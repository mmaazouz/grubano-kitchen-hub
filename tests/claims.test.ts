import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.5-C1 — lib/claims (the claim cycle workflow) ──────────────────────────────
// Owner-scoped create, restaurant accept→refund / refuse, auto-approval, and the
// refund-trigger idempotence (executeRefund at most once per claim). Prisma + the
// P4.5-A engine are mocked.

const { db } = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn() },
    claim: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

import { createClaim, respondToClaim, runClaimAutoApproval, getClaimEligibility } from '@/lib/claims'

const paidOrder = (o: Record<string, unknown> = {}) => ({
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', paymentStatus: 'paid', total: 50, updatedAt: new Date(), ...o,
})
const fx = { updateManyCount: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  fx.updateManyCount = 1
  db.order.findUnique.mockResolvedValue(paidOrder())
  db.claim.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cl1', ...data }))
  db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', restaurantId: 'r1', status: 'restaurant_review', requestedAmountCents: 5000 })
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.findMany.mockResolvedValue([])
  db.claim.update.mockResolvedValue({})
  db.claim.updateMany.mockImplementation(() => Promise.resolve({ count: fx.updateManyCount }))
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1', stripeRefundId: 're_1' })
  refundsFlag.mockReturnValue(true)
})

describe('createClaim — (a) owner + paid + window + amount', () => {
  it('creates a restaurant_review claim (whole order when no amount), deadline set', async () => {
    const res = await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })
    expect(res.ok).toBe(true)
    const data = db.claim.create.mock.calls[0][0].data
    expect(data).toMatchObject({ orderId: 'o1', consumerId: 'c1', restaurantId: 'r1', reason: 'quality', requestedAmountCents: 5000, status: 'restaurant_review', activeOrderKey: 'o1' })
    expect(data.responseDeadlineAt instanceof Date).toBe(true)
  })

  it('non-owner → 403, no create', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ consumerId: 'someone_else' }))
    const res = await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('not paid → 409', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ paymentStatus: 'pending' }))
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })).toMatchObject({ ok: false, status: 409 })
  })

  it('outside the 48h window → 409', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ updatedAt: new Date(Date.now() - 49 * 3600 * 1000) }))
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })).toMatchObject({ ok: false, status: 409 })
  })

  it('amount over the order total → 400', async () => {
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality', requestedAmountCents: 6000 })).toMatchObject({ ok: false, status: 400 })
  })

  it('invalid reason → 400', async () => {
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'nonsense' })).toMatchObject({ ok: false, status: 400 })
  })

  it('duplicate active claim (P2002 on activeOrderKey) → 409', async () => {
    db.claim.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await createClaim({ consumerId: 'c1', orderId: 'o1', reason: 'quality' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('respondToClaim — (b) accept → refund', () => {
  it('owner accept → executeRefund ONCE with the claimed amount + claim refunded', async () => {
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res.ok).toBe(true)
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 5000, reason: 'claim:cl1' })
    // refunded → refundId linked + activeOrderKey cleared
    const refundedUpdate = db.claim.update.mock.calls.find((c) => c[0]?.data?.status === 'refunded')
    expect(refundedUpdate?.[0].data).toMatchObject({ status: 'refunded', refundId: 'rf1', activeOrderKey: null })
  })

  it('(IDOR) a claim on another operator order → 404, no refund', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', restaurantId: 'OTHER', status: 'restaurant_review' })
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('double accept (lost the atomic guard) → 409, no second refund', async () => {
    fx.updateManyCount = 0 // review→approved matched 0 rows (already handled)
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('(c) refuse → status refused + reason, NO refund', async () => {
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'refuse', reason: 'photo non concluante' })
    expect(res.ok).toBe(true)
    const refusedCall = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'refused')
    expect(refusedCall?.[0].data).toMatchObject({ status: 'refused', restaurantResponse: 'refused', restaurantResponseReason: 'photo non concluante', activeOrderKey: null })
    expect(execMock).not.toHaveBeenCalled()
  })
})

describe('(e) gating — CLAIMS on but REFUNDS off', () => {
  it('accept records approval, refund PENDING (no executeRefund, no double)', async () => {
    refundsFlag.mockReturnValue(false)
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.refund).toEqual({ state: 'pending', reason: 'refunds_disabled' })
    expect(execMock).not.toHaveBeenCalled()
    // approved, but NOT refunded and refundAttempted not set
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'approved')
    expect(approved?.[0].data).toMatchObject({ status: 'approved', restaurantResponse: 'accepted', decidedBy: 'restaurant' })
  })
})

describe('(d) auto-approval cron', () => {
  it('expired restaurant_review → auto-approved + refund triggered once', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      where.status === 'restaurant_review' ? Promise.resolve([{ id: 'cl1' }]) : Promise.resolve([]))
    const summary = await runClaimAutoApproval()
    expect(summary.autoApproved).toBe(1)
    expect(summary.refundsTriggered).toBe(1)
    expect(execMock).toHaveBeenCalledTimes(1)
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.decidedBy === 'auto_timeout')
    expect(approved).toBeTruthy()
  })

  it('approved-but-unrefunded → refund driven once when REFUNDS now on', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      where.status === 'approved' ? Promise.resolve([{ id: 'cl1' }]) : Promise.resolve([]))
    const summary = await runClaimAutoApproval()
    expect(summary.refundsTriggered).toBe(1)
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('REFUNDS off → no pending-refund sweep, no executeRefund', async () => {
    refundsFlag.mockReturnValue(false)
    db.claim.findMany.mockResolvedValue([]) // no expired
    const summary = await runClaimAutoApproval()
    expect(summary.refundsTriggered).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
  })
})

describe('getClaimEligibility', () => {
  it('owner + paid + window + no active → canClaim, max = order total cents', async () => {
    const e = await getClaimEligibility({ consumerId: 'c1', orderId: 'o1' })
    expect(e).toMatchObject({ canClaim: true, maxRefundableCents: 5000, existingClaim: null })
  })
  it('an ACTIVE claim already exists → canClaim false (active_claim)', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl0', status: 'restaurant_review' })
    const e = await getClaimEligibility({ consumerId: 'c1', orderId: 'o1' })
    expect(e).toMatchObject({ canClaim: false, reason: 'active_claim' })
  })
  it('not the owner → canClaim false (not_owner)', async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ consumerId: 'other' }))
    expect(await getClaimEligibility({ consumerId: 'c1', orderId: 'o1' })).toMatchObject({ canClaim: false, reason: 'not_owner' })
  })
})
