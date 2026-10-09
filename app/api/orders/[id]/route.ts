import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { loadOrderRefundSummary, emptyRefundSummary, summaryAnomaly } from '@/lib/order-refund-summary'

// La « position livreur » mockée (coordonnées ALÉATOIRES dans Paris, servies
// comme réelles sur picked_up) est retirée : aucun rail livreur n'est actif.
// La position réelle, quand elle existera, passe par le rail courier-position
// (flag-gated, coarsened côté client) — ce payload sert null en attendant.

// ── GET /api/orders/:id ───────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    const order = await prisma.order.findUnique({
      where: { id: params.id },
      include: {
        restaurant: {
          select: {
            id:           true,
            name:         true,
            logo:         true,
            address:      true,
            city:         true,
            // WAVE 1 — coords pour le lien « Voir l'itinéraire » du pass de retrait
            // (destination précise si le resto est géocodé ; repli adresse texte sinon).
            lat:          true,
            lng:          true,
            deliveryTime: true,
            // Lot véracité : durée de préparation SAISIE par le restaurateur
            // (/dashboard/fulfillment) — la seule donnée temps honnête du pass.
            pickupPrepTime: true,
            deliveryPrepTime: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }

    // A consumer may read ONLY their own order (byte-identical). A staff caller
    // previously could read ANY order by id (IDOR — leaking deliveryAddress /
    // paymentMethod / tipCents / loyaltyCredit). Now an operator must OWN the
    // order's establishment; admin stays superuser. Cross-tenant → 404 (existence
    // not confirmed). A non-owner consumer still gets 403 here: resolveEstablishmentScope
    // returns {ok:false,403} for a non-operator role — preserving the old behaviour.
    const isOwner = order.consumerId === token.sub
    if (!isOwner) {
      const scope = await resolveEstablishmentScope(null)
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
      }
      if (scope.role !== 'admin' && !scope.ownedIds.includes(order.restaurantId)) {
        return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
      }
    }

    // ── ADDITIVE (P2-TIP) — the courier tip charged at checkout (cents), for the
    // post-delivery RECAP. SEPARATE guarded read: the tipCents column is new (its
    // db push), so a deploy before the push degrades to 0 (no recap line) rather
    // than 500. The main order query (above) does not select it for that reason.
    let tipCents = 0
    try {
      const extra = await prisma.order.findUnique({ where: { id: order.id }, select: { tipCents: true } })
      tipCents = extra?.tipCents ?? 0
    } catch { /* column missing pre-db-push → 0 */ }

    // ── ADDITIVE (chantier P2) — promo display data for the checkout recap.
    // discount + promotionId were resolved SERVER-side by P1 at order creation;
    // this only SURFACES them (+ the promo's display name). Defensive: a name
    // lookup failure degrades to a nameless discount line, never a 500.
    let promotion: { id: string; name: string } | null = null
    if (order.promotionId) {
      try {
        const p = await prisma.promotion.findUnique({
          where:  { id: order.promotionId },
          select: { id: true, name: true },
        })
        if (p) promotion = p
      } catch { /* nameless line */ }
    }

    // ── ADDITIVE (D′ L9 / T-45) — WHAT A REFUND DID TO THIS ORDER ────────────────────────────────
    //
    // Until this lot the consumer app could not tell a refunded order from a paid one. Worse, it asserted
    // the opposite: `paymentStatus` below still reads 'paid' (by design — it describes the PAYMENT, and
    // §2 of the L9 decision keeps it that way), and `pointsEarned` below is the pre-refund column, which
    // is never decremented. So a fully refunded order rendered « Total payé 14,50 € » and « +14 points
    // fidélité crédités » with nothing to contradict it.
    //
    // `refundSummary` is the additive read-model that carries the truth instead. It is computed ONLY for a
    // terminal order that has a PaymentIntent (§9), so the 15-second tracking poll of an order still in
    // preparation costs exactly ZERO extra queries; for a terminal one it costs three, all batched, none
    // per-row, and no Stripe call — a Stripe outage must never delay this page.
    //
    // A read that throws degrades to the stable empty shape rather than 500-ing the order: a customer must
    // be able to open their order even when the refund side is unreadable, and « nothing shown » is the
    // honest answer when nothing can be proven. Never a partial summary — §10 requires one stable shape.
    let refundSummary = emptyRefundSummary()
    try {
      refundSummary = await loadOrderRefundSummary(prisma, {
        id: order.id, status: order.status, total: order.total,
        stripePaymentIntentId: order.stripePaymentIntentId,
      })
      const anomaly = summaryAnomaly(refundSummary)
      if (anomaly) console.error(`[MONEY REVIEW] [refund_summary_anomaly] order ${order.id}: ${anomaly}`)
    } catch (e) {
      console.error('[GET /api/orders/:id] refundSummary unreadable (degraded to empty):', order.id, e instanceof Error ? e.message : e)
    }

    // The response NAMES the identity the server AUTHENTICATED, so a consumer surface can
    // refuse a body the browser attached a newer cookie to while React still believes the
    // previous account. `ownerId` is `token.sub` — the raw id of the ACTUAL caller — never
    // `order.consumerId`: a staff operator or admin can legitimately read someone else's
    // order here, and stamping the response with the queried consumer's id would hand the
    // tracking page a false identity match. Additive — existing callers destructure `order`
    // and ignore the rest.
    const ownerId: string | null = typeof token?.sub === 'string' ? token.sub : null

    return NextResponse.json({
      ownerId,
      order: {
        id:              order.id,
        status:          order.status,
        // fulfillmentType drives the entire /eat/track UI (pickup vs delivery)
        // — without it the page renders the mock delivery map for pickup
        // orders, which is absurd. Defaults to 'delivery' (matches schema).
        fulfillmentType: order.fulfillmentType,
        items:           order.items,
        subtotal:        order.subtotal,
        deliveryFee:     order.deliveryFee,
        total:           order.total,
        // Additive (P2) — the server-resolved discount + its promo (display).
        discount:        order.discount,
        promotion,
        // Additive (L2) — the SERVER-resolved loyalty credit (cents) + the
        // points it spent. Distinct from `discount` so the checkout recap shows
        // « Crédit fidélité » on its own line, never folded into the promo line.
        // Read-only: resolveLoyaltyCredit (L1) already wrote these at checkout.
        loyaltyCreditCents: order.loyaltyCreditCents,
        pointsRedeemed:     order.pointsRedeemed,
        // Additive (P2-TIP) — the courier tip charged at checkout (cents). Drives
        // the post-delivery recap line « pourboire ajouté · X € ». 0 = no tip.
        tipCents,
        estimatedTime:   order.estimatedTime,
        trackingUrl:     order.trackingUrl,
        deliveryAddress: order.deliveryAddress,
        paymentMethod:   order.paymentMethod,
        // Checkout C2 (additive) — null = legacy/not initiated, 'pending' = PI
        // created, 'paid' = webhook-confirmed (C1 contract).
        paymentStatus:   order.paymentStatus,
        // PRE-REFUND COLUMN, kept for compatibility and NO LONGER the whole truth: a consumer surface must
        // read `refundSummary.pointsReversed` beside it before saying anything about points. Never
        // decremented on a refund — that is a schema fact, not an oversight this lot may fix (T-44 / L6.1
        // own the loyalty numbers).
        pointsEarned:    order.pointsEarned,
        // D′ L9 (T-45): additive, always present, never undefined on any path.
        refundSummary,
        createdAt:       order.createdAt,
        updatedAt:       order.updatedAt,
        restaurant:      order.restaurant,
        driverLocation:  null,
      },
    })
  } catch (err) {
    console.error('[GET /api/orders/:id]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
