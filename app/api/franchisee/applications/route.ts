import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// ── /api/franchisee/applications — a restaurateur joins a brand (B7, Agent 48) ───────
// The RESTAURATEUR side of franchisee enrolment. STRUCTURE-only: creates a candidacy
// (FranchiseeApplication), NEVER a money/order/royalty surface; no link is created until
// the franchisor approves (see /api/franchise/applications).
//
// OWNER-SCOPED via the SESSION operator (session.user.id, never a client value → no IDOR):
//   GET  : the caller's OWN candidacies + their OWN restaurants eligible to enrol
//          (owned, not archived, not already linked to a POS — the 1:1).
//   POST : create a candidacy for ONE of the caller's OWN restaurants to an OPEN brand.
//          Guards: the caller must own the restaurant; the brand must be openToFranchise
//          and not 'full'; the restaurant must not already be linked to a POS; at most one
//          live candidacy per (restaurant, brand) (re-apply after a rejection reuses the
//          same row). 400/401/403/409 as appropriate.

async function sessionOperatorId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as { id?: string } | undefined)?.id ?? null
}

export async function GET() {
  try {
    const operatorId = await sessionOperatorId()
    if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const [applications, restaurants] = await Promise.all([
      prisma.franchiseeApplication.findMany({
        where:   { applicantOperatorId: operatorId },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, restaurantId: true, brandId: true, status: true, message: true, createdAt: true, decidedAt: true },
      }),
      // The caller's OWN restaurants that can still be enrolled (1:1 → pointOfSaleId null).
      prisma.restaurant.findMany({
        where:   { operatorId, archivedAt: null, pointOfSaleId: null },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, city: true },
      }),
    ])

    // Decorate candidacies with brand + restaurant labels for the UI (no extra scope leak:
    // the rows are already the caller's own).
    const brandIds = Array.from(new Set(applications.map(a => a.brandId)))
    const restIds  = Array.from(new Set(applications.map(a => a.restaurantId)))
    const [brands, appRestos] = await Promise.all([
      brandIds.length
        ? prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true, emoji: true } })
        : Promise.resolve([] as { id: string; name: string; emoji: string }[]),
      restIds.length
        ? prisma.restaurant.findMany({ where: { id: { in: restIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
    ])
    const brandMap = new Map(brands.map(b => [b.id, b]))
    const restoMap = new Map(appRestos.map(r => [r.id, r]))

    return NextResponse.json({
      authenticated: true,
      restaurants,
      applications: applications.map(a => ({
        id:             a.id,
        brandId:        a.brandId,
        brandName:      brandMap.get(a.brandId)?.name ?? '',
        brandEmoji:     brandMap.get(a.brandId)?.emoji ?? '🍴',
        restaurantId:   a.restaurantId,
        restaurantName: restoMap.get(a.restaurantId)?.name ?? '',
        status:         a.status,
        createdAt:      a.createdAt,
      })),
    })
  } catch (err) {
    console.error('[GET /api/franchisee/applications]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

const createSchema = z.object({
  restaurantId: z.string().min(1).max(64),
  brandId:      z.string().min(1).max(64),
  message:      z.string().trim().max(1000).optional(),
})

export async function POST(req: Request) {
  try {
    const operatorId = await sessionOperatorId()
    if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const { restaurantId, brandId, message } = parsed.data

    // (1) The caller must OWN the restaurant, and it must not already be franchised (1:1).
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { operatorId: true, pointOfSaleId: true },
    })
    if (!restaurant || restaurant.operatorId !== operatorId) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 403 })
    }
    if (restaurant.pointOfSaleId) {
      return NextResponse.json({ error: 'Ce restaurant est déjà rattaché à une enseigne.' }, { status: 409 })
    }

    // (2) The brand must exist AND be open to franchising (and not full).
    const brand = await prisma.brand.findUnique({
      where:  { id: brandId },
      select: { openToFranchise: true, franchiseStatus: true },
    })
    if (!brand || !brand.openToFranchise || brand.franchiseStatus === 'full') {
      return NextResponse.json({ error: "Cette enseigne n'accepte pas de candidature." }, { status: 400 })
    }

    // (3) At most one LIVE candidacy per (restaurant, brand). Re-applying after a rejection
    // flips the same row back to 'pending'; a 'pending'/'approved' row blocks a duplicate.
    const existing = await prisma.franchiseeApplication.findUnique({
      where:  { restaurantId_brandId: { restaurantId, brandId } },
      select: { id: true, status: true },
    })
    if (existing) {
      if (existing.status === 'pending')  return NextResponse.json({ error: 'Candidature déjà en attente.' }, { status: 409 })
      if (existing.status === 'approved') return NextResponse.json({ error: 'Déjà rattaché à cette enseigne.' }, { status: 409 })
      // 'rejected' → re-open the SAME row as a fresh pending candidacy.
      const reopened = await prisma.franchiseeApplication.update({
        where: { id: existing.id },
        data:  { status: 'pending', message: message ?? null, decidedAt: null, pointOfSaleId: null, applicantOperatorId: operatorId },
        select: { id: true, status: true },
      })
      return NextResponse.json({ ok: true, application: reopened }, { status: 201 })
    }

    try {
      const application = await prisma.franchiseeApplication.create({
        data:   { restaurantId, brandId, applicantOperatorId: operatorId, message: message ?? null },
        select: { id: true, status: true },
      })
      return NextResponse.json({ ok: true, application }, { status: 201 })
    } catch (err) {
      // Concurrent create on the same (restaurant, brand) → @unique P2002 → already applied.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'Candidature déjà en attente.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('[POST /api/franchisee/applications]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
