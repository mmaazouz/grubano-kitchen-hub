import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Reading session → never statically prerendered.
export const dynamic = 'force-dynamic'

// Grubano's commission on a basket. SAME constant as POST /api/orders
// (GRUBANO_FEE_PCT) so the P&L shown here matches what the checkout freezes.
const GRUBANO_FEE_PCT = 0.10

const round2 = (n: number) => Math.round(n * 100) / 100

// Roles allowed to see an operator's financial P&L.
const ALLOWED_ROLES = new Set(['restaurant', 'admin'])

// ── GET /api/finance/summary ────────────────────────────────────────────────
// Real restaurateur P&L over a rolling 30-day window, with creator COST and
// creator VALUE side by side. READ-ONLY: no write, no migration — every figure
// is derived from existing Order / DishSale / ReferralOrder rows.
export async function GET() {
  // Safe zero-filled shape: the page must render even if anything goes wrong.
  const empty = {
    windowDays:          30,
    caBrut:              0,
    commissionGrubano:   0,
    verseAuxCreateurs:   0,
    remisesFinancees:    0,
    netResto:            0,
    caAmeneParCreateurs: 0,
    ordersFromCreators:  0,
    ordersTotal:         0,
  }

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const role = (session.user as { role?: string }).role
    if (!role || !ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const operatorId = (session.user as { id?: string }).id
    if (!operatorId) {
      return NextResponse.json(empty)
    }

    // ── Rolling 30-day window (NOT the calendar month) ──────────────────────
    // Same choice as the other dashboards (/api/franchise/my-dashboard): a
    // calendar-month filter would read 0 on the 1st because most orders land in
    // the previous month. A rolling window removes that "1st of the month" edge.
    const now         = new Date()
    const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Restaurants owned by this operator (Restaurant.operatorId is @unique, so
    // this is 0 or 1 in practice — findMany keeps it future-proof regardless).
    const restaurants = await prisma.restaurant.findMany({
      where:  { operatorId, archivedAt: null },
      select: { id: true },
    })
    const restaurantIds = restaurants.map(r => r.id)
    if (restaurantIds.length === 0) {
      return NextResponse.json(empty)
    }

    // Real orders in the window. STATUS: everything that is NOT cancelled — a
    // cancelled order produced no revenue and no payout. (This is the inclusive
    // "au minimum tout ce qui n'est pas annulé" rule: received → delivered all
    // count.) We pull each order's referralOrder presence in the SAME query so
    // the creator-attributed CA needs no extra round-trip.
    const orders = await prisma.order.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        createdAt:    { gte: windowStart },
        // Ghost-orders fix: unpaid/abandoned card checkouts never count.
        status:       { notIn: ['cancelled', 'awaiting_payment', 'expired'] },
      },
      select: {
        id:            true,
        subtotal:      true,
        deliveryFee:   true,
        total:         true,
        referralOrder: { select: { id: true } },
      },
    })

    const ordersTotal = orders.length
    if (ordersTotal === 0) {
      return NextResponse.json(empty)
    }
    const orderIds = orders.map(o => o.id)

    // caBrut — gross revenue (sum of basket subtotals, delivery fees excluded:
    // they are pass-through to the courier, not restaurateur revenue).
    const caBrut = round2(orders.reduce((s, o) => s + o.subtotal, 0))

    // commissionGrubano — Grubano's 10 % basket commission (same rate the
    // checkout freezes on each ReferralOrder.grubanoFee).
    const commissionGrubano = round2(caBrut * GRUBANO_FEE_PCT)

    // verseAuxCreateurs — the REAL recipe cost paid to creators: the sum of the
    // FROZEN DishSale.creatorEarning for sales tied to these orders (4 % or 1 %
    // per levier 1, already frozen at order time — we never recompute it here).
    const dishAgg = await prisma.dishSale.aggregate({
      where: { orderId: { in: orderIds } },
      _sum:  { creatorEarning: true },
    })
    const verseAuxCreateurs = round2(dishAgg._sum.creatorEarning ?? 0)

    // remisesFinancees — welcome discounts THIS restaurant funded. There is no
    // dedicated discount column on Order, so we recover it per order as
    // discount = subtotal + deliveryFee − total (the amount knocked off the
    // total at checkout). We sum only the POSITIVE values: rounding noise or a
    // future surcharge must never inflate the figure into a negative "discount".
    const remisesFinancees = round2(
      orders.reduce((s, o) => {
        const d = round2(o.subtotal + o.deliveryFee - o.total)
        return s + (d > 0 ? d : 0)
      }, 0),
    )

    // netResto — what the restaurateur actually keeps after Grubano's
    // commission, the creator recipe cost, and the discounts they funded.
    const netResto = round2(
      caBrut - commissionGrubano - verseAuxCreateurs - remisesFinancees,
    )

    // ── VALUE side: CA brought IN by creators ───────────────────────────────
    // Orders that carry a ReferralOrder came from a creator's referral traffic
    // (the customer used a creator code). Their subtotal is MEASURED incremental
    // revenue, not an estimate. This is the value that justifies the cost above.
    const creatorOrders        = orders.filter(o => o.referralOrder !== null)
    const ordersFromCreators   = creatorOrders.length
    const caAmeneParCreateurs  = round2(
      creatorOrders.reduce((s, o) => s + o.subtotal, 0),
    )

    return NextResponse.json({
      windowDays:          30,
      caBrut,
      commissionGrubano,
      verseAuxCreateurs,
      remisesFinancees,
      netResto,
      caAmeneParCreateurs,
      ordersFromCreators,
      ordersTotal,
    })
  } catch (err) {
    // Never 500 the page: log and degrade to a clean zero-filled summary.
    console.error('[GET /api/finance/summary]', err)
    return NextResponse.json(empty)
  }
}
