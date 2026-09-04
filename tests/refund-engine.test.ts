import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.5-A — lib/refund.executeRefund (the engine) · PHASE 2 additions ───────────
// Prorata execution + franchise clawback + cumul + idempotence/resume + ledger, and
// (Phase 2, REFUND-FINANCIAL-CONTRACT §8/§10.B/§15/§16) STATUS TRUTH (pending / failed),
// the fail-closed lock, the clawback cap on RECOVERED money, the >24h reversal adoption,
// the fail-closed resume listing and the Stripe-truth eager ledger.
// Prisma, Stripe, the ledger writer and the admin alerts are mocked.

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    paymentIntents:  { retrieve: vi.fn() },
    refunds:         { create: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
    transfers:       { list: vi.fn(), createReversal: vi.fn(), listReversals: vi.fn() },
    applicationFees: { listRefunds: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    order:            { findUnique: vi.fn() },
    refund:           { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    dispute:          { aggregate: vi.fn() }, // cross-rail royalty-refunded (P4.5-B)
    franchiseRoyalty: { findUnique: vi.fn(), update: vi.fn() },
    payout:           { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { ledgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn() }))
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: ledgerMock }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn(async () => ({ status: 'sent' })) }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

import { executeRefund, finalizeRefundRowFromStripe } from '@/lib/refund'
import { capClawback } from '@/lib/royalty-recovered'

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const makeCharge = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'ch_1', amount: 5000, amount_refunded: 0, application_fee_amount: 600, application_fee: 'fee_1',
  currency: 'eur', transfer_data: { destination: 'acct_r' }, metadata: { grubano_channel: 'delivery' },
  ...o,
})
const makePI = (chargeOverrides = {}) => ({
  id: 'pi_1', status: 'succeeded', transfer_data: { destination: 'acct_r' },
  latest_charge: makeCharge(chargeOverrides),
})
const paidOrder = { id: 'o1', restaurantId: 'rest1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' }
// F8 (final hardening): rows carry createdAt — a RESUME may re-send the create ONLY while
// Stripe still holds the original idempotency key (20 h window). Fresh by default.
const refundRow = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'rf1', orderId: 'o1', restaurantId: 'rest1', idempotencyKey: 'refund:o1:0',
  amountCents: 5000, restaurantReverseCents: 4400, applicationFeeRefundCents: 600,
  royaltyRefundCents: 0, stripeRefundId: null, status: 'pending', createdAt: new Date(), ...o,
})
const HOURS = 3600 * 1000
// Stripe Refund objects now carry `status` — PHASE 2 §8 reads it (a fixture WITHOUT status
// is treated as `pending`: that flip is itself the negative control of the status truth).
// They also carry the EXPANDED transfer_reversal (F2): engine refunds reverse the full amount.
const stripeRefund = (o: Partial<Record<string, unknown>> = {}) =>
  ({ id: 're_1', status: 'succeeded', amount: 5000, currency: 'eur', created: 1_700_000_000, metadata: { grubano_refund_row: 'rf1' },
     transfer_reversal: { id: 'trr_re_1', amount: (o.amount as number | undefined) ?? 5000 }, ...o })
/** Make the Stripe TRUTH resolvable for a single succeeded refund (eager ledger path). */
const truthFor = (amount: number, feeBack: number, id = 're_1') => {
  stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [stripeRefund({ id, amount })] })
  stripeMock.applicationFees.listRefunds.mockResolvedValue({ data: [{ amount: feeBack, created: 1_700_000_000 }] })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findUnique.mockResolvedValue(paidOrder)
  stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI())
  db.refund.findFirst.mockResolvedValue(null)         // no failed lock, no interrupted refund
  db.refund.findUnique.mockResolvedValue(refundRow())
  db.franchiseRoyalty.findUnique.mockResolvedValue(null) // not franchised by default
  db.refund.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...refundRow(), ...data, id: 'rf1' }))
  db.refund.update.mockResolvedValue({})
  db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 0, royaltyClawbackCents: 0 } })
  db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 0, royaltyClawbackCents: 0 } })
  db.franchiseRoyalty.update.mockResolvedValue({})
  db.payout.findUnique.mockResolvedValue(null)
  stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
  stripeMock.applicationFees.listRefunds.mockResolvedValue({ data: [] })
  stripeMock.refunds.create.mockResolvedValue(stripeRefund())
  stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund())
  stripeMock.transfers.list.mockResolvedValue({ data: [] })
  stripeMock.transfers.listReversals.mockResolvedValue({ data: [] })
  stripeMock.transfers.createReversal.mockResolvedValue({ id: 'trr_1' })
  ledgerMock.mockResolvedValue({ ok: true })
})

