// tests/finance-commission.test.ts — Agent 1 / A6 gardiens.
// Pure unit tests for lib/commission.ts: no DB, no network, no Stripe.
//
// The intent is to lock the platform's revenue math against silent regressions:
// (1) the per-channel default rates table itself,
// (2) resolveCommissionRate's three layers — founders offer / override / default,
// (3) computeApplicationFee's rounding + [0, amount] bounds at the cent.
// Anything that touches money MUST stay green here for the deploy gate to pass.

import { describe, it, expect } from 'vitest'
import {
  PLATFORM_COMMISSION_RATES,
  resolveCommissionRate,
  computeApplicationFee,
  type CommissionChannel,
  type RestaurantCommissionFields,
} from '@/lib/commission'

/** Helper — a restaurant with no overrides and no founders offer. */
const plain: RestaurantCommissionFields = {
  commissionRateDineIn:   null,
  commissionRatePickup:   null,
  commissionRateDelivery: null,
  commissionFreeUntil:    null,
}

describe('PLATFORM_COMMISSION_RATES — frozen table per A0', () => {
  // The rates ARE the rail's contract; any change must be deliberate and
  // visible in the diff here.
  it('matches the A0 decision exactly (5% / 8% / 12% / 0%)', () => {
    expect(PLATFORM_COMMISSION_RATES.dinein).toBe(0.05)
    expect(PLATFORM_COMMISSION_RATES.pickup).toBe(0.08)
    expect(PLATFORM_COMMISSION_RATES.delivery).toBe(0.12)
    expect(PLATFORM_COMMISSION_RATES.reservation).toBe(0)
  })

  it('every CommissionChannel value has a numeric rate in [0, 1]', () => {
    const channels: CommissionChannel[] = ['dinein', 'pickup', 'delivery', 'reservation']
    for (const c of channels) {
      const r = PLATFORM_COMMISSION_RATES[c]
      expect(typeof r).toBe('number')
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })
})

describe('resolveCommissionRate — founders / override / default precedence', () => {
  const tomorrow  = new Date(Date.UTC(2030, 0, 1))   // far future, used as commissionFreeUntil
  const yesterday = new Date(Date.UTC(2020, 0, 1))   // past, founders offer expired
  const now       = new Date(Date.UTC(2026, 5, 11))  // a fixed "now" for determinism

  it('returns 0 on every channel while commissionFreeUntil is in the future', () => {
    const r: RestaurantCommissionFields = { ...plain, commissionFreeUntil: tomorrow }
    expect(resolveCommissionRate(r, 'dinein',      now)).toBe(0)
    expect(resolveCommissionRate(r, 'pickup',      now)).toBe(0)
    expect(resolveCommissionRate(r, 'delivery',    now)).toBe(0)
    expect(resolveCommissionRate(r, 'reservation', now)).toBe(0)
  })

  it('falls through to overrides / default once commissionFreeUntil has passed', () => {
    const r: RestaurantCommissionFields = { ...plain, commissionFreeUntil: yesterday }
    expect(resolveCommissionRate(r, 'dinein',   now)).toBe(0.05)
    expect(resolveCommissionRate(r, 'pickup',   now)).toBe(0.08)
    expect(resolveCommissionRate(r, 'delivery', now)).toBe(0.12)
  })

  it('uses the per-channel override when present (and ignores the others)', () => {
    const r: RestaurantCommissionFields = {
      commissionRateDineIn:   0.02,
      commissionRatePickup:   null,   // ← fallback to default
      commissionRateDelivery: 0.15,
      commissionFreeUntil:    null,
    }
    expect(resolveCommissionRate(r, 'dinein',   now)).toBe(0.02)   // override
    expect(resolveCommissionRate(r, 'pickup',   now)).toBe(0.08)   // default (override null)
    expect(resolveCommissionRate(r, 'delivery', now)).toBe(0.15)   // override
  })

  it('reservation channel never honours an override (no column for it)', () => {
    const r: RestaurantCommissionFields = {
      ...plain,
      // even if a caller tried to inject an override-like value, no field maps here.
      commissionRateDineIn: 0.99,
    }
    expect(resolveCommissionRate(r, 'reservation', now)).toBe(0)
  })

  it('uses the platform defaults when no override and no founders offer', () => {
    expect(resolveCommissionRate(plain, 'dinein',   now)).toBe(0.05)
    expect(resolveCommissionRate(plain, 'pickup',   now)).toBe(0.08)
    expect(resolveCommissionRate(plain, 'delivery', now)).toBe(0.12)
  })

  it('founders offer wins even if an override is also set', () => {
    const r: RestaurantCommissionFields = {
      commissionRateDineIn:   0.20,   // would normally apply…
      commissionRatePickup:   null,
      commissionRateDelivery: null,
      commissionFreeUntil:    tomorrow,
    }
    // …but commissionFreeUntil is still active → 0.
    expect(resolveCommissionRate(r, 'dinein', now)).toBe(0)
  })

  it('boundary: founders offer expires AT the timestamp (strict >, not >=)', () => {
    const t = new Date(Date.UTC(2026, 5, 11, 0, 0, 0))
    const r: RestaurantCommissionFields = { ...plain, commissionFreeUntil: t }
    // now === t → expired (the implementation uses `> now.getTime()`)
    expect(resolveCommissionRate(r, 'dinein', t)).toBe(0.05)
    // 1 ms before → still free
    expect(resolveCommissionRate(r, 'dinein', new Date(t.getTime() - 1))).toBe(0)
  })
})

describe('computeApplicationFee — cent-exact rounding + bounds', () => {
  it('zero amount → zero fee on every channel', () => {
    for (const c of ['dinein', 'pickup', 'delivery', 'reservation'] as const) {
      expect(computeApplicationFee(plain, c, 0)).toBe(0)
    }
  })

  it('one cent — rounding kicks in immediately', () => {
    // 1c × 5% = 0.05c → Math.round = 0.
    expect(computeApplicationFee(plain, 'dinein', 1)).toBe(0)
    // 1c × 12% = 0.12c → 0.
    expect(computeApplicationFee(plain, 'delivery', 1)).toBe(0)
  })

  it('rounds to the nearest cent at the .5 boundary (banker-agnostic: Math.round)', () => {
    // 10c × 5% = 0.5c → Math.round(0.5) === 1.
    expect(computeApplicationFee(plain, 'dinein', 10)).toBe(1)
    // 50c × 5% = 2.5c → 3.
    expect(computeApplicationFee(plain, 'dinein', 50)).toBe(3)
  })

  it('common e-commerce amounts compute the expected cents', () => {
    // 12.50 € dine-in @ 5% → 62.5c → 63.
    expect(computeApplicationFee(plain, 'dinein', 1250)).toBe(63)
    // 19.90 € pickup @ 8% → 159.2c → 159.
    expect(computeApplicationFee(plain, 'pickup', 1990)).toBe(159)
    // 35.00 € delivery @ 12% → 420c → 420.
    expect(computeApplicationFee(plain, 'delivery', 3500)).toBe(420)
    // empreinte 10.00 € reservation → 0.
    expect(computeApplicationFee(plain, 'reservation', 1000)).toBe(0)
  })

  it('large amounts stay exact in JS number range (integer cents)', () => {
    // 1 000 000 € delivery @ 12% → 12 000 000c
    expect(computeApplicationFee(plain, 'delivery', 100_000_000)).toBe(12_000_000)
  })

  it('founders offer → fee is 0 regardless of amount', () => {
    const future = new Date(Date.UTC(2030, 0, 1))
    const r: RestaurantCommissionFields = { ...plain, commissionFreeUntil: future }
    expect(computeApplicationFee(r, 'delivery', 3500, new Date(Date.UTC(2026, 5, 11)))).toBe(0)
  })

  it('clamps fee ≥ 0 even if a negative override slipped in (defensive)', () => {
    // A buggy DB value of -0.05 must not yield a negative fee — the clamp catches it.
    const r: RestaurantCommissionFields = { ...plain, commissionRateDineIn: -0.05 }
    expect(computeApplicationFee(r, 'dinein', 1000)).toBe(0)
  })

  it('clamps fee ≤ amount even if a rate > 1 slipped in (defensive)', () => {
    // Same shape on the upper side — the platform never takes more than the
    // gross. A 200 % override is non-sensical but the function must not return
    // 2× the amount.
    const r: RestaurantCommissionFields = { ...plain, commissionRateDineIn: 2 }
    expect(computeApplicationFee(r, 'dinein', 1000)).toBe(1000)
  })

  it('negative amount input → fee 0 (the math would yield negative — clamp wins)', () => {
    // The pipeline should never feed negative amounts to this function, but if
    // it does, we must not silently return a negative.
    expect(computeApplicationFee(plain, 'dinein', -500)).toBe(0)
  })
})
