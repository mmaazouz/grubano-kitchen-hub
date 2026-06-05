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
 *     → 200 { ok, role, status, hasBrand, hasRestaurant, needsOnboarding }
 *
 * `needsOnboarding` is true when a freshly-verified partner (role=restaurant)
 * has not yet created a Brand. /business/auth uses it to send a first-time
 * partner to /business/onboarding instead of /dashboard; the onboarding page
 * itself uses it to bounce an already-onboarded partner straight to their
 * dashboard. READ-only, no DB write.
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

    // Cheap existence checks. We only need to know "any" / "none".
    const [brand, restaurant] = await Promise.all([
      prisma.brand.findFirst({ where: { operatorId: operator.id }, select: { id: true } }),
      prisma.restaurant.findUnique({ where: { operatorId: operator.id }, select: { id: true } }),
    ])

    const hasBrand      = brand !== null
    const hasRestaurant = restaurant !== null
    // Only restaurant accounts have an onboarding flow; admins skip it entirely.
    const needsOnboarding = operator.role === 'restaurant' && !hasBrand

    return NextResponse.json({
      ok: true,
      role:            operator.role,
      status:          operator.status,
      hasBrand,
      hasRestaurant,
      needsOnboarding,
    })
  } catch (err) {
    console.error('[GET /api/business/me]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