describe('(a) prorata — NON-franchised', () => {
  it('FULL refund: split recorded, Stripe refund reverses transfer + fee, no royalty touch, ledger = Stripe truth', async () => {
    truthFor(5000, 600)
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.amountCents).toBe(5000)
    expect(res.applicationFeeRefundCents).toBe(600)
    expect(res.restaurantReverseCents).toBe(4400)
    expect(res.royaltyClawbackCents).toBe(0)
    // Stripe refund on a routed charge → pull back the transfer AND the fee, pro-rata.
    const [params, opts] = stripeMock.refunds.create.mock.calls[0]
    expect(params).toMatchObject({ payment_intent: 'pi_1', amount: 5000, refund_application_fee: true, reverse_transfer: true })
    expect(opts).toEqual({ idempotencyKey: 'refund:o1:0' })
    // No franchise row → no royalty write, no clawback.
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    // Refund row finalized + ledger written from Stripe's REAL fee refund.
    expect(db.refund.update.mock.calls[0][0].data).toMatchObject({ status: 'succeeded', stripeRefundId: 're_1' })
    expect(ledgerMock).toHaveBeenCalledWith(expect.objectContaining({ refundId: 're_1', refundedCents: 5000, applicationFeeRefundCents: 600 }))
  })

  it('PARTIAL refund passes the exact amount to Stripe and records the prorata split', async () => {
    stripeMock.refunds.create.mockResolvedValue(stripeRefund({ amount: 2500 }))
    const res = await executeRefund({ orderId: 'o1', amountCents: 2500 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(stripeMock.refunds.create.mock.calls[0][0].amount).toBe(2500)
    expect(db.refund.create.mock.calls[0][0].data).toMatchObject({ amountCents: 2500, applicationFeeRefundCents: 300, restaurantReverseCents: 2200 })
  })

  it('[§8 fee truth] Stripe real fee refund ≠ prediction → the ledger line uses STRIPE (601, not 600), MONEY REVIEW logged', async () => {
    truthFor(5000, 601)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    expect(ledgerMock).toHaveBeenCalledWith(expect.objectContaining({ applicationFeeRefundCents: 601 }))
    expect(err.mock.calls.some(c => String(c[0]).includes('[MONEY REVIEW] [fee_prediction_mismatch]'))).toBe(true)
    err.mockRestore()
  })

  it('[§8 fee truth] attribution AMBIGUOUS (same-second ties, deviating slices) → eager ledger SKIPPED (webhook backstop), refund still ok', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ amount_refunded: 2500 }))
    stripeMock.refunds.create.mockResolvedValue(stripeRefund({ id: 're_2', amount: 2500 }))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [
      stripeRefund({ id: 're_1', amount: 2500, created: 1 }), stripeRefund({ id: 're_2', amount: 2500, created: 1 }),
    ] })
    stripeMock.applicationFees.listRefunds.mockResolvedValue({ data: [{ amount: 100, created: 1 }, { amount: 500, created: 1 }] })
    const res = await executeRefund({ orderId: 'o1', amountCents: 2500 })
    expect(res.ok).toBe(true)
    expect(ledgerMock).not.toHaveBeenCalled()
    expect(db.refund.update.mock.calls[0][0].data).toMatchObject({ status: 'succeeded' })
  })

  it('[§8 fee truth] truth unresolvable (empty lists) → eager ledger SKIPPED, never a predicted cent frozen', async () => {
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    expect(ledgerMock).not.toHaveBeenCalled()
  })
})

