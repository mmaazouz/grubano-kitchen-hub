import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// ── GET /api/restaurants/[id]/invoices ────────────────────────────────────────
// Rail A4. The establishment lists ITS commission invoices (owner-or-admin gate,
// same shape as fulfillment/connect). Newest first.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(restaurantId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { id: true, operatorId: true, name: true, address: true, city: true },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }
  if (restaurant.operatorId !== operator.id && operator.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }
  return { restaurant }
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error

    const invoices = await prisma.invoice.findMany({
      where:   { restaurantId: params.id },
      orderBy: { periodStart: 'desc' },
      select: {
        id: true, number: true, periodStart: true, periodEnd: true,
        totalHt: true, totalTva: true, totalTtc: true,
        entriesCount: true, status: true, issuedAt: true,
      },
    })
    return NextResponse.json({ invoices })
  } catch (err) {
    console.error('[invoices list]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
