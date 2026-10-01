import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { canTransitionMission } from '@/lib/service-mission'

export const dynamic = 'force-dynamic'

// ── PATCH /api/marketplace/prestataire-missions/[id] — resto status change (P3) ──
// CLONE of /api/marketplace/orders/[id]. The RESTAURANT (buyer) ACCEPTS / DECLINES a QUOTED
// mission, or CANCELS a still-REQUESTED one — only on ITS OWN missions (session + ownership),
// and only via VALID transitions (lib/service-mission RESTAURANT_TRANSITIONS). On accept,
// scheduledDate is posed (the resto's value, else the prestataire's proposedDate — the REAL
// calendar is P4). 404 when PRESTATAIRE_ENABLED is OFF. NO money moves.

const bodySchema = z.object({
  status:        z.enum(['accepted', 'declined', 'cancelled']),
  scheduledDate: z.string().datetime().nullish(),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data = bodySchema.parse(await req.json())

    const mission = await prisma.serviceMission.findUnique({
      where: { id: params.id }, select: { restaurantOperatorId: true, status: true, proposedDate: true },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    if (mission.restaurantOperatorId !== operator.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    if (!canTransitionMission('restaurant', mission.status, data.status)) {
      return NextResponse.json({ error: 'Transition invalide' }, { status: 409 })
    }

    const patch: { status: string; scheduledDate?: Date | null } = { status: data.status }
    if (data.status === 'accepted') {
      // Pose the agreed date: the resto's chosen date, else the prestataire's proposed one.
      patch.scheduledDate = data.scheduledDate ? new Date(data.scheduledDate) : mission.proposedDate
    }

    const updated = await prisma.serviceMission.update({
      where: { id: params.id }, data: patch, select: { id: true, status: true, scheduledDate: true },
    })
    return NextResponse.json({ ok: true, mission: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/marketplace/prestataire-missions/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
