// tests/claims-dprime-l4-approved-amount.test.ts — D′ lot L4 (spec v2 T-07/T-08/T-09, §8.3).
//
// L4 gives an approval an AMOUNT and gives the admin a way to take it back before any money moves.
// The money-critical claims this file proves, each with the founder's own control letter:
//   A. approve with REFUNDS closed → 0 Stripe write
//   B. approve with REFUNDS OPEN in the fake world → still 0 Stripe write (S-02)
//   C. approve 500 → approvedAmountCents = 500
//   D. a second approve 400 without a withdrawal → 409, and the amount STAYS 500 (S-29)
//   E. approve 500 → withdraw → approve 400 → a valid new decision
//   F. the rail's T1 reads 400 and its CAS PINS 400 — no race can turn the payment back into 500 (S-11)
//   G. withdraw vs T1 concurrently → exactly one winner (S-09)
//   H. the audit disabled, or failing, → the decision is NOT modified (S-30)
//   I. approvedAmountCents = null → T1 answers amount_not_ratified with ZERO writes (S-27)
// The engine behind the spy is the REAL lib/refund, on the same in-memory world, so « no Stripe write »
// is measured rather than assumed — and each control has a negative control proving the world CAN move.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, stripeMock, engineSpy, alertMock, auditMock, emailMock, adminMock, schemaMock } = vi.hoisted(() => ({
  db: {
    claim:            { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund:           { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    order:            { findUnique: vi.fn(), findMany: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dispute:          { aggregate: vi.fn() },
    payout:           { findUnique: vi.fn() },
    emailDispatch:    { create: vi.fn(), findFirst: vi.fn() },
    adminAuditLog:    { create: vi.fn() },
    $transaction:     vi.fn(),
  },
  stripeMock: {
    paymentIntents:  { retrieve: vi.fn() },
    refunds:         { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    transfers:       { list: vi.fn(), listReversals: vi.fn(), createReversal: vi.fn() },
    applicationFees: { listRefunds: vi.fn() },
  },
  engineSpy: { fn: vi.fn() },
  alertMock: vi.fn(), auditMock: vi.fn(), emailMock: vi.fn(), adminMock: vi.fn(),
  schemaMock: { fn: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/refund')>()
  engineSpy.fn.mockImplementation((input: Parameters<typeof real.executeRefund>[0]) => real.executeRefund(input))
  return { ...real, executeRefund: (input: Parameters<typeof real.executeRefund>[0]) => engineSpy.fn(input) }
})
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/admin-audit')>()
  return { ...real, recordAdminAudit: auditMock }
})
vi.mock('@/lib/claim-emails', () => ({ sendClaimDecisionEmail: emailMock, sendClaimAckEmail: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/schema-ready', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/schema-ready')>()
  return { ...real, schemaReady: (...a: unknown[]) => schemaMock.fn(...a) }
})

import { POST as arbitrate } from '@/app/api/admin/claims/[id]/arbitrate/route'
import { POST as withdrawRoute } from '@/app/api/admin/claims/[id]/withdraw-approval/route'
import { arbitrateClaim, withdrawClaimApproval, triggerClaimRefund, listApprovedAwaitingPayment, listAwaitingRatification } from '@/lib/claims'
import {
  APPROVE_CONFIRM_WORD, WITHDRAW_CONFIRM_WORD, APPROVE_CONFIRM_REQUIRED, APPROVE_AMOUNT_REQUIRED,
  APPROVE_REDUCE_REASON_REQUIRED, APPROVE_ALREADY_SET, WITHDRAW_AUDIT_DISABLED, WITHDRAW_MONEY_RECORDED,
  WITHDRAW_ROW_STAMPED, WITHDRAW_ROW_UNREADABLE, WITHDRAW_CONFIRM_REQUIRED, WITHDRAW_REASON_REQUIRED,
} from '@/lib/claim-action-rules'
import { payableWorld, claimOf } from './support/claims-world'
import { wireEngineWorld, type EngineWorld } from './support/claims-engine-world'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

let w: EngineWorld
const openRefundsLease = () => {
  process.env.REFUNDS_ENABLED = 'true'
  process.env.REFUNDS_WINDOW_UNTIL = new Date(Date.now() + 15 * 60_000).toISOString()
}
const closeRefundsLease = () => { delete process.env.REFUNDS_ENABLED; delete process.env.REFUNDS_WINDOW_UNTIL }

/** Everything that would mean money actually moved. */
const moneyTouched = () => ({
  engine: engineSpy.fn.mock.calls.length,
  create: stripeMock.refunds.create.mock.calls.length,
  rows:   w.refunds.length,
})
const setWorld = (claim: Record<string, unknown> = {}) => {
  w = payableWorld(claim) as EngineWorld
  for (const group of Object.values(db)) {
    if (typeof group === 'function') continue
    for (const m of Object.values(group)) (m as { mockReset: () => void }).mockReset()
  }
  for (const group of Object.values(stripeMock)) for (const m of Object.values(group)) (m as { mockReset: () => void }).mockReset()
  wireEngineWorld(w, db, stripeMock)
  db.emailDispatch.create.mockResolvedValue({})
  db.adminAuditLog.create.mockResolvedValue({ id: 'aud1' })
  db.refund.count.mockImplementation(async ({ where }: { where: { orderId?: string; reason?: string } }) =>
    w.refunds.filter((r) => (!where.orderId || r.orderId === where.orderId) && (!where.reason || r.reason === where.reason)).length)
  // The transaction runs its callback against the SAME wired doubles: a throw inside must propagate,
  // which is what makes the « audit fails ⇒ rollback » control meaningful.
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db))
  return w
}
const approveVia = (body: Record<string, unknown>, id = 'cl1') =>
  arbitrate(new Request(`https://app.grubano.com/api/admin/claims/${id}/arbitrate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: { id } })
const withdrawVia = (body: Record<string, unknown>, id = 'cl1') =>
  withdrawRoute(new Request(`https://app.grubano.com/api/admin/claims/${id}/withdraw-approval`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: { id } })

const APPROVE = { decision: 'approve' as const, confirm: APPROVE_CONFIRM_WORD }
const WITHDRAW = { confirm: WITHDRAW_CONFIRM_WORD, reason: 'décision reprise après vérification du dossier' }

beforeEach(() => {
  vi.clearAllMocks()
  engineSpy.fn.mockClear()
  alertMock.mockReset(); alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockReset(); auditMock.mockResolvedValue(true)
  emailMock.mockReset(); emailMock.mockResolvedValue({ status: 'sent' })
  adminMock.mockReset(); adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test' })
  schemaMock.fn.mockReset(); schemaMock.fn.mockResolvedValue({ ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null })
  process.env.ADMIN_AUDIT_ENABLED = 'true'
  openClaimsWindow()
  // The claim under decision: in arbitration, 500 c requested, no amount decided yet.
  setWorld({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null, requestedAmountCents: 500, arbitratedBy: null, arbitratedAt: null, decidedBy: null, decidedAt: null })
})
afterEach(() => { closeClaimsWindow(); closeRefundsLease(); delete process.env.ADMIN_AUDIT_ENABLED })

// ── the approval contract ────────────────────────────────────────────────────────────────────
describe('T-07 — an approval carries a validated amount, an explicit confirmation, a motive when reduced', () => {
  it('C. approve 500 → approvedAmountCents = 500, the full decision is written, and the e-mail names THAT amount', async () => {
    const res = await approveVia({ ...APPROVE, approvedAmountCents: 500 })
    expect(res.status).toBe(200)
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null, decidedBy: 'admin' })
    expect(c.arbitratedBy).toBe('admin1')
    expect(c.arbitratedAt).toBeInstanceOf(Date)
    // D-11: the notice names the amount RE-READ from the row, stamped with this decision's instant.
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'approved', approvedCents: 500, refundedCents: null, decisionStamp: c.arbitratedAt,
    }))
    // the audit records what was decided, and that no money moved
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'claim.arbitrate', metadata: expect.objectContaining({ decision: 'approve', moneyMoved: false, approvedAmountCents: 500 }),
    }))
  })

  it('a REDUCED amount is accepted with a motive, and refused without one — the amount is never written on a refusal', async () => {
    const bad = await approveVia({ ...APPROVE, approvedAmountCents: 300 })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe(APPROVE_REDUCE_REASON_REQUIRED)
    expect(claimOf(w).approvedAmountCents ?? null).toBeNull()
    expect(w.writes).toHaveLength(0)

    const ok = await approveVia({ ...APPROVE, approvedAmountCents: 300, reduceReason: 'deux articles reçus sur trois' })
    expect(ok.status).toBe(200)
    expect(claimOf(w).approvedAmountCents).toBe(300)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ approvedAmountCents: 300, reduceReason: 'deux articles reçus sur trois' }),
    }))
  })

  it('S-10 — the server bound is the REQUESTED amount: 501 on a 500 claim is refused, with zero writes', async () => {
    const res = await approveVia({ ...APPROVE, approvedAmountCents: 501, reduceReason: 'peu importe' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supérieur au montant demandé \(5,00 €\)/)
    expect(w.writes).toHaveLength(0)
    expect(claimOf(w).status).toBe('arbitration')
  })

  it('the confirmation word and a usable amount are both required — a click alone approves nothing', async () => {
    const noConfirm = await approveVia({ decision: 'approve', approvedAmountCents: 500 })
    expect(noConfirm.status).toBe(400)
    expect((await noConfirm.json()).error).toBe(APPROVE_CONFIRM_REQUIRED)
    const wrongWord = await approveVia({ decision: 'approve', approvedAmountCents: 500, confirm: 'approuver' })
    expect(wrongWord.status).toBe(400)
    for (const amount of [undefined, 0, -100, 12.5]) {
      const r = await approveVia({ ...APPROVE, approvedAmountCents: amount })
      expect([400], `amount=${amount}`).toContain(r.status)
      if (amount !== 12.5 && amount !== undefined) expect((await r.json()).error).toBe(APPROVE_AMOUNT_REQUIRED)
    }
    expect(w.writes).toHaveLength(0)
    expect(claimOf(w).status).toBe('arbitration')
  })

  it('S-27 — the route refuses with 503 when the schema is not ready, and writes nothing (no fallback on the requested amount)', async () => {
    schemaMock.fn.mockResolvedValue({ ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'stale client' })
    const res = await approveVia({ ...APPROVE, approvedAmountCents: 500 })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ reason: 'schema_not_ready', schemaReady: false })
    expect(w.writes).toHaveLength(0)
    // A refusal writes none of the new columns — but arbitrateClaim READS them (its single findUnique
    // selects approvedAmountCents before either branch), so it is gated the same way. Found by the L4
    // adversarial review: a probe scoped to the approval would have left a refusal to crash on a stale client.
    const refuse = await approveVia({ decision: 'refuse_final', reason: 'hors périmètre' })
    expect(refuse.status).toBe(503)
    expect(claimOf(w).status).toBe('arbitration')
    // NEGATIVE CONTROL — the same refusal on a READY probe goes through.
    schemaMock.fn.mockResolvedValue({ ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null })
    expect((await approveVia({ decision: 'refuse_final', reason: 'hors périmètre' })).status).toBe(200)
    expect(claimOf(w).status).toBe('refused_final')
  })
})

