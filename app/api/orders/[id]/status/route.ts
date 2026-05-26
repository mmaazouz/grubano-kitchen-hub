import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// ── Valid status machine ──────────────────────────────────────────────────────
//   received → preparing → ready → picked_up → delivered
//   any state → cancelled  (restaurant/admin only)

const TRANSITIONS: Record<string, string[]> = {
  received:  ['preparing', 'cancelled'],
  preparing: ['ready',     'cancelled'],
  ready:     ['picked_up', 'cancelled'],
  picked_up: ['delivered'],
  delivered: [],
  cancelled: [],
}

const patchSchema = z.object({
  status: z.enum(['received', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled']),
})

// ── PATCH /api/orders/:id/status ─────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    // Only restaurant operators and admins can update order status
    const role = token.role as string
    if (!['restaurant', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await req.json()
    const { status: newStatus } = patchSchema.parse(body)

    const order = await prisma.order.findUnique({ where: { id: params.id } })
    if (!order) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }

    // Enforce state machine
    const allowed = TRANSITIONS[order.status] ?? []
    if (!allowed.includes(newStatus)) {
      return NextResponse.json(
        {
          error:   `Transition invalide: ${order.status} → ${newStatus}`,
          allowed: allowed.length ? allowed : ['(aucune transition possible)'],
        },
        { status: 422 },
      )
    }

    const updated = await prisma.order.update({
      where: { id: params.id },
      data:  { status: newStatus },
    })

    // When order is delivered: credit loyalty points to consumer
    if (newStatus === 'delivered' && order.pointsEarned > 0) {
      try {
        await prisma.loyaltyCustomer.updateMany({
          where: { id: order.consumerId },
          data:  { pointsBalance: { increment: order.pointsEarned } },
        })
      } catch {
        // Non-fatal: consumer may not have a loyalty account yet
      }
    }

    return NextResponse.json({
      orderId:    updated.id,
      status:     updated.status,
      updatedAt:  updated.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    console.error('[PATCH /api/orders/:id/status]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
