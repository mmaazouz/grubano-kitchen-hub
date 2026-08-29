import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

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

    return NextResponse.json({
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
        pointsEarned:    order.pointsEarned,
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
