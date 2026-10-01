import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P0-02 (vague 1 — Q2/Q8 fondateur) — refus SERVEUR des espèces ─────────────
// Q2 : le paiement en espèces est retiré du pilote. Q8 : une capacité hors MVP
// doit être INDISPONIBLE CÔTÉ SERVEUR, pas seulement masquée dans l'interface
// (jusqu'ici seul le panier /eat tenait Q2). Contrat épinglé ici :
//   • POST /api/orders avec paymentMethod 'cash' OU 'wallet' (valeur héritée de
//     l'enum, même famille sans paiement en ligne) → 400 explicite, code
//     'payment_method_unavailable', AUCUNE écriture DB, AUCUN effet économique ;
//   • 'card' (explicite ou par défaut d'enum) → contrat INCHANGÉ : 201,
//     'awaiting_payment' (gate ghost-orders), aucune régression du parcours carte.
// Mock harness copied from tests/ghost-orders.test.ts (same route, same domain).

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
    openingHour:      { findMany: vi.fn() },
    closureException: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST as createOrder } from '@/app/api/orders/route'

const makeReq = (body: Record<string, unknown>) =>
  new NextRequest('https://app.grubano.com/api/orders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const orderBody = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest1',
  items: [{ itemId: 'i1', name: 'Gnocchi maison', qty: 1, price: 20, options: [] }],
  deliveryAddress: '12 rue de la Paix, 75002 Paris',
  fulfillmentType: 'pickup',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'cust1', email: 'lea@example.com', role: 'consumer' })
  db.restaurant.findFirst.mockResolvedValue({
    deliveryEnabled: true, pickupEnabled: true, id: 'rest1', isActive: true, deliveryFee: 1.99, minOrder: 10,
    commissionRateDineIn: null, commissionRatePickup: null,
    commissionRateDelivery: null, commissionFreeUntil: null,
  })
  // Re-pricing serveur (P0 closed beta): mirror the orderBody() line (i1
  // 'Gnocchi maison' @ 20 €) in DB so the CARD-path economics are unchanged
  // (inert on the cash/wallet refusals, which fall before the re-pricing).
  const MENU: Record<string, { name: string; price: number }> = { i1: { name: 'Gnocchi maison', price: 20 } }
  db.menuItem.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => (MENU[id] ? { id, ...MENU[id] } : null)).filter(Boolean))
  db.openingHour.findMany.mockResolvedValue([])
  db.closureException.findMany.mockResolvedValue([])
  db.creator.findFirst.mockResolvedValue(null)
  db.promotion.findMany.mockResolvedValue([])
  db.referral.findFirst.mockResolvedValue(null)
  db.dishAdoption.findMany.mockResolvedValue([])
  db.order.create.mockResolvedValue({ id: 'order1' })
  db.order.update.mockResolvedValue({ id: 'order1', total: 20, status: 'awaiting_payment' })
})

describe('POST /api/orders — P0-02 : refus serveur des modes non-carte', () => {
  it("⭐ 'cash' → 400 avec message français explicite + code, AUCUNE écriture DB", async () => {
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'cash' })))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toMatchObject({
      error: "Le paiement en espèces n'est pas disponible pour le moment — seul le paiement par carte est accepté.",
      code:  'payment_method_unavailable',
    })
    expect(db.order.create).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it("⭐ 'wallet' (valeur héritée) → même refus 400, message NOMMANT wallet (pas « espèces »), AUCUNE écriture DB", async () => {
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'wallet' })))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('payment_method_unavailable')
    expect(json.error).toContain('« wallet »') // revue : le message dit la vérité par méthode
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('le refus tombe AVANT toute lecture DB (aucun findFirst restaurant) — indisponible côté serveur, pas après coup', async () => {
    await createOrder(makeReq(orderBody({ paymentMethod: 'cash' })))
    expect(db.restaurant.findFirst).not.toHaveBeenCalled()
  })

  it("une valeur hors enum ('bitcoin') reste un 400 Zod — l'élargissement de surface est impossible", async () => {
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'bitcoin' })))
    expect(res.status).toBe(400)
    expect(db.order.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/orders — P0-02 : non-régression du parcours CARTE', () => {
  it("'card' explicite → 201, créée 'awaiting_payment' (gate ghost-orders inchangé)", async () => {
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'card' })))
    expect(res.status).toBe(201)
    expect((db.order.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data).toMatchObject({
      paymentMethod: 'card', status: 'awaiting_payment',
    })
  })

  it("paymentMethod ABSENT → défaut d'enum 'card' → 201 (le contrat client existant ne casse pas)", async () => {
    const res = await createOrder(makeReq(orderBody()))
    expect(res.status).toBe(201)
    expect((db.order.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data).toMatchObject({
      paymentMethod: 'card',
    })
  })

  it('sans session → 401 : le refus P0-02 ne court-circuite pas l’auth (rate-limit → auth → parse → refus)', async () => {
    getTokenMock.mockResolvedValue(null)
    const res = await createOrder(makeReq(orderBody({ paymentMethod: 'cash' })))
    expect(res.status).toBe(401)
  })
})
