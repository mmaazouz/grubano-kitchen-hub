import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B2B supply payment lib (Stripe Checkout, Slice 5c) ────────────────────────
// Amounts come from the REAL computeSupplyEconomics (5a, not mocked). The Stripe
// client + prisma are mocked. Destination charge: charge restoPays, app_fee =
// grubanoMargin, supplier nets the rest. Idempotent mark-paid.

const { db, stripe } = vi.hoisted(() => ({
  db: { supplyOrder: { update: vi.fn(), updateMany: vi.fn() } },
  stripe: { getStripe: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe }))

import { startSupplyOrderCheckout, applySupplyOrderPaid, SUPPLY_PAY_CHANNEL } from '@/lib/supply-payment'

beforeEach(() => vi.clearAllMocks())

describe('startSupplyOrderCheckout — amounts strictly from 5a, destination charge, idempotent', () => {
  it('charges restoPays, app_fee = grubanoMargin, routes to the supplier; persists pending + economics', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.supplyOrder.update.mockResolvedValue({})

    // base 25000 → tier 1 (≥20000, −8% / resto −5%): restoPays 23750, supplierPayout 23000, grubanoMargin 750
    const r = await startSupplyOrderCheckout({ order: { id: 'o1', totalCents: 25000 }, supplierAccountId: 'acct_s', origin: 'https://app.x' })
    expect(r.url).toContain('checkout')
    const [params, opts] = create.mock.calls[0]
    expect(params.line_items[0].price_data.unit_amount).toBe(23750)               // resto pays (5a)
    expect(params.payment_intent_data.application_fee_amount).toBe(750)            // grubano margin (5a)
    expect(params.payment_intent_data.transfer_data.destination).toBe('acct_s')   // supplier Connect account
    expect(params.payment_intent_data.on_behalf_of).toBe('acct_s')
    expect(params.payment_intent_data.metadata).toMatchObject({ supplyOrderId: 'o1', grubano_channel: SUPPLY_PAY_CHANNEL })
    expect(opts.idempotencyKey).toBe('supply_pay_o1')                             // one session per order
    expect(db.supplyOrder.update.mock.calls[0][0].data).toMatchObject({
      paymentStatus: 'pending', stripeCheckoutSessionId: 'cs_1',
      chargedCents: 23750, supplierPayoutCents: 23000, grubanoMarginCents: 750,
    })
  })

  it('omits application_fee when the margin rounds to 0', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_2', url: 'u' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.supplyOrder.update.mockResolvedValue({})
    // base 10 → flat 1% → round(0.1) = 0 margin
    await startSupplyOrderCheckout({ order: { id: 'o2', totalCents: 10 }, supplierAccountId: 'acct_s', origin: 'https://app.x' })
    expect(create.mock.calls[0][0].payment_intent_data.application_fee_amount).toBeUndefined()
  })
})

describe('applySupplyOrderPaid — idempotent mark-paid', () => {
  it('marks paid once via the status guard; a replay updates 0 rows', async () => {
    db.supplyOrder.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    expect(await applySupplyOrderPaid('o1', 'pi_1')).toBe(1)
    expect(db.supplyOrder.updateMany.mock.calls[0][0].where).toEqual({ id: 'o1', paymentStatus: { not: 'paid' } })
    expect(db.supplyOrder.updateMany.mock.calls[0][0].data).toMatchObject({ paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
    expect(await applySupplyOrderPaid('o1', 'pi_1')).toBe(0) // replay → no-op
  })
  it('empty id → 0, no write', async () => {
    expect(await applySupplyOrderPaid('', null)).toBe(0)
    expect(db.supplyOrder.updateMany).not.toHaveBeenCalled()
  })
})
