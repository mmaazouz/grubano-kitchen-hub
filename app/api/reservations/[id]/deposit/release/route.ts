import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { releaseDeposit, retrieveIntent } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function stripeFatal(err: unknown) {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
  }
  console.error('[deposit/release] stripe error', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Erreur paiement, réessayez.' }, { status: 502 })
}

// ── POST /api/reservations/[id]/deposit/release ───────────────────────────────
// ARRIVAL: cancel the authorisation — nothing is charged. Owner-scoped.
//
// OPTION C: Stripe is the SOURCE OF TRUTH. We retrieve the live PaymentIntent and
// act on ITS status — we do NOT rely on the stored depositStatus as a gate (that
// stored value can lag, e.g. stay "none" while the card is actually authorised;
// that mismatch is the bug we are fixing). Sets depositStatus=released,
// status=arrived.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, stripePaymentIntentId: true },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }

    // No hold was ever created → just record the arrival (nothing to cancel).
    if (!reservation.stripePaymentIntentId) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data:  { depositStatus: 'released', status: 'arrived' },
      })
      return NextResponse.json({ depositStatus: 'released', status: 'arrived', note: 'no_hold' })
    }

    // Read the LIVE PaymentIntent and branch on its real status.
    let status: string
    try {
      const pi = await retrieveIntent(reservation.stripePaymentIntentId)
      status = pi.status
    } catch (err) {
      return stripeFatal(err)
    }

    // Already captured (no-show charged) → cannot release.
    if (status === 'succeeded') {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { depositStatus: 'captured' } })
      return NextResponse.json({ error: 'Empreinte déjà capturée, libération impossible.' }, { status: 409 })
    }

    // Already cancelled → idempotent (ensure the DB reflects it).
    if (status === 'canceled') {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data:  { depositStatus: 'released', status: 'arrived' },
      })
      return NextResponse.json({ depositStatus: 'released', status: 'arrived' })
    }

    // Any cancellable state (requires_capture / requires_payment_method /
    // requires_confirmation / requires_action / processing) → cancel the hold.
    try {
      await releaseDeposit(reservation.stripePaymentIntentId)
    } catch (err) {
      return stripeFatal(err)
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { depositStatus: 'released', status: 'arrived' },
    })
    return NextResponse.json({ depositStatus: 'released', status: 'arrived' })
  } catch (err) {
    console.error('[POST deposit/release]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
