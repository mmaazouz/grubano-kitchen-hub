// tests/loyalty-refund.test.ts — PHASE 1 loyalty↔refund reconciliation math.
// Pure unit tests for lib/loyalty-refund.ts: no DB, no network, no Stripe.
//
// Locks the founder-decided semantics (D1 earned reversal, D2 spent restore, D3
// recovery offset) and the cumulative-target model that makes multiple partial
// refunds equal one cumulative refund with zero rounding drift.
//
// NEGATIVE CONTROLS are explicit: each proves the harness can FAIL — a naive
// per-event round drifts, a 100 %-on-partial over-restores, a reversal without
// the offset pushes the balance negative. If any negative control silently
// passed the "correct" assertion, the test would be worthless.

import { describe, it, expect } from 'vitest'
import {
  loyaltyPointsCumulative,
  loyaltyPointsDelta,
  applyReversalWithOffset,
  applyEarnWithOffsetRepay,
  planLoyaltyRefund,
  cumulativeRefundedCents,
  loyaltyConvergenceDelta,
  applyGiveBackAgainstOffset,
  type RefundEvent,
} from '@/lib/loyalty-refund'

// Canonical rehearsal-shaped order: foodTotal 14,50 € → pointsEarned 14; the
// customer spent 8 points (0,40 €) → charge.amount = 1410 cents (cash captured).
const CHARGE = 1410
const EARNED = 14
const SPENT = 8

const re = (id: string, amountCents: number, createdUnix = 0): RefundEvent => ({ id, amountCents, createdUnix })

// ── loyaltyPointsCumulative — the telescoping primitive ──────────────────────
describe('loyaltyPointsCumulative — round(base × cum/charge), clamped [0, base]', () => {
  it('0 refunded → 0; full charge refunded → the whole base', () => {
    expect(loyaltyPointsCumulative(EARNED, CHARGE, 0)).toBe(0)
    expect(loyaltyPointsCumulative(EARNED, CHARGE, CHARGE)).toBe(EARNED) // f=1 → 14
    expect(loyaltyPointsCumulative(SPENT, CHARGE, CHARGE)).toBe(SPENT)   // f=1 → 8
  })
  it('half refunded → half the base (rounded)', () => {
    expect(loyaltyPointsCumulative(EARNED, CHARGE, 705)).toBe(7) // round(14×0.5)
    expect(loyaltyPointsCumulative(SPENT, CHARGE, 705)).toBe(4)  // round(8×0.5)
  })
  it('never exceeds the base even if cumulative overshoots the charge', () => {
    expect(loyaltyPointsCumulative(EARNED, CHARGE, CHARGE + 999)).toBe(EARNED)
  })
  it('degrades safely on zero base / zero charge', () => {
    expect(loyaltyPointsCumulative(0, CHARGE, CHARGE)).toBe(0)
    expect(loyaltyPointsCumulative(EARNED, 0, 100)).toBe(0)
  })
})

// ── EARNED POINTS (D1) — matrix A/B/C ────────────────────────────────────────
describe('D1 earned reversal — matrix A/B/C', () => {
  it('A. no refund → no reversal', () => {
    expect(planLoyaltyRefund({ refunds: [], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT }))
      .toEqual([])
  })
  it('B. full refund → 100 % of earned points reversed', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', CHARGE)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p).toHaveLength(1)
    expect(p[0].earnReversal).toBe(14)
  })
  it('C. 50 % refund → only the attributable earned points reversed', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', 705)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p[0].earnReversal).toBe(7)
  })
  it('D1 precondition — nothing earned yet (refund before delivered) → 0 clawback', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', CHARGE)], chargeAmountCents: CHARGE, earnedCredited: 0, pointsRedeemed: SPENT })
    expect(p[0].earnReversal).toBe(0) // no phantom negative
  })
})

