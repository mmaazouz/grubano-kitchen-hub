// tests/claims-state-machine.test.ts — CLAIMS batch 1 state machine & reconciliation
//
// Covers the foundational invariants introduced by this batch:
//   • restaurant SILENCE past the deadline becomes admin-actionable (it used to block
//     for ever) and still NEVER auto-refunds;
//   • the LEGACY FINALIZATION LOCK — an already-arbitrated claim cannot be re-arbitrated;
//   • REFUND IDENTITY BINDING — a RESUME-FIRST mismatch never reports the claim settled;
//   • REFUND → CLAIM RECONCILIATION, which must work with CLAIMS_ENABLED=false.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { updateManyMock } from './support/prisma-where'

const { db } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

import { arbitrateClaim, reconcileClaimForRefund, listActionableRefundClaims, claimAuthority, isClaimsEnabled, resolveStuckClaim, recoverStrandedClaimReconciliations, autoResolveSmallClaim, isStuckResolvable, runClaimAutoApproval, listArbitrationQueue } from '@/lib/claims'
import { ACCEPTED_REASONS, isSafetyReason } from '@/lib/claim-reasons'

const HOUR = 3600 * 1000
const past = () => new Date(Date.now() - 2 * HOUR)
const future = () => new Date(Date.now() + 2 * HOUR)
const fx: { row: Record<string, unknown> | null; forcedCount: number | null } = { row: null, forcedCount: null }

beforeEach(() => {
  vi.clearAllMocks()
  fx.row = null; fx.forcedCount = null
  // RE-AUDIT FIX: a mock that returns count:1 for ANY where clause cannot detect a CAS
  // regression — it is exactly why the first version of the unpaid-approval fix looked green
  // while the updateMany actually matched zero rows. This mock EVALUATES the where clause
  // against a simulated row, so a wrong CAS now fails the test.
  //
  // GATE T-49 FIX: the previous version skipped EVERY object-valued clause with
  //   `if (typeof v === 'object') continue  // range clauses — not simulated`
  // which silently exempted precisely the predicates that carry the money invariants:
  //   status: { in: ['refunding', 'approved'] }   (reconcileClaimForRefund's CAS)
  //   refundError: { not: null }                  (the stuck-money escape hatch)
  //   responseDeadlineAt: { lte: now }            (restaurant silence)
  // A fix that broke any of those stayed GREEN. Prisma's comparison operators are now
  // evaluated for real; an unsupported operator THROWS instead of passing silently, so the
  // suite can never again be quietly blind to a clause shape it does not understand.
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  db.claim.groupBy.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  // T-51: the default fixture row is stamped for the claim these suites drive ('cl1'). Without
  // an identity the guard fails CLOSED and every binding becomes a resume_mismatch — which is
  // exactly the intended behaviour, and why the stamp has to be explicit here.
  db.refund.findUnique.mockResolvedValue({ status: 'succeeded', reason: 'claim:cl1' })
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1', stripeRefundId: 're_1', amountCents: 500 })
  refundsFlag.mockReturnValue(true)
  delete process.env.CLAIMS_ENABLED
})

