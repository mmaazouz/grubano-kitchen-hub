import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/marketplace/reorder — read-only low-stock bridge (Slice 4) ───────
// Scopes to the operator's brands, returns ONLY low items (most-critical first),
// and NEVER writes stock (the mock exposes findMany only — a write would throw).

const { db, operatorCaller } = vi.hoisted(() => ({
  db: { stockItem: { findMany: vi.fn() } },
  operatorCaller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: operatorCaller }))

import { GET } from '@/app/api/marketplace/reorder/route'

beforeEach(() => vi.clearAllMocks())

describe('GET /api/marketplace/reorder', () => {
  it('returns ONLY low-stock items, scoped to operator brands, most-critical first', async () => {
    operatorCaller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.stockItem.findMany.mockResolvedValue([
      { id: 'a', name: 'Tomate', quantity: 0.2, unit: 'kg', minThreshold: 1, dlc: null }, // urgent (ratio 0.2)
      { id: 'b', name: 'Lait',   quantity: 5,   unit: 'L',  minThreshold: 2, dlc: null }, // ok → excluded
      { id: 'c', name: 'Farine', quantity: 0.8, unit: 'kg', minThreshold: 1, dlc: null }, // soon (ratio 0.8)
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items.map((i: { id: string }) => i.id)).toEqual(['a', 'c']) // low only, urgent first
    expect(data.items[0].status).toBe('urgent')
    expect(data.items[1].status).toBe('soon')
    // READ scoped to the operator's brands — no client brandId trusted.
    expect(db.stockItem.findMany.mock.calls[0][0].where).toEqual({ brand: { operatorId: 'op1' } })
  })

  it('401 anon, 403 non-restaurant; does not read/write stock when unauthorized', async () => {
    operatorCaller.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    operatorCaller.mockResolvedValue({ id: 'op1', role: 'consumer' })
    expect((await GET()).status).toBe(403)
    expect(db.stockItem.findMany).not.toHaveBeenCalled()
  })
})
