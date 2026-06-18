import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.5-B — lib/dispute (chargeback unwind) ─────────────────────────────────────
// Lost dispute → reverse_transfer the resto NET + clawback the franchise royalty,
// NEVER refund_application_fee. Reuses the REAL computeRefundSplit (not mocked) for the
// cent-exact prorata. Prisma, Stripe and the ledger writer are mocked.

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    charges:   { retrieve: vi.fn() },
    transfers: { createReversal: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
    refunds:   { create: vi.fn() }, // must NEVER be called by the dispute path
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    dispute:          { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
    refund:           { aggregate: vi.fn() },
    franchiseRoyalty: { findUnique: vi.fn(), update: vi.fn() },
    order:            { findFirst: vi.fn() },
    payout:           { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { ledgerMock, refundLedgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn(), refundLedgerMock: vi.fn() }))
vi.mock('@/lib/ledger', () => ({ recordLedgerEntry: ledgerMock, recordRefundLedgerEntry: refundLedgerMock }))

import { handleDisputeEvent } from '@/lib/dispute'

// ── Fixtures ─────────────────────────────────────────────────────────────────────
// T=5000, application fee F=900 (commission 600 + royalty 300 when franchised), net N=T−F=4100.
const makeCharge = (o: Record<string, unknown> = {}) => ({
  id: 'ch_1', amount: 5000, application_fee_amount: 900, amount_refunded: 0, currency: 'eur',
  metadata: { orderId: 'o1', restaurantId: 'rest1', grubano_channel: 'delivery' },
  transfer_data: { destination: 'acct_r' },
  transfer: { id: 'tr_net', amount: 4100, amount_reversed: 0 },
  ...o,
})
const makeDispute = (o: Record<string, unknown> = {}) => ({
  id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', amount: 5000, currency: 'eur',
  reason: 'fraudulent', status: 'needs_response', balance_transactions: [{ fee: 1500 }], ...o,
})
const closedLost = (d = makeDispute()) => ({ type: 'charge.dispute.closed', data: { object: { ...d, status: 'lost' } } }) as never
const closedWon  = (d = makeDispute()) => ({ type: 'charge.dispute.closed', data: { object: { ...d, status: 'won' } } }) as never
const created    = (d = makeDispute()) => ({ type: 'charge.dispute.created', data: { object: d } }) as never

const upsertReturns = (o: Record<string, unknown> = {}) => ({ id: 'D1', splitReversed: false, feeCents: 1500, refundedCents: 0, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  stripeMock.charges.retrieve.mockResolvedValue(makeCharge())
  stripeMock.transfers.createReversal.mockResolvedValue({ id: 'trr_1' })
  stripeMock.transfers.list.mockResolvedValue({ data: [] })
  db.dispute.upsert.mockResolvedValue(upsertReturns())
  db.dispute.update.mockResolvedValue({})
  db.dispute.updateMany.mockResolvedValue({ count: 1 })
  db.franchiseRoyalty.findUnique.mockResolvedValue(null) // not franchised by default
  db.franchiseRoyalty.update.mockResolvedValue({})
  db.order.findFirst.mockResolvedValue(null)
  db.payout.findUnique.mockResolvedValue(null)
  // cross-rail royalty-refunded aggregates (recomputeRoyaltyRefundedCents) — empty by default
  db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 0 } })
  db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 0 } })
  ledgerMock.mockResolvedValue({ ok: true })
})

// Helpers to read mock calls
const reverseCalls = () => stripeMock.transfers.createReversal.mock.calls
const reverseByKind = (kind: string) => reverseCalls().filter((c) => c[1]?.metadata?.kind === kind)

