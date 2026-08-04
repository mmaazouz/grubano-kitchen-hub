import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Brique B (Agent 59) — affiliate attribution + accrual in the order path ───────────
// AFFILIATE_ENABLED gates the affiliate resolution in the 5B block. OFF → byte-identical
// (no affiliate lookup, no affiliate accrual). ON → a code that resolves to an Affiliate
// (not a creator) writes a ReferralOrder.affiliateId accrual (NET 30%, FROZEN), with NO
// welcome discount (charge byte-identical) and NEVER a creatorId binding. The creator rail
// is untouched. Mocks mirror franchise-pos-tagging-route.test.ts.

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:     { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:        { findFirst: vi.fn() },
    affiliate:      { findFirst: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    referral:       { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:  { findUnique: vi.fn(), create: vi.fn() },
    order:          { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    promotion:      { findMany: vi.fn() },
    dishAdoption:   { findMany: vi.fn() },
    dishSale:       { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:    { update: vi.fn() },
    adoptionConfig: { findFirst: vi.fn() },
    openingHour:       { findMany: vi.fn() },
    closureException:  { findMany: vi.fn() },
    ledgerEntry:    { create: vi.fn(), findMany: vi.fn() },
    loyaltyCustomer: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST as createOrder } from '@/app/api/orders/route'

const makeReq = (body: Record<string, unknown>) =>
  new NextRequest('https://app.grubano.com/api/orders', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
const orderBody = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest1',
  items: [{ itemId: 'i1', name: 'Dish', qty: 1, price: 20, options: [] }],
  deliveryAddress: '12 rue de la Paix',
  paymentMethod: 'card',
  fulfillmentType: 'delivery',
  referralCode: 'CODE1',
  ...over,
})
const ON  = () => { process.env.AFFILIATE_ENABLED = 'true' }
const OFF = () => { delete process.env.AFFILIATE_ENABLED }
const refOrderData = () => (db.referralOrder.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data
const referralData = () => (db.referral.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data
const orderData    = () => (db.order.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data

function arm() {
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'consumer' })
  db.restaurant.findFirst.mockResolvedValue({
    deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, deliveryFee: 0, minOrder: 5, pointOfSaleId: null,
    commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.openingHour.findMany.mockResolvedValue([])
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)
  db.affiliate.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue({ commissionPctOfGrubanoFee: 0.30, newCustomerBonusAmount: 0, durationDays: 90, customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true })
  db.referral.findFirst.mockResolvedValue(null)
  db.referralOrder.findUnique.mockResolvedValue(null)
  db.referralOrder.create.mockResolvedValue({ id: 'ro1' })
  db.referral.create.mockResolvedValue({ id: 'refb1' })
  db.promotion.findMany.mockResolvedValue([])
  db.dishAdoption.findMany.mockResolvedValue([])
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 20, status: 'received' })
  db.order.updateMany.mockResolvedValue({ count: 1 })
  db.order.count.mockResolvedValue(0)
}

beforeEach(() => {
  // P0-01: ces tests exercent le contrat LIVRAISON (post-pilote) -> flag ON explicitement.
  process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
  vi.clearAllMocks(); OFF(); arm() })
afterEach(() => { OFF() })

describe('Brique B — affiliate attribution (AFFILIATE_ENABLED)', () => {
  it('(a) FLAG OFF + affiliate code → NO affiliate lookup, NO accrual (byte-identical)', async () => {
    OFF()
    db.affiliate.findFirst.mockResolvedValue({ id: 'a1', operatorId: 'aff-op', referralCode: 'CODE1' })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(db.affiliate.findFirst).not.toHaveBeenCalled() // never queried when OFF
    expect(db.referralOrder.create).not.toHaveBeenCalled()
    expect(db.referral.create).not.toHaveBeenCalled()
    expect(orderData().total).toBe(20) // no discount → charge unchanged
  })

  it('(b) FLAG ON + affiliate code → ReferralOrder.affiliateId accrual, NO creatorId, NO discount', async () => {
    ON()
    db.affiliate.findFirst.mockResolvedValue({ id: 'a1', operatorId: 'aff-op', referralCode: 'CODE1' })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    // binding bound to the affiliate (operator id), NOT a creator
    expect(referralData().affiliateId).toBe('aff-op')
    expect(referralData().creatorId).toBeUndefined()
    // accrual tagged with the affiliate, positive frozen earning, no creatorId on the row
    expect(refOrderData().affiliateId).toBe('aff-op')
    expect(typeof refOrderData().creatorEarning).toBe('number')
    expect(refOrderData().creatorEarning as number).toBeGreaterThan(0)
    expect((refOrderData().grubanoFee as number)).toBeGreaterThan(0)
    // CHARGE byte-identical: the affiliate path applies NO welcome discount
    expect(orderData().total).toBe(20)
  })

  it('(c) FLAG ON + creator code → creator binding (creatorId), affiliate NOT queried, no affiliateId on the accrual', async () => {
    ON()
    db.creator.findFirst.mockResolvedValue({ id: 'cr1', email: 'creator@x.com', referralCode: 'CODE1' })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(db.affiliate.findFirst).not.toHaveBeenCalled() // creator matched → no affiliate lookup (one referent)
    expect(referralData().creatorId).toBe('cr1')
    expect(referralData().affiliateId).toBeUndefined()
    expect(refOrderData().affiliateId).toBeUndefined() // creator accrual leaves affiliateId null
  })

  it('(d) FLAG ON + affiliate self-referral (affiliate.operatorId === buyer) → NO accrual', async () => {
    ON()
    db.affiliate.findFirst.mockResolvedValue({ id: 'a1', operatorId: 'cust1', referralCode: 'CODE1' }) // operator == token.sub
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(db.referral.create).not.toHaveBeenCalled()
    expect(db.referralOrder.create).not.toHaveBeenCalled()
  })

  it('(e) SAME formula — a creator code and an affiliate code yield the SAME creatorEarning for the same order', async () => {
    ON()
    // affiliate run
    db.affiliate.findFirst.mockResolvedValue({ id: 'a1', operatorId: 'aff-op', referralCode: 'CODE1' })
    await createOrder(makeReq(orderBody()))
    const affEarning = refOrderData().creatorEarning as number
    // creator run (fresh)
    vi.clearAllMocks(); arm(); ON()
    db.creator.findFirst.mockResolvedValue({ id: 'cr1', email: 'creator@x.com', referralCode: 'CODE1' })
    await createOrder(makeReq(orderBody()))
    const creEarning = refOrderData().creatorEarning as number
    expect(affEarning).toBeCloseTo(creEarning, 6) // identical NET×30% formula
    expect(affEarning).toBeGreaterThan(0)
  })

  it('(f) anti-doublon — an existing ReferralOrder for the order → no second accrual', async () => {
    ON()
    db.affiliate.findFirst.mockResolvedValue({ id: 'a1', operatorId: 'aff-op', referralCode: 'CODE1' })
    db.referralOrder.findUnique.mockResolvedValue({ id: 'existing' })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(db.referralOrder.create).not.toHaveBeenCalled()
  })
})

afterEach(() => { delete process.env.DELIVERY_FULFILLMENT_ENABLED })
