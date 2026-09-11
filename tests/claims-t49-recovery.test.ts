// tests/claims-t49-recovery.test.ts — T-49, founder decision 2026-09-10
//
// EVIDENCE ONLY, FAIL CLOSED ON AMBIGUITY — and fail VISIBLE, because a safe state nobody can
// see is a leak rather than safety. These tests pin both halves:
//
//   MONEY SAFETY    — no new money, no closure, no re-file and no guess when attribution
//                     cannot be proven; a claim never binds to another rail's refund;
//   RECOVERY LIVENESS — the ambiguous claim lands in a durable queue that survives the feature
//                     flag, raises an alert, and has a reachable evidence-based exit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { updateManyMock } from './support/prisma-where'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { stripeMock } = vi.hoisted(() => ({
  // `refunds.create` exists ONLY so a test can assert it was never called: this module has no
  // Stripe write authority, and a mock that lacks the method would make that assertion vacuous.
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  reconcileClaimEvidence, enterFinancialVerification, listFinancialVerificationClaims,
  listReconcileRequiredClaims, isStuckResolvable, isReconcileRequired, claimRefundReason, attributeClaimRefund, reconcileMarkerAge, RECONCILE_GRACE_MS, runClaimAutoApproval,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED,
  // round 7
  adoptStripeRefundForClaim, reconcileClaimForRefund, isNoRefundProven, NO_REFUND_PROVEN, EXTERNAL_REFUND_KEY_PREFIX,
} from '@/lib/claims'

/** The simulated row the CAS clauses are evaluated against (tests/support/prisma-where). */
const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  // applyWrites: the reconciler performs a CHAIN of CAS operations (bind, then reconcile), so the
  // simulated row must carry the first write into the second guard, exactly as a real row would.
  { row: null, forcedCount: null, applyWrites: true }

const CLAIM = { id: 'cl1', orderId: 'o1', status: 'refunding', refundId: null, requestedAmountCents: 500 }
const row = (o: Record<string, unknown> = {}) => ({
  id: 'rf1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1',
  reason: claimRefundReason('cl1'), createdAt: new Date(), ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  // The simulated row models the state AFTER the reconciler's binding write, because that write
  // happens first in the flow and the CAS that follows keys on the bound identity. A row that
  // did not model it would fail the second CAS and mask the outcome under test.
  fx.row = { status: 'refunding', refundId: 'rf1', refundError: null }; fx.forcedCount = null
  db.claim.findUnique.mockResolvedValue({ ...CLAIM })
  // reconcileClaimForRefund resolves the bound claim by refundId.
  db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
  // AUDIT FIX (T-49 audit, P1). This suite reintroduced the exact defect the batch exists to
  // remove: `mockResolvedValue({ count: 1 })` answers 1 for ANY where clause, so every CAS added
  // by T-49 — enterFinancialVerification's status window, the binding update, the pending clear,
  // the proof-of-absence release — was executed and never verified. The operator-aware mock
  // evaluates the clause against a simulated row instead.
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
  db.order.findMany.mockResolvedValue([])
  db.refund.findFirst.mockResolvedValue(null)
  db.refund.create.mockResolvedValue({ id: 'rf_ext' })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 },
  })
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
  stripeMock.refunds.retrieve.mockReset()
  stripeMock.refunds.create.mockReset()
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
    // ROUND-9: a pending row is decided by what Stripe proves about it — here, Stripe reports it pending.
    // ROUND-10: a recorded Stripe id is read BY that id, as the engine's own resume does.
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', status: 'pending', amount: 500, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf1' } })
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
    // ROUND-3 AUDIT FIX: the predicate is an OR now — the marker OR the LEGACY stranded shape,
    // which predates the marker and would otherwise fall out of every ambiguous list.
    const where = db.claim.findMany.mock.calls.at(-1)![0].where as { OR: Array<Record<string, unknown>> }
    expect(where.OR).toHaveLength(2)
    expect(where.OR[0].refundError).toEqual({ startsWith: RECONCILE_REQUIRED })
    expect(where.OR[1]).toMatchObject({ status: 'refunding', refundId: null, refundError: null })
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

