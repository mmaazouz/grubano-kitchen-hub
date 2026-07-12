import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.3 ÉTAPE 3 — courier COURSE accrual (lib/courier-accrual) ──────────────────────
// Locks the writer that FEEDS the rail: amounts + EXPLICIT commission rounding + the
// net=gross−fee assertion + DB-idempotence (P2002) + owner-scope + the flag/data gates.
// Plus an integration slice: the accrued row flows into computePartnerBalance('logistics')
// once matured. Prisma mocked; eurosToCents kept as real integer math.

const { db } = vi.hoisted(() => ({
  db: {
    mission:        { findUnique: vi.fn() },
    order:          { findUnique: vi.fn() },
    courierEarning: { create: vi.fn(), findMany: vi.fn() },
    payout:         { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ eurosToCents: (e: number) => Math.round(e * 100) }))
// KEEP REAL: @/lib/courier-earnings (courierMaturesAt is pure), @/lib/partner-balance

import { accrueCourierCourseEarning, courierCommissionBps } from '@/lib/courier-accrual'
import { computePartnerBalance } from '@/lib/partner-balance'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-06T00:00:00.000Z')
const MISSION = { id: 'm1', status: 'delivered', courierId: 'cP', orderId: 'o1' }
const ORDER_B = { deliveryMode: 'grubano_courier', deliveryFee: 5 } // 500c

beforeEach(() => {
  vi.clearAllMocks()
  process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED = 'true'
  delete process.env.LOGISTICS_COMMISSION_BPS
  delete process.env.COURIER_MATURATION_DAYS
  db.mission.findUnique.mockResolvedValue(MISSION)
  db.order.findUnique.mockResolvedValue(ORDER_B)
  db.courierEarning.create.mockResolvedValue({ id: 'ce1' })
  db.courierEarning.findMany.mockResolvedValue([])
  db.payout.findMany.mockResolvedValue([])
})
afterEach(() => {
  delete process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED
  delete process.env.LOGISTICS_COMMISSION_BPS
  delete process.env.COURIER_MATURATION_DAYS
})

describe('courierCommissionBps — configurable, validated', () => {
  it('default 2000 (20%); in-range override; rejects out-of-range / NaN; 0 is valid', () => {
    expect(courierCommissionBps()).toBe(2000)
    process.env.LOGISTICS_COMMISSION_BPS = '1500'; expect(courierCommissionBps()).toBe(1500)
    process.env.LOGISTICS_COMMISSION_BPS = '-1';   expect(courierCommissionBps()).toBe(2000)
    process.env.LOGISTICS_COMMISSION_BPS = '10001'; expect(courierCommissionBps()).toBe(2000)
    process.env.LOGISTICS_COMMISSION_BPS = 'x';    expect(courierCommissionBps()).toBe(2000)
    process.env.LOGISTICS_COMMISSION_BPS = '0';    expect(courierCommissionBps()).toBe(0)
  })
})

describe('accrual — case B happy path (amounts, rounding, maturesAt)', () => {
  it('creates ONE course earning: gross=deliveryFee, fee=20%, net=80%, pending, maturesAt=now+7d', async () => {
    const out = await accrueCourierCourseEarning('m1', 'cP', NOW)
    expect(out).toMatchObject({ status: 'created', grossCents: 500, feeCents: 100, netCents: 400 })
    const data = db.courierEarning.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      courierId: 'cP', missionId: 'm1', orderId: 'o1', type: 'course',
      grossCents: 500, feeCents: 100, netCents: 400, status: 'pending',
    })
    expect(data.maturesAt.getTime()).toBe(NOW.getTime() + 7 * DAY)
  })

  it('EXPLICIT rounding round(gross×bps/10000): 199c @20% → fee 40, net 159', async () => {
    db.order.findUnique.mockResolvedValue({ deliveryMode: 'grubano_courier', deliveryFee: 1.99 })
    const out = await accrueCourierCourseEarning('m1', 'cP', NOW)
    expect(out).toMatchObject({ grossCents: 199, feeCents: 40, netCents: 159 }) // 199*2000/10000=39.8→40
  })

  it('CONFIGURABLE commission — LOGISTICS_COMMISSION_BPS=1000 (10%) → fee 50, net 450', async () => {
    process.env.LOGISTICS_COMMISSION_BPS = '1000'
    const out = await accrueCourierCourseEarning('m1', 'cP', NOW)
    expect(out).toMatchObject({ grossCents: 500, feeCents: 50, netCents: 450 })
  })

  it('net = gross − fee holds on the created row (the balance invariant)', async () => {
    const out = await accrueCourierCourseEarning('m1', 'cP', NOW)
    if (out.status === 'created') expect(out.netCents).toBe(out.grossCents - out.feeCents)
  })
})

