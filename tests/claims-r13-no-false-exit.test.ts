// tests/claims-r13-no-false-exit.test.ts — T-49 round 13, J-M28 (D1, D2 (1), D14, G9, A-S00)
//
// HARD INVARIANT: no exit is offered that the engine would refuse. D′ L2 (spec v2 T-07/T-08, S-02; R13 v1.1 D1/E-10)
// split the exits of an approved claim: 'ratify' is a DECISION (amount not fixed — never money, never the engine),
// 'pay' is the financial rail (amount fixed — the L5 rail runs T1 → T2 → the engine), 'approve' is the decision exit of
// arbitration / silence-expired claims only. In the pure layer the invariant reads:
//   – 'approve' is never offered on an approved claim; 'ratify' reaches nothing (the last describe proves it);
//   – the rail's money path (T1 → T2 → engine) admits only a pre-image T1 re-derives (null or a v13 proof past its
//     instant), and T2 calls the engine only when its derivation on the fresh facts is payable — which the mirror says
//     the engine accepts (ER-M05: the approved-null states of D1 row 1 are ratifiable, and T2 blocks before the engine);
//   – an empty, decision-only or gated-only exit set names its registry entry; no refusal text carries a false exit.
// ROUND 13 (slice W8, W2 carry-over) → D′ L2: the last describe runs the decision (arbitrateClaim, which reaches NOTHING)
// and then the rail's money path by hand (the DIRECT triggerClaimRefund → T1 → T2 → the REAL lib/refund.ts executeRefund)
// on every J-M01 fixture world, with every pre-image D1 knows, both leases open, and scans every text the run renders
// (detail, decision toast, rail toast, refusal, MONEY label, GUIDANCE, customer status, reconcile toast).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, stripeMock, lease, engineSpy, ledgerMock } = vi.hoisted(() => ({
  db: {
    claim:            { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund:           { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    order:            { findUnique: vi.fn(), findMany: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dispute:          { aggregate: vi.fn() },
    payout:           { findUnique: vi.fn() },
    emailDispatch:    { create: vi.fn(), findFirst: vi.fn() },
  },
  stripeMock: {
    paymentIntents:  { retrieve: vi.fn() },
    refunds:         { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    transfers:       { list: vi.fn(), listReversals: vi.fn(), createReversal: vi.fn() },
    applicationFees: { listRefunds: vi.fn() },
  },
  /** The REFUNDS lease as triggerClaimRefund reads it: closed for the pure blocks, open for the engine run (J-M28 FIXTURE). */
  lease: { refunds: false },
  /** executeRefund is the REAL engine behind a spy (W8): every call and its answer are recorded. */
  engineSpy: { fn: vi.fn(), real: null as null | ((input: { orderId: string; amountCents: number; reason?: string }) => Promise<Record<string, unknown>>) },
  ledgerMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/refund')>()
  engineSpy.real = real.executeRefund as unknown as typeof engineSpy.real
  return { ...real, executeRefund: (input: Parameters<typeof real.executeRefund>[0]) => engineSpy.fn(input), isRefundsEnabled: () => lease.refunds }
})
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: ledgerMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  acceptedExits, arbitrationRefusal, exitRegistry, deriveNoRowOutcome, engineRefusalOnReapproval,
  APPROVE_LEGACY_PROOF, approveRevisableText, approvePermanentText, MARKERS, moneyStateGuidance, absenceProvenPayableLabel,
  HEAD_A, customerClaimStatus, boundRowShowsInProgress, refundedRowTruth, APPROVE_CONFIRM_WORD, APPROVE_ALREADY_SET,
  type ClaimFacts, type ReapprovalFacts, type MoneyRow, type ExitInput, type Refusal, type BoundRowFacts,
} from '@/lib/claim-action-rules'
import { reconcileClaimEvidence, resolveStuckClaim, listActionableRefundClaims, arbitrateClaim, triggerClaimRefund } from '@/lib/claims'
import { approvalToast } from '@/lib/claim-approval-toast'
import { reconcileToast } from '@/lib/claim-console-copy'
import { payableWorld, claimOf } from './support/claims-world'
import { wireEngineWorld, type EngineWorld } from './support/claims-engine-world'
import { STATES, stateOf, ENGINE_QUOTES, type StateEntry, type EngineStep, type EngineAnswer, type ResumeAnswer } from './fixtures/claims-r13-states'

const T0 = new Date('2026-09-12T08:00:00.000Z')
const INSTANT = new Date(T0.getTime() + 3_600_000)
/** J-M28: both leases open, now = max(Q-INSTANT, until) + margin. */
const NOW = new Date(T0.getTime() + 3 * 3_600_000)
const V13 = `${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${INSTANT.toISOString()} (UTC).`
const RAIL = (why: string) => `no_refund_proven_rail_locked: … ${why} …`

const base = (o: Partial<ReapprovalFacts> = {}): ReapprovalFacts => ({
  orderId: 'o', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded',
  chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 0,
  routed: false, royaltyStatus: null, stripeListLength: 0, rows: [], L: [], truths: {}, binders: {}, stampedClaims: {},
  succeededNotCounted: [], rowContradictions: [], ...o,
})
const row = (id: string, o: Partial<MoneyRow> = {}): MoneyRow => ({
  id, status: 'succeeded', amountCents: 300, stripeRefundId: `re_${id}`, reason: null, idempotencyKey: `refund:o:k_${id}`, createdAt: T0, royaltyRefundCents: 0, ...o,
})
const approved = (refundError: string | null, o: Partial<ClaimFacts> = {}): ClaimFacts =>
  ({ id: 'cl1', orderId: 'o', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError, ...o })
const reverted = { rowId: 'rf_o', how: 'reverted' as const, refundId: 're_O', stripeStatus: 'failed' }

type State = { id: string; claim: ClaimFacts; facts: ReapprovalFacts }
const PURE_STATES: State[] = [
  { id: 'A-S01', claim: approved(V13), facts: base() },
  { id: 'A-S01b', claim: approved(RAIL('E6')), facts: base({ rows: [row('rf_f', { status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o:0' })] }) },
  { id: 'A-S03', claim: approved(RAIL('E6 + H1')), facts: base({ rows: [row('rf_o', { stripeRefundId: 're_O', idempotencyKey: 'refund:o:0' })], succeededNotCounted: [reverted] }) },
  { id: 'A-S04', claim: approved(RAIL('H1')), facts: base({ rows: [row('rf_o', { stripeRefundId: 're_O', idempotencyKey: 'refund:o:500' })], succeededNotCounted: [reverted] }) },
  { id: 'A-S08a', claim: approved(RAIL('H2')), facts: base({ routed: true, L: [{ id: 're_D', status: 'failed', amount: 300, charge: 'ch_1', metadata: {} }] }) },
  {
    id: 'A-S26', claim: approved(RAIL('E4')),
    facts: base({ amountRefundedCents: 2000, rows: [row('rf_x', { stripeRefundId: 're_X', amountCents: 2000 })], L: [{ id: 're_X', status: 'succeeded', amount: 2000, charge: 'ch_1', metadata: {} }], binders: { rf_x: [{ id: 'cl_X', status: 'refunded', refundError: null, refundId: 'rf_x' }] } }),
  },
  { id: 'A-S30', claim: approved(`${MARKERS.SAFETY_HOLD} …`, { refundAttempted: true }), facts: base({ chargeDisputed: true }) },
  { id: 'A-S39', claim: approved(RAIL('H5')), facts: base({ chargeDisputed: true }) },
  { id: 'A-S32-1', claim: approved('no_refund_proven: …'), facts: base({ rows: [row('rf_o', { stripeRefundId: 're_O', idempotencyKey: 'refund:o:0' })], succeededNotCounted: [reverted] }) },
  { id: 'A-S06b', claim: approved('stripe_failed: …', { refundAttempted: true, refundId: 'rf1' }), facts: base({ rows: [row('rf1', { status: 'failed', stripeRefundId: 're_1' })] }) },
  { id: 'A-S24-1', claim: approved(`${MARKERS.STRIPE_REVERTED} …`, { refundAttempted: true, refundId: 'rf1' }), facts: base({ rows: [row('rf1', { stripeRefundId: 're_1', idempotencyKey: 'refund:o:0' })], succeededNotCounted: [{ ...reverted, rowId: 'rf1', refundId: 're_1' }] }) },
  {
    id: 'A-S10b', claim: approved(`${MARKERS.AWAITING_FINALIZATION} …`),
    facts: base({
      amountRefundedCents: 300, rows: [row('rf_A', { status: 'pending', stripeRefundId: null, reason: 'claim:cl_A' })],
      L: [{ id: 're_A', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: { grubano_refund_row: 'rf_A' } }],
      truths: { rf_A: { kind: 'at_stripe', refundId: 're_A', status: 'succeeded' } },
      binders: { rf_A: [{ id: 'cl_A', status: 'refunded', refundError: null, refundId: 'rf_A' }] },
    }),
  },
  { id: 'A-S12', claim: approved(null), facts: base({ rows: [row('rp', { status: 'pending', stripeRefundId: null })], truths: { rp: { kind: 'absent_within_window', until: new Date(T0.getTime() + 7_200_000) } } }) },
  { id: 'A-S30e-1', claim: approved(null), facts: base({ rows: [row('rp', { status: 'pending', stripeRefundId: null })], truths: { rp: { kind: 'absent_dead' } } }) },
  { id: 'A-S38-1', claim: approved(V13), facts: base({ amountRefundedCents: 300, L: [{ id: 're_D', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: {} }] }) },
  { id: 'A-S38-2', claim: approved(V13), facts: base({ amountRefundedCents: 1800, L: [{ id: 're_D', status: 'succeeded', amount: 1800, charge: 'ch_1', metadata: {} }] }) },
]
const state = (id: string) => PURE_STATES.find((s) => s.id === id)!

const FORBIDDEN = ['payable à nouveau', 'à nouveau payable', 'de nouveau payable', 'peut maintenant être rembours', 'relancez le remboursement', 'réessayez le remboursement', 'sera remboursée', 'sera payée', 'jamais déplacé', 'n’a déplacé d’argent', 'Absence de remboursement PROUVÉE']
type ExitsFn = (i: ExitInput) => string[]
type RefusalFn = (c: ClaimFacts, d: 'approve' | 'refuse_final', now: Date) => Refusal | null

/** T1 (C2) admits a pre-image only when it is null or a v13 proof (past its instant); every other recorded error is refused there. */
const t1Admits = (c: ClaimFacts) => c.refundError === null || (typeof c.refundError === 'string' && c.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13))
const t2Runs = t1Admits
type T2PayableFn = (s: State) => boolean
const t2Payable: T2PayableFn = (s) => {
  const o = deriveNoRowOutcome({ readable: true, facts: s.facts }, s.claim.id!)
  return o.kind === 'proof' && o.basis === 'verdict' && o.verdict === 'payable'
}
/** D1 v1.1: the money exit of an approved claim is 'pay', offered once its amount is fixed (never in these fixtures as they stand). */
const withAmount = (c: ClaimFacts): ClaimFacts => ({ ...c, approvedAmountCents: 500 })
const DECISION_EXITS = ['approve', 'ratify', 'refuse_final']

/**
 * The invariant, as a checker (D1 v1.1): the empty list means no exit reaches an engine refusal.
 *   – 'approve' never on an approved claim; 'ratify' is a decision (no money), so no engine condition applies to it;
 *   – 'pay' (the rail, amount fixed) runs T1 → T2 → the engine: T1 refuses every recorded pre-image but null / v13, and T2
 *     calls the engine only on a payable derivation — so an engine refusal is reachable only if T2 says payable while the
 *     mirror says the engine refuses (the one violation), or if 'pay' were offered on a state neither T1 nor T2 blocks.
 */
function violations(s: State, exitsFn: ExitsFn = acceptedExits, refusalFn: RefusalFn = arbitrationRefusal, t2PayableFn: T2PayableFn = t2Payable): string[] {
  const out: string[] = []
  const exits = exitsFn({ claim: s.claim, now: NOW })
  const refusal = refusalFn(s.claim, 'approve', NOW)
  const engineAccepts = engineRefusalOnReapproval(s.facts) === null
  if (s.claim.status === 'approved' && exits.includes('approve')) out.push('approve offered on an approved claim (D1 v1.1: ratify or pay, never a re-approval)')
  // the rail's money exit, as the table offers it once the amount is fixed
  const payOffered = exitsFn({ claim: withAmount(s.claim), now: NOW }).includes('pay')
  if (payOffered && t1Admits(s.claim) && t2PayableFn(s) && !engineAccepts) out.push('T2 would call an engine that refuses')
  if (payOffered && !engineAccepts) {
    const t1Refuses = !t1Admits(s.claim)
    const t2Blocks = t1Admits(s.claim) && !t2PayableFn(s)
    if (!t1Refuses && !t2Blocks) out.push('the engine refuses, and pay is neither refused by T1 nor blocked by T2')
  }
  // a ratification with a refusal is the D3 REVISABLE row only (a v13 proof before its instant, refused by the C4 instant text)
  if (exits.includes('ratify') && refusal !== null && !refusal.error.startsWith('Approbation prématurée')) out.push('ratify offered with a refusal that is not the C4 premature text')
  if (exits.every((x) => DECISION_EXITS.includes(x)) && exitRegistry({ claim: s.claim, now: NOW }) === null) out.push('empty, decision-only or gated-only set without a registry entry')
  const text = refusal?.error ?? ''
  if (FORBIDDEN.some((p) => text.toLowerCase().includes(p.toLowerCase()))) out.push('forbidden phrase in the refusal')
  return out
}

describe('J-M28 — HARD INVARIANT: no exit offered that the engine would refuse', () => {
  for (const s of PURE_STATES) {
    it(`${s.id}: no violation`, () => {
      expect(violations(s)).toEqual([])
    })
  }

  it('D1 v1.1 + D′ L4 control parity — approve never offered on an approved claim; with the amount fixed, pay is offered ONLY when T1 would attempt and withdraw ONLY when the reversal would be accepted', () => {
    for (const s of PURE_STATES) {
      expect(acceptedExits({ claim: s.claim, now: NOW }), s.id).not.toContain('approve')
      expect(acceptedExits({ claim: s.claim, now: NOW }), s.id).not.toContain('pay')
      const fixed = acceptedExits({ claim: withAmount(s.claim), now: NOW })
      expect(fixed, s.id).not.toContain('ratify')
      expect(fixed, s.id).not.toContain('approve')
      // THE PARITY RULE (D0, the reason this file exists): an offered exit is one a server ACCEPTS.
      // 'pay' ⇔ T1 would attempt this pre-image; 'withdraw' ⇔ §4 precondition 1 holds. A recorded money
      // state (a taken attempt, a bound row, a lock, a failure) removes BOTH — the console must never
      // render a control the rail and the reversal would both refuse. Before the D′ L4 parity fix this
      // branch offered them unconditionally, which is the Class-3 divergence this file exists to catch.
      const c = withAmount(s.claim) as { refundError?: string | null; refundAttempted?: boolean; refundId?: string | null; approvedAmountCents?: number | null }
      const noMoneyState = c.refundAttempted !== true && (c.refundId ?? null) === null
      const v13OrLocked = c.refundError != null
        && (String(c.refundError).startsWith('no_refund_proven:v13:') || String(c.refundError).startsWith('no_refund_proven_rail_locked'))
      const payable = noMoneyState && (c.refundError == null || t1Admits(withAmount(s.claim)))
      const reversible = noMoneyState && (c.refundError == null || v13OrLocked)
      expect(fixed.includes('pay'), s.id + ': pay offered iff T1 would attempt').toBe(payable)
      expect(fixed.includes('withdraw'), s.id + ': withdraw offered iff the reversal would be accepted').toBe(reversible)
      // NEGATIVE CONTROL — the pre-fix table said « withdraw, pay » for every fixed amount; on a state
      // carrying a recorded money state that set disagrees with both servers, and is no longer produced.
      if (!noMoneyState || (c.refundError != null && !v13OrLocked)) {
        expect(fixed, s.id).not.toContain('pay')
        expect(fixed, s.id).not.toContain('withdraw')
      }
    }
  })

  it('A-S01: ratifiable past its instant (a decision, never approve); the rail\'s T2 re-derives payable; the mirrored engine accepts', () => {
    const s = state('A-S01')
    const exits = acceptedExits({ claim: s.claim, now: NOW })
    expect(exits).toContain('ratify')
    expect(exits).not.toContain('approve')
    expect(arbitrationRefusal(s.claim, 'approve', NOW)).toBeNull()
    expect(t1Admits(s.claim)).toBe(true)
    expect(t2Payable(s)).toBe(true)
    expect(engineRefusalOnReapproval(s.facts)).toBeNull()
  })

  it('A-S01b, A-S03, A-S32-1 and A-S26 are never approvable nor ratifiable, at any instant; T1 refuses their pre-image', () => {
    for (const id of ['A-S01b', 'A-S03', 'A-S32-1', 'A-S26']) {
      const s = state(id)
      for (const now of [T0, INSTANT, NOW]) {
        const exits = acceptedExits({ claim: s.claim, now })
        expect(exits, `${id} @${now.toISOString()}`).not.toContain('approve')
        expect(exits, `${id} @${now.toISOString()}`).not.toContain('ratify')
        expect(arbitrationRefusal(s.claim, 'approve', now), `${id} @${now.toISOString()}`).not.toBeNull()
      }
      expect(engineRefusalOnReapproval(s.facts), id).not.toBeNull()
      expect(t1Admits(s.claim), id).toBe(false)
    }
  })

  it('A-S04, A-S08a, A-S30 and A-S39 (engine YES, holds) are refused Claims-side by D14 (2)', () => {
    for (const id of ['A-S04', 'A-S08a', 'A-S30', 'A-S39']) {
      const s = state(id)
      expect(engineRefusalOnReapproval(s.facts), id).toBeNull()
      expect(arbitrationRefusal(s.claim, 'approve', NOW)?.error, id).toBe(approveRevisableText(true))
    }
  })

  it('A-S06b and A-S24-1 are refused PERMANENT (3); A-S10b REVISABLE (2)', () => {
    expect(arbitrationRefusal(state('A-S06b').claim, 'approve', NOW)?.error).toBe(approvePermanentText(true))
    expect(arbitrationRefusal(state('A-S24-1').claim, 'approve', NOW)?.error).toBe(approvePermanentText(true))
    expect(arbitrationRefusal(state('A-S10b').claim, 'approve', NOW)?.error).toBe(approveRevisableText(true))
  })

  it('ER-M05 (D1 v1.1): the approved-null and stale-v13 states whose engine refuses are RATIFIABLE (a decision, not a money exit — the engine-refusal invariant does not apply to it), and the rail\'s T2 blocks before the engine', () => {
    for (const id of ['A-S12', 'A-S30e-1', 'A-S38-2']) {
      const s = state(id)
      const exits = acceptedExits({ claim: s.claim, now: NOW })
      expect(exits, id).toContain('ratify')
      expect(exits, id).not.toContain('approve')
      expect(arbitrationRefusal(s.claim, 'approve', NOW), id).toBeNull()
      expect(engineRefusalOnReapproval(s.facts), id).not.toBeNull()
      // the money path: T1 admits the pre-image (null / v13 past), T2's derivation on the fresh facts is NOT payable → no engine
      expect(t1Admits(s.claim), id).toBe(true)
      expect(t2Payable(s), id).toBe(false)
    }
    expect(deriveNoRowOutcome({ readable: true, facts: state('A-S12').facts }, 'cl1')).toMatchObject({ kind: 'no_write', outcome: 'unconfirmed_within_window' })
    expect(deriveNoRowOutcome({ readable: true, facts: state('A-S30e-1').facts }, 'cl1')).toMatchObject({ kind: 'proof', prefix: 'no_refund_proven_rail_locked:' })
    expect(deriveNoRowOutcome({ readable: true, facts: state('A-S38-1').facts }, 'cl1')).toMatchObject({ kind: 'park', reason: 'refund_moved_unattributed' })
  })

  it('NEGATIVE CONTROL — the round-12 otherClaimRows fixture (A-S03) with its proof written as v13: ratifiable (never approve), and the rail\'s T2 locks it before the engine', () => {
    const s: State = { ...state('A-S03'), claim: approved(V13) }
    const exits = acceptedExits({ claim: s.claim, now: NOW })
    expect(exits).toContain('ratify')
    expect(exits).not.toContain('approve')
    expect(arbitrationRefusal(s.claim, 'approve', NOW)).toBeNull()
    const o = deriveNoRowOutcome({ readable: true, facts: s.facts }, 'cl1')
    expect(o).toMatchObject({ kind: 'proof', basis: 'verdict', prefix: 'no_refund_proven_rail_locked:' })
    expect(violations(s)).toEqual([])
  })

  it('BREAK — the R13 v1.0 table (approve on an approved claim) is caught on every approved fixture; a T2 that called payable on the rail-locked row (A-S01b) is caught; a « à nouveau payable » refusal is caught too', () => {
    // the v1.0 shape: 'approve' where v1.1 offers 'ratify'
    const v10Exits: ExitsFn = (i) => acceptedExits(i).map((x) => (x === 'ratify' ? 'approve' : x))
    for (const id of ['A-S01', 'A-S12', 'A-S30e-1', 'A-S38-2']) {
      expect(violations(state(id), v10Exits), id).toContain('approve offered on an approved claim (D1 v1.1: ratify or pay, never a re-approval)')
    }
    // the dab754d exit shape brought back on the rail-locked row (D1 row 4)
    const exitsMutant: ExitsFn = (i) => {
      const e = acceptedExits(i)
      return typeof i.claim.refundError === 'string' && i.claim.refundError.startsWith('no_refund_proven_rail_locked:') ? ['approve', ...e] : e
    }
    const refusalMutant: RefusalFn = (c, d, now) =>
      typeof c.refundError === 'string' && c.refundError.startsWith('no_refund_proven_rail_locked:') && d === 'approve' ? null : arbitrationRefusal(c, d, now)
    expect(violations(state('A-S01b'), exitsMutant, refusalMutant)).not.toEqual([])
    // the money path's guard: a T2 whose derivation ignored the E6 row would send the rail into an engine that refuses
    const t2Mutant: T2PayableFn = () => true
    const railLockedV13: State = { ...state('A-S01b'), claim: approved(V13) } // T1 admits a v13 pre-image, so only T2 stands before the engine
    expect(violations(railLockedV13, acceptedExits, arbitrationRefusal, t2Mutant)).toContain('T2 would call an engine that refuses')
    expect(violations(railLockedV13)).toEqual([])
    const copyMutant: RefusalFn = (c, d, now) => {
      const r = arbitrationRefusal(c, d, now)
      return r ? { ...r, error: r.error + ' Elle est à nouveau payable.' } : r
    }
    expect(violations(state('A-S04'), acceptedExits, copyMutant)).toContain('forbidden phrase in the refusal')
  })
})

// ══ J-M28 (3) — the server functions behind reconcile and stuck_close accept exactly the set ═══════════
describe('J-M28 (3) — each reconcile / stuck_close in a state’s set is accepted by its server function (and only those)', () => {
  const GATE_REFUSED = 'Cette réclamation n’est pas en attente de réconciliation.'
  const CLOSE_REFUSED = 'Cette réclamation n’est pas bloquée sur un remboursement — utilisez l’arbitrage.'

  beforeEach(() => {
    vi.clearAllMocks()
    for (const m of [db.claim.findUnique, db.claim.findMany, db.claim.updateMany, db.refund.findMany, db.refund.findUnique, db.order.findUnique]) m.mockReset()
    // Every write loses its CAS: acceptance is decided before any write, and no money truth changes here.
    db.claim.updateMany.mockResolvedValue({ count: 0 })
    db.claim.findMany.mockResolvedValue([])
    db.refund.findMany.mockResolvedValue([])
    db.refund.findUnique.mockResolvedValue(null)
    db.order.findUnique.mockResolvedValue({ id: 'o', stripePaymentIntentId: null })
  })

  for (const s of PURE_STATES) {
    it(`${s.id}`, async () => {
      const exits = acceptedExits({ claim: s.claim, now: NOW })
      db.claim.findUnique.mockResolvedValue({ ...s.claim, requestedAmountCents: 500 })
      const rec = await reconcileClaimEvidence({ claimId: s.claim.id! })
      const gateRefused = !rec.ok && (rec.error === GATE_REFUSED || rec.error.includes('moins de 5 minutes'))
      expect(gateRefused, `${s.id} reconcile`).toBe(!exits.includes('reconcile'))
      const close = await resolveStuckClaim({ claimId: s.claim.id!, adminId: 'op1', resolution: 'closed_no_payment' })
      const closeRefused = !close.ok && close.error === CLOSE_REFUSED
      expect(closeRefused, `${s.id} stuck_close`).toBe(!exits.includes('stuck_close'))
    })
  }

  it('NEGATIVE CONTROL — a set that wrongly offered reconcile on the approved-unpaid state would disagree with the server', async () => {
    const s = state('A-S12')
    db.claim.findUnique.mockResolvedValue({ ...s.claim, requestedAmountCents: 500 })
    const rec = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(!rec.ok && rec.error === GATE_REFUSED).toBe(true)
    expect([...acceptedExits({ claim: s.claim, now: NOW }), 'reconcile'].includes('reconcile')).toBe(true) // the mutant set
  })
})

/** The console's MONEY labels, read out of AdminClaimsArbitration.tsx (never copied by hand). */
function consoleMoneyLabels(): Record<string, string> {
  const arb = readFileSync('components/claims/AdminClaimsArbitration.tsx', 'utf8').replace(/\r\n/g, '\n')
  const start = arb.indexOf('const MONEY_LABEL')
  const block = arb.slice(start, arb.indexOf('return (', start))
  const labels: Record<string, string> = {}
  const labelRe = /^\s+(\w+):\s+\{ text: '([^']*)'/gm
  for (let m = labelRe.exec(block); m; m = labelRe.exec(block)) labels[m[1]] = m[2]
  return labels
}

// ══ J-M28 (5) — the phrase scan on the texts each state renders ═════════════════════════════════════════
describe('J-M28 (5) — the D14 phrase scan on every text a state renders: approve refusal, GUIDANCE, MONEY label', () => {
  const LABELS = consoleMoneyLabels()
  const scan = (t: string) => FORBIDDEN.filter((p) => t.toLowerCase().includes(p.toLowerCase()))

  beforeEach(() => {
    db.claim.findMany.mockReset()
    db.refund.findMany.mockReset()
  })

  it('the MONEY labels were read out of the console, not copied by hand', () => {
    for (const k of ['stripe_pending', 'stripe_failed', 'refund_error_recorded', 'approved_not_driven', 'reconcile_required']) expect(LABELS[k], k).toBeTruthy()
  })

  // ROUND 13 (slice W7, W3 carry-over): the reconcile_marker_unreadable label (W3 round-2 fix) joins the scan by name, and every
  // label the console carries is scanned — not only the ones a fixture state happens to reach.
  it('the reconcile_marker_unreadable MONEY label and every other label pass the D14 phrase scan', () => {
    expect(LABELS.reconcile_marker_unreadable).toContain('heure de la tentative illisible, réconciliation refusée')
    expect(scan(LABELS.reconcile_marker_unreadable)).toEqual([])
    // ten money states; absence_proven_payable's label is computed per claim (absenceProvenPayableLabel, scanned per state above)
    expect(Object.keys(LABELS).length).toBeGreaterThanOrEqual(9)
    for (const [k, t] of Object.entries(LABELS)) expect(scan(t), k).toEqual([])
  })

  for (const s of PURE_STATES) {
    it(`${s.id}`, async () => {
      db.claim.findMany.mockResolvedValue([{ ...s.claim, reason: 'wrong_item', createdAt: T0, requestedAmountCents: 500 }])
      db.refund.findMany.mockResolvedValue(s.claim.refundId ? [{ id: s.claim.refundId, status: 'failed', amountCents: 300, stripeRefundId: 're_1', createdAt: T0, reason: null }] : [])
      const [l] = await listActionableRefundClaims()
      const label = l.moneyState === 'absence_proven_payable' ? absenceProvenPayableLabel(l.refundError) : LABELS[l.moneyState]
      expect(label, `${s.id} label for ${l.moneyState}`).toBeTruthy()
      for (const t of [moneyStateGuidance(l.moneyState), label, arbitrationRefusal(s.claim, 'approve', NOW)?.error ?? '']) {
        expect(scan(t), `${s.id}: ${t}`).toEqual([])
      }
    })
  }

  it('NEGATIVE CONTROL — the HEAD label and a « à nouveau payable » guidance are caught', () => {
    expect(scan('Absence de remboursement PROUVÉE (lignes + Stripe) — approuvée, non payée.')).not.toEqual([])
    expect(scan('Rien à clôturer : elle est à nouveau payable.')).not.toEqual([])
  })
})

// ══ J-M28 (1)(2)(3)(4)(5) through the REAL executeRefund, on every J-M01 fixture (slice W8, W2 carry-over) ═══════════
/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory world rows and engine answers (test doubles) */
type Row = Record<string, any>
type Run = {
  state: string
  pre: string
  /** D1 v1.1: the rail's money exit — 'pay' as the table offers it on the claim the decision left, once its amount is fixed. */
  approvable: boolean
  table: { engine?: EngineAnswer; resume?: ResumeAnswer }
  engineResults: Row[]
  creates: number
  claimAfter: Row
  /** Stripe facts of the world, read before the run: standing refunds on the order's payment, the reported cursor, the page cap. */
  stripe: { standing: number; overCap: boolean }
  texts: string[]
  /** D′ L2: what the DECISION alone (arbitrateClaim) reached, measured before the rail's step is driven by hand. */
  decision?: { engine: number; creates: number; token: boolean }
}

/** J-M28 on one run, as a checker (empty = no exit reached a refusal and no rendered text states an unestablished money truth). */
function runViolations(run: Run): string[] {
  const out: string[] = []
  const reached = run.engineResults.length > 0
  // D′ L2 (S-02): the decision reaches nothing — no engine, no Stripe create, no T1 attempt token
  if (run.decision && (run.decision.engine > 0 || run.decision.creates > 0)) out.push('arbitrateClaim reached the engine (D′ L2: approve is a decision only)')
  if (run.decision?.token) out.push('arbitrateClaim wrote a T1 attempt token (D′ L2: the decision never starts an attempt)')
  if (reached && !run.approvable) out.push('the engine was reached from a state the rail would not offer (no pay exit once the amount is fixed)')
  if (run.engineResults.length > 1) out.push('more than one engine call for one rail attempt')
  for (const res of run.engineResults) if (!res.ok && res.status !== 202) out.push(`the engine refused (${res.status} « ${res.error} »)`)
  if (reached && run.table.resume) out.push('a resume-first (E3) state reached the engine')
  if (reached && run.table.engine && !run.table.engine.accepts) out.push(`the table says NO (${run.table.engine.step}) and the engine was reached`)
  const first = run.engineResults[0]
  if (first?.ok && first.resumed === false && run.creates !== 1) out.push(`${run.creates} refunds.create for one accepted refund`)
  if (run.pre !== 'refunded' && run.claimAfter.status === 'refunded' && !(first?.ok && run.claimAfter.refundId === first.refundId)) {
    out.push('the claim reads refunded without an engine success on its own row')
  }
  const table = run.table.engine
  for (const t of run.texts) {
    for (const p of FORBIDDEN) if (t.toLowerCase().includes(p.toLowerCase())) out.push(`forbidden « ${p} »: ${t.slice(0, 90)}`)
    if (t.includes(HEAD_A) && (run.stripe.standing > 0 || run.stripe.overCap)) out.push(`HEAD_A on a payment with a standing refund: ${t.slice(0, 90)}`)
    const quoted = (Object.keys(ENGINE_QUOTES) as EngineStep[]).filter((k) => t.includes(`« ${ENGINE_QUOTES[k].message}`))
    if (table?.accepts && quoted.length) out.push(`an engine refusal (${quoted.join(', ')}) is quoted on a state the engine accepts: ${t.slice(0, 90)}`)
    if (table && !table.accepts && quoted.some((k) => k !== table.step)) out.push(`quotes ${quoted.join(', ')} where the engine answers ${table.step}: ${t.slice(0, 90)}`)
  }
  return out
}

describe('J-M28 (D′ L2) — every J-M01 state × every D1 pre-image: arbitrateClaim reaches NOTHING; then the DIRECT triggerClaimRefund → T1 → T2 → the REAL executeRefund (both leases open)', () => {
  const FR = JSON.parse(readFileSync('messages/fr.json', 'utf8')) as Row
  const LABELS = consoleMoneyLabels()
  const HOLD_TEXT = `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : x Décision humaine requise.`
  const OLD_MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'
  const v13At = (ms: number) => `${MARKERS.PROOF_PAYABLE_V13} preuve écrite avant. Elle est payable au plus tôt le ${new Date(ms).toISOString()} (UTC).`
  /** Every pre-image D1 knows (refundId = the world's first row where the shape is bound). */
  const PRE: Record<string, (firstRow: string | null) => Row> = {
    // D′ L4: the three DECIDABLE pre-images carry no ratified amount — the decision is what fixes it (T-07/T-08).
    // Every other pre-image below keeps the amount the payable world fixed (500 c), which is what makes it a RAIL state.
    approved_null: () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: null, arbitrationDecision: 'approved', approvedAmountCents: null }),
    v13_past:      () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: v13At(Date.now() - 60_000), arbitrationDecision: 'approved', approvedAmountCents: null }),
    arbitration:   () => ({ status: 'arbitration', refundAttempted: false, refundId: null, refundError: null, arbitrationDecision: null, approvedAmountCents: null }),
    v13_before:    () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: v13At(Date.now() + 3_600_000), arbitrationDecision: 'approved' }),
    rail_locked:   () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven_rail_locked: écrit avant' }),
    awaiting:      () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: `${MARKERS.AWAITING_FINALIZATION} écrit avant` }),
    legacy_proof:  () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven: preuve héritée' }),
    safety_hold:   () => ({ status: 'approved', refundAttempted: true, refundId: null, refundError: HOLD_TEXT }),
    stripe_failed: (r) => ({ status: 'approved', refundAttempted: true, refundId: r, refundError: 'stripe_failed: x' }),
    fv:            () => ({ status: 'financial_verification', refundAttempted: true, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: x' }),
    marker:        () => ({ status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER }),
    bound:         (r) => ({ status: 'refunding', refundAttempted: true, refundId: r, refundError: null }),
    refunded:      (r) => ({ status: 'refunded', refundAttempted: true, refundId: r, refundError: null, activeOrderKey: null }),
  }
  const BINDER = (c: Row) => c.refundError === null || !String(c.refundError).startsWith('resume_mismatch')

  let w: EngineWorld
  const allMocks = () => [...Object.values(db).flatMap((m) => Object.values(m)), ...Object.values(stripeMock).flatMap((m) => Object.values(m)), ledgerMock, engineSpy.fn]
  beforeEach(() => {
    vi.clearAllMocks()
    for (const m of allMocks()) m.mockReset()
    lease.refunds = true
    ledgerMock.mockResolvedValue({ ok: true })
    engineSpy.fn.mockImplementation((input: { orderId: string; amountCents: number; reason?: string }) => engineSpy.real!(input))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    lease.refunds = false
    vi.restoreAllMocks()
  })

  function setWorld(s: StateEntry, pre: string): EngineWorld {
    w = payableWorld() as EngineWorld
    s.world!(w)
    Object.assign(claimOf(w), PRE[pre](w.refunds[0]?.id ?? null))
    // one world per run: the call history of the previous run never counts for this one (implementations are re-wired below)
    for (const m of allMocks()) m.mockClear()
    wireEngineWorld(w, db, stripeMock)
    db.emailDispatch.create.mockResolvedValue({})
    return w
  }
  /** A settlement read from Stripe (G2 / G4): the claim's bound row carries a refund Stripe reports succeeded on the order's payment. */
  const settledOnStripeEvidence = (c: Row): boolean => {
    const r = c.refundId ? w.refunds.find((x) => x.id === c.refundId) : null
    if (!r) return false
    const s = w.stripeRefunds.find((x) => (r.stripeRefundId ? x.id === r.stripeRefundId : x.metadata?.grubano_refund_row === r.id))
    return !!s && s.status === 'succeeded' && (!s.payment_intent || s.payment_intent === 'pi_1') && !w.fail.refundRetrieve?.[s.id]
  }
  const stripeFacts = (x: EngineWorld) => ({
    standing: x.stripeRefunds.filter((r) => (!r.payment_intent || r.payment_intent === 'pi_1') && (r.status === 'succeeded' || r.status === 'pending')).length,
    overCap: x.fail.listOverCap === true,
  })
  const boundRowOf = (c: Row): BoundRowFacts | null => {
    const r = c.refundId ? w.refunds.find((x) => x.id === c.refundId) : null
    return r ? { id: r.id, orderId: r.orderId, status: r.status, stripeRefundId: r.stripeRefundId, reason: r.reason } : null
  }
  /** Every text the claim now renders: detail, refusal, MONEY label, GUIDANCE, customer status. */
  async function renderedTexts(before: Row, now: Date): Promise<string[]> {
    const c = claimOf(w)
    const texts: string[] = []
    if (typeof c.refundError === 'string' && c.refundError !== before.refundError) texts.push(c.refundError)
    texts.push(arbitrationRefusal(c as ClaimFacts, 'approve', now)?.error ?? '')
    const listed = (await listActionableRefundClaims()).find((l) => l.id === 'cl1')
    if (listed) {
      texts.push(moneyStateGuidance(listed.moneyState))
      texts.push((listed.moneyState === 'absence_proven_payable' ? absenceProvenPayableLabel(listed.refundError) : LABELS[listed.moneyState]) ?? '')
    }
    const r = c.refundId ? w.refunds.find((x) => x.id === c.refundId) ?? null : null
    const binders = r ? w.claims.filter((x) => x.refundId === r.id && BINDER(x)).length : null
    const status = customerClaimStatus(c as ClaimFacts, boundRowShowsInProgress(r), refundedRowTruth(r, binders, c.orderId))
    texts.push(String(FR.claims.status[status] ?? ''))
    if (status === 'refunded') texts.push('[customer:refunded]')
    return texts.filter((t) => t !== '')
  }

  const tokenWritten = () => w.writes.some((x) => String(x.data.refundError ?? '').startsWith(MARKERS.RECONCILE_REQUIRED))
  const DECISION_TOAST = String(FR.claims.admin[approvalToast(undefined).key]) // F13 v1.1: the console's nominal toast on a decision

  /**
   * D′ L2: the DECISION first (arbitrateClaim — measured to reach nothing), then the rail's money path BY HAND (the direct
   * triggerClaimRefund, L5's only engine entry point) on the claim the decision left. dab754d ran the second inline after the first.
   */
  async function approveRun(s: StateEntry, pre: string): Promise<Run & { exits: string[]; server: Row; rail: Row; decision: NonNullable<Run['decision']> }> {
    setWorld(s, pre)
    const before = { ...claimOf(w) }
    const stripe = stripeFacts(w)
    const now = new Date()
    const boundRow = boundRowOf(before)
    const exits = acceptedExits({ claim: before as ClaimFacts, boundRow, now })
    const server = await arbitrateClaim({ claimId: 'cl1', adminId: 'op1', decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD })
    const decision = { engine: engineSpy.fn.mock.calls.length, creates: stripeMock.refunds.create.mock.calls.length, token: tokenWritten() }
    const afterDecision = { ...claimOf(w) }
    // D1 v1.1: the rail's exit is 'pay', offered on the claim the decision left once its amount is fixed
    const approvable = acceptedExits({ claim: { ...afterDecision, approvedAmountCents: 500 } as ClaimFacts, boundRow: boundRowOf(afterDecision), now }).includes('pay')
    const rail = await triggerClaimRefund('cl1')
    const engineResults = await Promise.all(engineSpy.fn.mock.results.map((x) => x.value as Promise<Row>))
    const creates = stripeMock.refunds.create.mock.calls.length
    const texts = await renderedTexts(before, now)
    if (!server.ok) texts.push(server.error)
    else texts.push(DECISION_TOAST)
    texts.push(String(FR.claims.admin[approvalToast(rail as never).key] ?? ''))
    const claimAfter = { ...claimOf(w) }
    // the customer reads « Remboursée » only after an engine success on its own row (or when it already did)
    if (texts.includes('[customer:refunded]') && pre !== 'refunded' && !(engineResults[0]?.ok && claimAfter.refundId === engineResults[0].refundId)) texts.push('the customer reads refunded without an engine success')
    return { state: s.id, pre, approvable, table: { engine: s.engine, resume: s.resume }, engineResults, creates, claimAfter, stripe, texts: texts.filter((t) => !t.startsWith('[customer:')), exits, server, rail, decision }
  }

  for (const s of STATES) {
    it(`${s.id}: every pre-image — the decision reaches nothing; the rail reaches the engine only where pay is offered, and then it accepts; every rendered text is true`, async () => {
      const found: string[] = []
      for (const pre of Object.keys(PRE)) {
        const run = await approveRun(s, pre)
        for (const v of runViolations(run)) found.push(`${pre}: ${v}`)
        for (const t of run.texts) if (t === 'the customer reads refunded without an engine success') found.push(`${pre}: ${t}`)
        // D′ L2 differential: a won decision never carries a refund field, and a refused one leaves the pre-image untouched
        if (run.server.ok && 'refund' in run.server) found.push(`${pre}: the decision result carries a refund field`)
        // (4) an empty, decision-only or gated-only set names its registry entry
        const beforeRun = { ...PRE[pre](w.refunds[0]?.id ?? null) }
        if (run.exits.every((x) => DECISION_EXITS.includes(x)) && exitRegistry({ claim: { ...claimOf(payableWorld()), ...beforeRun } as ClaimFacts, boundRow: null, now: new Date() }) === null) {
          found.push(`${pre}: empty, decision-only or gated-only set without a registry entry`)
        }
      }
      expect(found).toEqual([])
    })
  }

  it('the run is not vacuous: the DIRECT rail step reaches the engine, which accepts and creates exactly once on the payable states, and never on a resume-first or NO state; the decision before it reached nothing every time', async () => {
    const reachedOn: string[] = []
    for (const id of ['A-S01', 'A-S02', 'A-S08b', 'A-S17', 'A-S30d', 'A-S32-2']) {
      const run = await approveRun(stateOf(id), 'approved_null')
      expect(run.decision, id).toEqual({ engine: 0, creates: 0, token: false })
      expect(run.server.ok, id).toBe(true)
      expect(run.rail, id).toMatchObject({ state: 'refunded' })
      expect(run.engineResults, id).toHaveLength(1)
      expect(run.engineResults[0], id).toMatchObject({ ok: true, resumed: false })
      expect(run.creates, id).toBe(1)
      expect(run.claimAfter, id).toMatchObject({ status: 'refunded', refundId: run.engineResults[0].refundId })
      reachedOn.push(id)
    }
    expect(reachedOn).toHaveLength(6)
    for (const id of ['A-S01b', 'A-S03', 'A-S10b', 'A-S12', 'A-S14b', 'A-S26']) {
      const run = await approveRun(stateOf(id), 'v13_past')
      expect(run.decision, id).toEqual({ engine: 0, creates: 0, token: false })
      expect(run.engineResults, id).toEqual([])
    }
  })

  it('D′ L2 DIFFERENTIAL — on the payable world (A-S01, both leases open) the decision alone leaves APPROVED_AWAITING_PAYMENT with zero money, and only the direct rail step moves it; the arbitration pre-image too', async () => {
    for (const pre of ['approved_null', 'arbitration', 'v13_past']) {
      setWorld(stateOf('A-S01'), pre)
      const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'op1', decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD })
      expect(r.ok, pre).toBe(true)
      expect(r, pre).not.toHaveProperty('refund')
      // D′ L4 (T-07/T-08): the decision RATIFIES 500 c and still moves nothing
      expect(claimOf(w), pre).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null })
      expect(engineSpy.fn, pre).not.toHaveBeenCalled()
      expect(stripeMock.refunds.create, pre).not.toHaveBeenCalled()
      expect(w.refunds, pre).toEqual([])
      expect(tokenWritten(), pre).toBe(false)
      // the rail's step, by hand: T1 → T2 → the REAL engine → Stripe, once
      expect(await triggerClaimRefund('cl1'), pre).toMatchObject({ state: 'refunded', refundId: 'rf_new' })
      expect(engineSpy.fn, pre).toHaveBeenCalledTimes(1)
      expect(stripeMock.refunds.create, pre).toHaveBeenCalledTimes(1)
      expect(claimOf(w), pre).toMatchObject({ status: 'refunded', refundId: 'rf_new' })
    }
  })

  it('D′ L4 NEGATIVE CONTROL (S-29) — the same payable world with the amount ALREADY fixed refuses the decision (409, 0 writes) while the rail pays that very amount: decision and payment are disjoint exits', async () => {
    setWorld(stateOf('A-S01'), 'approved_null')
    Object.assign(claimOf(w), { approvedAmountCents: 500 })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'op1', decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD })
    expect(r).toMatchObject({ ok: false, status: 409, error: APPROVE_ALREADY_SET })
    expect(w.writes).toEqual([])
    expect(engineSpy.fn).not.toHaveBeenCalled()
    expect(await triggerClaimRefund('cl1')).toMatchObject({ state: 'refunded' })
    expect(engineSpy.fn).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 500, reason: 'claim:cl1' }))
  })

  it('(3) on every J-M01 world: reconcile and stuck_close are accepted by their server function exactly when the set holds them', async () => {
    const found: string[] = []
    for (const s of STATES) {
      for (const pre of Object.keys(PRE)) {
        setWorld(s, pre)
        const before = { ...claimOf(w) }
        const exits = acceptedExits({ claim: before as ClaimFacts, boundRow: boundRowOf(before), now: new Date() })
        const rec = await reconcileClaimEvidence({ claimId: 'cl1' })
        if (exits.includes('reconcile') !== rec.ok) found.push(`${s.id} ${pre}: reconcile set=${exits.includes('reconcile')} server=${rec.ok ? 'ok' : (rec as { error: string }).error}`)
        setWorld(s, pre)
        const close = await resolveStuckClaim({ claimId: 'cl1', adminId: 'op1', resolution: 'closed_no_payment' })
        if (exits.includes('stuck_close') !== close.ok) found.push(`${s.id} ${pre}: stuck_close set=${exits.includes('stuck_close')} server=${close.ok ? 'ok' : (close as { error: string }).error}`)
        if (engineSpy.fn.mock.calls.length) found.push(`${s.id} ${pre}: a reconciliation or declaration reached the engine`)
      }
    }
    expect(found).toEqual([])
  })

  it('reconcile on every J-M01 world (a v13 pre-image): the written detail and its console toast pass the same text checks', async () => {
    const found: string[] = []
    for (const s of STATES) {
      setWorld(s, 'v13_past')
      const before = { ...claimOf(w) }
      const stripe = stripeFacts(w)
      const out = await reconcileClaimEvidence({ claimId: 'cl1' })
      const texts = await renderedTexts(before, new Date())
      if (out.ok) texts.push(reconcileToast(out as never).text)
      const claimAfter = { ...claimOf(w) }
      // A reconciliation settles only on Stripe's evidence for the bound row (never on the engine, never on our row alone).
      const settled = claimAfter.status === 'refunded'
      if (settled && !settledOnStripeEvidence(claimAfter)) found.push(`${s.id}: reconcile settled the claim without a succeeded Stripe refund for its bound row`)
      const run: Run = { state: s.id, pre: settled ? 'refunded' : 'v13_past', approvable: false, table: { engine: s.engine, resume: s.resume }, engineResults: [], creates: 0, claimAfter, stripe, texts: texts.filter((t) => !t.startsWith('[customer:')) }
      if (engineSpy.fn.mock.calls.length) found.push(`${s.id}: reconcile reached the engine`)
      for (const v of runViolations(run)) found.push(`${s.id}: ${v}`)
    }
    expect(found).toEqual([])
  })

  it('NEGATIVE CONTROL — A-S03 (the round-12 otherClaimRows fixture) with its proof written as v13: the decision ratifies with zero money, the direct rail step is locked by T2 before the engine; the engine’s own P2002 answer on A-S01b, a decision that reached the engine, or a « à nouveau payable » text, is caught', async () => {
    const run = await approveRun(stateOf('A-S03'), 'v13_past')
    expect(run.approvable).toBe(true)
    expect(run.decision).toEqual({ engine: 0, creates: 0, token: false })
    expect(run.server.ok).toBe(true)
    expect(engineSpy.fn).not.toHaveBeenCalled()
    // T2 (c): the H1 hold (re_O failed at Stripe) stops the rail's attempt before its derivation and before the engine
    expect(run.rail).toEqual({ state: 'failed', error: 'safety_hold' })
    expect(String(run.claimAfter.refundError).startsWith(MARKERS.SAFETY_HOLD)).toBe(true)
    expect(run.claimAfter).toMatchObject({ status: 'approved', refundId: null })
    expect(runViolations(run)).toEqual([])
    // the checker catches the dab754d shape: a decision that reached the engine, or that wrote the T1 token
    expect(runViolations({ ...run, decision: { engine: 1, creates: 1, token: true } })).toEqual([
      'arbitrateClaim reached the engine (D′ L2: approve is a decision only)',
      'arbitrateClaim wrote a T1 attempt token (D′ L2: the decision never starts an attempt)',
    ])
    // the checker is not vacuous: what an approval that reached the engine on A-S01b would get back
    setWorld(stateOf('A-S01b'), 'approved_null')
    const refused = await engineSpy.real!({ orderId: 'o1', amountCents: 500, reason: 'claim:cl1' })
    expect(refused).toMatchObject({ ok: false, status: 409, error: ENGINE_QUOTES.E6.message })
    expect(runViolations({ ...run, state: 'A-S01b', table: { engine: stateOf('A-S01b').engine }, engineResults: [refused] })).toEqual([
      `the engine refused (409 « ${ENGINE_QUOTES.E6.message} »)`,
      'the table says NO (E6) and the engine was reached',
    ])
    expect(runViolations({ ...run, texts: [`${approveRevisableText(true)} Elle est à nouveau payable.`] })).toEqual([`forbidden « à nouveau payable »: ${`${approveRevisableText(true)} Elle est à nouveau payable.`.slice(0, 90)}`])
    expect(runViolations({ ...run, stripe: { standing: 1, overCap: false }, texts: [`no_refund_proven_rail_locked: ${HEAD_A}`] })).toHaveLength(1)
  })
})
