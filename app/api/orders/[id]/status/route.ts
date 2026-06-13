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
  // ready → delivered DIRECTLY = the PICKUP hand-off (no courier leg, the
  // "picked_up / En route" step never applies to a pickup — ghost-orders 2.4).
  ready:     ['picked_up', 'delivered', 'cancelled'],
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

    // When order is delivered: credit loyalty points to the consumer.
    // FIX (chantier fidélité L1): LoyaltyCustomer is keyed by EMAIL, never by the
    // Operator id — the previous updateMany({ where: { id: consumerId } }) matched
    // nothing and silently credited zero. Resolve Operator(consumerId).email →
    // LoyaltyCustomer.email, then increment the balance AND append a signed 'earn'
    // ledger row in the SAME transaction. Idempotent: one 'earn' per order, so a
    // re-PATCH to 'delivered' (or a retry) never double-credits. Best-effort: a
    // missing loyalty account / table never blocks the status update.
    if (newStatus === 'delivered' && order.pointsEarned > 0) {
      try {
        const already = await prisma.loyaltyTransaction.findFirst({
          where: { orderId: order.id, type: 'earn' }, select: { id: true },
        })
        if (!already) {
          const operator = await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
          const lc = operator?.email
            ? await prisma.loyaltyCustomer.findUnique({ where: { email: operator.email }, select: { id: true } })
            : null
          if (lc) {
            await prisma.$transaction([
              prisma.loyaltyCustomer.update({ where: { id: lc.id }, data: { pointsBalance: { increment: order.pointsEarned } } }),
              prisma.loyaltyTransaction.create({ data: { customerId: lc.id, orderId: order.id, type: 'earn', points: order.pointsEarned } }),
            ])
          }
        }
      } catch (e) {
        // Non-fatal: consumer may not have a loyalty account yet, or the
        // LoyaltyTransaction table may be absent pre-db-push.
        console.error('[LOYALTY MISS] earn credit failed (non-fatal):', order.id, e instanceof Error ? e.message : e)
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
