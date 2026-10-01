import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Géoloc ÉTAPE 5 — RGPD retention sweep (bounded, flag-gated, best-effort). ──────────────────

const { db, flagT, flagD } = vi.hoisted(() => ({
  db: { courierPosition: { deleteMany: vi.fn() }, order: { updateMany: vi.fn() } },
  flagT: { isLogisticsTrackingEnabled: vi.fn() },
  flagD: { isLogisticsDistanceFeeEnabled: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-tracking', () => ({ isLogisticsTrackingEnabled: flagT.isLogisticsTrackingEnabled }))
vi.mock('@/lib/logistics-fee', () => ({ isLogisticsDistanceFeeEnabled: flagD.isLogisticsDistanceFeeEnabled }))

import {
  sweepStaleCourierPositions, purgeStaleOrderDeliveryCoords, runGeolocRetentionSweep,
  POSITION_TTL_MINUTES, ORDER_COORDS_RETENTION_DAYS,
} from '@/lib/courier-position-sweep'

const NOW = new Date('2026-07-07T12:00:00.000Z')
const MIN = 60_000, DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  flagT.isLogisticsTrackingEnabled.mockReturnValue(true)
  flagD.isLogisticsDistanceFeeEnabled.mockReturnValue(true)
  db.courierPosition.deleteMany.mockResolvedValue({ count: 2 })
  db.order.updateMany.mockResolvedValue({ count: 3 })
})

describe('bounded, never-indefinite thresholds', () => {
  it('position TTL default 120 min, within [5,1440]; order-coords retention default 90 d, within [1,365]', () => {
    expect(POSITION_TTL_MINUTES).toBe(120)
    expect(POSITION_TTL_MINUTES).toBeGreaterThanOrEqual(5)
    expect(POSITION_TTL_MINUTES).toBeLessThanOrEqual(1440)
    expect(ORDER_COORDS_RETENTION_DAYS).toBe(90)
    expect(ORDER_COORDS_RETENTION_DAYS).toBeGreaterThanOrEqual(1)
    expect(ORDER_COORDS_RETENTION_DAYS).toBeLessThanOrEqual(365)
  })
})

describe('sweepStaleCourierPositions', () => {
  it('flag ON → deletes points older than now − TTL (bounded cutoff), returns the count', async () => {
    const res = await sweepStaleCourierPositions(NOW)
    expect(res).toEqual({ deleted: 2 })
    const where = db.courierPosition.deleteMany.mock.calls[0][0].where
    expect(where.updatedAt.lt).toBeInstanceOf(Date)
    expect(where.updatedAt.lt.getTime()).toBe(NOW.getTime() - POSITION_TTL_MINUTES * MIN)
  })
  it('flag OFF → no-op, NEVER touches the table (deploy-safe)', async () => {
    flagT.isLogisticsTrackingEnabled.mockReturnValue(false)
    expect(await sweepStaleCourierPositions(NOW)).toEqual({ deleted: 0 })
    expect(db.courierPosition.deleteMany).not.toHaveBeenCalled()
  })
})

describe('purgeStaleOrderDeliveryCoords', () => {
  it('distance-fee flag ON → NULLs coords on TERMINAL orders older than retention, anchored on the IMMUTABLE createdAt', async () => {
    const res = await purgeStaleOrderDeliveryCoords(NOW)
    expect(res).toEqual({ purged: 3 })
    const arg = db.order.updateMany.mock.calls[0][0]
    expect(arg.where.status).toEqual({ in: ['delivered', 'cancelled'] })
    // Anchored on createdAt (immutable), NOT updatedAt (resettable by a later refund/reconcile write).
    expect(arg.where.createdAt.lt.getTime()).toBe(NOW.getTime() - ORDER_COORDS_RETENTION_DAYS * DAY)
    expect(arg.where.updatedAt).toBeUndefined()
    expect(arg.where.OR).toEqual([{ deliveryLat: { not: null } }, { deliveryLng: { not: null } }])
    expect(arg.data).toEqual({ deliveryLat: null, deliveryLng: null })
  })
  it('distance-fee flag OFF → no-op, NEVER touches Order (no coord was ever written)', async () => {
    flagD.isLogisticsDistanceFeeEnabled.mockReturnValue(false)
    expect(await purgeStaleOrderDeliveryCoords(NOW)).toEqual({ purged: 0 })
    expect(db.order.updateMany).not.toHaveBeenCalled()
  })
})

describe('runGeolocRetentionSweep', () => {
  it('runs both halves and returns both counts', async () => {
    expect(await runGeolocRetentionSweep(NOW)).toEqual({ positionsDeleted: 2, orderCoordsPurged: 3 })
  })
  it('best-effort: a failure in one half never blocks the other', async () => {
    db.courierPosition.deleteMany.mockRejectedValue(new Error('db down'))
    const res = await runGeolocRetentionSweep(NOW)
    expect(res).toEqual({ positionsDeleted: 0, orderCoordsPurged: 3 })
  })
})
