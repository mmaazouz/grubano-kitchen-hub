import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveFranchiseRate } from '@/lib/franchise-royalty'

// B4: the royalty rate is now PER-BRAND, resolved through the SAME helper the accrual
// uses (resolveFranchiseRate(brand) = brand.royaltyPct ?? 6%) → the dashboard estimate
// can never diverge from the real held-back. Each POS uses the rate of the brand it
// operates; a POS with no brand / no royaltyPct falls back to 6% (= pre-B4 behaviour).

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
    // uniform 6% this equals the old revenueThisMonth * 0.06.
    const royaltiesDue     = brandsPerf.reduce((s, b) => s + b.royalties, 0)

    return NextResponse.json({
      revenueThisMonth,
      revenueLastMonth,
      royaltiesDue,
      networkAvg: NETWORK_AVG,
      brands: brandsPerf,
    })
  } catch (err) {
    console.error('[GET /api/franchise/my-dashboard]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
