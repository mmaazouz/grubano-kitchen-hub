import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'

export const dynamic = 'force-dynamic'

// ── GET /api/marketplace/suppliers — B2B discovery (resto side, Slice 2) ──────
// A restaurateur browses the marketplace: ACTIVE suppliers only + their AVAILABLE
// catalogue items. Operator-gated (restaurant/admin). Distinct from the operator's
// private /api/suppliers directory and from the B2C app. Prices in cents (display
// via format-money). Zone/category filtering is a later refinement.

export async function GET() {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const suppliers = await prisma.supplierProfile.findMany({
      where:  { status: 'active' },
      select: {
        id: true, companyName: true, city: true, categories: true,
        deliveryZones: true, minimumOrderCents: true, leadTimeDays: true,
        catalogItems: {
          where:  { available: true },
          select: { id: true, name: true, description: true, category: true, priceCents: true, unit: true, packSize: true, allergens: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: { companyName: 'asc' },
    })

    return NextResponse.json({ suppliers })
  } catch (err) {
    console.error('[GET /api/marketplace/suppliers]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