// ── EARNED — matrix D/E: multiple partials & hostile rounding = one cumulative ─
describe('D1 earned reversal — cumulative equals single refund (matrix D/E)', () => {
  it('D. two partial refunds sum to the full reversal', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', 705, 1), re('re_2', 705, 2)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p.map((e) => e.earnReversal)).toEqual([7, 7])
    expect(p.reduce((s, e) => s + e.earnReversal, 0)).toBe(14) // == single full refund
  })
  it('E. three partials with hostile cent rounding still land on the cumulative target', () => {
    // 470 × 3 = 1410. Per-event naive round(14×470/1410)=5 each → 15 (WRONG, drift).
    // Cumulative deltas: 5, 4, 5 → 14 (CORRECT).
    const p = planLoyaltyRefund({ refunds: [re('re_a', 470, 1), re('re_b', 470, 2), re('re_c', 470, 3)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p.map((e) => e.earnReversal)).toEqual([5, 4, 5])
    expect(p.reduce((s, e) => s + e.earnReversal, 0)).toBe(14)
  })
  it('NEGATIVE CONTROL — a naive per-event round DRIFTS above the target (proves the model matters)', () => {
    const naivePerEvent = [470, 470, 470].map((a) => Math.round((EARNED * a) / CHARGE))
    expect(naivePerEvent).toEqual([5, 5, 5])
    expect(naivePerEvent.reduce((s, x) => s + x, 0)).toBe(15) // 15 ≠ 14 — the drift the cumulative model removes
  })
})

// ── SPENT POINTS (D2) — matrix F/G/H ─────────────────────────────────────────
describe('D2 spent restoration — proportional, matrix F/G/H', () => {
  it('F. full refund → 100 % of spent points restored', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', CHARGE)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p[0].spentRestore).toBe(8)
  })
  it('G. partial refund → ONLY the attributable spent points restored (never 100 %)', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', 141)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    // f = 141/1410 = 0.1 → round(8 × 0.1) = 1, NOT 8.
    expect(p[0].spentRestore).toBe(1)
  })
  it('H. multiple partials → cumulative restored equals the final allocation, no repeated full restore', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', 705, 1), re('re_2', 705, 2)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p.map((e) => e.spentRestore)).toEqual([4, 4])
    expect(p.reduce((s, e) => s + e.spentRestore, 0)).toBe(8)
  })
  it('NEGATIVE CONTROL — the OLD behaviour (100 % restore on a 10 % partial) is wrong', () => {
    // The pre-Phase-1 webhook re-credited the FULL pointsRedeemed on ANY refund.
    const oldBehaviour = SPENT // 8, regardless of fraction
    const correct = planLoyaltyRefund({ refunds: [re('re_1', 141)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })[0].spentRestore
    expect(oldBehaviour).toBe(8)
    expect(correct).toBe(1)
    expect(correct).not.toBe(oldBehaviour) // the bug this phase fixes
  })
})

// ── D3 recovery offset — matrix L/M/N ────────────────────────────────────────
describe('D3 recovery offset — earned-already-spent (matrix L/M/N)', () => {
  it('L. reversal exceeds available balance → floor at 0, remainder becomes offset', () => {
    const { balanceDecrement, offsetIncrease } = applyReversalWithOffset(14, 6) // reverse 14, only 6 available
    expect(balanceDecrement).toBe(6)   // balance 6 → 0, never negative
    expect(offsetIncrease).toBe(8)     // 8 unrecovered → internal debt
  })
  it('L. reversal within balance → no offset', () => {
    expect(applyReversalWithOffset(7, 20)).toEqual({ balanceDecrement: 7, offsetIncrease: 0 })
  })
  it('M. a future earning repays the offset first, only the remainder is spendable', () => {
    const { offsetRepaid, spendableIncrement, newOffset } = applyEarnWithOffsetRepay(10, 8)
    expect(offsetRepaid).toBe(8)
    expect(spendableIncrement).toBe(2)
    expect(newOffset).toBe(0)
  })
  it('N. offset reaches zero exactly once — no over-recovery across earnings', () => {
    let offset = 8
    let spendable = 0
    for (const earn of [3, 3, 3]) { // 9 earned across 3 orders vs 8 debt
      const r = applyEarnWithOffsetRepay(earn, offset)
      offset = r.newOffset
      spendable += r.spendableIncrement
    }
    expect(offset).toBe(0)     // debt cleared, never negative
    expect(spendable).toBe(1)  // 9 earned − 8 debt = 1 spendable
  })
  it('NEGATIVE CONTROL — without the offset split, the balance would go negative', () => {
    const naiveBalance = 6 - 14 // reverse 14 from a balance of 6
    expect(naiveBalance).toBe(-8)            // the forbidden visible-negative state
    expect(applyReversalWithOffset(14, 6).balanceDecrement).toBe(6) // our floor keeps it at 0
  })
})

