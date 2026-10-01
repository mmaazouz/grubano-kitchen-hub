import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isCreatorEnabled } from '@/lib/creator-account'

const FALLBACK = [
  { rank: 1, name: 'Amina K.',   dishes: 8, totalSales: 1240, earnings: 2480 },
  { rank: 2, name: 'Karim B.',   dishes: 5, totalSales: 980,  earnings: 1960 },
  { rank: 3, name: 'Sofia L.',   dishes: 4, totalSales: 640,  earnings: 1280 },
  { rank: 4, name: 'Yann D.',    dishes: 3, totalSales: 420,  earnings: 840  },
  { rank: 5, name: 'Leila M.',   dishes: 2, totalSales: 280,  earnings: 560  },
]

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const creators = await prisma.creator.findMany({
      include: {
        dishes: {
          where:  { status: { in: ['approved', 'live'] } },
          select: { totalSales: true, suggestedPrice: true, commission: true },
        },
      },
      orderBy: { totalEarnings: 'desc' },
      take: 5,
    })

    if (creators.length === 0) {
      return NextResponse.json({ leaderboard: FALLBACK })
    }

    const leaderboard = creators.map((c, i) => ({
      rank:       i + 1,
      name:       c.name,
      dishes:     c.dishes.length,
      totalSales: c.dishes.reduce((s, d) => s + d.totalSales, 0),
      earnings:   Number(c.totalEarnings.toFixed(2)),
    }))

    return NextResponse.json({ leaderboard })
  } catch (err) {
    console.error('[GET /api/creators/leaderboard]', err)
    return NextResponse.json({ leaderboard: FALLBACK })
  }
}
