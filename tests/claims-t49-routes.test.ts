// tests/claims-t49-routes.test.ts — T-49 audit fixes
//
// The audit found the only human handles on a parked money case had no tests at all, and that
// the "the queue survives the feature flag" property was pinned inside the library function
// rather than at the route and page a human actually reaches. Dead code is not a control, and an
// untested control is not one either.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
// ROUND-8 AUDIT FIX (P3): core.autocrlf=true on the founder's checkout rewrites line endings — a
// source pin must never go red on CRLF alone.
const readFileSync = (p: string, enc: 'utf8') => readRaw(p, enc).replace(/\r\n/g, '\n')

const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

const { reconcileMock, attributeMock, adoptMock, fvMock, rrMock, actionableMock, unfinalizedMock, unprovenMock, noticesMock } = vi.hoisted(() => ({
  reconcileMock: vi.fn(), attributeMock: vi.fn(), adoptMock: vi.fn(), fvMock: vi.fn(), rrMock: vi.fn(), actionableMock: vi.fn(), unfinalizedMock: vi.fn(),
  unprovenMock: vi.fn(), noticesMock: vi.fn(),
}))
// ROUND 13 (H10, slice W7): the « Avis client non envoyés » list the financial-verification route reads.
vi.mock('@/lib/claim-closure-lists', () => ({ listMissingClaimClosureNotices: noticesMock }))
vi.mock('@/lib/claims', () => ({
  reconcileClaimEvidence:            reconcileMock,
  attributeClaimRefund:              attributeMock,
  // round 7: the Stripe-anchored exit shares the attribute route
  adoptStripeRefundForClaim:         adoptMock,
  STRIPE_REFUND_ID_RE:               /^re_[A-Za-z0-9]{8,}$/,
  listFinancialVerificationClaims:   fvMock,
  listReconcileRequiredClaims:       rrMock,
  listActionableRefundClaims:        actionableMock,
  // round 11: pending Refund rows whose claim moved on, listed on the same ungated payload
  listUnfinalizedClaimRefundRows:    unfinalizedMock,
  // ROUND 13 (H10, slice W7): the E-13 section list, read after the money lists in its own catch.
  listRefundedClaimsWithUnprovenRow: unprovenMock,
  // ROUND 13 (W6, H07): the closure-notice attempt reads the lease at send time.
  isClaimsEnabled:                   closureFlag,
}))
// ROUND 13 (W6, J-C26): the closure sender at the reconcile and attribute send sites.
const { closureMock, closureFlag } = vi.hoisted(() => ({ closureMock: vi.fn(), closureFlag: vi.fn(() => true) }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimClosureEmail: closureMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

import { POST as RECONCILE } from '@/app/api/admin/claims/[id]/reconcile/route'
import { POST as ATTRIBUTE } from '@/app/api/admin/claims/[id]/attribute/route'
import { GET as QUEUE } from '@/app/api/admin/claims/financial-verification/route'

/** Exactly what provision-admin.js produces: primary role untouched, admin granted by row. */
const PROMOTED_ADMIN = { id: 'op1', role: 'restaurant', name: 'Founder', email: 'f@x.test' }

// The two handlers return different payload shapes; this helper only cares about the request.
type RouteHandler = (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const post = (h: RouteHandler, body?: unknown) =>
  h(new Request('https://app.grubano.com/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }) as never, { params: { id: 'cl1' } })

beforeEach(() => {
  vi.clearAllMocks()
  adminMock.mockResolvedValue(PROMOTED_ADMIN)
  reconcileMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 500 })
  attributeMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1' })
  auditMock.mockResolvedValue(undefined)
  fvMock.mockResolvedValue([]); rrMock.mockResolvedValue([]); actionableMock.mockResolvedValue([]); unfinalizedMock.mockResolvedValue([])
  // ROUND 13 (H10, slice W7): both section lists read and empty by default.
  unprovenMock.mockResolvedValue({ items: [], total: 0, scanTruncated: false }); noticesMock.mockResolvedValue({ items: [], total: 0, scanTruncated: false })
  delete process.env.CLAIMS_ENABLED
  delete process.env.CLAIMS_WINDOW_UNTIL
})

describe('POST /reconcile — the evidence exit', () => {
  it('the admin the project actually provisions can reach it', async () => {
    const res = await post(RECONCILE)
    expect(res.status).toBe(200)
    expect(reconcileMock).toHaveBeenCalledWith({ claimId: 'cl1' })
  })

  it('a non-admin is refused and nothing is reconciled', async () => {
    adminMock.mockResolvedValue(null)
    expect((await post(RECONCILE)).status).toBe(403)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('it is NOT gated by CLAIMS_ENABLED — the money question outlives the flag', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    expect((await post(RECONCILE)).status).toBe(200)
  })

  it('every outcome is audited as moving no money, including the inconclusive one', async () => {
    reconcileMock.mockResolvedValue({ ok: true, outcome: 'financial_verification', reason: 'stripe_unreadable', detail: 'x' })
    await post(RECONCILE)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'claim.reconcile_evidence',
      metadata: expect.objectContaining({ moneyMoved: false, outcome: 'financial_verification' }),
    }))
  })

  it('ROUND 13 (C1): a lost compare-and-set (changed_during_read) wrote nothing, so the route writes NO audit for it', async () => {
    reconcileMock.mockResolvedValue({ ok: true, outcome: 'changed_during_read' })
    const res = await post(RECONCILE)
    expect(res.status).toBe(200)
    // W6 (H07): only outcome 'refunded' attempts a closure notice — customerEmail null here.
    expect(await res.json()).toEqual({ result: { ok: true, outcome: 'changed_during_read' }, customerEmail: null })
    expect(auditMock).not.toHaveBeenCalled()
    // NEGATIVE CONTROL: the park that DID write (refund_moved_unattributed) is audited with its ambiguity.
    reconcileMock.mockResolvedValue({ ok: true, outcome: 'financial_verification', reason: 'refund_moved_unattributed', detail: 'x' })
    await post(RECONCILE)
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0].metadata).toMatchObject({ outcome: 'financial_verification', ambiguity: 'refund_moved_unattributed' })
  })

  it('a library refusal is passed through with ITS status, never a 200', async () => {
    reconcileMock.mockResolvedValue({ ok: false, status: 409, error: 'pas en attente' })
    expect((await post(RECONCILE)).status).toBe(409)
  })

  it('a failing audit never undoes a completed reconciliation', async () => {
    auditMock.mockRejectedValue(new Error('audit down'))
    expect((await post(RECONCILE)).status).toBe(200)
  })
})

