import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// ── GET /api/restaurants ──────────────────────────────────────────────────────
// Query params:
//   city     – filter by city (case-insensitive contains)
//   cuisine  – filter by cuisine tag (e.g. "italian")
//   q        – free-text search on name / description
//   sort     – "rating" | "newest" | "delivery"  (default: rating)
//   take     – page size (default 20, max 50)
//   skip     – offset for pagination

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const city    = searchParams.get('city')    ?? undefined
    const cuisine = searchParams.get('cuisine') ?? undefined
    const q       = searchParams.get('q')       ?? undefined
    const sort    = searchParams.get('sort')    ?? 'rating'
    const take    = Math.min(Number(searchParams.get('take') ?? 20), 50)
    const skip    = Number(searchParams.get('skip') ?? 0)

    // Build Prisma where clause
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

    // Determine orderBy
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
        },
      }),
      prisma.restaurant.count({ where }),
    ])

    // Post-query cuisine filter (JSON array stored as text in MySQL)
    const filtered = cuisine
      ? restaurants.filter(r => {
          const tags = r.cuisine as string[]
          return Array.isArray(tags) && tags.some(t =>
            t.toLowerCase().includes(cuisine.toLowerCase()),
          )
        })
      : restaurants

    return NextResponse.json({
      restaurants: filtered,
      total,
      take,
      skip,
    })
  } catch (err) {
    console.error('[GET /api/restaurants]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
