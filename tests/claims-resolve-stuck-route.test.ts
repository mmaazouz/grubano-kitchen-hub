// tests/claims-resolve-stuck-route.test.ts — CLAIMS batch 2, re-audit fix; ROUND 13 (slice W6): J-C26 (H07 site (i)) and
// the route + predicate halves of J-M39 (D11, D10 (i)).
//
// The stuck-money escape hatch shipped with its own bespoke authorization: it re-read
// `Operator.role` from the DB and required it to equal 'admin'. That LOOKED stricter than every
// other admin route. It was in fact broken: `scripts/server/provision-admin.js` grants admin by
// INSERTING an OperatorRole row and deliberately never touches `Operator.role`. So the only
// admin the project's own script creates was refused 403 here — while still being able to
// approve claims and move real money through /arbitrate. The one door added to unblock stuck
// money was closed to the only person who could walk through it.
//
// J-M39 lib halves (the CAS on the exact pre-image, DECLARED_AFTER_REVERT keeping the original text, count 0 → the D11 409
// and no record, count 1 → one record with P2002 silent, no engine and no Stripe call) run on the real resolveStuckClaim in
// tests/claims-r13-declaration-after-revert.test.ts and tests/claim-closure-record.test.ts.
//
// D′ L1 (FIN-EMAIL-01, S-25): the closure notice after a declaration is an explicit terminal CLOSURE — always sendable.
// The route passes claimsOpen: claimNoticeGate('closure') (= true whatever the flags say) instead of the lease; the gate
// is lib/claim-flags on the REAL env (no mock of lib/claims can answer it). The lease is CLOSED throughout this file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { closeClaimsWindow } from './support/claims-window'

const { resolveAdminMock } = vi.hoisted(() => ({ resolveAdminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: resolveAdminMock }))

const { resolveStuckMock } = vi.hoisted(() => ({ resolveStuckMock: vi.fn() }))
vi.mock('@/lib/claims', () => ({ resolveStuckClaim: resolveStuckMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { closureMock } = vi.hoisted(() => ({ closureMock: vi.fn() }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimClosureEmail: closureMock }))

import { POST } from '@/app/api/admin/claims/[id]/resolve-stuck/route'
import { isStuckResolvable, claimClosureKind, customerClaimStatus, MARKERS, type ClaimFacts } from '@/lib/claim-action-rules'
import { claimNoticeGate, claimsSurfaceOpen } from '@/lib/claim-flags'

const PRODUCT_FLAGS = ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'] as const

/** Exactly what provision-admin.js produces: primary role untouched, admin granted by row. */
const PROMOTED_ADMIN = { id: 'op1', role: 'restaurant', name: 'Founder', email: 'founder@example.test' }

const post = (body: unknown) =>
  POST(
    new Request('https://app.grubano.com/api/admin/claims/cl1/resolve-stuck', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }) as never,
    { params: { id: 'cl1' } },
  )

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [closureMock, auditMock, resolveStuckMock]) m.mockReset()
  // D′ L1: every claims gate CLOSED — the hatch and its closure notice do not depend on any of them.
  closeClaimsWindow()
  for (const k of PRODUCT_FLAGS) delete process.env[k]
  resolveAdminMock.mockResolvedValue(PROMOTED_ADMIN)
  resolveStuckMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'refused_final' } })
  auditMock.mockResolvedValue(undefined)
  closureMock.mockResolvedValue({ status: 'sent', kind: 'closed_by_declaration' })
})
afterEach(() => { closeClaimsWindow(); for (const k of PRODUCT_FLAGS) delete process.env[k] })

describe('RE-AUDIT FIX — the admin the project actually provisions can reach the hatch', () => {
  it('an operator whose PRIMARY role is restaurant but who holds the admin GRANT is accepted', async () => {
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
    expect(resolveStuckMock).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'cl1', adminId: 'op1' }))
  })

  it('NEGATIVE CONTROL — the old primary-column rule would have refused that same operator', () => {
    const oldRule = (o: { role: string }) => o.role === 'admin'
    expect(oldRule(PROMOTED_ADMIN)).toBe(false) // ← the defect the re-audit found
  })
})

describe('the guard is still a guard', () => {
  it('a non-admin is refused 403 and nothing is resolved', async () => {
    resolveAdminMock.mockResolvedValue(null)
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(403)
    expect(resolveStuckMock).not.toHaveBeenCalled()
  })

  it('authorization is resolved from the SESSION and the DB, never from the request body', async () => {
    resolveAdminMock.mockResolvedValue(null)
    const res = await post({ resolution: 'closed_no_payment', adminId: 'op1', role: 'admin' })
    expect(res.status).toBe(403)
    expect(resolveStuckMock).not.toHaveBeenCalled()
  })

  it('an invalid resolution is rejected before any state change', async () => {
    const res = await post({ resolution: 'refund_it_again' })
    expect(res.status).toBe(400)
    expect(resolveStuckMock).not.toHaveBeenCalled()
  })

  it('a resolution the lib refuses is passed through with ITS status, not a 200', async () => {
    resolveStuckMock.mockResolvedValue({ ok: false, status: 409, error: 'pas bloquée' })
    const res = await post({ resolution: 'settled_out_of_band' })
    expect(res.status).toBe(409)
  })
})

