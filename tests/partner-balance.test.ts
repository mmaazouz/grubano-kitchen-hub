import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.2 — partner balance computation (Agent 38) ────────────────────────────
// Locks the read-only aggregation: earned per role from the existing sources,
// paid from Payout 'paid' rows, available = max(0, earned − paid), cent-exact.
// Prisma mocked — no real reads, no writes.

const { db } = vi.hoisted(() => ({
  db: {
    referralOrder: { findMany: vi.fn() },
    dishSale:      { findMany: vi.fn() },
    supplyOrder:   { findMany: vi.fn() },
    ledgerEntry:   { findMany: vi.fn() },
    payout:        { findMany: vi.fn() },
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
  db.payout.findMany.mockResolvedValue([])
})

// ── Brique B (Agent 59) — affiliate balance (operator-keyed, read-only) ──────────────
describe('computePartnerBalance — affiliate', () => {
  it('(B) Σ matured ReferralOrder.affiliateId − Σ Payout(role=affiliate) → available, clamped ≥0', async () => {
    db.referralOrder.findMany.mockResolvedValue([{ creatorEarning: 3 }, { creatorEarning: 1 }]) // 400c
    db.payout.findMany.mockResolvedValue([{ amountCents: 150 }])
    const b = await computePartnerBalance('affiliate', 'aff-op')
    expect(b.earnedCents).toBe(400)
    expect(b.paidCents).toBe(150)
    expect(b.availableCents).toBe(250)
    expect(b.role).toBe('affiliate')
    // earnings scoped to the affiliate's operator id (= ReferralOrder.affiliateId), matured-only
    const reWhere = db.referralOrder.findMany.mock.calls[0][0].where
    expect(reWhere.affiliateId).toBe('aff-op')
    expect(reWhere.status).toEqual({ in: ['matured', 'paid'] })
    // payouts scoped to role=affiliate + operatorId
    expect(db.payout.findMany.mock.calls[0][0].where).toMatchObject({ role: 'affiliate', status: 'paid', operatorId: 'aff-op' })
    // affiliate balance does NOT read the creator's dishSale pipe
    expect(db.dishSale.findMany).not.toHaveBeenCalled()
  })

  it('(B) paid ≥ earned → available clamped at 0 (never negative)', async () => {
    db.referralOrder.findMany.mockResolvedValue([{ creatorEarning: 1 }]) // 100c
    db.payout.findMany.mockResolvedValue([{ amountCents: 500 }])
    const b = await computePartnerBalance('affiliate', 'aff-op')
    expect(b.availableCents).toBe(0)
  })
})

describe('computePartnerBalance — creator', () => {
  it('(a) matured referral + dish earnings minus a paid Payout → available = earned − paid', async () => {
    db.referralOrder.findMany.mockResolvedValue([{ creatorEarning: 2 }, { creatorEarning: 1.5 }]) // 350c
    db.dishSale.findMany.mockResolvedValue([{ creatorEarning: 0.5 }])                              //  50c
    db.payout.findMany.mockResolvedValue([{ amountCents: 100 }])
    const b = await computePartnerBalance('creator', 'c1')
    expect(b.earnedCents).toBe(400)
    expect(b.paidCents).toBe(100)
    expect(b.availableCents).toBe(300)
    expect(b.currency).toBe('eur')
    // matured-only + scoped to the creator
    expect(db.referralOrder.findMany.mock.calls[0][0].where).toEqual({ status: { in: ['matured', 'paid'] }, referral: { creatorId: 'c1' } })
    // paid Payout scoped to this creator
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'creator', status: 'paid', creatorId: 'c1' })
  })

  it('(b) no Payout → available = earned', async () => {
    db.referralOrder.findMany.mockResolvedValue([{ creatorEarning: 12.34 }])
    const b = await computePartnerBalance('creator', 'c1')
    expect(b.earnedCents).toBe(1234)
    expect(b.paidCents).toBe(0)
    expect(b.availableCents).toBe(1234)
  })

  it('(d) clamp — paid > earned → available = 0 (never negative)', async () => {
    db.dishSale.findMany.mockResolvedValue([{ creatorEarning: 5 }]) // 500c
    db.payout.findMany.mockResolvedValue([{ amountCents: 9999 }])
    const b = await computePartnerBalance('creator', 'c1')
    expect(b.earnedCents).toBe(500)
    expect(b.availableCents).toBe(0)
  })

  it('(e) cent-exact — euro floats rounded per row, integer cents out', async () => {
    db.referralOrder.findMany.mockResolvedValue([{ creatorEarning: 0.1 }, { creatorEarning: 0.2 }]) // 10 + 20
    const b = await computePartnerBalance('creator', 'c1')
    expect(b.earnedCents).toBe(30)
    expect(Number.isInteger(b.earnedCents)).toBe(true)
  })
})

describe('computePartnerBalance — supplier & restaurant', () => {
  it('(f) supplier → Σ supplierPayoutCents of PAID orders', async () => {
    db.supplyOrder.findMany.mockResolvedValue([{ supplierPayoutCents: 1000 }, { supplierPayoutCents: 500 }])
    const b = await computePartnerBalance('supplier', 'sp1')
    expect(b.earnedCents).toBe(1500)
    expect(b.availableCents).toBe(1500)
    expect(db.supplyOrder.findMany.mock.calls[0][0].where).toEqual({ supplierProfileId: 'sp1', paymentStatus: 'paid' })
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'supplier', status: 'paid', supplierProfileId: 'sp1' })
  })

  it('(f) restaurant → Σ netToRestaurant (refund lines are negative)', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([{ netToRestaurant: 2000 }, { netToRestaurant: -500 }])
    const b = await computePartnerBalance('restaurant', 'r1')
    expect(b.earnedCents).toBe(1500)
    expect(b.availableCents).toBe(1500)
    expect(db.ledgerEntry.findMany.mock.calls[0][0].where).toEqual({ restaurantId: 'r1' })
    expect(db.payout.findMany.mock.calls[0][0].where).toEqual({ role: 'restaurant', status: 'paid', restaurantId: 'r1' })
  })
})
