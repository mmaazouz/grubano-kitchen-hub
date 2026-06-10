import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  createTicketPayment, retrieveIntent, eurosToCents, getPublishableKey,
  updateIntentAmount, cancelIntent,
} from '@/lib/stripe'

// Stripe SDK → Node runtime, never static.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_CHARGE_CENTS = 50 // Stripe minimum (~0.50 EUR)

function stripeError(err: unknown) {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
  }
  console.error('[ticket pay] stripe error', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Erreur paiement, réessayez.' }, { status: 502 })
}

// ── POST /api/tickets/[id]/pay ────────────────────────────────────────────────
// Create (or reuse) the bill PaymentIntent for a table ticket. PUBLIC but gated
// by the non-guessable ticket cuid (the QR page resolves the ticket id from
// /api/t/[tableId]/ticket; the consumer app from the reservation's table). The
// amount is ALWAYS read server-side from ticket.subtotal — the client NEVER sends
// an amount (anti-fraud). Returns the client_secret + publishable key so the front
// (Agent 13) confirms the card with Stripe Elements.
//
// This is the FIRST REAL CHARGE on Grubano: capture is AUTOMATIC (immediate debit),
// not the manual-capture reservation empreinte. Commission is 0 during TEST
// (platformFeeAmount stays 0; no Connect → the whole amount lands on the platform
// account). On payment success the webhook marks the ticket paid AND releases the
// linked reservation's empreinte automatically.
// PAYMENT IS OPEN (Mohammed's decision): anyone may settle a bill — the client from
// their account, a QR walk-in, or a friend via a shared link (the bill-sharing
// model). We do NOT check identity. The ONLY gate (besides paid / void / amount) is
// a time window: a ticket tied to a reservation is payable once the restaurant has
// marked that reservation 'arrived'; a walk-in ticket (no reservation) is payable as
// soon as it is open. The QR walk-in channel is unchanged.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const ticket = await prisma.tableTicket.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, reservationId: true,
        status: true, currency: true, subtotal: true,
        stripePaymentIntentId: true, amountPaid: true,
      },
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    }
    if (ticket.status === 'paid') {
      return NextResponse.json({ error: 'Addition déjà payée.' }, { status: 409 })
    }
    if (ticket.status === 'void') {
      return NextResponse.json({ error: 'Addition annulée.' }, { status: 400 })
    }

    // ── Payment window (NO identity check — payment is open to anyone) ──────────
    // A ticket tied to a reservation can only be paid once the restaurant marked
    // that reservation 'arrived'. A walk-in ticket (no reservation) is payable as
    // soon as it is open. A stale link (reservationId set but the row is gone)
    // degrades to "payable" rather than blocking. Applies to BOTH channels (QR + app).
    if (ticket.reservationId) {
      const reservation = await prisma.reservation.findUnique({
        where:  { id: ticket.reservationId },
        select: { status: true },
      })
      if (reservation && reservation.status !== 'arrived') {
        return NextResponse.json(
          { error: 'Le restaurant doit valider votre arrivée avant le paiement.', code: 'not_arrived' },
          { status: 409 },
        )
      }
    }

    const currency = ticket.currency || 'eur'

    // ── Amount DUE, recomputed server-side on EVERY call (the money-bug fix) ────
    // The bill is a LIVE document: lines can land between opening the payment
    // screen and confirming the card. The charge must always be the CURRENT
    // subtotal minus what was already collected (amountPaid covers a past partial
    // payment recorded by the webhook safety-net). All maths in integer cents.
    const subtotalCents = eurosToCents(ticket.subtotal)
    const paidCents     = eurosToCents(ticket.amountPaid ?? 0)
    const dueCents      = subtotalCents - paidCents
    if (ticket.subtotal <= 0) {
      return NextResponse.json({ error: 'Addition vide ou montant trop faible.' }, { status: 400 })
    }
    if (dueCents <= 0) {
      // Everything is collected — only the webhook lag separates us from 'paid'.
      return NextResponse.json({ error: 'Addition déjà payée.' }, { status: 409 })
    }
    if (dueCents < MIN_CHARGE_CENTS) {
      // A sub-0.50€ remainder can't go through Stripe — settle it off-platform.
      return NextResponse.json(
        { error: 'Reste dû trop faible pour un paiement carte — à régler sur place.', code: 'remainder_too_small' },
        { status: 400 },
      )
    }

    const publishableKey = getPublishableKey()

    // Idempotent reuse of the stored PaymentIntent, but NEVER with a stale amount:
    //   • succeeded + still due > 0 → a PAST PARTIAL payment (pre-guard bug or
    //     mid-meal payment): fall through and create a NEW PI for the REMAINDER.
    //   • usable + amount matches dueCents → return as-is.
    //   • usable + amount STALE → paymentIntents.update (requires_payment_method /
    //     requires_confirmation); if Stripe refuses (e.g. requires_action), cancel
    //     it and fall through to a fresh PI — never leave an orphan payable at the
    //     wrong amount. 'processing' can be neither updated nor cancelled: return
    //     it untouched (the webhook at-cent guard is the safety net).
    if (ticket.stripePaymentIntentId) {
      try {
        const existing = await retrieveIntent(ticket.stripePaymentIntentId)
        if (existing.status !== 'succeeded' && existing.status !== 'canceled' && existing.client_secret) {
          if (existing.amount === dueCents) {
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: dueCents, currency,
            })
          }
          if (existing.status === 'processing') {
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: existing.amount, currency,
            })
          }
          try {
            const updated = await updateIntentAmount(existing.id, dueCents)
            return NextResponse.json({
              clientSecret: updated.client_secret, publishableKey, amount: dueCents, currency,
            })
          } catch {
            // Not updatable in this state → cancel (best-effort) + recreate below.
            try { await cancelIntent(existing.id) } catch {
              console.warn(`[ticket pay] could not cancel stale PI ${existing.id} (ticket ${ticket.id})`)
            }
          }
        }
        // succeeded with due > 0, or canceled → fall through to a fresh PI.
      } catch {
        // fall through and create a fresh PaymentIntent
      }
    }

    const pi = await createTicketPayment({
      amountCents: dueCents,
      currency,
      metadata: {
        ticketId:      ticket.id,
        restaurantId:  ticket.restaurantId,
        ...(ticket.reservationId ? { reservationId: ticket.reservationId } : {}),
      },
    })

    // Persist the PI id so the webhook can match it and /pay is idempotent.
    await prisma.tableTicket.update({
      where: { id: ticket.id },
      data:  { stripePaymentIntentId: pi.id },
    })

    return NextResponse.json(
      { clientSecret: pi.client_secret, publishableKey, amount: dueCents, currency },
      { status: 201 },
    )
  } catch (err) {
    return stripeError(err)
  }
}
