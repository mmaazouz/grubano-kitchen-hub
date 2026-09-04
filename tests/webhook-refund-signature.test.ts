import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Stripe from 'stripe'

// ── PHASE 2 OPERATIONAL GATE — refund.updated / refund.failed with a REAL signature ──
// The reconciliation suite mocks `constructEvent`. This disposable suite keeps the REAL
// Stripe signature verification (stripe-node `webhooks.constructEvent` +
// `generateTestHeaderString`, no network) and proves, end-to-end at the route:
//   • an UNSIGNED or WRONGLY-SIGNED delivery is rejected (400) before any handler;
//   • a signed `refund.failed` is routed to the status handler (row → failed, locked);
//   • the SAME event delivered twice is idempotent (one row transition, one alert key);
//   • a signed `refund.updated` succeeded is routed to the full reconciliation;
//   • an UNKNOWN refund (PI not retrievable) is fail-safe (503 retry, nothing written).
// Prisma + Stripe API calls are mocked; NO staging, NO money.

const SECRET = 'whsec_test_phase2_gate'
type StripeOpts = NonNullable<ConstructorParameters<typeof Stripe>[1]>
const real = new Stripe('sk_test_dummy_key_for_signature_only', { apiVersion: '2024-06-20' } as unknown as StripeOpts)

