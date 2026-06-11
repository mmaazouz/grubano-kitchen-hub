import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { refundPayment } from '@/lib/refunds'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// ── POST /api/reservations/[id]/refund-deposit ────────────────────────────────
// Rail A5 — OWNER refunds a CAPTURED empreinte in full (a contested no-show
// penalty, a goodwill gesture). depositStatus STAYS 'captured': the capture DID
// happen; the give-back is the compensating 'refund' ledger line written by the
// charge.refunded webhook (ledger = source of truth — A7 surfaces it).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, depositStatus: true, stripePaymentIntentId: true,
        email: true, customerName: true,
      },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }
    if (reservation.depositStatus !== 'captured' || !reservation.stripePaymentIntentId) {
      return NextResponse.json(
        { error: 'Aucune empreinte capturée à rembourser.' },
        { status: 409 },
      )
    }

    // Full refund of the captured penalty (no partial on an empreinte).
    const result = await refundPayment({ paymentIntentId: reservation.stripePaymentIntentId })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // ── Transactional email v1 — POST-success, BEST-EFFORT (never throws).
    // Typical case: a contested no-show penalty given back in full.
    if (reservation.email) {
      try {
        const resto = await prisma.restaurant.findUnique({
          where: { id: reservation.restaurantId as string }, select: { name: true },
        })
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
