import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Deposit route + the (modified) P8 pay route + the webhook (P8c, Agent 83) ──
// The DEPOSIT route charges quote×pct at acceptance. The pay route now charges the BALANCE when a
// deposit was paid — and is BYTE-IDENTICAL behaviour for depositPct=0 (it literally calls the P8
// startServiceInvoiceCheckout). The webhook routes deposit vs balance. Amounts are SERVER-derived
// (REAL computeDepositSplit). ⚠️ REAL money (TEST).

const { db, caller, conn, inv, lib, stripe } = vi.hoisted(() => ({
  db: { serviceMission: { findUnique: vi.fn() } },
  caller: vi.fn(),
  conn: { isPrestataireConnectLive: vi.fn(), applyPrestataireAccountStatus: vi.fn() },
  inv: vi.fn(),
  lib: {
    startServiceDepositCheckout: vi.fn(), startServiceBalanceCheckout: vi.fn(), startServiceInvoiceCheckout: vi.fn(),
    applyServiceInvoicePaid: vi.fn(), applyServiceDepositPaid: vi.fn(),
    MIN_SERVICE_CHARGE_CENTS: 50, SERVICE_PAY_CHANNEL: 'service_invoice', SERVICE_DEPOSIT_CHANNEL: 'service_deposit',
  },
  stripe: { getStripe: vi.fn(), mapAccountStatus: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: caller }))
vi.mock('@/lib/prestataire-connect', () => conn)
vi.mock('@/lib/service-invoice', () => ({ issueServiceInvoice: inv }))
vi.mock('@/lib/service-payment', () => lib)
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe, mapAccountStatus: stripe.mapAccountStatus }))
// lib/service-deposit is NOT mocked → the REAL split (and the REAL 5% via service-pricing) is exercised.

import { POST as DEPOSIT } from '@/app/api/prestataire-invoices/[missionId]/deposit/route'
import { POST as PAY } from '@/app/api/prestataire-invoices/[missionId]/pay/route'
import { POST as WEBHOOK } from '@/app/api/webhooks/stripe-prestataire/route'

const params = (missionId: string) => ({ params: { missionId } })
const req = (body?: unknown) => new Request('http://x', { method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
const ACTIVE = { status: 'active', stripeAccountId: 'acct_p', payoutStatus: 'active' }
const ISSUED = { id: 'inv1', number: 'PRS-2026-00001', amountCents: 10000, status: 'issued' }
const DEP = (over: Record<string, unknown> = {}) => ({
  id: 'm1', status: 'accepted', quoteAmountCents: 10000, depositPct: 30, depositStatus: null,
  restaurantOperatorId: 'op1', prestataireProfileId: 'pp1', prestataireProfile: ACTIVE, invoice: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  conn.isPrestataireConnectLive.mockReturnValue(true)
  caller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  inv.mockResolvedValue(ISSUED)
  lib.startServiceDepositCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/dep', sessionId: 'cs', chargedCents: 3000 })
  lib.startServiceBalanceCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/bal', sessionId: 'cs', chargedCents: 7000 })
  lib.startServiceInvoiceCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/full', sessionId: 'cs', chargedCents: 10000 })
})

describe('DEPOSIT route — gates + nominal + server amount', () => {
  beforeEach(() => db.serviceMission.findUnique.mockResolvedValue(DEP()))

  it('double-flag OFF → 404, no work', async () => {
    conn.isPrestataireConnectLive.mockReturnValue(false)
    expect((await DEPOSIT(req(), params('m1'))).status).toBe(404)
    expect(lib.startServiceDepositCheckout).not.toHaveBeenCalled()
  })
  it('401 / 403 role / 404 mission / 403 IDOR', async () => {
    caller.mockResolvedValue(null);             expect((await DEPOSIT(req(), params('m1'))).status).toBe(401)
    caller.mockResolvedValue({ id: 'op1', role: 'supplier' }); expect((await DEPOSIT(req(), params('m1'))).status).toBe(403)
    caller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
    db.serviceMission.findUnique.mockResolvedValue(null);       expect((await DEPOSIT(req(), params('m1'))).status).toBe(404)
    db.serviceMission.findUnique.mockResolvedValue(DEP({ restaurantOperatorId: 'op2' })); expect((await DEPOSIT(req(), params('m1'))).status).toBe(403)
  })
  it('409 when the quote has no deposit; 409 when not accepted/done; 409 when already paid/settled', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DEP({ depositPct: 0 }));  expect((await DEPOSIT(req(), params('m1'))).status).toBe(409)
    db.serviceMission.findUnique.mockResolvedValue(DEP({ status: 'quoted' })); expect((await DEPOSIT(req(), params('m1'))).status).toBe(409)
    db.serviceMission.findUnique.mockResolvedValue(DEP({ invoice: { id: 'inv1', status: 'paid' } })); expect((await DEPOSIT(req(), params('m1'))).status).toBe(409)
    db.serviceMission.findUnique.mockResolvedValue(DEP({ depositStatus: 'paid' })); expect((await DEPOSIT(req(), params('m1'))).status).toBe(409)
  })
  it('403 when the prestataire is not active / not payout-active', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DEP({ prestataireProfile: { status: 'suspended', stripeAccountId: 'acct_p', payoutStatus: 'active' } }))
    expect((await DEPOSIT(req(), params('m1'))).status).toBe(403)
    db.serviceMission.findUnique.mockResolvedValue(DEP({ prestataireProfile: { status: 'active', stripeAccountId: null, payoutStatus: 'pending' } }))
    expect((await DEPOSIT(req(), params('m1'))).status).toBe(403)
  })
  it('400 when the deposit is below the minimum (small quote)', async () => {
    db.serviceMission.findUnique.mockResolvedValue(DEP({ quoteAmountCents: 100, depositPct: 30 })) // 30 < 50
    expect((await DEPOSIT(req(), params('m1'))).status).toBe(400)
  })
  it('nominal → charges deposit = round(quote×pct) with its 5% share; body amount IGNORED', async () => {
    const res = await DEPOSIT(req({ amountCents: 999999, depositCents: 999999 }), params('m1'))
    expect(res.status).toBe(200)
    expect(lib.startServiceDepositCheckout.mock.calls[0][0]).toMatchObject({
      missionId: 'm1', depositCents: 3000, depositFeeCents: 150, prestataireAccountId: 'acct_p', // 30% of 10000, 5% of 3000
    })
  })
})

