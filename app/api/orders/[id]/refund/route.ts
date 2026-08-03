import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRefundAdmin } from '@/lib/refund-route-guard'
import { recordAdminAudit } from '@/lib/admin-audit'
import { refundPayment } from '@/lib/refunds'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// ── POST /api/orders/[id]/refund ──────────────────────────────────────────────
// P0-03 (vague 1, Q3 fondateur) : refund an order — ADMIN GRUBANO ONLY. This
// route used to be OWNER-scoped (the resto could refund its own orders); Q3
// requires every refund to go through a Grubano-admin validation, so the gate is
// now requireRefundAdmin (401/403 + 'refund.denied' audit for anyone else, resto
// included). Mechanics unchanged: lib/refunds takes Grubano's commission back
// pro-rata (refund_application_fee — the REAL Stripe figure, never recomputed)
// and pulls the funds back from the resto's account on a routed charge
// (reverse_transfer); state-dependent idempotency; 409 on already-refunded /
// over-amount. paymentStatus STAYS 'paid' (no state change): the compensating
// 'refund' ledger line written by the charge.refunded webhook — which inherits
// the order's channel from the charge metadata — is the source of truth. Every
// accepted refund is audited ('refund.run').
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  amountCents: z.number().int().positive().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    // P0-03 — ADMIN GRUBANO only (denied attempts audited inside the gate).
    const gate = await requireRefundAdmin(req, { route: 'orders/[id]/refund', targetType: 'order', targetId: params.id })
    if (!gate.ok) return gate.res

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 })
    }

    const order = await prisma.order.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, consumerId: true,
        paymentStatus: true, stripePaymentIntentId: true,
      },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    if (order.paymentStatus !== 'paid' || !order.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Commande non payée — rien à rembourser.' }, { status: 409 })
    }

    const result = await refundPayment({
      paymentIntentId: order.stripePaymentIntentId,
      amountCents:     parsed.data.amountCents,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // P0-03 — audit the ACCEPTED refund (best-effort, after the money moved).
    await recordAdminAudit({
      actorId:    gate.actorId,
      actorEmail: gate.actorEmail,
      action:     'refund.run',
      targetType: 'order',
      targetId:   order.id,
      metadata:   { route: 'orders/[id]/refund', refundId: result.refund.id, refundedCents: result.refundedCents, remainingCents: result.remainingCents },
      req,
    })

    // ── Transactional email — POST-success, BEST-EFFORT (never throws). The
    // consumer is an Operator row; a missing email simply skips the send.
    try {
      const [consumer, resto] = await Promise.all([
        prisma.operator.findUnique({
          where:  { id: order.consumerId },
          select: { email: true, name: true },
        }),
        prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true } }),
      ])
      if (consumer?.email) {
        await sendRefundConfirmation({
          to:             consumer.email,
          customerName:   consumer.name ?? consumer.email,
          restaurantName: resto?.name ?? 'votre restaurant',
          refundedCents:  result.refundedCents,
          partial:        result.remainingCents > 0,
          dedupeKey:      `order:${order.id}:${result.refundedCents}`,
        })
      }
    } catch (e) {
      console.error('[EMAIL MISS] [POST /api/orders/[id]/refund] context lookup failed',
        JSON.stringify({ orderId: order.id, refundId: result.refund.id }),
        e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      refundId:       result.refund.id,
      refundedCents:  result.refundedCents,
      remainingCents: result.remainingCents,
      routed:         result.routed,
    })
  } catch (err) {
    console.error('[POST /api/orders/[id]/refund]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