describe('RESTAURANT SILENCE — never blocks resolution for ever, never auto-refunds', () => {
  it('deadline PASSED → an admin may arbitrate the untouched restaurant_review claim', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'restaurant_review', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final', reason: 'hors périmètre' })
    expect(res.ok).toBe(true)
    // the CAS re-checks the deadline, so a restaurant answering at the same instant wins/loses cleanly
    const where = db.claim.updateMany.mock.calls[0][0].where
    expect(where).toMatchObject({ id: 'cl1', status: 'restaurant_review', arbitrationDecision: null })
    expect(where.responseDeadlineAt).toHaveProperty('lte')
    expect(execMock).not.toHaveBeenCalled()
  })

  it('deadline NOT passed → arbitration is REFUSED (the restaurant still holds the hand)', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'restaurant_review', refundAttempted: false, responseDeadlineAt: future(), arbitrationDecision: null })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('silence alone NEVER refunds — money only moves on an explicit admin approve', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'restaurant_review', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
    await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final' })
    expect(execMock).not.toHaveBeenCalled()
    db.claim.findUnique.mockResolvedValue({ id: 'cl2', status: 'restaurant_review', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null, orderId: 'o1', requestedAmountCents: 500 })
    await arbitrateClaim({ claimId: 'cl2', adminId: 'admin1', decision: 'approve' })
    expect(execMock).toHaveBeenCalledTimes(1) // the ADMIN decided, not the clock
  })

  it('claimAuthority names the current holder and whether an admin may act', () => {
    expect(claimAuthority({ status: 'restaurant_review', responseDeadlineAt: future(), refundAttempted: false }))
      .toMatchObject({ holder: 'restaurant', adminActionable: false, deadlineExpired: false, restaurantResponded: false })
    expect(claimAuthority({ status: 'restaurant_review', responseDeadlineAt: past(), refundAttempted: false }))
      .toMatchObject({ holder: 'admin', adminActionable: true, deadlineExpired: true })
    expect(claimAuthority({ status: 'arbitration', responseDeadlineAt: past(), refundAttempted: false }))
      .toMatchObject({ holder: 'admin', adminActionable: true, restaurantResponded: true })
    // fail-closed: an unreadable deadline never counts as expired
    expect(claimAuthority({ status: 'restaurant_review', responseDeadlineAt: null, refundAttempted: false }))
      .toMatchObject({ holder: 'restaurant', adminActionable: false })
  })
})

describe('LEGACY FINALIZATION LOCK — a decided claim is decided', () => {
  it('an already-arbitrated claim cannot be arbitrated a second time', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: 'approved' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin2', decision: 'refuse_final' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('a terminal claim (refunded / refused_final) is immutable under arbitration', async () => {
    for (const status of ['refunded', 'refused_final']) {
      vi.clearAllMocks()
      db.claim.findUnique.mockResolvedValue({ id: 'cl1', status, refundAttempted: true, responseDeadlineAt: past(), arbitrationDecision: null })
      const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
      expect(res).toMatchObject({ ok: false, status: 409 })
      expect(db.claim.updateMany).not.toHaveBeenCalled()
      expect(execMock).not.toHaveBeenCalled()
    }
  })

  it('the CAS still carries arbitrationDecision:null, so a concurrent second admin loses', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
    db.claim.updateMany.mockResolvedValue({ count: 0 }) // the other admin got there first
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })
})

