import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { gateFranchise } from '@/lib/franchise-pos'
import { isFranchiseEnabled } from '@/lib/franchise-account'

export const dynamic = 'force-dynamic'

// ── /api/franchise/applications — franchisor reviews join requests (B7, Agent 48) ────
// The FRANCHISOR side of franchisee enrolment. OWNER-SCOPED via gateFranchise (operator
// from the SESSION + 'franchise' role; 401/403, never a client value → no IDOR).
//   GET  : the candidacies to brands THIS operator OWNS (Brand.operatorId = session).
//   POST : approve | reject ONE candidacy to one of the operator's OWN brands (404 if the
//          candidacy targets another owner's brand → no IDOR / no info leak).
//
// On APPROVE (atomic transaction): create a PointOfSale (franchiseId = the franchisor,
// brandId = the brand) and link the applicant's restaurant (Restaurant.pointOfSaleId, 1:1)
// — the SAME race-safe claim as B3 (updateMany WHERE { id, operatorId: applicant,
// pointOfSaleId: null } must affect exactly 1 row; a @unique(pointOfSaleId) P2002 or a
// lost claim → clean 409, transaction rolled back, candidacy NOT approved). The
// cross-operator link (applicant's resto ↔ franchisor's POS) is created ONLY here, by the
// double accord (applicant posted + franchisor approves). On REJECT: status only, NO link.
// STRUCTURE-only: no order / payment / royalty surface is touched; royalties stay inert
// until the order taggage (B5) + flags are enabled, exactly like the franchisor's own POS.

function deny(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'Non autorisé' : 'Accès refusé' }, { status })
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const g = await gateFranchise()
    if (!g.ok) return deny(g.status)

    // The brands this operator owns → the only candidacies it may ever see.
    const myBrands = await prisma.brand.findMany({
      where:  { operatorId: g.operatorId },
      select: { id: true, name: true, emoji: true },
    })
    const brandMap = new Map(myBrands.map(b => [b.id, b]))
    const brandIds = myBrands.map(b => b.id)
    if (brandIds.length === 0) return NextResponse.json({ ok: true, applications: [] })

    const apps = await prisma.franchiseeApplication.findMany({
      where:   { brandId: { in: brandIds } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select:  { id: true, restaurantId: true, brandId: true, status: true, message: true, createdAt: true, decidedAt: true },
    })

    // Decorate with restaurant labels (the restaurants belong to the APPLICANTS, but they
    // are referenced by candidacies to the franchisor's own brands — legitimate to display).
    const restIds = Array.from(new Set(apps.map(a => a.restaurantId)))
    const restos = restIds.length
      ? await prisma.restaurant.findMany({ where: { id: { in: restIds } }, select: { id: true, name: true, city: true } })
      : []
    const restoMap = new Map(restos.map(r => [r.id, r]))

    return NextResponse.json({
      ok: true,
      applications: apps.map(a => ({
        id:             a.id,
        status:         a.status,
        message:        a.message,
        createdAt:      a.createdAt,
        decidedAt:      a.decidedAt,
        brandId:        a.brandId,
        brandName:      brandMap.get(a.brandId)?.name ?? '',
        brandEmoji:     brandMap.get(a.brandId)?.emoji ?? '🍴',
        restaurantId:   a.restaurantId,
        restaurantName: restoMap.get(a.restaurantId)?.name ?? '',
        restaurantCity: restoMap.get(a.restaurantId)?.city ?? '',
      })),
    })
  } catch (err) {
    console.error('[GET /api/franchise/applications]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

const decideSchema = z.object({
  id:     z.string().min(1).max(64),
  action: z.enum(['approve', 'reject']),
})

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const g = await gateFranchise()
    if (!g.ok) return deny(g.status)

    const parsed = decideSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const { id, action } = parsed.data

    const app = await prisma.franchiseeApplication.findUnique({
      where:  { id },
      select: { id: true, status: true, brandId: true, restaurantId: true, applicantOperatorId: true },
    })
    if (!app) return NextResponse.json({ error: 'Candidature introuvable' }, { status: 404 })

    // Owner-scope: the candidacy must target a brand THIS operator owns. 404 (not 403) so a
    // foreign candidacy id is indistinguishable from a non-existent one (no info leak).
    const brand = await prisma.brand.findUnique({ where: { id: app.brandId }, select: { operatorId: true } })
    if (!brand || brand.operatorId !== g.operatorId) {
      return NextResponse.json({ error: 'Candidature introuvable' }, { status: 404 })
    }

    if (app.status !== 'pending') {
      return NextResponse.json({ error: 'Candidature déjà traitée.' }, { status: 409 })
    }

    // ── REJECT — status only, no link created ───────────────────────────────────────
    if (action === 'reject') {
      await prisma.franchiseeApplication.update({
        where: { id: app.id },
        data:  { status: 'rejected', decidedAt: new Date() },
      })
      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    // ── APPROVE — create the POS + link the restaurant (atomic, 1:1, race-safe) ──────
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: app.restaurantId },
      select: { operatorId: true, name: true, city: true, pointOfSaleId: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    }
    if (restaurant.pointOfSaleId) {
      return NextResponse.json({ error: 'Ce restaurant est déjà rattaché à un point de vente.' }, { status: 409 })
    }

    let conflict = false
    const result = await prisma.$transaction(async (tx) => {
      const pos = await tx.pointOfSale.create({
        data: {
          franchiseId: g.operatorId,        // the FRANCHISOR (session), never a client value
          brandId:     app.brandId,         // the franchisor's own brand
          name:        restaurant.name,
          city:        restaurant.city || null,
        },
        select: { id: true, name: true, city: true },
      })
      // Claim the APPLICANT's restaurant for this POS (1:1). The WHERE re-checks the
      // applicant ownership + pointOfSaleId null at write time → race-safe (count === 1).
      const linked = await tx.restaurant.updateMany({
        where: { id: app.restaurantId, operatorId: app.applicantOperatorId, pointOfSaleId: null },
        data:  { pointOfSaleId: pos.id },
      })
      if (linked.count !== 1) { conflict = true; throw new Error('LINK_CONFLICT') }

      await tx.franchiseeApplication.update({
        where: { id: app.id },
        data:  { status: 'approved', decidedAt: new Date(), pointOfSaleId: pos.id },
      })
      return pos
    }).catch((err) => {
      // Lost claim (LINK_CONFLICT) OR a @unique(pointOfSaleId) P2002 (concurrent link) → a
      // clean 1:1 conflict, transaction rolled back (no POS, candidacy still pending).
      if (err instanceof Error && err.message === 'LINK_CONFLICT') return null
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null
      throw err
    })

    if (!result) {
      return NextResponse.json({ error: 'Ce restaurant a été rattaché entre-temps.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: 'approved', pointOfSale: result })
  } catch (err) {
    console.error('[POST /api/franchise/applications]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
