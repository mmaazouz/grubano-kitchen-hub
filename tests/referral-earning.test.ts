import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────
// POST /api/orders carries real money. Since C1 the referral payout follows the
// B0 rules (réconciliation créateur):
//   • grubanoFee  = the REAL commission via lib/commission on the PRODUCT
//     subtotal (channel pickup 8 % / delivery 12 %, per-resto override,
//     founders commissionFreeUntil → 0 %) — the hardcoded 10 % is GONE;
//   • grubanoFee = that REAL gross commission (the FROZEN column, UNCHANGED);
//   • creatorEarning = commissionPct × the NET margin (V1.5 §4: commission −
//     Stripe estimate − creator royalty), FROZEN at order time — NOT the gross
//     commission anymore. With no chef dish, royalty = 0, so the net = commission
//     − estimateStripeFeeCents(subtotal + delivery) (defaults 2.9 % + 25 c);
//   • newCustomerBonus = 5 € one-shot on the customer's FIRST Grubano order
//     (any restaurant), independent of the commission share.
// These tests pin those rules, the cent rounding, and the freeze-from-config.
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    // The route looks the restaurant up with findFirst (id + isActive +
    // archivedAt:null). The row now also carries the A1 commission fields
    // (null = platform defaults) read by lib/commission.
    restaurant:     { findFirst: vi.fn() },
    creator:        { findFirst: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    referral:       { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:  { findUnique: vi.fn(), create: vi.fn() },
    // order.count powers the B0 new-customer check (0 prior orders = first).
    order:          { create: vi.fn(), update: vi.fn(), count: vi.fn() },
    // P1: the checkout resolves the brand's active promotions (none by default).
    promotion:      { findMany: vi.fn() },
    dishAdoption:   { findMany: vi.fn() },
    dishSale:       { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:    { update: vi.fn() },
    adoptionConfig: { findFirst: vi.fn() },
    // Opening-hours gate: empty arrays = "hours not configured" = no
    // restriction — the referral logic under test runs unhindered.
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
  // delivery by default (the schema default) → platform rate 12 %
  ...over,
})

const referralOrderArg = () => (db.referralOrder.create.mock.calls[0]?.[0] as any)?.data

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com' })
  db.restaurant.findFirst.mockResolvedValue({
    id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10,
    // A1 commission fields: null = platform defaults (pickup 8 % / delivery 12 %)
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.openingHour.findMany.mockResolvedValue([])      // not configured → order not gated
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue({ id: 'creatorA', email: 'creator@example.com', referralCode: 'CHEF1' })
  db.referralConfig.findFirst.mockResolvedValue({
    commissionPctOfGrubanoFee: 0.30, durationDays: 90,
    customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
    // B0-quater: percentages ONLY — the fixed bonus is gone (config default 0).
    newCustomerBonusAmount: 0,
  })
  db.referral.findFirst.mockResolvedValue(null)              // CAS 1 by default
  db.referral.create.mockResolvedValue({ id: 'ref1' })
  db.referralOrder.findUnique.mockResolvedValue(null)
  db.referralOrder.create.mockResolvedValue({})
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 0, status: 'received' })
  db.order.count.mockResolvedValue(0)                        // first Grubano order by default
  db.promotion.findMany.mockResolvedValue([])                // no active promo by default (P1)
  db.dishAdoption.findMany.mockResolvedValue([])
})