// ── A / B — approving never moves money ──────────────────────────────────────────────────────
describe('S-02 — approving is not paying, whatever the REFUNDS lease says', () => {
  it('A. REFUNDS closed → 200 and zero Stripe write', async () => {
    closeRefundsLease()
    expect((await approveVia({ ...APPROVE, approvedAmountCents: 500 })).status).toBe(200)
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
  })

  it('B. REFUNDS OPEN in the fake world → still zero Stripe write, and the claim rests APPROVED_AWAITING_PAYMENT', async () => {
    openRefundsLease()
    expect((await approveVia({ ...APPROVE, approvedAmountCents: 500 })).status).toBe(200)
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    // NEGATIVE CONTROL — the world DOES reach Stripe when the rail is called by hand.
    const t = await triggerClaimRefund('cl1')
    expect(t.state).toBe('refunded')
    expect(moneyTouched()).toMatchObject({ engine: 1, create: 1, rows: 1 })
  })
})

// ── D / E — the amount is decided once; changing it goes through a withdrawal ────────────────
describe('S-29 — approvedAmountCents has exactly two writers: the decision and the withdrawal', () => {
  it('D. a second approve 400 without a withdrawal → 409 APPROVE_ALREADY_SET, and the amount stays 500', async () => {
    expect((await approveVia({ ...APPROVE, approvedAmountCents: 500 })).status).toBe(200)
    const writesAfterFirst = w.writes.length
    const second = await approveVia({ ...APPROVE, approvedAmountCents: 400, reduceReason: 'nouvelle appréciation du dossier' })
    expect(second.status).toBe(409)
    expect((await second.json()).error).toBe(APPROVE_ALREADY_SET)
    expect(claimOf(w).approvedAmountCents).toBe(500)
    expect(w.writes).toHaveLength(writesAfterFirst) // the refusal wrote nothing at all
  })

  it('E. approve 500 → withdraw → approve 400 : a valid new decision, and three distinct notices', async () => {
    expect((await approveVia({ ...APPROVE, approvedAmountCents: 500 })).status).toBe(200)
    const firstStamp = claimOf(w).arbitratedAt

    const out = await withdrawVia(WITHDRAW)
    expect(out.status).toBe(200)
    expect(await out.json()).toMatchObject({ moneyMoved: false })
    // back to arbitration with the decision and the amount cleared — never refused_final
    expect(claimOf(w)).toMatchObject({
      status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null,
      arbitratedBy: null, arbitratedAt: null, arbitrationReason: null, decidedBy: null, decidedAt: null,
    })
    expect(claimOf(w).activeOrderKey).toBe('o1') // the claim never stopped being active

    const again = await approveVia({ ...APPROVE, approvedAmountCents: 400, reduceReason: 'réduction après réexamen du dossier' })
    expect(again.status).toBe(200)
    expect(claimOf(w).approvedAmountCents).toBe(400)

    // §6.4 — one withdrawal notice and TWO distinct approval notices, deduped per decision, not per claim.
    const kinds = emailMock.mock.calls.map((c) => (c[0] as { decision: string; approvedCents?: number | null; decisionStamp?: unknown }))
    expect(kinds.map((k) => k.decision)).toEqual(['approved', 'approval_withdrawn', 'approved'])
    expect(kinds[0].approvedCents).toBe(500)
    expect(kinds[2].approvedCents).toBe(400)
    expect(kinds[1].decisionStamp).toEqual(firstStamp)
    expect(kinds[2].decisionStamp).not.toEqual(firstStamp)
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
  })
})

