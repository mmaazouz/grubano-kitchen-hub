import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Ghost-orders fix — the executable spec ─────────────────────────────────────
// A CARD order is INVISIBLE to the resto until the webhook confirms payment:
//   1. POST /api/orders: card → 'awaiting_payment', cash → 'received';
//   2. webhook payment_intent.succeeded → guarded flip awaiting_payment→received
//      (THE server-side reveal — never the browser return);
//   3. pickup hand-off: the state machine now allows ready → delivered directly
//      (the courier "En route" step never applies to a pickup).
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:     { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:        { findFirst: vi.fn() },
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
    loyaltyCustomer: { updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

// The PATCH route now resolves establishment ownership (hardening). Mock the
// helper so the caller owns 'rest1' (the order's restaurant) → the ownership
// pre-condition passes and these state-machine tests exercise the same paths.
vi.mock('@/lib/establishment-scope', () => ({
  resolveEstablishmentScope: vi.fn().mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['rest1'], restaurantId: 'rest1',
  }),
}))

import { POST as createOrder } from '@/app/api/orders/route'
import { PATCH as patchStatus } from '@/app/api/orders/[id]/status/route'

const makeReq = (body: Record<string, unknown>, url = 'https://app.grubano.com/api/orders') =>
  new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const orderBody = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest1',
  items: [{ itemId: 'i1', name: 'Dish', qty: 1, price: 20, options: [] }],
  deliveryAddress: '12 rue de la Paix',
  paymentMethod: 'card',
  fulfillmentType: 'pickup',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'restaurant' })
  db.restaurant.findFirst.mockResolvedValue({
    deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10,
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.openingHour.findMany.mockResolvedValue([])
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([])
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 20, status: 'received' })
  db.order.updateMany.mockResolvedValue({ count: 1 })
  db.dishAdoption.findMany.mockResolvedValue([])
})

describe('POST /api/orders — initial visibility status', () => {
  it("CARD: created as 'awaiting_payment' (invisible to the resto until the webhook)", async () => {
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'card' })))
    expect(res.status).toBe(201)
    const created = (db.order.create.mock.calls[0]?.[0] as any)?.data
    expect(created.status).toBe('awaiting_payment')
  })

  it("CASH: created as 'received' (no online payment — visible at once, the legitimate flow)", async () => {
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'cash' })))
    expect(res.status).toBe(201)
    const created = (db.order.create.mock.calls[0]?.[0] as any)?.data
    expect(created.status).toBe('received')
  })
})

describe('PATCH /api/orders/[id]/status — pickup hand-off skips the courier step', () => {
  const statusReq = (status: string) =>
    new NextRequest('https://app.grubano.com/api/orders/order1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status }),
      headers: { 'content-type': 'application/json' },
    })

  it('ready → delivered is now a valid transition (pickup remise au client)', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'order1', status: 'ready', restaurantId: 'rest1', pointsEarned: 0, consumerId: 'cust1' })
    db.order.update.mockResolvedValue({ id: 'order1', status: 'delivered', updatedAt: new Date() })
    const res = await patchStatus(statusReq('delivered'), { params: { id: 'order1' } })
    expect(res.status).toBe(200)
  })

  it('ready → picked_up stays valid (delivery courier flow untouched)', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'order1', status: 'ready', restaurantId: 'rest1', pointsEarned: 0, consumerId: 'cust1' })
    db.order.update.mockResolvedValue({ id: 'order1', status: 'picked_up', updatedAt: new Date() })
    const res = await patchStatus(statusReq('picked_up'), { params: { id: 'order1' } })
    expect(res.status).toBe(200)
  })

  it('received → delivered remains REFUSED (the machine is not loosened elsewhere)', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'order1', status: 'received', restaurantId: 'rest1', pointsEarned: 0, consumerId: 'cust1' })
    const res = await patchStatus(statusReq('delivered'), { params: { id: 'order1' } })
    expect(res.status).toBe(422)
  })
})
