import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isFranchiseEnabled } from '@/lib/franchise-account'

// Default royalty rate used when a Brand has no royaltyPct set
const DEFAULT_ROYALTY_RATE = 0.06

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
