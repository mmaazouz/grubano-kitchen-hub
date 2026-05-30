import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { geocodeAddress, haversineKm } from '@/lib/geocode'

// ── GET /api/restaurants ──────────────────────────────────────────────────────
// Query params:
//   city     – filter by city (case-insensitive contains)
//   cuisine  – filter by cuisine tag (e.g. "italian")
//   q        – free-text search on name / description
//   sort     – "rating" | "newest" | "delivery"  (default: rating)
//   take     – page size (default 20, max 50)
//   skip     – offset for pagination
//
//   ── Discovery v1 (geo) ───────────────────────────────────────────────────
//   lat, lng – consumer position. When provided we sort by distance and
//              expand the search radius until at least 8 results are found:
//                tiers = [5, 10, 25, 50, Infinity] km
//   category – cuisine tag filter applied BEFORE radius expansion. If the
//              filter yields zero hits even at infinity, we fall back to
//              nearest-of-any-category and set categoryHadNoMatch: true so
//              the frontend can show a "Pas de X près de vous, voici…" hint.
//   limit    – hard cap on returned rows (default 24, max 60)
//
// At 10k+ restaurants, move the distance calculation to SQL
// (MySQL ST_Distance_Sphere or a PostGIS index). Fetching all active
// restaurants and computing in memory is fine at our current scale.

export const dynamic = 'force-dynamic'

