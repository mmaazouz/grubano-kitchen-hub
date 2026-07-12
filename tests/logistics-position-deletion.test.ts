import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Géoloc ÉTAPE 2 — position DELETION (minimization: the point never survives the course) ────
// Two layers:
//   (A) lib/courier-position.deleteCourierPositionForMission — flag-gated, keyed by missionId.
//   (B) step-handler wiring — deliver/cancel erase the point; pickup does not; best-effort + gated.
// courier-position is REAL here (it uses the mocked prisma + mocked flag) so we assert the actual
// prisma.courierPosition.deleteMany call the wiring produces.

const { auth, db, missionsLib, attr, accrual, flag } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db: {
    logisticsProfile: { findUnique: vi.fn() },
    courierPosition:  { deleteMany: vi.fn() },
  },
  missionsLib: { isMissionsEnabled: vi.fn() },
  attr:        { advanceMissionByCourier: vi.fn() },
  accrual:     { accrueCourierCourseEarning: vi.fn(), accrueCourierTipEarning: vi.fn() },
  flag:        { isLogisticsTrackingEnabled: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/missions', () => missionsLib)
vi.mock('@/lib/mission-attribution', () => attr)
vi.mock('@/lib/courier-accrual', () => accrual)
vi.mock('@/lib/logistics-tracking', () => ({ isLogisticsTrackingEnabled: flag.isLogisticsTrackingEnabled }))
// NB: @/lib/courier-position is NOT mocked — it is the real helper (mocked prisma + mocked flag).

import { deleteCourierPositionForMission } from '@/lib/courier-position'
import { POST as pickup } from '@/app/api/logistics/missions/[id]/pickup/route'
import { POST as deliver } from '@/app/api/logistics/missions/[id]/deliver/route'
import { POST as cancel } from '@/app/api/logistics/missions/[id]/cancel/route'

const req = () => new Request('http://t/x', { method: 'POST' })
const ctx = { params: { id: 'm1' } }

beforeEach(() => {
  vi.clearAllMocks()
  missionsLib.isMissionsEnabled.mockReturnValue(true)
  flag.isLogisticsTrackingEnabled.mockReturnValue(true)
  auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  db.courierPosition.deleteMany.mockResolvedValue({ count: 1 })
  accrual.accrueCourierCourseEarning.mockResolvedValue(undefined)
  accrual.accrueCourierTipEarning.mockResolvedValue(undefined)
})

describe('(A) deleteCourierPositionForMission — the lib helper', () => {
  it('flag ON → deleteMany({ where:{ missionId } }), returns the count', async () => {
    db.courierPosition.deleteMany.mockResolvedValue({ count: 3 })
    const res = await deleteCourierPositionForMission('m9')
    expect(db.courierPosition.deleteMany).toHaveBeenCalledWith({ where: { missionId: 'm9' } })
    expect(res).toEqual({ deleted: 3 })
  })
  it('flag OFF → no-op, NEVER touches the table (byte-identical, safe pre-migration)', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    const res = await deleteCourierPositionForMission('m9')
    expect(res).toEqual({ deleted: 0 })
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
})

describe('(B) step-handler wiring — the point is erased when the mission ENDS', () => {
  it('deliver (ok) → erases the point, keyed by missionId', async () => {
    attr.advanceMissionByCourier.mockResolvedValue({ ok: true, missionId: 'm1', status: 'delivered' })
    const res = await deliver(req(), ctx)
    expect(res.status).toBe(200)
    expect(db.courierPosition.deleteMany).toHaveBeenCalledWith({ where: { missionId: 'm1' } })
  })
  it('cancel (ok) → erases the point too', async () => {
    attr.advanceMissionByCourier.mockResolvedValue({ ok: true, missionId: 'm1', status: 'cancelled' })
    await cancel(req(), ctx)
    expect(db.courierPosition.deleteMany).toHaveBeenCalledWith({ where: { missionId: 'm1' } })
  })
  it('pickup (ok, NOT terminal) → does NOT erase the point', async () => {
    attr.advanceMissionByCourier.mockResolvedValue({ ok: true, missionId: 'm1', status: 'picked_up' })
    await pickup(req(), ctx)
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
  it('deliver on a conflict retry (already terminal) → still erases (HEALS a missed delete)', async () => {
    attr.advanceMissionByCourier.mockResolvedValue({ ok: false, reason: 'conflict' })
    await deliver(req(), ctx)
    expect(db.courierPosition.deleteMany).toHaveBeenCalledWith({ where: { missionId: 'm1' } })
  })
  it('deliver on a forbidden/invalid result → does NOT erase (no false deletion)', async () => {
    attr.advanceMissionByCourier.mockResolvedValue({ ok: false, reason: 'invalid_transition' })
    await deliver(req(), ctx)
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
  it('tracking flag OFF → deliver ok but NO deletion (byte-identical, table never touched)', async () => {
    flag.isLogisticsTrackingEnabled.mockReturnValue(false)
    attr.advanceMissionByCourier.mockResolvedValue({ ok: true, missionId: 'm1', status: 'delivered' })
    const res = await deliver(req(), ctx)
    expect(res.status).toBe(200)
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
  it('best-effort: a deletion failure NEVER breaks the delivery response (still 200)', async () => {
    attr.advanceMissionByCourier.mockResolvedValue({ ok: true, missionId: 'm1', status: 'delivered' })
    db.courierPosition.deleteMany.mockRejectedValue(new Error('db down'))
    const res = await deliver(req(), ctx)
    expect(res.status).toBe(200)
  })
})
