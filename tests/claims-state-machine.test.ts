// tests/claims-state-machine.test.ts — CLAIMS batch 1 state machine & reconciliation
//
// Covers the foundational invariants introduced by this batch:
//   • restaurant SILENCE past the deadline becomes admin-actionable (it used to block
//     for ever) and still NEVER auto-refunds;
//   • the LEGACY FINALIZATION LOCK — an already-arbitrated claim cannot be re-arbitrated;
//   • REFUND IDENTITY BINDING — a RESUME-FIRST mismatch never reports the claim settled;
//   • REFUND → CLAIM RECONCILIATION, which must work with CLAIMS_ENABLED=false.
// D′ L2 (spec v2 S-02/S-13): an admin approve is a BUSINESS DECISION only — arbitrateClaim never reaches the
// engine. The T1..T4 rail (triggerClaimRefund, unchanged) is exercised here by calling it BY HAND after the
// decision; each such call is also the negative control proving the « 0 engine » pins observe a property.
// The silence sweep routes to arbitration and approves nothing; autoResolveSmallClaim is inert by construction.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { updateManyMock } from './support/prisma-where'

const { db } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
// ROUND 13 (C3): an approval reads the order, its rows and Stripe before the engine — never the real Stripe.
const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))

import { arbitrateClaim, reconcileClaimForRefund, listActionableRefundClaims, claimAuthority, isClaimsEnabled, resolveStuckClaim, recoverStrandedClaimReconciliations, autoResolveSmallClaim, isStuckResolvable, runClaimAutoApproval, listArbitrationQueue, triggerClaimRefund } from '@/lib/claims'
import { payableWorld, wireWorld, refundRow, claimOf, engineOk, engine202 } from './support/claims-world'

/** ROUND 13 (C3): the approval path runs T1 → T2 on fresh reads → the engine → T4; these tests drive it in an in-memory world. */
const world = (claim: Record<string, unknown>) => {
  const w = payableWorld(claim)
  wireWorld(w, db, stripeMock)
  execMock.mockResolvedValue(engineOk({ refundId: 'rf1', stripeRefundId: 're_1' }))
  return w
}
import { ACCEPTED_REASONS, isSafetyReason } from '@/lib/claim-reasons'

const HOUR = 3600 * 1000
const past = () => new Date(Date.now() - 2 * HOUR)
const future = () => new Date(Date.now() + 2 * HOUR)
const fx: { row: Record<string, unknown> | null; forcedCount: number | null } = { row: null, forcedCount: null }

