import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createSchema = z.object({
  operatorId: z.string(),
  name:       z.string().min(1).max(80),
  emoji:      z.string().default('🍴'),
  platform:   z.string().default('ubereats'),
})

// ── GET /api/brands?operatorId= ──────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const operatorId = searchParams.get('operatorId')

    const where: Record<string, unknown> = {}
    if (operatorId) where.operatorId = operatorId

    const brands = await prisma.brand.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { orders: true, menuItems: true },
        },
      },
    })

    // Augment with today's revenue
    const today    = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

    const enriched = await Promise.all(brands.map(async (b) => {
      const todayOrders = await prisma.loyaltyOrder.findMany({
        where: {
          brandId:     b.id,
          validatedAt: { gte: today, lt: tomorrow },
        },
      })
      const revenue = todayOrders.reduce((s, o) => s + o.amount, 0)

      return {
        id:          b.id,
        name:        b.name,
        emoji:       b.emoji,
        platform:    b.platform,
        status:      b.status,
        ordersToday: todayOrders.length,
        revenue,
        menuCount:   b._count.menuItems,
      }
    }))

    return NextResponse.json({ brands: enriched })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/brands ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const brand = await prisma.brand.create({ data })

    return NextResponse.json({ brand }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
