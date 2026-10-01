import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Deposit + Balance destination charges (lib, P8c, Agent 83) ─────────────────
// Each charge is created with an EXPLICIT server amount + fee (the route computes the split).
// Deposit → channel service_deposit, key service_deposit_<id>, marks the MISSION (not the invoice).
// Balance → channel service_invoice, key service_pay_<id> (= the completion), marks the invoice. TEST.

const { db, stripe } = vi.hoisted(() => ({
  db: { serviceMission: { update: vi.fn(), updateMany: vi.fn() }, serviceInvoice: { update: vi.fn() } },
  stripe: { getStripe: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripe.getStripe }))

import {
  startServiceDepositCheckout, startServiceBalanceCheckout, applyServiceDepositPaid,
  SERVICE_DEPOSIT_CHANNEL, SERVICE_PAY_CHANNEL,
} from '@/lib/service-payment'

beforeEach(() => vi.clearAllMocks())

describe('startServiceDepositCheckout — deposit destination charge', () => {
  it('charges the deposit amount + fee to the prestataire; persists pending on the mission', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_dep', url: 'https://checkout.stripe.test/dep' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.serviceMission.update.mockResolvedValue({})

    const r = await startServiceDepositCheckout({
      missionId: 'm1', invoice: { id: 'inv1', number: 'PRS-2026-00001' },
      depositCents: 3000, depositFeeCents: 150, prestataireAccountId: 'acct_p', origin: 'https://app.x',
    })
    expect(r.chargedCents).toBe(3000)
    const [params, opts] = create.mock.calls[0]
    expect(params.line_items[0].price_data.unit_amount).toBe(3000)                  // the deposit (server)
    expect(params.payment_intent_data.application_fee_amount).toBe(150)             // the deposit's fee
    expect(params.payment_intent_data.transfer_data.destination).toBe('acct_p')
    expect(params.payment_intent_data.on_behalf_of).toBe('acct_p')
    expect(params.payment_intent_data.metadata).toMatchObject({ serviceMissionId: 'm1', serviceInvoiceId: 'inv1', grubano_channel: SERVICE_DEPOSIT_CHANNEL })
    expect(opts.idempotencyKey).toBe('service_deposit_inv1')                        // distinct from the balance key
    // the MISSION goes 'pending' (the INVOICE stays issued — not paid by the deposit).
    expect(db.serviceMission.update.mock.calls[0][0]).toEqual({ where: { id: 'm1' }, data: { depositStatus: 'pending', depositPaidCents: 3000, depositStripeSessionId: 'cs_dep' } })
  })
  it('omits application_fee when the deposit fee rounds to 0', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs', url: 'u' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.serviceMission.update.mockResolvedValue({})
    await startServiceDepositCheckout({ missionId: 'm1', invoice: { id: 'inv1', number: 'N' }, depositCents: 9, depositFeeCents: 0, prestataireAccountId: 'acct_p', origin: 'x' })
    expect(create.mock.calls[0][0].payment_intent_data.application_fee_amount).toBeUndefined()
  })
})

describe('startServiceBalanceCheckout — balance destination charge (= completion)', () => {
  it('charges the balance + remaining fee; SAME channel + key as the full completion; marks the invoice ref', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_bal', url: 'https://checkout.stripe.test/bal' })
    stripe.getStripe.mockReturnValue({ checkout: { sessions: { create } } })
    db.serviceInvoice.update.mockResolvedValue({})

    const r = await startServiceBalanceCheckout({
      invoice: { id: 'inv1', number: 'PRS-2026-00001' },
      balanceCents: 7000, balanceFeeCents: 350, prestataireAccountId: 'acct_p', origin: 'https://app.x',
    })
    expect(r.chargedCents).toBe(7000)
    const [params, opts] = create.mock.calls[0]
    expect(params.line_items[0].price_data.unit_amount).toBe(7000)
    expect(params.payment_intent_data.application_fee_amount).toBe(350)
    expect(params.payment_intent_data.metadata).toMatchObject({ serviceInvoiceId: 'inv1', grubano_channel: SERVICE_PAY_CHANNEL })
    expect(opts.idempotencyKey).toBe('service_pay_inv1')                            // SAME as the full completion → one charge per invoice
    expect(db.serviceInvoice.update.mock.calls[0][0]).toEqual({ where: { id: 'inv1' }, data: { stripeCheckoutSessionId: 'cs_bal' } })
  })
})

describe('applyServiceDepositPaid — idempotent (marks the MISSION, not the invoice)', () => {
  it('marks the deposit paid once via the status guard; a replay updates 0 rows', async () => {
    db.serviceMission.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    expect(await applyServiceDepositPaid('m1', 'pi_d')).toBe(1)
    expect(db.serviceMission.updateMany.mock.calls[0][0].where).toEqual({ id: 'm1', depositStatus: { not: 'paid' } })
    expect(db.serviceMission.updateMany.mock.calls[0][0].data).toMatchObject({ depositStatus: 'paid', depositStripePaymentIntentId: 'pi_d' })
    expect(await applyServiceDepositPaid('m1', 'pi_d')).toBe(0)
  })
  it('empty id → 0, no write', async () => {
    expect(await applyServiceDepositPaid('', null)).toBe(0)
    expect(db.serviceMission.updateMany).not.toHaveBeenCalled()
  })
})
