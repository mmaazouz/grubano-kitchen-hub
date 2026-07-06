import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P4.3 ÉTAPE 4 — POST /api/orders · distance-based delivery fee (route gating) ─────
// Flag OFF (default) → the FLAT Restaurant.deliveryFee, byte-identical (no geocode, no
// coords). ON → base+per-km barème on the haversine distance; FAIL-OPEN to the flat fee
// if geocoding fails, order never blocked. Only the AMOUNT changes; the stored
// Order.deliveryFee is what ÉTAPE 3's case-A/case-B routing reads. Geocode + prisma mocked.

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

const { geo } = vi.hoisted(() => ({ geo: { geocodeAddressDetailed: vi.fn(), haversineKm: vi.fn() } }))
vi.mock('@/lib/geocode', () => ({
  geocodeAddressDetailed: geo.geocodeAddressDetailed,
  haversineKm:            geo.haversineKm,
  geocodeAddress:         vi.fn(),
  isPlausibleAddress:     vi.fn(),
  wait:                   vi.fn(),
}))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:       { findFirst: vi.fn(), findUnique: vi.fn() },
    creator:          { findFirst: vi.fn() },
    affiliate:        { findFirst: vi.fn() },
    referralConfig:   { findFirst: vi.fn() },
    referral:         { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralOrder:    { findUnique: vi.fn(), create: vi.fn() },
    order:            { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    promotion:        { findMany: vi.fn() },
    dishAdoption:     { findMany: vi.fn() },
    dishSale:         { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:      { update: vi.fn() },
    adoptionConfig:   { findFirst: vi.fn() },
    openingHour:      { findMany: vi.fn() },
    closureException: { findMany: vi.fn() },
    ledgerEntry:      { create: vi.fn(), findMany: vi.fn() },
    loyaltyCustomer:  { updateMany: vi.fn(), findUnique: vi.fn() },
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
  deliveryAddress: '12 rue de la Paix', paymentMethod: 'card', fulfillmentType: 'delivery', ...over,
})
const orderData = () => (db.order.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data
const coordUpdate = () =>
  db.order.update.mock.calls.find(c => 'deliveryLat' in ((c[0] as { data?: Record<string, unknown> })?.data ?? {}))
const ENVS = ['LOGISTICS_DISTANCE_FEE_ENABLED', 'LOGISTICS_FEE_BASE_CENTS', 'LOGISTICS_FEE_PER_KM_CENTS', 'LOGISTICS_FEE_MIN_CENTS', 'LOGISTICS_FEE_MAX_CENTS']

function arm() {
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'buyer@example.com', role: 'consumer' })
  db.restaurant.findFirst.mockResolvedValue({
    id: 'rest1', isActive: true, deliveryFee: 4.5, minOrder: 5, lat: 48.86, lng: 2.35, city: 'Paris',
    pointOfSaleId: null, commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
  })
  db.openingHour.findMany.mockResolvedValue([]); db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null); db.affiliate.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue({ commissionPctOfGrubanoFee: 0.30, newCustomerBonusAmount: 0, durationDays: 90, customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true })
  db.referral.findFirst.mockResolvedValue(null); db.referralOrder.findUnique.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([]); db.dishAdoption.findMany.mockResolvedValue([])
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 24.5, status: 'received' })
  db.order.updateMany.mockResolvedValue({ count: 1 }); db.order.count.mockResolvedValue(0)
  geo.geocodeAddressDetailed.mockResolvedValue({ status: 'ok', coords: { latitude: 48.88, longitude: 2.34 } })
  geo.haversineKm.mockReturnValue(3) // 3 km → 150 + 50×3 = 300c = €3.00
}

beforeEach(() => { vi.clearAllMocks(); ENVS.forEach(e => delete process.env[e]); arm() })
afterEach(() => { ENVS.forEach(e => delete process.env[e]) })

describe('flag OFF (default) — FLAT fee, byte-identical', () => {
  it('deliveryFee = restaurant.deliveryFee (4.50); geocode NOT called; no coords written', async () => {
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(orderData().deliveryFee).toBe(4.5)
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
    expect(coordUpdate()).toBeUndefined()
  })
})

describe('flag ON — distance barème', () => {
  it('deliveryFee = distance fee (€3.00 for 3 km); coords stored (minimal lat/lng)', async () => {
    process.env.LOGISTICS_DISTANCE_FEE_ENABLED = 'true'
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(orderData().deliveryFee).toBe(3) // 300c / 100
    expect(geo.geocodeAddressDetailed).toHaveBeenCalledWith('12 rue de la Paix', 'Paris')
    expect(coordUpdate()?.[0].data).toEqual({ deliveryLat: 48.88, deliveryLng: 2.34 })
  })

  it('geocode UNAVAILABLE → FLAT fee fallback (4.50); order still 201; no coords', async () => {
    process.env.LOGISTICS_DISTANCE_FEE_ENABLED = 'true'
    geo.geocodeAddressDetailed.mockResolvedValue({ status: 'unavailable' })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(orderData().deliveryFee).toBe(4.5) // fell back to the flat fee — never blocked
    expect(coordUpdate()).toBeUndefined()
  })

  it('resto not geocoded (lat/lng null) → FLAT fee fallback; no geocode call', async () => {
    process.env.LOGISTICS_DISTANCE_FEE_ENABLED = 'true'
    db.restaurant.findFirst.mockResolvedValue({
      id: 'rest1', isActive: true, deliveryFee: 4.5, minOrder: 5, lat: null, lng: null, city: 'Paris',
      pointOfSaleId: null, commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
    })
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect(orderData().deliveryFee).toBe(4.5)
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
  })

  it('pickup → fee 0, geocode NOT called (delivery-only feature)', async () => {
    process.env.LOGISTICS_DISTANCE_FEE_ENABLED = 'true'
    const res = await createOrder(makeReq(orderBody({ fulfillmentType: 'pickup' })))
    expect(res.status).toBe(201)
    expect(orderData().deliveryFee).toBe(0)
    expect(geo.geocodeAddressDetailed).not.toHaveBeenCalled()
    expect(coordUpdate()).toBeUndefined()
  })
})
