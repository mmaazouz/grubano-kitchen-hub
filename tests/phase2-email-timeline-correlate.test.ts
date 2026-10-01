// tests/phase2-email-timeline-correlate.test.ts
// Regression for the EVIDENCE-OPERATOR defect found during the Phase 2 FULL refund closeout
// (2026-09-09): `scripts/server/phase2-email-timeline.js` assumed "exactly ONE refund e-mail per
// consumer in 48 h" and evaluated the OLDEST EmailLog row, so after the second rehearsal it
// correlated the FULL refund (17:44) to the PARTIAL e-mail (10:09) and reported a FALSE NEGATIVE.
// The product behaviour was correct throughout — only the operator's correlation was wrong.
//
// The fixtures below are the REAL measured rows of both authorized rehearsals (same consumer,
// same restaurant): one PARTIAL e-mail and one FULL e-mail.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TL = require('../scripts/server/phase2-email-timeline.js') as {
  selectTargetRefund: (rows: RefundRow[], amount: number | null) => { refund: RefundRow | null; ambiguous: boolean; selection: string }
  expectedRefundSubject: (restaurant: string, partial: boolean) => string
  computeTemplateFlag: (i: { chargeAmount: number; refunds: SR[]; target: SR }) => { cumulativeThrough: number; remainingAfter: number; partial: boolean }
  correlateRefundEmail: (i: {
    dispatches: Claim[]; logs: LogRow[]; orderId: string; amountCents: number
    expectedSubject: string | null; nextClaimAt: string | null
  }) => { claim: Claim | null; claimKey: string; log: LogRow | null; selection: string; candidates: number; ignored: number; subjectMatch: boolean | null }
}

type RefundRow = { id: string; status: string; amountCents: number; stripeRefundId: string | null; createdAt: string }
type SR = { id: string; status: string; amount: number; created: number }
type Claim = { dedupeKey: string; createdAt: string }
type LogRow = { subject: string; status: string; sentAt: string; recipient: string }

// ── REAL measured data (2026-09-09, staging, Stripe TEST) ────────────────────────
const ORDER_PARTIAL = 'cmtju919h0001h7t6bkn5tsm0' // GR-N5TSM0 — 500 c partial
const ORDER_FULL = 'cmtj52ewh000320fboagbze1x'    // GR-GBZE1X — 1450 c full
const RESTO = 'Rehearsal Beta Grubano'
const CONSUMER = 'pilote-client@grubano.com'

const SUBJECT_PARTIAL = 'Votre remboursement partiel est confirmé — ' + RESTO
const SUBJECT_FULL = 'Votre remboursement est confirmé — ' + RESTO

const CLAIM_PARTIAL: Claim = { dedupeKey: 'order:' + ORDER_PARTIAL + ':500', createdAt: '2026-09-09T10:09:34.431Z' }
const CLAIM_FULL: Claim = { dedupeKey: 'order:' + ORDER_FULL + ':1450', createdAt: '2026-09-09T17:44:50.429Z' }

// BOTH e-mails are legitimate and BOTH are returned by the operator's EmailLog query,
// because that query can only filter by recipient + trigger + time (no order/refund key).
const LOG_PARTIAL: LogRow = { subject: SUBJECT_PARTIAL, status: 'sent', sentAt: '2026-09-09T10:09:34.846Z', recipient: CONSUMER }
const LOG_FULL: LogRow = { subject: SUBJECT_FULL, status: 'sent', sentAt: '2026-09-09T17:44:50.786Z', recipient: CONSUMER }
const BOTH_LOGS = [LOG_PARTIAL, LOG_FULL]

const ROWS_FULL: RefundRow[] = [{ id: 'cmtue1xh50000hxyor29m1sak', status: 'succeeded', amountCents: 1450, stripeRefundId: 're_3UAyauKuol4dGnN125UKXa5U', createdAt: '2026-09-09T17:44:48.500Z' }]
const ROWS_PARTIAL: RefundRow[] = [{ id: 'cmttxsfzr0000mev23go2yqio', status: 'succeeded', amountCents: 500, stripeRefundId: 're_3UB9bPKuol4dGnN10IdP5bzp', createdAt: '2026-09-09T10:09:31.500Z' }]

