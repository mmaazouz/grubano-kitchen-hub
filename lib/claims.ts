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
import { executeRefund, isRefundsEnabled, RESUME_CREATE_WINDOW_MS } from '@/lib/refund'
import { buildClaimScope, resolveClaimAmount, publicClaimScope, type ClaimScope, type ClaimSelection, type StripeCashTruth } from '@/lib/claim-scope'
import { getStripe } from '@/lib/stripe'
import { canonicalReason, authorityScope, isSafetyReason } from '@/lib/claim-reasons'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
import { recordAdminAudit } from '@/lib/admin-audit'
// ROUND-6 AUDIT FIX: the "is this bound refund actually ours?" predicate lives in ONE place. It
// used to be re-derived here from `refundId` alone, which is exactly the proxy four rounds removed.
import { isResumeMismatch } from '@/lib/claim-money-line'
// ROUND 13 (B1): the binder where excludes the engine's disowned bindings by this prefix.
import { RESUME_MISMATCH } from '@/lib/claim-money-line'
// ROUND 13 (F15, A-S24-1): a reversal marker means the bound refund pays nothing — never « réellement remboursé ».
import { isStripeReverted } from '@/lib/claim-money-line'
// ROUND-8 AUDIT FIX (P1, Class 3): the server and the console ask the SAME rule which row may be attributed.
import { attributionRefusal, ownersOf, stampedClaimId } from '@/lib/claim-attribution-rules'
// ROUND-9 AUDIT FIX (Class 3/4): every "may a human do X on this claim?" has one shared answer.
import { reconcileRefusal, arbitrationRefusal, customerClaimStatus, boundRowShowsInProgress, RECONCILE_GRACE_MS, reconcileMarkerAge, claimClosureKind, refundedRowTruth, proofInstantFor, MARKERS, RECONCILE_MARKER_UNREADABLE_TEXT } from '@/lib/claim-action-rules'
// ROUND 13 (F08): the reasons a customer payload carries, by who wrote them.
import { customerClaimReasons } from '@/lib/claim-action-rules'
// ROUND 13 (H05): the closure record's two constants.
import { CLOSURE_RECORD_TRIGGER, closureRecordKey } from '@/lib/claim-action-rules'
// ROUND 13 (slice W2): T1/T2/T4, the G3 loader, the G8 texts, I-01 facts and the B8 declaration predicate.
import {
  proofInstant, deriveNoRowOutcome, reapprovalSafetyHolds, absenceProofText, safetyHoldText, noChargeClause, holdsClause,
  LIST_OVER_CAP_CLAUSE, acceptedExits, exitRegistry, isStuckResolvable as declarationAccepted,
  type ClaimFacts, type BoundRowFacts, type OrderMoneyRead, type MoneyRow, type PendingRowTruth, type StripeRefundFact,
  type BinderFact, type SucceededNotCounted, type RowContradiction, type ReapprovalVerdict, type ReapprovalFacts,
  routedSentence,
} from '@/lib/claim-action-rules'
// ROUND 13 (slice W5): G10 / G11 / AMF-1 — the claim-only reversal marking, its texts and the R0 failure answer.
import { reversalMarkerText, R0_DB_FAILED } from '@/lib/claim-action-rules'
// ROUND 13 (slice W7): J-M31 / F16 (3) — the customer-visibility sentence of STRIPE_REVERTED_TEXT; the E-13 list's pure pieces.
import { CUSTOMER_VISIBILITY_SENTENCE, refundedRowProven } from '@/lib/claim-action-rules'

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
/** C2: the attempt token M — the ISO instant FIRST (reconcileMarkerAge parses it), then a nonce unique to the attempt. */
export const reconcileRequiredMarker = (now: Date, nonce: string) =>
  `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${now.toISOString()} (tentative ${nonce}) — identité du remboursement pas encore liée. Ceci n'est PAS un échec : la vérité argent doit être PROUVÉE (Stripe), jamais devinée.`

/** True when this refundError is the crash marker rather than a recorded failure. */
export function isReconcileRequired(refundError?: string | null): boolean {
  return typeof refundError === 'string' && refundError.startsWith(RECONCILE_REQUIRED)
}

/** The identity stamped on a Refund row created BY a claim (lib/refund.ts persists it). */
export const claimRefundReason = (claimId: string) => `claim:${claimId}`
/**
 * ROUND 13 (B1): THE binder where. A claim matched by it is a BINDER of the row, whatever its status,
 * terminal ones included (fail closed). A resume_mismatch claim is never a binder: the engine disowned
 * that binding. The explicit null branch is required — NOT startsWith drops NULL rows in SQL. Every binder
 * read uses it: the attribution pre-check, the console bindings and the customer binder count.
 */
export const BINDER_OR: Prisma.ClaimWhereInput[] = [
  { refundError: null },
  { NOT: { refundError: { startsWith: RESUME_MISMATCH } } },
]
export const boundToWhere = (rowId: string, exceptClaimId: string): Prisma.ClaimWhereInput =>
  ({ refundId: rowId, id: { not: exceptClaimId }, OR: BINDER_OR })
/** C4: the pure instant rule, re-exported for the N8 / T2 writers. */
export { proofInstantFor }
/** B12: a failed identity read refuses before any write; it is never a negative identity. */
const IDENTITY_READ_FAILED = 'La base n’a pas pu être lue : l’identité du remboursement n’est pas établie et rien n’a été modifié. Réessayez.'
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
/** ROUND-8 AUDIT FIX (P1): the rail-locked proof of absence. The engine refuses EVERY refund on an
 *  order carrying a failed Refund row with a Stripe id (lib/refund.ts), and NO code ever moves a
 *  row out of 'failed' — the lock is permanent. Approving such a claim again can only fail. */
export const NO_REFUND_PROVEN_RAIL_LOCKED = 'no_refund_proven_rail_locked'
export function isRailLocked(refundError?: string | null): boolean {
  return typeof refundError === 'string' && refundError.startsWith(`${NO_REFUND_PROVEN_RAIL_LOCKED}:`)
}
/** ROUND-9 AUDIT FIX (Class 4): the claim's own refund row is pending, Stripe's complete refund list
 *  holds nothing for it, and the engine's idempotency window has expired — it paid nothing and never
 *  will. Closable by declaration (the hatch accepts it); never reconciled again. */
export const ENGINE_ROW_DEAD = 'engine_row_dead'
/** Closed for good: money already moved, or the case was definitively refused.
 *  'refused' is NOT terminal — the client may still contest it within the window. */
// Exported (round 9): the census and the rehearsal operator count non-terminal claims from THIS set.
export const TERMINAL_STATUSES: readonly string[] = ['refunded', 'refused_final']

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
  /** ROUND 13 (C3, F12): `until` is set only with error 'unconfirmed_within_window' — when a conclusion is possible. */
  | { state: 'failed'; error: string; until?: string }
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
  const claims = await prisma.claim.findMany({ where: { consumerId }, orderBy: { createdAt: 'desc' }, take: 100 })
  // ROUND-9 AUDIT FIX (P1): the status the customer reads is derived, never the raw recovery state —
  // « en cours » only for a refund bound to a row Stripe confirmed (lib/claim-action-rules).
  // ROUND 13 (F03/F04): « Remboursée » needs the bound row proven too, and a row with two or more binders
  // (A-S43) reads as a manual check for EVERY claim on it. One row read and one binder count per page; a
  // throw leaves the status unknown (financial_verification), never « Remboursée ».
  const boundIds = Array.from(new Set(claims
    .filter((c) => !!c.refundId && (c.status === 'refunding' || claimClosureKind(c) === 'refunded'))
    .map((c) => c.refundId as string)))
  const refundedIds = Array.from(new Set(claims
    .filter((c) => !!c.refundId && claimClosureKind(c) === 'refunded')
    .map((c) => c.refundId as string)))
  type BoundRow = { id: string; orderId: string; status: string; amountCents: number; stripeRefundId: string | null }
  let rowsById: Map<string, BoundRow> | null = new Map()
  if (boundIds.length) {
    try {
      const rows = await prisma.refund.findMany({ where: { id: { in: boundIds } }, select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true } })
      rowsById = new Map(rows.map((r) => [r.id, r] as const))
    } catch { rowsById = null /* unknown → never « en cours », never « Remboursée » */ }
  }
  let bindersByRow: Map<string, number> | null = new Map()
  if (refundedIds.length) {
    try {
      const groups = await prisma.claim.groupBy({ by: ['refundId'], where: { refundId: { in: refundedIds }, OR: BINDER_OR }, _count: { _all: true } })
      bindersByRow = new Map(groups.map((g) => [g.refundId as string, g._count._all] as const))
    } catch { bindersByRow = null }
  }
  // The internal recovery fields never reach the customer: refundError carries engine and Stripe text and
  // ids written for operators (found in round 10 while deriving the status; no UI reads them).
  return claims.map((c) => {
    const row = c.refundId && rowsById ? rowsById.get(c.refundId) ?? null : null
    const inProgress = c.refundId ? boundRowShowsInProgress(row) === true : null
    const refundedRow = claimClosureKind(c) !== 'refunded' ? null
      : !c.refundId ? false
        : rowsById && bindersByRow ? refundedRowTruth(row, bindersByRow.get(c.refundId) ?? 0, c.orderId) : null
    // ROUND 13 (F08): the reasons are the customer's own view — a restaurant reason only for its refusal, no Grubano
    // reason on a declaration (a legacy declaration may still carry the operator's note in arbitrationReason).
    const pub: Record<string, unknown> = { ...c, status: customerClaimStatus(c, inProgress, refundedRow), ...customerClaimReasons(c) }
    for (const k of CONSUMER_HIDDEN_CLAIM_FIELDS) delete pub[k]
    return pub
  })
}
const CONSUMER_HIDDEN_CLAIM_FIELDS = ['refundError', 'refundId', 'refundAttempted', 'activeOrderKey', 'arbitratedBy'] as const

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
    // ROUND 13 (F02/F04): restaurantResponse and reason feed claimClosureKind.
    select:  { id: true, status: true, decidedAt: true, restaurantResponseReason: true, arbitrationReason: true, refundError: true, refundId: true, refundAttempted: true, arbitrationDecision: true, restaurantResponse: true, reason: true },
  })
  // C2: a refused claim can be contested while within the contest window.
  const canContest = !!existing && existing.status === 'refused' && !!existing.decidedAt &&
    (Date.now() - existing.decidedAt.getTime() <= claimContestHours() * 3600 * 1000)
  // ROUND-9 AUDIT FIX (P1): the customer was shown the RAW status — « Remboursement en cours » on a
  // claim whose engine run had failed, and on recovery states whose money truth is open. The status
  // shown is derived (lib/claim-action-rules): « en cours » only for a refund bound to a row Stripe
  // confirmed. The raw status still drives eligibility above.
  let existingBoundConfirmed: boolean | null = null
  if (existing && existing.status === 'refunding' && existing.refundId) {
    try {
      const bound = await prisma.refund.findUnique({ where: { id: existing.refundId }, select: { status: true, stripeRefundId: true } })
      existingBoundConfirmed = boundRowShowsInProgress(bound)
    } catch { existingBoundConfirmed = null }
  }
  // ROUND 13 (F03/F04): a settled claim reads « Remboursée » only on a proven bound row with at most one
  // binder. A failed read leaves it unknown (financial_verification), never « Remboursée ».
  let existingRefundedRow: boolean | null = null
  if (existing && claimClosureKind(existing) === 'refunded') {
    if (!existing.refundId) existingRefundedRow = false
    else {
      try {
        const row = await prisma.refund.findUnique({ where: { id: existing.refundId }, select: { id: true, orderId: true, status: true, amountCents: true } })
        // W7 fixer (ER-C22): binders are counted by the claim's refundId whether or not the row exists, as listConsumerClaims,
        // the closure sender and the H10 lists count them — a missing row shared by two claims reads the manual review here too.
        const binders = await prisma.claim.count({ where: { refundId: existing.refundId, OR: BINDER_OR } })
        existingRefundedRow = refundedRowTruth(row, binders, input.orderId)
      } catch { existingRefundedRow = null }
    }
  }
  const existingClaim = existing
    // ROUND 13 (F08): reasons by who wrote them — no Grubano reason on a declaration, no restaurant reason unless it refused.
    ? { id: existing.id, status: customerClaimStatus(existing, existingBoundConfirmed, existingRefundedRow), canContest, ...customerClaimReasons(existing) }
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
 * RESUME-FIRST re-drives the oldest PENDING Refund row of the ORDER, whoever created it. Two legitimate
 * refunds on one order can carry the same amount, so a claim could be bound to — and reported settled by —
 * a refund created by the admin rail, the ghost-order path, or an earlier claim. The binding is checked
 * against the row's OWN identity.
 *
 * ROUND 13 (B7, B12): that identity is THREE-way. A fresh engine create carries the reason this call
 * passed ('ours', no read). Otherwise the row's reason is read: claim:<this> → 'ours', anything else →
 * 'not_ours', and a read that throws or finds nothing → 'unknown' — neither attributed to this claim nor
 * ruled out. A failed read is never a negative identity.
 */
export async function refundRowIdentity(
  rowId: string,
  claimId: string,
  result: { ok: boolean; resumed?: boolean },
): Promise<'ours' | 'not_ours' | 'unknown'> {
  if (result.ok && result.resumed === false) return 'ours'
  try {
    const row = await prisma.refund.findUnique({ where: { id: rowId }, select: { reason: true } })
    if (!row) return 'unknown'
    return row.reason === claimRefundReason(claimId) ? 'ours' : 'not_ours'
  } catch (e) {
    console.warn('[claims] refund identity read failed (identity unknown, not negative) —', e instanceof Error ? e.message : e)
    return 'unknown'
  }
}

/** I-01: the closed cause enum of claim_payment_blocked. */
export type ClaimBlockedCause =
  | 'no_refund_proven:v13:' | 'no_refund_proven_rail_locked:awaiting_finalization:' | 'no_refund_proven_rail_locked:'
  | 'safety_hold' | 'safety_check_unreadable' | 'unconfirmed_within_window' | 'own_row_exists' | 'resume_mismatch'
  | 'identity_unverified' | 'engine_own_row' | 'engine_failed' | 'stripe_failed' | 'engine_row_dead' | 'stripe_reverted'
  | 'reverted_after_refund' | 'refunds_disabled' | 'attempt_crashed'
export const CLAIM_BLOCKED_TITLE = 'Réclamation non payée par le rail — décision admin requise'
/**
 * ROUND 13 — certification audit of c32d8d3 (P1, I-01): once executeRefund was invoked for this attempt, or when a row
 * stamped for this claim exists or could not be read, the rail may have paid — the headline states no payment outcome.
 */
export const CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE = 'Tentative de remboursement sans issue établie — preuve requise avant toute décision'
/**
 * I-01 title: « non payée par le rail » only where no rail payment for this claim can have happened — the engine was not called
 * AND the caller established that no row stamped for this claim exists (targeted re-audit of 2466e03: a stamped row seen, or a
 * stamped read that failed, before a throw or a revert). Callers outside triggerClaimRefund act on Stripe evidence for the bound row.
 */
export function claimBlockedTitle(cause: ClaimBlockedCause, engineCalled: boolean, ownRowAbsent = true): string {
  return engineCalled || cause === 'own_row_exists' || !ownRowAbsent ? CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE : CLAIM_BLOCKED_TITLE
}
export const CLAIM_ATTEMPT_SUPERSEDED_TITLE = 'Tentative de remboursement terminée après un changement d’état de la réclamation'
const GATED_EXIT_SUFFIX = ' (réclamations+remboursements ouverts)'

/** The claim as a write left it — for the exits and registry of an alert. Positional on purpose. */
const stateAfter = (status: string, refundAttempted: boolean, refundId: string | null, errorAfter: string | null, boundRow?: BoundRowFacts): ClaimFacts => ({
  status, refundAttempted, refundId,
  ...(boundRow !== undefined ? { boundRow } : {}),
  refundError: errorAfter,
})

/**
 * I-01 claim_payment_blocked. Sent only AFTER a write whose updateMany count was 1, never inside a
 * $transaction. Best-effort: it never throws and never changes the caller's result. The facts name the
 * state written, its exits and its registry entry; they never say the claim is or will be paid.
 */
export async function alertClaimPaymentBlocked(claimId: string, cause: ClaimBlockedCause, input: {
  orderId: string | null
  /** The claim as this write left it (exits and registry are computed from it). */
  claimAfter: ClaimFacts
  refundRowIds?: string[]
  stripeRefundIds?: Array<string | null | undefined>
  firstEngineRefusal?: string | null
  holds?: string[]
  routed?: boolean | null
  engineCalled: boolean
  /** I-01 title only (the facts are unchanged): false when the caller could not establish that no row stamped for this claim exists. */
  ownRowAbsent?: boolean
}): Promise<void> {
  try {
    const now = new Date()
    const c: ClaimFacts = { ...input.claimAfter, id: claimId, ...(input.orderId ? { orderId: input.orderId } : {}) }
    const v13 = typeof c.refundError === 'string' && c.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13)
    // W7 fixer (I-01, W2 carry-over): a v13 proof is approvable only from its C4 instant, so its gated approve exit states
    // that bound too (the instant also travels in quiescenceInstant); every other approve keeps the lease-only suffix.
    const v13Instant = v13 ? proofInstant(c.refundError) : null
    const approveSuffix = v13Instant
      ? `${GATED_EXIT_SUFFIX.slice(0, -1)}, au plus tôt le ${v13Instant.toISOString()} UTC)`
      : GATED_EXIT_SUFFIX
    const exits = acceptedExits({ claim: c, now }).map((x) => (x === 'approve' ? `approve${approveSuffix}` : x)).join(', ')
    const stripeIds = (input.stripeRefundIds ?? []).filter((x): x is string => !!x)
    await sendAdminMoneyReviewAlert({
      kind:      'claim_payment_blocked',
      dedupeKey: `claim_blocked:${claimId}:${cause}`,
      title:     claimBlockedTitle(cause, input.engineCalled, input.ownRowAbsent ?? true),
      facts: {
        claimId,
        orderId:            input.orderId,
        claimStatusAfter:   c.status,
        cause,
        refundRowIds:       (input.refundRowIds ?? []).join(', ') || null,
        stripeRefundIds:    stripeIds.join(', ') || null,
        firstEngineRefusal: input.firstEngineRefusal ?? null,
        holds:              (input.holds ?? []).join(',') || null,
        routed:             input.routed === true || input.routed === false ? input.routed : 'unknown',
        ...(v13 ? { quiescenceInstant: proofInstant(c.refundError)?.toISOString() ?? null } : {}),
        exits:              exits || null,
        engineCalled:       input.engineCalled,
        registry:           exitRegistry({ claim: c, now }),
      },
    })
  } catch (e) {
    console.error('[claims] claim_payment_blocked alert failed (the write stands) —', e instanceof Error ? e.message : e)
  }
}

/** G8/G5: the rows a lock verdict names, for the alert facts. */
function verdictRowIds(v: ReapprovalVerdict): string[] {
  if (v === 'payable') return []
  const ids: string[] = []
  const r = v.refusal
  if (r?.step === 'E2') ids.push(...r.rowIds)
  if (r?.step === 'E3') ids.push(...r.oldestRowIds, ...r.otherPendingRowIds)
  if (r?.step === 'E6') ids.push(r.rowId)
  for (const h of v.holds) if (h.hold === 'H1' || h.hold === 'H3') ids.push(h.rowId)
  return Array.from(new Set(ids))
}

/** I-01 facts: the Stripe refunds a lock verdict names (E3 rows read at Stripe, H1 and H2 refunds). */
function verdictStripeRefundIds(v: ReapprovalVerdict, truths: ReapprovalFacts['truths']): string[] {
  if (v === 'payable') return []
  const ids: string[] = []
  const r = v.refusal
  if (r?.step === 'E3') {
    for (const id of r.oldestRowIds) {
      const t = truths[id]
      if (t && t.kind === 'at_stripe') ids.push(t.refundId)
    }
  }
  for (const h of v.holds) {
    if (h.hold === 'H1' && h.refundId) ids.push(h.refundId)
    if (h.hold === 'H2') ids.push(h.refundId)
  }
  return Array.from(new Set(ids))
}

/** The claim fields T1 reads (C2 step 1). */
const T1_SELECT = {
  status:               true,
  refundAttempted:      true,
  refundId:             true,
  orderId:              true,
  requestedAmountCents: true,
  refundError:          true,
} as const
/** The claim fields T2 (f) and a lost T4 CAS read back. */
type ClaimNow = { status: string; refundId: string | null; refundError: string | null }
const CLAIM_NOW_SELECT = {
  status:      true,
  refundId:    true,
  refundError: true,
} as const