describe('POST /attribute — the escalation exit out of a permanent park', () => {
  it('requires a refund row id: an empty body is refused before anything happens', async () => {
    expect((await post(ATTRIBUTE, {})).status).toBe(400)
    expect(attributeMock).not.toHaveBeenCalled()
  })

  it('passes the operator identity and the chosen LINK, never an outcome', async () => {
    await post(ATTRIBUTE, { refundRowId: 'rf9', note: 'virement constaté' })
    const arg = attributeMock.mock.calls[0][0]
    expect(arg).toMatchObject({ claimId: 'cl1', refundRowId: 'rf9', adminId: 'op1' })
    // The caller cannot state whether money moved, nor how much.
    expect(Object.keys(arg)).not.toContain('outcome')
    expect(Object.keys(arg)).not.toContain('amountCents')
  })

  it('a non-admin is refused', async () => {
    adminMock.mockResolvedValue(null)
    expect((await post(ATTRIBUTE, { refundRowId: 'rf9' })).status).toBe(403)
    expect(attributeMock).not.toHaveBeenCalled()
  })

  it('a cross-order refund refusal is surfaced as 400, not swallowed', async () => {
    attributeMock.mockResolvedValue({ ok: false, status: 400, error: 'autre commande' })
    expect((await post(ATTRIBUTE, { refundRowId: 'rf9' })).status).toBe(400)
  })
})

