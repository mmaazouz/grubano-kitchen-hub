import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getStripe, type DepositStatus } from '@/lib/stripe'

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// Stripe pushes PaymentIntent lifecycle events here so the deposit empreinte
// status is synced RELIABLY in the DB — instead of only at read (GET /deposit) or
// at an operator action (capture/release). This removes the root cause of the
// "Mourad" bug: depositStatus used to stay 'none' after the customer confirmed
// their card, so the dashboard never showed the right buttons.
//
// SECURITY: a webhook MUST be public (Stripe calls it with no session). The trust
// comes from VERIFYING THE SIGNATURE, not from auth. /api/* is already excluded
// from middleware.ts (its matcher skips `api`), so this route is public by
// default — same as /api/reservations/public and /api/t/[id]. No middleware
// change is required.
//
// Node runtime + the RAW body are REQUIRED for signature verification (the bytes
// must be untouched — never JSON-parsed before constructEvent). Never static.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Terminal deposit states: once the hold is settled (money captured, or released
// with nothing charged), a late/duplicated event must NEVER regress it back to
// 'authorized'. This is the ordering guard that keeps the webhook idempotent.
const TERMINAL = new Set<DepositStatus>(['captured', 'released'])

// The 3 subscribed PaymentIntent events → our coarse depositStatus.
const EVENT_TO_STATUS: Record<string, DepositStatus> = {
  'payment_intent.amount_capturable_updated': 'authorized', // card authorised (manual-capture hold is live)
  'payment_intent.canceled':                  'released',    // hold cancelled — nothing charged
  'payment_intent.succeeded':                 'captured',    // captured (no-show penalty taken, or bill paid)
}

export async function POST(req: Request) {
  // 1) RAW body + signature header — both mandatory for constructEvent. Read the
  //    untouched text; do NOT req.json() first or the signature won't match.
  const rawBody   = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    // Misconfiguration (not a client fault). 500 so Stripe retries once the
    // secret is set, rather than silently swallowing events.
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET missing')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // 2) Verify the signature — this is what proves the call really came from
  //    Stripe. Tampered / forged payloads throw → 400 (rejected).
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // 3) Only the three deposit-lifecycle events are actioned; anything else is
  //    acknowledged with 200 so Stripe stops retrying it.
  const target = EVENT_TO_STATUS[event.type]
  if (!target) {
    return NextResponse.json({ received: true, ignored: event.type })
  }

  const pi            = event.data.object as Stripe.PaymentIntent
  const reservationId = pi.metadata?.reservationId || null

  try {
    // Find the reservation by the reliable metadata id (set at hold creation by
    // /api/reservations/[id]/deposit), falling back to the stored PaymentIntent id.
    const reservation = reservationId
      ? await prisma.reservation.findUnique({
          where:  { id: reservationId },
          select: { id: true, depositStatus: true, stripePaymentIntentId: true },
        })
      : await prisma.reservation.findFirst({
          where:  { stripePaymentIntentId: pi.id },
          select: { id: true, depositStatus: true, stripePaymentIntentId: true },
        })

    // Out-of-scope PaymentIntent (no matching reservation, e.g. another flow or
    // environment) → 200 + log. NEVER fail the webhook for a PI we don't own.
    if (!reservation) {
      console.warn(`[stripe webhook] ${event.type} for ${pi.id} — no matching reservation (reservationId=${reservationId ?? 'none'})`)
      return NextResponse.json({ received: true, matched: false })
    }

    const current = reservation.depositStatus as DepositStatus

    // 4) Idempotence + ordering guards:
    //    - already at target            → no-op (event replayed by Stripe).
    //    - 'authorized' but already terminal → skip (a late authorise event must
    //      not regress a hold that's already captured/released).
    //    - both terminal but different  → keep current + warn (a hold can't be
    //      both captured AND released; trust the real first settlement).
    if (current === target) {
      return NextResponse.json({ received: true, status: current, noop: true })
    }
    if (target === 'authorized' && TERMINAL.has(current)) {
      return NextResponse.json({ received: true, status: current, skipped: 'already_settled' })
    }
    if (TERMINAL.has(target) && TERMINAL.has(current)) {
      console.warn(`[stripe webhook] ${event.type}: refusing ${current}→${target} on reservation ${reservation.id}`)
      return NextResponse.json({ received: true, status: current, skipped: 'terminal_conflict' })
    }

    // 5) Apply. 'captured' also sets depositPaid (a real charge happened).
    //    Backfill stripePaymentIntentId if the row never stored it.
    const data: Prisma.ReservationUpdateInput = { depositStatus: target }
    if (target === 'captured')              data.depositPaid = true
    if (!reservation.stripePaymentIntentId) data.stripePaymentIntentId = pi.id

    await prisma.reservation.update({ where: { id: reservation.id }, data })

    return NextResponse.json({ received: true, status: target })
  } catch (err) {
    // DB error → 500 so Stripe retries; re-application is idempotent (guards above).
    console.error('[stripe webhook] handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}
