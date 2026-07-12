import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readCreatorRoles } from '@/lib/creator-roles'
import {
  rankOpportunities, estimateTypicalGainCents, type OpportunityCandidate,
} from '@/lib/affiliate-opportunities'

// ── GET /api/creator/affiliate-opportunities — « Brief du jour » (Slice 2d) ────
// HEURISTIC (no LLM), READ-ONLY. Session-aware (Creator from the SESSION email,
// NEVER a ?creatorId → IDOR-safe), isInfluencer-gated. Recommends 2-3 things to
// promote today (campaign > promo > converted > popular), each with a TEMPLATED
// reason (the client renders the i18n string) + a DISPLAY gain estimate. It
// touches no money: the estimate mirrors the real formula via pure helpers but
// recomputes/modifies nothing.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function itemIdsOf(conditions: unknown): string[] {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return []
  const ids = (conditions as Record<string, unknown>).itemIds
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 404 })
    }
    const roles = await readCreatorRoles(creator.id)
    if (!roles.isInfluencer) {
      return NextResponse.json({ opportunities: [], estimatedGainCents: 0, isInfluencer: false })
    }

    // Gain estimate (display) — config rate, default 30 %.
    let commissionPct = 0.30
    try {
      const cfg = await prisma.referralConfig.findFirst({ select: { commissionPctOfGrubanoFee: true } })
      if (cfg && Number.isFinite(cfg.commissionPctOfGrubanoFee) && cfg.commissionPctOfGrubanoFee > 0) {
        commissionPct = cfg.commissionPctOfGrubanoFee
      }
    } catch { /* default */ }
    const estimatedGainCents = estimateTypicalGainCents(commissionPct)

    const now = new Date()
    const candidates: OpportunityCandidate[] = []

    // 1) CAMPAIGNS — opted-in active campaign promos (highest value). Tolerant:
    //    CreatorCampaign / Promotion.campaignId absent pre-db-push → skipped.
    try {
      const campPromos = await prisma.promotion.findMany({
        where: {
          active: true, campaignId: { not: null },
          campaign: { status: 'active', startDate: { lte: now }, endDate: { gte: now } },
        },
        select: {
          discount: true, conditions: true,
          brand:    { select: { restaurantId: true, restaurant: { select: { name: true } } } },
          campaign: { select: { creatorDish: { select: { name: true } }, creator: { select: { name: true } } } },
        },
      })
      for (const p of campPromos) {
        const restaurantId = p.brand?.restaurantId
        if (!restaurantId) continue
        candidates.push({
          kind: 'campaign',
          restaurantId,
          restaurantName: p.brand?.restaurant?.name ?? '',
          dishId:   itemIdsOf(p.conditions)[0] ?? null,
          dishName: p.campaign?.creatorDish?.name ?? null,
          reasonKey: 'oppReasonCampaign',
          reasonParams: { creator: p.campaign?.creator?.name ?? '—', pct: Math.round(p.discount) },
        })
      }
    } catch { /* campaigns not migrated → skip */ }

    // 2) PLAIN PROMOS — active resto-financed « percent » promos (not campaign).
    try {
      const promos = await prisma.promotion.findMany({
        where: {
          active: true, type: 'percent', campaignId: null,
          startDate: { lte: now }, endDate: { gte: now },
          brand: { restaurantId: { not: null } },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          discount: true, conditions: true,
          brand: { select: { restaurantId: true, restaurant: { select: { name: true } } } },
        },
        take: 20,
      })
      for (const p of promos) {
        const restaurantId = p.brand?.restaurantId
        if (!restaurantId) continue
        candidates.push({
          kind: 'promo',
          restaurantId,
          restaurantName: p.brand?.restaurant?.name ?? '',
          dishId:   itemIdsOf(p.conditions)[0] ?? null,
          dishName: null,
          reasonKey: 'oppReasonPromo',
          reasonParams: { pct: Math.round(p.discount) },
        })
      }
    } catch { /* skip */ }

    // 3) CONVERTED — restaurants this influencer's referrals actually order from.
    try {
      const refOrders = await prisma.referralOrder.findMany({
        where:  { referral: { creatorId: creator.id }, status: { in: ['matured', 'pending', 'paid'] } },
        select: { order: { select: { restaurantId: true, restaurant: { select: { name: true } } } } },
        take:   200,
      })
      const counts = new Map<string, { name: string; n: number }>()
      for (const r of refOrders) {
        const id = r.order?.restaurantId
        if (!id) continue
        const prev = counts.get(id) ?? { name: r.order?.restaurant?.name ?? '', n: 0 }
        prev.n += 1
        counts.set(id, prev)
      }
      for (const [restaurantId, v] of Array.from(counts.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 5)) {
        candidates.push({
          kind: 'converted', restaurantId, restaurantName: v.name,
          dishId: null, dishName: null, reasonKey: 'oppReasonConverted',
        })
      }
    } catch { /* skip */ }

    // 4) POPULAR — cold fallback: top-rated active restaurants. Always available.
    try {
      const popular = await prisma.restaurant.findMany({
        where:   { isActive: true, archivedAt: null },
        orderBy: [{ rating: 'desc' }, { reviewCount: 'desc' }],
        take:    5,
        select:  { id: true, name: true },
      })
      for (const r of popular) {
        candidates.push({
          kind: 'popular', restaurantId: r.id, restaurantName: r.name,
          dishId: null, dishName: null, reasonKey: 'oppReasonPopular',
        })
      }
    } catch { /* skip */ }

    const opportunities = rankOpportunities(candidates, 3).map(o => ({ ...o, estimatedGainCents }))

    return NextResponse.json({ opportunities, estimatedGainCents, isInfluencer: true })
  } catch (err) {
    console.error('[GET /api/creator/affiliate-opportunities]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