beforeEach(() => {
  vi.clearAllMocks()
  // ROUND 13: some tests wire an in-memory world; its implementations must not leak into the next test.
  for (const m of [db.claim.findUnique, db.claim.findFirst, db.refund.findFirst, db.order.findUnique, db.franchiseRoyalty.findFirst]) m.mockReset()
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
  // ROUND 13 (B9 (a), slice W4): reconcileClaimForRefund reads EVERY claim bound to the row (findMany where { refundId }).
  // These fixtures give the bound claim through findFirst; that binder read answers with the same fixture (J-M13 pins
  // the two-binder case). Every other findMany keeps answering [] unless a test says otherwise.
  db.claim.findMany.mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
    const where = args?.where
    if (where && typeof where.refundId === 'string' && Object.keys(where).length === 1) {
      const bound = await db.claim.findFirst(args)
      return bound ? [bound] : []
    }
    return []
  })
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

  it('silence alone NEVER refunds — and an explicit admin approve is a DECISION only (D′ L2): the claim rests APPROVED_AWAITING_PAYMENT; only the rail, run by hand, moves money (negative control)', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'restaurant_review', refundAttempted: false, responseDeadlineAt: past(), arbitrationDecision: null })
    await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final' })
    expect(execMock).not.toHaveBeenCalled()
    const w = world({ id: 'cl2', status: 'restaurant_review', responseDeadlineAt: past(), arbitrationDecision: null })
    const res = await arbitrateClaim({ claimId: 'cl2', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(res).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()                    // the ADMIN decided — and a decision moves no money
    expect(refundsFlag).not.toHaveBeenCalled()
    expect(claimOf(w, 'cl2')).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', decidedBy: 'admin', refundAttempted: false, refundId: null, refundError: null })
    expect(w.writes).toHaveLength(1)                           // the silence CAS, nothing else
    expect(w.writes[0].where).toMatchObject({ id: 'cl2', status: 'restaurant_review', arbitrationDecision: null })
    // NEGATIVE CONTROL — the same world pays the moment the RAIL runs: the engine is reachable, the approve just does not reach it
    const t = await triggerClaimRefund('cl2')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(claimOf(w, 'cl2').status).toBe('refunded')
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

describe('REFUND IDENTITY BINDING — a claim never claims an amount nobody asked for (the RAIL after the decision, D′ L2)', () => {
  /** D′ L2: the admin decision first (no engine), then the rail by hand — what the pay-approved rail will do. */
  const decideThenRail = async (w: ReturnType<typeof world>) => {
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(res).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    return triggerClaimRefund('cl1')
  }

  it('RESUME-FIRST mismatch → claim NOT marked refunded, bound to the real refund, admin required', async () => {
    const w = world({ status: 'arbitration', responseDeadlineAt: past(), arbitrationDecision: null })
    execMock.mockResolvedValue(engineOk({ refundId: 'rf_older', stripeRefundId: 're_older', amountCents: 1200, resumed: true, resumedIgnoredAmount: true }))
    const t = await decideThenRail(w)
    expect(t).toMatchObject({ state: 'failed', error: 'resume_mismatch' })
    expect(execMock).toHaveBeenCalledTimes(1)
    const c = claimOf(w)
    expect(c.refundId).toBe('rf_older')          // bound to the ACTUAL refund driven
    expect(c.status).toBe('refunding')           // NOT flipped to 'refunded'
    expect(String(c.refundError)).toMatch(/resume_mismatch/)
    expect(db.claim.update).not.toHaveBeenCalled() // ROUND 13 (C5): every post-engine write is a CAS
  })

  it('a clean refund still settles the claim on the exact refund identity', async () => {
    const w = world({ status: 'arbitration', responseDeadlineAt: past(), arbitrationDecision: null })
    const t = await decideThenRail(w)
    expect(t).toEqual({ state: 'refunded', refundId: 'rf1', amountCents: 500 })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf1', activeOrderKey: null })
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

  it('a refunding claim with NO binding is money-unknown (reconcile_required), never silently fine', async () => {
    // ROUND-8 AUDIT FIX (P2): this shape was labelled « sans aucun remboursement Stripe associé », a
    // negative Stripe assertion nothing had checked, while the FV console lists the SAME population
    // as money-unknown. Both consoles now agree, and it is not closable by assertion.
    db.claim.findMany.mockResolvedValue([claimRow({ refundId: null })])
    const out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('reconcile_required')
    expect(out[0].resolvable).toBe(false)
  })

  it('a refunding claim bound to a Refund row that cannot be found is still flagged stale', async () => {
    db.claim.findMany.mockResolvedValue([claimRow({ refundId: 'rf_missing' })])
    db.refund.findMany.mockResolvedValue([])
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
  it('a claim approved while REFUNDS was off is RATIFIED, never re-driven, by a second approve (D′ L2 T-08); the RAIL run by hand still pays it (the lock must not strand money owed)', async () => {
    // the CAS is now evaluated against this simulated row, so a wrong where clause fails here
    // ROUND 13 (D2 (1)(b)): the legacy CAS also requires refundId null — the simulated row carries the column.
    // ROUND 13: the in-memory world evaluates every CAS (decision, T1, T4) against one claim row.
    const arbitratedAt = past()
    const w = world({ status: 'approved', refundAttempted: false, refundId: null, responseDeadlineAt: past(), arbitrationDecision: 'approved', arbitratedBy: 'admin0', arbitratedAt, decidedBy: 'admin', decidedAt: arbitratedAt })
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(res).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()                    // a re-approval moves NO money (S-02)
    expect(refundsFlag).not.toHaveBeenCalled()
    // the ratification CAS pins the instants it read and rewrites none of the existing decision fields
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0].where).toMatchObject({ id: 'cl1', status: 'approved', refundAttempted: false, refundId: null, arbitratedAt, decidedAt: arbitratedAt })
    expect(claimOf(w)).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', arbitratedBy: 'admin0', arbitratedAt, decidedBy: 'admin', decidedAt: arbitratedAt, refundAttempted: false, refundId: null })
    // NEGATIVE CONTROL — money owed is not stranded: the rail pays the ratified claim
    const t = await triggerClaimRefund('cl1')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)                  // the refund finally goes out — from the rail
    expect(claimOf(w).status).toBe('refunded')
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
    // ROUND 13 (B8): the disowned binding — the row carries ANOTHER claim's stamp.
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded', reason: 'claim:OTHER' })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf_older', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: false })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('ROUND 13 (B8) — a legacy resume_mismatch on the claim’s OWN stamped row is a candidate: its row settles it', async () => {
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: 'resume_mismatch: le moteur a repris…' })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded', reason: 'claim:cl1' })
    const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status: 'succeeded' })
    expect(r).toMatchObject({ reconciled: true, to: 'refunded' })
    expect(db.claim.updateMany.mock.calls[0][0].where).toMatchObject({ refundError: 'resume_mismatch: le moteur a repris…' })
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

describe('RE-AUDIT FIX P1 — a stuck refund is no longer a dead end (the RAIL after the decision, D′ L2)', () => {
  /** D′ L2: the admin decision first (no engine, no refund field), then the rail by hand. */
  const decideThenRail = async (w: ReturnType<typeof world>) => {
    const res = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(res).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null, refundError: null })
    return triggerClaimRefund('cl1')
  }

  it('the PENDING resume path now detects a mismatch too (the 202 outcome carries no resumedIgnoredAmount)', async () => {
    const w = world({ status: 'arbitration', responseDeadlineAt: past(), arbitrationDecision: null })
    execMock.mockResolvedValue(engine202({ refundId: 'rf_older', stripeRefundId: 're_older', amountCents: 1200 }))
    const t = await decideThenRail(w)
    expect(t).toMatchObject({ state: 'failed', error: 'resume_mismatch' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(String(claimOf(w).refundError)).toMatch(/resume_mismatch/)
    expect(claimOf(w).refundError).not.toBeNull()
  })

  it('a genuine pending refund of the RIGHT amount still parks cleanly with no error', async () => {
    const w = world({ status: 'arbitration', responseDeadlineAt: past(), arbitrationDecision: null })
    // the engine wrote this claim's own row (T3 reads its stamp on the 202 path)
    execMock.mockImplementation(async () => { w.refunds.push(refundRow('rf1', { reason: 'claim:cl1', status: 'pending', stripeRefundId: 're_1' })); return engine202({ refundId: 'rf1', stripeRefundId: 're_1', amountCents: 500 }) })
    const t = await decideThenRail(w)
    expect(t).toMatchObject({ state: 'pending', reason: 'stripe_pending' })
    expect(claimOf(w)).toMatchObject({ status: 'refunding', refundId: 'rf1', refundError: null })
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
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', orderId: 'o1', status: 'succeeded', stripeRefundId: 're_1', createdAt: new Date() }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    // ROUND 13 (G13, slice W5): the sweep re-reads the succeeded row's refund at Stripe before settling on it.
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 500, payment_intent: 'pi_1', metadata: {} })
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
    // ROUND 13 (B9 (a), slice W4): the sweep's selection and the reconciler's binder read are two findMany queries —
    // the sweep sees the stale refunding snapshot, the binder read sees the claim as it is now (already refunded).
    db.claim.findMany.mockImplementation(async (args?: { where?: Record<string, unknown> }) =>
      (args?.where && typeof args.where.refundId === 'string' ? [{ id: 'cl1', status: 'refunded', refundError: null }] : [{ id: 'cl1', refundId: 'rf1', status: 'refunding' }]))
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'succeeded', stripeRefundId: 're_1' }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunded', refundError: null }) // already done
    const out = await recoverStrandedClaimReconciliations()
    expect(out).toMatchObject({ reconciled: 0, skipped: 1 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('it works with CLAIMS_ENABLED=false (financial truth is never flag-gated)', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', orderId: 'o1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', orderId: 'o1', status: 'succeeded', stripeRefundId: 're_1', createdAt: new Date() }])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    db.refund.findUnique.mockResolvedValue({ status: 'succeeded' })
    // ROUND 13 (G13, slice W5): the Stripe re-read of the succeeded row (flag-independent, read-only).
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 500, payment_intent: 'pi_1', metadata: {} })
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
// `autoResolveSmallClaim` WAS the machine path: under the ceiling, from a non-flagged
// consumer, it approved and drove the refund with no human in the loop. An allergen
// exposure or a foreign body is precisely the report that must NOT be closed that way —
// and because such claims are usually SMALL, this was the most likely path for one to
// take. The taxonomy already knew which reasons are safety reasons; nothing consulted it.
// D′ L2 (spec v2 S-13): the machine path itself is gone — autoResolveSmallClaim is INERT BY
// CONSTRUCTION, so the safety exclusion is no longer a filter inside a live path but a
// consequence of there being no path at all. The pins below keep the safety property and
// INVERT the old « a non-safety claim still takes the machine path » control.
describe('AUDIT FIX — a safety report never takes the machine path (D′ L2: no claim does — the path is inert by construction)', () => {
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

  it('a NON-safety small claim does NOT take the machine path either (D′ L2: the blanket kill IS the contract — inert, 0 reads, 0 writes, 0 money)', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'c1', status: 'approved', orderId: 'o1', consumerId: 'u1', requestedAmountCents: 400, refundAttempted: false })
    const r = await autoResolveSmallClaim(claim('missing_item'))
    expect(r).toEqual({ state: 'not_eligible' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()   // no approval transition
    expect(db.claim.findUnique).not.toHaveBeenCalled()   // not even a read of the claim
    expect(db.claim.count).not.toHaveBeenCalled()        // nor of the abuse signal
    expect(refundsFlag).not.toHaveBeenCalled()           // nor of the REFUNDS lease
    expect(execMock).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the same non-safety claim, on a payable world, IS paid when the old machine path (approve + engine) is executed by hand: the inertness above is the function’s, not the world’s', async () => {
    const w = world({ id: 'c1', consumerId: 'u1', status: 'restaurant_review', arbitrationDecision: null, requestedAmountCents: 400, reason: 'missing_item' })
    expect(await autoResolveSmallClaim(claim('missing_item'))).toEqual({ state: 'not_eligible' })
    expect(w.writes).toEqual([])
    // what the pre-D′ machine path did after its eligibility checks: a machine approval, then the engine
    Object.assign(claimOf(w, 'c1'), { status: 'approved', decidedBy: 'auto_small', decidedAt: new Date() })
    const t = await triggerClaimRefund('c1')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 400, reason: 'claim:c1' })
  })

  it('NEGATIVE CONTROL — the pre-fix rule (amount + flags only) would have auto-approved it', () => {
    const preFix = (c: { requestedAmountCents: number; status: string }) =>
      c.status === 'restaurant_review' && c.requestedAmountCents <= 1000
    expect(preFix(claim('allergen_safety'))).toBe(true) // ← the defect the audit found
    expect(preFix(claim('missing_item'))).toBe(true)    // ← and under D′ even this one is no longer approved by a machine
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
describe('AUDIT FIX — the timeout sweep skips safety claims too (D′ L2: and ROUTES the others to arbitration — it approves nothing, pays nothing)', () => {
  it('an expired allergen claim is skipped; the ordinary one beside it is ROUTED to arbitration (no approval, no decision fields, no engine, no lease read)', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.status === 'restaurant_review'
        ? [{ id: 'safe1', reason: 'allergen_safety' }, { id: 'ord1', reason: 'quality' }]
        : []))
    // REFUNDS is closed (the real beta state) — and under D′ the sweep never even reads it: that isolates
    // what this test is about — WHICH claims get routed.
    refundsFlag.mockReturnValue(false)
    fx.row = { status: 'restaurant_review', refundAttempted: false }
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual({ scannedExpired: 2, routedToArbitration: 1, skippedSafety: 1, skippedAlreadyHandled: 0 })
    expect(summary).not.toHaveProperty('autoApproved')
    expect(summary).not.toHaveProperty('refundsPending')
    expect(db.claim.updateMany).toHaveBeenCalledTimes(1)
    const [args] = db.claim.updateMany.mock.calls[0]
    expect(args).toEqual({ where: { id: 'ord1', status: 'restaurant_review' }, data: { status: 'arbitration' } })
    expect(db.claim.updateMany.mock.calls.some((c) => c[0]?.where?.id === 'safe1')).toBe(false)
    expect(refundsFlag).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('a sweep of nothing but safety claims routes nothing, approves nothing and refunds nothing', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.status === 'restaurant_review'
        ? [{ id: 's1', reason: 'allergen_safety' }, { id: 's2', reason: 'allergen_safety' }]
        : []))
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual({ scannedExpired: 2, routedToArbitration: 0, skippedSafety: 2, skippedAlreadyHandled: 0 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('a claim that left restaurant_review between the scan and the CAS is counted skippedAlreadyHandled, never forced', async () => {
    db.claim.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.status === 'restaurant_review' ? [{ id: 'ord1', reason: 'quality' }] : []))
    fx.row = { status: 'refused', refundAttempted: false }   // the restaurant answered meanwhile
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual({ scannedExpired: 1, routedToArbitration: 0, skippedSafety: 0, skippedAlreadyHandled: 1 })
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
    db.claim.findMany.mockResolvedValue([{ id: 'c1', orderId: 'o1', refundId: 'rf1', status: 'refunding' }])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', orderId: 'o1', status: 'succeeded', stripeRefundId: 're_1', createdAt: new Date() }])
    // ROUND 13 (G13, slice W5): the sweep re-reads the succeeded row's refund at Stripe before settling on it.
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 500, payment_intent: 'pi_1', metadata: {} })
    db.claim.findUnique.mockResolvedValue({ id: 'c1', status: 'refunding', refundError: null })
    // ROUND 13: the bound claim the sweep reconciles is read by refundId (findFirst) — set here, never inherited from another test.
    db.claim.findFirst.mockResolvedValue({ id: 'c1', status: 'refunding', refundError: null })
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
    // ROUND 13 (C9 (b)): the CAS also carries the refundError read — the simulated row carries the column.
    fx.row = { status: 'refunding', refundId: 'rf1', refundError: null }
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
    // Round 11 modelled `startsWith` (the census counts crash markers with it); `endsWith` is still unmodelled.
    expect(() => db.claim.updateMany({ where: { id: 'c1', status: { endsWith: 'ved' } }, data: {} }))
      .toThrow(/unsupported operator/)
  })
})
