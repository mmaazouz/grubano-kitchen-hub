import { haversineKm } from '@/lib/geocode'

// ── Courier position DISPLAY helpers — Géoloc ÉTAPE 4 (RGPD-sensible). Server-only, PURE. ──────
// Two responsibilities, both testable in node:
//   • coarsenLatLng — GROSSIR (round to a coarse grid) the courier's position before it is EVER
//     returned to a client. The client must NEVER receive exact coordinates (reciprocal of the S1
//     dropoff masking). Rounding is deterministic → averaging many reads reveals nothing finer
//     than the grid cell.
//   • etaMinutes — a simple haversine ETA (approximate). It is computed server-side from the
//     EXACT courier position (more accurate) and only the integer minutes is exposed — the exact
//     position never leaves the server for a client.
// Admin/support get the EXACT position (not coarsened) — role-differentiated at the endpoint.

/** Grid precision (decimals) used to coarsen a courier position for a CLIENT. 3 ≈ 111 m cell.
 *  Configurable via LOGISTICS_CLIENT_POSITION_DECIMALS; default 3. Coarser = fewer decimals =
 *  more private. HARD-CAPPED at 4 (≈ 11 m) so an ops misconfiguration can NEVER expose a
 *  near-exact position to a client (5+ would defeat the S1 reciprocal) — out-of-range → 3. */
export const CLIENT_POSITION_DECIMALS: number = (() => {
  const n = parseInt(process.env.LOGISTICS_CLIENT_POSITION_DECIMALS ?? '', 10)
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 3
})()

/** Assumed average urban courier speed (km/h) for the ETA. Configurable via LOGISTICS_ETA_SPEED_KMH. */
export const ETA_SPEED_KMH: number = (() => {
  const n = parseFloat(process.env.LOGISTICS_ETA_SPEED_KMH ?? '')
  return Number.isFinite(n) && n > 0 ? n : 18
})()

export interface LatLng { lat: number; lng: number }

/** Round a number to `decimals` places (half-up). */
export function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(x * f) / f
}

/** GROSSIR a courier position before returning it to a client — snap to a ~decimals grid so the
 *  client sees an APPROXIMATE cell, never the exact point. Deterministic (averaging-safe). */
export function coarsenLatLng(lat: number, lng: number, decimals: number = CLIENT_POSITION_DECIMALS): LatLng {
  return { lat: roundTo(lat, decimals), lng: roundTo(lng, decimals) }
}

/** Approximate ETA in minutes from `from` to `to` at `speedKmh` (haversine, straight-line).
 *  Always ≥ 1. Computed from the EXACT courier position server-side; only the minutes is exposed. */
export function etaMinutes(from: LatLng, to: LatLng, speedKmh: number = ETA_SPEED_KMH): number {
  const km = haversineKm({ latitude: from.lat, longitude: from.lng }, { latitude: to.lat, longitude: to.lng })
  const minutes = (km / speedKmh) * 60
  return Math.max(1, Math.ceil(minutes))
}
