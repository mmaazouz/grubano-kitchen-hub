import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const userEmail = session.user.email!

    const creator = await prisma.creator.findUnique({
      where: { email: userEmail },
      include: { dishes: { orderBy: { createdAt: 'desc' } } },
    })

    if (!creator) {
      return NextResponse.json({ creator: null, dishes: [], totalEarnings: 0, totalSales: 0, adoptions: 0 })
    }

    const dishes = creator.dishes.map(d => ({
      id:             d.id,
      name:           d.name,
      description:    d.description,
      cuisineType:    d.cuisineType,
      suggestedPrice: d.suggestedPrice,
      status:         d.status,
      adoptions:      (d.adoptedBy as string[]).length,
      totalSales:     d.totalSales,
      earnings:       Number((d.totalSales * d.suggestedPrice * d.commission).toFixed(2)),
    }))

    return NextResponse.json({
      creator: {
        id:            creator.id,
        name:          creator.name,
        verified:      creator.verified,
        totalEarnings: creator.totalEarnings,
        instagram:     creator.instagram,
        tiktok:        creator.tiktok,
        youtube:       creator.youtube,
        followers:     creator.followers,
      },
      dishes,
      totalEarnings: dishes.reduce((s, d) => s + d.earnings, 0),
      totalSales:    dishes.reduce((s, d) => s + d.totalSales, 0),
      adoptions:     dishes.reduce((s, d) => s + d.adoptions, 0),
    })
  } catch (err) {
    console.error('[GET /api/creators/my-dishes]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
