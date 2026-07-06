import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { isLogisticsDistanceFeeEnabled, resolveDistanceDeliveryFee } from '@/lib/logistics-fee'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/logistics/fee-preview — cart delivery-fee PREVIEW (P4.3 ÉTAPE 5) ────────
// Lets the cart PREVIEW the delivery fee the server will charge, so the displayed fee is
// CONSISTENT with what POST /api/orders computes (lifts the ÉTAPE 4 go-live signal). READ-
// ONLY, money-neutral: it computes NOTHING that is charged here — the server stays
// authoritative at order time.
//   • LOGISTICS_DISTANCE_FEE_ENABLED OFF (default) → { enabled:false }. The cart never calls
//     this (it reads distanceFeeEnabled from the restaurant detail first) and shows the FLAT
//     Restaurant.deliveryFee → byte-identical. Defensive: a stray call still returns enabled:false.
//   • ON → geocode the address + apply the SAME barème (lib/logistics-fee) as the order path.
//     FAIL-OPEN: if geocoding fails, return the FLAT fee (mode:'flat') so the cart degrades to
//     the current forfait — a preview hiccup never blocks or mis-quotes.
// Public (the cart is public) + rate-limited (it geocodes). No auth, no owner data.

const previewSchema = z.object({
  restaurantId: z.string().min(1),
  address:      z.string().min(1).max(200),
})

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(req, 'fee_preview', { limitDefault: 40, windowDefault: 60 })
    if (limited) return limited

    // Flag OFF (default) → honest no-op; the cart keeps its flat fee → byte-identical.
    if (!isLogisticsDistanceFeeEnabled()) {
      return NextResponse.json({ enabled: false })
    }

    const body = await req.json().catch(() => null)
    const parsed = previewSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

    const restaurant = await prisma.restaurant.findFirst({
      where:  { id: parsed.data.restaurantId, archivedAt: null },
      select: { lat: true, lng: true, city: true, deliveryFee: true },
    })
    if (!restaurant) return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })

    const flatFeeCents = Math.round(restaurant.deliveryFee * 100)
    const distFee = await resolveDistanceDeliveryFee(restaurant, parsed.data.address)
    if (distFee) {
      return NextResponse.json({ enabled: true, mode: 'distance', feeCents: distFee.feeCents })
    }
    // Geocoding unavailable → fall back to the flat fee (same as the order path's fallback).
    return NextResponse.json({ enabled: true, mode: 'flat', feeCents: flatFeeCents })
  } catch (err) {
    console.error('[POST /api/logistics/fee-preview]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
