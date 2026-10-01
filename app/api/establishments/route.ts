import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'

// ── GET /api/establishments ───────────────────────────────────────────────────
// Owner-scoped list of the caller's own establishments (oldest first) plus the
// currently-selected one (resolved from the durable cookie, falling back to the
// oldest). Used by client pages that need the operator's establishments without
// the public Restaurant discovery endpoint (which only returns active rows).

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const restaurants = await prisma.restaurant.findMany({
      where:   { operatorId: operator.id, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select:  { id: true, name: true, city: true, isActive: true },
    })

    const current = pickEstablishment(restaurants, cookies().get(ESTABLISHMENT_COOKIE)?.value)

    return NextResponse.json({
      establishments: restaurants,
      currentId:      current?.id ?? null,
    })
  } catch (err) {
    console.error('[GET /api/establishments]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
