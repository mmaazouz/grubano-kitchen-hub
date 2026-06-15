import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, mapAccountStatus } from '@/lib/stripe'
import { applySupplierAccountStatus } from '@/lib/supplier-connect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/webhooks/stripe-supplier — SEPARATE B2B Connect webhook (5b) ────
// Handles account.updated for SUPPLIER Express accounts ONLY, verified with its
// OWN secret (STRIPE_SUPPLIER_WEBHOOK_SECRET — a distinct Stripe endpoint). It
// NEVER touches the B2C webhook (/api/webhooks/stripe). No-ops for non-supplier
// accounts (updateMany matches 0 rows) and for any other event type.
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
    }
  } catch (err) {
    console.error('[stripe-supplier webhook]', err instanceof Error ? err.message : err)
    // Never 500 a webhook on a handler hiccup — Stripe would retry forever.
  }
  return NextResponse.json({ received: true })
}
