import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { computePartnerBalance } from '@/lib/partner-balance'
import { countAffiliateClicks } from '@/lib/affiliate-clicks'
import { computeTier, computeStreakWeeks, computeBadges, rankLeaderboard, type LeaderRow } from '@/lib/affiliate-status'
import { isInfluencerEnabled, isAffiliateVerified } from '@/lib/influencer-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/affiliate/stats — the TOP-LEVEL affiliate's feed (Brique C, Agent 60) ───
// READ-ONLY twin of /api/creator/affiliate-stats, but for the AFFILIATE entity (operator-
// keyed). The affiliate is resolved from the SESSION operator id (never a client value →
// IDOR-safe). Gated by AFFILIATE_ENABLED (404 when OFF). Reuses the PURE gamification lib
// (affiliate-status) + B's balance (computePartnerBalance('affiliate', operatorId)) + the
// click funnel. ZERO money: it reads ReferralOrder.affiliateId / ReferralClick / Payout —
// it never writes, recomputes, or moves a cent. Leaderboard is privacy-safe (rank+name+tier
// only; € of others NEVER disclosed). All amounts INTEGER CENTS.

const ORDERS_CAP = 30
const cents = (eur: number) => Math.round(eur * 100)

export async function GET() {
  if (!isAffiliateEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  try {
    const session = await getServerSession(authOptions)
    const operatorId = (session?.user as { id?: string } | undefined)?.id
    if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const affiliate = await getAffiliateByOperator(operatorId)
    if (!affiliate) return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 404 })

    const links = {
      base: affiliate.referralLinkSlug ? `/ref/${affiliate.referralLinkSlug}` : null,
      code: affiliate.referralCode,
      slug: affiliate.referralLinkSlug,
    }

    // Config rate for the transparency line (canon 30 %). Read-only; hidden if null.
    let commissionPct: number | null = null
    try {
      const cfg = await prisma.referralConfig.findFirst({ select: { commissionPctOfGrubanoFee: true } })
      if (cfg && Number.isFinite(cfg.commissionPctOfGrubanoFee) && cfg.commissionPctOfGrubanoFee > 0) {
        commissionPct = Math.round(cfg.commissionPctOfGrubanoFee * 100)
      }
    } catch { /* line hidden */ }

    // Influencer-tier transparency — DISPLAY ONLY (Agent 90). A VERIFIED affiliate (INF-1,
    // Affiliate.audienceVerified) earns a HIGHER share of the SAME pot (INF-3, default 40 %).
    // We READ the configured rate (ReferralConfig.influencerCommissionPct) + the verified
    // state; we NEVER compute or move a cent — the APPLIED rate is FROZEN per ReferralOrder at
    // order time (orders/route, untouched). Gated by INFLUENCER_ENABLED: when OFF the tier is
    // inactive and NO extra query runs → the response stays byte-identical to today.
    let influencer: { verified: boolean; ratePct: number | null } = { verified: false, ratePct: null }
    if (isInfluencerEnabled()) {
      try {
        const [verified, infCfg] = await Promise.all([
          isAffiliateVerified(operatorId),
          prisma.referralConfig.findFirst({ select: { influencerCommissionPct: true } }),
        ])
        const ratePct = infCfg && Number.isFinite(infCfg.influencerCommissionPct) && infCfg.influencerCommissionPct > 0
          ? Math.round(infCfg.influencerCommissionPct * 100)
          : null
        influencer = { verified, ratePct }
      } catch { /* influencer line hidden */ }
    }

    // Owner-scoped reads, keyed on the affiliate's OPERATOR id (= ReferralOrder.affiliateId).
    const affiliateWhere = { affiliateId: operatorId }
    const [refAll, refRecent, newCustomers, balance, clicksTotal] = await Promise.all([
      prisma.referralOrder.findMany({
        where:  affiliateWhere,
        select: { status: true, creatorEarning: true, newCustomerBonus: true, createdAt: true, order: { select: { createdAt: true } } },
      }),
      prisma.referralOrder.findMany({
        where:   affiliateWhere,
        orderBy: { createdAt: 'desc' },
        take:    ORDERS_CAP,
        select: {
          id: true, createdAt: true, status: true, maturedAt: true,
          grubanoFee: true, creatorEarning: true, newCustomerBonus: true,
          order: { select: { total: true, createdAt: true, restaurant: { select: { name: true } } } },
        },
      }),
      prisma.referral.count({ where: { affiliateId: operatorId } }),
      computePartnerBalance('affiliate', operatorId), // B — earned/paid/available (READ-ONLY)
      countAffiliateClicks(operatorId),
    ])

    let maturedCents = 0
    let pendingCents = 0
    const byMonth = new Map<string, number>()
    for (const r of refAll) {
      const gain = cents(r.creatorEarning) + cents(r.newCustomerBonus)
      if (r.status === 'matured') maturedCents += gain
      else if (r.status === 'pending') pendingCents += gain
      if (r.status === 'matured' || r.status === 'pending') {
        const d = r.order?.createdAt ?? r.createdAt
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        byMonth.set(key, (byMonth.get(key) ?? 0) + gain)
      }
    }

    const orders = refRecent.map(o => ({
      id:                  o.id,
      date:                (o.order?.createdAt ?? o.createdAt).toISOString(),
      restaurant:          o.order?.restaurant?.name ?? null,
      orderTotalCents:     o.order ? cents(o.order.total) : null,
      grubanoFeeCents:     cents(o.grubanoFee),
      earningCents:        cents(o.creatorEarning),
      bonusCents:          cents(o.newCustomerBonus),
      status:              o.status,
      maturedAt:           o.maturedAt?.toISOString() ?? null,
    }))

    // Click → conversion funnel: clicks recorded vs orders attributed to this affiliate.
    const conversions = refAll.length
    const conversionRatePct = clicksTotal > 0 ? Math.round((conversions / clicksTotal) * 100) : 0

    // Gamification — STATUS ONLY (reuses the pure lib; zero rate/money effect).
    const orderDatesMs = refAll
      .filter(r => r.status === 'matured' || r.status === 'pending')
      .map(r => (r.order?.createdAt ?? r.createdAt).getTime())
    const tier   = computeTier(maturedCents)
    const streak = { weeks: computeStreakWeeks(orderDatesMs) }
    const badges = computeBadges({ ordersCount: orderDatesMs.length, newCustomers, maturedCents })

    // Affiliate leaderboard — matured gains over the last 90 days across affiliates; ranker
    // exposes NAME + RANK + TIER only (€ NEVER disclosed). Tolerant → never a 500.
    let leaderboard: { top: unknown[]; myRank: number | null; total: number } | null = null
    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const rows = await prisma.referralOrder.findMany({
        where:  { status: 'matured', affiliateId: { not: null }, order: { createdAt: { gte: since } } },
        select: { affiliateId: true, creatorEarning: true, newCustomerBonus: true },
      })
      const byAff = new Map<string, number>()
      for (const r of rows) {
        if (!r.affiliateId) continue
        byAff.set(r.affiliateId, (byAff.get(r.affiliateId) ?? 0) + cents(r.creatorEarning) + cents(r.newCustomerBonus))
      }
      const ids = Array.from(byAff.keys())
      const names = ids.length
        ? await prisma.operator.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : []
      const nameById = new Map(names.map(n => [n.id, n.name]))
      const leaderRows: LeaderRow[] = ids.map(id => ({ creatorId: id, name: nameById.get(id) ?? '—', gainCents: byAff.get(id) ?? 0 }))
      leaderboard = rankLeaderboard(leaderRows, operatorId, 10)
    } catch (e) {
      console.error('[affiliate-stats] leaderboard unavailable:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      enabled: true,
      links,
      earnings: {
        maturedCents,
        pendingCents,
        byMonth: Array.from(byMonth.entries()).map(([month, gainCents]) => ({ month, gainCents })).sort((a, b) => a.month.localeCompare(b.month)),
      },
      // B — authoritative balance (available = matured earned − paid; paid is 0 until Brique D).
      balance: { availableCents: balance.availableCents, paidCents: balance.paidCents },
      referrals: { newCustomers, orders },
      clicks: { total: clicksTotal, conversions, conversionRatePct },
      // HONEST payout state: matured money is claimable, but the withdrawal is Brique D.
      payout: { claimableCents: balance.availableCents, status: 'activation_pending' as const },
      tier,
      streak,
      badges,
      leaderboard,
      commissionPct,
      influencer,
    })
  } catch (err) {
    console.error('[GET /api/affiliate/stats]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
