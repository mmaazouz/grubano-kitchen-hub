// tests/claims-r13-engine-mirror.test.ts — T-49 round 13, J-M02 (G5, G9, A-S00)
//
// The pure mirror of lib/refund.ts executeRefund (724-839): the first refusal it reaches, the evidence
// class of every pending row, the Claims-side holds, the verdict, and which lock is temporary. The real
// engine parity runs belong to J-M03/J-M04; this file pins the pure order and classes.
import { describe, it, expect } from 'vitest'
import {
  engineRefusalOnReapproval, reapprovalSafetyHolds, reapprovalVerdict, lockIsTemporary, pendingEvidenceOf, proofPrefixFor, MARKERS,
  type ReapprovalFacts, type MoneyRow, type EngineRefusal, type PendingRowTruth,
} from '@/lib/claim-action-rules'

const T0 = new Date('2026-09-01T00:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)

/** J-M02 payable baseline: paid, PI present, succeeded, charge 2000 / refunded 0 / captured 2000, not disputed, not routed, requested 500, no rows, empty list. */
const base = (o: Partial<ReapprovalFacts> = {}): ReapprovalFacts => ({
  orderId: 'o', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded',
  chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 0,
  routed: false, royaltyStatus: null, stripeListLength: 0, rows: [], L: [], truths: {}, binders: {}, stampedClaims: {},
  succeededNotCounted: [], rowContradictions: [], ...o,
})
const row = (id: string, o: Partial<MoneyRow> = {}): MoneyRow => ({
  id, status: 'succeeded', amountCents: 300, stripeRefundId: `re_${id}`, reason: null, idempotencyKey: `refund:o:k_${id}`,
  createdAt: T0, royaltyRefundCents: 0, ...o,
})
const pendingRow = (id: string, truth: PendingRowTruth, o: Partial<MoneyRow> = {}) => ({
  rows: [row(id, { status: 'pending', stripeRefundId: null, ...o })],
  truths: { [id]: truth },
})
const step = (f: ReapprovalFacts) => engineRefusalOnReapproval(f)?.step ?? null
const ORDER: EngineRefusal['step'][] = ['E1', 'E2', 'E1b', 'E3', 'E4', 'E5', 'E6']

describe('J-M02 — each refusal, one fact flipped from the payable baseline', () => {
  it('the baseline is payable', () => {
    expect(engineRefusalOnReapproval(base())).toBeNull()
    expect(reapprovalSafetyHolds(base())).toEqual([])
    expect(reapprovalVerdict(base())).toBe('payable')
  })

  it('E1: payment not paid, or no PaymentIntent; reconcile_manual is refundable money', () => {
    expect(step(base({ orderPaymentStatus: 'pending' }))).toBe('E1')
    expect(step(base({ hasPaymentIntent: false }))).toBe('E1')
    expect(step(base({ orderPaymentStatus: 'reconcile_manual' }))).toBeNull()
  })

  it('E2: a failed row WITH a Stripe id; a failed row without one is not E2', () => {
    expect(engineRefusalOnReapproval(base({ rows: [row('f', { status: 'failed' })] }))).toEqual({ step: 'E2', rowIds: ['f'] })
    expect(step(base({ rows: [row('f', { status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o:x' })] }))).toBeNull()
  })

  it('E1b: the PaymentIntent is not succeeded', () => {
    expect(engineRefusalOnReapproval(base({ piStatus: 'requires_capture' }))).toEqual({ step: 'E1b', piStatus: 'requires_capture' })
  })

  it('E3: the pending row evidence classes', () => {
    const cls = (truth: PendingRowTruth, o: Partial<MoneyRow> = {}, royaltyStatus: string | null = null) => {
      const r = engineRefusalOnReapproval(base({ ...pendingRow('p', truth, o), royaltyStatus }))
      expect(r?.step).toBe('E3')
      return r && r.step === 'E3' ? r.evidenceByRow.p : null
    }
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'failed' })).toBe('failed_at_stripe')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'canceled' })).toBe('failed_at_stripe')
    expect(cls({ kind: 'absent_dead' })).toBe('dead')
    expect(cls({ kind: 'absent_within_window', until: later(3_600_000) })).toBe('within_window')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'pending' })).toBe('pending_at_stripe')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'requires_action' })).toBe('pending_at_stripe')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'succeeded' })).toBe('succeeded_at_stripe')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'succeeded' }, { royaltyRefundCents: 300 }, 'settled')).toBe('succeeded_at_stripe_clawback')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'succeeded' }, { royaltyRefundCents: 300 }, 'settling')).toBe('succeeded_at_stripe_clawback')
    // controls: a royalty not settled, or no royalty cents, is no clawback
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'succeeded' }, { royaltyRefundCents: 300 }, 'pending')).toBe('succeeded_at_stripe')
    expect(cls({ kind: 'at_stripe', refundId: 're_p', status: 'succeeded' }, { royaltyRefundCents: 0 }, 'settled')).toBe('succeeded_at_stripe')
  })

  it('ER-M04 regression: the clawback class applies at ANY age — a row created one hour ago is clawback, never temporary', () => {
    const f = base({ ...pendingRow('p', { kind: 'at_stripe', refundId: 're_p', status: 'succeeded' }, { royaltyRefundCents: 300, createdAt: new Date(Date.now() - 3_600_000) }), royaltyStatus: 'settled' })
    expect(pendingEvidenceOf(f.rows[0], f.truths.p, 'settled')).toBe('succeeded_at_stripe_clawback')
    expect(lockIsTemporary(reapprovalVerdict(f))).toBe(false)
  })

  it('E3: the engine list is truncated only for an id-less oldest row beyond 100 refunds', () => {
    const trunc = (listLen: number, id: string | null) => {
      const r = engineRefusalOnReapproval(base({ ...pendingRow('p', { kind: 'absent_dead' }, { stripeRefundId: id }), stripeListLength: listLen }))
      return r && r.step === 'E3' ? r.engineListTruncated : null
    }
    expect(trunc(101, null)).toBe(true)
    expect(trunc(100, null)).toBe(false)
    expect(trunc(101, 're_p')).toBe(false)
  })

  it('E3: a tie at the same createdAt names every oldest row; a younger pending row is listed apart', () => {
    const f = base({
      rows: [
        row('a', { status: 'pending', stripeRefundId: null }), row('b', { status: 'pending', stripeRefundId: null }),
        row('c', { status: 'pending', stripeRefundId: null, createdAt: later(1000) }),
      ],
      truths: { a: { kind: 'absent_dead' }, b: { kind: 'at_stripe', refundId: 're_b', status: 'succeeded' }, c: { kind: 'absent_dead' } },
    })
    const r = engineRefusalOnReapproval(f)
    expect(r).toMatchObject({ step: 'E3', oldestRowIds: ['a', 'b'], otherPendingRowIds: ['c'] })
  })

  it('E4: already fully refunded', () => {
    expect(engineRefusalOnReapproval(base({ amountRefundedCents: 2000 }))).toEqual({ step: 'E4', refundedCents: 2000, chargeAmountCents: 2000 })
  })

  it('E5: requested 0, 1.5 or above the refundable remainder (100 refunded)', () => {
    for (const req of [0, 1.5, 1901]) expect(step(base({ amountRefundedCents: 100, requestedAmountCents: req })), String(req)).toBe('E5')
    expect(step(base({ amountRefundedCents: 100, requestedAmountCents: 1900 }))).toBeNull()
  })

  it('E6: ANY row holding refund:o:<refunded>, a failed row without id included (A-S01b)', () => {
    expect(engineRefusalOnReapproval(base({ rows: [row('f', { status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o:0' })] })))
      .toEqual({ step: 'E6', key: 'refund:o:0', rowId: 'f' })
    expect(step(base({ rows: [row('s', { idempotencyKey: 'refund:o:0' })] }))).toBe('E6')
    expect(step(base({ rows: [row('s', { idempotencyKey: 'refund:o:0:failed:re_x' })] }))).toBeNull()
  })

  it('NEGATIVE CONTROL — the failed-without-id key-holding fixture is NOT payable', () => {
    const f = base({ rows: [row('f', { status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o:0' })] })
    expect(reapprovalVerdict(f)).not.toBe('payable')
  })
})

describe('J-M02 — the first refusal wins on every pairwise overlap', () => {
  const FLIPS: Record<EngineRefusal['step'], (f: ReapprovalFacts) => ReapprovalFacts> = {
    E1: (f) => ({ ...f, orderPaymentStatus: 'pending' }),
    E2: (f) => ({ ...f, rows: [...f.rows, row('f2', { status: 'failed', idempotencyKey: 'refund:o:f2' })] }),
    E1b: (f) => ({ ...f, piStatus: 'processing' }),
    E3: (f) => ({ ...f, rows: [...f.rows, row('p3', { status: 'pending', stripeRefundId: null, idempotencyKey: 'refund:o:p3' })], truths: { ...f.truths, p3: { kind: 'absent_dead' } } }),
    E4: (f) => ({ ...f, amountRefundedCents: 2000 }),
    E5: (f) => ({ ...f, requestedAmountCents: 1.5 }),
    E6: (f) => ({ ...f, rows: [...f.rows, row('k6', { idempotencyKey: `refund:o:${f.amountRefundedCents}` })] }),
  }

  it('each flip alone yields its own step', () => {
    for (const s of ORDER) expect(step(FLIPS[s](base())), s).toBe(s)
  })

  it('every pair yields the earlier step in refund.ts order — never E1c, never E5b', () => {
    for (let i = 0; i < ORDER.length; i++) {
      for (let j = i + 1; j < ORDER.length; j++) {
        const [a, b] = [ORDER[i], ORDER[j]]
        // E6 reads the cursor AFTER the other flip, so its key follows E4's refunded amount.
        const f = FLIPS[b](FLIPS[a](base()))
        const got = step(f)
        expect(got, `${a}+${b}`).toBe(a)
        expect(ORDER).toContain(got)
      }
    }
  })
})

describe('J-M02 — holds and verdict', () => {
  it('H1 for each how', () => {
    for (const how of ['reverted', 'pending_at_stripe', 'absent', 'other_payment'] as const) {
      const f = base({ succeededNotCounted: [{ rowId: 'rf_o', how, refundId: 're_O', stripeStatus: how === 'reverted' ? 'failed' : null }] })
      expect(reapprovalSafetyHolds(f), how).toEqual([{ hold: 'H1', rowId: 'rf_o', how, refundId: 're_O', stripeStatus: how === 'reverted' ? 'failed' : null }])
      expect(reapprovalVerdict(f), how).toEqual({ locked: true, refusal: null, holds: reapprovalSafetyHolds(f) })
    }
  })

  it('H2 only on a routed payment and only for a refund with ZERO owners', () => {
    const L = [{ id: 're_D', status: 'failed', amount: 300, metadata: {} }]
    expect(reapprovalSafetyHolds(base({ routed: true, L }))).toEqual([{ hold: 'H2', refundId: 're_D', status: 'failed' }])
    expect(reapprovalSafetyHolds(base({ routed: false, L }))).toEqual([])
    expect(reapprovalSafetyHolds(base({ routed: null, L }))).toEqual([])
    // a routed failed refund OWNED by a pending row (its tag) is E3 failed_at_stripe, never H2
    const owned = base({
      routed: true,
      L: [{ id: 're_P', status: 'failed', amount: 300, metadata: { grubano_refund_row: 'p' } }],
      ...pendingRow('p', { kind: 'at_stripe', refundId: 're_P', status: 'failed' }),
    })
    expect(reapprovalSafetyHolds(owned)).toEqual([])
    const r = engineRefusalOnReapproval(owned)
    expect(r && r.step === 'E3' ? r.evidenceByRow.p : null).toBe('failed_at_stripe')
  })

  it('H3 for a pending and a succeeded contradiction', () => {
    const f = base({ rowContradictions: [{ rowId: 'p', rowStatus: 'pending', detail: 'd1' }, { rowId: 's', rowStatus: 'succeeded', detail: 'd2' }] })
    expect(reapprovalSafetyHolds(f).map((h) => h.hold)).toEqual(['H3', 'H3'])
  })

  it('H5 disputed; H5 captured 1000 / refunded 600 / requested 500 (control 400)', () => {
    expect(reapprovalSafetyHolds(base({ chargeDisputed: true }))).toEqual([{ hold: 'H5', cause: 'disputed', chargeId: 'ch_1' }])
    expect(reapprovalSafetyHolds(base({ amountCapturedCents: 1000, amountRefundedCents: 600, requestedAmountCents: 500 })))
      .toEqual([{ hold: 'H5', cause: 'captured', requestedAmountCents: 500, remainingCapturedCents: 400 }])
    expect(reapprovalSafetyHolds(base({ amountCapturedCents: 1000, amountRefundedCents: 600, requestedAmountCents: 400 }))).toEqual([])
  })

  it('the verdict is payable only with no refusal and no hold', () => {
    expect(reapprovalVerdict(base())).toBe('payable')
    expect(reapprovalVerdict(base({ chargeDisputed: true }))).not.toBe('payable')
    expect(reapprovalVerdict(base({ amountRefundedCents: 2000 }))).not.toBe('payable')
  })
})

describe('J-M02 / G9 — lockIsTemporary', () => {
  const succeeded: PendingRowTruth = { kind: 'at_stripe', refundId: 're_A', status: 'succeeded' }
  const awaiting = () => base({ ...pendingRow('rf_A', succeeded) })

  it('true only for E3, no hold, every oldest row succeeded without clawback, list not truncated', () => {
    expect(lockIsTemporary(reapprovalVerdict(awaiting()))).toBe(true)
    expect(proofPrefixFor(reapprovalVerdict(awaiting()))).toBe(MARKERS.AWAITING_FINALIZATION)
  })

  it('false for the clawback row, a hold beside it, a dead tie, a truncated list, an E6 lock, and a payable verdict', () => {
    const clawback = base({ ...pendingRow('rf_A', succeeded, { royaltyRefundCents: 300 }), royaltyStatus: 'settled' })
    const withHold = { ...awaiting(), chargeDisputed: true }
    const tie = base({ rows: [row('a', { status: 'pending', stripeRefundId: null }), row('b', { status: 'pending', stripeRefundId: null })], truths: { a: succeeded, b: { kind: 'absent_dead' } } })
    const truncated = { ...base({ ...pendingRow('rf_A', succeeded) }), stripeListLength: 101 }
    const e6 = base({ rows: [row('k', { idempotencyKey: 'refund:o:0' })] })
    for (const [name, f] of [['clawback', clawback], ['hold', withHold], ['tie', tie], ['truncated', truncated], ['e6', e6]] as const) {
      expect(lockIsTemporary(reapprovalVerdict(f)), name).toBe(false)
      expect(proofPrefixFor(reapprovalVerdict(f)), name).toBe('no_refund_proven_rail_locked:')
    }
    expect(lockIsTemporary('payable')).toBe(false)
    expect(proofPrefixFor('payable')).toBe(MARKERS.PROOF_PAYABLE_V13)
  })
})
