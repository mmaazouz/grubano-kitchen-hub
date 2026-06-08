import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect } from '@/lib/ticket'
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
// Owner-scoped. Open a ticket on a table. If one is already open, RETURN it
// (idempotent, reused:true) rather than erroring. Best-effort links the table's
// active reservation today (so brique 2 can find the deposit empreinte to release).
const openSchema = z.object({ restaurantTableId: z.string().min(1) })

export async function POST(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { restaurantTableId } = openSchema.parse(await req.json())
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: restaurantTableId },
      select: { id: true, restaurantId: true },
    })
    if (!table) return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    if (!table.restaurantId || !scope.ownedIds.includes(table.restaurantId)) {
      return NextResponse.json({ error: 'Table non autorisée' }, { status: 403 })
    }

    const existing = await prisma.tableTicket.findFirst({
      where:  { restaurantTableId, status: 'open' },
      select: ticketSelect,
    })
    if (existing) return NextResponse.json({ ticket: existing, reused: true })

    // Best-effort: the table's active reservation today (for brique-2 empreinte).
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const dayEnd   = new Date(dayStart); dayEnd.setDate(dayStart.getDate() + 1)
    const resa = await prisma.reservation.findFirst({
      where:   { tableId: restaurantTableId, status: { notIn: ['cancelled', 'noshow'] }, date: { gte: dayStart, lt: dayEnd } },
      orderBy: { date: 'asc' },
      select:  { id: true },
    })

    const ticket = await prisma.tableTicket.create({
      data: {
        restaurantId:      table.restaurantId,
        restaurantTableId: table.id,
        reservationId:     resa?.id ?? null,
        status:            'open',
        currency:          'eur',
        subtotal:          0,
      },
      select: ticketSelect,
    })
    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/tickets]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
