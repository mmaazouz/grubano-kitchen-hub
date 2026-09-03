// lib/loyalty-refund.ts — PHASE 1 loyalty↔refund reconciliation, PURE + integer-exact.
//
// No DB, no network, no Stripe. Every function is a total, deterministic,
// cent/point-exact mapping — locked by tests/loyalty-refund.test.ts.
//
// ── DOCTRINE (founder decisions, locked 2026-09-02) ───────────────────────────
//  D1  Points EARNED from a purchase later refunded are REVERSED proportionally
//      to the refunded value (full → 100 %, partial → the attributable part).
//  D2  Points SPENT as payment are RESTORED proportionally (never 100 % on a
//      partial refund). The server computes it; the browser never dictates it.
//  D3  If earned points were already spent elsewhere, the reversal floors the
//      visible balance at 0 and the unrecovered remainder becomes an INTERNAL
//      recovery OFFSET (debt); future EARNINGS repay the offset first.
//
// ── FUNDING INVARIANT (why we prorate on CASH, not foodTotal) ─────────────────
//  Loyalty is GRUBANO-financed: the loyalty credit already REDUCED order.total at
//  creation, so the cash captured by Stripe = order.total = charge.amount, and
//  the loyalty-funded value was NEVER charged. The cash a refund can return is
//  therefore structurally capped by Stripe (charge.amount − amount_refunded).
//  The POINTS effects here prorate on the SAME cash quantity — the cumulative
//  refund fraction f = charge.amount_refunded / charge.amount — so points and
//  cash unwind by the identical fraction. Prorating on the pre-credit foodTotal
//  would desync points from the cash actually refunded on any order that spent
//  points. Points are NEVER converted to cash here; this module moves points only.
//
// ── CUMULATIVE-TARGET MODEL (drift-free across multiple partial refunds) ───────
//  Exactly the telescoping of lib/refund.ts computeRefundSplit: the loyalty state
//  is reconciled to the cumulative target for the cumulative refunded amount, and
//  each refund event contributes the DELTA between two rounded cumulative targets.
//  Because the target at full refund rounds to the whole integer base
//  (pointsEarned / pointsRedeemed), partial A + partial B + partial C land on
//  exactly the same final state as one equivalent cumulative refund — the sum of
//  deltas telescopes, no per-event rounding drift.

/** Cumulative points target for a refunded-so-far amount, mirroring feeCum() in
 *  computeRefundSplit: round(base × cumRefunded / chargeAmount), clamped to [0, base].
 *  `base` is pointsEarned (D1) or pointsRedeemed (D2). All integer cents in. */
export function loyaltyPointsCumulative(
  base: number,
  chargeAmountCents: number,
  cumRefundedCents: number,
): number {
  const b = Math.max(0, Math.floor(base))
  const T = Math.max(0, Math.floor(chargeAmountCents))
  if (b === 0 || T === 0) return 0
  const c = Math.min(Math.max(0, Math.floor(cumRefundedCents)), T) // never past full charge
  const target = Math.round((b * c) / T)
  return Math.min(target, b) // never reverse/restore more than the base
}

/** The per-refund-event DELTA for a points base: the cumulative target THROUGH
 *  this refund minus the cumulative target through the PREVIOUS refund (the two
 *  prefix sums of refund amounts in a deterministic order). Non-negative because
 *  cumThrough ≥ cumPrev and loyaltyPointsCumulative is monotone. */
export function loyaltyPointsDelta(
  base: number,
  chargeAmountCents: number,
  cumRefundedThroughPrevCents: number,
  cumRefundedThroughThisCents: number,
): number {
  const through = loyaltyPointsCumulative(base, chargeAmountCents, cumRefundedThroughThisCents)
  const prev = loyaltyPointsCumulative(base, chargeAmountCents, cumRefundedThroughPrevCents)
  return Math.max(0, through - prev)
}

