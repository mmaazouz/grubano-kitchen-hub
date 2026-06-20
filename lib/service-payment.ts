import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { computeServiceEconomics } from '@/lib/service-pricing'

// ── Service-mission invoice payment rail (Stripe Checkout, TEST — P8, Agent 81) ─
//
// A CLONE of lib/supply-payment (the supplier destination-charge), adapted to a 'done'
// mission's ServiceInvoice. It REUSES lib/stripe (getStripe) read-only and NEVER touches
// the B2C financial core, the supplier rail, or any other webhook. STRIPE TEST mode, gated
// upstream (double flag + mission 'done' + invoice issued & unpaid + prestataire payout-active).
// ⚠️ ALL amounts come from lib/service-pricing.computeServiceEconomics(invoice.amountCents) —
// NEVER a client-supplied amount, NEVER recomputed differently. A DESTINATION charge: the resto
// pays restaurantPaysCents (= the agreed quote), the prestataire NETS prestataireNetCents, and
// Grubano keeps grubanoMarginCents (5%) as the application_fee. P8 = payment-at-completion only.

export const SERVICE_PAY_CHANNEL = 'service_invoice'

// Stripe's minimum chargeable amount (EUR) — guard tiny/zero invoices.
export const MIN_SERVICE_CHARGE_CENTS = 50

/**
 * Create (idempotently) the Stripe Checkout session that charges the RESTO for an issued
 * ServiceInvoice and routes the payout to the PRESTATAIRE's Connect account. Amounts derive
 * EXCLUSIVELY from computeServiceEconomics(invoice.amountCents) (the agreed quote, stored
 * server-side) — the client never supplies an amount. Persists the pending Checkout session
 * reference. Returns the hosted-checkout URL. One session per invoice (idempotency key) → no
 * double charge; Stripe lets a session complete only once.
 */
export async function startServiceInvoiceCheckout(opts: {
  invoice: { id: string; number: string; amountCents: number }
  prestataireAccountId: string
  origin: string
}): Promise<{ url: string; sessionId: string; chargedCents: number }> {
  const eco = computeServiceEconomics(opts.invoice.amountCents)

  const piData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    transfer_data: { destination: opts.prestataireAccountId },
    on_behalf_of:  opts.prestataireAccountId,
    metadata:      { serviceInvoiceId: opts.invoice.id, grubano_channel: SERVICE_PAY_CHANNEL },
    // application_fee_amount omitted when 0 (Stripe rejects a 0 fee) → 100% transfers.
    ...(eco.grubanoMarginCents > 0 ? { application_fee_amount: eco.grubanoMarginCents } : {}),
  }

  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency:     'eur',
          unit_amount:  eco.restaurantPaysCents, // resto pays exactly this (server-derived, P6)
          product_data: { name: `Facture ${opts.invoice.number}` },
        },
      }],
      payment_intent_data: piData,
      metadata:    { serviceInvoiceId: opts.invoice.id, grubano_channel: SERVICE_PAY_CHANNEL },
      success_url: `${opts.origin}/marketplace/prestataire-missions?pay=success`,
      cancel_url:  `${opts.origin}/marketplace/prestataire-missions?pay=cancel`,
    },
    { idempotencyKey: `service_pay_${opts.invoice.id}` }, // one session per invoice (no double charge)
  )

  await prisma.serviceInvoice.update({
    where: { id: opts.invoice.id },
    data:  { stripeCheckoutSessionId: session.id },
  })

  return { url: session.url ?? '', sessionId: session.id, chargedCents: eco.restaurantPaysCents }
}

/**
 * Webhook: idempotently mark a ServiceInvoice PAID. The atomic status guard (status ≠ 'paid')
 * means a replayed event marks paid EXACTLY once (returns count 0 on replay / unknown invoice →
 * the caller no-ops). Best-effort; never throws. NO money math here — money already moved via the
 * destination charge; this only records the outcome.
 */
export async function applyServiceInvoicePaid(serviceInvoiceId: string, paymentIntentId: string | null): Promise<number> {
  if (!serviceInvoiceId) return 0
  try {
    const res = await prisma.serviceInvoice.updateMany({
      where: { id: serviceInvoiceId, status: { not: 'paid' } },
      data: {
        status: 'paid',
        paidAt: new Date(),
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      },
    })
    return res.count
  } catch (err) {
    console.error('[applyServiceInvoicePaid] non-fatal:', serviceInvoiceId, err instanceof Error ? err.message : err)
    return 0
  }
}
