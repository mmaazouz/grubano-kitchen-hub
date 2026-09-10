// ── P4.5-C1 — Customer refund-claim cycle (Agent 52) ─────────────────────────────
//
// A consumer who OWNS a paid order files a claim (reason + optional photo + requested
// amount) within CLAIM_WINDOW_HOURS. The owning restaurant ACCEPTS (→ triggers the
// P4.5-A engine lib/refund.executeRefund) or REFUSES within CLAIM_RESPONSE_HOURS; no
// response → AUTO-APPROVED by the internal cron. C1 is WORKFLOW + UI only — it CALLS
// the royalty-aware refund engine, it never reconstructs any split.
//
// GATING: isClaimsEnabled() gates the whole feature (routes/UI). The REAL refund only
// happens when isRefundsEnabled() is ON; with CLAIMS on + REFUNDS off, an approved
// claim rests at 'approved' (refund PENDING activation, refundId=null) — never silent.
//
// IDEMPOTENCE: executeRefund runs AT MOST ONCE per claim — `refundAttempted` flips
// false→true via an atomic updateMany (count===1 winner) BEFORE the engine call; a
// double-accept / re-click / cron+accept race / replay never refunds twice. A FAILED
// engine call leaves refundAttempted=true (status reverts 'approved' + refundError):
// it is NOT auto-retried, because executeRefund's idempotency cursor advances once the
// money moved, so a blind re-call could double-refund. Manual/C2 handles a stuck refund.

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type Stripe from 'stripe'
import { executeRefund, isRefundsEnabled } from '@/lib/refund'
import { buildClaimScope, resolveClaimAmount, publicClaimScope, type ClaimScope, type ClaimSelection, type StripeCashTruth } from '@/lib/claim-scope'
import { getStripe } from '@/lib/stripe'
import { canonicalReason, authorityScope, isSafetyReason } from '@/lib/claim-reasons'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
import { recordAdminAudit } from '@/lib/admin-audit'
// ROUND-6 AUDIT FIX: the "is this bound refund actually ours?" predicate lives in ONE place. It
// used to be re-derived here from `refundId` alone, which is exactly the proxy four rounds removed.
import { isResumeMismatch } from '@/lib/claim-money-line'

export type { ClaimSelection, StripeCashTruth } from '@/lib/claim-scope'
// The canonical reason taxonomy and its authority scopes live in lib/claim-reasons and are
// re-exported here so existing importers of '@/lib/claims' keep working unchanged.
export {
  CLAIM_REASONS, ACCEPTED_REASONS, LEGACY_REASON_ALIASES, canonicalReason, authorityScope,
  requiresItemSelection, isSafetyReason, reasonLabel, REASON_LABELS,
} from '@/lib/claim-reasons'
export type { ClaimReason, AuthorityScope } from '@/lib/claim-reasons'

/**
 * Live Stripe cash truth for an order's charge (batch 2).
 *
 * The DB only knows refunds the rail itself created. A refund issued from the Stripe
 * Dashboard leaves NO `Refund` row, so a DB-only ceiling overstates what is refundable.
 * This reads Stripe directly and also subtracts refunds still PENDING there, so a claim
 * cannot be authorized against cash that is already committed and in flight.
 *
 * Returns null when Stripe cannot be consulted — the caller then flags the ceiling as
 * `db_only` rather than silently pretending it was verified.
 */
export async function stripeCashTruthForOrder(piId: string | null | undefined): Promise<StripeCashTruth | null> {
  if (!piId) return null
  try {
    const stripe = getStripe()
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] })
    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    if (!charge) return null
    const capturedCents = charge.amount_captured ?? charge.amount ?? 0
    const refundedCents = charge.amount_refunded ?? 0
    // AUDIT FIX (batch 2). This used to read "pending refunds are NOT in amount_refunded yet",
    // which contradicts the project's own binding contract: REFUND-FINANCIAL-CONTRACT §66/§145
    // and A9 all state that `charge.amount_refunded` ALREADY counts a still-pending refund
    // (that is exactly why the ledger reconciles on Σ succeeded instead). Reported for its own
    // sake — buildClaimScope uses it as a FLOOR, never as a second subtraction.
    let pendingCents = 0
    try {
      const list = await stripe.refunds.list({ charge: charge.id, limit: 100 })
      pendingCents = (list.data || [])
        .filter((r) => r.status === 'pending' || r.status === 'requires_action')
        .reduce((a, r) => a + (r.amount || 0), 0)
    } catch { /* a refund list failure must not deny the captured/refunded truth we already hold */ }
    return { capturedCents, refundedCents, pendingCents }
  } catch (e) {
    console.warn('[claims scope] Stripe cash truth unavailable —', e instanceof Error ? e.message : e)
    return null
  }
}

/** Authoritative scope for ONE order: server line values + everything already refunded. */
export async function buildClaimScopeForOrder(input: {
  orderId: string
  items: unknown
  orderTotalEur: number
  /** The order's PaymentIntent — required to consult Stripe's own cumulative truth. */
  stripePaymentIntentId?: string | null
  /** Test seam: inject the Stripe truth instead of calling Stripe. */
  stripeTruth?: StripeCashTruth | null
}): Promise<ClaimScope> {
  // Already-refunded = SUCCEEDED rows only. A pending row has not moved money yet and a
  // failed one never will; counting either would silently shrink a legitimate claim.
  const agg = await prisma.refund.aggregate({
    where: { orderId: input.orderId, status: 'succeeded' },
    _sum:  { amountCents: true },
  })
  const stripe = input.stripeTruth !== undefined
    ? input.stripeTruth
    : await stripeCashTruthForOrder(input.stripePaymentIntentId)
  return buildClaimScope({
    items: input.items,
    orderTotalEur: input.orderTotalEur,
    alreadyRefundedCents: agg._sum.amountCents ?? 0,
    stripe,
  })
}

/**
 * T-53 — THE CLAIMS AUTHORIZATION IS A LEASE, NOT A BOOLEAN.
 *
 * Same core property as T-48 on the refund gate, for the same reason. A static flag survives
 * everything: SIGKILL, a host crash, a power cut, a reboot — `.env.local` is still on disk and
 * still says true. A rehearsal window opened for fifteen minutes could therefore stay open for
 * ever, and nobody would have to make a mistake for that to happen.
 *
 * So the flag alone authorizes NOTHING. The application additionally requires an ABSOLUTE
 * deadline that it re-checks on every call, which means the authorization dies of old age with
 * nobody acting. A restart does not extend it: the deadline is absolute, not a countdown. A
 * deadline beyond the compiled ceiling is refused outright rather than silently clamped, because
 * a year-long "window" is a configuration error or tampering, never a longer window.
 *
 * This lease grants NO refund authority whatsoever. The refund gate is separate and stays shut.
 */
export const CLAIMS_WINDOW_MAX_MS = 60 * 60 * 1000

export type ClaimsGateState =
  | { open: false; reason: 'flag_off' | 'no_lease' | 'lease_unreadable' | 'lease_expired' | 'lease_too_long' }
  | { open: true; expiresAt: Date; remainingMs: number }

/** The single place that decides whether the claims surface is open right now. */
export function claimsGateState(nowMs: number = Date.now()): ClaimsGateState {
  if (process.env.CLAIMS_ENABLED !== 'true') return { open: false, reason: 'flag_off' }
  const raw = (process.env.CLAIMS_WINDOW_UNTIL ?? '').trim()
  if (!raw) return { open: false, reason: 'no_lease' }
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return { open: false, reason: 'lease_unreadable' }
  if (t <= nowMs) return { open: false, reason: 'lease_expired' }
  if (t - nowMs > CLAIMS_WINDOW_MAX_MS) return { open: false, reason: 'lease_too_long' }
  return { open: true, expiresAt: new Date(t), remainingMs: t - nowMs }
}

/** Kill-switch — default OFF, and lease-bound since T-53. */
export function isClaimsEnabled(): boolean {
  return claimsGateState().open
}

/** P0-25 (vague 1, principe fondateur) : « aucune automatisation à effet financier
 *  sans validation humaine ». La route /api/admin/claims/auto-approve (sweep
 *  auto_timeout + re-pilotage des refunds en attente, via runClaimAutoApproval)
 *  REMBOURSE SANS HUMAIN — P0-07 a retiré son scheduler, ce flag rend la ROUTE
 *  elle-même inopérante. Défaut OFF (toute la bêta) ; seul le string exact 'true'
 *  l'active (post-pilote, décision fondateur + couplage check-flags). */
export function isClaimsAutoApproveEnabled(): boolean {
  return process.env.CLAIMS_AUTO_APPROVE_ENABLED === 'true'
}

function envHours(name: string, def: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : def
}
/** Submission window (default 48h), anchored on Order.updatedAt. */
export function claimWindowHours(): number { return envHours('CLAIM_WINDOW_HOURS', 48) }
/** Restaurant response delay before auto-approval (default 24h). */
export function claimResponseHours(): number { return envHours('CLAIM_RESPONSE_HOURS', 24) }
/** Contest window (default 48h) — a client may contest a refusal within this delay (C2). */
export function claimContestHours(): number { return envHours('CLAIM_CONTEST_HOURS', 48) }
/** P0-27 (vague 1) — verrou fail-safe de l'AUTO-RÉSOLUTION des petites réclamations
 *  (`autoResolveSmallClaim`, decidedBy 'auto_small' — le dernier chemin qui remboursait
 *  sans humain, signalé par la note Q3 de docs/ops/flags.md). Défaut OFF : l'ABSENCE de
 *  configuration signifie « désactivé », jamais « 10 € ». Seule la chaîne exacte 'true'
 *  active (convention maison, couplage check-flags : exige CLAIMS_ENABLED). */
export function isClaimAutoResolveEnabled(): boolean {
  return process.env.CLAIM_AUTO_RESOLVE_ENABLED === 'true'
}
/** Auto-resolution ceiling in CENTS. P0-27 : FAIL-SAFE — l'ancien défaut permissif
 *  (1000 = 10 € d'auto-remboursement ACTIF sans aucune config) est supprimé :
 *  absent/vide → 0 (désactivé) ; valeur mal formée (non-entier, négatif, texte) → 0
 *  + trace console — une erreur de configuration ne retombe JAMAIS sur un
 *  comportement permissif. Ne sert que si isClaimAutoResolveEnabled() est ON. (C2) */
