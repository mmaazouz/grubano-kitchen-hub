import { describe, it, expect } from 'vitest'

// ── PHASE 2 (final hardening, F2 CLOSED) — lib/refund-fee-truth ─────────────────────
// FOUNDER INVARIANT: Stripe ACTUAL financial truth == Grubano ledger truth. The ledger
// books ONLY Stripe's actual fee refunds (0 when none) and actual transfer reversals
// (0 when none). A proration prediction may exist only as an EXPECTATION / MONEY REVIEW,
// never as a settled ledger amount. In EVERY attribution mode Σ booked == Σ Stripe fee refunds.

import { matchFeeRefunds, predictFeeRefund, refundLedgerLine } from '@/lib/refund-fee-truth'

const r = (id: string, amount: number, created: number) => ({ id, amount, created })
const f = (amount: number, created: number) => ({ amount, created })
const sum = (m: Map<string, number>) => Array.from(m.values()).reduce((a, b) => a + b, 0)

describe('matchFeeRefunds — actual truth only', () => {
  it('NO fee refund at all (external refund without refund_application_fee) → mode none, every refund books 0', () => {
    const m = matchFeeRefunds([r('re_x', 2500, 10)], [], 600, 5000)
    expect(m.mode).toBe('none')
    expect(m.byRefundId.get('re_x')).toBe(0)
    expect(sum(m.byRefundId)).toBe(0)
  })

  it('single refund WITH an actual fee refund → Stripe truth, even when it deviates from the prediction', () => {
    const m = matchFeeRefunds([r('re_1', 5000, 10)], [f(601, 10)], 600, 5000)
    expect(m.mode).toBe('stripe')
    expect(m.byRefundId.get('re_1')).toBe(601)
  })

  it('two refunds, ONE fee refund (one issued without the flag) → the fee refund is attributed to the refund whose proration matches; the other books 0; Σ exact', () => {
    // re_1 (engine, with fee refund 300) then re_2 (external, no fee refund).
    const m = matchFeeRefunds([r('re_1', 2500, 10), r('re_2', 1000, 20)], [f(300, 10)], 600, 5000)
    expect(m.mode).toBe('matched')
    expect(m.byRefundId.get('re_1')).toBe(300)
    expect(m.byRefundId.get('re_2')).toBe(0)
    expect(sum(m.byRefundId)).toBe(300)
  })

  it('external refund WITHOUT fee refund FIRST, then an engine refund WITH one → attribution by amount, not by position', () => {
    const m = matchFeeRefunds([r('re_ext', 1000, 10), r('re_eng', 2500, 20)], [f(300, 20)], 600, 5000)
    expect(m.byRefundId.get('re_ext')).toBe(0)
    expect(m.byRefundId.get('re_eng')).toBe(300)
    expect(sum(m.byRefundId)).toBe(300)
  })

  it('distinct seconds, counts equal → chronological index match (Stripe truth)', () => {
    const m = matchFeeRefunds([r('re_b', 1000, 20), r('re_a', 4000, 10)], [f(120, 20), f(480, 10)], 600, 5000)
    expect(m.mode).toBe('stripe')
    expect(m.byRefundId.get('re_a')).toBe(480)
    expect(m.byRefundId.get('re_b')).toBe(120)
  })

  it('same-second ties, every slice within ±1 c → index match accepted', () => {
    const m = matchFeeRefunds([r('re_1', 2500, 10), r('re_2', 2500, 10)], [f(301, 10), f(299, 10)], 600, 5000)
    expect(m.mode).toBe('stripe')
    expect(Array.from(m.byRefundId.values()).sort()).toEqual([299, 301])
  })

  it('same-second ties with swapped amounts → attribution by matching amount (no swap frozen), Σ exact', () => {
    const m = matchFeeRefunds([r('re_1', 1000, 10), r('re_2', 4000, 10)], [f(480, 10), f(120, 10)], 600, 5000)
    expect(m.mode).toBe('matched')
    expect(m.byRefundId.get('re_1')).toBe(120)
    expect(m.byRefundId.get('re_2')).toBe(480)
    expect(sum(m.byRefundId)).toBe(600)
  })

  it('a fee refund matching NO refund (manual fee refund from the Dashboard) → still booked (residual) so Σ == Stripe Σ, flagged', () => {
    const m = matchFeeRefunds([r('re_1', 2500, 10)], [f(300, 10), f(50, 30)], 600, 5000)
    expect(m.mode).toBe('residual')
    expect(m.residualCents).toBe(50)
    expect(m.byRefundId.get('re_1')).toBe(350)
    expect(sum(m.byRefundId)).toBe(350)
  })

  it('[review #2] counts equal, NO ties, but the index pairing contradicts the amounts → general attribution, never a blind index match', () => {
    // A (2500, no fee refund) then B (1000, fr 120), plus a manual fee refund of 50 later:
    // a blind index match would book A←120, B←50. Truth: A 0, B 120 + residual 50 = 170.
    const m = matchFeeRefunds([r('A', 2500, 10), r('B', 1000, 20)], [f(120, 20), f(50, 30)], 600, 5000)
    expect(m.mode).toBe('residual')
    expect(m.byRefundId.get('A')).toBe(0)
    expect(m.byRefundId.get('B')).toBe(170)
    expect(m.residualCents).toBe(50)
    expect(sum(m.byRefundId)).toBe(170)
  })

  it('odd partials whose fee refunds follow the cumulative rule exactly → stripe index match, Σ == F', () => {
    const m = matchFeeRefunds([r('a', 333, 1), r('b', 333, 2), r('c', 333, 3), r('d', 4001, 4)], [f(60, 1), f(60, 2), f(60, 3), f(720, 4)], 900, 5000)
    expect(m.mode).toBe('stripe')
    expect(sum(m.byRefundId)).toBe(900)
    // …and a deviating slice on the same fixture is NOT index-matched blindly:
    const m2 = matchFeeRefunds([r('a', 333, 1), r('b', 333, 2), r('c', 333, 3), r('d', 4001, 4)], [f(60, 1), f(60, 2), f(60, 3), f(500, 4)], 900, 5000)
    expect(m2.mode).not.toBe('stripe')
    expect(sum(m2.byRefundId)).toBe(680)
  })

  it('⭐ negative control — the OLD prorata fallback would have booked 300 for a refund Stripe never fee-refunded', () => {
    const m = matchFeeRefunds([r('re_x', 2500, 10)], [], 600, 5000)
    expect(predictFeeRefund(600, 5000, 2500)).toBe(300) // the expectation still exists…
    expect(m.byRefundId.get('re_x')).toBe(0)             // …but is never booked
  })

  it('predictFeeRefund = documented proration, rounded; zero when no fee or no charge', () => {
    expect(predictFeeRefund(600, 5000, 2500)).toBe(300)
    expect(predictFeeRefund(900, 5000, 333)).toBe(60)
    expect(predictFeeRefund(0, 5000, 2500)).toBe(0)
    expect(predictFeeRefund(600, 0, 2500)).toBe(0)
  })

  it('inputs are never mutated (pure)', () => {
    const refunds = [r('re_2', 1, 20), r('re_1', 1, 10)]
    const fees = [f(1, 20), f(1, 10)]
    matchFeeRefunds(refunds, fees, 10, 100)
    expect(refunds.map((x) => x.id)).toEqual(['re_2', 're_1'])
    expect(fees.map((x) => x.created)).toEqual([20, 10])
  })
})

