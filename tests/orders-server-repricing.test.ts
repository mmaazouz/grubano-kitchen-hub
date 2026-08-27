import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0 closed beta — le SERVEUR est la seule autorité de prix ────────────────
// Avant : POST /api/orders sommait les prix unitaires ENVOYÉS PAR LE CLIENT
// (panier sessionStorage manipulable) sans jamais relire MenuItem — un panier
// falsifié achetait à n'importe quel prix, et les options codées en dur de la
// fiche plat (+2/+4 €, Bacon +1,50 €…) étaient facturées sans que le
// restaurateur les ait jamais définies. Désormais chaque ligne est résolue
// contre un MenuItem (a) existant, (b) available, (c) porté par une brand
// RATTACHÉE à CE restaurant ; le prix et le nom DB écrasent ceux du client.
// Les personnalisations tarifées (size / supplements) sont refusées net.

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

const RESTO = {
  id: 'r1', isActive: true, archivedAt: null, minOrder: 0, deliveryFee: 1.99,
  deliveryEnabled: true, pickupEnabled: true, pointOfSaleId: null,
}

// Carte réelle côté DB : le gnocchi vaut 12 €, la focaccia 6,50 €.
const MENU: Record<string, { id: string; name: string; price: number }> = {
  i1: { id: 'i1', name: 'Gnocchi 4 fromages', price: 12 },
  i2: { id: 'i2', name: 'Focaccia', price: 6.5 },
}

function post(body: Record<string, unknown>) {
  return POST(new Request('http://x/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never)
}

const BASE = {
  restaurantId: 'r1',
  deliveryAddress: '12 rue de la République, Orange',
  paymentMethod: 'card',
  fulfillmentType: 'pickup',
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.DELIVERY_FULFILLMENT_ENABLED
  tokenMock.mockResolvedValue({ sub: 'consumer-1', email: 'c@x.fr' })
  db.restaurant.findFirst.mockResolvedValue({ ...RESTO })
  db.menuItem.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => MENU[id]).filter(Boolean))
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

const createdData = () => db.order.create.mock.calls[0][0].data as Record<string, unknown>

describe('POST /api/orders — re-pricing serveur', () => {
  it('un prix client falsifié est ÉCRASÉ par le prix DB (le total facturable vient du serveur)', async () => {
    const res = await post({ ...BASE, items: [{ itemId: 'i1', name: 'Gnocchi 4 fromages', qty: 2, price: 0.01 }] })
    expect(res.status).toBe(201)
    const items = createdData().items as Array<{ price: number }>
    expect(items[0].price).toBe(12)
    expect(createdData().total).toBe(24) // 2 × 12 €, pickup → 0 frais
  })

  it('un nom falsifié est remplacé par le nom DB (ce que voit le restaurant est la vérité carte)', async () => {
    await post({ ...BASE, items: [{ itemId: 'i1', name: 'Menu offert par le patron', qty: 1, price: 12 }] })
    const items = createdData().items as Array<{ name: string }>
    expect(items[0].name).toBe('Gnocchi 4 fromages')
  })

  it('article inconnu du restaurant → 400 item_unavailable, rien n’est écrit', async () => {
    const res = await post({ ...BASE, items: [{ itemId: 'ghost', name: 'X', qty: 1, price: 5 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('item_unavailable')
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('article d’un AUTRE restaurant / indisponible → même refus (le where impose brand.restaurantId + available)', async () => {
    db.menuItem.findMany.mockResolvedValue([])
    const res = await post({ ...BASE, items: [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 12 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('item_unavailable')
    expect(db.menuItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ available: true, brand: { restaurantId: 'r1' } }),
    }))
  })

  it('ligne composite `dishId::sig` avec parentDishId → résolue sur le plat parent', async () => {
    const res = await post({
      ...BASE,
      items: [{ itemId: 'i1::abc', name: 'Gnocchi (Sans oignon)', qty: 1, price: 3, options: [{ parentDishId: 'i1', exclusions: ['Sans oignon'] }] }],
    })
    expect(res.status).toBe(201)
    const items = createdData().items as Array<{ price: number; options: unknown[] }>
    expect(items[0].price).toBe(12)
    // exclusions/note (sans impact prix) voyagent inchangées vers le restaurant
    expect(items[0].options).toEqual([{ parentDishId: 'i1', exclusions: ['Sans oignon'] }])
  })

  it('options tarifées (size / supplements) → 400 options_not_supported, rien n’est écrit', async () => {
    const res = await post({
      ...BASE,
      items: [{ itemId: 'i1::x', name: 'Gnocchi (Grande)', qty: 1, price: 16, options: [{ parentDishId: 'i1', size: 'Grande', supplements: [{ name: 'Bacon', price: 1.5 }] }] }],
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('options_not_supported')
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('minOrder est évalué sur le sous-total RE-PRICÉ, pas sur les prix client', async () => {
    db.restaurant.findFirst.mockResolvedValue({ ...RESTO, minOrder: 10 })
    // le client prétend 15 € mais la carte dit 6,50 € → sous le minimum → 400
    const res = await post({ ...BASE, items: [{ itemId: 'i2', name: 'Focaccia', qty: 1, price: 15 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/minimum/i)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('quantité absurde (>99) → 400 zod, rien n’est écrit', async () => {
    const res = await post({ ...BASE, items: [{ itemId: 'i1', name: 'Gnocchi', qty: 1000, price: 12 }] })
    expect(res.status).toBe(400)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('panier multi-lignes honnête → total = somme des prix DB', async () => {
    const res = await post({
      ...BASE,
      items: [
        { itemId: 'i1', name: 'Gnocchi 4 fromages', qty: 1, price: 12 },
        { itemId: 'i2', name: 'Focaccia', qty: 2, price: 6.5 },
      ],
    })
    expect(res.status).toBe(201)
    expect(createdData().total).toBe(25) // 12 + 2×6,50
  })
})
