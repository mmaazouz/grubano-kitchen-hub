// tests/claims-r13-no-false-exit.test.ts — T-49 round 13, J-M28 (D1, D2 (1), D14, G9, A-S00)
//
// HARD INVARIANT: no exit is offered that the engine would refuse. In the pure layer that reads:
//   – approve is offered only on a pre-image T2 re-derives (null or a v13 proof), and T2 calls the engine
//     only when its derivation on the fresh facts is payable — which the mirror says the engine accepts;
//   – every state whose facts make the engine refuse has approve absent, refused Claims-side (D14), or
//     blocked by that same T2 derivation (ER-M05: the approved-null states of D1 row 1);
//   – an empty or gated-only exit set names its registry entry; no refusal text carries a false exit.
// The full approve path against the real executeRefund (T1 → T2 → engine) is pinned by the T2 slice.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, stripeMock } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
  },
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  acceptedExits, arbitrationRefusal, exitRegistry, deriveNoRowOutcome, engineRefusalOnReapproval,
  APPROVE_LEGACY_PROOF, approveRevisableText, approvePermanentText, MARKERS, moneyStateGuidance, absenceProvenPayableLabel,
  type ClaimFacts, type ReapprovalFacts, type MoneyRow, type ExitInput, type Refusal,
} from '@/lib/claim-action-rules'
import { reconcileClaimEvidence, resolveStuckClaim, listActionableRefundClaims } from '@/lib/claims'

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
const STATES: State[] = [
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
const state = (id: string) => STATES.find((s) => s.id === id)!

const FORBIDDEN = ['payable à nouveau', 'à nouveau payable', 'de nouveau payable', 'peut maintenant être rembours', 'relancez le remboursement', 'réessayez le remboursement', 'sera remboursée', 'sera payée', 'jamais déplacé', 'n’a déplacé d’argent', 'Absence de remboursement PROUVÉE']
type ExitsFn = (i: ExitInput) => string[]
type RefusalFn = (c: ClaimFacts, d: 'approve' | 'refuse_final', now: Date) => Refusal | null

const t2Runs = (c: ClaimFacts) => c.refundError === null || (typeof c.refundError === 'string' && c.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13))
const t2Payable = (s: State) => {
  const o = deriveNoRowOutcome({ readable: true, facts: s.facts }, s.claim.id!)
  return o.kind === 'proof' && o.basis === 'verdict' && o.verdict === 'payable'
}

/** The invariant, as a checker: the empty list means no exit reaches an engine refusal. */
function violations(s: State, exitsFn: ExitsFn = acceptedExits, refusalFn: RefusalFn = arbitrationRefusal): string[] {
  const out: string[] = []
  const exits = exitsFn({ claim: s.claim, now: NOW })
  const refusal = refusalFn(s.claim, 'approve', NOW)
  const approvable = exits.includes('approve') && refusal === null
  const engineAccepts = engineRefusalOnReapproval(s.facts) === null
  if (approvable && !t2Runs(s.claim)) out.push('approve offered on a pre-image T2 does not re-derive')
  if (approvable && t2Runs(s.claim) && t2Payable(s) && !engineAccepts) out.push('T2 would call an engine that refuses')
  if (!engineAccepts && exits.includes('approve')) {
    const claimsSide = !!refusal && (refusal.error === APPROVE_LEGACY_PROOF || refusal.error.startsWith('Approbation impossible') || refusal.error === 'Cette réclamation n’est pas en arbitrage.')
    const t2Blocks = t2Runs(s.claim) && !t2Payable(s)
    if (!claimsSide && !t2Blocks) out.push('the engine refuses, and approve is neither refused nor blocked by T2')
  }
  if (exits.every((x) => x === 'approve' || x === 'refuse_final') && exitRegistry({ claim: s.claim, now: NOW }) === null) out.push('empty or gated-only set without a registry entry')
  const text = refusal?.error ?? ''
  if (FORBIDDEN.some((p) => text.toLowerCase().includes(p.toLowerCase()))) out.push('forbidden phrase in the refusal')
  return out
}

