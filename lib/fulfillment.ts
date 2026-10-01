import { NextResponse } from 'next/server'

// ── P0-01 — pilot Q1: the SERVER decides which fulfillment modes exist ─────────
//
// Founder decision Q1: the pilot is PICKUP-ONLY. Before this file, that decision
// was held ONLY by the /eat cart UI — POST /api/orders happily accepted (and even
// DEFAULTED to) 'delivery', and never read the Restaurant.deliveryEnabled /
// pickupEnabled columns that exist since the multi-establishment work.
//
// WHY A FLAG and not hard-code: delivery must come back after the pilot WITHOUT a
// rewrite. The rule is therefore layered:
//
//   1. DELIVERY_FULFILLMENT_ENABLED (env, default OFF) — the PILOT switch. OFF →
//      'delivery' is refused for EVERYONE, whatever the restaurant row says. This
//      is the Q8 doctrine applied to Q1: unavailable server-side, not just hidden.
//   2. Restaurant.deliveryEnabled / pickupEnabled (DB columns) — the PER-RESTAURANT
//      capability, enforced in BOTH modes. After the pilot, flipping the env flag
//      re-opens delivery and the columns take over as the only gate — no code
//      change. During the pilot the flag keeps delivery closed even if a column is
//      mis-set (defence in depth).
//
// STRICT comparisons (`!== true` / `=== 'true'`): pickupEnabled defaults to FALSE
// in the schema — a restaurant must be explicitly opted in to the pilot (ops
// action, see docs/ops/flags.md). An undefined/legacy row can never silently open
// a channel.
export function isDeliveryFulfillmentEnabled(): boolean {
  return process.env.DELIVERY_FULFILLMENT_ENABLED === 'true'
}

export type FulfillmentType = 'delivery' | 'pickup'

/**
 * Returns the refusal response for a forbidden (mode × restaurant) combination,
 * or null when the order may proceed. Pure decision (unit-tested); the caller
 * returns the response BEFORE any order write.
 */
export function refuseForbiddenFulfillment(
  fulfillmentType: FulfillmentType,
  restaurant: { deliveryEnabled?: boolean | null; pickupEnabled?: boolean | null },
): NextResponse | null {
  if (fulfillmentType === 'delivery') {
    if (!isDeliveryFulfillmentEnabled()) {
      return NextResponse.json(
        {
          error: 'La livraison n’est pas disponible pour le moment — commande à retirer sur place uniquement.',
          code:  'delivery_disabled',
        },
        { status: 403 },
      )
    }
    if (restaurant.deliveryEnabled !== true) {
      return NextResponse.json(
        { error: 'Ce restaurant ne propose pas la livraison.', code: 'delivery_disabled_restaurant' },
        { status: 403 },
      )
    }
    return null
  }
  if (restaurant.pickupEnabled !== true) {
    return NextResponse.json(
      { error: 'Ce restaurant ne propose pas le retrait sur place pour le moment.', code: 'pickup_disabled_restaurant' },
      { status: 403 },
    )
  }
  return null
}