describe('(b)+(c) prorata + clawback — FRANCHISED', () => {
  const royaltyPending = { id: 'fr_o1', royaltyCents: 300, refundedCents: 0, status: 'pending', payoutId: null, settlementId: null, franchisorOperatorId: 'opF' }

  it('(b) PENDING royalty: refundedCents accrued, NO franchisor reversal', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue(royaltyPending)
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 300, royaltyClawbackCents: 0 } })

    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyRefundCents).toBe(300)
    expect(res.royaltyClawbackCents).toBe(0)                 // pending → still in Grubano's balance
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    // Settlement-awareness: cumulative refunded written, capped at royaltyCents.
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })

  it('(b-truth) the Stripe-truth target (Σ succeeded refunds) also raises refundedCents when the Refund aggregate lags', async () => {
    // Engine row not yet counted (aggregate 0) but Stripe truth shows the full refund → target 300.
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue(royaltyPending)
    truthFor(5000, 900)
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })

  it('(cross-rail) a refund AFTER a lost dispute does NOT erase the dispute clawback', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, refundedCents: 150 })
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 150, royaltyClawbackCents: 0 } })   // this refund's slice
    db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 150, royaltyClawbackCents: 0 } }) // the prior lost dispute
    stripeMock.refunds.create.mockResolvedValue(stripeRefund({ amount: 2500 }))

    const res = await executeRefund({ orderId: 'o1', amountCents: 2500 })
    expect(res.ok).toBe(true)
    // cross-rail: 150 (refund) + 150 (dispute) = 300, capped at royaltyCents — dispute NOT erased.
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })

  it('(c) SETTLED royalty: clawback REVERSED from the franchisor transfer (idempotent key)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, status: 'settled', payoutId: 'po1', settlementId: 'SID' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 300, royaltyClawbackCents: 0 } })

    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(300)
    const [transferId, params, opts] = stripeMock.transfers.createReversal.mock.calls[0]
    expect(transferId).toBe('tr_set')
    expect(params).toMatchObject({ amount: 300 })
    expect(opts).toEqual({ idempotencyKey: 'refund-claw:rf1' })
    expect(db.refund.update.mock.calls[0][0].data).toMatchObject({ royaltyClawbackCents: 300 })
    // Fresh path never lists reversals (a row just created cannot have one).
    expect(stripeMock.transfers.listReversals).not.toHaveBeenCalled()
  })

  it('(c-bis) SETTLED but transfer not locatable → no reversal, refundedCents still reduced', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, status: 'settling', payoutId: null, settlementId: 'SID' })
    stripeMock.transfers.list.mockResolvedValue({ data: [] })       // no transfer yet
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 300, royaltyClawbackCents: 0 } })

    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(0)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })

  it('[D-H v2] SETTLED royalty ALREADY fully recovered (dispute clawback 300) → NO second reversal, refundedCents still written', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, status: 'settled', payoutId: 'po1', settlementId: 'SID', refundedCents: 300 })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 300, royaltyClawbackCents: 300 } })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(0)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('[D-H v2 — negative control of the OLD cap] webhook target already at royaltyCents (race) → the clawback MUST still equal the slice', async () => {
    // The charge.refunded webhook (D-B) may write refundedCents = 300 BEFORE finalize runs.
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, status: 'settled', payoutId: 'po1', settlementId: 'SID', refundedCents: 300 })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(300)                       // recovered so far = 0 → full slice
    // Documentation (NOT a control of old code — the rejected round-1 DESIGN capped on
    // refundedCents and would have given min(300, 300−300) = 0 here; D-H v2 caps on recovered money):
    expect(capClawback(300, 300, 0)).toBe(300)
    expect(capClawback(300, 300, 300)).toBe(0)
  })
})

describe('(d) cumul — never exceeds the order total', () => {
  it('amount over the refundable → 400, NO row, NO Stripe refund', async () => {
    const res = await executeRefund({ orderId: 'o1', amountCents: 6000 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(400)
    expect(db.refund.create).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('a prior refund shrinks the refundable (cumul) → a too-large second is rejected', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ amount_refunded: 4000 })) // 1000 left
    const res = await executeRefund({ orderId: 'o1', amountCents: 2000 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(400)
  })

  it('fully refunded already → 409', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ amount_refunded: 5000 }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
  })
})

