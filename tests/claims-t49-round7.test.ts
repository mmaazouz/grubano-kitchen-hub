// tests/claims-t49-round7.test.ts — T-49, round-7 fixes for the round-6 adversarial audit
//
// Round 6 (5 auditors, 23 findings, 15 confirmed) filed one P0 that the refuters re-graded to P1:
// FINANCIAL_VERIFICATION had NO exit for a claim parked because money moved on the order but no
// LOCAL Refund row was ours — the Stripe-Dashboard-refund population. attributeClaimRefund can
// only bind a row that already exists. This file pins the exit built for it, and the other
// round-6 findings, against the SHIPPED code with the same operator-aware CAS mock the earlier
// T-49 suites use — never a where-blind `{ count: 1 }`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { stripeMock } = vi.hoisted(() => ({
  // `refunds.create` exists ONLY so a test can assert it was never called: this module has no
  // Stripe write authority, and a mock that lacks the method would make that assertion vacuous.
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  reconcileClaimEvidence, reconcileClaimForRefund, attributeClaimRefund, adoptStripeRefundForClaim,
  listFinancialVerificationClaims, listActionableRefundClaims, isStuckResolvable, isNoRefundProven,
  claimRefundReason, FINANCIAL_VERIFICATION, NO_REFUND_PROVEN, EXTERNAL_REFUND_KEY_PREFIX,
} from '@/lib/claims'

