import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { captureHold } from '@/lib/deposit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/reservations/[id]/deposit/capture ───────────────────────────────
// NO-SHOW: capture the penalty (≤ the authorised hold). Owner-scoped. Uses the
// shared captureHold() (Stripe = source of truth). Sets depositStatus=captured,
// status=noshow. The same settle now also runs on PATCH status='noshow'.
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
        id: true, restaurantId: true, stripePaymentIntentId: true,
        depositAmount: true, noShowPenalty: true, depositCurrency: true,
      },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }

    const settle = await captureHold(
      reservation.stripePaymentIntentId, reservation.noShowPenalty, reservation.depositAmount,
    )
    if (!settle.ok) return NextResponse.json({ error: settle.error }, { status: settle.status })

    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { depositStatus: 'captured', depositPaid: true, status: 'noshow' },
    })
    return NextResponse.json({
      depositStatus: 'captured', status: 'noshow',
      capturedAmount: settle.capturedAmount, currency: reservation.depositCurrency,
    })
  } catch (err) {
    console.error('[POST deposit/capture]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