export function claimAutoApproveMaxCents(): number {
  const raw = (process.env.CLAIM_AUTO_APPROVE_MAX_CENTS ?? '').trim()
  if (raw === '') return 0
  if (!/^\d+$/.test(raw)) {
    console.warn(`[claims auto-resolve] [P0-27] CLAIM_AUTO_APPROVE_MAX_CENTS mal formée (« ${raw} ») — plafond forcé à 0, auto-résolution désactivée (fail-safe).`)
    return 0
  }
  return Number.parseInt(raw, 10)
}
/** SOFT anti-abuse orientation thresholds (no money sanction, no hard block). */
function abuseRecentThreshold(): number {
  const v = Number.parseInt(process.env.CLAIM_ABUSE_RECENT_THRESHOLD ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 3
}
function abuseWindowDays(): number {
  const v = Number.parseInt(process.env.CLAIM_ABUSE_WINDOW_DAYS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 30
}


// Active statuses (the order is "locked" against a second claim while in these).
// C2 adds 'arbitration' (a contested claim is active). C1 never reaches it → byte-identical.
// FOUNDER DECISION T-49 (2026-09-10) — EVIDENCE-ONLY / FAIL-CLOSED AMBIGUITY.
//
// 'financial_verification' is the explicit state of a claim whose MONEY TRUTH cannot be
// established from evidence. It is deliberately ACTIVE, never terminal:
//   • active   ⇒ activeOrderKey stays held ⇒ the customer CANNOT re-file into overlapping
//                financial authority while the first transaction is unattributed;
//   • not terminal ⇒ nobody has declared the customer paid or unpaid. Neither is known.
// Money safety and recovery liveness are BOTH required: fail-closed financially AND
// fail-VISIBLE operationally. A safe state with no exit is not an acceptable beta design,
// so this status carries a durable ungated admin queue and an alert on entry.
const ACTIVE_STATUSES = ['restaurant_review', 'approved', 'refunding', 'arbitration', 'financial_verification'] as const

/** Money truth unresolved; human, evidence-based reconciliation required. */
export const FINANCIAL_VERIFICATION = 'financial_verification'

/**
 * T-49 CRASH-WINDOW SELF-LABELLING.
 *
 * `triggerClaimRefund` flips a claim to 'refunding' in one atomic CAS and only afterwards
 * learns the refund identity. An infrastructure fault in between (uncaught throw, DB write
 * failure, process death) used to leave 'refunding' + refundId null + refundError null: a state
 * no route could classify, no reconciler could reach and no admin could exit — while a Stripe
 * refund for that order may already have SUCCEEDED.
 *
 * The marker rides that SAME atomic transition, so there is no additional write and therefore
 * no new crash window. It does NOT assert failure: it says only that an attempt started and its
 * identity is not yet bound. Every terminal path already overwrites or clears `refundError`.
 */
export const RECONCILE_REQUIRED = 'reconcile_required'
const reconcileRequiredMarker = (now: Date) =>
  `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${now.toISOString()} — identité du remboursement pas encore liée. Ceci n'est PAS un échec : la vérité argent doit être PROUVÉE (Stripe), jamais devinée.`

/** True when this refundError is the crash marker rather than a recorded failure. */
export function isReconcileRequired(refundError?: string | null): boolean {
  return typeof refundError === 'string' && refundError.startsWith(RECONCILE_REQUIRED)
}

/** The identity stamped on a Refund row created BY a claim (lib/refund.ts persists it). */
export const claimRefundReason = (claimId: string) => `claim:${claimId}`
// T-52 — WRITERS of this stamp, so the identity rule has a single, auditable list:
//   1. lib/refund.ts at Refund row creation, from the claim that DRIVES the refund (the rail);
//   2. adoptStripeRefundForClaim below, when it mirrors a Stripe-Dashboard refund into a local
//      row for the claim the operator anchors it to — after proving at Stripe that the refund
//      sits on THIS order's payment. Its rows are recognisable by idempotencyKey `external:…`.
// Readers: reconcileClaimEvidence (`mine`), listFinancialVerificationClaims, attributeClaimRefund.

/**
 * ROUND-6 AUDIT FIX (P2). Proof of ABSENCE used to be written into `refundError` with no marker
 * of its own, so every reader of that field treated a proven-payable claim as a recorded FAILURE:
 * the arbitration console badged it « Erreur … décision humaine requise » and the admin-assertion
 * hatch (isStuckResolvable) offered to close it unpaid. The proof now carries a prefix, and the
 * classifier and the hatch recognise it. The rail-locked variant keeps its own prefix on purpose:
 * that one DOES need a human, because the engine will refuse the next attempt.
 */
export const NO_REFUND_PROVEN = 'no_refund_proven'
export function isNoRefundProven(refundError?: string | null): boolean {
  return typeof refundError === 'string' && refundError.startsWith(`${NO_REFUND_PROVEN}:`)
}
/** Closed for good: money already moved, or the case was definitively refused.
 *  'refused' is NOT terminal — the client may still contest it within the window. */
const TERMINAL_STATUSES: readonly string[] = ['refunded', 'refused_final']

export type ClaimActionResult =
  | { ok: true; claim: unknown; refund?: RefundTriggerResult }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string }

export type RefundTriggerResult =
  /** Email truthfulness hotfix (2026-09-06): `amountCents` = the ENGINE's actual succeeded cash
   *  refund (executeRefund result), so the customer e-mail never shows the REQUESTED amount. */
  | { state: 'refunded'; refundId: string; amountCents: number }
  | { state: 'pending'; reason: 'refunds_disabled' }
  /** PHASE 2 (§15 A7): Stripe accepted the refund but it is not succeeded yet — the claim
   *  stays 'refunding' with the Refund row id; NO refundError, NO revert to 'approved'.
   *  Moving refunding → refunded when Stripe succeeds is a recorded Phase 3 item. */
  | { state: 'pending'; reason: 'stripe_pending'; refundId: string }
  | { state: 'failed'; error: string }
  | { state: 'already_handled' }

const isP2002 = (err: unknown) =>
  !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'

// ── CLIENT — create a claim ──────────────────────────────────────────────────────
// FINANCIAL AUTHORITY IS SERVER-DERIVED (Claims batch 1). The consumer may send a line
// SELECTION (`items: [{ index, qty }]` pointing into the server-built scope) or nothing
// at all (= the whole remaining refundable). It may NOT send an amount: any
// `requestedAmountCents` in the request is ignored, and cannot widen authority.
export async function createClaim(input: {
  consumerId: string
  orderId: string
  reason: string
  description?: string | null
  items?: ClaimSelection[] | null
  /** What the consumer ASKED FOR. Honoured ONLY as a reduction below the server ceiling. */
  requestedAmountCents?: number | null
  photoUrl?: string | null
}): Promise<ClaimActionResult> {
  const reason = canonicalReason(input.reason)
  if (!reason) return { ok: false, status: 400, error: 'Motif de réclamation invalide.' }
  const order = await prisma.order.findUnique({
    where:  { id: input.orderId },
    select: { id: true, consumerId: true, restaurantId: true, paymentStatus: true, total: true, updatedAt: true, items: true, stripePaymentIntentId: true },
  })
  if (!order) return { ok: false, status: 404, error: 'Commande introuvable.' }
  // OWNER-SCOPING (client): the claimant must OWN the order. Resolved from the session
  // by the route; never a trusted client id.
  if (order.consumerId !== input.consumerId) {
    return { ok: false, status: 403, error: 'Commande non autorisée.' }
  }
  if (order.paymentStatus !== 'paid') {
    return { ok: false, status: 409, error: 'Commande non payée — aucune réclamation possible.' }
  }
  // Submission window (server-read), anchored on the delivery/last-activity time.
  const windowMs = claimWindowHours() * 3600 * 1000
  if (Date.now() - order.updatedAt.getTime() > windowMs) {
    return { ok: false, status: 409, error: `Le délai de réclamation (${claimWindowHours()} h) est dépassé.` }
  }
  const scope = await buildClaimScopeForOrder({ orderId: order.id, items: order.items, orderTotalEur: order.total, stripePaymentIntentId: order.stripePaymentIntentId })
  // The REASON decides whether a whole-order ceiling is even available (batch 2).
  const resolved = resolveClaimAmount(scope, input.items ?? null, input.requestedAmountCents ?? null, authorityScope(reason))
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error }
  const requested = resolved.amountCents

  const responseDeadlineAt = new Date(Date.now() + claimResponseHours() * 3600 * 1000)
  try {
    const claim = await prisma.claim.create({
      data: {
        orderId:              order.id,
        consumerId:           input.consumerId,
        restaurantId:         order.restaurantId,
        reason:               reason, // canonical value (legacy aliases normalised)
        description:          input.description ?? null,
        requestedAmountCents: requested,
        photoUrl:             input.photoUrl ?? null,
        status:               'restaurant_review',
        responseDeadlineAt,
        activeOrderKey:       order.id, // @unique → at most one ACTIVE claim per order
      },
    })
    return { ok: true, claim }
  } catch (err) {
    if (isP2002(err)) {
      return { ok: false, status: 409, error: 'Une réclamation est déjà en cours pour cette commande.' }
    }
    throw err
  }
}

export async function listConsumerClaims(consumerId: string) {
  return prisma.claim.findMany({ where: { consumerId }, orderBy: { createdAt: 'desc' }, take: 100 })
}

export type ClaimEligibility = {
  canClaim: boolean
  reason?: 'not_owner' | 'not_paid' | 'window_expired' | 'active_claim'
  maxRefundableCents: number
  windowHours: number
  // C2: existingClaim carries the refusal reason + whether the client may still CONTEST.
  existingClaim:
    | { id: string; status: string; canContest: boolean; restaurantResponseReason: string | null; arbitrationReason: string | null }
    | null
  /** Server-derived, client-safe line scope. Never echoes a client-supplied price. */
  scope?: ReturnType<typeof publicClaimScope>
}

/** Server-derived eligibility for the client UI (owner + paid + within window + no
 *  active claim). All checks mirror createClaim so the button can never offer a claim
 *  the POST would reject. */
export async function getClaimEligibility(input: { consumerId: string; orderId: string }): Promise<ClaimEligibility> {
  const windowHours = claimWindowHours()
  const order = await prisma.order.findUnique({
    where:  { id: input.orderId },
    select: { consumerId: true, paymentStatus: true, total: true, updatedAt: true, items: true, stripePaymentIntentId: true },
  })
  if (!order || order.consumerId !== input.consumerId) {
    // Anti-IDOR: a non-owner learns nothing about the order (no total, no lines).
    return { canClaim: false, reason: 'not_owner', maxRefundableCents: 0, windowHours, existingClaim: null }
  }
  // Server-derived ceiling: order total MINUS what is already refunded (a second claim
  // on a partially refunded order can never ask for the whole order again).
  // AUDIT FIX (batch 2): the ceiling SHOWN to the customer must use the same cumulative
  // truth as the one enforced at creation, otherwise a Dashboard refund is invisible here and
  // the form offers an amount the server will refuse.
  const scope = await buildClaimScopeForOrder({ orderId: input.orderId, items: order.items, orderTotalEur: order.total, stripePaymentIntentId: order.stripePaymentIntentId })
  const maxRefundableCents = scope.maxAuthorityCents
  const publicScope = publicClaimScope(scope)
  const existing = await prisma.claim.findFirst({
    where:   { orderId: input.orderId, consumerId: input.consumerId },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, status: true, decidedAt: true, restaurantResponseReason: true, arbitrationReason: true },
  })
  // C2: a refused claim can be contested while within the contest window.
  const canContest = !!existing && existing.status === 'refused' && !!existing.decidedAt &&
    (Date.now() - existing.decidedAt.getTime() <= claimContestHours() * 3600 * 1000)
  const existingClaim = existing
    ? { id: existing.id, status: existing.status, canContest, restaurantResponseReason: existing.restaurantResponseReason, arbitrationReason: existing.arbitrationReason }
    : null
  if (order.paymentStatus !== 'paid') return { canClaim: false, reason: 'not_paid', maxRefundableCents, windowHours, existingClaim, scope: publicScope }
  if (Date.now() - order.updatedAt.getTime() > windowHours * 3600 * 1000) {
    return { canClaim: false, reason: 'window_expired', maxRefundableCents, windowHours, existingClaim, scope: publicScope }
  }
  if (existing && (ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
    return { canClaim: false, reason: 'active_claim', maxRefundableCents, windowHours, existingClaim, scope: publicScope }
  }
  return { canClaim: true, maxRefundableCents, windowHours, existingClaim, scope: publicScope }
}

// ── SAFETY TRIAGE (batch 2 audit fix) ─────────────────────────────────────────────
// A safety report was flagged only once it reached the STUCK-MONEY list — i.e. after the
// refund had already failed. On the lists where a claim actually ARRIVES (the restaurant's
// queue, the admin's pending and silence-expired lists) it was indistinguishable from a
// missing side dish, so an allergen exposure could sit behind two hundred ordinary claims.
// This changes VISIBILITY and ORDER only: no extra financial authority, no automatic
// refund, no medical conclusion — a human still decides (see isSafetyReason).
function triageBySafety<T extends { reason: string }>(rows: T[]): Array<T & { safety: boolean }> {
  return rows
    .map((r) => ({ ...r, safety: isSafetyReason(r.reason) }))
    // Stable: safety rows float to the top, everything else keeps the query's own order.
    .sort((a, b) => (b.safety ? 1 : 0) - (a.safety ? 1 : 0))
}