// Exported for the tests that pin what an attempt WRITES (round 7, round 13); no new caller.
export async function triggerClaimRefund(claimId: string): Promise<RefundTriggerResult> {
  // REFUNDS gate: engine off → nothing is written, the claim rests 'approved' (E-10).
  if (!isRefundsEnabled()) return { state: 'pending', reason: 'refunds_disabled' }

  // ── T1 (C2) — the pre-image, the refusals that write nothing, then ONE attempt CAS on that pre-image ──
  const before = await prisma.claim.findUnique({ where: { id: claimId }, select: T1_SELECT })
  if (!before) return { state: 'already_handled' }
  if (before.status !== 'approved' || before.refundAttempted || before.refundId) return { state: 'already_handled' }
  const v13Pre = typeof before.refundError === 'string' && before.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13)
  // Every recorded state but a v13 proof (a lock, AWAITING, a safety hold, a legacy proof, a failure) is refused.
  if (before.refundError && !v13Pre) return { state: 'already_handled' }
  if (v13Pre) {
    // C4: a proof is never used before its quiescence instant, and an unreadable instant refuses.
    const instant = proofInstant(before.refundError)
    if (!instant || Date.now() < instant.getTime()) return { state: 'already_handled' }
  }
  // C2: the attempt token — the ISO instant first (reconcileMarkerAge reads it), then a nonce unique to this attempt.
  const M = reconcileRequiredMarker(new Date(), globalThis.crypto.randomUUID())
  const got = await prisma.claim.updateMany({
    where: { id: claimId, status: 'approved', refundAttempted: false, refundId: null, refundError: before.refundError },
    data:  { status: 'refunding', refundAttempted: true, refundError: M },
  })
  if (got.count !== 1) return { state: 'already_handled' }

  const orderId = before.orderId
  const requested = before.requestedAmountCents
  const superseded: RefundTriggerResult = { state: 'failed', error: 'attempt_superseded' }
  // I-01 / A-S30d: whether a throw below came after the engine was called (money may have moved) or before it.
  let engineCalled = false
  // I-01 title (targeted re-audit of 2466e03, P1 + P2): true only while THIS attempt's last read of the rows stamped for this
  // claim returned none. A stamped row seen, a stamped read that failed, or no read yet leaves the payment outcome unknown.
  let ownRowAbsent = false
  try {
    // ── T2 (C3) — every read in try (a throw is transient), every write a CAS on {refunding, true, M} ──
    const readOwnStamped = async (): Promise<{ id: string } | null | 'unreadable'> => {
      try {
        const stamped = await prisma.refund.findFirst({ where: { orderId, reason: claimRefundReason(claimId) }, select: { id: true } })
        ownRowAbsent = stamped === null
        return stamped
      } catch {
        ownRowAbsent = false
        return 'unreadable'
      }
    }
    const ownRowExists = async (ownId: string): Promise<RefundTriggerResult> => {
      ownRowAbsent = false // a row carrying this claim's identity was read
      const ownText = `${M} Vérification avant moteur : la ligne ${ownId} porte déjà l’identité de cette réclamation ; aucun nouveau remboursement n’a été lancé. Seule la preuve (« Réconcilier d’après la preuve ») établira ce qui a été versé.`
      const w = await prisma.claim.updateMany({
        where: { id: claimId, status: 'refunding', refundAttempted: true, refundError: M },
        data:  {
          refundError: ownText,
        },
      })
      if (w.count !== 1) return superseded
      await alertClaimPaymentBlocked(claimId, 'own_row_exists', {
        orderId, refundRowIds: [ownId], engineCalled: false, ownRowAbsent,
        claimAfter: stateAfter('refunding', true, null, ownText),
      })
      return { state: 'failed', error: 'own_row_exists' }
    }
    const revertPreImage = async (cause: 'safety_check_unreadable' | 'unconfirmed_within_window', until?: Date): Promise<RefundTriggerResult> => {
      const w = await prisma.claim.updateMany({
        where: { id: claimId, status: 'refunding', refundAttempted: true, refundError: M },
        data:  { status: 'approved', refundAttempted: false, refundError: before.refundError },
      })
      if (w.count !== 1) return superseded
      await alertClaimPaymentBlocked(claimId, cause, {
        orderId, engineCalled: false, ownRowAbsent,
        claimAfter: stateAfter('approved', false, null, before.refundError),
      })
      if (cause === 'unconfirmed_within_window' && until) return { state: 'failed', error: 'unconfirmed_within_window', until: until.toISOString() }
      return { state: 'failed', error: cause }
    }
    const safetyHold = async (text: string, facts: { rowIds?: string[]; holds?: string[]; routed?: boolean | null }): Promise<RefundTriggerResult> => {
      const w = await prisma.claim.updateMany({
        where: { id: claimId, status: 'refunding', refundAttempted: true, refundError: M },
        data:  { status: 'approved', refundError: text },
      })
      if (w.count !== 1) return superseded
      await alertClaimPaymentBlocked(claimId, 'safety_hold', {
        orderId, refundRowIds: facts.rowIds, holds: facts.holds, routed: facts.routed, engineCalled: false, ownRowAbsent,
        claimAfter: stateAfter('approved', true, null, text),
      })
      return { state: 'failed', error: 'safety_hold' }
    }

    // (a) a row already carrying this claim's identity
    const own = await readOwnStamped()
    if (own === 'unreadable') return await revertPreImage('safety_check_unreadable')
    if (own) return await ownRowExists(own.id)

    // (b) transient / (b') permanent unreadability — the ONE loader (G3), fresh in this request
    const read = await loadOrderMoneyFacts(orderId, claimId, requested)
    if (!read.readable) {
      if (read.permanent === null) return await revertPreImage('safety_check_unreadable')
      if (read.permanent === 'no_charge') {
        return await safetyHold(safetyHoldText(noChargeClause(read)), { rowIds: read.rows.filter((r) => r.status === 'failed' && !!r.stripeRefundId).map((r) => r.id), routed: null })
      }
      return await safetyHold(safetyHoldText(LIST_OVER_CAP_CLAUSE), { routed: null })
    }

    // (c) safety holds H1/H2/H3/H5
    const holds = reapprovalSafetyHolds(read.facts)
    if (holds.length) {
      return await safetyHold(safetyHoldText(holdsClause(holds, read.facts.routed)), {
        holds: holds.map((h) => h.hold),
        rowIds: holds.flatMap((h) => (h.hold === 'H1' || h.hold === 'H3' ? [h.rowId] : [])),
        routed: read.facts.routed,
      })
    }

    // (e') the pure derivation, on the fresh facts, for EVERY pre-image (null or v13)
    const outcome = deriveNoRowOutcome(read, claimId)
    if (outcome.kind === 'park') {
      const parked = await enterFinancialVerification({
        claimId, reason: outcome.reason, detail: outcome.detail,
        expect: {
          status:      'refunding',
          refundError: M,
        },
      })
      return parked.entered ? { state: 'failed', error: 'proof_stale' } : superseded
    }
    if (outcome.kind === 'no_write') {
      if (outcome.outcome === 'unconfirmed_within_window') return await revertPreImage('unconfirmed_within_window', outcome.until)
      if (outcome.outcome === 'changed_during_read') {
        const stamped = read.facts.rows.find((r) => r.reason === claimRefundReason(claimId))
        return stamped ? await ownRowExists(stamped.id) : await revertPreImage('safety_check_unreadable')
      }
      return await revertPreImage('safety_check_unreadable')
    }
    const payable = outcome.basis === 'verdict' && outcome.verdict === 'payable'
    if (!payable) {
      // A locked or AWAITING proof is WRITTEN (V-A-1): never a revert to a pre-image no exit accepts.
      const text = absenceProofText(outcome, read, { preImage: before.refundError, now: new Date(), requestedAmountCents: requested })
      const w = await prisma.claim.updateMany({
        where: { id: claimId, status: 'refunding', refundAttempted: true, refundError: M },
        data:  { status: 'approved', refundAttempted: false, refundId: null, refundError: text },
      })
      if (w.count !== 1) return superseded
      const verdict = outcome.basis === 'verdict' ? outcome.verdict : 'payable'
      await alertClaimPaymentBlocked(claimId, outcome.prefix, {
        orderId, refundRowIds: verdictRowIds(verdict), routed: read.facts.routed, engineCalled: false, ownRowAbsent,
        stripeRefundIds: verdictStripeRefundIds(verdict, read.facts.truths),
        firstEngineRefusal: verdict === 'payable' ? null : verdict.refusal?.step ?? null,
        holds: verdict === 'payable' ? [] : verdict.holds.map((h) => h.hold),
        claimAfter: stateAfter('approved', false, null, text),
      })
      return { state: 'failed', error: 'proof_stale' }
    }
    if (v13Pre) {
      // Re-checked here (C3 (e')): a v13 pre-image before its instant is restored, never driven.
      const instant = proofInstant(before.refundError)
      // No `until`: that toast names an older row in its confirmation window, which is not this cause.
      if (!instant || Date.now() < instant.getTime()) return await revertPreImage('unconfirmed_within_window')
    }

    // (f) the last reads before the engine: the stamped query again, then the claim must still be {refunding, M}.
    const ownAgain = await readOwnStamped()
    if (ownAgain === 'unreadable') return await revertPreImage('safety_check_unreadable')
    if (ownAgain) return await ownRowExists(ownAgain.id)
    let current: ClaimNow | null
    try {
      current = await prisma.claim.findUnique({ where: { id: claimId }, select: CLAIM_NOW_SELECT })
    } catch {
      return await revertPreImage('safety_check_unreadable')
    }
    if (!current || current.status !== 'refunding' || current.refundError !== M) return superseded
    engineCalled = true
    const result = await executeRefund({
      orderId:     orderId,
      amountCents: requested,
      reason:      `claim:${claimId}`,
    })

    // ── T4 (C5) — every post-engine claim write is a CAS on {refunding, M}: a late attempt never overwrites ──
    const t4Write = async (data: Prisma.ClaimUpdateManyMutationInput): Promise<boolean> => {
      const w = await prisma.claim.updateMany({
        where: {
          id:          claimId,
          status:      'refunding',
          refundError: M,
        },
        data,
      })
      return w.count === 1
    }
    const lostCas = async (): Promise<RefundTriggerResult> => {
      if (result.ok || result.pending) {
        let now: ClaimNow | null = null
        try {
          now = await prisma.claim.findUnique({ where: { id: claimId }, select: CLAIM_NOW_SELECT })
        } catch { /* best effort: the alert still goes out */ }
        try {
          await sendAdminMoneyReviewAlert({
            kind:      'claim_attempt_superseded',
            dedupeKey: `claim_attempt:${claimId}:${result.refundId}`,
            title:     CLAIM_ATTEMPT_SUPERSEDED_TITLE,
            facts: {
              claimId, orderId,
              refundRowId:               result.refundId,
              stripeRefundId:            result.stripeRefundId ?? null,
              engineStatus:              result.ok ? 'ok' : 'pending',
              resumed:                   result.ok ? result.resumed : null,
              claimStatusNow:            now?.status ?? null,
              claimRefundIdNow:          now?.refundId ?? null,
              claimRefundErrorPrefixNow: now && now.refundError ? now.refundError.split(' ')[0].slice(0, 80) : null,
            },
          })
        } catch { /* never throws into the caller */ }
      } else {
        console.warn('[claims] attempt_superseded', claimId, result.error)
      }
      return superseded
    }
    const blocked = (cause: ClaimBlockedCause, claimAfter: ClaimFacts, rowId: string | null, stripeRefundId?: string | null) =>
      alertClaimPaymentBlocked(claimId, cause, { orderId, claimAfter, refundRowIds: rowId ? [rowId] : [], stripeRefundIds: [stripeRefundId], engineCalled: true })

    if (result.ok) {
      // RESUME-FIRST drove an OLDER interrupted row instead of this claim's amount: money moved, not for this claim.
      if (result.resumedIgnoredAmount) {
        if (!(await t4Write({
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a repris un remboursement antérieur (${result.amountCents} c) au lieu du montant de cette réclamation (${requested} c). Décision admin requise — aucun nouveau remboursement automatique.`,
        }))) return await lostCas()
        await blocked('resume_mismatch', stateAfter('refunding', true, result.refundId, RESUME_MISMATCH), result.refundId, result.stripeRefundId)
        return { state: 'failed', error: 'resume_mismatch' }
      }
      const identity = await refundRowIdentity(result.refundId, claimId, result)
      if (identity === 'not_ours') {
        if (!(await t4Write({
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a abouti sur un remboursement (${result.refundId}) qui n'appartient PAS à cette réclamation — montant identique, identité différente. Le remboursement a abouti chez Stripe, mais pas au titre de cette réclamation. Décision admin requise — aucun nouveau remboursement automatique.`,
        }))) return await lostCas()
        await blocked('resume_mismatch', stateAfter('refunding', true, result.refundId, RESUME_MISMATCH, { id: result.refundId }), result.refundId, result.stripeRefundId)
        return { state: 'failed', error: 'resume_mismatch' }
      }
      if (identity === 'unknown') {
        const unknownOk = `${M} Moteur : le remboursement de la ligne ${result.refundId} a abouti chez Stripe ; l’identité de cette ligne n’a pas pu être relue (lecture de la base en échec) : il n’est ni attribué à cette réclamation, ni écarté. Seule la preuve (« Réconcilier d’après la preuve ») établira à quelle réclamation il appartient.`
        if (!(await t4Write({
          refundError: unknownOk,
        }))) return await lostCas()
        await blocked('identity_unverified', stateAfter('refunding', true, null, unknownOk), result.refundId, result.stripeRefundId)
        return { state: 'failed', error: 'identity_unverified' }
      }
      if (!(await t4Write({
        status: 'refunded', refundId: result.refundId, activeOrderKey: null, decidedAt: new Date(),
        refundError: null,
      }))) return await lostCas()
      // H05 site 1: the T4 'ours' CAS to refunded won — this build's closure record, outside any transaction.
      await recordClaimClosure(claimId)
      return { state: 'refunded', refundId: result.refundId, amountCents: result.amountCents }
    }
    // PHASE 2 (§15 A7) — Stripe accepted the refund but it is NOT succeeded yet: the claim stays refunding.
    if (result.pending) {
      // The 202 outcome carries no resumedIgnoredAmount: compare the amount actually driven.
      if (result.amountCents !== requested) {
        if (!(await t4Write({
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a repris un remboursement antérieur (${result.amountCents} c, encore en attente chez Stripe) au lieu du montant de cette réclamation (${requested} c). Décision admin requise — aucun nouveau remboursement automatique.`,
        }))) return await lostCas()
        await blocked('resume_mismatch', stateAfter('refunding', true, result.refundId, RESUME_MISMATCH), result.refundId, result.stripeRefundId)
        return { state: 'failed', error: 'resume_mismatch' }
      }
      const identity = await refundRowIdentity(result.refundId, claimId, result)
      if (identity === 'not_ours') {
        if (!(await t4Write({
          refundId:    result.refundId,
          refundError: `resume_mismatch: le moteur a repris un remboursement (${result.refundId}) qui n'appartient PAS à cette réclamation — montant identique, identité différente, encore en attente chez Stripe. Décision admin requise — aucun nouveau remboursement automatique.`,
        }))) return await lostCas()
        await blocked('resume_mismatch', stateAfter('refunding', true, result.refundId, RESUME_MISMATCH, { id: result.refundId }), result.refundId, result.stripeRefundId)
        return { state: 'failed', error: 'resume_mismatch' }
      }
      if (identity === 'unknown') {
        const unknownPending = `${M} Moteur : le remboursement de la ligne ${result.refundId} a été accepté par Stripe et reste en attente ; l’identité de cette ligne n’a pas pu être relue (lecture de la base en échec) : il n’est ni attribué à cette réclamation, ni écarté. Seule la preuve (« Réconcilier d’après la preuve ») établira à quelle réclamation il appartient.`
        if (!(await t4Write({
          refundError: unknownPending,
        }))) return await lostCas()
        await blocked('identity_unverified', stateAfter('refunding', true, null, unknownPending), result.refundId, result.stripeRefundId)
        return { state: 'failed', error: 'identity_unverified' }
      }
      if (!(await t4Write({
        refundId:    result.refundId,
        refundError: null,
      }))) return await lostCas()
      return { state: 'pending', reason: 'stripe_pending', refundId: result.refundId }
    }
    // The engine refused. Nothing re-drives it from Claims. When this claim's own row exists and has not
    // failed, money may have moved: the claim keeps its token (evidence decides). engine_failed is written
    // only when the engine refused before creating anything, or when the row it created has failed.
    let ownRow: { id: string; status: string } | null | 'unreadable'
    try {
      ownRow = await prisma.refund.findFirst({
        where:   { orderId, reason: claimRefundReason(claimId) },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, status: true },
      })
    } catch {
      ownRow = 'unreadable'
    }
    if (ownRow === 'unreadable' || (ownRow && ownRow.status !== 'failed')) {
      const ownText = ownRow === 'unreadable'
        ? `${M} Moteur : « ${result.error} » — les lignes de remboursement de cette commande n’ont pas pu être relues ; seule la preuve établira ce qui a été versé ou non.`
        : `${M} Moteur : « ${result.error} » — la ligne ${ownRow.id} existe ; seule la preuve établira ce qui a été versé ou non.`
      if (!(await t4Write({
        refundError: ownText,
      }))) return await lostCas()
      await blocked('engine_own_row', stateAfter('refunding', true, null, ownText), ownRow === 'unreadable' ? null : ownRow.id)
      return { state: 'failed', error: result.error }
    }
    const failedData = {
      status:      'approved',
      ...(ownRow ? { refundId: ownRow.id } : {}),
      refundError: `engine_failed: ${result.error} — aucune relance possible depuis les réclamations ; décision humaine requise.`,
    }
    if (!(await t4Write(failedData))) return await lostCas()
    await blocked('engine_failed', stateAfter('approved', true, ownRow ? ownRow.id : null, failedData.refundError), ownRow ? ownRow.id : null)
    return { state: 'failed', error: result.error }
  } catch (err) {
    // A-S30d: a throw after T1 leaves the claim on its token (reconcile after the grace). Best-effort alert, then rethrow.
    // IMPLEMENTATION NOTE (W2) on I-01: the catch also covers the engine call and the T4 writes, so engineCalled
    // is the fact this attempt established — true once executeRefund was invoked, whatever it then did.
    await alertClaimPaymentBlocked(claimId, 'attempt_crashed', { orderId, engineCalled, ownRowAbsent, claimAfter: stateAfter('refunding', true, null, M) })
    throw err
  }
}

