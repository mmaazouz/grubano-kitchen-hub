import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import {
  createDepositHold, retrieveIntent, eurosToCents,
  mapPaymentIntentStatus, getPublishableKey,
  type DepositMetadata, type ConnectRouting,
} from '@/lib/stripe'

// Stripe SDK + session → Node runtime, never static.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_DEPOSIT_CENTS = 50 // Stripe minimum (~0.50 EUR)

function stripeError(err: unknown) {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
  }
  console.error('[deposit] stripe error', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Erreur paiement, réessayez.' }, { status: 502 })
}

// ── POST /api/reservations/[id]/deposit ───────────────────────────────────────
// Create (or reuse) the deposit pre-authorisation for a reservation. PUBLIC but
// gated by the non-guessable reservation cuid (consumer booking flow). The amount
// is ALWAYS read server-side from reservation.depositAmount — the client never
// sends an amount (anti-fraud). Returns the PaymentIntent client_secret + the
// publishable key so the front (Agent 13) can confirm the card with Stripe Elements.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, tableId: true, status: true,
        depositAmount: true, depositCurrency: true, depositStatus: true,
        stripePaymentIntentId: true,
      },
    })
    if (!reservation) {
      return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    }
    if (reservation.status === 'cancelled' || reservation.status === 'noshow') {
      return NextResponse.json({ error: 'Réservation clôturée.' }, { status: 400 })
    }
    if (!reservation.restaurantId) {
      return NextResponse.json({ error: 'Réservation sans établissement.' }, { status: 400 })
    }
    if (reservation.depositStatus === 'captured' || reservation.depositStatus === 'released') {
      return NextResponse.json({ error: 'Acompte déjà finalisé.' }, { status: 409 })
    }

    const currency = reservation.depositCurrency || 'eur'
    const amountCents = eurosToCents(reservation.depositAmount)
    if (amountCents < MIN_DEPOSIT_CENTS) {
      return NextResponse.json(
        { error: 'Aucun acompte configuré pour cette réservation.' },
        { status: 400 },
      )
    }

    const publishableKey = getPublishableKey()

    // Idempotent: reuse a still-usable PaymentIntent rather than stacking holds.
    if (reservation.stripePaymentIntentId) {
      try {
        const existing = await retrieveIntent(reservation.stripePaymentIntentId)
        if (existing.status !== 'canceled' && existing.client_secret) {
          return NextResponse.json({
            clientSecret: existing.client_secret, publishableKey, amount: amountCents, currency,
          })
        }
      } catch {
        // fall through and create a fresh PaymentIntent
      }
    }

    // ── Connect routing (rail A2) — 'reservation' channel, fee 0 (A0: a captured
    // no-show penalty goes 100 % to the resto). When the establishment's Express
    // account is active, the hold is a manual-capture DESTINATION charge: a later
    // capture lands on the resto's account; a release cancels as before. Any
    // other account state → the exact pre-A2 platform hold (full fallback).
    // NB: an EXISTING reused hold keeps the routing it was created with (its
    // amount never changes — reconciliation is a /pay concern, not a hold one).
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: reservation.restaurantId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    })
    const routed = !!(restaurant?.stripeAccountId && restaurant.stripeAccountStatus === 'active')
    const connect: ConnectRouting | undefined =
      routed ? { destination: restaurant!.stripeAccountId!, applicationFeeCents: 0 } : undefined

    const pi = await createDepositHold({
      amountCents,
      currency,
      metadata: {
        reservationId: reservation.id,
        restaurantId:  reservation.restaurantId,
        tableId:       reservation.tableId,
      } satisfies DepositMetadata,
      connect,
      extraMetadata: { grubano_channel: 'reservation', commission_rate: '0' },
      idempotencyKey: `deposit-${reservation.id}-${amountCents}-${reservation.stripePaymentIntentId ?? 'first'}`,
    })

    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { stripePaymentIntentId: pi.id, depositStatus: mapPaymentIntentStatus(pi.status), depositCurrency: currency },
    })

    return NextResponse.json(
      { clientSecret: pi.client_secret, publishableKey, amount: amountCents, currency },
      { status: 201 },
    )
  } catch (err) {
    return stripeError(err)
  }
}

// ── GET /api/reservations/[id]/deposit ────────────────────────────────────────
// Owner-scoped: the establishment reads the live deposit status (syncs from Stripe
// — e.g. once the card is authorised the PI is requires_capture → "authorized").
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, stripePaymentIntentId: true,
        depositStatus: true, depositAmount: true, depositCurrency: true,
      },
    })
    if (!reservation) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    if (!reservation.restaurantId || !scope.ownedIds.includes(reservation.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }

    let depositStatus = reservation.depositStatus
    let stripeStatus: string | null = null
    if (reservation.stripePaymentIntentId) {
      try {
        const pi = await retrieveIntent(reservation.stripePaymentIntentId)
        stripeStatus = pi.status
        const mapped = mapPaymentIntentStatus(pi.status)
        if (mapped !== 'none' && mapped !== depositStatus) {
          await prisma.reservation.update({ where: { id: reservation.id }, data: { depositStatus: mapped } })
          depositStatus = mapped
        }
      } catch {
        // keep the stored status on a transient Stripe error
      }
    }

    return NextResponse.json({
      depositStatus, stripeStatus,
      amount: eurosToCents(reservation.depositAmount), currency: reservation.depositCurrency,
    })
  } catch (err) {
    return stripeError(err)
  }
}
