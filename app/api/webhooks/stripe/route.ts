import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getStripe, type DepositStatus } from '@/lib/stripe'
import { releaseHold } from '@/lib/deposit'

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// Stripe pushes PaymentIntent lifecycle events here so payment state is synced
// RELIABLY in the DB. Two distinct flows share this endpoint, told apart by the
// PaymentIntent metadata:
//
//   • RESERVATION EMPREINTE (manual-capture hold) — metadata.reservationId, NO
//     ticketId. Maps amount_capturable_updated→authorized, canceled→released,
//     succeeded→captured. (Removes the root cause of the "Mourad" bug where
//     depositStatus stayed 'none' after the card was confirmed.)
//   • BILL PAYMENT (automatic-capture real charge, Brique 2) — metadata.ticketId.
//     On succeeded → mark the TableTicket paid AND auto-release the linked
//     reservation's empreinte (Mohammed's rule: never charge the meal AND keep
//     the guarantee held).
//
// SECURITY: a webhook MUST be public (Stripe calls it with no session). Trust comes
// from VERIFYING THE SIGNATURE, not from auth. /api/* is excluded from the
// middleware matcher, so this route is public by default. Node runtime + RAW body
// are REQUIRED for signature verification (never JSON-parse before constructEvent).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Terminal deposit states: once a hold is settled (captured, or released with
// nothing charged), a late/duplicated event must NEVER regress it to 'authorized'.
const TERMINAL = new Set<DepositStatus>(['captured', 'released'])

// Empreinte (manual-capture) PaymentIntent events → coarse depositStatus.
const EVENT_TO_STATUS: Record<string, DepositStatus> = {
  'payment_intent.amount_capturable_updated': 'authorized', // card authorised (hold is live)
  'payment_intent.canceled':                  'released',    // hold cancelled — nothing charged
  'payment_intent.succeeded':                 'captured',    // captured (no-show penalty taken)
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
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET missing')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // 2) Verify the signature — proves the call really came from Stripe. Tampered /
  //    forged payloads throw → 400 (rejected).
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const pi = event.data.object as Stripe.PaymentIntent

  // 3a) BILL PAYMENT branch — a succeeded PI carrying a ticketId is a real bill
  //     charge (NOT an empreinte). Checked FIRST so it never falls into the
  //     deposit mapping below (a bill PI may also carry reservationId).
  if (event.type === 'payment_intent.succeeded' && pi.metadata?.ticketId) {
    return handleTicketPaid(pi)
  }

  // 3b) EMPREINTE branch — only the three deposit-lifecycle events are actioned;
  //     anything else is acknowledged with 200 so Stripe stops retrying.
  const target = EVENT_TO_STATUS[event.type]
  if (!target) {
    return NextResponse.json({ received: true, ignored: event.type })
  }

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

    // Out-of-scope PaymentIntent (no matching reservation) → 200 + log. NEVER
    // fail the webhook for a PI we don't own.
    if (!reservation) {
      console.warn(`[stripe webhook] ${event.type} for ${pi.id} — no matching reservation (reservationId=${reservationId ?? 'none'})`)
      return NextResponse.json({ received: true, matched: false })
    }

    const current = reservation.depositStatus as DepositStatus

    // Idempotence + ordering guards (replayed / late events).
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

    // Apply. 'captured' also sets depositPaid (a real charge happened). Backfill
    // stripePaymentIntentId if the row never stored it.
    const data: Prisma.ReservationUpdateInput = { depositStatus: target }
    if (target === 'captured')              data.depositPaid = true
    if (!reservation.stripePaymentIntentId) data.stripePaymentIntentId = pi.id

    await prisma.reservation.update({ where: { id: reservation.id }, data })

    return NextResponse.json({ received: true, status: target })
  } catch (err) {
    console.error('[stripe webhook] handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

// ── Bill paid → mark ticket paid + auto-release the reservation empreinte ──────
async function handleTicketPaid(pi: Stripe.PaymentIntent) {
  const ticketId = pi.metadata?.ticketId
  if (!ticketId) return NextResponse.json({ received: true }) // defensive (checked by caller)

  try {
    const ticket = await prisma.tableTicket.findUnique({
      where:  { id: ticketId },
      select: { id: true, status: true, reservationId: true },
    })
    if (!ticket) {
      console.warn(`[stripe webhook] bill paid for ${pi.id} — ticket ${ticketId} not found`)
      return NextResponse.json({ received: true, matched: false })
    }

    // 1) Mark the ticket paid (idempotent: skip if already paid).
    if (ticket.status !== 'paid') {
      const amountPaid = (pi.amount_received ?? pi.amount ?? 0) / 100
      await prisma.tableTicket.update({
        where: { id: ticket.id },
        data:  {
          status:                'paid',
          paidAt:                new Date(),
          amountPaid,
          stripePaymentIntentId: pi.id,
        },
      })
    }

    // 2) CRITICAL (Mohammed): paying the bill AUTO-releases the reservation's
    //    guarantee empreinte. The empreinte PI (manual capture) is
    //    reservation.stripePaymentIntentId — DISTINCT from this bill PI (pi.id).
    //    releaseHold reads the live empreinte PI and cancels it (nothing charged).
    //    Idempotent: skip when already released/captured (don't regress).
    let depositReleased: string | null = null
    if (ticket.reservationId) {
      const reservation = await prisma.reservation.findUnique({
        where:  { id: ticket.reservationId },
        select: { id: true, depositStatus: true, stripePaymentIntentId: true },
      })
      if (
        reservation?.stripePaymentIntentId &&
        reservation.depositStatus !== 'released' &&
        reservation.depositStatus !== 'captured'
      ) {
        const settle = await releaseHold(reservation.stripePaymentIntentId)
        if (settle.ok) {
          await prisma.reservation.update({
            where: { id: reservation.id },
            data:  { depositStatus: settle.depositStatus ?? 'released' },
          })
          depositReleased = settle.depositStatus ?? 'released'
        } else {
          // e.g. already captured (shouldn't happen if they paid) — log, never fail.
          console.warn(`[stripe webhook] ticket ${ticket.id}: empreinte release skipped (${settle.status}: ${settle.error})`)
        }
      }
    }

    return NextResponse.json({ received: true, ticket: 'paid', depositReleased })
  } catch (err) {
    console.error('[stripe webhook] bill paid handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}