// ── APPROVE — restaurant accept OR auto-timeout ───────────────────────────────────
async function approveClaim(claimId: string, decidedBy: 'restaurant' | 'auto_timeout' | 'auto_small' | 'admin'): Promise<RefundTriggerResult> {
  // ATOMIC transition restaurant_review → approved (only one caller wins).
  const claimed = await prisma.claim.updateMany({
    where: { id: claimId, status: 'restaurant_review' },
    data:  { status: 'approved', restaurantResponse: 'accepted', decidedBy, decidedAt: new Date() },
  })
  if (claimed.count !== 1) return { state: 'already_handled' }
  const refund = await triggerClaimRefund(claimId)
  // I-01 / D2 (2): the refund rail is closed — nothing was started. After this function's own won CAS only.
  if (refund.state === 'pending' && refund.reason === 'refunds_disabled') {
    let orderId: string | null = null
    try {
      orderId = (await prisma.claim.findUnique({ where: { id: claimId }, select: { orderId: true } }))?.orderId ?? null
    } catch { /* best effort */ }
    await alertClaimPaymentBlocked(claimId, 'refunds_disabled', { orderId, engineCalled: false, firstEngineRefusal: null, claimAfter: stateAfter('approved', false, null, null) })
  }
  return refund
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
      // ROUND 13 (C4): the sweep reads refundError so it can skip every recorded state.
      select: { id: true, refundError: true },
      take:   500,
    })
    summary.scannedPending = pending.length
    for (const c of pending) {
      // ROUND 13 (C4, J-M21/J-M47): the sweep never drives a claim carrying a refundError — a proof of
      // absence (v13 before or after its instant, or legacy), a lock, a safety hold, a recorded failure.
      // Only a human approval re-drives those, through the arbitration checks.
      if (c.refundError) continue
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
    // ROUND 13 (D14 (0), D2 (1)(c)): a payable proof is approvable only unbound — the rule reads refundId.
    // ROUND 13 (I-01): orderId feeds the refunds_disabled alert facts.
    select: { id: true, orderId: true, status: true, refundAttempted: true, responseDeadlineAt: true, arbitrationDecision: true, refundId: true, refundError: true },
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
  // ROUND-9 AUDIT FIX (P1, Class 3 again): every pre-check — the rail lock, the finalization lock,
  // "already approved cannot be refused", terminal, the restaurant's delay, "not in arbitration" —
  // lives in ONE rule the arbitration queue also applies (lib/claim-action-rules → approveRefusal /
  // refuseFinalRefusal). Round 9 disabled approve on a rail-locked claim and left « Refuser » live,
  // which this function always refused there. Same checks, same order, same messages.
  const now = new Date()
  const refusal = arbitrationRefusal(claim, input.decision, now)
  if (refusal) return { ok: false, status: refusal.status, error: refusal.error }
  // ROUND 13 (D2 (1)(b)): unpaid AND unbound — the same admission as arbitrationRefusal.
  const legacyApproved = claim.status === 'approved' && !claim.refundAttempted && !claim.refundId // héritage pré-P0-24
  // RESTAURANT SILENCE (Claims batch 1): once the response deadline has passed the claim is
  // ADMIN-ACTIONABLE. Silence never triggers a refund by itself.
  const deadline = claim.responseDeadlineAt instanceof Date ? claim.responseDeadlineAt : null
  const silenceExpired = claim.status === 'restaurant_review' && !!deadline && deadline.getTime() <= now.getTime()

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
      // ROUND 13 (D2 (1)(b)/(c)): the pre-image the refusal read — a proof rewritten meanwhile is not re-decided.
      ? { id: claim.id, status: 'approved', refundAttempted: false, refundId: null, refundError: claim.refundError }
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
    // H05 site 6: a refuse_final decision is a closure by this build — the record follows the won CAS.
    await recordClaimClosure(claim.id)
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
  // ROUND 13 (D2 (2), I-01, N-C-2): the beta writer of E-10 — claims open, refunds closed. triggerClaimRefund
  // wrote nothing; this decision CAS won. The alert is best-effort and never changes the result.
  if (refund.state === 'pending' && refund.reason === 'refunds_disabled') {
    await alertClaimPaymentBlocked(claim.id, 'refunds_disabled', {
      orderId: claim.orderId ?? null, engineCalled: false, firstEngineRefusal: null,
      claimAfter: stateAfter('approved', false, null, claim.refundError ?? null),
    })
  }
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
    /** ROUND-8 AUDIT FIX (P1): approving this claim again can only fail — the engine lock is permanent. */
    railLocked:      isRailLocked(c.refundError),
    /** ROUND-9 AUDIT FIX (parity): the server's own verdict for each decision (lib/claim-action-rules) —
     *  the console disables exactly the decision arbitrateClaim would refuse, with its message. */
    approveRefusal:     arbitrationRefusal(c, 'approve', now)?.error ?? null,
    refuseFinalRefusal: arbitrationRefusal(c, 'refuse_final', now)?.error ?? null,
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
  | { reconciled: false; reason: 'no_claim' | 'already_final' | 'not_bound' | 'ambiguous_binding' | 'stripe_reverted' }
  | { reconciled: true; claimId: string; from: string; to: string }

export async function reconcileClaimForRefund(input: {
  /** Our `Refund` row id — the identity the claim is bound to. */
  refundRowId: string
  status: 'succeeded' | 'failed'
  /** Stripe's own id, for the audit trail only. */
  stripeRefundId?: string | null
  /**
   * IMPLEMENTATION NOTE (W6 fixer): the opt-out names the ONE claim its caller records (closureRecordedFor === claim.id);
   * any other claim this function settles on the row still writes its record with noNoticeSource, so no closure by this
   * build is ever left without a record because a caller opted out for a different claim.
   * ROUND 13 (H05 site 2, ER-R29 — IMPLEMENTATION NOTE (W5)): applyRowTruth records the closure itself (site 3) and says
   * so here. Every other caller — the Stripe webhook and the recovery sweep — omits it, and a refunded CAS won here
   * writes the record with noNoticeSource. Inverted from ER-R29's « callers pass noNoticeSource » because binding rule 9
   * keeps the webhook's reconcileClaimForRefund call byte-identical.
   */
  closureRecordedFor?: string
}): Promise<ClaimReconcileResult> {
  // ROUND 13 (B9 (a), slice W4): EVERY claim bound to the row — a legacy row can bind several, and one Refund
  // settles at most one claim (B6). findFirst picked one of them arbitrarily.
  const bound = await prisma.claim.findMany({
    where:  { refundId: input.refundRowId },
    select: { id: true, status: true, refundError: true },
  })
  // A refund with no claim bound to it is normal (admin rail, ghost-order, external).
  if (!bound.length) return { reconciled: false, reason: 'no_claim' }
  // The row, read ONCE: its stamp decides whether a legacy own-row mismatch is a candidate (B8), its status the
  // succeeded branch. A failed read concludes nothing (B12): no write.
  let row: { status: string; reason: string | null } | null
  try {
    row = await prisma.refund.findUnique({ where: { id: input.refundRowId }, select: { status: true, reason: true } })
  } catch (e) {
    // B12: no write. The swallowed identity read is logged, so a bound claim left on this row stays visible.
    const code = (e as { code?: unknown } | null)?.code
    console.warn('[claims] refund row read failed — no claim reconciled', input.refundRowId, typeof code === 'string' || typeof code === 'number' ? code : e instanceof Error ? e.name : 'unknown')
    return { reconciled: false, reason: 'not_bound' }
  }
  // AUDIT FIX (P1) + ROUND 13 (B8): a claim parked by the RESUME-FIRST mismatch guard is bound to a refund
  // that settled someone ELSE's amount — never a candidate. The exception is a legacy mismatch whose bound row
  // carries THIS claim's own stamp: its identity is established, so the row's truth applies.
  const candidates = bound.filter((c) => !isResumeMismatch(c.refundError) || (!!row && stampedClaimId(row.reason) === c.id))
  if (candidates.length === 0) return { reconciled: false, reason: 'not_bound' }
  // B9 (a) / A-S43: two or more candidates — nothing settles, nothing is written, a human decides (census REG-10).
  if (candidates.length > 1) {
    console.error('[MONEY REVIEW] ambiguous_binding', input.refundRowId, candidates.map((c) => c.id))
    return { reconciled: false, reason: 'ambiguous_binding' }
  }
  const claim = candidates[0]
  if (TERMINAL_STATUSES.includes(claim.status)) return { reconciled: false, reason: 'already_final' }

  if (input.status === 'succeeded') {
    // AUDIT FIX (P1): the caller's `status` argument describes the EVENT, not our row. A
    // succeeded event can arrive for a Refund row we already marked failed, or after the
    // finalize path no-ops. Trust our own row, not the event, before declaring money paid.
    if (!row || row.status !== 'succeeded') return { reconciled: false, reason: 'not_bound' }
    // ROUND 13 — certification audit of c32d8d3 (P1, and its recovery-sweep sibling; G13, A-S24-1, E-02): a reversal marks
    // the CLAIM only and leaves our row 'succeeded' by design, so our own row cannot prove that this refund held. A claim
    // carrying a reversal marker is never settled here — not by a stale, duplicate or out-of-order 'succeeded' delivery, and
    // not by a recovery pass whose Stripe read preceded the reversal. Nothing is written; the marked claim keeps its exits.
    if (isStripeReverted(claim.refundError)) {
      console.error('[MONEY REVIEW] stripe_reverted_not_settled', claim.id, input.refundRowId)
      return { reconciled: false, reason: 'stripe_reverted' }
    }

    // CAS on the exact bound identity AND the pre-image read (C9 (b)): a duplicate or out-of-order webhook
    // delivery finds no row to move the second time and is a clean no-op; a claim rewritten since is not touched.
    const done = await prisma.claim.updateMany({
      where: { id: claim.id, refundId: input.refundRowId, status: { in: ['refunding', 'approved'] }, refundError: claim.refundError },
      data:  { status: 'refunded', refundError: null, activeOrderKey: null, decidedAt: new Date() },
    })
    if (done.count !== 1) return { reconciled: false, reason: 'already_final' }
    // H05 site 2: the webhook / recovery settlement is this build's closure; no customer notice is sent from here.
    if (input.closureRecordedFor !== claim.id) await recordClaimClosure(claim.id, { noNoticeSource: true })
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
  // (The disowned binding was refused above; only the own-row legacy mismatch reaches here — B8.)
  const done = await prisma.claim.updateMany({
    where: { id: claim.id, refundId: input.refundRowId, status: { in: ['refunding', 'approved'] }, refundError: claim.refundError },
    data:  {
      status:      'approved', // actionable again for the admin, never auto-retried
      refundError: `stripe_failed: le remboursement Stripe ${input.stripeRefundId ?? input.refundRowId} a ÉCHOUÉ — cette ligne n’a donc rien versé. Cela ne dit RIEN des autres remboursements de la commande : vérifiez la commande dans Stripe avant tout paiement. Décision admin requise, aucun nouvel essai automatique.`,
    },
  })
  if (done.count !== 1) return { reconciled: false, reason: 'already_final' }
  return { reconciled: true, claimId: claim.id, from: claim.status, to: 'approved(refund_failed)' }
}

/** ROUND 13 (D0 / I-09, slice W7): the approvable flag of a list row — acceptedExits ∋ approve && arbitrationRefusal('approve') === null. */
function approvableNow(c: ClaimFacts, now: Date = new Date()): boolean {
  return acceptedExits({ claim: c, now }).includes('approve') && arbitrationRefusal(c, 'approve', now) === null
}

/** Claims whose MONEY needs a human: stuck in refunding, or carrying a refund error.
 *  Enriched with the bound Refund row so the admin sees Stripe's own status and the
 *  ACTUAL refunded amount — the Claim row itself only stores what was REQUESTED. */
export async function listActionableRefundClaims() {
  // ROUND 13 (I-09 / D7 / E-06 / E-07, slice W5): a settled claim whose bound row is FAILED with a Stripe id (A-S31c,
  // reconcile R0a) and a settled claim carrying the REVERTED_AFTER_REFUND marker (E-06, declaration) are listed here.
  const failedWithIdRowIds = (await prisma.refund.findMany({ where: { status: 'failed', stripeRefundId: { not: null } }, select: { id: true } }) ?? [])
    .map((r) => r.id)
  const claims = await prisma.claim.findMany({
    where: {
      OR: [
        { status: 'refunding' },
        { status: 'approved', refundError: { not: null } },
        { status: 'approved', refundAttempted: true },
        // Approved by a human but never driven (REFUNDS was off at decision time) — money owed.
        { status: 'approved', refundAttempted: false },
        { status: 'refunded', refundError: { startsWith: MARKERS.REVERTED_AFTER_REFUND } },
        ...(failedWithIdRowIds.length ? [{ status: 'refunded', refundError: null, refundId: { in: failedWithIdRowIds } }] : []),
      ],
    },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  const rowIds = claims.map((c) => c.refundId).filter((x): x is string => !!x)
  const rows = rowIds.length
    ? await prisma.refund.findMany({
        where:  { id: { in: rowIds } },
        select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true, reason: true },
      })
    : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  // ROUND 13 (E-07 / E-13 disjoint, slice W5): a settled claim is listed here only when its failed-with-id row is on its OWN
  // order (A-S31c, reconcile R0a); a row of another order is E-13 (refundedRowUnproven), never this list.
  const listed = claims.filter((c) => !(c.status === 'refunded' && c.refundError === null && (c.refundId ? byId.get(c.refundId)?.orderId : undefined) !== c.orderId))
  // SAFETY FIRST (batch 2): visibility and ordering only — no extra financial authority.
  listed.sort((a, b) => (isSafetyReason(b.reason) ? 1 : 0) - (isSafetyReason(a.reason) ? 1 : 0))
  return listed.map((c) => {
    const row = c.refundId ? byId.get(c.refundId) ?? null : null
    // ROUND 13 (B8, D0 parity): the flags read the bound row exactly as the routes do (read here: never undefined).
    // W5: with its orderId, which G1 (iii) compares with the claim's.
    const boundRow: BoundRowFacts | null = row ? { id: row.id, orderId: row.orderId, status: row.status, stripeRefundId: row.stripeRefundId, reason: row.reason } : null
    // ROUND 13 (D0): the reconcile gate verdict, read once — the flag and the money state below both come from it.
    const gateRefusal = reconcileRefusal({ ...c, boundRow })
    // Truthful classification — never "pending means success".
    let moneyState:
      | 'stripe_pending' | 'stripe_failed' | 'stripe_succeeded_claim_unreconciled'
      | 'stale_refunding_no_refund_row' | 'refund_error_recorded' | 'approved_not_driven'
      // T-49: an interrupted attempt whose refund identity was never bound. NOT a failure —
      // money may have moved. Only evidence can say. Never closed by admin assertion.
      | 'reconcile_required'
      // W3 round-2 fix (D0 / D5 / F16 (7)): the same marker whose start instant cannot be read (malformed or in the
      // future). The gate refuses it and no exit is accepted, so its guidance must not name reconcile.
      | 'reconcile_marker_unreadable'
      // ROUND-6 AUDIT FIX (P2): the reconciler PROVED nothing ever left (no row moved, Stripe
      // reports nothing). That is a success, not an error — it was classified as an error.
      | 'absence_proven_payable'
      // ROUND-8 AUDIT FIX (P1): OUR row is pending and carries NO Stripe id — nothing is confirmed at Stripe.
      | 'local_pending_unconfirmed'
    if (isReconcileRequired(c.refundError)) moneyState = gateRefusal?.error === RECONCILE_MARKER_UNREADABLE_TEXT ? 'reconcile_marker_unreadable' : 'reconcile_required'
    else if (c.status === FINANCIAL_VERIFICATION) moneyState = 'reconcile_required'
    // ROUND 13 (F15): only a proof written by this build is payable; a legacy proof is re-proved first (A-S32).
    else if (typeof c.refundError === 'string' && c.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13)) moneyState = 'absence_proven_payable'
    else if (isNoRefundProven(c.refundError)) moneyState = 'reconcile_required'
    else if (c.refundError) moneyState = 'refund_error_recorded'
    // ROUND-8 AUDIT FIX (P2): 'refunding' with NO binding and no error is the legacy stranded shape
    // the FV console lists as money-unknown; this console called it « sans aucun remboursement
    // Stripe », a negative Stripe assertion nothing had checked. Same population, same verdict.
    // ROUND-9 (exit table): an approval BOUND to a row that does not exist is the same stale binding, and
    // an approval whose attempt was taken with nothing recorded is money-unknown — not « jamais payée ».
    else if (!row) moneyState = c.refundId
      ? 'stale_refunding_no_refund_row'
      : (c.status === 'refunding' || c.refundAttempted ? 'reconcile_required' : 'approved_not_driven')
    // ROUND-8 AUDIT FIX (P1): OUR row being pending says nothing about Stripe. Only a row that
    // carries a Stripe id was ever confirmed there.
    else if (row.status === 'pending') moneyState = row.stripeRefundId ? 'stripe_pending' : 'local_pending_unconfirmed'
    else if (row.status === 'failed') moneyState = 'stripe_failed'
    else moneyState = 'stripe_succeeded_claim_unreconciled'
    return {
      ...c,
      moneyState,
      safety: isSafetyReason(c.reason),
      /** Whether the stuck-money escape hatch would ACCEPT this row (same predicate as the route). */
      resolvable: declarationAccepted({ ...c, boundRow }),
      /** ROUND-9 AUDIT FIX (parity): whether « Réconcilier d’après la preuve » would run on this claim —
       *  the same rule reconcileClaimEvidence applies before it reads anything. */
      reconcilable: gateRefusal === null,
      /** ROUND 13 (D0 / I-09, slice W7): acceptedExits ∋ approve && arbitrationRefusal('approve') === null — the verdict of the
       *  arbitrate route on the same facts (the financial-verification card never renders « Approuver »; ARB reads its own queue). */
      approvable: approvableNow({ ...c, boundRow }),
      // ROUND 13 (F15): the bound row's reason is its identity stamp — the card's money line reads it (cardMoneyLine).
      refund: row ? { id: row.id, status: row.status, actualAmountCents: row.amountCents, stripeRefundId: row.stripeRefundId, createdAt: row.createdAt, reason: row.reason } : null,
      /** ROUND-6 AUDIT FIX (P1): the bound row exists, but the engine established it is NOT this
       *  claim's refund (RESUME-FIRST disowned it). Its amount is somebody else's money. */
      refundNotOurs: isResumeMismatch(c.refundError) && !(row && row.reason === claimRefundReason(c.id)),
      /** ROUND 13 (F15, A-S36-1): a resume_mismatch on a row that carries THIS claim's stamp — identity established, not reconciled. */
      refundIdentityUnread: isResumeMismatch(c.refundError) && !!row && row.reason === claimRefundReason(c.id),
      /** The amount that ACTUALLY moved FOR THIS CLAIM, or null while nothing succeeded — or
       *  while what succeeded is not this claim's. `refundId` alone was used as the proxy here,
       *  which printed another claim's cash under « Montant réellement remboursé ». */
      // ROUND 13 (F15, A-S24-1): a claim marked STRIPE_REVERTED / REVERTED_AFTER_REFUND keeps a 'succeeded' row
      // whose Stripe refund failed or was canceled: that row pays nothing, whatever our base records.
      actualRefundedCents: isStripeReverted(c.refundError) ? null
        : row && row.status === 'succeeded' && !isResumeMismatch(c.refundError) ? row.amountCents : null,
    }
  })
}

/**
 * ROUND-10 AUDIT FIX (P2 ×2): reconciliation can conclude a CLAIM from Stripe's evidence while our own
 * Refund row stays 'pending' (a succeeded refund applied to the claim, a failed one recorded, a dead
 * row closed by declaration). The engine's row-side work — ledger, royalty clawback, the failed-row
 * lock — is not done by reconciliation, and RESUME-FIRST takes the order's oldest pending row before
 * any new refund on that order. Those rows are listed here, ungated, so they cannot go unseen.
 * Read-only: this function writes nothing. Each row carries the reconcile gate verdict of its claim (D7): the console
 * renders « Réconcilier d’après la preuve » on a row iff `reconcilable` is true, and the refusal text otherwise.
 */
export async function listUnfinalizedClaimRefundRows() {
  // ROUND 13 (D7 CONSOLE, slice W5): the row carries the claim's gate facts, so `reconcilable` is the server verdict
  // (reconcileRefusal with this bound row) — A-S31d (a settled claim on a pending row) gets « Réconcilier d’après la preuve ».
  const claims = await prisma.claim.findMany({
    where:  { refundId: { not: null }, status: { not: 'refunding' } },
    select: { id: true, orderId: true, status: true, refundId: true, refundAttempted: true, refundError: true },
  })
  if (!claims.length) return []
  const byRow = new Map(claims.map((c) => [c.refundId as string, c]))
  const rows = await prisma.refund.findMany({
    where:   { id: { in: Array.from(byRow.keys()) }, status: 'pending' },
    select:  { id: true, orderId: true, amountCents: true, stripeRefundId: true, createdAt: true, reason: true },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => {
    const c = byRow.get(r.id) ?? null
    const gate = c ? reconcileRefusal({ ...c, boundRow: { id: r.id, orderId: r.orderId, status: 'pending', stripeRefundId: r.stripeRefundId, reason: r.reason ?? null } }) : null
    return {
      /** D7 / J-M29 payload key. refundRowId is the same id, kept for the existing readers (W5 note on D7). */
      rowId:            r.id,
      refundRowId:      r.id,
      orderId:          r.orderId,
      amountCents:      r.amountCents,
      stripeRefundId:   r.stripeRefundId,
      rowCreatedAt:     r.createdAt,
      rowReason:        r.reason ?? null,
      claimId:          c?.id ?? null,
      claimStatus:      c?.status ?? null,
      refundError:      c?.refundError ?? null,
      /** D0 / D7: the reconcile gate verdict for this claim and row — the control is rendered iff true. */
      reconcilable:     !!c && gate === null,
      reconcileRefusal: c && gate ? gate.error : null,
    }
  })
}

/** H10 / E-13: records scanned per page, the scan cap and the items returned (the same bounds as the notice list). */
const UNPROVEN_SCAN_PAGE = 500
const UNPROVEN_SCAN_CAP = 5000
const UNPROVEN_ITEMS_CAP = 200

/**
 * ROUND 13 (H10 / E-13, slice W7) listRefundedClaimsWithUnprovenRow — READ-ONLY. Settled claims (refunded, refundError null)
 * whose bound row is not established (F03 refundedRowProven false: no refundId, the row missing, on another order, not
 * succeeded or pending, or without a usable amount), EXCLUDING a failed row with a Stripe id on the claim's own order (A-S31c,
 * listed in the card's otherUnsettled bucket by listActionableRefundClaims: E-07 and E-13 stay disjoint).
 * reconcilable = reconcileRefusal(claim facts with the bound row) === null (D0).
 * IMPLEMENTATION NOTE (W7) on H10 / E-12: a row with two or more binders (A-S43) is excluded too — its claims read the manual
 * review (refundedRowTruth null), not « Remboursement non confirmé », so the section text would be false for them; they stay
 * visible through the census rowsBoundToMultipleClaims and the notice blocker refunded_row_ambiguous. Settled claims are read
 * in pages of 500 (oldest first), up to 5000 scanned (scanTruncated past that); items are the first 200.
 * W7 fixer (H10 paging): the pages follow an id cursor (skip 1), as listMissingClaimClosureNotices does — an offset over the
 * mutable set {refunded, refundError null} skipped a claim whenever an earlier one left the set between two pages.
 */
export async function listRefundedClaimsWithUnprovenRow() {
  type Settled = { id: string; orderId: string; reason: string; requestedAmountCents: number; status: string; refundId: string | null; refundError: string | null; refundAttempted: boolean; createdAt: Date; decidedAt: Date | null }
  type Row = { id: string; orderId: string; status: string; amountCents: number; stripeRefundId: string | null; reason: string | null }
  const found: Array<Settled & { refund: Row | null; reconcilable: boolean }> = []
  let scanned = 0
  let scanTruncated = false
  let cursor: string | null = null
  for (;;) {
    const claims = (await prisma.claim.findMany({
      where:   { status: 'refunded', refundError: null },
      select:  { id: true, orderId: true, reason: true, requestedAmountCents: true, status: true, refundId: true, refundError: true, refundAttempted: true, createdAt: true, decidedAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take:    UNPROVEN_SCAN_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })) as Settled[]
    if (!claims.length) break
    scanned += claims.length
    cursor = claims[claims.length - 1].id
    const selected = claims.filter((c) => c.status === 'refunded' && c.refundError === null)
    const rowIds = Array.from(new Set(selected.map((c) => c.refundId).filter((x): x is string => !!x)))
    const rows = rowIds.length
      ? await prisma.refund.findMany({ where: { id: { in: rowIds } }, select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, reason: true } }) as Row[]
      : []
    const byId = new Map(rows.map((r) => [r.id, r] as const))
    const groups = rowIds.length
      ? await prisma.claim.groupBy({ by: ['refundId'], where: { refundId: { in: rowIds }, OR: BINDER_OR }, _count: { _all: true } })
      : []
    const binders = new Map(groups.map((g) => [g.refundId as string, g._count._all] as const))
    for (const c of selected) {
      const row = c.refundId ? byId.get(c.refundId) ?? null : null
      if (refundedRowProven(row, c.orderId)) continue
      // A-S31c (E-07): listed by listActionableRefundClaims, never here.
      if (row && row.orderId === c.orderId && row.status === 'failed' && !!row.stripeRefundId) continue
      if (c.refundId && (binders.get(c.refundId) ?? 0) >= 2) continue
      const boundRow: BoundRowFacts | null = row ? { id: row.id, orderId: row.orderId, status: row.status, stripeRefundId: row.stripeRefundId, reason: row.reason } : null
      found.push({ ...c, refund: row, reconcilable: reconcileRefusal({ ...c, boundRow }) === null })
    }
    if (claims.length < UNPROVEN_SCAN_PAGE) break
    if (scanned >= UNPROVEN_SCAN_CAP) {
      const more = await prisma.claim.findMany({ where: { status: 'refunded', refundError: null }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1, cursor: { id: cursor }, skip: 1 })
      scanTruncated = more.length > 0
      break
    }
  }
  return { items: found.slice(0, UNPROVEN_ITEMS_CAP), total: found.length, scanTruncated }
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
// ROUND 13 (B8, D11, D0 parity): ONE declaration predicate. The round-12 local copy said « closable » for a
// resume_mismatch on the claim's own row, which resolveStuckClaim refuses; the name now re-exports the rule the
// route and the list flags apply (lib/claim-action-rules isStuckResolvable, which reads the bound row).
export { declarationAccepted as isStuckResolvable }

export async function resolveStuckClaim(input: {
  claimId: string
  adminId: string
  resolution: 'settled_out_of_band' | 'closed_no_payment'
  reason?: string | null
}): Promise<ClaimActionResult> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, orderId: true, status: true, refundId: true, refundError: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  // ROUND 13 (D11 terminal exemption, E-06, slice W5 fixer): a settled claim whose bound refund Stripe reports failed or
  // canceled (REVERTED_AFTER_REFUND) is closable by declaration; every other terminal claim stays refused here.
  const settledThenReverted = claim.status === 'refunded' && typeof claim.refundError === 'string' && claim.refundError.startsWith(MARKERS.REVERTED_AFTER_REFUND)
  if (TERMINAL_STATUSES.includes(claim.status) && !settledThenReverted) {
    return { ok: false, status: 409, error: 'Cette réclamation est déjà clôturée.' }
  }
  // ROUND 13 (B8, B12): the declaration predicate reads the bound row — a resume_mismatch on the claim's OWN
  // stamped row is identity-established (reconcile, never a declaration). A failed read refuses, never guesses.
  let boundRow: BoundRowFacts | null = null
  if (claim.refundId) {
    try {
      boundRow = await prisma.refund.findUnique({ where: { id: claim.refundId }, select: { id: true, orderId: true, status: true, stripeRefundId: true, reason: true } })
    } catch {
      return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
    }
  }
  // Deliberately narrow: this is a STUCK-MONEY escape hatch, not a general reopen/close power.
  if (!declarationAccepted({ ...claim, boundRow })) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas bloquée sur un remboursement — utilisez l’arbitrage.' }
  }
  const status = input.resolution === 'settled_out_of_band' ? 'refunded' : 'refused_final'
  const done = await prisma.claim.updateMany({
    // ROUND 13 (C9 (e)): the exact pre-image read, never `refundError: { not: null }`.
    where: { id: claim.id, status: claim.status, refundError: claim.refundError },
    data:  {
      status,
      // D11 (E-06): a « paid another way » declaration on a reverted settled claim prefixes DECLARED_AFTER_REVERT and keeps
      // the reversal text (never money evidence); closed_no_payment keeps the recorded refundError as it is.
      ...(settledThenReverted && input.resolution === 'settled_out_of_band'
        ? { refundError: `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : payé autrement après l’échec chez Stripe du remboursement lié. ${claim.refundError}` }
        : {}),
      activeOrderKey:    null, // release the order: the customer is no longer locked out
      arbitratedBy:      input.adminId,
      // ROUND-10 AUDIT FIX (P3): the operator's free-text note was stored here, and arbitrationReason is
      // returned to the CUSTOMER. The note goes to the admin audit trail (resolve-stuck route) instead.
      arbitrationReason: null,
      arbitratedAt:      new Date(),
      decidedBy:         'admin',
      decidedAt:         new Date(),
    },
  })
  // D11: count 0 → nothing written, no record.
  if (done.count !== 1) return { ok: false, status: 409, error: 'Cette réclamation a changé d’état entre-temps — rien n’a été écrit. Relisez sa ligne dans la file.' }
  // H05 site 7: a declaration is a closure by this build (a claim settled, reverted then declared keeps its first record via
  // P2002). Never throws, never changes the result.
  await recordClaimClosure(claim.id)
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
export type ClaimRecoverySummary = {
  scanned: number; reconciled: number; skipped: number; details: string[]
  /** AMF-1: the bounded read-only re-verification of settled claims, run after the stranded pass. */
  settledReverify?: SettledReverifySummary
}
/** AMF-1 summary counts. Every checked claim lands in exactly one count, or only in `checked` for a lost CAS. */
export type SettledReverifySummary = { checked: number; reverted: number; standing: number; unreadable: number; unproven: number; truncated: boolean }

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
  // ROUND-9: the claim is bound to a Refund row that does not exist on its order.
  | 'bound_row_missing'
  // ROUND-9: a pending row's recorded Stripe refund is unknown to Stripe, or sits on another payment.
  | 'stripe_refund_contradiction'

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
  /** ROUND 13 (C9 (c)): REQUIRED — the pre-image the caller read. Entry only from approved or refunding;
   *  relabel only from financial_verification. Neither CAS matched → { entered: false }. */
  expect: ClaimPreImage
}): Promise<{ entered: boolean; relabelled?: boolean }> {
  if (input.expect.status === FINANCIAL_VERIFICATION) {
    // ROUND-7 AUDIT FIX (P1): a claim ALREADY parked has its ambiguity REFRESHED in place (relabel, status
    // unchanged) — now a compare-and-set on the refundError read (C9 (c)).
    const relabelled = await prisma.claim.updateMany({
      where: { id: input.claimId, status: FINANCIAL_VERIFICATION, refundError: input.expect.refundError },
      data:  {
        refundError: `${FINANCIAL_VERIFICATION}:${input.reason}: ${input.detail}`,
        ...(input.refundId ? { refundId: input.refundId } : {}),
      },
    })
    if (relabelled.count !== 1) return { entered: false }
    // I-02: a relabel with a NEW reason alerts once for that reason; the same reason sends nothing.
    const previousReason = typeof input.expect.refundError === 'string'
      ? input.expect.refundError.slice(`${FINANCIAL_VERIFICATION}:`.length).split(':')[0]
      : null
    if (previousReason !== input.reason) await alertFinancialVerification(input)
    return { entered: false, relabelled: true }
  }
  if (input.expect.status !== 'approved' && input.expect.status !== 'refunding') return { entered: false }
  const moved = await prisma.claim.updateMany({
    where: { id: input.claimId, status: input.expect.status, refundError: input.expect.refundError },
    data:  {
      status:      FINANCIAL_VERIFICATION,
      refundError: `${FINANCIAL_VERIFICATION}:${input.reason}: ${input.detail}`,
      // activeOrderKey is deliberately NOT cleared: the order stays locked against a second
      // money claim while the first transaction is unattributed (founder rule).
    },
  })
  if (moved.count !== 1) return { entered: false }
  await alertFinancialVerification(input)
  return { entered: true }
}

/** C9 (c): the pre-image a park or relabel compares against. */
export type ClaimPreImage = {
  status: string,
  refundError: string | null,
}

/** I-02 claim_financial_verification, after a won entry or a relabel with a new reason. Never throws. */
async function alertFinancialVerification(input: { claimId: string; reason: AmbiguityReason; detail: string; refundId?: string | null; stripeRefundId?: string | null }): Promise<void> {
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
  // ROUND-8 (parity): per row, the claims bound to it. The server excludes only the claim itself
  // (`id: { not: claim.id }`), so the console computes exactly that per candidate — no longer
  // "every parked claim", which could diverge from the server's verdict.
  const bindings = rows.length
    ? await prisma.claim.findMany({
        // ROUND 13 (B1): the one binder where — a resume_mismatch claim is not a binder of the row.
        where:  { refundId: { in: rows.map((r) => r.id) }, OR: BINDER_OR },
        select: { id: true, refundId: true },
      })
    : []
  const boundClaimsByRow = new Map<string, string[]>()
  for (const k of bindings) {
    const list = boundClaimsByRow.get(k.refundId as string) ?? []
    list.push(k.id)
    boundClaimsByRow.set(k.refundId as string, list)
  }
  // ROUND-6 (design graft): the Stripe-anchored exit asks the operator for a refund id they read
  // in the Dashboard; the row tells them WHICH payment to open there. An id, not money.
  const orders = orderIds.length
    ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, stripePaymentIntentId: true } })
    : []
  const piByOrder = new Map(orders.map((o) => [o.id, o.stripePaymentIntentId]))
  return triageBySafety(claims).map((c) => ({
    ...c,
    /** G1 (W3 round-1 fix): the reconcile gate's own verdict on the same facts (the where clause fixes the status). */
    reconcilable: reconcileRefusal({ ...c, status: FINANCIAL_VERIFICATION }) === null,
    /** ROUND 13 (D0 / I-09, slice W7): the arbitrate route's verdict on the same facts (never true for a parked claim). */
    approvable: approvableNow({ ...c, status: FINANCIAL_VERIFICATION }),
    /** Never states whether money moved: that is exactly what is unresolved. */
    moneyTruth: 'unresolved' as const,
    /** The PaymentIntent that paid this order, or null — the anchor the Stripe-id exit verifies against. */
    orderStripePaymentIntentId: piByOrder.get(c.orderId) ?? null,
    ambiguity:  (c.refundError ?? '').split(':')[1] ?? 'unknown',
    /** The refunds of THIS order, so an operator can attribute one without leaving the console. */
    candidateRefunds: rows.filter((r) => r.orderId === c.orderId).map((r) => {
      const boundToOther = (boundClaimsByRow.get(r.id) ?? []).find((id) => id !== c.id) ?? null
      const refusal = attributionRefusal({
        claimId: c.id,
        claimOrderId: c.orderId,
        row: { id: r.id, orderId: r.orderId, status: r.status, reason: r.reason ?? null, stripeRefundId: r.stripeRefundId ?? null },
        orderRows: rows.filter((x) => x.orderId === c.orderId),
        boundToOtherClaimId: boundToOther,
      })
      return {
        id: r.id, status: r.status, amountCents: r.amountCents,
        stripeRefundId: r.stripeRefundId, createdAt: r.createdAt,
        /** Whether this row carries ANOTHER claim's identity — shown, never hidden. */
        belongsToAnotherClaim: typeof r.reason === 'string' && r.reason.startsWith('claim:') && r.reason !== claimRefundReason(c.id),
        /** The row the engine stamped for THIS claim — the one the row path prefers. */
        belongsToThisClaim: r.reason === claimRefundReason(c.id),
        alreadyBoundToAnotherClaim: boundToOther !== null,
        /** ROUND-8 AUDIT FIX (P1, parity): the SERVER's own verdict for this row — the same rule
         *  attributeClaimRefund applies — or null. The console disables on exactly this. */
        refusal: refusal?.code ?? null,
      }
    }),
  }))
}

