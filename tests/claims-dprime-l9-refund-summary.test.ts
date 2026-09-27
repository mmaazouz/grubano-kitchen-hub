import { describe, it, expect, vi } from 'vitest'
import {
  refundedRowProven, refundedRowTruth, refundRowSettled, provenStripeRefundId, STRIPE_REFUND_ID_PREFIX,
  boundRowShowsInProgress,
} from '@/lib/claim-action-rules'
import {
  deriveOrderRefundSummary, loadOrderRefundSummary, loadRefundSummariesForOrders,
  refundSummaryApplies, refundSourceOf, refundListBadge, summaryAnomaly,
  emptyRefundSummary, EMPTY_REFUND_SUMMARY, REFUND_SUMMARY_TERMINAL_STATUSES,
  type RefundRowFacts, type LedgerLineFacts, type LoyaltyRowFacts, type OrderFactsForSummary,
} from '@/lib/order-refund-summary'
import { isReleasedRow, VOID_KEY_MARK } from '@/lib/refund-void-state'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L9 — S-20 (the hardened proof) and V-02 / T-45 (the consumer refund read-model).
//
// THE TWO DEFECTS THIS FILE PINS SHUT.
//
// (1) « Remboursée » ON A ROW THAT PROVED NOTHING. `refundedRowProven` accepted `status === 'pending'`
//     and never read `stripeRefundId` — its parameter type did not even declare the field, so no caller
//     could harden it by passing one. A claim marked `refunded` bound to a row (pending, id NULL, 500 c)
//     rendered « Remboursée » to the customer, while the SAME row in the SAME build read
//     `local_pending_unconfirmed` in the admin console and `refund_not_succeeded` in the restaurant's
//     figures. Three surfaces, one row, and the customer got the only optimistic answer.
//     The earlier frozen spec PRESCRIBED that body (R13 v1 F03) and its A-S31d entry REQUIRED
//     « Remboursée » on a pending row; spec v2 §7.2 said the opposite and was never implemented. The
//     founder's L9 §1 resolves it in favour of v2. Every pin that encoded the old rule is inverted, and
//     the negative control below is the old predicate itself.
//
// (2) THE CONSUMER WAS TOLD THE OPPOSITE OF THE TRUTH. No consumer surface read `Refund` or the ledger,
//     `Order.paymentStatus` kept asserting 'paid', and `Order.pointsEarned` is never decremented — so
//     /eat/track rendered « +14 points fidélité crédités » on an order whose points had been clawed
//     straight back. The read-model reads ROWS, never those columns.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const RE = 're_L9AAAAAAAA1'
const RE2 = 're_L9BBBBBBBB2'
const RE3 = 're_L9CCCCCCCC3'

/** A settled row, as lib/refund writes one once Stripe has named and confirmed the object. */
const settled = (over: Partial<RefundRowFacts> = {}): RefundRowFacts => ({
  status: 'succeeded', stripeRefundId: RE, amountCents: 500,
  reason: null, idempotencyKey: 'refund:o1:0', settledAt: new Date('2026-09-20T10:00:00Z'),
  createdAt: new Date('2026-09-20T09:59:00Z'), ...over,
})
const ledgerRefund = (re: string, cents: number, at = '2026-09-20T10:00:00Z'): LedgerLineFacts =>
  ({ type: 'refund', sourceEventId: re, grossAmount: -cents, createdAt: new Date(at) })
const ledgerPayment = (cents: number): LedgerLineFacts =>
  ({ type: 'payment', sourceEventId: 'pi_1', grossAmount: cents, createdAt: new Date('2026-09-19T10:00:00Z') })
const loyalty = (type: string, points: number, sourceEventId: string | null = 'prorata:v1:o1:500'): LoyaltyRowFacts =>
  ({ type, points, sourceEventId })

const derive = (over: Partial<Parameters<typeof deriveOrderRefundSummary>[0]> = {}) =>
  deriveOrderRefundSummary({ orderTotalCents: 1450, refundRows: [], ledgerLines: [], loyaltyRows: [], ...over })