describe('the hatch records the decision and never claims to have moved money', () => {
  it('the audit entry states moneyMoved: false', async () => {
    await post({ resolution: 'settled_out_of_band', reason: 'virement manuel' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action:   'claim.resolve_stuck',
      actorId:  'op1',
      metadata: expect.objectContaining({ moneyMoved: false, resolution: 'settled_out_of_band' }),
    }))
  })

  it('a failing audit never turns a completed resolution into an error', async () => {
    auditMock.mockRejectedValue(new Error('audit table down'))
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
  })
})

// ══ ROUND 13 — J-C26 (H07 site (i)) ══════════════════════════════════════════════════════════════
describe('J-C26 — the closure-notice attempt after a declaration', () => {
  it('both resolutions with a note → sendClaimClosureEmail once with exactly {claimId, claimsOpen:true} (the lease is CLOSED here): no note, no amount; the body carries customerEmail', async () => {
    auditMock.mockResolvedValue(false)
    expect(claimsSurfaceOpen()).toBe(false)
    for (const resolution of ['settled_out_of_band', 'closed_no_payment']) {
      closureMock.mockClear()
      const res = await post({ resolution, reason: 'virement manuel de 12,50 € le 10/09' })
      expect(res.status, resolution).toBe(200)
      expect(closureMock, resolution).toHaveBeenCalledTimes(1)
      expect(closureMock, resolution).toHaveBeenCalledWith({ claimId: 'cl1', claimsOpen: true })
      expect(JSON.stringify(closureMock.mock.calls[0]), resolution).not.toMatch(/virement|12,50|amount|evidence|note/)
      expect(await res.json(), resolution).toEqual({ claim: { id: 'cl1', status: 'refused_final' }, noteRecorded: false, customerEmail: { status: 'sent', kind: 'closed_by_declaration' } })
    }
  })

  it('D′ L1 INVERTED (FIN-EMAIL-01, S-25) — every gate closed, explicitly (CLAIMS_ENABLED=false, product flags false): the sender STILL receives claimsOpen true; the route itself is not gated', async () => {
    process.env.CLAIMS_ENABLED = 'false'; process.env.CLAIMS_SURFACE_ENABLED = 'false'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
    expect(closureMock).toHaveBeenCalledTimes(1)
    expect(closureMock).toHaveBeenCalledWith({ claimId: 'cl1', claimsOpen: true }) // ← was { claimsOpen: false } → skipped claims_disabled before D′ L1
    expect(closureMock).not.toHaveBeenCalledWith(expect.objectContaining({ claimsOpen: false }))
    expect((await res.json()).customerEmail).toEqual({ status: 'sent', kind: 'closed_by_declaration' })
  })

  it('NEGATIVE CONTROL (D′ L1) — in that same closed state the SURFACE and the PRE-MONEY gate read false: the old expectation (claimsOpen false) is exactly what a pre-money notice would receive, never a closure', () => {
    process.env.CLAIMS_ENABLED = 'false'; process.env.CLAIMS_SURFACE_ENABLED = 'false'
    expect(claimsSurfaceOpen()).toBe(false)              // the pre-L1 route read isClaimsEnabled() → false → skipped
    expect(claimNoticeGate('pre_money')).toBe(false)     // an ack / decision sender is skipped claims_disabled here
    expect(claimNoticeGate('closure')).toBe(true)        // the declaration's closure notice is not
    expect(claimNoticeGate('post_money')).toBe(true)
  })

  it('a sender rejection → the same status and body, plus customerEmail sender_error', async () => {
    closureMock.mockRejectedValue(new Error('boom'))
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ claim: { id: 'cl1', status: 'refused_final' }, noteRecorded: null, customerEmail: { status: 'failed', kind: null, why: 'sender_error' } })
  })

  it('403 / 400 / 404 / 409 → the sender is not called', async () => {
    resolveAdminMock.mockResolvedValueOnce(null)
    expect((await post({ resolution: 'closed_no_payment' })).status).toBe(403)
    expect((await post({ resolution: 'nope' })).status).toBe(400)
    resolveStuckMock.mockResolvedValueOnce({ ok: false, status: 404, error: 'Réclamation introuvable.' })
    expect((await post({ resolution: 'closed_no_payment' })).status).toBe(404)
    resolveStuckMock.mockResolvedValueOnce({ ok: false, status: 409, error: 'Cette réclamation a changé d’état entre-temps — rien n’a été écrit. Relisez sa ligne dans la file.' })
    expect((await post({ resolution: 'closed_no_payment' })).status).toBe(409)
    expect(closureMock).not.toHaveBeenCalled()
  })
})

