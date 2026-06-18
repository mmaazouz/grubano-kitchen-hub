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
// alongside the live `revenue × rate` ESTIMATE (royaltiesDue). The estimate is a
// projection of the rolling 30-day window; `royaltyEnabled` lets the client label it
// honestly (when the held-back rail is OFF, no money is actually retained → the
// authoritative totals stay 0 and the estimate is a mere projection). READ-ONLY: no
// write, no settlement trigger. Existing fields are unchanged (backward-compatible).

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
    // On the 1st of the month a calendar-month filter would show 0 because the
    // seeded/real orders mostly land in the previous month. A 30-day rolling
    // window is both more meaningful for an operator and avoids that edge.
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
    const prevOrders = posIds.length
      ? await prisma.order.findMany({
          where: {
            pointOfSaleId: { in: posIds },
            status:        'delivered',
            createdAt:     { gte: prevWindowStart, lt: windowStart },
          },
          select: { subtotal: true },
        })
      : []

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
        // B4: each POS at the rate of its brand (default 6%). When every POS resolves
        // to 6% this equals the pre-B4 `revenue * 0.06`.
        royalties: revenue * resolveFranchiseRate(p.brand_ref),
        topDishes: [] as string[], // a POS has no menu items of its own (yet)
      }
    })

    const revenueThisMonth = brandsPerf.reduce((s, b) => s + b.revenue, 0)
    const revenueLastMonth = prevOrders.reduce((s, o) => s + o.subtotal, 0)
    // Sum of per-POS (per-brand-rate) royalties → consistent with the accrual. With a
    // uniform 6% this equals the old revenueThisMonth * 0.06. This is the live ESTIMATE
    // (projection of the 30-day window), NOT the real held-back.
    const royaltiesDue     = brandsPerf.reduce((s, b) => s + b.royalties, 0)

    // B6 — AUTHORITATIVE totals from the FranchiseRoyalty table (the real held-back),
    // owner-scoped to THIS franchisor (operatorId from the session). All-time, in cents →
    // converted to euros to match the rest of this euro-denominated response. When the
    // held-back rail is OFF (royaltyEnabled=false) no rows are accrued → these stay 0 and
    // royaltiesDue is purely a projection.
    const earnings     = await getFranchiseEarnings(operatorId)
    const royaltyEnabled = isFranchiseRoyaltyEnabled()

    return NextResponse.json({
      revenueThisMonth,
      revenueLastMonth,
      royaltiesDue,
      networkAvg: NETWORK_AVG,
      brands: brandsPerf,
      // B6 — real held-back (authoritative), euros. royaltiesDue above is the estimate.
      royaltyEnabled,
      royaltiesAccrued: earnings.accruedCents / 100,
      royaltiesSettled: earnings.settledCents / 100,
      royaltiesPending: earnings.pendingCents / 100,
    })
  } catch (err) {
    console.error('[GET /api/franchise/my-dashboard]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
