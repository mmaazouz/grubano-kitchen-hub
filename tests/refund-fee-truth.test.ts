import { describe, it, expect } from 'vitest'

// ── PHASE 2 — lib/refund-fee-truth: ONE attribution rule for Stripe's real fee refunds ──
// (REFUND-FINANCIAL-CONTRACT §2 ⚠️, §8, §15 A8). Shared by the charge.refunded webhook
// and the engine's eager ledger line: the ledger never freezes a PREDICTED cent when the
// Stripe truth is unambiguous, and never mis-attributes a REAL cent when it is ambiguous.

import { matchFeeRefunds, predictFeeRefund } from '@/lib/refund-fee-truth'

const r = (id: string, amount: number, created: number) => ({ id, amount, created })
const f = (amount: number, created: number) => ({ amount, created })

describe('matchFeeRefunds', () => {
  it('single refund → Stripe truth (no ambiguity possible), even when it deviates from the prediction', () => {
    const m = matchFeeRefunds([r('re_1', 5000, 10)], [f(601, 10)], 600, 5000)
    expect(m.mode).toBe('stripe')
    expect(m.byRefundId.get('re_1')).toBe(601)
  })

  it('counts differ → prorata prediction for every refund', () => {
    const m = matchFeeRefunds([r('re_1', 2500, 10), r('re_2', 2500, 20)], [f(300, 10)], 600, 5000)
    expect(m.mode).toBe('prorata')
    expect(m.byRefundId.get('re_1')).toBe(300)
    expect(m.byRefundId.get('re_2')).toBe(300)
  })

  it('no fee refunds and no refunds → prorata, empty map', () => {
    const m = matchFeeRefunds([], [], 600, 5000)
    expect(m.mode).toBe('prorata')
    expect(m.byRefundId.size).toBe(0)
  })

  it('distinct seconds → chronological index match is unambiguous → Stripe truth', () => {
    const m = matchFeeRefunds([r('re_b', 1000, 20), r('re_a', 4000, 10)], [f(120, 20), f(480, 10)], 600, 5000)
    expect(m.mode).toBe('stripe')
    expect(m.byRefundId.get('re_a')).toBe(480)
    expect(m.byRefundId.get('re_b')).toBe(120)
  })

  it('same-second ties but every slice within ±1 c of prediction → Stripe truth accepted (swap-proof)', () => {
    const m = matchFeeRefunds([r('re_1', 2500, 10), r('re_2', 2500, 10)], [f(301, 10), f(299, 10)], 600, 5000)
    expect(m.mode).toBe('stripe')
    expect(Array.from(m.byRefundId.values()).sort()).toEqual([299, 301])
  })

  it('same-second ties AND a deviating slice → AMBIGUOUS: predicted values, caller must log MONEY REVIEW / skip eager', () => {
    const m = matchFeeRefunds([r('re_1', 1000, 10), r('re_2', 4000, 10)], [f(480, 10), f(120, 10)], 600, 5000)
    expect(m.mode).toBe('ambiguous')
    expect(m.byRefundId.get('re_1')).toBe(120) // prediction, not the (possibly swapped) real cents
    expect(m.byRefundId.get('re_2')).toBe(480)
  })

  it('predictFeeRefund = documented Stripe proration, rounded; zero when there is no fee or no charge', () => {
    expect(predictFeeRefund(600, 5000, 2500)).toBe(300)
    expect(predictFeeRefund(900, 5000, 333)).toBe(60)   // 59.94 → 60
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
