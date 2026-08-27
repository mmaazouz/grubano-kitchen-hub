import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P0-01 — pilot Q1: pickup-only enforced SERVER-SIDE ────────────────────────
// Before: createOrderSchema DEFAULTED to 'delivery' and never read the
// Restaurant.deliveryEnabled/pickupEnabled columns — the pickup-only pilot was
// held only by the cart UI. Now: fulfillmentType is REQUIRED, 'delivery' is
// refused while DELIVERY_FULFILLMENT_ENABLED is OFF (default), and BOTH modes
// honour the restaurant's own columns. Every acceptance criterion of the ticket
// is asserted here, including "a refused order writes strictly NOTHING".

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:      { findFirst: vi.fn() },
    menuItem:        { findMany: vi.fn() },
    order:           { create: vi.fn(), update: vi.fn(), count: vi.fn() },
    creator:         { findFirst: vi.fn() },
    affiliate:       { findFirst: vi.fn() },
    referral:        { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralConfig:  { findFirst: vi.fn() },
    referralOrder:   { findUnique: vi.fn(), create: vi.fn() },
    dishAdoption:    { findMany: vi.fn() },
    dishSale:        { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish:     { update: vi.fn() },
    adoptionConfig:  { findFirst: vi.fn() },
    loyaltyCustomer: { findUnique: vi.fn() },
    promoRedemption: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

// Opening hours: not configured → no restriction (the pure default path).
vi.mock('@/lib/opening-hours', () => ({
  loadHoursContext:     vi.fn().mockResolvedValue({ configured: false }),
  isOpenAtCtx:          vi.fn().mockReturnValue(true),
  nextOpeningCtx:       vi.fn().mockReturnValue(null),
  nextOpeningLabelFr:   vi.fn().mockReturnValue(null),
}))

import { POST } from '@/app/api/orders/route'
import { refuseForbiddenFulfillment, isDeliveryFulfillmentEnabled } from '@/lib/fulfillment'

const RESTO = {
  id: 'r1', isActive: true, archivedAt: null, minOrder: 0, deliveryFee: 1.99,
  deliveryEnabled: true, pickupEnabled: true, pointOfSaleId: null,
}

function post(body: Record<string, unknown>) {
  return POST(new Request('http://x/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never)
}

const BASE_BODY = {
  restaurantId: 'r1',
  items: [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 12 }],
  deliveryAddress: '12 rue de la République, Orange',
  paymentMethod: 'card',
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.DELIVERY_FULFILLMENT_ENABLED
  tokenMock.mockResolvedValue({ sub: 'consumer-1', email: 'c@x.fr' })
  db.restaurant.findFirst.mockResolvedValue({ ...RESTO })
  // Re-pricing serveur (P0 closed beta): mirror the BASE_BODY line (i1 'Gnocchi'
  // @ 12 €) in DB so the test economics are unchanged.
  const MENU: Record<string, { name: string; price: number }> = { i1: { name: 'Gnocchi', price: 12 } }
  db.menuItem.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => (MENU[id] ? { id, ...MENU[id] } : null)).filter(Boolean))
  db.order.create.mockResolvedValue({ id: 'o1', status: 'awaiting_payment' })
  db.order.update.mockResolvedValue({ id: 'o1', status: 'awaiting_payment' })
  db.referral.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue(null)
  db.dishAdoption.findMany.mockResolvedValue([])
  db.dishSale.findFirst.mockResolvedValue(null)
  db.loyaltyCustomer.findUnique.mockResolvedValue(null)
  db.creator.findFirst.mockResolvedValue(null)
  db.affiliate.findFirst.mockResolvedValue(null)
})
afterEach(() => { delete process.env.DELIVERY_FULFILLMENT_ENABLED })

describe('POST /api/orders — pickup-only pilot (P0-01)', () => {
  it('CRITÈRE 1 — body WITHOUT fulfillmentType → explicit 400, NO delivery order created', async () => {
    const res = await post(BASE_BODY)
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toMatch(/Mode de récupération requis/)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('CRITÈRE 2 — explicit delivery while the flag is OFF → 403 delivery_disabled, nothing written', async () => {
    const res = await post({ ...BASE_BODY, fulfillmentType: 'delivery' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('delivery_disabled')
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('CRITÈRE 3 — pickup on a pickup-enabled restaurant → accepted (201)', async () => {
    const res = await post({ ...BASE_BODY, fulfillmentType: 'pickup' })
    expect(res.status).toBe(201)
    expect(db.order.create).toHaveBeenCalledTimes(1)
    const arg = db.order.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data.fulfillmentType).toBe('pickup')
    expect(arg.data.deliveryFee).toBe(0) // pickup never pays the delivery fee
  })

  it('CRITÈRE 4 — restaurant with pickupEnabled=false → 403, nothing written', async () => {
    db.restaurant.findFirst.mockResolvedValue({ ...RESTO, pickupEnabled: false })
    const res = await post({ ...BASE_BODY, fulfillmentType: 'pickup' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('pickup_disabled_restaurant')
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('legacy row (columns absent from the mock → undefined) can NEVER open a channel', async () => {
    db.restaurant.findFirst.mockResolvedValue({ id: 'r1', isActive: true, minOrder: 0, deliveryFee: 1.99 })
    const res = await post({ ...BASE_BODY, fulfillmentType: 'pickup' })
    expect(res.status).toBe(403)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('POST-PILOT — flag ON + deliveryEnabled → delivery accepted again (no rewrite needed)', async () => {
    process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
    const res = await post({ ...BASE_BODY, fulfillmentType: 'delivery' })
    expect(res.status).toBe(201)
    const arg = db.order.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data.fulfillmentType).toBe('delivery')
    expect(arg.data.deliveryFee).toBe(1.99)
  })

  it('POST-PILOT — flag ON but restaurant.deliveryEnabled=false → 403 (columns finally enforced)', async () => {
    process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
    db.restaurant.findFirst.mockResolvedValue({ ...RESTO, deliveryEnabled: false })
    const res = await post({ ...BASE_BODY, fulfillmentType: 'delivery' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('delivery_disabled_restaurant')
    expect(db.order.create).not.toHaveBeenCalled()
  })
})

describe('refuseForbiddenFulfillment — pure decision', () => {
  it('flag semantics: only the exact string "true" enables delivery', () => {
    delete process.env.DELIVERY_FULFILLMENT_ENABLED
    expect(isDeliveryFulfillmentEnabled()).toBe(false)
    process.env.DELIVERY_FULFILLMENT_ENABLED = '1'
    expect(isDeliveryFulfillmentEnabled()).toBe(false)
    process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
    expect(isDeliveryFulfillmentEnabled()).toBe(true)
  })

  it('pickup on an opted-in restaurant → null (allowed)', () => {
    expect(refuseForbiddenFulfillment('pickup', { pickupEnabled: true })).toBeNull()
  })

  it('pickup refusals: false / undefined / null are ALL refused (strict opt-in)', async () => {
    for (const v of [false, undefined, null]) {
      const r = refuseForbiddenFulfillment('pickup', { pickupEnabled: v })
      expect(r).not.toBeNull()
      expect(r!.status).toBe(403)
    }
  })
})