describe('(e) idempotence / resume', () => {
  it('cursor collision (P2002 on create) → 409, NO Stripe refund', async () => {
    db.refund.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('RESUME-FIRST: a pending row with a recorded refund id is re-driven, NO new refund created', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.resumed).toBe(true)
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_1')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()   // never a second refund
    expect(db.refund.create).not.toHaveBeenCalled()
  })

  it('RESUME-FIRST ignores the caller amount and SAYS so (resumedIgnoredAmount)', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1' }))
    const res = await executeRefund({ orderId: 'o1', amountCents: 1000 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.resumed).toBe(true)
    expect(res.resumedIgnoredAmount).toBe(true)
    expect(res.amountCents).toBe(5000)
  })

  it('RESUME adopts a tagged refund when the create response was lost (>24h backstop)', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: null }))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [stripeRefund({ id: 're_adopt', created: 1, metadata: { grubano_refund_row: 'rf1' } })] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.stripeRefundId).toBe('re_adopt')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('[§16 B2] RESUME with the adoption list UNAVAILABLE → 502, NOTHING created (fail-closed)', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: null }))
    stripeMock.refunds.list.mockRejectedValue(new Error('stripe down'))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(502)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('[§15 A1] RESUME on a SETTLED royalty ADOPTS an existing tagged reversal (pruned key) — never a second reversal', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1', royaltyRefundCents: 300, applicationFeeRefundCents: 900, restaurantReverseCents: 4100 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr_o1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'SID', franchisorOperatorId: 'opF' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: 'trr_old', amount: 300, metadata: { refundId: 'rf1' } }] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(300)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('[§16 B2] RESUME on a SETTLED royalty with the reversal list UNAVAILABLE → 502, NO reversal created', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1', royaltyRefundCents: 300 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr_o1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'SID', franchisorOperatorId: 'opF' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    stripeMock.transfers.listReversals.mockRejectedValue(new Error('stripe down'))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(502)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })
})

