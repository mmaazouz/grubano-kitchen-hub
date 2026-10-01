import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── getDish archived-parent visibility gate (Agent 136) ────────────────────────
// A dish must be reachable by direct URL ONLY when it is available AND its parent restaurant
// exists + is NOT archived — aligning with getRestaurant's archivedAt:null gate. Read-only.

vi.mock('server-only', () => ({})) // data.ts imports 'server-only' (a Next stub, unresolvable in vitest)
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { menuItem: { findFirst } } }))

import { getDish } from '@/app/[locale]/eat-next/data'

beforeEach(() => { vi.clearAllMocks() })

describe('getDish — archived-parent visibility gate', () => {
  it('queries with available:true AND parent restaurant archivedAt:null (read-only findFirst)', async () => {
    findFirst.mockResolvedValueOnce(null)
    await getDish('d1')
    expect(findFirst).toHaveBeenCalledTimes(1)
    const where = findFirst.mock.calls[0][0].where
    expect(where.id).toBe('d1')
    expect(where.available).toBe(true)
    expect(where.brand).toEqual({ restaurant: { archivedAt: null } })
  })

  it('returns null when the dish is not visible (archived parent / unavailable → DB returns nothing)', async () => {
    findFirst.mockResolvedValueOnce(null)
    expect(await getDish('dish-of-archived-resto')).toBeNull()
  })

  it('maps a visible dish (available item, non-archived parent) to the EatNextDish shape', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'd1', name: 'Gnocchi', description: 'maison', price: 12.9, category: 'Pâtes',
      brand: { restaurant: { id: 'r1', name: 'Gnocchi Bar' } },
    })
    expect(await getDish('d1')).toEqual({
      id: 'd1', name: 'Gnocchi', description: 'maison', priceEur: 12.9, category: 'Pâtes',
      restaurantId: 'r1', restaurantName: 'Gnocchi Bar',
    })
  })

  it('degrades restaurantId/Name to empty strings if the parent relation is absent', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'd2', name: 'X', description: null, price: 5, category: 'A', brand: { restaurant: null },
    })
    const dish = await getDish('d2')
    expect(dish?.restaurantId).toBe('')
    expect(dish?.restaurantName).toBe('')
    expect(dish?.description).toBe('')
  })
})