// ── §1 / §25 — refundedRowProven, THE SIX MANDATED CASES ═════════════════════════════════════════════
describe('S-20 — refundedRowProven: the six cases the founder enumerated', () => {
  const row = (status: string, id: string | null, amountCents = 500) =>
    ({ orderId: 'o1', status, stripeRefundId: id, amountCents })

  it('A — succeeded + a valid re_ ⇒ REFUNDED', () => {
    expect(refundedRowProven(row('succeeded', RE), 'o1')).toBe(true)
    expect(refundRowSettled(row('succeeded', RE))).toBe(true)
  })

  it('B — pending + re_ ⇒ NOT refunded (the money has not been proven to arrive)', () => {
    expect(refundedRowProven(row('pending', RE), 'o1')).toBe(false)
    // …and it IS « en cours », which is the honest thing to say about it.
    expect(boundRowShowsInProgress(row('pending', RE))).toBe(true)
  })

  it('C — pending without re_ ⇒ NOT refunded, and not even « en cours »', () => {
    expect(refundedRowProven(row('pending', null), 'o1')).toBe(false)
    expect(boundRowShowsInProgress(row('pending', null))).toBe(false)
  })

  it('D — failed + re_ ⇒ NOT refunded (Stripe refused; the order stays locked by E2)', () => {
    expect(refundedRowProven(row('failed', RE), 'o1')).toBe(false)
  })

  it('E — succeeded WITHOUT re_ ⇒ NOT refunded: there is no object to re-read, so nothing can confirm it', () => {
    expect(refundedRowProven(row('succeeded', null), 'o1')).toBe(false)
    expect(refundedRowProven(row('succeeded', ''), 'o1')).toBe(false)
    expect(refundedRowProven(row('succeeded', 'rf_not_a_stripe_id'), 'o1')).toBe(false)  // our row id, not Stripe's
    expect(refundedRowProven(row('succeeded', 're_'), 'o1')).toBe(false)                 // the bare prefix names nothing
    // …and a SHORT but real id IS proven: the property is « there is an object we can re-read », not a length
    // rule. A length rule here would disagree with the frozen §24 set about which rows count.
    expect(refundedRowProven(row('succeeded', 're_R'), 'o1')).toBe(true)
  })

  it('F — a RELEASED row ⇒ NOT refunded, and the hardened predicate excludes it STRUCTURALLY', () => {
    // lib/refund-void-state: a release writes the PAIR (failed, stripeRefundId NULL) and marks the key.
    const released = { orderId: 'o1', status: 'failed', stripeRefundId: null, amountCents: 500, idempotencyKey: `refund:o1:0${VOID_KEY_MARK}2026-09-20T10:00:00.000Z` }
    expect(isReleasedRow(released)).toBe(true)
    expect(refundedRowProven(released, 'o1')).toBe(false)
    // The point of « structurally »: the predicate never imports the void state. `succeeded` alone
    // rejects it, so a future reader cannot forget to check for a release.
    expect(refundRowSettled({ status: 'failed', stripeRefundId: null, amountCents: 500 })).toBe(false)
  })

  it('NEGATIVE CONTROL — the OLD implementation accepted B, C and E; it is reconstructed here and shown to disagree', () => {
    const old = (r: { orderId: string; status: string; amountCents: number }, claimOrderId: string) =>
      !!r && r.orderId === claimOrderId && (r.status === 'succeeded' || r.status === 'pending')
        && typeof r.amountCents === 'number' && Number.isInteger(r.amountCents) && r.amountCents > 0
    for (const [name, r] of [
      ['B pending + re_',       row('pending', RE)],
      ['C pending, no re_',     row('pending', null)],
      ['E succeeded, no re_',   row('succeeded', null)],
    ] as const) {
      expect(old(r as never, 'o1'), `${name}: the old rule said proven`).toBe(true)
      expect(refundedRowProven(r, 'o1'), `${name}: the new rule says unproven`).toBe(false)
    }
    // …and the one case both agree on, so the control is not vacuous.
    expect(old(row('succeeded', RE) as never, 'o1')).toBe(true)
    expect(refundedRowProven(row('succeeded', RE), 'o1')).toBe(true)
  })

  it('the other-order guard and the amount guard are unchanged', () => {
    expect(refundedRowProven(row('succeeded', RE), 'OTHER')).toBe(false)
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(refundedRowProven(row('succeeded', RE, bad), 'o1'), String(bad)).toBe(false)
    }
    expect(refundedRowProven(null, 'o1')).toBe(false)
    expect(refundedRowProven(undefined, 'o1')).toBe(false)
  })

  it('refundedRowTruth still fails closed on an unreadable or ambiguous binding, ON TOP of the proof', () => {
    const good = row('succeeded', RE)
    expect(refundedRowTruth(good, null, 'o1')).toBe(null)   // unreadable binder count
    expect(refundedRowTruth(good, 2, 'o1')).toBe(null)      // A-S43 ambiguous
    expect(refundedRowTruth(good, 1, 'o1')).toBe(true)
    expect(refundedRowTruth(row('pending', RE), 1, 'o1')).toBe(false)
  })

  it('THE ID CONTRACT is the ROW-READING one, identical to the frozen §24 predicate — not the input-validation regex', () => {
    // TWO contracts exist in this repository and they are not interchangeable. This predicate reads OUR OWN
    // stored row, so it must agree with the set the loyalty authority already reconciles against
    // (`lib/loyalty-prorata.isStripeRefundId`, the frozen §24 union). The narrower
    // /^re_[A-Za-z0-9]{8,}$/ in lib/claims guards an id a HUMAN TYPES into the adoption route — it protects a
    // write, and using it to read our own rows would make two parts of one system disagree about which rows
    // count. That is the defect T-46 shipped and had to fix a day earlier, so it is pinned here instead.
    expect(STRIPE_REFUND_ID_PREFIX).toBe('re_')
    expect(provenStripeRefundId('re_3Nk9xQ2eZvKYlo2C')).toBe(true)
    for (const bad of ['re_', '', 'pi_3Nk9xQ2eZvKYlo2C', 'rf_1', 'R', null, undefined, 42, {}, []]) {
      expect(provenStripeRefundId(bad as never), JSON.stringify(bad)).toBe(false)
    }
    // PARITY with the §24 predicate, on a shared fixture, so the two cannot drift apart. lib/loyalty-prorata
    // is the L6.1 authority's input assembler and is PINNED by §29, so parity is asserted, never shared.
    const prorata = require('node:fs').readFileSync('lib/loyalty-prorata.ts', 'utf8') as string
    expect(prorata).toContain("typeof v === 'string' && v.startsWith('re_')")
    const theirs = (v: unknown): boolean => typeof v === 'string' && v.startsWith('re_')
    for (const v of ['re_3Nk9xQ2eZvKYlo2C', 're_R', 're_1', 'pi_1', 'rf_1', '', null, 42]) {
      // Identical on everything except the bare prefix, where ours is STRICTER (an id with nothing after
      // `re_` names no object). Asserted rather than assumed, so a future divergence is a red test.
      if (v === 're_') continue
      expect(provenStripeRefundId(v as never), JSON.stringify(v)).toBe(theirs(v))
    }
    expect(theirs('re_')).toBe(true)
    expect(provenStripeRefundId('re_')).toBe(false)
    // …and the input-validation regex stays where it belongs, untouched.
    const claimsSrc = require('node:fs').readFileSync('lib/claims.ts', 'utf8') as string
    expect(claimsSrc).toContain('/^re_[A-Za-z0-9]{8,}$/')
  })
})