// ══ ROUND 13 (slice W6) — J-C26 (H07, H06, R-D3, R-D4): the closure-notice attempts at reconcile and attribute ══════════
describe('J-C26 — reconcile and attribute attempt a closure notice only for refunded, with the evidence their result carries', () => {
  beforeEach(() => {
    closureMock.mockReset().mockResolvedValue({ status: 'sent', kind: 'refunded' })
    closureFlag.mockReset().mockReturnValue(true)
  })

  it('reconcile refunded / stripe_read 1300 → evidence {stripe_read, 1300}; refunded from our row only (ledger) → evidence undefined', async () => {
    reconcileMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 1300, evidence: 'stripe_read' })
    let res = await post(RECONCILE)
    expect(closureMock).toHaveBeenCalledWith({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 1300 }, claimsOpen: true })
    expect((await res.json()).customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    closureMock.mockClear()
    reconcileMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 500 })
    res = await post(RECONCILE)
    expect(res.status).toBe(200)
    expect(closureMock).toHaveBeenCalledWith({ claimId: 'cl1', evidence: undefined, claimsOpen: true })
  })

  it('every other outcome → customerEmail null and the sender never called (NEGATIVE CONTROL: reverted_after_refund, R-D3)', async () => {
    const outcomes: Array<Record<string, unknown>> = [
      { ok: true, outcome: 'reverted_after_refund', refundId: 'rf1' },
      { ok: true, outcome: 'no_refund_proven', payableFrom: '2026-09-12T12:00:00.000Z' },
      { ok: true, outcome: 'no_refund_proven_rail_locked' },
      { ok: true, outcome: 'no_refund_proven_awaiting_finalization', rowIds: ['rf2'] },
      { ok: true, outcome: 'refund_still_standing', refundId: 'rf1', stripeStatus: 'succeeded', amountCents: 500 },
      { ok: true, outcome: 'financial_verification', reason: 'stripe_unreadable', detail: 'x' },
      { ok: true, outcome: 'changed_during_read' },
      { ok: true, outcome: 'refund_failed', refundId: 'rf1' },
      { ok: true, outcome: 'still_pending', refundId: 'rf1' },
    ]
    for (const o of outcomes) {
      reconcileMock.mockResolvedValue(o)
      const res = await post(RECONCILE)
      expect(res.status, String(o.outcome)).toBe(200)
      expect((await res.json()).customerEmail, String(o.outcome)).toBeNull()
    }
    expect(closureMock).not.toHaveBeenCalled()
  })

  it('attribute: row and adoption branches send only for !dryRun ∧ refunded, with the result evidence; previews, refusals, the mirror-written 409 and a lost race send nothing', async () => {
    attributeMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf9', rowStatusBefore: 'pending', evidence: 'stripe_read', amountCents: 460 })
    let res = await post(ATTRIBUTE, { refundRowId: 'rf9' })
    expect(closureMock).toHaveBeenLastCalledWith({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 460 }, claimsOpen: true })
    expect((await res.json()).customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    adoptMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf_m', facts: {}, evidence: 'stripe_read', amountCents: 700 })
    res = await post(ATTRIBUTE, { stripeRefundId: 're_1234567890' })
    expect(closureMock).toHaveBeenLastCalledWith({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 700 }, claimsOpen: true })

    closureMock.mockClear()
    attributeMock.mockResolvedValue({ ok: true, outcome: 'preview', refundId: 'rf9', rowStatusBefore: 'pending', evidence: 'stripe_read', amountCents: 460 })
    res = await post(ATTRIBUTE, { refundRowId: 'rf9', dryRun: true })
    expect((await res.json()).customerEmail).toBeNull()
    adoptMock.mockResolvedValue({ ok: true, outcome: 'preview', facts: {}, wouldWrite: true })
    res = await post(ATTRIBUTE, { stripeRefundId: 're_1234567890', dryRun: true })
    expect((await res.json()).customerEmail).toBeNull()
    attributeMock.mockResolvedValue({ ok: false, status: 409, error: 'refusé' })
    expect((await post(ATTRIBUTE, { refundRowId: 'rf9' })).status).toBe(409)
    adoptMock.mockResolvedValue({ ok: false, status: 409, error: 'La ligne miroir rf_m a été enregistrée, mais la réclamation n’a pas été modifiée.', facts: {}, wrote: true })
    expect((await post(ATTRIBUTE, { stripeRefundId: 're_1234567890' })).status).toBe(409)
    attributeMock.mockResolvedValue({ ok: false, status: 409, error: 'La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez.' })
    expect((await post(ATTRIBUTE, { refundRowId: 'rf9' })).status).toBe(409)
    expect(closureMock).not.toHaveBeenCalled()
  })

  it('a sender rejection → the same HTTP status and body plus customerEmail sender_error; 403 / 400 → not called', async () => {
    closureMock.mockRejectedValue(new Error('boom'))
    reconcileMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 500, evidence: 'stripe_read' })
    const res = await post(RECONCILE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 500, evidence: 'stripe_read' }, customerEmail: { status: 'failed', kind: null, why: 'sender_error' } })
    attributeMock.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf9', rowStatusBefore: 'pending', evidence: 'stripe_read', amountCents: 460 })
    const a = await post(ATTRIBUTE, { refundRowId: 'rf9' })
    expect(a.status).toBe(200)
    expect((await a.json()).customerEmail).toEqual({ status: 'failed', kind: null, why: 'sender_error' })

    closureMock.mockClear()
    adminMock.mockResolvedValueOnce(null)
    expect((await post(RECONCILE)).status).toBe(403)
    expect((await post(ATTRIBUTE, {})).status).toBe(400)
    expect(closureMock).not.toHaveBeenCalled()
  })
})

