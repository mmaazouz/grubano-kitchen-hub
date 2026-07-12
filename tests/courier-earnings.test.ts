import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.3 ÉTAPE 2 — courier earnings maturation (lib/courier-earnings) ────────────────
// Locks the PURE maturation window rule + the idempotent batch pass. Calque of the
// creator 7-day hold, env-configurable. ÉTAPE 2 is INERT: the batch scans an EMPTY table
// (nothing writes CourierEarning yet) → no-op. Prisma mocked; the pure rule needs no I/O.

const { db } = vi.hoisted(() => ({
  db: { courierEarning: { findMany: vi.fn(), updateMany: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  courierMaturationDays,
  courierMaturationMs,
  courierMaturesAt,
  evaluateCourierEarningMaturity,
  matureCourierEarnings,
} from '@/lib/courier-earnings'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.COURIER_MATURATION_DAYS
  db.courierEarning.findMany.mockResolvedValue([])
  db.courierEarning.updateMany.mockResolvedValue({ count: 1 })
})
afterEach(() => { delete process.env.COURIER_MATURATION_DAYS })

describe('window config', () => {
  it('defaults to 7 days; env COURIER_MATURATION_DAYS overrides with a positive int', () => {
    expect(courierMaturationDays()).toBe(7)
    expect(courierMaturationMs()).toBe(7 * DAY)
    process.env.COURIER_MATURATION_DAYS = '3'
    expect(courierMaturationDays()).toBe(3)
    expect(courierMaturationMs()).toBe(3 * DAY)
  })

  it('ignores a non-positive / non-numeric override (falls back to 7)', () => {
    process.env.COURIER_MATURATION_DAYS = '0'
    expect(courierMaturationDays()).toBe(7)
    process.env.COURIER_MATURATION_DAYS = '-5'
    expect(courierMaturationDays()).toBe(7)
    process.env.COURIER_MATURATION_DAYS = 'abc'
    expect(courierMaturationDays()).toBe(7)
  })

  it('courierMaturesAt = base + window (used by the ÉTAPE 3 writer to stamp maturesAt)', () => {
    const base = new Date('2026-07-06T00:00:00.000Z')
    expect(courierMaturesAt(base).getTime()).toBe(base.getTime() + 7 * DAY)
  })
})

describe('evaluateCourierEarningMaturity — PURE window rule', () => {
  const createdAt = new Date('2026-07-01T00:00:00.000Z')

  it('now < maturesAt → pending (too_young)', () => {
    const maturesAt = new Date('2026-07-08T00:00:00.000Z')
    const now = new Date('2026-07-07T23:59:59.000Z')
    expect(evaluateCourierEarningMaturity({ createdAt, maturesAt, now })).toEqual({ status: 'pending', reason: 'too_young' })
  })

  it('now ≥ maturesAt → matured (ok)', () => {
    const maturesAt = new Date('2026-07-08T00:00:00.000Z')
    const now = new Date('2026-07-08T00:00:00.000Z')
    expect(evaluateCourierEarningMaturity({ createdAt, maturesAt, now })).toEqual({ status: 'matured', reason: 'ok' })
  })

  it('maturesAt null → falls back to createdAt + the configured window', () => {
    // createdAt + 7d = 2026-07-08. One second before → pending; at/after → matured.
    expect(evaluateCourierEarningMaturity({ createdAt, maturesAt: null, now: new Date('2026-07-07T23:59:59.000Z') }).status).toBe('pending')
    expect(evaluateCourierEarningMaturity({ createdAt, maturesAt: null, now: new Date('2026-07-08T00:00:01.000Z') }).status).toBe('matured')
  })

  it('the fallback honours the env window', () => {
    process.env.COURIER_MATURATION_DAYS = '2'
    // createdAt + 2d = 2026-07-03.
    expect(evaluateCourierEarningMaturity({ createdAt, maturesAt: null, now: new Date('2026-07-02T12:00:00.000Z') }).status).toBe('pending')
    expect(evaluateCourierEarningMaturity({ createdAt, maturesAt: null, now: new Date('2026-07-03T00:00:00.000Z') }).status).toBe('matured')
  })
})

describe('matureCourierEarnings — idempotent batch', () => {
  it('empty table (ÉTAPE 2 inert) → scanned 0, no update', async () => {
    const s = await matureCourierEarnings(new Date('2026-07-10T00:00:00.000Z'))
    expect(s).toEqual({ scanned: 0, matured: 0, pending: 0 })
    expect(db.courierEarning.updateMany).not.toHaveBeenCalled()
  })

  it('promotes only rows past their window; leaves the young ones pending', async () => {
    const now = new Date('2026-07-10T00:00:00.000Z')
    db.courierEarning.findMany.mockResolvedValue([
      { id: 'e1', createdAt: new Date('2026-07-01T00:00:00.000Z'), maturesAt: new Date('2026-07-08T00:00:00.000Z') }, // matured
      { id: 'e2', createdAt: new Date('2026-07-09T00:00:00.000Z'), maturesAt: new Date('2026-07-16T00:00:00.000Z') }, // pending
    ])
    const s = await matureCourierEarnings(now)
    expect(s).toEqual({ scanned: 2, matured: 1, pending: 1 })
    // only the matured row is flipped, and via a status-guarded updateMany (concurrency-safe)
    expect(db.courierEarning.updateMany).toHaveBeenCalledTimes(1)
    expect(db.courierEarning.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'e1', status: 'pending' },
      data:  { status: 'matured' },
    })
    // it only scans PENDING rows (idempotent — a promoted row leaves the set)
    expect(db.courierEarning.findMany.mock.calls[0][0].where).toEqual({ status: 'pending' })
  })

  it('all young → no update (money never touched, status only)', async () => {
    db.courierEarning.findMany.mockResolvedValue([
      { id: 'e3', createdAt: new Date('2026-07-09T00:00:00.000Z'), maturesAt: new Date('2026-07-16T00:00:00.000Z') },
    ])
    const s = await matureCourierEarnings(new Date('2026-07-10T00:00:00.000Z'))
    expect(s).toEqual({ scanned: 1, matured: 0, pending: 1 })
    expect(db.courierEarning.updateMany).not.toHaveBeenCalled()
  })
})
