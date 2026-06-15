import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/marketplace/orders/[id]/pay + B2B payment webhook (Slice 5c) ─────────
// Pay is gated (flag + supplier active) + ownership + status confirmed; the
// webhook marks paid idempotently for b2b_supply sessions only.

const { db, caller, gate, lib, stripe, supConnect } = vi.hoisted(() => ({
  db: { supplyOrder: { findUnique: vi.fn() } },
  caller: vi.fn(),
  gate: vi.fn(),
  lib: { startSupplyOrderCheckout: vi.fn(), applySupplyOrderPaid: vi.fn(), MIN_SUPPLY_CHARGE_CENTS: 50, SUPPLY_PAY_CHANNEL: 'b2b_supply' },
  stripe: { getStripe: vi.fn(), mapAccountStatus: vi.fn() },
  supConnect: { applySupplierAccountStatus: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: caller }))
vi.mock('@/lib/supplier-connect', () => ({ isSupplierConnectEnabled: gate, applySupplierAccountStatus: supConnect.applySupplierAccountStatus }))
vi.mock('@/lib/supply-payment', () => lib)
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, mapAccountStatus: stripe.mapAccountStatus }))

import { POST as PAY } from '@/app/api/marketplace/orders/[id]/pay/route'
import { POST as WEBHOOK } from '@/app/api/webhooks/stripe-supplier/route'

const payReq = () => new Request('http://x/api/marketplace/orders/o1/pay', { method: 'POST' })
const params = (id: string) => ({ params: { id } })
const ACTIVE_SUPPLIER = { stripeAccountId: 'acct_s', payoutStatus: 'active' }

beforeEach(() => vi.clearAllMocks())

describe('POST /pay — gate + ownership + status + supplier-active (amounts via 5a lib)', () => {
  beforeEach(() => { gate.mockReturnValue(true); caller.mockResolvedValue({ id: 'op1', role: 'restaurant' }) })

  it('403 gated when the flag is CLOSED — no checkout started', async () => {
    gate.mockReturnValue(false)
    const res = await PAY(payReq(), params('o1'))
    expect(res.status).toBe(403)
    expect((await res.json()).gated).toBe(true)
    expect(lib.startSupplyOrderCheckout).not.toHaveBeenCalled()
  })

  it('401 no operator', async () => {
    caller.mockResolvedValue(null)
    expect((await PAY(payReq(), params('o1'))).status).toBe(401)
  })

  it('403 when paying ANOTHER resto’s order', async () => {
    db.supplyOrder.findUnique.mockResolvedValue({ id: 'o1', operatorId: 'op2', status: 'confirmed', paymentStatus: 'unpaid', totalCents: 25000, supplierProfile: ACTIVE_SUPPLIER })
    expect((await PAY(payReq(), params('o1'))).status).toBe(403)
    expect(lib.startSupplyOrderCheckout).not.toHaveBeenCalled()
  })

  it('409 when not confirmed; 409 when already paid', async () => {
    db.supplyOrder.findUnique.mockResolvedValue({ id: 'o1', operatorId: 'op1', status: 'placed', paymentStatus: 'unpaid', totalCents: 25000, supplierProfile: ACTIVE_SUPPLIER })
    expect((await PAY(payReq(), params('o1'))).status).toBe(409)
    db.supplyOrder.findUnique.mockResolvedValue({ id: 'o1', operatorId: 'op1', status: 'confirmed', paymentStatus: 'paid', totalCents: 25000, supplierProfile: ACTIVE_SUPPLIER })
    expect((await PAY(payReq(), params('o1'))).status).toBe(409)
  })

  it('403 when the supplier is not payout-active', async () => {
    db.supplyOrder.findUnique.mockResolvedValue({ id: 'o1', operatorId: 'op1', status: 'confirmed', paymentStatus: 'unpaid', totalCents: 25000, supplierProfile: { stripeAccountId: null, payoutStatus: 'pending' } })
    expect((await PAY(payReq(), params('o1'))).status).toBe(403)
    expect(lib.startSupplyOrderCheckout).not.toHaveBeenCalled()
  })

  it('confirmed + active + gate open → starts Checkout for ITS OWN order, returns url', async () => {
    db.supplyOrder.findUnique.mockResolvedValue({ id: 'o1', operatorId: 'op1', status: 'confirmed', paymentStatus: 'unpaid', totalCents: 25000, supplierProfile: ACTIVE_SUPPLIER })
    lib.startSupplyOrderCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/x', sessionId: 'cs_1', chargedCents: 23750 })
    const res = await PAY(payReq(), params('o1'))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toContain('checkout')
    expect(lib.startSupplyOrderCheckout.mock.calls[0][0]).toMatchObject({ order: { id: 'o1', totalCents: 25000 }, supplierAccountId: 'acct_s' })
  })

  it("'pending' RESUMES (not rejected): the idempotency key returns the SAME session, never a double charge", async () => {
    db.supplyOrder.findUnique.mockResolvedValue({ id: 'o1', operatorId: 'op1', status: 'confirmed', paymentStatus: 'pending', totalCents: 25000, supplierProfile: ACTIVE_SUPPLIER })
    lib.startSupplyOrderCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/x', sessionId: 'cs_1', chargedCents: 23750 })
    const res = await PAY(payReq(), params('o1'))
    expect(res.status).toBe(200) // resume an abandoned checkout — same session via idempotency key
    expect(lib.startSupplyOrderCheckout).toHaveBeenCalledTimes(1)
  })
})

describe('webhook — checkout.session.completed → idempotent mark-paid (b2b only)', () => {
  beforeEach(() => { process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET = 'whsec_test' })

  it('b2b_supply session → applySupplyOrderPaid(orderId, pi)', async () => {
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { payment_intent: 'pi_9', metadata: { grubano_channel: 'b2b_supply', supplyOrderId: 'o1' } } } }) } })
    const res = await WEBHOOK(new Request('http://x/api/webhooks/stripe-supplier', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }))
    expect(res.status).toBe(200)
    expect(lib.applySupplyOrderPaid).toHaveBeenCalledWith('o1', 'pi_9')
  })

  it('ignores a non-b2b checkout session', async () => {
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { metadata: { grubano_channel: 'something_else' } } } }) } })
    await WEBHOOK(new Request('http://x/api/webhooks/stripe-supplier', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }))
    expect(lib.applySupplyOrderPaid).not.toHaveBeenCalled()
  })
})
