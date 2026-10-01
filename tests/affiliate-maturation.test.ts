import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Brique B (Agent 59) — maturation generalized to the affiliate rail ────────────────
// The maturation cron scans ALL pending ReferralOrders (referrer-agnostic), so affiliate
// accruals mature on the SAME rules (J+7, paid, not fully refunded). The self-referral
// belt is generalized: an affiliate row is self-referral when its affiliateId (the
// affiliate's operator id) equals the order's consumerId (the buyer's operator id).

const { db } = vi.hoisted(() => ({
  db: {
    referralOrder: { findMany: vi.fn(), updateMany: vi.fn() },
    dishSale:      { findMany: vi.fn(), updateMany: vi.fn() },
    ledgerEntry:   { findMany: vi.fn() },
    operator:      { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { matureCreatorEarnings } from '@/lib/creator-earnings'

const EIGHT_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)

function affiliateRow(affiliateOperatorId: string, consumerId: string) {
  return {
    id: 'ro1', createdAt: EIGHT_DAYS_AGO, affiliateId: affiliateOperatorId,
    referral: { creator: null }, // affiliate binding → no creator
    order: { createdAt: EIGHT_DAYS_AGO, paymentStatus: 'paid', total: 20, stripePaymentIntentId: 'pi1', consumerId },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.dishSale.findMany.mockResolvedValue([])
  db.ledgerEntry.findMany.mockResolvedValue([])  // no refunds
  db.operator.findMany.mockResolvedValue([])      // buyer emails (none needed for affiliate self-check)
  db.referralOrder.updateMany.mockResolvedValue({ count: 1 })
  db.dishSale.updateMany.mockResolvedValue({ count: 1 })
})

describe('matureCreatorEarnings — affiliate rail', () => {
  it('an affiliate accrual (J+7, paid, not refunded, not self) → matured', async () => {
    db.referralOrder.findMany.mockResolvedValue([affiliateRow('aff-op', 'buyer-op')])
    const summary = await matureCreatorEarnings()
    expect(summary.matured).toBe(1)
    const call = db.referralOrder.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'ro1', status: 'pending' })
    expect(call.data.status).toBe('matured')
  })

  it('an affiliate SELF-referral (affiliateId === order.consumerId) → cancelled, NOT matured', async () => {
    db.referralOrder.findMany.mockResolvedValue([affiliateRow('same-op', 'same-op')])
    const summary = await matureCreatorEarnings()
    expect(summary.matured).toBe(0)
    expect(summary.cancelled).toBe(1)
    expect(db.referralOrder.updateMany.mock.calls[0][0].data.status).toBe('cancelled')
  })

  it('an affiliate accrual fully refunded → cancelled (refund-aware, like the creator rail)', async () => {
    db.referralOrder.findMany.mockResolvedValue([affiliateRow('aff-op', 'buyer-op')])
    db.ledgerEntry.findMany.mockResolvedValue([{ stripePaymentIntentId: 'pi1', grossAmount: -2000 }]) // 20€ refunded ≥ total
    const summary = await matureCreatorEarnings()
    expect(summary.cancelled).toBe(1)
    expect(db.referralOrder.updateMany.mock.calls[0][0].data.status).toBe('cancelled')
  })
})
