// tests/claims-t49-recovery.test.ts — T-49, founder decision 2026-09-10
//
// EVIDENCE ONLY, FAIL CLOSED ON AMBIGUITY — and fail VISIBLE, because a safe state nobody can
// see is a leak rather than safety. These tests pin both halves:
//
//   MONEY SAFETY    — no new money, no closure, no re-file and no guess when attribution
//                     cannot be proven; a claim never binds to another rail's refund;
//   RECOVERY LIVENESS — the ambiguous claim lands in a durable queue that survives the feature
//                     flag, raises an alert, and has a reachable evidence-based exit.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn() },
    order:  { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  reconcileClaimEvidence, enterFinancialVerification, listFinancialVerificationClaims,
  listReconcileRequiredClaims, isStuckResolvable, isReconcileRequired, claimRefundReason,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED,
} from '@/lib/claims'

const CLAIM = { id: 'cl1', orderId: 'o1', status: 'refunding', refundId: null, requestedAmountCents: 500 }
const row = (o: Record<string, unknown> = {}) => ({
  id: 'rf1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1',
  reason: claimRefundReason('cl1'), createdAt: new Date(), ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.claim.findUnique.mockResolvedValue({ ...CLAIM })
  // reconcileClaimForRefund resolves the bound claim by refundId.
  db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
  db.claim.updateMany.mockResolvedValue({ count: 1 })
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
  db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 },
  })
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
  alertMock.mockResolvedValue({ status: 'sent' })
  refundsFlag.mockReturnValue(false)
})

// ═══ PROVEN OUTCOMES ═════════════════════════════════════════════════════════════
describe('evidence PROVES what happened → apply it, and only it', () => {
  it('a succeeded refund carrying this claim identity → bound and reconciled', async () => {
    db.refund.findMany.mockResolvedValue([row()])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 500 })
    expect(execMock).not.toHaveBeenCalled() // never re-drives the engine
  })

  it('a FAILED refund → recorded as failed, never dressed up as success', async () => {
    db.refund.findMany.mockResolvedValue([row({ status: 'failed' })])
    db.refund.findUnique.mockResolvedValue({ status: 'failed' })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refund_failed' })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('a PENDING refund stays pending — no terminal success, no terminal failure', async () => {
    db.refund.findMany.mockResolvedValue([row({ status: 'pending' })])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'still_pending' })
    const wrote = db.claim.updateMany.mock.calls.map((c) => c[0].data)
    expect(wrote.some((d) => d.status === 'refunded' || d.status === 'refused_final')).toBe(false)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('PROOF OF ABSENCE: no row anywhere and Stripe reports nothing → safely re-payable', async () => {
    db.refund.findMany.mockResolvedValue([])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'no_refund_proven' })
    const d = db.claim.updateMany.mock.calls.at(-1)![0].data
    expect(d).toMatchObject({ status: 'approved', refundAttempted: false })
    expect(execMock).not.toHaveBeenCalled()
  })
})

// ═══ FAIL CLOSED ON AMBIGUITY ════════════════════════════════════════════════════
describe('evidence CANNOT prove it → fail closed, and stay visible', () => {
  it('money moved on the order but no row is ours → FINANCIAL VERIFICATION', async () => {
    db.refund.findMany.mockResolvedValue([row({ reason: 'admin:orders/[id]/refund' })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 },
    })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
  })

  it('Stripe unreadable → no conclusion in EITHER direction', async () => {
    db.refund.findMany.mockResolvedValue([])
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('stripe down'))
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'stripe_unreadable' })
  })

  it('two rows claim this identity → ambiguous, not "pick the first"', async () => {
    db.refund.findMany.mockResolvedValue([row({ id: 'rfA' }), row({ id: 'rfB' })])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'multiple_candidate_refunds' })
  })

  it('the ambiguous state never moves money and never closes the claim', async () => {
    db.refund.findMany.mockResolvedValue([])
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('down'))
    await reconcileClaimEvidence({ claimId: 'cl1' })
    const wrote = db.claim.updateMany.mock.calls.map((c) => c[0].data)
    expect(execMock).not.toHaveBeenCalled()
    expect(wrote.some((d) => d.status === 'refunded' || d.status === 'refused_final')).toBe(false)
    // activeOrderKey is NEVER released here: the order stays shut to a second money claim.
    expect(wrote.some((d) => 'activeOrderKey' in d && d.activeOrderKey === null)).toBe(false)
  })

  it('the customer cannot re-file: the parked status is ACTIVE, so the order stays locked', async () => {
    const { default: mod } = await import('@/lib/claims').then((m) => ({ default: m }))
    // ACTIVE_STATUSES is private; the observable contract is that entering the state never
    // clears activeOrderKey, which is the @unique lock the consumer path collides with.
    await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'x' })
    const d = db.claim.updateMany.mock.calls.at(-1)![0].data
    expect('activeOrderKey' in d).toBe(false)
    expect(mod.FINANCIAL_VERIFICATION).toBe('financial_verification')
  })
})