describe('REFUND IDENTITY BINDING — a claim never claims an amount nobody asked for', () => {
  it('RESUME-FIRST mismatch → claim NOT marked refunded, bound to the real refund, admin required', async () => {
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl1', status: 'arbitration', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
      .mockResolvedValueOnce({ orderId: 'o1', requestedAmountCents: 500 })
      .mockResolvedValue({ id: 'cl1' })
    execMock.mockResolvedValue({ ok: true, refundId: 'rf_older', stripeRefundId: 're_older', amountCents: 1200, resumedIgnoredAmount: true })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect((res as { refund?: { state: string } }).refund).toMatchObject({ state: 'failed' })
    const written = db.claim.update.mock.calls.at(-1)![0].data
    expect(written.refundId).toBe('rf_older')          // bound to the ACTUAL refund driven
    expect(written.status).toBeUndefined()             // NOT flipped to 'refunded'
    expect(String(written.refundError)).toMatch(/resume_mismatch/)
  })

  it('a clean refund still settles the claim on the exact refund identity', async () => {
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl1', status: 'arbitration', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
      .mockResolvedValueOnce({ orderId: 'o1', requestedAmountCents: 500 })
      .mockResolvedValue({ id: 'cl1' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    const written = db.claim.update.mock.calls.at(-1)![0].data
    expect(written).toMatchObject({ status: 'refunded', refundId: 'rf1', activeOrderKey: null })
  })
})

describe('REFUND → CLAIM RECONCILIATION — financial truth is never blocked by a feature flag', () => {
  it('CLAIMS_ENABLED=false: a SUCCEEDED refund still reconciles its claim', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    expect(isClaimsEnabled()).toBe(false)
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding' })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded', stripeRefundId: 're_1' })
    expect(r).toMatchObject({ reconciled: true, claimId: 'cl1', to: 'refunded' })
    expect(db.claim.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'refunded', activeOrderKey: null, refundError: null })
  })

  it('CLAIMS_ENABLED=false: a FAILED refund makes the claim actionable again, with no blind retry', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding' })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'failed', stripeRefundId: 're_1' })
    expect(r).toMatchObject({ reconciled: true, to: 'approved(refund_failed)' })
    const data = db.claim.updateMany.mock.calls[0][0].data
    expect(data.status).toBe('approved')
    expect(String(data.refundError)).toMatch(/stripe_failed/)
    expect(execMock).not.toHaveBeenCalled() // never retried
  })

  it('the CAS binds to the EXACT refund identity — a wrong-row event cannot move the claim', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding' })
    await reconcileClaimForRefund({ refundRowId: 'rf_target', status: 'succeeded' })
    expect(db.claim.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'cl1', refundId: 'rf_target' })
  })

  it('a DUPLICATE (or out-of-order) webhook delivery is a clean no-op', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding' })
    db.claim.updateMany.mockResolvedValue({ count: 0 }) // already moved by the first delivery
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: false, reason: 'already_final' })
  })

  it('a refund with NO claim bound (admin rail, ghost order, external) is left alone', async () => {
    db.claim.findFirst.mockResolvedValue(null)
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: false, reason: 'no_claim' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('an already-terminal claim is never re-opened by a late event', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunded' })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'failed' })
    expect(r).toMatchObject({ reconciled: false, reason: 'already_final' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })
})

describe('STUCK REFUNDING VISIBILITY — pending is never dressed up as success', () => {
  const claimRow = (over: Record<string, unknown> = {}) => ({
    id: 'cl1', status: 'refunding', refundId: 'rf1', refundError: null, refundAttempted: true,
    requestedAmountCents: 500, createdAt: new Date(), ...over,
  })

  it('classifies pending / failed / succeeded-but-unreconciled distinctly, and exposes the ACTUAL amount', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ id: 'a' }), claimRow({ id: 'b' }), claimRow({ id: 'c' })])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'pending', amountCents: 500, stripeRefundId: 're_1', createdAt: new Date() }])
    let out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('stripe_pending')
    expect(out[0].actualRefundedCents).toBeNull() // pending ≠ refunded

    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'failed', amountCents: 500, stripeRefundId: 're_1', createdAt: new Date() }])
    out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('stripe_failed')
    expect(out[0].actualRefundedCents).toBeNull()

    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', amountCents: 480, stripeRefundId: 're_1', createdAt: new Date() }])
    out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('stripe_succeeded_claim_unreconciled')
    expect(out[0].actualRefundedCents).toBe(480) // the REAL amount, not the requested 500
  })

  it('a refunding claim with no Refund row at all is flagged stale, not silently fine', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ refundId: null })])
    const out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('stale_refunding_no_refund_row')
  })

  it('a recorded refund error wins the classification (a human already needs to look)', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ refundError: 'resume_mismatch: …' })])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', amountCents: 1200, stripeRefundId: 're_1', createdAt: new Date() }])
    const out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('refund_error_recorded')
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
// Prove the reconciliation tests would catch a flag-gated implementation.
describe('negative control — a CLAIMS_ENABLED-gated reconciliation would be caught', () => {
  const vulnerableReconcile = async (args: { refundRowId: string; status: 'succeeded' }) => {
    if (!isClaimsEnabled()) return { reconciled: false, reason: 'feature_disabled' as const } // the bug
    return reconcileClaimForRefund(args)
  }

  it('the gated variant refuses to reconcile with the flag off — the real one does not', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding' })
    expect(await vulnerableReconcile({ refundRowId: 'rf1', status: 'succeeded' })).toMatchObject({ reconciled: false, reason: 'feature_disabled' })
    expect(await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })).toMatchObject({ reconciled: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT FIXES — each of these pins a defect the independent adversarial audit of THIS
// batch found in my own implementation. They are regression locks, not new features.
// ═══════════════════════════════════════════════════════════════════════════════
describe('AUDIT FIX P1 — an UNPAID approval stays visible and payable', () => {
  it('a claim approved while REFUNDS was off can still be re-driven (the lock must not strand money owed)', async () => {
    // the CAS is now evaluated against this simulated row, so a wrong where clause fails here
    fx.row = { status: 'approved', refundAttempted: false, arbitrationDecision: 'approved' }
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl1', status: 'approved', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: 'approved' })
      .mockResolvedValueOnce({ orderId: 'o1', requestedAmountCents: 500 })
      .mockResolvedValue({ id: 'cl1' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(execMock).toHaveBeenCalledTimes(1) // the refund finally goes out
  })

  it('but the SAME claim cannot be flipped to a refusal after the customer was told "approved"', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: 'approved' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('an already-refused_final decision is still immutable (the lock keeps its real job)', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: 'refused_final' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('the admin queue still lists every unpaid approval, decided or not', async () => {
    db.claim.findMany.mockResolvedValue([])
    await (await import('@/lib/claims')).listArbitrationQueue()
    const where = db.claim.findMany.mock.calls[0][0].where as { OR: Array<Record<string, unknown>> }
    expect(where.OR).toContainEqual({ status: 'approved', refundAttempted: false })
  })

  it('an unpaid approval is also in the MONEY list (money owed must never be invisible)', async () => {
    db.claim.findMany.mockResolvedValue([])
    await listActionableRefundClaims()
    const where = db.claim.findMany.mock.calls[0][0].where as { OR: Array<Record<string, unknown>> }
    expect(where.OR).toContainEqual({ status: 'approved', refundAttempted: false })
  })
})

describe('AUDIT FIX P1 — reconciliation must not destroy the resume-mismatch guard', () => {
  it('a claim parked by resume_mismatch is NOT flipped to refunded, and its admin flag survives', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: 'resume_mismatch: le moteur a repris…' })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf_older', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: false })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('an ordinary claim still reconciles normally', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: true, to: 'refunded' })
  })
})

describe('AUDIT FIX P1 — a succeeded EVENT never overrides our own row status', () => {
  it('the Refund row must itself be succeeded before a claim is called refunded', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'failed' }) // our row says the money bounced
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: false, reason: 'not_bound' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a row that vanished is not treated as paid either', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue(null)
    expect(await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })).toMatchObject({ reconciled: false })
  })
})

