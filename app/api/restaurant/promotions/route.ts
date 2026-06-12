import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

// ── /api/restaurant/promotions ────────────────────────────────────────────────
// Chantier P1 — the resto manages ITS promotions (engine: lib/promotions, wired
// server-side at checkout). Ownership is STRICT: every touched promotion must
// belong to a brand of the caller's CURRENT establishment.
//
//   GET   → the establishment's promotions (+ usage counts, column-tolerant) +
//           the brands & menu items the create form needs.
//   POST  → create (V1: percent 1-90 | fixed > 0, window, optional minOrderEur /
//           itemIds from the OWN menu / channels).
//   PATCH → soft toggle { id, active } — promotions are NEVER deleted (orders
//           reference them).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const conditionsSchema = z.object({
  minOrderEur: z.number().positive().optional(),
  itemIds:     z.array(z.string().min(1)).min(1).optional(),
  channels:    z.array(z.enum(['delivery', 'pickup'])).min(1).optional(),
})

const createSchema = z.object({
  brandId:    z.string().min(1),
  name:       z.string().trim().min(2).max(80),
  type:       z.enum(['percent', 'fixed']), // V1 scope (D5) — bundle/flash have no UI
  // percent: whole 1..90 ; fixed: EUR > 0 (sane bounds)
  discount:   z.number().positive(),
  startDate:  z.string().datetime(),
  endDate:    z.string().datetime(),
  conditions: conditionsSchema.optional(),
})

const patchSchema = z.object({
  id:     z.string().min(1),
  active: z.boolean(),
})

async function ownedBrands(explicitRestaurantId: string | null) {
  const scope = await resolveEstablishmentScope(explicitRestaurantId)
  if (!scope.ok) return { error: NextResponse.json({ error: scope.error }, { status: scope.status }) }
  if (!scope.restaurantId) {
    return { error: NextResponse.json({ error: 'Aucun établissement' }, { status: 404 }) }
  }
  const brands = await prisma.brand.findMany({
    where:  { restaurantId: scope.restaurantId },
    select: { id: true, name: true, emoji: true },
  })
  return { restaurantId: scope.restaurantId, brands }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await ownedBrands(searchParams.get('restaurantId'))
    if ('error' in ctx) return ctx.error
    const brandIds = ctx.brands.map(b => b.id)

    const [promotions, menuItems] = await Promise.all([
      brandIds.length
        ? prisma.promotion.findMany({
            where:   { brandId: { in: brandIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      // The create form's multi-select: the establishment's own menu items.
      brandIds.length
        ? prisma.menuItem.findMany({
            where:  { brandId: { in: brandIds } },
            select: { id: true, name: true, brandId: true },
            orderBy: { name: 'asc' },
          })
        : [],
    ])

    // Usage counts — COLUMN-TOLERANT: before the db push, Order.promotionId does
    // not exist in MySQL → groupBy throws → every count degrades to 0.
    const usage = new Map<string, number>()
    try {
      const grouped = await prisma.order.groupBy({
        by:     ['promotionId'],
        where:  { promotionId: { in: promotions.map(p => p.id) } },
        _count: { _all: true },
      })
      for (const g of grouped) if (g.promotionId) usage.set(g.promotionId, g._count._all)
    } catch {
      // pre-db-push — counts stay 0
    }

    return NextResponse.json({
      promotions: promotions.map(p => ({
        id: p.id, brandId: p.brandId, name: p.name, type: p.type,
        discount: p.discount, conditions: p.conditions,
        startDate: p.startDate.toISOString(), endDate: p.endDate.toISOString(),
        active: p.active, createdAt: p.createdAt.toISOString(),
        usageCount: usage.get(p.id) ?? 0,
      })),
      brands:    ctx.brands,
      menuItems,
    })
  } catch (err) {
    console.error('[GET /api/restaurant/promotions]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await ownedBrands(null)
    if ('error' in ctx) return ctx.error

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    const data = parsed.data

    // Strict ownership: the brand must belong to the CURRENT establishment.
    if (!ctx.brands.some(b => b.id === data.brandId)) {
      return NextResponse.json({ error: 'Marque non autorisée' }, { status: 403 })
    }

    // Sane value bounds (V1): percent 1..90 whole, fixed > 0.
    if (data.type === 'percent' && (data.discount < 1 || data.discount > 90)) {
      return NextResponse.json({ error: 'Pourcentage entre 1 et 90.' }, { status: 400 })
    }
    const start = new Date(data.startDate)
    const end   = new Date(data.endDate)
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: 'La fin doit suivre le début.' }, { status: 400 })
    }

    // Targeted items must belong to the establishment's own menu (D4 hygiene).
    if (data.conditions?.itemIds?.length) {
      const owned = await prisma.menuItem.count({
        where: { id: { in: data.conditions.itemIds }, brandId: { in: ctx.brands.map(b => b.id) } },
      })
      if (owned !== data.conditions.itemIds.length) {
        return NextResponse.json({ error: 'Plats hors de votre carte.' }, { status: 400 })
      }
    }

    const promotion = await prisma.promotion.create({
      data: {
        brandId:    data.brandId,
        name:       data.name,
        type:       data.type,
        discount:   data.type === 'percent' ? Math.round(data.discount) : Math.round(data.discount * 100) / 100,
        conditions: (data.conditions ?? {}) as object,
        startDate:  start,
        endDate:    end,
        active:     true,
      },
    })
    return NextResponse.json({ promotion }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/restaurant/promotions]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await ownedBrands(null)
    if ('error' in ctx) return ctx.error

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }

    const promotion = await prisma.promotion.findUnique({
      where:  { id: parsed.data.id },
      select: { id: true, brandId: true },
    })
    if (!promotion) return NextResponse.json({ error: 'Promotion introuvable' }, { status: 404 })
    if (!ctx.brands.some(b => b.id === promotion.brandId)) {
      return NextResponse.json({ error: 'Promotion non autorisée' }, { status: 403 })
    }

    // Soft toggle only — NEVER a delete (orders may reference the promotion).
    const updated = await prisma.promotion.update({
      where: { id: promotion.id },
      data:  { active: parsed.data.active },
    })
    return NextResponse.json({ promotion: updated })
  } catch (err) {
    console.error('[PATCH /api/restaurant/promotions]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
