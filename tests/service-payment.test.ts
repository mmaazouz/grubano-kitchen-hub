import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Service-invoice payment lib (Stripe Checkout, P8, Agent 81) ───────────────
// Amounts come from the REAL computeServiceEconomics (P6, not mocked). The Stripe client +
// prisma are mocked. DESTINATION charge: charge restaurantPays (= the invoice amount), app_fee
// = grubanoMargin (5%), the prestataire nets the rest. Idempotent mark-paid. ⚠️ REAL money (TEST).

const { db, stripe } = vi.hoisted(() => ({
  db: { serviceInvoice: { update: vi.fn(), updateMany: vi.fn() } },
  stripe: { getStripe: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe }))

import { startServiceInvoiceCheckout, applyServiceInvoicePaid, SERVICE_PAY_CHANNEL } from '@/lib/service-payment'

beforeEach(() => vi.clearAllMocks())

describe('startServiceInvoiceCheckout — amounts strictly from P6, destination charge, idempotent', () => {
  it('charges restaurantPays (= invoice amount), app_fee = 5% margin, routes to the prestataire; one session', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.serviceInvoice.update.mockResolvedValue({})

    // amount 10000 → restaurantPays 10000, grubanoMargin round(10000×0.05)=500, prestataireNet 9500
    const r = await startServiceInvoiceCheckout({
      invoice: { id: 'inv1', number: 'PRS-2026-00001', amountCents: 10000 },
      prestataireAccountId: 'acct_p', origin: 'https://app.x',
    })
    expect(r.url).toContain('checkout')
    expect(r.chargedCents).toBe(10000)
    const [params, opts] = create.mock.calls[0]
    expect(params.line_items[0].price_data.unit_amount).toBe(10000)                 // resto pays the quote (server)
    expect(params.line_items[0].price_data.currency).toBe('eur')
    expect(params.payment_intent_data.application_fee_amount).toBe(500)             // Grubano 5% (computeServiceEconomics)
    expect(params.payment_intent_data.transfer_data.destination).toBe('acct_p')    // prestataire Connect account
    expect(params.payment_intent_data.on_behalf_of).toBe('acct_p')
    expect(params.payment_intent_data.metadata).toMatchObject({ serviceInvoiceId: 'inv1', grubano_channel: SERVICE_PAY_CHANNEL })
    expect(opts.idempotencyKey).toBe('service_pay_inv1')                            // one session per invoice → no double charge
    expect(db.serviceInvoice.update.mock.calls[0][0]).toEqual({ where: { id: 'inv1' }, data: { stripeCheckoutSessionId: 'cs_1' } })
  })

  it('the net (restaurantPays − app_fee) is exactly the prestataire payout — conservation', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_2', url: 'u' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.serviceInvoice.update.mockResolvedValue({})
    await startServiceInvoiceCheckout({ invoice: { id: 'inv2', number: 'N', amountCents: 33333 }, prestataireAccountId: 'acct_p', origin: 'x' })
    const p = create.mock.calls[0][0]
    const charged = p.line_items[0].price_data.unit_amount
    const fee = p.payment_intent_data.application_fee_amount
    expect(charged).toBe(33333)
    expect(fee).toBe(Math.round(33333 * 0.05)) // 1667
    expect(charged - fee).toBe(33333 - 1667)   // prestataire net, exact
  })

  it('omits application_fee when the 5% margin rounds to 0 (Stripe rejects a 0 fee)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_3', url: 'u' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.serviceInvoice.update.mockResolvedValue({})
    // amount 9 → round(0.45) = 0 margin
    await startServiceInvoiceCheckout({ invoice: { id: 'inv3', number: 'N', amountCents: 9 }, prestataireAccountId: 'acct_p', origin: 'x' })
    expect(create.mock.calls[0][0].payment_intent_data.application_fee_amount).toBeUndefined()
  })
})

describe('applyServiceInvoicePaid — idempotent mark-paid', () => {
  it('marks paid once via the status guard; a replay updates 0 rows', async () => {
    db.serviceInvoice.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    expect(await applyServiceInvoicePaid('inv1', 'pi_1')).toBe(1)
    expect(db.serviceInvoice.updateMany.mock.calls[0][0].where).toEqual({ id: 'inv1', status: { not: 'paid' } })
    expect(db.serviceInvoice.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripePaymentIntentId: 'pi_1' })
    expect(await applyServiceInvoicePaid('inv1', 'pi_1')).toBe(0) // replay → no double effect
  })
  it('empty id → 0, no write', async () => {
    expect(await applyServiceInvoicePaid('', null)).toBe(0)
    expect(db.serviceInvoice.updateMany).not.toHaveBeenCalled()
  })
})
