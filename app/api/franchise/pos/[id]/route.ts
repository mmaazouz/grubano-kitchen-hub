import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { gateFranchise } from '@/lib/franchise-pos'

export const dynamic = 'force-dynamic'

// ── /api/franchise/pos/[id] — edit / delete ONE of the franchisor's POS (B3) ─────
// OWNER-SCOPED: the POS must belong to the SESSION operator (pos.franchiseId ===
// session operator) — else 404 (never leak another franchisor's row). Re-linking a
// restaurant re-validates ownership + the 1:1 at write time. Deleting unlinks the
// restaurant first (so the link never dangles) and refuses if orders reference the
// POS (defensive — e.g. demo-seeded orders). STRUCTURE-only: no order/payment/royalty
// /dashboard surface is touched.

const patchSchema = z.object({
  name:         z.string().min(2, 'Nom trop court').max(120).optional(),
  address:      z.string().max(200).nullable().optional(),
  city:         z.string().max(100).nullable().optional(),
  lat:          z.number().min(-90).max(90).nullable().optional(),
  lng:          z.number().min(-180).max(180).nullable().optional(),
  brandId:      z.string().min(1).max(64).nullable().optional(),   // null = unset marque
  restaurantId: z.string().min(1).max(64).nullable().optional(),   // null = unlink ; string = (re)link
})

function deny(status: 401 | 403) {
  return NextResponse.json({ ok: false, error: status === 401 ? 'Non autorisé' : 'Accès refusé' }, { status })
}
const notFound = () => NextResponse.json({ ok: false, error: 'Point de vente introuvable' }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const g = await gateFranchise()
    if (!g.ok) return deny(g.status)

    // OWNER-SCOPED load — 404 if the POS is not THIS franchisor's (no existence leak).
    const pos = await prisma.pointOfSale.findUnique({
      where:  { id: params.id },
      select: { id: true, franchiseId: true, restaurant: { select: { id: true } } },
    })
    if (!pos || pos.franchiseId !== g.operatorId) return notFound()

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data
    const currentRestoId = pos.restaurant?.id ?? null

    // Ownership validation for a NEW brand / restaurant (only when provided non-null).
    if (d.brandId) {
      const b = await prisma.brand.findUnique({ where: { id: d.brandId }, select: { operatorId: true } })
      if (!b || b.operatorId !== g.operatorId) return NextResponse.json({ ok: false, error: 'Marque introuvable' }, { status: 403 })
    }
    if (d.restaurantId && d.restaurantId !== currentRestoId) {
      const r = await prisma.restaurant.findUnique({ where: { id: d.restaurantId }, select: { operatorId: true, pointOfSaleId: true } })
      if (!r || r.operatorId !== g.operatorId) return NextResponse.json({ ok: false, error: 'Restaurant introuvable' }, { status: 403 })
      if (r.pointOfSaleId) return NextResponse.json({ ok: false, error: 'Ce restaurant est déjà lié à un point de vente.' }, { status: 409 })
    }

    const ok = await prisma.$transaction(async (tx) => {
      // POS scalar fields (only the keys actually provided).
      const data: Record<string, unknown> = {}
      if (d.name    !== undefined) data.name    = d.name.trim()
      if (d.address !== undefined) data.address = d.address?.trim() || null
      if (d.city    !== undefined) data.city    = d.city?.trim() || null
      if (d.lat     !== undefined) data.lat     = d.lat
      if (d.lng     !== undefined) data.lng     = d.lng
      if (d.brandId !== undefined) data.brandId = d.brandId
      if (Object.keys(data).length) await tx.pointOfSale.update({ where: { id: pos.id }, data })

      // Re-link (only when restaurantId is explicitly present in the payload).
      if (d.restaurantId !== undefined && d.restaurantId !== currentRestoId) {
        if (currentRestoId) {
          await tx.restaurant.update({ where: { id: currentRestoId }, data: { pointOfSaleId: null } })
        }
        if (d.restaurantId) {
          const linked = await tx.restaurant.updateMany({
            where: { id: d.restaurantId, operatorId: g.operatorId, pointOfSaleId: null },
            data:  { pointOfSaleId: pos.id },
          })
          if (linked.count !== 1) throw new Error('LINK_CONFLICT')
        }
      }
      return true
    }).catch((err) => {
      // LINK_CONFLICT (claim lost) OR @unique(pointOfSaleId) P2002 (a concurrent relink
      // to the same restaurant) → a clean 1:1 conflict (409), never a 500.
      if (err instanceof Error && err.message === 'LINK_CONFLICT') return false
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
      throw err
    })

    if (!ok) return NextResponse.json({ ok: false, error: 'Ce restaurant est déjà lié à un point de vente.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/franchise/pos/[id]]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const g = await gateFranchise()
    if (!g.ok) return deny(g.status)

    const pos = await prisma.pointOfSale.findUnique({
      where:  { id: params.id },
      select: { id: true, franchiseId: true, restaurant: { select: { id: true } }, _count: { select: { orders: true } } },
    })
    if (!pos || pos.franchiseId !== g.operatorId) return notFound()

    // Defensive: a POS that already has orders (e.g. demo-seeded) must not be hard-deleted
    // (FK + accounting). Deletion semantics for a POS with real orders are revisited in B5/B6.
    if (pos._count.orders > 0) {
      return NextResponse.json({ ok: false, error: 'Ce point de vente a des commandes et ne peut pas être supprimé.' }, { status: 409 })
    }

    await prisma.$transaction(async (tx) => {
      // Unlink the restaurant FIRST (the FK lives on Restaurant) so it never dangles.
      if (pos.restaurant?.id) {
        await tx.restaurant.update({ where: { id: pos.restaurant.id }, data: { pointOfSaleId: null } })
      }
      await tx.pointOfSale.delete({ where: { id: pos.id } })
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/franchise/pos/[id]]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