describe('RE-AUDIT FIX P1 — a stuck refund is no longer a dead end', () => {
  it('the PENDING resume path now detects a mismatch too (the 202 outcome carries no resumedIgnoredAmount)', async () => {
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl1', status: 'arbitration', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
      .mockResolvedValueOnce({ orderId: 'o1', requestedAmountCents: 500 })
      .mockResolvedValue({ id: 'cl1' })
    execMock.mockResolvedValue({ ok: false, status: 202, pending: true, refundId: 'rf_older', stripeRefundId: 're_older', amountCents: 1200, stripeStatus: 'pending', error: 'pending' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect((res as { refund?: { state: string } }).refund).toMatchObject({ state: 'failed' })
    const written = db.claim.update.mock.calls.at(-1)![0].data
    expect(String(written.refundError)).toMatch(/resume_mismatch/)
    expect(written.refundError).not.toBeNull()
  })

  it('a genuine pending refund of the RIGHT amount still parks cleanly with no error', async () => {
    db.claim.findUnique
      .mockResolvedValueOnce({ id: 'cl1', status: 'arbitration', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
      .mockResolvedValueOnce({ orderId: 'o1', requestedAmountCents: 500 })
      .mockResolvedValue({ id: 'cl1' })
    execMock.mockResolvedValue({ ok: false, status: 202, pending: true, refundId: 'rf1', stripeRefundId: 're_1', amountCents: 500, stripeStatus: 'pending', error: 'pending' })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect((res as { refund?: { state: string; reason?: string } }).refund).toMatchObject({ state: 'pending', reason: 'stripe_pending' })
    expect(db.claim.update.mock.calls.at(-1)![0].data).toMatchObject({ refundId: 'rf1', refundError: null })
  })

  it('an admin can close a stuck claim as settled out of band → refunded, order released', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: 'resume_mismatch: …' })
    const res = await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'settled_out_of_band', reason: 'remboursé via le rail admin' })
    expect(res.ok).toBe(true)
    expect(db.claim.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'refunded', activeOrderKey: null, decidedBy: 'admin' })
    expect(execMock).not.toHaveBeenCalled() // never re-drives money
  })

  it('or as closed without payment → refused_final, order released', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundError: 'stripe_failed: …' })
    const res = await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })
    expect(res.ok).toBe(true)
    expect(db.claim.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'refused_final', activeOrderKey: null })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('it is NOT a general close power: a healthy claim with no refundError is refused', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundError: null })
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toMatchObject({ ok: false, status: 409 })
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', refundError: 'x' })
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toMatchObject({ ok: false, status: 409 })
  })

  it('an already terminal claim cannot be re-closed', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'refunded', refundError: 'x' })
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toMatchObject({ ok: false, status: 409 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })
})

