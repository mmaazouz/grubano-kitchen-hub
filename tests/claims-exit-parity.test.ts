// tests/claims-exit-parity.test.ts — T-49 round 13, J-M29 (D0, G1 list flags), B1 / B12 binder reads
//
// A console control is rendered iff the server function behind its route accepts. The payload flags
// come from the SAME pure functions the routes call. This file drives the shipped list functions and
// the shipped server functions on the same fixtures. Rendering the consoles and the unfinalized-row
// payload (I-09) belong to the console slice.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'

const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    // ROUND 13 (C6, H05, slice W4): the attribution binds in a Serializable transaction and records the closure.
    emailDispatch: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }))
const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: vi.fn(async () => ({ id: 'op1', role: 'admin', name: 'Admin', email: 'a@x.test' })) }))

import { POST as RECONCILE_ROUTE } from '@/app/api/admin/claims/[id]/reconcile/route'
import {
  listActionableRefundClaims, listArbitrationQueue, listFinancialVerificationClaims, listReconcileRequiredClaims, reconcileClaimEvidence, arbitrateClaim,
  resolveStuckClaim, attributeClaimRefund, isStuckResolvable as serverStuckResolvable, boundToWhere, FINANCIAL_VERIFICATION, RECONCILE_REQUIRED,
} from '@/lib/claims'
import {
  reconcileRefusal, arbitrationRefusal, acceptedExits, isStuckResolvable as pureStuckResolvable, deriveNoRowOutcome,
  moneyStateGuidance, absenceProvenPayableLabel, RECONCILE_MARKER_UNREADABLE_TEXT, APPROVE_ALREADY_SET,
  type ClaimFacts, type ReapprovalFacts,
} from '@/lib/claim-action-rules'
import { amountLineKind, cardMoneyLine, identityUnreadText, IDENTITY_UNREAD_TEXT, IDENTITY_UNREAD_NO_EXIT_TEXT } from '@/lib/claim-money-line'
import { BINDER_OR } from '@/lib/claims'

const fx: { row: Record<string, unknown> | null; forcedCount: number | null } = { row: null, forcedCount: null }

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [db.claim.findUnique, db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy, db.refund.findMany, db.refund.findUnique, db.refund.findFirst, db.order.findUnique, db.order.findMany, stripeMock.paymentIntents.retrieve, stripeMock.refunds.list, stripeMock.refunds.retrieve]) m.mockReset()
  fx.row = null; fx.forcedCount = null
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.findUnique.mockResolvedValue(null)
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  db.claim.groupBy.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.order.findUnique.mockResolvedValue({ id: 'o1', stripePaymentIntentId: null })
  db.order.findMany.mockResolvedValue([])
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false })
  refundsFlag.mockReturnValue(false)
})

const OLD_MARKER = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
const freshMarker = () => `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${new Date(Date.now() - 60_000).toISOString()} — identité pas encore liée.`
const shape = (id: string, o: Partial<ClaimFacts> & { status: string }) => ({
  id, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: new Date(),
  refundAttempted: false, refundId: null, refundError: null, arbitrationDecision: 'approved', responseDeadlineAt: new Date(0), ...o,
})

// One fixture per G1 admission the arbitration list carries (approved / refunding), and the refused shapes.
const GATE: Array<[string, ReturnType<typeof shape>, boolean]> = [
  ['marker after grace', shape('g1', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER }), true],
  ['marker in grace', shape('g2', { status: 'refunding', refundAttempted: true, refundError: freshMarker() }), false],
  ['legacy stranded', shape('g3', { status: 'refunding', refundAttempted: true }), true],
  ['bound, no error', shape('g4', { status: 'refunding', refundAttempted: true, refundId: 'rf1' }), true],
  ['attempt taken, nothing recorded', shape('g5', { status: 'approved', refundAttempted: true }), true],
  ['(i) v13 proof', shape('g6', { status: 'approved', refundError: 'no_refund_proven:v13: … payable au plus tôt le 2026-09-10T00:00:00.000Z (UTC).' }), true],
  ['(i) legacy proof', shape('g7', { status: 'approved', refundError: 'no_refund_proven: x' }), true],
  ['(i) rail locked', shape('g8', { status: 'approved', refundError: 'no_refund_proven_rail_locked: x' }), true],
  ['(i) awaiting finalization', shape('g9', { status: 'approved', refundError: 'no_refund_proven_rail_locked:awaiting_finalization: x' }), true],
  ['(i-b) safety hold', shape('g10', { status: 'approved', refundAttempted: true, refundError: 'refund_safety_hold: x' }), true],
  ['approved unpaid, no error', shape('g11', { status: 'approved' }), false],
  ['stripe failed, recorded', shape('g12', { status: 'approved', refundAttempted: true, refundId: 'rf1', refundError: 'stripe_failed: x' }), false],
  ['NEGATIVE CONTROL — safety hold with refundId set', shape('g13', { status: 'approved', refundAttempted: true, refundId: 'rf1', refundError: 'refund_safety_hold: x' }), false],
]

describe('J-M29 — reconcilable: the list flag equals the server gate, one fixture per admission', () => {
  it('list flag === reconcileRefusal === the server refused before reading anything', async () => {
    db.claim.findMany.mockResolvedValue(GATE.map(([, s]) => s))
    const listed = await listActionableRefundClaims()
    expect(listed).toHaveLength(GATE.length)
    fx.forcedCount = 0 // every CAS loses: an admitted claim writes nothing either way
    for (const [name, s, expected] of GATE) {
      const l = listed.find((x) => x.id === s.id)!
      expect(l.reconcilable, name).toBe(expected)
      expect(reconcileRefusal(s) === null, name).toBe(expected)
      db.claim.findUnique.mockResolvedValue(s)
      db.refund.findMany.mockClear(); db.refund.findUnique.mockClear(); stripeMock.paymentIntents.retrieve.mockClear()
      const server = await reconcileClaimEvidence({ claimId: s.id })
      // ROUND 13 (B8, slice W2): the gate reads the BOUND row (and nothing else) before it decides — the own-row
      // mismatch is decided on it. A refusal still reads no order row list, no Stripe, and writes nothing.
      const boundOnly = db.refund.findUnique.mock.calls.every((c) => (c[0] as { where: { id: string } }).where.id === s.refundId)
      const refusedBeforeReading = !server.ok && (server as { status?: number }).status === 409
        && db.refund.findMany.mock.calls.length === 0 && boundOnly && stripeMock.paymentIntents.retrieve.mock.calls.length === 0
      expect(refusedBeforeReading, name).toBe(!expected)
      if (expected) expect(server.ok, name).toBe(true)
    }
    expect(execMock).not.toHaveBeenCalled()
  })
})