/** Claims whose refund attempt was interrupted before its identity was bound (T-49). */
// The grace window and the marker-age parser (RE-AUDIT FIX: once shipped inert, its regex having lost
// its backslashes; round 3: a future timestamp is unreadable, never healthy) moved to
// lib/claim-action-rules in round 11 so the reconcile GATE applies them, not only this list.
// Re-exported for existing importers.
export { RECONCILE_GRACE_MS, reconcileMarkerAge }

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
      refundError: true, createdAt: true, restaurantId: true, status: true, refundAttempted: true,
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
  // ROUND 13 (G1 / D5 / D14, W3 round-1 fix): an unreadable marker stays LISTED (fail visible) but the server
  // refuses to reconcile it. The row carries the gate's own verdict and text, so the console renders the
  // reconcile control exactly where the route admits the claim (D0) and the refusal text elsewhere.
  return triageBySafety(stranded).map((c) => {
    const refusal = reconcileRefusal(c)
    // ROUND 13 (D0 / I-09, slice W7): the approvable flag from the same pure rules as the arbitrate route.
    return { ...c, reconcilable: refusal === null, reconcileRefusal: refusal?.error ?? null, approvable: approvableNow(c) }
  })
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
  /** evidence 'stripe_read': Stripe's own refund object was read for this conclusion (G2); absent: our bound row only (F14). */
  | { ok: true; outcome: 'refunded'; refundId: string; amountCents: number; evidence?: 'stripe_read' }
  /** C1: a compare-and-set lost — the claim changed while the evidence was read. Nothing more was written.
   *  boundRowId: this action's own bind write had already matched before the loss (applyRowTruth). */
  | { ok: true; outcome: 'changed_during_read'; boundRowId?: string }
  /** G8 N8 (D4): the AWAITING proof written; rowIds are the rows the engine would finalize first. */
  | { ok: true; outcome: 'no_refund_proven_awaiting_finalization'; rowIds: string[] }
  | { ok: true; outcome: 'refund_failed'; refundId: string }
  | { ok: true; outcome: 'still_pending'; refundId: string }
  // ROUND-9 AUDIT FIX (Class 4): round 9's 'pending_unconfirmed' wrote nothing and never read Stripe,
  // so a claim could sit in it for ever. What Stripe proves about a pending row now decides; these
  // are the answers that write nothing, and each names the action that ends it.
  /** Stripe's refund list could not be read completely: nothing concluded — re-run reconcile. */
  | { ok: true; outcome: 'stripe_unreadable_retry'; refundId: string | null }
  /** Stripe holds nothing for the row, and no conclusion is possible before `until` (the engine's
   *  idempotency window plus ENGINE_DEAD_MARGIN_MS). */
  | { ok: true; outcome: 'unconfirmed_within_window'; refundId: string | null; until: string }
  /** Stripe holds nothing for the row and the engine never will: the claim is now closable. */
  | { ok: true; outcome: 'engine_row_dead'; refundId: string }
  /** payableFrom: the C4 instant of a v13 proof written by N8 (D4); absent on the round-12 ladder's legacy proof. */
  | { ok: true; outcome: 'no_refund_proven'; payableFrom?: string }
  // AUDIT FIX (round 3): the honest rail-locked reason was written into refundError, where no
  // human reads it, while the caller received the SAME outcome — so the console still told the
  // operator the claim was payable again. The two cases are now distinguishable at the boundary.
  | { ok: true; outcome: 'no_refund_proven_rail_locked' }
  | { ok: true; outcome: 'financial_verification'; reason: AmbiguityReason; detail: string }
  // ROUND 13 (G10 / D7, slice W5): R0 on a settled claim (admission iii) — read-only toward Stripe.
  /** G11 wrote the REVERTED_AFTER_REFUND marker on this claim (status unchanged, no Refund write). */
  | { ok: true; outcome: 'reverted_after_refund'; refundId: string }
  /** Stripe still reports the bound refund succeeded / pending / requires_action: nothing written (H06 / ER-C21: the
   *  Stripe status and amount of the object read in this request). */
  | { ok: true; outcome: 'refund_still_standing'; refundId: string; stripeStatus: string; amountCents: number }
  /** The bound row could not be established at Stripe (dead, or a contradiction): nothing written. */
  | { ok: true; outcome: 'refunded_row_unproven'; refundId: string; detail: string }
  | { ok: false; status: 404 | 409 | 500; error: string }

const RECONCILABLE_STATUSES = ['refunding', 'approved', FINANCIAL_VERIFICATION]

// ── ROUND-9 AUDIT FIX (Class 4) — WHAT A REFUND ROW PROVES, AND WHAT THE CLAIM BECOMES ────────────
//
// Round 9 answered "our row is pending with no Stripe id" with a no-write 'pending_unconfirmed' that
// never read Stripe — so a claim could sit there for ever, and an ORDINARY Stripe error that used to
// be closable became permanent. Four auditors found it. A pending row now gets the answer the engine
// itself relies on when it resumes (lib/refund.ts driveRefund): does Stripe hold a refund carrying
// this row's id — or, with no id recorded, this row's tag? That answer decides, and every answer ends
// in an outcome with an exit: applied, closable, "re-run once terminal", or "re-run after <date>".

type StripeRefundsCache = { piLoaded?: boolean; pi?: string | null; listLoaded?: boolean; refunds?: Stripe.Refund[] | null; overCap?: boolean }

/** Past this many pages (100 refunds each) the list is treated as unreadable — never as complete. */
const STRIPE_REFUND_PAGES_MAX = 10
/** A create the engine sent just before its idempotency window closed can reach Stripe just after it.
 *  A row is declared dead only this long AFTER the window, so an in-flight create is seen first. */
export const ENGINE_DEAD_MARGIN_MS = 60 * 60 * 1000

/** Every Stripe refund of a PaymentIntent — or null when completeness cannot be proven. overCap: the page cap was hit (G3 permanent). */
async function stripeRefundsForPaymentIntent(piId: string): Promise<{ refunds: Stripe.Refund[] | null; overCap: boolean }> {
  const all: Stripe.Refund[] = []
  let startingAfter: string | undefined
  try {
    for (let page = 0; page < STRIPE_REFUND_PAGES_MAX; page++) {
      const list = await getStripe().refunds.list({ payment_intent: piId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) })
      if (!list || !Array.isArray(list.data)) return { refunds: null, overCap: false }
      all.push(...list.data)
      if (!list.has_more) return { refunds: all, overCap: false }
      const last = list.data[list.data.length - 1]
      if (!last) return { refunds: null, overCap: false }
      startingAfter = last.id
    }
    return { refunds: null, overCap: true } // more pages than the cap: absence is not proven
  } catch {
    return { refunds: null, overCap: false }
  }
}

async function orderPaymentIntent(orderId: string, cache: StripeRefundsCache, knownPi?: string | null): Promise<string | null> {
  if (knownPi) return knownPi
  if (!cache.piLoaded) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { stripePaymentIntentId: true } })
    cache.pi = order?.stripePaymentIntentId ?? null
    cache.piLoaded = true
  }
  return cache.pi ?? null
}

async function loadOrderStripeRefunds(orderId: string, cache: StripeRefundsCache, knownPi?: string | null): Promise<Stripe.Refund[] | null> {
  if (cache.listLoaded) return cache.refunds ?? null
  const pi = await orderPaymentIntent(orderId, cache, knownPi)
  const read = pi ? await stripeRefundsForPaymentIntent(pi) : { refunds: null, overCap: false }
  cache.refunds = read.refunds
  cache.overCap = read.overCap
  cache.listLoaded = true
  return cache.refunds
}

type RowTruth =
  | { kind: 'row_terminal'; status: 'succeeded' | 'failed'; refund?: Stripe.Refund }
  | { kind: 'at_stripe'; refund: Stripe.Refund }
  /** G4: a row marked succeeded here whose Stripe refund failed or was canceled. */
  | { kind: 'reverted'; refund: Stripe.Refund }
  /** G4 (absenceIsEvidence only): the row's refund is not on this payment. */
  | { kind: 'not_on_payment'; how: 'absent' | 'other_payment'; refundId: string | null }
  | { kind: 'unreadable' }
  | { kind: 'contradiction'; detail: string; pendingAtStripe?: boolean; refund?: Stripe.Refund }
  | { kind: 'absent_within_window'; until: Date; windowEnd: Date }
  | { kind: 'absent_dead'; until: Date; windowEnd: Date }

const isMissingAtStripe = (err: unknown) => {
  const e = err as { statusCode?: number; code?: string } | null
  return e?.statusCode === 404 || e?.code === 'resource_missing'
}

/**
 * G4 refundRowTruth(row, orderId, cache, anchorPi?, opts?). Read-only toward Stripe and the base.
 * Failed row → row_terminal failed (no read). Pending row → as round 12 (recorded id, else the engine tag).
 * Succeeded row → its refund is re-read: succeeded / reverted / contradiction, and — ONLY when the caller
 * passes absenceIsEvidence (loadOrderMoneyFacts, whose Stripe list is complete) — not_on_payment.
 */
export async function refundRowTruth(
  row: { id: string; status: string; stripeRefundId: string | null; createdAt: Date },
  orderId: string,
  cache: StripeRefundsCache,
  knownPi?: string | null,
  opts?: { absenceIsEvidence?: boolean },
): Promise<RowTruth> {
  if (row.status === 'failed') return { kind: 'row_terminal', status: 'failed' }
  // A canceled row paid nothing: the reconciler's failed path is the truthful one for it.
  if (row.status === 'canceled') return { kind: 'row_terminal', status: 'failed' }
  if (row.status === 'succeeded') return succeededRowTruth(row, orderId, cache, knownPi, opts?.absenceIsEvidence === true)
  if (row.status !== 'pending') {
    return { kind: 'contradiction', detail: `La ligne de remboursement ${row.id} porte un statut inconnu (« ${row.status} »). Aucune conclusion tirée.` }
  }
  if (row.stripeRefundId) {
    // A recorded id is read BY that id — exactly as the engine's own resume does (lib/refund.ts driveRefund).
    let s: Stripe.Refund | null | undefined
    try {
      s = await getStripe().refunds.retrieve(row.stripeRefundId)
    } catch (err) {
      if (isMissingAtStripe(err)) {
        return { kind: 'contradiction', detail: `La ligne ${row.id} enregistre le remboursement Stripe ${row.stripeRefundId}, que Stripe ne connaît pas avec la clé de ce serveur. Vérifiez que cette clé est celle du compte et du mode (test / live) où il a été créé, puis relancez la réconciliation ; sinon, anomalie de données à instruire. Aucune conclusion tirée.` }
      }
      return { kind: 'unreadable' }
    }
    if (!s || typeof s !== 'object') return { kind: 'unreadable' }
    const pi = await orderPaymentIntent(orderId, cache, knownPi)
    const refundPi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null
    if (!pi || refundPi !== pi) {
      return { kind: 'contradiction', detail: `Le remboursement Stripe ${row.stripeRefundId}, enregistré sur la ligne ${row.id}, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée.` }
    }
    return { kind: 'at_stripe', refund: s }
  }
  const refunds = await loadOrderStripeRefunds(orderId, cache, knownPi)
  if (!refunds) return { kind: 'unreadable' }
  const tagged = refunds.find((s) => s.metadata?.grubano_refund_row === row.id)
  if (tagged) return { kind: 'at_stripe', refund: tagged }
  if (typeof RESUME_CREATE_WINDOW_MS !== 'number' || !Number.isFinite(RESUME_CREATE_WINDOW_MS)) return { kind: 'unreadable' }
  // Nothing at Stripe carries this row's tag. The engine re-sends the create under the row's key only
  // inside its idempotency window; past it, driveRefund refuses (ResumeIdempotencyExpired) — and
  // RESUME-FIRST picks the oldest pending row again on every later refund of the order. Dead once the
  // window AND the margin have passed.
  const windowEnd = new Date(new Date(row.createdAt).getTime() + RESUME_CREATE_WINDOW_MS)
  const until = new Date(windowEnd.getTime() + ENGINE_DEAD_MARGIN_MS)
  return until.getTime() > Date.now() ? { kind: 'absent_within_window', until, windowEnd } : { kind: 'absent_dead', until, windowEnd }
}

