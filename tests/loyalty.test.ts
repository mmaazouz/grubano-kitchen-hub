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
  centsPerPoint,
  pointsToCents,
  centsToPoints,
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
