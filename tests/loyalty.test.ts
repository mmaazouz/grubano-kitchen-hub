// tests/loyalty.test.ts — Agent 14 / chantier fidélité L1 gardiens.
// Pure unit tests for lib/loyalty.ts: no DB, no network, no Stripe.
//
// Loyalty points are a CURRENCY that Grubano finances. This file locks the
// redemption math against silent regressions, dimension by dimension:
//   D2  loyalty never reduces the commission — it is computed elsewhere; here we
//       only check the credit itself is whole-point and capped;
//   D3  a promo on the order → loyalty is NOT applicable (credit 0, points kept);
//   D4  the client sends only the INTENTION → no intention, no credit;
//   D5  the THREE caps — converted balance, subtotal, AND Grubano's commission —
//       so the resulting application fee can never go negative.
// All money is INTEGER CENTS, all points are WHOLE. Anything touching money must
// stay green for the deploy gate to pass.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CENTS_PER_POINT,
  DEFAULT_STRIPE_FEE_PCT,
  DEFAULT_STRIPE_FEE_FIXED_CENTS,
  centsPerPoint,
  pointsToCents,
  centsToPoints,
  estimateStripeFeeCents,
  committedRoyaltyCents,
  resolveLoyaltyCredit,
} from '@/lib/loyalty'

describe('conversion scale — 100 pts = 5,00 € (5 cents/point)', () => {
  it('exposes the frozen default scale', () => {
    expect(DEFAULT_CENTS_PER_POINT).toBe(5)
    // No env override in the test runner → the default holds.
    expect(centsPerPoint()).toBe(5)
  })

  it('pointsToCents multiplies whole points by the scale', () => {
    expect(pointsToCents(0)).toBe(0)
    expect(pointsToCents(1)).toBe(5)
    expect(pointsToCents(100)).toBe(500)   // 100 pts = 5,00 €
    expect(pointsToCents(250)).toBe(1250)
  })

  it('pointsToCents floors fractional / clamps negative point inputs', () => {
    expect(pointsToCents(10.9)).toBe(50)   // floor(10.9) = 10 → 50 cents
    expect(pointsToCents(-50)).toBe(0)
  })

  it('centsToPoints floors onto a whole-point boundary ≤ cents', () => {
    expect(centsToPoints(0)).toBe(0)
    expect(centsToPoints(4)).toBe(0)       // < 1 point worth → 0
    expect(centsToPoints(5)).toBe(1)
    expect(centsToPoints(9)).toBe(1)       // 9 cents → 1 point (5 cents) only
    expect(centsToPoints(500)).toBe(100)
    expect(centsToPoints(-100)).toBe(0)
  })

  it('round-trips: pointsToCents ∘ centsToPoints lands on a point boundary', () => {
    for (const cents of [0, 4, 5, 17, 123, 500, 999]) {
      const pts = centsToPoints(cents)
      const back = pointsToCents(pts)
      expect(back).toBeLessThanOrEqual(cents)        // never exceeds the cap
      expect(back % DEFAULT_CENTS_PER_POINT).toBe(0) // on a point boundary
    }
  })
})

describe('resolveLoyaltyCredit — D3/D4 gating', () => {
  // A generous order so the caps don't interfere with the gating checks.
  const generous = { subtotalCents: 10_000, commissionFeeCents: 5_000 }

  it('D4 — no intention → no credit, no points spent', () => {
    expect(
      resolveLoyaltyCredit({
        customerPointsBalance: 1_000,
        ...generous,
        promoApplied: false,
        requestedUsePoints: false,
      }),
    ).toEqual({ creditCents: 0, pointsSpent: 0 })
  })

  it('D3 — a promo applies → loyalty not applicable, points preserved', () => {
    expect(
      resolveLoyaltyCredit({
        customerPointsBalance: 1_000,
        ...generous,
        promoApplied: true,
        requestedUsePoints: true,
      }),
    ).toEqual({ creditCents: 0, pointsSpent: 0 })
  })

  it('zero balance → nothing to spend', () => {
    expect(
      resolveLoyaltyCredit({
        customerPointsBalance: 0,
        ...generous,
        promoApplied: false,
        requestedUsePoints: true,
      }),
    ).toEqual({ creditCents: 0, pointsSpent: 0 })
  })
})

