// lib/delivery-zone.ts — WP-DZONE-01 delivery-zone enforcement (flag-gated, PURE
// logic + one geocode call). A DELIVERY order is rejected when its address is
// PROVABLY outside the restaurant's deliveryRadius. Money-neutral: this NEVER
// changes an amount, a fee, the commission or a ledger line — it only ACCEPTS or
// REJECTS an order before it is created.
//
// CENTRAL INVARIANT — gated by DELIVERY_ZONE_ENFORCEMENT (default OFF):
//   OFF → checkDeliveryZone is never called from the route; POST /api/orders is
//   BYTE-IDENTICAL to today (no geocode, no new query — the restaurant row is
//   already loaded). The rail is a no-op until the flag is flipped on.
//
// FAIL-OPEN by design: enforcement rejects ONLY when it can CONFIDENTLY geocode
// the address AND it is beyond the radius. Every uncertainty — restaurant not yet
// geocoded (lat/lng null), no radius configured, BAN unreachable, or the address
// unresolved — ALLOWS the order. A legitimate customer is never blocked by
// geocoding noise or a third-party outage; enforcement only ever tightens a case
// we are sure about.

import { geocodeAddressDetailed, haversineKm } from '@/lib/geocode'

/** Kill-switch for delivery-zone enforcement. Default OFF — only the exact string
 *  'true' enables it. */
export function isDeliveryZoneEnforcementEnabled(): boolean {
  return process.env.DELIVERY_ZONE_ENFORCEMENT === 'true'
}

/** The minimal restaurant shape the zone check needs — a subset of the Restaurant
 *  row already loaded by POST /api/orders (no extra query). */
export interface ZoneRestaurant {
  lat: number | null
  lng: number | null
  city: string
  deliveryRadius: number // km
}

export type ZoneCheck =
  | { ok: true; reason: 'disabled_or_uncertain' | 'in_zone'; distanceKm?: number; radiusKm?: number }
  | { ok: false; reason: 'out_of_zone'; distanceKm: number; radiusKm: number }

/**
 * Returns { ok:false, reason:'out_of_zone' } ONLY when the address geocodes
 * cleanly AND its distance to the restaurant exceeds deliveryRadius. Every other
 * path returns { ok:true } (fail-open):
 *   • restaurant not geocoded (lat/lng null)      → allow (backfill via geocode script)
 *   • deliveryRadius <= 0 (not configured)        → allow (no zone to enforce)
 *   • BAN 'unavailable' (outage / rate-limit)     → allow (third-party fault, not the user)
 *   • BAN 'not_found' (typo / unindexed address)  → allow (never reject on a soft miss)
 *   • distance <= radius                          → allow (in zone)
 */
export async function checkDeliveryZone(
  restaurant: ZoneRestaurant,
  address: string,
): Promise<ZoneCheck> {
  // Restaurant not geocoded yet → cannot measure a distance → allow.
  if (restaurant.lat == null || restaurant.lng == null) {
    return { ok: true, reason: 'disabled_or_uncertain' }
  }
  const radiusKm = restaurant.deliveryRadius
  // No usable radius → nothing to enforce.
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    return { ok: true, reason: 'disabled_or_uncertain' }
  }

  // Geocode the free-text delivery address (BAN, city sharpens the match).
  const geo = await geocodeAddressDetailed(address, restaurant.city)
  // Only a confident 'ok' can reject; 'not_found' / 'unavailable' → allow.
  if (geo.status !== 'ok') {
    return { ok: true, reason: 'disabled_or_uncertain' }
  }

  const distanceKm = haversineKm(
    { latitude: restaurant.lat, longitude: restaurant.lng },
    geo.coords,
  )
  if (distanceKm > radiusKm) {
    return { ok: false, reason: 'out_of_zone', distanceKm, radiusKm }
  }
  return { ok: true, reason: 'in_zone', distanceKm, radiusKm }
}
