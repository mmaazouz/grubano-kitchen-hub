import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { releaseHold } from '@/lib/deposit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/reservations/[id]/deposit/release ───────────────────────────────
// ARRIVAL: cancel the authorisation — nothing is charged. Owner-scoped. Uses the
// shared releaseHold() (Stripe = source of truth: reads the live PI, acts on its
// real status, never on the stored depositStatus). Sets depositStatus=released,
// status=arrived. The same settle now also runs on PATCH status='arrived'.
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

    const settle = await releaseHold(reservation.stripePaymentIntentId)
    if (!settle.ok) return NextResponse.json({ error: settle.error }, { status: settle.status })

    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { depositStatus: settle.depositStatus ?? 'released', status: 'arrived' },
    })
    return NextResponse.json({ depositStatus: settle.depositStatus ?? 'released', status: 'arrived' })
  } catch (err) {
    console.error('[POST deposit/release]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