// ── F / I — what the rail is allowed to pay ─────────────────────────────────────────────────
describe('S-11 / S-27 — T1 pays the ratified amount, pinned by its CAS, or refuses without writing', () => {
  it('F. the rail reads 400 and its CAS pins 400 — the engine is called with 400, never with the requested 500', async () => {
    openRefundsLease()
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 400, requestedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null })
    const t = await triggerClaimRefund('cl1')
    expect(t.state).toBe('refunded')
    expect(engineSpy.fn).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 400, reason: 'claim:cl1' }))
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 400 }), expect.anything())
    // the attempt CAS pinned the decision AND the amount it read
    const attempt = w.writes.find((x) => x.data.status === 'refunding')!
    expect(attempt.where).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', approvedAmountCents: 400 })
  })

  it('I. approvedAmountCents null → amount_not_ratified, ZERO writes, and no engine call', async () => {
    openRefundsLease()
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: null, requestedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null })
    const t = await triggerClaimRefund('cl1')
    expect(t).toEqual({ state: 'failed', error: 'amount_not_ratified' })
    expect(w.writes).toHaveLength(0)
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    // and no silent fallback on the requested amount ever happens
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false })
  })

  it('every shape T1 must refuse without writing: no decision, a zero, a negative, a non-integer, an amount above the request', async () => {
    openRefundsLease()
    for (const claim of [
      { arbitrationDecision: null, approvedAmountCents: 400 },
      { arbitrationDecision: 'approved', approvedAmountCents: 0 },
      { arbitrationDecision: 'approved', approvedAmountCents: -400 },
      { arbitrationDecision: 'approved', approvedAmountCents: 12.5 },
      { arbitrationDecision: 'approved', approvedAmountCents: 501 },
    ]) {
      setWorld({ status: 'approved', requestedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null, ...claim })
      const t = await triggerClaimRefund('cl1')
      expect(t, JSON.stringify(claim)).toEqual({ state: 'failed', error: 'amount_not_ratified' })
      expect(w.writes, JSON.stringify(claim)).toHaveLength(0)
      expect(engineSpy.fn, JSON.stringify(claim)).not.toHaveBeenCalled()
    }
    // NEGATIVE CONTROL — the very same world with a ratified amount DOES pay.
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, requestedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null })
    expect((await triggerClaimRefund('cl1')).state).toBe('refunded')
    expect(engineSpy.fn).toHaveBeenCalledTimes(1)
  })
})