describe('refundLedgerLine — the compensating line from ACTUAL movements (gross = fee + net)', () => {
  it('engine refund: reversal = amount, fee refund actual → net −(a − fr), fee −fr', () => {
    const l = refundLedgerLine({ amountCents: 2500, reversalCents: 2500, feeRefundCents: 300 })
    expect(l).toEqual({ grossAmount: -2500, applicationFeeAmount: -300, netToRestaurant: -2200 })
    expect(l.grossAmount).toBe(l.applicationFeeAmount + l.netToRestaurant)
  })
  it('external refund WITHOUT reverse_transfer and WITHOUT fee refund → restaurant 0, platform bore all', () => {
    const l = refundLedgerLine({ amountCents: 2500, reversalCents: 0, feeRefundCents: 0 })
    expect(l).toEqual({ grossAmount: -2500, applicationFeeAmount: -2500, netToRestaurant: 0 })
    expect(l.grossAmount).toBe(l.applicationFeeAmount + l.netToRestaurant)
  })
  it('external refund WITH reverse_transfer but WITHOUT fee refund → restaurant −a, Grubano 0', () => {
    const l = refundLedgerLine({ amountCents: 2500, reversalCents: 2500, feeRefundCents: 0 })
    expect(l).toEqual({ grossAmount: -2500, applicationFeeAmount: 0, netToRestaurant: -2500 })
  })
  it('partial reversal (proportional on a partial-amount transfer) → exact actual cents', () => {
    const l = refundLedgerLine({ amountCents: 1000, reversalCents: 877, feeRefundCents: 60 })
    expect(l).toEqual({ grossAmount: -1000, applicationFeeAmount: -183, netToRestaurant: -817 })
    expect(l.grossAmount).toBe(l.applicationFeeAmount + l.netToRestaurant)
  })
  it('never a signed zero', () => {
    const l = refundLedgerLine({ amountCents: 0, reversalCents: 0, feeRefundCents: 0 })
    expect(Object.is(l.grossAmount, 0) && Object.is(l.netToRestaurant, 0) && Object.is(l.applicationFeeAmount, 0)).toBe(true)
  })
})
