import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── D5 (closed beta) — CONNECT-READY GATE à la CRÉATION de commande ──────────
// Sans compte Connect ACTIF, le fallback plateforme encaisserait 100 % de
// l'argent (part restaurant comprise) chez Grubano SANS rail de reversement.
// /pay refuse déjà (orders-pay-route) ; ici on prouve le refus PRÉVENTIF à la
// création (éviter de fabriquer des commandes impayables) + le danger-flag QA.
// Le harnais global ouvre ALLOW_PLATFORM_FALLBACK (vitest.config env) — chaque
// test le pose explicitement pour prouver les deux côtés.

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
    promotion:       { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

vi.mock('@/lib/opening-hours', () => ({
  loadHoursContext:     vi.fn().mockResolvedValue({ configured: false }),
  isOpenAtCtx:          vi.fn().mockReturnValue(true),
  nextOpeningCtx:       vi.fn().mockReturnValue(null),
  nextOpeningLabelFr:   vi.fn().mockReturnValue(null),
}))

import { POST } from '@/app/api/orders/route'

const CONNECT_READY = {
  id: 'r1', isActive: true, archivedAt: null, minOrder: 0, deliveryFee: 1.99,
  deliveryEnabled: true, pickupEnabled: true, pointOfSaleId: null, deliveryTime: 25,
  stripeAccountId: 'acct_test', stripeAccountStatus: 'active',
}
const NOT_READY = { ...CONNECT_READY, stripeAccountId: null, stripeAccountStatus: null }

function post() {
  return POST(new Request('http://x/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      restaurantId: 'r1',
      items: [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 12 }],
      deliveryAddress: '12 rue de la République, Orange',
      paymentMethod: 'card',
      fulfillmentType: 'pickup',
    }),
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ sub: 'c1', email: 'c@x.fr' })
  db.menuItem.findMany.mockResolvedValue([{ id: 'i1', name: 'Gnocchi', price: 12 }])
  db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o1', status: 'awaiting_payment', ...data }))
  db.order.update.mockResolvedValue({ id: 'o1', status: 'awaiting_payment' })
  db.referral.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue(null)
  db.dishAdoption.findMany.mockResolvedValue([])
  db.dishSale.findFirst.mockResolvedValue(null)
  db.loyaltyCustomer.findUnique.mockResolvedValue(null)
  db.creator.findFirst.mockResolvedValue(null)
  db.affiliate.findFirst.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([])
})
afterEach(() => { process.env.ALLOW_PLATFORM_FALLBACK = 'true' })

describe('POST /api/orders — CONNECT-READY GATE préventif (D5)', () => {
  it('défaut (flag absent) : resto sans Connect → 409 restaurant_not_payable, RIEN écrit', async () => {
    delete process.env.ALLOW_PLATFORM_FALLBACK
    db.restaurant.findFirst.mockResolvedValue({ ...NOT_READY })
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('restaurant_not_payable')
    expect(db.order.create).not.toHaveBeenCalled()
    expect(db.menuItem.findMany).not.toHaveBeenCalled() // refus AVANT re-pricing
  })

  it("défaut : compte présent mais status 'restricted' → même refus (dégradation couverte)", async () => {
    delete process.env.ALLOW_PLATFORM_FALLBACK
    db.restaurant.findFirst.mockResolvedValue({ ...CONNECT_READY, stripeAccountStatus: 'restricted' })
    const res = await post()
    expect(res.status).toBe(409)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('défaut : resto Connect ACTIF → la commande passe (201)', async () => {
    delete process.env.ALLOW_PLATFORM_FALLBACK
    db.restaurant.findFirst.mockResolvedValue({ ...CONNECT_READY })
    const res = await post()
    expect(res.status).toBe(201)
    expect(db.order.create).toHaveBeenCalledTimes(1)
  })

  it("QA : ALLOW_PLATFORM_FALLBACK='true' restaure le comportement historique (201 sans Connect)", async () => {
    process.env.ALLOW_PLATFORM_FALLBACK = 'true'
    db.restaurant.findFirst.mockResolvedValue({ ...NOT_READY })
    const res = await post()
    expect(res.status).toBe(201)
  })

  it("strictement 'true' : 'TRUE' ne suffit pas", async () => {
    process.env.ALLOW_PLATFORM_FALLBACK = 'TRUE'
    db.restaurant.findFirst.mockResolvedValue({ ...NOT_READY })
    const res = await post()
    expect(res.status).toBe(409)
  })
})