export async function listRestaurantClaims(restaurantIds: string[], opts?: { status?: string }) {
  if (restaurantIds.length === 0) return []
  const rows = await prisma.claim.findMany({
    where:   { restaurantId: { in: restaurantIds }, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  return triageBySafety(rows)
}

// ── REFUND TRIGGER — executeRefund at most once per claim ─────────────────────────
/**
 * T-51 — AMOUNT IS EVIDENCE; AMOUNT IS NOT IDENTITY.
 *
 * RESUME-FIRST re-drives the oldest PENDING Refund row of the ORDER, whoever created it. The
 * engine flags a mismatch only when the AMOUNTS differ, and this module compared amounts too.
 * Two legitimate refunds on one order can carry the same amount, so a claim could be bound to —
 * and reported settled by — a refund created by the admin rail, the ghost-order path, or an
 * earlier claim. Same money, wrong attribution, and a customer told their claim was settled by
 * a payment that was never theirs.
 *
 * The binding is now checked against the row's OWN identity. An unreadable identity fails
 * CLOSED: a binding we cannot verify is treated exactly like a wrong one.
 */
async function refundRowBelongsToClaim(refundRowId: string, claimId: string): Promise<boolean> {
  try {
    const row = await prisma.refund.findUnique({ where: { id: refundRowId }, select: { reason: true } })
    return !!row && row.reason === claimRefundReason(claimId)
  } catch (e) {
    console.warn('[claims] refund identity check unavailable —', e instanceof Error ? e.message : e)
    return false
  }
}

// Exported for the test that pins what an engine failure WRITES (round 7); no new caller.
export async function triggerClaimRefund(claimId: string): Promise<RefundTriggerResult> {
  // REFUNDS gate: engine off → leave the claim 'approved', refund pending activation.
  if (!isRefundsEnabled()) return { state: 'pending', reason: 'refunds_disabled' }

  // ATOMIC claim of the single refund attempt: only one caller flips the flag.
  const got = await prisma.claim.updateMany({
    where: { id: claimId, status: 'approved', refundAttempted: false },
    // T-49: the marker rides the SAME atomic write — no extra round trip, no new window.
    data:  { refundAttempted: true, status: 'refunding', refundError: reconcileRequiredMarker(new Date()) },
  })
  if (got.count !== 1) return { state: 'already_handled' }

  const claim = await prisma.claim.findUnique({
    where:  { id: claimId },
    select: { orderId: true, requestedAmountCents: true },
  })
  if (!claim) return { state: 'already_handled' }

  const result = await executeRefund({
    orderId:     claim.orderId,
    amountCents: claim.requestedAmountCents,
    reason:      `claim:${claimId}`,
  })

  if (result.ok) {
    // REFUND IDENTITY BINDING (Claims batch 1, baseline P2). RESUME-FIRST can re-drive an
    // OLDER interrupted Refund row of the same order instead of this claim's amount: the
    // engine then reports `resumedIgnoredAmount`. Money DID move — but not for this claim.
    // Binding the claim to that row and calling it 'refunded' would state that the claim
    // was settled for an amount nobody asked for. Keep it in 'refunding', bind the ACTUAL
    // Refund identity that was driven, and hand it to the admin queue with an explicit
    // reason. NEVER auto-retry (the engine cursor has advanced).
    if (result.resumedIgnoredAmount) {
      await prisma.claim.update({
        where: { id: claimId },
        data:  {
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a repris un remboursement antérieur (${result.amountCents} c) au lieu du montant de cette réclamation (${claim.requestedAmountCents} c). Décision admin requise — aucun nouveau remboursement automatique.`,
        },
      })
      return { state: 'failed', error: 'resume_mismatch' }
    }
    // T-51: the engine can succeed on a row this claim did not create. Verify identity BEFORE
    // telling the customer their claim was settled.
    if (!(await refundRowBelongsToClaim(result.refundId, claimId))) {
      await prisma.claim.update({
        where: { id: claimId },
        data:  {
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a abouti sur un remboursement (${result.refundId}) qui n'appartient PAS à cette réclamation — montant identique, identité différente. De l'argent A bougé, mais pas au titre de cette réclamation. Décision admin requise — aucun nouveau remboursement automatique.`,
        },
      })
      return { state: 'failed', error: 'resume_mismatch' }
    }
    await prisma.claim.update({
      where: { id: claimId },
      data:  { status: 'refunded', refundId: result.refundId, refundError: null, activeOrderKey: null },
    })
    return { state: 'refunded', refundId: result.refundId, amountCents: result.amountCents }
  }
  // PHASE 2 (§15 A7) — Stripe accepted the refund but it is NOT succeeded yet: money has
  // not reached the customer. Keep the claim 'refunding' (truthful), record the Refund row,
  // write NO refundError and do NOT revert to 'approved' (that would make the claim
  // permanently un-retriable while a live Stripe refund exists).
  if (result.pending) {
    // RE-AUDIT FIX (P1): the 202 outcome does NOT carry `resumedIgnoredAmount`, so the guard
    // above cannot see a RESUME-FIRST mismatch on the pending path. It does carry the amount
    // actually driven — compare it. Clearing refundError unconditionally here would also have
    // erased a mismatch flag written by an earlier attempt.
    if (result.amountCents !== claim.requestedAmountCents) {
      await prisma.claim.update({
        where: { id: claimId },
        data:  {
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a repris un remboursement antérieur (${result.amountCents} c, encore en attente chez Stripe) au lieu du montant de cette réclamation (${claim.requestedAmountCents} c). Décision admin requise — aucun nouveau remboursement automatique.`,
        },
      })
      return { state: 'failed', error: 'resume_mismatch' }
    }
    // T-51: identical identity guard on the 202 path — a pending refund we did not create is
    // still not ours to report as this claim's.
    if (!(await refundRowBelongsToClaim(result.refundId, claimId))) {
      await prisma.claim.update({
        where: { id: claimId },
        data:  {
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a repris un remboursement (${result.refundId}) qui n'appartient PAS à cette réclamation — montant identique, identité différente, encore en attente chez Stripe. Décision admin requise — aucun nouveau remboursement automatique.`,
        },
      })
      return { state: 'failed', error: 'resume_mismatch' }
    }
    await prisma.claim.update({
      where: { id: claimId },
      data:  { refundId: result.refundId, refundError: null },
    })
    return { state: 'pending', reason: 'stripe_pending', refundId: result.refundId }
  }
  // Engine failed AFTER the attempt flag — do NOT auto-retry (the cursor may have moved;
  // a blind re-call could double-refund). Revert to 'approved' for visibility + record.
  //
  // ROUND-7 AUDIT FIX (P1): the engine's USER-FACING sentence (« Erreur paiement, réessayez. »,
  // « … — réessayez. ») was persisted verbatim and rendered raw under « Détail : » on a card
  // whose only controls close the case and whose header says no retry exists. The engine text is
  // kept as evidence, wrapped in what is true from here: nothing re-drives it from Claims.
  await prisma.claim.update({
    where: { id: claimId },
    data:  { status: 'approved', refundError: `engine_failed: ${result.error} — aucune relance possible depuis les réclamations ; décision humaine requise.` },
  })
  return { state: 'failed', error: result.error }
}

// ── APPROVE — restaurant accept OR auto-timeout ───────────────────────────────────
async function approveClaim(claimId: string, decidedBy: 'restaurant' | 'auto_timeout' | 'auto_small' | 'admin'): Promise<RefundTriggerResult> {
  // ATOMIC transition restaurant_review → approved (only one caller wins).
  const claimed = await prisma.claim.updateMany({
    where: { id: claimId, status: 'restaurant_review' },
    data:  { status: 'approved', restaurantResponse: 'accepted', decidedBy, decidedAt: new Date() },
  })
  if (claimed.count !== 1) return { state: 'already_handled' }
  return triggerClaimRefund(claimId)
}

// ── RESTO — respond to a claim (owner-scoped by the route) ────────────────────────
// P0-24 (vague 1, Q3 volet 2) : ACCEPTER ne déclenche PLUS de remboursement. Le
// restaurateur garde le droit de RECONNAÎTRE le problème (restaurantResponse
// 'accepted') ; la réclamation est routée vers la FILE ADMIN (status 'arbitration',
// la file existante) où SEUL un admin Grubano décide et déclenche le remboursement
// (arbitrateClaim → triggerClaimRefund). decidedBy/decidedAt restent vides : la
// décision d'argent appartient à l'admin, pas au resto. Aucun montant (partiel ou
// intégral) n'est déclenchable depuis ce chemin.
export async function respondToClaim(input: {
  claimId: string
  restaurantIds: string[]   // the responding operator's owned restaurants (from session)
  action: 'accept' | 'refuse'
  reason?: string | null
}): Promise<ClaimActionResult> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, restaurantId: true, status: true },
  })
  // Anti-IDOR: a claim on another operator's order is INVISIBLE (404, not 403).
  if (!claim || !input.restaurantIds.includes(claim.restaurantId)) {
    return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  }
  if (claim.status !== 'restaurant_review') {
    return { ok: false, status: 409, error: 'Cette réclamation a déjà été traitée.' }
  }

  if (input.action === 'refuse') {
    const refused = await prisma.claim.updateMany({
      where: { id: claim.id, status: 'restaurant_review' },
      data:  {
        status:                   'refused',
        restaurantResponse:       'refused',
        restaurantResponseReason: input.reason ?? null,
        decidedBy:                'restaurant',
        decidedAt:                new Date(),
        activeOrderKey:           null, // terminal → free the order (C2 may re-claim)
      },
    })
    if (refused.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a déjà été traitée.' }
    const updated = await prisma.claim.findUnique({ where: { id: claim.id } })
    return { ok: true, claim: updated }
  }

  // accept → FILE ADMIN (P0-24). CAS restaurant_review → arbitration (count===1
  // winner) ; activeOrderKey reste posé (arbitration est un statut ACTIF). AUCUN
  // appel au moteur de remboursement ici — l'admin décide via arbitrateClaim.
  const moved = await prisma.claim.updateMany({
    where: { id: claim.id, status: 'restaurant_review' },
    data:  {
      status:                   'arbitration',
      restaurantResponse:       'accepted',
      restaurantResponseReason: input.reason ?? null,
    },
  })
  if (moved.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a déjà été traitée.' }
  const updated = await prisma.claim.findUnique({ where: { id: claim.id } })
  return { ok: true, claim: updated }
}

// ── CRON — auto-approve expired claims + drive pending refunds ────────────────────
export type ClaimSweepSummary = {
  autoApproved: number
  refundsTriggered: number
  refundsPending: number
  refundsFailed: number
  scannedExpired: number
  scannedPending: number
}

export async function runClaimAutoApproval(): Promise<ClaimSweepSummary> {
  const summary: ClaimSweepSummary = {
    autoApproved: 0, refundsTriggered: 0, refundsPending: 0, refundsFailed: 0, scannedExpired: 0, scannedPending: 0,
  }
  const now = new Date()

  // 1. Expired restaurant_review → auto-approve (and attempt the refund).
  // AUDIT FIX (batch 2, defence in depth). This sweep is unreachable in every authorized
  // configuration — CLAIMS_AUTO_APPROVE_ENABLED is documented OFF for the whole beta and its
  // scheduler was deleted by founder decision P0-07 precisely because it pays out with no admin
  // in the loop. But the batch's rule is "a machine never closes a safety report", and a rule
  // that holds on one automatic path and not the other is not a rule. Safety claims are skipped
  // here too, so the invariant does not depend on a flag staying off.
  const expired = await prisma.claim.findMany({
    where:  { status: 'restaurant_review', responseDeadlineAt: { lt: now } },
    select: { id: true, reason: true },
    take:   500,
  })
  summary.scannedExpired = expired.length
  for (const c of expired) {
    if (isSafetyReason(c.reason)) {
      console.warn(`[claims auto-approval] SAFETY reason (${c.reason}) on claim ${c.id} — skipped by design; a human must decide.`)
      continue
    }
    const r = await approveClaim(c.id, 'auto_timeout')
    if (r.state !== 'already_handled') summary.autoApproved++
    if (r.state === 'refunded') summary.refundsTriggered++
    else if (r.state === 'pending') summary.refundsPending++
    else if (r.state === 'failed') summary.refundsFailed++
  }

  // 2. Approved-but-unrefunded (e.g. REFUNDS_ENABLED was OFF at approval, now ON) →
  //    drive the refund exactly once (refundAttempted guard). Skipped when REFUNDS off.
  if (isRefundsEnabled()) {
    const pending = await prisma.claim.findMany({
      where:  { status: 'approved', refundAttempted: false },
      select: { id: true },
      take:   500,
    })
    summary.scannedPending = pending.length
    for (const c of pending) {
      const r = await triggerClaimRefund(c.id)
      if (r.state === 'refunded') summary.refundsTriggered++
      else if (r.state === 'pending') summary.refundsPending++
      else if (r.state === 'failed') summary.refundsFailed++
    }
  }

  return summary
}

// ═══════════════════════════════════════════════════════════════════════════════════
// P4.5-C2 — neutrality & anti-abuse layer (Agent 53): auto-resolution of small cases,
// contest → ADMIN arbitration, and read-only abuse signals. Reuses the C1 idempotent
// refund trigger; the C1 cycle (createClaim/respondToClaim/runClaimAutoApproval) is
// untouched. The arbiter is ALWAYS a neutral Grubano admin — never a party.
// ═══════════════════════════════════════════════════════════════════════════════════

/** SOFT abuse orientation (no money sanction, no hard block): a consumer with ≥ N claims
 *  in the last M days is routed to the normal resto review instead of auto-resolution. */
export async function isConsumerAbuseFlagged(consumerId: string): Promise<boolean> {
  const since = new Date(Date.now() - abuseWindowDays() * 24 * 3600 * 1000)
  const recent = await prisma.claim.count({ where: { consumerId, createdAt: { gte: since } } })
  return recent >= abuseRecentThreshold()
}

// ── AUTO-RESOLUTION of small, obvious claims (called by the create route post-create) ──
// At/below the ceiling, from a non-flagged consumer → approve immediately (carried by
// the resto via the engine prorata), no resto round-trip. Otherwise a NO-OP → the claim
// stays 'restaurant_review' = the exact C1 flow. Reuses approveClaim (CAS) +
// triggerClaimRefund (≤1 refund/claim). Never a second refund (refundAttempted guard).
// P0-27 : DOUBLE VERROU FAIL-SAFE — flag booléen (défaut OFF, gate n°1) ET plafond > 0
// (défaut 0, gate n°2). Sans configuration explicite des DEUX, aucun remboursement
// automatique ne part : la réclamation suit le flux C1 (revue restaurant), et le
// non-déclenchement est TRACÉ (console.warn), jamais silencieux.
export async function autoResolveSmallClaim(
  claim: { id: string; consumerId: string; requestedAmountCents: number; status: string; reason?: string | null },
): Promise<RefundTriggerResult | { state: 'not_eligible' }> {
  // AUDIT FIX (batch 2): a SAFETY report — allergen exposure, foreign body, illness — must
  // never be closed by a machine paying out a few euros. Money is not the answer to it: a
  // human has to see it. Small amounts made this the MOST likely path to auto-close, so the
  // check comes FIRST, before every other gate, and routes the claim to human review.
  if (claim.reason && isSafetyReason(claim.reason)) {
    console.warn(`[claims auto-resolve] SAFETY reason (${claim.reason}) — auto-resolution refused by design; human review required.`)
    return { state: 'not_eligible' }
  }
  if (!isClaimAutoResolveEnabled()) {
    console.warn('[claims auto-resolve] [P0-27] CLAIM_AUTO_RESOLVE_ENABLED est OFF — aucune auto-résolution, la réclamation part en revue restaurant (validation humaine).')
    return { state: 'not_eligible' }
  }
  if (claim.status !== 'restaurant_review') return { state: 'not_eligible' }
  const ceiling = claimAutoApproveMaxCents()
  if (ceiling <= 0) {
    // Revue P0-27 : flag ON mais plafond absent/0 = config incomplète — sans cette
    // trace, le no-op serait TOTALEMENT silencieux (sûr mais indébuggable).
    console.warn('[claims auto-resolve] [P0-27] CLAIM_AUTO_RESOLVE_ENABLED est ON mais le plafond CLAIM_AUTO_APPROVE_MAX_CENTS est absent/0 — auto-résolution inopérante (fail-safe).')
    return { state: 'not_eligible' }
  }
  if (claim.requestedAmountCents > ceiling) return { state: 'not_eligible' }
  if (await isConsumerAbuseFlagged(claim.consumerId)) return { state: 'not_eligible' } // orient to resto review
  return approveClaim(claim.id, 'auto_small')
}

// ── CLIENT — contest a refusal → admin arbitration ───────────────────────────────
export async function contestClaim(input: { claimId: string; consumerId: string; reason?: string | null }): Promise<ClaimActionResult> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, consumerId: true, orderId: true, status: true, decidedAt: true },
  })
  // Owner-scoping: a claim that is not the caller's is INVISIBLE (404 — no IDOR).
  if (!claim || claim.consumerId !== input.consumerId) {
    return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  }
  if (claim.status !== 'refused') {
    return { ok: false, status: 409, error: 'Cette réclamation ne peut pas être contestée.' }
  }
  const anchor = claim.decidedAt?.getTime() ?? 0
  if (!anchor || Date.now() - anchor > claimContestHours() * 3600 * 1000) {
    return { ok: false, status: 409, error: `Le délai de contestation (${claimContestHours()} h) est dépassé.` }
  }
  // CAS refused → arbitration (count===1 winner); re-acquire activeOrderKey (active again).
  try {
    const moved = await prisma.claim.updateMany({
      where: { id: claim.id, status: 'refused' },
      data:  { status: 'arbitration', contestedAt: new Date(), contestReason: input.reason ?? null, activeOrderKey: claim.orderId },
    })
    if (moved.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation ne peut plus être contestée.' }
  } catch (err) {
    // A newer active claim already holds activeOrderKey for this order → cannot re-activate.
    if (isP2002(err)) return { ok: false, status: 409, error: 'Une réclamation active existe déjà pour cette commande.' }
    throw err
  }
  const updated = await prisma.claim.findUnique({ where: { id: claim.id } })
  return { ok: true, claim: updated }
}