/** G4, succeeded row: the Stripe status of its refund decides; absence is evidence only on a complete list. */
async function succeededRowTruth(
  row: { id: string; stripeRefundId: string | null },
  orderId: string,
  cache: StripeRefundsCache,
  knownPi: string | null | undefined,
  absenceIsEvidence: boolean,
): Promise<RowTruth> {
  const byStatus = (s: Stripe.Refund): RowTruth => {
    if (s.status === 'succeeded') return { kind: 'row_terminal', status: 'succeeded', refund: s }
    if (s.status === 'failed' || s.status === 'canceled') return { kind: 'reverted', refund: s }
    if (s.status === 'pending' || s.status === 'requires_action') {
      return { kind: 'contradiction', pendingAtStripe: true, refund: s, detail: `La ligne ${row.id} est marquée ABOUTIE dans notre base, mais Stripe rapporte son remboursement ${s.id} « ${s.status} ». Aucune conclusion tirée.` }
    }
    return { kind: 'contradiction', refund: s, detail: `La ligne ${row.id} est marquée ABOUTIE dans notre base, mais Stripe rapporte son remboursement ${s.id} au statut « ${s.status} », non reconnu. Aucune conclusion tirée.` }
  }
  if (row.stripeRefundId) {
    let s: Stripe.Refund | null | undefined
    try {
      s = await getStripe().refunds.retrieve(row.stripeRefundId)
    } catch (err) {
      if (!isMissingAtStripe(err)) return { kind: 'unreadable' }
      if (absenceIsEvidence) {
        const list = await loadOrderStripeRefunds(orderId, cache, knownPi)
        if (!list) return { kind: 'unreadable' }
        if (!list.some((x) => x.id === row.stripeRefundId)) return { kind: 'not_on_payment', how: 'absent', refundId: row.stripeRefundId }
      }
      return { kind: 'contradiction', detail: `La ligne ${row.id} est marquée ABOUTIE et enregistre le remboursement Stripe ${row.stripeRefundId}, que Stripe ne connaît pas avec la clé de ce serveur. Vérifiez que cette clé est celle du compte et du mode (test / live) où il a été créé, puis relancez la réconciliation ; sinon, anomalie de données à instruire. Aucune conclusion tirée.` }
    }
    if (!s || typeof s !== 'object') return { kind: 'unreadable' }
    const pi = await orderPaymentIntent(orderId, cache, knownPi)
    if (!pi && absenceIsEvidence) return { kind: 'unreadable' }
    const refundPi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null
    if (!pi || refundPi !== pi) {
      if (absenceIsEvidence) return { kind: 'not_on_payment', how: 'other_payment', refundId: row.stripeRefundId }
      return { kind: 'contradiction', detail: `Le remboursement Stripe ${row.stripeRefundId}, enregistré comme ABOUTI sur la ligne ${row.id}, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée.` }
    }
    return byStatus(s)
  }
  const list = await loadOrderStripeRefunds(orderId, cache, knownPi)
  if (!list) return { kind: 'unreadable' }
  const tagged = list.find((x) => x.metadata?.grubano_refund_row === row.id)
  if (tagged) return byStatus(tagged)
  if (absenceIsEvidence) return { kind: 'not_on_payment', how: 'absent', refundId: null }
  return { kind: 'contradiction', detail: `La ligne ${row.id} est marquée ABOUTIE sans identifiant Stripe enregistré, et aucun remboursement de ce paiement ne porte son étiquette. Aucune conclusion tirée.` }
}

/** G8 STRIPE_REVERTED_TEXT on a non-terminal claim: our row is marked succeeded, its Stripe refund failed or was canceled. */
function stripeRevertedText(rowId: string, refundId: string, status: string, routed: boolean | null): string {
  const r = routedSentence(routed)
  return `${MARKERS.STRIPE_REVERTED} la ligne ${rowId} est marquée ABOUTIE dans notre base, mais Stripe rapporte aujourd’hui son remboursement ${refundId} « ${status} » : il ne verse rien au titre de cette ligne. Notre base la compte toujours comme remboursée ; le webhook laisse ce cas à une révision humaine, sans action automatique. ${r ? `${r} ` : ''}${CUSTOMER_VISIBILITY_SENTENCE} Cela ne dit RIEN des autres remboursements de la commande : vérifiez la commande dans Stripe avant tout paiement. Décision admin requise, aucun nouvel essai automatique.`
}

/**
 * ROUND 13 (G2 (3), G6-G8 N0-N8; D4 / D5 / D6) for every no-row pre-image the gate admits: the ONE loader T2 uses
 * (loadOrderMoneyFacts), the same pure derivation (deriveNoRowOutcome), and the N8 writer — the stamped re-query, the
 * CAS on every field read, the alert after a won CAS. A park goes through enterFinancialVerification with the read
 * pre-image (C9), which sends I-02 on entry and on a relabel with a NEW reason. A payable proof grants no authority:
 * only a gated approval pays, through T1/T2 (G14).
 */
async function reconcileNoRowByDerivation(
  claim: { id: string; orderId: string; status: string; refundId: string | null; refundAttempted: boolean; requestedAmountCents: number; refundError: string | null },
  cache: StripeRefundsCache,
): Promise<ClaimEvidenceOutcome> {
  const read = await loadOrderMoneyFacts(claim.orderId, claim.id, claim.requestedAmountCents, cache)
  const o = deriveNoRowOutcome(read, claim.id)
  if (o.kind === 'no_write') {
    if (o.outcome === 'unconfirmed_within_window') return { ok: true, outcome: 'unconfirmed_within_window', refundId: null, until: o.until.toISOString() }
    if (o.outcome === 'changed_during_read') return { ok: true, outcome: 'changed_during_read' }
    return { ok: true, outcome: 'stripe_unreadable_retry', refundId: null }
  }
  if (o.kind === 'park') {
    const parked = await enterFinancialVerification({
      claimId: claim.id, reason: o.reason, detail: o.detail,
      expect: { status: claim.status, refundError: claim.refundError },
    })
    if (!parked.entered && !parked.relabelled) return { ok: true, outcome: 'changed_during_read' }
    return { ok: true, outcome: 'financial_verification', reason: o.reason, detail: o.detail }
  }
  // G8 WRITE (1): a row carrying this claim's identity since the read — the no-row branch no longer applies (B12 on a throw).
  let stamped: { id: string } | null
  try {
    stamped = await prisma.refund.findFirst({ where: { orderId: claim.orderId, reason: claimRefundReason(claim.id) }, select: { id: true } })
  } catch {
    return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
  }
  if (stamped) return { ok: true, outcome: 'changed_during_read' }
  const text = absenceProofText(o, read, { preImage: claim.refundError, now: new Date(), requestedAmountCents: claim.requestedAmountCents })
  // (2) the compare-and-set on every field the decision read.
  const proven = await prisma.claim.updateMany({
    where: { id: claim.id, status: claim.status, refundAttempted: claim.refundAttempted, refundId: claim.refundId, refundError: claim.refundError },
    data:  { status: 'approved', refundAttempted: false, refundId: null, refundError: text },
  })
  if (proven.count !== 1) return { ok: true, outcome: 'changed_during_read' }
  // (3) ALERT-B after the won CAS, per prefix (I-01).
  const verdict = o.basis === 'verdict' ? o.verdict : null
  const locked = verdict && verdict !== 'payable' ? verdict : null
  await alertClaimPaymentBlocked(claim.id, o.prefix, {
    orderId: claim.orderId, engineCalled: false,
    refundRowIds: verdict ? verdictRowIds(verdict) : [],
    stripeRefundIds: verdict && read.readable ? verdictStripeRefundIds(verdict, read.facts.truths) : [],
    firstEngineRefusal: locked ? locked.refusal?.step ?? null : o.basis === 'no_charge' ? o.noChargeStep : null,
    holds: locked ? locked.holds.map((h) => h.hold) : [],
    routed: read.readable ? read.facts.routed : null,
    claimAfter: stateAfter('approved', false, null, text),
  })
  // (4) the outcome.
  if (o.prefix === MARKERS.PROOF_PAYABLE_V13) return { ok: true, outcome: 'no_refund_proven', payableFrom: proofInstant(text)?.toISOString() }
  if (o.prefix === MARKERS.AWAITING_FINALIZATION) {
    return { ok: true, outcome: 'no_refund_proven_awaiting_finalization', rowIds: locked?.refusal?.step === 'E3' ? locked.refusal.oldestRowIds : [] }
  }
  return { ok: true, outcome: 'no_refund_proven_rail_locked' }
}

const STANDING_STRIPE_STATUSES = ['succeeded', 'pending', 'requires_action']
/** G3 step 7: a binder as the pure derivation reads it. */
const BINDER_SELECT = {
  id:          true,
  status:      true,
  refundId:    true,
  refundError: true,
} as const

/**
 * G3 loadOrderMoneyFacts(orderId, claimId, requestedCents, cache): THE read-only loader of the facts the
 * pure derivation (deriveNoRowOutcome) reads — used by T2 before any money authority and by reconcile.
 * It never throws and never writes: any throw → { readable: false, permanent: null } (B12).
 */
export async function loadOrderMoneyFacts(orderId: string, claimId: string, requestedCents: number, cache: StripeRefundsCache = {}): Promise<OrderMoneyRead> {
  try {
    // 1. the order
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true, stripePaymentIntentId: true } })
    if (!order) return { readable: false, permanent: null }
    // 2. the rows (G2 select)
    const dbRows = await prisma.refund.findMany({
      where:   { orderId },
      select:  { id: true, status: true, amountCents: true, stripeRefundId: true, reason: true, idempotencyKey: true, createdAt: true, royaltyRefundCents: true },
      orderBy: { createdAt: 'asc' },
    })
    const rows: MoneyRow[] = dbRows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }))
    // 3. the royalty status
    const royalty = await prisma.franchiseRoyalty.findFirst({ where: { orderId }, select: { status: true } })
    const pi = order.stripePaymentIntentId
    if (!pi) return { readable: false, permanent: 'no_charge', rows, paymentStatus: order.paymentStatus ?? '', piStatus: '', hasPaymentIntent: false }
    cache.pi = pi
    cache.piLoaded = true
    // 4. the charge state
    let intent: Stripe.PaymentIntent
    try {
      intent = await getStripe().paymentIntents.retrieve(pi, { expand: ['latest_charge'] })
    } catch {
      return { readable: false, permanent: null }
    }
    if (!intent || typeof intent !== 'object') return { readable: false, permanent: null }
    const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    if (!charge) return { readable: false, permanent: 'no_charge', rows, paymentStatus: order.paymentStatus ?? '', piStatus: String(intent.status ?? ''), hasPaymentIntent: true }
    const refundedCents = charge.amount_refunded ?? 0
    // 5. the complete refund list
    const list = await loadOrderStripeRefunds(orderId, cache, pi)
    if (!list) return cache.overCap ? { readable: false, permanent: 'list_over_cap', refundedCents } : { readable: false, permanent: null, refundedCents }
    // 6. the truth of every pending and succeeded row, absence being evidence here only
    const truths: Record<string, PendingRowTruth> = {}
    const succeededNotCounted: SucceededNotCounted[] = []
    const rowContradictions: RowContradiction[] = []
    for (const row of rows) {
      if (row.status !== 'pending' && row.status !== 'succeeded') continue
      const t = await refundRowTruth(row, orderId, cache, pi, { absenceIsEvidence: true })
      if (t.kind === 'unreadable') return { readable: false, permanent: null, refundedCents }
      if (row.status === 'pending') {
        if (t.kind === 'at_stripe') truths[row.id] = { kind: 'at_stripe', refundId: t.refund.id, status: String(t.refund.status ?? '') }
        else if (t.kind === 'absent_within_window') truths[row.id] = { kind: 'absent_within_window', until: t.until }
        else if (t.kind === 'absent_dead') truths[row.id] = { kind: 'absent_dead' }
        else if (t.kind === 'contradiction') {
          truths[row.id] = { kind: 'contradiction', detail: t.detail }
          rowContradictions.push({ rowId: row.id, rowStatus: 'pending', detail: t.detail })
        }
        continue
      }
      if (t.kind === 'reverted') succeededNotCounted.push({ rowId: row.id, how: 'reverted', refundId: t.refund.id, stripeStatus: t.refund.status ?? null })
      else if (t.kind === 'not_on_payment') succeededNotCounted.push({ rowId: row.id, how: t.how, refundId: t.refundId })
      else if (t.kind === 'contradiction' && t.pendingAtStripe) {
        succeededNotCounted.push({ rowId: row.id, how: 'pending_at_stripe', refundId: t.refund?.id ?? row.stripeRefundId, stripeStatus: t.refund?.status ?? null })
      } else if (t.kind === 'contradiction') rowContradictions.push({ rowId: row.id, rowStatus: 'succeeded', detail: t.detail })
    }
    // 7. owners, binders and the stamped claims of every standing refund
    const L: StripeRefundFact[] = list.map((s) => ({
      id:       s.id,
      status:   String(s.status ?? ''),
      amount:   s.amount,
      charge:   typeof s.charge === 'string' ? s.charge : s.charge?.id ?? null,
      metadata: { grubano_refund_row: s.metadata?.grubano_refund_row ?? null },
    }))
    const binders: Record<string, BinderFact[]> = {}
    const stampedClaims: Record<string, { status: string; refundId: string | null } | null> = {}
    for (const s of L) {
      if (!STANDING_STRIPE_STATUSES.includes(s.status)) continue
      const owners = ownersOf(s, rows)
      if (owners.length !== 1) continue
      const owner = owners[0]
      if (!(owner.id in binders)) {
        binders[owner.id] = await prisma.claim.findMany({ where: boundToWhere(owner.id, claimId), select: BINDER_SELECT })
      }
      const y = stampedClaimId(owner.reason)
      if (y && y !== claimId && !binders[owner.id].some((b) => b.id === y) && !(y in stampedClaims)) {
        stampedClaims[y] = await prisma.claim.findUnique({ where: { id: y }, select: { status: true, refundId: true } })
      }
    }
    return {
      readable: true,
      facts: {
        orderId,
        requestedAmountCents: requestedCents,
        orderPaymentStatus:   order.paymentStatus ?? '',
        hasPaymentIntent:     true,
        piStatus:             String(intent.status ?? ''),
        chargeId:             charge.id,
        chargeAmountCents:    charge.amount,
        amountCapturedCents:  charge.amount_captured ?? charge.amount,
        chargeDisputed:       charge.disputed === true,
        amountRefundedCents:  refundedCents,
        routed:               !!intent.transfer_data,
        royaltyStatus:        royalty?.status ?? null,
        stripeListLength:     L.length,
        rows, L, truths, binders, stampedClaims, succeededNotCounted, rowContradictions,
      },
    }
  } catch (e) {
    console.warn('[claims] order money facts unreadable (nothing concluded) —', e instanceof Error ? e.message : e)
    return { readable: false, permanent: null }
  }
}
/**
 * H05: this build's closure record — the only closure-notice eligibility source (AMF-2). Called only after a
 * closure compare-and-set matched 1 row, outside any transaction. It never throws and never changes the caller's
 * result. The seven H05 sites (W6): (1) triggerClaimRefund T4 'ours' → refunded; (2) reconcileClaimForRefund's refunded
 * CAS, with noNoticeSource unless the caller records it (ER-R29); (3) applyRowTruth row_terminal / at_stripe succeeded;
 * (4) attributeWithEvidence after an observed commit; (5) its C7 re-read branch; (6) arbitrateClaim refuse_final;
 * (7) resolveStuckClaim, every declaration. Nothing else writes, sends or deletes this trigger.
 */
async function recordClaimClosure(claimId: string, opts?: { noNoticeSource?: true }): Promise<boolean> {
  let ok = false
  try { await prisma.emailDispatch.create({ data: { trigger: CLOSURE_RECORD_TRIGGER, dedupeKey: closureRecordKey(claimId) } }); ok = true }
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ok = true
    else console.error('[EMAIL MISS] [claim_closure_record] claim ' + claimId + ' — record NOT written: no closure notice can be sent for it')
  }
  // ROUND 13 (slice W8, H05 site 2 / ER-R29): the line names every path that reaches it — the webhook, the recovery sweep,
  // or a reconciliation run for ANOTHER claim bound to the same row (applyRowTruth's closureRecordedFor is per claim; that
  // other claim is parked, not settled).
  if (ok && opts?.noNoticeSource) console.error('[EMAIL MISS] [claim_decision_refunded] claim ' + claimId + ' settled on its refund row by a path that sends no customer notice (the Stripe webhook, the recovery sweep, or a reconciliation run for another claim bound to the same row) — it appears in « Avis client non envoyés » while no refunded notice is recorded')
  return ok
}

