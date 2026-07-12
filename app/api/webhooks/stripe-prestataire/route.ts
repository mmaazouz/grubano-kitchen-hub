import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, mapAccountStatus } from '@/lib/stripe'
import { isPrestataireConnectLive, applyPrestataireAccountStatus } from '@/lib/prestataire-connect'
import { applyServiceInvoicePaid, applyServiceDepositPaid, SERVICE_PAY_CHANNEL, SERVICE_DEPOSIT_CHANNEL } from '@/lib/service-payment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/webhooks/stripe-prestataire — SEPARATE services webhook (P7 + P8) ─
// CLONE of /api/webhooks/stripe-supplier. P7: account.updated → prestataire KYB status. P8:
// checkout.session.completed → mark the service invoice PAID (idempotent). PRESTATAIRE Express
// accounts / service-invoice payments ONLY, verified with its OWN secret
// (STRIPE_PRESTATAIRE_WEBHOOK_SECRET — a DISTINCT Stripe endpoint). It NEVER touches the B2C
// webhook (/api/webhooks/stripe) nor the supplier webhook (/api/webhooks/stripe-supplier).
// DOUBLE-FLAG gated → 404 when OFF. No-ops for non-prestataire accounts / non-service sessions /
// any other event type.
export async function POST(req: Request) {
  // Double-flag gate (default CLOSED): OFF → the endpoint does not exist, no work done.
  if (!isPrestataireConnectLive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const secret = process.env.STRIPE_PRESTATAIRE_WEBHOOK_SECRET
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
      await applyPrestataireAccountStatus(account.id, mapAccountStatus(account))
    } else if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const channel = session.metadata?.grubano_channel
      const piId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null
      if (channel === SERVICE_DEPOSIT_CHANNEL && session.metadata?.serviceMissionId) {
        // P8c — a DEPOSIT (acompte) completed. Marks the deposit paid on the mission, NOT the
        // invoice (the invoice flips 'paid' only after the balance). Idempotent; no-op otherwise.
        await applyServiceDepositPaid(session.metadata.serviceMissionId, piId)
      } else if (channel === SERVICE_PAY_CHANNEL && session.metadata?.serviceInvoiceId) {
        // P8 — a service-invoice payment completed (full quote, or the balance after a deposit).
        // Idempotent mark-paid; no-op for any non-service session. UNCHANGED from P8.
        await applyServiceInvoicePaid(session.metadata.serviceInvoiceId, piId)
      }
    }
  } catch (err) {
    console.error('[stripe-prestataire webhook]', err instanceof Error ? err.message : err)
    // Never 500 a webhook on a handler hiccup — Stripe would retry forever.
  }
  return NextResponse.json({ received: true })
}
