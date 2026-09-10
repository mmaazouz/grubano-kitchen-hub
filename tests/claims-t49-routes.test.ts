// tests/claims-t49-routes.test.ts — T-49 audit fixes
//
// The audit found the only human handles on a parked money case had no tests at all, and that
// the "the queue survives the feature flag" property was pinned inside the library function
// rather than at the route and page a human actually reaches. Dead code is not a control, and an
// untested control is not one either.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

const { reconcileMock, attributeMock, fvMock, rrMock, actionableMock } = vi.hoisted(() => ({
  reconcileMock: vi.fn(), attributeMock: vi.fn(), fvMock: vi.fn(), rrMock: vi.fn(), actionableMock: vi.fn(),
}))
vi.mock('@/lib/claims', () => ({
  reconcileClaimEvidence:            reconcileMock,
  attributeClaimRefund:              attributeMock,
  listFinancialVerificationClaims:   fvMock,
  listReconcileRequiredClaims:       rrMock,
  listActionableRefundClaims:        actionableMock,
}))

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
  fvMock.mockResolvedValue([]); rrMock.mockResolvedValue([]); actionableMock.mockResolvedValue([])
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
    expect(src).toContain("{r.kind !== 'other_unsettled' ? (")
    // and its caption lives WITH it, rather than trailing every card
    expect(src.match(/Lit Stripe et les lignes/g) ?? []).toHaveLength(1)
  })

  it('the money line comes from the tested pure function, not an inline ternary', () => {
    expect(src).toContain("import { moneyLineFor } from '@/lib/claim-money-line'")
    expect(src).toContain('moneyLineFor({ kind: r.kind, refundId: r.refundId, refundError: r.refundError })')
    expect(src).not.toContain('état connu mais NON SOLDÉ')
  })

  it('BOTH handlers pick their tone from the outcome — not just reconcile', () => {
    // Round 4 fixed reconcile() and left attribute() green on a failed refund.
    expect(src).toContain("if (needsAttention) toast.error(text)")
    expect(src).toContain("if (outcome === 'refund_failed') toast.error(text)")
  })

  it('the rail-locked outcome reaches an operator-visible message', () => {
    expect(src).toContain('no_refund_proven_rail_locked')
    expect(src).toMatch(/verrouille cette commande/)
  })

  it('rows the attribution guard will refuse are flagged AND disabled', () => {
    expect(src).toContain('alreadyBoundToAnotherClaim')
    expect(src).toContain('disabled={busyId === r.id || c.alreadyBoundToAnotherClaim}')
  })

  it('a failed load is distinguishable from an empty queue', () => {
    expect(src).toContain('loadError')
    expect(src).toMatch(/ILLISIBLE/)
  })

  it('the banner no longer sorts the third bucket into a category', () => {
    expect(src).toMatch(/ligne par ligne/)
  })
})
