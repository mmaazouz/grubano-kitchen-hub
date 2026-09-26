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
        // T-46: the join between this screen's REVENUE population and the ledger's refund lines.
        stripePaymentIntentId: true,
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
      // D′ L8 (T-46): `type`, `grossAmount`, `netToRestaurant` and the PaymentIntent are read in the SAME
      // query so the refund figures below cost no extra round-trip. The commission sum is unchanged — it
      // still adds `applicationFeeAmount` over all three types, refund lines included.
      select: { type: true, applicationFeeAmount: true, grossAmount: true, netToRestaurant: true, stripePaymentIntentId: true },
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
    // AND `netResto` SUBTRACTS `refundedCents` — founder arbitration of 2026-09-26, after the mandatory
    // double-count guard MEASURED that the returned fee already re-enters through the refund-net
    // commission. The full reasoning and the algebra sit on the `netResto` line below; the short version is
    // that the gross is the term which makes the total variation equal `netToRestaurant`, the same integer
    // the per-claim block shows the restaurant. `netReversedCents` is EXPOSED for reading and is never
    // subtracted — doing so would credit the restaurant with the returned fee twice.
    // ── THE SAME POPULATION ON BOTH SIDES, and this is the load-bearing part ────────────────────────
    //
    // `caBrut` is ORDER revenue: `Σ Order.subtotal` over this window's non-cancelled orders. The ledger,
    // by contrast, carries every rail this restaurant is paid on — a DINE-IN bill (`TableTicket`, a
    // `payment` line with a `ticketId` and no Order) and a captured no-show DEPOSIT (`deposit_capture`)
    // both belong to it. Summing « all refund lines of the window » and subtracting that from an
    // order-only revenue base produces a PHANTOM LOSS: refunding a 50 € dine-in bill in full is a
    // net-zero event for the restaurant, and an unscoped subtraction would have shown −47,50 € on a
    // screen that never counted the 50 €. Found by the adversarial review OF THIS CHANGE.
    //
    // So the refund figures are restricted to the PaymentIntents of the orders this screen counts. Both
    // sides of the P&L then describe one population, and two edges follow for free: a refund whose order
    // has aged out of the window is excluded (its revenue is out too), and a window with no orders has no
    // in-scope refunds rather than a silently dropped subtraction.
    const windowOrderPis = new Set(
      orders.map((o) => o.stripePaymentIntentId).filter((x): x is string => !!x),
    )
    const refundLines = feeLines.filter((l) => l.type === 'refund'
      && !!l.stripePaymentIntentId && windowOrderPis.has(l.stripePaymentIntentId))
    const refundsCount = refundLines.length
    const refundedCents = refundLines.reduce((s, l) => s + Math.max(0, -l.grossAmount), 0)
    // Σ of what was actually pulled FROM the restaurant. `max(0, …)` because a refund issued with no
    // transfer reversal leaves `netToRestaurant` POSITIVE — nothing was reversed, so nothing is counted
    // here; that shape is owned by the `refund_without_reverse_transfer` money-review alert.
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
    //
    // ── T-46 (arbitrage fondateur, 2026-09-26) — POURQUOI LE BRUT ET NON LE NET REPRIS ──────────────
    //
    // LE DÉFAUT. `caBrut` est `Σ Order.subtotal` sur les commandes non annulées : un remboursement ne le
    // diminue JAMAIS. `commissionGrubano` ci-dessus somme en revanche les lignes ledger `refund`, dont
    // l'`applicationFeeAmount` est NÉGATIF — elle est donc refund-nette (épingle spec v2 §7.3). Les deux
    // moitiés du même P&L ne décrivaient plus la même réalité, et `netResto` bougeait dans le MAUVAIS
    // SENS : le chiffre d'affaires restait, la commission baissait, donc le net du restaurateur MONTAIT
    // après un départ d'argent. Mesuré : 88,00 → 88,40 sur un remboursement de 5,00 €.
    //
    // POURQUOI `refundedCents` ET NON `netReversedCents`. Parce que soustraire une commission PLUS PETITE
    // rajoute déjà les frais restitués :
    //     netResto = caBrut − (feeCharged − feeReturned) − … = caBrut − feeCharged + feeReturned − …
    // Soustraire `netReversedCents` (= reprise − frais restitués) PAR-DESSUS créditerait le restaurant des
    // frais restitués DEUX FOIS : 88,40 − 4,60 = 83,80, soit 0,40 € au-dessus de la vérité. Le brut donne
    // 88,40 − 5,00 = 83,40, et la variation totale vaut alors :
    //     +(R − V + F)/100 − R/100 = (F − V)/100 = netToRestaurant/100
    // c'est-à-dire EXACTEMENT l'impact net de la ligne ledger — `restaurantNetImpactCents`, le même entier
    // que le bloc par réclamation montre au restaurant. L'identité est ALGÉBRIQUE : elle ne dépend pas du
    // montant de la reprise (elle tient aussi quand Grubano a absorbé une partie), et le sweep du test la
    // vérifie sur plusieurs couples.
    //
    // À NE JAMAIS FAIRE (contrat figé) : soustraire `netReversedCents` une seconde fois, ou réintroduire
    // `grubanoFeeReturnedCents` ailleurs dans ce calcul. Trois contrôles négatifs le tiennent dans
    // tests/finance-summary-ledger.test.ts.
    const netResto = round2(
      caBrut - commissionGrubano - verseAuxCreateurs - remisesFinancees - refundedCents / 100,
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
      // T-46: measured from the ledger. `netResto` above DOES move because of `refundedCents` — that is the
      // whole point of the ticket — and the /finance page folds the same term into the « FRAIS » total it
      // prints, so the equation on screen stays checkable by hand. `netReversedCents` and `refundsCount`
      // are read-only: nothing is computed from them here.
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
