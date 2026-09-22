// tests/claims-t49-round10.test.ts — T-49, round-10 fixes for the round-9 adversarial audit
//
// Round 9 ran to completion on 7c459eb: P0 0, P1 9. Four of the P1s were ONE absorbing state that
// round 9 itself introduced (our pending row with no Stripe id: no write, no Stripe read, no exit).
// The rest were the same classes again — a console control the server refuses (Class 3), copy that
// promises a mechanism the code does not reliably run (Class 1) — plus the status and delay copy a
// CUSTOMER reads. So the method changed instead of patching a tenth time:
//   • one shared rule per human action (lib/claim-action-rules), with PARITY tests below;
//   • an EXIT TABLE over every claim state: each has an action the server accepts, or a named path;
//   • evidence for every pending row: Stripe's refunds, by the engine's own tag or recorded id.
// Everything runs against the SHIPPED code with the operator-aware CAS mock.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'
// ROUND 13 (slice W7, J-C17): F14 / G10 / A-S29-3 values are read out of the frozen specification.
import { specSection } from './support/spec-copy'

/** CRLF-safe: the founder's checkout has core.autocrlf=true. */
const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')
/** Negative pins read CODE only: comments quote removed sentences on purpose (the audit record). */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const WINDOW = 20 * 60 * 60 * 1000

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

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { cronMock } = vi.hoisted(() => ({ cronMock: vi.fn() }))
vi.mock('@/lib/safe-compare', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isInternalCronRequest: cronMock,
}))

import {
  reconcileClaimEvidence, listActionableRefundClaims, listArbitrationQueue, arbitrateClaim, triggerClaimRefund,
  listConsumerClaims, isStuckResolvable, isRailLocked, isReconcileRequired, claimRefundReason,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, NO_REFUND_PROVEN, NO_REFUND_PROVEN_RAIL_LOCKED, ENGINE_ROW_DEAD,
  ENGINE_DEAD_MARGIN_MS, TERMINAL_STATUSES,
} from '@/lib/claims'
import {
  MARKERS, TERMINAL, reconcileRefusal, arbitrationRefusal, customerClaimStatus, moneyStateGuidance, type ClaimFacts,
  acceptedExits as pureAcceptedExits, exitRegistry, REFUSE_APPROVED_AM_B3, APPROVE_ALREADY_SET, type BoundRowFacts, type ExitNote,
} from '@/lib/claim-action-rules'
import { attributionRefusal } from '@/lib/claim-attribution-rules'
import { payableWorld, wireWorld, refundRow, claimOf, type World } from './support/claims-world'
import { GET as CENSUS } from '@/app/api/admin/claims/census/route'

const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  { row: null, forcedCount: null, applyWrites: true }

const MARKER = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [
    db.claim.findUnique, db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy,
    db.refund.findFirst, db.refund.findUnique, db.refund.findMany, db.order.findUnique,
    stripeMock.refunds.list, stripeMock.refunds.retrieve, stripeMock.paymentIntents.retrieve,
  ]) m.mockReset()
  fx.row = null; fx.forcedCount = null; fx.applyWrites = true
  db.claim.findUnique.mockResolvedValue(null)
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  // ROUND 13 (B9 (a), slice W4): reconcileClaimForRefund reads EVERY claim bound to the row (findMany where { refundId }).
  // These fixtures give the bound claim through findFirst; that binder read answers with the same fixture.
  db.claim.findMany.mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
    const where = args?.where
    if (where && typeof where.refundId === 'string' && Object.keys(where).length === 1) {
      const bound = await db.claim.findFirst(args)
      return bound ? [bound] : []
    }
    return []
  })
  db.claim.count.mockResolvedValue(0)
  db.claim.groupBy.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false })
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(undefined)
  refundsFlag.mockReturnValue(false)
  cronMock.mockReturnValue(true)
})

// ══ THE SHARED MODULE SPEAKS THE LIBRARY'S MARKERS ═══════════════════════════════════════
describe('the shared rules module speaks the library’s own markers', () => {
  it('every prefix and the terminal set are the library’s', () => {
    // ROUND 13: the five family names stay pinned to lib/claims' exports; the full prefixes the round adds
    // are pinned to the spec (G8 PROOF_PAYABLE_V13 / AWAITING, C3 SAFETY_HOLD, G8 STRIPE_REVERTED, G11, F02).
    const { FINANCIAL_VERIFICATION: fv, RECONCILE_REQUIRED: rr, NO_REFUND_PROVEN: np, RAIL_LOCKED: rl, ENGINE_ROW_DEAD: rd, ...round13 } = MARKERS
    expect({ fv, rr, np, rl, rd }).toEqual({ fv: FINANCIAL_VERIFICATION, rr: RECONCILE_REQUIRED, np: NO_REFUND_PROVEN, rl: NO_REFUND_PROVEN_RAIL_LOCKED, rd: ENGINE_ROW_DEAD })
    expect(round13).toEqual({
      PROOF_PAYABLE_V13: 'no_refund_proven:v13:',
      AWAITING_FINALIZATION: 'no_refund_proven_rail_locked:awaiting_finalization:',
      SAFETY_HOLD: 'refund_safety_hold:',
      STRIPE_REVERTED: 'stripe_reverted:',
      REVERTED_AFTER_REFUND: 'stripe_reverted_after_refund:',
      DECLARED_AFTER_REVERT: 'declared_settled_after_revert:',
    })
    expect([...TERMINAL]).toEqual([...TERMINAL_STATUSES])
  })

  it('the crash marker is recognised exactly as lib/claims recognises it', () => {
    // ROUND 13 (D5, W3): a marker is recognised by the gate (never « pas en attente de réconciliation ») exactly when
    // lib/claims recognises it; a marker whose instant cannot be read is recognised but refused, never read as aged.
    const NOT_PENDING = 'Cette réclamation n’est pas en attente de réconciliation.'
    for (const e of [MARKER, RECONCILE_REQUIRED, 'engine_failed: x', 'financial_verification:x', 'resume_mismatch: x']) {
      const recognised = reconcileRefusal({ status: 'refunding', refundId: 'rf1', refundError: e })?.error !== NOT_PENDING
      expect(recognised, e).toBe(isReconcileRequired(e))
    }
    expect(reconcileRefusal({ status: 'refunding', refundId: 'rf1', refundError: MARKER })).toBeNull()
    expect(reconcileRefusal({ status: 'refunding', refundId: 'rf1', refundError: RECONCILE_REQUIRED })?.error).toContain('n’a pas pu être lue')
  })
})

// ══ EXIT TABLE (ROUND 13, J-M30 / D1) — the sets lib/claim-action-rules acceptedExits returns ════
// Round 11: NOW follows the real clock (to the second), because the reconcile gate now reads a crash
// marker's AGE — a fixed date would put fresh markers in the future relative to the routes' own clock.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const PAST = new Date(NOW.getTime() - 3_600_000)
const FUTURE = new Date(NOW.getTime() + 3_600_000)
const S = (o: Partial<ClaimFacts> & { status: string }): ClaimFacts =>
  ({ id: 'cl1', orderId: 'o1', refundAttempted: false, refundId: null, refundError: null, arbitrationDecision: null, responseDeadlineAt: PAST, ...o })

type Exit = ReturnType<typeof pureAcceptedExits>[number]
/** What the SERVER accepts on this claim — the shared rule every route and list applies (D0). */
function acceptedExits(c: ClaimFacts, now = NOW, extra: { boundRow?: BoundRowFacts | null; attributableRows?: number } = {}): Exit[] {
  return pureAcceptedExits({ claim: c, now, ...extra })
}