/** Applies what a row proves to the claim. Every branch ends in an outcome with an exit. */
async function applyRowTruth(
  // ROUND 13 (C9 (a)): the pre-image the decision read — every write below is a CAS on it.
  claim: { id: string; orderId?: string; status: string; refundId: string | null; refundError: string | null; refundAttempted?: boolean },
  row: { id: string; amountCents: number; stripeRefundId: string | null },
  truth: RowTruth,
  relation: 'stamped' | 'bound',
): Promise<ClaimEvidenceOutcome> {
  // C1: every lost compare-and-set answers changed_during_read; boundRowId says this action's bind had matched first.
  const changed = (boundRowId?: string): ClaimEvidenceOutcome =>
    (boundRowId ? { ok: true, outcome: 'changed_during_read', boundRowId } : { ok: true, outcome: 'changed_during_read' })
  const which = relation === 'stamped' ? "porte bien l'identité de cette réclamation" : 'est liée à cette réclamation'
  const preImage = {
    id: claim.id, status: claim.status, refundId: claim.refundId,
    refundError: claim.refundError,
  }
  // not_on_payment is a loader-only kind (absenceIsEvidence): never produced on this path.
  if (truth.kind === 'not_on_payment') return { ok: true, outcome: 'stripe_unreadable_retry', refundId: row.id }

  // G2 / B9 (b): before ANY write that settles (row_terminal succeeded, at_stripe succeeded), a row that another
  // claim also binds never settles this claim without a human decision. A failed read refuses (B12).
  const settles = (truth.kind === 'row_terminal' && truth.status === 'succeeded') || (truth.kind === 'at_stripe' && truth.refund.status === 'succeeded')
  if (settles) {
    let others: number
    try {
      others = await prisma.claim.count({ where: boundToWhere(row.id, claim.id) })
    } catch {
      return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
    }
    if (others > 0) {
      const detail = `La ligne ${row.id} est liée à au moins une autre réclamation : cette réclamation ne peut pas être soldée sur elle sans décision humaine. Aucune conclusion tirée.`
      const parked = await enterFinancialVerification({
        claimId: claim.id, reason: 'reconcile_not_applied', detail, refundId: row.id, stripeRefundId: row.stripeRefundId,
        expect: { status: claim.status, refundError: claim.refundError },
      })
      if (!parked.entered && !parked.relabelled) return changed()
      return { ok: true, outcome: 'financial_verification', reason: 'reconcile_not_applied', detail }
    }
  }

  if (truth.kind === 'reverted') {
    // G2: our row is marked succeeded, and Stripe reports its refund failed or canceled — it pays nothing for
    // this row. The claim is marked (never settled on it); the Refund row is not touched.
    const s = truth.refund
    const text = stripeRevertedText(row.id, s.id, String(s.status ?? ''), null)
    const done = await prisma.claim.updateMany({
      where: preImage,
      data:  { status: 'approved', refundId: row.id, refundError: text },
    })
    if (done.count !== 1) return changed()
    await alertClaimPaymentBlocked(claim.id, 'stripe_reverted', {
      orderId: claim.orderId ?? null, refundRowIds: [row.id], stripeRefundIds: [s.id], engineCalled: false, routed: null,
      // I-01 facts hygiene (W3 round-1 fix): the pre-image may carry refundAttempted false (a v13 or lock proof with a late own row).
      claimAfter: stateAfter('approved', claim.refundAttempted ?? true, row.id, text),
    })
    return { ok: true, outcome: 'refund_failed', refundId: row.id }
  }

  if (truth.kind === 'row_terminal') {
    // Bind the identity the crash prevented from being written — a BINDING, not a payment — then reuse
    // the already-audited reconciler: same CAS, same guards, no new money code.
    const bindStatus = claim.status === FINANCIAL_VERIFICATION ? 'refunding' : claim.status
    const bound = await prisma.claim.updateMany({
      where: preImage,
      data:  { refundId: row.id, ...(claim.status === FINANCIAL_VERIFICATION ? { status: 'refunding' } : {}) },
    })
    if (bound.count !== 1) return changed()
    const applied = await reconcileClaimForRefund({ refundRowId: row.id, status: truth.status, stripeRefundId: row.stripeRefundId, closureRecordedFor: claim.id })
    // A legacy row bound to several claims: the reconciler may have applied it to ANOTHER claim — never reported as this one's.
    if (!applied.reconciled || applied.claimId !== claim.id) {
      const detail = applied.reconciled
        ? `La réconciliation de la ligne Refund ${row.id} a été appliquée à une autre réclamation liée à cette ligne (${applied.claimId}) : cette réclamation-ci n'a pas été soldée sur elle. L'état de la réclamation n'est pas établi.`
        : `La ligne Refund ${row.id} ${which} et est ${truth.status}, mais la réconciliation n'a pas pu être appliquée (${applied.reason}). L'état de la réclamation n'est pas établi.`
      // C9 (a): the park after the bind expects the POST-bind values.
      const parked = await enterFinancialVerification({
        claimId: claim.id, reason: 'reconcile_not_applied', detail, refundId: row.id, stripeRefundId: row.stripeRefundId,
        expect: { status: bindStatus, refundError: claim.refundError },
      })
      if (!parked.entered && !parked.relabelled) return changed(row.id)
      return { ok: true, outcome: 'financial_verification', reason: 'reconcile_not_applied', detail }
    }
    if (truth.status !== 'succeeded') {
      // G2 / I-01: ALERT-B after the stripe_failed write reconcileClaimForRefund won for THIS claim.
      await alertClaimPaymentBlocked(claim.id, 'stripe_failed', {
        orderId: claim.orderId ?? null, refundRowIds: [row.id], stripeRefundIds: [row.stripeRefundId], engineCalled: false, routed: null,
        claimAfter: stateAfter('approved', claim.refundAttempted ?? true, row.id, 'stripe_failed:'),
      })
      return { ok: true, outcome: 'refund_failed', refundId: row.id }
    }
    // G2 / H05 site 3: reconcileClaimForRefund's refunded CAS won for THIS claim — this build's closure record follows it.
    await recordClaimClosure(claim.id)
    // G2 / F14: 'stripe_read' only when Stripe's refund object was read for this conclusion.
    return truth.refund
      ? { ok: true, outcome: 'refunded', refundId: row.id, amountCents: truth.refund.amount, evidence: 'stripe_read' }
      : { ok: true, outcome: 'refunded', refundId: row.id, amountCents: row.amountCents }
  }

  if (truth.kind === 'at_stripe') {
    const s = truth.refund
    if (s.status === 'succeeded') {
      // Stripe settled the refund carrying this row's id or tag. It is applied to the CLAIM from
      // Stripe's own object: the engine row may lag (a lost response, or a clawback failure after
      // success), and the engine's next re-drive adopts this same refund — it never creates a second.
      const done = await prisma.claim.updateMany({
        where: preImage,
        data:  { status: 'refunded', refundId: row.id, refundError: null, activeOrderKey: null, decidedAt: new Date() },
      })
      if (done.count !== 1) return changed()
      // G2 / H05 site 3: this build's closure record, only after the won refunded CAS, outside any transaction.
      await recordClaimClosure(claim.id)
      // ROUND-10 AUDIT FIX (P2 ×2): our row stays 'pending' — reconciliation does not do the engine's
      // row-side work (ledger, royalty clawback). Say so now (best effort) and durably: the row is
      // listed, ungated, by listUnfinalizedClaimRefundRows.
      try {
        await sendAdminMoneyReviewAlert({
          kind:      'claim_refunded_row_unfinalized',
          dedupeKey: `claim_row_unfinalized:${row.id}`,
          title:     `Réclamation ${claim.id} soldée d’après Stripe — ligne de remboursement ${row.id} encore en attente`,
          facts:     {
            claimId: claim.id, refundRowId: row.id, stripeRefundId: s.id, stripeStatus: s.status ?? null, amountCents: s.amount,
            action:  'La ligne reste « en attente » dans notre base : cette réconciliation n’a appliqué ni ligne de ledger ni reprise de royalty (si elles sont dues). Aucune action automatique n’a été prise.',
          },
        })
      } catch { /* best effort — the ungated list is the durable signal */ }
      return { ok: true, outcome: 'refunded', refundId: row.id, amountCents: s.amount, evidence: 'stripe_read' }
    }
    if (s.status === 'failed' || s.status === 'canceled') {
      const failedText = `stripe_failed: le remboursement Stripe ${s.id} de la ligne ${row.id} a ÉCHOUÉ — cette ligne n’a donc rien versé. Cela ne dit RIEN des autres remboursements de la commande : vérifiez la commande dans Stripe avant tout paiement. Décision admin requise, aucun nouvel essai automatique.`
      const done = await prisma.claim.updateMany({
        where: preImage,
        data:  {
          status:      'approved',
          refundId:    row.id,
          refundError: failedText,
        },
      })
      if (done.count !== 1) return changed()
      // G2 / I-01: ALERT-B after the stripe_failed write, never on a lost CAS.
      await alertClaimPaymentBlocked(claim.id, 'stripe_failed', {
        orderId: claim.orderId ?? null, refundRowIds: [row.id], stripeRefundIds: [s.id], engineCalled: false, routed: null,
        claimAfter: stateAfter('approved', claim.refundAttempted ?? true, row.id, failedText),
      })
      return { ok: true, outcome: 'refund_failed', refundId: row.id }
    }
    // Still pending at Stripe: bind and clear the crash marker — the identity is now known. A bound
    // claim stays reconcilable, so re-running reconcile once the refund is terminal applies it.
    const pendingBound = await prisma.claim.updateMany({
      where: preImage,
      data:  { refundId: row.id, status: 'refunding', refundError: null },
    })
    if (pendingBound.count !== 1) return changed()
    return { ok: true, outcome: 'still_pending', refundId: row.id }
  }

  if (truth.kind === 'unreadable') return { ok: true, outcome: 'stripe_unreadable_retry', refundId: row.id }
  if (truth.kind === 'contradiction') {
    // What Stripe says contradicts what the row records. Retrying would loop for ever; guessing would
    // break the founder's rule. Parked, visible, with the one thing to check.
    const parked = await enterFinancialVerification({
      claimId: claim.id, reason: 'stripe_refund_contradiction', detail: truth.detail, refundId: row.id, stripeRefundId: row.stripeRefundId,
      expect: { status: claim.status, refundError: claim.refundError },
    })
    if (!parked.entered && !parked.relabelled) return changed()
    return { ok: true, outcome: 'financial_verification', reason: 'stripe_refund_contradiction', detail: truth.detail }
  }
  if (truth.kind === 'absent_within_window') {
    return { ok: true, outcome: 'unconfirmed_within_window', refundId: row.id, until: truth.until.toISOString() }
  }

  // absent_dead — Stripe holds nothing for this row and the engine will never create it.
  const deadText = `${ENGINE_ROW_DEAD}: Stripe ne connaît aucun remboursement portant la ligne ${row.id}, et le moteur ne la créera plus : sa fenêtre d’idempotence a expiré le ${truth.windowEnd.toISOString()} (conclusion tirée après une marge d’une heure). Cette ligne n’a donc rien versé. Tant qu’elle reste en attente, le moteur refusera les remboursements de cette commande ; aucun code de l’application ne la retire, et aucune procédure documentée ne lève ce refus. Rien ne sera payé par l’application pour cette réclamation : clôturez le dossier (« Clôturer ce dossier… »).`
  const done = await prisma.claim.updateMany({
    where: preImage,
    data:  {
      status:      'approved',
      refundId:    row.id,
      refundError: deadText,
    },
  })
  if (done.count !== 1) return changed()
  // G2 / I-01: ALERT-B after the engine_row_dead write, never on a lost CAS.
  await alertClaimPaymentBlocked(claim.id, 'engine_row_dead', {
    orderId: claim.orderId ?? null, refundRowIds: [row.id], engineCalled: false, routed: null,
    claimAfter: stateAfter('approved', claim.refundAttempted ?? true, row.id, deadText),
  })
  return { ok: true, outcome: 'engine_row_dead', refundId: row.id }
}

/** A claim bound to a refund row with no recorded error: reconcile applies THAT row's truth. */
async function reconcileBoundClaim(
  claim: { id: string; orderId: string; status: string; refundId: string; refundError: string | null },
  cache: StripeRefundsCache,
  /** The gate's own read of this row (reconcileClaimEvidence), so the row is read once per request. */
  preRead?: { id: string; orderId: string; status: string; amountCents: number; stripeRefundId: string | null; createdAt: Date } | null,
): Promise<ClaimEvidenceOutcome> {
  const row = preRead !== undefined ? preRead : await prisma.refund.findUnique({
    where:  { id: claim.refundId },
    select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true },
  })
  if (!row || row.orderId !== claim.orderId) {
    const detail = `La réclamation est liée à la ligne de remboursement ${claim.refundId}, introuvable sur cette commande. L'état de la réclamation n'est pas établi.`
    const parked = await enterFinancialVerification({
      claimId: claim.id, reason: 'bound_row_missing', detail,
      expect: { status: claim.status, refundError: claim.refundError },
    })
    if (!parked.entered && !parked.relabelled) return { ok: true, outcome: 'changed_during_read' }
    return { ok: true, outcome: 'financial_verification', reason: 'bound_row_missing', detail }
  }
  // ROUND 13 (G4 / G11, slice W5): the temporary boundPathRowTruth is deleted — a SUCCEEDED bound row is re-read at
  // Stripe like every other row (a reversal marks the claim STRIPE_REVERTED, a settlement carries 'stripe_read').
  return applyRowTruth(claim, row, await refundRowTruth(row, claim.orderId, cache), 'bound')
}

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
 * then reads Stripe's evidence for that row (round 13, G12) and binds it only when Stripe reports that refund succeeded
 * on this order's payment; the row's own status is never the proof. The operator cannot state an
 * outcome, cannot state an amount, and cannot create money:
 *   • the refund row must already exist AND belong to the SAME order — a row from another order
 *     is refused outright, so a claim can never be settled by an unrelated payment;
 *   • the outcome comes from Stripe's evidence for the row, read by this request, never from the human;
 *   • no engine call, no Stripe write, no retry.
 */
// ROUND 13 (G12, C6, C7, D8 — slice W4): the operator names the LINK; Stripe's evidence for that row is read BEFORE
// any write, and the binding is ONE Serializable transaction holding the binder read and the FV → refunded CAS. The
// only success is a commit this request observed: a commit reported lost (C7) is a 409 that states what a re-read
// shows. There is no 'refund_failed', 'still_pending' or park outcome any more — the round-11 bind-first write, the
// reconcileBoundClaim call and the failed-row branch are deleted (G12, B5).
export type ClaimAttributionOutcome =
  | {
      ok: true
      /** 'preview' only for dryRun (D8 (6)): Stripe proved the row, nothing was written. */
      outcome: 'refunded' | 'preview'
      refundId: string
      /** The row status read before the write — the G12 success copy depends on it. */
      rowStatusBefore: 'succeeded' | 'pending'
      evidence: 'stripe_read'
      /** The amount of the Stripe refund object that proved the row (never the row's own amount). */
      amountCents: number
    }
  | { ok: false; status: 400 | 404 | 409; error: string }

/** The Refund row an attribution binds, as read by the caller. */
export type AttributionRow = {
  id: string
  orderId: string
  status: string
  amountCents: number
  stripeRefundId: string | null
  reason: string | null
  createdAt: Date
}
/** Why an attribution wrote nothing, for the adoption caller (B11 (c)) — never shown as such. */
export type AttributionCause = 'not_found' | 'changed' | 'refused' | 'not_proven' | 'identity_unread' | 'already_bound' | 'unestablished' | 'not_written'
export type AttributionResult =
  | { out: Extract<ClaimAttributionOutcome, { ok: true }>; refund: Stripe.Refund; cause: null }
  | {
      out: Extract<ClaimAttributionOutcome, { ok: false }>
      refund: null
      cause: AttributionCause
      /** C7: after a transaction error, the claim was read back bound to this row (a commit reported lost). */
      alreadyBound?: { status: string; recorded: boolean }
      /** B11 (a), W4 fixer: the Stripe refund object this request read for the row, when one was read (G12). A refusal
       *  shows these facts, never our own row's. Absent when the refusal came before any Stripe read. */
      stripeRead?: Stripe.Refund
    }
/** A Prisma client for the binding (the C10 rehearsal passes one per connection; the app uses the singleton). */
export type AttributionClient = Pick<typeof prisma, '$transaction' | 'claim' | 'refund'>

/** C6: the aborts thrown inside the binding transaction — a full rollback, never a partial write. */
class AttributionAbort extends Error {
  constructor(readonly code: 'bound_to_other_claim' | 'claim_changed', readonly otherClaimId: string | null = null) {
    super(`attribution aborted: ${code}`)
    this.name = 'AttributionAbort'
  }
}
/** C8: the abort thrown inside the adoption mirror transaction. */
class AdoptionAbort extends Error {
  constructor(readonly code: 'stamped_exists') {
    super(`adoption aborted: ${code}`)
    this.name = 'AdoptionAbort'
  }
}
/** C7: a re-read after a transaction error failed — nothing about the claim is established. */
const BINDING_UNESTABLISHED = 'État non établi : la base n’a pas pu confirmer ce qui a été écrit. Relisez la ligne de cette réclamation dans la file avant toute autre action.'
// C7, IMPLEMENTATION NOTE (W4, fixer round 1): a transaction error followed by a re-read that shows the claim NOT bound to
// this row establishes « rien n’a été écrit », not that anything changed — the deadlock may come from the binding of a
// different row (the binder read share-locks every claim row), or the error may precede the transaction itself.
const ATTRIBUTION_NOT_WRITTEN = 'La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez.'
/** C7 (W4 fixer): the tail when recordClaimClosure returned true — the record exists; no console section is named. */
const CLOSURE_RECORDED_TAIL = 'sa clôture est enregistrée.'

/** G12 NOT PROVEN: the 409 text of every Stripe reading that does not prove the row's refund SUCCEEDED. */
function attributionNotProvenText(rowId: string, t: RowTruth): string {
  const kept = 'La réclamation n’a pas été modifiée.'
  if (t.kind === 'at_stripe') {
    const s = t.refund
    const st = String(s.status ?? '')
    if (st === 'pending' || st === 'requires_action') {
      return `Stripe rapporte le remboursement ${s.id} de la ligne ${rowId} EN ATTENTE : rien n’est prouvé, la réclamation n’a pas été modifiée. Réessayez lorsqu’il sera terminal.`
    }
    if (st === 'failed' || st === 'canceled') {
      return `Stripe rapporte le remboursement ${s.id} de la ligne ${rowId} « ${st} » : cette ligne ne verse rien et ne peut solder aucune réclamation. ${kept} « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande.`
    }
    return `Stripe rapporte le remboursement ${s.id} de la ligne ${rowId} au statut « ${st} », non reconnu : rien n’est prouvé. ${kept}`
  }
  if (t.kind === 'reverted') {
    return `La ligne ${rowId} est marquée ABOUTIE ici, mais Stripe rapporte aujourd’hui son remboursement ${t.refund.id} « ${String(t.refund.status ?? '')} » : il ne solde rien. ${kept}`
  }
  if (t.kind === 'contradiction') return `${t.detail} ${kept}`
  if (t.kind === 'absent_within_window') {
    return `Stripe ne connaît pas encore de remboursement pour la ligne ${rowId}. ${kept} Conclusion possible à partir du ${t.until.toISOString()} (UTC).`
  }
  if (t.kind === 'absent_dead') {
    return `Stripe ne connaît aucun remboursement pour la ligne ${rowId}, et le moteur ne la créera plus (fenêtre d’idempotence expirée le ${t.windowEnd.toISOString()}) : elle ne verse rien et ne peut solder aucune réclamation. ${kept}`
  }
  // unreadable — and any reading this path cannot produce (fail closed: nothing is concluded).
  return `Stripe n’a pas pu être lu pour la ligne ${rowId} : rien n’est conclu, la réclamation n’a pas été modifiée. Réessayez.`
}

/**
 * G12 (4)-(5): the Stripe evidence for the row, read before any write. Without a supplied refund: refundRowTruth on
 * the row it binds (G4, never absence as evidence). With a supplied refund (adoption B11 (c), read and anchored by
 * the caller in the same request; the C10 rehearsal injects it): that object, and only if it is the row's own.
 * IMPLEMENTATION NOTE (W4, fixer round 1): a supplied refund is used only for a SUCCEEDED row (the adoption mirror,
 * whose caller anchored it to the order's PaymentIntent and charge). A pending row always reads refundRowTruth, which
 * anchors the PaymentIntent itself — a supplied object is never at_stripe evidence on an id or tag match alone.
 * PROVEN = (row pending && at_stripe succeeded) || (row succeeded && row_terminal succeeded).
 * A reading that does not prove carries the Stripe refund object it read, when there is one (the refusal's facts).
 */
async function attributionEvidence(
  row: AttributionRow,
  orderId: string,
  supplied: Stripe.Refund | undefined,
): Promise<{ proven: true; refund: Stripe.Refund } | { proven: false; text: string; refund: Stripe.Refund | null }> {
  let t: RowTruth
  if (supplied && row.status === 'succeeded') {
    const owns = (!!row.stripeRefundId && supplied.id === row.stripeRefundId) || supplied.metadata?.grubano_refund_row === row.id
    const st = String(supplied.status ?? '')
    if (!owns) t = { kind: 'contradiction', detail: `Le remboursement Stripe ${supplied.id} n’est pas celui que la ligne ${row.id} enregistre. Aucune conclusion tirée.` }
    else if (st === 'succeeded') t = { kind: 'row_terminal', status: 'succeeded', refund: supplied }
    else if (st === 'failed' || st === 'canceled') t = { kind: 'reverted', refund: supplied }
    else t = { kind: 'contradiction', detail: `La ligne ${row.id} est marquée ABOUTIE dans notre base, mais Stripe rapporte son remboursement ${supplied.id} « ${st} ». Aucune conclusion tirée.` }
  } else {
    try {
      t = await refundRowTruth(row, orderId, {})
    } catch {
      t = { kind: 'unreadable' }
    }
  }
  if (row.status === 'pending' && t.kind === 'at_stripe' && t.refund.status === 'succeeded') return { proven: true, refund: t.refund }
  if (row.status === 'succeeded' && t.kind === 'row_terminal' && t.status === 'succeeded' && t.refund) return { proven: true, refund: t.refund }
  const read = t.kind === 'at_stripe' || t.kind === 'reverted' ? t.refund
    : (t.kind === 'row_terminal' || t.kind === 'contradiction') && t.refund ? t.refund : null
  return { proven: false, text: attributionNotProvenText(row.id, t), refund: read }
}

/** C7: a transaction error that is not a C6 abort. Report only what a re-read of the claim shows. */
async function bindingNotObserved(db: AttributionClient, claimId: string, rowId: string, e: unknown, read: Stripe.Refund): Promise<AttributionResult> {
  const fail = (error: string, cause: AttributionCause): AttributionResult => ({ out: { ok: false, status: 409, error }, refund: null, cause, stripeRead: read })
  if (e instanceof AttributionAbort) {
    return e.code === 'bound_to_other_claim'
      ? fail(`Ce remboursement est déjà lié à la réclamation ${e.otherClaimId} — une même somme ne peut pas solder deux réclamations.`, 'changed')
      : fail('Cette réclamation a changé d’état entre-temps — elle n’a pas été modifiée. Relisez sa ligne dans la file.', 'changed')
  }
  // P2034 (a deadlock, 1213), P2028 (a lock wait past the timeout), 1020 / ER_CHECKREAD, a connection lost during
  // COMMIT, or anything else: nothing is proven written.
  const code = (e as { code?: unknown } | null)?.code
  console.warn('[claims] binding transaction aborted', typeof code === 'string' || typeof code === 'number' ? code : e instanceof Error ? e.name : 'unknown')
  let now: { status: string; refundId: string | null; refundError: string | null } | null
  try {
    now = await db.claim.findUnique({ where: { id: claimId }, select: { status: true, refundId: true, refundError: true } })
  } catch {
    return fail(BINDING_UNESTABLISHED, 'unestablished')
  }
  if (now && (now.status === 'refunded' || now.status === 'refused_final') && now.refundId === rowId) {
    // H05 site 5: the claim was FV at this request's read, and only C6 or a later write of this build binds it to this
    // row — this closure is by this build. No notice, no audit, no success from this branch.
    // IMPLEMENTATION NOTE (W4, fixer round 1): the record-written tail names no console section — the missing-notice
    // section of H10 has not landed, so the sentence says only what the record establishes.
    const recorded = await recordClaimClosure(claimId)
    const tail = recorded
      ? CLOSURE_RECORDED_TAIL
      : 'l’enregistrement de sa clôture a échoué : aucun avis client ne pourra lui être envoyé.'
    return {
      ...fail(`Cette réclamation est déjà liée à ce remboursement (statut actuel : « ${now.status} »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; ${tail} Relisez sa ligne dans la file.`, 'already_bound'),
      alreadyBound: { status: now.status, recorded },
    } as AttributionResult
  }
  // True: a committed C6 write can only have become refunded or refused_final with the same refundId since.
  return fail(ATTRIBUTION_NOT_WRITTEN, 'not_written')
}