const RADIUS_TIERS_KM = [5, 10, 25, 50, Infinity] as const
const TARGET_RESULT_COUNT = 8

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const city    = searchParams.get('city')    ?? undefined
    const cuisine = searchParams.get('cuisine') ?? undefined
    // Accept both ?cuisine= and ?category= for the geo path (task aliases them).
    const category = searchParams.get('category') ?? cuisine
    const q       = searchParams.get('q')       ?? undefined
    const sort    = searchParams.get('sort')    ?? 'rating'
    const take    = Math.min(Number(searchParams.get('take') ?? 20), 50)
    const skip    = Number(searchParams.get('skip') ?? 0)

    // ── Geo params ────────────────────────────────────────────────────────
    const latParam = searchParams.get('lat')
    const lngParam = searchParams.get('lng')
    const hasGeo   = latParam !== null && lngParam !== null
    const userLat  = hasGeo ? Number(latParam) : null
    const userLng  = hasGeo ? Number(lngParam) : null
    const geoValid = hasGeo
      && userLat !== null && userLng !== null
      && Number.isFinite(userLat) && Number.isFinite(userLng)
    const limit = Math.min(Number(searchParams.get('limit') ?? 24), 60)

    // ── Branch 1 — geo-aware Discovery v1 ────────────────────────────────
    if (geoValid) {
      // Fetch ALL active restaurants with coords. We accept restaurants
      // without coords later in the fallback.
      const all = await prisma.restaurant.findMany({
        where: { isActive: true },
        select: {
          id:           true,
          name:         true,
          coverPhoto:   true,
          logo:         true,
          cuisine:      true,
          rating:       true,
          reviewCount:  true,
          deliveryTime: true,
          minOrder:     true,
          deliveryFee:  true,
          city:         true,
          address:      true,
          isActive:     true,
          lat:          true,
          lng:          true,
        },
      })

      // Attach distanceKm (null when the row has no coords).
      type R = (typeof all)[number] & { distanceKm: number | null }
      const withDistance: R[] = all.map(r => {
        if (r.lat == null || r.lng == null) {
          return { ...r, distanceKm: null }
        }
        const km = haversineKm(
          { latitude: userLat!, longitude: userLng! },
          { latitude: r.lat,    longitude: r.lng    },
        )
        return { ...r, distanceKm: Math.round(km * 10) / 10 }
      })

      // Helper — filter by cuisine tag (JSON array in MySQL).
      const matchesCategory = (r: R, tag: string) => {
        const tags = r.cuisine as unknown
        return Array.isArray(tags) && tags.some(t =>
          typeof t === 'string' && t.toLowerCase().includes(tag.toLowerCase()),
        )
      }

      // Step 1 — apply category filter if any.
      const categoryFiltered = category
        ? withDistance.filter(r => matchesCategory(r, category))
        : withDistance

      // Step 2 — sort by distance, drop coord-less rows for the radius walk.
      const sortByDistance = (rows: R[]) =>
        rows
          .filter(r => r.distanceKm !== null)
          .sort((a, b) => (a.distanceKm! - b.distanceKm!))

      // Step 3 — radius expansion: walk tiers until ≥ 8 hits.
      let radiusUsedKm: number | null = null
      let chosen: R[] = []
      for (const tier of RADIUS_TIERS_KM) {
        const inTier = sortByDistance(categoryFiltered)
          .filter(r => r.distanceKm! <= tier)
        if (inTier.length >= TARGET_RESULT_COUNT || tier === Infinity) {
          chosen = inTier
          radiusUsedKm = tier === Infinity ? null : tier
          break
        }
      }

      // Step 4 — category fallback. If the category filter killed everything
      // (even at infinity), return nearest-of-any-category instead.
      let categoryHadNoMatch = false
      if (category && chosen.length === 0) {
        categoryHadNoMatch = true
        chosen = sortByDistance(withDistance)
        radiusUsedKm = null
      }

      return NextResponse.json({
        restaurants: chosen.slice(0, limit),
        total:        chosen.length,
        radiusUsedKm,                         // null = no radius cap (Infinity)
        categoryHadNoMatch,                   // true = we widened past category
        userLocation: { lat: userLat, lng: userLng },
      })
    }

    // ── Branch 2 — legacy (no geo) ───────────────────────────────────────
    // Preserves the pre-Discovery behaviour for callers that don't send lat/lng.
    const where: Prisma.RestaurantWhereInput = {
      isActive: true,
    }

    if (city) {
      where.city = { contains: city }
    }

    if (q) {
      where.OR = [
        { name:        { contains: q } },
        { description: { contains: q } },
        { city:        { contains: q } },
      ]
    }

    const orderBy: Prisma.RestaurantOrderByWithRelationInput =
      sort === 'delivery' ? { deliveryTime: 'asc' }
      : sort === 'newest' ? { createdAt: 'desc' }
      : { rating: 'desc' }

    const [restaurants, total] = await Promise.all([
      prisma.restaurant.findMany({
        where,
        orderBy,
        take,
        skip,
        select: {
          id:           true,
          name:         true,
          coverPhoto:   true,
          logo:         true,
          cuisine:      true,
          rating:       true,
          reviewCount:  true,
          deliveryTime: true,
          minOrder:     true,
          deliveryFee:  true,
          city:         true,
          address:      true,
          isActive:     true,
          lat:          true,
          lng:          true,
        },
      }),
      prisma.restaurant.count({ where }),
    ])

    const filtered = category
      ? restaurants.filter(r => {
          const tags = r.cuisine as unknown
          return Array.isArray(tags) && tags.some(t =>
            typeof t === 'string' && t.toLowerCase().includes(category.toLowerCase()),
          )
        })
      : restaurants

    return NextResponse.json({
      restaurants: filtered.map(r => ({ ...r, distanceKm: null })),
      total,
      take,
      skip,
    })
  } catch (err) {
    console.error('[GET /api/restaurants]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/restaurants ─────────────────────────────────────────────────────
// Operator creates their own restaurant profile (one per operator — the
// Restaurant.operatorId column is @unique). The address is geocoded server-side
// via the BAN; on failure we save the row with null coords so the operator
// isn't blocked, and the backfill script can resolve later.

const CreateInput = z.object({
  name:         z.string().min(1).max(120),
  description:  z.string().max(2000).optional().nullable(),
  cuisine:      z.array(z.string()).default([]),
  city:         z.string().min(1).max(100),
  address:      z.string().min(1).max(300),
  postalCode:   z.string().max(12).optional(),
  coverPhoto:   z.string().url().optional().nullable(),
  logo:         z.string().url().optional().nullable(),
  deliveryTime: z.number().int().min(0).max(180).optional(),
  minOrder:     z.number().min(0).max(500).optional(),
  deliveryFee:  z.number().min(0).max(50).optional(),
})

export async function POST(req: Request) {
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

    const json   = await req.json().catch(() => ({}))
    const parsed = CreateInput.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { postalCode, ...input } = parsed.data

    // Reject duplicate (Restaurant.operatorId is @unique).
    const existing = await prisma.restaurant.findUnique({
      where:  { operatorId: operator.id },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Vous avez déjà un restaurant. Utilisez PATCH pour le mettre à jour.' },
        { status: 409 },
      )
    }

    // Geocode (soft-fail — null coords are OK).
    const coords = await geocodeAddress(input.address, input.city, postalCode)

    const restaurant = await prisma.restaurant.create({
      data: {
        ...input,
        operatorId: operator.id,
        lat:        coords?.latitude  ?? null,
        lng:        coords?.longitude ?? null,
      },
    })

    return NextResponse.json({ restaurant, geocoded: coords !== null }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/restaurants]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
