import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── V5-1 — les réservations deviennent des CARTES de « Mes commandes » ────────
// Avant : GET /api/eat/orders requêtait les réservations du client (select
// {id}) mais uniquement comme PONT vers les additions dine-in — une réservation
// à venir sans ticket ne produisait AUCUNE carte, et un client avec 15 €
// pré-autorisés n'avait aucune page pour comprendre la ligne de son relevé.
// Ces tests verrouillent : les cartes 'reservation' (4 états), l'affichage de
// l'empreinte piloté par depositStatus/depositAmount, l'ABSENCE structurelle de
// noShowPenalty dans la réponse, la garantie de propriété (where userId =
// token.sub), la non-régression des cartes food, le pont dine-in intact et
// l'axe de tri unique (le moment de l'événement).

const { db, getTokenMock } = vi.hoisted(() => ({
  db: {
    order:       { findMany: vi.fn() },
    reservation: { findMany: vi.fn() },
    tableTicket: { findMany: vi.fn() },
  },
  getTokenMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

import { GET } from '@/app/api/eat/orders/route'

const req = () => new NextRequest('http://x/api/eat/orders')
const H = 3600_000
const now = Date.now()

const resa = (over: Record<string, unknown> = {}) => ({
  id: 'resa1',
  date: new Date(now + 48 * H),
  endTime: new Date(now + 50 * H),
  guests: 2,
  status: 'confirmed',
  depositAmount: 15,
  depositStatus: 'authorized',
  restaurant: { id: 'r1', name: 'Chez Test' },
  table: { restaurant: { id: 'r1', name: 'Chez Test' } },
  ...over,
})

const order = () => ({
  id: 'ord1', status: 'preparing', total: 24.5, fulfillmentType: 'pickup',
  trackingUrl: null, createdAt: new Date(now - 1 * H), items: [{ qty: 2 }],
  estimatedTime: 20, restaurant: { id: 'r1', name: 'Chez Test' },
})

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'user1' })
  db.order.findMany.mockResolvedValue([])
  db.reservation.findMany.mockResolvedValue([])
  db.tableTicket.findMany.mockResolvedValue([])
})

describe('GET /api/eat/orders — cartes réservation (V5-1)', () => {
  it('une réservation À VENIR sans ticket produit une carte current avec empreinte + annulable', async () => {
    db.reservation.findMany.mockResolvedValue([resa()])
    const j = await (await GET(req())).json()
    expect(j.current).toHaveLength(1)
    const c = j.current[0]
    expect(c.kind).toBe('reservation')
    expect(c.restaurantName).toBe('Chez Test')
    expect(c.guests).toBe(2)
    expect(c.depositAmount).toBe(15)
    expect(c.depositStatus).toBe('authorized')
    expect(c.cancellable).toBe(true)
    expect(j.past).toHaveLength(0)
  })

  it('LE CAS FONDATEUR : noshow + empreinte LIBÉRÉE (15 €) → carte past, depositStatus released', async () => {
    db.reservation.findMany.mockResolvedValue([resa({
      status: 'noshow',
      date: new Date(now - 30 * H), endTime: new Date(now - 28 * H),
      depositStatus: 'released',
    })])
    const j = await (await GET(req())).json()
    expect(j.past).toHaveLength(1)
    const c = j.past[0]
    expect(c.kind).toBe('reservation')
    expect(c.status).toBe('noshow')
    expect(c.depositStatus).toBe('released')
    expect(c.depositAmount).toBe(15)
    expect(c.cancellable).toBe(false)
  })

  it('annulée → past, non annulable ; passée (créneau fini) → past, non annulable', async () => {
    db.reservation.findMany.mockResolvedValue([
      resa({ id: 'a', status: 'cancelled' }),
      resa({ id: 'b', date: new Date(now - 5 * H), endTime: new Date(now - 3 * H) }),
    ])
    const j = await (await GET(req())).json()
    expect(j.current).toHaveLength(0)
    expect(j.past.map((c: { id: string }) => c.id).sort()).toEqual(['a', 'b'])
    expect(j.past.every((c: { cancellable: boolean }) => c.cancellable === false)).toBe(true)
  })

  it('SÉCURITÉ : les réservations sont lues UNIQUEMENT where userId = token.sub', async () => {
    await GET(req())
    expect(db.reservation.findMany).toHaveBeenCalledTimes(1)
    const arg = db.reservation.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ userId: 'user1' })
  })

  it('SÉCURITÉ : sans token → 401, aucune requête DB', async () => {
    getTokenMock.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(db.reservation.findMany).not.toHaveBeenCalled()
  })

  it('noShowPenalty n’apparaît NULLE PART : ni dans le select, ni dans la réponse', async () => {
    db.reservation.findMany.mockResolvedValue([resa({ status: 'noshow', depositStatus: 'released' })])
    const res = await GET(req())
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain('noShowPenalty')
    const select = db.reservation.findMany.mock.calls[0][0].select
    expect(select.noShowPenalty).toBeUndefined()
    expect(select.depositStatus).toBe(true)
    expect(select.depositAmount).toBe(true)
  })

  it('NON-RÉGRESSION : une commande food garde exactement sa forme de carte', async () => {
    db.order.findMany.mockResolvedValue([order()])
    const j = await (await GET(req())).json()
    expect(j.current).toHaveLength(1)
    expect(j.current[0]).toEqual({
      id: 'ord1', kind: 'pickup', phase: 'current', restaurantName: 'Chez Test',
      itemsCount: 2, total: 24.5, status: 'preparing',
      createdAt: new Date(now - 1 * H).toISOString(), ref: 'GR-' + 'ord1'.slice(-5).toUpperCase(),
      restaurantId: 'r1', eta: 20, trackingId: 'ord1',
    })
  })

  it('PONT dine-in intact : un ticket lié à une résa produit toujours sa carte dinein (+ la carte résa)', async () => {
    db.reservation.findMany.mockResolvedValue([resa()])
    db.tableTicket.findMany.mockResolvedValue([{
      id: 'tk1', status: 'open', subtotal: 30, amountPaid: null, openedAt: new Date(now),
      restaurant: { id: 'r1', name: 'Chez Test' },
      restaurantTable: { id: 'tb1', name: 'Table 4' },
      items: [{ quantity: 1 }],
    }])
    const j = await (await GET(req())).json()
    const kinds = j.current.map((c: { kind: string }) => c.kind).sort()
    expect(kinds).toEqual(['dinein', 'reservation'])
    const bridgeArg = db.tableTicket.findMany.mock.calls[0][0]
    expect(bridgeArg.where.reservationId).toEqual({ in: ['resa1'] })
  })

  it('TRI : un seul axe = le moment de l’événement (résa J+2 avant la commande d’il y a 1 h, desc)', async () => {
    db.order.findMany.mockResolvedValue([order()])
    db.reservation.findMany.mockResolvedValue([resa()])
    const j = await (await GET(req())).json()
    expect(j.current.map((c: { kind: string }) => c.kind)).toEqual(['reservation', 'pickup'])
  })
})
