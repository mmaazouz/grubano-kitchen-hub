// Distance-based delivery fee (rail livreur P4.3 ÉTAPE 4 — barème par distance).
//
// Replaces the FLAT Restaurant.deliveryFee with a base + per-km barème computed on the
// haversine distance between the restaurant and the geocoded client address. Everything
// here is integer CENTS and the barème is a PURE function (fully unit-tested); the only
// I/O is one BAN geocode in resolveDistanceDeliveryFee (a calque of lib/delivery-zone's
// fail-open geocoding — a hiccup NEVER blocks or reprices the order punitively).
//
// CENTRAL INVARIANT — gated by LOGISTICS_DISTANCE_FEE_ENABLED (default OFF):
//   OFF → the route never calls this; POST /api/orders keeps the FLAT Restaurant.deliveryFee,
//   BYTE-IDENTICAL to today (no geocode, no coords stored). The barème is inert until the
//   flag is flipped on. This changes ONLY the delivery-fee AMOUNT; the case-A/case-B routing
//   (ÉTAPE 3) reads the stored Order.deliveryFee unchanged.
//
// ⚠️ GO-LIVE COUPLING: when the flag is ON, the SERVER prices the fee by distance while the
// cart still previews the FLAT fee until the ÉTAPE 5 screens surface it — so flip this flag
// TOGETHER with the ÉTAPE 5 consumer surfaces (staging-only mismatch otherwise). The server
// stays authoritative for the charge (anti-fraud).
//
// The barème parameters are configurable in CENTS via env (reasonable placeholders; the final
// figures are calibrated later). All are validated (reject NaN / negative → the default).
import { geocodeAddressDetailed, haversineKm, type GeoCoords } from '@/lib/geocode'

/** Kill-switch — default OFF. Only the exact string 'true' enables the distance barème. */
export function isLogisticsDistanceFeeEnabled(): boolean {
  return process.env.LOGISTICS_DISTANCE_FEE_ENABLED === 'true'
}

/** Read a non-negative integer-cents env param; NaN / negative / missing → fallback. */
function readCents(envName: string, fallback: number): number {
  const v = Number.parseInt(process.env[envName] ?? '', 10)
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

// Placeholder defaults (only apply when the flag is ON): €1.50 base + €0.50/km, floored at
// €1.99 (the current flat floor) and capped at €9.00. To be calibrated with real figures.
export function logisticsFeeBaseCents():  number { return readCents('LOGISTICS_FEE_BASE_CENTS', 150) }
export function logisticsFeePerKmCents(): number { return readCents('LOGISTICS_FEE_PER_KM_CENTS', 50) }
export function logisticsFeeMinCents():   number { return readCents('LOGISTICS_FEE_MIN_CENTS', 199) }
export function logisticsFeeMaxCents():   number { return readCents('LOGISTICS_FEE_MAX_CENTS', 900) }

/**
 * PURE — the distance delivery fee in integer CENTS:
 *   clamp( round(base + perKm × distanceKm), min, max )
 * distanceKm is coerced to ≥ 0 (haversine is never negative; a NaN/negative degrades to 0,
 * i.e. the fee floors at the base/min). If the config is inverted (min > max, a misconfig)
 * the clamp returns `max` — a safe, bounded value (never unbounded, never negative). Fully
 * testable, no I/O, no Float money (integer cents in, integer cents out).
 */
export function computeDistanceFeeCents(distanceKm: number): number {
  const km  = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0
  const raw = Math.round(logisticsFeeBaseCents() + logisticsFeePerKmCents() * km)
  const min = logisticsFeeMinCents()
  const max = logisticsFeeMaxCents()
  return Math.min(Math.max(raw, min), max)
}

/** The minimal restaurant shape the fee resolver needs — a subset of the Restaurant row
 *  already loaded by POST /api/orders (no extra query). */
export interface FeeRestaurant {
  lat:  number | null
  lng:  number | null
  city: string
}

export type DistanceFeeResult = { feeCents: number; distanceKm: number; coords: GeoCoords }

/**
 * Geocode the free-text client address + compute the distance fee. Returns null on ANY
 * failure so the caller falls back to the FLAT fee (fail-open, like checkDeliveryZone):
 *   • restaurant not geocoded (lat/lng null)   → null
 *   • BAN 'unavailable' (outage / rate-limit)  → null
 *   • BAN 'not_found' (typo / unindexed)       → null
 * NEVER throws (geocodeAddressDetailed already catches; the extra try/catch is a belt).
 * On success returns the fee (cents), the distance, and the coords (for MINIMAL storage).
 */
export async function resolveDistanceDeliveryFee(
  restaurant: FeeRestaurant,
  address: string,
): Promise<DistanceFeeResult | null> {
  if (restaurant.lat == null || restaurant.lng == null) return null
  let geo
  try {
    geo = await geocodeAddressDetailed(address, restaurant.city)
  } catch {
    return null
  }
  if (geo.status !== 'ok') return null
  const distanceKm = haversineKm({ latitude: restaurant.lat, longitude: restaurant.lng }, geo.coords)
  return { feeCents: computeDistanceFeeCents(distanceKm), distanceKm, coords: geo.coords }
}
