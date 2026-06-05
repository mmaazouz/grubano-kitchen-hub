import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Tiny gate endpoint for the partner-onboarding flow.
 *
 *   GET /api/business/me
 *     → 401 if not signed in
 *     → 200 { ok, role, status, hasBrand, hasRestaurant, needsOnboarding, brand }
 *
 * `needsOnboarding` is true for a restaurant partner who has not yet finished
 * onboarding — i.e. is missing EITHER the Brand OR the Restaurant. This lets a
 * partner who quit mid-flow (brand created, restaurant not) RESUME at the right
 * step instead of landing on an empty dashboard.
 *
 * `brand` (when present) carries the existing brand's fields so the onboarding
 * page can resume at step 2 with the cuisine pre-filled. READ-only, no write.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
    }

    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true, status: true },
    })
    if (!operator) {
      return NextResponse.json({ ok: false, error: 'Utilisateur introuvable' }, { status: 401 })
    }

    // Existing brand (first one) + whether a restaurant row exists.
    const [brand, restaurant] = await Promise.all([
      prisma.brand.findFirst({
        where:   { operatorId: operator.id },
        orderBy: { createdAt: 'asc' },
        select:  { id: true, name: true, emoji: true, cuisineType: true },
      }),
      prisma.restaurant.findFirst({ where: { operatorId: operator.id }, select: { id: true } }),
    ])

    const hasBrand      = brand !== null
    const hasRestaurant = restaurant !== null
    // A restaurant partner is "still onboarding" until BOTH the brand and the
    // restaurant exist. Other roles never onboard through this flow.
    const needsOnboarding =
      operator.role === 'restaurant' && (!hasBrand || !hasRestaurant)

    return NextResponse.json({
      ok: true,
      role:            operator.role,
      status:          operator.status,
      hasBrand,
      hasRestaurant,
      needsOnboarding,
      brand, // null when none — used to resume + pre-fill onboarding step 2
    })
  } catch (err) {
    console.error('[GET /api/business/me]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
