import { describe, it, expect } from 'vitest'
import { stockStatus, isLowStock, itemMatchesQuery, reorderSearchHref } from '@/lib/marketplace'

// ── Stock → reorder bridge pure helpers (B2B Slice 4, Agent 14) ───────────────
// stockStatus replicates app/[locale]/stocks/page.tsx statusOf byte-for-byte.

describe('stockStatus (kept in sync with /stocks statusOf)', () => {
  it('urgent at ≤40% of threshold, soon below threshold, ok at/above', () => {
    expect(stockStatus(0.2, 1)).toBe('urgent') // 0.2 ≤ 0.4
    expect(stockStatus(0.4, 1)).toBe('urgent') // 0.4 ≤ 0.4
    expect(stockStatus(0.7, 1)).toBe('soon')   // 0.4 < 0.7 < 1
    expect(stockStatus(1, 1)).toBe('ok')
    expect(stockStatus(2, 1)).toBe('ok')
  })
})

describe('isLowStock', () => {
  it('low = status not ok; no threshold (0) → not low', () => {
    expect(isLowStock(0.5, 1)).toBe(true)
    expect(isLowStock(1, 1)).toBe(false)
    expect(isLowStock(5, 0)).toBe(false)
  })
})

describe('itemMatchesQuery', () => {
  it('case-insensitive substring; a blank query never matches', () => {
    expect(itemMatchesQuery('Tomates cerises', 'tomate')).toBe(true)
    expect(itemMatchesQuery('Mozzarella', 'zaR')).toBe(true)
    expect(itemMatchesQuery('Lait', 'TOM')).toBe(false)
    expect(itemMatchesQuery('Lait', '   ')).toBe(false)
  })
})

describe('reorderSearchHref', () => {
  it('encodes the product name into the discovery search query', () => {
    expect(reorderSearchHref('Sauce tomate')).toBe('/marketplace/suppliers?q=Sauce%20tomate')
    expect(reorderSearchHref('  Mozzarella  ')).toBe('/marketplace/suppliers?q=Mozzarella')
  })
})
