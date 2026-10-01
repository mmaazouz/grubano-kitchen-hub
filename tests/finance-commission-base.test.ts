import { describe, it, expect, afterEach } from 'vitest'
import { commissionBaseCents, commissionBaseMode } from '@/lib/promotions'
import { computeApplicationFee } from '@/lib/commission'

// ── WP-MONEY-04 · pure money math — commission BASE (lib/promotions.ts) ────────
// The base the pay route feeds into computeApplicationFee. 'discounted' (default,
// D2) → a promo shrinks Grubano's cut; 'list' → commission on the full subtotal.

afterEach(() => { delete process.env.COMMISSION_BASE })

const REST = { commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null }

describe('commissionBaseMode — "discounted" default, "list" opt-in', () => {
  it('defaults to discounted (undefined / any non-"list" value)', () => {
    expect(commissionBaseMode()).toBe('discounted')
    process.env.COMMISSION_BASE = 'anything'
    expect(commissionBaseMode()).toBe('discounted')
  })
  it('"list" only for the exact "list" value', () => {
    process.env.COMMISSION_BASE = 'list'
    expect(commissionBaseMode()).toBe('list')
  })
})

describe('commissionBaseCents — discounted vs list, ≥0 clamps', () => {
  it('discounted: subtotal − discount, clamped ≥ 0', () => {
    expect(commissionBaseCents(5000, 200, 'discounted')).toBe(4800)
    expect(commissionBaseCents(5000, 0, 'discounted')).toBe(5000)
    expect(commissionBaseCents(5000, 6000, 'discounted')).toBe(0)    // discount > subtotal
    expect(commissionBaseCents(5000, -100, 'discounted')).toBe(5000) // negative discount ignored
  })
  it('list: discount ignored, subtotal clamped ≥ 0', () => {
    expect(commissionBaseCents(5000, 200, 'list')).toBe(5000)
    expect(commissionBaseCents(-5000, 0, 'list')).toBe(0)
  })
})

describe('base → fee cross-check (the money-flow fixture)', () => {
  it('subtotal 10000, promo 200 → base 9800 discounted / 10000 list; delivery fee follows the base', () => {
    const baseDiscounted = commissionBaseCents(10000, 200, 'discounted')
    const baseList = commissionBaseCents(10000, 200, 'list')
    expect(baseDiscounted).toBe(9800)
    expect(baseList).toBe(10000)
    // delivery = 12% → the promo shrinks Grubano's cut in 'discounted' mode
    expect(computeApplicationFee(REST, 'delivery', baseDiscounted)).toBe(1176) // round(9800*0.12)
    expect(computeApplicationFee(REST, 'delivery', baseList)).toBe(1200)       // round(10000*0.12)
  })
})
