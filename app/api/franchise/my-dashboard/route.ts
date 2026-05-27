import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const ROYALTY_RATES: Record<string, number> = {
  'Gnocchi Bar':  0.06,
  'Riz Gourmand': 0.05,
  'Pasta Fresca': 0.05,
  'Rollix':       0.07,
  'Bowl Healthy': 0.05,
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operatorId = (session.user as { id?: string }).id!

    const now              = new Date()
    const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

    const brands = await prisma.brand.findMany({
      where: { operatorId },
      include: {
        orders: {
          where: { validatedAt: { gte: startOfMonth } },
        },
        menuItems: {
          orderBy: { isPopular: 'desc' },
          take: 3,
          select: { name: true },
        },
      },
    })

    const lastMonthOrders = await prisma.loyaltyOrder.findMany({
      where: {
        brand:      { operatorId },
        validatedAt: { gte: startOfLastMonth, lte: endOfLastMonth },
      },
    })

    const revenueThisMonth = brands.reduce((s, b) => s + b.orders.reduce((bs, o) => bs + o.amount, 0), 0)
    const revenueLastMonth = lastMonthOrders.reduce((s, o) => s + o.amount, 0)
    const royaltiesDue     = brands.reduce((s, b) => {
      const rate = ROYALTY_RATES[b.name] ?? 0.06
      const rev  = b.orders.reduce((bs, o) => bs + o.amount, 0)
      return s + rev * rate
    }, 0)

    const brandsPerf = brands.map(b => ({
      id:        b.id,
      name:      b.name,
      emoji:     b.emoji,
      revenue:   b.orders.reduce((s, o) => s + o.amount, 0),
      orders:    b.orders.length,
      royalties: b.orders.reduce((s, o) => s + o.amount, 0) * (ROYALTY_RATES[b.name] ?? 0.06),
      topDishes: b.menuItems.map(m => m.name),
    }))

    return NextResponse.json({
      revenueThisMonth,
      revenueLastMonth,
      royaltiesDue,
      networkAvg: 7800,
      brands: brandsPerf,
    })
  } catch (err) {
    console.error('[GET /api/franchise/my-dashboard]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