describe('PAY route — balance vs full, and depositPct=0 ≡ P8 (equivalence)', () => {
  const PAY_M = (over: Record<string, unknown> = {}) => ({
    id: 'm1', status: 'done', quoteAmountCents: 10000, restaurantOperatorId: 'op1', prestataireProfileId: 'pp1',
    depositPct: 0, depositStatus: null, prestataireProfile: ACTIVE, invoice: null, ...over,
  })

  it('⚠️ depositPct=0 → calls the UNCHANGED P8 startServiceInvoiceCheckout (full quote), NOT the balance', async () => {
    db.serviceMission.findUnique.mockResolvedValue(PAY_M())
    const res = await PAY(req(), params('m1'))
    expect(res.status).toBe(200)
    expect(lib.startServiceInvoiceCheckout).toHaveBeenCalledTimes(1)
    expect(lib.startServiceInvoiceCheckout.mock.calls[0][0]).toMatchObject({ invoice: { id: 'inv1', amountCents: 10000 } })
    expect(lib.startServiceBalanceCheckout).not.toHaveBeenCalled()
  })

  it('depositPct>0 + deposit paid → charges the BALANCE (quote − deposit) with the remaining fee', async () => {
    db.serviceMission.findUnique.mockResolvedValue(PAY_M({ depositPct: 30, depositStatus: 'paid' }))
    const res = await PAY(req(), params('m1'))
    expect(res.status).toBe(200)
    expect(lib.startServiceBalanceCheckout.mock.calls[0][0]).toMatchObject({ balanceCents: 7000, balanceFeeCents: 350 }) // 10000−3000, 500−150
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })

  it('depositPct>0 + deposit NOT paid → 409 (the deposit must be settled first), no charge', async () => {
    db.serviceMission.findUnique.mockResolvedValue(PAY_M({ depositPct: 30, depositStatus: null }))
    expect((await PAY(req(), params('m1'))).status).toBe(409)
    expect(lib.startServiceBalanceCheckout).not.toHaveBeenCalled()
    expect(lib.startServiceInvoiceCheckout).not.toHaveBeenCalled()
  })
})

describe('webhook — deposit vs balance vs account, P7/P8 intact', () => {
  beforeEach(() => { process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET = 'whsec_test' })
  const hook = () => WEBHOOK(new Request('http://x', { method: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' }))

  it('service_deposit → applyServiceDepositPaid(missionId) (NOT the invoice)', async () => {
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { payment_intent: 'pi_d', metadata: { grubano_channel: 'service_deposit', serviceMissionId: 'm1' } } } }) } })
    expect((await hook()).status).toBe(200)
    expect(lib.applyServiceDepositPaid).toHaveBeenCalledWith('m1', 'pi_d')
    expect(lib.applyServiceInvoicePaid).not.toHaveBeenCalled()
  })
  it('service_invoice → applyServiceInvoicePaid(invoiceId) (P8 unchanged)', async () => {
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { payment_intent: 'pi_b', metadata: { grubano_channel: 'service_invoice', serviceInvoiceId: 'inv1' } } } }) } })
    await hook()
    expect(lib.applyServiceInvoicePaid).toHaveBeenCalledWith('inv1', 'pi_b')
    expect(lib.applyServiceDepositPaid).not.toHaveBeenCalled()
  })
  it('account.updated still works (P7); double-flag OFF → 404; bad sig → 400', async () => {
    stripe.mapAccountStatus.mockReturnValue('active')
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => ({ type: 'account.updated', data: { object: { id: 'acct_p' } } }) } })
    await hook()
    expect(conn.applyPrestataireAccountStatus).toHaveBeenCalledWith('acct_p', 'active')
    conn.isPrestataireConnectLive.mockReturnValue(false); expect((await hook()).status).toBe(404)
    conn.isPrestataireConnectLive.mockReturnValue(true)
    stripe.getStripe.mockReturnValue({ webhooks: { constructEvent: () => { throw new Error('bad') } } })
    expect((await hook()).status).toBe(400)
  })
})