describe('subject template — must stay byte-identical to lib/transactional-emails.sendRefundConfirmation', () => {
  it('partial and full variants', () => {
    expect(TL.expectedRefundSubject(RESTO, true)).toBe(SUBJECT_PARTIAL)
    expect(TL.expectedRefundSubject(RESTO, false)).toBe(SUBJECT_FULL)
  })
})

describe('selectTargetRefund — never assumes one refund per order', () => {
  it('picks the succeeded row of the requested amount', () => {
    const rows: RefundRow[] = [
      { id: 'a', status: 'succeeded', amountCents: 500, stripeRefundId: 're_a', createdAt: '2026-09-09T10:00:00Z' },
      { id: 'b', status: 'succeeded', amountCents: 910, stripeRefundId: 're_b', createdAt: '2026-09-09T11:00:00Z' },
    ]
    expect(TL.selectTargetRefund(rows, 500).refund?.id).toBe('a')
    expect(TL.selectTargetRefund(rows, 910).refund?.id).toBe('b')
  })
  it('ignores pending / failed rows and reports why when nothing matches', () => {
    const rows: RefundRow[] = [
      { id: 'p', status: 'pending', amountCents: 1450, stripeRefundId: null, createdAt: '2026-09-09T10:00:00Z' },
      { id: 'f', status: 'failed', amountCents: 1450, stripeRefundId: 're_f', createdAt: '2026-09-09T10:05:00Z' },
    ]
    const r = TL.selectTargetRefund(rows, 1450)
    expect(r.refund).toBeNull()
    expect(r.selection).toMatch(/no succeeded refund row/)
  })
  it('with no amount given, takes the LATEST succeeded row (never the oldest)', () => {
    const rows: RefundRow[] = [
      { id: 'old', status: 'succeeded', amountCents: 500, stripeRefundId: 're_o', createdAt: '2026-09-09T10:00:00Z' },
      { id: 'new', status: 'succeeded', amountCents: 500, stripeRefundId: 're_n', createdAt: '2026-09-09T17:00:00Z' },
    ]
    expect(TL.selectTargetRefund(rows, null).refund?.id).toBe('new')
  })
  it('the real GR-GBZE1X row is selected for 1450 c', () => {
    expect(TL.selectTargetRefund(ROWS_FULL, 1450).refund?.stripeRefundId).toBe('re_3UAyauKuol4dGnN125UKXa5U')
  })
})

describe('THE REGRESSION — two legitimate refund e-mails for the SAME consumer', () => {
  it('FULL refund (1450) correlates to the 17:44 FULL e-mail, NOT the older 10:09 partial one', () => {
    const r = TL.correlateRefundEmail({
      dispatches: [CLAIM_FULL], logs: BOTH_LOGS, orderId: ORDER_FULL, amountCents: 1450,
      expectedSubject: SUBJECT_FULL, nextClaimAt: null,
    })
    expect(r.log).not.toBeNull()
    expect(r.log!.sentAt).toBe('2026-09-09T17:44:50.786Z')
    expect(r.log!.subject).toBe(SUBJECT_FULL)
    expect(r.subjectMatch).toBe(true)
    expect(r.ignored).toBe(1) // the 10:09 partial row is excluded: it precedes this claim
  })

  it('the OLD naive rule (oldest sent row) would have picked the WRONG e-mail — proof the defect is fixed', () => {
    const naive = BOTH_LOGS.filter((l) => l.status === 'sent')[0] // what the first version evaluated
    expect(naive.sentAt).toBe('2026-09-09T10:09:34.846Z')
    const r = TL.correlateRefundEmail({
      dispatches: [CLAIM_FULL], logs: BOTH_LOGS, orderId: ORDER_FULL, amountCents: 1450,
      expectedSubject: SUBJECT_FULL, nextClaimAt: null,
    })
    expect(r.log!.sentAt).not.toBe(naive.sentAt)
    // and the ordering verdict that follows is now correct (e-mail AFTER Stripe succeeded 17:44:48)
    expect(new Date(r.log!.sentAt).getTime()).toBeGreaterThan(new Date('2026-09-09T17:44:48.000Z').getTime())
  })

  it('PARTIAL refund (500) still correlates to its own 10:09 e-mail even though a later one exists', () => {
    const r = TL.correlateRefundEmail({
      dispatches: [CLAIM_PARTIAL], logs: BOTH_LOGS, orderId: ORDER_PARTIAL, amountCents: 500,
      expectedSubject: SUBJECT_PARTIAL, nextClaimAt: CLAIM_FULL.createdAt,
    })
    expect(r.log!.sentAt).toBe('2026-09-09T10:09:34.846Z')
    expect(r.subjectMatch).toBe(true)
  })

  it('both correlations select DIFFERENT rows — no e-mail is claimed by two refunds', () => {
    const full = TL.correlateRefundEmail({ dispatches: [CLAIM_FULL], logs: BOTH_LOGS, orderId: ORDER_FULL, amountCents: 1450, expectedSubject: SUBJECT_FULL, nextClaimAt: null })
    const part = TL.correlateRefundEmail({ dispatches: [CLAIM_PARTIAL], logs: BOTH_LOGS, orderId: ORDER_PARTIAL, amountCents: 500, expectedSubject: SUBJECT_PARTIAL, nextClaimAt: CLAIM_FULL.createdAt })
    expect(full.log!.sentAt).not.toBe(part.log!.sentAt)
  })
})