describe('BATCH 2 — RECOVERY when the reconciliation webhook never arrived', () => {
  it('a claim stuck in refunding whose Refund row is SUCCEEDED is reconciled by the sweep', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', stripeRefundId: 're_1' }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    const out = await recoverStrandedClaimReconciliations()
    expect(out).toMatchObject({ scanned: 1, reconciled: 1 })
    expect(db.claim.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'refunded' })
  })

  it('a FAILED row is recovered too, without any retry', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'failed', stripeRefundId: 're_1' }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    const out = await recoverStrandedClaimReconciliations()
    expect(out).toMatchObject({ reconciled: 1 })
    expect(String(db.claim.updateMany.mock.calls[0][0].data.refundError)).toMatch(/stripe_failed/)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('a still-PENDING row is left alone — no outcome is ever invented', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'pending', stripeRefundId: 're_1' }])
    const out = await recoverStrandedClaimReconciliations()
    expect(out).toMatchObject({ scanned: 1, reconciled: 0, skipped: 1 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('it is IDEMPOTENT: a second pass over an already-reconciled claim changes nothing', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', stripeRefundId: 're_1' }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunded', refundError: null }) // already done
    const out = await recoverStrandedClaimReconciliations()
    expect(out).toMatchObject({ reconciled: 0, skipped: 1 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('it works with CLAIMS_ENABLED=false (financial truth is never flag-gated)', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', stripeRefundId: 're_1' }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    expect(await recoverStrandedClaimReconciliations()).toMatchObject({ reconciled: 1 })
  })

  it('it never touches a claim with no bound refund identity', async () => {
    db.claim.findMany.mockResolvedValue([])
    const out = await recoverStrandedClaimReconciliations()
    expect(out).toMatchObject({ scanned: 0, reconciled: 0 })
    expect(db.refund.findMany).not.toHaveBeenCalled()
  })
})