const A = 'approved'
const v13At = (at: Date) => `${MARKERS.PROOF_PAYABLE_V13} Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue). … Elle est payable au plus tôt le ${at.toISOString()} (UTC).`
const OWN_ROW: BoundRowFacts = { id: 'rf1', orderId: 'o1', status: 'pending', stripeRefundId: null, reason: 'claim:cl1' }
type TableRow = { state: string; d1: string; claim: ClaimFacts; boundRow?: BoundRowFacts | null; attributableRows?: number; exits: Exit[]; registry: ExitNote | null }
const EXIT_TABLE: TableRow[] = [
  // D′ L2 (D1 v1.1, R13 spec « v1.1 AMENDMENTS »): an approved claim is NEVER re-approved as a money path. Amount not
  // fixed (approvedAmountCents null — the column is not migrated yet, so every legacy row) → 'ratify' (a decision, no
  // money); amount fixed → ['withdraw', 'pay'] (the audited reversal, the gated rail). The v13 shape keeps 'reconcile'.
  { d1: '1', state: 'approved, unpaid — admin-decided', claim: S({ status: A, arbitrationDecision: A }), exits: ['ratify'], registry: 'E-10' },
  { d1: '1', state: 'approved, unpaid — legacy, no decision', claim: S({ status: A }), exits: ['ratify'], registry: 'E-10' },
  { d1: '1', state: 'approved, unpaid — amount fixed (APPROVED_AWAITING_PAYMENT, v1.1)', claim: S({ status: A, arbitrationDecision: A, approvedAmountCents: 500 }), exits: ['withdraw', 'pay'], registry: 'E-10' },
  { d1: '2', state: 'absence proven (v13), instant passed', claim: S({ status: A, arbitrationDecision: A, refundError: v13At(new Date(NOW.getTime() - 60_000)) }), exits: ['ratify', 'reconcile'], registry: 'E-10' },
  { d1: '2', state: 'absence proven (v13), before its instant', claim: S({ status: A, arbitrationDecision: A, refundError: v13At(FUTURE) }), exits: ['ratify', 'reconcile'], registry: 'E-10' },
  // W1 round-1 fix (D1 row 2 / D3): an unreadable instant refuses approval until reconcile re-derives it — not revisable.
  { d1: '2', state: 'absence proven (v13), instant unreadable', claim: S({ status: A, arbitrationDecision: A, refundError: `${MARKERS.PROOF_PAYABLE_V13} Stripe ne rapporte aujourd’hui aucun remboursement … (sans instant)` }), exits: ['reconcile'], registry: 'E-10' },
  // W1 round-1 fix (D2 (1)(b)): an approval BOUND to a row is not re-driven by approve, whatever refundAttempted says.
  { d1: 'D2(1)(b)', state: 'approved — not attempted but bound, no error', claim: S({ status: A, arbitrationDecision: A, refundId: 'rf1' }), exits: ['reconcile'], registry: null },
  { d1: '3', state: 'legacy proof of absence', claim: S({ status: A, arbitrationDecision: A, refundError: `${NO_REFUND_PROVEN}: x` }), exits: ['reconcile'], registry: 'E-01' },
  { d1: '4', state: 'rail locked — admin-decided', claim: S({ status: A, arbitrationDecision: A, refundError: `${NO_REFUND_PROVEN_RAIL_LOCKED}: x` }), exits: ['reconcile', 'stuck_close'], registry: 'E-01' },
  { d1: '4', state: 'rail locked — legacy, no decision', claim: S({ status: A, refundError: `${NO_REFUND_PROVEN_RAIL_LOCKED}: x` }), exits: ['reconcile', 'stuck_close'], registry: 'E-01' },
  { d1: '4', state: 'awaiting finalization', claim: S({ status: A, arbitrationDecision: A, refundError: `${MARKERS.AWAITING_FINALIZATION} x` }), exits: ['reconcile', 'stuck_close'], registry: 'E-01' },
  { d1: '5', state: 'safety hold', claim: S({ status: A, refundAttempted: true, arbitrationDecision: A, refundError: `${MARKERS.SAFETY_HOLD} x` }), exits: ['reconcile', 'stuck_close'], registry: 'E-01' },
  { d1: '6', state: 'engine row dead', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A, refundError: `${ENGINE_ROW_DEAD}: x` }), exits: ['stuck_close'], registry: 'E-02' },
  { d1: '6', state: 'stripe failed, recorded', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A, refundError: 'stripe_failed: x' }), exits: ['stuck_close'], registry: 'E-02' },
  { d1: '6', state: 'engine failed, recorded', claim: S({ status: A, refundAttempted: true, arbitrationDecision: A, refundError: 'engine_failed: x' }), exits: ['stuck_close'], registry: 'E-02' },
  { d1: '6', state: 'stripe reverted', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A, refundError: `${MARKERS.STRIPE_REVERTED} x` }), exits: ['stuck_close'], registry: 'E-02' },
  { d1: '7', state: 'refunding — resume mismatch, bound row read and not this claim’s', claim: S({ status: 'refunding', refundAttempted: true, refundId: 'rf9', refundError: 'resume_mismatch: x' }), boundRow: { id: 'rf9', orderId: 'o1', status: 'succeeded', stripeRefundId: 're_9', reason: 'claim:cl_OTHER' }, exits: ['stuck_close'], registry: 'E-02' },
  { d1: '8', state: 'refunding — resume mismatch on the claim’s OWN row', claim: S({ status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: 'resume_mismatch: x' }), boundRow: { ...OWN_ROW, status: 'succeeded', stripeRefundId: 're_1' }, exits: ['reconcile'], registry: 'E-05' },
  { d1: '9', state: 'refunding — crash marker written a minute ago (attempt in flight)', claim: S({ status: 'refunding', refundAttempted: true, arbitrationDecision: A, refundError: `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${new Date(NOW.getTime() - 60_000).toISOString()} — identité pas encore liée.` }), exits: [], registry: 'E-05' },
  { d1: '9', state: 'refunding — crash marker', claim: S({ status: 'refunding', refundAttempted: true, arbitrationDecision: A, refundError: MARKER }), exits: ['reconcile'], registry: 'E-05' },
  { d1: '10', state: 'financial verification, an attributable row', claim: S({ status: FINANCIAL_VERIFICATION, refundAttempted: true, refundError: 'financial_verification:stripe_unreadable: x' }), attributableRows: 1, exits: ['reconcile', 'attribute', 'adopt'], registry: 'E-03' },
  { d1: '10', state: 'financial verification, no attributable row', claim: S({ status: FINANCIAL_VERIFICATION, refundAttempted: true, refundError: 'financial_verification:stripe_unreadable: x' }), attributableRows: 0, exits: ['reconcile', 'adopt'], registry: 'E-03' },
  { d1: '11', state: 'refunded — bound row failed with a Stripe id', claim: S({ status: 'refunded', refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), boundRow: { ...OWN_ROW, status: 'failed', stripeRefundId: 're_1' }, exits: ['reconcile'], registry: 'E-07' },
  { d1: '11', state: 'refunded — bound row pending', claim: S({ status: 'refunded', refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), boundRow: OWN_ROW, exits: ['reconcile'], registry: 'E-07' },
  { d1: '11', state: 'refunded — bound row succeeded (route-only)', claim: S({ status: 'refunded', refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), boundRow: { ...OWN_ROW, status: 'succeeded', stripeRefundId: 're_1' }, exits: ['reconcile'], registry: 'E-09' },
  { d1: '12', state: 'refunded + REVERTED_AFTER_REFUND', claim: S({ status: 'refunded', refundAttempted: true, refundId: 'rf1', arbitrationDecision: A, refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` }), exits: ['stuck_close'], registry: 'E-06' },
  { d1: '13', state: 'refused_final', claim: S({ status: 'refused_final', arbitrationDecision: 'refused_final' }), exits: [], registry: 'terminal' },
  { d1: '13', state: 'refunded after a declaration', claim: S({ status: 'refunded', refundError: `${MARKERS.DECLARED_AFTER_REVERT} x` }), exits: [], registry: 'terminal' },
  { d1: '13', state: 'refunded — bound row failed WITHOUT a Stripe id', claim: S({ status: 'refunded', refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), boundRow: { ...OWN_ROW, status: 'failed' }, exits: [], registry: 'terminal' },
  { d1: '14', state: 'refunding — resume mismatch, bound row NOT read', claim: S({ status: 'refunding', refundAttempted: true, refundId: 'rf9', refundError: 'resume_mismatch: x' }), exits: [], registry: 'unread:bound_row' },
  { d1: '14', state: 'refunded — bound row NOT read', claim: S({ status: 'refunded', refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), exits: [], registry: 'unread:bound_row' },
  // ER-M06: the non-terminal shapes D1 omitted — kept exactly as G1 and arbitrateClaim accept them.
  { d1: 'ER-M06', state: 'approved — bound, no error', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), exits: ['reconcile'], registry: null },
  { d1: 'ER-M06', state: 'approved — attempt taken, nothing recorded', claim: S({ status: A, refundAttempted: true, arbitrationDecision: A }), exits: ['reconcile'], registry: null },
  { d1: 'ER-M06', state: 'refunding — legacy stranded', claim: S({ status: 'refunding', refundAttempted: true }), exits: ['reconcile'], registry: null },
  { d1: 'ER-M06', state: 'refunding — bound to its own row pending at Stripe, no error (the 202 outcome)', claim: S({ status: 'refunding', refundAttempted: true, refundId: 'rf1' }), boundRow: { ...OWN_ROW, stripeRefundId: 're_1' }, exits: ['reconcile'], registry: null },
  { d1: 'ER-M06', state: 'arbitration', claim: S({ status: 'arbitration' }), exits: ['approve', 'refuse_final'], registry: 'not_money:awaiting_decision' },
  { d1: 'ER-M06', state: 'restaurant_review — delay expired', claim: S({ status: 'restaurant_review' }), exits: ['approve', 'refuse_final'], registry: 'not_money:awaiting_decision' },
  { d1: 'ER-M06', state: 'restaurant_review — delay running', claim: S({ status: 'restaurant_review', responseDeadlineAt: FUTURE }), exits: [], registry: 'not_money:restaurant_delay' },
  { d1: 'ER-M06', state: 'refused by the restaurant', claim: S({ status: 'refused' }), exits: [], registry: 'not_money:refused_contestable' },
]
const extraOf = (r: TableRow) => ({ ...(r.boundRow !== undefined ? { boundRow: r.boundRow } : {}), attributableRows: r.attributableRows })

describe('EXIT TABLE (ROUND 13, J-M30) — acceptedExits returns exactly the D1 sets', () => {
  for (const row of EXIT_TABLE) {
    it(`D1 ${row.d1}: ${row.state} → ${row.exits.join(' + ') || row.registry}`, () => {
      expect(acceptedExits(row.claim, NOW, extraOf(row))).toEqual(row.exits)
      expect(exitRegistry({ claim: row.claim, now: NOW, ...extraOf(row) })).toBe(row.registry)
    })
  }

  /** D′ L2: every exit that needs a lease — the decisions (CLAIMS), the rail 'pay' (REFUNDS ∧ SURFACE) and the audited
   *  'withdraw' (admin session). A set made only of these has no ungated way out and must name its registry entry. */
  const GATED: Exit[] = ['approve', 'ratify', 'refuse_final', 'withdraw', 'pay']
  it('every empty or gated-only set names its registry entry (or its terminal / non-money note)', () => {
    for (const row of EXIT_TABLE) {
      const gatedOnly = row.exits.every((x) => GATED.includes(x))
      if (gatedOnly) expect(row.registry, row.state).not.toBeNull()
    }
    const rowsFor = (d1: string) => EXIT_TABLE.filter((r) => r.d1 === d1).map((r) => r.registry)
    expect(new Set([...rowsFor('1'), ...rowsFor('2')])).toEqual(new Set(['E-10']))
    expect(rowsFor('3')).toEqual(['E-01'])
    expect(EXIT_TABLE.find((r) => r.state.includes('attempt in flight'))!.registry).toBe('E-05')
    expect(EXIT_TABLE.find((r) => r.state.includes('route-only'))!.registry).toBe('E-09')
    expect(new Set(rowsFor('13'))).toEqual(new Set(['terminal']))
    // NEGATIVE CONTROL: the pre-D′ predicate (approve / refuse_final only) would read ['ratify'] and ['withdraw', 'pay']
    // as ungated sets and stop requiring an E id for the two E-10 shapes.
    const oldPredicate = (exits: Exit[]) => exits.every((x) => x === 'approve' || x === 'refuse_final')
    expect(oldPredicate(['ratify'])).toBe(false)
    expect(oldPredicate(['withdraw', 'pay'])).toBe(false)
    expect(['ratify'].every((x) => GATED.includes(x as Exit)) && ['withdraw', 'pay'].every((x) => GATED.includes(x as Exit))).toBe(true)
  })

  it('D′ L2 (D1 v1.1): the amount-fixed shape refuses approve with APPROVE_ALREADY_SET; "approve" is never an exit of an approved claim', () => {
    const fixed = EXIT_TABLE.find((r) => r.state.includes('amount fixed'))!.claim
    expect(arbitrationRefusal(fixed, 'approve', NOW)).toEqual({ status: 409, error: APPROVE_ALREADY_SET })
    expect(APPROVE_ALREADY_SET).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
    for (const r of EXIT_TABLE.filter((r) => r.claim.status === A)) expect(acceptedExits(r.claim, NOW, extraOf(r)), r.state).not.toContain('approve')
    // NEGATIVE CONTROL: the same two shapes with the amount NOT fixed are ratifiable, and 'approve' is still the exit of
    // an arbitration claim — the rule reads approvedAmountCents, not the status alone.
    expect(acceptedExits({ ...fixed, approvedAmountCents: null })).toEqual(['ratify'])
    expect(arbitrationRefusal({ ...fixed, approvedAmountCents: null }, 'approve', NOW)).toBeNull()
    expect(acceptedExits(S({ status: 'arbitration' }))).toEqual(['approve', 'refuse_final'])
  })

  it('refuse_final on EVERY approved claim → the exact AM-B3 text (D13, text v1.1 — D′ L2)', () => {
    const approvedRows = EXIT_TABLE.filter((r) => r.claim.status === A)
    expect(approvedRows.length).toBeGreaterThan(8)
    for (const r of approvedRows) {
      expect(arbitrationRefusal(r.claim, 'refuse_final', NOW)?.error, r.state).toBe('Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : elle relève du rail financier (« Payer les approuvées »), retirez l’approbation (« Retirer l’approbation »), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose.')
    }
    expect(REFUSE_APPROVED_AM_B3).toBe(arbitrationRefusal(S({ status: A }), 'refuse_final', NOW)?.error)
    // NEGATIVE CONTROL: the v1 text named a re-approval as the way to be paid; it is not the shipped text any more.
    const V1_AM_B3 = 'Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose.'
    expect(V1_AM_B3).toMatch(/approuvez-la à nouveau/)
    expect(REFUSE_APPROVED_AM_B3).not.toBe(V1_AM_B3)
    expect(REFUSE_APPROVED_AM_B3).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
    expect(REFUSE_APPROVED_AM_B3).toContain('Retirer l’approbation')
  })

  it('markers are matched with startsWith — a marker quoted inside another text is not that marker (an includes mutant is red)', () => {
    const quoting = S({ status: A, refundError: 'engine_failed: le texte cite no_refund_proven_rail_locked: et no_refund_proven: et refund_safety_hold:' })
    expect(acceptedExits(quoting)).toEqual(['stuck_close'])
    const includesMutant = (e: string) => e.includes('no_refund_proven')
    expect(includesMutant(quoting.refundError!)).toBe(true) // ← a mutant would admit it to reconcile and refuse the close
  })

  it('no row offers a power that does not exist: no « annuler », no apply_row_failure, no declaration from FV', () => {
    // D′ L2 (D1 v1.1): the exit union gains ratify | withdraw | pay — and nothing else.
    const ALLOWED: Exit[] = ['approve', 'ratify', 'refuse_final', 'withdraw', 'pay', 'reconcile', 'attribute', 'adopt', 'stuck_close']
    for (const r of EXIT_TABLE) {
      for (const x of acceptedExits(r.claim, NOW, extraOf(r))) expect(ALLOWED, r.state).toContain(x)
      if (r.claim.status === FINANCIAL_VERIFICATION) expect(acceptedExits(r.claim, NOW, extraOf(r)), r.state).not.toContain('stuck_close')
    }
    // NEGATIVE CONTROL: the three v1.1 exits really are exercised by the table (the list above is not slack), and none of
    // the powers that do not exist ever appears.
    const seen = new Set(EXIT_TABLE.flatMap((r) => acceptedExits(r.claim, NOW, extraOf(r))))
    for (const x of ['ratify', 'withdraw', 'pay']) expect(seen.has(x as Exit), x).toBe(true)
    for (const x of ['annuler', 'apply_row_failure', 'cancel', 'declare']) expect(seen.has(x as Exit), x).toBe(false)
  })

  it('NEGATIVE CONTROL — an FV claim with no attributable row → reconcile + adopt, never attribute', () => {
    const fv = EXIT_TABLE.find((r) => r.state === 'financial verification, no attributable row')!
    expect(acceptedExits(fv.claim, NOW, extraOf(fv))).toEqual(['reconcile', 'adopt'])
  })

  it('terminal states, and only they, carry neither an exit nor a note', () => {
    for (const status of TERMINAL_STATUSES) expect(acceptedExits(S({ status })), status).toEqual([])
  })

  it('the grace note is real: five minutes later the reconcile gate admits the same claim', () => {
    const inFlight = EXIT_TABLE.find((r) => r.state.includes('attempt in flight'))!.claim
    expect(acceptedExits(inFlight, new Date(NOW.getTime() + 5 * 60 * 1000))).toEqual(['reconcile'])
  })

  it('the documented non-human path is real: once the restaurant’s delay passes, arbitration accepts both decisions', () => {
    const running = EXIT_TABLE.find((r) => r.state === 'restaurant_review — delay running')!.claim
    const after = new Date(FUTURE.getTime() + 1)
    expect(arbitrationRefusal(running, 'approve', after)).toBeNull()
    expect(arbitrationRefusal(running, 'refuse_final', after)).toBeNull()
  })

  it('« awaits the refund rail » is stated, not hidden: with REFUNDS closed an approval pays nothing and writes nothing', async () => {
    refundsFlag.mockReturnValue(false)
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'pending', reason: 'refunds_disabled' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })
})

// ══ PARITY — the consoles carry exactly the server's verdicts ════════════════════════════
describe('ARBITRATION PARITY — the queue carries exactly the refusal the server returns', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('for every state and both decisions: listed verdict === server verdict, and a lost CAS is the only other answer', async () => {
    const shapes = EXIT_TABLE.map((r, i) => ({
      ...r.claim, id: `cl${i}`, orderId: `o${i}`, consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: PAST,
    }))
    db.claim.findMany.mockImplementation(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? shapes : []))
    const queue = await listArbitrationQueue()
    expect(queue).toHaveLength(shapes.length)

    fx.row = null; fx.forcedCount = 0 // every CAS loses: no call can reach the engine
    let refusals = 0
    for (const listed of queue) {
      db.claim.findUnique.mockResolvedValue(shapes.find((s) => s.id === listed.id))
      const pairs: Array<['approve' | 'refuse_final', string | null]> = [['approve', listed.approveRefusal], ['refuse_final', listed.refuseFinalRefusal]]
      for (const [decision, verdict] of pairs) {
        const server = await arbitrateClaim({ claimId: listed.id, adminId: 'op1', decision })
        if (verdict) { refusals++; expect(server, `${listed.id} ${decision}`).toEqual({ ok: false, status: 409, error: verdict }) }
        else expect(server, `${listed.id} ${decision}`).toEqual({ ok: false, status: 409, error: 'Cette réclamation a déjà été arbitrée.' })
      }
    }
    expect(refusals).toBeGreaterThan(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('ROUND 11 (round-10 audit, P3): an ENABLED decision really succeeds — the CAS matches, the claim moves, no engine runs', async () => {
    const shapes = EXIT_TABLE.map((r, i) => ({
      ...r.claim, id: `cl${i}`, orderId: `o${i}`, consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: PAST,
    }))
    db.claim.findMany.mockImplementation(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? shapes : []))
    const queue = await listArbitrationQueue()
    refundsFlag.mockReturnValue(false)
    let successes = 0
    for (const listed of queue) {
      const shape = shapes.find((s) => s.id === listed.id)!
      const pairs: Array<['approve' | 'refuse_final', string | null, string]> = [
        ['approve', listed.approveRefusal, 'approved'], ['refuse_final', listed.refuseFinalRefusal, 'refused_final'],
      ]
      for (const [decision, verdict, to] of pairs) {
        if (verdict) continue
        fx.row = { ...shape }; fx.forcedCount = null; fx.applyWrites = true
        db.claim.findUnique.mockResolvedValue({ ...shape })
        const server = await arbitrateClaim({ claimId: listed.id, adminId: 'op1', decision })
        expect(server.ok, `${listed.id} ${decision}`).toBe(true)
        expect(fx.row!.status, `${listed.id} ${decision}`).toBe(to)
        successes++
      }
    }
    // ROUND 13 (J-M30): AM-B3 removes refuse_final on approved claims and D14 refuses approval on recorded
    // errors — the enabled decisions are exactly: the RATIFICATION (D′ L2: approve on an approved claim whose amount is
    // not fixed — a decision, no money) of the two unpaid approvals and of the v13 proof past its instant, and both
    // decisions on arbitration and on an expired restaurant delay. The amount-fixed shape is refused (APPROVE_ALREADY_SET).
    expect(successes).toBe(7)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('the rail-locked claim that round 9 left with « Refuser » live: both decisions are refused, both are disabled', () => {
    const rail = EXIT_TABLE.find((r) => r.state === 'rail locked — admin-decided')!.claim
    expect(arbitrationRefusal(rail, 'approve', NOW)).not.toBeNull()
    expect(arbitrationRefusal(rail, 'refuse_final', NOW)).not.toBeNull()
  })
})

describe('RECONCILE PARITY — the button appears exactly where the server’s gate admits the claim', () => {
  it('for every approved / refunding state: `reconcilable` === the server did not return the gate refusal', async () => {
    const GATE = 'Cette réclamation n’est pas en attente de réconciliation.'
    const shapes = EXIT_TABLE.filter((r) => ['approved', 'refunding'].includes(r.claim.status)).map((r, i) => ({
      ...r.claim, id: `cl${i}`, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: PAST,
    }))
    db.claim.findMany.mockResolvedValue(shapes)
    const listed = await listActionableRefundClaims()
    expect(listed).toHaveLength(shapes.length)

    // Admitted claims run to a park without Stripe; every CAS loses, so nothing is written either way.
    db.order.findUnique.mockResolvedValue({ id: 'o1', stripePaymentIntentId: null })
    fx.row = null; fx.forcedCount = 0
    let admitted = 0, refused = 0
    for (const l of listed) {
      db.claim.findUnique.mockResolvedValue(shapes.find((s) => s.id === l.id))
      db.refund.findMany.mockClear(); db.refund.findUnique.mockClear()
      const server = await reconcileClaimEvidence({ claimId: l.id })
      // Round 11: the gate has two refusals now (not reconcilable; attempt in flight) — both refuse
      // before anything is read. ROUND 13 (B8, slice W2): except the bound row itself, which the gate decides on.
      const shape = shapes.find((s) => s.id === l.id) as { refundId?: string | null }
      const boundOnly = db.refund.findUnique.mock.calls.every((c) => (c[0] as { where: { id: string } }).where.id === shape.refundId)
      const refusedBeforeReading = !server.ok && (server as { status?: number }).status === 409
        && db.refund.findMany.mock.calls.length === 0 && boundOnly
      expect(refusedBeforeReading, l.id).toBe(!l.reconcilable)
      if (l.reconcilable) { admitted++; expect(server.ok, l.id).toBe(true) } else refused++
    }
    expect(GATE).toContain('pas en attente de réconciliation')
    expect(admitted).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)
  })
})

// ══ A PENDING ROW IS DECIDED BY STRIPE — round 9's absorbing state, removed ═══════════════
const OWN = (o: Record<string, unknown> = {}) => ({
  id: 'rf1', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: null as string | null,
  reason: claimRefundReason('cl1'), createdAt: new Date(Date.now() - 3_600_000), ...o,
})
const MARKED = { id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: null, requestedAmountCents: 500, refundError: MARKER }
const stripeRefund = (status: string, o: Record<string, unknown> = {}) =>
  ({ id: 're_T', status, amount: 500, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf1' }, ...o })

describe('OUR PENDING ROW, NO STRIPE ID — Stripe decides by the engine’s own tag, and every answer has an exit', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER, activeOrderKey: 'o1' }
  })

  it('Stripe unreadable → nothing concluded, nothing written; the claim stays reconcilable', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockRejectedValue(new Error('stripe down'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: 'rf1' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(reconcileRefusal(fx.row as ClaimFacts)).toBeNull()
  })

  it('a truncated list is PAGED, never read as complete — the tag on page 2 is found', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list
      .mockResolvedValueOnce({ data: [{ id: 're_other', status: 'succeeded', amount: 100, metadata: {} }], has_more: true })
      .mockResolvedValueOnce({ data: [stripeRefund('succeeded')], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1' })
    expect(stripeMock.refunds.list.mock.calls[1][0]).toMatchObject({ payment_intent: 'pi_1', starting_after: 're_other' })
  })

  it('…and a list longer than the page cap proves nothing', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_x', status: 'succeeded', amount: 1, metadata: {} }], has_more: true })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'stripe_unreadable_retry' })
    expect(stripeMock.refunds.list).toHaveBeenCalledTimes(10)
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('the tagged refund SUCCEEDED → the claim is refunded, bound, and the order released', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund('succeeded', { amount: 480 })], has_more: false })
    // ROUND 13 (G2 / F14): Stripe's refund object was read for this conclusion — the outcome says so.
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 480, evidence: 'stripe_read' })
    expect(fx.row).toMatchObject({ status: 'refunded', refundId: 'rf1', refundError: null, activeOrderKey: null })
  })

  it('the tagged refund FAILED or was CANCELED → approved with the Stripe failure recorded — closable', async () => {
    for (const s of ['failed', 'canceled']) {
      fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER }
      db.refund.findMany.mockResolvedValue([OWN()])
      stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund(s)], has_more: false })
      expect(await reconcileClaimEvidence({ claimId: 'cl1' }), s).toEqual({ ok: true, outcome: 'refund_failed', refundId: 'rf1' })
      expect(fx.row, s).toMatchObject({ status: 'approved', refundId: 'rf1' })
      expect(String(fx.row!.refundError).startsWith('stripe_failed:'), s).toBe(true)
      expect(isStuckResolvable(fx.row as { status: string; refundError: string }), s).toBe(true)
    }
  })

  it('the tagged refund is PENDING at Stripe → bound, marker cleared, still reconcilable (re-run once terminal)', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund('pending')], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'still_pending', refundId: 'rf1' })
    expect(fx.row).toMatchObject({ status: 'refunding', refundId: 'rf1', refundError: null })
    expect(reconcileRefusal(fx.row as ClaimFacts)).toBeNull()
  })

  it('NOT at Stripe, past the window but inside the margin → says from when it can conclude, writes nothing', async () => {
    const createdAt = new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS / 2)
    db.refund.findMany.mockResolvedValue([OWN({ createdAt })])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({
      ok: true, outcome: 'unconfirmed_within_window', refundId: 'rf1',
      until: new Date(createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString(),
    })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('NOT at Stripe, past the window AND the margin → the row is dead: approved, bound, closable, never re-approvable', async () => {
    const createdAt = new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000)
    db.refund.findMany.mockResolvedValue([OWN({ createdAt })])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'engine_row_dead', refundId: 'rf1' })
    expect(fx.row).toMatchObject({ status: 'approved', refundId: 'rf1', refundAttempted: true })
    const e = String(fx.row!.refundError)
    expect(e.startsWith(`${ENGINE_ROW_DEAD}:`)).toBe(true)
    expect(e).toContain('rf1')
    expect(e).toContain('Clôturer ce dossier')
    const after = { ...(fx.row as ClaimFacts), arbitrationDecision: 'approved' }
    expect(acceptedExits(after)).toEqual(['stuck_close'])
  })
})

describe('OUR PENDING ROW WITH A STRIPE ID — read by that id, as the engine does', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER, activeOrderKey: 'o1' }
    db.refund.findMany.mockResolvedValue([OWN({ stripeRefundId: 're_1' })])
  })

  it('succeeded → refunded, and the list is not consulted', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('succeeded', { id: 're_1' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1' })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_1')
    expect(stripeMock.refunds.list).not.toHaveBeenCalled()
  })

  it('Stripe does not know that id → parked with the contradiction, never « retry for ever »', async () => {
    stripeMock.refunds.retrieve.mockRejectedValue(Object.assign(new Error('No such refund'), { statusCode: 404, code: 'resource_missing' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
    expect(fx.row!.status).toBe(FINANCIAL_VERIFICATION)
    // ROUND 13 (D1 row 10): 'attribute' needs an attributable row, which the FV list decides; adoption is always offered.
    expect(acceptedExits(fx.row as ClaimFacts)).toEqual(['reconcile', 'adopt'])
  })

  it('the refund sits on ANOTHER payment → parked, never applied', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('succeeded', { id: 're_1', payment_intent: 'pi_OTHER' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
    expect(fx.row!.status).not.toBe('refunded')
  })

  it('a transient read error → nothing written, re-run', async () => {
    stripeMock.refunds.retrieve.mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: 'rf1' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a CANCELED row in our table paid nothing → the reconciler’s failed path, closable', async () => {
    db.refund.findMany.mockResolvedValue([OWN({ status: 'canceled', stripeRefundId: 're_1' })])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: MARKER })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refund_failed', refundId: 'rf1' })
    expect(isStuckResolvable(fx.row as { status: string; refundError: string })).toBe(true)
  })
})

// ══ A CLAIM BOUND TO A ROW, WITH NO ERROR — it had no human exit at all ═══════════════════
describe('A CLAIM BOUND TO A ROW, NO ERROR — reconcile applies that row’s truth', () => {
  const BOUND = { id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: 'rf1', requestedAmountCents: 500, refundError: null }
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...BOUND })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: null, activeOrderKey: 'o1' }
  })

  it('Stripe reports the bound refund succeeded and the webhook never came → refunded', async () => {
    db.refund.findUnique.mockResolvedValue(OWN({ stripeRefundId: 're_1' }))
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('succeeded', { id: 're_1' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1' })
    expect(fx.row).toMatchObject({ status: 'refunded', activeOrderKey: null })
    // the order's other rows are not this claim's question
    expect(db.refund.findMany).not.toHaveBeenCalled()
  })

  it('the bound row FAILED in our table → recorded as failed by the reconciler, and the claim becomes closable', async () => {
    db.refund.findUnique.mockResolvedValue(OWN({ status: 'failed', stripeRefundId: 're_1' }))
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refund_failed', refundId: 'rf1' })
    expect(isStuckResolvable(fx.row as { status: string; refundError: string })).toBe(true)
  })

  it('the bound row is not on this order → parked, where a refund can be linked', async () => {
    db.refund.findUnique.mockResolvedValue(OWN({ orderId: 'o_OTHER' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'bound_row_missing' })
    expect(fx.row!.status).toBe(FINANCIAL_VERIFICATION)
  })
})

// ══ NO ROW IS OURS — a dead pending row of the order no longer blocks the proof for ever ═══
describe('NO ROW IS OURS — a dead pending row no longer blocks the proof of absence', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER }
    // ROUND 13 (G2 (3), G3, W3): the marker pre-image is re-derived on the loader, which reads the order's payment
    // status (E1), the royalty and the intent status (E1b).
    db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
    db.franchiseRoyalty.findFirst.mockResolvedValue(null)
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
  })
  const adminRow = (createdAt: Date) => ({ id: 'rf_admin', orderId: 'o1', status: 'pending', amountCents: 300, stripeRefundId: null, reason: 'admin:x', createdAt })

  it('Stripe reports nothing and the order’s only pending row is dead → proof of absence, locked by that row, closable', async () => {
    db.refund.findMany.mockResolvedValue([adminRow(new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000))])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    expect(fx.row).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    const e = String(fx.row!.refundError)
    expect(isRailLocked(e)).toBe(true)
    expect(e).toContain('rf_admin')
    expect(isStuckResolvable({ status: 'approved', refundError: e })).toBe(true)
  })

  it('the same row still inside the window → nothing concluded, nothing written, and from when', async () => {
    const createdAt = new Date(Date.now() - 3_600_000)
    db.refund.findMany.mockResolvedValue([adminRow(createdAt)])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({
      ok: true, outcome: 'unconfirmed_within_window', refundId: null,
      until: new Date(createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString(),
    })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('that row’s refund IS at Stripe → not absence: parked, never « nothing left »', async () => {
    db.refund.findMany.mockResolvedValue([adminRow(new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000))])
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_A', status: 'pending', amount: 300, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf_admin' } }], has_more: false })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification' })
    expect(fx.row!.refundAttempted).toBe(true)
  })
})

// ══ THE GATE — an attempt taken with nothing recorded is money-unknown ═══════════════════
describe('RECONCILE GATE — an approval whose attempt was taken with nothing recorded', () => {
  it('is admitted, and the evidence runs', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: true, refundId: null, requestedAmountCents: 500, refundError: null })
    fx.row = { status: 'approved', refundAttempted: true, refundId: null, refundError: null }
    await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(db.refund.findMany).toHaveBeenCalled()
  })

  it('the classifier calls it reconcile_required, not « jamais payée »; an approval bound to a missing row is stale', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'a', orderId: 'o1', status: 'approved', refundAttempted: true, refundId: null, refundError: null, reason: 'wrong_item', createdAt: PAST },
      { id: 'b', orderId: 'o1', status: 'approved', refundAttempted: true, refundId: 'rf_gone', refundError: null, reason: 'wrong_item', createdAt: PAST },
      { id: 'c', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, refundError: null, reason: 'wrong_item', createdAt: PAST },
    ])
    const byId = Object.fromEntries((await listActionableRefundClaims()).map((c) => [c.id, c]))
    expect([byId.a.moneyState, byId.b.moneyState, byId.c.moneyState]).toEqual(['reconcile_required', 'stale_refunding_no_refund_row', 'approved_not_driven'])
    expect([byId.a.reconcilable, byId.b.reconcilable, byId.c.reconcilable]).toEqual([true, true, false])
  })
})

// ══ GUIDANCE AND COPY — facts and accepted actions, never a mechanism that may not run ═════
const MONEY_STATES = [
  'reconcile_required', 'stripe_pending', 'local_pending_unconfirmed', 'stripe_failed', 'stripe_succeeded_claim_unreconciled',
  'stale_refunding_no_refund_row', 'approved_not_driven', 'absence_proven_payable', 'refund_error_recorded',
  // W3 round-2 fix (D0 / D5): a marker whose start instant cannot be read.
  'reconcile_marker_unreadable',
  // MODE B commit B: la ligne liee a ete LIBEREE — preuve qu'aucun remboursement Stripe n'a jamais existe.
  'row_voided',
]
const PROMISES = [/l[’']appliquera/i, /sera appliqu[ée]e? par/i, /la reprend/i, /son webhook/i, /balayage de récupération/i]

describe('GUIDANCE — one fact-only line per money state, shared by both consoles', () => {
  it('the classifier’s union is exactly the guided set', () => {
    const src = stripComments(read('lib/claims.ts'))
    const block = src.slice(src.indexOf('let moneyState:'), src.indexOf('if (isReconcileRequired(c.refundError)) moneyState'))
    const union = Array.from(block.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort()
    expect(union).toEqual([...MONEY_STATES].sort())
  })

  it('every state has its own line, and none promises a mechanism', () => {
    const fallback = moneyStateGuidance('__unknown__')
    for (const s of MONEY_STATES) {
      const g = moneyStateGuidance(s)
      expect(g, s).not.toBe(fallback)
      for (const re of PROMISES) expect(g, `${s} ${re}`).not.toMatch(re)
    }
  })

  it('no shipped console or rule string promises that a webhook, the sweep or the engine will act (comments excluded)', () => {
    // Round 11 (round-10 audit, P3): the refundError strings in lib/claims.ts, the money line and the five
    // locale files are shown to operators and customers too.
    for (const f of [
      'components/claims/AdminFinancialVerification.tsx', 'components/claims/AdminClaimsArbitration.tsx', 'lib/claim-attribution-rules.ts', 'lib/claim-action-rules.ts',
      'lib/claims.ts', 'lib/claim-money-line.ts', ...LOCALES.map((l) => `messages/${l}.json`),
    ]) {
      const code = stripComments(read(f))
      const hits = PROMISES.flatMap((re) => { const m = code.match(re); return m ? [`${re} → « ${m[0]} »`] : [] })
      expect(hits, f).toEqual([])
    }
  })

  it('NEGATIVE CONTROL — the round-9 sentences would be caught', () => {
    const caught = (s: string) => PROMISES.some((re) => re.test(s))
    expect(caught('Elle n’avancera que si Stripe a réellement créé ce remboursement (son webhook l’appliquera)')).toBe(true)
    expect(caught('ou si le moteur de remboursement la reprend (fenêtre remboursements ouverte)')).toBe(true)
    expect(caught('son sort sera appliqué par la réconciliation (webhook Stripe, ou le balayage de récupération lorsqu’il est déclenché)')).toBe(true)
  })

  it('ROUND 12 (round-11 audit, P1): a pending row without a Stripe id is no longer refused — its evidence decides', () => {
    const r = attributionRefusal({ claimId: 'cl1', row: { id: 'rf1', status: 'pending', reason: claimRefundReason('cl1'), stripeRefundId: null }, orderRows: [{ id: 'rf1', reason: claimRefundReason('cl1') }], boundToOtherClaimId: null })
    expect(r).toBeNull()
  })

  it('both consoles render the shared line', () => {
    expect(read('components/claims/AdminClaimsArbitration.tsx')).toContain('{moneyStateGuidance(r.moneyState)}')
    expect(read('components/claims/AdminFinancialVerification.tsx')).toContain("moneyStateGuidance(r.moneyState ?? '')")
  })
})

// ══ THE CUSTOMER — « en cours » only when a refund is bound to a row Stripe confirmed ══════
describe('CUSTOMER STATUS — never the raw recovery state', () => {
  it('the table', () => {
    // ROUND 13 (F04): the third input is the F03 row proof of a settled claim.
    const T: Array<[ClaimFacts, boolean | null, string, (boolean | null)?]> = [
      [{ status: 'refunding', refundId: 'rf1', refundError: null }, true, 'refunding'],
      [{ status: 'refunding', refundId: 'rf1', refundError: null }, false, FINANCIAL_VERIFICATION],
      [{ status: 'refunding', refundId: 'rf1', refundError: null }, null, FINANCIAL_VERIFICATION],
      [{ status: 'refunding', refundId: null, refundError: MARKER }, true, FINANCIAL_VERIFICATION],
      [{ status: 'refunding', refundId: 'rf9', refundError: 'resume_mismatch: x' }, true, FINANCIAL_VERIFICATION],
      [{ status: 'approved', refundError: 'engine_failed: x' }, null, FINANCIAL_VERIFICATION],
      [{ status: 'approved', refundError: `${ENGINE_ROW_DEAD}: x` }, null, FINANCIAL_VERIFICATION],
      [{ status: 'approved', refundError: null }, null, 'approved'],
      [{ status: FINANCIAL_VERIFICATION, refundError: 'x' }, null, FINANCIAL_VERIFICATION],
      [{ status: 'refunded', refundId: 'rfE', refundError: null }, null, 'refunded', true],
      [{ status: 'refunded', refundId: 'rfE', refundError: null }, null, 'refund_unconfirmed', false],
      [{ status: 'refunded', refundId: 'rfE', refundError: null }, null, FINANCIAL_VERIFICATION, null],
      // Round 12: only arbitrateClaim's refusal (which records the decision) reads as « refused ».
      // ROUND 13 (F02): « Refus confirmé » needs the restaurant's own refusal on record.
      [{ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }, null, 'refused_final'],
      [{ status: 'refused_final', arbitrationDecision: 'refused_final' }, null, 'refused_by_grubano'],
      [{ status: 'restaurant_review' }, null, 'restaurant_review'],
    ]
    for (const [c, confirmed, want, refundedRow] of T) expect(customerClaimStatus(c, confirmed, refundedRow ?? null), `${JSON.stringify(c)} ${confirmed} ${refundedRow}`).toBe(want)
  })

  it('the customer list carries the derived status and none of the internal recovery fields', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'a', status: 'refunding', refundId: 'rfA', refundError: null, refundAttempted: true, activeOrderKey: 'o1', arbitratedBy: null },
      { id: 'b', status: 'refunding', refundId: 'rfB', refundError: null, refundAttempted: true, activeOrderKey: 'o2', arbitratedBy: null },
      { id: 'c', status: 'approved', refundId: null, refundError: 'engine_failed: Erreur paiement', refundAttempted: true, activeOrderKey: 'o3', arbitratedBy: 'op1' },
      { id: 'd', status: 'refunding', refundId: null, refundError: MARKER, refundAttempted: true, activeOrderKey: 'o4', arbitratedBy: null },
      { id: 'e', orderId: 'o5', status: 'refunded', refundId: 'rfE', refundError: null, refundAttempted: true, activeOrderKey: null, arbitratedBy: null },
    ])
    // Round 11: « en cours » needs the bound row PENDING and recorded at Stripe — the row read carries its status.
    // ROUND 13 (F03): « Remboursée » needs the settled claim's bound row proven (same order, succeeded, amount > 0).
    db.refund.findMany.mockResolvedValue([
      { id: 'rfA', status: 'pending', stripeRefundId: 're_A' }, { id: 'rfB', status: 'pending', stripeRefundId: null },
      { id: 'rfE', orderId: 'o5', status: 'succeeded', amountCents: 500, stripeRefundId: 're_E' },
    ])
    const out = await listConsumerClaims('u1')
    expect(out.map((c) => [c.id, c.status])).toEqual([
      ['a', 'refunding'], ['b', FINANCIAL_VERIFICATION], ['c', FINANCIAL_VERIFICATION], ['d', FINANCIAL_VERIFICATION], ['e', 'refunded'],
    ])
    for (const c of out) for (const k of ['refundError', 'refundId', 'refundAttempted', 'activeOrderKey', 'arbitratedBy']) expect(c, `${c.id} ${k}`).not.toHaveProperty(k)
  })

  it('eligibility derives the status too, the help page reads the review state as a review, and every locale has its line', () => {
    expect(read('lib/claims.ts')).toContain('status: customerClaimStatus(existing, existingBoundConfirmed, existingRefundedRow)')
    expect(read('app/[locale]/eat/order/[orderId]/help/page.tsx')).toContain("if (ex.status === 'financial_verification') return t('claimInReview')")
    for (const loc of LOCALES) expect(typeof JSON.parse(read(`messages/${loc}.json`)).claims.status.financial_verification, loc).toBe('string')
  })

  it('the requested-amount line promises no delay, in any locale', () => {
    for (const loc of LOCALES) {
      const v = JSON.parse(read(`messages/${loc}.json`)).eat.help.refundEstimate as string
      expect(v, loc).toContain('<b>{amount} €</b>')
      expect(v, loc).not.toMatch(/3[–-]5|jours|days|días|giorni|أيام/)
    }
  })
})

// ══ CENSUS — nonTerminal from the library's terminal set ═════════════════════════════════
describe('CENSUS — nonTerminal is the total minus the library’s terminal set', () => {
  it('a refused claim — and a status in NO hand-picked list — is counted; every filtered count is evaluated', async () => {
    // Round 11 (round-10 audit, P3): the fixture returned 0 for every filtered count and could not tell
    // total − TERMINAL from another formula. Counts are now evaluated over a row fixture.
    const R = (status: string, o: Record<string, unknown> = {}) => ({ status, refundId: null, refundError: null, responseDeadlineAt: FUTURE, ...o })
    const ROWS = [
      R('refused'), R('refused'), R('refunded', { refundId: 'rf' }), R('refunded', { refundId: 'rf' }), R('refunded', { refundId: 'rf' }),
      R('refused_final'), R('arbitration'), R('legacy_unknown'), R('refunding', { refundError: MARKER }), R('restaurant_review', { responseDeadlineAt: PAST }),
    ]
    db.claim.count.mockImplementation(async (args?: { where?: Record<string, unknown> }) =>
      ROWS.filter((r) => !args?.where || matchWhere(args.where, r)).length)
    db.claim.groupBy.mockImplementation(async () =>
      Object.entries(ROWS.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m }, {}))
        .map(([status, _count]) => ({ status, _count })))
    const res = await CENSUS(new Request('https://app.grubano.com/api/admin/claims/census') as never)
    expect(res.status).toBe(200)
    const c = (await res.json()).claims
    expect(c.total).toBe(10)
    expect(c.nonTerminal).toBe(6) // refused ×2, arbitration, legacy_unknown, refunding, restaurant_review
    expect(c.active).toBe(3)      // arbitration, refunding, restaurant_review
    expect([c.refunding, c.reconcileMarked, c.arbitration, c.restaurantReview, c.silenceExpired, c.t49Shape]).toEqual([1, 1, 1, 1, 1, 0])
    expect(c.byStatusMeasured).toBe(true)
  })

  it('NEGATIVE CONTROL — the round-9 formula is gone', () => {
    expect(stripComments(read('app/api/admin/claims/census/route.ts'))).not.toMatch(/nonTerminal:\s*active/)
  })
})

// ══ ENGINE FAILURE — the own-row query and a stale read (round-9 P3) ═════════════════════
describe('ENGINE FAILURE — the own-row query honours its clauses, and a stale read writes nothing', () => {
  // ROUND 13 (C3/C5): T2 reads fresh facts before the engine; the rows below are created BY the engine call.
  let w: World
  const refusal = { ok: false, status: 502, error: 'Erreur paiement, réessayez.' }
  beforeEach(() => {
    refundsFlag.mockReturnValue(true)
    w = payableWorld()
    wireWorld(w, db, stripeMock)
  })

  it('the NEWEST row stamped for THIS claim decides — not an older one, not another claim’s', async () => {
    const ROWS = [
      refundRow('rf_old_failed', { reason: claimRefundReason('cl1'), status: 'failed', createdAt: new Date(1000) }),
      refundRow('rf_new_pending', { reason: claimRefundReason('cl1'), status: 'pending', createdAt: new Date(2000) }),
      refundRow('rf_other_newest', { reason: claimRefundReason('cl_OTHER'), status: 'failed', createdAt: new Date(3000) }),
    ]
    execMock.mockImplementation(async () => { w.refunds.push(...ROWS); return refusal })
    await triggerClaimRefund('cl1')
    expect(claimOf(w).status).toBe('refunding')
    expect(String(claimOf(w).refundError)).toContain('rf_new_pending')
    expect(db.claim.update).not.toHaveBeenCalled()
    expect(matchWhere({ orderId: 'o1' }, ROWS[0])).toBe(true)
  })

  it('a stale read of the marker writes nothing: the append is keyed on the attempt token T1 wrote (C5)', async () => {
    execMock.mockImplementation(async () => {
      w.refunds.push(refundRow('rf_own', { reason: claimRefundReason('cl1'), status: 'pending' }))
      claimOf(w).refundError = `${RECONCILE_REQUIRED}: an OLDER marker`
      return refusal
    })
    await triggerClaimRefund('cl1')
    expect(claimOf(w).status).toBe('refunding')
    expect(String(claimOf(w).refundError)).not.toContain('Moteur :')
    expect(db.claim.update).not.toHaveBeenCalled()
  })
})

// ══ ROUND-10 SOURCE PINS ═════════════════════════════════════════════════════════════════
describe('round-10 source pins', () => {
  it('the arbitration console enables each decision on the server’s verdict — no hand-picked flag', () => {
    const arb = read('components/claims/AdminClaimsArbitration.tsx')
    expect(arb).toContain('disabled={c.approveRefusal != null}')
    expect(arb).toContain('disabled={busyId === c.id || c.refuseFinalRefusal != null}')
    expect(stripComments(arb)).not.toContain('railLocked === true')
  })

  it('arbitrateClaim keeps no pre-check of its own beside the shared rule', () => {
    const src = stripComments(read('lib/claims.ts'))
    const body = src.slice(src.indexOf('export async function arbitrateClaim'), src.indexOf('export type ConsumerClaimStats'))
    expect(body).toContain('arbitrationRefusal(claim, input.decision, now)')
    for (const msg of ['décision définitive', 'arbitrage prématuré', 'n’est pas en arbitrage', 'ne peut plus être refusée', 'Approbation impossible']) {
      expect(body, msg).not.toContain(msg)
    }
  })

  it('the reconcile route’s gate is the shared rule', () => {
    const src = stripComments(read('lib/claims.ts'))
    const body = src.slice(src.indexOf('export async function reconcileClaimEvidence'), src.indexOf('export async function recoverStrandedClaimReconciliations'))
    // ROUND 13 (B8 slice W2; G1 (iii) slice W5): the same shared rule, with the bound row it reads — for EVERY claim, the
    // settled one included (G2 (1) → R0).
    expect(body).toContain('const gate = reconcileRefusal({ ...claim, boundRow })')
    expect(body).not.toContain('legacyStranded')
  })

  it('the financial-verification card offers reconcile and the declaration close on the server’s own flags', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    // ROUND 13 (D0 / D14 / D5, W3 round-1 fix): the reconcile control follows the server's reconcilable flag on EVERY
    // bucket (a reconcile_required row whose marker instant is unreadable is refused by the gate), and a refused
    // reconcile renders the server's refusal text instead of a control.
    const code = stripComments(fv)
    expect(code).toContain('{r.reconcilable === true && (')
    expect(code).toContain('{r.reconcilable !== true && r.reconcileRefusal && (')
    // NEGATIVE CONTROL — the bucket-wide admissions that rendered a control the server refuses are gone.
    expect(code).not.toContain("r.kind !== 'other_unsettled' || r.reconcilable === true")
    expect(code).not.toContain("r.kind === 'financial_verification' || r.reconcilable === true")
    expect(fv).toContain("{r.kind === 'other_unsettled' && r.resolvable === true && (")
    expect(fv).toContain('`/api/admin/claims/${id}/resolve-stuck`')
  })
})

// ══ ROUND 13 (slice W7) — J-C17 (F14, F15, A-S36-1, A-S24-1): the card's reconcile toasts, money labels and guidance ════
// The toasts are the pure reconcileToast (lib/claim-console-copy) the card calls; the expected values are read out of the
// frozen specification (F14, G10), so neither side can drift by a hand-copied table.
describe('J-C17 — reconcile toasts equal F14 verbatim, split by outcome, with their tone', () => {
  const quoted = (id: string) => {
    const out: Record<string, string> = {}
    for (const line of specSection(id)) {
      const m = /^\s*- (.+?): « (.*) »$/.exec(line)
      if (m) out[m[1]] = m[2]
    }
    return out
  }
  const F14 = quoted('F14')
  const G10 = quoted('G10')
  const ISO = '2026-09-12T13:00:00.000Z'
  const fmt = (iso: string) => `<${iso}>`

  it('every F14 value is read from the specification (the parser found them)', () => {
    for (const k of ["refunded, evidence 'stripe_read'", 'refunded, otherwise', 'no_refund_proven (v13 only)', 'no_refund_proven_rail_locked', 'awaiting_finalization', 'refund_failed', 'engine_row_dead', "stripeStatus 'succeeded'", "'pending' or 'requires_action'"]) {
      expect(F14[k], k).toBeTruthy()
    }
    expect(G10.reverted_after_refund).toBeTruthy()
  })

  it('said values: F14 verbatim (rail_locked with the ER-R27 qualifier; reverted_after_refund with G10’s wording, W5 note)', async () => {
    const { reconcileToast } = await import('@/lib/claim-console-copy')
    const t = (r: Record<string, string>) => reconcileToast(r, fmt).text
    expect(t({ outcome: 'refunded', evidence: 'stripe_read' })).toBe(F14["refunded, evidence 'stripe_read'"])
    expect(t({ outcome: 'refunded' })).toBe(F14['refunded, otherwise'])
    expect(t({ outcome: 'no_refund_proven', payableFrom: ISO })).toBe(F14['no_refund_proven (v13 only)'].replace('${payableFrom}', ISO))
    expect(t({ outcome: 'no_refund_proven_rail_locked' })).toBe(F14.no_refund_proven_rail_locked.replace('aucun remboursement non expliqué', 'aucun remboursement abouti ou en attente non expliqué'))
    expect(t({ outcome: 'no_refund_proven_awaiting_finalization' })).toBe(F14.awaiting_finalization)
    expect(t({ outcome: 'refund_failed' })).toBe(F14.refund_failed)
    expect(t({ outcome: 'engine_row_dead' })).toBe(F14.engine_row_dead)
    expect(t({ outcome: 'reverted_after_refund' })).toBe(G10.reverted_after_refund)
    expect(t({ outcome: 'reverted_after_refund' }).toLowerCase()).toContain('quand les réclamations sont ouvertes')
    expect(t({ outcome: 'refund_still_standing', stripeStatus: 'succeeded' })).toBe(F14["stripeStatus 'succeeded'"])
    for (const s of ['pending', 'requires_action']) expect(t({ outcome: 'refund_still_standing', stripeStatus: s }), s).toBe(F14["'pending' or 'requires_action'"])
  })

  it('no_refund_proven renders payableFrom, or « instant illisible — relancez la réconciliation » when absent', async () => {
    const { reconcileToast } = await import('@/lib/claim-console-copy')
    expect(reconcileToast({ outcome: 'no_refund_proven', payableFrom: ISO }).text).toContain(`au plus tôt le ${ISO} (UTC)`)
    const absent = reconcileToast({ outcome: 'no_refund_proven' }).text
    expect(absent).toContain('instant illisible — relancez la réconciliation')
    expect(absent).not.toContain('undefined')
  })

  it('refund_still_standing not_at_stripe_yet reuses the unconfirmed_within_window toast with its date — never « toujours ABOUTI ou en attente »', async () => {
    const { reconcileToast } = await import('@/lib/claim-console-copy')
    const notYet = reconcileToast({ outcome: 'refund_still_standing', stripeStatus: 'not_at_stripe_yet', until: ISO }, fmt)
    expect(notYet.text).toBe(reconcileToast({ outcome: 'unconfirmed_within_window', until: ISO }, fmt).text)
    expect(notYet.text).toContain(`Conclusion possible à partir du <${ISO}>`)
    expect(notYet.needsAttention).toBe(true)
    for (const s of ['not_at_stripe_yet', 'weird', undefined]) {
      expect(reconcileToast({ outcome: 'refund_still_standing', stripeStatus: s }).text, String(s)).not.toContain('toujours ce remboursement ABOUTI ou en attente')
    }
  })

  it('needsAttention ⊇ {no_refund_proven_rail_locked, awaiting_finalization, reverted_after_refund}; refunded and still-standing succeeded are success; an unknown outcome is never a success', async () => {
    const { reconcileToast } = await import('@/lib/claim-console-copy')
    for (const outcome of ['no_refund_proven_rail_locked', 'no_refund_proven_awaiting_finalization', 'reverted_after_refund', 'refund_failed', 'engine_row_dead', 'changed_during_read', 'financial_verification', 'refunded_row_unproven']) {
      expect(reconcileToast({ outcome }).needsAttention, outcome).toBe(true)
    }
    expect(reconcileToast({ outcome: 'refunded', evidence: 'stripe_read' }).needsAttention).toBe(false)
    expect(reconcileToast({ outcome: 'refund_still_standing', stripeStatus: 'succeeded' }).needsAttention).toBe(false)
    const unknown = reconcileToast({ outcome: 'a_new_outcome' })
    expect(unknown).toEqual({ text: 'Réponse inattendue : rien n’est confirmé. Relisez sa ligne dans la file.', needsAttention: true })
  })

  it('C9 / A-S29-3: a lost compare-and-set renders what the server returned — the row this action bound, or the A-S29-3 text', async () => {
    const { reconcileToast } = await import('@/lib/claim-console-copy')
    expect(reconcileToast({ outcome: 'changed_during_read', boundRowId: 'rf_77' }).text).toContain('la ligne rf_77')
    expect(reconcileToast({ outcome: 'changed_during_read' }).text).toBe(quoted('A-S29-3').ADMIN ?? 'La réclamation ou les lignes de remboursement de sa commande ont changé pendant la lecture : rien n’a été écrit. Relisez sa ligne, puis relancez si la réconciliation est encore proposée.')
  })

  it('NEGATIVE CONTROL — the HEAD toasts « le moteur refusera tout remboursement », « redevient traitable », « rien ne sera payé par Grubano » and « toujours ABOUTI ou en attente » for not_at_stripe_yet are caught; no shipped toast carries one', async () => {
    const { reconcileSaid } = await import('@/lib/claim-console-copy')
    const HEAD = /le moteur refusera tout remboursement|redevient traitable|rien ne sera payé par Grubano|jamais déplacé/i
    expect(HEAD.test('Preuve trouvée : Stripe rapporte cette ligne de remboursement ÉCHOUÉE. La réclamation redevient traitable.')).toBe(true)
    expect(HEAD.test('elle n’a rien versé, et rien ne sera payé par Grubano pour cette réclamation.')).toBe(true)
    for (const r of [{ outcome: 'x' }, { outcome: 'x', payableFrom: ISO }, { outcome: 'x', stripeStatus: 'not_at_stripe_yet' }]) {
      for (const [k, v] of Object.entries(reconcileSaid(r))) {
        expect(HEAD.test(v), k).toBe(false)
        if (r.stripeStatus === 'not_at_stripe_yet' && k === 'refund_still_standing') expect(v).not.toContain('toujours ce remboursement ABOUTI ou en attente')
      }
    }
  })

  it('the attribute and adopt handlers render body.error for every 409; attribution success only on refunded', () => {
    const fv = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
    expect(fv).toContain("if (!res.ok) { toast.error((body as { error?: string }).error || 'Attribution refusée.'); return }")
    expect(fv).toContain("toast.error(body.error || (dryRun ? 'Vérification refusée.' : 'Liaison refusée.'))")
    expect(fv).toContain("if (result?.outcome !== 'refunded') {")
  })
})

describe('J-C17 (F15) — money state classification: legacy proof → reconcile_required, v13 → absence_proven_payable, rail_locked → refund_error_recorded', () => {
  it('listActionableRefundClaims classifies the three proof shapes', async () => {
    const at = '2026-09-12T13:00:00.000Z'
    db.refund.findMany.mockResolvedValue([])
    db.claim.findMany.mockResolvedValue([
      { id: 'legacy', orderId: 'o1', reason: 'wrong_item', status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven: aucun remboursement …', createdAt: new Date() },
      { id: 'v13', orderId: 'o1', reason: 'wrong_item', status: 'approved', refundAttempted: false, refundId: null, refundError: `${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le ${at} (UTC).`, createdAt: new Date() },
      { id: 'rail', orderId: 'o1', reason: 'wrong_item', status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven_rail_locked: x', createdAt: new Date() },
    ])
    const byId = Object.fromEntries((await listActionableRefundClaims()).map((l) => [l.id, l.moneyState]))
    expect(byId).toEqual({ legacy: 'reconcile_required', v13: 'absence_proven_payable', rail: 'refund_error_recorded' })
    // NEGATIVE CONTROL: the legacy proof is never absence_proven_payable
    expect(byId.legacy).not.toBe('absence_proven_payable')
  })

  it('guidance equals F15 (with ER-R27, text v1.1 — D′ L2), and absence_proven_payable says « au plus tôt »', () => {
    expect(moneyStateGuidance('absence_proven_payable')).toContain('au plus tôt')
    expect(moneyStateGuidance('approved_not_driven')).toBe('Approuvée, en attente de paiement. Elle ne se paie que par le rail financier (« Payer les approuvées », session admin, remboursements ouverts), et seulement si la vérification avant moteur le permet à ce moment  ; une ré-approbation ne paie jamais. Aucune clôture manuelle sur cet état.')
    // NEGATIVE CONTROL: the v1 line named the arbitration queue's approval as the way to be paid — it is gone, and no
    // F15 line names a re-approval any more.
    const V1_APPROVED_NOT_DRIVEN = 'Approuvée, jamais payée. Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts, et seulement si la vérification avant moteur le permet à ce moment. Aucune clôture manuelle sur cet état.'
    expect(moneyStateGuidance('approved_not_driven')).not.toBe(V1_APPROVED_NOT_DRIVEN)
    for (const s of ['approved_not_driven', 'absence_proven_payable']) {
      expect(moneyStateGuidance(s), s).not.toMatch(/approuvez-la à nouveau|nouvelle approbation|approbation admin \(file d’arbitrage\)/)
      expect(moneyStateGuidance(s), s).toContain('Payer les approuvées')
    }
  })
})
