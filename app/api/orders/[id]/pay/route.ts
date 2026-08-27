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
import { isTipsEnabled } from '@/lib/tips'
import { recordCourierTipLedgerEntry } from '@/lib/ledger'
import { isLogisticsCourierAccrualEnabled } from '@/lib/courier-accrual'

// ── POST /api/orders/[id]/pay ─────────────────────────────────────────────────
// Chantier checkout C1 (décision C0: pickup AND delivery are paid IMMEDIATELY at
// order). Creates (or reuses) the order's PaymentIntent:
//   • CONSUMER-OWNER only (getToken; the order must belong to the caller) — an
//     order is personal, unlike the open table bill.
//   • charge amount = order.total (products + delivery fee − welcome discount),
//     read SERVER-side (anti-fraud, the client never sends an amount);
//   • commission = lib/commission on the PRODUCT SUBTOTAL ONLY (C0: the delivery
//     fee goes 100 % to the resto — Grubano never commissions the courier cost).
//     EXCEPTION P4.3 ÉTAPE 3 (case B): when Order.deliveryMode='grubano_courier' AND
//     LOGISTICS_COURIER_ACCRUAL_ENABLED is ON, the deliveryFee is instead withheld in
//     the application_fee (the courier is paid from it later); case A ('restaurant',
//     the default/only prod value) / flag OFF → byte-identical to the C0 behaviour.
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
        // P0-29 (vague 2): the route was structurally BLIND to the payment mode
        // (paymentMethod absent from this select — audit P8) → the guard below
        // needs the read.
        paymentMethod: true,
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
    // Une commande EXPIRÉE (lazy expiry > 24 h, jamais révélée au restaurant)
    // était encore payable : le PaymentIntent n'est pas annulé à l'expiration,
    // et payer une commande morte envoie l'argent tout droit dans la file
    // 'reconcile_manual' (WP-MONEY-01) pendant que l'écran de suivi affichait
    // « rien n'a été débité ». On ferme la source : refus AVANT tout appel Stripe.
    if (order.status === 'expired') {
      return NextResponse.json(
        { error: 'Commande expirée — elle ne peut plus être payée. Repassez commande.', code: 'order_expired' },
        { status: 409 },
      )
    }
    // ── P0-29 (vague 2 — Q2/Q8 fondateur) : le rail carte est réservé aux
    // commandes CARTE. P0-02 a fermé la CRÉATION cash/wallet ; ce garde ferme le
    // PAIEMENT PAR LIEN (/eat/checkout/[orderId]) des lignes HÉRITÉES — c'était
    // le double encaissement établi de l'audit A-F/P8 (espèces à la livraison ET
    // carte en ligne). Tentative TRACÉE : sur une ligne héritée réelle c'est un
    // signal d'incident (client double-facturable), pas un simple 4xx.
    if (order.paymentMethod !== 'card') {
      console.warn(
        `[order pay] [P0-29] paiement carte REFUSÉ sur une commande non-carte ` +
        `(order ${order.id}, mode « ${order.paymentMethod} », consumer ${token.sub})`,
      )
      return NextResponse.json(
        {
          error: `Cette commande n'est pas payable en ligne — son mode de paiement (« ${order.paymentMethod} ») n'est pas la carte.`,
          code:  'payment_method_mismatch',
        },
        { status: 409 },
      )
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
    // P2-TIP: the courier tip held on this order (cents). SEPARATE guard (its own
    // try/catch) for the SAME reason as the small fee: the tipCents column is new
    // (this push) so a combined select would throw as a unit on the missing column
    // and wrongly zero the EXISTING loyalty/small-fee reads during the deploy
    // window. ALSO gated by isTipsEnabled(): with the flag OFF tipCents stays 0
    // here even if a column value exists → the charge/fee are byte-identical.
    let tipCents = 0
    if (isTipsEnabled()) {
      try {
        const extra = await prisma.order.findUnique({ where: { id: order.id }, select: { tipCents: true } })
        tipCents = extra?.tipCents ?? 0
      } catch { /* column missing pre-db-push → 0 */ }
    }
    // P4.3 ÉTAPE 3 — case-B courier delivery mode. Read ONLY behind the accrual flag (and in
    // its own guard, same reason as tip: a combined select would throw as a unit on a missing
    // column and wrongly zero the existing reads during a deploy window). With the flag OFF —
    // or the column absent — deliveryMode stays 'restaurant' (case A) → the withholding below
    // is 0 → the charge/fee are BYTE-IDENTICAL. Only 'grubano_courier' (case B) withholds.
    let deliveryMode = 'restaurant'
    if (isLogisticsCourierAccrualEnabled()) {
      try {
        const extra = await prisma.order.findUnique({ where: { id: order.id }, select: { deliveryMode: true } })
        deliveryMode = extra?.deliveryMode ?? 'restaurant'
      } catch { /* column missing pre-db-push → 'restaurant' (case A) */ }
    }

    // amountCents (= order.total) = subtotal + delivery + smallFee + tip − promo −
    // credit. So the discount baked into the charge = subtotal + delivery + smallFee
    // + tip − amount = promo + credit. The small fee AND the tip MUST be added back
    // here, else once they are in total the derived "discount" would be understated
    // and the commission base wrong. (V1.5 / P2-TIP). With TIPS_ENABLED OFF, tipCents
    // is 0 → this expression is byte-identical to the pre-tip one.
    const totalDiscountCents = Math.max(
      0, subtotalCents + eurosToCents(order.deliveryFee) + smallFeeCents + tipCents - amountCents,
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
    // P2-TIP: the courier tip is ADDED to the application_fee — held 100 % by the
    // PLATFORM (it is an obligation owed to the courier, NEVER routed to the resto).
    // It is in amountCents too (order.total includes it), so the +tip in amount and
    // the +tip in the app fee CANCEL for the resto: net = amount − fee is unchanged,
    // the tip is NEVER the resto's take. The royalty clamp below sees the tip on both
    // sides (room = amount − baseFee), so it is unaffected. With TIPS_ENABLED OFF
    // tipCents is 0 → byte-identical. (Only routed charges split the fee; on the
    // platform fallback the whole charge — tip included — already stays on Grubano's
    // account and the 'courier_tip' accrual still records the obligation.)
    // P4.3 ÉTAPE 3 — case-B courier withholding. When Order.deliveryMode === 'grubano_courier'
    // (and the accrual flag is ON), the FULL deliveryFee is retained in the platform's
    // application_fee instead of going to the resto — EXACTLY the tip pattern: the deliveryFee
    // is already in amountCents (order.total includes it) AND is added to the fee here, so the
    // +fee in amount and the +fee in the app fee CANCEL for the resto (net = amount − fee drops
    // by the deliveryFee, i.e. the resto no longer keeps it). The platform then owes the courier
    // net = 80 % of it (accrued at delivery, lib/courier-accrual) and keeps 20 % commission. Only
    // routed (destination) charges split the fee; on the platform fallback the whole charge stays
    // on Grubano anyway. Case A ('restaurant') / flag OFF → 0 → BYTE-IDENTICAL. The royalty clamp
    // below sees this in baseFeeCents (room = amount − baseFee), so feeCents ≤ amount stays true.
    const courierWithheldCents = (routed && deliveryMode === 'grubano_courier') ? eurosToCents(order.deliveryFee) : 0
    const baseFeeCents = routed ? Math.max(0, grossFeeCents - loyaltyCreditCents) + smallFeeCents + tipCents + courierWithheldCents : 0
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

    // P2-TIP: idempotent, BEST-EFFORT accrual of the COURIER tip held in THIS order's
    // application_fee. Keyed on the PI id (sourceEventId) via @@unique([sourceEventId,
    // 'courier_tip']) → a replay / reuse on the SAME PI is a silent duplicate. Records
    // the obligation (the held tip is NOT Grubano revenue) so the courier reversal rail
    // (P4.3 ÉTAPE 6: lib/courier-accrual → payPartner('logistics'), gated
    // LOGISTICS_PAYOUT_ENABLED) reverses it later. NEVER throws into the payment;
    // a no-op when tipCents is 0 (flag OFF / no tip → byte-identical, no line written).
    const accrueCourierTip = async (piId: string) => {
      if (tipCents <= 0) return
      try {
        const res = await recordCourierTipLedgerEntry({
          orderId:               order.id,
          stripePaymentIntentId: piId,
          tipCents,
          channel,
        })
        if (!res.ok) {
          console.error(`[order pay] courier tip ledger write failed for order ${order.id} (payment unaffected): ${res.error}`)
        }
      } catch (err) {
        console.error(
          `[order pay] courier tip accrual failed for order ${order.id} (payment unaffected): ` +
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
            await accrueCourierTip(existing.id)
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
        // P2-TIP: stamp the held courier tip (cents) on the (immutable) PI when it
        // applies, so the obligation is recoverable from Stripe even if the DB
        // ledger write fails. Spreads NOTHING when no tip → byte-identical metadata.
        ...(tipCents > 0 ? { courier_tip_cents: String(tipCents) } : {}),
        // P4.3 ÉTAPE 3: stamp the withheld case-B deliveryFee (cents) on the (immutable) PI
        // so the courier obligation is recoverable from Stripe. Spreads NOTHING for case A /
        // flag OFF (courierWithheldCents 0) → byte-identical metadata.
        ...(courierWithheldCents > 0 ? { courier_withheld_cents: String(courierWithheldCents) } : {}),
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
    // P2-TIP: accrue the courier-tip obligation against the freshly-created PI (no-op
    // when no tip / flag OFF → byte-identical). See the helper above.
    await accrueCourierTip(pi.id)

    return NextResponse.json(
      { clientSecret: pi.client_secret, publishableKey, amount: amountCents, currency },
      { status: 201 },
    )
  } catch (err) {
    return stripeError(err)
  }
}
