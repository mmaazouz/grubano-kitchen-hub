import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

// ── GET /api/eat/orders ──────────────────────────────────────────────────────
// READ-ONLY consumer feed for the « Mes commandes » screen (/eat/orders). Merges
// the authenticated consumer's delivery/pickup ORDERS, their dine-in
// TableTickets (linked via a Reservation they own) and — V5-1 — their table
// RESERVATIONS themselves (a reservation without a ticket used to produce NO
// card, leaving a client no page to understand a 15 € pre-authorisation on
// their bank statement). Normalised into a single list of cards split into
// current / past. No writes, no money flow — the dine-in payment, the order
// tracking and the reservation CANCEL are reached via EXISTING routes.
//
// Dine-in linkage: a TableTicket carries reservationId (nullable). A ticket is the
// consumer's iff that reservation is theirs (Reservation.userId). Walk-in tickets
// (no reservation) have no consumer link and are intentionally not surfaced here.

type Card = {
  id: string
  kind: 'delivery' | 'pickup' | 'dinein' | 'reservation'
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
  // ── kind 'reservation' only (V5-1) — ADDITIVE, existing cards unchanged ─────
  // The deposit pair is the WHOLE point (founder decision: display driven by
  // depositStatus + depositAmount, noShowPenalty NEVER selected nor exposed —
  // the explicit prisma select below guarantees it structurally).
  date?: string          // reservation start (also the card's sort axis)
  endTime?: string
  guests?: number
  depositAmount?: number
  depositStatus?: string // none | authorized | captured | released
  cancellable?: boolean  // UI hint; the cancel ROUTE re-judges everything
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

    // 2) The consumer's OWN reservations (V5-1: now cards in their own right,
    //    no longer just a bridge). SECURITY: the where is the ownership gate —
    //    userId = token.sub, nothing else ever widens it. The select DELIBERATELY
    //    omits noShowPenalty (config value, never a debt — founder decision) and
    //    every PII the client doesn't need; depositStatus + depositAmount drive
    //    the hold display. No take: the same rows keep feeding the dine-in
    //    ticket bridge below exactly as before (a cap could drop old paid
    //    tickets); the CARD list is capped at 50 further down.
    const reservations = await prisma.reservation.findMany({
      where: { userId: consumerId },
      orderBy: { date: 'desc' },
      select: {
        id: true, date: true, endTime: true, guests: true, status: true,
        depositAmount: true, depositStatus: true,
        restaurant: { select: { id: true, name: true } },
        table: { select: { restaurant: { select: { id: true, name: true } } } },
      },
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

    // 3) Reservation cards (V5-1). One card per reservation, ticket or not — an
    //    upcoming reservation IS the thing the client looks for when a 15 €
    //    pre-authorisation sits on their statement. Phase: a confirmed/underway
    //    reservation whose slot hasn't ended is 'current'; cancelled / noshow /
    //    ended slots are 'past'. Cancellable is a UI HINT only (confirmed +
    //    future start) — POST /api/reservations/[id]/cancel re-judges ownership,
    //    status and the cancellation window, unchanged.
    const now = Date.now()
    const UNDERWAY = ['confirmed', 'arrived', 'overrun']
    for (const r of reservations.slice(0, 50)) {
      const restaurant = r.restaurant ?? r.table?.restaurant ?? null
      cards.push({
        id: r.id,
        kind: 'reservation',
        phase: UNDERWAY.includes(r.status) && r.endTime.getTime() > now ? 'current' : 'past',
        restaurantName: restaurant?.name ?? '—',
        itemsCount: 0,
        total: 0,
        status: r.status,
        // The card's sort axis = the EVENT time (see comparator note below).
        createdAt: r.date.toISOString(),
        ref: refOf(r.id),
        restaurantId: restaurant?.id,
        date: r.date.toISOString(),
        endTime: r.endTime.toISOString(),
        guests: r.guests,
        depositAmount: r.depositAmount,
        depositStatus: r.depositStatus,
        cancellable: r.status === 'confirmed' && r.date.getTime() > now,
      })
    }

    // Sort criterion (V5-1, deliberate): ONE axis for the mixed list — the
    // moment the thing happens (orders/tickets: created/opened at; reservations:
    // the booked slot). It is the only field that means the same thing for both
    // object kinds, and it keeps the relative order of existing food cards
    // strictly unchanged (their axis is untouched). Descending, as before.
    const byDateDesc = (a: Card, b: Card) => (a.createdAt < b.createdAt ? 1 : -1)
    const current = cards.filter((c) => c.phase === 'current').sort(byDateDesc)
    const past = cards.filter((c) => c.phase === 'past').sort(byDateDesc)

    return NextResponse.json({ current, past })
  } catch (err) {
    console.error('[GET /api/eat/orders]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
