// tests/claims-dprime-l8-financial-effect.test.ts — D′ L8 / T-46: THE RESTAURANT'S FINANCIAL BLOCK
//
// The rule under test is one page long and decides whether a restaurateur is shown numbers about their
// own money. It is pure on purpose (no Prisma, no Stripe), so every shape of evidence can be enumerated
// rather than sampled — including the shapes that must produce NOTHING.
//
// WHAT WOULD HAVE BEEN EASY AND WRONG. `Refund.restaurantReverseCents` and
// `Refund.applicationFeeRefundCents` are sitting right there on the row the claim already points at, and
// they read like the answer. They are PREDICTIONS computed before Stripe replied; lib/refund.ts logs
// `[MONEY REVIEW] [fee_prediction_mismatch]` when they diverge and never rewrites them. The negative
// control at the end of this file shows the divergence being displayed, so that "we could have used the
// Refund row" is a measured wrong answer and not an opinion.
import { describe, it, expect } from 'vitest'
import {
  deriveFinancialEffect, financialEffectIsSendable,
  type RefundLedgerFacts,
} from '@/lib/claim-financial-effect'

/**
 * The ledger line EXACTLY as lib/ledger.recordRefundLedgerEntry writes it, from the two Stripe facts it
 * is given. Reproduced here rather than imported so the test states the writer's arithmetic
 * independently: if the writer's field mapping ever changes, these fixtures and the production module
 * disagree and the suite says so.
 *   applicationFeeAmount = −(refund − reversal + feeBack)
 *   netToRestaurant      = −(reversal − feeBack)
 *   grossAmount          = −refund                       (so gross = fee + net always holds)
 */
const z = (n: number) => (n === 0 ? 0 : n) // the writer's own normaliser: never store -0
const line = (refund: number, reversal: number, feeBack: number): RefundLedgerFacts => ({
  grossAmount:          z(-refund),
  applicationFeeAmount: z(-(refund - reversal + feeBack)),
  netToRestaurant:      z(-(reversal - feeBack)),
})

/** A settled, unambiguously bound refund — the only starting point that can yield figures. */
const settled = (lines: RefundLedgerFacts[], over: Record<string, unknown> = {}) => deriveFinancialEffect({
  bound: true, refundStatus: 'succeeded', stripeRefundId: 're_1', ledgerLines: lines, ...over,
})

