import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/eat/promos — restaurants with ≥ 1 ACTIVE promotion (chantier P2).
//
// PUBLIC, read-only, display only — the P1 engine alone decides at checkout.
// One grouped query (window + active + V1 types, archived establishments
// excluded), then grouped per establishment with its BEST promo for display
// (heuristic: highest percent first, else highest fixed — the true « best »
// stays the server's pickBestPromotion on the real basket). Short cache.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const MAX_RESTAURANTS = 50

type PublicPromo = {
  id: string; name: string; type: string; discount: number; minOrderEur: number | null
}

export async function GET() {
  try {
    const now = new Date()
    const rows = await prisma.promotion.findMany({
      where: {
        active:    true,
        startDate: { lte: now },
        endDate:   { gte: now },
        type:      { in: ['percent', 'fixed'] },
        brand:     { restaurant: { archivedAt: null } },
      },
      select: {
        id: true, name: true, type: true, discount: true, conditions: true,
        brand: {
          select: {
            restaurant: {
              select: { id: true, name: true, city: true, coverPhoto: true, logo: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Group per establishment, keep the display-best promo + the count.
    type Entry = {
      id: string; name: string; city: string; photo: string | null
      promo: PublicPromo; promoCount: number
    }
    const byResto = new Map<string, Entry>()
    const better = (a: PublicPromo, b: PublicPromo) => {
      // Display heuristic: any percent beats any fixed; within a type, the
      // bigger figure wins (noted — checkout truth stays pickBestPromotion).
      if (a.type !== b.type) return a.type === 'percent' ? a : b
      return a.discount >= b.discount ? a : b
    }
    for (const r of rows) {
      const resto = r.brand?.restaurant
      if (!resto) continue
      const c = (r.conditions && typeof r.conditions === 'object' && !Array.isArray(r.conditions)
        ? r.conditions : {}) as Record<string, unknown>
      const promo: PublicPromo = {
        id:          r.id,
        name:        r.name,
        type:        r.type,
        discount:    r.discount,
        minOrderEur: typeof c.minOrderEur === 'number' && c.minOrderEur > 0 ? c.minOrderEur : null,
      }
      const existing = byResto.get(resto.id)
      if (existing) {
        existing.promo = better(existing.promo, promo)
        existing.promoCount += 1
      } else if (byResto.size < MAX_RESTAURANTS) {
        byResto.set(resto.id, {
          id:         resto.id,
          name:       resto.name,
          city:       resto.city,
          photo:      resto.coverPhoto ?? resto.logo ?? null,
          promo,
          promoCount: 1,
        })
      }
    }

    // The home banner figure: the REAL max active percent (and best fixed).
    let maxPercent = 0
    let bestFixed  = 0
    for (const r of rows) {
      if (r.type === 'percent') maxPercent = Math.max(maxPercent, r.discount)
      if (r.type === 'fixed')   bestFixed  = Math.max(bestFixed,  r.discount)
    }

    return NextResponse.json(
      {
        restaurants: Array.from(byResto.values()),
        totalPromos: rows.length,
        maxPercent,
        bestFixed,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } },
    )
  } catch (err) {
    console.error('[GET /api/eat/promos]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