// W3 round-1 fix (D0 / D14 / D5): the reconcile gate refuses a marker whose instant cannot be read. The
// reconcile_required list keeps such a claim (fail visible) but carries the gate's verdict and text, so the console
// renders the server refusal text and no control; the route answers 409 with that same text.
describe('J-M29 / D5 — reconcile_required list: an unreadable marker instant is listed refused, with the server text', () => {
  const MALFORMED = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10Tzz:00Z — identité pas encore liée.`
  const futureMarker = () => `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${new Date(Date.now() + 3_600_000).toISOString()} — identité pas encore liée.`
  const post = (id: string) => RECONCILE_ROUTE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id } })

  it('malformed and future markers: list flag false with RECONCILE_MARKER_UNREADABLE_TEXT; the route answers 409 with that text, reading and writing nothing', async () => {
    const rows = [
      shape('u1', { status: 'refunding', refundAttempted: true, refundError: MALFORMED }),
      shape('u2', { status: 'approved', refundAttempted: true, refundError: futureMarker() }),
    ]
    db.claim.findMany.mockResolvedValue(rows)
    const listed = await listReconcileRequiredClaims()
    expect(listed.map((l) => l.id).sort()).toEqual(['u1', 'u2'])
    for (const s of rows) {
      const l = listed.find((x) => x.id === s.id)!
      expect(l.reconcilable, s.id).toBe(false)
      expect(l.reconcileRefusal, s.id).toBe(RECONCILE_MARKER_UNREADABLE_TEXT)
      expect(reconcileRefusal(s)?.error, s.id).toBe(l.reconcileRefusal)
      db.claim.findUnique.mockResolvedValue(s)
      const res = await post(s.id)
      expect(res.status, s.id).toBe(409)
      expect((await res.json()).error, s.id).toBe(RECONCILE_MARKER_UNREADABLE_TEXT)
      expect(acceptedExits({ claim: s, now: new Date() }), s.id).toEqual([])
    }
    expect(db.refund.findMany).not.toHaveBeenCalled()
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — an aged marker: list flag true, no refusal text, and the route admits the claim (200)', async () => {
    const s = shape('a1', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    db.claim.findMany.mockResolvedValue([s])
    const [l] = await listReconcileRequiredClaims()
    expect(l.reconcilable).toBe(true)
    expect(l.reconcileRefusal).toBeNull()
    fx.forcedCount = 0 // an admitted claim writes nothing either way
    db.claim.findUnique.mockResolvedValue(s)
    expect((await post('a1')).status).toBe(200)
  })

  it('G1: the financial-verification list carries the gate verdict too (a FV claim is reconcilable)', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'fv1', orderId: 'o1', reason: 'wrong_item', requestedAmountCents: 500, refundId: null, refundError: `${FINANCIAL_VERIFICATION}:stripe_unreadable: x`, createdAt: new Date(), decidedAt: null, restaurantId: 'r1' }])
    const [fv] = await listFinancialVerificationClaims()
    expect(fv.reconcilable).toBe(true)
    expect(reconcileRefusal({ ...fv, status: FINANCIAL_VERIFICATION })).toBeNull()
  })
})

describe('J-M29 — resolvable: the list flag, the resolve-stuck server and the D14 suffix predicate agree', () => {
  it('on every approved / refunding fixture', async () => {
    db.claim.findMany.mockResolvedValue(GATE.map(([, s]) => s))
    const listed = await listActionableRefundClaims()
    fx.forcedCount = 0
    for (const [name, s] of GATE) {
      const l = listed.find((x) => x.id === s.id)!
      expect(l.resolvable, name).toBe(serverStuckResolvable(s))
      // the D14 « Clôturer » sentence reads the pure D11 predicate; on these shapes it names exactly the accepted close
      expect(pureStuckResolvable(s), name).toBe(serverStuckResolvable(s))
      db.claim.findUnique.mockResolvedValue(s)
      const server = await resolveStuckClaim({ claimId: s.id, adminId: 'op1', resolution: 'closed_no_payment' })
      const refusedByPredicate = !server.ok && (server as { error?: string }).error === 'Cette réclamation n’est pas bloquée sur un remboursement — utilisez l’arbitrage.'
      expect(refusedByPredicate, name).toBe(!l.resolvable)
    }
  })
})

// D′ L2 (D1 v1.1): « approvable » = the « Approuver » control is live — a DECISION ('approve' on arbitration / silence-
// expired) or a RATIFICATION ('ratify' on an approved claim whose amount is not fixed). Never a money exit ('pay' is the rail).
const approvableByD0 = (c: ClaimFacts, now: Date) => {
  const exits = acceptedExits({ claim: c, now })
  return (exits.includes('approve') || exits.includes('ratify')) && arbitrationRefusal(c, 'approve', now) === null
}

describe('J-M29 — approvable (D0, v1.1): acceptedExits ∋ approve | ratify && the server verdict is null', () => {
  it('the queue verdict is the server verdict, and approvable follows D0', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    try {
      const now = new Date()
      const shapes = [
        ...GATE.map(([, s]) => s).filter((s) => s.status === 'approved'),
        shape('v13future', { status: 'approved', refundError: `no_refund_proven:v13: … payable au plus tôt le ${new Date(now.getTime() + 3_600_000).toISOString()} (UTC).` }),
        shape('arb', { status: 'arbitration', arbitrationDecision: null }),
        // D′ L2: an approved claim whose amount is fixed is never re-approved (APPROVE_ALREADY_SET) — not approvable
        shape('fixed', { status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500 }),
      ]
      db.claim.findMany.mockImplementation(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? shapes : []))
      const queue = await listArbitrationQueue()
      fx.forcedCount = 0
      let approvableCount = 0
      let ratifiableCount = 0
      for (const q of queue) {
        const s = shapes.find((x) => x.id === q.id)!
        expect(q.approveRefusal, s.id).toBe(arbitrationRefusal(s, 'approve', now)?.error ?? null)
        const approvable = approvableByD0(s, now)
        db.claim.findUnique.mockResolvedValue(s)
        const server = await arbitrateClaim({ claimId: s.id, adminId: 'op1', decision: 'approve' })
        // a CAS that loses is the only answer an approvable claim can get here
        expect((server as { error?: string }).error === 'Cette réclamation a déjà été arbitrée.', s.id).toBe(approvable)
        if (approvable) approvableCount++
        if (approvable && acceptedExits({ claim: s, now }).includes('ratify')) ratifiableCount++
      }
      expect(approvableCount).toBeGreaterThan(0)
      expect(ratifiableCount).toBeGreaterThan(0) // the approved-null shapes are approvable THROUGH ratification only
      expect(queue.find((q) => q.id === 'fixed')!.approveRefusal).toBe(APPROVE_ALREADY_SET)
      expect(execMock).not.toHaveBeenCalled()
      // NEGATIVE CONTROL: the pre-D′ predicate (∋ 'approve' only) would call every ratifiable row NOT approvable, while the
      // server accepts its decision (the CAS is the only thing that refuses it here) — the two sides would disagree.
      const oldPredicate = (c: ClaimFacts) => acceptedExits({ claim: c, now }).includes('approve') && arbitrationRefusal(c, 'approve', now) === null
      const ratifiable = shapes.filter((s) => approvableByD0(s, now) && !oldPredicate(s))
      expect(ratifiable.length).toBe(ratifiableCount)
      expect(ratifiable.every((s) => s.status === 'approved' && s.approvedAmountCents == null)).toBe(true)
      expect(oldPredicate(shapes.find((s) => s.id === 'arb')!)).toBe(true) // 'approve' stays the decision exit of arbitration
    } finally { vi.useRealTimers() }
  })

  it('the financial-verification card never renders « Approuver »', () => {
    expect(stripComments(read('components/claims/AdminFinancialVerification.tsx'))).not.toContain('Approuver')
  })
})

// ══ B1 — one binder where for the server pre-check, the console binding and the no-row derivation ══
describe('B1 (P3-22) — a binding disowned by resume_mismatch binds nothing, on every side', () => {
  const PARKED = { id: 'cl1', orderId: 'o1', reason: 'wrong_item', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: x', createdAt: new Date(), decidedAt: null, restaurantId: 'r1' }
  const ROW_R = { id: 'rf_R', orderId: 'o1', status: 'succeeded', amountCents: 300, stripeRefundId: 're_R', reason: null, createdAt: new Date(), idempotencyKey: 'refund:o1:k' }

  const arrange = (z: { status: string; refundError: string | null }) => {
    const CLAIMS = [{ id: 'cl_Z', refundId: 'rf_R', ...z }]
    db.claim.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      (where.status === FINANCIAL_VERIFICATION ? [PARKED] : CLAIMS.filter((c) => matchWhere(where, c))))
    db.claim.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => CLAIMS.find((c) => matchWhere(where, c)) ?? null)
    db.refund.findMany.mockResolvedValue([ROW_R])
    db.refund.findUnique.mockResolvedValue(ROW_R)
    db.order.findMany.mockResolvedValue([{ id: 'o1', stripePaymentIntentId: 'pi_1' }])
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
    fx.forcedCount = 0
    return CLAIMS
  }
  const derivationNames = (claims: Array<{ id: string; refundId: string; status: string; refundError: string | null }>) => {
    const binders = claims.filter((c) => matchWhere(boundToWhere('rf_R', 'cl1') as Record<string, unknown>, c)).map((c) => ({ ...c, refundId: c.refundId }))
    const facts: ReapprovalFacts = {
      orderId: 'o1', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded', chargeId: 'ch_1',
      chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 300, routed: false, royaltyStatus: null, stripeListLength: 1,
      rows: [{ ...ROW_R, createdAt: new Date() }], L: [{ id: 're_R', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: {} }], truths: {},
      binders: { rf_R: binders }, stampedClaims: {}, succeededNotCounted: [], rowContradictions: [],
    }
    return JSON.stringify(deriveNoRowOutcome({ readable: true, facts }, 'cl1')).includes('cl_Z')
  }

  it('Z resume_mismatch: attribution is not refused bound_to_other_claim, the console binding is empty, the derivation never names Z', async () => {
    const claims = arrange({ status: 'refunded', refundError: 'resume_mismatch: le moteur a repris …' })
    const listed = await listFinancialVerificationClaims()
    const cand = listed[0].candidateRefunds.find((c) => c.id === 'rf_R')!
    expect(cand.alreadyBoundToAnotherClaim).toBe(false)
    expect(cand.refusal).toBeNull()
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_R', adminId: 'op1' })
    expect(JSON.stringify(r)).not.toContain('cl_Z')
    expect(derivationNames(claims)).toBe(false)
  })

  it('NEGATIVE CONTROL — Z with a null error: all three name Z', async () => {
    const claims = arrange({ status: 'refunded', refundError: null })
    const listed = await listFinancialVerificationClaims()
    const cand = listed[0].candidateRefunds.find((c) => c.id === 'rf_R')!
    expect(cand.alreadyBoundToAnotherClaim).toBe(true)
    expect(cand.refusal).toBe('bound_to_other_claim')
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_R', adminId: 'op1' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect((r as { error?: string }).error).toContain('cl_Z')
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(derivationNames(claims)).toBe(true)
  })

  it('the server pre-check and the console bindings read the one binder where (source pins)', () => {
    const src = stripComments(read('lib/claims.ts'))
    // ROUND 13 (C6, slice W4): the pre-check moved with the binding into attributeWithEvidence (attributeClaimRefund delegates to it).
    const attr = src.slice(src.indexOf('export async function attributeWithEvidence('), src.indexOf('export async function attributeClaimRefund('))
    expect(attr).toContain('where:  boundToWhere(row.id, claim.id),')
    const fv = src.slice(src.indexOf('export async function listFinancialVerificationClaims'), src.indexOf('export async function listReconcileRequiredClaims'))
    expect(fv).toContain('where:  { refundId: { in: rows.map((r) => r.id) }, OR: BINDER_OR },')
  })
})

// ══ B12 — a failed identity read is never a negative identity ═══════════════════════════════════════
describe('B12 — attribution: a failed binder or stamp read refuses before any write', () => {
  const ROW = { id: 'rf1', orderId: 'o1', status: 'succeeded', amountCents: 300, stripeRefundId: 're_1', reason: null }
  const TEXT = 'La base n’a pas pu être lue : l’identité du remboursement n’est pas établie et rien n’a été modifié. Réessayez.'

  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
    db.refund.findUnique.mockResolvedValue(ROW)
  })

  it('the binder read rejects → 409 with the B12 text, no claim write, never bound_to_other_claim', async () => {
    db.claim.findFirst.mockRejectedValue(new Error('db down'))
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf1', adminId: 'op1' })).toEqual({ ok: false, status: 409, error: TEXT })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('the order-rows (stamps) read rejects → the same', async () => {
    db.refund.findMany.mockRejectedValue(new Error('db down'))
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf1', adminId: 'op1' })).toEqual({ ok: false, status: 409, error: TEXT })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('the candidate row read (it carries the stamp) rejects → the same 409, no binder read, no write (round-1 fix)', async () => {
    db.refund.findUnique.mockRejectedValue(new Error('db down'))
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf1', adminId: 'op1' })).toEqual({ ok: false, status: 409, error: TEXT })
    expect(db.claim.findFirst).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — with readable identity the same row proceeds past the pre-check (a write is attempted)', async () => {
    fx.forcedCount = 0
    // ROUND 13 (G12 / C6, slice W4): past the pre-check, Stripe proves the row, then the binding transaction writes.
    db.order.findUnique.mockResolvedValue({ id: 'o1', stripePaymentIntentId: 'pi_1' })
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 300, payment_intent: 'pi_1', metadata: {} })
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf1', adminId: 'op1' })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_1')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.claim.updateMany).toHaveBeenCalled()
    vi.mocked(console.warn).mockRestore()
  })
})

// ══ C9 / D4 (W2 round-1 fix) — an approved legacy proof is re-derived and written by N8, a CAS on the claim as read ══
describe('C9 / D4 — G1 (i) admits approved proofs: N8 re-derives them on the loader and its write CASes on the pre-image', () => {
  const LEGACY = 'no_refund_proven: aucun remboursement n’a été créé …'
  const PROOF = shape('lp1', { status: 'approved', refundError: LEGACY })

  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue(PROOF)
    db.order.findUnique.mockResolvedValue({ id: 'o1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
    db.refund.findMany.mockResolvedValue([])
    db.franchiseRoyalty.findFirst.mockResolvedValue(null)
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', transfer_data: null, latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, disputed: false } })
  })

  it('a T1 that moved the claim to refunding between the read and the write → nothing written, changed_during_read (C1)', async () => {
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-12T08:00:00.000Z — identité pas encore liée.` }
    const r = await reconcileClaimEvidence({ claimId: 'lp1' })
    expect(r).toEqual({ ok: true, outcome: 'changed_during_read' })
    const proofWrites = db.claim.updateMany.mock.calls.filter((c) => c[0]?.data?.refundAttempted === false)
    expect(proofWrites).toHaveLength(1)
    expect(proofWrites[0][0].where).toEqual({ id: 'lp1', status: 'approved', refundAttempted: false, refundId: null, refundError: LEGACY })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the claim unchanged since the read → a v13 proof is written (never the legacy text again) and reported with its instant', async () => {
    fx.row = { status: 'approved', refundAttempted: false, refundId: null, refundError: LEGACY }
    const r = await reconcileClaimEvidence({ claimId: 'lp1' })
    expect(r).toMatchObject({ ok: true, outcome: 'no_refund_proven' })
    expect(typeof (r as { payableFrom?: string }).payableFrom).toBe('string')
    const written = db.claim.updateMany.mock.calls.filter((c) => c[0]?.data?.refundAttempted === false)
    expect(written).toHaveLength(1)
    expect(String(written[0][0].data.refundError).startsWith('no_refund_proven:v13: ')).toBe(true)
  })
})