/**
 * C6 attributeWithEvidence(claim, row, stripeRefund?): the one function that CREATES a settling binding of an
 * unstamped row (binding rule 5 (b)). Before the transaction: the claim as read (the CAS pre-image), the B10 refusals
 * with the one binder where (B1), the Stripe evidence (G12). The transaction holds only the binder read and the CAS.
 * After an observed commit only: the closure record (H05), I-04 for a pending row, the audit. No engine, no Stripe
 * write, no Refund write.
 */
export async function attributeWithEvidence(
  claimRef: { id: string },
  row: AttributionRow,
  stripeRefund: Stripe.Refund | undefined,
  opts: { adminId: string; note?: string | null; dryRun?: boolean; client?: AttributionClient },
): Promise<AttributionResult> {
  const db: AttributionClient = opts.client ?? prisma
  const fail = (status: 400 | 404 | 409, error: string, cause: AttributionCause): AttributionResult => ({ out: { ok: false, status, error }, refund: null, cause })
  // D8 (1): the claim as this decision reads it.
  const claim = await db.claim.findUnique({
    where:  { id: claimRef.id },
    select: { id: true, orderId: true, status: true, refundError: true },
  })
  if (!claim) return fail(404, 'Réclamation introuvable.', 'not_found')
  if (claim.status !== FINANCIAL_VERIFICATION) {
    return fail(409, 'Cette réclamation n’est pas en vérification financière — utilisez la réconciliation par preuve.', 'changed')
  }
  // D8 (2)-(3), B10: THE anchor (a refund of the claim's OWN order) is the first refusal of the shared rule the
  // console also applies (lib/claim-attribution-rules). ROUND 13 (B1, B12): the binder read uses the one binder
  // where, and a failed identity read is never a negative identity — it refuses before any Stripe read or write.
  let orderRows: Array<{ id: string; reason: string | null }>
  let boundTo: { id: string } | null
  try {
    orderRows = await db.refund.findMany({
      where:  { orderId: claim.orderId },
      select: { id: true, reason: true },
    })
    boundTo = await db.claim.findFirst({
      where:  boundToWhere(row.id, claim.id),
      select: { id: true },
    })
  } catch {
    return fail(409, IDENTITY_READ_FAILED, 'identity_unread')
  }
  const refusal = attributionRefusal({
    claimId: claim.id,
    claimOrderId: claim.orderId,
    row: { id: row.id, orderId: row.orderId, status: row.status, reason: row.reason ?? null, stripeRefundId: row.stripeRefundId ?? null },
    orderRows,
    boundToOtherClaimId: boundTo?.id ?? null,
  })
  if (refusal) return fail(refusal.status, refusal.message, 'refused')
  // Type narrowing only: the rule has already refused every other status (unusable_status, row_failed).
  if (row.status !== 'succeeded' && row.status !== 'pending') return fail(409, 'Statut de remboursement inexploitable.', 'refused')
  const rowStatusBefore: 'succeeded' | 'pending' = row.status

  // D8 (4)-(5), G12: Stripe is read BEFORE any write. Not proven → 409, nothing written, no audit.
  const ev = await attributionEvidence(row, claim.orderId, stripeRefund)
  if (!ev.proven) return { out: { ok: false, status: 409, error: ev.text }, refund: null, cause: 'not_proven', stripeRead: ev.refund ?? undefined }
  const s = ev.refund
  const proven = { refundId: row.id, rowStatusBefore, evidence: 'stripe_read' as const, amountCents: s.amount }
  // D8 (6): a preview writes nothing.
  if (opts.dryRun) return { out: { ok: true, outcome: 'preview', ...proven }, refund: s, cause: null }

  // D8 (7), C6: the binder read and the FV → refunded CAS in ONE Serializable transaction. Under SERIALIZABLE the
  // binder read share-locks every claim row it scans (Claim.refundId has no index): two crossing bindings deadlock
  // and one is rolled back (P2034); a sequential second binding sees the first. Nothing else runs inside.
  try {
    await db.$transaction(async (tx) => {
      const other = await tx.claim.findFirst({ where: boundToWhere(row.id, claim.id), select: { id: true } })
      if (other) throw new AttributionAbort('bound_to_other_claim', other.id)
      const done = await tx.claim.updateMany({
        where: { id: claim.id, status: FINANCIAL_VERIFICATION, refundError: claim.refundError },
        data:  { status: 'refunded', refundId: row.id, refundError: null, activeOrderKey: null, decidedAt: new Date() },
      })
      if (done.count !== 1) throw new AttributionAbort('claim_changed')
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 })
  } catch (e) {
    return bindingNotObserved(db, claim.id, row.id, e, s)
  }

  // AFTER AN OBSERVED COMMIT ONLY, in C6 order.
  // 1. H05 site 4: this build's closure record (the only closure-notice eligibility source).
  await recordClaimClosure(claim.id)
  // 2. I-04: our row stays « en attente » — this action applied no ledger line and no royalty clawback.
  if (rowStatusBefore === 'pending') {
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'claim_refunded_row_unfinalized',
        dedupeKey: `claim_row_unfinalized:${row.id}`,
        title:     `Réclamation ${claim.id} soldée d’après Stripe — ligne de remboursement ${row.id} encore en attente`,
        facts:     {
          claimId: claim.id, refundRowId: row.id, stripeRefundId: s.id, stripeStatus: s.status ?? null, amountCents: s.amount,
          action:  'La ligne reste « en attente » dans notre base : cette réconciliation n’a appliqué ni ligne de ledger ni reprise de royalty (si elles sont dues). Aucune action automatique n’a été prise.',
        },
      })
    } catch { /* best effort — the ungated list of unfinalized rows is the durable signal */ }
  }
  // 3. The audit — its boolean never decides notice eligibility.
  try {
    await recordAdminAudit({
      actorId:    opts.adminId,
      actorEmail: null,
      action:     'claim.attribute_refund',
      targetType: 'claim',
      targetId:   claim.id,
      metadata:   {
        refundRowId: row.id, stripeRefundId: s.id, stripeStatus: 'succeeded', rowStatusBefore,
        orderId: claim.orderId, note: opts.note ?? null,
        moneyMoved: false, // this function never moves money; it records an existing link Stripe proved
      },
    })
  } catch { /* audit is best-effort; it must never undo a completed attribution */ }
  return { out: { ok: true, outcome: 'refunded', ...proven }, refund: s, cause: null }
}

export async function attributeClaimRefund(input: {
  claimId: string
  /** The EXISTING Refund row the operator attributes to this claim. */
  refundRowId: string
  adminId: string
  note?: string | null
  /** D8 (6): read the evidence, write nothing. */
  dryRun?: boolean
}): Promise<ClaimAttributionOutcome> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, orderId: true, status: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  if (claim.status !== FINANCIAL_VERIFICATION) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas en vérification financière — utilisez la réconciliation par preuve.' }
  }
  // ROUND 13 (B12): the row read carries the identity stamp (reason) — a failed read refuses before any write.
  let row: AttributionRow | null
  try {
    row = await prisma.refund.findUnique({
      where:  { id: input.refundRowId },
      select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, reason: true, createdAt: true },
    })
  } catch {
    return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
  }
  if (!row) return { ok: false, status: 404, error: 'Remboursement introuvable.' }
  return (await attributeWithEvidence({ id: claim.id }, row, undefined, { adminId: input.adminId, note: input.note, dryRun: input.dryRun })).out
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
 * claimRefundReason(claim.id) so a later reconcile finds it as `mine`. Then it binds the row through
 * attributeWithEvidence (C6), on the Stripe refund object read above — never on the row's own status (G12).
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
  /** ROUND 13 (B11, G12): a success is always an observed C6 commit on Stripe evidence read in this request. */
  | { ok: true; outcome: 'refunded'; refundId: string; facts: StripeRefundFacts; evidence: 'stripe_read'; amountCents: number }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string; facts?: StripeRefundFacts; wrote?: boolean | null }

/** The facts of a Stripe refund object, as read in this request. */
function stripeRefundFacts(refund: Stripe.Refund): StripeRefundFacts {
  return {
    stripeRefundId:  refund.id,
    stripeStatus:    refund.status ?? 'unknown',
    amountCents:     refund.amount,
    paymentIntentId: typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id ?? null,
    chargeId:        typeof refund.charge === 'string' ? refund.charge : refund.charge?.id ?? null,
    createdAt:       refund.created ? new Date(refund.created * 1000).toISOString() : null,
    source:          'stripe',
  }
}

/**
 * B11 (c): the 409 after the mirror row exists but the attribution wrote nothing. The B11 (c) sentence when the
 * claim was proven unmodified by a change; IMPLEMENTATION NOTE (W4) variants where « elle a changé d’état » is not
 * what was established (an identity read that failed, a commit reported lost, a re-read that failed).
 */
function mirrorWrittenNotBoundText(rowId: string, refundId: string, bound: Extract<AttributionResult, { cause: AttributionCause }>): string {
  const head = `La ligne miroir ${rowId} (remboursement ${refundId} ABOUTI chez Stripe, identité de cette réclamation) a été enregistrée`
  if (bound.cause === 'already_bound') {
    const tail = bound.alreadyBound?.recorded
      ? CLOSURE_RECORDED_TAIL
      : 'l’enregistrement de sa clôture a échoué : aucun avis client ne pourra lui être envoyé.'
    return `${head}, et la réclamation est déjà liée à cette ligne (statut actuel : « ${bound.alreadyBound?.status ?? '—'} »). Cette action n’a tenté aucun e-mail ; ${tail} Relisez sa ligne dans la file.`
  }
  if (bound.cause === 'unestablished') {
    return `${head}, mais la base n’a pas pu confirmer ce qui a été écrit sur la réclamation. Relisez la ligne de cette réclamation dans la file avant toute autre action.`
  }
  if (bound.cause === 'not_written') {
    return `${head}, mais la réclamation n’a pas été modifiée : la liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base). Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité.`
  }
  if (bound.cause === 'identity_unread') {
    return `${head}, mais la réclamation n’a pas été modifiée : la base n’a pas pu être relue pour établir l’identité du remboursement. Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité.`
  }
  return `${head}, mais la réclamation n’a pas été modifiée : elle a changé d’état entre-temps. Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité.`
}

/**
 * B11 (a) / C7, IMPLEMENTATION NOTE (W4, fixer round 1): the attribution outcomes after which THIS call's own binding
 * transaction may have committed — a commit reported lost whose re-read shows the claim bound, or a re-read that failed.
 * « Nothing was written » (wrote false) is not established after them, on either adoption branch: wrote is null.
 */
const bindingMayHaveCommitted = (cause: AttributionCause) => cause === 'already_bound' || cause === 'unestablished'

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
  // ROUND-8 AUDIT FIX (P2): every refusal now says whether THIS call wrote anything. The console
  // printed « Rien n’a été écrit » on refusals that come after the mirror row was created.
  // false = proven nothing written; true = the mirror row exists; null = unknown (a bind may have run).
  const trace: { wrote: boolean | null } = { wrote: false }
  const out = await adoptStripeRefundInner(input, trace)
  return out.ok ? out : { ...out, wrote: trace.wrote }
}

async function adoptStripeRefundInner(input: {
  claimId: string
  stripeRefundId: string
  adminId: string
  note?: string | null
  dryRun?: boolean
}, trace: { wrote: boolean | null }): Promise<ClaimStripeAdoptionOutcome> {
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
  // ROUND 13 (B12): both identity reads of this exit (the existing mirror, which carries the stamp, and the stamped
  // row) refuse on a throw — no write, no audit, no alert.
  let existing: Prisma.RefundGetPayload<{ select: { id: true; orderId: true; status: true; reason: true; idempotencyKey: true; amountCents: true; stripePaymentIntentId: true; settledAt: true; stripeRefundId: true; createdAt: true } }> | null
  try {
    existing = await prisma.refund.findFirst({
      where:  { stripeRefundId },
      select: { id: true, orderId: true, status: true, reason: true, idempotencyKey: true, amountCents: true, stripePaymentIntentId: true, settledAt: true, stripeRefundId: true, createdAt: true },
    })
  } catch {
    return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
  }
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
    // ROUND 13 (B11 (a), G12): the row is not the evidence — attributeWithEvidence reads Stripe for it before binding.
    const ours = existing.idempotencyKey.startsWith(EXTERNAL_REFUND_KEY_PREFIX)
      && existing.reason === claimRefundReason(claim.id) && existing.status === 'succeeded'
    if (!ours) {
      return { ok: false, status: 409, error: `Ce remboursement Stripe est déjà enregistré ici (ligne ${existing.id}, statut ${existing.status}) — utilisez « Attribuer » sur cette ligne, ou « Réconcilier d’après la preuve ».` }
    }
    // ROUND-7 AUDIT FIX (P2): the facts of THIS branch come from our own row, and say so. They
    // used to be fabricated (amount 0, a row status relabelled as Stripe's), and the dryRun
    // answer was a 409 that told the operator to press a button the console keeps disabled
    // without a preview. dryRun now returns a real preview, marked local, so « Lier » enables.
    // ROUND 13 (W4 fixer): these local facts serve the dry-run preview only; a refusal carries Stripe's facts or none.
    const rowFacts: StripeRefundFacts = {
      stripeRefundId, stripeStatus: existing.status, amountCents: existing.amountCents,
      paymentIntentId: existing.stripePaymentIntentId, chargeId: null,
      createdAt: existing.settledAt ? existing.settledAt.toISOString() : null, source: 'local_row',
    }
    if (input.dryRun) return { ok: true, outcome: 'preview', facts: rowFacts, wouldWrite: false }
    // ROUND 13 (B11 (a), slice W4): this branch writes no mirror, so nothing is written before a refusal. The binding
    // is attributeWithEvidence's: it reads Stripe for the mirror row (G12) before its Serializable transaction (C6).
    trace.wrote = false
    const bound = await attributeWithEvidence({ id: claim.id }, {
      id: existing.id, orderId: existing.orderId, status: existing.status, amountCents: existing.amountCents,
      stripeRefundId: existing.stripeRefundId, reason: existing.reason, createdAt: existing.createdAt,
    }, undefined, { adminId: input.adminId, note: input.note })
    if (bound.cause !== null) {
      // W4 fixer: after a C7 outcome of this call's own binding transaction, « nothing written » is not established.
      if (bindingMayHaveCommitted(bound.cause)) trace.wrote = null
      // The facts of a refusal are the Stripe refund object this request read for the row, or none — never our row's.
      return { ...bound.out, facts: bound.stripeRead ? stripeRefundFacts(bound.stripeRead) : undefined }
    }
    // The facts of a success are Stripe's, read by this request — never our row's.
    return { ok: true, outcome: 'refunded', refundId: existing.id, facts: stripeRefundFacts(bound.refund), evidence: 'stripe_read', amountCents: bound.out.amountCents }
  }
  // One identity, one row. ROUND-7 AUDIT NOTE (P3): this guard is check-then-act — the UNIQUE key
  // is per Stripe refund, not per claim, so two operators adopting two DIFFERENT Dashboard refunds
  // for the same claim at the same instant both pass it; the first binding wins the FV CAS, the
  // second gets 409 from the tail, and its row stays as an orphan stamped for a terminal claim.
  // Money stays correct (both refunds are real; every consumer sums or mins). Making it structural
  // would need a schema change (a uniqueness on (orderId, reason)), which is out of scope here.
  let stamped: { id: string } | null
  try {
    stamped = await prisma.refund.findFirst({
      where:  { orderId: claim.orderId, reason: claimRefundReason(claim.id) },
      select: { id: true },
    })
  } catch {
    return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
  }
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

  // THE single mirror write: a local mirror of a refund Stripe says succeeded on this order's charge.
  const mirrorData = {
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
  }
  // ROUND 13 (C8, D9 (4), slice W4): the stamped-row read and the mirror insert in ONE Serializable transaction.
  // The stamped read share-locks the order's Refund range, so two concurrent adoptions of two refunds for this
  // claim cannot both insert: one is rolled back. The pre-transaction read above stays as a fast refusal.
  let row: { id: string }
  /** ER-M08: the adoption audit is written only for a commit this call observed. */
  let observedCommit = true
  try {
    row = await prisma.$transaction(async (tx) => {
      const stampedNow = await tx.refund.findFirst({ where: { orderId: order.id, reason: claimRefundReason(claim.id) }, select: { id: true } })
      if (stampedNow) throw new AdoptionAbort('stamped_exists')
      return tx.refund.create({ data: mirrorData, select: { id: true } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 })
  } catch (err) {
    if (err instanceof AdoptionAbort) {
      return { ok: false, status: 409, error: 'Un remboursement porte déjà l’identité de cette réclamation sur cette commande : aucune ligne miroir n’a été écrite. Relancez « Réconcilier d’après la preuve ».', facts }
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, status: 409, error: 'Ce remboursement Stripe vient d’être enregistré par ailleurs — rechargez la file.', facts }
    }
    // C7 for the mirror: nothing is proven written — report only what a re-read of the refund shows.
    const code = (err as { code?: unknown } | null)?.code
    // C7's log line: C7 covers the errors of both the C6 and the C8 transaction.
    console.warn('[claims] binding transaction aborted', typeof code === 'string' || typeof code === 'number' ? code : err instanceof Error ? err.name : 'unknown')
    let found: { id: string; reason: string | null } | null
    try {
      found = await prisma.refund.findFirst({ where: { stripeRefundId: refund.id }, select: { id: true, reason: true } })
    } catch {
      trace.wrote = null
      return { ok: false, status: 409, error: BINDING_UNESTABLISHED, facts }
    }
    if (!found) {
      return { ok: false, status: 409, error: 'L’enregistrement de la ligne miroir n’a pas pu être confirmé : aucune ligne miroir n’existe, rien n’a été écrit. Réessayez.', facts }
    }
    if (found.reason !== claimRefundReason(claim.id)) {
      // Another adoption recorded this Stripe refund (another claim's stamp): this call wrote nothing.
      return { ok: false, status: 409, error: 'Ce remboursement Stripe vient d’être enregistré par ailleurs — rechargez la file.', facts }
    }
    // ER-M08: the mirror carrying this claim's identity exists; whether THIS call's commit or a concurrent one wrote
    // it is not established — continue with the binding, write no second adoption audit.
    row = { id: found.id }
    observedCommit = false
  }
  trace.wrote = true // the mirror row exists from here on
  if (observedCommit) {
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
  }

  // B11 (c): the binding on the mirror, with the refund object read above (no second Stripe read).
  const bound = await attributeWithEvidence({ id: claim.id }, {
    id: row.id, orderId: order.id, status: 'succeeded', amountCents: refund.amount,
    stripeRefundId: refund.id, reason: claimRefundReason(claim.id), createdAt: mirrorData.settledAt,
  }, refund, { adminId: input.adminId, note: input.note })
  if (bound.cause === null) {
    return { ok: true, outcome: 'refunded', refundId: row.id, facts, evidence: 'stripe_read', amountCents: bound.out.amountCents }
  }
  // W4 fixer: the mirror exists (the text says so), but whether this call bound the claim is not established after a
  // C7 outcome of its own binding transaction — wrote null, so the console never says « la liaison n’a pas abouti ».
  if (bindingMayHaveCommitted(bound.cause)) trace.wrote = null
  return { ok: false, status: 409, error: mirrorWrittenNotBoundText(row.id, refund.id, bound), facts }
}

/** G2 (3): the order's Refund rows as the dispatch and the loader read them. */
const G2_ROW_SELECT = {
  id: true, status: true, amountCents: true, stripeRefundId: true, reason: true, idempotencyKey: true, createdAt: true, royaltyRefundCents: true,
} as const

