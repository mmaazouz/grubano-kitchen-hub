import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'

// Owner-scoped create schema. `operatorId` is NEVER read from the body — it is
// always forced from the authenticated session. Fixes the privilege-escalation
// reported in the Agent 12 audit (point 3): previously anyone could POST a
// brand for any operatorId. `cuisineType` is part of the partner-onboarding
// payload (already on the Brand model).
const createSchema = z.object({
  name:        z.string().min(1).max(80),
  emoji:       z.string().min(1).max(8).default('🍴'),
  platform:    z.string().min(1).max(40).default('ubereats'),
  cuisineType: z.string().max(60).optional().nullable(),
})

/** Resolve the calling operator from the session — null on any failure. */
async function callerOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true, status: true },
  })
}

// ── GET /api/brands?operatorId= ──────────────────────────────────────────────
// READ: scope to the caller's own operatorId unless the caller is admin. An
// anonymous request still gets 401, even on GET — partner data is private.

export async function GET(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const requestedOperatorId = searchParams.get('operatorId')
    const isAdmin = operator.role === 'admin'

    // A non-admin can only ever see their own brands, regardless of what they
    // ask for. Admin sees the requested filter, or everything if omitted.
    const effectiveOperatorId = isAdmin ? (requestedOperatorId ?? undefined) : operator.id

    const where: { operatorId?: string } = {}
    if (effectiveOperatorId) where.operatorId = effectiveOperatorId

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
// CREATE: an authenticated restaurant/admin creates a brand for THEMSELVES.
// `operatorId` is sourced from the session — body-supplied operatorIds are
// silently ignored (createSchema strips unknown keys by default).

export async function POST(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const json = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }

    const brand = await prisma.brand.create({
      data: {
        ...parsed.data,
        operatorId: operator.id, // ← forced from the session
      },
    })

    return NextResponse.json({ brand }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
