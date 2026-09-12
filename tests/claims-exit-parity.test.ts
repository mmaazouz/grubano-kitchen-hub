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
  moneyStateGuidance, absenceProvenPayableLabel, RECONCILE_MARKER_UNREADABLE_TEXT,
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

describe('J-M29 — approvable (D0): acceptedExits ∋ approve && the server verdict is null', () => {
  it('the queue verdict is the server verdict, and approvable follows D0', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    try {
      const now = new Date()
      const shapes = [
        ...GATE.map(([, s]) => s).filter((s) => s.status === 'approved'),
        shape('v13future', { status: 'approved', refundError: `no_refund_proven:v13: … payable au plus tôt le ${new Date(now.getTime() + 3_600_000).toISOString()} (UTC).` }),
        shape('arb', { status: 'arbitration', arbitrationDecision: null }),
      ]
      db.claim.findMany.mockImplementation(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? shapes : []))
      const queue = await listArbitrationQueue()
      fx.forcedCount = 0
      let approvableCount = 0
      for (const q of queue) {
        const s = shapes.find((x) => x.id === q.id)!
        expect(q.approveRefusal, s.id).toBe(arbitrationRefusal(s, 'approve', now)?.error ?? null)
        const approvable = acceptedExits({ claim: s, now }).includes('approve') && q.approveRefusal === null
        db.claim.findUnique.mockResolvedValue(s)
        const server = await arbitrateClaim({ claimId: s.id, adminId: 'op1', decision: 'approve' })
        // a CAS that loses is the only answer an approvable claim can get here
        expect((server as { error?: string }).error === 'Cette réclamation a déjà été arbitrée.', s.id).toBe(approvable)
        if (approvable) approvableCount++
      }
      expect(approvableCount).toBeGreaterThan(0)
      expect(execMock).not.toHaveBeenCalled()
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
    const attr = src.slice(src.indexOf('export async function attributeClaimRefund'), src.indexOf('export async function attributeClaimRefund') + 4000)
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
    await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf1', adminId: 'op1' })
    expect(db.claim.updateMany).toHaveBeenCalled()
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
