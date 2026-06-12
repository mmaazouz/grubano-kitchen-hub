import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import {
  createTicketPayment, retrieveIntent, eurosToCents, getPublishableKey,
  cancelIntent, type ConnectRouting,
} from '@/lib/stripe'
import { computeApplicationFee, resolveCommissionRate, type CommissionChannel } from '@/lib/commission'
import { commissionBaseCents, commissionBaseMode } from '@/lib/promotions'

// ── POST /api/orders/[id]/pay ─────────────────────────────────────────────────
// Chantier checkout C1 (décision C0: pickup AND delivery are paid IMMEDIATELY at
// order). Creates (or reuses) the order's PaymentIntent:
//   • CONSUMER-OWNER only (getToken; the order must belong to the caller) — an
//     order is personal, unlike the open table bill.
//   • charge amount = order.total (products + delivery fee − welcome discount),
//     read SERVER-side (anti-fraud, the client never sends an amount);
//   • commission = lib/commission on the PRODUCT SUBTOTAL ONLY (C0: the delivery
//     fee goes 100 % to the resto — Grubano never commissions the courier cost),
//     channel 'pickup' or 'delivery' from the order's fulfillmentType,
//     MINUS the welcome discount (B0: the discount is financed BY GRUBANO — it
//     comes out of OUR commission, floored at 0, never out of the resto's net);
//   • destination charge when the resto's Connect account is active, exact A2
//     fallback (bare platform PI) otherwise;
//   • deterministic idempotency keys — a double-click can never stack charges.
// The webhook confirms payment (order.paymentStatus='paid') and writes the
// ledger line WITH the channel.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_CHARGE_CENTS = 50 // Stripe minimum (~0.50 EUR)

function stripeError(err: unknown) {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
  }
  console.error('[order pay] stripe error', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Erreur paiement, réessayez.' }, { status: 502 })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    const order = await prisma.order.findUnique({
      where:  { id: params.id },
      select: {
        id: true, consumerId: true, restaurantId: true, status: true,
        subtotal: true, deliveryFee: true, total: true, fulfillmentType: true,
        stripePaymentIntentId: true, paymentStatus: true,
      },
    })
    if (!order) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }
    if (order.consumerId !== token.sub) {
      return NextResponse.json({ error: 'Commande non autorisée' }, { status: 403 })
    }
    if (order.paymentStatus === 'paid') {
      return NextResponse.json({ error: 'Commande déjà payée.' }, { status: 409 })
    }
    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Commande annulée.' }, { status: 400 })
    }

    const currency    = 'eur'
    const amountCents = eurosToCents(order.total)
    if (order.total <= 0 || amountCents < MIN_CHARGE_CENTS) {
      return NextResponse.json({ error: 'Montant trop faible pour un paiement carte.' }, { status: 400 })
    }

    // ── Commission (C0 + P1 doctrine D1/D2) ─────────────────────────────────────
    // Base = the PRODUCT subtotal minus the order's discount (derivable:
    // subtotal + deliveryFee − total, clamped ≥ 0) when COMMISSION_BASE is
    // 'discounted' (default — the commission is computed on what was PAID), or
    // the list subtotal when 'list'. D1: the resto finances its promo — the
    // discount shrinks the commission BASE, it is never deducted from the fee
    // itself (the former welcome-financing deduction is retired with D6: the
    // welcome discount is OFF; if it is ever reactivated, its Grubano-financing
    // needs a fresh spec).
    const channel: CommissionChannel =
      order.fulfillmentType === 'pickup' ? 'pickup' : 'delivery'
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: order.restaurantId },
      select: {
        stripeAccountId: true, stripeAccountStatus: true,
        commissionRateDineIn: true, commissionRatePickup: true,
        commissionRateDelivery: true, commissionFreeUntil: true,
      },
    })
    const subtotalCents = eurosToCents(order.subtotal)
    const discountCents = Math.max(
      0, subtotalCents + eurosToCents(order.deliveryFee) - amountCents,
    )
    const baseCents = commissionBaseCents(subtotalCents, discountCents, commissionBaseMode())
    const routed = !!(restaurant?.stripeAccountId && restaurant.stripeAccountStatus === 'active')
    const feeCents = routed ? computeApplicationFee(restaurant!, channel, baseCents) : 0
    const rate     = routed ? resolveCommissionRate(restaurant!, channel) : 0
    const connect: ConnectRouting | undefined =
      routed ? { destination: restaurant!.stripeAccountId!, applicationFeeCents: feeCents } : undefined

    const publishableKey = getPublishableKey()

    // Idempotent reuse — an order's amount is FIXED at creation (not a live
    // document like the table bill), so reuse needs only the routing check:
    //   • succeeded → 409 (webhook lag);
    //   • usable + same routing + same amount → returned as-is;
    //   • routing/amount mismatch (account toggled, defensive) → cancel +
    //     recreate (transfer_data is immutable on update);
    //   • canceled → fresh PI.
    if (order.stripePaymentIntentId) {
      try {
        const existing = await retrieveIntent(order.stripePaymentIntentId)
        if (existing.status === 'succeeded') {
          return NextResponse.json({ error: 'Commande déjà payée.' }, { status: 409 })
        }
        if (existing.status !== 'canceled' && existing.client_secret) {
          const existingDest = typeof existing.transfer_data?.destination === 'string'
            ? existing.transfer_data.destination
            : (existing.transfer_data?.destination as { id?: string } | null | undefined)?.id ?? null
          const routingMatches = routed
            ? existingDest === restaurant!.stripeAccountId
            : !existingDest
          const feeMatches = (existing.application_fee_amount ?? 0) === feeCents
          if (routingMatches && feeMatches && existing.amount === amountCents) {
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: amountCents, currency,
            })
          }
          if (existing.status === 'processing') {
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: existing.amount, currency,
            })
          }
          try { await cancelIntent(existing.id) } catch {
            console.warn(`[order pay] could not cancel stale PI ${existing.id} (order ${order.id})`)
          }
        }
        // canceled / just-cancelled → fall through to a fresh PI.
      } catch {
        // fall through and create a fresh PaymentIntent
      }
    }

    // createTicketPayment = the shared automatic-capture charge factory (A2).
    // Identification flows through metadata: orderId (NOT ticketId) tells the
    // webhook this is a checkout order.
    const pi = await createTicketPayment({
      amountCents,
      currency,
      metadata: { restaurantId: order.restaurantId },
      connect,
      extraMetadata: {
        orderId:         order.id,
        grubano_channel: channel,
        commission_rate: String(rate),
      },
      idempotencyKey: `orderpay-${order.id}-${amountCents}-${feeCents}-${order.stripePaymentIntentId ?? 'first'}`,
    })

    await prisma.order.update({
      where: { id: order.id },
      data:  { stripePaymentIntentId: pi.id, paymentStatus: 'pending' },
    })

    return NextResponse.json(
      { clientSecret: pi.client_secret, publishableKey, amount: amountCents, currency },
      { status: 201 },
    )
  } catch (err) {
    return stripeError(err)
  }
}
