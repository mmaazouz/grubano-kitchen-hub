import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, mapAccountStatus } from '@/lib/stripe'
import { applySupplierAccountStatus } from '@/lib/supplier-connect'
import { applySupplyOrderPaid, SUPPLY_PAY_CHANNEL } from '@/lib/supply-payment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/webhooks/stripe-supplier — SEPARATE B2B webhook (5b + 5c) ───────
// 5b: account.updated → supplier KYB status. 5c: checkout.session.completed →
// mark the supply order PAID (idempotent). SUPPLIER Express accounts / B2B supply
// payments ONLY, verified with its OWN secret (STRIPE_SUPPLIER_WEBHOOK_SECRET — a
// distinct Stripe endpoint). It NEVER touches the B2C webhook (/api/webhooks/stripe).
// No-ops for non-supplier accounts / non-B2B sessions / any other event type.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'webhook_not_configured' }, { status: 400 })

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    const raw = await req.text()
    event = getStripe().webhooks.constructEvent(raw, sig, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account
      await applySupplierAccountStatus(account.id, mapAccountStatus(account))
    } else if (event.type === 'checkout.session.completed') {
      // 5c — a B2B supply-order payment completed. Idempotent mark-paid; no-op for
      // any non-B2B session (different grubano_channel / missing supplyOrderId).
      const session = event.data.object as Stripe.Checkout.Session
      if (session.metadata?.grubano_channel === SUPPLY_PAY_CHANNEL && session.metadata?.supplyOrderId) {
        const piId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null
        await applySupplyOrderPaid(session.metadata.supplyOrderId, piId)
      }
    }
  } catch (err) {
    console.error('[stripe-supplier webhook]', err instanceof Error ? err.message : err)
    // Never 500 a webhook on a handler hiccup — Stripe would retry forever.
  }
  return NextResponse.json({ received: true })
}