// ── §26 — refundSummary, THE THIRTEEN MANDATED CASES ═════════════════════════════════════════════════
describe('V-02 — the consumer refund read-model: the cases A–M the founder enumerated', () => {
  it('A — no refund ⇒ refundedCents 0, and the whole shape is the stable empty one', () => {
    const s = derive()
    expect(s.refundedCents).toBe(0)
    expect(s.pendingCents).toBe(0)
    expect(s.unattributedCents).toBe(0)
    expect(s.isTotal).toBe(false)
    expect(s.isPartial).toBe(false)
    expect(s.refunds).toEqual([])
  })

  it('B — a partial settled refund of 500 on a 1450 charge ⇒ 500, isPartial', () => {
    const s = derive({ refundRows: [settled({ amountCents: 500 })], ledgerLines: [ledgerPayment(1450)] })
    expect(s.refundedCents).toBe(500)
    expect(s.chargeCents).toBe(1450)
    expect(s.isPartial).toBe(true)
    expect(s.isTotal).toBe(false)
  })

  it('C — a full settled refund ⇒ isTotal', () => {
    const s = derive({ refundRows: [settled({ amountCents: 1450 })], ledgerLines: [ledgerPayment(1450)] })
    expect(s.refundedCents).toBe(1450)
    expect(s.isTotal).toBe(true)
    expect(s.isPartial).toBe(false)
  })

  it('D — pending ONLY ⇒ pendingCents > 0 and refundedCents 0: nothing may read as « remboursé »', () => {
    const s = derive({ refundRows: [settled({ status: 'pending', amountCents: 700 })], ledgerLines: [ledgerPayment(1450)] })
    expect(s.pendingCents).toBe(700)
    expect(s.refundedCents).toBe(0)
    expect(s.isPartial).toBe(false)
    expect(s.isTotal).toBe(false)
    expect(s.refunds).toEqual([])          // the history states settled money only
  })

  it('E — settled AND pending ⇒ the two are separate figures, never summed', () => {
    const s = derive({
      refundRows: [settled({ amountCents: 500 }), settled({ status: 'pending', stripeRefundId: RE2, amountCents: 300 })],
      ledgerLines: [ledgerPayment(1450)],
    })
    expect(s.refundedCents).toBe(500)
    expect(s.pendingCents).toBe(300)
    expect(s.refundedCents + s.pendingCents).toBe(800)   // the reader may add them; the model never does
    expect(s.refunds).toHaveLength(1)
  })

  it('F — a failed row is absent from the confirmed figure and from the history', () => {
    const s = derive({ refundRows: [settled({ status: 'failed' })], ledgerLines: [ledgerPayment(1450)] })
    expect(s.refundedCents).toBe(0)
    expect(s.pendingCents).toBe(0)
    expect(s.refunds).toEqual([])
  })

  it('G — two settled refunds ⇒ the cumulative sum, and both lines in the history newest first', () => {
    const s = derive({
      refundRows: [
        settled({ amountCents: 500, settledAt: new Date('2026-09-20T10:00:00Z') }),
        settled({ amountCents: 400, stripeRefundId: RE2, settledAt: new Date('2026-09-21T10:00:00Z') }),
      ],
      ledgerLines: [ledgerPayment(1450)],
    })
    expect(s.refundedCents).toBe(900)
    expect(s.isPartial).toBe(true)
    expect(s.refunds.map((r) => r.amountCents)).toEqual([400, 500])
  })

  it('H — an EXTERNAL ledger refund with no row of ours ⇒ unattributedCents, never refundedCents', () => {
    const s = derive({ ledgerLines: [ledgerPayment(1450), ledgerRefund(RE3, 1450)] })
    expect(s.unattributedCents).toBe(1450)
    expect(s.refundedCents).toBe(0)                 // §4: rows only
    // AND IT IS TOTAL. This assertion used to read `false`, and that was the P0 the adversarial review found:
    // « nothing we can ATTRIBUTE was refunded » confused provenance with arrival. A `type:'refund'` ledger
    // line exists only for a refund Stripe reported succeeded, so 1450 c of a 1450 c charge did come back —
    // the customer was fully refunded and only the ORIGIN is unproven. §8 asks the flags to follow the
    // confirmed cumulative, and calling this order « not fully refunded » was the opposite of that.
    expect(s.isTotal).toBe(true)
    expect(s.isPartial).toBe(false)
    // What §6 protects is the COPY: no cause, no totality stated ABOUT that money. The card enforces it by
    // refusing to print a figure it cannot complete, which is asserted in the P0 regression test below.
  })

  it('I — a Refund row and a ledger line for the SAME re_ ⇒ counted ONCE, never twice', () => {
    const s = derive({
      refundRows:  [settled({ amountCents: 500 })],
      ledgerLines: [ledgerPayment(1450), ledgerRefund(RE, 500)],
    })
    expect(s.refundedCents).toBe(500)
    expect(s.unattributedCents).toBe(0)
    expect(s.refundedCents + s.unattributedCents).toBe(500)
  })

  it('I-bis — ONLY A SETTLED ROW ATTRIBUTES MONEY; the ledger decides whether it ARRIVED', () => {
    // The rule, after the adversarial review corrected it. Two questions, answered by two sources:
    //   DID IT ARRIVE?  the LEDGER. A `type:'refund'` line exists only for a refund Stripe reported
    //                   succeeded, so such a line is proof — the same proof the frozen §24 set uses.
    //   WHOSE IS IT?    a SETTLED row. A `pending` row is an unfinished attempt and a `failed` row is an
    //                   abandoned one; neither establishes the refund as ours, whatever id it carries.
    // The first version conflated them: it let a pending row CLAIM the ledger line (so the money left the
    // unattributed bucket) while still counting that money as in-flight — so the tracking page said
    // « Remboursement de 5,00 € en cours » about money the ledger already proved had arrived, and the list
    // showed nothing. The three buckets are now disjoint.
    const arrived = derive({
      refundRows:  [settled({ amountCents: 500 })],                       // succeeded → attributed
      ledgerLines: [ledgerPayment(1450), ledgerRefund(RE, 500)],
    })
    expect(arrived).toMatchObject({ refundedCents: 500, pendingCents: 0, unattributedCents: 0 })

    for (const status of ['pending', 'failed']) {
      const s = derive({
        refundRows:  [settled({ status, amountCents: 500 })],
        ledgerLines: [ledgerPayment(1450), ledgerRefund(RE, 500)],
      })
      // arrived (the ledger says so) but not attributable to a completed refund of ours
      expect(s.refundedCents, status).toBe(0)
      expect(s.pendingCents, status).toBe(0)          // NEVER « en cours » for money that landed
      expect(s.unattributedCents, status).toBe(500)   // neutral copy, and it counts toward the total
      expect(s.isTotal, status).toBe(false)           // 500 of 1450
      expect(s.isPartial, status).toBe(true)
    }

    // …and a pending row with NO ledger line is still genuinely in flight.
    const inFlight = derive({
      refundRows:  [settled({ status: 'pending', amountCents: 500 })],
      ledgerLines: [ledgerPayment(1450)],
    })
    expect(inFlight).toMatchObject({ refundedCents: 0, pendingCents: 500, unattributedCents: 0 })
  })

  it('P1 REGRESSION — a full refund whose row never finalised reads TOTAL, and never « en cours »', () => {
    // The permanent failure the rules layer documents: the engine writes the ledger line before setting
    // `stripeRefundId`, so a process killed between the two leaves a row that never says succeeded while
    // Stripe has already paid the customer. 14,10 € of 14,10 € is back.
    const s = derive({
      refundRows:  [settled({ status: 'pending', amountCents: 1410 })],
      ledgerLines: [ledgerPayment(1410), ledgerRefund(RE, 1410)],
      orderTotalCents: 1410,
    })
    expect(s.pendingCents).toBe(0)
    expect(s.unattributedCents).toBe(1410)
    expect(s.isTotal).toBe(true)
    expect(s.isPartial).toBe(false)
    // the card states the neutral word rather than a figure it cannot complete
    expect(refundListBadge(s)).toEqual({ refundedCents: 0, unattributedCents: 1410, isTotal: true, isPartial: false })
  })

  it('J — an earn_reversal ⇒ pointsReversed, read from the ROW and not from Order.pointsEarned', () => {
    const s = derive({ refundRows: [settled({ amountCents: 1450 })], loyaltyRows: [loyalty('earn', 14, null), loyalty('earn_reversal', -14)] })
    expect(s.pointsReversed).toBe(14)
    expect(s.pointsRestored).toBe(0)
  })

  it('K — a refund/restoration row ⇒ pointsRestored', () => {
    const s = derive({ refundRows: [settled()], loyaltyRows: [loyalty('redeem', -50, null), loyalty('refund', 50)] })
    expect(s.pointsRestored).toBe(50)
    expect(s.pointsReversed).toBe(0)
  })

  it('K-bis — SIGNED sums: an L6.1 give-back reduces the clawback instead of reading as more of it', () => {
    // lib/loyalty-prorata: `earn_reversal` is NEGATIVE on a clawback and POSITIVE on a convergence
    // give-back. Summing magnitudes would report 14 + 4 = 18 points taken from a customer who lost 10.
    const s = derive({ loyaltyRows: [loyalty('earn_reversal', -14), loyalty('earn_reversal', +4, 'prorata:v1:o1:900')] })
    expect(s.pointsReversed).toBe(10)
    expect(s.pointsReversed).not.toBe(18)
  })

  it('K-ter — a LEGACY restore row (sourceEventId null) still counts as restored, and states no prorata', () => {
    const s = derive({ loyaltyRows: [loyalty('refund', 50, null)] })
    expect(s.pointsRestored).toBe(50)
    // The model exposes two integers and no rate, so a grandfathered full re-credit cannot be misread as
    // a prorated one — there is no prorata figure anywhere in the payload.
    expect(Object.keys(s)).not.toContain('pointsProrata')
  })

  it('K-quater — offset_waiver rows never reach a per-order summary (orderId is always null on them)', () => {
    // Defensive: even if one were handed in, it is neither a reversal nor a restoration.
    const s = derive({ loyaltyRows: [loyalty('offset_waiver', 6, null)] })
    expect(s.pointsReversed).toBe(0)
    expect(s.pointsRestored).toBe(0)
  })

  it('L — a NON-TERMINAL order is not aggregated at all (§9)', () => {
    for (const status of ['received', 'preparing', 'ready', 'picked_up', 'awaiting_payment']) {
      expect(refundSummaryApplies({ status, stripePaymentIntentId: 'pi_1' }), status).toBe(false)
    }
    for (const status of REFUND_SUMMARY_TERMINAL_STATUSES) {
      expect(refundSummaryApplies({ status, stripePaymentIntentId: 'pi_1' }), status).toBe(true)
    }
    expect(REFUND_SUMMARY_TERMINAL_STATUSES).toEqual(['delivered', 'cancelled', 'expired'])
  })

  it('M — no PaymentIntent ⇒ the stable empty summary, whatever the status', () => {
    for (const status of REFUND_SUMMARY_TERMINAL_STATUSES) {
      expect(refundSummaryApplies({ status, stripePaymentIntentId: null }), status).toBe(false)
    }
    expect(emptyRefundSummary()).toEqual({ ...EMPTY_REFUND_SUMMARY, refunds: [] })
  })
})

