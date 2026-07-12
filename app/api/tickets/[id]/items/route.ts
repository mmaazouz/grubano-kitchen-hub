import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect, recomputeSubtotal, round2 } from '@/lib/ticket'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// ── POST /api/tickets/[id]/items ──────────────────────────────────────────────
// Owner-scoped. Add a line: from the menu ({menuItemId} → name + unitPrice FROZEN
// from MenuItem) OR a free line ({name, unitPrice}). Recomputes subtotal.
const addSchema = z.object({
  menuItemId: z.string().min(1).optional(),
  name:       z.string().min(1).max(120).optional(),
  unitPrice:  z.number().min(0).max(100000).optional(),
  quantity:   z.number().int().min(1).max(99).default(1),
}).refine(
  d => Boolean(d.menuItemId) || (Boolean(d.name) && d.unitPrice != null),
  { message: 'Fournissez un menuItemId, ou un name + unitPrice (ligne libre).' },
)

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const data = addSchema.parse(await req.json())

    const ticket = await prisma.tableTicket.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, status: true },
    })
    if (!ticket) return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    if (!scope.ownedIds.includes(ticket.restaurantId)) {
      return NextResponse.json({ error: 'Addition non autorisée' }, { status: 403 })
    }
    if (ticket.status !== 'open') {
      return NextResponse.json({ error: 'Addition non ouverte.' }, { status: 409 })
    }

    // Resolve the line — freeze name + unitPrice at add time.
    let name: string
    let unitPrice: number
    let menuItemId: string | null = null
    if (data.menuItemId) {
      const mi = await prisma.menuItem.findUnique({
        where:  { id: data.menuItemId },
        select: { name: true, price: true, brand: { select: { operatorId: true } } },
      })
      if (!mi) return NextResponse.json({ error: 'Plat introuvable' }, { status: 400 })
      // Owner consistency: the dish must belong to the caller's operator.
      if (mi.brand.operatorId !== scope.operatorId) {
        return NextResponse.json({ error: 'Plat non autorisé' }, { status: 403 })
      }
      name = mi.name
      unitPrice = round2(mi.price)
      menuItemId = data.menuItemId
    } else {
      name = data.name!.trim()
      unitPrice = round2(data.unitPrice!)
    }

    await prisma.ticketItem.create({
      data: { ticketId: ticket.id, menuItemId, name, unitPrice, quantity: data.quantity },
    })
    await recomputeSubtotal(ticket.id)

    const full = await prisma.tableTicket.findUnique({ where: { id: ticket.id }, select: ticketSelect })
    return NextResponse.json({ ticket: full }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/tickets/[id]/items]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