// ══ AUDIT FIX — THE GUARDS ARE EXERCISED IN THEIR FAILING DIRECTION TOO ══════════
// The audit noted the T-51 identity guard and the T-49 crash marker were only ever tested
// where they pass, which proves nothing about what they refuse.
describe('the identity guard and the crash marker, exercised where they REFUSE', () => {
  it('a refund row belonging to ANOTHER claim is never adopted', async () => {
    db.refund.findMany.mockResolvedValue([row({ reason: claimRefundReason('SOMEONE-ELSE') })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 },
    })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'financial_verification' })
  })

  it('a refund row with NO identity at all is never adopted', async () => {
    db.refund.findMany.mockResolvedValue([row({ reason: null })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 },
    })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification' })
  })

  it('the marker is NOT treated as a recorded failure by any reader', () => {
    expect(isReconcileRequired('stripe_failed: la banque a refusé')).toBe(false)
    expect(isReconcileRequired(null)).toBe(false)
    expect(isReconcileRequired(undefined)).toBe(false)
    expect(isStuckResolvable({ status: 'refunding', refundError: `${RECONCILE_REQUIRED}: x` })).toBe(false)
  })

  it('PROOF OF ABSENCE survives a stale FAILED row that never reached Stripe', async () => {
    // A failed row with NO Stripe id does not lock the engine, so the claim is genuinely payable.
    db.refund.findMany.mockResolvedValue([row({ status: 'failed', reason: 'admin:x', stripeRefundId: null })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 },
    })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'no_refund_proven' })
  })

  it('…but a failed row WITH a Stripe id locks the engine, and the outcome says so', async () => {
    // ROUND-3 AUDIT FIX: executeRefund refuses every later refund on an order carrying a failed
    // row with a Stripe id. Reporting "payable again by the normal rail" was the opposite of what
    // the engine will do, and the honest reason was written to a field no human reads.
    db.refund.findMany.mockResolvedValue([row({ status: 'failed', reason: 'admin:x', stripeRefundId: 're_dead' })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 },
    })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ outcome: 'no_refund_proven_rail_locked' })
    const wrote = db.claim.updateMany.mock.calls.at(-1)![0].data as { refundError: string }
    expect(wrote.refundError).toContain('rail_locked')
    expect(execMock).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — one outcome for both cases would be caught here', async () => {
    // The two states differ ONLY by whether the engine will accept a later refund. Collapsing them
    // (as the previous round did) is what let the console promise a payment that will be refused.
    const collapsed = () => 'no_refund_proven'
    expect(collapsed()).toBe('no_refund_proven')
    db.refund.findMany.mockResolvedValue([row({ status: 'failed', reason: 'admin:x', stripeRefundId: 're_dead' })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 },
    })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'no_refund_proven_rail_locked' })
  })

  it('a LEGACY stranded row (no marker at all) is still listed as ambiguous', async () => {
    // ROUND-3 AUDIT FIX: it has no marker, so it fell out of every ambiguous list, landed in the
    // generic bucket that calls its state "known", and lost its only handle.
    db.claim.findMany.mockResolvedValue([
      { id: 'legacy', orderId: 'o1', reason: 'quality', requestedAmountCents: 500,
        refundId: null, refundError: null, createdAt: new Date(), restaurantId: 'r1' },
    ])
    expect(await listReconcileRequiredClaims()).toHaveLength(1)
  })

  it('…but a SUCCEEDED row of another rail still blocks that proof', async () => {
    db.refund.findMany.mockResolvedValue([row({ status: 'succeeded', reason: 'admin:x' })])
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 },
    })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification' })
  })
})