// ── §8 — the total/partial edges, including the one that must NOT rewrite data ════════════════════════
describe('V-02 — TOTAL vs PARTIAL, and the over-refund anomaly', () => {
  it('a pending refund that WOULD reach the total keeps the order non-total', () => {
    const s = derive({
      refundRows:  [settled({ amountCents: 500 }), settled({ status: 'pending', stripeRefundId: RE2, amountCents: 950 })],
      ledgerLines: [ledgerPayment(1450)],
    })
    expect(s.refundedCents + s.pendingCents).toBe(1450)
    expect(s.isTotal).toBe(false)
    expect(s.isPartial).toBe(true)
  })

  it('P0 REGRESSION — a TWO-RAIL full refund is TOTAL, not « partiel », and the card states no figure it cannot complete', async () => {
    // FOUND BY THE ADVERSARIAL REVIEW OF THIS LOT, and it had reached a measured screen. A 14,10 € order
    // refunded by two rails — 10,00 € through the claim engine (a `Refund` row) and the remaining 4,10 € from
    // the Stripe Dashboard (a ledger line and NO row, because only lib/refund and the adoption mirror create
    // rows) — computed its flags from `refundedCents` ALONE and answered isPartial TRUE. The list card then
    // read « Remboursement partiel 10,00 € » on an order whose customer had received every cent, understated
    // by 410 c, while the loyalty side had already clawed back ALL 14 points because the FROZEN §24 set unions
    // rows WITH ledger lines. One build, one Stripe object, two different stories — the T-46 defect's shape.
    const s = derive({
      refundRows:  [settled({ amountCents: 1000 })],
      ledgerLines: [ledgerPayment(1410), ledgerRefund(RE, 1000), ledgerRefund(RE3, 410)],
      loyaltyRows: [loyalty('earn_reversal', -14)],
      orderTotalCents: 1410,
    })
    expect(s.refundedCents).toBe(1000)              // §4: rows only, unchanged
    expect(s.unattributedCents).toBe(410)
    expect(s.refundedCents + s.unattributedCents).toBe(1410)
    expect(s.chargeCents).toBe(1410)
    // THE FIX: the flags follow the whole CONFIRMED cumulative (§8). A ledger refund line exists only for a
    // refund Stripe reported succeeded, so that money arrived — it is merely unattributed.
    expect(s.isTotal).toBe(true)
    expect(s.isPartial).toBe(false)
    // …and the faulty verdict is named, so this cannot silently regress.
    expect(s.isPartial).not.toBe(true)
    // THE CARD must not print 10,00 € as though it were the whole refund: it carries the unattributed figure
    // precisely so it can choose silence-with-a-neutral-word over an understatement.
    const badge = refundListBadge(s)
    expect(badge).toEqual({ refundedCents: 1000, unattributedCents: 410, isTotal: true, isPartial: false })
    const page = require('node:fs').readFileSync('app/[locale]/eat/orders/page.tsx', 'utf8') as string
    expect(page).toContain("if (other > 0) return t('refundedRecordedBadge')")
    // and the neutral key exists in all five locales
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = require(`../messages/${loc}.json`)
      expect(m.eat.orders.refundedRecordedBadge, loc).toBeTruthy()
    }
  })

  it('P0 REGRESSION — the pending half still never reaches the flags', async () => {
    // The fix widened the flags to the confirmed cumulative; it must NOT have let pending in.
    const s = derive({
      refundRows:  [settled({ status: 'pending', amountCents: 1410 })],
      ledgerLines: [ledgerPayment(1410)],
    })
    expect(s.pendingCents).toBe(1410)
    expect(s.isTotal).toBe(false)
    expect(s.isPartial).toBe(false)
  })

  it('chargeCents comes from the ledger payment line, and falls back to the order total by NAME', () => {
    expect(derive({ ledgerLines: [ledgerPayment(1400)] }).chargeCents).toBe(1400)
    expect(derive({ ledgerLines: [] }).chargeCents).toBe(1450)            // round(14.50 × 100)
    expect(derive({ orderTotalCents: 0, ledgerLines: [] }).chargeCents).toBe(0)
  })

  it('an over-refund is REPORTED, never rewritten (§8)', () => {
    const s = derive({ refundRows: [settled({ amountCents: 2000 })], ledgerLines: [ledgerPayment(1450)] })
    expect(s.refundedCents).toBe(2000)                 // as measured — not clamped to 1450
    expect(s.isTotal).toBe(true)
    expect(summaryAnomaly(s)).toContain('refunded_above_charge')
    expect(summaryAnomaly(derive({ refundRows: [settled()], orderTotalCents: 0 }))).toBe('refunded_with_no_charge_reference')
    expect(summaryAnomaly(derive({ refundRows: [settled({ amountCents: 500 })], ledgerLines: [ledgerPayment(1450)] }))).toBe(null)
  })

  it('a zero charge never produces isTotal out of nothing', () => {
    expect(derive({ orderTotalCents: 0, ledgerLines: [] }).isTotal).toBe(false)
  })
})

