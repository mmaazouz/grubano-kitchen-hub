import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketHistorySelect } from '@/lib/ticket'

export const dynamic = 'force-dynamic'

// ── GET /api/reservations/[id]/tickets ────────────────────────────────────────
// Owner-scoped HISTORY for one reservation: every ticket it ever produced —
// open, paid AND void — with all their lines (INCLUDING cancelled ones), subtotal,
// status, closure trace + dates. Powers the restaurant "click a past reservation →
// see what was consumed" view (T5.Q3 / T6.Q2). Nothing is ever deleted, so a fully
// settled or voided service still shows its complete record here.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, customerName: true, status: true, date: true },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }

    const tickets = await prisma.tableTicket.findMany({
      where:   { reservationId: reservation.id },
      orderBy: { openedAt: 'desc' },
      select:  ticketHistorySelect,
    })

    // Derive a uniform closedReason for display: a paid ticket reads 'paid' even
    // though the bill-payment webhook (Agent 14) doesn't stamp closedReason; an
    // open ticket has none yet.
    const withReason = tickets.map((t) => ({
      ...t,
      closedReason: t.closedReason ?? (t.status === 'paid' ? 'paid' : null),
    }))

    return NextResponse.json({
      reservation: {
        id: reservation.id, customerName: reservation.customerName,
        status: reservation.status, date: reservation.date,
      },
      tickets: withReason,
    })
  } catch (err) {
    console.error('[GET /api/reservations/[id]/tickets]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
