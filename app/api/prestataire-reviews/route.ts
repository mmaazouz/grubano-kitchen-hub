import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { RATING_MIN, RATING_MAX, computeAverage } from '@/lib/service-review'

export const dynamic = 'force-dynamic'

// ── /api/prestataire-reviews — restaurant reviews of a prestataire (P5, Agent 78) ──
// POST: a RESTAURANT rates a prestataire AFTER one of ITS missions is 'done'. ANTI-FRAUD:
// the review is bound to that ServiceMission, the author MUST own it (restaurantOperatorId
// == session), the mission MUST be 'done', and there can be only ONE review per mission
// (DB @unique + a pre-check). GET: the reviews + average for a prestataire (for the fiche).
// Operator-gated (restaurant/admin), calqued on the discovery route. 404 when
// PRESTATAIRE_ENABLED is OFF. NO money — a review has no amount / charge / payout concept.

const NOT_FOUND = NextResponse.json({ error: 'Not found' }, { status: 404 })

const postSchema = z.object({
  serviceMissionId: z.string().min(1, 'Mission requise'),
  rating:           z.number().int().min(RATING_MIN).max(RATING_MAX),
  comment:          z.string().max(2000).nullish(),
})

export async function GET(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const prestataireProfileId = new URL(req.url).searchParams.get('prestataireProfileId')
  if (!prestataireProfileId) return NextResponse.json({ error: 'prestataireProfileId requis' }, { status: 400 })

  const reviews = await prisma.serviceReview.findMany({
    where:   { prestataireProfileId },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, rating: true, comment: true, createdAt: true },
  })
  const { average, count } = computeAverage(reviews.map((r) => r.rating))
  return NextResponse.json({ average, count, reviews })
}

export async function POST(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data = postSchema.parse(await req.json())

    // ANTI-FRAUD: the mission must exist, be OWNED by the caller, and be 'done'.
    const mission = await prisma.serviceMission.findUnique({
      where:  { id: data.serviceMissionId },
      select: { id: true, status: true, restaurantOperatorId: true, prestataireProfileId: true },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    if (mission.restaurantOperatorId !== operator.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    if (mission.status !== 'done') {
      return NextResponse.json({ error: 'La mission doit être réalisée pour être évaluée' }, { status: 409 })
    }

    const review = await prisma.serviceReview.create({
      data: {
        serviceMissionId:     mission.id,
        restaurantOperatorId: operator.id,                  // ← session author, never the body
        prestataireProfileId: mission.prestataireProfileId, // ← from the mission, never the body
        rating:               data.rating,
        comment:              data.comment?.trim() || null,
      },
      select: { id: true, rating: true },
    })
    return NextResponse.json({ review }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    // @unique(serviceMissionId) → a second review on the same mission is impossible.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Cette mission a déjà été évaluée' }, { status: 409 })
    }
    console.error('[POST /api/prestataire-reviews]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