// ── AUDIT FIX (batch 2) — SAFETY IS NOT A SMALL CLAIM ────────────────────────────
// `autoResolveSmallClaim` is the machine path: under the ceiling, from a non-flagged
// consumer, it approves and drives the refund with no human in the loop. An allergen
// exposure or a foreign body is precisely the report that must NOT be closed that way —
// and because such claims are usually SMALL, this was the most likely path for one to
// take. The taxonomy already knew which reasons are safety reasons; nothing consulted it.
describe('AUDIT FIX — a safety report never takes the machine path', () => {
  const claim = (reason: string) => ({ id: 'c1', consumerId: 'u1', requestedAmountCents: 400, status: 'restaurant_review', reason })
  beforeEach(() => {
    process.env.CLAIM_AUTO_RESOLVE_ENABLED = 'true'
    process.env.CLAIM_AUTO_APPROVE_MAX_CENTS = '1000'
    db.claim.count.mockResolvedValue(0) // not abuse-flagged
    fx.row = { status: 'restaurant_review', refundAttempted: false }
  })
  afterEach(() => {
    delete process.env.CLAIM_AUTO_RESOLVE_ENABLED
    delete process.env.CLAIM_AUTO_APPROVE_MAX_CENTS
  })

  it('allergen_safety is refused by the machine even when every other gate says go', async () => {
    const r = await autoResolveSmallClaim(claim('allergen_safety'))
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()      // no money
    expect(db.claim.updateMany).not.toHaveBeenCalled() // and no approval transition either
  })

  it('EVERY reason the taxonomy calls a safety reason is excluded', async () => {
    for (const reason of ACCEPTED_REASONS.filter((x) => isSafetyReason(x))) {
      vi.clearAllMocks()
      db.claim.count.mockResolvedValue(0)
      expect(await autoResolveSmallClaim(claim(reason))).toEqual({ state: 'not_eligible' })
      expect(execMock).not.toHaveBeenCalled()
    }
  })

  it('the exclusion is by REASON, not by amount: 1 cent is still refused', async () => {
    const r = await autoResolveSmallClaim({ ...claim('allergen_safety'), requestedAmountCents: 1 })
    expect(r).toEqual({ state: 'not_eligible' })
  })

  it('a NON-safety small claim still takes the machine path (the fix is not a blanket kill)', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'c1', status: 'approved', orderId: 'o1', consumerId: 'u1', requestedAmountCents: 400, refundAttempted: false })
    const r = await autoResolveSmallClaim(claim('missing_item'))
    expect(r).not.toEqual({ state: 'not_eligible' })
    expect(db.claim.updateMany).toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the pre-fix rule (amount + flags only) would have auto-approved it', () => {
    const preFix = (c: { requestedAmountCents: number; status: string }) =>
      c.status === 'restaurant_review' && c.requestedAmountCents <= 1000
    expect(preFix(claim('allergen_safety'))).toBe(true) // ← the defect the audit found
  })
})

// ── SELF-REVIEW FIX (batch 2) — THE UI MAY NOT OFFER WHAT THE SERVER REFUSES ─────
// Wiring the stuck-money control revealed that the admin list carries SIX money states while
// `resolveStuckClaim` accepts exactly ONE of them. A button on every card would have 409'd on
// most rows. The list now carries the server's own verdict, from the same predicate the route
// enforces, so the two cannot drift apart.
describe('stuck-money resolvability is declared by the server, not guessed by the UI', () => {
  const rows = [
    { status: 'approved',  refundError: 'stripe_failed: …', expected: true  },
    { status: 'refunding', refundError: 'boom',             expected: true  },
    { status: 'refunding', refundError: null,               expected: false }, // may still pay out
    { status: 'approved',  refundError: null,               expected: false }, // never driven — arbitrate it
    { status: 'refunded',  refundError: 'stale',            expected: false }, // already terminal
    { status: 'refused_final', refundError: 'stale',        expected: false },
  ]

  it('the predicate matches the route guard exactly', () => {
    for (const r of rows) expect(isStuckResolvable(r)).toBe(r.expected)
  })

  it('a row the predicate rejects is also rejected by resolveStuckClaim itself', async () => {
    for (const r of rows.filter((x) => !x.expected)) {
      db.claim.findUnique.mockResolvedValue({ id: 'c1', status: r.status, refundError: r.refundError })
      const res = await resolveStuckClaim({ claimId: 'c1', adminId: 'a1', resolution: 'closed_no_payment' })
      expect(res.ok).toBe(false)
      expect(db.claim.updateMany).not.toHaveBeenCalled()
    }
  })

  it('a PENDING refund can never be closed by hand — it may still reach the customer', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'c1', status: 'refunding', refundError: null })
    const res = await resolveStuckClaim({ claimId: 'c1', adminId: 'a1', resolution: 'settled_out_of_band' })
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('NEGATIVE CONTROL — an always-true predicate would be caught here', () => {
    const alwaysOffer = () => true
    expect(alwaysOffer()).toBe(true)                                  // ← the button-on-every-row bug
    expect(isStuckResolvable({ status: 'refunding', refundError: null })).toBe(false) // ← fixed
  })
})