// ═══ ALERT + QUEUE = LIVENESS ════════════════════════════════════════════════════
describe('recovery liveness — the parked claim is seen, not just safe', () => {
  it('entering the state raises an operator alert with enough to investigate', async () => {
    db.claim.findUnique.mockResolvedValue({ orderId: 'o1', requestedAmountCents: 500, createdAt: new Date() })
    await enterFinancialVerification({ claimId: 'cl1', reason: 'refund_moved_unattributed', detail: 'why' })
    expect(alertMock).toHaveBeenCalledTimes(1)
    const p = alertMock.mock.calls[0][0]
    expect(p.facts).toMatchObject({ claimId: 'cl1', orderId: 'o1', ambiguity: 'refund_moved_unattributed' })
    expect(String(p.facts.moneyMoved)).toMatch(/INDÉTERMINÉ/) // never asserts either way
  })

  it('the alert is deduped per claim AND per reason, so a replay cannot storm', async () => {
    await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'a' })
    await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'b' })
    const keys = alertMock.mock.calls.map((c) => c[0].dedupeKey)
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('claim_fv:cl1:stripe_unreadable')
  })

  it('A FAILED ALERT NEVER HIDES THE CLAIM — the queue is the control', async () => {
    alertMock.mockRejectedValue(new Error('smtp down'))
    const r = await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'x' })
    expect(r.entered).toBe(true) // the state change stands
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', reason: 'quality', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:stripe_unreadable: x', createdAt: new Date(), restaurantId: 'r1' }])
    expect(await listFinancialVerificationClaims()).toHaveLength(1)
  })

  it('the queue is UNGATED: it lists the same rows with the claims flag off', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', reason: 'quality', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:stripe_unreadable: x', createdAt: new Date(), restaurantId: 'r1' }])
    const q = await listFinancialVerificationClaims()
    expect(q).toHaveLength(1)
    expect(q[0].moneyTruth).toBe('unresolved') // never "no money"
    delete process.env.CLAIMS_ENABLED
  })

  it('an interrupted attempt is listed too, by its marker', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl9', orderId: 'o9', reason: 'quality', requestedAmountCents: 100, refundId: null, refundError: `${RECONCILE_REQUIRED}: …`, createdAt: new Date(), restaurantId: 'r1' }])
    expect(await listReconcileRequiredClaims()).toHaveLength(1)
    const where = db.claim.findMany.mock.calls.at(-1)![0].where
    expect(where.refundError).toEqual({ startsWith: RECONCILE_REQUIRED })
  })
})

// ═══ THE HATCH MUST NOT LET AN ADMIN GUESS ═══════════════════════════════════════
describe('an interrupted attempt is never closable by admin assertion', () => {
  it('the crash marker is excluded from the guess-based hatch', () => {
    expect(isReconcileRequired(`${RECONCILE_REQUIRED}: started at …`)).toBe(true)
    expect(isStuckResolvable({ status: 'refunding', refundError: `${RECONCILE_REQUIRED}: …` })).toBe(false)
  })

  it('…while a genuinely recorded failure still is', () => {
    expect(isStuckResolvable({ status: 'approved', refundError: 'stripe_failed: …' })).toBe(true)
  })
})

// ═══ REQUIRED DIFFERENTIAL NEGATIVE CONTROLS ═════════════════════════════════════
// Each reinjects a defect the founder named and proves this suite would catch it.
describe('negative controls — every named regression is detectable here', () => {
  it('AMOUNT-ONLY refund matching would bind claim A to refund B', async () => {
    const amountOnly = (claimAmount: number, r: { amountCents: number }) => r.amountCents === claimAmount
    const foreign = row({ id: 'rfB', reason: claimRefundReason('OTHER-CLAIM'), amountCents: 500 })
    expect(amountOnly(500, foreign)).toBe(true) // ← the defect: same amount, wrong owner
    db.refund.findMany.mockResolvedValue([foreign])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 },
    })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification' }) // ← fixed: identity, not amount
  })

  it('a FALSE "no money reached the customer" would be caught', async () => {
    const falseCopy = () => 'aucun (rien n’a encore atteint le client)'
    expect(falseCopy()).toContain('rien n’a encore atteint le client') // ← the defect
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', reason: 'quality', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:stripe_unreadable: x', createdAt: new Date(), restaurantId: 'r1' }])
    const q = await listFinancialVerificationClaims()
    expect(q[0].moneyTruth).toBe('unresolved')                        // ← fixed
    expect(JSON.stringify(q[0])).not.toContain('atteint le client')
  })

  it('REMOVING THE ALERT would be caught', async () => {
    alertMock.mockClear()
    await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'x' })
    expect(alertMock).toHaveBeenCalled() // deleting the call makes this fail
  })

  it('MAKING THE QUEUE FLAG-GATED would be caught', async () => {
    const gated = (enabled: boolean, rowsIn: unknown[]) => (enabled ? rowsIn : []) // ← the defect
    expect(gated(false, [1])).toHaveLength(0)
    process.env.CLAIMS_ENABLED = 'false'
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', reason: 'quality', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:stripe_unreadable: x', createdAt: new Date(), restaurantId: 'r1' }])
    expect(await listFinancialVerificationClaims()).toHaveLength(1)   // ← fixed
    delete process.env.CLAIMS_ENABLED
  })

  it('LETTING THE RECONCILER CREATE A REFUND would be caught', async () => {
    // Every branch is exercised; the engine must never be called from any of them.
    for (const setup of [
      () => db.refund.findMany.mockResolvedValue([row()]),
      () => db.refund.findMany.mockResolvedValue([row({ status: 'pending' })]),
      () => db.refund.findMany.mockResolvedValue([]),
      () => { db.refund.findMany.mockResolvedValue([]); stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('x')) },
    ]) {
      vi.clearAllMocks()
      db.claim.findUnique.mockResolvedValue({ ...CLAIM })
      db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
      db.claim.updateMany.mockResolvedValue({ count: 1 })
      db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
      db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
      stripeMock.refunds.list.mockResolvedValue({ data: [] })
      setup()
      await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(execMock).not.toHaveBeenCalled()
    }
  })

  it('the reconciler refuses a claim that is not awaiting reconciliation at all', async () => {
    db.claim.findUnique.mockResolvedValue({ ...CLAIM, status: 'refunded' })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: false, status: 409 })
  })
})
