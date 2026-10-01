import { prisma } from '@/lib/prisma'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'

// ── Courier position store — server-side operations (Géoloc ÉTAPE 2). RGPD minimization. ──
// This module owns the DELETION side of the last-point store: the instant a mission ends
// (delivered/cancelled) its point is erased, so it never survives the course. The WRITE side
// lives in the POST /api/logistics/position receiver (a last-point upsert). BOTH are gated OFF
// by LOGISTICS_TRACKING_ENABLED. ZÉRO géolocalisation here — no capture, no display, no read-out.

/** Erase the courier's last-known point for a finished mission (delivered/cancelled) —
 *  minimization: the point NEVER survives the course, and is NEVER retained indefinitely.
 *  Flag-gated: OFF → no-op, the CourierPosition table is never touched (byte-identical +
 *  safe deploy-before-migration). Safe to call best-effort — it only throws on a real DB
 *  error, which the caller logs without failing the mission step. Keyed by missionId (never
 *  courierId → deleting one finished mission's point never touches another mission's point). */
export async function deleteCourierPositionForMission(missionId: string): Promise<{ deleted: number }> {
  if (!isLogisticsTrackingEnabled()) return { deleted: 0 }
  const res = await prisma.courierPosition.deleteMany({ where: { missionId } })
  return { deleted: res.count }
}
