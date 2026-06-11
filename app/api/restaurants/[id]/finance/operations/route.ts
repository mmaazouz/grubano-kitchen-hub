import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// ── GET /api/restaurants/[id]/finance/operations?from&to&page ─────────────────
// Rail A7 — the establishment's paginated money operations, straight from
// LedgerEntry (read-only), ENRICHED with what the UI needs to display and act:
//   • the linked ticket (table name + status — a 'paid' ticket with money left
//     is refundable) or reservation (customer + depositStatus — a 'captured'
//     not-yet-refunded penalty is refundable);
//   • the cumulative refunded amount per PaymentIntent (derived from the
//     ledger's own 'refund' lines, ANY date) so the UI can badge a payment as
//     partially/fully refunded and cap the refund input.
// Defaults: last 30 days, newest first, 20 per page.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

async function authorize(restaurantId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { id: true, operatorId: true },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }
  if (restaurant.operatorId !== operator.id && operator.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }
  return { restaurant }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error

    const { searchParams } = new URL(req.url)
    const now      = new Date()
    const toParam   = searchParams.get('to')
    const fromParam = searchParams.get('from')
    const to   = toParam   ? new Date(toParam)   : now
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return NextResponse.json({ error: 'Période invalide' }, { status: 400 })
    }
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)

    const where = { restaurantId: params.id, createdAt: { gte: from, lte: to } }
    const [total, lines] = await Promise.all([
      prisma.ledgerEntry.count({ where }),
      prisma.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * PAGE_SIZE,
        take:    PAGE_SIZE,
        select: {
          id: true, type: true, createdAt: true, currency: true, routed: true,
          grossAmount: true, applicationFeeAmount: true, netToRestaurant: true,
          ticketId: true, reservationId: true, stripePaymentIntentId: true,
        },
      }),
    ])

    // ── Enrichment (batched) ────────────────────────────────────────────────────
    const ticketIds      = Array.from(new Set(lines.map(l => l.ticketId).filter((x): x is string => !!x)))
    const reservationIds = Array.from(new Set(lines.map(l => l.reservationId).filter((x): x is string => !!x)))
    const piIds          = Array.from(new Set(lines.map(l => l.stripePaymentIntentId).filter((x): x is string => !!x)))

    const [tickets, reservations, refundLines] = await Promise.all([
      ticketIds.length
        ? prisma.tableTicket.findMany({
            where:  { id: { in: ticketIds } },
            select: {
              id: true, status: true, subtotal: true, amountPaid: true,
              restaurantTable: { select: { name: true } },
            },
          })
        : [],
      reservationIds.length
        ? prisma.reservation.findMany({
            where:  { id: { in: reservationIds } },
            select: { id: true, customerName: true, date: true, depositStatus: true },
          })
        : [],
      // Cumulative refunds per PI (ANY date — a January payment refunded in
      // March must still badge as refunded).
      piIds.length
        ? prisma.ledgerEntry.findMany({
            where:  { type: 'refund', stripePaymentIntentId: { in: piIds } },
            select: { stripePaymentIntentId: true, grossAmount: true },
          })
        : [],
    ])

    const ticketById      = new Map(tickets.map(t => [t.id, t]))
    const reservationById = new Map(reservations.map(r => [r.id, r]))
    const refundedByPi    = new Map<string, number>()
    for (const r of refundLines) {
      if (!r.stripePaymentIntentId) continue
      refundedByPi.set(
        r.stripePaymentIntentId,
        (refundedByPi.get(r.stripePaymentIntentId) ?? 0) + -r.grossAmount,
      )
    }

    const operations = lines.map(l => {
      const ticket      = l.ticketId      ? ticketById.get(l.ticketId)           : undefined
      const reservation = l.reservationId ? reservationById.get(l.reservationId) : undefined
      const refundedCents = l.stripePaymentIntentId
        ? refundedByPi.get(l.stripePaymentIntentId) ?? 0
        : 0
      return {
        id:                   l.id,
        type:                 l.type,
        createdAt:            l.createdAt.toISOString(),
        currency:             l.currency,
        routed:               l.routed,
        grossCents:           l.grossAmount,
        applicationFeeCents:  l.applicationFeeAmount,
        netCents:             l.netToRestaurant,
        // Money-in lines only: how much of THIS payment already went back.
        refundedCents:        l.type === 'refund' ? 0 : refundedCents,
        ticket: ticket
          ? { id: ticket.id, status: ticket.status, tableName: ticket.restaurantTable?.name ?? null }
          : null,
        reservation: reservation
          ? {
              id:            reservation.id,
              customerName:  reservation.customerName,
              date:          reservation.date.toISOString(),
              depositStatus: reservation.depositStatus,
            }
          : null,
      }
    })

    return NextResponse.json({
      operations,
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: page * PAGE_SIZE < total,
      from: from.toISOString(),
      to:   to.toISOString(),
    })
  } catch (err) {
    console.error('[finance operations]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
