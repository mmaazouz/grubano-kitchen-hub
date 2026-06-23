import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// ── lib/mission-attribution — Brick 2/4 compliant attribution (Agent 123) ──────
// Verifies the 5 compliance invariants: offer-never-assign, free atomic first-come acceptance,
// decline = no-op without penalty, objective/transparent eligibility, no auto-deactivation. Plus
// gating. Uses the REAL lib/missions (brick 1, reused) — only prisma is mocked.

const { db } = vi.hoisted(() => ({
  db: {
    mission: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    missionDecline: { upsert: vi.fn() },
    logisticsProfile: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@prisma/client', () => ({ Prisma: {} })) // brick-1 lib/missions imports the Prisma namespace (type-only use)

import * as attribution from '@/lib/mission-attribution'
import {
  isCourierEligibleForMission, eligibleCouriers,
  offerMission, acceptMission, declineMission, offeredMissionsForCourier,
} from '@/lib/mission-attribution'

const COURIER = (over: Partial<{ id: string; status: string; missionTypes: string[]; vehicleTypes: string[]; zones: string[] }> = {}) => ({
  id: 'c1', status: 'active', missionTypes: ['repas'], vehicleTypes: ['velo'], zones: ['Paris'], ...over,
})

const OLD = process.env.LOGISTICS_MISSIONS_ENABLED
beforeEach(() => {
  vi.clearAllMocks()
  process.env.LOGISTICS_MISSIONS_ENABLED = 'true'
})
afterAll(() => {
  if (OLD === undefined) delete process.env.LOGISTICS_MISSIONS_ENABLED
  else process.env.LOGISTICS_MISSIONS_ENABLED = OLD
})

describe('(a) eligibility — objective + transparent, no scoring', () => {
  const mission = { type: 'repas', zone: 'Paris' }
  it('active courier matching zone + type → eligible', () => {
    expect(isCourierEligibleForMission(COURIER(), mission)).toBe(true)
  })
  it('non-active status → not eligible', () => {
    expect(isCourierEligibleForMission(COURIER({ status: 'pending' }), mission)).toBe(false)
    expect(isCourierEligibleForMission(COURIER({ status: 'suspended' }), mission)).toBe(false)
  })
  it('wrong zone / wrong mission type → not eligible', () => {
    expect(isCourierEligibleForMission(COURIER({ zones: ['Lyon'] }), mission)).toBe(false)
    expect(isCourierEligibleForMission(COURIER({ missionTypes: ['b2b'] }), mission)).toBe(false)
  })
  it('optional vehicle requirement is enforced when present', () => {
    const cold = { type: 'froid', zone: 'Paris', requiredVehicleTypes: ['frigorifique'] }
    expect(isCourierEligibleForMission(COURIER({ missionTypes: ['froid'], vehicleTypes: ['velo'] }), cold)).toBe(false)
    expect(isCourierEligibleForMission(COURIER({ missionTypes: ['froid'], vehicleTypes: ['frigorifique'] }), cold)).toBe(true)
  })
  it('null mission zone → zone is not constrained', () => {
    expect(isCourierEligibleForMission(COURIER({ zones: [] }), { type: 'repas', zone: null })).toBe(true)
  })
  it('eligibleCouriers preserves INPUT ORDER (stable, no ranking)', () => {
    const pool = eligibleCouriers(mission, [
      COURIER({ id: 'a' }),
      COURIER({ id: 'b', zones: ['Lyon'] }), // ineligible
      COURIER({ id: 'c' }),
    ])
    expect(pool.map((c) => c.id)).toEqual(['a', 'c']) // same order in, filtered — never reordered
  })
})

describe('(b) acceptance — free, atomic, first-come-wins', () => {
  it('two concurrent accepts → exactly one wins, the other gets graceful "unavailable"', async () => {
    db.mission.findUnique.mockResolvedValue({ id: 'm1', type: 'repas', zone: 'Paris', status: 'offered', courierId: null })
    db.logisticsProfile.findUnique.mockResolvedValue(COURIER())
    let claimed = false
    db.mission.updateMany.mockImplementation(async () => (claimed ? { count: 0 } : ((claimed = true), { count: 1 })))

    const [ra, rb] = await Promise.all([acceptMission('m1', 'cA'), acceptMission('m1', 'cB')])
    const wins = [ra, rb].filter((r) => r.ok)
    const losses = [ra, rb].filter((r) => !r.ok)
    expect(wins).toHaveLength(1)
    expect(losses).toHaveLength(1)
    expect((losses[0] as { reason: string }).reason).toBe('unavailable') // graceful, NOT punitive

    // the claim is the atomic conditional updateMany (status offered + courierId null)
    const call = db.mission.updateMany.mock.calls[0][0]
    expect(call.where).toMatchObject({ id: 'm1', status: 'offered', courierId: null })
    expect(call.data).toMatchObject({ status: 'accepted' })
    expect(call.data.courierId).toBeTruthy()
    expect(call.data.acceptedAt).toBeInstanceOf(Date)
  })

  it('ineligible courier cannot claim (no write attempted)', async () => {
    db.mission.findUnique.mockResolvedValue({ id: 'm1', type: 'repas', zone: 'Paris', status: 'offered', courierId: null })
    db.logisticsProfile.findUnique.mockResolvedValue(COURIER({ status: 'pending' }))
    const r = await acceptMission('m1', 'c1')
    expect(r).toEqual({ ok: false, reason: 'ineligible' })
    expect(db.mission.updateMany).not.toHaveBeenCalled()
  })

  it('already-claimed mission → unavailable, not_found when missing', async () => {
    db.mission.findUnique.mockResolvedValueOnce({ id: 'm1', type: 'repas', zone: 'Paris', status: 'accepted', courierId: 'cX' })
    expect(await acceptMission('m1', 'c1')).toEqual({ ok: false, reason: 'unavailable' })
    db.mission.findUnique.mockResolvedValueOnce(null)
    expect(await acceptMission('mZ', 'c1')).toEqual({ ok: false, reason: 'not_found' })
    expect(db.mission.updateMany).not.toHaveBeenCalled()
  })
})

describe('(c) decline — pure no-op, no penalty, just "do not re-offer to me"', () => {
  it('records an idempotent decline with an EMPTY update (no counter) and never touches the mission', async () => {
    db.missionDecline.upsert.mockResolvedValue({})
    const r = await declineMission('m1', 'c1')
    expect(r).toEqual({ ok: true })

    const call = db.missionDecline.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ missionId_courierId: { missionId: 'm1', courierId: 'c1' } })
    expect(call.create).toEqual({ missionId: 'm1', courierId: 'c1' })
    expect(call.update).toEqual({}) // NO counter/score bumped on a repeat decline

    // the mission stays 'offered' for everyone else → no status mutation
    expect(db.mission.updateMany).not.toHaveBeenCalled()
  })

  it('a thrown upsert (e.g. unknown mission) is swallowed → still ok, never punitive', async () => {
    db.missionDecline.upsert.mockRejectedValue(new Error('FK violation'))
    expect(await declineMission('mZ', 'c1')).toEqual({ ok: true })
  })

  it('offeredMissionsForCourier EXCLUDES missions this courier declined (query filter)', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(COURIER())
    db.mission.findMany.mockResolvedValue([
      { id: 'm1', type: 'repas', zone: 'Paris' },
      { id: 'm2', type: 'b2b', zone: 'Lyon' }, // ineligible → filtered objectively
    ])
    const list = await offeredMissionsForCourier('c1')
    expect(db.mission.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'offered', courierId: null, declines: { none: { courierId: 'c1' } },
    })
    expect(list.map((m: { id: string }) => m.id)).toEqual(['m1']) // only the eligible, non-declined one
  })
})

