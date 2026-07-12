import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Reading session → never statically prerendered.
export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

// Roles allowed to see an operator's brands + performance.
const ALLOWED_ROLES = new Set(['restaurant', 'admin'])

type BrandSummary = {
  id:               string
  name:             string
  emoji:            string
  platform:         string
  status:           string
  // Option B: which establishment this brand belongs to (Brand.restaurantId,
  // direct link added in step 1, backfilled in step 2). Exposed so the
  // establishment hub (/dashboard/establishments/[id]) can scope brands by
  // restaurantId. null when the brand is not (yet) attached to a restaurant.
  restaurantId:     string | null
  menuCount:        number
  adoptedDishCount: number
}

type Performance = {
  windowDays:  number
  caBrut:      number
  ordersTotal: number
}

// ── GET /api/brands/summary ───────────────────────────────────────────────────
// The connected operator's REAL brands + an operator-level performance block.
//
// HONESTY CONSTRAINT (verified): there is NO reliable Order↔Brand link — Order
// carries restaurantId + items (JSON) but no brandId, Restaurant has no brandId,
// and Brand.orders points at LoyaltyOrder (loyalty points), NOT the real Order
// rows. So we DO NOT fabricate a per-brand CA by digging through item JSON (it
// would be wrong for multi-brand baskets). Per-brand we only return what we can
// state reliably (menu count, adopted creator-dish count); the CA is reported at
// the OPERATOR level ("toutes marques confondues"), using the SAME 30-day window
// and the SAME Σ Order.subtotal source as /api/finance/summary so the figures
// line up across pages.
//
// READ-ONLY: no write, no migration. Never 500s — degrades to safe defaults.
export async function GET() {
  const empty: { brands: BrandSummary[]; performance: Performance } = {
    brands: [],
    performance: { windowDays: 30, caBrut: 0, ordersTotal: 0 },
  }

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const role = (session.user as { role?: string }).role
    if (!role || !ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const operatorId = (session.user as { id?: string }).id
    if (!operatorId) {
      return NextResponse.json(empty)
    }

    // ── The operator's real brands ──────────────────────────────────────────
    const brands = await prisma.brand.findMany({
      where:   { operatorId },
      orderBy: { name: 'asc' },
      select: {
        id:           true,
        name:         true,
        emoji:        true,
        platform:     true,
        status:       true,
        restaurantId: true,
        _count:       { select: { menuItems: true } },
      },
    })

    // Active adopted creator dishes, counted per brand in ONE round-trip.
    // (Filtered relation counts in _count are still preview in Prisma 5.x, so a
    // groupBy keeps it stable.) Only status === 'active' adoptions count.
    const brandIds = brands.map(b => b.id)
    const adoptionCounts = brandIds.length
      ? await prisma.dishAdoption.groupBy({
          by:    ['brandId'],
          where: { brandId: { in: brandIds }, status: 'active' },
          _count: { _all: true },
        })
      : []
    const adoptedByBrand = new Map<string, number>(
      adoptionCounts.map(a => [a.brandId, a._count._all]),
    )

    const brandSummaries: BrandSummary[] = brands.map(b => ({
      id:               b.id,
      name:             b.name,
      emoji:            b.emoji,
      platform:         b.platform,
      status:           b.status,
      restaurantId:     b.restaurantId,
      menuCount:        b._count.menuItems,
      adoptedDishCount: adoptedByBrand.get(b.id) ?? 0,
    }))

    // ── Operator-level performance (NOT split per brand) ──────────────────────
    // Same 30-day rolling window + same Σ Order.subtotal source as
    // /api/finance/summary, so "Performance globale" agrees with the Finance page.
    const now         = new Date()
    const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const restaurants = await prisma.restaurant.findMany({
      where:  { operatorId, archivedAt: null },
      select: { id: true },
    })
    const restaurantIds = restaurants.map(r => r.id)

    let caBrut      = 0
    let ordersTotal = 0
    if (restaurantIds.length > 0) {
      const orders = await prisma.order.findMany({
        where: {
          restaurantId: { in: restaurantIds },
          createdAt:    { gte: windowStart },
          // Ghost-orders fix: unpaid/abandoned card checkouts never count.
          status:       { notIn: ['cancelled', 'awaiting_payment', 'expired'] },
        },
        select: { subtotal: true },
      })
      ordersTotal = orders.length
      caBrut      = round2(orders.reduce((s, o) => s + o.subtotal, 0))
    }

    return NextResponse.json({
      brands: brandSummaries,
      performance: { windowDays: 30, caBrut, ordersTotal },
    })
  } catch (err) {
    // Never 500 the page: log and degrade to safe defaults.
    console.error('[GET /api/brands/summary]', err)
    return NextResponse.json(empty)
  }
}
