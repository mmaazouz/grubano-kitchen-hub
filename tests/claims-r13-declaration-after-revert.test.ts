// tests/claims-r13-declaration-after-revert.test.ts — T-49 round 13, slice W5 fixer: D11's terminal exemption for E-06
// (refunded + REVERTED_AFTER_REFUND), D0 control parity, H05 site 7, J-M39 (E-06 rows).
//
// W5 is the first slice that WRITES REVERTED_AFTER_REFUND (webhook, R0, AMF-1). listActionableRefundClaims lists that
// claim with resolvable true and the consoles render « Clôturer ce dossier… »: POST resolve-stuck must accept exactly that
// exit — settled_out_of_band → refunded + DECLARED_AFTER_REVERT (original text kept), closed_no_payment → refused_final
// (refundError kept) — with a CAS on the pre-image and the closure record after count 1. No money, no Stripe, no engine.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { payableWorld, wireWorld, refundRow, claimOf, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    emailDispatch: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { engine } = vi.hoisted(() => ({ engine: { executeRefund: vi.fn(), markRefundRowFailed: vi.fn(), finalizeRefundRowFromStripe: vi.fn(), isRefundsEnabled: vi.fn() } }))
vi.mock('@/lib/refund', () => ({ ...engine, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock, auditMock, adminMock } = vi.hoisted(() => ({ alertMock: vi.fn(), auditMock: vi.fn(), adminMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { listActionableRefundClaims } from '@/lib/claims'
import { POST as RESOLVE_STUCK } from '@/app/api/admin/claims/[id]/resolve-stuck/route'
import { MARKERS, claimClosureKind, customerClaimStatus, isStuckResolvable, acceptedExits } from '@/lib/claim-action-rules'

const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf_b, mais Stripe rapporte aujourd’hui son remboursement re_b « failed » : il ne verse rien au titre de cette ligne.`
const DECLARED_HEAD = `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : payé autrement après l’échec chez Stripe du remboursement lié. `
const CHANGED = 'Cette réclamation a changé d’état entre-temps — rien n’a été écrit. Relisez sa ligne dans la file.'
const ALREADY_CLOSED = 'Cette réclamation est déjà clôturée.'

let w: World
function e06(refundError: string | null = REVERTED) {
  w = payableWorld({ status: 'refunded', refundAttempted: true, refundId: 'rf_b', refundError, activeOrderKey: null, arbitrationDecision: 'approved' })
  w.refunds.push(refundRow('rf_b', { status: 'succeeded', stripeRefundId: 're_b', reason: 'claim:cl1' }))
  wireWorld(w, db, stripeMock)
  return w
}
const post = async (resolution: string) => {
  const res = await RESOLVE_STUCK(new Request('https://app.grubano.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution }) }), { params: { id: 'cl1' } })
  return { status: res.status, body: await res.json() as { error?: string; claim?: Record<string, unknown> } }
}
const records = () => (db.emailDispatch.create.mock.calls as Array<[{ data: Record<string, unknown> }]>).map((c) => c[0].data)
function expectNoMoney() {
  expect(engine.executeRefund).not.toHaveBeenCalled()
  expect(engine.markRefundRowFailed).not.toHaveBeenCalled()
  for (const m of [stripeMock.refunds.create, stripeMock.refunds.retrieve, stripeMock.refunds.list, stripeMock.paymentIntents.retrieve]) expect(m).not.toHaveBeenCalled()
  expect(db.refund.update).not.toHaveBeenCalled()
  expect(db.refund.updateMany).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [...Object.values(engine), alertMock, auditMock, adminMock, db.emailDispatch.create, db.refund.update, db.refund.updateMany]) m.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(true)
  adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'a@x.test' })
  db.emailDispatch.create.mockResolvedValue({})
})

describe('D11 / D0 — an E-06 claim: the list flag equals the resolve-stuck verdict', () => {
  it('settled_out_of_band → 200: refunded + DECLARED_AFTER_REVERT keeping the reversal text; CAS on the pre-image; one closure record; customer closed_by_support', async () => {
    e06()
    const listed = await listActionableRefundClaims()
    expect(listed.map((c) => [c.id, c.resolvable])).toEqual([['cl1', true]])
    expect(acceptedExits({ claim: { ...claimOf(w), boundRow: w.refunds[0] } as never, now: new Date() })).toContain('stuck_close')
    const r = await post('settled_out_of_band')
    expect(r.status).toBe(200)
    const c = claimOf(w)
    expect(c.status).toBe('refunded')
    expect(c.refundError).toBe(DECLARED_HEAD + REVERTED)
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0].where).toEqual({ id: 'cl1', status: 'refunded', refundError: REVERTED })
    expect(records()).toEqual([{ trigger: 'claim_closure_record', dedupeKey: 'claim:cl1' }])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.resolve_stuck', metadata: expect.objectContaining({ resolution: 'settled_out_of_band', moneyMoved: false }) }))
    expect(claimClosureKind(c as never)).toBe('settled_by_declaration')
    expect(customerClaimStatus(c as never, null, null)).toBe('closed_by_support')
    // the exit took it out of the list, and it is not declarable a second time
    expect(await listActionableRefundClaims()).toEqual([])
    expect(isStuckResolvable({ ...c, boundRow: w.refunds[0] } as never)).toBe(false)
    expect(await post('settled_out_of_band')).toEqual({ status: 409, body: { error: ALREADY_CLOSED } })
    expectNoMoney()
  })

  it('closed_no_payment → 200: refused_final with the refundError kept; one closure record; customer closed_by_support', async () => {
    e06()
    expect((await listActionableRefundClaims()).map((c) => c.resolvable)).toEqual([true])
    const r = await post('closed_no_payment')
    expect(r.status).toBe(200)
    const c = claimOf(w)
    expect(c.status).toBe('refused_final')
    expect(c.refundError).toBe(REVERTED)
    expect(c.activeOrderKey).toBeNull()
    expect(w.writes[0].where).toEqual({ id: 'cl1', status: 'refunded', refundError: REVERTED })
    expect(records()).toEqual([{ trigger: 'claim_closure_record', dedupeKey: 'claim:cl1' }])
    expect(claimClosureKind(c as never)).toBe('closed_by_declaration')
    expect(customerClaimStatus(c as never, null, null)).toBe('closed_by_support')
    expect(await listActionableRefundClaims()).toEqual([])
    expectNoMoney()
  })

  it('an existing closure record (P2002, closed then reverted then declared) is silent: 200, the claim declared', async () => {
    e06()
    db.emailDispatch.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect((await post('settled_out_of_band')).status).toBe(200)
    expect(String(claimOf(w).refundError).startsWith(MARKERS.DECLARED_AFTER_REVERT)).toBe(true)
  })

  it('C9 (e) — the refundError changed between the read and the CAS → 409 « a changé d’état entre-temps — rien n’a été écrit », no record, no audit', async () => {
    e06()
    w.beforeClaimWrite = () => { claimOf(w).refundError = `${MARKERS.DECLARED_AFTER_REVERT} déclaration concurrente` }
    expect(await post('closed_no_payment')).toEqual({ status: 409, body: { error: CHANGED } })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(claimOf(w).status).toBe('refunded')
    expect(records()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    expectNoMoney()
  })

  for (const [label, refundError] of [['refunded + DECLARED_AFTER_REVERT (no re-declaration)', `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : … ${REVERTED}`], ['refunded + null error', null]] as const) {
    it(`NEGATIVE CONTROL — ${label}: not listed as resolvable, and resolve-stuck refuses (409), nothing written`, async () => {
      e06(refundError)
      expect(isStuckResolvable({ ...claimOf(w), boundRow: w.refunds[0] } as never)).toBe(false)
      expect((await listActionableRefundClaims()).filter((c) => c.resolvable)).toEqual([])
      for (const resolution of ['settled_out_of_band', 'closed_no_payment']) {
        expect(await post(resolution)).toEqual({ status: 409, body: { error: ALREADY_CLOSED } })
      }
      expect(w.writes).toEqual([])
      expect(records()).toEqual([])
    })
  }

  it('BREAK/RESTORE witness — the exemption is the only terminal claim admitted past the guard (source, comments stripped)', () => {
    const src = readFileSync('lib/claims.ts', 'utf8').replace(/\r\n/g, '\n').replace(/^[ \t]*\/\/.*$/gm, '')
    const body = src.slice(src.indexOf('export async function resolveStuckClaim('), src.indexOf('export type ClaimRecoverySummary'))
    expect(body).toContain("const settledThenReverted = claim.status === 'refunded' && typeof claim.refundError === 'string' && claim.refundError.startsWith(MARKERS.REVERTED_AFTER_REFUND)")
    expect(body).toContain('if (TERMINAL_STATUSES.includes(claim.status) && !settledThenReverted) {')
    expect(body.indexOf('await recordClaimClosure(claim.id)')).toBeGreaterThan(body.indexOf('if (done.count !== 1)'))
  })
})
