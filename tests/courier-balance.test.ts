import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.3 ÉTAPE 2 — logistics (courier) balance branch of computePartnerBalance ───────
// Locks the read-only aggregation for the NEW 'logistics' role: earned = Σ netCents of
// MATURED CourierEarning, paid = Σ Payout(role='logistics') 'paid', available = max(0,
// earned − paid), cent-exact (native integer cents, no Float). Prisma mocked — no real
// reads/writes. Empty table → 0 (the ÉTAPE 2 inert state). Also asserts the EXISTING
// roles are unchanged (the logistics branch never touches their pipes).

const { db } = vi.hoisted(() => ({
  db: {
    referralOrder:  { findMany: vi.fn() },
    dishSale:       { findMany: vi.fn() },
    supplyOrder:    { findMany: vi.fn() },
    ledgerEntry:    { findMany: vi.fn() },
    courierEarning: { findMany: vi.fn() },
    payout:         { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { computePartnerBalance } from '@/lib/partner-balance'

beforeEach(() => {
  vi.clearAllMocks()
  db.referralOrder.findMany.mockResolvedValue([])
  db.dishSale.findMany.mockResolvedValue([])
  db.supplyOrder.findMany.mockResolvedValue([])
  db.ledgerEntry.findMany.mockResolvedValue([])
  db.courierEarning.findMany.mockResolvedValue([])
  db.payout.findMany.mockResolvedValue([])
})

describe('computePartnerBalance — logistics', () => {
  it('empty CourierEarning table → earned 0, paid 0, available 0 (ÉTAPE 2 inert state)', async () => {
    const b = await computePartnerBalance('logistics', 'lp1')
    expect(b.earnedCents).toBe(0)
    expect(b.paidCents).toBe(0)
    expect(b.availableCents).toBe(0)
    expect(b.role).toBe('logistics')
    expect(b.currency).toBe('eur')
  })

  it('Σ matured CourierEarning.netCents − Σ Payout(role=logistics) → available, scoped to the courier', async () => {
    db.courierEarning.findMany.mockResolvedValue([{ netCents: 1200 }, { netCents: 800 }]) // 2000c
    db.payout.findMany.mockResolvedValue([{ amountCents: 500 }])
    const b = await computePartnerBalance('logistics', 'lp1')
    expect(b.earnedCents).toBe(2000)
    expect(b.paidCents).toBe(500)
    expect(b.availableCents).toBe(1500)
    // earnings scoped to the courier's LogisticsProfile id + matured-only (pending excluded)
    expect(db.courierEarning.findMany.mock.calls[0][0].where).toEqual({
      courierId: 'lp1', status: { in: ['matured', 'paid'] },
    })
    // payouts scoped to role=logistics + logisticsProfileId (the provisioned column)
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({
      role: 'logistics', status: 'paid', logisticsProfileId: 'lp1',
    })
    // the logistics branch NEVER reads the creator/affiliate/supplier/restaurant pipes
    expect(db.referralOrder.findMany).not.toHaveBeenCalled()
    expect(db.dishSale.findMany).not.toHaveBeenCalled()
    expect(db.supplyOrder.findMany).not.toHaveBeenCalled()
    expect(db.ledgerEntry.findMany).not.toHaveBeenCalled()
  })

  it('anti-double-pay — paid ≥ earned → available clamped at 0 (never negative)', async () => {
    db.courierEarning.findMany.mockResolvedValue([{ netCents: 1000 }])
    db.payout.findMany.mockResolvedValue([{ amountCents: 5000 }])
    const b = await computePartnerBalance('logistics', 'lp1')
    expect(b.earnedCents).toBe(1000)
    expect(b.paidCents).toBe(5000)
    expect(b.availableCents).toBe(0)
  })

  it('native integer cents — no Float, no rounding drift', async () => {
    db.courierEarning.findMany.mockResolvedValue([{ netCents: 333 }, { netCents: 334 }, { netCents: 333 }])
    const b = await computePartnerBalance('logistics', 'lp1')
    expect(b.earnedCents).toBe(1000)
    expect(Number.isInteger(b.earnedCents)).toBe(true)
  })

  it('two partial payouts already disbursed → available = earned − Σ paid (the remainder)', async () => {
    db.courierEarning.findMany.mockResolvedValue([{ netCents: 9000 }])
    db.payout.findMany.mockResolvedValue([{ amountCents: 4000 }, { amountCents: 3000 }])
    const b = await computePartnerBalance('logistics', 'lp1')
    expect(b.availableCents).toBe(2000)
  })
})

// The existing roles must be untouched by the added branch (spot-check one money path).
describe('computePartnerBalance — existing roles unaffected by the logistics branch', () => {
  it('creator still reads referral/dish pipes, never courierEarning', async () => {
    db.referralOrder.findMany.mockResolvedValue([{ creatorEarning: 4 }]) // 400c
    const b = await computePartnerBalance('creator', 'c1')
    expect(b.earnedCents).toBe(400)
    expect(db.courierEarning.findMany).not.toHaveBeenCalled()
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'creator', status: 'paid', creatorId: 'c1' })
  })

  it('restaurant (the final else branch) still keys on restaurantId, never courierEarning', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([{ netToRestaurant: 700 }])
    const b = await computePartnerBalance('restaurant', 'r1')
    expect(b.earnedCents).toBe(700)
    expect(db.courierEarning.findMany).not.toHaveBeenCalled()
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'restaurant', status: 'paid', restaurantId: 'r1' })
  })
})