export async function reconcileClaimEvidence(input: { claimId: string }): Promise<ClaimEvidenceOutcome> {
  const claim = await prisma.claim.findUnique({
    where:  { id: input.claimId },
    select: { id: true, orderId: true, status: true, refundId: true, refundAttempted: true, requestedAmountCents: true, refundError: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  // G1: the gate is ONE rule shared with the lists the consoles read (lib/claim-action-rules → `reconcilable`).
  // It still refuses a HEALTHY approved-but-unpaid claim (the round-8 finding).
  // ROUND 13 (B8, B12): the bound row is read before the gate — a failed identity read refuses, never guesses.
  let boundRow: { id: string; orderId: string; status: string; amountCents: number; stripeRefundId: string | null; createdAt: Date; reason: string | null } | null = null
  if (claim.refundId) {
    try {
      boundRow = await prisma.refund.findUnique({
        where:  { id: claim.refundId },
        select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true, reason: true },
      })
    } catch {
      return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
    }
  }
  // ROUND 13 (G1 (ii)/(iii), slice W5): the bound row read above is passed for EVERY claim — the list flags pass the same.
  const gate = reconcileRefusal({ ...claim, boundRow })
  if (gate) return { ok: false, status: gate.status, error: gate.error }
  // G2 (1): a settled claim → R0 (G10). The gate admitted it only with a bound row on its own order.
  if (claim.status === 'refunded') {
    if (!boundRow) return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
    return reconcileSettledClaim(claim, boundRow, {})
  }
  // C9 (c): every park below compares against the claim as read here.
  const claimPreImage: ClaimPreImage = {
    status:      claim.status,
    refundError: claim.refundError,
  }
  const stripeCache: StripeRefundsCache = {}

  // G2 (2): a claim bound to a row with no recorded error applies THAT row's truth.
  if (claim.refundId && claim.refundError === null && (claim.status === 'approved' || claim.status === 'refunding')) {
    return reconcileBoundClaim({
      id: claim.id, orderId: claim.orderId, status: claim.status, refundId: claim.refundId,
      refundError: claim.refundError,
    }, stripeCache, boundRow)
  }

  // G2 (3): every Refund row of the ORDER. `reason` is the identity stamp lib/refund.ts writes at creation (T-52);
  // a failed read of it establishes nothing (B12).
  let rows: Prisma.RefundGetPayload<{ select: typeof G2_ROW_SELECT }>[]
  try {
    rows = await prisma.refund.findMany({ where: { orderId: claim.orderId }, select: G2_ROW_SELECT, orderBy: { createdAt: 'asc' } })
  } catch {
    return { ok: false, status: 409, error: IDENTITY_READ_FAILED }
  }
  const mine = rows.filter((r) => r.reason === claimRefundReason(claim.id))

  // More than one row stamped with this claim's identity: no attribution without a human.
  if (mine.length > 1) {
    const detail = `${mine.length} lignes Refund portent l'identité de cette réclamation (${mine.map((r) => r.id).join(', ')}). Attribution impossible sans décision humaine.`
    const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'multiple_candidate_refunds', detail, expect: claimPreImage })
    if (!parked.entered && !parked.relabelled) return { ok: true, outcome: 'changed_during_read' }
    return { ok: true, outcome: 'financial_verification', reason: 'multiple_candidate_refunds', detail }
  }

  // Exactly one row is ours (B8 (ii), a stalled attempt's late row A-S33): apply ITS truth.
  if (mine.length === 1) {
    const row = mine[0]
    // G2 (3) / G4 (IMPLEMENTATION NOTE (W3)): the claim's own stamped row is re-read at Stripe — a reversal marks the
    // claim (STRIPE_REVERTED), a 404 or another payment parks, a settlement carries evidence 'stripe_read' and the
    // Stripe amount. Without absenceIsEvidence (only the loader passes it). The mine, bound and attribution paths all read
    // refundRowTruth (G4, W4/W5).
    return applyRowTruth(claim, row, await refundRowTruth(row, claim.orderId, stripeCache), 'stamped')
  }

  // No PaymentIntent: a fact about the ORDER, not a transient unreadable read — its own park reason.
  const order = await prisma.order.findUnique({
    where:  { id: claim.orderId },
    select: { stripePaymentIntentId: true },
  })
  if (!order?.stripePaymentIntentId) {
    const detail = 'Cette commande n’a aucun paiement Stripe enregistré : aucune preuve Stripe ne peut exister pour elle. Aucune conclusion n’est tirée.'
    const parked = await enterFinancialVerification({ claimId: claim.id, reason: 'no_payment_intent', detail, expect: claimPreImage })
    if (!parked.entered && !parked.relabelled) return { ok: true, outcome: 'changed_during_read' }
    return { ok: true, outcome: 'financial_verification', reason: 'no_payment_intent', detail }
  }

  // G2 (3) otherwise → N0-N8 (G6-G8) for EVERY admitted pre-image: FV, a proof (v13 or legacy), a lock, a safety hold,
  // a marker past its grace, a legacy stranded or attempted-unrecorded claim. The ONE loader T2 uses, the same pure
  // derivation, the N8 writer. The round-12 ladder is deleted (G2): no reconciliation path creates money authority (G14).
  return reconcileNoRowByDerivation(claim, stripeCache)
}

// ══ ROUND 13 (slice W5) — G10 / G11 / G13 / AMF-1: reversal of a settled refund, detected without a money write ══════

/** G11 evidence: what establishes that the refund bound to a row pays nothing. */
export type RevertEvidence =
  | { kind: 'stripe_object'; refund: Stripe.Refund }
  | { kind: 'failed_row' }
  | { kind: 'pending_row_stripe'; refund: Stripe.Refund }

/** G11: a Stripe refund object shows a routed payment only when it carries a transfer reversal; otherwise unknown. */
const routedFromRefund = (s: Stripe.Refund | null | undefined): boolean | null => (s && s.transfer_reversal ? true : null)
const refundPaymentIntentOf = (s: Stripe.Refund): string | null => (typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null)

/**
 * G11 markClaimsForRevertedRefundRow — CLAIM-ONLY marking. It re-reads the row (and, where the evidence needs it, the
 * order's PaymentIntent id from our base), checks the evidence on that fresh read, then compare-and-sets each target
 * claim on its exact pre-image. It never calls the engine, never calls Stripe, never writes a Refund row and sends no
 * e-mail (R-D3). failed is true only when a DB read or write threw; no target, a lost CAS or a skip → failed false.
 * IMPLEMENTATION NOTE (W5) on G11: stripe_object also accepts a succeeded row WITHOUT a recorded id whose refund carries
 * the engine tag (grubano_refund_row) on the order's PaymentIntent — the same identity rule as pending_row_stripe —
 * because R0c reads such a row by its tag (G4) and a proven reversal must not answer « changed during read ».
 */
export async function markClaimsForRevertedRefundRow(input: {
  rowId: string
  evidence: RevertEvidence
  onlyClaimId?: string
  routed?: boolean | null
}): Promise<{ claimIds: string[]; written: boolean; failed: boolean }> {
  const claimIds: string[] = []
  let written = false
  const nothing = () => ({ claimIds, written, failed: false })
  const routed = input.routed ?? null
  try {
    const row = await prisma.refund.findUnique({ where: { id: input.rowId }, select: { status: true, stripeRefundId: true, orderId: true } })
    if (!row) return nothing()
    const ev = input.evidence
    const orderPi = async () => (await prisma.order.findUnique({ where: { id: row.orderId }, select: { stripePaymentIntentId: true } }))?.stripePaymentIntentId ?? null
    const failedAtStripe = (s: Stripe.Refund) => s.status === 'failed' || s.status === 'canceled'
    const identifies = async (s: Stripe.Refund, piAnchorAlways: boolean): Promise<boolean> => {
      const byId = !!row.stripeRefundId && row.stripeRefundId === s.id
      const byTag = !row.stripeRefundId && s.metadata?.grubano_refund_row === input.rowId
      if (!byId && !byTag) return false
      if (!piAnchorAlways && byId) return true
      const pi = await orderPi()
      return !!pi && refundPaymentIntentOf(s) === pi
    }
    let text: string
    if (ev.kind === 'stripe_object') {
      if (row.status !== 'succeeded' || !failedAtStripe(ev.refund) || !(await identifies(ev.refund, false))) return nothing()
      text = reversalMarkerText('succeeded', input.rowId, ev.refund.id, String(ev.refund.status), routed)
    } else if (ev.kind === 'failed_row') {
      if (row.status !== 'failed' || !row.stripeRefundId) return nothing()
      text = reversalMarkerText('failed', input.rowId, row.stripeRefundId, 'failed', routed)
    } else {
      if (row.status !== 'pending' || !failedAtStripe(ev.refund) || !(await identifies(ev.refund, true))) return nothing()
      text = reversalMarkerText('pending', input.rowId, ev.refund.id, String(ev.refund.status), routed)
    }
    const targets = await prisma.claim.findMany({
      where:  { refundId: input.rowId, ...(input.onlyClaimId ? { id: input.onlyClaimId } : {}) },
      select: { id: true, status: true, refundError: true },
    })
    for (const t of targets) claimIds.push(t.id)
    for (const t of targets) {
      // A disowned binding (resume_mismatch) and every recorded error are skipped: only a null pre-image is marked.
      if (isResumeMismatch(t.refundError) || t.refundError !== null) continue
      if (t.status === 'refunded') {
        const done = await prisma.claim.updateMany({ where: { id: t.id, status: 'refunded', refundError: null }, data: { refundError: text } })
        if (done.count === 1) written = true
      } else if ((t.status === 'approved' || t.status === 'refunding') && ev.kind === 'stripe_object') {
        const done = await prisma.claim.updateMany({
          where: { id: t.id, status: t.status, refundError: null },
          data:  { status: 'approved', refundError: stripeRevertedText(input.rowId, ev.refund.id, String(ev.refund.status), routed) },
        })
        if (done.count === 1) written = true
      }
    }
    return { claimIds, written, failed: false }
  } catch (e) {
    console.error('[claims] markClaimsForRevertedRefundRow — a DB call failed: nothing is established for row', input.rowId, e instanceof Error ? e.message : e)
    return { claimIds, written, failed: true }
  }
}

/** The bound row R0 reads (G1 (iii) admitted it: pending, succeeded, or failed with a Stripe id, on the claim's order). */
type SettledBoundRow = { id: string; orderId: string; status: string; stripeRefundId: string | null; createdAt: Date }

/**
 * G10 R0 (D7): a refunded claim with no recorded error, on a bound row of its own order. Read-only toward Stripe
 * (refundRowTruth, never absenceIsEvidence); the only write is the G11 claim marker. Every marking sends I-01
 * 'reverted_after_refund' after the won CAS. The audit claim.reconcile_evidence {moneyMoved:false} is written by the
 * caller (the reconcile route, or reverifySettledClaimRefunds). No customer e-mail (R-D3).
 */
async function reconcileSettledClaim(
  claim: { id: string; orderId: string; refundAttempted?: boolean | null },
  row: SettledBoundRow,
  cache: StripeRefundsCache,
): Promise<ClaimEvidenceOutcome> {
  const mark = async (evidence: RevertEvidence, re: string | null, routed: boolean | null): Promise<ClaimEvidenceOutcome> => {
    const m = await markClaimsForRevertedRefundRow({ rowId: row.id, evidence, onlyClaimId: claim.id, routed })
    if (m.failed) return { ok: false, status: 409, error: R0_DB_FAILED }
    if (!m.written) return { ok: true, outcome: 'changed_during_read' }
    await alertClaimPaymentBlocked(claim.id, 'reverted_after_refund', {
      orderId: claim.orderId, refundRowIds: [row.id], stripeRefundIds: [re], engineCalled: false, routed,
      claimAfter: stateAfter('refunded', claim.refundAttempted ?? true, row.id, MARKERS.REVERTED_AFTER_REFUND),
    })
    return { ok: true, outcome: 'reverted_after_refund', refundId: row.id }
  }
  const unproven = (detail: string): ClaimEvidenceOutcome => ({ ok: true, outcome: 'refunded_row_unproven', refundId: row.id, detail })
  const retry: ClaimEvidenceOutcome = { ok: true, outcome: 'stripe_unreadable_retry', refundId: row.id }

  // R0a — our row is failed with its Stripe id: the local row is the evidence.
  if (row.status === 'failed') return mark({ kind: 'failed_row' }, row.stripeRefundId, null)

  // R0b — the row is pending: its refund is read by the recorded id, else by the engine tag in the PaymentIntent list.
  if (row.status === 'pending') {
    const t = await refundRowTruth(row, claim.orderId, cache)
    if (t.kind === 'at_stripe') {
      const s = t.refund
      // The row is NOT touched: no markRefundRowFailed, no key rename.
      if (s.status === 'failed' || s.status === 'canceled') return mark({ kind: 'pending_row_stripe', refund: s }, s.id, routedFromRefund(s))
      if (s.status === 'succeeded' || s.status === 'pending' || s.status === 'requires_action') {
        return { ok: true, outcome: 'refund_still_standing', refundId: row.id, stripeStatus: s.status, amountCents: s.amount }
      }
      return unproven(`Stripe rapporte le remboursement ${s.id} de la ligne ${row.id} au statut « ${String(s.status)} », non reconnu. Aucune conclusion tirée.`)
    }
    // Never refund_still_standing: nothing at Stripe carries this row yet (D7, verifier A P3).
    if (t.kind === 'absent_within_window') return { ok: true, outcome: 'unconfirmed_within_window', refundId: row.id, until: t.until.toISOString() }
    if (t.kind === 'absent_dead') {
      return unproven(`Stripe ne connaît aucun remboursement pour la ligne ${row.id}, et le moteur ne la créera plus (fenêtre d’idempotence expirée le ${t.windowEnd.toISOString()}). Aucune conclusion tirée.`)
    }
    if (t.kind === 'contradiction') return unproven(t.detail)
    return retry
  }

  // R0c — the row is succeeded: its refund is re-read at Stripe.
  if (row.status === 'succeeded') {
    const t = await refundRowTruth(row, claim.orderId, cache)
    if (t.kind === 'row_terminal' && t.status === 'succeeded' && t.refund) {
      return { ok: true, outcome: 'refund_still_standing', refundId: row.id, stripeStatus: 'succeeded', amountCents: t.refund.amount }
    }
    if (t.kind === 'reverted') return mark({ kind: 'stripe_object', refund: t.refund }, t.refund.id, routedFromRefund(t.refund))
    if (t.kind === 'contradiction') return unproven(t.detail)
    return retry
  }
  return unproven(`La ligne liée ${row.id} porte le statut « ${row.status} » : aucune conclusion tirée.`)
}

const DAY_MS = 24 * 60 * 60 * 1000
/** AMF-1: the audit actor of a machine run (lib/admin-audit CRON_ACTOR_ID, repeated so this module keeps its imports). */
const SWEEP_ACTOR_ID = 'system:cron'

/**
 * AMF-1 reverifySettledClaimRefunds — the bounded, read-only re-verification of settled claims (closes E-09 to a
 * 35-day residual). Selection: refunded, no recorded error, bound, settled (decidedAt, else createdAt) within
 * lookbackDays, oldest first, at most `take` (truncated reported); a bound row of the claim's own order that is
 * succeeded or pending. Per claim: exactly the D7 reads (R0b / R0c); only a failed / canceled refund is marked (G11),
 * with I-01 and the audit claim.reconcile_evidence {moneyMoved:false}. Never an engine call, a Stripe write, a Refund
 * write or a customer e-mail. IMPLEMENTATION NOTE (W5) on AMF-1: the summary has no key for a within-window pending row
 * or a lost CAS — a within-window row is counted in `unproven` (not established at Stripe yet), a lost CAS only in
 * `checked`; a DB failure of the marking helper is counted in `unreadable`. The DB order is decidedAt then createdAt
 * ascending (MySQL sorts a null decidedAt first), the closest Prisma form of « settledAt, else createdAt ».
 */
export async function reverifySettledClaimRefunds(opts: { lookbackDays?: number; take?: number; actor?: { id: string; email?: string | null } } = {}): Promise<SettledReverifySummary> {
  const lookbackDays = opts.lookbackDays ?? 35
  const take = opts.take ?? 100
  const out: SettledReverifySummary = { checked: 0, reverted: 0, standing: 0, unreadable: 0, unproven: 0, truncated: false }
  const since = new Date(Date.now() - lookbackDays * DAY_MS)
  // The selection, restated on what was read (a claim outside it is never re-verified).
  const settledAt = (c: { decidedAt?: Date | null; createdAt?: Date | null }) => new Date((c.decidedAt ?? c.createdAt) as Date).getTime()
  // IMPLEMENTATION NOTE (W5 fixer) on AMF-1: `take` and `truncated` apply to ELIGIBLE claims — the row conditions (own order,
  // succeeded or pending) are part of the selection, so an ineligible settled claim never uses a slot. The window is read in
  // pages of take + 1 (oldest first, id as the tie-break) until more than `take` eligible claims are found or the window is
  // exhausted; a page that brings no new claim ends the read. At most MAX_PAGES pages: past that, truncated is reported.
  const PAGE = take + 1
  const MAX_PAGES = 50
  type Candidate = { id: string; orderId: string; status: string; refundId: string | null; refundError: string | null; refundAttempted: boolean; decidedAt: Date | null; createdAt: Date }
  type EligibleRow = { id: string; orderId: string; status: string; stripeRefundId: string | null; createdAt: Date }
  const eligible: Array<{ c: Candidate; row: EligibleRow }> = []
  const seen = new Set<string>()
  let exhausted = false
  for (let page = 0; page < MAX_PAGES && eligible.length <= take; page++) {
    const found = (await prisma.claim.findMany({
      where: {
        status: 'refunded', refundError: null, refundId: { not: null },
        OR: [{ decidedAt: { gte: since } }, { decidedAt: null, createdAt: { gte: since } }],
      },
      select:  { id: true, orderId: true, status: true, refundId: true, refundError: true, refundAttempted: true, decidedAt: true, createdAt: true },
      orderBy: [{ decidedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip:    page * PAGE,
      take:    PAGE,
    })) ?? []
    const fresh = found.filter((c) => !seen.has(c.id))
    for (const c of fresh) seen.add(c.id)
    const selected = fresh.filter((c) => c.status === 'refunded' && c.refundError === null && !!c.refundId && !!(c.decidedAt ?? c.createdAt) && settledAt(c) >= since.getTime())
    if (selected.length) {
      const rows = await prisma.refund.findMany({
        where:  { id: { in: selected.map((c) => c.refundId as string) } },
        select: { id: true, orderId: true, status: true, stripeRefundId: true, createdAt: true },
      })
      const byId = new Map(rows.map((r) => [r.id, r]))
      for (const c of selected) {
        const row = byId.get(c.refundId as string)
        if (!row || row.orderId !== c.orderId || (row.status !== 'succeeded' && row.status !== 'pending')) continue
        eligible.push({ c, row })
      }
    }
    if (found.length < PAGE || fresh.length === 0) { exhausted = true; break }
  }
  out.truncated = eligible.length > take || !exhausted
  const list = eligible.slice(0, take)
  if (!list.length) return out
  const caches = new Map<string, StripeRefundsCache>()
  for (const { c, row } of list) {
    out.checked++
    if (!caches.has(c.orderId)) caches.set(c.orderId, {})
    let r: ClaimEvidenceOutcome
    try {
      r = await reconcileSettledClaim(c, row, caches.get(c.orderId) as StripeRefundsCache)
    } catch (e) {
      console.error('[claims] settled re-verification read failed —', c.id, e instanceof Error ? e.message : e)
      out.unreadable++
      continue
    }
    if (!r.ok) { out.unreadable++; continue }
    if (r.outcome === 'reverted_after_refund') {
      out.reverted++
      try {
        await recordAdminAudit({
          actorId:    opts.actor?.id ?? SWEEP_ACTOR_ID,
          actorEmail: opts.actor?.email ?? null,
          action:     'claim.reconcile_evidence',
          targetType: 'claim',
          targetId:   c.id,
          metadata:   { outcome: r.outcome, moneyMoved: false, source: 'settled_reverify' },
        })
      } catch { /* audit is best-effort; the marking stands */ }
    } else if (r.outcome === 'refund_still_standing') out.standing++
    else if (r.outcome === 'stripe_unreadable_retry') out.unreadable++
    else if (r.outcome === 'refunded_row_unproven' || r.outcome === 'unconfirmed_within_window') out.unproven++
  }
  return out
}

export async function recoverStrandedClaimReconciliations(limit = 200, opts: { actor?: { id: string; email?: string | null } } = {}): Promise<ClaimRecoverySummary> {
  const out: ClaimRecoverySummary = { scanned: 0, reconciled: 0, skipped: 0, details: [] }
  await recoverStrandedPass(out, limit)
  // AMF-1: the bounded read-only re-verification of settled claims runs AFTER the existing pass (G13 « no pass over
  // refunded claims » is superseded). A failure of its selection read propagates: the caller answers 500, never « ok ».
  out.settledReverify = await reverifySettledClaimRefunds({ actor: opts.actor })
  return out
}

/** The stranded pass (G13): selection unchanged; a succeeded row is re-read at Stripe before anything settles on it. */
async function recoverStrandedPass(out: ClaimRecoverySummary, limit: number): Promise<void> {
  const stranded = await prisma.claim.findMany({
    // RE-AUDIT FIX (batch 2). Without the refundError exclusion this sweep never RETIRED a row:
    // reconcileClaimForRefund moves a failed refund to status 'approved' WITH a refundError, which
    // is still inside this predicate, so the same claims were re-reconciled every single day —
    // rewriting byte-identical values, reporting a fresh `reconciled: 1` for ever, and permanently
    // occupying the take:200 window ahead of genuinely stranded claims. A row already carrying a
    // refundError has been reconciled; it now needs an ADMIN, not another sweep.
    where:  { status: { in: ['refunding', 'approved'] }, refundId: { not: null }, refundError: null },
    select: { id: true, refundId: true, status: true, orderId: true },
    take:   limit,
  })
  out.scanned = stranded.length
  if (!stranded.length) return
  const rows = await prisma.refund.findMany({
    where:  { id: { in: stranded.map((c) => c.refundId as string) } },
    select: { id: true, orderId: true, status: true, stripeRefundId: true, createdAt: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const caches = new Map<string, StripeRefundsCache>()
  for (const c of stranded) {
    const row = c.refundId ? byId.get(c.refundId) : null
    // Still pending, or no row at all: nothing terminal to apply. Never invent an outcome.
    if (!row || (row.status !== 'succeeded' && row.status !== 'failed')) { out.skipped++; continue }
    if (row.status === 'succeeded') {
      // G13: the recovery sweep never settles a claim on a reverted refund — the row's refund is re-read at Stripe first
      // (read-only, never absenceIsEvidence).
      const orderId = c.orderId ?? row.orderId
      if (!caches.has(orderId)) caches.set(orderId, {})
      const t = await refundRowTruth(row, orderId, caches.get(orderId) as StripeRefundsCache)
      if (t.kind === 'reverted') {
        const m = await markClaimsForRevertedRefundRow({ rowId: row.id, evidence: { kind: 'stripe_object', refund: t.refund }, routed: routedFromRefund(t.refund) })
        if (m.written) { out.reconciled++; out.details.push(`${c.id}: reverted → approved(stripe_reverted)`) } else { out.skipped++; out.details.push(`${c.id}: reverted${m.failed ? ' (db_unreadable)' : ''}`) }
        continue
      }
      if (!(t.kind === 'row_terminal' && t.status === 'succeeded')) { out.skipped++; out.details.push(`${c.id}: ${t.kind}`); continue }
    }
    const res = await reconcileClaimForRefund({
      refundRowId:    row.id,
      status:         row.status === 'succeeded' ? 'succeeded' : 'failed',
      stripeRefundId: row.stripeRefundId,
    })
    if (res.reconciled) { out.reconciled++; out.details.push(`${c.id}: ${res.from} → ${res.to}`) } else out.skipped++
  }
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
