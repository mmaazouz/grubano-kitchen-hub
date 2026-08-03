import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Borne de sécurité du crédit fidélité (D-A) — integration over POST /api/orders ─
// The loyalty credit must never push Grubano net-negative once ALL claims on the
// commission are counted: Stripe fee (destination charge) + creator royalty +
// affiliation. These tests pin the WIRING in api/orders (the engine math itself is
// covered by tests/loyalty.test.ts). Pickup 8% commission; defaults STRIPE_FEE_PCT
// 2.9% + 25c. computeApplicationFee + estimateStripeFeeCents run for real.
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:      { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:         { findFirst: vi.fn() },
    referralConfig:  { findFirst: vi.fn() },
    referral:        { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:   { findUnique: vi.fn(), create: vi.fn() },
    order:           { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    promotion:       { findMany: vi.fn() },
    dishAdoption:    { findMany: vi.fn() },
    dishSale:        { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:     { update: vi.fn() },
    adoptionConfig:  { findFirst: vi.fn() },
    openingHour:     { findMany: vi.fn() },
    closureException:{ findMany: vi.fn() },
    loyaltyCustomer: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST as createOrder } from '@/app/api/orders/route'

const makeReq = (body: Record<string, unknown>) =>
  new NextRequest('https://app.grubano.com/api/orders', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

// 20,00 € pickup, paying with points.
const body = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest1',
  items: [{ itemId: 'i1', name: 'Plat', qty: 1, price: 20, options: [] }],
  deliveryAddress: '12 rue de la Paix',
  paymentMethod: 'card',
  fulfillmentType: 'pickup',
  usePoints: true,
  ...over,
})

// commission (pickup 8% of 20,00 €) and the conservative Stripe estimate.
const COMMISSION_CENTS = 160
const STRIPE_CENTS = Math.round(2000 * 0.029) + 25 // 83

beforeEach(() => {
  // P0-01: ces tests exercent le contrat LIVRAISON (post-pilote) -> flag ON explicitement.
  process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'consumer' })
  db.restaurant.findFirst.mockResolvedValue({
    deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, archivedAt: null, deliveryFee: 2.99, minOrder: 10,
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.openingHour.findMany.mockResolvedValue([])
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([])
  db.loyaltyCustomer.findUnique.mockResolvedValue({ id: 'lc1', pointsBalance: 100_000 }) // huge balance
  db.adoptionConfig.findFirst.mockResolvedValue(null) // default 2% tiers
  db.dishAdoption.findMany.mockResolvedValue([])      // overridden per test
  db.dishSale.findFirst.mockResolvedValue(null)
  db.dishSale.createMany.mockResolvedValue({ count: 1 })
  db.creatorDish.update.mockResolvedValue({})
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', status: 'awaiting_payment' })
})

describe('POST /api/orders — loyalty credit never pushes Grubano net-negative', () => {
  it('NORMAL order: credit capped at commission − Stripe fee (pre-fix this went negative)', async () => {
    db.dishAdoption.findMany.mockResolvedValue([]) // no adopted dish → no royalty

    const res = await createOrder(makeReq(body()))
    expect(res.status).toBe(201)
    const out = await res.json()

    // cap = commission(160) − stripe(83) = 77c → floor to 15 pts = 75c.
    expect(out.pointsRedeemed).toBe(15)
    expect(Math.round(out.loyaltyCredit * 100)).toBe(75)
    // Grubano net = commission − credit − stripe ≥ 0 (was 160 − 160 − 83 = −83 before the fix).
    expect(COMMISSION_CENTS - 75 - STRIPE_CENTS).toBeGreaterThanOrEqual(0)
  })

  it('CHEF dish: credit capped at commission − Stripe − royalty (net ≥ 0)', async () => {
    // The ordered item is an adopted recipe → 2% royalty on 20,00 € = 40c.
    db.dishAdoption.findMany.mockResolvedValue([
      { id: 'ad1', menuItemId: 'i1', creatorDishId: 'cd1', creatorDish: { creatorId: 'cr1' } },
    ])

    const res = await createOrder(makeReq(body()))
    expect(res.status).toBe(201)
    const out = await res.json()

    // committed = stripe(83) + royalty(40) = 123c → cap = 160 − 123 = 37c → 7 pts = 35c.
    expect(out.pointsRedeemed).toBe(7)
    expect(Math.round(out.loyaltyCredit * 100)).toBe(35)
    const ROYALTY_CENTS = 40
    expect(COMMISSION_CENTS - 35 - STRIPE_CENTS - ROYALTY_CENTS).toBeGreaterThanOrEqual(0) // = 2c, never < 0
  })
})

describe('POST /api/orders — small-order fee (V1.5)', () => {
  // Use minOrder 5 so an 11 € order is valid yet below the 12 € fee threshold.
  beforeEach(() => {
    db.restaurant.findFirst.mockResolvedValue({
      deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, archivedAt: null, deliveryFee: 2.99, minOrder: 5,
      commissionRateDineIn: null, commissionRatePickup: null,
      commissionRateDelivery: null, commissionFreeUntil: null,
    })
  })

  it('BELOW threshold → flat 1 € fee applied to the total + the column written', async () => {
    const res = await createOrder(makeReq(body({
      items: [{ itemId: 'i1', name: 'Snack', qty: 1, price: 11, options: [] }],
      usePoints: false,
    })))
    expect(res.status).toBe(201)
    const out = await res.json()

    expect(out.smallOrderFee).toBe(1)            // 11 € < 12 € → fee
    expect(out.total).toBe(12)                   // 11 food + 1 fee
    const feeUpdate = db.order.update.mock.calls.map(c => c[0] as any).find(a => a?.data?.smallOrderFeeCents !== undefined)
    expect(feeUpdate?.data?.smallOrderFeeCents).toBe(100)
  })

  it('AT/ABOVE threshold → no fee', async () => {
    const res = await createOrder(makeReq(body({
      items: [{ itemId: 'i1', name: 'Plat', qty: 1, price: 15, options: [] }],
      usePoints: false,
    })))
    expect(res.status).toBe(201)
    const out = await res.json()

    expect(out.smallOrderFee).toBe(0)            // 15 € ≥ 12 € → none
    expect(out.total).toBe(15)
    const feeUpdate = db.order.update.mock.calls.map(c => c[0] as any).find(a => a?.data?.smallOrderFeeCents !== undefined)
    expect(feeUpdate).toBeUndefined()
  })
})

describe('POST /api/orders — affiliation on NET margin (V1.5 §4)', () => {
  it('a referred chef order pays the creator 30% of (commission − Stripe − royalty); Grubano net ≥ 0', async () => {
    // Delivery 30 € chef dish via a still-valid referral binding (CAS 2). Delivery
    // commission 12% = 360c; stripe on 32,99 € = 121c; royalty 2% of 30 € = 60c.
    db.restaurant.findFirst.mockResolvedValue({
      deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, archivedAt: null, deliveryFee: 2.99, minOrder: 10,
      commissionRateDineIn: null, commissionRatePickup: null,
      commissionRateDelivery: null, commissionFreeUntil: null,
    })
    db.creator.findFirst.mockResolvedValue({ id: 'cr1', email: 'creator@x.com', referralCode: 'CODE' })
    db.referralConfig.findFirst.mockResolvedValue({
      commissionPctOfGrubanoFee: 0.30, newCustomerBonusAmount: 0, durationDays: 90,
      customerDiscountPct: 0.10, customerDiscountCapEur: 5,
    })
    db.referral.findFirst.mockResolvedValue({
      id: 'rf1', creatorId: 'cr1', active: true, expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    db.dishAdoption.findMany.mockResolvedValue([
      { id: 'ad1', menuItemId: 'i1', creatorDishId: 'cd1', creatorDish: { creatorId: 'cr1' } },
    ])
    db.referralOrder.findUnique.mockResolvedValue(null)
    db.referralOrder.create.mockResolvedValue({ id: 'ro1' })

    const res = await createOrder(makeReq(body({
      items: [{ itemId: 'i1', name: 'Recette chef', qty: 1, price: 30, options: [] }],
      fulfillmentType: 'delivery',
      referralCode: 'CODE',
      usePoints: true,
    })))
    expect(res.status).toBe(201)
    const out = await res.json()

    const COMMISSION = 360, STRIPE = Math.round(3299 * 0.029) + 25, ROYALTY = 60 // 121, 60
    const NET = COMMISSION - STRIPE - ROYALTY                                    // 179
    const AFFILIATION = Math.round(NET * 0.30)                                   // 54
    const CAP = COMMISSION - (STRIPE + ROYALTY + AFFILIATION)                    // 125

    // Affiliation is paid on the NET (not the gross commission): 30% × 1,79 € = 0,54 €.
    const roData = db.referralOrder.create.mock.calls[0][0].data as any
    expect(roData.creatorEarning).toBe(Math.round((NET / 100) * 0.30 * 100) / 100) // 0.54
    expect(roData.grubanoFee).toBe(COMMISSION / 100)                               // 3.60 (gross, unchanged column)

    // Loyalty cap = commission − committed claims = 0.70 × net (floored to points).
    expect(Math.round(out.loyaltyCredit * 100)).toBe(CAP - (CAP % 5))              // 125

    // Grubano net = commission − credit − stripe − royalty − affiliation ≥ 0.
    const creditCents = Math.round(out.loyaltyCredit * 100)
    expect(COMMISSION - creditCents - STRIPE - ROYALTY - AFFILIATION).toBeGreaterThanOrEqual(0)
  })
})

afterEach(() => { delete process.env.DELIVERY_FULFILLMENT_ENABLED })
