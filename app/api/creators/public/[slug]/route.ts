import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// PUBLIC, read-only, no auth. A dynamic param route is server-rendered on demand.
export const dynamic = 'force-dynamic'

// ── GET /api/creators/public/:slug ────────────────────────────────────────────
// PUBLIC creator profile for the consumer-facing page (/eat/c/[slug], Agent 3).
//
// The slug accepts EITHER referralLinkSlug ("demo20") OR referralCode ("DEMO20")
// — both are @unique. Resolution is case-tolerant (the link slug is lowercase,
// the code is uppercase, so we try the raw value plus its upper/lower variants).
//
// PUBLIC SAFETY: only non-sensitive fields are returned — NEVER the email or any
// internal data. For each approved recipe, `servedAt` lists the restaurants that
// currently serve it (active DishAdoption → brand → operator → restaurant). This
// is the anti-cannibalisation lever: the public page funnels the customer to the
// restaurant that adopted the recipe. READ-ONLY, no migration, never 500.
//
// Data path (verified):
//   Creator → CreatorDish (approved) → DishAdoption (active)
//           → Brand → Operator → Restaurant { id, name, city }
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const raw = decodeURIComponent(params.slug ?? '').trim()
    if (!raw) {
      return NextResponse.json({ error: 'Créateur introuvable' }, { status: 404 })
    }
    // Case-tolerant candidates (raw + upper + lower), de-duplicated.
    const candidates = Array.from(new Set([raw, raw.toUpperCase(), raw.toLowerCase()]))

    const creator = await prisma.creator.findFirst({
      where: {
        OR: [
          { referralLinkSlug: { in: candidates } },
          { referralCode:     { in: candidates } },
        ],
      },
      select: {
        id:               true,
        name:             true,
        bio:              true,
        followers:        true,
        verified:         true,
        instagram:        true,
        tiktok:           true,
        youtube:          true,
        referralCode:     true,
        referralLinkSlug: true,
        // Live recipes only (approved). 'live' tolerated for forward-compat.
        dishes: {
          where:   { status: { in: ['approved', 'live'] } },
          orderBy: { createdAt: 'desc' },
          select: {
            id:          true,
            name:        true,
            description: true,
            photo:       true,
            cuisineType: true,
            adoptions: {
              where:  { status: 'active' },
              select: {
                id:           true,
                menuItemId:   true,
                sellingPrice: true,
                brand: {
                  select: {
                    // Option B (step 4): read the brand's establishment via the
                    // DIRECT Brand.restaurantId link, not the transitive
                    // operator.restaurant path (which is now a list).
                    restaurant: {
                      // lat/lng (nullable) feed the /chef proximity sort — Mission
                      // 1 Creator Studio. null stays null, never coerced to 0.
                      select: { id: true, name: true, city: true, lat: true, lng: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!creator) {
      return NextResponse.json({ error: 'Créateur introuvable' }, { status: 404 })
    }

    // ── Social proof (Mission 1 Creator Studio — VOLUMES ONLY, never € on a
    // public payload). One grouped query over every active adoption of every
    // listed recipe (no N+1): DishSale counts per adoption.
    const adoptionIds = creator.dishes.flatMap(d => d.adoptions.map(a => a.id))
    const salesByAdoption = new Map<string, number>()
    if (adoptionIds.length > 0) {
      try {
        const grouped = await prisma.dishSale.groupBy({
          by:     ['adoptionId'],
          where:  { adoptionId: { in: adoptionIds } },
          _count: { _all: true },
        })
        for (const g of grouped) salesByAdoption.set(g.adoptionId, g._count._all)
      } catch (e) {
        // Degrade to zero counts — the page hides the proof banner then.
        console.error('[GET /api/creators/public/:slug] sales groupBy failed', e instanceof Error ? e.message : e)
      }
    }

    type ServedAt = {
      id:           string
      name:         string
      city:         string
      lat:          number | null
      lng:          number | null
      sellingPrice: number
      menuItemId:   string | null
    }

    const allRestaurantIds = new Set<string>()
    let totalSales = 0

    const recipes = creator.dishes.map(d => {
      // One entry per restaurant (an operator could adopt the same recipe under
      // two brands → same restaurant twice). De-dupe by restaurant id, keep first.
      const seen = new Set<string>()
      const servedAt: ServedAt[] = []
      let salesCount = 0
      for (const a of d.adoptions) {
        salesCount += salesByAdoption.get(a.id) ?? 0
        const r = a.brand?.restaurant
        if (!r || seen.has(r.id)) continue
        seen.add(r.id)
        allRestaurantIds.add(r.id)
        servedAt.push({
          id:           r.id,
          name:         r.name,
          city:         r.city,
          lat:          r.lat ?? null,
          lng:          r.lng ?? null,
          sellingPrice: a.sellingPrice,
          menuItemId:   a.menuItemId,
        })
      }
      totalSales += salesCount
      return {
        id:          d.id,
        name:        d.name,
        description: d.description,
        photo:       d.photo,
        cuisineType: d.cuisineType,
        servedAt,
        // Social proof per recipe (volumes only).
        salesCount,
        restaurantsCount: servedAt.length,
      }
    })

    return NextResponse.json({
      name:         creator.name,
      bio:          creator.bio,
      followers:    creator.followers,
      verified:     creator.verified,
      instagram:    creator.instagram,
      tiktok:       creator.tiktok,
      youtube:      creator.youtube,
      // Kept for the legacy /eat/c reader until its débranchement — the new
      // /chef page deliberately never displays it (pivot créateur/influenceur).
      referralCode: creator.referralCode,
      slug:         creator.referralLinkSlug ?? creator.referralCode,
      recipes,
      // Creator-level social proof aggregates (volumes only).
      totalSales,
      totalRestaurants: allRestaurantIds.size,
    })
  } catch (err) {
    // Never 500: log and degrade to a clean not-found so the page renders.
    console.error('[GET /api/creators/public/:slug]', err)
    return NextResponse.json({ error: 'Créateur introuvable' }, { status: 404 })
  }
}
