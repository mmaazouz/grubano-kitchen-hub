import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { round2 } from '@/lib/ticket'

export const dynamic = 'force-dynamic'

// ── GET /api/tickets/menu ─────────────────────────────────────────────────────
// Owner-scoped. The current establishment's available menu items (id, name,
// price) for the addition picker. Static "menu" segment beside [id] — no conflict.
export async function GET() {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if (!scope.restaurantId) return NextResponse.json({ items: [] })

    const brands = await prisma.brand.findMany({
      where:  { restaurantId: scope.restaurantId },
      select: { id: true },
    })
    const brandIds = brands.map(b => b.id)
    if (brandIds.length === 0) return NextResponse.json({ items: [] })

    const items = await prisma.menuItem.findMany({
      where:   { brandId: { in: brandIds }, available: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select:  { id: true, name: true, price: true, category: true },
    })
    return NextResponse.json({
      items: items.map(i => ({ id: i.id, name: i.name, price: round2(i.price), category: i.category })),
    })
  } catch (err) {
    console.error('[GET /api/tickets/menu]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
