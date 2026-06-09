import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { round2, recomputeSubtotal, consumerTicketSelect } from '@/lib/ticket'

// Stripe is not touched here, but we read the session JWT → Node runtime, dynamic.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/t/[tableId]/order ───────────────────────────────────────────────
// CONSUMER "order at the table" — a logged-in guest adds dishes to THEIR own
// session bill from the app. The price is ALWAYS read SERVER-side from the menu
// (the client never sends an amount) and frozen on the line, exactly like the
// operator-side add. Lines are tagged addedBy='client' so the dashboard can
// surface a "new client order" notification (Agent 13, étape 3).
//
// SERVER CONTROLS (balayage decisions):
//   (a) the caller must be CONNECTED (getToken) AND be the reservation's account
//       holder — reservation.userId === token.sub. /api is outside the middleware
//       matcher, so auth is enforced here, not by middleware (untouched).
//   (b) the reservation must be 'arrived' (the restaurant validated the arrival)
//       → otherwise 409.
//   (c) a single OPEN ticket must exist on the table (the session bill).
//   (d) WALK-IN (ticket.reservationId === null) → 403: ordering from the app is
//       reserved to guests who booked (T5.Q2). A walk-in orders via the server.
// Adds are DIRECT (no operator pre-approval, T2.Q1) and the client may order
// SEVERAL times (T2.Q3) — no anti-duplicate.
const lineSchema = z.object({
  menuItemId: z.string().min(1),
  quantity:   z.number().int().min(1).max(99).default(1),
  // Per-line modifiers, SAME shape the delivery cart uses for Order.items[].options
  // (an array of objects). Stored JSON-encoded on the line. Optional.
  options:    z.array(z.record(z.unknown())).max(40).optional(),
  notes:      z.string().max(280).optional(),
  allergies:  z.string().max(280).optional(),
})
const orderSchema = z.object({ items: z.array(lineSchema).min(1).max(50) })

export async function POST(
  req: NextRequest,
  { params }: { params: { tableId: string } },
) {
  try {
    // (a) Connected guest — same identity model as /api/orders (token.sub = Operator.id).
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Connectez-vous pour commander à table.' }, { status: 401 })
    }

    const { items } = orderSchema.parse(await req.json())

    // The table must exist + be active (mirror the public ticket endpoint's guard).
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: params.tableId },
      select: { id: true, active: true, restaurantId: true },
    })
    if (!table || !table.active) {
      return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    }
    if (!table.restaurantId) {
      return NextResponse.json({ error: 'Table non rattachée à un établissement.' }, { status: 409 })
    }

    // (c) The single OPEN session ticket on this table (the bill in progress).
    const ticket = await prisma.tableTicket.findFirst({
      where:   { restaurantTableId: table.id, status: 'open' },
      orderBy: { openedAt: 'desc' },
      select:  { id: true, reservationId: true },
    })
    if (!ticket) {
      return NextResponse.json(
        { error: "Aucune addition ouverte. Le restaurant doit valider votre arrivée.", code: 'no_open_ticket' },
        { status: 409 },
      )
    }

    // (d) Walk-in (no reservation) → app ordering is not available.
    if (!ticket.reservationId) {
      return NextResponse.json(
        { error: 'La commande depuis l’app est réservée aux clients ayant réservé. Demandez au serveur.', code: 'walkin_no_order' },
        { status: 403 },
      )
    }

    // (a)+(b) Identity + arrival window. The bill is bound to a precise reservation;
    // only its account holder may order, and only once arrived.
    const reservation = await prisma.reservation.findUnique({
      where:  { id: ticket.reservationId },
      select: { userId: true, status: true },
    })
    if (!reservation) {
      return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 })
    }
    if (reservation.userId !== token.sub) {
      return NextResponse.json(
        { error: 'Cette table n’est pas liée à votre compte.', code: 'not_your_session' },
        { status: 403 },
      )
    }
    if (reservation.status !== 'arrived') {
      return NextResponse.json(
        { error: 'Le restaurant doit valider votre arrivée avant de commander.', code: 'not_arrived' },
        { status: 409 },
      )
    }

    // Resolve the menu lines SERVER-side: one query, freeze name + unitPrice at add
    // time, and confirm each dish belongs to THIS establishment's operator (a guest
    // can never bill a dish from another restaurant).
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: table.restaurantId },
      select: { operatorId: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Établissement introuvable.' }, { status: 404 })
    }

    const ids = Array.from(new Set(items.map(i => i.menuItemId)))
    const menuItems = await prisma.menuItem.findMany({
      where:  { id: { in: ids } },
      select: { id: true, name: true, price: true, available: true, brand: { select: { operatorId: true } } },
    })
    const byId = new Map(menuItems.map(m => [m.id, m]))

    const rows = items.map((line) => {
      const mi = byId.get(line.menuItemId)
      if (!mi)                                     throw new LineError('Plat introuvable.')
      if (mi.brand.operatorId !== restaurant.operatorId) throw new LineError('Plat non disponible sur cette table.')
      if (!mi.available)                           throw new LineError(`« ${mi.name} » n’est plus disponible.`)
      return {
        ticketId:  ticket.id,
        menuItemId: mi.id,
        name:      mi.name,
        unitPrice: round2(mi.price),
        quantity:  line.quantity,
        addedBy:   'client',
        status:    'active',
        options:   line.options && line.options.length ? JSON.stringify(line.options) : null,
        notes:     line.notes?.trim() || null,
        allergies: line.allergies?.trim() || null,
      }
    })

    await prisma.ticketItem.createMany({ data: rows })
    await recomputeSubtotal(ticket.id)

    // Return the consumer-safe bill (active lines, no private fields) so the app
    // reflects the order immediately.
    const full = await prisma.tableTicket.findUnique({ where: { id: ticket.id }, select: consumerTicketSelect })
    return NextResponse.json({ ticket: full, added: rows.length }, { status: 201 })
  } catch (err) {
    if (err instanceof LineError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/t/[tableId]/order]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// Tiny typed error so a bad line maps to a clean 400 (not an opaque 500).
class LineError extends Error {}