// ══ ROUND 13 — J-M39 (D11, D10 (i)) ════════════════════════════════════════════════════════════
describe('J-M39 — D10 (i) runs whatever the audit returned', () => {
  it('audit true → the notice is attempted; audit false (ADMIN_AUDIT_ENABLED off) → attempted too: the record, not the audit, is eligibility', async () => {
    auditMock.mockResolvedValue(true)
    let res = await post({ resolution: 'settled_out_of_band', reason: 'x' })
    expect((await res.json()).noteRecorded).toBe(true)
    expect(closureMock).toHaveBeenCalledTimes(1)

    closureMock.mockClear()
    auditMock.mockResolvedValue(false)
    res = await post({ resolution: 'settled_out_of_band', reason: 'x' })
    expect((await res.json()).noteRecorded).toBe(false)
    expect(closureMock).toHaveBeenCalledTimes(1)
  })
})

describe('J-M39 — the isStuckResolvable matrix (D11)', () => {
  const MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'
  const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf_b…`
  const DECLARED = `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : payé autrement après l’échec chez Stripe du remboursement lié. ${REVERTED}`
  const RM = 'resume_mismatch: le moteur a repris un remboursement antérieur (500 c) au lieu du montant de cette réclamation (300 c).'
  const row = (reason: string | null) => ({ id: 'rf_b', orderId: 'o1', status: 'succeeded', stripeRefundId: 're_b', reason })
  const CASES: Array<[string, ClaimFacts, boolean]> = [
    ['marker (refunding)', { id: 'cl1', status: 'refunding', refundError: MARKER }, false],
    ['marker (approved)', { id: 'cl1', status: 'approved', refundError: MARKER }, false],
    ['v13 proof', { id: 'cl1', status: 'approved', refundError: `${MARKERS.PROOF_PAYABLE_V13} x` }, false],
    ['legacy proof', { id: 'cl1', status: 'approved', refundError: 'no_refund_proven: preuve héritée' }, false],
    ['RAIL_LOCKED', { id: 'cl1', status: 'approved', refundError: `${MARKERS.RAIL_LOCKED}: écrit avant` }, true],
    ['AWAITING', { id: 'cl1', status: 'approved', refundError: `${MARKERS.AWAITING_FINALIZATION} x` }, true],
    ['SAFETY_HOLD', { id: 'cl1', status: 'approved', refundError: `${MARKERS.SAFETY_HOLD} x` }, true],
    ['STRIPE_REVERTED', { id: 'cl1', status: 'approved', refundError: `${MARKERS.STRIPE_REVERTED} x` }, true],
    ['engine_failed', { id: 'cl1', status: 'approved', refundError: 'engine_failed: x' }, true],
    ['engine_row_dead', { id: 'cl1', status: 'approved', refundError: `${MARKERS.ENGINE_ROW_DEAD}: x` }, true],
    ['stripe_failed', { id: 'cl1', status: 'approved', refundError: 'stripe_failed: x' }, true],
    ['resume_mismatch, own stamp', { id: 'cl1', status: 'refunding', refundError: RM, boundRow: row('claim:cl1') }, false],
    ['resume_mismatch, other stamp', { id: 'cl1', status: 'refunding', refundError: RM, boundRow: row('claim:cl9') }, true],
    ['resume_mismatch, stamp unread', { id: 'cl1', status: 'refunding', refundError: RM }, false],
    ['refunded + REVERTED_AFTER_REFUND', { id: 'cl1', status: 'refunded', refundError: REVERTED }, true],
    ['refunded + DECLARED_AFTER_REVERT', { id: 'cl1', status: 'refunded', refundError: DECLARED }, false],
    ['refunded, no error', { id: 'cl1', status: 'refunded', refundError: null }, false],
    ['approved, no error', { id: 'cl1', status: 'approved', refundError: null }, false],
    ['refused_final', { id: 'cl1', status: 'refused_final', refundError: 'engine_failed: x' }, false],
  ]
  it('verdicts exactly as D11', () => {
    for (const [name, c, want] of CASES) expect(isStuckResolvable(c), name).toBe(want)
  })

  it('NEGATIVE CONTROL — refunded + DECLARED_AFTER_REVERT is refused: no re-declaration', () => {
    expect(isStuckResolvable({ id: 'cl1', status: 'refunded', refundError: DECLARED })).toBe(false)
  })

  it('both declaration results read as a closure by the team, never a refund or a refusal', () => {
    const settled = { status: 'refunded', refundError: DECLARED, arbitrationDecision: 'approved' }
    const closed = { status: 'refused_final', refundError: 'engine_failed: x', arbitrationDecision: 'approved' }
    expect(claimClosureKind(settled)).toBe('settled_by_declaration')
    expect(claimClosureKind(closed)).toBe('closed_by_declaration')
    expect(customerClaimStatus(settled, null, true)).toBe('closed_by_support')
    expect(customerClaimStatus(closed, null, null)).toBe('closed_by_support')
  })
})
