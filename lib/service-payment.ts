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

// P8c — the DEPOSIT (acompte) charge channel, distinct from the completion/balance ('service_invoice').
// The webhook routes a 'service_deposit' session to the deposit handler (marks the deposit paid, NOT
// the invoice); a 'service_invoice' session marks the invoice paid (= the balance/completion settled).
export const SERVICE_DEPOSIT_CHANNEL = 'service_deposit'

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

// ── P8c — DEPOSIT (acompte) + BALANCE (solde) destination charges (TEST) ────────
// The deposit + the balance are TWO destination charges against the SAME ServiceInvoice. The
// amount + application_fee of EACH are passed in EXPLICITLY by the caller (the route, from the PURE
// lib/service-deposit.computeDepositSplit) — this module NEVER recomputes the split. The two fees
// re-add to the commission on the WHOLE quote (the balance fee absorbs the rounding). ⚠️ NO amount
// is ever client-supplied. startServiceInvoiceCheckout above is UNCHANGED (it is still used for the
// FORFAIT and for the depositPct=0 completion, so those paths stay byte-identical).

/** Shared Stripe-Checkout factory for a service DESTINATION charge with an EXPLICIT amount + fee.
 *  Mirrors startServiceInvoiceCheckout's session shape; the amount/fee are server-derived by the
 *  caller and trusted here as-is (the fee is omitted when 0 — Stripe rejects a 0 fee). */
async function createServiceDestinationCheckout(opts: {
  amountCents: number
  applicationFeeCents: number
  prestataireAccountId: string
  metadata: Record<string, string>
  label: string
  idempotencyKey: string
  origin: string
}): Promise<{ url: string; sessionId: string }> {
  const piData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    transfer_data: { destination: opts.prestataireAccountId },
    on_behalf_of:  opts.prestataireAccountId,
    metadata:      opts.metadata,
    ...(opts.applicationFeeCents > 0 ? { application_fee_amount: opts.applicationFeeCents } : {}),
  }
  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: { currency: 'eur', unit_amount: opts.amountCents, product_data: { name: opts.label } },
      }],
      payment_intent_data: piData,
      metadata:    opts.metadata,
      success_url: `${opts.origin}/marketplace/prestataire-missions?pay=success`,
      cancel_url:  `${opts.origin}/marketplace/prestataire-missions?pay=cancel`,
    },
    { idempotencyKey: opts.idempotencyKey },
  )
  return { url: session.url ?? '', sessionId: session.id }
}

/** Charge the DEPOSIT (acompte) for a mission, at acceptance. One session per invoice
 *  (service_deposit_<invoiceId>) → no double deposit. Persists the deposit sub-state on the
 *  MISSION ('pending' until the webhook confirms 'paid'). The ServiceInvoice stays 'issued'. */
export async function startServiceDepositCheckout(opts: {
  missionId: string
  invoice: { id: string; number: string }
  depositCents: number
  depositFeeCents: number
  prestataireAccountId: string
  origin: string
}): Promise<{ url: string; sessionId: string; chargedCents: number }> {
  const { url, sessionId } = await createServiceDestinationCheckout({
    amountCents:          opts.depositCents,
    applicationFeeCents:  opts.depositFeeCents,
    prestataireAccountId: opts.prestataireAccountId,
    metadata:             { serviceMissionId: opts.missionId, serviceInvoiceId: opts.invoice.id, grubano_channel: SERVICE_DEPOSIT_CHANNEL },
    label:                `Acompte facture ${opts.invoice.number}`,
    idempotencyKey:       `service_deposit_${opts.invoice.id}`,
    origin:               opts.origin,
  })
  await prisma.serviceMission.update({
    where: { id: opts.missionId },
    data:  { depositStatus: 'pending', depositPaidCents: opts.depositCents, depositStripeSessionId: sessionId },
  })
  return { url, sessionId, chargedCents: opts.depositCents }
}

/** Charge the BALANCE (solde) for a mission whose deposit was paid, at completion. Channel +
 *  idempotency key are the SAME as the full-completion charge (service_invoice / service_pay_<id>),
 *  so the webhook marks the invoice 'paid' and one invoice is completed exactly once. */
export async function startServiceBalanceCheckout(opts: {
  invoice: { id: string; number: string }
  balanceCents: number
  balanceFeeCents: number
  prestataireAccountId: string
  origin: string
}): Promise<{ url: string; sessionId: string; chargedCents: number }> {
  const { url, sessionId } = await createServiceDestinationCheckout({
    amountCents:          opts.balanceCents,
    applicationFeeCents:  opts.balanceFeeCents,
    prestataireAccountId: opts.prestataireAccountId,
    metadata:             { serviceInvoiceId: opts.invoice.id, grubano_channel: SERVICE_PAY_CHANNEL },
    label:                `Solde facture ${opts.invoice.number}`,
    idempotencyKey:       `service_pay_${opts.invoice.id}`,
    origin:               opts.origin,
  })
  await prisma.serviceInvoice.update({
    where: { id: opts.invoice.id },
    data:  { stripeCheckoutSessionId: sessionId },
  })
  return { url, sessionId, chargedCents: opts.balanceCents }
}

/** Webhook: idempotently mark a mission's DEPOSIT paid. Atomic guard (depositStatus ≠ 'paid')
 *  → a replay marks paid exactly once. Does NOT touch the ServiceInvoice (the invoice flips 'paid'
 *  only after the BALANCE). Best-effort; never throws. NO money math here. */
export async function applyServiceDepositPaid(serviceMissionId: string, paymentIntentId: string | null): Promise<number> {
  if (!serviceMissionId) return 0
  try {
    const res = await prisma.serviceMission.updateMany({
      where: { id: serviceMissionId, depositStatus: { not: 'paid' } },
      data: {
        depositStatus: 'paid',
        ...(paymentIntentId ? { depositStripePaymentIntentId: paymentIntentId } : {}),
      },
    })
    return res.count
  } catch (err) {
    console.error('[applyServiceDepositPaid] non-fatal:', serviceMissionId, err instanceof Error ? err.message : err)
    return 0
  }
}