describe('(a) LOST — non-franchised', () => {
  it('reverse_transfer the resto NET; NEVER refund_application_fee; balanced ledger', async () => {
    const out = await handleDisputeEvent(closedLost())
    expect(out).toMatchObject({ outcome: 'lost', reversed: true, reverseTransferCents: 4100, royaltyClawbackCents: 0 })

    // reverse_transfer of the NET (T−F = 4100) on the charge's transfer, idempotent key.
    expect(reverseByKind('dispute_net_reversal')).toHaveLength(1)
    const [transferId, params, opts] = reverseByKind('dispute_net_reversal')[0]
    expect(transferId).toBe('tr_net')
    expect(params).toMatchObject({ amount: 4100 })
    expect(opts).toEqual({ idempotencyKey: 'dispute-reverse:dp_1' })

    // ❌ NEVER a refund_application_fee (the KEY difference vs a refund).
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(reverseByKind('dispute_royalty_clawback')).toHaveLength(0) // no royalty

    // Ledger: NEGATIVE 'adjustment', golden equation gross = fee + net.
    const led = ledgerMock.mock.calls[0][0]
    expect(led.type).toBe('adjustment')
    expect(led.grossAmount).toBe(-5000)
    expect(led.applicationFeeAmount).toBe(-900)
    expect(led.netToRestaurant).toBe(-4100)
    expect(led.grossAmount).toBe(led.applicationFeeAmount + led.netToRestaurant) // golden
    expect(led.sourceEventId).toBe('dp_1')

    // Marked reversed + lost (idempotent guard splitReversed:false).
    const mark = db.dispute.updateMany.mock.calls.find((c) => c[0]?.data?.splitReversed === true)
    expect(mark?.[0]).toMatchObject({ where: { stripeDisputeId: 'dp_1', splitReversed: false }, data: { splitReversed: true, status: 'lost' } })
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
  })
})

describe('(b) LOST — franchised, royalty PENDING', () => {
  it('reverse NET + refundedCents bumped; NO franchisor clawback; NO refund_application_fee', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'pending', payoutId: null, settlementId: null, franchisorOperatorId: 'opF' })
    const out = await handleDisputeEvent(closedLost())
    expect(out).toMatchObject({ outcome: 'lost', reversed: true, royaltyClawbackCents: 0 })

    expect(reverseByKind('dispute_net_reversal')).toHaveLength(1)          // net reversed
    expect(reverseByKind('dispute_royalty_clawback')).toHaveLength(0)       // pending → no reverse
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()

    // settlement-awareness: refundedCents = cumulative royalty lost (capped at royaltyCents)
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })
})

describe('(c) LOST — franchised, royalty SETTLED → clawback from the franchisor', () => {
  it('reverse NET + clawback reverse (franchisor transfer, idempotent key); NO refund_application_fee', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'SID', franchisorOperatorId: 'opF' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })

    const out = await handleDisputeEvent(closedLost())
    expect(out).toMatchObject({ outcome: 'lost', reversed: true, royaltyClawbackCents: 300 })

    expect(reverseByKind('dispute_net_reversal')).toHaveLength(1)
    const claw = reverseByKind('dispute_royalty_clawback')
    expect(claw).toHaveLength(1)
    expect(claw[0][0]).toBe('tr_set')                                   // reverse the SETTLEMENT transfer
    expect(claw[0][1]).toMatchObject({ amount: 300 })
    expect(claw[0][2]).toEqual({ idempotencyKey: 'dispute-claw:dp_1' })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })
})

describe('(d) WON — no money moves', () => {
  it('no reverse_transfer, no clawback, no ledger; marked won', async () => {
    const out = await handleDisputeEvent(closedWon())
    expect(out).toMatchObject({ outcome: 'won' })
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(ledgerMock).not.toHaveBeenCalled()
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
    const wonCall = db.dispute.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'won')
    expect(wonCall?.[0]).toMatchObject({ where: { stripeDisputeId: 'dp_1', status: { not: 'lost' } }, data: { status: 'won' } })
  })
})

