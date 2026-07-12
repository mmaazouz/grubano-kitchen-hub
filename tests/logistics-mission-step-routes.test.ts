import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Courier step ROUTES — pickup / deliver / cancel (brick 3 wiring, Agent 126) ─
// Thin routes over the shared step-handler: gating (flag OFF → 404, brick-2 untouched), auth
// scoping (courier by session e-mail → LogisticsProfile; 401/403), delegation with the RESOLVED
// courier id + fixed target (never a client id), and the brick-2 reason → HTTP mapping
// (invalid_transition→422, forbidden→403, conflict→409). NO money anywhere.

const { auth, db, missionsLib, attr } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db: { logisticsProfile: { findUnique: vi.fn() } },
  missionsLib: { isMissionsEnabled: vi.fn() },
  attr: { advanceMissionByCourier: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/missions', () => missionsLib)
vi.mock('@/lib/mission-attribution', () => attr)

import { POST as pickup } from '@/app/api/logistics/missions/[id]/pickup/route'
import { POST as deliver } from '@/app/api/logistics/missions/[id]/deliver/route'
import { POST as cancel } from '@/app/api/logistics/missions/[id]/cancel/route'

const req = () => new Request('http://t/x', { method: 'POST' })
const ctx = { params: { id: 'm1' } }

beforeEach(() => {
  vi.clearAllMocks()
  missionsLib.isMissionsEnabled.mockReturnValue(true)
})

it('gating OFF → 404 for all three, brick-2 never called', async () => {
  missionsLib.isMissionsEnabled.mockReturnValue(false)
  expect((await pickup(req(), ctx)).status).toBe(404)
  expect((await deliver(req(), ctx)).status).toBe(404)
  expect((await cancel(req(), ctx)).status).toBe(404)
  expect(attr.advanceMissionByCourier).not.toHaveBeenCalled()
})

it('401 without session, 403 without a courier profile', async () => {
  auth.getServerSession.mockResolvedValueOnce(null)
  expect((await pickup(req(), ctx)).status).toBe(401)
  auth.getServerSession.mockResolvedValueOnce({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValueOnce(null)
  expect((await pickup(req(), ctx)).status).toBe(403)
  expect(attr.advanceMissionByCourier).not.toHaveBeenCalled()
})

it('pickup delegates with the RESOLVED courier id + fixed target, passes ok through', async () => {
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  attr.advanceMissionByCourier.mockResolvedValueOnce({ ok: true, missionId: 'm1', status: 'picked_up' })
  const res = await pickup(req(), ctx)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, missionId: 'm1', status: 'picked_up' })
  expect(attr.advanceMissionByCourier).toHaveBeenCalledWith('m1', 'cP', 'picked_up') // never a client id
})

it('deliver + cancel target their own step', async () => {
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  attr.advanceMissionByCourier.mockResolvedValue({ ok: true, missionId: 'm1', status: 'delivered' })
  await deliver(req(), ctx)
  expect(attr.advanceMissionByCourier).toHaveBeenLastCalledWith('m1', 'cP', 'delivered')
  await cancel(req(), ctx)
  expect(attr.advanceMissionByCourier).toHaveBeenLastCalledWith('m1', 'cP', 'cancelled')
})

it('reason → HTTP: invalid_transition→422, forbidden→403, conflict→409, not_found→404', async () => {
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  attr.advanceMissionByCourier.mockResolvedValueOnce({ ok: false, reason: 'invalid_transition' })
  expect((await deliver(req(), ctx)).status).toBe(422)
  attr.advanceMissionByCourier.mockResolvedValueOnce({ ok: false, reason: 'forbidden' })
  expect((await pickup(req(), ctx)).status).toBe(403)
  attr.advanceMissionByCourier.mockResolvedValueOnce({ ok: false, reason: 'conflict' })
  expect((await cancel(req(), ctx)).status).toBe(409)
  attr.advanceMissionByCourier.mockResolvedValueOnce({ ok: false, reason: 'not_found' })
  expect((await pickup(req(), ctx)).status).toBe(404)
})