describe('resolveLoyaltyCredit — D5 the three caps', () => {
  it('balance cap — fewer points than the order could absorb', () => {
    // 30 pts = 1,50 €. Order & commission both large → balance is the binding cap.
    const r = resolveLoyaltyCredit({
      customerPointsBalance: 30,
      subtotalCents: 10_000,
      commissionFeeCents: 5_000,
      promoApplied: false,
      requestedUsePoints: true,
    })
    expect(r).toEqual({ pointsSpent: 30, creditCents: 150 })
  })

  it('commission cap — credit never exceeds Grubano’s fee (fee stays ≥ 0)', () => {
    // Balance worth 50,00 €, subtotal 100,00 €, but commission is only 3,00 €.
    // The credit must cap at the commission (300 cents = 60 pts).
    const r = resolveLoyaltyCredit({
      customerPointsBalance: 1_000,   // 50,00 €
      subtotalCents: 10_000,          // 100,00 €
      commissionFeeCents: 300,        // 3,00 €  ← binding cap
      promoApplied: false,
      requestedUsePoints: true,
    })
    expect(r).toEqual({ pointsSpent: 60, creditCents: 300 })
    // The resulting net fee (gross − credit) is exactly 0 — never negative (D5).
    expect(300 - r.creditCents).toBe(0)
  })

  it('subtotal cap — credit never exceeds what the customer is paying', () => {
    // Tiny subtotal (2,00 €) but a big commission figure and balance.
    const r = resolveLoyaltyCredit({
      customerPointsBalance: 1_000,   // 50,00 €
      subtotalCents: 200,             // 2,00 €  ← binding cap
      commissionFeeCents: 5_000,
      promoApplied: false,
      requestedUsePoints: true,
    })
    expect(r).toEqual({ pointsSpent: 40, creditCents: 200 })
  })

  it('commission cap not on a point boundary floors to whole points', () => {
    // Commission 9 cents → only 1 whole point (5 cents) can be spent, not 9 cents.
    const r = resolveLoyaltyCredit({
      customerPointsBalance: 1_000,
      subtotalCents: 10_000,
      commissionFeeCents: 9,
      promoApplied: false,
      requestedUsePoints: true,
    })
    expect(r).toEqual({ pointsSpent: 1, creditCents: 5 })
    expect(9 - r.creditCents).toBeGreaterThanOrEqual(0) // net fee still ≥ 0
  })

  it('commission below one point worth → no credit at all', () => {
    const r = resolveLoyaltyCredit({
      customerPointsBalance: 1_000,
      subtotalCents: 10_000,
      commissionFeeCents: 4,   // < 5 cents → 0 whole points
      promoApplied: false,
      requestedUsePoints: true,
    })
    expect(r).toEqual({ creditCents: 0, pointsSpent: 0 })
  })

  it('credit always lands on a whole-point boundary and respects every cap', () => {
    // Property-ish sweep: whatever the inputs, creditCents ≤ each cap and is a
    // multiple of the scale, and pointsSpent matches creditCents exactly.
    const cases = [
      { customerPointsBalance: 7,    subtotalCents: 1_234, commissionFeeCents: 999 },
      { customerPointsBalance: 333,  subtotalCents: 77,    commissionFeeCents: 5_000 },
      { customerPointsBalance: 333,  subtotalCents: 5_000, commissionFeeCents: 77 },
      { customerPointsBalance: 1,    subtotalCents: 5_000, commissionFeeCents: 5_000 },
    ]
    for (const c of cases) {
      const r = resolveLoyaltyCredit({ ...c, promoApplied: false, requestedUsePoints: true })
      expect(r.creditCents % DEFAULT_CENTS_PER_POINT).toBe(0)
      expect(r.creditCents).toBeLessThanOrEqual(pointsToCents(c.customerPointsBalance))
      expect(r.creditCents).toBeLessThanOrEqual(c.subtotalCents)
      expect(r.creditCents).toBeLessThanOrEqual(c.commissionFeeCents)
      expect(pointsToCents(r.pointsSpent)).toBe(r.creditCents)
    }
  })

  it('negative cap inputs are clamped (never a negative credit)', () => {
    const r = resolveLoyaltyCredit({
      customerPointsBalance: 100,
      subtotalCents: -50,
      commissionFeeCents: -10,
      promoApplied: false,
      requestedUsePoints: true,
    })
    expect(r).toEqual({ creditCents: 0, pointsSpent: 0 })
  })
})

// ── Stripe fee estimation (borne de sécurité, phase 0) ────────────────────────
describe('estimateStripeFeeCents', () => {
  it('uses the frozen defaults: round(charge × 2.9%) + 25c fixed', () => {
    expect(DEFAULT_STRIPE_FEE_PCT).toBe(0.029)
    expect(DEFAULT_STRIPE_FEE_FIXED_CENTS).toBe(25)
    expect(estimateStripeFeeCents(2000)).toBe(Math.round(2000 * 0.029) + 25) // 20,00 € → 83c
    expect(estimateStripeFeeCents(2000)).toBe(83)
    expect(estimateStripeFeeCents(0)).toBe(25)   // the fixed part still applies
  })

  it('clamps negative/garbage charges', () => {
    expect(estimateStripeFeeCents(-100)).toBe(25)
  })
})

