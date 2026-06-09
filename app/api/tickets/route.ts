import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect, ensureOpenTicket } from '@/lib/ticket'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// ── GET /api/tickets?restaurantTableId= ───────────────────────────────────────
// Owner-scoped. Returns the OPEN ticket on a table (with its items + subtotal),
// or { ticket: null } if none is open.
export async function GET(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const restaurantTableId = new URL(req.url).searchParams.get('restaurantTableId')
    if (!restaurantTableId) {
      return NextResponse.json({ error: 'restaurantTableId requis' }, { status: 400 })
    }
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: restaurantTableId },
      select: { restaurantId: true },
    })
    if (!table) return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    if (!table.restaurantId || !scope.ownedIds.includes(table.restaurantId)) {
      return NextResponse.json({ error: 'Table non autorisée' }, { status: 403 })
    }

    const ticket = await prisma.tableTicket.findFirst({
      where:   { restaurantTableId, status: 'open' },
      orderBy: { openedAt: 'desc' },
      select:  ticketSelect,
    })
    return NextResponse.json({ ticket: ticket ?? null })
  } catch (err) {
    console.error('[GET /api/tickets]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/tickets ─────────────────────────────────────────────────────────
// Owner-scoped. Open a SESSION ticket on a table — isolated per service:
//   • if one is already open on the table → return it (uniqueness, reused:true);
//   • { walkin: true } → open WITHOUT a reservation (explicit walk-in, reservationId
//     null), payable as soon as open;
//   • otherwise → require a reservation of THIS table marked 'arrived' today and
//     link the ticket to THAT precise reservation. No arrived client → 409, so a
//     bill can never open (nor be paid) before the restaurant validates the arrival.
// (Tickets also open AUTOMATICALLY when the operator marks a reservation 'arrived'
// in PATCH /api/reservations.)
const openSchema = z.object({
  restaurantTableId: z.string().min(1),
  walkin:            z.boolean().optional(),
})

export async function POST(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { restaurantTableId, walkin } = openSchema.parse(await req.json())
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: restaurantTableId },
      select: { id: true, restaurantId: true },
    })
    if (!table) return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    if (!table.restaurantId || !scope.ownedIds.includes(table.restaurantId)) {
      return NextResponse.json({ error: 'Table non autorisée' }, { status: 403 })
    }

    // Already an open session on the table → return it (one open per table).
    const existing = await prisma.tableTicket.findFirst({
      where:  { restaurantTableId, status: 'open' },
      select: ticketSelect,
    })
    if (existing) return NextResponse.json({ ticket: existing, reused: true })

    // Resolve the precise service this ticket belongs to.
    let reservationId: string | null = null
    if (!walkin) {
      // Require an ARRIVED reservation on this table today — the ticket is bound to
      // that exact service, never to a past/other booking of the same table.
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const dayEnd   = new Date(dayStart); dayEnd.setDate(dayStart.getDate() + 1)
      const arrived = await prisma.reservation.findFirst({
        where:   { tableId: restaurantTableId, status: 'arrived', date: { gte: dayStart, lt: dayEnd } },
        orderBy: { date: 'desc' },
        select:  { id: true },
      })
      if (!arrived) {
        return NextResponse.json(
          { error: "Aucun client arrivé sur cette table. Marquez l'arrivée d'une réservation, ou ouvrez en walk-in.", code: 'no_arrived' },
          { status: 409 },
        )
      }
      reservationId = arrived.id
    }

    const { id } = await ensureOpenTicket({ restaurantTableId: table.id, restaurantId: table.restaurantId, reservationId })
    const ticket = await prisma.tableTicket.findUnique({ where: { id }, select: ticketSelect })
    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/tickets]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
