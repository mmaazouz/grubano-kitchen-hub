import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { refundPayment } from '@/lib/refunds'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// ── POST /api/orders/[id]/refund ──────────────────────────────────────────────
// C3-fix — the A5×C1 gap: the OWNER (resto) refunds a PAID pickup/delivery
// order, partially ({ amountCents }) or fully (empty body). Exact pattern of
// /api/tickets/[id]/refund: lib/refunds takes Grubano's commission back
// pro-rata (refund_application_fee — the REAL Stripe figure, never recomputed)
// and pulls the funds back from the resto's account on a routed charge
// (reverse_transfer); state-dependent idempotency; 409 on already-refunded /
// over-amount. paymentStatus STAYS 'paid' (no state change): the compensating
// 'refund' ledger line written by the charge.refunded webhook — which inherits
// the order's channel from the charge metadata — is the source of truth.
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
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

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
    if (!scope.ownedIds.includes(order.restaurantId)) {
      return NextResponse.json({ error: 'Commande non autorisée' }, { status: 403 })
    }
    if (order.paymentStatus !== 'paid' || !order.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Commande non payée — rien à rembourser.' }, { status: 409 })
    }

    const result = await refundPayment({
      paymentIntentId: order.stripePaymentIntentId,
      amountCents:     parsed.data.amountCents,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

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
