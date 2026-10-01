import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  computeCreatorStars, nextStarProgress,
  STAR2_MIN_RESTAURANTS, STAR2_MIN_SALES, STAR3_MIN_RESTAURANTS, STAR3_MIN_SALES,
} from '@/lib/creator-stars'

// ── ⭐ Étoiles Grubano — pure scoring (Mission 4) ───────────────────────────────
// Ledger-proven performance: the 4 tiers, the freshness gate, the env overrides.

describe('computeCreatorStars — the 4 tiers', () => {
  it('0 stars when there is no active adoption', () => {
    expect(computeCreatorStars({ activeRestaurants: 0, maturedSales: 5000, hasFreshSale: true })).toBe(0)
  })

  it('⭐ on the first active adoption (sales irrelevant)', () => {
    expect(computeCreatorStars({ activeRestaurants: 1, maturedSales: 0, hasFreshSale: false })).toBe(1)
  })

  it('⭐⭐ needs both restaurants AND matured sales thresholds', () => {
    expect(computeCreatorStars({ activeRestaurants: STAR2_MIN_RESTAURANTS, maturedSales: STAR2_MIN_SALES, hasFreshSale: false })).toBe(2)
    // one short on either axis → stays ⭐
    expect(computeCreatorStars({ activeRestaurants: STAR2_MIN_RESTAURANTS, maturedSales: STAR2_MIN_SALES - 1, hasFreshSale: false })).toBe(1)
    expect(computeCreatorStars({ activeRestaurants: STAR2_MIN_RESTAURANTS - 1, maturedSales: STAR2_MIN_SALES, hasFreshSale: false })).toBe(1)
  })

  it('⭐⭐⭐ needs restaurants AND sales AND a FRESH matured sale', () => {
    expect(computeCreatorStars({ activeRestaurants: STAR3_MIN_RESTAURANTS, maturedSales: STAR3_MIN_SALES, hasFreshSale: true })).toBe(3)
  })

  it('without a fresh sale, a ⭐⭐⭐-volume creator is capped at ⭐⭐', () => {
    expect(computeCreatorStars({ activeRestaurants: STAR3_MIN_RESTAURANTS, maturedSales: STAR3_MIN_SALES, hasFreshSale: false })).toBe(2)
  })

  it('one short of the ⭐⭐⭐ restaurants/sales bars stays ⭐⭐', () => {
    expect(computeCreatorStars({ activeRestaurants: STAR3_MIN_RESTAURANTS - 1, maturedSales: STAR3_MIN_SALES, hasFreshSale: true })).toBe(2)
    expect(computeCreatorStars({ activeRestaurants: STAR3_MIN_RESTAURANTS, maturedSales: STAR3_MIN_SALES - 1, hasFreshSale: true })).toBe(2)
  })
})

describe('nextStarProgress — gamification deltas', () => {
  it('from 0 → next is ⭐, one restaurant away', () => {
    expect(nextStarProgress({ activeRestaurants: 0, maturedSales: 0, hasFreshSale: false }))
      .toEqual({ nextStar: 1, missingRestaurants: 1, missingSales: 0 })
  })

  it('from ⭐ → next is ⭐⭐ with the exact missing restaurants and sales', () => {
    expect(nextStarProgress({ activeRestaurants: 1, maturedSales: 0, hasFreshSale: false }))
      .toEqual({ nextStar: 2, missingRestaurants: STAR2_MIN_RESTAURANTS - 1, missingSales: STAR2_MIN_SALES })
  })

  it('from ⭐⭐ → next is ⭐⭐⭐', () => {
    expect(nextStarProgress({ activeRestaurants: STAR2_MIN_RESTAURANTS, maturedSales: STAR2_MIN_SALES, hasFreshSale: false }))
      .toEqual({ nextStar: 3, missingRestaurants: STAR3_MIN_RESTAURANTS - STAR2_MIN_RESTAURANTS, missingSales: STAR3_MIN_SALES - STAR2_MIN_SALES })
  })

  it('at ⭐⭐⭐ → no next star, nothing missing', () => {
    expect(nextStarProgress({ activeRestaurants: STAR3_MIN_RESTAURANTS, maturedSales: STAR3_MIN_SALES, hasFreshSale: true }))
      .toEqual({ nextStar: null, missingRestaurants: 0, missingSales: 0 })
  })
})

describe('env overrides change the thresholds without a redeploy', () => {
  afterEach(() => {
    delete process.env.STAR2_MIN_RESTAURANTS
    delete process.env.STAR2_MIN_SALES
    vi.resetModules()
  })

  it('STAR2_MIN_* read from env flip the ⭐⭐ verdict', async () => {
    vi.resetModules()
    process.env.STAR2_MIN_RESTAURANTS = '5'
    process.env.STAR2_MIN_SALES = '10'
    const mod = await import('@/lib/creator-stars')
    // With the override, 5 restos + 10 sales clears ⭐⭐…
    expect(mod.computeCreatorStars({ activeRestaurants: 5, maturedSales: 10, hasFreshSale: false })).toBe(2)
    // …while the default-passing (3, 100) now stays ⭐ (below the new 5-resto bar).
    expect(mod.computeCreatorStars({ activeRestaurants: 3, maturedSales: 100, hasFreshSale: false })).toBe(1)
  })
})
