// tests/pricing.test.ts — Agent 14 / V1.5 pricing primitives (PURE).
// lib/pricing: the small-order fee + the shared net-margin base. No DB/Stripe.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SMALL_ORDER_FEE_CENTS,
  DEFAULT_SMALL_ORDER_THRESHOLD_CENTS,
  smallOrderFeeConfigCents,
  smallOrderThresholdCents,
  smallOrderFeeCents,
  netBeforeAffiliateCents,
} from '@/lib/pricing'

describe('small-order fee — defaults 1,00 € below 12,00 €', () => {
  it('exposes the frozen defaults', () => {
    expect(DEFAULT_SMALL_ORDER_FEE_CENTS).toBe(100)
    expect(DEFAULT_SMALL_ORDER_THRESHOLD_CENTS).toBe(1200)
    expect(smallOrderFeeConfigCents()).toBe(100)
    expect(smallOrderThresholdCents()).toBe(1200)
  })

  it('charges the flat fee STRICTLY below the threshold, nothing at/above', () => {
    expect(smallOrderFeeCents(0)).toBe(100)      // empty-ish (still below)
    expect(smallOrderFeeCents(900)).toBe(100)    // 9,00 € → fee
    expect(smallOrderFeeCents(1199)).toBe(100)   // just under
    expect(smallOrderFeeCents(1200)).toBe(0)     // exactly the threshold → no fee
    expect(smallOrderFeeCents(1500)).toBe(0)     // above → no fee
  })

  it('clamps garbage subtotals', () => {
    expect(smallOrderFeeCents(-50)).toBe(100)    // negative floors to 0 → below threshold
  })
})

describe('netBeforeAffiliateCents — commission − Stripe − royalty, floored at 0', () => {
  it('subtracts the Stripe fee and the royalty from the commission', () => {
    expect(netBeforeAffiliateCents(360, 121, 60)).toBe(179)
    expect(netBeforeAffiliateCents(160, 83, 0)).toBe(77)   // normal order, no royalty
    expect(netBeforeAffiliateCents(160, 83, 40)).toBe(37)  // chef dish
  })

  it('floors at 0 when the claims exceed the commission (Grubano never advances)', () => {
    expect(netBeforeAffiliateCents(80, 83, 10)).toBe(0)    // small chef dish, fee eats it
    expect(netBeforeAffiliateCents(50, 60, 0)).toBe(0)
  })

  it('clamps negative inputs', () => {
    expect(netBeforeAffiliateCents(100, -10, -5)).toBe(100)
    expect(netBeforeAffiliateCents(-100, 10, 5)).toBe(0)
  })
})