describe('GET /financial-verification — ungated AT THE ROUTE, not just in the library', () => {
  it('returns the payload with CLAIMS_ENABLED unset', async () => {
    fvMock.mockResolvedValue([{ id: 'a' }])
    const res = await QUEUE()
    expect(res.status).toBe(200)
    expect((await res.json()).counts.total).toBe(1)
  })

  it('…and with CLAIMS_ENABLED explicitly false', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    fvMock.mockResolvedValue([{ id: 'a' }])
    expect((await (await QUEUE()).json()).counts.total).toBe(1)
  })

  it('carries EVERY unsettled money state, not only the parked ones', async () => {
    fvMock.mockResolvedValue([{ id: 'a' }])
    rrMock.mockResolvedValue([{ id: 'b' }])
    actionableMock.mockResolvedValue([{ id: 'c' }, { id: 'a' }]) // 'a' already listed
    const body = await (await QUEUE()).json()
    expect(body.counts.total).toBe(3)             // a, b, c — de-duplicated
    expect(body.otherUnsettled.map((r: { id: string }) => r.id)).toEqual(['c'])
  })

  it('a non-admin gets nothing', async () => {
    adminMock.mockResolvedValue(null)
    expect((await QUEUE()).status).toBe(403)
  })

  it('ROUND 11: pending Refund rows whose claim moved on are carried, ungated, and kept out of the claim total', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    unfinalizedMock.mockResolvedValue([{ refundRowId: 'rf1', orderId: 'o1', amountCents: 500, stripeRefundId: 're_1', claimId: 'cl1', claimStatus: 'refunded' }])
    const body = await (await QUEUE()).json()
    expect(body.unfinalizedRefundRows).toHaveLength(1)
    expect(body.counts.unfinalizedRefundRows).toBe(1)
    expect(body.counts.total).toBe(0)
  })

  // ROUND 13 (J-C30 / I-09, slice W7): the two H10 sections travel on the same ungated payload, outside `total`.
  it('ROUND 13: refundedUnproven and closureNotices are carried with their counts, kept out of total; a list rejection answers 200 with a null count', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    fvMock.mockResolvedValue([{ id: 'a' }])
    unprovenMock.mockResolvedValue({ items: [{ id: 'u1' }], total: 1, scanTruncated: false })
    noticesMock.mockResolvedValue({ items: [{ claimId: 'n1' }, { claimId: 'n2' }], total: 2, scanTruncated: true })
    let res = await QUEUE()
    let body = await res.json()
    expect(body.counts).toEqual({ financialVerification: 1, reconcileRequired: 0, otherUnsettled: 0, unfinalizedRefundRows: 0, total: 1, refundedUnproven: 1, closureNoticesMissing: 2 })
    expect(body.closureNotices).toEqual({ items: [{ claimId: 'n1' }, { claimId: 'n2' }], total: 2, scanTruncated: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    noticesMock.mockRejectedValue(new Error('db down'))
    unprovenMock.mockRejectedValue(new Error('db down'))
    res = await QUEUE()
    expect(res.status).toBe(200)
    body = await res.json()
    expect(body.financialVerification).toEqual([{ id: 'a' }])
    expect(body.closureNotices).toEqual({ error: 'unreadable' })
    expect(body.refundedUnproven).toEqual({ error: 'unreadable' })
    expect(body.counts).toMatchObject({ total: 1, refundedUnproven: null, closureNoticesMissing: null })
    expect(Object.keys(body)).not.toContain('revertedAfterRefund')
    vi.mocked(console.error).mockRestore()
  })
})

