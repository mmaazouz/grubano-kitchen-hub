import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── WP-MONEY-04 (2b) · webhook recordSucceededPaymentLedger — line construction ─
// The final arbiter that bakes net = gross − fee, derives `routed` from
// transfer_data.destination, and the channel from metadata.grubano_channel (with
// the ticketId→dinein / no-order→reservation fallback). This is the exact code
// WP-MONEY-01 will touch — locking it now makes that gate's non-regression provable.
// recordLedgerEntry runs FIRST (route line 134), before handleOrderPaid, so we
// assert on the produced ledgerEntry.create payload.

const { db, stripe } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn() },
    operator:           { findUnique: vi.fn() },
    loyaltyCustomer:    { findUnique: vi.fn() },
    reservation:        { findFirst: vi.fn(), findUnique: vi.fn() },
    ledgerEntry:        { create: vi.fn() },
    $transaction:       vi.fn(),
  },
  stripe: { getStripe: vi.fn(), retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(), constructEvent: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, retrieveChargeFacts: stripe.retrieveChargeFacts, mapAccountStatus: stripe.mapAccountStatus }))
// KEEP REAL: @/lib/ledger (recordLedgerEntry → the mocked prisma.ledgerEntry.create)

import { POST } from '@/app/api/webhooks/stripe/route'

const post = (sig = 'sig') =>
  POST(new Request('http://x/api/webhooks/stripe', {
    method: 'POST', body: 'raw', headers: sig ? { 'stripe-signature': sig } : {},
  }))
const fire = (pi: any, type = 'payment_intent.succeeded') => { stripe.constructEvent.mockReturnValue({ type, data: { object: pi } }); return post() }
const ledgerData = () => db.ledgerEntry.create.mock.calls[0][0].data as any
const golden = (d: any) => expect(d.grossAmount).toBe(d.applicationFeeAmount + d.netToRestaurant)

const ORDER_PI = {
  id: 'pi_1', amount_received: 10500, amount: 10500, application_fee_amount: 1200,
  transfer_data: { destination: 'acct_x' }, currency: 'eur', latest_charge: 'ch_1',
  metadata: { restaurantId: 'r1', orderId: 'o1', grubano_channel: 'delivery' },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: stripe.constructEvent } })
  stripe.retrieveChargeFacts.mockResolvedValue({ chargeId: 'ch_1', stripeFeeCents: 250, transferId: 'tr_1' })
  db.ledgerEntry.create.mockResolvedValue({ id: 'le1' })
  // handleOrderPaid path — a payable, not-yet-paid order whose total matches the charge
  db.order.findUnique.mockResolvedValue({ id: 'o1', paymentStatus: 'pending', stripePaymentIntentId: null, total: 105, pointsRedeemed: 0, consumerId: 'c1' })
  db.order.update.mockResolvedValue({})
  db.order.updateMany.mockResolvedValue({ count: 1 })
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.reservation.findFirst.mockResolvedValue(null)
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('signature', () => {
  it('missing stripe-signature → 400, no ledger', async () => {
    const res = await post('')
    expect(res.status).toBe(400)
    expect(db.ledgerEntry.create).not.toHaveBeenCalled()
  })
})

describe('routed order payment — golden equation + routing + channel', () => {
  it('writes gross/fee/net=gross−fee, routed from transfer_data, channel from metadata', async () => {
    const res = await fire(ORDER_PI)
    expect(res.status).toBe(200)
    const d = ledgerData()
    expect(d.type).toBe('payment')
    expect(d.grossAmount).toBe(10500)
    expect(d.applicationFeeAmount).toBe(1200)
    expect(d.netToRestaurant).toBe(9300)
    golden(d)
    expect(d.routed).toBe(true)
    expect(d.destinationAccountId).toBe('acct_x')
    expect(d.channel).toBe('delivery')
    expect(d.stripeChargeId).toBe('ch_1')
    expect(d.stripeFeeAmount).toBe(250)
    expect(d.stripeTransferId).toBe('tr_1')
    expect(d.sourceEventId).toBe('pi_1')
    // the nominal reveal flip fired
    expect(db.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'awaiting_payment' }, data: { status: 'received' } })
  })
})

describe('platform-only payment (no transfer_data)', () => {
  it('routed false, destinationAccountId null, still net = gross − fee', async () => {
    const d = (await fire({ ...ORDER_PI, transfer_data: undefined }), ledgerData())
    expect(d.routed).toBe(false)
    expect(d.destinationAccountId).toBeNull()
    golden(d)
  })
})

describe('channel fallback + deposit_capture', () => {
  it('no orderId/ticketId + no grubano_channel → type deposit_capture, channel reservation', async () => {
    await fire({ id: 'pi_2', amount_received: 3000, amount: 3000, application_fee_amount: 0, currency: 'eur', metadata: { restaurantId: 'r1' } })
    const d = ledgerData()
    expect(d.type).toBe('deposit_capture')
    expect(d.channel).toBe('reservation')
    expect(d.routed).toBe(false)
    golden(d)
  })
})

describe('resilience', () => {
  it('retrieveChargeFacts throws → line still written, stripeFeeAmount null', async () => {
    stripe.retrieveChargeFacts.mockRejectedValue(new Error('stripe down'))
    const res = await fire(ORDER_PI)
    expect(res.status).toBe(200)
    const d = ledgerData()
    expect(d.stripeFeeAmount).toBeNull()
    expect(d.stripeChargeId).toBe('ch_1') // falls back to pi.latest_charge
    golden(d)
  })
  it('duplicate ledger (P2002) → idempotent, webhook still 200', async () => {
    db.ledgerEntry.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }))
    const res = await fire(ORDER_PI)
    expect(res.status).toBe(200)
  })
  it('PI without metadata.restaurantId → no ledger line, webhook still 200', async () => {
    const res = await fire({ id: 'pi_3', amount_received: 1000, amount: 1000, currency: 'eur', metadata: {} })
    expect(res.status).toBe(200)
    expect(db.ledgerEntry.create).not.toHaveBeenCalled()
  })
})