// ══ AUDIT FIX — THE PARKED STATE HAS A REAL EXIT ════════════════════════════════
describe('attributeClaimRefund — the escalation exit out of a permanent park', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
    db.refund.findUnique.mockResolvedValue({ id: 'rf9', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_9' })
    // findFirst serves TWO callers here: the double-attribution guard (must find nothing) and
    // reconcileClaimForRefund (must find this claim). Order matters, so drive it explicitly.
    db.claim.findFirst
      .mockResolvedValueOnce(null) // no OTHER claim already holds this refund
      .mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: 'rf9', refundError: null }
  })

  it('an operator-supplied link is applied with the ROW’s truth, not the operator’s', async () => {
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf9' })
    expect(execMock).not.toHaveBeenCalled() // still no money authority
  })

  it('a refund from ANOTHER order is refused outright', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf9', orderId: 'DIFFERENT', status: 'succeeded', amountCents: 500, stripeRefundId: null })
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  it('the outcome follows the row: a FAILED row cannot be attributed as a success', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf9', orderId: 'o1', status: 'failed', amountCents: 500, stripeRefundId: 're_9' })
    db.claim.findFirst.mockReset()
    db.claim.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refund_failed' })
  })

  it('a PENDING row is attributed without any terminal verdict', async () => {
    // ROUND-8: a pending row must carry a Stripe id to be attributable — without one nothing is
    // confirmed at Stripe and the shared rule refuses it (pinned in tests/claims-t49-round9.test.ts).
    db.refund.findUnique.mockResolvedValue({ id: 'rf9', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: 're_9' })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' }))
      .toMatchObject({ ok: true, outcome: 'still_pending' })
  })

  it('it refuses a claim that is not parked, so it cannot be used as a general override', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'refunding' })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' }))
      .toMatchObject({ ok: false, status: 409 })
  })

  it('NEGATIVE CONTROL — a park with no exit at all would be caught here', async () => {
    const absorbing = (status: string) => status === FINANCIAL_VERIFICATION // ← the defect: no way out
    expect(absorbing(FINANCIAL_VERIFICATION)).toBe(true)
    db.claim.findFirst.mockReset()
    db.claim.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    expect(r.ok).toBe(true) // ← fixed: there is a way out
  })
})

// ══ RE-AUDIT FIX — THE GRACE WINDOW MUST ACTUALLY PARSE A MARKER ════════════════
// It shipped INERT: the regex lost its backslashes, so reconcileMarkerAge always returned null
// and every marker — including a refund in flight one second earlier — was listed as stranded.
// Three independent auditors found it. These tests make the parse itself the thing under test.
describe('reconcileMarkerAge — the grace window is not decorative', () => {
  const marker = (iso: string) => `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${iso} — identité pas encore liée.`

  it('parses the timestamp out of a REAL marker (this is what was broken)', () => {
    const iso = '2026-09-10T16:18:16.910Z'
    const age = reconcileMarkerAge(marker(iso), Date.parse(iso) + 90_000)
    expect(age).toBe(90_000)
  })

  it('a refund in flight one second ago is INSIDE the grace window', () => {
    const age = reconcileMarkerAge(marker(new Date(Date.now() - 1000).toISOString()))
    expect(age).not.toBeNull()
    expect(age!).toBeLessThan(RECONCILE_GRACE_MS)
  })

  it('an attempt older than the grace window is outside it', () => {
    const age = reconcileMarkerAge(marker(new Date(Date.now() - 10 * 60 * 1000).toISOString()))
    expect(age!).toBeGreaterThan(RECONCILE_GRACE_MS)
  })

  it('a non-marker returns null, and so does a marker with no timestamp', () => {
    expect(reconcileMarkerAge('stripe_failed: …')).toBeNull()
    expect(reconcileMarkerAge(`${RECONCILE_REQUIRED}: pas d’horodatage`)).toBeNull()
  })

  it('NEGATIVE CONTROL — the shipped-inert regex would be caught here', () => {
    const inert = /(d{4}-d{2}-d{2}T[d:.]+Z)/   // ← exactly what shipped
    const iso = '2026-09-10T16:18:16.910Z'
    expect(inert.exec(marker(iso))).toBeNull()          // ← never matched anything
    expect(reconcileMarkerAge(marker(iso))).not.toBeNull() // ← fixed
  })

  it('an unreadable marker still fails VISIBLE: the claim is listed, not hidden', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'x', orderId: 'o', reason: 'quality', requestedAmountCents: 1, refundId: null,
        refundError: `${RECONCILE_REQUIRED}: pas d’horodatage`, createdAt: new Date(), restaurantId: 'r' },
    ])
    expect(await listReconcileRequiredClaims()).toHaveLength(1)
  })
})

