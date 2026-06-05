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
                menuItemId:   true,
                sellingPrice: true,
                brand: {
                  select: {
                    // Option B (step 4): read the brand's establishment via the
                    // DIRECT Brand.restaurantId link, not the transitive
                    // operator.restaurant path (which is now a list).
                    restaurant: {
                      select: { id: true, name: true, city: true },
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

    type ServedAt = {
      id:           string
      name:         string
      city:         string
      sellingPrice: number
      menuItemId:   string | null
    }

    const recipes = creator.dishes.map(d => {
      // One entry per restaurant (an operator could adopt the same recipe under
      // two brands → same restaurant twice). De-dupe by restaurant id, keep first.
      const seen = new Set<string>()
      const servedAt: ServedAt[] = []
      for (const a of d.adoptions) {
        const r = a.brand?.restaurant
        if (!r || seen.has(r.id)) continue
        seen.add(r.id)
        servedAt.push({
          id:           r.id,
          name:         r.name,
          city:         r.city,
          sellingPrice: a.sellingPrice,
          menuItemId:   a.menuItemId,
        })
      }
      return {
        id:          d.id,
        name:        d.name,
        description: d.description,
        photo:       d.photo,
        cuisineType: d.cuisineType,
        servedAt,
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
      referralCode: creator.referralCode,
      slug:         creator.referralLinkSlug ?? creator.referralCode,
      recipes,
    })
  } catch (err) {
    // Never 500: log and degrade to a clean not-found so the page renders.
    console.error('[GET /api/creators/public/:slug]', err)
    return NextResponse.json({ error: 'Créateur introuvable' }, { status: 404 })
  }
}
