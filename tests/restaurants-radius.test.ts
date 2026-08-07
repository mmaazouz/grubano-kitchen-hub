import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// Only the geo branch of GET /api/restaurants is under test; it touches one
// Prisma call (restaurant.findMany) and the real haversineKm (left unmocked).
const { findMany, groupBy } = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn() }))
// V4-2 : la route applique le gate d'honnêteté des notes (lib/review-stats →
// prisma.review.groupBy). Zéro avis réel ici → rating null (non asserté par ce
// fichier, qui ne teste que la géo/radius).
vi.mock('@/lib/prisma', () => ({ prisma: { restaurant: { findMany }, review: { groupBy } } }))
// The route imports auth at module load for its POST handler; stub so the
// import is cheap and side-effect free for these GET-only tests.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET } from '@/app/api/restaurants/route'

// Orange, France — the consumer's position for every case below.
const USER = { lat: 44.1380, lng: 4.8079 }
// 1° latitude ≈ 111.195 km; placing a restaurant due north by X/111.195 degrees
// puts it ~X km away (distance along a meridian == R·dLat).
const KM_PER_DEG = 111.195
const at = (km: number, cuisine: string[] = []) => ({
  id: `r${km}`,
  name: `R${km}`,
  coverPhoto: null, logo: null,
  cuisine,
  rating: 4.5, reviewCount: 10, deliveryTime: 25, minOrder: 10, deliveryFee: 1.99,
  city: 'Orange', address: 'x', isActive: true,
  lat: USER.lat + km / KM_PER_DEG,
  lng: USER.lng,
})

const callGeo = async (extra = '') => {
  const res = await GET(new Request(`https://app.grubano.com/api/restaurants?lat=${USER.lat}&lng=${USER.lng}${extra}`))
  return res.json() as Promise<any>
}

beforeEach(() => {
  findMany.mockReset()
  groupBy.mockReset()
  groupBy.mockResolvedValue([]) // zéro avis réel — le gate V4-2 nulle les notes, hors sujet ici
})

describe('GET /api/restaurants — radius expansion', () => {
  it('walks tiers 5→10→25 until ≥8 results and reports the tier used', async () => {
    // 3 within 5km, +2 within 10km (5), +4 within 25km (9 ≥ 8 → stop at 25).
    findMany.mockResolvedValue([
      at(2), at(3), at(4),            // ≤5
      at(7), at(9),                   // ≤10  (total 5)
      at(12), at(15), at(18), at(22), // ≤25  (total 9)
      at(40), at(80),                 // beyond
    ])
    const data = await callGeo()
    expect(data.radiusUsedKm).toBe(25)
    expect(data.total).toBe(9)
    expect(data.categoryHadNoMatch).toBe(false)
  })

  it('returns results sorted by ascending distance', async () => {
    findMany.mockResolvedValue([at(22), at(2), at(15), at(7), at(12), at(3), at(18), at(9), at(4)])
    const data = await callGeo()
    const dists = data.restaurants.map((r: any) => r.distanceKm)
    expect(dists).toEqual([...dists].sort((a, b) => a - b))
  })

  it('uses radiusUsedKm=null (Infinity tier) when fewer than 8 total', async () => {
    findMany.mockResolvedValue([at(3), at(40), at(80)]) // never reaches 8
    const data = await callGeo()
    expect(data.radiusUsedKm).toBeNull()
    expect(data.total).toBe(3)
  })

  it('excludes restaurants without coordinates from the geo results', async () => {
    findMany.mockResolvedValue([
      at(3),
      { ...at(5), id: 'no-coords', lat: null, lng: null },
    ])
    const data = await callGeo()
    const ids = data.restaurants.map((r: any) => r.id)
    expect(ids).not.toContain('no-coords')
    expect(ids).toContain('r3')
  })
})

describe('GET /api/restaurants — category filter + fallback', () => {
  it('filters to the requested category when matches exist', async () => {
    findMany.mockResolvedValue([
      at(2, ['italian']), at(7, ['japanese']), at(40, ['italian']), at(12, ['burger']),
    ])
    const data = await callGeo('&category=italian')
    const cuisines = data.restaurants.flatMap((r: any) => r.cuisine)
    expect(cuisines.every((c: string) => c === 'italian')).toBe(true)
    expect(data.categoryHadNoMatch).toBe(false)
  })

  it('sets categoryHadNoMatch=true and falls back to nearest-of-any when the category matches nothing', async () => {
    findMany.mockResolvedValue([at(2, ['italian']), at(7, ['japanese']), at(12, ['burger'])])
    const data = await callGeo('&category=sushi')
    expect(data.categoryHadNoMatch).toBe(true)
    expect(data.total).toBe(3)        // widened to all coord rows
    expect(data.radiusUsedKm).toBeNull()
  })

  it('aliases ?cuisine= to the category filter', async () => {
    findMany.mockResolvedValue([at(2, ['italian']), at(7, ['japanese'])])
    const data = await callGeo('&cuisine=japanese')
    expect(data.restaurants).toHaveLength(1)
    expect(data.restaurants[0].cuisine).toEqual(['japanese'])
  })
})