/** D3 — apply a points REVERSAL (earned-point clawback) against a balance that
 *  must never go visibly negative. Reverse up to the available balance; the
 *  unrecovered remainder becomes recovery offset (internal debt). Caller applies
 *  {balanceDecrement, offsetIncrease} atomically. */
export function applyReversalWithOffset(
  reversalPoints: number,
  availableBalance: number,
): { balanceDecrement: number; offsetIncrease: number } {
  const r = Math.max(0, Math.floor(reversalPoints))
  const bal = Math.max(0, Math.floor(availableBalance))
  const balanceDecrement = Math.min(r, bal)
  const offsetIncrease = r - balanceDecrement
  return { balanceDecrement, offsetIncrease }
}

/** D3 — a FUTURE earning first repays the recovery offset, only the remainder is
 *  spendable. Caller applies {offsetRepaid, spendableIncrement} atomically and
 *  sets the new offset = currentOffset − offsetRepaid. */
export function applyEarnWithOffsetRepay(
  earnedPoints: number,
  currentOffset: number,
): { offsetRepaid: number; spendableIncrement: number; newOffset: number } {
  const e = Math.max(0, Math.floor(earnedPoints))
  const off = Math.max(0, Math.floor(currentOffset))
  const offsetRepaid = Math.min(e, off)
  const spendableIncrement = e - offsetRepaid
  return { offsetRepaid, spendableIncrement, newOffset: off - offsetRepaid }
}

/** A succeeded Stripe refund reduced to the fields the reconciliation needs.
 *  `id` is the immutable re_… — the idempotency source event (one loyalty effect
 *  per (id, type)). `amountCents` is that refund object's own amount. */
export interface RefundEvent {
  id: string
  amountCents: number
  createdUnix: number
}

export interface LoyaltyRefundPlanInput {
  /** All succeeded refunds currently on the charge (order-independent). */
  refunds: RefundEvent[]
  /** charge.amount = order.total captured = the cash cap. */
  chargeAmountCents: number
  /** Order.pointsEarned actually credited (0 if not yet delivered → no clawback). */
  earnedCredited: number
  /** Order.pointsRedeemed spent on the order. */
  pointsRedeemed: number
}

export interface LoyaltyRefundEffect {
  sourceEventId: string // the refund re_… id
  earnReversal: number  // points to reverse (≥ 0) attributable to THIS refund
  spentRestore: number  // points to restore (≥ 0) attributable to THIS refund
}

/** Build the deterministic per-refund reconciliation plan. Refunds are sorted by
 *  (createdUnix, id) so prefix sums — and therefore every per-event delta — are
 *  stable regardless of the order Stripe lists them or the order webhooks arrive.
 *  Each effect is keyed by its refund id; the caller persists it idempotently and
 *  skips any (sourceEventId, type) already applied. The sum of earnReversal over
 *  all refunds telescopes to loyaltyPointsCumulative(earnedCredited, charge, total
 *  refunded); likewise spentRestore — so multiple partials equal one cumulative. */
export function planLoyaltyRefund(input: LoyaltyRefundPlanInput): LoyaltyRefundEffect[] {
  const T = Math.max(0, Math.floor(input.chargeAmountCents))
  const earned = Math.max(0, Math.floor(input.earnedCredited))
  const spent = Math.max(0, Math.floor(input.pointsRedeemed))
  const sorted = [...input.refunds]
    .filter((r) => Math.floor(r.amountCents) > 0)
    .sort((a, b) => a.createdUnix - b.createdUnix || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const effects: LoyaltyRefundEffect[] = []
  let cumPrev = 0
  for (const r of sorted) {
    const cumThis = cumPrev + Math.floor(r.amountCents)
    effects.push({
      sourceEventId: r.id,
      earnReversal: loyaltyPointsDelta(earned, T, cumPrev, cumThis),
      spentRestore: loyaltyPointsDelta(spent, T, cumPrev, cumThis),
    })
    cumPrev = cumThis
  }
  return effects
}
