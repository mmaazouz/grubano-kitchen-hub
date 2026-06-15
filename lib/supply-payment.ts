import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { computeSupplyEconomics } from '@/lib/supply-pricing'

// ── B2B supply order payment rail (Stripe Checkout, TEST — Slice 5c, Agent 14) ─
//
// A SEPARATE B2B path that REUSES lib/stripe (getStripe) read-only and NEVER
// touches the B2C financial core or its webhook. STRIPE TEST mode, gated upstream
// (flag + supplier payoutStatus='active' + immatriculation). ALL amounts come
// from lib/supply-pricing.computeSupplyEconomics — NEVER a client-supplied amount,
// NEVER recomputed here. A destination charge: the resto pays restoPaysCents, the
// supplier nets supplierPayoutCents, Grubano keeps grubanoMarginCents (application_fee).

export const SUPPLY_PAY_CHANNEL = 'b2b_supply'

// Stripe's minimum chargeable amount (EUR) — guard tiny/zero orders.
export const MIN_SUPPLY_CHARGE_CENTS = 50

/**
 * Create (idempotently) the Stripe Checkout session that charges the resto for a
 * confirmed supply order and routes the payout to the supplier's Connect account.
 * Amounts derive EXCLUSIVELY from computeSupplyEconomics(order.totalCents). Persists
 * the pending payment + the economics snapshot. Returns the hosted-checkout URL.
 */
export async function startSupplyOrderCheckout(opts: {
  order: { id: string; totalCents: number }
  supplierAccountId: string
  origin: string
}): Promise<{ url: string; sessionId: string; chargedCents: number }> {
  const eco = computeSupplyEconomics({ baseCents: opts.order.totalCents })

  const piData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    transfer_data: { destination: opts.supplierAccountId },
    on_behalf_of:  opts.supplierAccountId,
    metadata:      { supplyOrderId: opts.order.id, grubano_channel: SUPPLY_PAY_CHANNEL },
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
          unit_amount:  eco.restoPaysCents, // resto pays exactly this (from 5a)
          product_data: { name: `Commande fournisseur ${opts.order.id.slice(-6).toUpperCase()}` },
        },
      }],
      payment_intent_data: piData,
      metadata:    { supplyOrderId: opts.order.id, grubano_channel: SUPPLY_PAY_CHANNEL },
      success_url: `${opts.origin}/marketplace/orders?pay=success`,
      cancel_url:  `${opts.origin}/marketplace/orders?pay=cancel`,
    },
    { idempotencyKey: `supply_pay_${opts.order.id}` }, // one session per order (no double charge)
  )

  await prisma.supplyOrder.update({
    where: { id: opts.order.id },
    data: {
      paymentStatus:           'pending',
      stripeCheckoutSessionId: session.id,
      chargedCents:            eco.restoPaysCents,
      supplierPayoutCents:     eco.supplierPayoutCents,
      grubanoMarginCents:      eco.grubanoMarginCents,
    },
  })

  return { url: session.url ?? '', sessionId: session.id, chargedCents: eco.restoPaysCents }
}

/**
 * Webhook: idempotently mark a supply order PAID. The atomic status guard
 * (paymentStatus ≠ 'paid') means a replayed event marks paid exactly once (returns
 * count 0 on replay / unknown order → caller no-ops). Best-effort; never throws.
 */
export async function applySupplyOrderPaid(supplyOrderId: string, paymentIntentId: string | null): Promise<number> {
  if (!supplyOrderId) return 0
  try {
    const res = await prisma.supplyOrder.updateMany({
      where: { id: supplyOrderId, paymentStatus: { not: 'paid' } },
      data: {
        paymentStatus: 'paid',
        paidAt:        new Date(),
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      },
    })
    return res.count
  } catch (err) {
    console.error('[applySupplyOrderPaid] non-fatal:', supplyOrderId, err instanceof Error ? err.message : err)
    return 0
  }
}