// ══ ROUND-3 AUDIT FIX — THE ATTRIBUTION GUARD IS DRIVEN TO REFUSE ═══════════════
// The audit noted the double-attribution guard was only ever exercised where it PASSES, which
// proves nothing about what it blocks — and that the findFirst mock ignored its where clause, so
// the guard could have been querying anything at all.
describe('the double-attribution guard, exercised where it REFUSES', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
    db.refund.findUnique.mockResolvedValue({ id: 'rf9', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_9' })
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: 'rf9', refundError: null }
  })

  it('a refund ALREADY held by another claim is refused, and nothing is bound', async () => {
    db.claim.findFirst.mockReset()
    db.claim.findFirst.mockResolvedValue({ id: 'OTHER-CLAIM' }) // the guard finds a holder
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(String((r as { error: string }).error)).toContain('OTHER-CLAIM')
    expect(db.claim.updateMany).not.toHaveBeenCalled() // refused BEFORE any write
  })

  it('the guard queries the right thing: this refund, excluding this claim', async () => {
    db.claim.findFirst.mockReset()
    db.claim.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    const where = db.claim.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({ refundId: 'rf9', id: { not: 'cl1' } })
  })

  it('NEGATIVE CONTROL — a guard that never refused would be caught here', async () => {
    const noGuard = () => null // ← the previous behaviour: nothing was ever found
    expect(noGuard()).toBeNull()
    db.claim.findFirst.mockReset()
    db.claim.findFirst.mockResolvedValue({ id: 'OTHER-CLAIM' })
    expect((await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })).ok).toBe(false)
  })
})

// ══ ROUND-3 — THE GRACE WINDOW IS ROUND-TRIPPED THROUGH THE REAL WRITER ═════════
// The audit noted the grace tests re-typed the marker by hand, so a writer/reader divergence —
// exactly the bug that shipped — would go unseen. This drives the SHIPPED writer.
describe('the marker the code WRITES is the marker the code can READ', () => {
  it('round-trips: the SHIPPED writer produces a marker the SHIPPED reader parses', async () => {
    // ROUND-4 AUDIT FIX (P1). The previous version called reconcileClaimEvidence, which never
    // writes a marker, then fell through to a hand-typed string — so it asserted its own literal
    // and would NOT have caught the writer/reader divergence it was named after. That divergence
    // is exactly what shipped in round 2 (the inert regex). This drives the real producer:
    // runClaimAutoApproval -> approveClaim -> triggerClaimRefund, whose CAS writes the marker.
    refundsFlag.mockReturnValue(true)
    fx.row = { status: 'restaurant_review', refundAttempted: false, refundId: null, refundError: null }
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.status === 'restaurant_review' ? [{ id: 'cl1', reason: 'quality' }] : []))
    db.claim.findUnique.mockResolvedValue({ orderId: 'o1', requestedAmountCents: 500 })
    execMock.mockResolvedValue({ ok: false, status: 502, error: 'boom' })
    await runClaimAutoApproval()

    const markers = db.claim.updateMany.mock.calls
      .map((c) => (c[0].data as { refundError?: unknown }).refundError)
      .filter((v): v is string => typeof v === 'string' && v.startsWith(RECONCILE_REQUIRED))
    // If the producer stopped writing a marker at all, that is itself the regression: fail here
    // rather than quietly substituting a literal, which is what the old version did.
    expect(markers.length).toBeGreaterThan(0)
    expect(reconcileMarkerAge(markers[0])).not.toBeNull()
    expect(reconcileMarkerAge(markers[0])!).toBeLessThan(RECONCILE_GRACE_MS)
  })

  it('NEGATIVE CONTROL — a writer emitting a non-ISO timestamp is caught by the round trip', () => {
    // The exact divergence the round trip exists for: change the writer, keep the reader.
    const badWriter = (now: Date) => `${RECONCILE_REQUIRED}: démarrée à ${now.toString()} — x`
    expect(reconcileMarkerAge(badWriter(new Date()))).toBeNull() // ← would strand every attempt
    const goodWriter = (now: Date) => `${RECONCILE_REQUIRED}: démarrée à ${now.toISOString()} — x`
    expect(reconcileMarkerAge(goodWriter(new Date()))).not.toBeNull()
  })
  it('a marker dated in the FUTURE is not read as healthy', () => {
    // ROUND-3 AUDIT FIX: clock skew gave a NEGATIVE age, which the grace filter read as "still in
    // flight" and hid the claim indefinitely. A future marker is not evidence of health.
    const future = `${RECONCILE_REQUIRED}: démarrée à ${new Date(Date.now() + 3600_000).toISOString()} — x`
    expect(reconcileMarkerAge(future)).toBeNull()
  })

  it('…and an unreadable age still lands the claim in the list, never hidden', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'z', orderId: 'o', reason: 'quality', requestedAmountCents: 1, refundId: null,
        refundError: `${RECONCILE_REQUIRED}: démarrée à ${new Date(Date.now() + 3600_000).toISOString()} — x`,
        createdAt: new Date(), restaurantId: 'r' },
    ])
    expect(await listReconcileRequiredClaims()).toHaveLength(1)
  })
})