// ── IDEMPOTENCY / ordering (pure side) — matrix S/T ──────────────────────────
describe('idempotency & ordering (matrix S/T)', () => {
  it('S. two DIFFERENT partial refunds produce two distinct keyed effects', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', 705, 1), re('re_2', 705, 2)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p.map((e) => e.sourceEventId)).toEqual(['re_1', 're_2'])
    expect(new Set(p.map((e) => e.sourceEventId)).size).toBe(2) // distinct keys → both applied once
  })
  it('T. out-of-order webhook listing → deterministic prefix sums (sorted by created,id)', () => {
    const inOrder = planLoyaltyRefund({ refunds: [re('re_a', 470, 1), re('re_b', 470, 2), re('re_c', 470, 3)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    const shuffled = planLoyaltyRefund({ refunds: [re('re_c', 470, 3), re('re_a', 470, 1), re('re_b', 470, 2)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(shuffled).toEqual(inOrder) // same final per-id deltas regardless of input order
  })
  it('a zero-amount refund contributes nothing', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_0', 0)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p).toEqual([])
  })
})

// ══ L6.1 — CONVERGENCE TO THE CUMULATIVE TARGET (founder decision, option (a)) ═════════════════════
//
// The per-event model above is exact only for a writer that sees the whole set at once. L6.1 makes the
// reconciliation converge instead: target(proven set) − already applied. These are the ARITHMETIC pins;
// the DB-level proof (rows, balance, idempotency key, concurrency) is in tests/loyalty-refund-apply.
describe('L6.1 cumulativeRefundedCents — the proven set reduced to ONE order-independent number', () => {
  it('sums the amounts', () => {
    expect(cumulativeRefundedCents([re('re_a', 470), re('re_b', 470), re('re_c', 470)])).toBe(1410)
  })

  it('⭐ the same re_ reported TWICE counts ONCE (our Refund row and the ledger line are one refund)', () => {
    // §24 (3): the DB-known set is the union of our rows and the ledger lines. The same refund appears in
    // both. Summing it twice would double the cumulative and over-reverse the customer's points.
    expect(cumulativeRefundedCents([re('re_a', 470), re('re_a', 470)])).toBe(470)
  })

  it('⭐ on a duplicated id with DIFFERENT amounts, the LARGER wins — a source that under-reports cannot lower the cumulative', () => {
    expect(cumulativeRefundedCents([re('re_a', 200), re('re_a', 470)])).toBe(470)
    expect(cumulativeRefundedCents([re('re_a', 470), re('re_a', 200)])).toBe(470)
  })

  it('⭐ ORDER-INDEPENDENT: every permutation of the same set gives the same number', () => {
    const s = [re('re_a', 470, 3), re('re_b', 470, 1), re('re_c', 470, 2)]
    const perms = [
      [s[0], s[1], s[2]], [s[0], s[2], s[1]], [s[1], s[0], s[2]],
      [s[1], s[2], s[0]], [s[2], s[0], s[1]], [s[2], s[1], s[0]],
    ]
    for (const p of perms) expect(cumulativeRefundedCents(p)).toBe(1410)
  })

  it('a zero, negative, fractional or unnamed amount is not a refund', () => {
    expect(cumulativeRefundedCents([re('re_0', 0), re('re_neg', -100), re('', 500)])).toBe(0)
    expect(cumulativeRefundedCents([re('re_f', 470.9)])).toBe(470) // floored, never rounded up
  })

  it('the empty set is 0', () => {
    expect(cumulativeRefundedCents([])).toBe(0)
  })
})

describe('L6.1 applyGiveBackAgainstOffset — the INVERSE claimed by §13, actually exercised', () => {
  // The code and the contract both call this "the exact arithmetic inverse of applyReversalWithOffset". A
  // claim like that is worth nothing unless a test walks the round trip, so here it is — and its PRECONDITION
  // is stated rather than assumed: the inverse returns to the starting state when the debt handed to the
  // give-back is the debt THAT reversal created. On a customer-level pool holding another order's debt it is
  // not an inverse at all, which is exactly why the writer bounds the release (see loyalty-refund-apply).
  const roundTrip = (points: number, balance: number) => {
    const rev = applyReversalWithOffset(points, balance)
    const afterBalance = balance - rev.balanceDecrement
    const afterOffset = rev.offsetIncrease
    const back = applyGiveBackAgainstOffset(points, afterOffset)
    return {
      balance: afterBalance + back.balanceIncrement,
      offset:  afterOffset - back.offsetDecrement,
      rev, back,
    }
  }

  it('⭐ reverse then give back the SAME amount returns to the starting state — balance and debt', () => {
    for (const balance of [0, 1, 3, 5, 13, 14, 100]) {
      for (const points of [0, 1, 5, 14, 20]) {
        const t = roundTrip(points, balance)
        expect(t.balance, `bal=${balance} pts=${points}`).toBe(balance)
        expect(t.offset, `bal=${balance} pts=${points}`).toBe(0)
      }
    }
  })

  it('⭐ the three shapes, explicitly: no spill, full spill, partial spill', () => {
    // No spill — the balance covered it, so the debt is untouched in both directions.
    expect(applyReversalWithOffset(5, 100)).toEqual({ balanceDecrement: 5, offsetIncrease: 0 })
    expect(applyGiveBackAgainstOffset(5, 0)).toEqual({ offsetDecrement: 0, balanceIncrement: 5 })
    // Full spill — nothing to take, so all of it became debt, and all of it comes off the debt.
    expect(applyReversalWithOffset(5, 0)).toEqual({ balanceDecrement: 0, offsetIncrease: 5 })
    expect(applyGiveBackAgainstOffset(5, 5)).toEqual({ offsetDecrement: 5, balanceIncrement: 0 })
    // Partial spill — 3 taken, 2 owed; the give-back clears the 2 owed FIRST, then credits the 3.
    expect(applyReversalWithOffset(5, 3)).toEqual({ balanceDecrement: 3, offsetIncrease: 2 })
    expect(applyGiveBackAgainstOffset(5, 2)).toEqual({ offsetDecrement: 2, balanceIncrement: 3 })
  })

  it('⭐ NEGATIVE CONTROL — crediting the balance and IGNORING the debt does NOT round-trip', () => {
    // The tempting simplification: "just give the points back to the balance, leave the debt alone." The
    // customer then holds the points AND still owes them — they would repay from a future earning points they
    // were never supposed to lose. This is the arithmetic of that mistake.
    const balance = 0, points = 5
    const rev = applyReversalWithOffset(points, balance)   // { 0, 5 }
    const naiveBalance = balance - rev.balanceDecrement + points  // 5
    const naiveOffset = rev.offsetIncrease                        // still 5
    expect(naiveBalance).toBe(5)
    expect(naiveOffset, 'the debt survives — 5 points owed on points already returned').toBe(5)
    expect(naiveBalance - naiveOffset, 'the customer is 5 points worse off than they started').toBe(0)
    expect(roundTrip(points, balance)).toMatchObject({ balance: 0, offset: 0 })
  })

  it('the give-back never returns more than it was asked for, and never goes negative', () => {
    expect(applyGiveBackAgainstOffset(0, 9)).toEqual({ offsetDecrement: 0, balanceIncrement: 0 })
    expect(applyGiveBackAgainstOffset(-5, 9)).toEqual({ offsetDecrement: 0, balanceIncrement: 0 })
    expect(applyGiveBackAgainstOffset(3, -9)).toEqual({ offsetDecrement: 0, balanceIncrement: 3 })
    const r = applyGiveBackAgainstOffset(2.9, 1.9)
    expect(r.offsetDecrement + r.balanceIncrement, 'floored, never rounded up').toBe(2)
  })
})

describe('L6.1 loyaltyConvergenceDelta — target minus what is REALLY applied', () => {
  const d = (cum: number, applied: number, base = EARNED) =>
    loyaltyConvergenceDelta({ base, chargeAmountCents: CHARGE, cumRefundedCents: cum, appliedPoints: applied })

  it('⭐ THE FOUNDER SEQUENCE — 470 ⇒ 5 ; an OLDER 470 lands ⇒ 4 (total 9, NOT 10) ; a third ⇒ 5 (total 14)', () => {
    // Step 1: one refund proven, nothing applied yet.
    expect(d(470, 0)).toBe(5)
    // Step 2: the cumulative is 940 and 5 is already applied. round(14×940/1410) = 9 ⇒ 4 more.
    expect(d(940, 5)).toBe(4)
    expect(5 + 4).toBe(9)
    // Step 3: full charge refunded, 9 applied ⇒ 5 more, total exactly the base.
    expect(d(1410, 9)).toBe(5)
    expect(5 + 4 + 5).toBe(EARNED)
  })

  it('⭐ the per-event model is what produced 10: this is the arithmetic that replaces it', () => {
    // The OLD behaviour, reproduced here so the regression is visible, not described: the later refund's
    // delta was priced from a cumulative of ZERO, and the earlier one then priced its own from zero too.
    const oldLate = loyaltyPointsDelta(EARNED, CHARGE, 0, 470)   // 5, written first
    const oldEarly = loyaltyPointsDelta(EARNED, CHARGE, 0, 470)  // 5 again — its prefix was empty
    expect(oldLate + oldEarly).toBe(10)
    // The convergence never books a second 5: it asks what the TOTAL should be.
    expect(d(940, oldLate)).toBe(4)
    expect(oldLate + d(940, oldLate)).toBe(9)
  })

  it('⭐ AT THE TARGET THE DELTA IS ZERO — this is what makes a replay write nothing', () => {
    expect(d(470, 5)).toBe(0)
    expect(d(940, 9)).toBe(0)
    expect(d(1410, 14)).toBe(0)
    expect(d(0, 0)).toBe(0)
  })

  it('⭐ ANY ARRIVAL ORDER of the same three refunds converges on 14', () => {
    const AMOUNTS = [470, 470, 470]
    // Whatever order the three become provable in, the cumulative after k of them is the same, so the
    // running total of the deltas is too.
    for (const path of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
      let applied = 0
      let cum = 0
      for (const i of path) {
        cum += AMOUNTS[i]
        applied += d(cum, applied)
      }
      expect(applied, path.join('>')).toBe(EARNED)
    }
  })

  it('⭐ a NEGATIVE delta when more was applied than the target — the L6 over-application, corrected', () => {
    // The state the per-event code could leave: 10 booked, cumulative 940, target 9.
    expect(d(940, 10)).toBe(-1)
    // …and after that one-point give-back, it is converged and stays silent.
    expect(d(940, 9)).toBe(0)
  })

  it('a partial then a total refund lands exactly on the base, never past it', () => {
    let applied = 0
    applied += d(705, applied)          // 7
    expect(applied).toBe(7)
    applied += d(CHARGE, applied)       // +7
    expect(applied).toBe(EARNED)
    // An overshooting cumulative cannot push it further.
    expect(d(CHARGE + 500, applied)).toBe(0)
  })

  it('the SPENT side (D2) converges on the same rule with its own base', () => {
    let applied = 0
    applied += d(470, applied, SPENT)   // round(8×470/1410) = 3
    expect(applied).toBe(3)
    applied += d(940, applied, SPENT)   // round(8×940/1410) = 5 ⇒ +2
    expect(applied).toBe(5)
    applied += d(CHARGE, applied, SPENT)
    expect(applied).toBe(SPENT)
  })

  it('with nothing credited (the D-15 shape before delivery) the target is 0 whatever is refunded', () => {
    expect(d(CHARGE, 0, 0)).toBe(0)
    // …and once the earning is credited, the same cumulative asks for the whole clawback in one go.
    expect(d(CHARGE, 0, EARNED)).toBe(EARNED)
  })

  it('NEGATIVE CONTROL — summing per-event deltas over an out-of-order prefix DOES drift, which is why this exists', () => {
    // If this ever stops drifting, the pin above is no longer testing anything.
    const perEvent = loyaltyPointsDelta(EARNED, CHARGE, 0, 470) + loyaltyPointsDelta(EARNED, CHARGE, 0, 470)
    expect(perEvent).not.toBe(loyaltyPointsCumulative(EARNED, CHARGE, 940))
    expect(perEvent - loyaltyPointsCumulative(EARNED, CHARGE, 940)).toBe(1)
  })

  it('⭐ EXHAUSTIVE — for every cumulative from 0 to the charge, target − applied lands exactly on the target', () => {
    for (let cum = 0; cum <= CHARGE; cum += 7) {
      const target = loyaltyPointsCumulative(EARNED, CHARGE, cum)
      for (const applied of [0, 1, 5, 7, 9, 13, 14, 20]) {
        expect(applied + d(cum, applied), `cum=${cum} applied=${applied}`).toBe(target)
      }
    }
  })
})

// ── MIXED FUNDING invariant (matrix I/J) — points move, cash is capped elsewhere
describe('mixed funding — points-only, cash cap is structural (matrix I/J)', () => {
  it('an order that spent points: full refund restores exactly the spent points, reverses exactly the earned', () => {
    const p = planLoyaltyRefund({ refunds: [re('re_1', CHARGE)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p[0]).toMatchObject({ earnReversal: 14, spentRestore: 8 })
    // The cash side is NOT this module's job: charge.amount (1410) is the Stripe cap;
    // the loyalty-funded 40 c was never charged, so it can never be refunded as cash.
  })
  it('J. an item-level partial (fraction of charge) allocates points by the same fraction', () => {
    // A 3,53 € item refund on a 14,10 € charge ≈ 25 %.
    const p = planLoyaltyRefund({ refunds: [re('re_1', 353)], chargeAmountCents: CHARGE, earnedCredited: EARNED, pointsRedeemed: SPENT })
    expect(p[0].earnReversal).toBe(Math.round((EARNED * 353) / CHARGE)) // 4
    expect(p[0].spentRestore).toBe(Math.round((SPENT * 353) / CHARGE))  // 2
  })
})
