import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// ── Courier lifecycle STEPS — brick 3 wiring (Agent 126) · lib + S1 masking ────
// The assigned courier drives a mission they OWN: accepted→picked_up→delivered, or
// accepted|picked_up→cancelled. Verifies OWNER-SCOPE (only the assigned courier), the ATOMIC
// guarded transition (WHERE pins status + courierId; count 0 → conflict), state-machine legality
// (invalid step → invalid_transition), gating, and ZERO money (the patch carries ONLY status +
// its timestamp). Uses the REAL brick-1 state machine (lib/missions) — only prisma is mocked.
// Plus the S1 privacy masking of the drop-off on the OFFER list (pure serializeMission).

const { db } = vi.hoisted(() => ({ db: { mission: { findUnique: vi.fn(), updateMany: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@prisma/client', () => ({ Prisma: {} })) // brick-1 lib/missions imports the Prisma namespace (type-only use)

import { advanceMissionByCourier } from '@/lib/mission-attribution'
import { serializeMission } from '@/lib/mission-serialize'

const NOW = new Date('2026-07-05T12:00:00Z')
const MISSION = (over = {}) => ({ id: 'm1', status: 'accepted', courierId: 'cP', ...over })

describe('advanceMissionByCourier (lib)', () => {
  const OLD = process.env.LOGISTICS_MISSIONS_ENABLED
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LOGISTICS_MISSIONS_ENABLED = 'true'
    db.mission.updateMany.mockResolvedValue({ count: 1 })
  })
  afterAll(() => {
    if (OLD === undefined) delete process.env.LOGISTICS_MISSIONS_ENABLED
    else process.env.LOGISTICS_MISSIONS_ENABLED = OLD
  })

  it('accepted→picked_up: ok + ATOMIC WHERE pins id+status+courierId, stamps pickedUpAt', async () => {
    db.mission.findUnique.mockResolvedValue(MISSION({ status: 'accepted' }))
    const r = await advanceMissionByCourier('m1', 'cP', 'picked_up', NOW)
    expect(r).toEqual({ ok: true, missionId: 'm1', status: 'picked_up' })

    const call = db.mission.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'm1', status: 'accepted', courierId: 'cP' }) // owner-scope + atomic guard
    expect(call.data).toEqual({ status: 'picked_up', pickedUpAt: NOW })
    // ZERO money: the patch is ONLY status + its timestamp — no priceCents / gain / payout field.
    expect(Object.keys(call.data).sort()).toEqual(['pickedUpAt', 'status'])
  })

  it('picked_up→delivered: ok, stamps deliveredAt', async () => {
    db.mission.findUnique.mockResolvedValue(MISSION({ status: 'picked_up' }))
    const r = await advanceMissionByCourier('m1', 'cP', 'delivered', NOW)
    expect(r).toEqual({ ok: true, missionId: 'm1', status: 'delivered' })
    expect(db.mission.updateMany.mock.calls[0][0].data).toEqual({ status: 'delivered', deliveredAt: NOW })
  })

  it('courier drops out: accepted→cancelled and picked_up→cancelled both ok (NEUTRAL, no penalty)', async () => {
    db.mission.findUnique.mockResolvedValue(MISSION({ status: 'accepted' }))
    expect((await advanceMissionByCourier('m1', 'cP', 'cancelled', NOW)).ok).toBe(true)
    expect(db.mission.updateMany.mock.calls[0][0].data).toEqual({ status: 'cancelled', cancelledAt: NOW })

    db.mission.findUnique.mockResolvedValue(MISSION({ status: 'picked_up' }))
    expect((await advanceMissionByCourier('m1', 'cP', 'cancelled', NOW)).ok).toBe(true)
  })

  it('OWNER-SCOPE: an unclaimed (offered/null) or someone-else\'s mission → forbidden, NO write', async () => {
    db.mission.findUnique.mockResolvedValueOnce(MISSION({ status: 'offered', courierId: null }))
    expect(await advanceMissionByCourier('m1', 'cP', 'picked_up', NOW)).toEqual({ ok: false, reason: 'forbidden' })
    db.mission.findUnique.mockResolvedValueOnce(MISSION({ status: 'accepted', courierId: 'someoneElse' }))
    expect(await advanceMissionByCourier('m1', 'cP', 'picked_up', NOW)).toEqual({ ok: false, reason: 'forbidden' })
    expect(db.mission.updateMany).not.toHaveBeenCalled()
  })

  it('invalid step → invalid_transition, NO write (skip accepted→delivered; terminal delivered→x)', async () => {
    db.mission.findUnique.mockResolvedValueOnce(MISSION({ status: 'accepted' }))
    expect(await advanceMissionByCourier('m1', 'cP', 'delivered', NOW)).toEqual({ ok: false, reason: 'invalid_transition' })
    db.mission.findUnique.mockResolvedValueOnce(MISSION({ status: 'delivered' }))
    expect(await advanceMissionByCourier('m1', 'cP', 'delivered', NOW)).toEqual({ ok: false, reason: 'invalid_transition' })
    expect(db.mission.updateMany).not.toHaveBeenCalled()
  })

  it('lost race / status moved underneath → conflict (updateMany count 0)', async () => {
    db.mission.findUnique.mockResolvedValue(MISSION({ status: 'accepted' }))
    db.mission.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await advanceMissionByCourier('m1', 'cP', 'picked_up', NOW)).toEqual({ ok: false, reason: 'conflict' })
  })

  it('missing mission → not_found', async () => {
    db.mission.findUnique.mockResolvedValueOnce(null)
    expect(await advanceMissionByCourier('mZ', 'cP', 'picked_up', NOW)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('gating OFF → disabled, no DB touched', async () => {
    process.env.LOGISTICS_MISSIONS_ENABLED = 'false'
    expect(await advanceMissionByCourier('m1', 'cP', 'picked_up', NOW)).toEqual({ ok: false, reason: 'disabled' })
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.mission.updateMany).not.toHaveBeenCalled()
  })
})

describe('serializeMission — S1 drop-off masking', () => {
  const M = (over = {}) => ({
    id: 'm1', type: 'repas', pickupAddress: 'Resto, 5 Rue Pizza', dropoffAddress: '12 Rue de la Paix, 69003 Lyon',
    zone: 'Lyon', priceCents: 600, status: 'offered', courierId: null, orderId: null,
    snapshot: {}, createdAt: new Date('2026-07-05T10:00:00Z'),
    offeredAt: new Date(), acceptedAt: null, pickedUpAt: null, deliveredAt: null,
    declinedAt: null, expiredAt: null, cancelledAt: null, ...over,
  })

  it('unmasked (default): full drop-off, dropoffApprox false', () => {
    const dto = serializeMission(M() as never)
    expect(dto.dropoffAddress).toBe('12 Rue de la Paix, 69003 Lyon')
    expect(dto.dropoffApprox).toBe(false)
  })

  it('masked: prefers the objective zone, hides street/number, dropoffApprox true, pickup intact', () => {
    const dto = serializeMission(M() as never, { maskDropoff: true })
    expect(dto.dropoffApprox).toBe(true)
    expect(dto.dropoffAddress).toBe('Lyon')
    expect(dto.dropoffAddress).not.toMatch(/12 Rue de la Paix/) // exact street NEVER broadcast
    expect(dto.pickupAddress).toBe('Resto, 5 Rue Pizza') // merchant address is not client PII → not masked
  })

  it('masked without a zone: keeps only the postal-code+city tail (street dropped)', () => {
    const dto = serializeMission(M({ zone: null }) as never, { maskDropoff: true })
    expect(dto.dropoffAddress).toBe('69003 Lyon')
    expect(dto.dropoffAddress).not.toMatch(/Rue de la Paix/)
  })

  it('masked with neither zone nor postal: digit-free city segment only', () => {
    const dto = serializeMission(M({ zone: null, dropoffAddress: '12 Rue de la Paix, Lyon' }) as never, { maskDropoff: true })
    expect(dto.dropoffAddress).toBe('Lyon')
  })

  // PRIVACY-FIRST hardening (review finding): the zone-less fallback must NEVER leak the street,
  // even for adversarial inputs. A digit-bearing last segment (street number) → withheld ('').
  it('masked, zone-less: never leaks the street for odd inputs', () => {
    const mask = { maskDropoff: true }
    // 5-digit street NUMBER (not a postal) with a clean city tail → city only, street dropped
    expect(serializeMission(M({ zone: null, dropoffAddress: '12345 Grand Boulevard, Lyon' }) as never, mask).dropoffAddress).toBe('Lyon')
    // "Résidence 75001, …, Paris" — a 5-digit token buried in the street must NOT anchor the reveal
    const r = serializeMission(M({ zone: null, dropoffAddress: 'Résidence 75001, 3 Rue Cachée, Paris' }) as never, mask)
    expect(r.dropoffAddress).toBe('Paris')
    expect(r.dropoffAddress).not.toMatch(/Rue Cachée/)
    // comma-only street with no locality tail → reveal NOTHING (never the street)
    const s = serializeMission(M({ zone: null, dropoffAddress: 'Apt 5, 12 Rue Secret' }) as never, mask)
    expect(s.dropoffAddress).toBe('')
    expect(s.dropoffAddress).not.toMatch(/Rue Secret/)
    // comma-less street-only address → reveal NOTHING
    expect(serializeMission(M({ zone: null, dropoffAddress: '12 Rue Secret' }) as never, mask).dropoffAddress).toBe('')
  })
})
