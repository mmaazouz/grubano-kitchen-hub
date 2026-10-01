import { describe, it, expect } from 'vitest'
import { buildOrderLines } from '@/lib/marketplace'

// ── B2B supply order — pure line builder (marketplace Slice 2, Agent 14) ──────
// Immutable price/name/unit snapshots + integer-cents total. Separate from B2C.

const items = [
  { id: 'a', name: 'Tomate', unit: 'kg', priceCents: 250, available: true },
  { id: 'b', name: 'Lait',   unit: 'L',  priceCents: 100, available: true },
  { id: 'c', name: 'Sel',    unit: 'kg', priceCents: 50,  available: false },
]

describe('buildOrderLines', () => {
  it('builds immutable snapshots + total in CENTS', () => {
    const r = buildOrderLines(items, [{ catalogItemId: 'a', quantity: 3 }, { catalogItemId: 'b', quantity: 2 }])
    expect(r.ok).toBe(true)
    expect(r.totalCents).toBe(950) // 3×250 + 2×100
    expect(r.lines).toEqual([
      { catalogItemId: 'a', nameSnapshot: 'Tomate', unitSnapshot: 'kg', quantity: 3, unitPriceCents: 250, lineTotalCents: 750 },
      { catalogItemId: 'b', nameSnapshot: 'Lait',   unitSnapshot: 'L',  quantity: 2, unitPriceCents: 100, lineTotalCents: 200 },
    ])
  })

  it('refuses an UNAVAILABLE item', () => {
    const r = buildOrderLines(items, [{ catalogItemId: 'c', quantity: 1 }])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/indisponible/i)
  })

  it('refuses an unknown item id (not in the supplier scope)', () => {
    expect(buildOrderLines(items, [{ catalogItemId: 'zzz', quantity: 1 }]).ok).toBe(false)
  })

  it('refuses an invalid quantity (0, negative, fractional)', () => {
    expect(buildOrderLines(items, [{ catalogItemId: 'a', quantity: 0 }]).ok).toBe(false)
    expect(buildOrderLines(items, [{ catalogItemId: 'a', quantity: -2 }]).ok).toBe(false)
    expect(buildOrderLines(items, [{ catalogItemId: 'a', quantity: 1.5 }]).ok).toBe(false)
  })

  it('refuses an empty cart', () => {
    expect(buildOrderLines(items, []).ok).toBe(false)
  })
})
