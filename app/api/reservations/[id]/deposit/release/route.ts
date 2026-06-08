import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { releaseDeposit } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/reservations/[id]/deposit/release ───────────────────────────────
// ARRIVAL: cancel the authorisation — nothing is charged. Owner-scoped. Sets
// depositStatus=released, status=arrived.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, stripePaymentIntentId: true, depositStatus: true },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }
    if (reservation.depositStatus === 'captured') {
      return NextResponse.json({ error: 'Empreinte déjà capturée, libération impossible.' }, { status: 409 })
    }
    if (reservation.depositStatus === 'released') {
      // Idempotent.
      return NextResponse.json({ depositStatus: 'released', status: 'arrived' })
    }

    // Cancel the hold if one exists (nothing charged). With no PI we just mark
    // the arrival — release is a no-op on a reservation that never had a hold.
    if (reservation.stripePaymentIntentId) {
      try {
        await releaseDeposit(reservation.stripePaymentIntentId)
      } catch (err) {
        if (err instanceof Error && err.message === 'stripe_not_configured') {
          return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
        }
        console.error('[deposit/release] stripe error', err instanceof Error ? err.message : err)
        return NextResponse.json(
          { error: 'Libération impossible (empreinte déjà finalisée).' },
          { status: 409 },
        )
      }
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
