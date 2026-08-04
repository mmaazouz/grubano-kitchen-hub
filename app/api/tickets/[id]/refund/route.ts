import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRefundAdmin } from '@/lib/refund-route-guard'
import { recordAdminAudit } from '@/lib/admin-audit'
import { isRefundsEnabled } from '@/lib/refund'
import { rateLimit } from '@/lib/rate-limit'
import { refundPayment } from '@/lib/refunds'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// ── POST /api/tickets/[id]/refund ─────────────────────────────────────────────
// P0-03 (vague 1, Q3 fondateur) : refund a PAID bill — ADMIN GRUBANO ONLY
// (used to be OWNER-scoped; every refund now requires a Grubano-admin session,
// denied + accepted attempts audited). Mechanics unchanged (rail A5): partial
// ({ amountCents }) or full (empty body); the refund takes Grubano's commission
// back pro-rata and, on a routed charge, pulls the funds back from the resto's
// account (lib/refunds). The ticket STAYS 'paid' (no state change, no
// migration): the compensating 'refund' ledger line written by the
// charge.refunded webhook is the source of truth of what was given back.
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
    // P0-26 — même régime que /api/admin/refunds/run : rate-limit → kill-switch
    // REFUNDS_ENABLED (défaut OFF → 403 explicite, AUCUN Stripe) → garde admin.
    const limited = rateLimit(req, 'ticket_refund', { limitDefault: 20, windowDefault: 60 })
    if (limited) return limited
    if (!isRefundsEnabled()) {
      return NextResponse.json({ error: 'Remboursements indisponibles', gated: true }, { status: 403 })
    }

    // P0-03 — ADMIN GRUBANO only (denied attempts audited inside the gate).
    const gate = await requireRefundAdmin(req, { route: 'tickets/[id]/refund', targetType: 'ticket', targetId: params.id })
    if (!gate.ok) return gate.res

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 })
    }

    const ticket = await prisma.tableTicket.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, status: true, stripePaymentIntentId: true, reservationId: true },
    })
    if (!ticket) return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    if (ticket.status !== 'paid' || !ticket.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Addition non payée — rien à rembourser.' }, { status: 409 })
    }

    const result = await refundPayment({
      paymentIntentId: ticket.stripePaymentIntentId,
      amountCents:     parsed.data.amountCents,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // P0-03 — audit the ACCEPTED refund (best-effort, after the money moved).
    await recordAdminAudit({
      actorId:    gate.actorId,
      actorEmail: gate.actorEmail,
      action:     'refund.run',
      targetType: 'ticket',
      targetId:   ticket.id,
      metadata:   { route: 'tickets/[id]/refund', refundId: result.refund.id, refundedCents: result.refundedCents, remainingCents: result.remainingCents },
      req,
    })

    // ── Transactional email v1 — POST-success, BEST-EFFORT (never throws).
    // The client's email lives on the LINKED reservation; a walk-in ticket
    // (reservationId null) or a reservation without email → nothing to send.
    if (ticket.reservationId) {
      try {
        const [reservation, resto] = await Promise.all([
          prisma.reservation.findUnique({
            where:  { id: ticket.reservationId },
            select: { email: true, customerName: true },
          }),
          prisma.restaurant.findUnique({ where: { id: ticket.restaurantId }, select: { name: true } }),
        ])
        if (reservation?.email) {
          await sendRefundConfirmation({
            to:             reservation.email,
            customerName:   reservation.customerName,
            restaurantName: resto?.name ?? 'votre restaurant',
            refundedCents:  result.refundedCents,
            partial:        result.remainingCents > 0,
            dedupeKey:      `ticket:${ticket.id}:${result.refundedCents}`,
          })
        }
      } catch (e) {
        console.error('[EMAIL MISS] [POST /api/tickets/[id]/refund] context lookup failed',
          JSON.stringify({ ticketId: ticket.id, refundId: result.refund.id }),
          e instanceof Error ? e.message : e)
      }
    }

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
