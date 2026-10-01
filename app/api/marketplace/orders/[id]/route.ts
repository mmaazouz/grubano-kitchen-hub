import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { canTransition } from '@/lib/marketplace'

export const dynamic = 'force-dynamic'

// ── PATCH /api/marketplace/orders/[id] — resto status change (Slice 3) ────────
// The RESTO (buyer) may only CANCEL one of ITS OWN orders, and ONLY while it is
// still `placed` (before the supplier confirms) — enforced by the state machine
// (lib/marketplace OPERATOR_TRANSITIONS). Scoped to the session operator +
// ownership. A cancel after confirmation → 409.

const bodySchema = z.object({ status: z.string().min(1) })

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { status } = bodySchema.parse(await req.json())

    const order = await prisma.supplyOrder.findUnique({
      where: { id: params.id }, select: { operatorId: true, status: true },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    if (order.operatorId !== operator.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    if (!canTransition('operator', order.status, status)) {
      return NextResponse.json({ error: 'Transition invalide' }, { status: 409 })
    }

    const updated = await prisma.supplyOrder.update({
      where: { id: params.id }, data: { status }, select: { id: true, status: true },
    })
    return NextResponse.json({ ok: true, order: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/marketplace/orders/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
