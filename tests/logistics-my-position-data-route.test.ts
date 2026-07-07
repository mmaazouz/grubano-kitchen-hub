import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Géoloc ÉTAPE 5 — GET/DELETE /api/logistics/my-position-data (courier RGPD access + erasure) ──
// Owner-scoped (session email → LogisticsProfile; never a client id → no IDOR). Flag-gated.

const { auth, db, flag } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db:   { logisticsProfile: { findUnique: vi.fn() }, courierPosition: { findMany: vi.fn(), deleteMany: vi.fn() } },
  flag: { isLogisticsTrackingEnabled: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-tracking', () => ({ isLogisticsTrackingEnabled: flag.isLogisticsTrackingEnabled }))

import { GET, DELETE } from '@/app/api/logistics/my-position-data/route'

beforeEach(() => {
  vi.clearAllMocks()
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1', trackingConsent: true, trackingConsentAt: new Date('2026-07-01T00:00:00Z') })
  db.courierPosition.findMany.mockResolvedValue([{ missionId: 'm1', lat: 48.85, lng: 2.35, accuracy: 5, updatedAt: new Date() }])
  db.courierPosition.deleteMany.mockResolvedValue({ count: 1 })
  flag.isLogisticsTrackingEnabled.mockReturnValue(true)
})

describe('GET (art. 15 access)', () => {
  it('401 without a session', async () => {
    auth.getServerSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('OFF → { enabled:false }, NEVER reads the tracking columns (safe pre-migration)', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    expect(await (await GET()).json()).toEqual({ enabled: false })
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
  })
  it('ON → returns the courier OWN consent + OWN positions (owner-scoped by session email, no IDOR)', async () => {
    const json = await (await GET()).json()
    expect(json.enabled).toBe(true)
    expect(json.consent).toBe(true)
    expect(json.positions).toHaveLength(1)
    expect(db.logisticsProfile.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x.fr' })
    expect(db.courierPosition.findMany.mock.calls[0][0].where).toEqual({ courierId: 'lp1' }) // only their own
  })
  it('ON + no profile → 403', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
    expect(db.courierPosition.findMany).not.toHaveBeenCalled()
  })
})

describe('DELETE (art. 17 erasure)', () => {
  it('401 without a session', async () => {
    auth.getServerSession.mockResolvedValue(null)
    expect((await DELETE()).status).toBe(401)
  })
  it('OFF → 404 gated, NO delete', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    expect((await DELETE()).status).toBe(404)
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
  it('ON → erases ONLY the courier own points (owner-scoped), returns the count', async () => {
    const json = await (await DELETE()).json()
    expect(json).toEqual({ ok: true, deleted: 1 })
    expect(db.courierPosition.deleteMany.mock.calls[0][0].where).toEqual({ courierId: 'lp1' }) // never another courier
  })
  it('ON + no profile → 403, no delete', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await DELETE()).status).toBe(403)
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
})
