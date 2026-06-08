import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect } from '@/lib/ticket'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// ── GET /api/tickets/[id] ─────────────────────────────────────────────────────
// Owner-scoped. A ticket with its items + subtotal.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const ticket = await prisma.tableTicket.findUnique({ where: { id: params.id }, select: ticketSelect })
    if (!ticket) return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    if (!scope.ownedIds.includes(ticket.restaurantId)) {
      return NextResponse.json({ error: 'Addition non autorisée' }, { status: 403 })
    }
    return NextResponse.json({ ticket })
  } catch (err) {
    console.error('[GET /api/tickets/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PATCH /api/tickets/[id] ───────────────────────────────────────────────────
// Owner-scoped. Void a ticket (cancel). Payment (status=paid) is brique 2.
const patchSchema = z.object({ status: z.enum(['void']) })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { status } = patchSchema.parse(await req.json())

    const existing = await prisma.tableTicket.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, status: true },
    })
    if (!existing) return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    if (!scope.ownedIds.includes(existing.restaurantId)) {
      return NextResponse.json({ error: 'Addition non autorisée' }, { status: 403 })
    }
    if (existing.status === 'paid') {
      return NextResponse.json({ error: 'Addition déjà payée, annulation impossible.' }, { status: 409 })
    }

    const ticket = await prisma.tableTicket.update({
      where:  { id: params.id },
      data:   { status },
      select: ticketSelect,
    })
    return NextResponse.json({ ticket })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/tickets/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
