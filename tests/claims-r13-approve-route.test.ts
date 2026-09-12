// tests/claims-r13-approve-route.test.ts — T-49 round 13, slice W2: J-M32 (D2, E-10, A-S25, I-01, F12).
//
// POST /api/admin/claims/[id]/arbitrate {decision:'approve'} through the real route and lib/claims: the CLAIMS
// lease gates the route, the REFUNDS lease gates any payment before any claim write, the decision CAS decides,
// T1 → T2 → the engine → T4, and a success toast only when the engine settled THIS claim and T4 won.
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

import { POST } from '@/app/api/admin/claims/[id]/arbitrate/route'
import { MARKERS, HEAD_A, acceptedExits, arbitrationRefusal, approvePrematureText, approveRevisableText, approvePermanentText } from '@/lib/claim-action-rules'
import { approvalToast } from '@/lib/claim-approval-toast'

let w: World
const approve = async () => {
  const res = await POST(new Request('https://app.grubano.com/api/admin/claims/cl1/arbitrate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
  }), { params: { id: 'cl1' } })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const blocked = () => (alertMock.mock.calls as Array<[{ kind: string; dedupeKey: string; facts: Record<string, unknown> }]>).map((c) => c[0]).filter((a) => a.kind === 'claim_payment_blocked')
const tokenWrites = () => w.writes.filter((x) => String(x.data.refundError ?? '').startsWith('reconcile_required'))

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
  w = payableWorld({ status: 'arbitration', arbitrationDecision: null })
  wireWorld(w, db, stripeMock)
})
afterEach(() => closeClaimsWindow())

describe('J-M32 — approve: server order, leases, drift refusal and success only on commit', () => {
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
    it(`${name}, REFUNDS off → the decision CAS writes approved, no M, I-01 refunds_disabled once, toast approvedNotSent (success), e-mail 'approved'`, async () => {
      refundsFlag.mockReturnValue(false)
      Object.assign(claimOf(w), claim)
      const r = await approve()
      expect(r.status).toBe(200)
      expect(r.body.refund).toEqual({ state: 'pending', reason: 'refunds_disabled' })
      expect(claimOf(w)).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null, refundError: null })
      expect(tokenWrites()).toEqual([])
      const a = blocked()
      expect(a).toHaveLength(1)
      expect(a[0].dedupeKey).toBe('claim_blocked:cl1:refunds_disabled')
      expect(a[0].facts).toMatchObject({ cause: 'refunds_disabled', claimStatusAfter: 'approved', engineCalled: false, registry: 'E-10', firstEngineRefusal: null })
      expect(approvalToast(r.body.refund as never)).toEqual({ key: 'approvedNotSent', tone: 'success' })
      expect(emailMock.mock.calls[0][0]).toMatchObject({ decision: 'approved' })
      expect(execMock).not.toHaveBeenCalled()
    })
  }

  it('(b3) the decision CAS matches nothing → 409 « Cette réclamation a déjà été arbitrée. », no trigger, no alert', async () => {
    refundsFlag.mockReturnValue(false)
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).status = 'refused_final' }
    const r = await approve()
    expect(r).toEqual({ status: 409, body: { error: 'Cette réclamation a déjà été arbitrée.' } })
    expect(refundsFlag).not.toHaveBeenCalled()
    expect(blocked()).toEqual([])
  })

  it('(c) both leases open, null pre-image, payable → T1 → T2 → executeRefund once → T3 ours → T4 count 1 → approvedRefunded', async () => {
    // D2 CONSOLE: no text emitted before the engine call says the claim will be paid (claim writes and alerts so far).
    let beforeEngine = ''
    execMock.mockImplementation(async () => {
      beforeEngine = JSON.stringify({ writes: w.writes.map((x) => x.data), alerts: alertMock.mock.calls })
      return engineOk()
    })
    const r = await approve()
    expect(beforeEngine).not.toBe('')
    expect(beforeEngine).not.toMatch(/sera pay|payée|remboursée|sera rembours|will be paid|payable/i)
    expect(r.status).toBe(200)
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(r.body.refund).toEqual({ state: 'refunded', refundId: 'rf_new', amountCents: 500 })
    expect(approvalToast(r.body.refund as never)).toMatchObject({ key: 'approvedRefunded', tone: 'success', amountCents: 500 })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_new' })
  })

  it('(d) a Dashboard refund lands after T2 (f): the engine refuses E6 → T4 CAS → approved engine_failed + ALERT-B; then stuck_close only, PERMANENT refusal', async () => {
    execMock.mockResolvedValue(engineRefusal('Un remboursement est déjà en cours sur ce montant cumulé.'))
    const r = await approve()
    expect(r.status).toBe(200)
    expect(r.body.refund).toEqual({ state: 'failed', error: 'Un remboursement est déjà en cours sur ce montant cumulé.' })
    expect(approvalToast(r.body.refund as never)).toEqual({ key: 'approvedFailed', tone: 'error' })
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'approved', refundAttempted: true })
    expect(c.refundError).toBe('engine_failed: Un remboursement est déjà en cours sur ce montant cumulé. — aucune relance possible depuis les réclamations ; décision humaine requise.')
    expect(blocked().map((a) => a.facts.cause)).toEqual(['engine_failed'])
    const now = new Date()
    expect(acceptedExits({ claim: c as never, now })).toEqual(['stuck_close'])
    expect(arbitrationRefusal(c as never, 'approve', now)).toEqual({ status: 409, error: approvePermanentText(true) })
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

  it('NEGATIVE CONTROL — (c) with the T4 CAS lost → no success toast', async () => {
    w.beforeClaimWrite = (n) => { if (n === 3) Object.assign(claimOf(w), { status: 'financial_verification', refundError: 'financial_verification:x: y' }) }
    const r = await approve()
    expect(r.body.refund).toEqual({ state: 'failed', error: 'attempt_superseded' })
    expect(approvalToast(r.body.refund as never)).toEqual({ key: 'approvedSuperseded', tone: 'error' })
  })
})