// ── ADMIN — arbitrate a claim awaiting a Grubano decision ─────────────────────────
// P0-24 : la file admin reçoit désormais TROIS provenances — (1) contestation client
// (C2, chemin historique), (2) acceptation RESTAURATEUR (routée ici sans argent),
// (3) HÉRITAGE : les réclamations déjà 'approved' AVANT P0-24 avec refundAttempted
// false (acceptées sous l'ancienne règle, argent jamais parti car REFUNDS était OFF).
// Pour (3), l'admin décide aussi : approve → déclenche le remboursement idempotent ;
// refuse_final → clôture sans argent. Les 'approved' avec refundAttempted=true sont
// EXCLUS (l'argent a pu bouger — reprise manuelle uniquement, jamais un re-trigger).
export async function arbitrateClaim(input: { claimId: string; adminId: string; decision: 'approve' | 'refuse_final'; reason?: string | null }): Promise<ClaimActionResult> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, status: true, refundAttempted: true, responseDeadlineAt: true, arbitrationDecision: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }

  // FINALIZATION LOCK (Claims batch 1, baseline P1): a DECIDED outcome must not be rewritten
  // — the historic guard re-admitted an 'approved' + refundAttempted:false row even after an
  // admin had ruled, so a second decision could flip an approval into refused_final.
  //
  // AUDIT FIX (P1): the first version of this lock was too wide and REGRESSED the beta. In the
  // beta's real configuration (CLAIMS on, REFUNDS off) `triggerClaimRefund` returns
  // refunds_disabled BEFORE flipping `refundAttempted`, so an admin-approved claim rests at
  // status 'approved' / arbitrationDecision 'approved' / refundAttempted false — money owed,
  // nothing paid. Locking that row made it unarbitrable AND removed it from the queue: the
  // customer had been e-mailed "approved" and no in-app path could ever pay them.
  // An UNPAID approval is not a final state. Re-driving it is allowed; REVERSING it is not.
  const awaitingRefundActivation = claim.status === 'approved' && !claim.refundAttempted
  if (claim.arbitrationDecision && !awaitingRefundActivation) {
    return { ok: false, status: 409, error: 'Cette réclamation a déjà été arbitrée — décision définitive.' }
  }
  if (claim.arbitrationDecision === 'approved' && input.decision === 'refuse_final') {
    return { ok: false, status: 409, error: 'Cette réclamation a déjà été approuvée — elle ne peut plus être refusée (le client en a été informé).' }
  }
  if (TERMINAL_STATUSES.includes(claim.status)) {
    return { ok: false, status: 409, error: 'Cette réclamation est clôturée — elle ne peut plus être arbitrée.' }
  }

  const now = new Date()
  const legacyApproved = claim.status === 'approved' && !claim.refundAttempted // héritage pré-P0-24
  // RESTAURANT SILENCE (Claims batch 1, baseline gap 1): a claim the restaurant never
  // answered stayed in restaurant_review FOREVER — no admin transition existed, so silence
  // permanently blocked resolution. Once the response deadline has passed the claim becomes
  // ADMIN-ACTIONABLE. Silence never triggers a refund by itself: it only hands the decision
  // to the neutral admin, who still has to approve or refuse explicitly.
  const deadline = claim.responseDeadlineAt instanceof Date ? claim.responseDeadlineAt : null
  const silenceExpired = claim.status === 'restaurant_review' && !!deadline && deadline.getTime() <= now.getTime()
  if (claim.status === 'restaurant_review' && !silenceExpired) {
    return { ok: false, status: 409, error: 'Le restaurant dispose encore du délai de réponse — arbitrage prématuré.' }
  }
  if (claim.status !== 'arbitration' && !legacyApproved && !silenceExpired) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas en arbitrage.' }
  }

  // CAS guard matching the exact state observed — race-safe against a restaurant answering
  // at the same instant (its updateMany and ours cannot both see restaurant_review).
  const casWhere: Prisma.ClaimWhereInput = silenceExpired
    ? { id: claim.id, status: 'restaurant_review', responseDeadlineAt: { lte: now }, arbitrationDecision: null } // deadline re-checked in the CAS
    : legacyApproved
      // RE-AUDIT FIX (P1, my own incomplete fix): `arbitrationDecision: null` here means IS NULL
      // in Prisma, so this CAS matched ZERO rows for the exact case the guard above now allows —
      // an admin-approved but unpaid claim — and the call still 409'd. The money stayed stranded
      // and only the pre-CAS half of the fix was real. `refundAttempted: false` here, plus the
      // atomic flip inside triggerClaimRefund, already guarantee at most one refund per claim,
      // so this branch needs no second-admin filter. The other two branches keep theirs.
      ? { id: claim.id, status: 'approved', refundAttempted: false }
      : { id: claim.id, status: 'arbitration', arbitrationDecision: null }

  if (input.decision === 'refuse_final') {
    const done = await prisma.claim.updateMany({
      where: casWhere,
      data:  {
        status: 'refused_final', arbitratedBy: input.adminId, arbitrationDecision: 'refused_final',
        arbitrationReason: input.reason ?? null, arbitratedAt: new Date(), decidedBy: 'admin',
        decidedAt: new Date(), activeOrderKey: null, // terminal
      },
    })
    if (done.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a déjà été arbitrée.' }
    const updated = await prisma.claim.findUnique({ where: { id: claim.id } })
    return { ok: true, claim: updated }
  }

  // approve → CAS vers 'approved' avec les métadonnées d'arbitrage (count===1),
  // puis le MÊME remboursement idempotent (triggerClaimRefund, ≤1 par réclamation).
  // Héritage : déjà 'approved' → on n'écrit QUE les métadonnées (même garde CAS).
  const moved = await prisma.claim.updateMany({
    where: casWhere,
    data:  {
      status: 'approved', arbitratedBy: input.adminId, arbitrationDecision: 'approved',
      arbitrationReason: input.reason ?? null, arbitratedAt: new Date(), decidedBy: 'admin', decidedAt: new Date(),
    },
  })
  if (moved.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a déjà été arbitrée.' }
  const refund = await triggerClaimRefund(claim.id)
  const updated = await prisma.claim.findUnique({ where: { id: claim.id } })
  return { ok: true, claim: updated, refund }
}

// ── ANTI-ABUSE SIGNALS — read-only aggregation (display + orientation, NO sanction) ──
export type ConsumerClaimStats = { total: number; recent: number; approved: number; refused: number; approvalRate: number; flagged: boolean }
export async function consumerClaimStats(consumerId: string): Promise<ConsumerClaimStats> {
  const since = new Date(Date.now() - abuseWindowDays() * 24 * 3600 * 1000)
  const [total, recent, byStatus] = await Promise.all([
    prisma.claim.count({ where: { consumerId } }),
    prisma.claim.count({ where: { consumerId, createdAt: { gte: since } } }),
    prisma.claim.groupBy({ by: ['status'], where: { consumerId }, _count: true }),
  ])
  const cnt = (s: string) => byStatus.find((g) => g.status === s)?._count ?? 0
  const approved = cnt('approved') + cnt('refunding') + cnt('refunded')
  const refused = cnt('refused') + cnt('refused_final')
  const decided = approved + refused
  return { total, recent, approved, refused, approvalRate: decided ? approved / decided : 0, flagged: recent >= abuseRecentThreshold() }
}

export type RestaurantRefusalStats = { refused: number; overturned: number; overturnRate: number; flagged: boolean }
export async function restaurantRefusalStats(restaurantId: string): Promise<RestaurantRefusalStats> {
  const [refused, overturned] = await Promise.all([
    prisma.claim.count({ where: { restaurantId, restaurantResponse: 'refused' } }),
    // overturned = the resto refused but a neutral admin later APPROVED on contest.
    prisma.claim.count({ where: { restaurantId, restaurantResponse: 'refused', arbitrationDecision: 'approved' } }),
  ])
  const overturnRate = refused ? overturned / refused : 0
  return { refused, overturned, overturnRate, flagged: refused >= 3 && overturnRate >= 0.5 }
}

/** The admin arbitration queue, each claim enriched with both parties' abuse signals.
 *  P0-24 : inclut aussi l'HÉRITAGE — les réclamations 'approved' non remboursées
 *  (refundAttempted=false, acceptées avant P0-24 pendant que REFUNDS était OFF) —
 *  pour qu'aucune décision d'argent en attente n'échappe à la file admin. */
export async function listArbitrationQueue() {
  const now = new Date()
  const claims = await prisma.claim.findMany({
    where: {
      OR: [
        { status: 'arbitration' },
        // EVERY unpaid approval, including one an admin already approved while REFUNDS was off.
        // AUDIT FIX (P1): filtering these on arbitrationDecision:null deleted the beta's most
        // common money-owed row from the only list that showed it.
        { status: 'approved', refundAttempted: false },
        // Claims batch 1: restaurant silence past the deadline is now ADMIN-ACTIONABLE,
        // so it can no longer sit invisible in restaurant_review for ever.
        { status: 'restaurant_review', responseDeadlineAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  // RE-AUDIT FIX (batch 2). Safety triage stopped ONE STEP before the screen that matters: this
  // is the only admin list carrying the approve / refuse buttons, and every safety claim the
  // machine path refuses ends up here once the restaurant routes it. Ordered by createdAt alone,
  // an allergen report sat among up to 200 rows indistinguishable from a missing side dish, at
  // the exact moment a human decides it. Visibility and order only — no extra authority.
  claims.sort((a, b) => (isSafetyReason(b.reason) ? 1 : 0) - (isSafetyReason(a.reason) ? 1 : 0))
  return Promise.all(claims.map(async (c) => ({
    ...c,
    safety:          isSafetyReason(c.reason),
    authority:       claimAuthority(c, now),
    /** Why this row is in the queue — the admin should not have to infer it. */
    queueReason:
      c.status === 'arbitration' ? 'contested_or_routed'
        : c.status === 'restaurant_review' ? 'restaurant_silence_expired'
          : 'legacy_pending_money_decision',
    consumerStats:   await consumerClaimStats(c.consumerId),
    restaurantStats: await restaurantRefusalStats(c.restaurantId),
  })))
}

/** P0-39 (vague 3) — les réclamations EN ATTENTE DE RÉPONSE DU RESTAURANT, pour
 *  la console admin. L'auto-approbation 24 h (la soupape du circuit) a été
 *  retirée (P0-07 + P0-25, conformément à Q3) sans remplacement : une
 *  réclamation qu'un restaurant ignore restait bloquée indéfiniment, invisible
 *  de tous. REQUÊTE PURE, lecture seule — AUCUNE transition, AUCUN effet : la
 *  décision reste au restaurant, puis à l'admin en arbitrage (Q3 interdit toute
 *  automatisation à effet financier). Indexée ([status, responseDeadlineAt] /
 *  [restaurantId, status]) ; les plus anciennes d'abord (l'ancienneté est
 *  l'information que l'admin vient chercher). */
/** P0-08 (vague 4) — demande de remboursement SYSTÈME. L'annulation par le
 *  restaurant d'une commande PAYÉE entre DIRECTEMENT dans la file d'arbitrage
 *  admin (status 'arbitration') : l'argent encaissé d'une commande annulée ne
 *  peut pas rester acquis par défaut — mais Q3 est absolu, AUCUN remboursement
 *  n'est déclenché ici : une DEMANDE est créée, l'admin tranche (arbitrateClaim,
 *  le circuit prouvé en exécution le 04/08).
 *  · Le motif est DISTINCT de CLAIM_REASONS et INACCESSIBLE au schéma public
 *    (z.enum(CLAIM_REASONS) ne peut pas le produire — même patron que le
 *    `cancelledBy` système des réservations, hors enum client).
 *  · activeOrderKey @unique ⇒ au plus UNE demande ACTIVE par commande : un
 *    rejeu, ou une réclamation client déjà active sur la même commande, retombe
 *    en P2002 → { created:false, reason:'already_active' } — la question de
 *    l'argent est DÉJÀ dans le circuit, jamais de doublon.
 *  · `tx` optionnel : l'appelant peut l'inscrire dans la MÊME transaction que
 *    l'annulation (atomicité annulation+demande — P0-08 critère 1).
 *  CETTE FONCTION EST ADDITIVE : aucune transition existante n'est modifiée. */
export const SYSTEM_CLAIM_REASON_ORDER_CANCELLED = 'system_order_cancelled'

export async function createSystemClaim(input: {
  orderId:              string
  consumerId:           string
  restaurantId:         string
  requestedAmountCents: number
  description?:         string | null
  tx?:                  Prisma.TransactionClient
}): Promise<{ created: true; claimId: string } | { created: false; reason: 'already_active' }> {
  const db = input.tx ?? prisma
  try {
    const claim = await db.claim.create({
      data: {
        orderId:              input.orderId,
        consumerId:           input.consumerId,
        restaurantId:         input.restaurantId,
        reason:               SYSTEM_CLAIM_REASON_ORDER_CANCELLED,
        description:          input.description ?? null,
        requestedAmountCents: input.requestedAmountCents,
        status:               'arbitration', // directement la file admin — pas de revue resto
        // Champ NOT NULL du modèle ; sans objet en arbitration (la sonde P0-39
        // ne regarde que 'restaurant_review') — posé à maintenant.
        responseDeadlineAt:   new Date(),
        activeOrderKey:       input.orderId, // @unique → anti-doublon structurel
      },
    })
    return { created: true, claimId: claim.id }
  } catch (err) {
    if (isP2002(err)) return { created: false, reason: 'already_active' }
    throw err // toute autre panne remonte → l'appelant (transaction) échoue AVEC l'annulation
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// REFUND → CLAIM RECONCILIATION (Claims batch 1) — NEVER gated by CLAIMS_ENABLED.
//
// Baseline A7: nothing ever moved a claim from 'refunding' to 'refunded'. A claim whose
// Stripe refund succeeded stayed "in progress" for ever, and a failed one was invisible.
//
// A feature flag may block NEW claims activity. It must NOT block the reconciliation of
// financial truth that ALREADY exists: the money moved (or failed) regardless of the
// flag, so the Claim must be told. This function is therefore deliberately flag-free and
// is called from the Stripe webhook on every refund status transition.
//
// It never CREATES money movement, never retries, and never invents an amount: the
// truthful refunded amount lives on the bound `Refund` row (exposed at read time).
// ═══════════════════════════════════════════════════════════════════════════════════
export type ClaimReconcileResult =
  | { reconciled: false; reason: 'no_claim' | 'already_final' | 'not_bound' }
  | { reconciled: true; claimId: string; from: string; to: string }

export async function reconcileClaimForRefund(input: {
  /** Our `Refund` row id — the identity the claim is bound to. */
  refundRowId: string
  status: 'succeeded' | 'failed'
  /** Stripe's own id, for the audit trail only. */
  stripeRefundId?: string | null
}): Promise<ClaimReconcileResult> {
  const claim = await prisma.claim.findFirst({
    where:  { refundId: input.refundRowId },
    select: { id: true, status: true, refundError: true },
  })
  // A refund with no claim bound to it is normal (admin rail, ghost-order, external).
  if (!claim) return { reconciled: false, reason: 'no_claim' }
  if (TERMINAL_STATUSES.includes(claim.status)) return { reconciled: false, reason: 'already_final' }

  if (input.status === 'succeeded') {
    // AUDIT FIX (P1): the caller's `status` argument describes the EVENT, not our row. A
    // succeeded event can arrive for a Refund row we already marked failed, or after the
    // finalize path no-ops. Trust our own row, not the event, before declaring money paid.
    const row = await prisma.refund.findUnique({ where: { id: input.refundRowId }, select: { status: true } })
    if (!row || row.status !== 'succeeded') return { reconciled: false, reason: 'not_bound' }

    // AUDIT FIX (P1): a claim parked by the RESUME-FIRST mismatch guard is bound to a refund
    // that settled someone ELSE's amount. Marking it 'refunded' (and clearing the admin flag)
    // would destroy the very guard this batch added, and would tell the customer their claim
    // was settled for an amount nobody asked for. Leave it for the admin.
    if (typeof claim.refundError === 'string' && claim.refundError.startsWith('resume_mismatch')) {
      return { reconciled: false, reason: 'not_bound' }
    }
    // CAS on the exact bound identity: a duplicate or out-of-order webhook delivery finds
    // no row to move the second time and is a clean no-op. `refundError` is cleared only when
    // it recorded a PREVIOUS failure of this same refund that this success now supersedes.
    const done = await prisma.claim.updateMany({
      where: { id: claim.id, refundId: input.refundRowId, status: { in: ['refunding', 'approved'] } },
      data:  { status: 'refunded', refundError: null, activeOrderKey: null, decidedAt: new Date() },
    })
    if (done.count !== 1) return { reconciled: false, reason: 'already_final' }
    return { reconciled: true, claimId: claim.id, from: claim.status, to: 'refunded' }
  }

  // FAILED — THIS ROW paid nothing. That is all this function knows: it reads one Refund row,
  // never the order's other rows and never Stripe, so it cannot say anything about the CUSTOMER
  // (ROUND-6 AUDIT FIX, P1: the previous comment and string here asserted exactly that). Do not
  // blindly retry: the engine's idempotency cursor may have advanced. Surface it for an admin.
  //
  // ROUND-6 AUDIT FIX (P1, filed P2): the succeeded branch above refuses to touch a claim whose
  // binding the engine DISOWNED (resume_mismatch) — the failed branch had no such guard and
  // overwrote the marker, which is the sole input of the shipped "is this refund ours?" rule.
  // The two pending-path mismatch writers leave the claim bound to a PENDING row that is not
  // its own; when Stripe fails that row, the webhook lands here. Same guard, same answer.
  if (isResumeMismatch(claim.refundError)) return { reconciled: false, reason: 'not_bound' }
  const done = await prisma.claim.updateMany({
    where: { id: claim.id, refundId: input.refundRowId, status: { in: ['refunding', 'approved'] } },
    data:  {
      status:      'approved', // actionable again for the admin, never auto-retried
      refundError: `stripe_failed: le remboursement Stripe ${input.stripeRefundId ?? input.refundRowId} a ÉCHOUÉ — cette ligne n’a donc rien versé. Cela ne dit RIEN des autres remboursements de la commande : vérifiez la commande dans Stripe avant tout paiement. Décision admin requise, aucun nouvel essai automatique.`,
    },
  })
  if (done.count !== 1) return { reconciled: false, reason: 'already_final' }
  return { reconciled: true, claimId: claim.id, from: claim.status, to: 'approved(refund_failed)' }
}

/** Claims whose MONEY needs a human: stuck in refunding, or carrying a refund error.
 *  Enriched with the bound Refund row so the admin sees Stripe's own status and the
 *  ACTUAL refunded amount — the Claim row itself only stores what was REQUESTED. */
export async function listActionableRefundClaims() {
  const claims = await prisma.claim.findMany({
    where: {
      OR: [
        { status: 'refunding' },
        { status: 'approved', refundError: { not: null } },
        { status: 'approved', refundAttempted: true },
        // Approved by a human but never driven (REFUNDS was off at decision time) — money owed.
        { status: 'approved', refundAttempted: false },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  const rowIds = claims.map((c) => c.refundId).filter((x): x is string => !!x)
  const rows = rowIds.length
    ? await prisma.refund.findMany({
        where:  { id: { in: rowIds } },
        select: { id: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true },
      })
    : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  // SAFETY FIRST (batch 2): visibility and ordering only — no extra financial authority.
  claims.sort((a, b) => (isSafetyReason(b.reason) ? 1 : 0) - (isSafetyReason(a.reason) ? 1 : 0))
  return claims.map((c) => {
    const row = c.refundId ? byId.get(c.refundId) ?? null : null
    // Truthful classification — never "pending means success".
    let moneyState:
      | 'stripe_pending' | 'stripe_failed' | 'stripe_succeeded_claim_unreconciled'
      | 'stale_refunding_no_refund_row' | 'refund_error_recorded' | 'approved_not_driven'
      // T-49: an interrupted attempt whose refund identity was never bound. NOT a failure —
      // money may have moved. Only evidence can say. Never closed by admin assertion.
      | 'reconcile_required'
      // ROUND-6 AUDIT FIX (P2): the reconciler PROVED nothing ever left (no row moved, Stripe
      // reports nothing). That is a success, not an error — it was classified as an error.
      | 'absence_proven_payable'
    if (isReconcileRequired(c.refundError)) moneyState = 'reconcile_required'
    else if (c.status === FINANCIAL_VERIFICATION) moneyState = 'reconcile_required'
    else if (isNoRefundProven(c.refundError)) moneyState = 'absence_proven_payable'
    else if (c.refundError) moneyState = 'refund_error_recorded'
    else if (!row) moneyState = c.status === 'refunding' ? 'stale_refunding_no_refund_row' : 'approved_not_driven'
    else if (row.status === 'pending') moneyState = 'stripe_pending'
    else if (row.status === 'failed') moneyState = 'stripe_failed'
    else moneyState = 'stripe_succeeded_claim_unreconciled'
    return {
      ...c,
      moneyState,
      safety: isSafetyReason(c.reason),
      /** Whether the stuck-money escape hatch would ACCEPT this row (same predicate as the route). */
      resolvable: isStuckResolvable(c),
      refund: row ? { id: row.id, status: row.status, actualAmountCents: row.amountCents, stripeRefundId: row.stripeRefundId, createdAt: row.createdAt } : null,
      /** ROUND-6 AUDIT FIX (P1): the bound row exists, but the engine established it is NOT this
       *  claim's refund (RESUME-FIRST disowned it). Its amount is somebody else's money. */
      refundNotOurs: isResumeMismatch(c.refundError),
      /** The amount that ACTUALLY moved FOR THIS CLAIM, or null while nothing succeeded — or
       *  while what succeeded is not this claim's. `refundId` alone was used as the proxy here,
       *  which printed another claim's cash under « Montant réellement remboursé ». */
      actualRefundedCents: row && row.status === 'succeeded' && !isResumeMismatch(c.refundError) ? row.amountCents : null,
    }
  })
}

/**
 * ADMIN — terminate a claim whose refund is STUCK (RE-AUDIT FIX, P1).
 *
 * A claim left at `approved`/`refunding` with a `refundError` (engine failure, Stripe failure,
 * or a RESUME-FIRST mismatch) was resolvable by NO route: arbitration rejects it, the sweep is
 * flag-locked, and it keeps `activeOrderKey`, so the customer could never re-file on that order
 * either. This gives the neutral admin the ONE transition that was missing.
 *
 * It NEVER calls the refund engine and never moves money — a blind re-drive could double-refund
 * because the engine's idempotency cursor may already have advanced. The admin states what is
 * true and the claim closes accordingly:
 *   settled_out_of_band → the customer WAS paid another way (e.g. the admin refund rail) ⇒ refunded
 *   closed_no_payment   → no money is owed / the case is closed unpaid          ⇒ refused_final
 */
/**
 * The EXACT set of claims the stuck-money escape hatch may close. Exported so the admin list
 * marks the same rows the route will accept: a control offered on a row the server then refuses
 * is a lie told by the UI, and this batch exists to remove those. Deliberately narrow — a claim
 * whose refund is still PENDING at Stripe, or that succeeded and merely needs reconciling, must
 * NOT be closed by hand: the first may still pay out, the second already did.
 */
export function isStuckResolvable(claim: { status: string; refundError?: string | null }): boolean {
  // FOUNDER DECISION T-49: this hatch closes a case by ADMIN ASSERTION ('paid another way' /
  // 'nothing owed'). That is a judgement, not evidence, so it must never be offered on a claim
  // whose money truth is unknown. The crash marker means exactly that — unknown — so it is
  // excluded here and routed to the EVIDENCE-based reconciler instead.
  if (isReconcileRequired(claim.refundError)) return false
  // ROUND-6 AUDIT FIX (P2): a PROVEN absence is not a stuck refund — the claim is approved and
  // payable by the rail. Offering "close unpaid by assertion" on it was the classifier reading a
  // success out of the error field. (The rail-locked variant stays resolvable: it needs a human.)
  if (isNoRefundProven(claim.refundError)) return false
  return !!claim.refundError && ['approved', 'refunding'].includes(claim.status)
}

export async function resolveStuckClaim(input: {
  claimId: string
  adminId: string
  resolution: 'settled_out_of_band' | 'closed_no_payment'
  reason?: string | null
}): Promise<ClaimActionResult> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, status: true, refundError: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  if (TERMINAL_STATUSES.includes(claim.status)) {
    return { ok: false, status: 409, error: 'Cette réclamation est déjà clôturée.' }
  }
  // Deliberately narrow: this is a STUCK-MONEY escape hatch, not a general reopen/close power.
  if (!isStuckResolvable(claim)) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas bloquée sur un remboursement — utilisez l’arbitrage.' }
  }
  const status = input.resolution === 'settled_out_of_band' ? 'refunded' : 'refused_final'
  const done = await prisma.claim.updateMany({
    where: { id: claim.id, status: claim.status, refundError: { not: null } },
    data:  {
      status,
      activeOrderKey:    null, // release the order: the customer is no longer locked out
      arbitratedBy:      input.adminId,
      arbitrationReason: input.reason ?? null,
      arbitratedAt:      new Date(),
      decidedBy:         'admin',
      decidedAt:         new Date(),
    },
  })
  if (done.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a déjà été traitée.' }
  const updated = await prisma.claim.findUnique({ where: { id: claim.id } })
  return { ok: true, claim: updated }
}

/**
 * RECOVERY RECONCILER (batch 2) — the safety net for a webhook that never arrived.
 *
 * `reconcileClaimForRefund` is driven by `refund.updated` / `refund.failed`. Stripe does not
 * guarantee delivery: an endpoint outage, a signature rejection or a dropped event would leave
 * a claim stuck in `refunding` for ever even though its Refund row is long since terminal.
 *
 * This sweeps claims whose BOUND Refund row has reached a terminal state and applies exactly
 * the same reconciliation. It is:
 *   • IDEMPOTENT — it reuses the same CAS, so a second pass is a clean no-op;
 *   • BOUND TO THE REAL IDENTITY — it only ever acts on `claim.refundId`, never on a guess;
 *   • NOT gated by CLAIMS_ENABLED — the money is real whatever the feature flag says;
 *   • INCAPABLE of moving money — it calls no engine and creates no Stripe object.
 */
export type ClaimRecoverySummary = { scanned: number; reconciled: number; skipped: number; details: string[] }

// ═══════════════════════════════════════════════════════════════════════════════════
// T-49 — FINANCIAL VERIFICATION: FAIL-CLOSED FINANCIALLY, FAIL-VISIBLE OPERATIONALLY
//
// Founder decision, 2026-09-10: when authoritative evidence cannot establish whether the
// customer was paid, the system must NOT guess. It must not close the claim, must not say
// paid, must not say unpaid, must not authorize another refund, and must not release the
// order for a second money claim. It parks the claim in an explicit state and escalates.
//
// That is only acceptable because the state is LIVE: a durable admin queue that survives the
// claims feature flag being off, plus an alert on entry. Email is best effort; the queue is
// the control. A safe state nobody can see is not safety, it is a leak.
// ═══════════════════════════════════════════════════════════════════════════════════

/** Why a claim could not be attributed. Recorded verbatim for the operator. */
export type AmbiguityReason =
  | 'stripe_unreadable'          // Stripe truth could not be read at all
  | 'refund_moved_unattributed'  // money moved on the order, but not provably for THIS claim
  | 'multiple_candidate_refunds' // more than one row claims this identity
  | 'already_parked_or_moved'   // the park CAS matched nothing: already parked, or moved on
  // ROUND-6 AUDIT FIX (P1): exactly ONE row carries this claim's identity, but the reconciler's
  // CAS could not be applied (a concurrent webhook, a row whose status moved). This used to share
  // 'refund_moved_unattributed', whose console label says « aucun ne porte l'identité » — the
  // opposite of the truth on this path, and it steered the operator away from the one-click exit.
  | 'reconcile_not_applied'
  // ROUND-6 (design graft): an order with no PaymentIntent has no Stripe money to read — that is
  // a FACT about the order, not an "unreadable" Stripe. Labelled as such so nobody waits for
  // Stripe to become readable. (Unreachable for claims created by the rail, which refuses unpaid
  // orders; kept truthful for legacy rows.)
  | 'no_payment_intent'

/**
 * Park a claim in FINANCIAL VERIFICATION and escalate. Moves NO money, ever.
 *
 * The CAS only accepts a claim that is still in a pre-terminal money state, so a claim already
 * reconciled by the webhook cannot be dragged backwards by a late reconciler.
 */
export async function enterFinancialVerification(input: {
  claimId: string
  reason:  AmbiguityReason
  detail:  string
  refundId?: string | null
  stripeRefundId?: string | null
}): Promise<{ entered: boolean; relabelled?: boolean }> {
  const moved = await prisma.claim.updateMany({
    where: { id: input.claimId, status: { in: ['refunding', 'approved'] } },
    data:  {
      status:      FINANCIAL_VERIFICATION,
      refundError: `${FINANCIAL_VERIFICATION}:${input.reason}: ${input.detail}`,
      // activeOrderKey is deliberately NOT cleared: the order stays locked against a second
      // money claim while the first transaction is unattributed (founder rule).
    },
  })
  if (moved.count !== 1) {
    // ROUND-7 AUDIT FIX (P1): a claim ALREADY parked could never have its ambiguity refreshed —
    // this CAS excluded FINANCIAL_VERIFICATION while the reconciler admits it, so a second
    // reconcile that DID read Stripe and found money moved threw the fresh evidence away and the
    // console kept saying « Stripe n'a pas pu être lue ». The reason/detail are REFRESHED in
    // place; the status does not change, no alert is re-sent, and the caller is told it was a
    // relabel, not a new park.
    const relabelled = await prisma.claim.updateMany({
      where: { id: input.claimId, status: FINANCIAL_VERIFICATION },
      data:  {
        refundError: `${FINANCIAL_VERIFICATION}:${input.reason}: ${input.detail}`,
        ...(input.refundId ? { refundId: input.refundId } : {}),
      },
    })
    return relabelled.count === 1 ? { entered: false, relabelled: true } : { entered: false }
  }

  // Alert is BEST EFFORT and is never the liveness control — the queue is. A failed send
  // must never make the claim invisible, so this cannot throw into the caller.
  try {
    const claim = await prisma.claim.findUnique({
      where:  { id: input.claimId },
      select: { orderId: true, requestedAmountCents: true, createdAt: true },
    })
    await sendAdminMoneyReviewAlert({
      kind:      'claim_financial_verification',
      // One alert per claim per ambiguity reason: a replayed reconciliation cannot storm.
      dedupeKey: `claim_fv:${input.claimId}:${input.reason}`,
      title:     `Vérification financière requise — réclamation ${input.claimId}`,
      facts: {
        claimId:        input.claimId,
        orderId:        claim?.orderId ?? null,
        claimState:     FINANCIAL_VERIFICATION,
        ambiguity:      input.reason,
        detail:         input.detail,
        refundRowId:    input.refundId ?? null,
        stripeRefundId: input.stripeRefundId ?? null,
        requestedCents: claim?.requestedAmountCents ?? null,
        // Deliberately NOT asserted: whether money moved. That is the open question.
        moneyMoved:     'INDÉTERMINÉ — à établir par preuve Stripe',
        nextAction:     'Réconciliation manuelle fondée sur la preuve. AUCUN nouveau remboursement.',
      },
    })
  } catch (e) {
    console.error('[claims] financial-verification alert failed (claim stays queued) —', e instanceof Error ? e.message : e)
  }
  return { entered: true }
}

/**
 * The durable FINANCIAL VERIFICATION queue. Deliberately UNGATED by CLAIMS_ENABLED: the money
 * question exists whatever the feature flag says, and hiding it behind the flag is precisely
 * how a claim would disappear silently.
 */
export async function listFinancialVerificationClaims() {
  const claims = await prisma.claim.findMany({
    where:  { status: FINANCIAL_VERIFICATION },
    select: {
      id: true, orderId: true, reason: true, requestedAmountCents: true, refundId: true,
      refundError: true, createdAt: true, decidedAt: true, restaurantId: true,
    },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  // AUDIT FIX (T-49 audit): the escalation exit needs the operator to name WHICH existing refund
  // belongs to the claim, but no admin surface exposed an order's refund rows — so the exit was
  // reachable in principle and unusable in practice. The candidates travel with the row. They are
  // facts about refunds already made: no secret, no token, no customer data.
  // Array.from rather than spread: the compile target predates iterable spread on Set.
  const orderIds = Array.from(new Set(claims.map((c) => c.orderId)))
  const rows = orderIds.length
    ? await prisma.refund.findMany({
        where:  { orderId: { in: orderIds } },
        select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true, reason: true },
        orderBy: { createdAt: 'asc' },
      })
    : []
  // Which of those rows is ALREADY held by a DIFFERENT claim? That is exactly what the
  // attribution guard refuses on, so the console must show it rather than discover it on a 409.
  const parkedIds = new Set(claims.map((c) => c.id))
  const boundElsewhere = new Set(
    (rows.length
      ? await prisma.claim.findMany({
          where:  { refundId: { in: rows.map((r) => r.id) } },
          select: { id: true, refundId: true },
        })
      : []
    ).filter((k) => !parkedIds.has(k.id)).map((k) => k.refundId as string),
  )
  // ROUND-6 (design graft): the Stripe-anchored exit asks the operator for a refund id they read
  // in the Dashboard; the row tells them WHICH payment to open there. An id, not money.
  const orders = orderIds.length
    ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, stripePaymentIntentId: true } })
    : []
  const piByOrder = new Map(orders.map((o) => [o.id, o.stripePaymentIntentId]))
  return triageBySafety(claims).map((c) => ({
    ...c,
    /** Never states whether money moved: that is exactly what is unresolved. */
    moneyTruth: 'unresolved' as const,
    /** The PaymentIntent that paid this order, or null — the anchor the Stripe-id exit verifies against. */
    orderStripePaymentIntentId: piByOrder.get(c.orderId) ?? null,
    ambiguity:  (c.refundError ?? '').split(':')[1] ?? 'unknown',
    /** The refunds of THIS order, so an operator can attribute one without leaving the console. */
    candidateRefunds: rows.filter((r) => r.orderId === c.orderId).map((r) => ({
      id: r.id, status: r.status, amountCents: r.amountCents,
      stripeRefundId: r.stripeRefundId, createdAt: r.createdAt,
      /** Whether this row already carries ANOTHER claim's identity — shown, never hidden. Since
       *  round 7 the server REFUSES these too (T-51: reason IS identity), so the console must
       *  disable the button on them as well, not only badge them. */
      belongsToAnotherClaim: typeof r.reason === 'string' && r.reason.startsWith('claim:') && r.reason !== claimRefundReason(c.id),
      /** The row the engine stamped for THIS claim — the one the row path prefers. */
      belongsToThisClaim: r.reason === claimRefundReason(c.id),
      // AUDIT FIX (round 3): the warning above keys on the reason STAMP, but attributeClaimRefund
      // refuses on the BINDING — a row bound to another claim through the resume path carries an
      // admin or ghost reason and showed NO warning, so the console offered a button the server
      // was always going to refuse. ROUND-7: the guard now applies BOTH conditions (binding AND
      // stamp), and the console disables on both.
      alreadyBoundToAnotherClaim: boundElsewhere.has(r.id),
    })),
  }))
}

/** Claims whose refund attempt was interrupted before its identity was bound (T-49). */
/**
 * How long a refund attempt may legitimately be in flight before its marker means something is
 * wrong. AUDIT FIX (T-49 audit): the marker is written at the START of every attempt, so without
 * this a perfectly healthy refund appears in the operator queue as "interrupted" for the seconds
 * it takes Stripe to answer — crying wolf on the one queue that must stay credible.
 */
export const RECONCILE_GRACE_MS = 5 * 60 * 1000

/** The instant a marker was written, or null when it cannot be read. */
export function reconcileMarkerAge(refundError: string | null | undefined, nowMs = Date.now()): number | null {
  if (!isReconcileRequired(refundError)) return null
  // RE-AUDIT FIX: this shipped as /(d{4}-d{2}-d{2}T[d:.]+Z)/ — the backslashes were lost on the
  // way in, so it never matched an ISO timestamp, reconcileMarkerAge always returned null, and
  // the grace window was INERT: every marker, including a refund legitimately in flight one
  // second earlier, was listed as stranded. A regex literal keeps the escapes visible.
  const m = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(refundError as string)
  if (!m) return null
  const t = Date.parse(m[1])
  if (!Number.isFinite(t)) return null
  // AUDIT FIX (round 3): clock skew can put a marker in the future, giving a NEGATIVE age that the
  // grace filter read as 'still healthy' — hiding a stranded claim indefinitely. A future marker
  // is not evidence of health; treat it as unreadable, which fails VISIBLE.
  const age = nowMs - t
  return age < 0 ? null : age
}

export async function listReconcileRequiredClaims() {
  const claims = await prisma.claim.findMany({
    // AUDIT FIX (round 3): the marker only exists on attempts made AFTER it shipped. A LEGACY
    // stranded row — 'refunding' with no binding and no error — has no marker, so it fell out of
    // this list, landed in the generic bucket that calls its state «known», and lost the reconcile
    // button that is its only handle. Its money truth is precisely what is NOT known.
    where: {
      OR: [
        { status: { in: ['refunding', 'approved'] }, refundError: { startsWith: RECONCILE_REQUIRED } },
        { status: 'refunding', refundId: null, refundError: null },
      ],
    },
    select: {
      id: true, orderId: true, reason: true, requestedAmountCents: true, refundId: true,
      refundError: true, createdAt: true, restaurantId: true,
    },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  // An attempt still inside its grace window is HEALTHY, not stranded: leave it alone. An
  // unreadable timestamp is treated as stranded — fail visible, never fail silent.
  const stranded = claims.filter((c) => {
    const age = reconcileMarkerAge(c.refundError)
    return age === null || age >= RECONCILE_GRACE_MS
  })
  return triageBySafety(stranded)
}

/**
 * T-49 — EVIDENCE-BASED CLAIM RECONCILER. The real, reachable recovery exit.
 *
 * FOUNDER POLICY: evidence only, fail closed on ambiguity. This function therefore has exactly
 * one authority — READ Stripe and our own Refund rows, IDENTIFY which refund (if any) belongs to
 * this claim, and APPLY the truth that already exists. It has NO authority to create money:
 * it never calls the refund engine, never touches Stripe with a write, never retries.
 *
 * Outcomes, in the founder's own terms:
 *   proven succeeded  → bind the exact identity and apply the row's terminal state to the CLAIM
 *                       (reconcileClaimForRefund writes the Claim row and nothing else), recording
 *                       the ACTUAL amount (the row's, never the requested one). ROUND-6 AUDIT FIX
 *                       (P3): this line used to say "reconcile claim/ledger/loyalty" — ledger and
 *                       loyalty consequences belong to the Stripe webhook rail and are NOT
 *                       performed by this exit;
 *   proven failed     → record the failure, land in the canonical recoverable state;
 *   still pending     → stay pending. No terminal success, no terminal failure, no 2nd refund;
 *   proven untouched  → nothing was ever created and no cash moved ⇒ safe to release for a
 *                       fresh attempt. This is the ONLY branch that re-opens the attempt, and it
 *                       requires POSITIVE proof of absence, not merely a missing binding;
 *   ambiguous         → FINANCIAL VERIFICATION. No money, no closure, no re-file, no guess.
 */
export type ClaimEvidenceOutcome =
  | { ok: true; outcome: 'refunded'; refundId: string; amountCents: number }
  | { ok: true; outcome: 'refund_failed'; refundId: string }
  | { ok: true; outcome: 'still_pending'; refundId: string }
  | { ok: true; outcome: 'no_refund_proven' }
  // AUDIT FIX (round 3): the honest rail-locked reason was written into refundError, where no
  // human reads it, while the caller received the SAME outcome — so the console still told the
  // operator the claim was payable again. The two cases are now distinguishable at the boundary.
  | { ok: true; outcome: 'no_refund_proven_rail_locked' }
  | { ok: true; outcome: 'financial_verification'; reason: AmbiguityReason; detail: string }
  | { ok: false; status: 404 | 409 | 500; error: string }

const RECONCILABLE_STATUSES = ['refunding', 'approved', FINANCIAL_VERIFICATION]

/**
 * T-49 — THE ESCALATION EXIT (audit fix, P1).
 *
 * The audit proved FINANCIAL VERIFICATION was an ABSORBING state: once a claim was parked with
 * `refund_moved_unattributed`, no route could ever move it. The automatic branches could not
 * fire again by construction (triggerClaimRefund CASes on approved + refundAttempted:false, so a
 * row stamped for this claim can never be created afterwards, and nothing deletes Refund rows),
 * so the claim, the order lock and the money-review row were permanent. The founder's own
 * condition was explicit: FINANCIAL VERIFICATION is acceptable ONLY if a real recovery path
 * exists. It did not. This is that path.
 *
 * It is NOT a guess about whether money moved — that is precisely what the policy forbids. The
 * operator supplies the missing LINK (which existing refund belongs to this claim); the system
 * then reads that row's OWN status and amount and applies it. The operator cannot state an
 * outcome, cannot state an amount, and cannot create money:
 *   • the refund row must already exist AND belong to the SAME order — a row from another order
 *     is refused outright, so a claim can never be settled by an unrelated payment;
 *   • the outcome comes from the row, never from the human;
 *   • no engine call, no Stripe write, no retry.
 */
export type ClaimAttributionOutcome =
  | { ok: true; outcome: 'refunded' | 'refund_failed' | 'still_pending'; refundId: string }
  | { ok: false; status: 400 | 404 | 409; error: string }

export async function attributeClaimRefund(input: {
  claimId: string
  /** The EXISTING Refund row the operator attributes to this claim. */
  refundRowId: string
  adminId: string
  note?: string | null
}): Promise<ClaimAttributionOutcome> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, orderId: true, status: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  if (claim.status !== FINANCIAL_VERIFICATION) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas en vérification financière — utilisez la réconciliation par preuve.' }
  }
  const row = await prisma.refund.findUnique({
    where:  { id: input.refundRowId },
    select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, reason: true },
  })
  if (!row) return { ok: false, status: 404, error: 'Remboursement introuvable.' }
  // THE anchor: a claim may only ever be attributed a refund of its OWN order.
  if (row.orderId !== claim.orderId) {
    return { ok: false, status: 400, error: 'Ce remboursement appartient à une autre commande — attribution refusée.' }
  }
  // ROUND-6 HARDENING (finding refuted as P1 — the two-parked-claims scenario cannot exist because
  // activeOrderKey is @unique — kept as defence in depth). T-51: `reason` IS identity. A row the
  // engine stamped for ANOTHER claim answers for that claim; binding it here would let two claims
  // report the same money. The console already badges these rows; the server now agrees with it.
  if (typeof row.reason === 'string' && row.reason.startsWith('claim:') && row.reason !== claimRefundReason(claim.id)) {
    return { ok: false, status: 409, error: `Ce remboursement porte l’identité de la réclamation ${row.reason.slice('claim:'.length)} — attribution refusée.` }
  }
  // ROUND-7 AUDIT FIX (P2): the Stripe-id exit refuses to act while a row stamped for THIS claim
  // exists on the order; the row path did not. Binding an UNSTAMPED row (admin rail, ghost) while
  // the engine's own row for this claim sits beside it would close the claim on somebody else's
  // refund and leave the claim's real refund claim-less — its later webhook would land as
  // `no_claim` and never be applied to anything. One identity, one row: use the stamped one.
  if (row.reason !== claimRefundReason(claim.id)) {
    const stamped = await prisma.refund.findFirst({
      where:  { orderId: claim.orderId, reason: claimRefundReason(claim.id), id: { not: row.id } },
      select: { id: true },
    })
    if (stamped) {
      return { ok: false, status: 409, error: `Une ligne de remboursement porte déjà l’identité de cette réclamation (${stamped.id}) — attribuez celle-là, ou utilisez « Réconcilier d’après la preuve ».` }
    }
  }
  // RE-AUDIT FIX: without this, ONE refund could be attributed to TWO claims of the same order,
  // and both would report themselves settled by the same money. The row must be free.
  const alreadyBound = await prisma.claim.findFirst({
    where:  { refundId: row.id, id: { not: claim.id } },
    select: { id: true },
  })
  if (alreadyBound) {
    return { ok: false, status: 409, error: `Ce remboursement est déjà lié à la réclamation ${alreadyBound.id} — une même somme ne peut pas solder deux réclamations.` }
  }
  if (row.status !== 'succeeded' && row.status !== 'failed' && row.status !== 'pending') {
    return { ok: false, status: 409, error: 'Statut de remboursement inexploitable.' }
  }

  // Bind, then let the row's own truth decide. The operator chose the LINK, not the OUTCOME.
  const bound = await prisma.claim.updateMany({
    where: { id: claim.id, status: FINANCIAL_VERIFICATION },
    data:  { refundId: row.id, status: 'refunding', refundError: null },
  })
  if (bound.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a changé d’état entre-temps.' }

  try {
    await recordAdminAudit({
      actorId:    input.adminId,
      actorEmail: null,
      action:     'claim.attribute_refund',
      targetType: 'claim',
      targetId:   claim.id,
      metadata:   {
        refundRowId: row.id, stripeRefundId: row.stripeRefundId, refundStatus: row.status,
        orderId: claim.orderId, note: input.note ?? null,
        moneyMoved: false, // this function never moves money; it records an existing link
      },
    })
  } catch { /* audit is best-effort; it must never undo a completed attribution */ }

  // AUDIT FIX: this branch reports 'still pending' from OUR row's status alone. That is what we
  // know, and the wording downstream says exactly that — it does not claim Stripe was consulted.
  // The row not being terminal is sufficient to refuse a terminal verdict here, which is the
  // only decision this branch makes.
  if (row.status === 'pending') return { ok: true, outcome: 'still_pending', refundId: row.id }
  const applied = await reconcileClaimForRefund({ refundRowId: row.id, status: row.status, stripeRefundId: row.stripeRefundId })
  if (!applied.reconciled) return { ok: false, status: 409, error: 'La réconciliation n’a pas pu être appliquée — réessayez.' }
  return { ok: true, outcome: row.status === 'succeeded' ? 'refunded' : 'refund_failed', refundId: row.id }
}

/**
 * T-49 — THE STRIPE-ANCHORED EXIT (round-6 audit: filed P0, confirmed P1).
 *
 * attributeClaimRefund can only bind a Refund row that already EXISTS locally. A refund issued
 * from the Stripe Dashboard leaves no such row (see stripeCashTruthForOrder), so a claim parked
 * because "money moved on this order but no row is ours" had no exit that did not involve paying
 * the customer a second time. The founder's condition — a REAL recovery path — was not met for
 * that population. Three independent designs were judged for this; this is the one that won on
 * money safety, with the anchors every judge asked for.
 *
 * The operator supplies a Stripe refund id (re_…) and NOTHING else — no amount, no outcome. Before
 * writing anything, the server PROVES at Stripe that the refund sits on THIS order's payment:
 *   • refund.payment_intent === Order.stripePaymentIntentId  (our own record of which PI paid);
 *   • refund.charge === that PI's latest_charge.id            (a PI whose first attempt failed
 *                                                              carries an earlier, unrefundable charge);
 *   • the PI's metadata.orderId, when present, does not contradict the claim's order.
 * It adopts ONLY a refund whose Stripe status is `succeeded`. Pending is refused (nothing terminal
 * to apply — retry once it is). Failed/canceled is refused (it settles nothing, and a local
 * `failed` row would engage the engine's fail-closed lock on this order). A refund the ENGINE
 * created (Stripe metadata.grubano_refund_row) is refused: it has, or should have, a local row
 * and belongs to the row path.
 *
 * What it writes: ONE Refund row that MIRRORS Stripe — amount, status, ids copied from the Stripe
 * object; every split field 0 (the royalty aggregates sum those fields, so a zero row is inert
 * for them; the ledger check reads ledger lines against Stripe, never Refund rows; RESUME-FIRST
 * re-drives only `pending` rows; the fail-closed lock keys on `failed` rows); idempotencyKey
 * `external:<re_…>` (UNIQUE ⇒ a double submit is a 409, never two rows); reason =
 * claimRefundReason(claim.id) so a later reconcile finds it as `mine`. Then it hands the row to
 * attributeClaimRefund, whose audited tail decides the claim's fate from the row's own status.
 * No engine call, no Stripe write, no ledger/loyalty/Order write.
 *
 * `dryRun: true` stops before the write and returns what Stripe says, so the console shows the
 * operator the facts that WOULD be bound before the single write happens.
 */
export type StripeRefundFacts = {
  stripeRefundId: string
  stripeStatus: string
  amountCents: number
  paymentIntentId: string | null
  chargeId: string | null
  createdAt: string | null
  /** ROUND-7 AUDIT FIX (P2): WHERE these values were read. 'stripe' = the Stripe object, just
   *  now. 'local_row' = our own mirror row from an earlier adoption — Stripe was NOT re-read. */
  source: 'stripe' | 'local_row'
}
export type ClaimStripeAdoptionOutcome =
  /** `wouldWrite` false = the row already exists; « Lier » will only bind it. */
  | { ok: true; outcome: 'preview'; facts: StripeRefundFacts; wouldWrite: boolean }
  | { ok: true; outcome: 'refunded'; refundId: string; facts: StripeRefundFacts }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string; facts?: StripeRefundFacts }

export const STRIPE_REFUND_ID_RE = /^re_[A-Za-z0-9]{8,}$/
/** Provenance marker of rows this exit creates — never the engine's `refund:<order>:<cumul>`. */
export const EXTERNAL_REFUND_KEY_PREFIX = 'external:'

export async function adoptStripeRefundForClaim(input: {
  claimId: string
  stripeRefundId: string
  adminId: string
  note?: string | null
  dryRun?: boolean
}): Promise<ClaimStripeAdoptionOutcome> {
  const stripeRefundId = input.stripeRefundId.trim()
  if (!STRIPE_REFUND_ID_RE.test(stripeRefundId)) {
    return { ok: false, status: 400, error: 'Identifiant Stripe invalide — attendu un identifiant de remboursement « re_… ».' }
  }
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, orderId: true, status: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  if (claim.status !== FINANCIAL_VERIFICATION) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas en vérification financière — utilisez la réconciliation par preuve.' }
  }
  const order = await prisma.order.findUnique({
    where:  { id: claim.orderId },
    select: { id: true, restaurantId: true, stripePaymentIntentId: true },
  })
  if (!order) return { ok: false, status: 404, error: 'Commande introuvable.' }
  if (!order.stripePaymentIntentId) {
    return { ok: false, status: 409, error: 'Cette commande n’a aucun paiement Stripe enregistré : aucun remboursement Stripe ne peut lui être rattaché.' }
  }

  // DB guards BEFORE any Stripe read — what our own rows already settle costs no network call.
  const existing = await prisma.refund.findFirst({
    where:  { stripeRefundId },
    select: { id: true, orderId: true, status: true, reason: true, idempotencyKey: true, amountCents: true, stripePaymentIntentId: true, settledAt: true },
  })
  if (existing) {
    if (existing.orderId !== claim.orderId) {
      return { ok: false, status: 400, error: 'Ce remboursement Stripe est déjà enregistré sur une AUTRE commande — liaison refusée.' }
    }
    // ROUND-7 AUDIT FIX (P1): this 409 pointed EVERY existing row at « Attribuer » — including a
    // row stamped for ANOTHER claim, which the row path will refuse. Say which case it is.
    const stampedFor = typeof existing.reason === 'string' && existing.reason.startsWith('claim:') ? existing.reason.slice('claim:'.length) : null
    if (stampedFor && stampedFor !== claim.id) {
      return { ok: false, status: 409, error: `Ce remboursement Stripe est déjà enregistré ici (ligne ${existing.id}) et porte l’identité de la réclamation ${stampedFor} — il ne peut pas solder cette réclamation.` }
    }
    // The crash-resume case: this exit already mirrored the row, then died before binding it.
    // Nothing to re-read at Stripe — the row IS the evidence; bind it through the audited tail.
    const ours = existing.idempotencyKey.startsWith(EXTERNAL_REFUND_KEY_PREFIX)
      && existing.reason === claimRefundReason(claim.id) && existing.status === 'succeeded'
    if (!ours) {
      return { ok: false, status: 409, error: `Ce remboursement Stripe est déjà enregistré ici (ligne ${existing.id}, statut ${existing.status}) — utilisez « Attribuer » sur cette ligne, ou « Réconcilier d’après la preuve ».` }
    }
    // ROUND-7 AUDIT FIX (P2): the facts of THIS branch come from our own row, and say so. They
    // used to be fabricated (amount 0, a row status relabelled as Stripe's), and the dryRun
    // answer was a 409 that told the operator to press a button the console keeps disabled
    // without a preview. dryRun now returns a real preview, marked local, so « Lier » enables.
    const rowFacts: StripeRefundFacts = {
      stripeRefundId, stripeStatus: existing.status, amountCents: existing.amountCents,
      paymentIntentId: existing.stripePaymentIntentId, chargeId: null,
      createdAt: existing.settledAt ? existing.settledAt.toISOString() : null, source: 'local_row',
    }
    if (input.dryRun) return { ok: true, outcome: 'preview', facts: rowFacts, wouldWrite: false }
    const resumed = await attributeClaimRefund({ claimId: claim.id, refundRowId: existing.id, adminId: input.adminId, note: input.note })
    if (!resumed.ok) return { ...resumed, facts: rowFacts }
    if (resumed.outcome !== 'refunded') return { ok: false, status: 409, error: 'La ligne enregistrée n’est plus aboutie — réconciliez d’après la preuve.', facts: rowFacts }
    return { ok: true, outcome: 'refunded', refundId: existing.id, facts: rowFacts }
  }
  // One identity, one row. ROUND-7 AUDIT NOTE (P3): this guard is check-then-act — the UNIQUE key
  // is per Stripe refund, not per claim, so two operators adopting two DIFFERENT Dashboard refunds
  // for the same claim at the same instant both pass it; the first binding wins the FV CAS, the
  // second gets 409 from the tail, and its row stays as an orphan stamped for a terminal claim.
  // Money stays correct (both refunds are real; every consumer sums or mins). Making it structural
  // would need a schema change (a uniqueness on (orderId, reason)), which is out of scope here.
  const stamped = await prisma.refund.findFirst({
    where:  { orderId: claim.orderId, reason: claimRefundReason(claim.id) },
    select: { id: true },
  })
  if (stamped) {
    return { ok: false, status: 409, error: `Une ligne de remboursement porte déjà l’identité de cette réclamation (${stamped.id}) — utilisez « Réconcilier d’après la preuve ».` }
  }

  // Stripe read #1 — the refund itself. A missing id and an outage are different facts.
  let refund: Stripe.Refund
  try {
    refund = await getStripe().refunds.retrieve(stripeRefundId)
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'resource_missing') {
      return { ok: false, status: 404, error: 'Aucun remboursement Stripe avec cet identifiant.' }
    }
    return { ok: false, status: 502, error: 'Stripe n’a pas pu être consulté — rien n’a été écrit. Réessayez.' }
  }
  const refundPi = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null
  const refundCharge = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id ?? null
  const facts: StripeRefundFacts = {
    stripeRefundId:  refund.id,
    stripeStatus:    refund.status ?? 'unknown',
    amountCents:     refund.amount,
    paymentIntentId: refundPi,
    chargeId:        refundCharge,
    createdAt:       refund.created ? new Date(refund.created * 1000).toISOString() : null,
    source:          'stripe',
  }
  // Engine provenance: our own refunds carry the row id in Stripe metadata (lib/refund.ts). They
  // are never "external": the row path owns them, whether or not the local row survived.
  const engineRow = refund.metadata?.grubano_refund_row
  if (engineRow) {
    return { ok: false, status: 409, error: `Ce remboursement Stripe a été créé par le moteur Grubano (ligne ${engineRow}) — il relève du chemin « Attribuer » / « Réconcilier d’après la preuve », pas d’une liaison externe.`, facts }
  }
  // ANCHOR 1 — the payment. Compared to OUR record of which PI paid this order, never to metadata.
  if (refundPi !== order.stripePaymentIntentId) {
    return { ok: false, status: 400, error: 'Ce remboursement Stripe porte sur un autre paiement que celui de cette commande — liaison refusée.', facts }
  }
  // Stripe read #2 — the payment, to anchor the CHARGE as well (same call shape as the truth reader).
  let charge: Stripe.Charge | null
  try {
    const pi = await getStripe().paymentIntents.retrieve(refundPi, { expand: ['latest_charge'] })
    charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    const taggedOrder = pi.metadata?.orderId
    if (taggedOrder && taggedOrder !== claim.orderId) {
      return { ok: false, status: 400, error: 'Le paiement de ce remboursement est étiqueté pour une autre commande — liaison refusée.', facts }
    }
  } catch {
    return { ok: false, status: 502, error: 'Stripe n’a pas pu être consulté — rien n’a été écrit. Réessayez.', facts }
  }
  if (!charge) return { ok: false, status: 502, error: 'Charge introuvable sur le paiement — rien n’a été écrit.', facts }
  // ANCHOR 2 — the charge.
  if (refundCharge !== charge.id) {
    return { ok: false, status: 400, error: 'Ce remboursement Stripe porte sur une autre charge que celle du paiement de cette commande — liaison refusée.', facts }
  }
  // Only a SETTLED refund is evidence of settlement. Nothing else is mirrored, ever.
  if (refund.status !== 'succeeded') {
    return refund.status === 'pending' || refund.status === 'requires_action'
      ? { ok: false, status: 409, error: 'Ce remboursement est encore EN ATTENTE chez Stripe — rien n’est écrit. Réessayez lorsqu’il sera terminal.', facts }
      : { ok: false, status: 409, error: `Ce remboursement est « ${refund.status} » chez Stripe : il ne peut solder aucune réclamation. Rien n’est écrit.`, facts }
  }
  const captured = charge.amount_captured ?? charge.amount ?? 0
  if (!(Number.isInteger(refund.amount) && refund.amount > 0 && refund.amount <= captured)) {
    return { ok: false, status: 400, error: 'Montant Stripe incohérent avec le paiement de cette commande — liaison refusée.', facts }
  }

  if (input.dryRun) return { ok: true, outcome: 'preview', facts, wouldWrite: true }

  // THE single write: a local mirror of a refund Stripe says succeeded on this order's charge.
  let row: { id: string }
  try {
    row = await prisma.refund.create({
      data: {
        orderId:                   order.id,
        restaurantId:              order.restaurantId,
        stripePaymentIntentId:     refundPi,
        stripeRefundId:            refund.id,
        idempotencyKey:            `${EXTERNAL_REFUND_KEY_PREFIX}${refund.id}`,
        amountCents:               refund.amount,
        restaurantReverseCents:    0,
        applicationFeeRefundCents: 0,
        royaltyRefundCents:        0,
        royaltyClawbackCents:      0,
        franchiseRoyaltyStatus:    null,
        reason:                    claimRefundReason(claim.id),
        status:                    'succeeded',
        settledAt:                 facts.createdAt ? new Date(facts.createdAt) : new Date(),
      },
      select: { id: true },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, status: 409, error: 'Ce remboursement Stripe vient d’être enregistré par ailleurs — rechargez la file.', facts }
    }
    throw err
  }
  try {
    await recordAdminAudit({
      actorId:    input.adminId,
      actorEmail: null,
      action:     'claim.adopt_stripe_refund',
      targetType: 'claim',
      targetId:   claim.id,
      metadata:   {
        refundRowId: row.id, stripeRefundId: refund.id, orderId: claim.orderId,
        anchoredPaymentIntent: refundPi, anchoredCharge: charge.id, amountCents: refund.amount,
        note: input.note ?? null,
        moneyMoved: false, // a MIRROR of a refund Stripe already executed; nothing was created there
      },
    })
  } catch { /* audit is best-effort; it must never undo a completed adoption */ }

  const applied = await attributeClaimRefund({ claimId: claim.id, refundRowId: row.id, adminId: input.adminId, note: input.note })
  if (!applied.ok) return { ...applied, facts }
  if (applied.outcome !== 'refunded') {
    return { ok: false, status: 409, error: 'La ligne a été enregistrée mais la réconciliation n’a pas pu être appliquée — réconciliez d’après la preuve.', facts }
  }
  return { ok: true, outcome: 'refunded', refundId: row.id, facts }
}

export async function reconcileClaimEvidence(input: { claimId: string }): Promise<ClaimEvidenceOutcome> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, orderId: true, status: true, refundId: true, requestedAmountCents: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  if (!RECONCILABLE_STATUSES.includes(claim.status)) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas en attente de réconciliation.' }
  }

  // Every Refund row of the ORDER — including rows this claim is not bound to. `reason` is the
  // identity stamp lib/refund.ts writes at creation; it is read here and nowhere else (T-52).
  const rows = await prisma.refund.findMany({
    where:  { orderId: claim.orderId },
    select: { id: true, status: true, amountCents: true, stripeRefundId: true, reason: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const mine = rows.filter((r) => r.reason === claimRefundReason(claim.id))

  // ── AMBIGUOUS: more than one row stamped with this claim's identity ────────────
  if (mine.length > 1) {
    const detail = `${mine.length} lignes Refund portent l'identité de cette réclamation (${mine.map((r) => r.id).join(', ')}). Attribution impossible sans décision humaine.`
    const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'multiple_candidate_refunds', detail })
    // AUDIT FIX: the park CAS can legitimately match nothing (already parked, or moved on by a
    // concurrent webhook). Reporting 'parked and escalated' when neither happened would be a
    // false statement about a money case, so the caller is told what actually occurred.
    if (!parked.entered && !parked.relabelled) {
      return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as AmbiguityReason, detail }
    }
    return { ok: true, outcome: 'financial_verification', reason: 'multiple_candidate_refunds', detail }
  }

  // ── PROVEN: exactly one row is ours. Apply ITS truth, whatever it is. ──────────
  if (mine.length === 1) {
    const row = mine[0]
    // Bind the identity the crash prevented from being written. This is a BINDING, not a
    // payment: it records which refund was already driven for this claim.
    await prisma.claim.updateMany({
      where: { id: claim.id, status: { in: RECONCILABLE_STATUSES } },
      data:  { refundId: row.id, ...(claim.status === FINANCIAL_VERIFICATION ? { status: 'refunding' } : {}) },
    })
    if (row.status === 'succeeded' || row.status === 'failed') {
      // Reuse the already-audited reconciler: same CAS, same guards, no new money code.
      // AUDIT FIX: the verdict was discarded, so an outcome of 'refunded' could be reported when
      // the CAS matched nothing (a concurrent webhook, a resume_mismatch guard, a row whose status
      // had moved). Reporting a settlement that did not happen is exactly the class of lie this
      // batch exists to remove: if the reconciler did not apply, say the truth is still open.
      const applied = await reconcileClaimForRefund({ refundRowId: row.id, status: row.status, stripeRefundId: row.stripeRefundId })
      if (!applied.reconciled) {
        const detail = `La ligne Refund ${row.id} porte bien l'identité de cette réclamation et est ${row.status}, mais la réconciliation n'a pas pu être appliquée (${applied.reason}). L'état de la réclamation n'est pas établi.`
        // ROUND-6 AUDIT FIX (P1): this path used to park under 'refund_moved_unattributed', whose
        // console label says « aucun ne porte l'identité de cette réclamation » — on the one path
        // where exactly one row DOES. It has its own reason now, and its own truthful label.
        const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'reconcile_not_applied', detail, refundId: row.id, stripeRefundId: row.stripeRefundId })
        // AUDIT FIX: the park CAS can legitimately match nothing (already parked, or moved on by a
        // concurrent webhook). Reporting 'parked and escalated' when neither happened would be a
        // false statement about a money case, so the caller is told what actually occurred.
        if (!parked.entered && !parked.relabelled) {
          return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as AmbiguityReason, detail }
        }
        return { ok: true, outcome: 'financial_verification', reason: 'reconcile_not_applied', detail }
      }
      return row.status === 'succeeded'
        ? { ok: true, outcome: 'refunded', refundId: row.id, amountCents: row.amountCents }
        : { ok: true, outcome: 'refund_failed', refundId: row.id }
    }
    // PENDING: money has not reached the customer and may still. Clear only the crash marker —
    // the identity is now known — and leave the claim pending. No terminal state either way.
    await prisma.claim.updateMany({
      where: { id: claim.id, refundId: row.id, status: { in: ['refunding', 'approved'] } },
      data:  { status: 'refunding', refundError: null },
    })
    return { ok: true, outcome: 'still_pending', refundId: row.id }
  }

  // ── NO ROW IS OURS. Absence of a binding is NOT absence of money: ask Stripe. ──
  const order = await prisma.order.findUnique({
    where:  { id: claim.orderId },
    select: { stripePaymentIntentId: true },
  })
  // ROUND-6 (design graft): no PaymentIntent means there is no Stripe money to read — a fact
  // about the ORDER, not a transient "unreadable". Parked under its own reason so the console
  // does not tell the operator to wait for Stripe to become readable; it never will.
  if (!order?.stripePaymentIntentId) {
    const detail = 'Cette commande n’a aucun paiement Stripe enregistré : aucune preuve Stripe ne peut exister pour elle. Aucune conclusion n’est tirée.'
    const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'no_payment_intent', detail })
    if (!parked.entered && !parked.relabelled) {
      return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as AmbiguityReason, detail }
    }
    return { ok: true, outcome: 'financial_verification', reason: 'no_payment_intent', detail }
  }
  const truth = await stripeCashTruthForOrder(order.stripePaymentIntentId)
  if (!truth) {
    const detail = 'La vérité Stripe n’a pas pu être lue pour cette commande. Aucune conclusion n’est tirée : ni remboursé, ni non remboursé. Réévalué à chaque « Réconcilier d’après la preuve ».'
    const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'stripe_unreadable', detail })
    // AUDIT FIX: the park CAS can legitimately match nothing (already parked, or moved on by a
    // concurrent webhook). Reporting 'parked and escalated' when neither happened would be a
    // false statement about a money case, so the caller is told what actually occurred.
    if (!parked.entered && !parked.relabelled) {
      return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as AmbiguityReason, detail }
    }
    return { ok: true, outcome: 'financial_verification', reason: 'stripe_unreadable', detail }
  }

  const nothingAtStripe = (truth.refundedCents || 0) === 0 && (truth.pendingCents || 0) === 0
  // AUDIT FIX (T-49 audit, P1 liveness). This required rows.length === 0, so ONE stale row on the
  // order — a refund that FAILED or was CANCELED months ago, and therefore moved nothing — parked
  // the claim for ever even while Stripe positively proved that no cash left. Absence of cash is
  // what matters, and Stripe is the authority on it: a row that never moved money cannot make
  // the proof ambiguous. A row that DID move money (succeeded) or still might (pending) does.
  const noRowEverMoved = !rows.some((r) => r.status === 'succeeded' || r.status === 'pending')
  // RE-AUDIT FIX: `executeRefund` refuses EVERY later refund on an order that carries a FAILED
  // row with a Stripe id (the fail-closed lock, lib/refund.ts) — so telling the operator the
  // claim is 'payable again' would be a promise the engine will refuse. Say which it is.
  const railLocked = rows.some((r) => r.status === 'failed' && !!r.stripeRefundId)
  if (nothingAtStripe && noRowEverMoved) {
    // POSITIVE PROOF OF ABSENCE: no Refund row exists on this order at all, and Stripe reports
    // zero refunded and zero pending. Nothing was created and no cash moved, so re-opening the
    // attempt cannot double-pay anyone. This is the ONLY branch that resets refundAttempted,
    // and it is gated on proof, never on a missing binding.
    await prisma.claim.updateMany({
      where: { id: claim.id, status: { in: RECONCILABLE_STATUSES } },
      data:  {
        status:          'approved',
        refundAttempted: false,
        refundId:        null,
        refundError:     railLocked
          ? 'no_refund_proven_rail_locked: Stripe ne rapporte AUCUN remboursement (ni abouti, ni en attente) — rien n’est parti. MAIS un remboursement ÉCHOUÉ verrouille cette commande côté moteur : toute nouvelle tentative sera refusée tant que la reprise manuelle Stripe n’a pas été faite. Reprise humaine requise.'
          // ROUND-6 AUDIT FIX (P2): "payable par le rail normal" promised a payment the closed
          // rail will refuse. Say what is established: the state it returns to, and the one
          // thing that will pay it.
          : `${NO_REFUND_PROVEN}: aucun remboursement n’a jamais déplacé d’argent sur cette commande et Stripe n’en rapporte aucun (ni abouti, ni en attente). La tentative interrompue n’a rien créé — la réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts.`,
      },
    })
    return { ok: true, outcome: railLocked ? 'no_refund_proven_rail_locked' : 'no_refund_proven' }
  }

  // Money moved on this order, but nothing proves it moved FOR THIS CLAIM. Fail closed.
  const detail = `Des remboursements existent sur cette commande (Stripe : ${truth.refundedCents} c remboursés, ${truth.pendingCents} c en attente ; ${rows.length} ligne(s) Refund) mais aucune ne porte l'identité de cette réclamation. L'attribution ne peut pas être prouvée.`
  const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'refund_moved_unattributed', detail })
  // AUDIT FIX: the park CAS can legitimately match nothing (already parked, or moved on by a
  // concurrent webhook). Reporting 'parked and escalated' when neither happened would be a
  // false statement about a money case, so the caller is told what actually occurred.
  // ROUND-7: an already-parked claim is RELABELLED with the fresh evidence instead — that is a
  // real outcome, reported under the new reason.
  if (!parked.entered && !parked.relabelled) {
    return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as AmbiguityReason, detail }
  }
  return { ok: true, outcome: 'financial_verification', reason: 'refund_moved_unattributed', detail }
}

