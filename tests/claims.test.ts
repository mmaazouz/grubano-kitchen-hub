import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.5-C1 — lib/claims (the claim cycle workflow) ──────────────────────────────
// Owner-scoped create, restaurant accept / refuse, auto-approval, and the
// refund-trigger idempotence (executeRefund at most once per claim). Prisma + the
// P4.5-A engine are mocked.
// P0-24 (vague 1, Q3 volet 2) : l'ACCEPT restaurateur ne déclenche PLUS de
// remboursement — il route la réclamation en file admin ('arbitration'). Seul un
// admin (arbitrateClaim) décide et déclenche.

const { db } = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn() },
    claim: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

import { createClaim, respondToClaim, runClaimAutoApproval, getClaimEligibility, arbitrateClaim, listArbitrationQueue } from '@/lib/claims'

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

describe('respondToClaim — (b) accept → FILE ADMIN, jamais de remboursement (P0-24)', () => {
  it("owner accept → AUCUN executeRefund ; CAS restaurant_review → 'arbitration' (reconnaissance sans argent)", async () => {
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res.ok).toBe(true)
    expect(execMock).not.toHaveBeenCalled() // ⭐ critère P0-24 : zéro stripe.refunds.create
    const moved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'arbitration')
    expect(moved?.[0].where).toMatchObject({ id: 'cl1', status: 'restaurant_review' })
    expect(moved?.[0].data).toMatchObject({ status: 'arbitration', restaurantResponse: 'accepted' })
    // la décision d'argent n'est PAS prise : decidedBy/decidedAt absents de l'écriture
    expect(moved?.[0].data.decidedBy).toBeUndefined()
    // et activeOrderKey n'est pas touché (arbitration = statut ACTIF, verrou conservé)
    expect(moved?.[0].data.activeOrderKey).toBeUndefined()
    if (res.ok) expect(res.refund).toBeUndefined()
  })

  it('accept est indépendant du flag REFUNDS (ON comme OFF → même routage, zéro argent)', async () => {
    refundsFlag.mockReturnValue(true)
    await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    refundsFlag.mockReturnValue(false)
    await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(execMock).not.toHaveBeenCalled()
    expect(db.claim.updateMany.mock.calls.filter((c) => c[0]?.data?.status === 'arbitration')).toHaveLength(2)
  })

  it('(IDOR) a claim on another operator order → 404, no refund', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', restaurantId: 'OTHER', status: 'restaurant_review' })
    const res = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('double accept (lost the atomic guard) → 409, no refund', async () => {
    fx.updateManyCount = 0 // review→arbitration matched 0 rows (already handled)
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

describe("(e) P0-24 — l'ADMIN décide et déclenche (les deux rôles couverts)", () => {
  it("admin arbitrate approve sur une réclamation 'arbitration' (acceptée par le resto) → executeRefund UNE fois", async () => {
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl1', status: 'arbitration', refundAttempted: false })              // load arbitrate
      .mockResolvedValueOnce({ orderId: 'o1', requestedAmountCents: 5000 })                              // load trigger
      .mockResolvedValue({ id: 'cl1', status: 'refunded' })                                              // reload final
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'adm1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 5000, reason: 'claim:cl1' })
  })

  it('HÉRITAGE pré-P0-24 : approved + refundAttempted=false → arbitrable (approve → refund idempotent)', async () => {
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl9', status: 'approved', refundAttempted: false })
      .mockResolvedValueOnce({ orderId: 'o9', requestedAmountCents: 1200 })
      .mockResolvedValue({ id: 'cl9', status: 'refunded' })
    const res = await arbitrateClaim({ claimId: 'cl9', adminId: 'adm1', decision: 'approve' })
    expect(res.ok).toBe(true)
    // le CAS héritage exige refundAttempted:false dans le WHERE (race-safe)
    const meta = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.arbitrationDecision === 'approved')
    expect(meta?.[0].where).toMatchObject({ id: 'cl9', status: 'approved', refundAttempted: false })
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('HÉRITAGE : refundAttempted=true (argent peut-être parti) → 409, JAMAIS re-déclenché', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl8', status: 'approved', refundAttempted: true })
    const res = await arbitrateClaim({ claimId: 'cl8', adminId: 'adm1', decision: 'approve' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it("la file admin inclut 'arbitration' ET l'héritage approved non remboursé", async () => {
    db.claim.findMany.mockResolvedValue([])
    await listArbitrationQueue()
    expect(db.claim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ status: 'arbitration' }, { status: 'approved', refundAttempted: false }] },
    }))
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
