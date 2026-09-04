import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.3 ÉTAPE 6 — courier TIP reversal + clawback (lib/courier-accrual) ─────────────
// Tip = 100 % to the courier (gross=net=tip, fee=0), accrued at delivery, gated by the
// reversal rail (LOGISTICS_PAYOUT_ENABLED). Clawback on TOTAL refund cancels the tip but
// NEVER the course. Prisma + payout-flag mocked; eurosToCents/courierMaturesAt real-ish.

const { db, pay } = vi.hoisted(() => ({
  db:  {
    mission: { findUnique: vi.fn() }, order: { findUnique: vi.fn() },
    courierEarning: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    ledgerEntry: { findMany: vi.fn() }, // PHASE 2 §15 A12 — refund guard reads the ledger truth
  },
  pay: { isLogisticsPayoutEnabled: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ eurosToCents: (e: number) => Math.round(e * 100) }))
vi.mock('@/lib/creator-payout', () => ({ isLogisticsPayoutEnabled: pay.isLogisticsPayoutEnabled }))
// KEEP REAL: @/lib/courier-earnings (courierMaturesAt is pure)

import { accrueCourierTipEarning, clawbackCourierTip } from '@/lib/courier-accrual'

const NOW = new Date('2026-07-06T00:00:00.000Z')
const MISSION = { id: 'm1', status: 'delivered', courierId: 'cP', orderId: 'o1' }
const PAYMENT_LINE = { type: 'payment', grossAmount: 5000 }

beforeEach(() => {
  vi.clearAllMocks()
  pay.isLogisticsPayoutEnabled.mockReturnValue(true)
  db.mission.findUnique.mockResolvedValue(MISSION)
  db.order.findUnique.mockResolvedValue({ tipCents: 300, stripePaymentIntentId: 'pi_o1' })
  db.ledgerEntry.findMany.mockResolvedValue([PAYMENT_LINE])
  db.courierEarning.create.mockResolvedValue({ id: 'ce_tip1' })
  db.courierEarning.findMany.mockResolvedValue([])
  db.courierEarning.updateMany.mockResolvedValue({ count: 1 })
})

describe('accrueCourierTipEarning — 100 % tip, gated by the reversal rail', () => {
  it('creates a tip earning 100 % (gross=net=tip, fee=0), pending + maturesAt', async () => {
    const out = await accrueCourierTipEarning('m1', 'cP', NOW)
    expect(out).toMatchObject({ status: 'created', grossCents: 300, feeCents: 0, netCents: 300 })
    const data = db.courierEarning.create.mock.calls[0][0].data
    expect(data).toMatchObject({ courierId: 'cP', missionId: 'm1', orderId: 'o1', type: 'tip', grossCents: 300, feeCents: 0, netCents: 300, status: 'pending' })
    expect(data.maturesAt).toBeInstanceOf(Date)
  })
  it('flag OFF (LOGISTICS_PAYOUT_ENABLED) → rail_disabled, ZERO DB touch (tip stays HELD)', async () => {
    pay.isLogisticsPayoutEnabled.mockReturnValue(false)
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'rail_disabled' })
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('no tip (tipCents 0) → no_tip, no create', async () => {
    db.order.findUnique.mockResolvedValue({ tipCents: 0, stripePaymentIntentId: 'pi_o1' })
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'no_tip' })
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('OWNER-SCOPE — requester ≠ the mission courier → not_owner', async () => {
    expect(await accrueCourierTipEarning('m1', 'SOMEONE_ELSE', NOW)).toEqual({ status: 'skipped', reason: 'not_owner' })
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('not delivered yet → not_delivered', async () => {
    db.mission.findUnique.mockResolvedValue({ ...MISSION, status: 'picked_up' })
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'not_delivered' })
  })
  it('idempotent — P2002 (distinct type "tip") → already_accrued', async () => {
    db.courierEarning.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'already_accrued' })
  })
  it('tip is INDEPENDENT of deliveryMode (reads tipCents + the PI for the refund guard, not the case-A/B routing)', async () => {
    await accrueCourierTipEarning('m1', 'cP', NOW)
    expect(db.order.findUnique.mock.calls[0][0].select).toEqual({ tipCents: true, stripePaymentIntentId: true })
  })

  // ── PHASE 2 (REFUND-FINANCIAL-CONTRACT §12 / §15 A12) — never accrue a tip on refunded money ──
  it('[Phase 2] order FULLY refunded per the ledger (Σ −refund gross ≥ payment gross) → skipped:refunded, NO create', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([PAYMENT_LINE, { type: 'refund', grossAmount: -3000 }, { type: 'refund', grossAmount: -2000 }])
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'refunded' })
    expect(db.courierEarning.create).not.toHaveBeenCalled()
    expect(db.ledgerEntry.findMany.mock.calls[0][0].where).toMatchObject({ stripePaymentIntentId: 'pi_o1', type: { in: ['payment', 'refund'] } })
  })
  it('[Phase 2] PARTIAL refund → the courier keeps the whole tip (D-E): accrued normally', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([PAYMENT_LINE, { type: 'refund', grossAmount: -2500 }])
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toMatchObject({ status: 'created', grossCents: 300 })
  })
  it('[Phase 2] payment ledger line UNKNOWN → fail-closed skipped:ledger_unknown (tip stays HELD, no loss)', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([])
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'ledger_unknown' })
    expect(db.courierEarning.create).not.toHaveBeenCalled()
  })
  it('[Phase 2] order without a PaymentIntent → fail-closed skipped:ledger_unknown', async () => {
    db.order.findUnique.mockResolvedValue({ tipCents: 300, stripePaymentIntentId: null })
    expect(await accrueCourierTipEarning('m1', 'cP', NOW)).toEqual({ status: 'skipped', reason: 'ledger_unknown' })
  })
})

describe('clawbackCourierTip — TOTAL refund cancels the tip, COURSE stays acquired', () => {
  it('cancels pending|matured TIP rows only; scoped to type=tip; NEVER the course', async () => {
    db.courierEarning.findMany.mockResolvedValue([{ id: 't1', status: 'pending' }])
    const out = await clawbackCourierTip('o1')
    expect(out).toEqual({ status: 'clawed', count: 1 })
    // the update is scoped to type=tip + not-yet-paid → the 'course' row is untouchable here
    expect(db.courierEarning.updateMany.mock.calls[0][0]).toEqual({
      where: { orderId: 'o1', type: 'tip', status: { in: ['pending', 'matured'] } },
      data:  { status: 'cancelled' },
    })
    expect(db.courierEarning.findMany.mock.calls[0][0].where).toEqual({ orderId: 'o1', type: 'tip' })
  })
  it('no tip earning → noop, no update', async () => {
    db.courierEarning.findMany.mockResolvedValue([])
    expect(await clawbackCourierTip('o1')).toEqual({ status: 'noop', reason: 'no_tip' })
    expect(db.courierEarning.updateMany).not.toHaveBeenCalled()
  })
  it('already-PAID tip → kept (money already reached the courier); updateMany flips 0 → noop', async () => {
    db.courierEarning.findMany.mockResolvedValue([{ id: 't1', status: 'paid' }])
    db.courierEarning.updateMany.mockResolvedValue({ count: 0 })
    expect(await clawbackCourierTip('o1')).toEqual({ status: 'noop', reason: 'nothing_to_claw' })
  })
})
