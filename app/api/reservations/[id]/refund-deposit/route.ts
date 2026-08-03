import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRefundAdmin } from '@/lib/refund-route-guard'
import { recordAdminAudit } from '@/lib/admin-audit'
import { isRefundsEnabled } from '@/lib/refund'
import { rateLimit } from '@/lib/rate-limit'
import { refundPayment } from '@/lib/refunds'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// ── POST /api/reservations/[id]/refund-deposit ────────────────────────────────
// P0-03 (vague 1, Q3 fondateur) : refund a CAPTURED empreinte in full — ADMIN
// GRUBANO ONLY (used to be OWNER-scoped; every refund now requires a Grubano-
// admin session, denied + accepted attempts audited). Mechanics unchanged (rail
// A5): a contested no-show penalty, a goodwill gesture. depositStatus STAYS
// 'captured': the capture DID happen; the give-back is the compensating 'refund'
// ledger line written by the charge.refunded webhook (ledger = source of truth).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    // P0-26 — même régime que /api/admin/refunds/run : rate-limit → kill-switch
    // REFUNDS_ENABLED (défaut OFF → 403 explicite, AUCUN Stripe) → garde admin.
    const limited = rateLimit(req, 'reservation_refund_deposit', { limitDefault: 20, windowDefault: 60 })
    if (limited) return limited
    if (!isRefundsEnabled()) {
      return NextResponse.json({ error: 'Remboursements indisponibles', gated: true }, { status: 403 })
    }

    // P0-03 — ADMIN GRUBANO only (denied attempts audited inside the gate).
    const gate = await requireRefundAdmin(req, { route: 'reservations/[id]/refund-deposit', targetType: 'reservation', targetId: params.id })
    if (!gate.ok) return gate.res

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, depositStatus: true, stripePaymentIntentId: true,
        email: true, customerName: true,
      },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (reservation.depositStatus !== 'captured' || !reservation.stripePaymentIntentId) {
      return NextResponse.json(
        { error: 'Aucune empreinte capturée à rembourser.' },
        { status: 409 },
      )
    }

    // Full refund of the captured penalty (no partial on an empreinte).
    const result = await refundPayment({ paymentIntentId: reservation.stripePaymentIntentId })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // P0-03 — audit the ACCEPTED refund (best-effort, after the money moved).
    await recordAdminAudit({
      actorId:    gate.actorId,
      actorEmail: gate.actorEmail,
      action:     'refund.run',
      targetType: 'reservation',
      targetId:   reservation.id,
      metadata:   { route: 'reservations/[id]/refund-deposit', refundId: result.refund.id, refundedCents: result.refundedCents },
      req,
    })

    // ── Transactional email v1 — POST-success, BEST-EFFORT (never throws).
    // Typical case: a contested no-show penalty given back in full.
    if (reservation.email) {
      try {
        // Admin gate is global (no ownership) → restaurantId can be null here.
        const resto = reservation.restaurantId
          ? await prisma.restaurant.findUnique({
              where: { id: reservation.restaurantId }, select: { name: true },
            })
          : null
        await sendRefundConfirmation({
          to:             reservation.email,
          customerName:   reservation.customerName,
          restaurantName: resto?.name ?? 'votre restaurant',
          refundedCents:  result.refundedCents,
          partial:        false,
        })
      } catch (e) {
        console.error('[EMAIL MISS] [POST /api/reservations/[id]/refund-deposit] context lookup failed',
          JSON.stringify({ reservationId: reservation.id, refundId: result.refund.id }),
          e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({
      refundId:      result.refund.id,
      refundedCents: result.refundedCents,
      routed:        result.routed,
    })
  } catch (err) {
    console.error('[POST /api/reservations/[id]/refund-deposit]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