describe('(d) conformity — structural guarantees', () => {
  it('the module exposes NO assign / score / rank / penalty / deactivate function', () => {
    const forbidden = /assign|score|rank|penal|deactiv|suspend|priorit/i
    const offenders = Object.keys(attribution).filter((k) => forbidden.test(k))
    expect(offenders).toEqual([])
  })
  it('offerMission previews the eligible pool WITHOUT assigning anyone', async () => {
    db.mission.findUnique.mockResolvedValue({ id: 'm1', type: 'repas', zone: 'Paris' })
    db.logisticsProfile.findMany.mockResolvedValue([COURIER({ id: 'c1' }), COURIER({ id: 'c2', zones: ['Lyon'] })])
    const r = await offerMission('m1')
    expect(r).toEqual({ ok: true, eligibleCourierIds: ['c1'] })
    expect(db.mission.updateMany).not.toHaveBeenCalled() // an offer never writes a courier onto the mission
    // pool query is objective: active couriers only
    expect(db.logisticsProfile.findMany.mock.calls[0][0].where).toEqual({ status: 'active' })
  })
})

describe('(e) gating — LOGISTICS_MISSIONS_ENABLED OFF → every op is a no-op', () => {
  beforeEach(() => { process.env.LOGISTICS_MISSIONS_ENABLED = 'false' })
  it('no DB call, neutral results', async () => {
    expect(await offerMission('m1')).toEqual({ ok: false, reason: 'disabled' })
    expect(await acceptMission('m1', 'c1')).toEqual({ ok: false, reason: 'disabled' })
    expect(await declineMission('m1', 'c1')).toEqual({ ok: false, reason: 'disabled' })
    expect(await offeredMissionsForCourier('c1')).toEqual([])
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.mission.updateMany).not.toHaveBeenCalled()
    expect(db.missionDecline.upsert).not.toHaveBeenCalled()
    expect(db.mission.findMany).not.toHaveBeenCalled()
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
  })
})
