import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// ── lib/missions — Brique 1/4 logistics mission model + state machine (Agent 122) ──
// Foundation only: NO money (priceCents inert), NO UI, NO attribution. Tests cover the
// model creation (B2C + autonomous B2B), the gating flag, the PURE transitions
// (valid/invalid), and the compliance invariants (declined = neutral terminal; courierId
// null until accepted; no forced 'assigned' state; no penalty/score field).

const { db } = vi.hoisted(() => ({ db: { mission: { create: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// Keep the Prisma namespace import in lib/missions resolvable without the real client.
vi.mock('@prisma/client', () => ({ Prisma: {} }))

import {
  isMissionsEnabled, createMission, canTransition, buildTransitionData,
  MISSION_ACTIVE_STATUSES, MISSION_TERMINAL_STATUSES, type MissionStatus,
} from '@/lib/missions'

const OLD = process.env.LOGISTICS_MISSIONS_ENABLED
beforeEach(() => {
  vi.clearAllMocks()
  process.env.LOGISTICS_MISSIONS_ENABLED = 'true' // ON by default in tests; the OFF case sets false
  db.mission.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data }))
})
afterAll(() => {
  if (OLD === undefined) delete process.env.LOGISTICS_MISSIONS_ENABLED
  else process.env.LOGISTICS_MISSIONS_ENABLED = OLD
})

describe('createMission — model (B2C + autonomous B2B)', () => {
  it('B2C: orderId present → persisted as "offered", NO courier assigned', async () => {
    const m = await createMission({ orderId: 'ord1', pickupAddress: 'A', dropoffAddress: 'B', zone: 'Paris', priceCents: 600 })
    expect(db.mission.create).toHaveBeenCalledTimes(1)
    const data = db.mission.create.mock.calls[0][0].data
    expect(data.orderId).toBe('ord1')
    expect(data.status).toBe('offered')
    expect('courierId' in data).toBe(false) // no forced assignment — courier links only on free accept (brique 2)
    expect(data.priceCents).toBe(600)
    expect(m).not.toBeNull()
  })

  it('B2B: no orderId → autonomous mission (orderId null), still "offered"', async () => {
    await createMission({ type: 'b2b', pickupAddress: 'Entrepôt', dropoffAddress: 'Resto' })
    const data = db.mission.create.mock.calls[0][0].data
    expect(data.orderId).toBeNull()
    expect(data.type).toBe('b2b')
    expect(data.status).toBe('offered')
  })

  it('defaults: type "repas", priceCents 0 (inert), snapshot {}', async () => {
    await createMission({ pickupAddress: 'A', dropoffAddress: 'B' })
    const data = db.mission.create.mock.calls[0][0].data
    expect(data.type).toBe('repas')
    expect(data.priceCents).toBe(0)
    expect(data.snapshot).toEqual({})
  })
})

describe('gating — LOGISTICS_MISSIONS_ENABLED', () => {
  it('OFF → createMission is a no-op (returns null, no write)', async () => {
    process.env.LOGISTICS_MISSIONS_ENABLED = 'false'
    expect(isMissionsEnabled()).toBe(false)
    const m = await createMission({ pickupAddress: 'A', dropoffAddress: 'B' })
    expect(m).toBeNull()
    expect(db.mission.create).not.toHaveBeenCalled()
  })

  it('ON → enabled + creates', async () => {
    expect(isMissionsEnabled()).toBe(true)
    await createMission({ pickupAddress: 'A', dropoffAddress: 'B' })
    expect(db.mission.create).toHaveBeenCalledTimes(1)
  })
})

describe('state machine — valid transitions', () => {
  it('happy path offered→accepted→picked_up→delivered', () => {
    expect(canTransition('offered', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'picked_up')).toBe(true)
    expect(canTransition('picked_up', 'delivered')).toBe(true)
  })
  it('neutral terminals from offered: declined / expired / cancelled', () => {
    expect(canTransition('offered', 'declined')).toBe(true)
    expect(canTransition('offered', 'expired')).toBe(true)
    expect(canTransition('offered', 'cancelled')).toBe(true)
  })
  it('a courier can drop out: accepted→cancelled, picked_up→cancelled', () => {
    expect(canTransition('accepted', 'cancelled')).toBe(true)
    expect(canTransition('picked_up', 'cancelled')).toBe(true)
  })
  it('buildTransitionData stamps the matching timestamp', () => {
    const now = new Date('2026-06-23T10:00:00Z')
    expect(buildTransitionData('offered', 'accepted', now)).toEqual({ status: 'accepted', acceptedAt: now })
    expect(buildTransitionData('picked_up', 'delivered', now)).toEqual({ status: 'delivered', deliveredAt: now })
  })
})

describe('state machine — invalid transitions refused', () => {
  it('cannot go backwards or skip', () => {
    expect(canTransition('picked_up', 'offered')).toBe(false)
    expect(canTransition('delivered', 'accepted')).toBe(false)
    expect(canTransition('offered', 'picked_up')).toBe(false)
    expect(canTransition('accepted', 'delivered')).toBe(false)
  })
  it('terminals go nowhere', () => {
    for (const t of MISSION_TERMINAL_STATUSES) {
      expect(canTransition(t, 'accepted')).toBe(false)
    }
  })
  it('buildTransitionData throws on an invalid transition', () => {
    expect(() => buildTransitionData('delivered', 'accepted', new Date())).toThrow(/Invalid mission transition/)
  })
})

describe('compliance — autonomy is preserved in the model', () => {
  it('"declined" is a NEUTRAL terminal: the patch carries ONLY status + declinedAt (no penalty/score)', () => {
    const now = new Date()
    const data = buildTransitionData('offered', 'declined', now)
    expect(data).toEqual({ status: 'declined', declinedAt: now })
    expect(Object.keys(data).sort()).toEqual(['declinedAt', 'status']) // nothing else — no penalty, no score
  })
  it('there is NO "assigned" / forced state in the machine', () => {
    expect(([...MISSION_ACTIVE_STATUSES, ...MISSION_TERMINAL_STATUSES] as string[])).not.toContain('assigned')
    expect(canTransition('offered', 'assigned' as MissionStatus)).toBe(false)
  })
})
