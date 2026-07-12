import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readCreatorRoles } from '@/lib/creator-roles'
import { computeTier, computeStreakWeeks, computeBadges, rankLeaderboard, type LeaderRow } from '@/lib/affiliate-status'

// ── GET /api/creator/affiliate-stats ──────────────────────────────────────────
// Dashboard Affiliés — Slice 2a. The INFLUENCER's affiliation feed, READ-ONLY.
// Session-aware: the Creator is resolved from the SESSION email, NEVER from a
// ?creatorId param (IDOR-safe by construction). All amounts in INTEGER CENTS.
//
// Earnings come from ReferralOrder (creatorEarning is FROZEN on the NET margin
// since V1.5: 30 % of commission − Stripe − royalty, + newCustomerBonus),
// split matured (acquis) vs pending (7-day maturation). The status is the SERVER
// lifecycle — ZERO recomputation here. Shape is EXTENSIBLE on purpose (clicks,
// tiers, deep-link analytics slot in later WITHOUT breaking it).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORDERS_CAP = 30 // recent referred orders surfaced (gains list + activity feed)
const cents = (eur: number) => Math.round(eur * 100)

// The empty/locked payload — same SHAPE so the client never branches on missing
// fields (a non-influencer, or a brand-new influencer with no referrals).
function emptyPayload(over: Record<string, unknown> = {}) {
  return {
    isInfluencer: true,
    links:     { base: null as string | null, code: null as string | null, slug: null as string | null },
    earnings:  { maturedCents: 0, pendingCents: 0, byMonth: [] as { month: string; gainCents: number }[] },
    referrals: { newCustomers: 0, orders: [] as unknown[] },
    payout:    { claimableCents: 0, status: 'activation_pending' as const },
    tier:      null,
    streak:    { weeks: 0 },
    badges:    [] as { key: string; achieved: boolean }[],
    leaderboard: null as { top: unknown[]; myRank: number | null; total: number } | null,
    commissionPct: null as number | null,
    ...over,
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, referralCode: true, referralLinkSlug: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 404 })
    }

    // Role gate (tolerant — both true pre-migration). A creator who turned the
    // influencer role OFF gets a clean locked state, never another creator's data.
    const roles = await readCreatorRoles(creator.id)
    const links = {
      base: creator.referralLinkSlug ? `/ref/${creator.referralLinkSlug}` : null,
      code: creator.referralCode ?? null,
      slug: creator.referralLinkSlug ?? null,
    }
    if (!roles.isInfluencer) {
      return NextResponse.json(emptyPayload({ isInfluencer: false, links }))
    }

    // Config rate for the transparency line (« 30 % de la marge nette »). Read-
    // only; the line is simply hidden client-side if this is null.
    let commissionPct: number | null = null
    try {
      const cfg = await prisma.referralConfig.findFirst({ select: { commissionPctOfGrubanoFee: true } })
      if (cfg && Number.isFinite(cfg.commissionPctOfGrubanoFee) && cfg.commissionPctOfGrubanoFee > 0) {
        commissionPct = Math.round(cfg.commissionPctOfGrubanoFee * 100)
      }
    } catch { /* line hidden */ }

    const referralWhere = { referral: { creatorId: creator.id } }
    const [refAll, refRecent, newCustomers] = await Promise.all([
      // All rows for the totals + the monthly timeline (test volumes; revisit at scale).
      prisma.referralOrder.findMany({
        where:  referralWhere,
        select: {
          status: true, creatorEarning: true, newCustomerBonus: true, createdAt: true,
          order: { select: { createdAt: true } },
        },
      }),
      // Recent rows for the gains list + the activity feed.
      prisma.referralOrder.findMany({
        where:   referralWhere,
        orderBy: { createdAt: 'desc' },
        take:    ORDERS_CAP,
        select: {
          id: true, createdAt: true, status: true, maturedAt: true,
          grubanoFee: true, creatorEarning: true, newCustomerBonus: true,
          order: { select: { total: true, createdAt: true, restaurant: { select: { name: true } } } },
        },
      }),
      // « Clients référés » = distinct customer bindings for this creator.
      prisma.referral.count({ where: { creatorId: creator.id } }),
    ])

    let maturedCents = 0
    let pendingCents = 0
    const byMonth = new Map<string, number>()
    for (const r of refAll) {
      const gain = cents(r.creatorEarning) + cents(r.newCustomerBonus)
      if (r.status === 'matured') maturedCents += gain
      else if (r.status === 'pending') pendingCents += gain
      // paid/cancelled excluded from the two active buckets (paid shown elsewhere later).
      // Monthly timeline counts matured + pending (the "earning so far" view).
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
      creatorEarningCents: cents(o.creatorEarning),
      bonusCents:          cents(o.newCustomerBonus),
      status:              o.status,
      maturedAt:           o.maturedAt?.toISOString() ?? null,
    }))

    // ── Gamification (Slice 2c) — STATUS ONLY, computed, READ-ONLY ──────────────
    // Tier from cumulative matured earnings; streak = consecutive weeks with ≥1
    // real (matured|pending) referred order; badges = milestones. NONE of this
    // touches the commission rate (30 % for everyone).
    const orderDatesMs = refAll
      .filter(r => r.status === 'matured' || r.status === 'pending')
      .map(r => (r.order?.createdAt ?? r.createdAt).getTime())
    const ordersCount = orderDatesMs.length
    const tier   = computeTier(maturedCents)
    const streak = { weeks: computeStreakWeeks(orderDatesMs) }
    const badges = computeBadges({ ordersCount, newCustomers, maturedCents })

    // Leaderboard — matured gains over the last 90 days across influencers; the
    // ranker exposes NAME + RANK + TIER only (€ NEVER disclosed). Tolerant: any
    // error → no leaderboard, never a 500. (Test volumes — revisit at scale.)
    let leaderboard: { top: unknown[]; myRank: number | null; total: number } | null = null
    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const rows = await prisma.referralOrder.findMany({
        where:  { status: 'matured', order: { createdAt: { gte: since } } },
        select: {
          creatorEarning: true, newCustomerBonus: true,
          referral: { select: { creator: { select: { id: true, name: true, isInfluencer: true } } } },
        },
      })
      const byCreator = new Map<string, LeaderRow>()
      for (const r of rows) {
        const c = r.referral?.creator
        if (!c || c.isInfluencer === false) continue
        const prev = byCreator.get(c.id) ?? { creatorId: c.id, name: c.name, gainCents: 0 }
        prev.gainCents += cents(r.creatorEarning) + cents(r.newCustomerBonus)
        byCreator.set(c.id, prev)
      }
      leaderboard = rankLeaderboard(Array.from(byCreator.values()), creator.id, 10)
    } catch (e) {
      console.error('[affiliate-stats] leaderboard unavailable:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      isInfluencer: true,
      links,
      earnings: {
        maturedCents,
        pendingCents,
        byMonth: Array.from(byMonth.entries())
          .map(([month, gainCents]) => ({ month, gainCents }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      },
      referrals: { newCustomers, orders },
      // HONEST payout state: matured money is claimable, but payouts are gated on
      // KYC/immatriculation (B2b) → 'activation_pending', never a fake "pay now".
      payout: { claimableCents: maturedCents, status: 'activation_pending' as const },
      // Gamification (Slice 2c) — STATUS ONLY (no rate effect).
      tier,
      streak,
      badges,
      leaderboard,
      commissionPct,
    })
  } catch (err) {
    console.error('[GET /api/creator/affiliate-stats]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