describe('gates — nothing accrues unless flag ON + delivered + owner + order + case B', () => {
  it('flag OFF → rail_disabled, ZERO db touch', async () => {
    delete process.env.LOGISTICS_COURIER_ACCRUAL_ENABLED
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'rail_disabled' })
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('case A (deliveryMode=restaurant) → not_case_b, no create', async () => {
    db.order.findUnique.mockResolvedValue({ deliveryMode: 'restaurant', deliveryFee: 5 })
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'not_case_b' })
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('mission not delivered yet → not_delivered', async () => {
    db.mission.findUnique.mockResolvedValue({ ...MISSION, status: 'picked_up' })
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'not_delivered' })
  })
  it('OWNER-SCOPE — requester ≠ the mission courier → not_owner, no create', async () => {
    expect(await accrueCourierCourseEarning('m1', 'SOMEONE_ELSE', NOW)).toEqual({ status: 'skipped', reason: 'not_owner' })
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('autonomous mission (orderId null) → no_order', async () => {
    db.mission.findUnique.mockResolvedValue({ ...MISSION, orderId: null })
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'no_order' })
  })
  it('mission / order missing → mission_not_found / order_not_found', async () => {
    db.mission.findUnique.mockResolvedValue(null)
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'mission_not_found' })
    db.mission.findUnique.mockResolvedValue(MISSION)
    db.order.findUnique.mockResolvedValue(null)
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'order_not_found' })
  })
})

describe('idempotence — a replay is a no-op (DB @@unique([missionId,type]) → P2002)', () => {
  it('P2002 on create → already_accrued, no throw', async () => {
    db.courierEarning.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await accrueCourierCourseEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'already_accrued' })
  })
  it('a non-P2002 error propagates (surfaced, not swallowed)', async () => {
    db.courierEarning.create.mockRejectedValue(new Error('db down'))
    await expect(accrueCourierCourseEarning('m1', 'cP', NOW)).rejects.toThrow('db down')
  })
})

describe('defensive assertion — net = gross − fee bounds', () => {
  it('a negative gross (bad deliveryFee) trips the assertion → throws, NO write', async () => {
    db.order.findUnique.mockResolvedValue({ deliveryMode: 'grubano_courier', deliveryFee: -5 })
    await expect(accrueCourierCourseEarning('m1', 'cP', NOW)).rejects.toThrow(/invariant/)
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
})

describe('integration — the accrued row flows into computePartnerBalance after maturation', () => {
  it('pending accrual → balance 0; once matured → balance = netCents', async () => {
    // The accrual writes status 'pending'. computePartnerBalance('logistics') counts only
    // matured|paid, so BEFORE maturation the courier's available is 0…
    db.courierEarning.findMany.mockResolvedValue([]) // no matured rows yet
    const before = await computePartnerBalance('logistics', 'cP')
    expect(before.availableCents).toBe(0)
    // …and AFTER the maturation pass promotes it (status matured), the same 400c is available.
    db.courierEarning.findMany.mockResolvedValue([{ netCents: 400 }])
    const after = await computePartnerBalance('logistics', 'cP')
    expect(after.earnedCents).toBe(400)
    expect(after.availableCents).toBe(400)
    expect(db.courierEarning.findMany.mock.calls.at(-1)![0].where).toEqual({
      courierId: 'cP', status: { in: ['matured', 'paid'] },
    })
  })
})
