import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import {
  createTicketPayment, retrieveIntent, eurosToCents, getPublishableKey,
  updateIntentAmount, cancelIntent, type ConnectRouting,
} from '@/lib/stripe'
import { computeApplicationFee, resolveCommissionRate } from '@/lib/commission'
import { isPlatformFallbackAllowed } from '@/lib/connect-gate'
import { isDineInServiceEnabled, dineInServiceCents } from '@/lib/dinein-service'

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
// not the manual-capture reservation empreinte. Routing (rail A2): when the
// establishment's Connect account is ACTIVE the PI is a destination charge — the
// resto receives the net and Grubano's commission (lib/commission, 'dinein' 5 %
// by default) is taken at the source via application_fee_amount; otherwise the
// charge stays fully on the platform account exactly as before A2 (fallback).
// On payment success the webhook marks the ticket paid AND releases the linked
// reservation's empreinte automatically.
// PAYMENT IS OPEN (Mohammed's decision): anyone may settle a bill — the client from
// their account, a QR walk-in, or a friend via a shared link (the bill-sharing
// model). We do NOT check identity. The ONLY gate (besides paid / void / amount) is
// a time window: a ticket tied to a reservation is payable once the restaurant has
// marked that reservation 'arrived'; a walk-in ticket (no reservation) is payable as
// soon as it is open. The QR walk-in channel is unchanged.
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const limited = rateLimit(req, 'ticket_pay', { limitDefault: 30, windowDefault: 60 })
    if (limited) return limited

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

    // ── G1 — DINE-IN SERVICE CHARGE (resto-bound, mirrors the delivery fee) ─────
    // Flag + per-resto rate gated. With DINEIN_SERVICE_ENABLED OFF (or the rate
    // null/0) serviceCents is ALWAYS 0 → every line below (dueCents, the bill
    // total, the application_fee, the ledger) is BYTE-IDENTICAL to pre-G1. The
    // service is added to the bill TOTAL (subtotal + service) and flows to the
    // resto net — it is NEVER part of the commission base (see the fee below).
    // Guarded read so a deploy BEFORE the db push (column absent) degrades to 0.
    let dineInServiceRatePct = 0
    if (isDineInServiceEnabled()) {
      try {
        // dineInServiceRatePct is added by the central G1 schema merge and is
        // absent from the generated Prisma type until the client is regenerated, so
        // the select goes through `as any` (no-explicit-any is not enabled in this
        // project's eslint config). The try/catch ALSO tolerates the column being
        // absent at RUNTIME (deploy before the db push) → degrades to 0 (inert).
        const r = await prisma.restaurant.findUnique({
          where:  { id: ticket.restaurantId },
          select: { dineInServiceRatePct: true } as any,
        }) as { dineInServiceRatePct: number | null } | null
        dineInServiceRatePct = r?.dineInServiceRatePct ?? 0
      } catch { /* column missing pre-db-push → 0 (inert) */ }
    }

    // ── Amount DUE, recomputed server-side on EVERY call (the money-bug fix) ────
    // The bill is a LIVE document: lines can land between opening the payment
    // screen and confirming the card. The charge must always be the CURRENT
    // bill total minus what was already collected (amountPaid covers a past
    // partial payment recorded by the webhook safety-net). All maths in integer
    // cents. G1: the bill total = food subtotal + service; the service is owed
    // ONCE over the whole bill, so a partial payment draws down the SAME total —
    // dueCents = (subtotal + service) − amountPaid. The food portion still owed
    // (foodDueCents) drives the commission base only (the service is excluded).
    const subtotalCents = eurosToCents(ticket.subtotal)
    const paidCents     = eurosToCents(ticket.amountPaid ?? 0)
    const serviceCents  = dineInServiceCents(subtotalCents, dineInServiceRatePct) // 0 when flag off / rate 0
    const billTotalCents = subtotalCents + serviceCents
    const dueCents      = billTotalCents - paidCents
    // Food still owed (for the commission base): the food is settled FIRST as the
    // bill is drawn down — clamped to [0, dueCents]. When serviceCents is 0 this is
    // exactly dueCents → the fee base below is byte-identical to pre-G1.
    const foodDueCents  = Math.min(dueCents, Math.max(0, subtotalCents - paidCents))
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

    // ── Connect routing (rail financier A2) — table bill = 'dinein' channel ─────
    // Routed ONLY when the establishment's Express account is fully active; any
    // other state (none/pending/restricted) keeps the exact pre-A2 platform
    // charge (full fallback, zero regression). The fee is computed by lib/commission
    // (A0: 5 % dine-in, overrides + founders offer included) on the FOOD portion of
    // this charge ONLY (foodDueCents) — G1: the dine-in service is RESTO revenue,
    // NEVER in the commission base, so it flows to the resto net (amount − fee)
    // exactly like the delivery fee. With serviceCents 0, foodDueCents === dueCents
    // → the fee is byte-identical to pre-G1.
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: ticket.restaurantId },
      select: {
        stripeAccountId: true, stripeAccountStatus: true,
        commissionRateDineIn: true, commissionRatePickup: true,
        commissionRateDelivery: true, commissionFreeUntil: true,
      },
    })
    const routed = !!(restaurant?.stripeAccountId && restaurant.stripeAccountStatus === 'active')
    // ── D5 (closed beta) — CONNECT-READY GATE — même refus que POST /api/orders/[id]/pay :
    // un fallback plateforme encaisserait l'addition sans rail de reversement.
    // Refus AVANT tout appel Stripe ; danger-flag ALLOW_PLATFORM_FALLBACK (QA).
    if (!routed && !isPlatformFallbackAllowed()) {
      return NextResponse.json(
        {
          error: 'Le paiement en ligne est momentanément indisponible pour ce restaurant — réglez auprès de l’équipe.',
          code:  'restaurant_not_payable',
        },
        { status: 409 },
      )
    }
    const feeCents = routed ? computeApplicationFee(restaurant!, 'dinein', foodDueCents) : 0
    const rate     = routed ? resolveCommissionRate(restaurant!, 'dinein') : 0
    const connect: ConnectRouting | undefined =
      routed ? { destination: restaurant!.stripeAccountId!, applicationFeeCents: feeCents } : undefined

    // Idempotent reuse of the stored PaymentIntent, but NEVER with a stale amount,
    // fee, or routing:
    //   • succeeded + still due > 0 → a PAST PARTIAL payment: fall through and
    //     create a NEW PI for the REMAINDER.
    //   • usable + amount, fee AND routing all match → return as-is.
    //   • 'processing' → untouchable either way (webhook at-cent guard nets it).
    //   • routing mismatch (account became active/inactive since creation, or a
    //     different destination) → transfer_data can NOT be changed by update →
    //     cancel + recreate with the right routing.
    //   • amount/fee stale on matching routing → ONE update sets amount AND
    //     application_fee_amount TOGETHER (the commission always tracks the
    //     charged amount — the money-fix coherence). If Stripe refuses (e.g.
    //     requires_action), cancel + recreate — never an orphan payable wrong.
    if (ticket.stripePaymentIntentId) {
      try {
        const existing = await retrieveIntent(ticket.stripePaymentIntentId)
        if (existing.status !== 'succeeded' && existing.status !== 'canceled' && existing.client_secret) {
          const existingDest   = typeof existing.transfer_data?.destination === 'string'
            ? existing.transfer_data.destination
            : (existing.transfer_data?.destination as { id?: string } | null | undefined)?.id ?? null
          const routingMatches = routed
            ? existingDest === restaurant!.stripeAccountId
            : !existingDest
          const feeMatches     = (existing.application_fee_amount ?? 0) === feeCents
          if (routingMatches && feeMatches && existing.amount === dueCents) {
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: dueCents, currency,
            })
          }
          if (existing.status === 'processing') {
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: existing.amount, currency,
            })
          }
          if (routingMatches) {
            try {
              const updated = await updateIntentAmount(existing.id, dueCents, {
                // Only a ROUTED PI carries a fee; explicit 0 clears a stale fee.
                ...(routed ? { applicationFeeCents: feeCents } : {}),
                idempotencyKey: `payup-${ticket.id}-${existing.id}-${dueCents}-${feeCents}`,
              })
              return NextResponse.json({
                clientSecret: updated.client_secret, publishableKey, amount: dueCents, currency,
              })
            } catch {
              // Not updatable in this state → cancel (best-effort) + recreate below.
              try { await cancelIntent(existing.id) } catch {
                console.warn(`[ticket pay] could not cancel stale PI ${existing.id} (ticket ${ticket.id})`)
              }
            }
          } else {
            // Routing changed since creation → recreate with the right routing.
            try { await cancelIntent(existing.id) } catch {
              console.warn(`[ticket pay] could not cancel misrouted PI ${existing.id} (ticket ${ticket.id})`)
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
      connect,
      extraMetadata: {
        grubano_channel: 'dinein',
        commission_rate: String(rate),
        // G1: stamp the resto-bound service held in THIS charge (cents) on the
        // (immutable) PI for trace/recovery. Spreads NOTHING when no service →
        // byte-identical metadata (flag off / rate 0). The service is part of
        // amountCents (= dueCents) but NOT of the application_fee → it is in the
        // resto net (amount − fee), the same as the delivery fee.
        ...(serviceCents > 0 ? { dinein_service_cents: String(serviceCents) } : {}),
      },
      // Same logical attempt (ticket + amount + fee + predecessor PI) → same PI:
      // a double-click race never stacks two charges; any state change (new due,
      // new fee, predecessor replaced) yields a new key.
      idempotencyKey: `pay-${ticket.id}-${dueCents}-${feeCents}-${ticket.stripePaymentIntentId ?? 'first'}`,
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
