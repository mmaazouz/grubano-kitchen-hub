import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── GET /api/logistics/missions/mine — the courier's own missions (LO2) ────────
// Verify: gating (flag OFF → 404, no DB), owner-scoping (session email → LogisticsProfile,
// query pinned to courierId; 401/403), current = accepted/picked_up, done = delivered/cancelled,
// and serializeOwnMission reveals the FULL drop-off (dropoffApprox:false) + lifecycle timestamps.

const { auth, db, missionsLib } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db: { logisticsProfile: { findUnique: vi.fn() }, mission: { findMany: vi.fn() } },
  missionsLib: { isMissionsEnabled: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/missions', () => missionsLib) // real mission-serialize is used (no mock)

import { GET } from '@/app/api/logistics/missions/mine/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const MISSION = (over = {}) => ({
  id: 'm1', type: 'repas', pickupAddress: 'Resto, 5 Rue Pizza', dropoffAddress: '22 rue de Charonne, 75011 Paris',
  zone: 'Paris', priceCents: 580, status: 'accepted', courierId: 'cP',
  createdAt: new Date('2026-07-05T10:00:00Z'),
  acceptedAt: new Date('2026-07-05T10:05:00Z'), pickedUpAt: null, deliveredAt: null, cancelledAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  missionsLib.isMissionsEnabled.mockReturnValue(true)
})

it('gating OFF → 404, no DB touched', async () => {
  missionsLib.isMissionsEnabled.mockReturnValue(false)
  const res = await GET()
  expect(res.status).toBe(404)
  expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
  expect(db.mission.findMany).not.toHaveBeenCalled()
})

it('401 without session, 403 without a courier profile', async () => {
  auth.getServerSession.mockResolvedValueOnce(null)
  expect((await GET()).status).toBe(401)
  auth.getServerSession.mockResolvedValueOnce({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValueOnce(null)
  expect((await GET()).status).toBe(403)
  expect(db.mission.findMany).not.toHaveBeenCalled()
})

it('owner-scoped: queries pin courierId + the right status sets; reveals FULL dropoff + timestamps', async () => {
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  db.mission.findMany
    .mockResolvedValueOnce([MISSION({ status: 'accepted' })])                                  // current
    .mockResolvedValueOnce([MISSION({ id: 'm2', status: 'delivered', deliveredAt: new Date('2026-07-05T11:00:00Z') })]) // done

  const res = await GET()
  expect(res.status).toBe(200)

  // both queries are owner-scoped (courierId = the resolved profile id) — never a client id
  const currentWhere = db.mission.findMany.mock.calls[0][0].where
  const doneWhere = db.mission.findMany.mock.calls[1][0].where
  expect(currentWhere).toMatchObject({ courierId: 'cP', status: { in: ['accepted', 'picked_up'] } })
  expect(doneWhere).toMatchObject({ courierId: 'cP', status: { in: ['delivered', 'cancelled'] } })

  const body = await res.json()
  // FULL drop-off revealed post-claim (not masked), + lifecycle timestamps
  expect(body.current[0].dropoffAddress).toBe('22 rue de Charonne, 75011 Paris')
  expect(body.current[0].dropoffApprox).toBe(false)
  expect(body.current[0].acceptedAt).toBe('2026-07-05T10:05:00.000Z')
  expect(body.done[0].status).toBe('delivered')
  expect(body.done[0].deliveredAt).toBe('2026-07-05T11:00:00.000Z')
})
