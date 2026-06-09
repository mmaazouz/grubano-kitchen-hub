import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect, recomputeSubtotal } from '@/lib/ticket'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// Owner-scope + load the open ticket and confirm the item belongs to it.
async function loadOwnedLine(
  ticketId: string, itemId: string,
  scope: { ownedIds: string[] },
) {
  const ticket = await prisma.tableTicket.findUnique({
    where:  { id: ticketId },
    select: { id: true, restaurantId: true, status: true },
  })
  if (!ticket) return { error: NextResponse.json({ error: 'Addition introuvable' }, { status: 404 }) }
  if (!scope.ownedIds.includes(ticket.restaurantId)) {
    return { error: NextResponse.json({ error: 'Addition non autorisée' }, { status: 403 }) }
  }
  if (ticket.status !== 'open') {
    return { error: NextResponse.json({ error: 'Addition non ouverte.' }, { status: 409 }) }
  }
  const item = await prisma.ticketItem.findUnique({ where: { id: itemId }, select: { id: true, ticketId: true } })
  if (!item || item.ticketId !== ticketId) {
    return { error: NextResponse.json({ error: 'Ligne introuvable' }, { status: 404 }) }
  }
  return { ticket }
}

// ── PATCH /api/tickets/[id]/items/[itemId] — change quantity ──────────────────
const patchSchema = z.object({ quantity: z.number().int().min(1).max(99) })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; itemId: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { quantity } = patchSchema.parse(await req.json())
    const loaded = await loadOwnedLine(params.id, params.itemId, scope)
    if ('error' in loaded) return loaded.error

    await prisma.ticketItem.update({ where: { id: params.itemId }, data: { quantity } })
    await recomputeSubtotal(params.id)
    const ticket = await prisma.tableTicket.findUnique({ where: { id: params.id }, select: ticketSelect })
    return NextResponse.json({ ticket })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/tickets/[id]/items/[itemId]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/tickets/[id]/items/[itemId] — cancel a line (SERVER only) ─────
// SOFT cancel (decision T3/T5): the line is marked status='cancelled' (+ cancelledAt)
// and dropped from the subtotal, but KEPT in the DB so the addition/history shows
// "this was ordered then cancelled by the server". Only the operator reaches this
// route (owner-scoped — a 'consumer' role is refused upstream); the client has NO
// endpoint to cancel a line (T3.Q2). Idempotent: cancelling an already-cancelled
// line just no-ops the trace and recomputes.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; itemId: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const loaded = await loadOwnedLine(params.id, params.itemId, scope)
    if ('error' in loaded) return loaded.error

    await prisma.ticketItem.update({
      where: { id: params.itemId },
      data:  { status: 'cancelled', cancelledAt: new Date() },
    })
    await recomputeSubtotal(params.id)
    const ticket = await prisma.tableTicket.findUnique({ where: { id: params.id }, select: ticketSelect })
    return NextResponse.json({ ticket })
  } catch (err) {
    console.error('[DELETE /api/tickets/[id]/items/[itemId]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
