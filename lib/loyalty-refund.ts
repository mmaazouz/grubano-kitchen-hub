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
//
// ── L6.1 — CONVERGENCE, NOT TELESCOPING (founder decision, option (a), 2026-09-25) ─
//  The telescoping above is exact only for a writer that sees the WHOLE refund set in
//  one pass. It is NOT: a Dashboard refund's webhook can land after a rail refund's
//  row is written, so an EARLIER refund can become provable AFTER a later one — and a
//  per-event delta, once written, is never recomputed. Measured on real arithmetic:
//  T=1410, E=14, two refunds of 470. The later one visible alone ⇒ its delta is priced
//  from a cumulative of zero (5). The earlier one lands, sorts first, and books 5 too
//  ⇒ 10 booked where the cumulative target for 940 refunded is round(14×940/1410) = 9.
//
//  The founder's ruling: the reconciliation CONVERGES TO THE TARGET instead of summing
//  per-event deltas. Each pass computes the target for the set currently PROVEN, reads
//  the effect ALREADY REALLY APPLIED, and writes only the difference. That makes it
//  order-independent (the target depends on the SUM, not the sequence), idempotent (at
//  the target the difference is 0 and nothing is written), convergent (any arrival
//  order lands on the same state), and safe when an older refund shows up late. Past
//  rows are never rewritten — the correction is a new, keyed, compensating row.
//
//  `loyaltyPointsDelta` and `planLoyaltyRefund` below are KEPT: they are the pure
//  statement of the per-event model, they are what the refund-gate operator's expected
//  vector mirrors, and for an in-order prefix Σ(deltas) == the target. They are no
//  longer what persists the effect — see cumulativeRefundedCents/loyaltyConvergenceDelta
//  and lib/loyalty-refund-apply.

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

/**
 * L6.1 — the proven refund set reduced to the ONE number the target depends on.
 *
 * Deduplicated by the Stripe refund id, so the same `re_` reported by two sources (our own `Refund` row
 * AND the ledger line the webhook wrote from Stripe's object) counts ONCE; summed, so the result cannot
 * depend on the order the events were seen in. Non-positive amounts are not refunds and are dropped.
 */
export function cumulativeRefundedCents(refunds: readonly RefundEvent[]): number {
  const seen = new Map<string, number>()
  for (const r of refunds) {
    if (!r || typeof r.id !== 'string' || r.id === '') continue
    const cents = Math.floor(Number(r.amountCents))
    if (!Number.isFinite(cents) || cents <= 0) continue
    // Same id twice ⇒ ONE refund. Keep the LARGER amount: a source that under-reports an amount must not
    // be able to lower the cumulative — the ceiling is applied later by loyaltyPointsCumulative anyway.
    const prev = seen.get(r.id)
    if (prev === undefined || cents > prev) seen.set(r.id, cents)
  }
  let total = 0
  // Array.from, not a for…of over the iterator: this file compiles under an ES5 target (TS2802).
  for (const cents of Array.from(seen.values())) total += cents
  return total
}

/**
 * L6.1 — the SIGNED adjustment that takes an already-applied loyalty effect to the cumulative target.
 *
 * `appliedPoints` is the effect REALLY applied so far, as a non-negative magnitude (Σ of the points
 * clawed back, or Σ of the points restored) — measured from the ledger, never assumed from the events.
 * The result is `target − applied`:
 *   > 0  the target is not reached yet ⇒ apply that much more ;
 *   = 0  converged ⇒ the caller writes NOTHING (this is what makes a replay free) ;
 *   < 0  MORE was applied than the target ⇒ give exactly that much back. Reachable in real data: rows
 *        written by the pre-L6.1 per-event code can over-apply by one point, and the target itself moves
 *        when the base or the charge amount is corrected.
 */
export function loyaltyConvergenceDelta(input: {
  /** pointsEarned actually credited (D1) or pointsRedeemed (D2). */
  base: number
  chargeAmountCents: number
  /** Σ of the proven refunds, deduplicated — see cumulativeRefundedCents. */
  cumRefundedCents: number
  /** The magnitude already applied, read from the ledger. */
  appliedPoints: number
}): number {
  const target = loyaltyPointsCumulative(input.base, input.chargeAmountCents, input.cumRefundedCents)
  const applied = Math.floor(Number(input.appliedPoints))
  return target - (Number.isFinite(applied) ? applied : 0)
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

/**
 * L6.1 — the EXACT INVERSE of `applyReversalWithOffset`, for a convergence that has to GIVE BACK points.
 *
 * It is not a new policy and it must never become one: a clawback that exceeded the visible balance put the
 * unrecovered remainder into the recovery offset (a debt), so undoing part of that clawback has to take the
 * debt back off FIRST and only then credit the spendable balance. Credit the balance without touching the
 * debt and the customer holds the points AND still owes them — they would repay from a future earning points
 * they were never supposed to lose. The round-trip property (reverse, then give back the same amount, returns
 * to the starting state) is walked in tests/loyalty-refund.test.ts, together with the negative control that
 * shows the naive "credit the balance and leave the debt" does NOT round-trip.
 *
 * ITS PRECONDITION, stated because it is not automatic: this is an inverse of THAT reversal only when the
 * debt handed in is the debt that reversal created. `recoveryOffsetPoints` is a CUSTOMER-level pool and can
 * hold other orders' debt, and repaying that would write off something genuinely owed — so the CALLER is
 * responsible for bounding the debt it passes here (lib/loyalty-refund-apply bounds it by the order's own
 * clawback total). Full attribution would need the per-row spill, which this schema does not store: a T-44
 * item, reported and never silently assumed away.
 *
 * The D3 RULE itself is untouched: only future EARNINGS repay a debt that is genuinely owed. This function
 * only unwinds a debt that this very reconciliation had booked in error. Its use is reported (T-44).
 */
export function applyGiveBackAgainstOffset(
  giveBackPoints: number,
  currentOffset: number,
): { offsetDecrement: number; balanceIncrement: number } {
  const g = Math.max(0, Math.floor(giveBackPoints))
  const off = Math.max(0, Math.floor(currentOffset))
  const offsetDecrement = Math.min(g, off)
  return { offsetDecrement, balanceIncrement: g - offsetDecrement }
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
