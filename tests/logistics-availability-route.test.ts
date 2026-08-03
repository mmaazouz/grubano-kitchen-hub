import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Géoloc ÉTAPE 1 — GET/PATCH /api/logistics/availability (« en ligne » toggle) ─────
// Owner-scoped (session email → LogisticsProfile), gated by LOGISTICS_AVAILABILITY_ENABLED,
// rate-limited on the write. ZÉRO géolocalisation — a pure boolean + a lastSeenAt heartbeat.
// OFF → GET {enabled:false} without reading isOnline; PATCH 404 without writing.

const { auth, db, flag, rl } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db:   { logisticsProfile: { findUnique: vi.fn(), update: vi.fn() } },
  flag: { isLogisticsAvailabilityEnabled: vi.fn() },
  rl:   { rateLimit: vi.fn((): Response | null => null) },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-availability', () => ({ isLogisticsAvailabilityEnabled: flag.isLogisticsAvailabilityEnabled }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rl.rateLimit }))

import { GET, PATCH } from '@/app/api/logistics/availability/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const patch = (body: unknown) => PATCH(new NextRequest('http://x/api/logistics/availability', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}))

beforeEach(() => {
  vi.clearAllMocks()
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1', isOnline: false })
  db.logisticsProfile.update.mockResolvedValue({ isOnline: true })
  flag.isLogisticsAvailabilityEnabled.mockReturnValue(true)
  rl.rateLimit.mockReturnValue(null)
})

describe('GET', () => {
  it('401 without a session', async () => {
    auth.getServerSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('OFF → { enabled:false }, NEVER reads isOnline (safe pre-migration)', async () => {
    flag.isLogisticsAvailabilityEnabled.mockReturnValue(false)
    const json = await (await GET()).json()
    expect(json).toEqual({ enabled: false })
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
  })
  it('ON → { enabled:true, isOnline }, owner-scoped by session email', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue({ isOnline: true })
    const json = await (await GET()).json()
    expect(json).toEqual({ enabled: true, isOnline: true })
    expect(db.logisticsProfile.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x.fr' })
  })
})

describe('PATCH', () => {
  it('OFF → 404 gated, NO write (never touches the new columns)', async () => {
    flag.isLogisticsAvailabilityEnabled.mockReturnValue(false)
    const res = await patch({ isOnline: true })
    expect(res.status).toBe(404)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })
  it('ON → sets isOnline + a lastSeenAt heartbeat, owner-scoped by session email', async () => {
    const res = await patch({ isOnline: true })
    expect(res.status).toBe(200)
    const call = db.logisticsProfile.update.mock.calls[0][0]
    expect(call.where).toEqual({ email: 'c@x.fr' }) // never a client id → no IDOR
    expect(call.data.isOnline).toBe(true)
    expect(call.data.lastSeenAt).toBeInstanceOf(Date) // heartbeat
  })
  it('can toggle OFF too (isOnline:false)', async () => {
    db.logisticsProfile.update.mockResolvedValue({ isOnline: false })
    await patch({ isOnline: false })
    expect(db.logisticsProfile.update.mock.calls[0][0].data.isOnline).toBe(false)
  })
  it('no session → 401, no profile → 403, invalid body → 400', async () => {
    auth.getServerSession.mockResolvedValue(null)
    expect((await patch({ isOnline: true })).status).toBe(401)
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await patch({ isOnline: true })).status).toBe(403)
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1' })
    expect((await patch({ isOnline: 'yes' })).status).toBe(400)
  })
  it('rate-limited → returns the limiter response', async () => {
    rl.rateLimit.mockReturnValue(new Response('slow', { status: 429 }))
    expect((await patch({ isOnline: true })).status).toBe(429)
  })
})
