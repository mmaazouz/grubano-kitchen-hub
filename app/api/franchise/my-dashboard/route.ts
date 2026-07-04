import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveFranchiseRate, isFranchiseRoyaltyEnabled } from '@/lib/franchise-royalty'
import { getFranchiseEarnings } from '@/lib/franchise-earnings'

// B4: the royalty rate is now PER-BRAND, resolved through the SAME helper the accrual
// uses (resolveFranchiseRate(brand) = brand.royaltyPct ?? 6%) → the dashboard estimate
// can never diverge from the real held-back. Each POS uses the rate of the brand it
// operates; a POS with no brand / no royaltyPct falls back to 6% (= pre-B4 behaviour).
//
// B6 (Agent 47): the dashboard now ALSO returns the AUTHORITATIVE royalty totals read
// from the FranchiseRoyalty table (accrued / settled / pending) — the real held-back —
// alongside the live `revenue × rate` ESTIMATE (royaltiesDue). READ-ONLY: no write, no
// settlement trigger. Existing fields are unchanged (backward-compatible).
//
// FR2 (Vague 1 CD): the SAME owner-scoped read is extended (ADDITIVE) with the network
// aggregates the CD dashboard renders — all REAL or omitted, never fabricated:
//   • posOpenCount / posClosedCount / posTotalCount / cityCount  (real POS counts)
//   • pendingApplications                                        (real pending candidacies)
//   • monthRoyaltiesCents (30-day FranchiseRoyalty, CENTS)       (authoritative, 0 when gated OFF)
//   • royaltyRatePct  (single real Brand.royaltyPct as %, or NULL when it varies — NEVER hardcoded)
//   • topPos          (the franchisor's POS ranked by 30-day CA)
//   • recentActivity  (POS-opening events dated by PointOfSale.createdAt — real events only)
// The franchisor sees ONLY its own network (every query is scoped by the SESSION operator).

// Network average revenue benchmark (per franchise, 30-day window). Kept as the
// pre-existing constant the front already displays.
const NETWORK_AVG = 7800