// ══ D2 (1)(b) — an approval already BOUND to a row is not re-driven by « Approuver » ══════════════════
describe('D2 (1)(b) — approved, not attempted, refundId SET, null error: approve refused before any write; exits [reconcile]', () => {
  it('decided and undecided variants are refused with the existing texts, and neither reaches the CAS or the engine', async () => {
    const decided = shape('b1', { status: 'approved', refundId: 'rf1' })
    const undecided = shape('b2', { status: 'approved', refundId: 'rf1', arbitrationDecision: null })
    for (const s of [decided, undecided]) {
      db.claim.findUnique.mockResolvedValue(s)
      expect(await arbitrateClaim({ claimId: s.id, adminId: 'op1', decision: 'approve' }), s.id).toMatchObject({ ok: false, status: 409 })
      expect(acceptedExits({ claim: s, now: new Date() }), s.id).toEqual(['reconcile'])
    }
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(arbitrationRefusal(decided, 'approve', new Date())?.error).toBe('Cette réclamation a déjà été arbitrée — décision définitive.')
    expect(arbitrationRefusal(undecided, 'approve', new Date())?.error).toBe('Cette réclamation n’est pas en arbitrage.')
  })

  it('NEGATIVE CONTROL — the same claim UNBOUND is approvable, and the legacy CAS itself requires refundId null', async () => {
    const s = shape('b3', { status: 'approved' })
    db.claim.findUnique.mockResolvedValue(s)
    fx.forcedCount = 0
    const r = await arbitrateClaim({ claimId: s.id, adminId: 'op1', decision: 'approve' })
    expect((r as { error?: string }).error).toBe('Cette réclamation a déjà été arbitrée.')
    // ROUND 13 (D2 (1)(b)/(c), slice W2): the legacy CAS also carries the refundError the refusal read.
    expect(db.claim.updateMany.mock.calls[0][0].where).toEqual({ id: 'b3', status: 'approved', refundAttempted: false, refundId: null, refundError: null })
  })
})

