import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'consumer' })
  db.restaurant.findFirst.mockResolvedValue({
    id: 'rest1', isActive: true, archivedAt: null, deliveryFee: 2.99, minOrder: 10,
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
