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
import { computeFranchiseRoyalty, recordFranchiseRoyalty } from '@/lib/franchise-royalty'

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
        // P4-Franchise-A: needed to resolve the franchisor (PointOfSale.franchiseId)
        // for the held-back royalty. Inert (null) when the order is not franchised.
        pointOfSaleId: true,
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
    // Loyalty credit + small-order fee on this order — guarded read so a deploy
    // before the db push (columns absent) degrades to 0 (and order.total is the
    // food-only total in that case, so the whole derivation stays consistent).
    // Read each column INDEPENDENTLY: the loyalty column already exists (L1 db
    // push) while the small-fee column is new (this push). A combined select would
    // throw as a unit on the missing new column and wrongly zero the EXISTING
    // loyalty credit during the deploy window — so they get separate guards.
    let loyaltyCreditCents = 0
    try {
      const extra = await prisma.order.findUnique({ where: { id: order.id }, select: { loyaltyCreditCents: true } })
      loyaltyCreditCents = extra?.loyaltyCreditCents ?? 0
    } catch { /* column missing pre-db-push → 0 */ }
    let smallFeeCents = 0
    try {
      const extra = await prisma.order.findUnique({ where: { id: order.id }, select: { smallOrderFeeCents: true } })
      smallFeeCents = extra?.smallOrderFeeCents ?? 0
    } catch { /* column missing pre-db-push → 0 */ }

    // amountCents (= order.total) = subtotal + delivery + smallFee − promo − credit.
    // So the discount baked into the charge = subtotal + delivery + smallFee −
    // amount = promo + credit. The small fee MUST be added back here, else once it
    // is in total the derived "discount" would be understated and the commission
    // base wrong. (V1.5)
    const totalDiscountCents = Math.max(
      0, subtotalCents + eurosToCents(order.deliveryFee) + smallFeeCents - amountCents,
    )
    // D1: ONLY the promo discount reduces the commission BASE. The loyalty credit
    // and the small fee never shrink the base (the fee is not even part of it).
    const promoDiscountCents = Math.max(0, totalDiscountCents - loyaltyCreditCents)
    const baseCents = commissionBaseCents(subtotalCents, promoDiscountCents, commissionBaseMode())
    const routed = !!(restaurant?.stripeAccountId && restaurant.stripeAccountStatus === 'active')
    const grossFeeCents = routed ? computeApplicationFee(restaurant!, channel, baseCents) : 0
    // ── Franchise royalty (P4-Franchise-A) — HELD-BACK at the source ──────────────
    // ADDITIVE + flag-gated. computeFranchiseRoyalty returns 0 (and does NOT touch
    // the DB) when FRANCHISE_ROYALTY_ENABLED is OFF (default) OR the order is not
    // attached to a franchise point of sale → feeCents, the PaymentIntent, its
    // idempotency key and the ledger line stay BYTE-IDENTICAL to today and NO royalty
    // row is created. When ON for a franchised order, an EXTRA `rate` (6%) of the food
    // subtotal is retained in the application_fee ON TOP of the Grubano commission —
    // composed HERE, at the call site (lib/commission is UNCHANGED) — and accrued
    // (below, after the PI is created) as a 'pending' obligation owed to the franchisor
    // (100% pass-through, NOT Grubano revenue). Base = order.subtotal, the SAME
    // definition as the franchise my-dashboard. Only routed (destination) charges can
    // hold money back, so this is gated on `routed` like the rest of the fee.
    const royalty = routed
      ? await computeFranchiseRoyalty({ pointOfSaleId: order.pointOfSaleId, subtotalCents })
      : { royaltyCents: 0, franchisorOperatorId: null, pointOfSaleId: null, rate: 0 }
    // D1/D5: the loyalty credit reduces Grubano's NET application fee (floored 0).
    // V1.5: the small-order fee is ADDED to the application_fee — kept 100 % by
    // GRUBANO. The resto receives amount − fee = subtotal+delivery − promo −
    // grossFee = PLEIN (the +smallFee in amount and the +smallFee in the app fee
    // cancel for the resto; the credit cancels likewise). The D5/D-A cap guarantees
    // grossFee − credit ≥ 0. THE RESTO TOUCHES PLEIN; GRUBANO ABSORBS THE CREDIT
    // AND KEEPS THE FEE. On the platform fallback (not routed) the whole charge —
    // fee included — already stays on Grubano's account, so no split is needed.
    // P4-Franchise-A: the franchisor's HELD-BACK is composed onto the application_fee
    // at the source. Stripe REJECTS application_fee_amount > amount, and the royalty is
    // computed on the FULL list subtotal while amountCents is the DISCOUNTED total — so
    // on a heavily-discounted franchised order the raw royalty could push the fee past
    // the charge and break the payment. CLAMP it to the room left under amountCents: the
    // charge can NEVER fail, and we accrue EXACTLY what was held (royaltyChargedCents),
    // so the obligation row matches Stripe to the cent. The resto's net = gross − feeCents
    // drops by exactly the charged royalty; the ledger records this composed fee (golden
    // equation holds); the franchisor's share is tracked separately (FranchiseRoyalty).
    // When the flag is OFF (or not franchised), royaltyChargedCents = 0 and feeCents
    // reduces to the exact pre-feature expression → byte-identical.
    const baseFeeCents = routed ? Math.max(0, grossFeeCents - loyaltyCreditCents) + smallFeeCents : 0
    const royaltyChargedCents = routed
      ? Math.min(royalty.royaltyCents, Math.max(0, amountCents - baseFeeCents))
      : 0
    const feeCents = baseFeeCents + royaltyChargedCents
    const rate     = routed ? resolveCommissionRate(restaurant!, channel) : 0
    const connect: ConnectRouting | undefined =
      routed ? { destination: restaurant!.stripeAccountId!, applicationFeeCents: feeCents } : undefined

    const publishableKey = getPublishableKey()

    // P4-Franchise-A: idempotent, BEST-EFFORT accrual of the franchise royalty for THIS
    // order, pointing the obligation row at the LIVE PaymentIntent. Safe to call on EVERY
    // path — fresh create AND reuse/early-return — because recordFranchiseRoyalty
    // reconciles a 'pending' row (or creates one) keyed on orderId. That dual role matters:
    //   • it HEALS a first accrual that failed transiently — the reuse path retries it
    //     (otherwise the early return would strand the held-back with no obligation row);
    //   • it RE-POINTS the row (paymentIntentId + the live held-back amount) when a stale
    //     PI was cancelled + recreated with a different fee, instead of leaving the row on
    //     the cancelled intent with a stale royalty.
    // It NEVER throws into the payment: a failure is logged for reconciliation only, and
    // it is a no-op when no royalty applies (flag OFF / not franchised → byte-identical).
    const accrueFranchiseRoyalty = async (piId: string) => {
      if (!(royaltyChargedCents > 0 && royalty.franchisorOperatorId && order.pointOfSaleId)) return
      try {
        await recordFranchiseRoyalty({
          orderId:              order.id,
          paymentIntentId:      piId,
          franchisorOperatorId: royalty.franchisorOperatorId,
          restaurantId:         order.restaurantId,
          pointOfSaleId:        order.pointOfSaleId,
          channel,
          baseRevenueCents:     subtotalCents,
          royaltyCents:         royaltyChargedCents,
          rate:                 royalty.rate,
        })
      } catch (err) {
        console.error(
          `[order pay] franchise royalty accrual failed for order ${order.id} (payment unaffected): ` +
          (err instanceof Error ? err.message : String(err)),
        )
      }
    }

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
            // Reused PI carries the same TOTAL fee → reconcile/heal the accrual against
            // THIS live intent before returning (covers a failed first accrual). Note:
            // feeMatches compares the total only; in the rare doubly-clamped regime the
            // royalty split could differ by cents from what the PI stamped — the PI
            // metadata (franchise_royalty_cents) stays the authoritative source for
            // step-B settlement, which reconciles against it.
            await accrueFranchiseRoyalty(existing.id)
            return NextResponse.json({
              clientSecret: existing.client_secret, publishableKey, amount: amountCents, currency,
            })
          }
          if (existing.status === 'processing') {
            // Deliberately NO accrual here: this branch is only reached when the fee did
            // NOT match (the matching case returned above), so the in-flight PI may hold a
            // different held-back than the freshly-computed one — re-pointing the row to it
            // could record a stale royalty. The accrual heals on the fee-consistent reuse
            // path or at (re)creation; the PI metadata remains the recoverable source.
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
        // P4-Franchise-A: stamp the ACTUALLY-HELD-BACK amount (post-clamp) on the
        // (immutable) PI when it applies, so the franchisor obligation is recoverable
        // from Stripe even if the DB row write below fails. Spreads NOTHING when no
        // royalty → byte-identical metadata.
        ...(royaltyChargedCents > 0 && royalty.franchisorOperatorId
          ? {
              franchise_royalty_cents: String(royaltyChargedCents),
              franchisor_operator_id:  royalty.franchisorOperatorId,
              franchise_royalty_rate:  String(royalty.rate),
            }
          : {}),
      },
      idempotencyKey: `orderpay-${order.id}-${amountCents}-${feeCents}-${order.stripePaymentIntentId ?? 'first'}`,
    })

    await prisma.order.update({
      where: { id: order.id },
      data:  { stripePaymentIntentId: pi.id, paymentStatus: 'pending' },
    })

    // P4-Franchise-A: accrue/reconcile the franchise royalty against the freshly-created
    // PI (no-op when no royalty applies → byte-identical when OFF). See the helper above.
    await accrueFranchiseRoyalty(pi.id)

    return NextResponse.json(
      { clientSecret: pi.client_secret, publishableKey, amount: amountCents, currency },
      { status: 201 },
    )
  } catch (err) {
    return stripeError(err)
  }
}