// ── Committed creator royalty (mirrors the FROZEN DishSale formula) ───────────
describe('committedRoyaltyCents', () => {
  it('sums round2(amount × rate) per line → cents', () => {
    // 20,00 € @ 2% = 0,40 € = 40c
    expect(committedRoyaltyCents([{ amountCents: 2000, rate: 0.02 }])).toBe(40)
    // two lines: 20,00 @ 2% (40c) + 7,50 @ 2% (round2(0.15)=0.15 → 15c) = 55c
    expect(committedRoyaltyCents([{ amountCents: 2000, rate: 0.02 }, { amountCents: 750, rate: 0.02 }])).toBe(55)
  })

  it('no adopted lines → 0; negative inputs clamp', () => {
    expect(committedRoyaltyCents([])).toBe(0)
    expect(committedRoyaltyCents([{ amountCents: -100, rate: 0.02 }])).toBe(0)
  })
})

// ── D-A — the credit cap subtracts ALL committed claims (Grubano never < 0) ───
describe('resolveLoyaltyCredit — committedClaimsCents (margin guard)', () => {
  const base = {
    customerPointsBalance: 100_000, // huge → balance is never the binding cap here
    subtotalCents: 10_000,          // 100 € → subtotal never the binding cap here
    promoApplied: false as const,
    requestedUsePoints: true as const,
  }

  it('(a) normal order — credit capped at commission − Stripe fee', () => {
    // commission 160c, stripe 83c → cap 77c → floor to 15 pts = 75c.
    const r = resolveLoyaltyCredit({ ...base, commissionFeeCents: 160, committedClaimsCents: 83 })
    expect(r).toEqual({ pointsSpent: 15, creditCents: 75 })
    expect(160 - 83 - r.creditCents).toBeGreaterThanOrEqual(0) // Grubano net ≥ 0
  })

  it('(b) chef dish — credit capped at commission − Stripe − royalty', () => {
    // commission 160c, stripe 83c + royalty 40c = 123c → cap 37c → 7 pts = 35c.
    const r = resolveLoyaltyCredit({ ...base, commissionFeeCents: 160, committedClaimsCents: 83 + 40 })
    expect(r).toEqual({ pointsSpent: 7, creditCents: 35 })
    expect(160 - 123 - r.creditCents).toBeGreaterThanOrEqual(0)
  })

  it('(c) chef dish + affiliation — credit capped at commission − Stripe − royalty − affiliation', () => {
    // delivery 12% on a bigger order: commission 600c; stripe 120c + royalty 80c +
    // affiliation 180c = 380c → cap 220c → 44 pts = 220c.
    const r = resolveLoyaltyCredit({ ...base, commissionFeeCents: 600, committedClaimsCents: 120 + 80 + 180 })
    expect(r).toEqual({ pointsSpent: 44, creditCents: 220 })
    expect(600 - 380 - r.creditCents).toBeGreaterThanOrEqual(0)
  })

  it('(d) committed claims ≥ commission → credit 0 (small chef dish, fee eaten by Stripe+royalty)', () => {
    const r = resolveLoyaltyCredit({ ...base, commissionFeeCents: 80, committedClaimsCents: 83 + 10 })
    expect(r).toEqual({ creditCents: 0, pointsSpent: 0 })
  })

  it('(e) non-regression — committedClaimsCents omitted behaves exactly as before (cap = commission)', () => {
    const without = resolveLoyaltyCredit({ ...base, commissionFeeCents: 300 })
    const withZero = resolveLoyaltyCredit({ ...base, commissionFeeCents: 300, committedClaimsCents: 0 })
    expect(without).toEqual(withZero)
    expect(without).toEqual({ pointsSpent: 60, creditCents: 300 }) // 300c → 60 pts, full commission
  })

  it('balance/subtotal caps still bind under committed claims (3-cap min preserved)', () => {
    // commission − claims = 500c, but balance only 3 pts = 15c → 15c wins.
    const r = resolveLoyaltyCredit({ customerPointsBalance: 3, subtotalCents: 10_000, commissionFeeCents: 600, committedClaimsCents: 100, promoApplied: false, requestedUsePoints: true })
    expect(r).toEqual({ pointsSpent: 3, creditCents: 15 })
  })
})
