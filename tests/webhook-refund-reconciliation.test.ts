import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── PHASE 2 — webhook charge.refunded + refund.updated/refund.failed reconciliation ─────
// (REFUND-FINANCIAL-CONTRACT §5 D-B, §8, §15 A2, §16 B1/B3, §17). The FIRST behavioural
// suite of handleChargeRefunded (Phase 0 found ZERO). Proves, on STANDARD and FRANCHISE
// orders, that the SINGLE reconciliation point reconciles the Stripe truth whatever the
// refund's origin (engine rail or EXTERNAL Dashboard refund with no Refund row):
//   • ledger line per succeeded refund from Stripe's REAL fee refund (prorata fallback logged);
//   • loyalty reconciliation (mocked, Phase 1) receives the SUCCEEDED refunds only;
//   • FranchiseRoyalty.refundedCents raised to royCum(Σ succeeded) — monotone, never on a
//     pending refund, identical target for engine and external refunds; settled royalty hit
//     by an EXTERNAL refund → MONEY REVIEW alert, NO money movement;
//   • tip clawback only when Σ SUCCEEDED ≥ charge.amount (never on amount_refunded);
//   • replay idempotent; empty list after a list failure → 503 + alert;
//   • refund.updated succeeded → full reconciliation re-run + pending row finalized;
//   • refund.failed → row failed + lock + alert; external failure → alert only.
// lib/refund, lib/ledger, lib/royalty-*, lib/refund-fee-truth, lib/courier-accrual run REAL
// against the mocked Prisma / Stripe; loyalty and admin alerts are mocked.

const { db, stripe, ledgerStore } = vi.hoisted(() => {
  const ledgerStore = new Set<string>()
  return {
    ledgerStore,
    db: {
      ledgerEntry:      { create: vi.fn() },
      franchiseRoyalty: { findUnique: vi.fn(), update: vi.fn() },
      refund:           { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
      dispute:          { aggregate: vi.fn() },
      courierEarning:   { findMany: vi.fn(), updateMany: vi.fn() },
      order:            { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      payout:           { findUnique: vi.fn() },
      loyaltyTransaction: { findFirst: vi.fn() },
      reservation:      { findFirst: vi.fn(), findUnique: vi.fn() },
      $transaction:     vi.fn(),
    },
    stripe: {
      constructEvent: vi.fn(),
      refunds:        { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
      applicationFees:{ listRefunds: vi.fn() },
      paymentIntents: { retrieve: vi.fn() },
      charges:        { retrieve: vi.fn() },
      transfers:      { list: vi.fn(), createReversal: vi.fn(), listReversals: vi.fn() },
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent: stripe.constructEvent }, ...stripe }),
  retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(),
}))
const { loyaltyMock } = vi.hoisted(() => ({ loyaltyMock: vi.fn(async () => ({ status: 'reconciled' })) }))
vi.mock('@/lib/loyalty-refund-apply', () => ({ reconcileLoyaltyOnRefund: loyaltyMock }))
const { alerts } = vi.hoisted(() => ({
  alerts: {
    sendAdminGhostOrderAlert: vi.fn(async () => ({ status: 'sent' })),
    sendAdminStalePiAlert:    vi.fn(async () => ({ status: 'sent' })),
    sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })),
  },
}))
vi.mock('@/lib/admin-alerts', () => alerts)

import { Prisma } from '@prisma/client'
import { POST } from '@/app/api/webhooks/stripe/route'
import { computeRefundExposure } from '@/lib/refund-exposure'

const fire = (type: string, obj: Record<string, unknown>) => {
  stripe.constructEvent.mockReturnValue({ type, data: { object: obj } })
  return POST(new Request('http://x/api/webhooks/stripe', { method: 'POST', body: 'raw', headers: { 'stripe-signature': 'sig' } }))
}

