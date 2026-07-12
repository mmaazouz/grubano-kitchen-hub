import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── WP-MONEY-01 · ghost-order expiry reconciliation ───────────────────────────
// A card order lazily expired (>24h) then its payment_intent.succeeded lands. The
// money was captured — never mark it paid-and-dead. Explicit paymentStatus sentinel
// ('reconcile_manual' / 'refunded'), admin alert, auto-refund ONLY via lib/refund
// when REFUNDS_ENABLED (else manual queue), NEVER a silent money-out. The nominal
// awaiting_payment→received path stays byte-identical (last test).

const { db, stripe, refund, emails } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn() },
    operator:           { findUnique: vi.fn() },
    loyaltyCustomer:    { findUnique: vi.fn() },
    reservation:        { findFirst: vi.fn() },
    ledgerEntry:        { create: vi.fn() },
    $transaction:       vi.fn(),
  },
  stripe: { getStripe: vi.fn(), retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(), constructEvent: vi.fn() },
  refund: { isRefundsEnabled: vi.fn(), executeRefund: vi.fn() },
  emails: { sendAdminGhostOrderAlert: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, retrieveChargeFacts: stripe.retrieveChargeFacts, mapAccountStatus: stripe.mapAccountStatus }))
vi.mock('@/lib/refund', () => ({ isRefundsEnabled: refund.isRefundsEnabled, executeRefund: refund.executeRefund }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminGhostOrderAlert: emails.sendAdminGhostOrderAlert }))

import { POST } from '@/app/api/webhooks/stripe/route'

const PI = {
  id: 'pi_1', amount_received: 10500, amount: 10500, application_fee_amount: 1200,
  transfer_data: { destination: 'acct_x' }, currency: 'eur', latest_charge: 'ch_1',
  metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'delivery' },
}
const fire = (pi: any = PI) => { stripe.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: pi } }); return POST(new Request('http://x/api/webhooks/stripe', { method: 'POST', body: 'raw', headers: { 'stripe-signature': 'sig' } })) }
const expiredOrder = (paymentStatus = 'pending') => ({ id: 'o1', status: 'expired', total: 105, paymentStatus, stripePaymentIntentId: 'pi_1' })
const updates = () => db.order.update.mock.calls.map((c: any) => c[0].data)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: stripe.constructEvent } })
  stripe.retrieveChargeFacts.mockResolvedValue({ chargeId: 'ch_1', stripeFeeCents: 250, transferId: 'tr_1' })
  db.ledgerEntry.create.mockResolvedValue({ id: 'le1' })
  db.order.update.mockResolvedValue({})
  db.order.updateMany.mockResolvedValue({ count: 1 })
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.reservation.findFirst.mockResolvedValue(null)
  refund.isRefundsEnabled.mockReturnValue(false)
  refund.executeRefund.mockResolvedValue({ ok: true })
  emails.sendAdminGhostOrderAlert.mockResolvedValue({ status: 'sent' })
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('after expiry · REFUNDS ON', () => {
  it('auto-refunds via lib/refund, marks refunded, never reveals to resto', async () => {
    refund.isRefundsEnabled.mockReturnValue(true)
    db.order.findUnique.mockResolvedValue(expiredOrder())
    const res = await fire()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ order: 'expired_reconciled', refunded: true })
    expect(emails.sendAdminGhostOrderAlert).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', paymentIntentId: 'pi_1', amountCents: 10500, refundsOn: true }))
    expect(refund.executeRefund).toHaveBeenCalledWith({ orderId: 'o1', reason: 'ghost_order_expired' })
    expect(updates()).toEqual([{ paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' }, { paymentStatus: 'refunded' }])
    expect(db.order.updateMany).not.toHaveBeenCalled() // never flipped expired→received
  })

  it('refund returns not-ok → marks reconcile_manual (never final paid)', async () => {
    refund.isRefundsEnabled.mockReturnValue(true)
    refund.executeRefund.mockResolvedValue({ ok: false, status: 502, error: 'stripe down' })
    db.order.findUnique.mockResolvedValue(expiredOrder())
    const res = await fire()
    expect(await res.json()).toMatchObject({ order: 'expired_reconciled', refunded: false })
    expect(updates().at(-1)).toEqual({ paymentStatus: 'reconcile_manual' })
  })

  it('executeRefund THROWS → caught, marks reconcile_manual, webhook still 200', async () => {
    refund.isRefundsEnabled.mockReturnValue(true)
    refund.executeRefund.mockRejectedValue(new Error('boom'))
    db.order.findUnique.mockResolvedValue(expiredOrder())
    const res = await fire()
    expect(res.status).toBe(200)
    expect(updates().at(-1)).toEqual({ paymentStatus: 'reconcile_manual' })
  })
})

describe('after expiry · REFUNDS OFF → manual queue, no money-out', () => {
  it('marks reconcile_manual, alerts admin, does NOT refund or reveal', async () => {
    refund.isRefundsEnabled.mockReturnValue(false)
    db.order.findUnique.mockResolvedValue(expiredOrder())
    const res = await fire()
    expect(await res.json()).toMatchObject({ order: 'expired_needs_reconciliation' })
    expect(refund.executeRefund).not.toHaveBeenCalled()
    expect(emails.sendAdminGhostOrderAlert).toHaveBeenCalledWith(expect.objectContaining({ refundsOn: false }))
    expect(updates()).toEqual([{ paymentStatus: 'reconcile_manual', stripePaymentIntentId: 'pi_1' }])
    expect(db.order.updateMany).not.toHaveBeenCalled()
  })
})

describe('idempotent replay — condition (1)', () => {
  it('paymentStatus already reconcile_manual → no-op, no re-mark / no refund / no alert', async () => {
    db.order.findUnique.mockResolvedValue(expiredOrder('reconcile_manual'))
    const res = await fire()
    expect(await res.json()).toMatchObject({ noop: true, order: 'reconcile_manual' })
    expect(db.order.update).not.toHaveBeenCalled()
    expect(refund.executeRefund).not.toHaveBeenCalled()
    expect(emails.sendAdminGhostOrderAlert).not.toHaveBeenCalled()
  })
  it('paymentStatus already refunded → no-op', async () => {
    db.order.findUnique.mockResolvedValue(expiredOrder('refunded'))
    expect(await (await fire()).json()).toMatchObject({ noop: true, order: 'refunded' })
    expect(db.order.update).not.toHaveBeenCalled()
  })
})

describe('nominal path (not expired) — byte-identical', () => {
  it('awaiting_payment order → paid + reveal flip, no reconcile branch touched', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', status: 'awaiting_payment', total: 105, paymentStatus: 'pending', stripePaymentIntentId: 'pi_1' })
    const res = await fire()
    expect(await res.json()).toMatchObject({ order: 'paid' })
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' } })
    expect(db.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'awaiting_payment' }, data: { status: 'received' } })
    expect(refund.executeRefund).not.toHaveBeenCalled()
    expect(emails.sendAdminGhostOrderAlert).not.toHaveBeenCalled()
  })
})
