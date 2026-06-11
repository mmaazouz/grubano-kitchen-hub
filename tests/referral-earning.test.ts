import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────
// POST /api/orders carries real money: the referral payout (grubanoFee ×
// commissionPctOfGrubanoFee) is FROZEN into ReferralOrder at checkout. These
// tests pin the formula, the half-up rounding, and the freeze-from-config rule.
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    // The route looks the restaurant up with findFirst (id + isActive +
    // archivedAt:null) since a9bfdce (archived-establishment exclusion) —
    // findUnique is gone from this code path.
    restaurant:     { findFirst: vi.fn() },
    creator:        { findFirst: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    referral:       { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:  { findUnique: vi.fn(), create: vi.fn() },
    order:          { create: vi.fn(), update: vi.fn() },
    dishAdoption:   { findMany: vi.fn() },
    dishSale:       { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:    { update: vi.fn() },
    adoptionConfig: { findFirst: vi.fn() },
    // Opening-hours gate (cf080df): POST /api/orders calls loadHoursContext,
    // which reads these two models. Empty arrays = "hours not configured" =
    // no restriction (T1.Q3) — the referral logic under test runs unhindered.
    openingHour:       { findMany: vi.fn() },
    closureException:  { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/orders/route'

const makeReq = (body: Record<string, unknown>) =>
  new NextRequest('https://app.grubano.com/api/orders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const orderBody = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest1',
  items: [{ itemId: 'i1', name: 'Dish', qty: 1, price: 100, options: [] }],
  deliveryAddress: '12 rue de la Paix',
  paymentMethod: 'card',
  referralCode: 'CHEF1',
  ...over,
})

const referralOrderArg = () => (db.referralOrder.create.mock.calls[0]?.[0] as any)?.data

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com' })
  db.restaurant.findFirst.mockResolvedValue({ id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10 })
  db.openingHour.findMany.mockResolvedValue([])      // not configured → order not gated
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue({ id: 'creatorA', email: 'creator@example.com', referralCode: 'CHEF1' })
  db.referralConfig.findFirst.mockResolvedValue({
    commissionPctOfGrubanoFee: 0.22, durationDays: 90,
    customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
  })
  db.referral.findFirst.mockResolvedValue(null)              // CAS 1 by default
  db.referral.create.mockResolvedValue({ id: 'ref1' })
  db.referralOrder.findUnique.mockResolvedValue(null)
  db.referralOrder.create.mockResolvedValue({})
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 0, status: 'received' })
  db.dishAdoption.findMany.mockResolvedValue([])
})

describe('POST /api/orders — referral payout freeze (CAS 1)', () => {
  it('freezes grubanoFee = subtotal×10% and creatorEarning = grubanoFee×22%', async () => {
    const res = await POST(makeReq(orderBody({ items: [{ itemId: 'i1', name: 'D', qty: 1, price: 100, options: [] }] })))
    expect(res.status).toBe(201)
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 10, creatorEarning: 2.2 })
  })

  it('rounds creatorEarning half-up to 2 decimals (4.75 × 22% = 1.045 → 1.05)', async () => {
    // subtotal 47.50 → grubanoFee 4.75 → 1.045 must round to 1.05, not 1.04.
    const res = await POST(makeReq(orderBody({ items: [{ itemId: 'i1', name: 'D', qty: 2, price: 23.75, options: [] }] })))
    expect(res.status).toBe(201)
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 4.75, creatorEarning: 1.05 })
  })

  it('uses the ACTIVE ReferralConfig rate at order time (value frozen from config, not hardcoded)', async () => {
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.30, durationDays: 90,
      customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
    })
    await POST(makeReq(orderBody())) // subtotal 100 → fee 10 → earn 10×30% = 3.00
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 10, creatorEarning: 3 })
  })

  it('applies the welcome discount capped at customerDiscountCapEur', async () => {
    const res = await POST(makeReq(orderBody())) // 10% of 100 = 10, capped at 5
    const json = await res.json()
    expect(json.discount).toBe(5)
  })
})

describe('POST /api/orders — referral edge cases', () => {
  it('writes no ReferralOrder for an organic order (no code)', async () => {
    const { referralCode, ...noCode } = orderBody()
    const res = await POST(makeReq(noCode))
    expect(res.status).toBe(201)
    expect(db.referralOrder.create).not.toHaveBeenCalled()
  })

  it('blocks self-referral (buyer == creator email): no payout, no discount', async () => {
    db.creator.findFirst.mockResolvedValue({ id: 'creatorA', email: 'buyer@example.com', referralCode: 'CHEF1' })
    const res = await POST(makeReq(orderBody()))
    const json = await res.json()
    expect(db.referralOrder.create).not.toHaveBeenCalled()
    expect(json.discount).toBe(0)
  })

  it('CAS 2 (open window): reuses the existing binding, pays the bound creator, no discount', async () => {
    db.referral.findFirst.mockResolvedValue({
      id: 'refExisting', creatorId: 'creatorB', active: true,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    const res = await POST(makeReq(orderBody()))
    const json = await res.json()
    expect(json.discount).toBe(0)
    expect(db.referral.create).not.toHaveBeenCalled()
    expect(referralOrderArg()).toMatchObject({ referralId: 'refExisting', grubanoFee: 10, creatorEarning: 2.2 })
  })

  it('CAS 2 (expired window): closes the binding, no payout, no discount', async () => {
    db.referral.findFirst.mockResolvedValue({
      id: 'refOld', creatorId: 'creatorB', active: true,
      expiresAt: new Date(Date.now() - 86_400_000),
    })
    const res = await POST(makeReq(orderBody()))
    const json = await res.json()
    expect(json.discount).toBe(0)
    expect(db.referral.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refOld' }, data: { active: false },
    }))
    expect(db.referralOrder.create).not.toHaveBeenCalled()
  })
})
