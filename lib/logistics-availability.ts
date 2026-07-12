// Courier availability (« en ligne / disponible ») — Géoloc ÉTAPE 1. ZÉRO géolocalisation.
//
// A simple ON/OFF boolean (LogisticsProfile.isOnline) deciding whether a courier RECEIVES
// mission offers right now. NO position, NO GPS, NO tracking — the position-tracking steps
// come later. This module holds ONLY the kill-switch.
//
// CENTRAL INVARIANT — gated by LOGISTICS_AVAILABILITY_ENABLED (default OFF):
//   OFF → the toggle stays the inert placeholder, the /api/logistics/availability endpoint is
//   gated (404 on write), NOTHING reads or writes isOnline/lastSeenAt, and the offer pool is
//   BYTE-IDENTICAL to today (every 'active' courier is offered). The feature — and the two new
//   columns — are completely dormant until the flag is flipped on.
//   ON → the toggle is real (writes isOnline + a lastSeenAt heartbeat), and the offer filters
//   (lib/mission-attribution) restrict offers to isOnline=true couriers.

/** Kill-switch for the courier availability feature. Default OFF — only the exact string
 *  'true' enables it. When OFF, isOnline/lastSeenAt are never touched (safe deploy-before-
 *  migration: the new columns are read/written ONLY under this flag). */
export function isLogisticsAvailabilityEnabled(): boolean {
  return process.env.LOGISTICS_AVAILABILITY_ENABLED === 'true'
}
