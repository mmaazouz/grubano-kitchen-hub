import { describe, it, expect } from 'vitest'
import { computeRefundSplit } from '@/lib/refund'

// ── P4.5-A — the money arithmetic (the core) ─────────────────────────────────────
// Prorata, integer, cent-EXACT, cumulative. The customer-facing identity
// restaurantReverse + applicationFeeRefund === amount must hold to the cent, the
// royalty slice nests inside the fee refund, and across partial refunds nothing is
// lost or created (totals land EXACTLY at full refund).

const split = (o: Partial<Parameters<typeof computeRefundSplit>[0]> & { refundAmountCents: number }) =>
  computeRefundSplit({
    chargeTotalCents:     5000,
    applicationFeeCents:  600,
    royaltyChargedCents:  0,
    alreadyRefundedCents: 0,
    ...o,
  })

describe('computeRefundSplit — (a) prorata exact, NON-franchised', () => {
  it('FULL refund → fee + reverse = amount, fee = the whole application fee', () => {
    const s = split({ refundAmountCents: 5000 })
    expect(s.applicationFeeRefundCents).toBe(600)            // round(600 × 5000/5000)
    expect(s.restaurantReverseCents).toBe(4400)              // 5000 − 600
    expect(s.restaurantReverseCents + s.applicationFeeRefundCents).toBe(5000) // EXACT
    expect(s.royaltyRefundCents).toBe(0)
    expect(s.cumulativeRoyaltyRefundedCents).toBe(0)
  })

  it('PARTIAL f=0.5 → each party gives back half its share, sum exact', () => {
    const s = split({ refundAmountCents: 2500 })
    expect(s.applicationFeeRefundCents).toBe(300)            // round(600 × 2500/5000)
    expect(s.restaurantReverseCents).toBe(2200)
    expect(s.restaurantReverseCents + s.applicationFeeRefundCents).toBe(2500)
    expect(s.royaltyRefundCents).toBe(0)
  })
})

describe('computeRefundSplit — (b) prorata exact, FRANCHISED (royalty slice included)', () => {
  // T=5000, commission 600 + held-back royalty 300 ⇒ application fee F=900, R=300.
  const fr = (o: { refundAmountCents: number; alreadyRefundedCents?: number }) =>
    computeRefundSplit({ chargeTotalCents: 5000, applicationFeeCents: 900, royaltyChargedCents: 300, alreadyRefundedCents: 0, ...o })

  it('FULL refund → royalty fully reversed and == R, fee = commission + royalty', () => {
    const s = fr({ refundAmountCents: 5000 })
    expect(s.applicationFeeRefundCents).toBe(900)
    expect(s.royaltyRefundCents).toBe(300)                   // the whole held-back
    expect(s.cumulativeRoyaltyRefundedCents).toBe(300)
    expect(s.restaurantReverseCents).toBe(4100)             // 5000 − 900
    expect(s.restaurantReverseCents + s.applicationFeeRefundCents).toBe(5000)
    expect(s.royaltyRefundCents).toBeLessThanOrEqual(s.applicationFeeRefundCents) // slice nests
  })

  it('PARTIAL f=0.5 → royalty slice = half the held-back, nested in the fee refund', () => {
    const s = fr({ refundAmountCents: 2500 })
    expect(s.applicationFeeRefundCents).toBe(450)            // round(900 × 0.5)
    expect(s.royaltyRefundCents).toBe(150)                   // round(450 × 300/900)
    expect(s.restaurantReverseCents).toBe(2050)
    expect(s.restaurantReverseCents + s.applicationFeeRefundCents).toBe(2500)
    expect(s.royaltyRefundCents).toBeLessThanOrEqual(s.applicationFeeRefundCents)
  })
})