// ══ F15 (A-S24-1) — a reversal marker pays nothing ═════════════════════════════════════════════════════
describe('F15 (A-S24-1) — STRIPE_REVERTED / REVERTED_AFTER_REFUND on a succeeded row: no « Montant réellement remboursé »', () => {
  const ROW = { id: 'rf1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1', createdAt: new Date(), reason: null }

  it('actualRefundedCents is null, the arbitration amount line is « reverted », the card line bound_reverted', async () => {
    db.claim.findMany.mockResolvedValue([
      shape('c_rev', { status: 'approved', refundAttempted: true, refundId: 'rf1', refundError: 'stripe_reverted: la ligne rf1 est marquée ABOUTIE dans notre base …' }),
      shape('c_rev2', { status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: 'stripe_reverted_after_refund: la réclamation a été soldée …' }),
    ])
    db.refund.findMany.mockResolvedValue([ROW])
    const listed = await listActionableRefundClaims()
    expect(listed).toHaveLength(2)
    for (const l of listed) {
      expect(l.actualRefundedCents, l.id).toBeNull()
      expect(amountLineKind(l), l.id).toBe('reverted')
      expect(cardMoneyLine({ ...l, kind: 'other_unsettled' }).certainty, l.id).toBe('bound_reverted')
    }
  })

  it('NEGATIVE CONTROL — the same succeeded row with a null error prints its amount', async () => {
    db.claim.findMany.mockResolvedValue([shape('c_ok', { status: 'approved', refundAttempted: true, refundId: 'rf1' })])
    db.refund.findMany.mockResolvedValue([ROW])
    const [l] = await listActionableRefundClaims()
    expect(l.actualRefundedCents).toBe(500)
    expect(amountLineKind(l)).toBe('amount')
  })
})

