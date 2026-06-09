import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  createTicketPayment, retrieveIntent, eurosToCents, getPublishableKey,
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
        stripePaymentIntentId: true,
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

    const currency    = ticket.currency || 'eur'
    const amountCents  = eurosToCents(ticket.subtotal)
    if (ticket.subtotal <= 0 || amountCents < MIN_CHARGE_CENTS) {
      return NextResponse.json({ error: 'Addition vide ou montant trop faible.' }, { status: 400 })
    }

    const publishableKey = getPublishableKey()

    // Idempotent: reuse a still-usable PaymentIntent rather than stacking charges.
    // If a prior PI already succeeded, the bill is effectively paid (webhook lag) →
    // 409. A canceled PI falls through to create a fresh one.
    if (ticket.stripePaymentIntentId) {
      try {
        const existing = await retrieveIntent(ticket.stripePaymentIntentId)
        if (existing.status === 'succeeded') {
          return NextResponse.json({ error: 'Addition déjà payée.' }, { status: 409 })
        }
        if (existing.status !== 'canceled' && existing.client_secret) {
          return NextResponse.json({
            clientSecret: existing.client_secret, publishableKey, amount: amountCents, currency,
          })
        }
      } catch {
        // fall through and create a fresh PaymentIntent
      }
    }

    const pi = await createTicketPayment({
      amountCents,
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
      { clientSecret: pi.client_secret, publishableKey, amount: amountCents, currency },
      { status: 201 },
    )
  } catch (err) {
    return stripeError(err)
  }
}
