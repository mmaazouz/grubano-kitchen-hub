import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.5-B — cross-rail royalty give-back accounting (the bug-fix invariant) ──────
// refundedCents must reflect BOTH rails (refunds + lost disputes), be capped at the
// accrued royalty, and never decrease — so neither rail can erase the other's clawback
// and the franchise settlement never pays a refunded/charged-back royalty.

const { db } = vi.hoisted(() => ({
  db: { refund: { aggregate: vi.fn() }, dispute: { aggregate: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { recomputeRoyaltyRefundedCents } from '@/lib/royalty-refunded'

const set = (refund: number, dispute: number) => {
  db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: refund } })
  db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: dispute } })
}

beforeEach(() => { vi.clearAllMocks(); set(0, 0) })

describe('recomputeRoyaltyRefundedCents', () => {
  it('sums BOTH rails (refunds + lost disputes)', async () => {
    set(150, 150)
    expect(await recomputeRoyaltyRefundedCents({ orderId: 'o1', royaltyCents: 300, existingRefundedCents: 0 })).toBe(300)
  })

  it('caps at royaltyCents (never over-counts)', async () => {
    set(250, 250) // 500 > 300
    expect(await recomputeRoyaltyRefundedCents({ orderId: 'o1', royaltyCents: 300, existingRefundedCents: 0 })).toBe(300)
  })

  it('never decreases below the existing value (monotone)', async () => {
    set(0, 0) // both aggregates empty (e.g. a stale read)
    expect(await recomputeRoyaltyRefundedCents({ orderId: 'o1', royaltyCents: 300, existingRefundedCents: 200 })).toBe(200)
  })

  it('adds an in-flight slice not yet committed to a row (dispute mid-settle)', async () => {
    set(150, 0) // a prior refund of 150; the in-flight dispute is not yet splitReversed
    expect(await recomputeRoyaltyRefundedCents({ orderId: 'o1', royaltyCents: 300, existingRefundedCents: 150, inFlightCents: 150 })).toBe(300)
  })

  it('refund-only order (no disputes) → exactly the refund aggregate (byte-identical to pre-P4.5-B)', async () => {
    set(180, 0)
    expect(await recomputeRoyaltyRefundedCents({ orderId: 'o1', royaltyCents: 300, existingRefundedCents: 0 })).toBe(180)
  })
})
