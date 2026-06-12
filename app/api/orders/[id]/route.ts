import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

// ── Mock driver location (replace with real Uber Direct polling) ──────────────

function mockDriverLocation(status: string) {
  const locations: Record<string, { lat: number; lng: number; bearing: number }> = {
    picked_up: { lat: 48.8566 + (Math.random() - 0.5) * 0.02, lng: 2.3522 + (Math.random() - 0.5) * 0.02, bearing: 45  },
    delivered: { lat: 48.8566,  lng: 2.3522,  bearing: 0  },
  }
  return locations[status] ?? null
}

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
            deliveryTime: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }

    // Consumers can only see their own orders; restaurant/admin can see any
    const role = token.role as string
    const isOwner = order.consumerId === token.sub
    const isStaff = ['restaurant', 'admin'].includes(role)
    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

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
        driverLocation:  mockDriverLocation(order.status),
      },
    })
  } catch (err) {
    console.error('[GET /api/orders/:id]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
