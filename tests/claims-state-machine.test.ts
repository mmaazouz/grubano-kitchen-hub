// tests/claims-state-machine.test.ts — CLAIMS batch 1 state machine & reconciliation
//
// Covers the foundational invariants introduced by this batch:
//   • restaurant SILENCE past the deadline becomes admin-actionable (it used to block
//     for ever) and still NEVER auto-refunds;
//   • the LEGACY FINALIZATION LOCK — an already-arbitrated claim cannot be re-arbitrated;
//   • REFUND IDENTITY BINDING — a RESUME-FIRST mismatch never reports the claim settled;
//   • REFUND → CLAIM RECONCILIATION, which must work with CLAIMS_ENABLED=false.
import { describe, it, expect, beforeEach, vi } from 'vitest'

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

import { arbitrateClaim, reconcileClaimForRefund, listActionableRefundClaims, claimAuthority, isClaimsEnabled, resolveStuckClaim } from '@/lib/claims'

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
  db.claim.updateMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    const row = fx.row
    if (!row) return Promise.resolve({ count: fx.forcedCount ?? 1 })
    for (const [k, v] of Object.entries(where)) {
      if (k === 'id') continue
      if (v !== null && typeof v === 'object') continue // range clauses (lte) — not simulated
      if ((row as Record<string, unknown>)[k] !== v) return Promise.resolve({ count: 0 })
    }
    return Promise.resolve({ count: fx.forcedCount ?? 1 })
  })
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  db.claim.groupBy.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
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
