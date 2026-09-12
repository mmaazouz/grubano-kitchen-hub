// tests/claims-r13-rules.test.ts — T-49 round 13, J-M47 (G9, D14 (2)/(3), A-S10b, A-S10c, A-S30e-2)
//
// Only ONE lock can cease without a Claims action: another claim's pending row whose Stripe refund
// succeeded and needs no settled-royalty clawback. Every other lock is permanent. Neither is payable.
// The pure layer: which facts give the AWAITING prefix, and which approval refusal each lock gets.
// The G8 texts, T1 and the sweep are wired by a later slice.
import { describe, it, expect } from 'vitest'
import {
  deriveNoRowOutcome, proofInstantFor, arbitrationRefusal, approveRevisableText, approvePermanentText, acceptedExits,
  ATTEMPT_QUIESCENCE_MS, MARKERS,
  type ReapprovalFacts, type MoneyRow, type NoRowOutcome,
} from '@/lib/claim-action-rules'

const T0 = new Date('2026-09-12T08:00:00.000Z')
const row = (id: string, o: Partial<MoneyRow> = {}): MoneyRow => ({
  id, status: 'pending', amountCents: 300, stripeRefundId: null, reason: 'claim:cl_A', idempotencyKey: `refund:o:k_${id}`,
  createdAt: T0, royaltyRefundCents: 0, ...o,
})
/** A-S10b: cl_A's pending row rf_A, its refund re_A SUCCEEDED at Stripe; cl_A is the single refunded binder. */
const aS10b = (o: Partial<ReapprovalFacts> = {}): ReapprovalFacts => ({
  orderId: 'o', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded',
  chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 300,
  routed: false, royaltyStatus: null, stripeListLength: 1,
  rows: [row('rf_A')],
  L: [{ id: 're_A', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: { grubano_refund_row: 'rf_A' } }],
  truths: { rf_A: { kind: 'at_stripe', refundId: 're_A', status: 'succeeded' } },
  binders: { rf_A: [{ id: 'cl_A', status: 'refunded', refundError: null, refundId: 'rf_A' }] },
  stampedClaims: {}, succeededNotCounted: [], rowContradictions: [], ...o,
})
const prefixOf = (o: NoRowOutcome) => (o.kind === 'proof' ? o.prefix : `${o.kind}:${'outcome' in o ? o.outcome : o.reason}`)

describe('J-M47 — only the finalizable other-claim row is temporary', () => {
  it('A-S10b (and A-S30e-2, the same facts at T2) → AWAITING', () => {
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: aS10b() }, 'cl1'))).toBe(MARKERS.AWAITING_FINALIZATION)
  })

  it('A-S10c (settled royalty, 300 c) → permanent lock', () => {
    const f = aS10b({ rows: [row('rf_A', { royaltyRefundCents: 300 })], royaltyStatus: 'settled' })
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: f }, 'cl1'))).toBe('no_refund_proven_rail_locked:')
  })

  it('AWAITING plus H5, a tie with a dead oldest row, a truncated list, and an E6 lock → permanent', () => {
    const withH5 = aS10b({ chargeDisputed: true })
    const tie = aS10b({
      rows: [row('rf_A'), row('rf_D', { reason: null })],
      truths: { rf_A: { kind: 'at_stripe', refundId: 're_A', status: 'succeeded' }, rf_D: { kind: 'absent_dead' } },
    })
    const truncated = aS10b({ stripeListLength: 101 })
    const e6 = aS10b({
      rows: [row('rf_S', { status: 'succeeded', stripeRefundId: 're_A', idempotencyKey: 'refund:o:300' })],
      L: [{ id: 're_A', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: {} }],
      truths: {}, binders: { rf_S: [{ id: 'cl_A', status: 'refunded', refundError: null, refundId: 'rf_S' }] },
    })
    for (const [name, f] of [['H5', withH5], ['tie', tie], ['truncated', truncated], ['E6', e6]] as const) {
      expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: f }, 'cl1')), name).toBe('no_refund_proven_rail_locked:')
    }
  })

  it('NEGATIVE CONTROL — A-S10c must NOT get the AWAITING prefix', () => {
    const f = aS10b({ rows: [row('rf_A', { royaltyRefundCents: 300 })], royaltyStatus: 'settling' })
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: f }, 'cl1'))).not.toBe(MARKERS.AWAITING_FINALIZATION)
  })

  it('after the other row finalized (succeeded, explained) the derivation is payable, with a NEW instant later than the earlier write + Q', () => {
    const firstWrite = T0
    const after = aS10b({ rows: [row('rf_A', { status: 'succeeded', stripeRefundId: 're_A', idempotencyKey: 'refund:o:0' })], truths: {} })
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: after }, 'cl1'))).toBe(MARKERS.PROOF_PAYABLE_V13)
    const awaitingText = `${MARKERS.AWAITING_FINALIZATION} … la plus ancienne ligne en attente de la commande, rf_A (identité claim:cl_A), est reprise par le moteur avant tout nouveau remboursement …`
    const reconcileAt = new Date(firstWrite.getTime() + 2 * 3_600_000)
    const instant = proofInstantFor(awaitingText, reconcileAt)
    expect(instant.getTime()).toBeGreaterThan(firstWrite.getTime() + ATTEMPT_QUIESCENCE_MS)
    const v13 = { id: 'cl1', orderId: 'o', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError: `${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).` }
    expect(arbitrationRefusal(v13, 'approve', new Date(instant.getTime() - 1))).not.toBeNull()
    expect(arbitrationRefusal(v13, 'approve', instant)).toBeNull()
  })
})

describe('J-M47 — the approval refusal of a lock: REVISABLE when reconcile admits it, PERMANENT otherwise', () => {
  const now = new Date(T0.getTime() + 86_400_000)
  const approved = (refundError: string, o: Record<string, unknown> = {}) =>
    ({ id: 'cl1', orderId: 'o', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError, ...o })

  it('AWAITING, a permanent lock and a safety hold (reconcile admits) → D14 (2) with the declaration sentence', () => {
    for (const c of [
      approved(`${MARKERS.AWAITING_FINALIZATION} x`),
      approved('no_refund_proven_rail_locked: x'),
      approved(`${MARKERS.SAFETY_HOLD} x`, { refundAttempted: true }),
    ]) {
      expect(arbitrationRefusal(c, 'approve', now), c.refundError).toEqual({ status: 409, error: approveRevisableText(true) })
      expect(acceptedExits({ claim: c, now }), c.refundError).toEqual(['reconcile', 'stuck_close'])
    }
  })

  it('stripe_failed, engine_failed, engine_row_dead, STRIPE_REVERTED (reconcile refuses) → D14 (3) naming the close', () => {
    for (const e of ['stripe_failed: x', 'engine_failed: x', 'engine_row_dead: x', `${MARKERS.STRIPE_REVERTED} x`]) {
      const c = approved(e, { refundAttempted: true, refundId: 'rf1' })
      expect(arbitrationRefusal(c, 'approve', now), e).toEqual({ status: 409, error: approvePermanentText(true) })
      expect(acceptedExits({ claim: c, now }), e).toEqual(['stuck_close'])
    }
  })

  it('no lock prefix is approvable', () => {
    for (const e of [`${MARKERS.AWAITING_FINALIZATION} x`, 'no_refund_proven_rail_locked: x']) {
      expect(acceptedExits({ claim: approved(e), now })).not.toContain('approve')
    }
  })
})
