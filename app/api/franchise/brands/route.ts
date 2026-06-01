import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Default royalty rate used when a Brand has no royaltyPct set
const DEFAULT_ROYALTY_RATE = 0.06

export async function GET() {
  try {
    const dbBrands = await prisma.brand.findMany({
      where:   { openToFranchise: true },
      include: {
        menuItems:    { take: 4, select: { name: true } },
        pointsOfSale: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const brands = dbBrands.map(b => ({
      id:          b.id,
      name:        b.name,
      cuisine:     b.cuisineType          ?? '',
      emoji:       b.emoji,                         // String @default("🍴") — always present
      description: b.tagline              ?? '',
      avgRevenue:  b.avgMonthlyRevenue    ?? 0,
      setupCost:   b.setupFee             ?? 0,
      royaltyRate: b.royaltyPct           ?? DEFAULT_ROYALTY_RATE,
      citiesAvail: (Array.isArray(b.franchiseZones) ? b.franchiseZones : []) as string[],
      available:   b.franchiseStatus !== 'full',
      topDishes:   b.menuItems.map(m => m.name),
    }))

    return NextResponse.json({ brands })
  } catch (err) {
    console.error('[GET /api/franchise/brands]', err)
    return NextResponse.json({ brands: [] }, { status: 500 })
  }
}
