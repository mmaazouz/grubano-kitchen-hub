// tests/claims-r13-approve-route.test.ts — T-49 round 13, slice W2: J-M32 (D2, E-10, A-S25, I-01, F12) — re-pinned under D′ L2.
//
// POST /api/admin/claims/[id]/arbitrate {decision:'approve'} through the real route and lib/claims: the CLAIMS
// lease gates the route, the decision CAS decides, and under D′ L2 (spec v2 S-02/T-07/T-08) THAT IS ALL: the route
// never reads the REFUNDS lease, never calls the engine, never emits a « refunds_disabled » alert and returns no
// `refund` field. T1 → T2 → the engine → T4 (unchanged) belong to the RAIL: they are exercised here by calling
// triggerClaimRefund BY HAND on the world the approve left, which is also the negative control proving the
// « 0 engine » assertions observe a property (the same world DOES reach the engine when the rail runs).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { payableWorld, wireWorld, claimOf, engineOk, engineRefusal, type World } from './support/claims-world'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
const { auditMock, emailMock, adminMock } = vi.hoisted(() => ({ auditMock: vi.fn(), emailMock: vi.fn(), adminMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimDecisionEmail: emailMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
// D′ L4 (S-27): the approve branch of the route refuses 503 unless the D′ columns are usable. The probe
// itself is pinned by tests/claims-dprime-l3b-schema-ready.test.ts; here it answers READY.
const { schemaMock } = vi.hoisted(() => ({ schemaMock: { fn: vi.fn() } }))
vi.mock('@/lib/schema-ready', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/schema-ready')>()
  return { ...real, schemaReady: (...a: unknown[]) => schemaMock.fn(...a) }
})

import { POST } from '@/app/api/admin/claims/[id]/arbitrate/route'
import { triggerClaimRefund } from '@/lib/claims'
import { MARKERS, HEAD_A, acceptedExits, arbitrationRefusal, approvePrematureText, approveRevisableText, approvePermanentText, APPROVE_CONFIRM_WORD, APPROVE_ALREADY_SET, APPROVE_CONFIRM_REQUIRED } from '@/lib/claim-action-rules'
import { approvalToast } from '@/lib/claim-approval-toast'

let w: World
/** D′ L4 (T-07): an approval carries the amount it ratifies and the admin's typed confirmation. */
const approve = async (body: Record<string, unknown> = {}) => {
  const res = await POST(new Request('https://app.grubano.com/api/admin/claims/cl1/arbitrate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD, ...body }),
  }), { params: { id: 'cl1' } })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const blocked = () => (alertMock.mock.calls as Array<[{ kind: string; dedupeKey: string; facts: Record<string, unknown> }]>).map((c) => c[0]).filter((a) => a.kind === 'claim_payment_blocked')
const tokenWrites = () => w.writes.filter((x) => String(x.data.refundError ?? '').startsWith('reconcile_required'))
/** D′ L2: the shape an approve leaves — APPROVED_AWAITING_PAYMENT, decided, untouched by any rail. */
const AWAITING_PAYMENT = { status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null }
/** D′ L2: what a route approve must NOT have done — read the REFUNDS lease, called the engine, written a token, alerted, reported a refund. */
const expectDecisionOnly = (r: { status: number; body: Record<string, unknown> }) => {
  expect(r.status).toBe(200)
  expect(r.body).not.toHaveProperty('refund')
  expect(refundsFlag).not.toHaveBeenCalled()
  expect(execMock).not.toHaveBeenCalled()
  expect(tokenWrites()).toEqual([])
  expect(blocked()).toEqual([])
  // D′ L4: the audit records WHAT was decided — the amount the CAS wrote, and no motive when nothing was reduced.
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.arbitrate', metadata: { decision: 'approve', moneyMoved: false, approvedAmountCents: 500, reduceReason: null } }))
  expect(emailMock).toHaveBeenCalledTimes(1)
  // D-11: the notice names the APPROVED amount (re-read from the row) and still promises no payment.
  expect(emailMock.mock.calls[0][0]).toMatchObject({ decision: 'approved', refundedCents: null, approvedCents: 500 })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, alertMock, refundsFlag, auditMock, emailMock, adminMock]) m.mockReset()
  openClaimsWindow()
  refundsFlag.mockReturnValue(true)
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(true)
  emailMock.mockResolvedValue({ status: 'sent' })
  adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test' })
  execMock.mockResolvedValue(engineOk())
  schemaMock.fn.mockReset()
  schemaMock.fn.mockResolvedValue({ ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null })
  // D′ L4: the claim under decision carries NO amount yet — the decision is what fixes it.
  w = payableWorld({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
  wireWorld(w, db, stripeMock)
})
afterEach(() => closeClaimsWindow())

describe('J-M32 (D′ L2) — approve: server order, the CLAIMS lease, the decision CAS, drift refusal — and NO money, whatever the REFUNDS lease', () => {
  it('(a) CLAIMS off → 403 {gated:true}, nothing written', async () => {
    closeClaimsWindow()
    const r = await approve()
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ gated: true })
    expect(w.writes).toEqual([])
    expect(execMock).not.toHaveBeenCalled()
  })

  for (const [name, claim] of [
    ['(b) an arbitration claim', { status: 'arbitration', arbitrationDecision: null }],
    ['(b2) a legacy approved claim with arbitrationDecision null', { status: 'approved', arbitrationDecision: null }],
  ] as const) {
    it(`${name}, REFUNDS off → the decision CAS writes APPROVED_AWAITING_PAYMENT, no M, NO refunds_disabled alert, no refund field, e-mail 'approved' (D′ L2 S-02)`, async () => {
      refundsFlag.mockReturnValue(false)
      Object.assign(claimOf(w), claim)
      const r = await approve()
      expectDecisionOnly(r)
      expect(claimOf(w)).toMatchObject({ ...AWAITING_PAYMENT, arbitratedBy: 'admin1', decidedBy: 'admin' })
      // REFUNDS off is NOT an incident under D′ (spec v2 §1.2 C14): no alert of any kind — the rail (« Payer les
      // approuvées ») is the only pay exit, and the old alert shape (cause refunds_disabled, registry E-10) went with it
      expect(alertMock).not.toHaveBeenCalled()
      // the legacy approved case is a RATIFICATION: exactly ONE claim write, the decision fields filled once
      expect(w.writes).toHaveLength(1)
      expect(w.writes[0].data).toMatchObject({ status: 'approved', arbitrationDecision: 'approved' })
    })
  }

  it('(b4) the same two claims with REFUNDS ON → byte-identical decision: the lease is never even read (the approve is lease-independent)', async () => {
    refundsFlag.mockReturnValue(true)
    const r = await approve()
    expectDecisionOnly(r)
    expect(claimOf(w)).toMatchObject(AWAITING_PAYMENT)
    expect(w.writes).toHaveLength(1)
  })

  // ── D′ L4 NEGATIVE CONTROLS — the pre-L4 request shape no longer decides anything ──────────────
  it('NEGATIVE CONTROL (D′ L4) — the old body « decision: approve » alone → 400, 0 writes, no audit, no e-mail; and a schema that cannot hold the amount → 503, 0 writes (S-27)', async () => {
    const res = await POST(new Request('https://app.grubano.com/api/admin/claims/cl1/arbitrate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
    }), { params: { id: 'cl1' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: APPROVE_CONFIRM_REQUIRED })
    expect(w.writes).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    expect(emailMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    // and the whole contract is refused upstream when the D′ columns are not usable on this server
    schemaMock.fn.mockResolvedValue({ ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'stale client' })
    const gated = await approve()
    expect(gated.status).toBe(503)
    expect(gated.body).toMatchObject({ reason: 'schema_not_ready', schemaReady: false })
    expect(w.writes).toEqual([])
    expect(claimOf(w)).toMatchObject({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
  })

  it('(b3) the decision CAS matches nothing → 409 « Cette réclamation a déjà été arbitrée. », no trigger, no alert', async () => {
    refundsFlag.mockReturnValue(false)
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).status = 'refused_final' }
    const r = await approve()
    expect(r).toEqual({ status: 409, body: { error: 'Cette réclamation a déjà été arbitrée.' } })
    expect(refundsFlag).not.toHaveBeenCalled()
    expect(blocked()).toEqual([])
  })

  it('(c) both leases open, null pre-image, payable → the approve is STILL decision-only (0 engine, 0 token, 0 alert); NEGATIVE CONTROL: the rail run by hand on that world → T1 → T2 → executeRefund once → T3 ours → T4 count 1 → refunded', async () => {
    // D2 CONSOLE: no text emitted before the engine call says the claim will be paid (claim writes and alerts so far).
    let beforeEngine = ''
    execMock.mockImplementation(async () => {
      beforeEngine = JSON.stringify({ writes: w.writes.map((x) => x.data), alerts: alertMock.mock.calls })
      return engineOk()
    })
    const r = await approve()
    expectDecisionOnly(r)
    expect(beforeEngine).toBe('')                                   // the engine was never reached by the approve
    expect(claimOf(w)).toMatchObject(AWAITING_PAYMENT)
    expect(w.writes).toHaveLength(1)                                // the decision CAS, nothing else
    // NEGATIVE CONTROL — the property is observable: the SAME world, driven by the rail (dab754d's inline call), pays.
    const t = await triggerClaimRefund('cl1')
    expect(beforeEngine).not.toBe('')
    expect(beforeEngine).not.toMatch(/sera pay|payée|remboursée|sera rembours|will be paid|payable/i)
    expect(refundsFlag).toHaveBeenCalledTimes(1)                    // the lease is read by the RAIL, not by the decision
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(t).toEqual({ state: 'refunded', refundId: 'rf_new', amountCents: 500 })
    expect(approvalToast(t)).toMatchObject({ key: 'approvedRefunded', tone: 'success', amountCents: 500 })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_new' })
    expect(tokenWrites()).toHaveLength(1)                           // T1 wrote M once — on the rail, after the decision
  })

  it('(d) RAIL (triggerClaimRefund, unchanged T1..T4) on the approve’s world: a Dashboard refund lands after T2 (f): the engine refuses E6 → T4 CAS → approved engine_failed + ALERT-B; then stuck_close only, PERMANENT refusal — and the approve itself wrote none of it', async () => {
    execMock.mockResolvedValue(engineRefusal('Un remboursement est déjà en cours sur ce montant cumulé.'))
    const r = await approve()
    expectDecisionOnly(r)
    expect(claimOf(w)).toMatchObject(AWAITING_PAYMENT)
    const t = await triggerClaimRefund('cl1')
    expect(t).toEqual({ state: 'failed', error: 'Un remboursement est déjà en cours sur ce montant cumulé.' })
    expect(approvalToast(t)).toEqual({ key: 'approvedFailed', tone: 'error' })
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'approved', refundAttempted: true })
    expect(c.refundError).toBe('engine_failed: Un remboursement est déjà en cours sur ce montant cumulé. — aucune relance possible depuis les réclamations ; décision humaine requise.')
    expect(blocked().map((a) => a.facts.cause)).toEqual(['engine_failed'])
    const now = new Date()
    // D′ L4 (D1 v1.1): the amount is FIXED on this row, so the declared set is the rail + the withdrawal…
    // D′ L4 control parity: an engine_failed state is past the financial frontier — the rail refuses it
    // (already_handled) and the reversal refuses it (WITHDRAW_MONEY_RECORDED), so the declaration close is
    // the only exit, exactly as this test's title says. Before the parity fix the table also offered
    // 'withdraw' and 'pay' here — two controls both servers would have refused.
    expect(acceptedExits({ claim: c as never, now })).toEqual(['stuck_close'])
    // …while the rail itself still refuses this recorded money state, and never reaches the engine twice.
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'already_handled' })
    expect(execMock).toHaveBeenCalledTimes(1)
    // D′ L4 (S-29): an amount already fixed refuses a re-approval FIRST, whatever the recorded money state says.
    expect(arbitrationRefusal(c as never, 'approve', now)).toEqual({ status: 409, error: APPROVE_ALREADY_SET })
    // NEGATIVE CONTROL — it is the fixed AMOUNT that refuses, not the error: the same facts with no amount
    // still yield the pre-L4 permanent refusal.
    expect(arbitrationRefusal({ ...c, approvedAmountCents: null } as never, 'approve', now)).toEqual({ status: 409, error: approvePermanentText(true) })
    // the route refuses the same way (the rule is shared): a second approve writes nothing
    const writesBefore = w.writes.length
    const r2 = await approve({ approvedAmountCents: 400, reduceReason: 'nouvelle appréciation du dossier' })
    expect(r2).toEqual({ status: 409, body: { error: APPROVE_ALREADY_SET } })
    expect(w.writes).toHaveLength(writesBefore)
    expect(claimOf(w).approvedAmountCents).toBe(500)
  })

  it('(e) approved + v13 before its instant → the C4 premature refusal, 0 writes', async () => {
    const instant = new Date(Date.now() + 30 * 60_000)
    Object.assign(claimOf(w), { status: 'approved', arbitrationDecision: 'approved', refundError: `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).` })
    const r = await approve()
    expect(r).toEqual({ status: 409, body: { error: approvePrematureText(instant.toISOString()) } })
    expect(w.writes).toEqual([])
  })

  it('(f) approved + RAIL_LOCKED → D14 (2), 0 writes', async () => {
    Object.assign(claimOf(w), { status: 'approved', arbitrationDecision: 'approved', refundError: `no_refund_proven_rail_locked: ${HEAD_A}` })
    const r = await approve()
    expect(r).toEqual({ status: 409, body: { error: approveRevisableText(true) } })
    expect(w.writes).toEqual([])
  })

  it('NEGATIVE CONTROL — (c) with the T4 CAS lost on the RAIL → no success toast (write 1 = the decision CAS, 2 = T1, 3 = T4)', async () => {
    w.beforeClaimWrite = (n) => { if (n === 3) Object.assign(claimOf(w), { status: 'financial_verification', refundError: 'financial_verification:x: y' }) }
    const r = await approve()
    expectDecisionOnly(r)
    expect(w.writes).toHaveLength(1)
    const t = await triggerClaimRefund('cl1')
    expect(t).toEqual({ state: 'failed', error: 'attempt_superseded' })
    expect(approvalToast(t)).toEqual({ key: 'approvedSuperseded', tone: 'error' })
    expect(w.writes).toHaveLength(3)
    expect(w.writes[2].count).toBe(0)                               // the T4 CAS matched nothing
  })
})