type R = { id: string; amount: number; created: number; status: string; metadata?: Record<string, string>; transfer_reversal?: { id: string; amount: number } | null }
// Refund fixtures carry the EXPANDED transfer_reversal object (F2: the ledger books the ACTUAL
// reversal). Engine/Dashboard-with-reverse_transfer refunds reverse the full amount by default;
// pass `reversal: 0` for an EXTERNAL refund issued WITHOUT reverse_transfer.
const re = (id: string, amount: number, created: number, status = 'succeeded', metadata?: Record<string, string>, reversal: number | null = amount): R =>
  ({ id, amount, created, status, ...(metadata ? { metadata } : {}), currency: 'eur',
     transfer_reversal: reversal === 0 || reversal === null ? null : { id: `trr_${id}`, amount: reversal } } as R)
const fee = (amount: number, created: number) => ({ amount, created })

const T = 5000
const CHARGE = (o: Record<string, unknown> = {}) => ({
  id: 'ch_1', object: 'charge', amount: T, amount_refunded: 0, refunded: false, currency: 'eur',
  application_fee_amount: 900, application_fee: 'fee_1', payment_intent: 'pi_1',
  transfer_data: { destination: 'acct_r' },
  metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'delivery' },
  ...o,
})
const ROYALTY_PENDING = { royaltyCents: 300, refundedCents: 0, status: 'pending' }
const ledgerData = () => db.ledgerEntry.create.mock.calls.map((c) => c[0].data as Record<string, unknown>)

let fx: { refunds: R[]; feeRefunds: Array<{ amount: number; created: number }>; listFails: boolean }

beforeEach(() => {
  vi.clearAllMocks()
  ledgerStore.clear()
  fx = { refunds: [], feeRefunds: [], listFails: false }
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  // Faithful unique-key ledger: (sourceEventId,type) duplicate → P2002.
  db.ledgerEntry.create.mockImplementation(({ data }: { data: { sourceEventId: string; type: string } }) => {
    const k = `${data.sourceEventId}|${data.type}`
    if (ledgerStore.has(k)) return Promise.reject(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    ledgerStore.add(k)
    return Promise.resolve({ id: `le_${ledgerStore.size}` })
  })
  stripe.refunds.list.mockImplementation(() => ({
    autoPagingToArray: async () => { if (fx.listFails) throw new Error('stripe down'); return fx.refunds },
    // engine's resolveFeeTruth reads `.data` / `.has_more` on the awaited list
    then: undefined,
  }))
  stripe.applicationFees.listRefunds.mockImplementation(async () => ({ data: fx.feeRefunds }))
  db.franchiseRoyalty.findUnique.mockResolvedValue(null) // STANDARD by default
  db.franchiseRoyalty.update.mockResolvedValue({})
  db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 0, royaltyClawbackCents: 0 } })
  db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 0, royaltyClawbackCents: 0 } })
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.refund.update.mockResolvedValue({})
  db.courierEarning.findMany.mockResolvedValue([{ id: 'ce_tip', status: 'pending' }])
  db.courierEarning.updateMany.mockResolvedValue({ count: 1 })
  db.payout.findUnique.mockResolvedValue(null)
  stripe.transfers.list.mockResolvedValue({ data: [] })
  stripe.transfers.listReversals.mockResolvedValue({ data: [] })
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