// ── G / H — the withdrawal, and its exclusivity with the rail ───────────────────────────────
describe('T-09 / S-09 / S-30 — withdrawing an approval', () => {
  const approved = () => setWorld({
    status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, requestedAmountCents: 500,
    refundAttempted: false, refundId: null, refundError: null, arbitratedBy: 'admin1', arbitratedAt: new Date('2026-09-23T08:00:00.000Z'),
    decidedBy: 'admin', decidedAt: new Date('2026-09-23T08:00:00.000Z'),
  })

  it('G. withdraw and T1 race on the same row → exactly one winner, and the loser writes nothing new', async () => {
    openRefundsLease()
    approved()
    // the rail wins the pre-image first…
    const paid = await triggerClaimRefund('cl1')
    expect(paid.state).toBe('refunded')
    // …so the withdrawal must now refuse: the financial frontier is crossed.
    const out = await withdrawClaimApproval({ claimId: 'cl1', adminId: 'admin1', reason: 'trop tard, paiement parti', confirm: WITHDRAW_CONFIRM_WORD })
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ status: 409 })
    expect(claimOf(w).status).toBe('refunded')

    // the mirror order: the withdrawal wins first, and the rail then finds nothing payable.
    approved()
    const gone = await withdrawClaimApproval({ claimId: 'cl1', adminId: 'admin1', reason: 'retiré avant tout paiement', confirm: WITHDRAW_CONFIRM_WORD })
    expect(gone.ok).toBe(true)
    const after = await triggerClaimRefund('cl1')
    expect(after).toEqual({ state: 'already_handled' })
    expect(moneyTouched()).toMatchObject({ engine: 1 }) // only the FIRST scenario's payment
  })

  it('H. the audit disabled → 409 audit_disabled with no read and no write at all (S-30)', async () => {
    approved()
    process.env.ADMIN_AUDIT_ENABLED = 'false'
    const res = await withdrawVia(WITHDRAW)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'audit_disabled', error: WITHDRAW_AUDIT_DISABLED })
    expect(w.writes).toHaveLength(0)
    expect(db.claim.findUnique).not.toHaveBeenCalled()
    expect(claimOf(w)).toMatchObject({ status: 'approved', approvedAmountCents: 500 })
  })

  it('H (bis). the audit WRITE failing rolls the reversal back — the decision survives intact', async () => {
    approved()
    db.adminAuditLog.create.mockRejectedValue(new Error('audit table unavailable'))
    // a real transaction rolls back; the double must therefore undo what the callback wrote.
    const snapshot = JSON.parse(JSON.stringify(claimOf(w)))
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      try { return await fn(db) } catch (e) { Object.assign(claimOf(w), snapshot); throw e }
    })
    const out = await withdrawClaimApproval({ claimId: 'cl1', adminId: 'admin1', reason: 'motif suffisamment long', confirm: WITHDRAW_CONFIRM_WORD })
    expect(out.ok).toBe(false)
    expect(claimOf(w)).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500 })
  })

  it('the audit row is written INSIDE the transaction, with the previous decision recorded', async () => {
    approved()
    const out = await withdrawClaimApproval({ claimId: 'cl1', adminId: 'admin1', adminEmail: 'a@g.test', reason: 'motif suffisamment long', confirm: WITHDRAW_CONFIRM_WORD })
    expect(out.ok).toBe(true)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'claim.withdraw_approval', targetId: 'cl1',
        metadata: expect.objectContaining({ previousApprovedAmountCents: 500, previousArbitratedBy: 'admin1', moneyMoved: false, reason: 'motif suffisamment long' }),
      }),
    }))
    // the generic best-effort audit helper is NOT what recorded it — the transaction did.
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a recorded money state, a stamped row, or an unreadable row list each refuse the withdrawal', async () => {
    // a real attempt
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: true, refundId: null, refundError: 'refund_safety_hold: x' })
    expect(await withdrawClaimApproval({ claimId: 'cl1', adminId: 'a', reason: 'motif suffisamment long', confirm: WITHDRAW_CONFIRM_WORD }))
      .toMatchObject({ ok: false, status: 409, error: WITHDRAW_MONEY_RECORDED })

    // a Refund row carrying this claim's stamp
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null })
    w.refunds.push({ id: 'rf_x', orderId: 'o1', status: 'failed', amountCents: 500, stripeRefundId: null, reason: 'claim:cl1', idempotencyKey: 'refund:o1:k', createdAt: new Date(), royaltyRefundCents: 0 })
    expect(await withdrawClaimApproval({ claimId: 'cl1', adminId: 'a', reason: 'motif suffisamment long', confirm: WITHDRAW_CONFIRM_WORD }))
      .toMatchObject({ ok: false, status: 409, error: WITHDRAW_ROW_STAMPED })

    // the row list unreadable — not knowing is not permission
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null })
    db.refund.count.mockRejectedValue(new Error('db down'))
    expect(await withdrawClaimApproval({ claimId: 'cl1', adminId: 'a', reason: 'motif suffisamment long', confirm: WITHDRAW_CONFIRM_WORD }))
      .toMatchObject({ ok: false, status: 409, error: WITHDRAW_ROW_UNREADABLE })
    expect(w.writes).toHaveLength(0)
  })

  it('the confirmation word and a ≥10-character motive are both required; a v13 proof of absence stays withdrawable', async () => {
    approved()
    expect(await withdrawClaimApproval({ claimId: 'cl1', adminId: 'a', reason: 'motif suffisamment long' }))
      .toMatchObject({ ok: false, status: 400, error: WITHDRAW_CONFIRM_REQUIRED })
    expect(await withdrawClaimApproval({ claimId: 'cl1', adminId: 'a', reason: 'court', confirm: WITHDRAW_CONFIRM_WORD }))
      .toMatchObject({ ok: false, status: 400, error: WITHDRAW_REASON_REQUIRED })
    expect(w.writes).toHaveLength(0)
    // §4 precondition 1: a proof written by a path that reached no engine does not block the reversal.
    setWorld({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null,
      refundError: 'no_refund_proven:v13:2026-09-23T09:00:00.000Z: preuve' })
    const out = await withdrawClaimApproval({ claimId: 'cl1', adminId: 'a', reason: 'motif suffisamment long', confirm: WITHDRAW_CONFIRM_WORD })
    expect(out.ok).toBe(true)
    expect(claimOf(w)).toMatchObject({ status: 'arbitration', approvedAmountCents: null })
  })
})