// ── F8 CLOSED (final hardening): ONE intended refund action ⇒ AT MOST ONE Stripe refund ──
// The resume path re-sends the create ONLY inside Stripe's idempotency window (same key ⇒
// the SAME refund, even if the list omitted it); after the window it NEVER creates again.
describe('(e-bis) F8 — one intended action, at most one Stripe economic effect', () => {
  const pendingNoId = (age = 0) => refundRow({ stripeRefundId: null, createdAt: new Date(Date.now() - age) })

  it('lost response / crash after Stripe accepted, retry BEFORE the window: list has the tagged refund → ADOPTED, no create', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(2 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [stripeRefund({ id: 're_lost', metadata: { grubano_refund_row: 'rf1' } })] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('Stripe list OMISSION + retry BEFORE the window → create re-sent under the SAME key (Stripe returns the same refund) — exactly one key ever used', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(2 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'refund:o1:0' }) // the ORIGINAL key, never a new one
  })

  it('network timeout on the ORIGINAL create (row pending, nothing at Stripe), retry within the window → one create, same key', async () => {
    stripeMock.refunds.create.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    const first = await executeRefund({ orderId: 'o1' })
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.status).toBe(502)
    // Retry: the row is now pending (no stripeRefundId); Stripe has nothing tagged.
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(60 * 1000))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    const second = await executeRefund({ orderId: 'o1' })
    expect(second.ok).toBe(true)
    const keys = stripeMock.refunds.create.mock.calls.map((c) => c[1].idempotencyKey)
    expect(new Set(keys).size).toBe(1) // both attempts under ONE key ⇒ Stripe dedupes to ONE refund
  })

  it('Stripe list OMISSION + retry AFTER the window (key pruned) → 409 fail-closed, NOTHING created, MONEY REVIEW', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(26 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(res.error).toMatch(/idempotence/)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(err.mock.calls.some((c) => String(c[0]).includes('[resume_idempotency_expired]'))).toBe(true)
    err.mockRestore()
  })

  it('retry AFTER the window but the list HAS the tagged refund → ADOPTED (no create, no lock)', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(48 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [stripeRefund({ id: 're_old', metadata: { grubano_refund_row: 'rf1' } })] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.stripeRefundId).toBe('re_old')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('TRUNCATED list (has_more) on resume → fail-closed 502, nothing created', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(1 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: true, data: [] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(502)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('same admin action replayed (double click) while the row is pending with a refund id → re-driven, ONE Stripe refund, zero creates', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1' }))
      .mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1' }))
    const a = await executeRefund({ orderId: 'o1' })
    const b = await executeRefund({ orderId: 'o1' })
    expect(a.ok && b.ok).toBe(true)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledTimes(2)
  })

  it('remaining partial headroom does NOT license a second create after the window (the ceiling is not idempotency)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ amount_refunded: 1000 })) // 4000 headroom
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(30 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    const res = await executeRefund({ orderId: 'o1', amountCents: 500 })
    expect(res.ok).toBe(false)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('two DIFFERENT legitimate partial refunds (distinct cumul cursors) → each created exactly once under its own key', async () => {
    stripeMock.refunds.create.mockResolvedValueOnce(stripeRefund({ id: 're_a', amount: 1000 }))
    const a = await executeRefund({ orderId: 'o1', amountCents: 1000 })
    expect(a.ok).toBe(true)
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ amount_refunded: 1000 }))
    stripeMock.refunds.create.mockResolvedValueOnce(stripeRefund({ id: 're_b', amount: 500 }))
    const b = await executeRefund({ orderId: 'o1', amountCents: 500 })
    expect(b.ok).toBe(true)
    const keys = stripeMock.refunds.create.mock.calls.map((c) => c[1].idempotencyKey)
    expect(keys).toEqual(['refund:o1:0', 'refund:o1:1000'])
  })

  it('[review #12] clawback RESUME on a SETTLED royalty: TRUNCATED reversal list → 502, NO reversal created', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1', royaltyRefundCents: 300, createdAt: new Date(Date.now() - 1 * HOURS) }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr_o1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'SID', franchisorOperatorId: 'opF' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    stripeMock.transfers.listReversals.mockResolvedValue({ has_more: true, data: [] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(502)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('[review #12] clawback RESUME AFTER the idempotency window with no adoptable reversal → 409 fail-closed, NO reversal created (franchisor never debited twice)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1', royaltyRefundCents: 300, createdAt: new Date(Date.now() - 30 * HOURS) }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr_o1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'SID', franchisorOperatorId: 'opF' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    stripeMock.transfers.listReversals.mockResolvedValue({ has_more: false, data: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('[negative control] the pre-hardening resume (create regardless of age) is REJECTED: an old pending row + empty list must not create', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingNoId(25 * HOURS))
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await executeRefund({ orderId: 'o1' })
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(0)
    vi.restoreAllMocks()
  })
})