describe('computeTemplateFlag — partial vs full must follow STRIPE truth, never a sum of DB rows', () => {
  const T0 = 1788000000, T1 = T0 + 60, T2 = T0 + 120
  it('the partial rehearsal: charge 1410, one 500 refund → remaining 910 → PARTIAL', () => {
    const r: SR = { id: 're_a', status: 'succeeded', amount: 500, created: T1 }
    expect(TL.computeTemplateFlag({ chargeAmount: 1410, refunds: [r], target: r })).toEqual({ cumulativeThrough: 500, remainingAfter: 910, partial: true })
  })
  it('the full rehearsal: charge 1450, one 1450 refund → remaining 0 → FULL', () => {
    const r: SR = { id: 're_b', status: 'succeeded', amount: 1450, created: T1 }
    expect(TL.computeTemplateFlag({ chargeAmount: 1450, refunds: [r], target: r })).toEqual({ cumulativeThrough: 1450, remainingAfter: 0, partial: false })
  })
  it('THE AUDIT CASE — a Stripe-Dashboard refund has no DB row: counting Stripe truth gives FULL (what the engine sent), counting DB rows would have wrongly expected PARTIAL', () => {
    const dashboard: SR = { id: 're_dash', status: 'succeeded', amount: 400, created: T0 } // no DB Refund row exists for this one
    const rail: SR = { id: 're_rail', status: 'succeeded', amount: 1050, created: T1 }
    const stripeTruth = TL.computeTemplateFlag({ chargeAmount: 1450, refunds: [dashboard, rail], target: rail })
    expect(stripeTruth).toEqual({ cumulativeThrough: 1450, remainingAfter: 0, partial: false })
    // the old DB-only reasoning: 1050 of 1450 → would have expected the PARTIAL subject → false FAIL
    const dbOnly = TL.computeTemplateFlag({ chargeAmount: 1450, refunds: [rail], target: rail })
    expect(dbOnly.partial).toBe(true)
    expect(dbOnly.partial).not.toBe(stripeTruth.partial)
  })
  it('a NON-latest target is sliced correctly (refunds created after it are excluded)', () => {
    const first: SR = { id: 're_1', status: 'succeeded', amount: 500, created: T1 }
    const second: SR = { id: 're_2', status: 'succeeded', amount: 300, created: T2 }
    expect(TL.computeTemplateFlag({ chargeAmount: 1410, refunds: [first, second], target: first }).cumulativeThrough).toBe(500)
    expect(TL.computeTemplateFlag({ chargeAmount: 1410, refunds: [first, second], target: second }).cumulativeThrough).toBe(800)
  })
  it('failed and pending Stripe refunds never count toward the cumulative', () => {
    const failed: SR = { id: 're_f', status: 'failed', amount: 900, created: T0 }
    const pending: SR = { id: 're_p', status: 'pending', amount: 50, created: T0 }
    const ok: SR = { id: 're_ok', status: 'succeeded', amount: 1450, created: T1 }
    expect(TL.computeTemplateFlag({ chargeAmount: 1450, refunds: [failed, pending, ok], target: ok }).partial).toBe(false)
  })
})