describe('J-M28 — HARD INVARIANT: no exit offered that the engine would refuse', () => {
  for (const s of STATES) {
    it(`${s.id}: no violation`, () => {
      expect(violations(s)).toEqual([])
    })
  }

  it('A-S01: approvable past its instant; T2 re-derives payable; the mirrored engine accepts', () => {
    const s = state('A-S01')
    expect(acceptedExits({ claim: s.claim, now: NOW })).toContain('approve')
    expect(arbitrationRefusal(s.claim, 'approve', NOW)).toBeNull()
    expect(t2Payable(s)).toBe(true)
    expect(engineRefusalOnReapproval(s.facts)).toBeNull()
  })

  it('A-S01b, A-S03, A-S32-1 and A-S26 are never approvable, at any instant', () => {
    for (const id of ['A-S01b', 'A-S03', 'A-S32-1', 'A-S26']) {
      const s = state(id)
      for (const now of [T0, INSTANT, NOW]) {
        const approvable = acceptedExits({ claim: s.claim, now }).includes('approve') && arbitrationRefusal(s.claim, 'approve', now) === null
        expect(approvable, `${id} @${now.toISOString()}`).toBe(false)
      }
      expect(engineRefusalOnReapproval(s.facts), id).not.toBeNull()
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

  it('ER-M05: the approved-null and stale-v13 states whose engine refuses are approvable, and T2 blocks before the engine', () => {
    for (const id of ['A-S12', 'A-S30e-1', 'A-S38-2']) {
      const s = state(id)
      expect(acceptedExits({ claim: s.claim, now: NOW }), id).toContain('approve')
      expect(engineRefusalOnReapproval(s.facts), id).not.toBeNull()
      expect(t2Payable(s), id).toBe(false)
    }
    expect(deriveNoRowOutcome({ readable: true, facts: state('A-S12').facts }, 'cl1')).toMatchObject({ kind: 'no_write', outcome: 'unconfirmed_within_window' })
    expect(deriveNoRowOutcome({ readable: true, facts: state('A-S30e-1').facts }, 'cl1')).toMatchObject({ kind: 'proof', prefix: 'no_refund_proven_rail_locked:' })
    expect(deriveNoRowOutcome({ readable: true, facts: state('A-S38-1').facts }, 'cl1')).toMatchObject({ kind: 'park', reason: 'refund_moved_unattributed' })
  })

  it('NEGATIVE CONTROL — the round-12 otherClaimRows fixture (A-S03) with its proof written as v13: approvable, and T2 locks it before the engine', () => {
    const s: State = { ...state('A-S03'), claim: approved(V13) }
    expect(acceptedExits({ claim: s.claim, now: NOW })).toContain('approve')
    expect(arbitrationRefusal(s.claim, 'approve', NOW)).toBeNull()
    const o = deriveNoRowOutcome({ readable: true, facts: s.facts }, 'cl1')
    expect(o).toMatchObject({ kind: 'proof', basis: 'verdict', prefix: 'no_refund_proven_rail_locked:' })
    expect(violations(s)).toEqual([])
  })

  it('BREAK — offering approve on the rail-locked row (D1 row 4) is caught on A-S01b; a « à nouveau payable » refusal is caught too', () => {
    const exitsMutant: ExitsFn = (i) => {
      const e = acceptedExits(i)
      return typeof i.claim.refundError === 'string' && i.claim.refundError.startsWith('no_refund_proven_rail_locked:') ? ['approve', ...e] : e
    }
    const refusalMutant: RefusalFn = (c, d, now) =>
      typeof c.refundError === 'string' && c.refundError.startsWith('no_refund_proven_rail_locked:') && d === 'approve' ? null : arbitrationRefusal(c, d, now)
    expect(violations(state('A-S01b'), exitsMutant, refusalMutant)).not.toEqual([])
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

  for (const s of STATES) {
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

// ══ J-M28 (5) — the phrase scan on the texts each state renders ═════════════════════════════════════════
describe('J-M28 (5) — the D14 phrase scan on every text a state renders: approve refusal, GUIDANCE, MONEY label', () => {
  const arb = readFileSync('components/claims/AdminClaimsArbitration.tsx', 'utf8').replace(/\r\n/g, '\n')
  const start = arb.indexOf('const MONEY_LABEL')
  const block = arb.slice(start, arb.indexOf('return (', start))
  const LABELS: Record<string, string> = {}
  const labelRe = /^\s+(\w+):\s+\{ text: '([^']*)'/gm
  for (let m = labelRe.exec(block); m; m = labelRe.exec(block)) LABELS[m[1]] = m[2]
  const scan = (t: string) => FORBIDDEN.filter((p) => t.toLowerCase().includes(p.toLowerCase()))

  beforeEach(() => {
    db.claim.findMany.mockReset()
    db.refund.findMany.mockReset()
  })

  it('the MONEY labels were read out of the console, not copied by hand', () => {
    for (const k of ['stripe_pending', 'stripe_failed', 'refund_error_recorded', 'approved_not_driven', 'reconcile_required']) expect(LABELS[k], k).toBeTruthy()
  })

  for (const s of STATES) {
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
