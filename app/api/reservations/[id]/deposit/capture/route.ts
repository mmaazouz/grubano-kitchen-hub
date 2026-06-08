import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { captureDeposit, eurosToCents } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/reservations/[id]/deposit/capture ───────────────────────────────
// NO-SHOW: capture the penalty (≤ the authorised hold) from the empreinte.
// Owner-scoped — only the establishment that owns the reservation. Sets
// depositStatus=captured, status=noshow.
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
        depositStatus: true, depositAmount: true, noShowPenalty: true, depositCurrency: true,
      },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }
    if (!reservation.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Aucune empreinte à capturer.' }, { status: 400 })
    }
    if (reservation.depositStatus === 'released') {
      return NextResponse.json({ error: 'Empreinte déjà libérée.' }, { status: 409 })
    }
    if (reservation.depositStatus === 'captured') {
      // Idempotent: already captured → just reflect the current state.
      return NextResponse.json({ depositStatus: 'captured', status: 'noshow' })
    }

    // Penalty defaults to the full deposit when no explicit penalty is set, and is
    // capped at the authorised amount (Stripe allows capturing ≤ the hold).
    const penaltyEur = reservation.noShowPenalty > 0 ? reservation.noShowPenalty : reservation.depositAmount
    const captureCents = Math.min(eurosToCents(penaltyEur), eurosToCents(reservation.depositAmount))
    if (captureCents < 50) {
      return NextResponse.json({ error: 'Montant de pénalité trop faible.' }, { status: 400 })
    }

    try {
      await captureDeposit(reservation.stripePaymentIntentId, captureCents)
    } catch (err) {
      if (err instanceof Error && err.message === 'stripe_not_configured') {
        return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
      }
      // Typically: the hold was never authorised (card not confirmed) → not capturable.
      console.error('[deposit/capture] stripe error', err instanceof Error ? err.message : err)
      return NextResponse.json(
        { error: 'Capture impossible (empreinte non autorisée ou déjà finalisée).' },
        { status: 409 },
      )
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
