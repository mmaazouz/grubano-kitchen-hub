// lib/claim-eligibility.ts — WHO MAY FILE A CLAIM, and why not (D′ L6, spec v2 §7.1).
//
// THE DEFECT THIS FILE EXISTS TO PREVENT. Two functions answer the same question: `getClaimEligibility`
// tells the customer whether the form is open, and `createClaim` decides whether the claim is accepted.
// Until now each carried its own copy of the rules, in a different order, with different wording — so a
// form could invite a claim the server then refused, or refuse one the form had promised. Both now ask
// THIS function, which is pure: it takes facts the caller has already read and returns the refusal, or
// null. There is one list, in one order, with one reason code per refusal.
//
// WHY delivered-ONLY (E3, the founder's D-3). A claim is about food that arrived and was wrong. Before
// delivery there is nothing to judge: an order still on its way is a delivery problem, and a paid order
// the restaurant cancelled is a question GRUBANO must answer by itself — that is the SYSTEM claim, which
// bypasses this list entirely (S-17). `picked_up` is deliberately excluded too: nobody has confirmed the
// hand-off, so support handles it.
//
// WHY THE ANCHOR IS deliveredAt AND NEVER updatedAt (E4). `updatedAt` moves on every later write — a
// restaurant note, a reconciliation, an admin read-repair — so a 48-hour window measured from it silently
// re-opens days after the meal, and a customer who was refused on Monday could file on Thursday because
// something unrelated touched the row. `deliveredAt` is written once, at the transition, and never again.
// An order that carries no anchor is NOT eligible for self-service: there is no honest way to date the
// window, and inventing one from `updatedAt` or `createdAt` would be exactly the defect. Those orders go
// to support — no fallback, no backfill.
//
// WHY A HARD CAP ON createdAt (E5). The window above is short, but a clock, a time zone, or a future
// `deliveredAt` written by a bug must not open a claim on a year-old order. 30 days is the ceiling, and it
// is at most the coordinate-retention window, so the evidence a claim needs still exists.

/** Spec v2 §7.1 E5 — the hard ceiling on an order's age, whatever the delivery anchor says. */
export const CLAIM_MAX_ORDER_AGE_DAYS = 30

/** The refusal codes the customer path can return. Each is rendered by an i18n key, never a raw sentence. */
export type ClaimRefusalReason =
  | 'not_owner'
  | 'not_paid'
  /** D′ L6: the order is not delivered — nothing has arrived to be judged yet. */
  | 'not_delivered'
  | 'window_expired'
  | 'active_claim'

/** Everything the rules read. The caller does the I/O; this module decides. */
export interface ClaimEligibilityFacts {
  /** The order's owner, as the database holds it. */
  orderConsumerId: string | null
  /** The session's consumer, resolved by the route — never a client-supplied id. */
  consumerId: string
  paymentStatus: string | null
  status: string
  /** Written once at the delivered transition. null ⇒ no anchor ⇒ no self-service. */
  deliveredAt: Date | null
  createdAt: Date
  /** True when a claim of this order is in an ACTIVE state (computed by the caller). */
  hasActiveClaim: boolean
  nowMs: number
  /** The submission window in hours (CLAIM_WINDOW_HOURS, 48 by default). */
  windowHours: number
  maxOrderAgeDays?: number
}

export interface ClaimRefusal {
  reason: ClaimRefusalReason
  /** The HTTP status `createClaim` answers with, so both callers agree on that too. */
  status: 403 | 409
  /**
   * Which rule refused, for the trail and the tests: a report that says « window_expired » without saying
   * whether it was the 48-hour window or the 30-day ceiling makes two very different situations look alike.
   */
  rule: 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E8'
}

/**
 * The ordered list of spec v2 §7.1. null ⇔ the claim may be filed (subject to E6, the financial ceiling,
 * which the caller computes because it needs Stripe).
 *
 * The order is load-bearing and is the spec's own: ownership first (a non-owner must learn NOTHING about
 * the order, not even that it is unpaid), then payment, then delivery, then the two time rules, and last
 * the active-claim check — which is asked last so a customer who already has a claim in flight is told
 * THAT, rather than being told the window has closed on an order they have already claimed.
 */
export function claimEligibilityRefusal(f: ClaimEligibilityFacts): ClaimRefusal | null {
  // E1 — ownership. Anti-IDOR: nothing else is evaluated, so nothing else can leak.
  if (!f.orderConsumerId || f.orderConsumerId !== f.consumerId) {
    return { reason: 'not_owner', status: 403, rule: 'E1' }
  }
  // E2 — the money must have been taken, or there is nothing to give back.
  if (f.paymentStatus !== 'paid') return { reason: 'not_paid', status: 409, rule: 'E2' }
  // E3 — delivered only (D′ L6). A paid cancellation is a SYSTEM claim and never reaches this list.
  if (f.status !== 'delivered') return { reason: 'not_delivered', status: 409, rule: 'E3' }
  // E4 — the 48-hour window, anchored on the delivery instant and on nothing else. No anchor ⇒ refused.
  if (f.deliveredAt === null) return { reason: 'window_expired', status: 409, rule: 'E4' }
  const deliveredMs = f.deliveredAt.getTime()
  if (!Number.isFinite(deliveredMs)) return { reason: 'window_expired', status: 409, rule: 'E4' }
  if (f.nowMs - deliveredMs > f.windowHours * 3600 * 1000) {
    return { reason: 'window_expired', status: 409, rule: 'E4' }
  }
  // E5 — the hard ceiling on the order's own age, whatever the anchor says.
  const maxDays = f.maxOrderAgeDays ?? CLAIM_MAX_ORDER_AGE_DAYS
  if (f.nowMs - f.createdAt.getTime() > maxDays * 24 * 3600 * 1000) {
    return { reason: 'window_expired', status: 409, rule: 'E5' }
  }
  // E8 — one active claim per order at a time.
  if (f.hasActiveClaim) return { reason: 'active_claim', status: 409, rule: 'E8' }
  return null
}

/**
 * The French sentence `createClaim` answers with, per refusal. The REASON CODE is what travels to the
 * client and is rendered from the i18n catalogue in the customer's own locale; this text is the server's
 * own log-and-API message, and it never promises or denies money — it says why the form is closed.
 */
/**
 * The fallback sentence for each code — read by a client that cannot localise the code, and by the log.
 *
 * It carries E6 (`no_refundable_amount`) too, even though E6 is NOT one of this module's pure rules: the
 * ceiling needs the order's lines and Stripe's cash truth, so it is decided in lib/claims. The SENTENCE
 * lives here all the same, because a refusal code and its wording must not drift apart across two files.
 */
export const CLAIM_REFUSAL_TEXT: Record<ClaimRefusalReason | 'no_refundable_amount', string> = {
  not_owner:     'Commande non autorisée.',
  not_paid:      'Commande non payée — aucune réclamation possible.',
  not_delivered: 'Réclamation impossible : cette commande n’est pas encore marquée livrée. Une commande en cours de livraison, ou annulée, relève du support.',
  window_expired: 'Le délai de réclamation est dépassé.',
  active_claim:  'Une réclamation est déjà en cours pour cette commande.',
  // The ceiling also subtracts a refund that is still IN FLIGHT (lib/claim-scope), so « tout a été
  // remboursé » would be false for a customer whose money is on its way back. Both cases, in one sentence.
  no_refundable_amount: 'Cette commande n’a plus de montant remboursable : son total est déjà couvert par un remboursement effectué ou en cours de traitement.',
}
