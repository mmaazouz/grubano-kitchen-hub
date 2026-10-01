import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── LOT 6 — dispatch HONNÊTE à la création de commande ───────────────────────
// L'ancien mock Uber Direct fabriquait un trackingUrl vers un sous-domaine
// inexistant (track.grubano.com) et une ETA ALÉATOIRE 25-40 min, persistés et
// affichés au client après un paiement réel. Désormais : AUCUNE URL de suivi
// (colonne nullable), et l'estimation = le temps configuré du restaurant
// (Restaurant.deliveryTime — le même chiffre que « Prêt vers HH:MM » du panier).

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
  deliveryTime: 22,
}

function post(body: Record<string, unknown>) {
  return POST(new Request('http://x/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never)
}

const BODY = {
  restaurantId: 'r1',
  items: [{ itemId: 'i1', name: 'Gnocchi', qty: 1, price: 12 }],
  deliveryAddress: '12 rue de la République, Orange',
  paymentMethod: 'card',
  fulfillmentType: 'pickup',
}

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ sub: 'c1', email: 'c@x.fr' })
  db.restaurant.findFirst.mockResolvedValue({ ...RESTO })
  db.menuItem.findMany.mockResolvedValue([{ id: 'i1', name: 'Gnocchi', price: 12 }])
  db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o1', status: 'awaiting_payment', ...data }))
  db.order.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o1', status: 'awaiting_payment', ...data }))
  db.referral.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue(null)
  db.dishAdoption.findMany.mockResolvedValue([])
  db.dishSale.findFirst.mockResolvedValue(null)
  db.loyaltyCustomer.findUnique.mockResolvedValue(null)
  db.creator.findFirst.mockResolvedValue(null)
  db.affiliate.findFirst.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([])
})

describe('POST /api/orders — dispatch honnête', () => {
  it('plus AUCUN trackingUrl fabriqué : la mise à jour post-création écrit null', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(201)
    const dispatchUpdate = db.order.update.mock.calls.find(
      (c) => 'trackingUrl' in ((c[0] as { data: Record<string, unknown> }).data),
    )
    expect(dispatchUpdate).toBeDefined()
    expect((dispatchUpdate![0] as { data: Record<string, unknown> }).data.trackingUrl).toBeNull()
  })

  it("l'ETA n'est plus aléatoire : estimatedTime = Restaurant.deliveryTime, renvoyé aussi en estimatedDelivery", async () => {
    const res = await post(BODY)
    const j = await res.json()
    const dispatchUpdate = db.order.update.mock.calls.find(
      (c) => 'estimatedTime' in ((c[0] as { data: Record<string, unknown> }).data),
    )
    expect((dispatchUpdate![0] as { data: Record<string, unknown> }).data.estimatedTime).toBe(22)
    expect(j.estimatedDelivery).toBe(22)
    expect(j.trackingUrl).toBeNull()
  })

  it('déterminisme : deux créations successives donnent la MÊME estimation (fin du random)', async () => {
    await post(BODY)
    const first = db.order.update.mock.calls.find(
      (c) => 'estimatedTime' in ((c[0] as { data: Record<string, unknown> }).data),
    )![0] as { data: Record<string, unknown> }
    vi.clearAllMocks()
    tokenMock.mockResolvedValue({ sub: 'c1', email: 'c@x.fr' })
    db.restaurant.findFirst.mockResolvedValue({ ...RESTO })
    db.menuItem.findMany.mockResolvedValue([{ id: 'i1', name: 'Gnocchi', price: 12 }])
    db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o2', status: 'awaiting_payment', ...data }))
    db.order.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o2', status: 'awaiting_payment', ...data }))
    db.referral.findFirst.mockResolvedValue(null)
    db.referralConfig.findFirst.mockResolvedValue(null)
    db.dishAdoption.findMany.mockResolvedValue([])
    db.dishSale.findFirst.mockResolvedValue(null)
    db.loyaltyCustomer.findUnique.mockResolvedValue(null)
    db.creator.findFirst.mockResolvedValue(null)
    db.affiliate.findFirst.mockResolvedValue(null)
    db.promotion.findMany.mockResolvedValue([])
    await post(BODY)
    const second = db.order.update.mock.calls.find(
      (c) => 'estimatedTime' in ((c[0] as { data: Record<string, unknown> }).data),
    )![0] as { data: Record<string, unknown> }
    expect(second.data.estimatedTime).toBe(first.data.estimatedTime)
  })
})
