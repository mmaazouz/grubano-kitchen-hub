import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'
import { coarsenLatLng, etaMinutes } from '@/lib/courier-position-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/orders/:id/courier-position — Géoloc ÉTAPE 4 (affichage, RGPD-sensible) ──────────
// Returns the delivery courier's position for THIS order, role-differentiated:
//   • the ORDER OWNER (consumer, order.consumerId === session) → position GROSSIE (coarsened,
//     never exact — reciprocal of the S1 dropoff masking).
//   • ADMIN / support (whitelist = admin role) → EXACT position.
//   • the RESTAURANT operator (even one owning the order's establishment) → FORBIDDEN (403). The
//     restaurant never sees the courier position.
//   • anyone else → 403/404 (no IDOR — never another order's courier).
// GATED by LOGISTICS_TRACKING_ENABLED: OFF (default) → 404 BEFORE any position read → no display,
// byte-identical. Returns { available:false } when there is no in-course mission / no point yet.
// The pickup (restaurant) + dropoff (the caller's own delivery address) are exact anchors for the
// map; ONLY the courier point is coarsened for the client. ETA is computed server-side from the
// EXACT courier point and only the integer minutes is exposed.

interface Point { lat: number; lng: number }
const NONE = { available: false as const }

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Feature-gated FIRST — OFF → no position display at all (byte-identical), no position read.
    if (!isLogisticsTrackingEnabled()) {
      return NextResponse.json({ available: false, gated: true }, { status: 404 })
    }

    const token = await getToken({ req })
    if (!token) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

    const order = await prisma.order.findUnique({
      where: { id: params.id },
      select: {
        id: true, consumerId: true, restaurantId: true,
        deliveryLat: true, deliveryLng: true,
        restaurant: { select: { lat: true, lng: true } },
      },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })

    // Role gate. Owner (consumer) → coarsened. Admin → exact. Everyone else (incl. the restaurant
    // operator that owns the establishment) → forbidden: the courier position is NOT theirs to see.
    const isOwner = order.consumerId === token.sub
    let exact = false
    if (isOwner) {
      exact = false
    } else {
      const scope = await resolveEstablishmentScope(null)
      if (scope.ok && scope.role === 'admin') {
        exact = true
      } else {
        // A restaurant operator (or any non-owner non-admin) is refused — never expose the courier.
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
    }

    // The order's in-course delivery mission (accepted/picked_up) and its courier's last point.
    const mission = await prisma.mission.findFirst({
      where: { orderId: order.id, status: { in: ['accepted', 'picked_up'] } },
      orderBy: { acceptedAt: 'desc' },
      select: { id: true, courierId: true, status: true },
    })
    if (!mission || !mission.courierId) return NextResponse.json(NONE)

    const point = await prisma.courierPosition.findUnique({
      where: { courierId_missionId: { courierId: mission.courierId, missionId: mission.id } },
      select: { lat: true, lng: true, updatedAt: true },
    })
    if (!point) return NextResponse.json(NONE)

    // Anchors (exact — the restaurant is public, the dropoff is the caller's own address / admin).
    const pickup: Point | null =
      order.restaurant?.lat != null && order.restaurant?.lng != null
        ? { lat: order.restaurant.lat, lng: order.restaurant.lng } : null
    const dropoff: Point | null =
      order.deliveryLat != null && order.deliveryLng != null
        ? { lat: order.deliveryLat, lng: order.deliveryLng } : null

    // ETA from the EXACT courier point → dropoff (only the minutes is exposed, never the exact pt).
    const eta = dropoff ? etaMinutes({ lat: point.lat, lng: point.lng }, dropoff) : null

    // The courier point: EXACT for admin, GROSSIE for the client (never exact to a client).
    const courier: Point = exact
      ? { lat: point.lat, lng: point.lng }
      : coarsenLatLng(point.lat, point.lng)

    return NextResponse.json({
      available: true,
      approx: !exact,
      courier,
      pickup,
      dropoff,
      etaMinutes: eta,
      status: mission.status,
      updatedAt: point.updatedAt,
    })
  } catch (err) {
    console.error('[GET /api/orders/[id]/courier-position]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