describe('the writer’s own arithmetic — the fixtures are not free-hand', () => {
  it('gross = fee + net holds for every shape used below', () => {
    for (const [r, v, f] of [[500, 500, 40], [500, 0, 0], [1000, 1000, 0], [250, 250, 20], [1, 1, 0]]) {
      const l = line(r, v, f)
      expect(l.grossAmount, `${r}/${v}/${f}`).toBe(l.applicationFeeAmount + l.netToRestaurant)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A / B — SUCCEEDED, LEDGER COMPLETE: the figures are the ledger's, to the cent
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('A — a PARTIAL refund with a complete ledger line', () => {
  it('reports the customer refund, the Grubano fee returned and the signed net impact', () => {
    // 2,50 € returned on a 10,00 € order, 20 c of commission given back, transfer fully reversed.
    expect(settled([line(250, 250, 20)])).toEqual({
      confirmed: true,
      customerRefundCents: 250,
      grubanoFeeReturnedCents: 20,
      restaurantNetImpactCents: -230,
      source: 'ledger',
    })
  })

  it('the net impact is what the restaurant’s own account moved, not the customer’s refund', () => {
    const e = settled([line(250, 250, 20)])
    expect(e.confirmed && e.restaurantNetImpactCents).toBe(-230)
    expect(e.confirmed && e.customerRefundCents).toBe(250)
    // and the three numbers close: what the customer got = what Grubano put back + what the resto bore
    expect(e.confirmed && (e.customerRefundCents + e.restaurantNetImpactCents)).toBe(20)
  })
})

describe('B — a FULL refund, same contract', () => {
  it('the whole basket returned, the Grubano fee returned with it', () => {
    expect(settled([line(1000, 1000, 80)])).toMatchObject({
      confirmed: true, customerRefundCents: 1000, grubanoFeeReturnedCents: 80, restaurantNetImpactCents: -920,
    })
  })

  it('a full refund on a commission-free order (0 %) returns no fee and the resto bears it all', () => {
    expect(settled([line(1000, 1000, 0)])).toMatchObject({
      confirmed: true, customerRefundCents: 1000, grubanoFeeReturnedCents: 0, restaurantNetImpactCents: -1000,
    })
  })

  it('one cent is still money: no rounding, no floor to zero', () => {
    expect(settled([line(1, 1, 0)])).toMatchObject({
      confirmed: true, customerRefundCents: 1, grubanoFeeReturnedCents: 0, restaurantNetImpactCents: -1,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// H — THE MODE B REHEARSAL, REPRODUCED FROM THE LEDGER SHAPE IT PRODUCED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('H — the certified Mode B numbers come out of the ledger shape, unmodified', () => {
  it('500 c refunded · 40 c of Grubano fee returned · −460 c for the restaurant', () => {
    // The 2026-09-22 rehearsal: one Stripe refund of 500 c, fee refund 40 c, the Connect reversal
    // debited on the pending balance for the full 500 c. Nothing here reads a Refund row.
    expect(settled([line(500, 500, 40)])).toEqual({
      confirmed: true,
      customerRefundCents: 500,
      grubanoFeeReturnedCents: 40,
      restaurantNetImpactCents: -460,
      source: 'ledger',
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// C / D / E / F — NO CONFIRMED FIGURES, AND THE REASON IS NAMED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('C/D — a refund Stripe has not settled yields nothing', () => {
  it('pending → refund_not_succeeded, even with a perfectly good ledger line present', () => {
    expect(deriveFinancialEffect({
      bound: true, refundStatus: 'pending', stripeRefundId: 're_1', ledgerLines: [line(500, 500, 40)],
    })).toEqual({ confirmed: false, reason: 'refund_not_succeeded' })
  })

  it('failed and canceled → the same: money that did not move is not an effect', () => {
    for (const st of ['failed', 'canceled', 'requires_action', '', null, undefined]) {
      expect(deriveFinancialEffect({
        bound: true, refundStatus: st, stripeRefundId: 're_1', ledgerLines: [line(500, 500, 40)],
      }), String(st)).toEqual({ confirmed: false, reason: 'refund_not_succeeded' })
    }
  })

  it('no refund bound at all → no_refund_bound, not a zero', () => {
    expect(deriveFinancialEffect({ bound: false })).toEqual({ confirmed: false, reason: 'no_refund_bound' })
    // A zero would read as « rien ne vous a été prélevé », which is a claim about money. Absence is not 0.
    expect(deriveFinancialEffect({ bound: false })).not.toMatchObject({ customerRefundCents: 0 })
  })
})

describe('E — a settled refund whose ledger line is absent', () => {
  it('→ ledger_line_missing, never a reconstruction from the refund amount', () => {
    expect(settled([])).toEqual({ confirmed: false, reason: 'ledger_line_missing' })
    expect(deriveFinancialEffect({
      bound: true, refundStatus: 'succeeded', stripeRefundId: 're_1', ledgerLines: null,
    })).toEqual({ confirmed: false, reason: 'ledger_line_missing' })
  })

  it('a settled refund with no re_ id cannot be looked up, and says so distinctly', () => {
    for (const id of [null, undefined, '']) {
      expect(deriveFinancialEffect({
        bound: true, refundStatus: 'succeeded', stripeRefundId: id, ledgerLines: [line(500, 500, 40)],
      }), String(id)).toEqual({ confirmed: false, reason: 'refund_id_unknown' })
    }
  })
})

describe('F — an ambiguous association is not a number', () => {
  it('two candidate lines → ledger_ambiguous (the unique key should forbid it; the guard does not assume so)', () => {
    expect(settled([line(500, 500, 40), line(500, 500, 40)])).toEqual({ confirmed: false, reason: 'ledger_ambiguous' })
  })

  it('a row bound by more than one claim → ledger_ambiguous before anything is read', () => {
    expect(settled([line(500, 500, 40)], { ambiguousBinding: true }))
      .toEqual({ confirmed: false, reason: 'ledger_ambiguous' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// G — AN EXTERNAL REFUND NEVER INVENTS A RETURNED COMMISSION
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('G — a Dashboard refund with no proven fee-back', () => {
  it('reverse transfer, no fee refund → fee returned 0, the restaurant bears the whole refund', () => {
    // This is the honest shape: Stripe pulled the money back from the connected account and no
    // application-fee refund was issued, so Grubano returned nothing.
    expect(settled([line(500, 500, 0)])).toEqual({
      confirmed: true,
      customerRefundCents: 500,
      grubanoFeeReturnedCents: 0,
      restaurantNetImpactCents: -500,
      source: 'ledger',
    })
  })

  it('NO reverse transfer → the line implies Grubano absorbed everything, and no label describes that', () => {
    // refund 500, reversal 0, feeBack 0 ⇒ applicationFeeAmount −500, netToRestaurant 0. Read literally,
    // the middle figure would say « commission Grubano restituée : 5,00 € » on a 5,00 € order. Each
    // integer is ledger truth and the sentence is still false, so nothing is shown. (The money rails
    // already alert on this shape: [MONEY REVIEW] [refund_without_reverse_transfer].)
    const l = line(500, 0, 0)
    expect(l).toEqual({ grossAmount: -500, applicationFeeAmount: -500, netToRestaurant: 0 })
    expect(settled([l], { feeChargedCents: 40 })).toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })

  it('…and the conservation bound catches it: the fee charged bounds the fee returned', () => {
    // 500 c refunded, 60 c of commission "returned" but only 40 c was ever charged ⇒ impossible.
    expect(settled([line(500, 440, 60)], { feeChargedCents: 40 }))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
    // exactly at the ceiling is fine — a full commission give-back is normal on a full refund
    expect(settled([line(500, 500, 40)], { feeChargedCents: 40 })).toMatchObject({ confirmed: true })
  })

  it('an unreadable payment line does not block the block — the three structural guards still stand', () => {
    // The ceiling is a STRICTER check, not the only one. When the payment lines could not be read the
    // figures are still ledger truth and still internally coherent, so they are shown.
    expect(settled([line(500, 500, 40)], { feeChargedCents: null })).toMatchObject({ confirmed: true })
    expect(settled([line(500, 500, 40)], { feeChargedCents: undefined })).toMatchObject({ confirmed: true })
    // …but the shape the ceiling exists to catch is ALSO caught without it, by guard (4): a refund that
    // credits the restaurant is never presented as fact.
    expect(settled([line(500, 0, 40)])).toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE GUARDS, ONE BY ONE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('a line that cannot carry the labels is refused, with the reason named', () => {
  it('the golden equation must hold: gross = fee + net', () => {
    expect(settled([{ grossAmount: -500, applicationFeeAmount: -40, netToRestaurant: -461 }]))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })

  it('a refund line with a POSITIVE gross is not a refund', () => {
    expect(settled([{ grossAmount: 500, applicationFeeAmount: 40, netToRestaurant: 460 }]))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
    expect(settled([{ grossAmount: 0, applicationFeeAmount: 0, netToRestaurant: 0 }]))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })

  it('a NEGATIVE commission returned (Grubano taking more) is refused', () => {
    expect(settled([{ grossAmount: -500, applicationFeeAmount: 20, netToRestaurant: -520 }]))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })

  it('a commission returned larger than the refund is refused', () => {
    expect(settled([{ grossAmount: -500, applicationFeeAmount: -501, netToRestaurant: 1 }]))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })

  it('a refund that CREDITS the restaurant is refused', () => {
    expect(settled([{ grossAmount: -500, applicationFeeAmount: -540, netToRestaurant: 40 }]))
      .toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
  })

  it('non-integer cents are refused before they are read as money', () => {
    for (const bad of [
      { grossAmount: -500.5, applicationFeeAmount: -40, netToRestaurant: -460.5 },
      { grossAmount: -500, applicationFeeAmount: NaN, netToRestaurant: -460 },
      { grossAmount: -500, applicationFeeAmount: -40, netToRestaurant: Infinity },
    ]) {
      expect(settled([bad]), JSON.stringify(bad)).toEqual({ confirmed: false, reason: 'ledger_inconsistent' })
    }
  })

  it('every reason this module can produce is reachable, and none is dead text', () => {
    const reasons = new Set([
      deriveFinancialEffect({ bound: false }),
      settled([line(500, 500, 40)], { ambiguousBinding: true }),
      deriveFinancialEffect({ bound: true, refundStatus: 'pending', stripeRefundId: 're_1' }),
      deriveFinancialEffect({ bound: true, refundStatus: 'succeeded', stripeRefundId: null }),
      settled([]),
      settled([line(1, 1, 0), line(1, 1, 0)]),
      settled([{ grossAmount: 1, applicationFeeAmount: 0, netToRestaurant: 1 }]),
    ].map((e) => (e.confirmed ? 'CONFIRMED' : e.reason)))
    expect(reasons).toEqual(new Set([
      'no_refund_bound', 'ledger_ambiguous', 'refund_not_succeeded', 'refund_id_unknown',
      'ledger_line_missing', 'ledger_inconsistent',
    ]))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SENDABILITY RULE (spec §16)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('a financial e-mail is sendable only when the block is confirmed', () => {
  it('confirmed → sendable; every unconfirmed reason → not sendable', () => {
    expect(financialEffectIsSendable(settled([line(500, 500, 40)]))).toBe(true)
    for (const e of [
      deriveFinancialEffect({ bound: false }),
      deriveFinancialEffect({ bound: true, refundStatus: 'pending', stripeRefundId: 're_1' }),
      settled([]),
      settled([line(500, 0, 0)], { feeChargedCents: 40 }),
    ]) {
      expect(financialEffectIsSendable(e), JSON.stringify(e)).toBe(false)
    }
  })

  it('Stripe saying succeeded is NOT sufficient: the ledger must be able to state the figures', () => {
    // spec §16 in one assertion — the refund really settled, and the e-mail is still not sendable.
    const stripeSaysSucceeded = settled([])
    expect(stripeSaysSucceeded).toEqual({ confirmed: false, reason: 'ledger_line_missing' })
    expect(financialEffectIsSendable(stripeSaysSucceeded)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROLS — the tempting wrong sources, shown to be wrong
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('negative control — deriving the block from the Refund row would be caught', () => {
  it('the PREDICTED fee refund diverges from Stripe truth, and the ledger is the one that is right', () => {
    // The real divergence lib/refund.ts logs: predicted 50 c, Stripe really gave back 40 c.
    const refundRow = { amountCents: 500, restaurantReverseCents: 500, applicationFeeRefundCents: 50 }
    const fromRow = {
      customerRefundCents: refundRow.amountCents,
      grubanoFeeReturnedCents: refundRow.applicationFeeRefundCents,
      restaurantNetImpactCents: -(refundRow.restaurantReverseCents - refundRow.applicationFeeRefundCents),
    }
    expect(fromRow).toEqual({ customerRefundCents: 500, grubanoFeeReturnedCents: 50, restaurantNetImpactCents: -450 })
    // ← the defect: a restaurateur told they bore 4,50 € when Stripe took 4,60 €
    const fromLedger = settled([line(500, 500, 40)])
    expect(fromLedger).toMatchObject({ grubanoFeeReturnedCents: 40, restaurantNetImpactCents: -460 })
    expect(fromRow.restaurantNetImpactCents).not.toBe(
      fromLedger.confirmed ? fromLedger.restaurantNetImpactCents : null,
    )
  })

  it('the module cannot read a Refund row even if a caller tries to pass one', () => {
    // Structural: the input type has no such field, so a prediction cannot enter by mistake. Passing one
    // changes nothing about the answer.
    const withJunk = deriveFinancialEffect({
      bound: true, refundStatus: 'succeeded', stripeRefundId: 're_1', ledgerLines: [line(500, 500, 40)],
      ...({ applicationFeeRefundCents: 9999, restaurantReverseCents: 9999 } as unknown as Record<string, never>),
    })
    expect(withJunk).toMatchObject({ grubanoFeeReturnedCents: 40, restaurantNetImpactCents: -460 })
  })

  it('NEGATIVE CONTROL — a pro-rata estimate would be caught: it is not what Stripe did', () => {
    // The seductive formula: commission returned ≈ charged × refund / charge. On a 1000 c charge with
    // 80 c of commission, a 500 c refund "should" return 40 c. Stripe actually returned 0 here.
    const prorata = Math.round(80 * 500 / 1000)
    expect(prorata).toBe(40)                                   // ← the estimate
    expect(settled([line(500, 500, 0)])).toMatchObject({ grubanoFeeReturnedCents: 0 }) // ← the truth
  })
})