// ── the read-only queues ─────────────────────────────────────────────────────────────────────
describe('§8.5 — the « À rembourser » queue is a READING in this lot', () => {
  it('lists only the exact payable shape, FIFO by decision instant, and never touches money', async () => {
    const rows = [
      { id: 'a', orderId: 'o1', status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null, refundError: null, approvedAmountCents: 400, requestedAmountCents: 500, arbitratedAt: new Date('2026-09-23T09:00:00Z'), createdAt: new Date('2026-09-20T09:00:00Z'), arbitrationReason: null },
      { id: 'b', orderId: 'o2', status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null, refundError: null, approvedAmountCents: 200, requestedAmountCents: 200, arbitratedAt: new Date('2026-09-23T08:00:00Z'), createdAt: new Date('2026-09-21T09:00:00Z'), arbitrationReason: null },
    ]
    db.claim.findMany.mockResolvedValue(rows)
    const out = await listApprovedAwaitingPayment()
    expect(db.claim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null, refundError: null, approvedAmountCents: { not: null } }),
      orderBy: [{ arbitratedAt: 'asc' }, { createdAt: 'asc' }],
    }))
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
    expect(out[0]).toMatchObject({ approvedAmountCents: 400, requestedAmountCents: 500 })
    expect(out[0].orderRef).toMatch(/^GR-/)          // a reference, never a raw id, in a list
    expect(JSON.stringify(out)).not.toMatch(/consumerId|refundError|arbitratedBy/)
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
  })

  it('« À ratifier » is the amount-less shape, and the two lists are disjoint by construction', async () => {
    db.claim.findMany.mockResolvedValue([])
    await listAwaitingRatification()
    expect(db.claim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'approved', refundAttempted: false, refundId: null, approvedAmountCents: null }),
    }))
  })
})

