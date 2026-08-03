import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── P4.3 ÉTAPE 5 — GET /api/logistics/earnings (LO6 feed) ────────────────────────────
// Owner-scoped (session email → LogisticsProfile), real balances + CourierEarning rows,
// server cents. No hard gate (empty when nothing accrued). Prisma + balance mocked.

const { auth, db, bal } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db:   { logisticsProfile: { findUnique: vi.fn() }, courierEarning: { findMany: vi.fn() } },
  bal:  { computePartnerBalance: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: bal.computePartnerBalance }))

import { GET } from '@/app/api/logistics/earnings/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

beforeEach(() => {
  vi.clearAllMocks()
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1' })
  db.courierEarning.findMany.mockResolvedValue([])
  bal.computePartnerBalance.mockResolvedValue({ availableCents: 0, paidCents: 0 })
})

it('401 without a session', async () => {
  auth.getServerSession.mockResolvedValue(null)
  expect((await GET()).status).toBe(401)
})

it('404 without a courier profile (never a client id)', async () => {
  db.logisticsProfile.findUnique.mockResolvedValue(null)
  expect((await GET()).status).toBe(404)
  expect(db.logisticsProfile.findUnique.mock.calls[0][0].where).toEqual({ email: 'c@x.fr' })
})

it('owner-scoped balance + earnings; pending net summed; real Mission ref; server cents', async () => {
  bal.computePartnerBalance.mockResolvedValue({ availableCents: 4800, paidCents: 41200 })
  db.courierEarning.findMany.mockResolvedValue([
    { id: 'e1', type: 'course', grossCents: 600, feeCents: 120, netCents: 480, status: 'pending', missionId: 'm1', orderId: 'o1', maturesAt: null, createdAt: new Date('2026-07-01T00:00:00Z') },
    { id: 'e2', type: 'tip',    grossCents: 200, feeCents: 0,   netCents: 200, status: 'matured', missionId: 'm1', orderId: 'o1', maturesAt: null, createdAt: new Date('2026-07-01T00:00:00Z') },
  ])
  const res = await GET()
  const json = await res.json()
  expect(bal.computePartnerBalance).toHaveBeenCalledWith('logistics', 'lp1')
  expect(db.courierEarning.findMany.mock.calls[0][0].where).toEqual({ courierId: 'lp1' })
  expect(json.balance).toEqual({ availableCents: 4800, paidCents: 41200 })
  expect(json.pendingCents).toBe(480) // only the pending course row's net
  expect(json.earnings).toHaveLength(2)
  expect(json.earnings[0]).toMatchObject({ id: 'e1', type: 'course', grossCents: 600, feeCents: 120, netCents: 480, missionId: 'm1' })
  expect(json.earnings[1]).toMatchObject({ id: 'e2', type: 'tip', netCents: 200, feeCents: 0 })
})

it('empty rail (nothing accrued) → zero balances, empty list', async () => {
  const json = await (await GET()).json()
  expect(json.balance).toEqual({ availableCents: 0, paidCents: 0 })
  expect(json.pendingCents).toBe(0)
  expect(json.earnings).toEqual([])
})