// ══ D0 / F16 (7) — a rendered text naming « Réconcilier » sits on a row the server lets reconcile ═══════
describe('D0 / F16 (7) — names « Réconcilier d’après la preuve » ⇒ reconcilable (or refused only for the marker grace)', () => {
  const OWN = { id: 'rf_own', status: 'succeeded', amountCents: 500, stripeRefundId: 're_own', createdAt: new Date(), reason: 'claim:m_own' }
  const OTHER = { id: 'rf_oth', status: 'succeeded', amountCents: 500, stripeRefundId: 're_oth', createdAt: new Date(), reason: 'claim:someone_else' }
  const PENDING_RF1 = { id: 'rf1', status: 'pending', amountCents: 500, stripeRefundId: null, createdAt: new Date(), reason: null }
  // W3 round-2 fix (D0 / D5): markers whose start instant cannot be read — malformed, or in the future — on both
  // statuses the arbitration list carries. The gate refuses them with RECONCILE_MARKER_UNREADABLE_TEXT, not the grace.
  const MALFORMED_MARKER = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10Tzz:00Z — identité pas encore liée.`
  const futureMarker = () => `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${new Date(Date.now() + 3_600_000).toISOString()} — identité pas encore liée.`
  const UNREADABLE = () => [
    shape('um_ref', { status: 'refunding', refundAttempted: true, refundError: MALFORMED_MARKER }),
    shape('um_app', { status: 'approved', refundAttempted: true, refundError: MALFORMED_MARKER }),
    shape('uf_ref', { status: 'refunding', refundAttempted: true, refundError: futureMarker() }),
    shape('uf_app', { status: 'approved', refundAttempted: true, refundError: futureMarker() }),
  ]
  const UNREADABLE_IDS = ['uf_app', 'uf_ref', 'um_app', 'um_ref']
  const FIXTURES = () => [
    ...GATE.map(([, s]) => s),
    shape('m_own', { status: 'refunding', refundAttempted: true, refundId: 'rf_own', refundError: 'resume_mismatch: le moteur a repris un remboursement antérieur …' }),
    shape('m_oth', { status: 'refunding', refundAttempted: true, refundId: 'rf_oth', refundError: 'resume_mismatch: le moteur a abouti sur un remboursement …' }),
    ...UNREADABLE(),
  ]
  type Listed = Awaited<ReturnType<typeof listActionableRefundClaims>>[number]
  const renderedTexts = (l: Listed, idText: (r: boolean | undefined) => string) => [
    moneyStateGuidance(l.moneyState),
    l.moneyState === 'absence_proven_payable' ? absenceProvenPayableLabel(l.refundError) : '',
    amountLineKind(l) === 'identity_unread' ? idText(l.reconcilable) : '',
    cardMoneyLine({ ...l, kind: 'other_unsettled' }).text,
  ]
  const violations = (listed: Listed[], idText: (r: boolean | undefined) => string = identityUnreadText) => listed.filter((l) => {
    const names = renderedTexts(l, idText).some((t) => t.includes('Réconcilier'))
    const graceOnly = reconcileRefusal(l)?.error.includes('moins de 5 minutes') === true
    return names && l.reconcilable !== true && !graceOnly
  }).map((l) => l.id)
  const arrange = async () => {
    db.claim.findMany.mockResolvedValue(FIXTURES())
    db.refund.findMany.mockResolvedValue([OWN, OTHER, PENDING_RF1])
    return listActionableRefundClaims()
  }

  it('no listed row names reconcile while the server refuses it — the own-row resume_mismatch is now reconcilable (B8, slice W2: the list reads the bound row)', async () => {
    const listed = await arrange()
    const own = listed.find((l) => l.id === 'm_own')!
    expect(own.refundIdentityUnread).toBe(true)
    expect(own.reconcilable).toBe(true)
    expect(own.resolvable).toBe(false)
    expect(listed.find((l) => l.id === 'm_oth')!).toMatchObject({ reconcilable: false, resolvable: true })
    expect(violations(listed)).toEqual([])
  })

  it('NEGATIVE CONTROL — the round-1 defect (A-S36-1 sentence whatever the verdict) is caught on the own-row resume_mismatch when the verdict is a refusal', async () => {
    const listed = (await arrange()).map((l) => (l.id === 'm_own' ? { ...l, reconcilable: false } : l))
    expect(violations(listed, () => IDENTITY_UNREAD_TEXT)).toEqual(['m_own'])
    expect(violations(listed)).toEqual([])
  })

  it('W3 round-2 fix — an unreadable marker instant (malformed or future, approved or refunding): reconcile_marker_unreadable, no exit, its guidance is the server refusal and names no control', async () => {
    const listed = await arrange()
    const now = new Date()
    for (const s of UNREADABLE()) {
      const l = listed.find((x) => x.id === s.id)!
      expect(l.moneyState, s.id).toBe('reconcile_marker_unreadable')
      expect(l.reconcilable, s.id).toBe(false)
      expect(l.resolvable, s.id).toBe(false)
      expect(reconcileRefusal(l)?.error, s.id).toBe(RECONCILE_MARKER_UNREADABLE_TEXT)
      expect(acceptedExits({ claim: s, now }), s.id).toEqual([])
      const g = moneyStateGuidance(l.moneyState)
      expect(g, s.id).toContain(RECONCILE_MARKER_UNREADABLE_TEXT)
      expect(g, s.id).not.toContain('Réconcilier')
      expect(g, s.id).not.toBe(moneyStateGuidance('__unknown__'))
    }
    // the marker past its grace keeps reconcile_required and its control
    expect(listed.find((l) => l.id === 'g1')!).toMatchObject({ moneyState: 'reconcile_required', reconcilable: true })
    expect(violations(listed)).toEqual([])
  })

  it('NEGATIVE CONTROL — the round-1 mapping (every marker → reconcile_required) names reconcile on exactly the unreadable-marker rows (break/restore)', async () => {
    const listed = (await arrange()).map((l) => (UNREADABLE_IDS.includes(l.id) ? { ...l, moneyState: 'reconcile_required' as const } : l))
    expect(violations(listed).sort()).toEqual(UNREADABLE_IDS)
  })

  it('F15 card line: the own row → identity_unread naming reconcile only when the server admits it; another claim’s row → bound_but_not_ours; a payload without the reason → INDÉTERMINÉ', async () => {
    const listed = await arrange()
    const own = listed.find((l) => l.id === 'm_own')!
    const oth = listed.find((l) => l.id === 'm_oth')!
    expect(cardMoneyLine({ ...own, kind: 'other_unsettled', reconcilable: false })).toEqual({ certainty: 'identity_unread', text: IDENTITY_UNREAD_NO_EXIT_TEXT })
    expect(cardMoneyLine({ ...own, kind: 'other_unsettled' }).text).toBe(IDENTITY_UNREAD_TEXT)
    expect(cardMoneyLine({ ...oth, kind: 'other_unsettled' }).certainty).toBe('bound_but_not_ours')
    expect(cardMoneyLine({ ...oth, kind: 'other_unsettled', refund: { reason: undefined } }).certainty).toBe('unknown')
    expect(stripComments(read('components/claims/AdminFinancialVerification.tsx'))).toContain('{cardMoneyLine(r).text}')
  })
})

// ══ tests/support/prisma-where — the emulation the binder where relies on ═══════════════════════════════
describe('prisma-where — SQL NULL under NOT, undefined is no filter', () => {
  it('NOT { f: scalar } on a NULL column is UNKNOWN (no match); on another value it matches', () => {
    expect(matchWhere({ NOT: { refundError: 'x' } }, { refundError: null })).toBe(false)
    expect(matchWhere({ NOT: { refundError: 'x' } }, { refundError: 'y' })).toBe(true)
    expect(matchWhere({ NOT: { refundError: 'x' } }, { refundError: 'x' })).toBe(false)
  })

  it('NOT { f: null } is IS NOT NULL — never UNKNOWN', () => {
    expect(matchWhere({ NOT: { refundError: null } }, { refundError: null })).toBe(false)
    expect(matchWhere({ NOT: { refundError: null } }, { refundError: 'x' })).toBe(true)
  })

  it('a field set to undefined filters nothing (Prisma semantics)', () => {
    expect(matchWhere({ status: 'approved', refundAttempted: undefined }, { status: 'approved', refundAttempted: true })).toBe(true)
  })

  it('NEGATIVE CONTROL — the binder where still needs its explicit null branch', () => {
    expect(matchWhere({ OR: [{ NOT: { refundError: { startsWith: 'resume_mismatch' } } }] }, { refundError: null })).toBe(false)
    expect(matchWhere({ OR: BINDER_OR as unknown as Record<string, unknown>[] }, { refundError: null })).toBe(true)
  })
})

// ══ ROUND 13 (slice W7) — J-M29 console half: one fixture per D1 row, rendered from the list payload ═══════════════════════
// The shipped list builders run over the fixtures; the payload is assembled as GET /api/admin/claims/financial-verification
// assembles it; the card is rendered from it (react-dom/server). A control is rendered iff its flag, and each flag equals the
// D1 exit set computed on the same facts (the bound row as the list read it).
describe('J-M29 (W7) — the rendered card equals the server verdicts, one fixture per D1 row', () => {
  const OLD = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
  const FRESH = () => `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${new Date(Date.now() - 60_000).toISOString()} — identité pas encore liée.`
  const C = (id: string, o: Record<string, unknown>) => ({ ...shape(id, { status: 'approved', ...o }), decidedAt: null })
  const R = (id: string, o: Record<string, unknown> = {}) => ({ id, orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: `re_${id}`, createdAt: new Date(Date.now() - 3_600_000), reason: null, ...o })
  const D1 = () => [
    C('d1_null', {}),
    C('d2_v13', { refundError: `no_refund_proven:v13: … payable au plus tôt le ${new Date(Date.now() + 3_600_000).toISOString()} (UTC).` }),
    C('d3_legacy', { refundError: 'no_refund_proven: x' }),
    C('d4_rail', { refundError: 'no_refund_proven_rail_locked: x' }),
    C('d5_hold', { refundAttempted: true, refundError: 'refund_safety_hold: x' }),
    C('d6_failed', { refundAttempted: true, refundId: 'rf6', refundError: 'stripe_failed: x' }),
    C('d7_mismatch_other', { status: 'refunding', refundAttempted: true, refundId: 'rf7', refundError: 'resume_mismatch: x' }),
    C('d8_mismatch_own', { status: 'refunding', refundAttempted: true, refundId: 'rf8', refundError: 'resume_mismatch: y' }),
    C('d9_grace', { status: 'refunding', refundAttempted: true, refundError: FRESH() }),
    C('d9_aged', { status: 'refunding', refundAttempted: true, refundError: OLD }),
    C('d10_fv', { status: FINANCIAL_VERIFICATION, refundError: `${FINANCIAL_VERIFICATION}:refund_moved_unattributed: x` }),
    C('d11_failed', { status: 'refunded', refundAttempted: true, refundId: 'rf11f' }),
    C('d11_pending', { status: 'refunded', refundAttempted: true, refundId: 'rf11p' }),
    C('d11_succeeded', { status: 'refunded', refundAttempted: true, refundId: 'rf11s' }),
    C('d12_reverted', { status: 'refunded', refundAttempted: true, refundId: 'rf12', refundError: 'stripe_reverted_after_refund: x' }),
    C('d13_terminal', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }),
    C('neg_hold_bound', { refundAttempted: true, refundId: 'rf_h', refundError: 'refund_safety_hold: x' }),
  ]
  const ROWS = () => [
    R('rf6', { status: 'failed' }), R('rf7', { reason: 'claim:someone_else' }), R('rf8', { reason: 'claim:d8_mismatch_own' }),
    R('rf10', {}), R('rf11f', { status: 'failed' }), R('rf11p', { status: 'pending' }), R('rf11s'), R('rf12'), R('rf_h'),
  ]
  const arrange = () => {
    const claims = D1()
    const rows = ROWS()
    db.claim.findMany.mockImplementation(async (args?: { where?: Record<string, unknown> }) => claims.filter((c) => matchWhere(args?.where ?? {}, c)).map((c) => ({ ...c })))
    db.refund.findMany.mockImplementation(async (args?: { where?: Record<string, unknown> }) => rows.filter((r) => matchWhere(args?.where ?? {}, r)).map((r) => ({ ...r })))
    db.order.findMany.mockResolvedValue([{ id: 'o1', stripePaymentIntentId: 'pi_1' }])
    return { claims, rows }
  }
  const payloadOf = async () => {
    const [financialVerification, reconcileRequired, actionable, unfinalizedRefundRows] = await Promise.all([
      listFinancialVerificationClaims(), listReconcileRequiredClaims(), listActionableRefundClaims(), listUnfinalizedClaimRefundRows(),
    ])
    const marked = new Set([...financialVerification, ...reconcileRequired].map((c) => c.id))
    const otherUnsettled = actionable.filter((c) => !marked.has(c.id))
    return { financialVerification, reconcileRequired, otherUnsettled, unfinalizedRefundRows, counts: { financialVerification: 0, reconcileRequired: 0, otherUnsettled: 0, total: 0 } }
  }
  const renderCard = (payload: unknown) => {
    ;(globalThis as { React?: unknown }).React = React
    const h = React.createElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => React.ReactElement
    const html = renderToStaticMarkup(h(NextIntlClientProvider, { locale: 'fr', messages: {}, timeZone: 'UTC' },
      h(ToastProvider, null, h(AdminFinancialVerification, { initialData: payload }))))
    return Array.from(html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)).map((m) => ({ label: m[2].replace(/<[^>]+>/g, '').trim(), disabled: /\sdisabled=""/.test(m[1]) }))
  }

  it('listUnfinalizedClaimRefundRows carries { rowId, claimId, claimStatus, refundError, orderId, rowReason, reconcilable }', async () => {
    arrange()
    const [u] = await listUnfinalizedClaimRefundRows()
    expect(u).toMatchObject({ rowId: 'rf11p', claimId: 'd11_pending', claimStatus: 'refunded', refundError: null, orderId: 'o1', rowReason: null, reconcilable: true })
    expect(u.refundRowId).toBe(u.rowId)
  })

  it('every listed flag equals the D1 exit set on the same facts; each D1 row is placed as the registry says', async () => {
    const { rows } = arrange()
    const p = await payloadOf()
    const now = new Date()
    const listed = [...p.otherUnsettled, ...p.reconcileRequired, ...p.financialVerification] as Array<Record<string, unknown> & { id: string }>
    for (const l of listed) {
      const row = rows.find((r) => r.id === l.refundId) ?? null
      const exits = acceptedExits({ claim: { ...(l as unknown as ClaimFacts), status: String(l.status ?? FINANCIAL_VERIFICATION) }, boundRow: l.refundId ? (row ? { id: row.id, orderId: row.orderId, status: row.status, stripeRefundId: row.stripeRefundId, reason: row.reason } : null) : null, now })
      expect(l.reconcilable, `${l.id} reconcilable`).toBe(exits.includes('reconcile'))
      if ('resolvable' in l) expect(l.resolvable, `${l.id} resolvable`).toBe(exits.includes('stuck_close'))
      // D′ L2 (D1 v1.1): approvable through a decision OR a ratification; 'approve' never appears on an approved row.
      expect(l.approvable, `${l.id} approvable`).toBe((exits.includes('approve') || exits.includes('ratify')) && arbitrationRefusal({ ...(l as unknown as ClaimFacts), status: String(l.status ?? FINANCIAL_VERIFICATION) }, 'approve', now) === null)
      if (l.status === 'approved') expect(exits, `${l.id} never 'approve'`).not.toContain('approve')
    }
    // NEGATIVE CONTROL: d1_null (approved, null error, amount not fixed) is approvable THROUGH 'ratify' — the pre-D′ flag
    // (∋ 'approve' only) would read it as not approvable while the list says it is.
    const d1 = listed.find((l) => l.id === 'd1_null')!
    expect(d1.approvable).toBe(true)
    expect(acceptedExits({ claim: d1 as unknown as ClaimFacts, now })).toEqual(['ratify'])
    const at = (id: string) => (p.reconcileRequired.some((c) => c.id === id) ? 'reconcileRequired' : p.financialVerification.some((c) => c.id === id) ? 'financialVerification' : p.otherUnsettled.some((c) => c.id === id) ? 'otherUnsettled' : p.unfinalizedRefundRows.some((u) => u.claimId === id) ? 'unfinalized' : 'nowhere')
    expect(Object.fromEntries(D1().map((c) => [c.id, at(c.id)]))).toEqual({
      d1_null: 'otherUnsettled', d2_v13: 'otherUnsettled', d3_legacy: 'otherUnsettled', d4_rail: 'otherUnsettled', d5_hold: 'otherUnsettled', d6_failed: 'otherUnsettled',
      d7_mismatch_other: 'otherUnsettled', d8_mismatch_own: 'otherUnsettled', d9_grace: 'otherUnsettled', d9_aged: 'reconcileRequired', d10_fv: 'financialVerification',
      d11_failed: 'otherUnsettled', d11_pending: 'unfinalized', d11_succeeded: 'nowhere', d12_reverted: 'otherUnsettled', d13_terminal: 'nowhere', neg_hold_bound: 'otherUnsettled',
    })
  })

  it('the rendered controls equal the flags: « Réconcilier » = reconcilable rows + unfinalized rows; « Clôturer » = resolvable; « Attribuer » enabled = pre-check null; never « Approuver »', async () => {
    arrange()
    const p = await payloadOf()
    const buttons = renderCard(p)
    const claimsListed = [...p.reconcileRequired, ...p.financialVerification, ...p.otherUnsettled] as Array<{ reconcilable?: boolean; resolvable?: boolean; candidateRefunds?: Array<{ refusal: string | null }> }>
    const count = (label: string, disabled?: boolean) => buttons.filter((b) => b.label === label && (disabled === undefined || b.disabled === disabled)).length
    expect(count('Réconcilier d’après la preuve')).toBe(claimsListed.filter((c) => c.reconcilable === true).length + p.unfinalizedRefundRows.filter((u) => u.reconcilable).length)
    expect(count('Clôturer ce dossier…')).toBe(p.otherUnsettled.filter((c) => c.resolvable === true).length)
    const candidates = claimsListed.flatMap((c) => c.candidateRefunds ?? [])
    expect(count('Attribuer', false)).toBe(candidates.filter((x) => x.refusal === null).length)
    expect(count('Attribuer', true)).toBe(candidates.filter((x) => x.refusal !== null).length)
    expect(buttons.some((b) => b.label.includes('Approuver'))).toBe(false)
    expect(buttons.filter((b) => b.label === 'Réconcilier d’après la preuve' && b.disabled)).toEqual([])
  })

  it('NEGATIVE CONTROL — approved + SAFETY_HOLD with refundId set → reconcilable false and no reconcile control; BREAK/RESTORE witness: `status !== refunded` as the flag breaks A-S31c', async () => {
    const { rows } = arrange()
    const p = await payloadOf()
    const neg = p.otherUnsettled.find((c) => c.id === 'neg_hold_bound')!
    expect(neg.reconcilable).toBe(false)
    const now = new Date()
    const mutant = (l: { status: string }) => l.status !== 'refunded'
    const mismatches = p.otherUnsettled.filter((l) => {
      const row = rows.find((r) => r.id === l.refundId) ?? null
      const exits = acceptedExits({ claim: l as unknown as ClaimFacts, boundRow: l.refundId ? (row ? { id: row.id, orderId: row.orderId, status: row.status, stripeRefundId: row.stripeRefundId, reason: row.reason } : null) : null, now })
      return mutant(l as { status: string }) !== exits.includes('reconcile')
    }).map((l) => l.id)
    expect(mismatches).toContain('d11_failed')
  })
})

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ToastProvider } from '@/components/design-system'
import AdminFinancialVerification from '@/components/claims/AdminFinancialVerification'
import { listUnfinalizedClaimRefundRows } from '@/lib/claims'
