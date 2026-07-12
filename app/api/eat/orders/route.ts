import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

// ── GET /api/eat/orders ──────────────────────────────────────────────────────
// READ-ONLY consumer feed for the « Mes commandes » screen (/eat/orders). Merges
// the authenticated consumer's delivery/pickup ORDERS with their dine-in
// TableTickets (linked via a Reservation they own), normalised into a single list
// of cards split into current / past. No writes, no money flow — the dine-in
// payment + the order tracking are reached by routing to EXISTING pages.
//
// Dine-in linkage: a TableTicket carries reservationId (nullable). A ticket is the
// consumer's iff that reservation is theirs (Reservation.userId). Walk-in tickets
// (no reservation) have no consumer link and are intentionally not surfaced here.

type Card = {
  id: string
  kind: 'delivery' | 'pickup' | 'dinein'
  phase: 'current' | 'past'
  restaurantName: string
  itemsCount: number
  total: number
  status: string
  createdAt: string
  ref: string
  restaurantId?: string
  eta?: number
  trackingId?: string
  tableLabel?: string
  tableId?: string
}

const ACTIVE_ORDER = ['received', 'preparing', 'ready', 'picked_up']
const PAST_ORDER = ['delivered', 'cancelled']

// Short, human-friendly reference derived from the real id (no fabricated codes).
const refOf = (id: string) => 'GR-' + id.slice(-5).toUpperCase()

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }
    const consumerId = token.sub

    // 1) Delivery / pickup orders (the consumer's own).
    const orders = await prisma.order.findMany({
      where: { consumerId, status: { in: [...ACTIVE_ORDER, ...PAST_ORDER] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, status: true, total: true, fulfillmentType: true,
        trackingUrl: true, createdAt: true, items: true, estimatedTime: true,
        restaurant: { select: { id: true, name: true } },
      },
    })

    // 2) Dine-in tickets reachable from a reservation the consumer owns.
    const reservations = await prisma.reservation.findMany({
      where: { userId: consumerId },
      select: { id: true },
    })
    const reservationIds = reservations.map((r) => r.id)
    const tickets = reservationIds.length
      ? await prisma.tableTicket.findMany({
          where: { reservationId: { in: reservationIds }, status: { in: ['open', 'paid'] } },
          orderBy: { openedAt: 'desc' },
          take: 50,
          select: {
            id: true, status: true, subtotal: true, amountPaid: true, openedAt: true,
            restaurant: { select: { id: true, name: true } },
            restaurantTable: { select: { id: true, name: true } },
            items: { where: { status: 'active' }, select: { quantity: true } },
          },
        })
      : []

    const cards: Card[] = []

    for (const o of orders) {
      const items = Array.isArray(o.items) ? (o.items as Array<{ qty?: number }>) : []
      const itemsCount = items.reduce((s, it) => s + (typeof it?.qty === 'number' ? it.qty : 1), 0)
      cards.push({
        id: o.id,
        kind: o.fulfillmentType === 'pickup' ? 'pickup' : 'delivery',
        phase: ACTIVE_ORDER.includes(o.status) ? 'current' : 'past',
        restaurantName: o.restaurant?.name ?? '—',
        itemsCount,
        total: o.total,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        ref: refOf(o.id),
        restaurantId: o.restaurant?.id,
        eta: o.estimatedTime,
        trackingId: o.id,
      })
    }

    for (const t of tickets) {
      cards.push({
        id: t.id,
        kind: 'dinein',
        phase: t.status === 'open' ? 'current' : 'past',
        restaurantName: t.restaurant?.name ?? '—',
        itemsCount: t.items.reduce((s, it) => s + (it.quantity ?? 1), 0),
        total: t.status === 'paid' ? (t.amountPaid ?? t.subtotal) : t.subtotal,
        status: t.status,
        createdAt: t.openedAt.toISOString(),
        ref: refOf(t.id),
        restaurantId: t.restaurant?.id,
        tableLabel: t.restaurantTable?.name,
        tableId: t.restaurantTable?.id,
      })
    }

    const byDateDesc = (a: Card, b: Card) => (a.createdAt < b.createdAt ? 1 : -1)
    const current = cards.filter((c) => c.phase === 'current').sort(byDateDesc)
    const past = cards.filter((c) => c.phase === 'past').sort(byDateDesc)

    return NextResponse.json({ current, past })
  } catch (err) {
    console.error('[GET /api/eat/orders]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