// ── AUDIT FIX (batch 2, defence in depth) — THE RULE HOLDS ON BOTH MACHINE PATHS ──
// A refuter correctly argued that runClaimAutoApproval is unreachable in every authorized
// configuration: CLAIMS_AUTO_APPROVE_ENABLED is documented OFF for the whole beta and founder
// decision P0-07 deleted its scheduler. That makes it not a live hole — but "a machine never
// closes a safety report" is either an invariant or it is a flag setting. It is now an invariant.
describe('AUDIT FIX — the timeout sweep skips safety claims too', () => {
  it('an expired allergen claim is skipped; the ordinary ones beside it still sweep', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.status === 'restaurant_review'
        ? [{ id: 'safe1', reason: 'allergen_safety' }, { id: 'ord1', reason: 'quality' }]
        : []))
    // REFUNDS is closed (the real beta state): approveClaim wins its CAS, then the refund rests
    // pending activation. That isolates what this test is about — WHICH claims get approved.
    refundsFlag.mockReturnValue(false)
    fx.row = { status: 'restaurant_review', refundAttempted: false }
    const summary = await runClaimAutoApproval()
    expect(summary.scannedExpired).toBe(2)
    expect(summary.autoApproved).toBe(1) // the safety claim was NOT one of them
    expect(summary.refundsPending).toBe(1) // …and no money moved: the rail is closed
    expect(execMock).not.toHaveBeenCalled()
  })

  it('a sweep of nothing but safety claims approves nothing and refunds nothing', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.status === 'restaurant_review'
        ? [{ id: 's1', reason: 'allergen_safety' }, { id: 's2', reason: 'allergen_safety' }]
        : []))
    const summary = await runClaimAutoApproval()
    expect(summary.autoApproved).toBe(0)
    expect(summary.refundsTriggered).toBe(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('the sweep actually SELECTS the reason — without it the guard would read undefined', async () => {
    db.claim.findMany.mockResolvedValue([])
    await runClaimAutoApproval()
    const calls = db.claim.findMany.mock.calls as Array<[{ where: Record<string, unknown>; select: Record<string, unknown> }]>
    const call = calls.find((c) => c[0].where.status === 'restaurant_review')
    expect(call?.[0].select.reason).toBe(true)
  })
})