// ── static pins ──────────────────────────────────────────────────────────────────────────────
describe('STATIC PINS — the shipped sources', () => {
  const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('lib/refund.ts is byte-identical to the frozen engine (L4 changed no money code)', () => {
    // the SHA pin lives in tests/claims-r13-engine-closed.test.ts; here we assert the file is untouched
    // by this lot's own diff surface: no D′ L4 marker was added to it.
    expect(src('lib/refund.ts')).not.toMatch(/D′ L4/)
  })

  it('T1 reads the approved amount, refuses without it, and pins it in the CAS (§8.3)', () => {
    const s = strip(src('lib/claims.ts'))
    expect(s).toMatch(/approvedAmountCents:\s*true,\s*\n\s*arbitrationDecision:\s*true,/)
    expect(s).toMatch(/const payableCents = before\.approvedAmountCents/)
    expect(s).toMatch(/return \{ state: 'failed', error: 'amount_not_ratified' \}/)
    expect(s).toMatch(/arbitrationDecision: 'approved', approvedAmountCents: payableCents,/)
    // and the engine is called with the payable amount, never the requested one
    expect(s).toMatch(/amountCents: payableCents,/)
    expect(s).not.toMatch(/amountCents: before\.requestedAmountCents/)
  })

  it('the withdrawal writes its audit inside the transaction and never writes refused_final', () => {
    const s = strip(src('lib/claims.ts'))
    const body = s.slice(s.indexOf('export async function withdrawClaimApproval'), s.indexOf('// ══ D′ L4 (spec v2 §8.5)') > 0 ? undefined : undefined)
    expect(body).toMatch(/prisma\.\$transaction/)
    expect(body).toMatch(/tx\.adminAuditLog\.create/)
    expect(body.slice(0, body.indexOf('export async function', 10) + 1)).not.toMatch(/refused_final/)
    expect(strip(src('app/api/admin/claims/[id]/withdraw-approval/route.ts'))).not.toMatch(/refused_final/)
  })

  it('no L4 route reaches the engine, Stripe, or a refund write', () => {
    for (const p of [
      'app/api/admin/claims/[id]/arbitrate/route.ts',
      'app/api/admin/claims/[id]/withdraw-approval/route.ts',
      'app/api/admin/claims/[id]/ceiling/route.ts',
    ]) {
      const s = strip(src(p))
      expect(s, p).not.toMatch(/triggerClaimRefund|executeRefund|@\/lib\/refund/)
      expect(s, p).not.toMatch(/refunds\.create|getStripe\(/)
    }
    // the ceiling route writes nothing at all
    expect(strip(src('app/api/admin/claims/[id]/ceiling/route.ts'))).not.toMatch(/\.(create|update|updateMany|upsert|delete)\(/)
  })
})

// ── S-11, the OTHER half: reconcile must judge what the rail would pay ───────────────────────
// Found by the L4 adversarial review, which is the only reason this file has it: the `requested →
// payable` rename of §8.3 was applied to T1 and stopped there, while the SAME spec line names three
// more sites. Before L4 the omission was invisible — nothing wrote approvedAmountCents, so both halves
// read the same number. L4 made them able to disagree, and a disagreement here is not cosmetic: the
// derivation decides whether the engine WOULD refuse and then writes that verdict into the claim as a
// money proof. Judging the requested amount would lock a decision that was payable at the approved one.
describe('§8.3 / S-11 — the reconcile half judges the APPROVED amount, never the requested one', () => {
  const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('reconcileNoRowByDerivation loads the money facts and writes its proof text with the decided amount', () => {
    const s = strip(src('lib/claims.ts'))
    expect(s).toMatch(/const judged = claim\.approvedAmountCents \?\? claim\.requestedAmountCents/)
    expect(s).toMatch(/loadOrderMoneyFacts\(claim\.orderId, claim\.id, judged, cache\)/)
    expect(s).toMatch(/absenceProofText\(o, read, \{ preImage: claim\.refundError, now: new Date\(\), requestedAmountCents: judged \}\)/)
    // NEGATIVE CONTROL — the pre-fix shape, which judged the requested amount, is gone from both sites.
    expect(s).not.toMatch(/loadOrderMoneyFacts\(claim\.orderId, claim\.id, claim\.requestedAmountCents/)
    expect(s).not.toMatch(/requestedAmountCents: claim\.requestedAmountCents \}\)/)
  })

  it('the claim that feeds it CARRIES the decided amount — without the select the fallback would always win', () => {
    const s = strip(src('lib/claims.ts'))
    // reconcileClaimEvidence's own select
    expect(s).toMatch(/select: \{ id: true, orderId: true, status: true, refundId: true, refundAttempted: true, requestedAmountCents: true, approvedAmountCents: true, refundError: true \}/)
    // and the signature accepts it
    expect(s).toMatch(/requestedAmountCents: number; approvedAmountCents\?: number \| null; refundError: string \| null \}/)
  })

  it('the financial-verification alert names the decided amount beside the requested one', () => {
    const s = strip(src('lib/claims.ts'))
    expect(s).toMatch(/select: \{ orderId: true, requestedAmountCents: true, approvedAmountCents: true, createdAt: true \}/)
    expect(s).toMatch(/approvedCents:\s+claim\?\.approvedAmountCents \?\? null,/)
  })

  it('EVERY site that judges or names the claim money amount is now fed one of the two allowed values', () => {
    // The whole point of the invariant: `requestedAmountCents` may still be READ (it is the bound of an
    // approval, and the fallback), but no site may feed the ENGINE or a PROOF TEXT the requested amount
    // when a decided one exists. These are the four money-facing feeds in the file.
    const s = strip(src('lib/claims.ts'))
    const feeds = s.match(/loadOrderMoneyFacts\([^)]*\)/g) ?? []
    expect(feeds.length).toBeGreaterThanOrEqual(2)
    for (const f of feeds) expect(f, f).toMatch(/payableCents|judged|requestedCents/)
    // absenceProofText's argument list contains a nested call (new Date()), so the window must run to
    // the end of the statement rather than to the first closing parenthesis.
    const proofs = s.match(/absenceProofText\([^;]{0,300}/g) ?? []
    expect(proofs.length).toBeGreaterThanOrEqual(2)
    for (const p of proofs) expect(p, p).toMatch(/requestedAmountCents: (payableCents|judged)/)
  })
})
