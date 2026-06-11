import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { refundPayment } from '@/lib/refunds'

// ── POST /api/tickets/[id]/refund ─────────────────────────────────────────────
// Rail A5 — OWNER refunds a PAID bill, partially ({ amountCents }) or fully
// (empty body). A0: the refund takes Grubano's commission back pro-rata and, on
// a routed charge, pulls the funds back from the resto's account (lib/refunds).
// The ticket STAYS 'paid' (no state change, no migration): the compensating
// 'refund' ledger line written by the charge.refunded webhook is the source of
// truth of what was given back — A7 surfaces it.
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

    const ticket = await prisma.tableTicket.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, status: true, stripePaymentIntentId: true },
    })
    if (!ticket) return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    if (!scope.ownedIds.includes(ticket.restaurantId)) {
      return NextResponse.json({ error: 'Addition non autorisée' }, { status: 403 })
    }
    if (ticket.status !== 'paid' || !ticket.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Addition non payée — rien à rembourser.' }, { status: 409 })
    }

    const result = await refundPayment({
      paymentIntentId: ticket.stripePaymentIntentId,
      amountCents:     parsed.data.amountCents,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return NextResponse.json({
      refundId:       result.refund.id,
      refundedCents:  result.refundedCents,
      remainingCents: result.remainingCents,
      routed:         result.routed,
    })
  } catch (err) {
    console.error('[POST /api/tickets/[id]/refund]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