export async function recoverStrandedClaimReconciliations(limit = 200): Promise<ClaimRecoverySummary> {
  const out: ClaimRecoverySummary = { scanned: 0, reconciled: 0, skipped: 0, details: [] }
  const stranded = await prisma.claim.findMany({
    // RE-AUDIT FIX (batch 2). Without the refundError exclusion this sweep never RETIRED a row:
    // reconcileClaimForRefund moves a failed refund to status 'approved' WITH a refundError, which
    // is still inside this predicate, so the same claims were re-reconciled every single day —
    // rewriting byte-identical values, reporting a fresh `reconciled: 1` for ever, and permanently
    // occupying the take:200 window ahead of genuinely stranded claims. A row already carrying a
    // refundError has been reconciled; it now needs an ADMIN, not another sweep.
    where:  { status: { in: ['refunding', 'approved'] }, refundId: { not: null }, refundError: null },
    select: { id: true, refundId: true, status: true },
    take:   limit,
  })
  out.scanned = stranded.length
  if (!stranded.length) return out
  const rows = await prisma.refund.findMany({
    where:  { id: { in: stranded.map((c) => c.refundId as string) } },
    select: { id: true, status: true, stripeRefundId: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const c of stranded) {
    const row = c.refundId ? byId.get(c.refundId) : null
    // Still pending, or no row at all: nothing terminal to apply. Never invent an outcome.
    if (!row || (row.status !== 'succeeded' && row.status !== 'failed')) { out.skipped++; continue }
    const res = await reconcileClaimForRefund({
      refundRowId:    row.id,
      status:         row.status === 'succeeded' ? 'succeeded' : 'failed',
      stripeRefundId: row.stripeRefundId,
    })
    if (res.reconciled) { out.reconciled++; out.details.push(`${c.id}: ${res.from} → ${res.to}`) } else out.skipped++
  }
  return out
}

/** Claims the restaurant never answered and whose deadline has passed — admin-actionable. */
export async function listSilenceExpiredClaims() {
  const rows = await prisma.claim.findMany({
    where:  { status: 'restaurant_review', responseDeadlineAt: { lte: new Date() } },
    select: {
      id: true, orderId: true, restaurantId: true, reason: true, requestedAmountCents: true,
      description: true, createdAt: true, responseDeadlineAt: true,
    },
    orderBy: { responseDeadlineAt: 'asc' },
    take:    200,
  })
  return triageBySafety(rows)
}

/** Who currently holds the decision, and whether an admin may already act. */
export function claimAuthority(claim: { status: string; responseDeadlineAt?: Date | null; refundAttempted: boolean; arbitrationDecision?: string | null }, now: Date = new Date()) {
  const deadline = claim.responseDeadlineAt instanceof Date ? claim.responseDeadlineAt : null
  // No readable deadline ⇒ never claim it expired (fail-closed: the restaurant keeps the hand).
  const deadlinePassed = !!deadline && deadline.getTime() <= now.getTime()
  if (claim.status === 'restaurant_review') {
    return {
      holder: deadlinePassed ? ('admin' as const) : ('restaurant' as const),
      restaurantResponded: false,
      responseDeadlineAt: deadline,
      deadlineExpired: deadlinePassed,
      adminActionable: deadlinePassed,
    }
  }
  // RE-AUDIT FIX: an UNPAID approval is admin-actionable whether or not an admin already
  // ruled on it — otherwise the console hides the very action that pays the customer.
  const adminActionable =
    claim.status === 'arbitration' ||
    (claim.status === 'approved' && !claim.refundAttempted)
  return {
    holder: adminActionable ? ('admin' as const) : ('system' as const),
    restaurantResponded: claim.status !== 'restaurant_review',
    responseDeadlineAt: deadline,
    deadlineExpired: deadlinePassed,
    adminActionable,
  }
}

export async function listPendingRestaurantClaims() {
  const rows = await prisma.claim.findMany({
    where:   { status: 'restaurant_review' },
    // Revue P0-39 : SELECT curaté — la console n'affiche que ces champs, on
    // n'expose pas toute la ligne Claim (surface minimale, même esprit que la
    // forme curatée de la file d'arbitrage).
    select: {
      id: true, orderId: true, reason: true, requestedAmountCents: true,
      description: true, createdAt: true, responseDeadlineAt: true,
    },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  return triageBySafety(rows)
}
