import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── B5 (Agent 45) — Order.pointOfSaleId tagging at creation, server-derived, flag-gated ─
// FRANCHISE_POS_TAGGING_ENABLED (default OFF). OFF → the order-creation `data` is
// BYTE-IDENTICAL to before this brick (no pointOfSaleId key). ON → pointOfSaleId =
// restaurant.pointOfSaleId (DERIVED SERVER-SIDE; a client-sent pointOfSaleId is ignored).
// Mocks mirror ghost-orders.test.ts (getToken + prisma) — we assert order.create's data.

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:     { findFirst: vi.fn(), findUnique: vi.fn() },
    menuItem:       { findMany: vi.fn() },
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
  fulfillmentType: 'pickup',
  ...over,
})

const ON  = () => { process.env.FRANCHISE_POS_TAGGING_ENABLED = 'true' }
const OFF = () => { delete process.env.FRANCHISE_POS_TAGGING_ENABLED }
const createdData = () => (db.order.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data

// Re-pricing serveur (P0 closed beta): the route now resolves every line against
// MenuItem — mirror the request bodies so the tests' economics stay identical.
const MENU: Record<string, { name: string; price: number }> = { i1: { name: 'Dish', price: 20 } }
const armMenu = () =>
  db.menuItem.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => (MENU[id] ? { id, ...MENU[id] } : null)).filter(Boolean))

beforeEach(() => {
  vi.clearAllMocks()
  OFF()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'restaurant' })
  // A FRANCHISED restaurant by default (pointOfSaleId set) — the demanding case.
  db.restaurant.findFirst.mockResolvedValue({
    deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10, pointOfSaleId: 'pos1',
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  armMenu()
  db.openingHour.findMany.mockResolvedValue([])
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([])
  db.dishAdoption.findMany.mockResolvedValue([])
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 20, status: 'received' })
  db.order.updateMany.mockResolvedValue({ count: 1 })
})
afterEach(() => { OFF() })

describe('B5 — Order.pointOfSaleId tagging (FRANCHISE_POS_TAGGING_ENABLED)', () => {
  it('(a) FLAG OFF + franchised restaurant → create data is BYTE-IDENTICAL (NO pointOfSaleId key)', async () => {
    OFF()
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    const data = createdData()
    // The key is NOT added at all when OFF → structurally identical to pre-B5.
    expect('pointOfSaleId' in data).toBe(false)
    expect(data.pointOfSaleId).toBeUndefined()
  })

  it('(b) FLAG ON + franchised restaurant → pointOfSaleId = restaurant.pointOfSaleId', async () => {
    ON()
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(createdData().pointOfSaleId).toBe('pos1')
  })

  it('(c) FLAG ON + NON-franchised restaurant (pointOfSaleId null) → pointOfSaleId = null (= today)', async () => {
    ON()
    db.restaurant.findFirst.mockResolvedValue({
      deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10, pointOfSaleId: null,
      commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
    })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    const data = createdData()
    expect('pointOfSaleId' in data).toBe(true)
    expect(data.pointOfSaleId).toBeNull()
  })

  it('(d) FLAG ON + client sends pointOfSaleId in body → IGNORED; value comes from the restaurant (anti-usurpation)', async () => {
    ON()
    const res = await createOrder(makeReq(orderBody({ pointOfSaleId: 'hacker-pos', brandId: 'hacker-brand' })))
    expect(res.status).toBe(201)
    // server-derived value, NEVER the client-sent one
    expect(createdData().pointOfSaleId).toBe('pos1')
    expect(createdData().pointOfSaleId).not.toBe('hacker-pos')
  })

  it('(e) only pointOfSaleId differs — every other create field is identical OFF vs ON', async () => {
    OFF()
    await createOrder(makeReq(orderBody()))
    const off = { ...createdData() }
    vi.clearAllMocks()
    // re-arm the mocks consumed above
    getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'restaurant' })
    db.restaurant.findFirst.mockResolvedValue({ deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10, pointOfSaleId: 'pos1', commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null })
    armMenu()
    db.openingHour.findMany.mockResolvedValue([]); db.closureException.findMany.mockResolvedValue([])
    db.creator.findFirst.mockResolvedValue(null); db.promotion.findMany.mockResolvedValue([]); db.dishAdoption.findMany.mockResolvedValue([])
    db.order.create.mockResolvedValue({ id: 'order1' }); db.order.update.mockResolvedValue({ id: 'order1', total: 20, status: 'received' }); db.order.updateMany.mockResolvedValue({ count: 1 })
    ON()
    await createOrder(makeReq(orderBody()))
    const on = { ...createdData() }
    // ON = OFF + the single pointOfSaleId key.
    expect(on).toEqual({ ...off, pointOfSaleId: 'pos1' })
  })
})
