// Courier position tracking — Géoloc ÉTAPE 2 (FONDATIONS INERTES, sujet RGPD-sensible).
//
// This step lays the STRUCTURE to STORE and RECEIVE a courier's live position, but NOTHING
// captures it (courier-side capture = Étape 3) and NOTHING displays it (client map = Étape 4).
// This module holds ONLY the kill-switch. There is deliberately no geolocation code here.
//
// PRIVACY-BY-DESIGN INVARIANTS (frozen product + RGPD decisions):
//   • LAST POINT ONLY — one current point per courier/mission (upsert), NEVER a breadcrumb trail.
//   • IN-COURSE ONLY — a point is accepted only while the courier's own mission is accepted/
//     picked_up; not before acceptance, not after delivery.
//   • DELETED AFTER DELIVERY — the point is erased when the mission becomes delivered/cancelled;
//     it never survives the course, never lives indefinitely.
//   • EXPLICIT OPT-IN — no point is stored unless the courier has given tracking consent.
//   • NO EXPOSURE — this step never reads a position back out to anyone (no map, no API read).
//
// CENTRAL INVARIANT — gated by LOGISTICS_TRACKING_ENABLED (default OFF):
//   OFF → POST /api/logistics/position writes NOTHING, no position is ever stored, and NO code
//   path touches the new CourierPosition table (safe deploy-before-migration: the table and the
//   trackingConsent column are dormant until the flag is flipped on).
//   ON → the receiver upserts the last point, but ONLY when opt-in is given AND the mission is
//   the courier's own AND it is in-course; every other request is refused without a write.

/** Kill-switch for the courier position-tracking feature. Default OFF — only the exact string
 *  'true' enables it. When OFF, the CourierPosition table and trackingConsent are never touched
 *  (the receiver refuses without writing), so the migration can trail the code deploy safely. */
export function isLogisticsTrackingEnabled(): boolean {
  return process.env.LOGISTICS_TRACKING_ENABLED === 'true'
}
