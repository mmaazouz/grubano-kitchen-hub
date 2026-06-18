import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.5-A — lib/refund.executeRefund (the engine) ───────────────────────────────
// Prorata execution + franchise clawback + cumul + idempotence/resume + ledger.
// Prisma, Stripe and the ledger writer are mocked.

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { create: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
    transfers:      { list: vi.fn(), createReversal: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    order:            { findUnique: vi.fn() },
    refund:           { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    franchiseRoyalty: { findUnique: vi.fn(), update: vi.fn() },
    payout:           { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { ledgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn() }))
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: ledgerMock }))

import { executeRefund } from '@/lib/refund'

// ── Fixtures ─────────────────────────────────────────────────────────────────────
const makeCharge = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'ch_1', amount: 5000, amount_refunded: 0, application_fee_amount: 600,
  currency: 'eur', transfer_data: { destination: 'acct_r' }, metadata: { grubano_channel: 'delivery' },
  ...o,
})
const makePI = (chargeOverrides = {}) => ({
  id: 'pi_1', status: 'succeeded', transfer_data: { destination: 'acct_r' },
  latest_charge: makeCharge(chargeOverrides),
})
const paidOrder = { id: 'o1', restaurantId: 'rest1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' }
const refundRow = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'rf1', orderId: 'o1', restaurantId: 'rest1', idempotencyKey: 'refund:o1:0',
  amountCents: 5000, restaurantReverseCents: 4400, applicationFeeRefundCents: 600,
  royaltyRefundCents: 0, stripeRefundId: null, ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findUnique.mockResolvedValue(paidOrder)
  stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI())
  db.refund.findFirst.mockResolvedValue(null)         // no interrupted refund
  db.franchiseRoyalty.findUnique.mockResolvedValue(null) // not franchised by default
  db.refund.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...refundRow(), ...data, id: 'rf1' }))
  db.refund.update.mockResolvedValue({})
  db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 0 } })
  db.franchiseRoyalty.update.mockResolvedValue({})
  db.payout.findUnique.mockResolvedValue(null)
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
  stripeMock.refunds.create.mockResolvedValue({ id: 're_1', currency: 'eur', created: 1_700_000_000 })
  stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', currency: 'eur', created: 1_700_000_000 })
  stripeMock.transfers.list.mockResolvedValue({ data: [] })
  stripeMock.transfers.createReversal.mockResolvedValue({ id: 'trr_1' })
  ledgerMock.mockResolvedValue({ ok: true })
})

describe('(a) prorata — NON-franchised', () => {
  it('FULL refund: split recorded, Stripe refund reverses transfer + fee, no royalty touch', async () => {
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
    // Refund row finalized + ledger written.
    expect(db.refund.update.mock.calls[0][0].data).toMatchObject({ status: 'succeeded', stripeRefundId: 're_1' })
    expect(ledgerMock).toHaveBeenCalledWith(expect.objectContaining({ refundId: 're_1', refundedCents: 5000, applicationFeeRefundCents: 600 }))
  })

  it('PARTIAL refund passes the exact amount to Stripe and records the prorata split', async () => {
    const res = await executeRefund({ orderId: 'o1', amountCents: 2500 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(stripeMock.refunds.create.mock.calls[0][0].amount).toBe(2500)
    expect(db.refund.create.mock.calls[0][0].data).toMatchObject({ amountCents: 2500, applicationFeeRefundCents: 300, restaurantReverseCents: 2200 })
  })
})

describe('(b)+(c) prorata + clawback — FRANCHISED', () => {
  const royaltyPending = { id: 'fr_o1', royaltyCents: 300, refundedCents: 0, status: 'pending', payoutId: null, settlementId: null, franchisorOperatorId: 'opF' }

  it('(b) PENDING royalty: refundedCents accrued, NO franchisor reversal', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue(royaltyPending)
    db.refund.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...refundRow(), ...data, id: 'rf1' }))
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 300 } })

    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyRefundCents).toBe(300)
    expect(res.royaltyClawbackCents).toBe(0)                 // pending → still in Grubano's balance
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    // Settlement-awareness: cumulative refunded written, capped at royaltyCents.
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })

  it('(c) SETTLED royalty: clawback REVERSED from the franchisor transfer (idempotent key)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, status: 'settled', payoutId: 'po1', settlementId: 'SID' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 300 } })

    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(300)
    const [transferId, params, opts] = stripeMock.transfers.createReversal.mock.calls[0]
    expect(transferId).toBe('tr_set')
    expect(params).toMatchObject({ amount: 300 })
    expect(opts).toEqual({ idempotencyKey: 'refund-claw:rf1' })
    expect(db.refund.update.mock.calls[0][0].data).toMatchObject({ royaltyClawbackCents: 300 })
  })

  it('(c-bis) SETTLED but transfer not locatable → no reversal, refundedCents still reduced', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(makePI({ application_fee_amount: 900 }))
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...royaltyPending, status: 'settling', payoutId: null, settlementId: 'SID' })
    stripeMock.transfers.list.mockResolvedValue({ data: [] })       // no transfer yet
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 300 } })

    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.royaltyClawbackCents).toBe(0)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
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
    db.refund.findFirst.mockResolvedValue(refundRow({ stripeRefundId: 're_1' }))
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.resumed).toBe(true)
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_1')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()   // never a second refund
    expect(db.refund.create).not.toHaveBeenCalled()
  })

  it('RESUME adopts a tagged refund when the create response was lost (>24h backstop)', async () => {
    db.refund.findFirst.mockResolvedValue(refundRow({ stripeRefundId: null }))
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_adopt', currency: 'eur', created: 1, metadata: { grubano_refund_row: 'rf1' } }] })
    const res = await executeRefund({ orderId: 'o1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.stripeRefundId).toBe('re_adopt')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
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
})
