import { describe, it, expect } from 'vitest'
import { evaluateEarningMaturity, MATURATION_DAYS, PAYOUT_THRESHOLD_CENTS } from '@/lib/creator-earnings'

// ── B2a — the B0 maturation rules, PURE (no I/O, no mocks) ────────────────────
// A gain matures 7 days AFTER the ORDER, once the order is PAID, not fully
// refunded (ledger-read), and not a self-referral. A never-paid or fully
// refunded order cancels the gain; self-referral cancels at any age.

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-06-11T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY)

const base = {
  now,
  orderExists:        true,
  orderPaymentStatus: 'paid' as string | null,
  orderTotalCents:    2500,
  refundedCents:      0,
  isSelfReferral:     false,
}

describe('evaluateEarningMaturity — B0 rules', () => {
  it('constants pin the B0 defaults (7 days, 20 € threshold)', () => {
    expect(MATURATION_DAYS).toBe(7)
    expect(PAYOUT_THRESHOLD_CENTS).toBe(2000)
  })

  it('stays pending before 7 days, even when paid', () => {
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(6.9) }))
      .toEqual({ status: 'pending', reason: 'too_young' })
  })

  it('matures at 7+ days when the order is paid and not refunded', () => {
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(7.1) }))
      .toEqual({ status: 'matured', reason: 'ok' })
  })

  it('a never-paid order NEVER matures — cancelled at 7+ days', () => {
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(8), orderPaymentStatus: null }))
      .toEqual({ status: 'cancelled', reason: 'never_paid' })
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(8), orderPaymentStatus: 'pending' }))
      .toEqual({ status: 'cancelled', reason: 'never_paid' })
  })

  it('a FULLY refunded order cancels the gain', () => {
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(8), refundedCents: 2500 }))
      .toEqual({ status: 'cancelled', reason: 'fully_refunded' })
  })

  it('a PARTIAL refund still matures (the pro-rata take-back is a payout-time compensating line)', () => {
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(8), refundedCents: 1000 }))
      .toEqual({ status: 'matured', reason: 'ok' })
  })

  it('self-referral cancels at ANY age (even before 7 days)', () => {
    expect(evaluateEarningMaturity({ ...base, orderCreatedAt: daysAgo(1), isSelfReferral: true }))
      .toEqual({ status: 'cancelled', reason: 'self_referral' })
  })

  it('a legacy aggregate gain (no linked order) matures on age alone', () => {
    expect(evaluateEarningMaturity({
      ...base, orderCreatedAt: daysAgo(8), orderExists: false, orderPaymentStatus: null,
    })).toEqual({ status: 'matured', reason: 'no_order_link' })
  })

  it('threshold progression: matured cents measure against 2000c (B1 progressPct contract)', () => {
    // 12 € matured of the 20 € threshold → 60 %.
    const maturedCents = 1200
    expect(Math.min(100, Math.round((maturedCents / PAYOUT_THRESHOLD_CENTS) * 100))).toBe(60)
    // 25 € matured → capped at 100 %.
    expect(Math.min(100, Math.round((2500 / PAYOUT_THRESHOLD_CENTS) * 100))).toBe(100)
  })
})
