import { prisma } from '@/lib/prisma'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'
import { isLogisticsDistanceFeeEnabled } from '@/lib/logistics-fee'

// ── Géoloc ÉTAPE 5 — RGPD retention sweep (bounded, never indefinite). Server-only. ───────────
// Two independent, bounded purges — the durcissement conformité before go-live:
//   • sweepStaleCourierPositions — the safety net for residual F1 (Ét.2): erase any CourierPosition
//     whose last update is older than a BOUNDED TTL (stalled mission / a swallowed at-delivered
//     delete). The primary deletion stays event-driven (deleteCourierPositionForMission at
//     delivered/cancelled); this is the belt-and-braces so NO point survives inactivity for long.
//   • purgeStaleOrderDeliveryCoords — the fix for residual R5: NULL the CLIENT delivery coordinates
//     (Order.deliveryLat/lng) on TERMINAL orders older than a bounded retention window (data
//     minimisation — coords were kept without a TTL).
// Each half is independently flag-gated → a no-op (and zero table access) when its feature is OFF.

const MIN_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

/** Max staleness (minutes) a CourierPosition may survive after its last update before the sweeper
 *  erases it. Configurable via LOGISTICS_POSITION_TTL_MINUTES; default 120; clamped to [5, 1440]
 *  (NEVER indefinite). During a live course the point is upserted on movement so its updatedAt
 *  stays fresh; only a stale/abandoned/orphaned point ages past the TTL and is swept. */
export const POSITION_TTL_MINUTES: number = (() => {
  const n = parseInt(process.env.LOGISTICS_POSITION_TTL_MINUTES ?? '', 10)
  return Number.isInteger(n) && n >= 5 && n <= 1440 ? n : 120
})()

/** Retention window (days) for the CLIENT delivery coordinates (Order.deliveryLat/lng) after the
 *  order reaches a TERMINAL state, covering the dispute/litigation period. After it the coordinates
 *  are anonymised (NULLed). Configurable via LOGISTICS_ORDER_COORDS_RETENTION_DAYS; default 90;
 *  clamped to [1, 365] (NEVER indefinite). */
export const ORDER_COORDS_RETENTION_DAYS: number = (() => {
  const n = parseInt(process.env.LOGISTICS_ORDER_COORDS_RETENTION_DAYS ?? '', 10)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 90
})()

/** Erase CourierPosition rows whose last update is older than POSITION_TTL_MINUTES. Flag-gated
 *  (OFF → no-op, the table is never touched → deploy-safe). `now` is injectable for tests. */
export async function sweepStaleCourierPositions(now: Date = new Date()): Promise<{ deleted: number }> {
  if (!isLogisticsTrackingEnabled()) return { deleted: 0 }
  const cutoff = new Date(now.getTime() - POSITION_TTL_MINUTES * MIN_MS)
  const res = await prisma.courierPosition.deleteMany({ where: { updatedAt: { lt: cutoff } } })
  return { deleted: res.count }
}

/** Anonymise (NULL) the client delivery coordinates on TERMINAL orders older than the retention
 *  window. Gated by LOGISTICS_DISTANCE_FEE_ENABLED — the flag that WROTE those coords — so OFF is a
 *  no-op (no coord was ever written) that also stays deploy-safe. Only touches rows that still carry
 *  a coordinate. `now` is injectable for tests.
 *
 *  ANCHOR = the IMMUTABLE Order.createdAt, NOT updatedAt: @updatedAt bumps on ANY later Order write
 *  (a Stripe refund / chargeback / ghost-order reconcile), which would RESET the retention clock and
 *  let a repeatedly-touched order keep its client GPS coords past the window (unbounded). createdAt
 *  is set once → a truly BOUNDED window that no later write can extend. For food delivery createdAt
 *  ≈ delivery time (orders complete within hours), and an earlier purge is strictly more minimising. */
export async function purgeStaleOrderDeliveryCoords(now: Date = new Date()): Promise<{ purged: number }> {
  if (!isLogisticsDistanceFeeEnabled()) return { purged: 0 }
  const cutoff = new Date(now.getTime() - ORDER_COORDS_RETENTION_DAYS * DAY_MS)
  const res = await prisma.order.updateMany({
    where: {
      status: { in: ['delivered', 'cancelled'] },
      createdAt: { lt: cutoff },
      OR: [{ deliveryLat: { not: null } }, { deliveryLng: { not: null } }],
    },
    data: { deliveryLat: null, deliveryLng: null },
  })
  return { purged: res.count }
}

/** Run the full geoloc retention sweep (positions + order coords). Each half is independently
 *  gated + best-effort — a failure in one never blocks the other. Used by the cron endpoint. */
export async function runGeolocRetentionSweep(now: Date = new Date()): Promise<{ positionsDeleted: number; orderCoordsPurged: number }> {
  let positionsDeleted = 0
  let orderCoordsPurged = 0
  try {
    positionsDeleted = (await sweepStaleCourierPositions(now)).deleted
  } catch (e) {
    console.error('[geoloc sweep] positions failed:', e instanceof Error ? e.message : e)
  }
  try {
    orderCoordsPurged = (await purgeStaleOrderDeliveryCoords(now)).purged
  } catch (e) {
    console.error('[geoloc sweep] order coords failed:', e instanceof Error ? e.message : e)
  }
  return { positionsDeleted, orderCoordsPurged }
}
