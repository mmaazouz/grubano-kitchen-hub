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
import { executeRefund, isRefundsEnabled } from '@/lib/refund'

/** Kill-switch — default OFF (mirrors isRefundsEnabled / isChargebacksEnabled). */
export function isClaimsEnabled(): boolean {
  return process.env.CLAIMS_ENABLED === 'true'
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

export const CLAIM_REASONS = ['missing_item', 'wrong_order', 'quality', 'not_delivered', 'other'] as const
export type ClaimReason = (typeof CLAIM_REASONS)[number]

// Active statuses (the order is "locked" against a second claim while in these).
// C2 adds 'arbitration' (a contested claim is active). C1 never reaches it → byte-identical.
const ACTIVE_STATUSES = ['restaurant_review', 'approved', 'refunding', 'arbitration'] as const

export type ClaimActionResult =
  | { ok: true; claim: unknown; refund?: RefundTriggerResult }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string }

export type RefundTriggerResult =
  | { state: 'refunded'; refundId: string }
  | { state: 'pending'; reason: 'refunds_disabled' }
  | { state: 'failed'; error: string }
  | { state: 'already_handled' }

const isP2002 = (err: unknown) =>
  !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002'

// ── CLIENT — create a claim ──────────────────────────────────────────────────────
export async function createClaim(input: {
  consumerId: string
  orderId: string
  reason: string
  description?: string | null
  requestedAmountCents?: number | null
  photoUrl?: string | null
}): Promise<ClaimActionResult> {
  if (!CLAIM_REASONS.includes(input.reason as ClaimReason)) {
    return { ok: false, status: 400, error: 'Motif de réclamation invalide.' }
  }
  const order = await prisma.order.findUnique({
    where:  { id: input.orderId },
    select: { id: true, consumerId: true, restaurantId: true, paymentStatus: true, total: true, updatedAt: true },
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
  // Amount: default = the whole order; cap at the order total (the engine enforces the
  // TRUE live refundable + cumul at refund time). Server-derived, never trusted raw.
  const orderTotalCents = Math.max(0, Math.round(order.total * 100))
  const requested = input.requestedAmountCents ?? orderTotalCents
  if (!Number.isInteger(requested) || requested <= 0 || requested > orderTotalCents) {
    return { ok: false, status: 400, error: `Montant invalide — maximum remboursable : ${(orderTotalCents / 100).toFixed(2)} €.` }
  }

  const responseDeadlineAt = new Date(Date.now() + claimResponseHours() * 3600 * 1000)
  try {
    const claim = await prisma.claim.create({
      data: {
        orderId:              order.id,
        consumerId:           input.consumerId,
        restaurantId:         order.restaurantId,
        reason:               input.reason,
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
}

/** Server-derived eligibility for the client UI (owner + paid + within window + no
 *  active claim). All checks mirror createClaim so the button can never offer a claim
 *  the POST would reject. */
export async function getClaimEligibility(input: { consumerId: string; orderId: string }): Promise<ClaimEligibility> {
  const windowHours = claimWindowHours()
  const order = await prisma.order.findUnique({
    where:  { id: input.orderId },
    select: { consumerId: true, paymentStatus: true, total: true, updatedAt: true },
  })
  if (!order || order.consumerId !== input.consumerId) {
    return { canClaim: false, reason: 'not_owner', maxRefundableCents: 0, windowHours, existingClaim: null }
  }
  const maxRefundableCents = Math.max(0, Math.round(order.total * 100))
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
  if (order.paymentStatus !== 'paid') return { canClaim: false, reason: 'not_paid', maxRefundableCents, windowHours, existingClaim }
  if (Date.now() - order.updatedAt.getTime() > windowHours * 3600 * 1000) {
    return { canClaim: false, reason: 'window_expired', maxRefundableCents, windowHours, existingClaim }
  }
  if (existing && (ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
    return { canClaim: false, reason: 'active_claim', maxRefundableCents, windowHours, existingClaim }
  }
  return { canClaim: true, maxRefundableCents, windowHours, existingClaim }
}

export async function listRestaurantClaims(restaurantIds: string[], opts?: { status?: string }) {
  if (restaurantIds.length === 0) return []
  return prisma.claim.findMany({
    where:   { restaurantId: { in: restaurantIds }, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
}

// ── REFUND TRIGGER — executeRefund at most once per claim ─────────────────────────
async function triggerClaimRefund(claimId: string): Promise<RefundTriggerResult> {
  // REFUNDS gate: engine off → leave the claim 'approved', refund pending activation.
  if (!isRefundsEnabled()) return { state: 'pending', reason: 'refunds_disabled' }

  // ATOMIC claim of the single refund attempt: only one caller flips the flag.
  const got = await prisma.claim.updateMany({
    where: { id: claimId, status: 'approved', refundAttempted: false },
    data:  { refundAttempted: true, status: 'refunding' },
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
    await prisma.claim.update({
      where: { id: claimId },
      data:  { status: 'refunded', refundId: result.refundId, refundError: null, activeOrderKey: null },
    })
    return { state: 'refunded', refundId: result.refundId }
  }
  // Engine failed AFTER the attempt flag — do NOT auto-retry (the cursor may have moved;
  // a blind re-call could double-refund). Revert to 'approved' for visibility + record.
  await prisma.claim.update({
    where: { id: claimId },
    data:  { status: 'approved', refundError: result.error },
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
  const expired = await prisma.claim.findMany({
    where:  { status: 'restaurant_review', responseDeadlineAt: { lt: now } },
    select: { id: true },
    take:   500,
  })
  summary.scannedExpired = expired.length
  for (const c of expired) {
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
  claim: { id: string; consumerId: string; requestedAmountCents: number; status: string },
): Promise<RefundTriggerResult | { state: 'not_eligible' }> {
  if (!isClaimAutoResolveEnabled()) {
    console.warn('[claims auto-resolve] [P0-27] CLAIM_AUTO_RESOLVE_ENABLED est OFF — aucune auto-résolution, la réclamation part en revue restaurant (validation humaine).')
    return { state: 'not_eligible' }
  }
  if (claim.status !== 'restaurant_review') return { state: 'not_eligible' }
  const ceiling = claimAutoApproveMaxCents()
  if (ceiling <= 0 || claim.requestedAmountCents > ceiling) return { state: 'not_eligible' }
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
    select: { id: true, status: true, refundAttempted: true },
  })
  if (!claim) return { ok: false, status: 404, error: 'Réclamation introuvable.' }
  const legacyApproved = claim.status === 'approved' && !claim.refundAttempted // héritage pré-P0-24
  if (claim.status !== 'arbitration' && !legacyApproved) {
    return { ok: false, status: 409, error: 'Cette réclamation n’est pas en arbitrage.' }
  }

  if (input.decision === 'refuse_final') {
    const done = await prisma.claim.updateMany({
      // CAS depuis l'état constaté ; pour l'héritage, refundAttempted:false dans le
      // WHERE garantit qu'aucun remboursement n'a été tenté entre-temps (race-safe).
      where: legacyApproved
        ? { id: claim.id, status: 'approved', refundAttempted: false }
        : { id: claim.id, status: 'arbitration' },
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
    where: legacyApproved
      ? { id: claim.id, status: 'approved', refundAttempted: false }
      : { id: claim.id, status: 'arbitration' },
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
  const claims = await prisma.claim.findMany({
    where:   { OR: [{ status: 'arbitration' }, { status: 'approved', refundAttempted: false }] },
    orderBy: { createdAt: 'asc' },
    take:    200,
  })
  return Promise.all(claims.map(async (c) => ({
    ...c,
    consumerStats:   await consumerClaimStats(c.consumerId),
    restaurantStats: await restaurantRefusalStats(c.restaurantId),
  })))
}