describe('computeRefundSplit — (d) cumul: many partials sum EXACTLY to the totals', () => {
  it('5€ + 5€ on 50€ accrue without drift (cumulative fee target)', () => {
    const r1 = split({ refundAmountCents: 500, alreadyRefundedCents: 0 })
    const r2 = split({ refundAmountCents: 500, alreadyRefundedCents: 500 })
    expect(r1.applicationFeeRefundCents).toBe(60)            // round(600 × 500/5000)
    expect(r2.applicationFeeRefundCents).toBe(60)            // round(600 × 1000/5000) − 60
    expect(r1.applicationFeeRefundCents + r2.applicationFeeRefundCents).toBe(120)
    expect(r1.restaurantReverseCents + r2.restaurantReverseCents).toBe(880)
  })
})

describe('computeRefundSplit — (f) centimes: last cent is deterministic, no 1c lost/created', () => {
  it('NON-franchised: 3×3.33€ + 0.01€ on 10€ (fee 1.25€) sums to F and T−F EXACTLY', () => {
    const T = 1000, F = 125
    const amounts = [333, 333, 333, 1] // = 1000 total
    let cumPrev = 0
    let feeSum = 0, reverseSum = 0, refundSum = 0
    for (const amt of amounts) {
      const s = computeRefundSplit({ chargeTotalCents: T, applicationFeeCents: F, royaltyChargedCents: 0, alreadyRefundedCents: cumPrev, refundAmountCents: amt })
      expect(s.restaurantReverseCents + s.applicationFeeRefundCents).toBe(amt) // each refund exact
      feeSum += s.applicationFeeRefundCents
      reverseSum += s.restaurantReverseCents
      refundSum += amt
      cumPrev += amt
    }
    expect(refundSum).toBe(T)
    expect(feeSum).toBe(F)          // no commission cent lost or created
    expect(reverseSum).toBe(T - F)  // no resto cent lost or created
  })

  it('FRANCHISED: cumulative royalty lands EXACTLY on R across odd partials', () => {
    const T = 1000, F = 125, R = 60
    const amounts = [333, 333, 333, 1]
    let cumPrev = 0
    let royaltySum = 0
    let lastCumulative = 0
    for (const amt of amounts) {
      const s = computeRefundSplit({ chargeTotalCents: T, applicationFeeCents: F, royaltyChargedCents: R, alreadyRefundedCents: cumPrev, refundAmountCents: amt })
      expect(s.royaltyRefundCents).toBeGreaterThanOrEqual(0)
      expect(s.royaltyRefundCents).toBeLessThanOrEqual(s.applicationFeeRefundCents)
      royaltySum += s.royaltyRefundCents
      lastCumulative = s.cumulativeRoyaltyRefundedCents
      cumPrev += amt
    }
    expect(lastCumulative).toBe(R)  // absolute cumulative target lands on R
    expect(royaltySum).toBe(R)      // the per-refund slices also sum to R
  })
})

describe('computeRefundSplit — guards / degeneracies', () => {
  it('royalty is clamped to the application fee (never exceeds the fee slice)', () => {
    const s = computeRefundSplit({ chargeTotalCents: 5000, applicationFeeCents: 200, royaltyChargedCents: 999, alreadyRefundedCents: 0, refundAmountCents: 5000 })
    expect(s.royaltyRefundCents).toBeLessThanOrEqual(s.applicationFeeRefundCents)
    expect(s.cumulativeRoyaltyRefundedCents).toBeLessThanOrEqual(200)
  })

  it('zero charge total → all zeros (no division by zero)', () => {
    const s = computeRefundSplit({ chargeTotalCents: 0, applicationFeeCents: 0, royaltyChargedCents: 0, alreadyRefundedCents: 0, refundAmountCents: 0 })
    expect(s).toMatchObject({ restaurantReverseCents: 0, applicationFeeRefundCents: 0, royaltyRefundCents: 0 })
  })

  it('platform charge (no fee, F=0) → 100% reversed to the resto, royalty 0', () => {
    const s = computeRefundSplit({ chargeTotalCents: 5000, applicationFeeCents: 0, royaltyChargedCents: 0, alreadyRefundedCents: 0, refundAmountCents: 2500 })
    expect(s.applicationFeeRefundCents).toBe(0)
    expect(s.restaurantReverseCents).toBe(2500)
    expect(s.royaltyRefundCents).toBe(0)
  })
})