// ── §7 — the source vocabulary, and the zero-leak contract ════════════════════════════════════════════
describe('V-02 — refunds[]: three fields, four sources, and nothing else', () => {
  it('the source is normalised to exactly the four allowed words', () => {
    expect(refundSourceOf({ reason: 'claim:cl_123', idempotencyKey: 'refund:o1:0' })).toBe('claim')
    expect(refundSourceOf({ reason: 'ghost_order_expired', idempotencyKey: 'refund:o1:0' })).toBe('system')
    expect(refundSourceOf({ reason: 'admin:orders/[id]/refund', idempotencyKey: 'refund:o1:0' })).toBe('support')
    expect(refundSourceOf({ reason: null, idempotencyKey: 'refund:o1:0' })).toBe('support')
    expect(refundSourceOf({ reason: 'anything at all', idempotencyKey: `external:${RE}` })).toBe('external')
    // the mirror wins over the reason it copied — a Dashboard refund adopted into a claim is still external
    expect(refundSourceOf({ reason: 'claim:cl_123', idempotencyKey: `external:${RE}` })).toBe('external')
  })

  it('a NULL reason is « support », because that is the commonest support row', () => {
    // /api/admin/refunds/run makes `reason` optional, so the naive « reason NOT LIKE claim:% » reading
    // would have dropped exactly this row. Here it must be classified, not lost.
    const s = derive({ refundRows: [settled({ reason: null })] })
    expect(s.refunds).toHaveLength(1)
    expect(s.refunds[0].source).toBe('support')
  })

  it('ZERO LEAK — a history line carries exactly amountCents, at and source', () => {
    const s = derive({ refundRows: [settled()] })
    expect(Object.keys(s.refunds[0]).sort()).toEqual(['amountCents', 'at', 'source'])
  })

  it('ZERO LEAK — the summary payload carries exactly the nine contracted fields and no internal identifier', () => {
    const s = derive({
      refundRows:  [settled({ reason: 'claim:cl_secret' })],
      ledgerLines: [ledgerPayment(1450), ledgerRefund(RE3, 100)],
      loyaltyRows: [loyalty('earn_reversal', -14)],
    })
    expect(Object.keys(s).sort()).toEqual([
      'chargeCents', 'isPartial', 'isTotal', 'pendingCents', 'pointsRestored', 'pointsReversed',
      'refundedCents', 'refunds', 'unattributedCents',
    ])
    const json = JSON.stringify(s)
    for (const secret of [RE, RE2, RE3, 'pi_', 'cl_secret', 'claim:', 'external:', 'refund:o1:0', 'prorata:', 'grossAmount', 'applicationFee', 'netToRestaurant', 'sourceEventId', 'idempotencyKey', 'stripeRefundId']) {
      expect(json, `leaked: ${secret}`).not.toContain(secret)
    }
  })

  it('the LIST badge is the minimal shape, with no history and no pending (§11)', () => {
    const s = derive({ refundRows: [settled({ amountCents: 500 }), settled({ status: 'pending', stripeRefundId: RE2, amountCents: 300 })], ledgerLines: [ledgerPayment(1450)] })
    // FOUR fields, not three. `unattributedCents` is carried because without it a card holding the amount and
    // the flags cannot tell « fully refunded, 14,10 € » from « fully refunded, of which only 10,00 € is ours
    // to name » — and it would print the smaller figure as if it were the whole refund. Still no `refunds[]`
    // and still no pending figure: a card is not the place to explain a refund.
    expect(Object.keys(refundListBadge(s)).sort()).toEqual(['isPartial', 'isTotal', 'refundedCents', 'unattributedCents'])
    expect(refundListBadge(s)).toEqual({ refundedCents: 500, unattributedCents: 0, isTotal: false, isPartial: true })
  })
})