describe('POST /api/orders — B0 referral payout (CAS 1)', () => {
  it('freezes grubanoFee = REAL delivery commission (12 %) and creatorEarning = 30 % of the NET — NO bonus by default (B0-quater)', async () => {
    // subtotal 100, delivery 1.99 → gross commission 12.00 (frozen grubanoFee).
    // V1.5: net = 1200 − stripe(round(10199×0.029)+25=321) − 0 = 879c →
    // creatorEarning = round2(8.79 × 0.30) = 2.64. Bonus config 0 → none, the
    // new-customer count query is not even made.
    const res = await POST(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 12, creatorEarning: 2.64, newCustomerBonus: 0 })
    expect(db.order.count).not.toHaveBeenCalled()
  })

  it('pays the configured acquisition bonus ONCE when activated (first Grubano order only)', async () => {
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.30, durationDays: 90,
      customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
      newCustomerBonusAmount: 5, // Mohammed re-activates a bonus by config
    })
    await POST(makeReq(orderBody()))
    expect(referralOrderArg()).toMatchObject({ newCustomerBonus: 5 })
  })

  it('uses the pickup rate (8 %) when the order is a pickup', async () => {
    // pickup → no delivery fee. gross 800 ; net = 800 − stripe(round(10000×0.029)
    // +25=315) = 485c → creatorEarning = round2(4.85 × 0.30) = 1.45 (IEEE float:
    // 4.85×0.30 = 1.45499… → rounds down to 1.45).
    const res = await POST(makeReq(orderBody({ fulfillmentType: 'pickup' })))
    expect(res.status).toBe(201)
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 8, creatorEarning: 1.45 })
  })

  it('honours the per-restaurant override rate (B0: real commission, never a fixed 10 %)', async () => {
    db.restaurant.findFirst.mockResolvedValue({
      id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10,
      commissionRateDineIn: null, commissionRatePickup: null,
      commissionRateDelivery: 0.10, commissionFreeUntil: null, // override 10 %
    })
    // gross 1000 ; net = 1000 − stripe(321) = 679c → round2(6.79 × 0.30) = 2.04.
    await POST(makeReq(orderBody()))
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 10, creatorEarning: 2.04 })
  })

  it('founders offer (commissionFreeUntil future): fee 0, earning 0 — an ACTIVATED bonus still flows', async () => {
    db.restaurant.findFirst.mockResolvedValue({
      id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10,
      commissionRateDineIn: null, commissionRatePickup: null,
      commissionRateDelivery: null,
      commissionFreeUntil: new Date(Date.now() + 30 * 86_400_000),
    })
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.30, durationDays: 90,
      customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
      newCustomerBonusAmount: 5,
    })
    await POST(makeReq(orderBody()))
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 0, creatorEarning: 0, newCustomerBonus: 5 })
  })

  it('rounds at the cent through lib/commission then half-up on the 30 % share of the NET', async () => {
    // subtotal 47.50 delivery 1.99 → gross feeCents = round(4750 × 0.12) = 570 →
    // 5.70 € (frozen grubanoFee). net = 570 − stripe(round(4949×0.029)+25=169) =
    // 401c → creatorEarning = round2(4.01 × 0.30) = 1.20.
    const res = await POST(makeReq(orderBody({ items: [{ itemId: 'i1', name: 'D', qty: 2, price: 23.75, options: [] }] })))
    expect(res.status).toBe(201)
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 5.7, creatorEarning: 1.2 })
  })

  it('freezes the ACTIVE ReferralConfig share at order time (param respected, not hardcoded)', async () => {
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.22, durationDays: 90,
      customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
    })
    // gross 12 (frozen) ; net = 1200 − stripe(321) = 879c → round2(8.79 × 0.22) = 1.93.
    await POST(makeReq(orderBody()))
    expect(referralOrderArg()).toMatchObject({ grubanoFee: 12, creatorEarning: 1.93 })
  })

  it('pays NO acquisition bonus to a returning customer even when activated', async () => {
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.30, durationDays: 90,
      customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true,
      newCustomerBonusAmount: 5,
    })
    db.order.count.mockResolvedValue(3)
    await POST(makeReq(orderBody()))
    expect(referralOrderArg()).toMatchObject({ newCustomerBonus: 0 })
  })

  it('applies the welcome discount capped at customerDiscountCapEur (kept by B0, Grubano-financed)', async () => {
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

  it('CAS 2 (open window): reuses the binding, pays the bound creator the B0 share, no discount, no bonus', async () => {
    db.referral.findFirst.mockResolvedValue({
      id: 'refExisting', creatorId: 'creatorB', active: true,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    db.order.count.mockResolvedValue(2) // a bound customer has ordered before
    const res = await POST(makeReq(orderBody()))
    const json = await res.json()
    expect(json.discount).toBe(0)
    expect(db.referral.create).not.toHaveBeenCalled()
    // net-based (V1.5): net = 1200 − stripe(321) = 879c → round2(8.79 × 0.30) = 2.64.
    expect(referralOrderArg()).toMatchObject({
      referralId: 'refExisting', grubanoFee: 12, creatorEarning: 2.64, newCustomerBonus: 0,
    })
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