describe('correlation safety', () => {
  it('two SUCCEEDED refunds of the same amount on one order are flagged AMBIGUOUS (they share one e-mail dedupeKey)', () => {
    const rows: RefundRow[] = [
      { id: 'r1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1', createdAt: '2026-09-09T10:00:00Z' },
      { id: 'r2', status: 'succeeded', amountCents: 500, stripeRefundId: 're_2', createdAt: '2026-09-09T12:00:00Z' },
    ]
    const sel = TL.selectTargetRefund(rows, 500)
    expect(sel.ambiguous).toBe(true)
    expect(sel.refund?.id).toBe('r2')
    expect(TL.selectTargetRefund(ROWS_FULL, 1450).ambiguous).toBe(false)
  })

  it('never selects an e-mail sent BEFORE the claim (a claim always precedes its send)', () => {
    const r = TL.correlateRefundEmail({
      dispatches: [CLAIM_FULL], logs: [LOG_PARTIAL], orderId: ORDER_FULL, amountCents: 1450,
      expectedSubject: SUBJECT_FULL, nextClaimAt: null,
    })
    expect(r.log).toBeNull()
    expect(r.selection).toMatch(/no sent e-mail at\/after the claim/)
    expect(r.ignored).toBe(1)
  })

  it('no dispatch claim → not correlatable, and no row is guessed', () => {
    const r = TL.correlateRefundEmail({
      dispatches: [CLAIM_PARTIAL], logs: BOTH_LOGS, orderId: ORDER_FULL, amountCents: 1450,
      expectedSubject: SUBJECT_FULL, nextClaimAt: null,
    })
    expect(r.claim).toBeNull()
    expect(r.log).toBeNull()
    expect(r.selection).toMatch(/no EmailDispatch claim/)
  })

  it('failed / skipped EmailLog rows are never correlated as proof of a send', () => {
    const failed: LogRow = { subject: SUBJECT_FULL, status: 'failed', sentAt: '2026-09-09T17:44:50.700Z', recipient: CONSUMER }
    const skipped: LogRow = { subject: SUBJECT_FULL, status: 'skipped', sentAt: '2026-09-09T17:44:50.750Z', recipient: CONSUMER }
    const r = TL.correlateRefundEmail({ dispatches: [CLAIM_FULL], logs: [failed, skipped], orderId: ORDER_FULL, amountCents: 1450, expectedSubject: SUBJECT_FULL, nextClaimAt: null })
    expect(r.log).toBeNull()
  })

  it('two partial refunds on the SAME order: each claim correlates to its own e-mail (window + subject)', () => {
    const order = ORDER_PARTIAL
    const c1: Claim = { dedupeKey: 'order:' + order + ':500', createdAt: '2026-09-09T10:09:34.431Z' }
    const c2: Claim = { dedupeKey: 'order:' + order + ':300', createdAt: '2026-09-09T12:00:00.100Z' }
    const l1: LogRow = { subject: SUBJECT_PARTIAL, status: 'sent', sentAt: '2026-09-09T10:09:34.846Z', recipient: CONSUMER }
    const l2: LogRow = { subject: SUBJECT_PARTIAL, status: 'sent', sentAt: '2026-09-09T12:00:00.500Z', recipient: CONSUMER }
    const first = TL.correlateRefundEmail({ dispatches: [c1, c2], logs: [l1, l2], orderId: order, amountCents: 500, expectedSubject: SUBJECT_PARTIAL, nextClaimAt: c2.createdAt })
    const second = TL.correlateRefundEmail({ dispatches: [c1, c2], logs: [l1, l2], orderId: order, amountCents: 300, expectedSubject: SUBJECT_PARTIAL, nextClaimAt: null })
    expect(first.log!.sentAt).toBe('2026-09-09T10:09:34.846Z')
    expect(second.log!.sentAt).toBe('2026-09-09T12:00:00.500Z')
  })

  it('subject mismatch is reported (not silently accepted) while still returning the in-window row', () => {
    const wrong: LogRow = { subject: SUBJECT_PARTIAL, status: 'sent', sentAt: '2026-09-09T17:44:50.786Z', recipient: CONSUMER }
    const r = TL.correlateRefundEmail({ dispatches: [CLAIM_FULL], logs: [wrong], orderId: ORDER_FULL, amountCents: 1450, expectedSubject: SUBJECT_FULL, nextClaimAt: null })
    expect(r.log).not.toBeNull()
    expect(r.subjectMatch).toBe(false)
  })
})