// ── §9 — the loaders: query counts, no N+1, and the shapes they ask for ══════════════════════════════
describe('V-02 — the loaders: bounded query counts and no N+1 (§9)', () => {
  const db = () => {
    const refund = vi.fn().mockResolvedValue([])
    const ledgerEntry = vi.fn().mockResolvedValue([])
    const loyaltyTransaction = vi.fn().mockResolvedValue([])
    return {
      db: { refund: { findMany: refund }, ledgerEntry: { findMany: ledgerEntry }, loyaltyTransaction: { findMany: loyaltyTransaction } },
      refund, ledgerEntry, loyaltyTransaction,
    }
  }
  const order = (over: Partial<OrderFactsForSummary> = {}): OrderFactsForSummary =>
    ({ id: 'o1', status: 'delivered', total: 14.5, stripePaymentIntentId: 'pi_1', ...over })

  it('one order ⇒ exactly THREE queries, and none of them is per-row', async () => {
    const h = db()
    await loadOrderRefundSummary(h.db, order())
    expect(h.refund).toHaveBeenCalledTimes(1)
    expect(h.ledgerEntry).toHaveBeenCalledTimes(1)
    expect(h.loyaltyTransaction).toHaveBeenCalledTimes(1)
  })

  it('a non-terminal order or one without a PaymentIntent ⇒ ZERO queries (the 15 s poll pays nothing)', async () => {
    for (const o of [order({ status: 'preparing' }), order({ status: 'received' }), order({ stripePaymentIntentId: null })]) {
      const h = db()
      const s = await loadOrderRefundSummary(h.db, o)
      expect(h.refund).not.toHaveBeenCalled()
      expect(h.ledgerEntry).not.toHaveBeenCalled()
      expect(h.loyaltyTransaction).not.toHaveBeenCalled()
      expect(s).toEqual(emptyRefundSummary())
    }
  })

  it('the queries read by the indexed key and never by a Stripe id', async () => {
    const h = db()
    await loadOrderRefundSummary(h.db, order())
    expect(h.refund.mock.calls[0][0]).toMatchObject({ where: { orderId: 'o1' } })
    expect(h.ledgerEntry.mock.calls[0][0]).toMatchObject({ where: { stripePaymentIntentId: 'pi_1', type: { in: ['payment', 'refund'] } } })
    expect(h.loyaltyTransaction.mock.calls[0][0]).toMatchObject({ where: { orderId: 'o1' } })
    // the ledger has no orderId column: the PaymentIntent IS the join, and it is @unique on Order
    expect(JSON.stringify(h.ledgerEntry.mock.calls[0][0])).not.toContain('orderId')
  })

  it('a PAGE of 50 orders ⇒ still exactly THREE queries (N+1 would be 150)', async () => {
    const h = db()
    const orders = Array.from({ length: 50 }, (_, i) => order({ id: `o${i}`, stripePaymentIntentId: `pi_${i}` }))
    const map = await loadRefundSummariesForOrders(h.db, orders)
    expect(h.refund).toHaveBeenCalledTimes(1)
    expect(h.ledgerEntry).toHaveBeenCalledTimes(1)
    expect(h.loyaltyTransaction).toHaveBeenCalledTimes(1)
    expect(map.size).toBe(50)
    expect(h.refund.mock.calls[0][0]).toMatchObject({ where: { orderId: { in: orders.map((o) => o.id) } } })
  })

  it('a page with NO eligible order ⇒ ZERO queries', async () => {
    const h = db()
    const map = await loadRefundSummariesForOrders(h.db, [order({ status: 'preparing' }), order({ id: 'o2', stripePaymentIntentId: null })])
    expect(h.refund).not.toHaveBeenCalled()
    expect(map.get('o1')).toEqual(emptyRefundSummary())
    expect(map.get('o2')).toEqual(emptyRefundSummary())
  })

  it('the batched path attributes each row to its own order and each ledger line to its own PI', async () => {
    const h = db()
    h.refund.mockResolvedValue([
      { ...settled({ amountCents: 500 }), orderId: 'oA' },
      { ...settled({ amountCents: 900, stripeRefundId: RE2 }), orderId: 'oB' },
    ])
    h.ledgerEntry.mockResolvedValue([
      { ...ledgerPayment(1450), stripePaymentIntentId: 'pi_A' },
      { ...ledgerPayment(900),  stripePaymentIntentId: 'pi_B' },
    ])
    h.loyaltyTransaction.mockResolvedValue([{ ...loyalty('earn_reversal', -14), orderId: 'oB' }])
    const map = await loadRefundSummariesForOrders(h.db, [
      order({ id: 'oA', stripePaymentIntentId: 'pi_A', total: 14.5 }),
      order({ id: 'oB', stripePaymentIntentId: 'pi_B', total: 9 }),
    ])
    expect(map.get('oA')).toMatchObject({ refundedCents: 500, chargeCents: 1450, isPartial: true, isTotal: false, pointsReversed: 0 })
    expect(map.get('oB')).toMatchObject({ refundedCents: 900, chargeCents: 900, isTotal: true, isPartial: false, pointsReversed: 14 })
  })

  it('PERF CONTRACT (source pin) — no loader may read Stripe, and the detail loader may not loop a query', () => {
    const src = require('node:fs').readFileSync('lib/order-refund-summary.ts', 'utf8') as string
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const forbidden of ['@/lib/stripe', 'stripe.', 'getStripe', 'fetch(']) {
      expect(code, forbidden).not.toContain(forbidden)
    }
    // no query inside a loop: every findMany sits in a Promise.all, and there are exactly six of them
    // (three for one order, three for a page).
    expect((code.match(/findMany\(/g) ?? []).length).toBe(6)
    expect((code.match(/Promise\.all\(/g) ?? []).length).toBe(2)
    // and the model never reads the two columns that lie after a refund
    expect(code).not.toContain('pointsEarned')
    expect(code).not.toContain('paymentStatus')
  })
})
