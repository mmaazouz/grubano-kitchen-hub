// tests/claims-t49-round7-routes.test.ts — T-49 round 7: the Stripe-id body shape, and the
// CLASS-level truthfulness pins the round-6 audit asked for.
//
// Round 6 found that the only pin against the recurring "blanket cash claim about the CUSTOMER
// from one ROW's status" was one exact sentence in one file — and a paraphrase of it shipped in
// lib/claims.ts, rendered verbatim to the operator by the arbitration console. These pins cover
// every file that writes or renders an operator-visible money string, on the CLASS of sentence,
// and ignore comments (the audit history quotes the removed sentences on purpose).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
// ROUND-8 AUDIT FIX (P3): core.autocrlf=true on the founder's checkout rewrites line endings — the
// placement pin went red on CRLF alone. Every source read here is normalised.
const readFileSync = (p: string, enc: 'utf8') => readRaw(p, enc).replace(/\r\n/g, '\n')

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

  it('a malformed id is refused before any call', async () => {
    const res = await post({ stripeRefundId: 'not-a-refund' })
    expect(res.status).toBe(400)
    expect(adoptMock).not.toHaveBeenCalled()
    expect(attributeMock).not.toHaveBeenCalled()
  })

  it('the body cannot carry an amount or an outcome — a body with extras is REFUSED outright (400), nothing called', async () => {
    // ROUND-8 AUDIT FIX (P3): the branches were non-strict, so extras were silently stripped. Both
    // branches are strict now: an amount or an outcome in the body is a 400, not a quiet drop.
    const res = await post({ stripeRefundId: 're_dash12345678', amountCents: 500, status: 'succeeded', refundId: 'rf_forged', outcome: 'refunded' })
    expect(res.status).toBe(400)
    expect(adoptMock).not.toHaveBeenCalled()
    expect(attributeMock).not.toHaveBeenCalled()
  })

  it('a body carrying BOTH shapes with dryRun:true is refused — it can never silently write', async () => {
    const res = await post({ stripeRefundId: 're_dash12345678', dryRun: true, refundRowId: 'rf_admin' })
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

// ROUND-7 AUDIT FIX (P1): the pin covered four files and one shape; the approval toasts in
// messages/*.json and lib/claim-approval-toast.ts shipped « de l’argent EST parti » and « aucun
// argent n’est parti » past it, and the stuck-money hatch toasted « client payé hors rail » /
// « Aucun argent n’a bougé » unqualified. The list now covers every file that writes or renders an
// operator-visible money sentence, and the patterns cover the CLASS — an unqualified assertion
// that money did / did not reach the customer, or did / did not move — in both apostrophes and in
// the two languages the code and copy are written in.
const FILES = [
  'lib/claims.ts',
  'lib/claim-money-line.ts',
  'lib/claim-approval-toast.ts',
  // ROUND-9: the shared rule modules write operator-visible messages too.
  'lib/claim-attribution-rules.ts',
  'lib/claim-action-rules.ts',
  'components/claims/AdminFinancialVerification.tsx',
  'components/claims/AdminClaimsArbitration.tsx',
  'messages/fr.json',
  'messages/en.json',
  // ROUND-8: the other three locales carry the same admin and customer money copy.
  'messages/es.json',
  'messages/it.json',
  'messages/ar.json',
]
const FORBIDDEN = [
  /aucun argent (n[’']a atteint|reçu par) le client/i,
  /rien n[’']a (encore )?atteint le client/i,
  /le client n[’']a rien reçu/i,
  /le client a été (remboursé|payé)/i,
  /client payé/i,
  /argent (EST|est|a) (parti|bougé)/,            // « de l’argent EST parti » — the round-7 toast
  /(?<!qu[’']|que )aucun argent n[’']est parti/i, // « aucun argent n’est parti » asserted — not « ne prouve pas qu’aucun … »
  /aucun argent n[’']a bougé\.(?!\s*ici)/i,     // unqualified; « … bougé ici » (this action) is allowed
  /nothing reached the customer/i,
  /money did NOT reach the customer/i,
  /money DID leave/i,
  /no money left/i,
  // ROUND-8: the same assertions in es / it / ar.
  /ha salido dinero|sí ha salido/i,
  /(denaro|soldi) (È|è) partito/,
  /خرج مال/,
]

describe('no shipped money string asserts a CUSTOMER outcome from one row (comments excluded)', () => {
  for (const f of FILES) {
    it(`${f} is clean`, () => {
      const src = stripComments(readFileSync(f, 'utf8'))
      // ROUND-8: report EVERY hit at once, with the matched text — stopping at the first failing
      // pattern hid any second defect in the same file until the next run.
      const hits = FORBIDDEN.flatMap((re) => { const m = src.match(re); return m ? [`${re} → « ${m[0]} »`] : [] })
      expect(hits, f).toEqual([])
    })
  }

  it('NEGATIVE CONTROL — the sentences rounds 6 and 7 found would be caught', () => {
    const caught = (s: string) => FORBIDDEN.some((re) => re.test(s))
    expect(caught('… a ÉCHOUÉ — aucun argent reçu par le client.')).toBe(true)
    expect(caught('Remboursement ÉCHOUÉ chez Stripe — le client n’a rien reçu')).toBe(true)
    expect(caught('Aucun argent n’a atteint le client')).toBe(true)
    expect(caught("Aucun argent n'a atteint le client")).toBe(true)
    // round 7
    expect(caught('de cette commande : de l’argent EST parti, pour un autre montant.')).toBe(true)
    expect(caught('le remboursement a ÉCHOUÉ : aucun argent n\'est parti.')).toBe(true)
    expect(caught('Dossier clôturé : client payé hors rail. Aucun argent n’a bougé ici.')).toBe(true)
    expect(caught('Dossier clôturé sans paiement. Aucun argent n’a bougé.')).toBe(true)
    expect(caught('money DID leave, for a different amount')).toBe(true)
    expect(caught('the refund FAILED: no money left.')).toBe(true)
    // and the qualified form the shipped toast uses is NOT caught: the assertion is about THIS action
    expect(caught('Cette action n’a déplacé aucun argent et n’a rien vérifié chez Stripe.')).toBe(false)
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
    // ROUND-7 AUDIT FIX (P1): the previous pin matched an UNRELATED block (the anchor occurs
    // twice), so re-gating the panel on candidateRefurds — the exact regression that would make
    // the exit unreachable for the population it was built for — stayed green. This pins the
    // PLACEMENT: the gate that opens the « Lier » panel must not mention candidateRefunds.
    const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')
    const panel = src.indexOf('Lier un remboursement fait depuis le Dashboard Stripe')
    expect(panel).toBeGreaterThan(0)
    const before = src.slice(0, panel)
    const gate = before.lastIndexOf("{r.kind === 'financial_verification' &&")
    expect(gate).toBeGreaterThan(0)
    const gateLine = before.slice(gate, before.indexOf('\n', gate))
    expect(gateLine).not.toContain('candidateRefunds')
    expect(gateLine.trim()).toBe("{r.kind === 'financial_verification' && (")
    expect(src).toContain('adoptStripe(r.id, true)')   // read-only verify
    expect(src).toContain('adoptStripe(r.id, false)')  // the single write
  })

  it('NEGATIVE CONTROL — the round-6 regression (panel re-gated on candidates) would be caught', () => {
    const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')
    const regressed = src.replace(
      "{r.kind === 'financial_verification' && (\n              <div className=\"mt-3 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3\">\n                <p className=\"text-[13px] font-semibold text-grubano-ink\">\n                  Lier un remboursement",
      "{r.kind === 'financial_verification' && (r.candidateRefunds?.length ?? 0) > 0 && (\n              <div className=\"mt-3 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3\">\n                <p className=\"text-[13px] font-semibold text-grubano-ink\">\n                  Lier un remboursement",
    )
    expect(regressed).not.toBe(src) // the replacement found the real opening
    const panel = regressed.indexOf('Lier un remboursement fait depuis le Dashboard Stripe')
    const before = regressed.slice(0, panel)
    const gate = before.lastIndexOf("{r.kind === 'financial_verification' &&")
    const gateLine = before.slice(gate, before.indexOf('\n', gate))
    expect(gateLine).toContain('candidateRefunds') // ← the pin above would fail on this
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
