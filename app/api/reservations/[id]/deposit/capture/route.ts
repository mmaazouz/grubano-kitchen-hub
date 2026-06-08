import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { captureDeposit, retrieveIntent, eurosToCents } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function stripeFatal(err: unknown) {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
  }
  console.error('[deposit/capture] stripe error', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Erreur paiement, réessayez.' }, { status: 502 })
}

// ── POST /api/reservations/[id]/deposit/capture ───────────────────────────────
// NO-SHOW: capture the penalty (≤ the authorised hold). Owner-scoped.
//
// OPTION C: Stripe is the SOURCE OF TRUTH. We retrieve the live PaymentIntent and
// act on ITS status — never on the stored depositStatus. Sets depositStatus=captured,
// status=noshow.
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
    if (!reservation.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Aucune empreinte à capturer.' }, { status: 400 })
    }

    // Read the LIVE PaymentIntent and branch on its real status.
    let status: string
    let amountCapturable = 0
    try {
      const pi = await retrieveIntent(reservation.stripePaymentIntentId)
      status = pi.status
      amountCapturable = pi.amount_capturable ?? 0
    } catch (err) {
      return stripeFatal(err)
    }

    // Already released (arrival processed) → cannot capture.
    if (status === 'canceled') {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { depositStatus: 'released' } })
      return NextResponse.json({ error: 'Empreinte déjà libérée, capture impossible.' }, { status: 409 })
    }

    // Already captured → idempotent (sync the DB and reflect the no-show).
    if (status === 'succeeded') {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data:  { depositStatus: 'captured', depositPaid: true, status: 'noshow' },
      })
      return NextResponse.json({ depositStatus: 'captured', status: 'noshow' })
    }

    // Only a card-authorised hold (requires_capture) can be captured. Any other
    // state means the card was never confirmed → nothing to capture.
    if (status !== 'requires_capture') {
      return NextResponse.json(
        { error: 'Empreinte non autorisée (carte non confirmée).' },
        { status: 409 },
      )
    }

    // Penalty defaults to the full deposit; capped at the AUTHORISED amount that
    // Stripe actually holds (amount_capturable), so we never over-capture.
    const penaltyEur   = reservation.noShowPenalty > 0 ? reservation.noShowPenalty : reservation.depositAmount
    const wanted       = Math.min(eurosToCents(penaltyEur), eurosToCents(reservation.depositAmount))
    const captureCents = amountCapturable > 0 ? Math.min(wanted, amountCapturable) : wanted
    if (captureCents < 50) {
      return NextResponse.json({ error: 'Montant de pénalité trop faible.' }, { status: 400 })
    }

    try {
      await captureDeposit(reservation.stripePaymentIntentId, captureCents)
    } catch (err) {
      return stripeFatal(err)
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { depositStatus: 'captured', depositPaid: true, status: 'noshow' },
    })

    return NextResponse.json({
      depositStatus: 'captured', status: 'noshow',
      capturedAmount: captureCents, currency: reservation.depositCurrency,
    })
  } catch (err) {
    console.error('[POST deposit/capture]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
