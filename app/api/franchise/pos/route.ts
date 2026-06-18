import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { gateFranchise } from '@/lib/franchise-pos'

export const dynamic = 'force-dynamic'

// ── /api/franchise/pos — franchisor points-of-sale CRUD (B3, Agent 44) ───────────
// GET  : the franchisor's OWN points of sale (+ its linkable restaurants & brands).
// POST : create a POS for the franchisor, optionally linking ONE of its OWN restaurants
//        (1:1) and ONE of its OWN brands. OWNER-SCOPED via the session (no IDOR); every
//        franchiseId/operatorId is the resolved session operator, never a client value.
// STRUCTURE-only: writes PointOfSale + the Restaurant↔POS link; touches NO order /
// payment / royalty / dashboard surface (those stay inert until B5 tags orders).

const createSchema = z.object({
  name:         z.string().min(2, 'Nom trop court').max(120),
  address:      z.string().max(200).optional(),
  city:         z.string().max(100).optional(),
  lat:          z.number().min(-90).max(90).optional(),
  lng:          z.number().min(-180).max(180).optional(),
  brandId:      z.string().min(1).max(64).optional(),       // one of the operator's brands
  restaurantId: z.string().min(1).max(64).optional(),       // one of the operator's restaurants (1:1)
})

function deny(status: 401 | 403) {
  return NextResponse.json({ ok: false, error: status === 401 ? 'Non autorisé' : 'Accès refusé' }, { status })
}

export async function GET() {
  try {
    const g = await gateFranchise()
    if (!g.ok) return deny(g.status)

    const [pointsOfSale, restaurants, brands] = await Promise.all([
      prisma.pointOfSale.findMany({
        where:   { franchiseId: g.operatorId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, address: true, city: true, isActive: true, brandId: true,
          restaurant: { select: { id: true, name: true, city: true } },
          brand_ref:  { select: { id: true, name: true, emoji: true } },
        },
      }),
      // The operator's OWN restaurants (for the link picker); pointOfSaleId reveals which
      // are already linked so the UI can exclude them (1:1).
      prisma.restaurant.findMany({
        where:   { operatorId: g.operatorId, archivedAt: null },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, city: true, pointOfSaleId: true },
      }),
      // The operator's OWN brands (optional marque for a POS).
      prisma.brand.findMany({
        where:   { operatorId: g.operatorId },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, emoji: true },
      }),
    ])

    return NextResponse.json({ ok: true, pointsOfSale, restaurants, brands })
  } catch (err) {
    console.error('[GET /api/franchise/pos]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const g = await gateFranchise()
    if (!g.ok) return deny(g.status)

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // Ownership validation — the brand AND the restaurant must belong to THIS operator.
    if (d.brandId) {
      const b = await prisma.brand.findUnique({ where: { id: d.brandId }, select: { operatorId: true } })
      if (!b || b.operatorId !== g.operatorId) {
        return NextResponse.json({ ok: false, error: 'Marque introuvable' }, { status: 403 })
      }
    }
    if (d.restaurantId) {
      const r = await prisma.restaurant.findUnique({ where: { id: d.restaurantId }, select: { operatorId: true, pointOfSaleId: true } })
      if (!r || r.operatorId !== g.operatorId) {
        return NextResponse.json({ ok: false, error: 'Restaurant introuvable' }, { status: 403 })
      }
      if (r.pointOfSaleId) {
        return NextResponse.json({ ok: false, error: 'Ce restaurant est déjà lié à un point de vente.' }, { status: 409 })
      }
    }

    // Create the POS (franchiseId = the SESSION operator, never a client value), then
    // link the restaurant atomically. The updateMany WHERE {operatorId, pointOfSaleId:null}
    // re-checks ownership + the 1:1 at write time → race-safe (count must be exactly 1).
    let conflict = false
    const pos = await prisma.$transaction(async (tx) => {
      const created = await tx.pointOfSale.create({
        data: {
          franchiseId: g.operatorId,
          name:        d.name.trim(),
          address:     d.address?.trim() || null,
          city:        d.city?.trim() || null,
          lat:         d.lat ?? null,
          lng:         d.lng ?? null,
          brandId:     d.brandId ?? null,
        },
        select: { id: true, name: true, city: true, isActive: true },
      })
      if (d.restaurantId) {
        const linked = await tx.restaurant.updateMany({
          where: { id: d.restaurantId, operatorId: g.operatorId, pointOfSaleId: null },
          data:  { pointOfSaleId: created.id },
        })
        if (linked.count !== 1) { conflict = true; throw new Error('LINK_CONFLICT') }
      }
      return created
    }).catch((err) => {
      // LINK_CONFLICT (claim lost the count-1 race) OR a @unique(pointOfSaleId) P2002
      // (a concurrent link to the same restaurant) → a clean 1:1 conflict, not a 500.
      if (err instanceof Error && err.message === 'LINK_CONFLICT') return null
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null
      throw err
    })

    if (!pos) {
      return NextResponse.json({ ok: false, error: 'Ce restaurant est déjà lié à un point de vente.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, pointOfSale: pos }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/franchise/pos]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
