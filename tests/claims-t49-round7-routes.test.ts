// tests/claims-t49-round7-routes.test.ts — T-49 round 7: the Stripe-id body shape, and the
// CLASS-level truthfulness pins the round-6 audit asked for.
//
// Round 6 found that the only pin against the recurring "blanket cash claim about the CUSTOMER
// from one ROW's status" was one exact sentence in one file — and a paraphrase of it shipped in
// lib/claims.ts, rendered verbatim to the operator by the arbitration console. These pins cover
// every file that writes or renders an operator-visible money string, on the CLASS of sentence,
// and ignore comments (the audit history quotes the removed sentences on purpose).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

const { attributeMock, adoptMock } = vi.hoisted(() => ({ attributeMock: vi.fn(), adoptMock: vi.fn() }))
vi.mock('@/lib/claims', () => ({
  attributeClaimRefund:      attributeMock,
  adoptStripeRefundForClaim: adoptMock,
  STRIPE_REFUND_ID_RE:       /^re_[A-Za-z0-9]{8,}$/,
}))

import { POST as ATTRIBUTE } from '@/app/api/admin/claims/[id]/attribute/route'

const PROMOTED_ADMIN = { id: 'op1', role: 'restaurant', name: 'Founder', email: 'f@x.test' }
const post = (body: unknown) =>
  ATTRIBUTE(new Request('https://app.grubano.com/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never, { params: { id: 'cl1' } })

describe('POST /attribute — the Stripe-anchored shape dispatches to the adoption exit', () => {
  beforeEach(() => { vi.clearAllMocks(); adminMock.mockResolvedValue(PROMOTED_ADMIN) })

  it('{ stripeRefundId } goes to adoptStripeRefundForClaim, never to the row path', async () => {
    adoptMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf_ext', facts: { stripeRefundId: 're_dash12345678' } })
    const res = await post({ stripeRefundId: 're_dash12345678' })
    expect(res.status).toBe(200)
    expect(adoptMock).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'cl1', stripeRefundId: 're_dash12345678', dryRun: false, adminId: 'op1' }))
    expect(attributeMock).not.toHaveBeenCalled()
  })

  it('{ refundRowId } still goes to the row path, never to the adoption exit', async () => {
    attributeMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf9' })
    const res = await post({ refundRowId: 'rf9' })
    expect(res.status).toBe(200)
    expect(attributeMock).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'cl1', refundRowId: 'rf9' }))
    expect(adoptMock).not.toHaveBeenCalled()
  })

  it('dryRun is passed through, and a refusal carries the Stripe facts', async () => {
    adoptMock.mockResolvedValue({ ok: false, status: 400, error: 'autre paiement', facts: { stripeRefundId: 're_dash12345678', stripeStatus: 'succeeded' } })
    const res = await post({ stripeRefundId: 're_dash12345678', dryRun: true })
    expect(res.status).toBe(400)
    expect(adoptMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
    expect(await res.json()).toMatchObject({ error: 'autre paiement', facts: { stripeStatus: 'succeeded' } })
  })

  it('the body cannot carry an amount or an outcome — a malformed id is refused before any call', async () => {
    const res = await post({ stripeRefundId: 'not-a-refund', amountCents: 500 })
    expect(res.status).toBe(400)
    expect(adoptMock).not.toHaveBeenCalled()
    expect(attributeMock).not.toHaveBeenCalled()
  })

  it('still guarded: no admin → 403, nothing called', async () => {
    adminMock.mockResolvedValue(null)
    expect((await post({ stripeRefundId: 're_dash12345678' })).status).toBe(403)
    expect(adoptMock).not.toHaveBeenCalled()
  })
})

// ── CLASS-LEVEL PIN — no shipped file asserts a cash outcome for the CUSTOMER from one row ──
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const FILES = [
  'lib/claims.ts',
  'lib/claim-money-line.ts',
  'components/claims/AdminFinancialVerification.tsx',
  'components/claims/AdminClaimsArbitration.tsx',
]
const FORBIDDEN = [
  /aucun argent (n[’']a atteint|reçu par) le client/i,
  /rien n[’']a (encore )?atteint le client/i,
  /le client n[’']a rien reçu/i,
  /le client a été (remboursé|payé)/i,
  /nothing reached the customer/i,
  /money did NOT reach the customer/i,
]

describe('no shipped money string asserts a CUSTOMER outcome from one row (comments excluded)', () => {
  for (const f of FILES) {
    it(`${f} is clean`, () => {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const re of FORBIDDEN) expect(src, `${f} matches ${re}`).not.toMatch(re)
    })
  }

  it('NEGATIVE CONTROL — the two sentences round 6 found would be caught', () => {
    expect('… a ÉCHOUÉ — aucun argent reçu par le client.').toMatch(FORBIDDEN[0])
    expect('Remboursement ÉCHOUÉ chez Stripe — le client n’a rien reçu').toMatch(FORBIDDEN[2])
    // and the round-5 one, in either apostrophe
    expect('Aucun argent n’a atteint le client').toMatch(FORBIDDEN[0])
    expect("Aucun argent n'a atteint le client").toMatch(FORBIDDEN[0])
  })

  it('NEGATIVE CONTROL — the comment stripper does not hide a string that is NOT in a comment', () => {
    const shipped = "const x = 'aucun argent reçu par le client' // removed in round 6\n"
    expect(stripComments(shipped)).toMatch(FORBIDDEN[0])
  })
})

describe('round-6 source pins — reverting a fix turns this red', () => {
  it('the reconcile handler reads the reason and gives already_parked_or_moved its own message', () => {
    const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')
    expect(src).toContain("result?.reason === 'already_parked_or_moved'")
    expect(src).toContain('Rien n’a été modifié')
  })

  it('the FV console offers the Stripe-id exit on EVERY parked row, not only when local candidates exist', () => {
    const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')
    expect(src).toContain("{r.kind === 'financial_verification' && (\n")
    expect(src).toContain('Lier un remboursement fait depuis le Dashboard Stripe')
    expect(src).toContain('adoptStripe(r.id, true)')   // read-only verify
    expect(src).toContain('adoptStripe(r.id, false)')  // the single write
  })

  it('the arbitration card distinguishes "nothing bound" from "bound but not succeeded" from "bound but not ours"', () => {
    const src = readFileSync('components/claims/AdminClaimsArbitration.tsx', 'utf8')
    expect(src).toContain('r.refund && r.refundNotOurs')
    expect(src).toContain('rien n’a encore abouti sur la ligne liée')
    expect(src).toContain("r.actualRefundedCents === null && !r.refund && (")
  })

  it('the classifier nulls the amount on a disowned binding, from the shared predicate', () => {
    const src = readFileSync('lib/claims.ts', 'utf8')
    expect(src).toContain("import { isResumeMismatch } from '@/lib/claim-money-line'")
    expect(src).toContain("row.status === 'succeeded' && !isResumeMismatch(c.refundError) ? row.amountCents : null")
  })

  it('the claims-gate operator reports residue on the abort path', () => {
    const src = readFileSync('scripts/server/phase2-claims-gate.js', 'utf8')
    expect(src).toMatch(/const fail = async \(step\) => \{\s*if \(residuePrisma\) await reportResidue\(\)/)
  })

  it('check-flags no longer cites the removed transitive rule', () => {
    expect(readFileSync('scripts/check-flags.mjs', 'utf8')).not.toContain('transitivement')
  })
})