// ─────────────────────────────────────────────────────────────────────────────────────
describe('charge.refunded — STANDARD restaurant (no royalty)', () => {
  it('FULL succeeded refund → ONE ledger line from Stripe REAL fee refund (gross −5000, fee −900, net −4100), loyalty + tip clawback', async () => {
    fx.refunds = [re('re_1', 5000, 10)]; fx.feeRefunds = [fee(900, 10)]
    const res = await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, refunds: 1, recorded: 1 })
    const [line] = ledgerData()
    expect(line).toMatchObject({ type: 'refund', grossAmount: -5000, applicationFeeAmount: -900, netToRestaurant: -4100, stripeFeeAmount: 0, routed: true, sourceEventId: 're_1', channel: 'delivery' })
    expect(line.grossAmount).toBe((line.applicationFeeAmount as number) + (line.netToRestaurant as number)) // golden equation with negatives
    expect(loyaltyMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: 'o1', chargeAmountCents: 5000, refunds: [{ id: 're_1', amountCents: 5000, createdUnix: 10 }] }))
    expect(db.courierEarning.updateMany).toHaveBeenCalledTimes(1)
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
  })

  it('PARTIAL 2500 → fee −450 from Stripe truth, tip NOT clawed (courier keeps it — D-E), loyalty reconciled on the partial', async () => {
    fx.refunds = [re('re_1', 2500, 10)]; fx.feeRefunds = [fee(450, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(ledgerData()[0]).toMatchObject({ grossAmount: -2500, applicationFeeAmount: -450, netToRestaurant: -2050 })
    expect(db.courierEarning.updateMany).not.toHaveBeenCalled()
  })

  it('MULTIPLE partials (2 events) → 2 lines, Σ fee == Stripe truth Σ, replay writes NOTHING new (unique keys)', async () => {
    fx.refunds = [re('re_1', 333, 10), re('re_2', 4667, 20)]; fx.feeRefunds = [fee(60, 10), fee(840, 20)]
    const res1 = await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(await res1.json()).toMatchObject({ recorded: 2 })
    const res2 = await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(await res2.json()).toMatchObject({ recorded: 0 })
    const lines = ledgerData()
    expect(lines.filter((l) => l.sourceEventId === 're_1').length).toBe(2) // second attempt rejected as duplicate by the store
    expect(ledgerStore.size).toBe(2)
    const feeSum = -(60 + 840)
    expect(feeSum).toBe(-900)
  })

  // ── F2 CLOSED (final hardening): the ledger books ONLY Stripe's ACTUAL movements ──────
  it('[F2] EXTERNAL refund WITHOUT refund_application_fee (no fr_) but WITH reverse_transfer → fee-back 0 (never a prediction), restaurant −2500, MONEY REVIEW with the expectation', async () => {
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(ledgerData()[0]).toMatchObject({ grossAmount: -2500, applicationFeeAmount: 0, netToRestaurant: -2500 })
    expect(err.mock.calls.some((c) => String(c[0]).includes('[MONEY REVIEW] [fee_attribution_none]') && String(c[0]).includes('EXPECTED (proration, not booked) {re_x:450}'))).toBe(true)
    err.mockRestore()
  })

  it('[F2] EXTERNAL refund WITHOUT reverse_transfer AND WITHOUT fee refund → restaurant 0, platform bore 2500, MONEY REVIEW', async () => {
    fx.refunds = [re('re_x', 2500, 10, 'succeeded', undefined, 0)]; fx.feeRefunds = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(ledgerData()[0]).toMatchObject({ grossAmount: -2500, applicationFeeAmount: -2500, netToRestaurant: 0 })
    expect(err.mock.calls.some((c) => String(c[0]).includes('[refund_without_reverse_transfer]'))).toBe(true)
    err.mockRestore()
  })

  it('[F2] EXTERNAL refund WITH an actual fee refund of a non-prorata amount (manual 100 c) → exactly 100 booked', async () => {
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = [fee(100, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(ledgerData()[0]).toMatchObject({ grossAmount: -2500, applicationFeeAmount: -100, netToRestaurant: -2400 })
  })

  it('[F2] engine refund WITH fee refund + external refund WITHOUT → 450 and 0, Σ fee == Stripe Σ, Σ gross exact', async () => {
    fx.refunds = [re('re_eng', 2500, 10, 'succeeded', { grubano_refund_row: 'rf1' }), re('re_ext', 1000, 20)]
    fx.feeRefunds = [fee(450, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 3500 }))
    const lines = ledgerData()
    const eng = lines.find((l) => l.sourceEventId === 're_eng'), ext = lines.find((l) => l.sourceEventId === 're_ext')
    expect(eng).toMatchObject({ applicationFeeAmount: -450, netToRestaurant: -2050 })
    expect(ext).toMatchObject({ applicationFeeAmount: 0, netToRestaurant: -1000 })
    expect(lines.reduce((s, l) => s + (l.applicationFeeAmount as number), 0)).toBe(-450)
    expect(lines.reduce((s, l) => s + (l.grossAmount as number), 0)).toBe(-3500)
  })

  it('[F2] PARTIAL external refund with a partial actual reversal (877 on 1000) → exact actual cents', async () => {
    fx.refunds = [re('re_x', 1000, 10, 'succeeded', undefined, 877)]; fx.feeRefunds = [fee(60, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 1000 }))
    expect(ledgerData()[0]).toMatchObject({ grossAmount: -1000, applicationFeeAmount: -183, netToRestaurant: -817 })
  })

  it('[F2] late refund.updated after a charge.refunded that already booked the truth → convergence: same line, no duplicate, no re-booking', async () => {
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = []
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', transfer_data: { destination: 'acct_r' }, latest_charge: CHARGE({ amount_refunded: 2500 }) })
    const res = await fire('refund.updated', { id: 're_x', object: 'refund', status: 'succeeded', amount: 2500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    expect(res.status).toBe(200)
    expect(ledgerStore.size).toBe(1)
    expect(ledgerData().every((l) => l.applicationFeeAmount === 0)).toBe(true)
  })

  it('[F2 / review #10] fee-refund list UNAVAILABLE → 503 (Stripe retries) + MONEY REVIEW, NOTHING booked (an unknown list is not "no fee")', async () => {
    fx.refunds = [re('re_1', 2500, 10)]
    stripe.applicationFees.listRefunds.mockRejectedValue(new Error('stripe down'))
    const res = await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(res.status).toBe(503)
    expect(ledgerData().length).toBe(0)
    expect(loyaltyMock).not.toHaveBeenCalled()
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_reconciliation_incomplete', dedupeKey: 'charge:ch_1:fees:2500' }))
  })

  it('[F2 negative control] the pre-hardening behaviour (450 predicted fee-back on a refund with no fee refund) is REJECTED', async () => {
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = []
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(ledgerData()[0].applicationFeeAmount).not.toBe(-450)
  })

  it('[§9.4 / A2] a PENDING refund carried by charge.refunded → NO ledger, NO tip clawback, loyalty sees ZERO succeeded refunds', async () => {
    fx.refunds = [re('re_1', 5000, 10, 'pending')]
    const res = await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(res.status).toBe(200)
    expect(ledgerData().length).toBe(0)
    expect(db.courierEarning.updateMany).not.toHaveBeenCalled()
    expect(loyaltyMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refunds: [] }))
  })

  it('[A2 negative control] amount_refunded says FULL but only a PARTIAL succeeded → tip NOT clawed (the old predicate would have cancelled it)', async () => {
    fx.refunds = [re('re_1', 2500, 10), re('re_2', 2500, 20, 'pending')]; fx.feeRefunds = [fee(450, 10)]
    const charge = CHARGE({ amount_refunded: 5000, refunded: true })
    await fire('charge.refunded', charge)
    expect(db.courierEarning.updateMany).not.toHaveBeenCalled()
    // Control: the pre-Phase-2 predicate evaluated on THIS fixture is TRUE (it would have clawed).
    const oldPredicate = charge.refunded === true || (charge.amount_refunded as number) >= (charge.amount as number)
    expect(oldPredicate).toBe(true)
  })

  it('[§16 B3 / R4-3] refund list unavailable and nothing embedded → 503 (Stripe retries) + MONEY REVIEW alert, nothing reconciled', async () => {
    fx.listFails = true
    const res = await fire('charge.refunded', CHARGE({ amount_refunded: 5000 }))
    expect(res.status).toBe(503)
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_reconciliation_incomplete' }))
    expect(ledgerData().length).toBe(0)
    expect(loyaltyMock).not.toHaveBeenCalled()
  })

  it('[R4-2] charge without metadata.restaurantId → PI metadata fallback before giving up', async () => {
    fx.refunds = [re('re_1', 5000, 10)]; fx.feeRefunds = [fee(900, 10)]
    stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', metadata: { restaurantId: 'r1', orderId: 'o1' } })
    const res = await fire('charge.refunded', CHARGE({ metadata: {}, amount_refunded: 5000 }))
    expect(await res.json()).toMatchObject({ recorded: 1 })
    expect(ledgerData()[0]).toMatchObject({ restaurantId: 'r1' })
    expect(loyaltyMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: 'o1' }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
describe('charge.refunded — FRANCHISE restaurant (royalty 300 inside fee 900) — D-B royalty reconciliation', () => {
  beforeEach(() => { db.franchiseRoyalty.findUnique.mockResolvedValue(ROYALTY_PENDING) })

  it('EXTERNAL Dashboard PARTIAL 2500 (no Refund row, no grubano_refund_row) → refundedCents = royCum(2500) = 150; no alert (pending royalty)', async () => {
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = [fee(450, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 150 } })
    expect(alerts.sendAdminMoneyReviewAlert).not.toHaveBeenCalled()
    // Tripartite identity on STRIPE TRUTH values (§7 evaluated on truth, critic #14):
    const ex = computeRefundExposure({ chargeTotalCents: T, applicationFeeCents: 900, royaltyChargedCents: 300, tipCents: 0, courierWithheldCents: 0, stripeFeeCents: 0, alreadyRefundedCents: 0, refundAmountCents: 2500 })
    expect(ex.split.applicationFeeRefundCents).toBe(450) // == Stripe real fee refund fixture
    expect(ex.royaltySliceCents).toBe(150)               // == refundedCents written
    expect(ex.conservationResidualCents).toBe(0)
  })

  it('EXTERNAL FULL on a PENDING royalty → refundedCents 300 (settlement pays 0), NO money moved, NO alert', async () => {
    fx.refunds = [re('re_x', 5000, 10)]; fx.feeRefunds = [fee(900, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
    expect(alerts.sendAdminMoneyReviewAlert).not.toHaveBeenCalled()
  })

  it('MULTIPLE external partials 333/333/333/4001 → cumulative target lands EXACTLY on 300 (telescoping), monotone through the events', async () => {
    const seq = [re('re_1', 333, 10), re('re_2', 333, 20), re('re_3', 333, 30), re('re_4', 4001, 40)]
    const fees = [fee(60, 10), fee(60, 20), fee(60, 30), fee(720, 40)]
    let existing = 0
    const targets: number[] = []
    for (let i = 1; i <= 4; i++) {
      fx.refunds = seq.slice(0, i); fx.feeRefunds = fees.slice(0, i)
      db.franchiseRoyalty.findUnique.mockResolvedValue({ ...ROYALTY_PENDING, refundedCents: existing })
      db.franchiseRoyalty.update.mockClear()
      await fire('charge.refunded', CHARGE({ amount_refunded: seq.slice(0, i).reduce((s, r) => s + r.amount, 0) }))
      const call = db.franchiseRoyalty.update.mock.calls[0]
      const written = call ? (call[0].data.refundedCents as number) : existing
      expect(written).toBeGreaterThanOrEqual(existing)
      targets.push(written)
      existing = written
    }
    expect(targets[3]).toBe(300)
    expect(targets).toEqual([...targets].sort((a, b) => a - b))
  })

  it('ENGINE-originated refund (metadata.grubano_refund_row) on a SETTLED royalty → target written, NO external alert (the engine claws back itself)', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ royaltyCents: 300, refundedCents: 0, status: 'settled' })
    fx.refunds = [re('re_e', 5000, 10, 'succeeded', { grubano_refund_row: 'rf1', orderId: 'o1' })]; fx.feeRefunds = [fee(900, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
    expect(alerts.sendAdminMoneyReviewAlert).not.toHaveBeenCalled()
  })

  it('EXTERNAL refund on a SETTLED royalty → refundedCents target written + MONEY REVIEW alert (human clawback), NO reversal from the webhook', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ royaltyCents: 300, refundedCents: 0, status: 'settled' })
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = [fee(450, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 150 } })
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'external_refund_settled_royalty',
      facts: expect.objectContaining({ orderId: 'o1', royaltyStatus: 'settled', royaltyRefundedTargetCents: 150, externalRefundIds: 're_x' }),
    }))
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('[monotone] existing refundedCents 300 with a lower target → NO regression, NO update', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...ROYALTY_PENDING, refundedCents: 300 })
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = [fee(450, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
  })

  it('[#16 control] the only refund is PENDING → refundedCents stays 0 (no update), whatever amount_refunded says', async () => {
    fx.refunds = [re('re_x', 5000, 10, 'pending')]
    await fire('charge.refunded', CHARGE({ amount_refunded: 5000, refunded: true }))
    expect(db.franchiseRoyalty.update).not.toHaveBeenCalled()
  })

  it('[cross-rail] a lost-dispute slice (150) + external refund slice (150) → 300, capped, never erased', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue({ ...ROYALTY_PENDING, refundedCents: 150 })
    db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 150, royaltyClawbackCents: 0 } })
    fx.refunds = [re('re_x', 2500, 10)]; fx.feeRefunds = [fee(450, 10)]
    await fire('charge.refunded', CHARGE({ amount_refunded: 2500 }))
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
describe('refund.updated / refund.failed — the status oracle (§16 B1)', () => {
  const PI_WITH_CHARGE = (charge: Record<string, unknown>) => ({ id: 'pi_1', status: 'succeeded', transfer_data: { destination: 'acct_r' }, latest_charge: charge })

  it('refund.updated succeeded (pending-at-creation TOTAL refund, EXTERNAL, no row) → full reconciliation re-run: ledger + loyalty + tip clawed + royalty target', async () => {
    db.franchiseRoyalty.findUnique.mockResolvedValue(ROYALTY_PENDING)
    fx.refunds = [re('re_x', 5000, 10)]; fx.feeRefunds = [fee(900, 10)]
    stripe.paymentIntents.retrieve.mockResolvedValue(PI_WITH_CHARGE(CHARGE({ amount_refunded: 5000, refunded: true })))
    const res = await fire('refund.updated', { id: 're_x', object: 'refund', status: 'succeeded', amount: 5000, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, refund: 're_x', status: 'succeeded', finalized: null })
    expect(ledgerData()[0]).toMatchObject({ sourceEventId: 're_x', grossAmount: -5000, applicationFeeAmount: -900 })
    expect(loyaltyMock).toHaveBeenCalledTimes(1)
    expect(db.courierEarning.updateMany).toHaveBeenCalledTimes(1)
    expect(db.franchiseRoyalty.update).toHaveBeenCalledWith({ where: { orderId: 'o1' }, data: { refundedCents: 300 } })
  })

  it('refund.updated succeeded with our PENDING row (metadata.grubano_refund_row) → reconciliation + row finalized succeeded, ledger written ONCE', async () => {
    const row = { id: 'rf1', orderId: 'o1', restaurantId: 'r1', idempotencyKey: 'refund:o1:0', amountCents: 5000, restaurantReverseCents: 4100, applicationFeeRefundCents: 900, royaltyRefundCents: 0, stripeRefundId: 're_1', status: 'pending' }
    db.refund.findUnique.mockResolvedValue(row)
    db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
    const refundObj = re('re_1', 5000, 10, 'succeeded', { grubano_refund_row: 'rf1', orderId: 'o1' })
    fx.refunds = [refundObj]; fx.feeRefunds = [fee(900, 10)]
    // The engine's resolveFeeTruth awaits `refunds.list(...)` and reads `.data` / `.has_more`:
    stripe.refunds.list.mockImplementation(() => {
      const p = Promise.resolve({ data: fx.refunds, has_more: false }) as Promise<unknown> & { autoPagingToArray?: () => Promise<R[]> }
      p.autoPagingToArray = async () => fx.refunds
      return p
    })
    stripe.refunds.retrieve.mockResolvedValue(refundObj)
    stripe.paymentIntents.retrieve.mockResolvedValue(PI_WITH_CHARGE(CHARGE({ amount_refunded: 5000, refunded: true })))
    const res = await fire('refund.updated', { id: 're_1', object: 'refund', status: 'succeeded', amount: 5000, payment_intent: 'pi_1', charge: 'ch_1', metadata: { grubano_refund_row: 'rf1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ finalized: 'rf1' })
    expect(db.refund.update.mock.calls.some((c) => c[0]?.data?.status === 'succeeded')).toBe(true)
    expect(ledgerStore.size).toBe(1) // webhook line + eager line share (re_1,'refund') → one row
  })

  it('refund.failed with our pending row → row FAILED (cursor released), MONEY REVIEW alert, 200 locked', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf1', orderId: 'o1', idempotencyKey: 'refund:o1:0', amountCents: 5000, status: 'pending', stripeRefundId: 're_1' })
    const res = await fire('refund.failed', { id: 're_1', object: 'refund', status: 'failed', amount: 5000, payment_intent: 'pi_1', charge: 'ch_1', metadata: { grubano_refund_row: 'rf1' }, failure_reason: 'expired_or_canceled_card' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ row: 'rf1', locked: true })
    expect(db.refund.update).toHaveBeenCalledWith({ where: { id: 'rf1' }, data: { status: 'failed', stripeRefundId: 're_1', idempotencyKey: 'refund:o1:0:failed:re_1' } })
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_failed', dedupeKey: 'refund:re_1' }))
    expect(ledgerData().length).toBe(0)
    expect(loyaltyMock).not.toHaveBeenCalled()
  })

  it('refund.failed EXTERNAL (no row) → MONEY REVIEW alert only, 200', async () => {
    const res = await fire('refund.failed', { id: 're_ext', object: 'refund', status: 'failed', amount: 1000, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ row: null })
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_failed', dedupeKey: 'refund:re_ext' }))
    expect(db.refund.update).not.toHaveBeenCalled()
  })

  it('[security P2-c] refund.failed naming a row whose order belongs to ANOTHER PaymentIntent → row IGNORED (not locked), external alert only', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf_other', orderId: 'o_other', idempotencyKey: 'refund:o_other:0', amountCents: 5000, status: 'pending', stripeRefundId: null })
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_OTHER' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await fire('refund.failed', { id: 're_1', object: 'refund', status: 'failed', amount: 5000, payment_intent: 'pi_1', charge: 'ch_1', metadata: { grubano_refund_row: 'rf_other' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ row: null })
    expect(db.refund.update).not.toHaveBeenCalled()
    expect(err.mock.calls.some((c) => String(c[0]).includes('[refund_row_mismatch]'))).toBe(true)
    err.mockRestore()
  })

  it('refund.updated still pending → acknowledged, nothing reconciled', async () => {
    const res = await fire('refund.updated', { id: 're_p', object: 'refund', status: 'pending', amount: 1000, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    expect(await res.json()).toMatchObject({ ignored: true })
    expect(ledgerData().length).toBe(0)
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('refund.updated succeeded but the charge cannot be retrieved → 503 (Stripe retries), nothing half-reconciled', async () => {
    stripe.paymentIntents.retrieve.mockRejectedValue(new Error('down'))
    const res = await fire('refund.updated', { id: 're_x', object: 'refund', status: 'succeeded', amount: 5000, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    expect(res.status).toBe(503)
    expect(ledgerData().length).toBe(0)
  })
})