describe('(f) STATUS TRUTH — PHASE 2 §8', () => {
  it('Stripe refund `pending` at creation → NON-ok 202 pending variant: row stays pending (stripeRefundId recorded), NO ledger, NO succeeded', async () => {
    stripeMock.refunds.create.mockResolvedValue(stripeRefund({ status: 'pending' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(202)
    expect(res.pending).toBe(true)
    if (!res.pending) return
    expect(res.stripeRefundId).toBe('re_1')
    expect(res.amountCents).toBe(5000)
    expect(ledgerMock).not.toHaveBeenCalled()
    const updates = db.refund.update.mock.calls.map(c => c[0].data)
    expect(updates).toEqual([{ stripeRefundId: 're_1' }])
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
  })

  it('[§16 B4] a fixture WITHOUT status (legacy) is treated as pending — never ok:true by default', async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', currency: 'eur', created: 1_700_000_000 })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(202)
  })

  it('Stripe refund `failed` → row FAILED, cursor released (key suffixed), stripeRefundId written, MONEY REVIEW alert, 409', async () => {
    stripeMock.refunds.create.mockResolvedValue(stripeRefund({ id: 're_f', status: 'failed', failure_reason: 'expired_or_canceled_card' }))
    db.refund.findUnique.mockResolvedValue(refundRow({ status: 'pending' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(db.refund.update).toHaveBeenCalledWith({
      where: { id: 'rf1' },
      data:  { status: 'failed', stripeRefundId: 're_f', idempotencyKey: 'refund:o1:0:failed:re_f' },
    })
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_failed', dedupeKey: 'refund:re_f' }))
    expect(ledgerMock).not.toHaveBeenCalled()
  })

  it('[§15 A3] RESUME retrieving a refund that FAILED at Stripe → same failed transition (the only oracle without refund.* events)', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1' }))
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ status: 'canceled' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(db.refund.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', idempotencyKey: 'refund:o1:0:failed:re_1' }) }))
  })

  it('[§8 fail-closed, §16 B5] a FAILED row on the order LOCKS it BEFORE any Stripe read / resume', async () => {
    db.refund.findFirst.mockResolvedValueOnce({ id: 'rf_old', stripeRefundId: 're_old' })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(res.error).toMatch(/reprise manuelle/)
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.refund.create).not.toHaveBeenCalled()
  })

  it('[negative control] asserting « effectué » semantics on a pending refund FAILS: ok is false and no ledger', async () => {
    stripeMock.refunds.create.mockResolvedValue(stripeRefund({ status: 'pending' }))
    const res = await executeRefund({ orderId: 'o1' })
    // Anyone asserting the pre-Phase-2 behaviour (ok:true + ledger) would fail here.
    expect(res.ok).not.toBe(true)
    expect(ledgerMock).not.toHaveBeenCalled()
  })
})

describe('(g) finalizeRefundRowFromStripe — webhook finalize path (§16 B1)', () => {
  it('pending row + Stripe succeeded → finalized (succeeded), same engine path', async () => {
    db.refund.findUnique.mockResolvedValue(refundRow({ stripeRefundId: 're_1', status: 'pending' }))
    db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'rest1', stripePaymentIntentId: 'pi_1' })
    const res = await finalizeRefundRowFromStripe('rf1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.resumed).toBe(true)
    expect(db.refund.update.mock.calls[0][0].data).toMatchObject({ status: 'succeeded' })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('[security P2-a] webhook path is ADOPT-ONLY: pending row with no stripeRefundId and no tagged refund → 502, NEVER refunds.create', async () => {
    db.refund.findUnique.mockResolvedValue(refundRow({ stripeRefundId: null, status: 'pending' }))
    db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'rest1', stripePaymentIntentId: 'pi_1' })
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    const res = await finalizeRefundRowFromStripe('rf1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(502)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('[security P2-c] markRefundRowFailed refuses to re-label a row that holds a DIFFERENT refund id', async () => {
    db.refund.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(refundRow({ stripeRefundId: 're_1' }))
    db.refund.findUnique.mockResolvedValue(refundRow({ stripeRefundId: 're_other', status: 'pending' }))
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund({ id: 're_1', status: 'failed' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    expect(db.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }))
  })

  it('already succeeded → 409 no-op ; failed → 409 locked', async () => {
    db.refund.findUnique.mockResolvedValue(refundRow({ status: 'succeeded' }))
    const a = await finalizeRefundRowFromStripe('rf1')
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.status).toBe(409)
    db.refund.findUnique.mockResolvedValue(refundRow({ status: 'failed' }))
    const b = await finalizeRefundRowFromStripe('rf1')
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.status).toBe(409)
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
  })
})

describe('guards', () => {
  it('order not found → 404', async () => {
    db.order.findUnique.mockResolvedValue(null)
    const res = await executeRefund({ orderId: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(404)
  })

  it('order not paid → 409, NO Stripe call', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: 'pending' })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  // LOT C — garde ÉLARGIE : la file manuelle ghost-order (paymentStatus
  // 'reconcile_manual' = argent RÉELLEMENT encaissé) est désormais drainable par
  // le moteur — avant, le rail censé la vider la refusait en 409.
  it('[LOT C] reconcile_manual (ghost order encaissé) → ACCEPTÉ, refund exécuté normalement', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: 'reconcile_manual' })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.amountCents).toBe(5000)
    // Le refundable reste re-vérifié LIVE côté Stripe (PI succeeded + cumul).
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] })
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
  })

  it('[LOT C] la garde élargie ne rembourse toujours PAS un statut non encaissé (null) → 409', async () => {
    db.order.findUnique.mockResolvedValue({ ...paidOrder, paymentStatus: null })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
  })
})
