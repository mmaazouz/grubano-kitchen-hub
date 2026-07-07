import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Géoloc ÉTAPE 4 — GET /api/orders/[id]/courier-position (owner-scoped display) ──────────────
// Owner (consumer) → COARSENED (never exact). Admin → EXACT. Restaurant operator / anyone else →
// 403. Flag OFF → 404 before any read. coarsen + ETA are REAL (integration).

const { jwt, db, scope, flag } = vi.hoisted(() => ({
  jwt: { getToken: vi.fn() },
  db: {
    order:           { findUnique: vi.fn() },
    mission:         { findFirst: vi.fn() },
    courierPosition: { findUnique: vi.fn() },
  },
  scope: { resolveEstablishmentScope: vi.fn() },
  flag:  { isLogisticsTrackingEnabled: vi.fn() },
}))
vi.mock('next-auth/jwt', () => ({ getToken: jwt.getToken }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scope.resolveEstablishmentScope }))
vi.mock('@/lib/logistics-tracking', () => ({ isLogisticsTrackingEnabled: flag.isLogisticsTrackingEnabled }))
// REAL: @/lib/courier-position-view (+ @/lib/geocode) — coarsening + ETA are exercised for real.

import { GET } from '@/app/api/orders/[id]/courier-position/route'

const EXACT = { lat: 48.85678912, lng: 2.35234567 }
const ctx = { params: { id: 'o1' } }
const call = () => GET(new NextRequest('http://x/api/orders/o1/courier-position'), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  flag.isLogisticsTrackingEnabled.mockReturnValue(true)
  jwt.getToken.mockResolvedValue({ sub: 'consumer1' })
  db.order.findUnique.mockResolvedValue({
    id: 'o1', consumerId: 'consumer1', restaurantId: 'r1',
    deliveryLat: 48.86, deliveryLng: 2.36,
    restaurant: { lat: 48.84, lng: 2.34 },
  })
  db.mission.findFirst.mockResolvedValue({ id: 'm1', courierId: 'cP', status: 'picked_up' })
  db.courierPosition.findUnique.mockResolvedValue({ lat: EXACT.lat, lng: EXACT.lng, updatedAt: new Date('2026-07-07T10:00:00Z') })
  scope.resolveEstablishmentScope.mockResolvedValue({ ok: true, role: 'admin' })
})

describe('gating', () => {
  it('flag OFF → 404, NO order read (byte-identical, no position surface)', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    const res = await call()
    expect(res.status).toBe(404)
    expect(db.order.findUnique).not.toHaveBeenCalled()
  })
  it('no token → 401', async () => {
    jwt.getToken.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
  it('order not found → 404', async () => {
    db.order.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
})

describe('owner-scope + coarsening (no IDOR, never exact to the client)', () => {
  it('the ORDER OWNER (consumer) gets the COARSENED position, approx:true — never the exact point', async () => {
    jwt.getToken.mockResolvedValue({ sub: 'consumer1' }) // === order.consumerId
    const json = await (await call()).json()
    expect(json.available).toBe(true)
    expect(json.approx).toBe(true)
    expect(json.courier).toEqual({ lat: 48.857, lng: 2.352 }) // coarsened (3 decimals)
    expect(json.courier).not.toEqual(EXACT)
    expect(scope.resolveEstablishmentScope).not.toHaveBeenCalled() // owner path doesn't consult scope
  })
  it('a NON-owner NON-admin (restaurant operator owning the establishment) → 403, courier never read', async () => {
    jwt.getToken.mockResolvedValue({ sub: 'someone_else' })
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: true, role: 'operator', ownedIds: ['r1'] })
    const res = await call()
    expect(res.status).toBe(403)
    expect(db.courierPosition.findUnique).not.toHaveBeenCalled() // the restaurant NEVER sees the courier
  })
  it('a non-operator non-owner (scope not ok) → 403', async () => {
    jwt.getToken.mockResolvedValue({ sub: 'someone_else' })
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, error: 'x', status: 403 })
    expect((await call()).status).toBe(403)
  })
})

describe('admin whitelist (exact)', () => {
  it('ADMIN (non-owner) gets the EXACT position, approx:false', async () => {
    jwt.getToken.mockResolvedValue({ sub: 'admin1' })
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: true, role: 'admin' })
    const json = await (await call()).json()
    expect(json.available).toBe(true)
    expect(json.approx).toBe(false)
    expect(json.courier).toEqual(EXACT) // exact for admin/support
  })
})

describe('availability + anchors + ETA', () => {
  it('no in-course mission → { available:false }, no position read', async () => {
    db.mission.findFirst.mockResolvedValue(null)
    const json = await (await call()).json()
    expect(json).toEqual({ available: false })
    expect(db.courierPosition.findUnique).not.toHaveBeenCalled()
  })
  it('mission but no stored point → { available:false }', async () => {
    db.courierPosition.findUnique.mockResolvedValue(null)
    expect(await (await call()).json()).toEqual({ available: false })
  })
  it('exposes an ETA (minutes) + EXACT anchors (restaurant + own address) for the map', async () => {
    const json = await (await call()).json() // owner
    expect(typeof json.etaMinutes).toBe('number')
    expect(json.etaMinutes).toBeGreaterThanOrEqual(1)
    expect(json.pickup).toEqual({ lat: 48.84, lng: 2.34 })
    expect(json.dropoff).toEqual({ lat: 48.86, lng: 2.36 })
  })
  it('reads the point by the (courierId, missionId) unique key', async () => {
    await call()
    expect(db.courierPosition.findUnique.mock.calls[0][0].where).toEqual({
      courierId_missionId: { courierId: 'cP', missionId: 'm1' },
    })
  })
})