const { db, api, ledgerStore } = vi.hoisted(() => {
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
    api: {
      refunds:         { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
      applicationFees: { listRefunds: vi.fn() },
      paymentIntents:  { retrieve: vi.fn() },
      charges:         { retrieve: vi.fn() },
      transfers:       { list: vi.fn(), createReversal: vi.fn(), listReversals: vi.fn() },
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({
  // REAL signature verification, mocked API surface.
  getStripe: () => ({ webhooks: real.webhooks, ...api }),
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

const deliver = (payload: string, signature: string | null) =>
  POST(new Request('http://x/api/webhooks/stripe', {
    method: 'POST', body: payload,
    headers: signature ? { 'stripe-signature': signature } : {},
  }))
const event = (type: string, refund: Record<string, unknown>) =>
  JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object: { object: 'refund', ...refund } } })
const sign = (payload: string, secret = SECRET) => real.webhooks.generateTestHeaderString({ payload, secret })

const CHARGE = {
  id: 'ch_1', object: 'charge', amount: 1410, amount_refunded: 500, refunded: false, currency: 'eur',
  application_fee_amount: 76, application_fee: 'fee_1', payment_intent: 'pi_1',
  transfer_data: { destination: 'acct_r' },
  metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'pickup' },
}

beforeEach(() => {
  vi.clearAllMocks()
  ledgerStore.clear()
  process.env.STRIPE_WEBHOOK_SECRET = SECRET
  db.ledgerEntry.create.mockImplementation(({ data }: { data: { sourceEventId: string; type: string } }) => {
    const k = `${data.sourceEventId}|${data.type}`
    if (ledgerStore.has(k)) return Promise.reject(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    ledgerStore.add(k)
    return Promise.resolve({ id: `le_${ledgerStore.size}` })
  })
  api.refunds.list.mockImplementation(() => ({ autoPagingToArray: async () => [{ id: 're_1', amount: 500, created: 10, status: 'succeeded', currency: 'eur', transfer_reversal: { id: 'trr_1', amount: 500 } }] }))
  api.applicationFees.listRefunds.mockResolvedValue({ data: [{ amount: 27, created: 10 }] })
  db.franchiseRoyalty.findUnique.mockResolvedValue(null)
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.refund.update.mockResolvedValue({})
  db.courierEarning.findMany.mockResolvedValue([])
  db.courierEarning.updateMany.mockResolvedValue({ count: 0 })
  db.order.findUnique.mockResolvedValue(undefined)
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('signature gate — nothing runs before a valid signature', () => {
  it('UNSIGNED delivery → 400, no handler side effect', async () => {
    const res = await deliver(event('refund.failed', { id: 're_1', status: 'failed', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: { grubano_refund_row: 'rf1' } }), null)
    expect(res.status).toBe(400)
    expect(db.refund.findUnique).not.toHaveBeenCalled()
    expect(db.refund.update).not.toHaveBeenCalled()
    expect(alerts.sendAdminMoneyReviewAlert).not.toHaveBeenCalled()
  })

  it('WRONG secret → 400, no handler side effect', async () => {
    const payload = event('refund.failed', { id: 're_1', status: 'failed', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const res = await deliver(payload, sign(payload, 'whsec_other'))
    expect(res.status).toBe(400)
    expect(db.refund.findUnique).not.toHaveBeenCalled()
    expect(alerts.sendAdminMoneyReviewAlert).not.toHaveBeenCalled()
  })

  it('TAMPERED payload after signing → 400', async () => {
    const payload = event('refund.failed', { id: 're_1', status: 'failed', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const sig = sign(payload)
    const res = await deliver(payload.replace('"amount":500', '"amount":999'), sig)
    expect(res.status).toBe(400)
  })
})

describe('refund.failed — routed, locked, idempotent', () => {
  const ROW = { id: 'rf1', orderId: 'o1', idempotencyKey: 'refund:o1:0', amountCents: 500, status: 'pending', stripeRefundId: 're_1' }

  it('signed refund.failed with our pending row → row failed (cursor released), alert, 200 locked', async () => {
    db.refund.findUnique.mockResolvedValue(ROW)
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
    const payload = event('refund.failed', { id: 're_1', status: 'failed', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: { grubano_refund_row: 'rf1' }, failure_reason: 'expired_or_canceled_card' })
    const res = await deliver(payload, sign(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ refund: 're_1', status: 'failed', row: 'rf1', locked: true })
    expect(db.refund.update).toHaveBeenCalledWith({ where: { id: 'rf1' }, data: { status: 'failed', stripeRefundId: 're_1', idempotencyKey: 'refund:o1:0:failed:re_1' } })
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_failed', dedupeKey: 'refund:re_1' }))
    expect(ledgerStore.size).toBe(0)
    expect(loyaltyMock).not.toHaveBeenCalled()
  })

  it('the SAME signed event delivered twice → second delivery is a no-op (row already failed)', async () => {
    // Faithful row state: the first delivery flips it to 'failed'; every later read sees that.
    let row = { ...ROW }
    db.refund.findUnique.mockImplementation(async () => ({ ...row }))
    db.refund.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { row = { ...row, ...data } as typeof row; return {} })
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
    const payload = event('refund.failed', { id: 're_1', status: 'failed', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: { grubano_refund_row: 'rf1' } })
    const sig = sign(payload)
    expect((await deliver(payload, sig)).status).toBe(200)
    expect((await deliver(payload, sig)).status).toBe(200)
    expect(db.refund.update).toHaveBeenCalledTimes(1)
    const keys = (alerts.sendAdminMoneyReviewAlert.mock.calls as unknown as Array<[{ dedupeKey: string }]>).map((c) => c[0].dedupeKey)
    expect(new Set(keys).size).toBe(1) // one dedupe key → sendOnce collapses any second email
  })

  it('UNKNOWN refund (no row) failed → review alert only, nothing mutated', async () => {
    const payload = event('refund.failed', { id: 're_unknown', status: 'failed', amount: 500, payment_intent: 'pi_zzz', charge: 'ch_zzz', metadata: {} })
    const res = await deliver(payload, sign(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ row: null })
    expect(db.refund.update).not.toHaveBeenCalled()
    expect(alerts.sendAdminMoneyReviewAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refund_failed', dedupeKey: 'refund:re_unknown' }))
  })
})

describe('refund.updated — routed to the full reconciliation, idempotent, fail-safe', () => {
  it('signed refund.updated succeeded → PI retrieved, ledger line from Stripe truth, loyalty reconciled', async () => {
    api.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', transfer_data: { destination: 'acct_r' }, latest_charge: CHARGE })
    const payload = event('refund.updated', { id: 're_1', status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const res = await deliver(payload, sign(payload))
    expect(res.status).toBe(200)
    expect(api.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] })
    const line = db.ledgerEntry.create.mock.calls[0][0].data
    expect(line).toMatchObject({ type: 'refund', grossAmount: -500, applicationFeeAmount: -27, netToRestaurant: -473, sourceEventId: 're_1', routed: true })
    expect(loyaltyMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: 'o1', chargeAmountCents: 1410 }))
  })

  it('the SAME signed refund.updated delivered twice → ledger line written ONCE (unique key), both 200', async () => {
    api.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', status: 'succeeded', transfer_data: { destination: 'acct_r' }, latest_charge: CHARGE })
    const payload = event('refund.updated', { id: 're_1', status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const sig = sign(payload)
    expect((await deliver(payload, sig)).status).toBe(200)
    expect((await deliver(payload, sig)).status).toBe(200)
    expect(ledgerStore.size).toBe(1)
    expect(db.ledgerEntry.create).toHaveBeenCalledTimes(2) // second attempt rejected by the unique key
  })

  it('UNKNOWN refund (PI not retrievable) succeeded → 503 fail-safe, nothing written (Stripe retries)', async () => {
    api.paymentIntents.retrieve.mockRejectedValue(new Error('No such payment_intent'))
    const payload = event('refund.updated', { id: 're_ghost', status: 'succeeded', amount: 500, payment_intent: 'pi_ghost', charge: 'ch_ghost', metadata: {} })
    const res = await deliver(payload, sign(payload))
    expect(res.status).toBe(503)
    expect(ledgerStore.size).toBe(0)
    expect(loyaltyMock).not.toHaveBeenCalled()
    expect(db.refund.update).not.toHaveBeenCalled()
  })

  it('still-pending refund.updated → acknowledged, nothing reconciled', async () => {
    const payload = event('refund.updated', { id: 're_p', status: 'pending', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const res = await deliver(payload, sign(payload))
    expect(await res.json()).toMatchObject({ ignored: true })
    expect(api.paymentIntents.retrieve).not.toHaveBeenCalled()
  })
})
