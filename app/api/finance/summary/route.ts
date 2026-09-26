import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Reading session → never statically prerendered.
export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

// Roles allowed to see an operator's financial P&L.
const ALLOWED_ROLES = new Set(['restaurant', 'admin'])

// ── GET /api/finance/summary ────────────────────────────────────────────────
// Real restaurateur P&L over a rolling 30-day window, with creator COST and
// creator VALUE side by side. READ-ONLY: no write, no migration — every figure
// is derived from existing Order / DishSale / ReferralOrder / LedgerEntry rows.
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
    // D′ L8 (T-46) — see below. Zero-filled like the rest so the page never reads `undefined`.
    refundedCents:       0,
    netReversedCents:    0,
    refundsCount:        0,
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

    // commissionGrubano — the commission Grubano ACTUALLY kept over the window,
    // READ from the stamped ledger (V3-2). LedgerEntry.applicationFeeAmount is
    // frozen per transaction by the payment rail (per-channel 12/8/5/0 grid,
    // per-establishment overrides, founders 0 % offer — lib/commission at charge
    // time), so this screen shows the stamped truth, never a flat-rate estimate.
    // Same money-in/refund semantics as GET /api/restaurants/[id]/finance/summary
    // (rail A7, the ledger-reading reference): refund lines carry NEGATIVE
    // amounts, so summing payment + deposit_capture + refund yields the NET fee
    // kept. A flow with no ledger line (e.g. cash) shows no fee — because none
    // was taken.
    const feeLines = await prisma.ledgerEntry.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        createdAt:    { gte: windowStart, lte: now },
        type:         { in: ['payment', 'deposit_capture', 'refund'] },
      },
      // D′ L8 (T-46): `type`, `grossAmount` and `netToRestaurant` are read in the SAME query so the refund
      // figures below cost no extra round-trip. The commission sum is unchanged.
      select: { type: true, applicationFeeAmount: true, grossAmount: true, netToRestaurant: true },
    })
    const commissionGrubano = round2(
      feeLines.reduce((s, l) => s + l.applicationFeeAmount, 0) / 100,
    )

    // ── T-46 — THE REFUNDS THIS SCREEN USED TO BE BLIND TO ───────────────────────────────────────
    //
    // THE DEFECT (GO-LIVE-TICKETS T-46, found by the closeout's adversarial review). `caBrut` above is
    // `Σ Order.subtotal` over non-cancelled orders, so a refund NEVER reduces it. `commissionGrubano`, on
    // the other hand, sums ledger lines — and a refund line carries a NEGATIVE `applicationFeeAmount`, so
    // it IS refund-aware. The two halves of the same P&L therefore stopped describing the same reality,
    // and `netResto = caBrut − commission − …` moved the WRONG WAY when a refund arrived: the revenue
    // stayed, the commission fell, and the restaurateur's net went UP after money left their account.
    //
    // WHAT IS ADDED: the three measured figures spec v2 §7.3 names, all from the ledger `refund` lines of
    // the window — the same source as the per-claim block (S-19), never `Refund` fields (predictions).
    //   refundedCents    Σ what customers actually got back        (= Σ −grossAmount)
    //   netReversedCents Σ what was actually pulled FROM this restaurant (= Σ max(0, −netToRestaurant))
    //   refundsCount     how many refund lines the window carries
    //
    // WHY `max(0, …)`: on a refund issued with no transfer reversal, `netToRestaurant` is POSITIVE (the
    // platform bore the refund and the fee refund landed on the connected account). That is not a reversal,
    // and counting it as one would understate what the restaurant gave back. It is the shape the money
    // rails already alert on (`refund_without_reverse_transfer`).
    //
    // WHAT IS **NOT** CHANGED, DELIBERATELY: `netResto`. The ticket says the remediation — derive `caBrut`
    // from the ledger, or subtract the refund lines — is « à trancher » by the founder, and the two
    // candidates do not give the same number. Worked example, 5,00 € refunded with 0,40 € of commission
    // returned: `caBrut` still counts 5,00 and the commission kept falls to 0, so subtracting the 4,60
    // actually reversed leaves a residue of exactly the returned commission (net 0,40 instead of 0), while
    // subtracting the full 5,00 lands on 0. Moving a restaurateur's net on that choice is not a decision to
    // make inside a projection lot, so the figures are EXPOSED and the arithmetic is left alone until the
    // founder rules. The screen can now show the refunds; it no longer has to imply they did not happen.
    const refundLines = feeLines.filter((l) => l.type === 'refund')
    const refundsCount = refundLines.length
    const refundedCents = refundLines.reduce((s, l) => s + Math.max(0, -l.grossAmount), 0)
    const netReversedCents = refundLines.reduce((s, l) => s + Math.max(0, -l.netToRestaurant), 0)

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
      // T-46: measured, additive, and no existing figure moves because of them.
      refundedCents,
      netReversedCents,
      refundsCount,
    })
  } catch (err) {
    // Never 500 the page: log and degrade to a clean zero-filled summary.
    console.error('[GET /api/finance/summary]', err)
    return NextResponse.json(empty)
  }
}
