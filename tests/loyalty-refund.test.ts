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