// ── SOURCE-LEVEL PINS ────────────────────────────────────────────────────────────
// The audit noted the "survives the flag" property was asserted only where it was easiest.
// These pin it where a human actually arrives.
describe('the page keeps the money queue mounted when the feature flag is off', () => {
  const page = readFileSync('app/[locale]/admin/claims/page.tsx', 'utf8')

  it('the page no longer redirects away when claims are disabled', () => {
    expect(page).not.toMatch(/if \(!isClaimsEnabled\(\)\) redirect/)
  })

  it('the money queue is unconditional; only the arbitration console is gated', () => {
    expect(page).toContain('<AdminFinancialVerification />')
    expect(page).toContain('{claimsOpen && <AdminClaimsArbitration />}')
  })

  it('NEGATIVE CONTROL — the old unconditional redirect would be caught here', () => {
    const oldShape = "if (!isClaimsEnabled()) redirect('/admin/approvals')"
    expect(oldShape).toMatch(/redirect/)      // ← what the page used to do
    expect(page).not.toContain(oldShape)      // ← fixed
  })
})

// ══ ROUND-4 AUDIT FIX — THE COMPONENT FIXES ARE PINNED ══════════════════════════
// The audit found that NONE of the round-4 component fixes was pinned by any test: reverting each
// left the suite green — which is how a fix reported as applied, and never applied, survived a
// whole round. The money-line decision is a tested pure function now (tests/claim-money-line);
// these pin the rest at source level. Crude, but they fail when the code is reverted.
describe('the money queue component keeps its audit fixes', () => {
  const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')

  it('the reconcile button is scoped, not unconditional (the round-3 P1)', () => {
    // ROUND-9: the button appears where the SERVER's reconcile gate admits the claim (payload flag).
    // ROUND 13 (D0 / D5, W3 round-1 fix): on every bucket — the reconcile_required list now carries the gate's verdict,
    // which refuses an unreadable marker instant; the refusal text replaces the control.
    expect(src).toContain('{r.reconcilable === true && (')
    expect(src).toContain('{r.reconcilable !== true && r.reconcileRefusal && (')
    // NEGATIVE CONTROL — an unconditional or bucket-wide control would render where the server answers 409.
    const gateOf = (s: string) => {
      const click = s.indexOf('onClick={() => reconcile(r.id)}')
      const open = s.lastIndexOf('{r', click)
      return s.slice(open, s.indexOf('\n', open)).trim()
    }
    expect(gateOf(src)).toBe('{r.reconcilable === true && (')
    const regressed = src.replace('{r.reconcilable === true && (', "{(r.kind !== 'other_unsettled' || r.reconcilable === true) && (")
    expect(regressed).not.toBe(src)
    expect(gateOf(regressed)).not.toBe('{r.reconcilable === true && (')
    // and its caption lives WITH it, rather than trailing every card
    expect(src.match(/Lit Stripe et les lignes/g) ?? []).toHaveLength(1)
  })

  it('the money line comes from the tested pure function, not an inline ternary', () => {
    // ROUND-12: the same module also carries the card's visibility predicate.
    // ROUND 13 (H10, slice W7): the same module carries the red heading's predicate.
    expect(src).toContain("import { cardMoneyLine, financialVerificationCardVisible, financialVerificationHeadingVisible } from '@/lib/claim-money-line'")
    // ROUND 13 (F15): the card passes the whole row — claim id, bound row reason, reconcile verdict — to the pure helper.
    expect(src).toContain('{cardMoneyLine(r).text}')
    expect(src).not.toContain('état connu mais NON SOLDÉ')
  })

  it('BOTH handlers pick their tone from the outcome — not just reconcile', () => {
    // Round 4 fixed reconcile() and left attribute() green on a failed refund.
    expect(src).toContain("if (needsAttention) toast.error(text)")
    // ROUND 13 (G12 / D8, slice W4): attribution has ONE success outcome ('refunded', an observed commit on Stripe
    // evidence); every refusal is a 409 whose server text the handler renders with the error tone.
    expect(src).toContain("if (!res.ok) { toast.error((body as { error?: string }).error || 'Attribution refusée.'); return }")
    expect(src).toContain("if (result?.outcome !== 'refunded') {")
    // ROUND-5: and neither handler may make a blanket cash claim about the CUSTOMER from one
    // ROW's status — the assertion I added in round 4 and the audit removed in round 5.
    expect(src).not.toContain('Aucun argent n’a atteint le client')
  })

  it('the rail-locked outcome reaches an operator-visible message', () => {
    // ROUND 13 (F14, slice W7): the said map lives in lib/claim-console-copy.ts (reconcileSaid), which the card calls.
    const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8') + readFileSync('lib/claim-console-copy.ts', 'utf8')
    expect(src).toContain('no_refund_proven_rail_locked')
    // ROUND-10: the lock has two causes now; the toast states what holds for both.
    // ROUND 13 (F14): « le moteur refusera tout remboursement » was false for the H1/H2/H5 holds (the engine accepts).
    expect(src).toContain('refus du moteur ou blocage de sûreté, la cause est dans le détail de la réclamation')
    expect(src).not.toMatch(/refusera tout remboursement sur cette commande/)
  })

  it('rows the attribution guard will refuse are flagged AND disabled', () => {
    expect(src).toContain('alreadyBoundToAnotherClaim')
    // ROUND-8: the server applies FIVE row refusals (lib/claim-attribution-rules). The console
    // disables on the server's own verdict, never on a hand-picked subset of flags — the parity test
    // in tests/claims-t49-round9.test.ts holds the two together.
    expect(src).toContain('disabled={busyId === r.id || c.refusal != null}')
  })

  it('a failed load is distinguishable from an empty queue', () => {
    expect(src).toContain('loadError')
    expect(src).toMatch(/ILLISIBLE/)
  })

  it('the banner no longer sorts the third bucket into a category', () => {
    expect(src).toMatch(/ligne par ligne/)
  })
})