// ── RE-AUDIT FIXES (batch 2) ─────────────────────────────────────────────────────
// Five findings survived adversarial refutation after the first round of batch-2 fixes.
// These pin the three that live in lib/claims.ts.
describe('RE-AUDIT FIX — safety triage reaches the queue that carries the DECISION', () => {
  const rows = [
    { id: 'a', reason: 'quality',         status: 'arbitration', consumerId: 'u1', restaurantId: 'r1', refundAttempted: false, createdAt: new Date(1) },
    { id: 'b', reason: 'allergen_safety', status: 'arbitration', consumerId: 'u2', restaurantId: 'r1', refundAttempted: false, createdAt: new Date(2) },
    { id: 'c', reason: 'missing_item',    status: 'arbitration', consumerId: 'u3', restaurantId: 'r1', refundAttempted: false, createdAt: new Date(3) },
  ]

  it('an allergen claim filed LAST is listed FIRST, and says so', async () => {
    db.claim.findMany.mockResolvedValue(rows)
    const q = await listArbitrationQueue()
    expect(q[0].id).toBe('b')
    expect(q[0].safety).toBe(true)
    expect(q[1].safety).toBe(false)
  })

  it('ordinary claims keep their own chronological order behind it', async () => {
    db.claim.findMany.mockResolvedValue(rows)
    const q = await listArbitrationQueue()
    expect(q.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('NEGATIVE CONTROL — plain createdAt ordering would have buried it', () => {
    const chronological = [...rows].sort((x, y) => +x.createdAt - +y.createdAt).map((r) => r.id)
    expect(chronological).toEqual(['a', 'b', 'c'])       // ← the safety row sits in the middle
    expect(chronological[0]).not.toBe('b')               // ← the defect the re-audit found
  })
})

describe('RE-AUDIT FIX — the recovery sweep retires a row instead of re-reconciling it daily', () => {
  it('a claim already carrying a refundError is NOT selected again', async () => {
    db.claim.findMany.mockResolvedValue([])
    await recoverStrandedClaimReconciliations()
    const where = db.claim.findMany.mock.calls[0][0].where as Record<string, unknown>
    expect(where.refundError).toBeNull()
  })

  it('the sweep still picks up a genuinely stranded claim (the exclusion is not a blanket off)', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'c1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', stripeRefundId: 're_1' }])
    db.claim.findUnique.mockResolvedValue({ id: 'c1', status: 'refunding', refundError: null })
    fx.row = { status: 'refunding', refundError: null, refundId: 'rf1' }
    const out = await recoverStrandedClaimReconciliations()
    expect(out.scanned).toBe(1)
    expect(out.reconciled).toBe(1)
  })

  it('NEGATIVE CONTROL — the old predicate re-matched a reconciled failure for ever', () => {
    const reconciledFailure = { status: 'approved', refundId: 'rf1', refundError: 'stripe_failed: …' }
    const oldPredicate = (c: { status: string; refundId: string | null }) =>
      ['refunding', 'approved'].includes(c.status) && c.refundId !== null
    const newPredicate = (c: { status: string; refundId: string | null; refundError: string | null }) =>
      oldPredicate(c) && c.refundError === null
    expect(oldPredicate(reconciledFailure)).toBe(true)  // ← re-swept every day
    expect(newPredicate(reconciledFailure)).toBe(false) // ← fixed
  })
})

// ── GATE T-49 — THE MOCK ITSELF IS NOW UNDER TEST ────────────────────────────────
// The audit of this batch found that the compare-and-set mock skipped every object-valued
// where clause, so `status: { in: [...] }`, `refundError: { not: null }` and `lte` deadlines
// were exempt from verification: a fix that broke one stayed green. These are DIFFERENTIAL
// controls — they drive SHIPPED code and assert an outcome that the old mock could not
// produce, so they fail if either the mock or the shipped predicate regresses.
describe('the CAS mock enforces comparison operators, not just scalar equality', () => {
  it('an `in` clause is evaluated: a claim outside the CAS window is NOT reconciled', async () => {
    // reconcileClaimForRefund guards on status: { in: ['refunding', 'approved'] }.
    // 'restaurant_review' is neither terminal nor inside that window, so the CAS must miss.
    // Under the previous mock the `in` clause was skipped and this returned reconciled:true.
    db.claim.findFirst.mockResolvedValue({ id: 'c1', status: 'restaurant_review', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    fx.row = { status: 'restaurant_review', refundId: 'rf1' }
    const res = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded', stripeRefundId: 're_1' })
    expect(res.reconciled).toBe(false)
  })

  it('…and a claim INSIDE the window still reconciles, so the guard is not a blanket refusal', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'c1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    fx.row = { status: 'refunding', refundId: 'rf1' }
    const res = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded', stripeRefundId: 're_1' })
    expect(res.reconciled).toBe(true)
  })

  it('the refund IDENTITY is enforced: a CAS bound to another row matches nothing', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'c1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    fx.row = { status: 'refunding', refundId: 'SOME-OTHER-ROW' }
    const res = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded', stripeRefundId: 're_1' })
    expect(res.reconciled).toBe(false)
  })

  it('an operator the mock does not model THROWS instead of silently passing', () => {
    // The mock throws SYNCHRONOUSLY, before any promise exists — that is deliberate: a clause
    // shape the harness cannot evaluate must stop the test, never be waved through.
    fx.row = { status: 'approved' }
    expect(() => db.claim.updateMany({ where: { id: 'c1', status: { startsWith: 'app' } }, data: {} }))
      .toThrow(/unsupported operator/)
  })
})