// Default marker shown next to a point of sale in the front (which renders
// `brand.emoji`). PointOfSale has no emoji column, so we use a location pin.
const POS_EMOJI = '📍'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operatorId = (session.user as { id?: string }).id!

    // ── Rolling 30-day window (NOT the calendar month) ──────────────────────────
    const now              = new Date()
    const windowStart      = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const prevWindowStart  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) // j-60 → j-30

    // Points of sale owned by this franchise, with their delivered orders in the
    // current 30-day window.
    const pointsOfSale = await prisma.pointOfSale.findMany({
      where: { franchiseId: operatorId, isActive: true },
      include: {
        orders: {
          where: { status: 'delivered', createdAt: { gte: windowStart } },
          select: { subtotal: true },
        },
        brand_ref: { select: { royaltyPct: true } }, // B4: per-brand royalty rate
      },
      orderBy: { createdAt: 'asc' },
    })

    // Previous-period revenue (j-60 → j-30) for the delta, across the same POS set.
    const posIds = pointsOfSale.map(p => p.id)
    const [prevOrders, closedPosCount, monthRoyaltyAgg, myBrands] = await Promise.all([
      posIds.length
        ? prisma.order.findMany({
            where: {
              pointOfSaleId: { in: posIds },
              status:        'delivered',
              createdAt:     { gte: prevWindowStart, lt: windowStart },
            },
            select: { subtotal: true },
          })
        : Promise.resolve([]),
      // Temporarily-closed (paused) POS of this franchisor — for the network distribution.
      prisma.pointOfSale.count({ where: { franchiseId: operatorId, isActive: false } }),
      // Authoritative royalties accrued over the SAME 30-day window (CENTS). 0 when the
      // held-back rail is gated OFF (no rows) → honest, never a projection here.
      prisma.franchiseRoyalty.aggregate({
        where: { franchisorOperatorId: operatorId, createdAt: { gte: windowStart } },
        _sum:  { royaltyCents: true },
      }),
      // This franchisor's OWN brands — for the single displayed rate + the candidacy scope.
      prisma.brand.findMany({ where: { operatorId: operatorId }, select: { id: true, royaltyPct: true, openToFranchise: true } }),
    ])

    // Per-POS performance, mapped into the `brands` shape the front already reads.
    const brandsPerf = pointsOfSale.map(p => {
      const revenue = p.orders.reduce((s, o) => s + o.subtotal, 0)
      return {
        id:        p.id,
        name:      p.name,
        city:      p.city ?? '',
        emoji:     POS_EMOJI,
        revenue,
        orders:    p.orders.length,
        // B4: each POS at the rate of its brand (default 6%).
        royalties: revenue * resolveFranchiseRate(p.brand_ref),
        topDishes: [] as string[],
      }
    })

    const revenueThisMonth = brandsPerf.reduce((s, b) => s + b.revenue, 0)
    const revenueLastMonth = prevOrders.reduce((s, o) => s + o.subtotal, 0)
    const royaltiesDue     = brandsPerf.reduce((s, b) => s + b.royalties, 0)

    // B6 — AUTHORITATIVE all-time totals from the FranchiseRoyalty table (the real
    // held-back), owner-scoped, cents → euros. 0 when the rail is OFF.
    const earnings       = await getFranchiseEarnings(operatorId)
    const royaltyEnabled = isFranchiseRoyaltyEnabled()

    // ── FR2 additive network aggregates (all owner-scoped, real-or-omitted) ─────────
    const brandIds = myBrands.map(b => b.id)
    const pendingApplications = brandIds.length
      ? await prisma.franchiseeApplication.count({ where: { brandId: { in: brandIds }, status: 'pending' } })
      : 0

    const posOpenCount  = pointsOfSale.length
    const posTotalCount = posOpenCount + closedPosCount
    const cityCount     = new Set(
      pointsOfSale.map(p => (p.city ?? '').trim().toLowerCase()).filter(Boolean),
    ).size

    // Single royalty rate ONLY when it is unambiguous across the franchisor's FRANCHISED
    // brands — otherwise null (the front shows « — »). NEVER a hardcoded percentage.
    const franchisedRates = myBrands.filter(b => b.openToFranchise).map(b => resolveFranchiseRate(b))
    const distinctRates   = Array.from(new Set(franchisedRates))
    const royaltyRatePct  = distinctRates.length === 1 ? Math.round(distinctRates[0] * 100) : null

    // Authoritative royalties held back over the 30-day window (cents → euros); 0 when OFF.
    const monthRoyalties = (monthRoyaltyAgg._sum.royaltyCents ?? 0) / 100

    // Top establishments by 30-day CA (from the same active-POS perf; already owner-scoped).
    const topPos = brandsPerf
      .slice()
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(b => ({ id: b.id, name: b.name, city: b.city, revenue: b.revenue }))

    // Recent activity — REAL POS-opening events only, dated by PointOfSale.createdAt.
    // Defensive: a POS with no timestamp is skipped rather than crashing the dashboard.
    const recentActivity = pointsOfSale
      .filter(p => p.createdAt)
      .map(p => ({ type: 'pos_open' as const, name: p.name, city: p.city ?? '', at: new Date(p.createdAt).toISOString() }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 6)

    return NextResponse.json({
      // ── existing (unchanged) ──
      revenueThisMonth,
      revenueLastMonth,
      royaltiesDue,
      networkAvg: NETWORK_AVG,
      brands: brandsPerf,
      royaltyEnabled,
      royaltiesAccrued: earnings.accruedCents / 100,
      royaltiesSettled: earnings.settledCents / 100,
      royaltiesPending: earnings.pendingCents / 100,
      // ── FR2 additive ──
      posOpenCount,
      posClosedCount: closedPosCount,
      posTotalCount,
      cityCount,
      pendingApplications,
      monthRoyalties,
      royaltyRatePct,
      topPos,
      recentActivity,
    })
  } catch (err) {
    console.error('[GET /api/franchise/my-dashboard]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