const CLAIMS_SRC = readFileSync('lib/claims.ts', 'utf8')
/** A REAL mismatch writer, read out of the engine — never hand-typed. */
const MISMATCH = CLAIMS_SRC.match(/refundError: `(resume_mismatch:[^`]*)`/)![1]

const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  { row: null, forcedCount: null, applyWrites: true }

const CLAIM = { id: 'cl1', orderId: 'o1', status: 'refunding', refundId: null, requestedAmountCents: 500 }
const row = (o: Record<string, unknown> = {}) => ({
  id: 'rf1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1',
  reason: claimRefundReason('cl1'), createdAt: new Date(), ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  fx.row = { status: 'refunding', refundId: 'rf1', refundError: null }; fx.forcedCount = null
  db.claim.findUnique.mockResolvedValue({ ...CLAIM })
  db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
  db.refund.findFirst.mockResolvedValue(null)
  db.refund.create.mockResolvedValue({ id: 'rf_ext' })
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
  db.order.findMany.mockResolvedValue([])
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 },
  })
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
  stripeMock.refunds.retrieve.mockReset()
  stripeMock.refunds.create.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(undefined)
  refundsFlag.mockReturnValue(false)
})

// ══ THE STRIPE-ANCHORED EXIT ══════════════════════════════════════════════════════
describe('adoptStripeRefundForClaim — the exit for a Dashboard refund with no local row', () => {
  const RE = 're_dash12345678'
  const stripeRefund = (o: Record<string, unknown> = {}) => ({
    id: RE, status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', created: 1_700_000_000, metadata: {}, ...o,
  })
  const parkedClaim = { id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION }

  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...parkedClaim })
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund())
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 }, metadata: { orderId: 'o1' },
    })
    // The mirrored row, as attributeClaimRefund's tail reads it back.
    db.refund.findUnique.mockResolvedValue({ id: 'rf_ext', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: RE, reason: claimRefundReason('cl1') })
    db.claim.findFirst.mockReset()
    db.claim.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: …' }
  })

  it('FIRST, the park it exists for is real: rows=[] + Stripe says refunded ⇒ FINANCIAL VERIFICATION', async () => {
    db.claim.findUnique.mockResolvedValue({ ...CLAIM })
    fx.row = { status: 'refunding', refundId: null, refundError: null }
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 } })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
    expect(db.refund.create).not.toHaveBeenCalled()
  })

  it('a SUCCEEDED Dashboard refund on THIS payment and charge is mirrored, then bound through the audited tail', async () => {
    const r = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_ext' })
    expect(db.refund.create).toHaveBeenCalledTimes(1)
    const data = db.refund.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      orderId: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1', stripeRefundId: RE,
      idempotencyKey: EXTERNAL_REFUND_KEY_PREFIX + RE, amountCents: 500, status: 'succeeded', reason: claimRefundReason('cl1'),
      restaurantReverseCents: 0, applicationFeeRefundCents: 0, royaltyRefundCents: 0, royaltyClawbackCents: 0,
    })
    // amount and status came from STRIPE, never from the operator: the input has no such fields
    expect(execMock).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    // ROUND-7 AUDIT FIX (P1): "some write sets refunded" was satisfied by a direct write that
    // bypassed the tail — the stamp guard, the one-row-two-claims guard, the FV compare-and-set
    // and the row-status re-read. The tail is pinned by its SIGNATURE: the bind CAS keyed on
    // FINANCIAL_VERIFICATION, then the reconcile CAS keyed on the bound identity, and BOTH audit
    // records — the adoption's and the attribution's.
    const calls = db.claim.updateMany.mock.calls.map((c) => c[0])
    expect(calls[0]).toMatchObject({ where: { status: FINANCIAL_VERIFICATION }, data: { status: 'refunding', refundId: 'rf_ext' } })
    expect(calls[1]).toMatchObject({ where: { refundId: 'rf_ext' }, data: { status: 'refunded' } })
    expect(calls).toHaveLength(2)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.adopt_stripe_refund', metadata: expect.objectContaining({ moneyMoved: false, anchoredCharge: 'ch_1', stripeRefundId: RE }) }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.attribute_refund', metadata: expect.objectContaining({ refundRowId: 'rf_ext', moneyMoved: false }) }))
  })

  it('NEGATIVE CONTROL — a direct terminal write that skipped the tail would be caught by the signature', () => {
    const bypass = [{ where: { id: 'cl1' }, data: { status: 'refunded', refundId: 'rf_ext' } }]
    expect(bypass[0]).not.toMatchObject({ where: { status: FINANCIAL_VERIFICATION } })
    expect(bypass).toHaveLength(1) // ← not 2: the reconcile CAS is missing
  })

  it('dryRun reads Stripe and returns the facts — and writes NOTHING', async () => {
    const r = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1', dryRun: true })
    expect(r).toMatchObject({ ok: true, outcome: 'preview', facts: { stripeRefundId: RE, stripeStatus: 'succeeded', amountCents: 500, paymentIntentId: 'pi_1', chargeId: 'ch_1' } })
    expect(db.refund.create).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  describe('every refusal leaves the DB untouched', () => {
    afterEach(() => {
      expect(db.refund.create).not.toHaveBeenCalled()
      expect(db.claim.updateMany).not.toHaveBeenCalled()
    })
    const adopt = () => adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' })

    it('a refund on ANOTHER payment intent → 400 (ANCHOR 1)', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ payment_intent: 'pi_OTHER' }))
      expect(await adopt()).toMatchObject({ ok: false, status: 400 })
    })
    it('T-51 NEGATIVE CONTROL — same amount as requested, different payment → still 400 (identity, not amount)', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ payment_intent: 'pi_OTHER', amount: 500 }))
      expect(await adopt()).toMatchObject({ ok: false, status: 400 })
    })
    it('a refund on an EARLIER charge of the same payment → 400 (ANCHOR 2)', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ charge: 'ch_failed_attempt' }))
      expect(await adopt()).toMatchObject({ ok: false, status: 400 })
    })
    it('a payment tagged for another order → 400', async () => {
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000 }, metadata: { orderId: 'o_OTHER' } })
      expect(await adopt()).toMatchObject({ ok: false, status: 400 })
    })
    it('a PENDING refund → 409, nothing mirrored (nothing terminal to apply)', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ status: 'pending' }))
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
    })
    it('a FAILED refund → 409 — never a local failed row, which would engage the engine lock', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ status: 'failed' }))
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
    })
    it('a refund the ENGINE created (metadata.grubano_refund_row) → 409, it belongs to the row path', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ metadata: { grubano_refund_row: 'rf_engine' } }))
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
    })
    it('an amount above what was captured → 400', async () => {
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ amount: 999_999 }))
      expect(await adopt()).toMatchObject({ ok: false, status: 400 })
    })
    it('an unknown id → 404; a Stripe outage → 502 — different facts, different answers', async () => {
      stripeMock.refunds.retrieve.mockRejectedValueOnce(Object.assign(new Error('No such refund'), { code: 'resource_missing' }))
      expect(await adopt()).toMatchObject({ ok: false, status: 404 })
      stripeMock.refunds.retrieve.mockRejectedValueOnce(new Error('ECONNRESET'))
      expect(await adopt()).toMatchObject({ ok: false, status: 502 })
    })
    it('a malformed id never reaches Stripe', async () => {
      expect(await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: 'ch_notarefund', adminId: 'op1' })).toMatchObject({ ok: false, status: 400 })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    it('a claim that is NOT parked → 409 (no general override)', async () => {
      db.claim.findUnique.mockResolvedValue({ ...parkedClaim, status: 'refunding' })
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    it('an order with no PaymentIntent → 409, before any Stripe call', async () => {
      db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: null })
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    // ROUND-7 AUDIT FIX (P3): these three used to be pinned by call ORDER (`mockResolvedValueOnce`
    // twice), so the WHERE clauses — the actual guards — were never evaluated. The mock now answers
    // from a row fixture through the same where-matcher the CAS mock uses.
    const withRows = (rows: Array<Record<string, unknown>>) =>
      db.refund.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matchWhere(where, r)) ?? null)

    it('a Stripe id already recorded on ANOTHER order → 400, before any Stripe call', async () => {
      withRows([{ id: 'rfX', orderId: 'o_OTHER', stripeRefundId: RE, status: 'succeeded', reason: null, idempotencyKey: 'refund:o_OTHER:0', amountCents: 500, stripePaymentIntentId: 'pi_X', settledAt: null }])
      expect(await adopt()).toMatchObject({ ok: false, status: 400 })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    it('a Stripe id already recorded on THIS order by the engine → 409 pointing at the row path', async () => {
      withRows([{ id: 'rfX', orderId: 'o1', stripeRefundId: RE, status: 'succeeded', reason: 'admin:x', idempotencyKey: 'refund:o1:0', amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null }])
      const r = await adopt()
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(String((r as { error?: string }).error)).toContain('Attribuer')
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    it('a Stripe id already recorded here but stamped for ANOTHER claim → 409 that names the claim, never « Attribuer »', async () => {
      withRows([{ id: 'rfX', orderId: 'o1', stripeRefundId: RE, status: 'succeeded', reason: claimRefundReason('cl_OTHER'), idempotencyKey: 'refund:o1:0', amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null }])
      const r = await adopt()
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(String((r as { error?: string }).error)).toContain('cl_OTHER')
      expect(String((r as { error?: string }).error)).not.toContain('Attribuer')
    })
    it('a row already stamped for this claim → 409 (multiple_candidate_refunds can never be manufactured)', async () => {
      // NOT matched by stripeRefundId (different re_), matched by orderId + reason = our stamp.
      withRows([{ id: 'rf_mine', orderId: 'o1', stripeRefundId: 're_other000000', status: 'succeeded', reason: claimRefundReason('cl1'), idempotencyKey: 'refund:o1:0', amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null }])
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    it('NEGATIVE CONTROL — the stamped guard is keyed on the STAMP: a row on the order without it does not trip it', async () => {
      withRows([{ id: 'rf_admin', orderId: 'o1', stripeRefundId: 're_other000000', status: 'succeeded', reason: 'admin:x', idempotencyKey: 'refund:o1:0', amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null }])
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ status: 'pending' })) // refused later, for another reason
      expect(await adopt()).toMatchObject({ ok: false, status: 409 })
      expect(stripeMock.refunds.retrieve).toHaveBeenCalled() // ← it got PAST the stamped guard
    })
    // ROUND-7 AUDIT FIX (P3): two of the three conjuncts of the crash-resume 'ours' predicate were
    // pinned by nothing — deleting `status === 'succeeded'` stayed green.
    it('an external row stamped for this claim whose status is no longer succeeded is NOT resumed → 409, no bind', async () => {
      withRows([{ id: 'rf_ext', orderId: 'o1', stripeRefundId: RE, status: 'failed', reason: claimRefundReason('cl1'), idempotencyKey: EXTERNAL_REFUND_KEY_PREFIX + RE, amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null }])
      const r = await adopt()
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(String((r as { error?: string }).error)).toContain('failed')
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    })
    it('an external row stamped for ANOTHER claim is NOT resumed → 409 naming that claim', async () => {
      withRows([{ id: 'rf_ext', orderId: 'o1', stripeRefundId: RE, status: 'succeeded', reason: claimRefundReason('cl_OTHER'), idempotencyKey: EXTERNAL_REFUND_KEY_PREFIX + RE, amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null }])
      const r = await adopt()
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(String((r as { error?: string }).error)).toContain('cl_OTHER')
    })
  })

  describe('CRASH-RESUME facts come from OUR row and say so (round-7 P2)', () => {
    const resumeRow = { id: 'rf_ext', orderId: 'o1', stripeRefundId: RE, status: 'succeeded', reason: claimRefundReason('cl1'), idempotencyKey: EXTERNAL_REFUND_KEY_PREFIX + RE, amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: new Date('2026-09-10T10:00:00Z') }
    // Braces on purpose: a beforeEach that RETURNS the mock hands vitest a "cleanup" function,
    // which it then calls with no arguments.
    beforeEach(() => {
      db.refund.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (matchWhere(where, resumeRow) ? resumeRow : null))
    })

    it('dryRun returns a REAL preview (wouldWrite false, source local_row) so « Lier » can enable — and writes nothing', async () => {
      const r = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1', dryRun: true })
      expect(r).toMatchObject({ ok: true, outcome: 'preview', wouldWrite: false, facts: { stripeRefundId: RE, stripeStatus: 'succeeded', amountCents: 500, paymentIntentId: 'pi_1', source: 'local_row' } })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
      expect(db.refund.create).not.toHaveBeenCalled()
      expect(db.claim.updateMany).not.toHaveBeenCalled()
    })

    it('the resumed success reports the row’s amount, never 0, and marks the source', async () => {
      const r = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' })
      expect(r).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_ext', facts: { amountCents: 500, source: 'local_row' } })
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
      expect(db.refund.create).not.toHaveBeenCalled()
    })
  })

  it('a double submit collides on the UNIQUE key → 409, never two rows', async () => {
    const { Prisma } = await import('@prisma/client')
    db.refund.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
    expect(await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' })).toMatchObject({ ok: false, status: 409 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('CRASH-RESUME — the row was mirrored and the process died before binding: no second Stripe read, bound through the tail', async () => {
    db.refund.findFirst.mockResolvedValueOnce({ id: 'rf_ext', orderId: 'o1', status: 'succeeded', reason: claimRefundReason('cl1'), idempotencyKey: EXTERNAL_REFUND_KEY_PREFIX + RE, amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: null })
    const r = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_ext' })
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    expect(db.refund.create).not.toHaveBeenCalled()
  })

  it('the row path now refuses a row stamped for ANOTHER claim (round-6 hardening, T-51: reason IS identity)', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf9', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_9', reason: claimRefundReason('cl_OTHER') })
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(String((r as { error?: string }).error)).toContain('cl_OTHER')
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('POPULATION C REGRESSION PIN — a claim parked as stripe_unreadable exits on the next reconcile once Stripe reads zero', async () => {
    db.claim.findUnique.mockResolvedValue({ ...CLAIM, status: FINANCIAL_VERIFICATION })
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:stripe_unreadable: …' }
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'no_refund_proven' })
    const calls = db.claim.updateMany.mock.calls
    const data = calls[calls.length - 1][0].data
    expect(data).toMatchObject({ status: 'approved', refundAttempted: false })
    expect(isNoRefundProven(data.refundError)).toBe(true)
  })

  it('THE HATCH STAYS CLOSED — a parked claim is never closable by admin assertion', () => {
    expect(isStuckResolvable({ status: FINANCIAL_VERIFICATION, refundError: 'financial_verification:refund_moved_unattributed: …' })).toBe(false)
  })
})

// ══ ROUND-7 FINDINGS, PINNED WHERE THE BEHAVIOUR LIVES ═════════════════════════════
describe('round-7 P1/P2 fixes in the library', () => {
  it('an ALREADY-parked claim gets its ambiguity REFRESHED when new evidence arrives (relabel, not a no-op)', async () => {
    // Parked as stripe_unreadable; Stripe now reads fine and reports money moved on the order.
    db.claim.findUnique.mockResolvedValue({ ...CLAIM, status: FINANCIAL_VERIFICATION })
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:stripe_unreadable: …' }
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 } })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
    expect((r as { reason?: string }).reason).not.toBe('already_parked_or_moved')
    const writes = db.claim.updateMany.mock.calls.map((c) => c[0])
    const relabel = writes.find((w) => w.where?.status === FINANCIAL_VERIFICATION && typeof w.data?.refundError === 'string')
    expect(relabel).toBeDefined()
    expect(String(relabel!.data.refundError)).toContain('financial_verification:refund_moved_unattributed')
    expect(writes.some((w) => w.data?.status && w.data.status !== FINANCIAL_VERIFICATION)).toBe(false) // status untouched
  })

  it('…and a claim that really moved on (terminal) is still reported as already_parked_or_moved', async () => {
    db.claim.findUnique.mockResolvedValue({ ...CLAIM, status: FINANCIAL_VERIFICATION })
    fx.row = { status: 'refunded', refundId: null, refundError: null } // moved to terminal concurrently
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 } })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification', reason: 'already_parked_or_moved' })
  })

  it('the row path refuses an UNSTAMPED row while a row stamped for THIS claim exists on the order', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
    const rows = [
      { id: 'rf_mine', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_m', reason: claimRefundReason('cl1') },
      { id: 'rf_admin', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_a', reason: 'admin:x' },
    ]
    db.refund.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows.find((x) => x.id === where.id) ?? null)
    db.refund.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => rows.find((x) => matchWhere(where, x)) ?? null)
    db.claim.findFirst.mockResolvedValue(null)
    const refused = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_admin', adminId: 'op1' })
    expect(refused).toMatchObject({ ok: false, status: 409 })
    expect(String((refused as { error?: string }).error)).toContain('rf_mine')
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    // the stamped row itself proceeds past that guard (it fails later only because this mock's
    // findFirst returns null for reconcileClaimForRefund — the guard is what is under test)
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:x: …' }
    const ok = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_mine', adminId: 'op1' })
    expect(db.claim.updateMany).toHaveBeenCalled() // the bind CAS ran: the guard let the stamped row through
    if (!ok.ok) expect(String((ok as { error?: string }).error)).not.toContain('porte déjà l’identité')
  })

  it('an engine failure is stored as engine_failed:<engine text> — with the truth that nothing re-drives it from here', async () => {
    // Drive the real producer: an approved claim, the attempt CAS, the engine refusing.
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, requestedAmountCents: 500, refundId: null, refundError: null })
    fx.row = { status: 'approved', refundAttempted: false, refundId: null, refundError: null }
    refundsFlag.mockReturnValue(true)
    execMock.mockResolvedValue({ ok: false, status: 502, error: 'Erreur paiement, réessayez.' })
    const { triggerClaimRefund } = await import('@/lib/claims')
    const r = await triggerClaimRefund('cl1')
    expect(r).toMatchObject({ state: 'failed' })
    const written = String(db.claim.update.mock.calls.at(-1)![0].data.refundError)
    expect(written.startsWith('engine_failed: Erreur paiement, réessayez.')).toBe(true)
    expect(written).toContain('aucune relance possible depuis les réclamations')
  })
})

// ══ THE OTHER ROUND-6 FINDINGS, PINNED WHERE THE BEHAVIOUR LIVES ════════════════════
describe('round-6 P1/P2 fixes in the library', () => {
  it('reconcile_not_applied — exactly one row is ours but the CAS could not apply: parked under ITS OWN reason', async () => {
    db.refund.findMany.mockResolvedValue([row()])
    // reconcileClaimForRefund finds the claim already TERMINAL → already_final → not applied
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunded', refundError: null })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification', reason: 'reconcile_not_applied' })
    expect(String((r as { detail?: string }).detail)).toContain("porte bien l'identité")
  })

  it('no_payment_intent — an order with no Stripe payment is parked as a FACT, not as "unreadable", and Stripe is never called', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: null })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification', reason: 'no_payment_intent' })
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('proof of absence is NOT a stuck refund: the hatch is closed on it, open on the rail-locked variant', () => {
    expect(isStuckResolvable({ status: 'approved', refundError: NO_REFUND_PROVEN + ': aucun remboursement …' })).toBe(false)
    expect(isStuckResolvable({ status: 'approved', refundError: 'no_refund_proven_rail_locked: Stripe ne rapporte AUCUN …' })).toBe(true)
  })

  it('the FAILED branch of the row reconciler refuses a DISOWNED binding, exactly like the succeeded branch', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: MISMATCH })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'failed', stripeRefundId: 're_1' })
    expect(r).toMatchObject({ reconciled: false, reason: 'not_bound' })
    expect(db.claim.updateMany).not.toHaveBeenCalled() // the marker survives
  })

  it('the stripe_failed writer speaks of THE ROW, never of the customer — pinned on the shipped template', async () => {
    fx.row = { status: 'refunding', refundId: 'rf1', refundError: null }
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'failed', stripeRefundId: 're_1' })
    expect(r).toMatchObject({ reconciled: true })
    const written = String(db.claim.updateMany.mock.calls[0][0].data.refundError)
    expect(written).toContain('cette ligne n’a donc rien versé')
    expect(written).toContain('ne dit RIEN des autres remboursements')
    expect(written).not.toMatch(/client/i)
  })

  it('the queue row carries the order PaymentIntent, so the operator knows which payment to open', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', reason: 'x', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: …', createdAt: new Date(), decidedAt: null, restaurantId: 'r1' }])
    db.order.findMany.mockResolvedValue([{ id: 'o1', stripePaymentIntentId: 'pi_1' }])
    const out = await listFinancialVerificationClaims()
    expect(out[0].orderStripePaymentIntentId).toBe('pi_1')
  })
})

// ══ THE MONEY QUEUE CLASSIFIER — another claim's cash is never this claim's ═════════
describe('listActionableRefundClaims after round 6', () => {
  const claimRow = (over: Record<string, unknown> = {}) => ({
    id: 'cl1', status: 'refunding', refundId: 'rf1', refundError: null, refundAttempted: true,
    requestedAmountCents: 500, createdAt: new Date(), reason: 'wrong_item', ...over,
  })

  it('a bound SUCCEEDED row the engine DISOWNED yields actualRefundedCents null and refundNotOurs true', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ refundError: MISMATCH })])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', amountCents: 1200, stripeRefundId: 're_1', createdAt: new Date() }])
    const out = await listActionableRefundClaims()
    expect(out[0].actualRefundedCents).toBeNull()   // ← 1200 c was printed as this claim's money
    expect(out[0].refundNotOurs).toBe(true)
    expect(out[0].refund).toMatchObject({ status: 'succeeded' }) // the link itself is still shown
  })

  it('a genuinely bound succeeded row still reports its amount', async () => {
    db.claim.findMany.mockResolvedValue([claimRow()])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', amountCents: 480, stripeRefundId: 're_1', createdAt: new Date() }])
    const out = await listActionableRefundClaims()
    expect(out[0].actualRefundedCents).toBe(480)
    expect(out[0].refundNotOurs).toBe(false)
  })

  it('proof of absence classifies as absence_proven_payable, not as a recorded error', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ status: 'approved', refundId: null, refundAttempted: false, refundError: NO_REFUND_PROVEN + ': aucun remboursement …' })])
    const out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('absence_proven_payable')
    expect(out[0].resolvable).toBe(false)
  })

  it('the rail-locked variant stays a human matter', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ status: 'approved', refundId: null, refundError: 'no_refund_proven_rail_locked: …' })])
    const out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('refund_error_recorded')
    expect(out[0].resolvable).toBe(true)
  })

  // (ROUND-7 AUDIT FIX, P3: a "negative control" that re-implemented the old rule as a local lambda
  // lived here. It touched no shipped code and proved nothing; the first test in this block IS
  // the differential — it reads the shipped classifier with the real marker.)
})
