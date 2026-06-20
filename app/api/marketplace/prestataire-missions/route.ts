import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireEnabled } from '@/lib/prestataire-account'

export const dynamic = 'force-dynamic'

// ── /api/marketplace/prestataire-missions — request + list service missions (resto) ──
// CLONE of /api/marketplace/orders adapted to the SERVICE quote cycle. POST: a restaurateur
// REQUESTS a quote from a prestataire (a ServiceMission in status 'requested'). GET: the
// resto's own missions. restaurantOperatorId is the SESSION operator (never the body). The
// target prestataire must be ACTIVE; an optional serviceOfferingId must belong to it. 404
// when PRESTATAIRE_ENABLED is OFF. NO money — the quote amount is set later by the
// prestataire and is pure data (no charge / commission / payout here).

const NOT_FOUND = NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET() {
  if (!isPrestataireEnabled()) return NOT_FOUND
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const missions = await prisma.serviceMission.findMany({
    where:   { restaurantOperatorId: operator.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, requestDetails: true,
      quoteAmountCents: true, quoteDescription: true, proposedDate: true, scheduledDate: true, createdAt: true,
      prestataireProfile: { select: { id: true, companyName: true, city: true } },
      serviceOffering:    { select: { id: true, title: true, category: true } },
      // P5 (Agent 78) — the existing review (if any), so the « Laisser un avis » button only
      // shows on 'done' missions not yet reviewed. Additive read of the 1:1 back-relation.
      review:             { select: { id: true, rating: true } },
    },
  })
  return NextResponse.json({ missions })
}

const requestSchema = z.object({
  prestataireProfileId: z.string().min(1, 'Prestataire requis'),
  serviceOfferingId:    z.string().min(1).nullish(),
  requestDetails:       z.string().trim().min(1, 'Décrivez votre besoin').max(2000),
})

export async function POST(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data = requestSchema.parse(await req.json())

    // The target prestataire must exist AND be active (discovery only shows active).
    const prestataire = await prisma.prestataireProfile.findUnique({
      where: { id: data.prestataireProfileId }, select: { id: true, status: true },
    })
    if (!prestataire || prestataire.status !== 'active') {
      return NextResponse.json({ error: 'Prestataire indisponible' }, { status: 400 })
    }

    // If an offering is referenced, it must belong to that prestataire AND be active.
    if (data.serviceOfferingId) {
      const offering = await prisma.serviceOffering.findUnique({
        where: { id: data.serviceOfferingId }, select: { prestataireProfileId: true, active: true },
      })
      if (!offering || offering.prestataireProfileId !== prestataire.id || !offering.active) {
        return NextResponse.json({ error: 'Service invalide' }, { status: 400 })
      }
    }

    const mission = await prisma.serviceMission.create({
      data: {
        restaurantOperatorId: operator.id, // ← from the SESSION, never the body
        prestataireProfileId: prestataire.id,
        serviceOfferingId:    data.serviceOfferingId ?? null,
        requestDetails:       data.requestDetails,
        status:               'requested',
      },
      select: { id: true, status: true },
    })
    return NextResponse.json({ mission }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/marketplace/prestataire-missions]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