describe('(e) IDEMPOTENCE / out-of-order', () => {
  it('created → one upsert (status open), no reversal', async () => {
    const out = await handleDisputeEvent(created())
    expect(out).toMatchObject({ handled: 'charge.dispute.created' })
    expect(db.dispute.upsert).toHaveBeenCalledTimes(1)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('closed lost replay (already reversed) → NO second reversal', async () => {
    db.dispute.upsert.mockResolvedValue(upsertReturns({ splitReversed: true }))
    const out = await handleDisputeEvent(closedLost())
    expect(out).toMatchObject({ outcome: 'lost', alreadyReversed: true })
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    expect(ledgerMock).not.toHaveBeenCalled()
  })

  it('closed lost BEFORE created (out-of-order) → upsert creates the row, reversal still runs', async () => {
    // upsert returns a fresh row (splitReversed false) even though "created" never arrived.
    const out = await handleDisputeEvent(closedLost())
    expect(out).toMatchObject({ outcome: 'lost', reversed: true })
    expect(db.dispute.upsert).toHaveBeenCalled()
    expect(reverseByKind('dispute_net_reversal')).toHaveLength(1)
  })
})

describe('(f/g) mechanic guards', () => {
  it('funds_withdrawn → recorded + flag set, no reversal', async () => {
    const out = await handleDisputeEvent({ type: 'charge.dispute.funds_withdrawn', data: { object: makeDispute() } } as never)
    expect(out).toMatchObject({ handled: 'charge.dispute.funds_withdrawn' })
    expect(db.dispute.update).toHaveBeenCalledWith({ where: { stripeDisputeId: 'dp_1' }, data: { fundsWithdrawn: true } })
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('a dispute NEVER calls refunds.create (refund_application_fee is refund-only)', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'SID', franchisorOperatorId: 'opF' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_set' })
    await handleDisputeEvent(closedLost())
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('reverse caps at the transfer remaining reversible (defensive, prior partial reversal)', async () => {
    stripeMock.charges.retrieve.mockResolvedValue(makeCharge({ transfer: { id: 'tr_net', amount: 4100, amount_reversed: 4000 } })) // only 100 left
    const out = await handleDisputeEvent(closedLost())
    expect(reverseByKind('dispute_net_reversal')[0][1]).toMatchObject({ amount: 100 }) // capped, not 4100
    expect(out.reverseTransferCents).toBe(100)
  })

  it('unresolvable context (no order/charge) → recorded lost, NO reversal', async () => {
    stripeMock.charges.retrieve.mockResolvedValue({ id: 'ch_1', amount: 0, metadata: {}, transfer: null })
    const out = await handleDisputeEvent(closedLost(makeDispute({ charge: 'ch_1', payment_intent: null })))
    expect(out).toMatchObject({ outcome: 'lost', reversed: false, reason: 'unresolved_context' })
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })
})

describe('(h) partial dispute — proportional, cent-exact', () => {
  it('half disputed → reverse half the net, royalty slice half, golden ledger', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'pending', payoutId: null, settlementId: null, franchisorOperatorId: 'opF' })
    const out = await handleDisputeEvent(closedLost(makeDispute({ amount: 2500 }))) // D=2500 (half)
    // appFee slice = round(900·2500/5000)=450 ; net slice = 2500−450 = 2050
    expect(reverseByKind('dispute_net_reversal')[0][1]).toMatchObject({ amount: 2050 })
    const led = ledgerMock.mock.calls[0][0]
    expect(led.grossAmount).toBe(-2500)
    expect(led.applicationFeeAmount).toBe(-450)
    expect(led.netToRestaurant).toBe(-2050)
    expect(led.grossAmount).toBe(led.applicationFeeAmount + led.netToRestaurant) // golden
    // royalty slice = round(450·300/900) = 150 → refundedCents bumped to 150
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 150 } })
    expect(out.reverseTransferCents).toBe(2050)
  })
})

describe('(cross-rail) dispute composes with a prior REFUND on the same order', () => {
  it('refund 2500 (royalty slice 150) THEN dispute 2500 → refundedCents = 300, never erased', async () => {
    // A prior P4.5-A refund already gave back half the principal (amount_refunded=2500)
    // and recorded a 150-cent royalty slice (refund.aggregate). The dispute on the
    // remaining 2500 must ADD its 150 slice → 300 total (the full royalty unwound).
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 150, status: 'pending', payoutId: null, settlementId: null, franchisorOperatorId: 'opF' })
    db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 150 } })       // the prior refund
    stripeMock.charges.retrieve.mockResolvedValue(makeCharge({ amount_refunded: 2500, transfer: { id: 'tr_net', amount: 4100, amount_reversed: 2050 } }))

    await handleDisputeEvent(closedLost(makeDispute({ amount: 2500 })))

    // dispute's own slice over band [2500,5000] = royCum(5000)−royCum(2500) = 300−150 = 150 (inFlight);
    // cross-rail total = 150 (refund) + 0 (settled disputes) + 150 (this) = 300, capped at royaltyCents.
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })
})
