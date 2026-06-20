import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/prestataire-invoices/[missionId]/pay + the extended stripe-prestataire webhook (P8) ──
// Pay is DOUBLE-FLAG gated + owner-scoped + 7 gates; amounts come ONLY from the server (the
// issued invoice). The webhook marks the invoice PAID idempotently for service_invoice sessions
// only, and still handles account.updated (P7). ⚠️ REAL money (TEST).

const { db, caller, conn, inv, lib, stripe } = vi.hoisted(() => ({
  db: { serviceMission: { findUnique: vi.fn() } },
  caller: vi.fn(),
  conn: { isPrestataireConnectLive: vi.fn(), applyPrestataireAccountStatus: vi.fn() },
  inv: vi.fn(), // issueServiceInvoice
  lib: { startServiceInvoiceCheckout: vi.fn(), applyServiceInvoicePaid: vi.fn(), MIN_SERVICE_CHARGE_CENTS: 50, SERVICE_PAY_CHANNEL: 'service_invoice' },
  stripe: { getStripe: vi.fn(), mapAccountStatus: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: caller }))
vi.mock('@/lib/prestataire-connect', () => conn)
vi.mock('@/lib/service-invoice', () => ({ issueServiceInvoice: inv }))
vi.mock('@/lib/service-payment', () => lib)
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, mapAccountStatus: stripe.mapAccountStatus }))

import { POST as PAY } from '@/app/api/prestataire-invoices/[missionId]/pay/route'
import { POST as WEBHOOK } from '@/app/api/webhooks/stripe-prestataire/route'

const params = (missionId: string) => ({ params: { missionId } })
const payReq = (body?: unknown) => new Request('http://x/api/prestataire-invoices/m1/pay', {
  method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
})
const ACTIVE_PRESTA = { status: 'active', stripeAccountId: 'acct_p', payoutStatus: 'active' }
const DONE = (over: Record<string, unknown> = {}) => ({
  id: 'm1', status: 'done', quoteAmountCents: 10000, restaurantOperatorId: 'op1', prestataireProfileId: 'pp1',
  prestataireProfile: ACTIVE_PRESTA, invoice: null, ...over,
})
const ISSUED = { id: 'inv1', number: 'PRS-2026-00001', amountCents: 10000, status: 'issued' }

beforeEach(() => {
  vi.clearAllMocks()
  conn.isPrestataireConnectLive.mockReturnValue(true)
  caller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  inv.mockResolvedValue(ISSUED)
  lib.startServiceInvoiceCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/x', sessionId: 'cs_1', chargedCents: 10000 })
})

describe('POST /pay — the 7 gates', () => {
  it('(1) DOUBLE FLAG OFF → 404, no work', async () => {
    conn.isPrestataireConnectLive.mockReturnValue(false)
    expect((await PAY(payReq(), params('m1'))).status).toBe(404)
    expect(caller).not.toHaveBeenCalled()
    expect(inv).not.toHaveBeenCalled()
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('401 no operator; 403 non-restaurant role', async () => {
    caller.mockResolvedValue(null)
    expect((await PAY(payReq(), params('m1'))).status).toBe(401)
    caller.mockResolvedValue({ id: 'op1', role: 'supplier' })
    expect((await PAY(payReq(), params('m1'))).status).toBe(403)
  })
  it('404 mission not found', async () => {
    db.serviceMission.findUnique.mockResolvedValue(null)
    expect((await PAY(payReq(), params('m1'))).status).toBe(404)
  })
  it('(5) 403 paying ANOTHER resto’s mission (IDOR), nothing charged', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ restaurantOperatorId: 'op2' }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(403)
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('(2) 409 when mission not done', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ status: 'accepted' }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(409)
  })
  it('(3a) 409 when no agreed amount', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ quoteAmountCents: null }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(409)
  })
  it('(3b) 409 when the invoice is already paid (early, from loaded data)', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ invoice: { id: 'inv1', status: 'paid' } }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(409)
    expect(inv).not.toHaveBeenCalled()
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('(3b race) 409 when the freshly-issued invoice is already paid', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE())
    inv.mockResolvedValue({ ...ISSUED, status: 'paid' })
    expect((await PAY(payReq(), params('m1'))).status).toBe(409)
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('(4a) 403 when the prestataire business status is not active', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ prestataireProfile: { status: 'suspended', stripeAccountId: 'acct_p', payoutStatus: 'active' } }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(403)
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
  it('(4b) 403 when the prestataire is not payout-active (no account / status ≠ active)', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ prestataireProfile: { status: 'active', stripeAccountId: null, payoutStatus: 'pending' } }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(403)
    db.serviceMission.findUnique.mockResolvedValue(DONE({ prestataireProfile: { status: 'active', stripeAccountId: 'acct_p', payoutStatus: 'pending' } }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(403)
  })
  it('(6) 400 when the amount is below the minimum', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DONE({ quoteAmountCents: 10 }))
    expect((await PAY(payReq(), params('m1'))).status).toBe(400)
  })
})

