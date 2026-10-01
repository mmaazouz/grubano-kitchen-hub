import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Logistics mission SURFACES routes — brick 3/4 (Agent 124) ──────────────────
// Verify: gating (flag OFF → 404, no lib call), auth/scoping (courier by session e-mail;
// requester by session id + business role), accept graceful 'unavailable', decline no-op,
// create stamps the requester in snapshot (no money), requested list is owner-scoped.

const { auth, db, missionsLib, attr } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db: { logisticsProfile: { findUnique: vi.fn() }, mission: { findMany: vi.fn() } },
  missionsLib: { isMissionsEnabled: vi.fn(), createMission: vi.fn() },
  attr: { offeredMissionsForCourier: vi.fn(), acceptMission: vi.fn(), declineMission: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/missions', () => missionsLib)
vi.mock('@/lib/mission-attribution', () => attr)

import { GET as listOffered } from '@/app/api/logistics/missions/route'
import { POST as acceptRoute } from '@/app/api/logistics/missions/[id]/accept/route'
import { POST as declineRoute } from '@/app/api/logistics/missions/[id]/decline/route'
import { POST as createRoute, GET as listRequested } from '@/app/api/logistics/missions/request/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const MISSION = (over = {}) => ({
  id: 'm1', type: 'repas', pickupAddress: 'A', dropoffAddress: 'B', zone: 'Paris',
  priceCents: 600, status: 'offered', courierId: null, createdAt: new Date('2026-06-23T10:00:00Z'), ...over,
})
const post = (body?: unknown) =>
  new Request('http://t/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  missionsLib.isMissionsEnabled.mockReturnValue(true)
})

describe('(a) gating — flag OFF → 404, no lib touched', () => {
  beforeEach(() => missionsLib.isMissionsEnabled.mockReturnValue(false))
  it('every route 404s and calls nothing', async () => {
    expect((await listOffered()).status).toBe(404)
    expect((await acceptRoute(post(), { params: { id: 'm1' } })).status).toBe(404)
    expect((await declineRoute(post(), { params: { id: 'm1' } })).status).toBe(404)
    expect((await createRoute(post({ type: 'repas', pickupAddress: 'AAA', dropoffAddress: 'BBB' }))).status).toBe(404)
    expect((await listRequested()).status).toBe(404)
    expect(attr.offeredMissionsForCourier).not.toHaveBeenCalled()
    expect(attr.acceptMission).not.toHaveBeenCalled()
    expect(attr.declineMission).not.toHaveBeenCalled()
    expect(missionsLib.createMission).not.toHaveBeenCalled()
  })
})

describe('(b) auth — courier scope + requester role', () => {
  it('offered list: 401 no session, 403 no courier profile', async () => {
    auth.getServerSession.mockResolvedValueOnce(null)
    expect((await listOffered()).status).toBe(401)
    auth.getServerSession.mockResolvedValueOnce({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValueOnce(null)
    expect((await listOffered()).status).toBe(403)
  })
  it('create: 401 no session, 403 for a non-business role (consumer)', async () => {
    auth.getServerSession.mockResolvedValueOnce(null)
    expect((await createRoute(post({ type: 'repas', pickupAddress: 'AAA', dropoffAddress: 'BBB' }))).status).toBe(401)
    auth.getServerSession.mockResolvedValueOnce({ user: { id: 'op1', roles: ['consumer'] } })
    const res = await createRoute(post({ type: 'repas', pickupAddress: 'AAA', dropoffAddress: 'BBB' }))
    expect(res.status).toBe(403)
    expect(missionsLib.createMission).not.toHaveBeenCalled()
  })
})

describe('(c) accept via route — delegates + graceful unavailable', () => {
  beforeEach(() => {
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  })
  it('ok:true passes through', async () => {
    attr.acceptMission.mockResolvedValueOnce({ ok: true, missionId: 'm1', courierId: 'cP' })
    const res = await acceptRoute(post(), { params: { id: 'm1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, missionId: 'm1', courierId: 'cP' })
    expect(attr.acceptMission).toHaveBeenCalledWith('m1', 'cP')
  })
  it('lost race → 200 with {ok:false, reason:"unavailable"} (no error, no penalty)', async () => {
    attr.acceptMission.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    const res = await acceptRoute(post(), { params: { id: 'm1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('(d) decline via route — no-op, no penalty', () => {
  it('delegates to declineMission(id, courier) and returns {ok:true}', async () => {
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
    attr.declineMission.mockResolvedValueOnce({ ok: true })
    const res = await declineRoute(post(), { params: { id: 'm1' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(attr.declineMission).toHaveBeenCalledWith('m1', 'cP')
    // no penalty / score field is ever returned
    expect(Object.keys(body)).toEqual(['ok'])
  })
})

describe('(e) create via route — stamps requester in snapshot, no money', () => {
  it('a restaurant operator creates an offered mission', async () => {
    auth.getServerSession.mockResolvedValue({ user: { id: 'op1', roles: ['restaurant'] } })
    missionsLib.createMission.mockResolvedValueOnce(MISSION())
    const res = await createRoute(post({ type: 'repas', pickupAddress: 'Rue A', dropoffAddress: 'Rue B', zone: 'Paris', priceCents: 600 }))
    expect(res.status).toBe(200)
    const arg = missionsLib.createMission.mock.calls[0][0]
    expect(arg.snapshot).toEqual({ requestedByOperatorId: 'op1' }) // requester linkage (no schema change)
    expect(arg.type).toBe('repas')
    expect(arg.priceCents).toBe(600)
    expect('courierId' in arg).toBe(false) // never assigns a courier
    expect('orderId' in arg).toBe(false)   // standalone B2B mission (no consumer order)
  })
})

describe('(f) requested list — owner-scoped to the connected operator', () => {
  it('filters missions by snapshot.requestedByOperatorId = session id', async () => {
    auth.getServerSession.mockResolvedValue({ user: { id: 'op1', roles: ['supplier'] } })
    db.mission.findMany.mockResolvedValueOnce([MISSION({ status: 'accepted' })])
    const res = await listRequested()
    expect(res.status).toBe(200)
    const where = db.mission.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ snapshot: { path: '$.requestedByOperatorId', equals: 'op1' } })
    const body = await res.json()
    expect(body.missions[0].status).toBe('accepted')
  })
})