describe('POST /pay — nominal + server-amount', () => {
  beforeEach(() => db.serviceMission.findUnique.mockResolvedValue(DONE()))

  it('done + invoice issued + prestataire payout-active → checkout for the prestataire account, returns url', async () => {
    const res = await PAY(payReq(), params('m1'))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toContain('checkout')
    const arg = lib.startServiceInvoiceCheckout.mock.calls[0][0]
    expect(arg.invoice).toEqual({ id: 'inv1', number: 'PRS-2026-00001', amountCents: 10000 })
    expect(arg.prestataireAccountId).toBe('acct_p')
  })

  it('a client-supplied amount in the body is IGNORED — the charge uses the issued invoice amount', async () => {
    await PAY(payReq({ amountCents: 1, amount: 999999, totalCents: 999999 }), params('m1'))
    // the route never reads the body; the amount comes from the issued invoice (server).
    expect(lib.startServiceInvoiceCheckout.mock.calls[0][0].invoice.amountCents).toBe(10000)
  })

  it('issues the invoice from the SESSION mission (server ids), never the request', async () => {
    await PAY(payReq(), params('m1'))
    expect(inv.mock.calls[0][0]).toEqual({
      serviceMissionId: 'm1', restaurantOperatorId: 'op1', prestataireProfileId: 'pp1', amountCents: 10000,
    })
  })
})

describe('webhook — checkout.session.completed → idempotent mark-paid (service only) + P7 intact', () => {
  beforeEach(() => { process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET = 'whsec_test' })

  it('service_invoice session → applyServiceInvoicePaid(invoiceId, pi)', async () => {
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { payment_intent: 'pi_9', metadata: { grubano_channel: 'service_invoice', serviceInvoiceId: 'inv1' } } } }) } })
    const res = await WEBHOOK(new Request('http://x/api/webhooks/stripe-prestataire', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }))
    expect(res.status).toBe(200)
    expect(lib.applyServiceInvoicePaid).toHaveBeenCalledWith('inv1', 'pi_9')
  })

  it('ignores a non-service checkout session (no mass effect)', async () => {
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { metadata: { grubano_channel: 'b2b_supply', supplyOrderId: 'o1' } } } }) } })
    await WEBHOOK(new Request('http://x/api/webhooks/stripe-prestataire', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }))
    expect(lib.applyServiceInvoicePaid).not.toHaveBeenCalled()
  })

  it('account.updated still works (P7 branch intact)', async () => {
    stripe.mapAccountStatus.mockReturnValue('active')
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'account.updated', data: { object: { id: 'acct_p' } } }) } })
    await WEBHOOK(new Request('http://x/api/webhooks/stripe-prestataire', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }))
    expect(conn.applyPrestataireAccountStatus).toHaveBeenCalledWith('acct_p', 'active')
    expect(lib.applyServiceInvoicePaid).not.toHaveBeenCalled()
  })

  it('double flag OFF → 404; bad signature → 400', async () => {
    conn.isPrestataireConnectLive.mockReturnValue(false)
    expect((await WEBHOOK(new Request('http://x', { method: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' }))).status).toBe(404)
    conn.isPrestataireConnectLive.mockReturnValue(true)
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => { throw new Error('bad sig') } } })
    expect((await WEBHOOK(new Request('http://x', { method: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' }))).status).toBe(400)
  })
})
