import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { loadHoursContext, isOpenAtCtx, nextOpeningCtx, nextOpeningLabelFr } from '@/lib/opening-hours'
import { computeApplicationFee, type CommissionChannel } from '@/lib/commission'
import { fetchActivePromotions, pickBestPromotion } from '@/lib/promotions'
import { resolveLoyaltyCredit, estimateStripeFeeCents, committedRoyaltyCents } from '@/lib/loyalty'
import { smallOrderFeeCents, netBeforeAffiliateCents } from '@/lib/pricing'
import { isFranchisePosTaggingEnabled } from '@/lib/franchise-pos-tagging'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

// B0-quater: the creator is paid in PERCENTAGES ONLY. The acquisition bonus is
// now a CONFIG parameter (ReferralConfig.newCustomerBonusAmount, default 0 = no
// bonus is ever written). No fixed amount lives in code anymore.

// Round money to 2 decimals. Used by the referral attribution logic below.
const round2 = (n: number) => Math.round(n * 100) / 100

// ── Validation ────────────────────────────────────────────────────────────────

const orderItemSchema = z.object({
  itemId:   z.string(),
  name:     z.string(),
  qty:      z.number().int().min(1),
  price:    z.number().positive(),
  options:  z.array(z.record(z.unknown())).default([]),
})

const createOrderSchema = z.object({
  restaurantId:    z.string(),
  items:           z.array(orderItemSchema).min(1),
  deliveryAddress: z.string().min(5).max(200),
  paymentMethod:   z.enum(['card', 'cash', 'wallet']).default('card'),
  // Pickup vs delivery. The /eat cart already sends this; the server uses it to
  // zero the delivery fee on pickup (a customer collecting in person must NOT be
  // charged €1.99). Defaults to 'delivery' to keep the existing contract intact.
  fulfillmentType: z.enum(['delivery', 'pickup']).default('delivery'),
  // brique 5B: optional manual referral code. The `grubano_ref` cookie is the
  // primary source; this body field is a future-proof fallback for manual entry.
  // .optional() keeps the existing request contract intact.
  referralCode:    z.string().optional(),
  // Chantier fidélité L1 (D4): the customer's INTENTION to spend loyalty points.
  // The SERVER computes the euro credit, checks the balance, applies the caps —
  // any client-sent amount is ignored. Default false keeps the contract intact.
  usePoints:       z.boolean().default(false),
})

// ── Uber Direct mock ──────────────────────────────────────────────────────────
// Replace with real Uber Direct API call when credentials are available.

async function mockUberDirectDispatch(orderId: string) {
  await new Promise(r => setTimeout(r, 50)) // simulate API latency
  return {
    trackingUrl:   `https://track.grubano.com/order/${orderId}`,
    estimatedTime: 25 + Math.floor(Math.random() * 15), // 25–40 min
    driverId:      `DRV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
  }
}

// ── POST /api/orders ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req })
    if (!token) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    const body = await req.json()
    const data = createOrderSchema.parse(body)

    // Verify restaurant exists, is active, and is not archived (soft-deleted).
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: data.restaurantId, isActive: true, archivedAt: null },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable ou fermé' }, { status: 404 })
    }

    // Opening hours (Chantier horaires): a delivery/pickup order is placed for
    // NOW, so it is blocked while the establishment is closed — with the next
    // opening spelled out ("Ouvre à 19h00"). Not configured → no restriction
    // (T1.Q3). Browsing the menu stays free (T3.Q3) — only the order is gated.
    // At-table ordering (/api/t/[tableId]/order) is intentionally NOT subject to
    // hours: an 'arrived' session rules (angle mort 1).
    const hoursCtx = await loadHoursContext(data.restaurantId)
    if (hoursCtx.configured && !isOpenAtCtx(hoursCtx, new Date())) {
      const next = nextOpeningCtx(hoursCtx, new Date())
      const label = next ? nextOpeningLabelFr(next, new Date()) : null
      return NextResponse.json(
        {
          error: `L'établissement est actuellement fermé${label ? ` — ouvre ${label}` : ''}.`,
          code:  'closed',
          ...(next ? { nextOpening: { dateStr: next.dateStr, time: next.time, label } } : {}),
        },
        { status: 409 },
      )
    }

    // Calculate totals. minOrder is enforced on the PRE-discount subtotal: the
    // customer genuinely ordered enough, so the referral welcome discount (5B)
    // applied below is a gift on top and must never retroactively block the order.
    const subtotal = data.items.reduce((sum, item) => sum + item.price * item.qty, 0)

    // Pickup orders are collected in person → no delivery fee. Delivery keeps the
    // restaurant's normal fee. Used everywhere the fee applies to THIS order
    // (total calc + the deliveryFee stored on the Order) so the billing matches
    // exactly what the cart already shows the customer.
    const effectiveDeliveryFee = data.fulfillmentType === 'pickup' ? 0 : restaurant.deliveryFee

    if (subtotal < restaurant.minOrder) {
      return NextResponse.json(
        { error: `Commande minimum: €${restaurant.minOrder.toFixed(2)}` },
        { status: 400 },
      )
    }

    // ── Referral attribution — RESOLUTION phase (brique 5B) ────────────────────
    // Resolve the referral BEFORE creating the Order so the welcome discount is
    // baked into the stored total (the customer pays the right amount). The actual
    // Referral / ReferralOrder WRITES happen AFTER the Order, best-effort (same
    // rule as the 5C DishSale block). These resolution reads are themselves
    // wrapped in try/catch: a referral hiccup must never block checkout.
    //
    // B0 (réconciliation C1): grubanoFee is the REAL commission (lib/commission —
    // per-channel rate, per-resto override, founders offer), never a hardcoded
    // 10 %; the creator earns 30 % of it (ReferralConfig) + the 5 € acquisition
    // bonus on a customer's first Grubano order.
    const ref = {
      code:                    null as string | null, // Order.referralCode — set whenever a valid creator code is seen, regardless of expiry
      discount:                0,                      // welcome discount, FIRST referred order only
      createReferralCreatorId: null as string | null, // CAS 1 → create a new Referral with this creator
      reuseReferralId:         null as string | null,  // CAS 2 (valid window) → reuse this referral for the ReferralOrder
      expiredReferralId:       null as string | null,  // CAS 2 (expired window) → deactivate, no payout
      commissionPct:           0.30,                    // ReferralConfig.commissionPctOfGrubanoFee (B0: 30 %)
      bonusAmount:             0,                       // ReferralConfig.newCustomerBonusAmount (B0-quater: default 0 = none)
      durationDays:            90,                      // ReferralConfig.durationDays
      // Levier 1: the creator who will actually receive a ReferralOrder payout for
      // THIS order (CAS 1 → the resolved creator, CAS 2-valid → the existing
      // binding's creator). null when organic, no code, or an expired window: those
      // produce no ReferralOrder, so the 5C recipe rate must stay on the reduced
      // (organic) tier. Read-only here; the 5C block uses it, the 5B writes do not.
      referringCreatorId:      null as string | null,
      // ── Brique B (Agent 59) — top-level affiliate, gated by AFFILIATE_ENABLED ────
      // The AFFILIATE (by OPERATOR id) to credit for THIS order — set ONLY when the
      // code resolves to an Affiliate (not a creator), the flag is ON, and it is not a
      // self-referral. EXACTLY one referrer: referringCreatorId XOR referringAffiliateId.
      // The affiliate path is ACCRUAL-ONLY: it NEVER sets `discount` → the charge /
      // amount encaissé is byte-identical (the welcome discount stays creator-only).
      createReferralAffiliateId: null as string | null, // CAS 1 → bind a new Referral to this affiliate (operatorId)
      referringAffiliateId:      null as string | null, // the affiliate (operatorId) credited by the ReferralOrder
    }
    try {
      const rawCode = (data.referralCode ?? req.cookies.get('grubano_ref')?.value ?? '').trim().toUpperCase()
      if (rawCode) {
        const creator = await prisma.creator.findFirst({ where: { referralCode: rawCode } })
        // Brique B — a code resolves to a CREATOR or (gated) a top-level AFFILIATE.
        // Codes are UNIQUE cross-table (Brique A) → at most one matches; we only look
        // for an affiliate when no creator matched AND AFFILIATE_ENABLED is ON, so when
        // the flag is OFF this is a no-op and the path below is byte-identical.
        const affiliate = (!creator && isAffiliateEnabled())
          ? await prisma.affiliate.findFirst({ where: { referralCode: rawCode } })
          : null
        // Anti-self-referral: a referrer cannot refer themselves. Creator↔Operator is
        // by EMAIL (no Creator.operatorId), so we compare the buyer's token email to the
        // creator's email. The AFFILIATE is 1:1 with an Operator, so the self-check is a
        // direct operator-id comparison (affiliate.operatorId === buyer). No email → skip
        // the creator self-check (best-effort), as before.
        const buyerEmail = typeof token.email === 'string' ? token.email.toLowerCase() : null
        const isSelfCreator   = !!creator && !!buyerEmail && creator.email.toLowerCase() === buyerEmail
        const isSelfAffiliate = !!affiliate && affiliate.operatorId === token.sub
        const creatorOk   = !!creator && !isSelfCreator
        const affiliateOk = !!affiliate && !isSelfAffiliate
        if (creatorOk || affiliateOk) {
          const cfg = await prisma.referralConfig.findFirst({ where: { active: true } })
          ref.commissionPct = cfg?.commissionPctOfGrubanoFee ?? 0.30
          ref.bonusAmount   = cfg?.newCustomerBonusAmount ?? 0
          ref.durationDays  = cfg?.durationDays ?? 90
          const discountPct = cfg?.customerDiscountPct ?? 0.10
          const discountCap = cfg?.customerDiscountCapEur ?? 5
          ref.code = rawCode // tag the order for reporting, independent of expiry

          // Binding is per-customer (referrer-agnostic): once a customer is linked to a
          // referrer via first-touch, we stay on that link while it is active — so a
          // customer has AT MOST one active binding (creator XOR affiliate).
          const existing = await prisma.referral.findFirst({
            where: { customerId: token.sub!, active: true },
          })
          if (!existing) {
            // CAS 1 — first referred order for this customer → bind. The welcome
            // DISCOUNT is creator-only (the affiliate path is accrual-only → the charge
            // / amount encaissé stays byte-identical).
            if (creatorOk) {
              ref.createReferralCreatorId = creator!.id
              ref.referringCreatorId      = creator!.id // payout goes to this creator
              ref.discount = round2(Math.min(subtotal * discountPct, discountCap))
            } else {
              ref.createReferralAffiliateId = affiliate!.operatorId
              ref.referringAffiliateId      = affiliate!.operatorId // accrual goes to this affiliate
            }
          } else if (existing.expiresAt > new Date()) {
            // CAS 2 — window still open → reuse the binding, NO discount. The accrual
            // goes to the ALREADY-bound referrer (creator XOR affiliate), not necessarily
            // the code's referrer (first-touch wins).
            ref.reuseReferralId = existing.id
            if (existing.creatorId)        ref.referringCreatorId   = existing.creatorId
            else if (existing.affiliateId) ref.referringAffiliateId = existing.affiliateId
          } else {
            // CAS 2 — window expired → no payout, no discount (close it later).
            // referring*Id stays null → 5C uses the organic (reduced) rate.
            ref.expiredReferralId = existing.id
          }
        }
      }
    } catch (refErr) {
      console.error('[POST /api/orders] referral resolution failed (order proceeds normally):', refErr)
    }

    // ── Promotions restaurateur (P1) — SERVER-resolved, D4 ─────────────────────
    // The brand's active promos are fetched and the BEST one applies (D5). The
    // client never sends a discount — anything client-side is ignored. D6 guard:
    // the referral welcome discount is OFF (0); if it ever fires, the promo is
    // skipped — there is NO stacking, ever. Best-effort: a promo hiccup never
    // blocks checkout (no discount, normal order).
    const promo = { id: null as string | null, discountEur: 0 }
    if (ref.discount === 0) {
      try {
        const active = await fetchActivePromotions(data.restaurantId)
        if (active.length > 0) {
          // Composite cart line ids (`dishId::sig`) reduce to the RAW MenuItem id
          // (same reduction the DishSale block applies — duplicated here because
          // that block's helper is scoped inside it and the block is frozen).
          const rawLines = data.items.map((item) => {
            const parent = item.options?.[0]?.parentDishId
            const rawId = typeof parent === 'string' && parent.length > 0
              ? parent
              : item.itemId.split('::')[0]
            return { rawId, price: item.price, qty: item.qty }
          })
          const best = pickBestPromotion(active, {
            items:   rawLines,
            channel: data.fulfillmentType === 'pickup' ? 'pickup' : 'delivery',
          })
          if (best) {
            promo.id          = best.promotionId
            promo.discountEur = best.discountEur
          }
        }
      } catch (promoErr) {
        console.error('[POST /api/orders] promotion resolution failed (order proceeds at full price):', promoErr)
      }
    }

    // Apply the discounts to the FOOD total (clamped ≥ 0). D1: the promo is the
    // RESTO's — the customer pays the discounted price, the resto's net absorbs it.
    const foodTotal    = Math.max(0, round2(subtotal + effectiveDeliveryFee - ref.discount - promo.discountEur))
    // Points: 1 point per euro actually spent (rounded down). Computed on the
    // promo-reduced FOOD total, BEFORE the small-order fee (the fee is a penalty,
    // not loyalty-earning spend — choice noted) and BEFORE any loyalty credit.
    const pointsEarned = Math.floor(foodTotal)

    const subtotalCents = Math.round(subtotal * 100)
    // ── Small-order fee (V1.5) — flat fee when the ITEMS subtotal (list price) is
    // below the threshold. Paid by the CLIENT, kept 100 % by GRUBANO (added to the
    // application_fee in /pay), NEVER in the commission base and NEVER reduced by
    // points/promos. Added to the charge total. Written BEST-EFFORT post-create
    // (column-tolerant → inert before the db push, exactly like the loyalty columns).
    const smallFeeCents = smallOrderFeeCents(subtotalCents)
    // The order is CREATED at the FOOD-only total; the small fee (then the loyalty
    // credit) are layered on via TOLERANT post-create updates, so a pre-db-push
    // deploy charges neither (and /pay has nothing to mis-split). The fee portion
    // is preserved on the /pay side via the application_fee split (resto unchanged).

    // ── Loyalty resolution (L1) + shared margin base (V1.5) — Grubano-financed
    // (D1), promo-exclusive (D3), server-computed (D4), capped so Grubano is never
    // net-negative (D-A). The credit is NOT applied to `total` here — it is written
    // in a TOLERANT post-create update so a pre-db-push deploy stays fully inert.
    // Grubano's commission on the FULL price (D1).
    const grossCommissionCents = computeApplicationFee(
      restaurant,
      data.fulfillmentType === 'pickup' ? 'pickup' : 'delivery',
      subtotalCents,
    )

    // Shared net-margin base + committed claims — computed ONCE and used by BOTH
    // the loyalty cap AND the affiliation (V1.5 §4.1). Only when the order needs it
    // (loyalty used, or a ReferralOrder will be written) to avoid an extra query on
    // plain orders. netBeforeAffiliate = commission − Stripe(full charge) − royalty;
    // the affiliation earns commissionPct × that net; committedClaims = Stripe +
    // royalty + affiliation feeds the loyalty cap (commission − committedClaims).
    const loyaltyEligible = data.usePoints && promo.discountEur === 0 && !promo.id && ref.discount === 0
    // A ReferralOrder is written for a creator OR (Brique B) an affiliate referrer. This
    // only widens to affiliate when AFFILIATE_ENABLED is ON (referringAffiliateId stays
    // null otherwise) → byte-identical when OFF. It triggers the NET-base read below so
    // the affiliate accrual uses the SAME base; the loyalty cap stays creator-only (the
    // affiliation claim added to committedClaims is gated on referringCreatorId).
    const willWriteReferralOrder = ref.referringCreatorId !== null || ref.referringAffiliateId !== null
    let committedClaimsCents = 0
    let affiliateBaseCents   = 0
    if (loyaltyEligible || willWriteReferralOrder) {
      // Stripe estimate on the FULL charge (items + delivery, before credit/fee).
      // The small fee is intentionally EXCLUDED so it does not affect the cap (its
      // own Stripe cost is covered by the fee's own revenue — choice noted).
      const stripeFeeCents = estimateStripeFeeCents(Math.round((subtotal + effectiveDeliveryFee) * 100))
      // Committed creator royalty — mirror the FROZEN 5C raw-id match + per-line tier.
      let royaltyCents = 0
      try {
        const rawIdOf = (item: (typeof data.items)[number]): string => {
          const parent = item.options?.[0]?.parentDishId
          if (typeof parent === 'string' && parent.length > 0) return parent
          return item.itemId.split('::')[0]
        }
        const adoptions = await prisma.dishAdoption.findMany({
          where:  { status: 'active', menuItemId: { in: data.items.map(rawIdOf) } },
          select: { menuItemId: true, creatorDish: { select: { creatorId: true } } },
        })
        if (adoptions.length > 0) {
          const cfg = await prisma.adoptionConfig.findFirst({ where: { active: true } })
          const referredPct = cfg?.creatorCommissionPctReferred ?? 0.02
          const organicPct  = cfg?.creatorCommissionPctOrganic  ?? 0.02
          const byMenuItem  = new Map(adoptions.map(a => [a.menuItemId as string, a]))
          const lines = data.items.flatMap((item) => {
            const adoption = byMenuItem.get(rawIdOf(item))
            if (!adoption) return []
            const isCreatorTraffic =
              ref.referringCreatorId !== null && ref.referringCreatorId === adoption.creatorDish.creatorId
            return [{ amountCents: Math.round(item.price * item.qty * 100), rate: isCreatorTraffic ? referredPct : organicPct }]
          })
          royaltyCents = committedRoyaltyCents(lines)
        }
      } catch (royErr) {
        // PRUDENT fallback (D-A): assume the worst default tier (2 %) on the whole
        // subtotal so the cap/affiliation never under-protect Grubano.
        royaltyCents = Math.round(subtotalCents * 0.02)
        console.error('[POST /api/orders] committed-royalty sizing failed — prudent 2% fallback:',
          royErr instanceof Error ? royErr.message : royErr)
      }
      // V1.5 §4: affiliation on the NET, shared base with the loyalty cap.
      affiliateBaseCents = netBeforeAffiliateCents(grossCommissionCents, stripeFeeCents, royaltyCents)
      const affiliationCents = ref.referringCreatorId ? Math.round(affiliateBaseCents * ref.commissionPct) : 0
      committedClaimsCents = stripeFeeCents + royaltyCents + affiliationCents
    }
    let loyalty: { creditCents: number; pointsSpent: number; customerId: string | null } =
      { creditCents: 0, pointsSpent: 0, customerId: null }
    if (loyaltyEligible) {
      try {
        // LoyaltyCustomer is keyed by EMAIL (its id is its own cuid, NOT the
        // Operator id). token.email is the connected consumer's email. The cap
        // uses the SHARED committedClaimsCents (Stripe + royalty + affiliation-on-
        // net) computed above, so Grubano's margin stays ≥ 0 (D-A).
        const email = typeof token.email === 'string' ? token.email : null
        const lc = email
          ? await prisma.loyaltyCustomer.findUnique({ where: { email }, select: { id: true, pointsBalance: true } })
          : null
        if (lc) {
          const r = resolveLoyaltyCredit({
            customerPointsBalance: lc.pointsBalance,
            subtotalCents,
            commissionFeeCents:    grossCommissionCents,
            committedClaimsCents,
            promoApplied:          false,
            requestedUsePoints:    true,
          })
          if (r.creditCents > 0) loyalty = { creditCents: r.creditCents, pointsSpent: r.pointsSpent, customerId: lc.id }
        }
      } catch (loyErr) {
        console.error('[POST /api/orders] loyalty resolution failed (order proceeds without credit):', loyErr)
      }
    }

    // Ghost-orders fix: a CARD order must NEVER be visible to the resto before
    // its payment is SERVER-confirmed (webhook). It is created as
    // 'awaiting_payment' — the webhook flips it to 'received' at
    // payment_intent.succeeded, and THAT is when it appears in the resto's
    // Orders screen. Cash (and the legacy 'wallet' value) has no online payment
    // → visible at creation, the legitimate current flow.
    const initialStatus = data.paymentMethod === 'card' ? 'awaiting_payment' : 'received'

    // B5 (FRANCHISE_POS_TAGGING_ENABLED, default OFF): tag the order with its franchise
    // point of sale, DERIVED SERVER-SIDE from the linked restaurant (Restaurant.pointOfSaleId,
    // the 1:1 link from B2/B3) — NEVER from client input (createOrderSchema has no such
    // field). When OFF, this spread is empty → the create `data` below is BYTE-IDENTICAL to
    // before this brick (pointOfSaleId stays unset = null, exactly as today). When ON, a
    // non-franchised restaurant has pointOfSaleId=null → Order.pointOfSaleId=null (= today).
    // This is what re-activates Franchise-A accrual (still separately gated by
    // FRANCHISE_ROYALTY_ENABLED) and the franchise my-dashboard; nothing else changes.
    const franchisePosTag = isFranchisePosTaggingEnabled()
      ? { pointOfSaleId: restaurant.pointOfSaleId ?? null }
      : {}

    // Create order in DB (referralCode stored for reporting; 5B writes follow).
    const order = await prisma.order.create({
      data: {
        consumerId:      token.sub!,
        restaurantId:    data.restaurantId,
        items:           data.items as unknown as Prisma.InputJsonValue,
        subtotal,
        deliveryFee:     effectiveDeliveryFee,
        total:           foodTotal,
        fulfillmentType: data.fulfillmentType,
        deliveryAddress: data.deliveryAddress,
        paymentMethod:   data.paymentMethod,
        pointsEarned,
        referralCode:    ref.code,
        status:          initialStatus,
        ...franchisePosTag,
      },
    })

    // Dispatch to Uber Direct (mocked)
    const dispatch = await mockUberDirectDispatch(order.id)

    // Update order with tracking info + estimated time
    const updated = await prisma.order.update({
      where: { id: order.id },
      data:  {
        trackingUrl:   dispatch.trackingUrl,
        estimatedTime: dispatch.estimatedTime,
      },
    })

    // ── Promotion trace (P1) — BEST-EFFORT + COLUMN-TOLERANT ───────────────────
    // The applied promo (id + EUR amount) is written in a SEPARATE update so a
    // deployment that precedes the db push (Order.promotionId/discount columns
    // not in MySQL yet) logs and moves on — the order is already correct (the
    // discount is baked into `total` above), only the trace is missing.
    if (promo.id || promo.discountEur > 0 || ref.discount > 0) {
      try {
        await prisma.order.update({
          where: { id: order.id },
          data:  { promotionId: promo.id, discount: round2(ref.discount + promo.discountEur) },
        })
      } catch (traceErr) {
        console.error('[POST /api/orders] promotion trace write failed (column missing pre-db-push? order stays valid):',
          traceErr instanceof Error ? traceErr.message : traceErr)
      }
    }

    // ── Small-order fee application (V1.5) — TOLERANT post-create update ────────
    // Writes the fee column AND raises `total` by the fee TOGETHER, so the fee only
    // takes effect when it is durably recorded. Pre-db-push (column missing) the
    // update throws → caught → the order keeps the food-only total and the fee is
    // fully inert (no charge, nothing for /pay to split → resto unchanged). Points,
    // promos and the loyalty credit never touch the fee (it is added on top).
    let appliedSmallFeeCents = 0
    if (smallFeeCents > 0) {
      try {
        await prisma.order.update({
          where: { id: order.id },
          data:  { total: round2(foodTotal + smallFeeCents / 100), smallOrderFeeCents: smallFeeCents },
        })
        appliedSmallFeeCents = smallFeeCents
      } catch (feeErr) {
        console.error('[POST /api/orders] small-order fee column missing pre-db-push — fee NOT applied:',
          feeErr instanceof Error ? feeErr.message : feeErr)
      }
    }

    // ── Loyalty credit application (L1) — TOLERANT post-create update ───────────
    // Reduces the total (food + applied fee) by the credit AND records
    // pointsRedeemed/loyaltyCreditCents TOGETHER, so the credit only takes effect
    // when durably traced. Pre-db-push → throws → caught → loyalty fully inert.
    // Points are NOT debited here (D6 — the confirmed-payment webhook does that).
    let appliedCreditCents = 0
    let appliedPointsSpent = 0
    if (loyalty.creditCents > 0) {
      try {
        await prisma.order.update({
          where: { id: order.id },
          data:  {
            total:              Math.max(0, round2(foodTotal + appliedSmallFeeCents / 100 - loyalty.creditCents / 100)),
            pointsRedeemed:     loyalty.pointsSpent,
            loyaltyCreditCents: loyalty.creditCents,
          },
        })
        appliedCreditCents = loyalty.creditCents
        appliedPointsSpent = loyalty.pointsSpent
      } catch (loyErr) {
        console.error('[POST /api/orders] loyalty columns missing pre-db-push — credit NOT applied (order at full price):',
          loyErr instanceof Error ? loyErr.message : loyErr)
      }
    }

    // ── Adopted-dish sales (brique 5C) ─────────────────────────────────────────
    // For every ordered line whose MenuItem is tied to an ACTIVE DishAdoption,
    // record a real DishSale with FROZEN earnings — same freeze-at-write rule
    // already applied to ReferralOrder (never recomputed from config on read).
    //
    // BEST-EFFORT, on purpose: this runs AFTER the Order is committed and is NOT
    // wrapped together with it in a $transaction. A shared transaction would roll
    // the Order back if a DishSale insert failed, which would break checkout. The
    // absolute priority is that the customer is always served — so any failure in
    // this block is logged and swallowed, leaving the Order fully valid.
    try {
      // The /eat cart sends a COMPOSITE line id for customised dishes:
      // `${dishId}::${optionsSignature}` (see lineKeyFor in the restaurant page).
      // The DishAdoption.menuItemId stores the RAW MenuItem id, so we must match
      // on the raw id, not the composite line id — otherwise an adopted dish
      // ordered WITH options (size/extras) never matches and no DishSale is made.
      //
      // Raw id = the line's parentDishId when present (set by the cart whenever
      // the line carries options), else the part of itemId before "::" (robust:
      // a cuid never contains "::", so a plain line returns itself).
      const rawIdOf = (item: (typeof data.items)[number]): string => {
        const parent = item.options?.[0]?.parentDishId
        if (typeof parent === 'string' && parent.length > 0) return parent
        return item.itemId.split('::')[0]
      }
      const rawIds = data.items.map(rawIdOf)
      // One query (no N+1): the active adoptions whose menuItem is in this order.
      // We also pull the recipe owner's creatorId (via the CreatorDish relation) so
      // levier 1 can compare it to the referring creator without a second round-trip.
      const adoptions = await prisma.dishAdoption.findMany({
        where:  { status: 'active', menuItemId: { in: rawIds } },
        select: {
          id: true,
          menuItemId: true,
          creatorDishId: true,
          creatorDish: { select: { creatorId: true } },
        },
      })

      if (adoptions.length > 0) {
        // Anti-doublon: a DishSale is bound to orderId. If this order already
        // produced sales (route replayed), do nothing.
        const already = await prisma.dishSale.findFirst({
          where:  { orderId: order.id },
          select: { id: true },
        })
        if (!already) {
          // Read the single AdoptionConfig row once; fall back to launch defaults.
          const cfg = await prisma.adoptionConfig.findFirst({ where: { active: true } })
          // Levier 1: two rates instead of one. The FORT rate rewards a creator when
          // the sale of THEIR recipe comes from THEIR own referral traffic; every
          // other sale (organic, or another creator's traffic) earns the reduced one.
          // B0 fallbacks: adopted-recipe royalty = flat 2 % from Grubano's share
          // (both tiers 0.02, no Grubano cut) — the two-tier plumbing stays
          // parameterisable via AdoptionConfig.
          const referredPct = cfg?.creatorCommissionPctReferred ?? 0.02
          const organicPct  = cfg?.creatorCommissionPctOrganic  ?? 0.02
          const grubanoPct  = cfg?.grubanoCutPct ?? 0
          const round2 = (n: number) => Math.round(n * 100) / 100

          const byMenuItem = new Map(adoptions.map((a) => [a.menuItemId as string, a]))
          const sales: Prisma.DishSaleCreateManyInput[] = []
          const salesPerDish = new Map<string, number>()

          // One DishSale per matched order LINE (each customisation is a distinct
          // sale): same dish with different options counts as separate sales.
          for (const item of data.items) {
            const adoption = byMenuItem.get(rawIdOf(item))
            if (!adoption) continue // not an adopted dish → ignore this line
            // Levier 1 — pick the rate PER LINE by recipe: a sale earns the FORT rate
            // only when the referring creator (from 5B) IS the recipe's own creator.
            const recipeCreatorId = adoption.creatorDish.creatorId
            const isCreatorTraffic =
              ref.referringCreatorId !== null && ref.referringCreatorId === recipeCreatorId
            const rateApplied    = isCreatorTraffic ? referredPct : organicPct
            const amount         = round2(item.price * item.qty)        // CA of this line
            const creatorEarning = round2(amount * rateApplied)         // FROZEN
            const grubanoCut     = round2(creatorEarning * grubanoPct)  // FROZEN
            sales.push({ adoptionId: adoption.id, orderId: order.id, amount, creatorEarning, grubanoCut, rateApplied })
            salesPerDish.set(adoption.creatorDishId, (salesPerDish.get(adoption.creatorDishId) ?? 0) + 1)
          }

          if (sales.length > 0) {
            await prisma.dishSale.createMany({ data: sales })
            // Keep the denormalized CreatorDish.totalSales counter (read by the
            // public creator leaderboard) in sync with real sales.
            await Promise.all(
              Array.from(salesPerDish.entries()).map(([creatorDishId, count]) =>
                prisma.creatorDish.update({
                  where: { id: creatorDishId },
                  data:  { totalSales: { increment: count } },
                }),
              ),
            )
          }
        }
      }
    } catch (saleErr) {
      // Never break checkout because of adoption bookkeeping.
      console.error('[POST /api/orders] DishSale creation failed (order still valid):', saleErr)
    }

    // ── Referral writes (brique 5B) ────────────────────────────────────────────
    // Best-effort, AFTER the Order, and fully independent of the 5C DishSale block
    // above: a single order may legitimately produce BOTH a DishSale and a
    // ReferralOrder. Amounts are FROZEN at order time, never recomputed from config
    // on read (same rule as DishSale / the seed). A failure here is logged and
    // swallowed — the Order stays valid.
    try {
      // Expired window → close the binding, no payout.
      if (ref.expiredReferralId) {
        await prisma.referral.update({
          where: { id: ref.expiredReferralId },
          data:  { active: false },
        })
      }

      // CAS 1 → create the customer↔referrer binding with a FROZEN expiresAt. The
      // binding is a creator XOR an affiliate (Brique B) — never both.
      let referralId = ref.reuseReferralId
      if (ref.createReferralCreatorId) {
        const now = new Date()
        const created = await prisma.referral.create({
          data: {
            creatorId:  ref.createReferralCreatorId,
            customerId: token.sub!,
            codeUsed:   ref.code!,
            startedAt:  now,
            expiresAt:  new Date(now.getTime() + ref.durationDays * 24 * 60 * 60 * 1000),
            active:     true,
          },
        })
        referralId = created.id
      } else if (ref.createReferralAffiliateId) {
        // Brique B — affiliate binding: creatorId stays null, affiliateId = the
        // affiliate's operator id. Same expiresAt window as the creator rail.
        const now = new Date()
        const created = await prisma.referral.create({
          data: {
            affiliateId: ref.createReferralAffiliateId,
            customerId:  token.sub!,
            codeUsed:    ref.code!,
            startedAt:   now,
            expiresAt:   new Date(now.getTime() + ref.durationDays * 24 * 60 * 60 * 1000),
            active:      true,
          },
        })
        referralId = created.id
      }

      // CAS 1 or CAS 2-valid → one ReferralOrder (orderId @unique → anti-doublon).
      if (referralId) {
        const exists = await prisma.referralOrder.findUnique({ where: { orderId: order.id } })
        if (!exists) {
          // B0: the REAL Grubano commission for this order's channel — same
          // source of truth as the charge itself (lib/commission on the PRODUCT
          // subtotal: per-channel default 8 % pickup / 12 % delivery, per-resto
          // override, founders 0 %). Never a hardcoded rate again.
          const channel: CommissionChannel =
            data.fulfillmentType === 'pickup' ? 'pickup' : 'delivery'
          const feeCents       = computeApplicationFee(restaurant, channel, Math.round(subtotal * 100))
          const grubanoFee     = feeCents / 100                          // FROZEN — gross commission (EUR), column unchanged
          // V1.5 §4 — the referrer (creator OR affiliate) earns commissionPct of the
          // NET margin (commission − Stripe − royalty) = affiliateBaseCents, the SAME
          // base that sizes the loyalty cap. One positive base, so Grubano is never
          // net-negative. (affiliateBaseCents was computed above whenever a ReferralOrder
          // is written — willWriteReferralOrder ⟺ a creator OR affiliate referrer.) The
          // `creatorEarning` column holds the earning for EITHER rail (the referrer is
          // distinguished by referral.creatorId vs ReferralOrder.affiliateId).
          const creatorEarning = round2((affiliateBaseCents / 100) * ref.commissionPct) // FROZEN — on net (V1.5)
          // B0-quater acquisition bonus: CONFIG-driven (default 0 → no count
          // query, no write). When activated, paid once on the customer's FIRST
          // Grubano order (any restaurant), independent of the commission share.
          let newCustomerBonus = 0
          if (ref.bonusAmount > 0) {
            const priorOrders = await prisma.order.count({
              where: { consumerId: token.sub!, id: { not: order.id } },
            })
            newCustomerBonus = priorOrders === 0 ? ref.bonusAmount : 0
          }
          // Brique B — tag the accrual with the AFFILIATE (operator id) when the
          // referrer is an affiliate; a creator accrual leaves affiliateId null (the
          // creator is linked via referral.creatorId). EXACTLY one referrer per row.
          const affiliateTag = ref.referringAffiliateId ? { affiliateId: ref.referringAffiliateId } : {}
          await prisma.referralOrder.create({
            data: { referralId, orderId: order.id, grubanoFee, creatorEarning, newCustomerBonus, ...affiliateTag },
          })
        }
      }
    } catch (refErr) {
      // Never break checkout because of referral bookkeeping.
      console.error('[POST /api/orders] referral writes failed (order still valid):', refErr)
    }

    // ── Chef contribution stamp (Mission 1 Creator Studio) — BEST-EFFORT ─────
    // Pure STAT, zero financial impact: when the buyer came through a /chef
    // page (grubano_chef cookie, 24 h last-touch), stamp Order.chefSlug. The
    // affiliation blocks above are UNTOUCHED — this never creates a
    // ReferralOrder. Survives a missing column (deploy before db push): the
    // catch swallows everything, the order stays intact.
    try {
      const chefSlug = (req.cookies.get('grubano_chef')?.value ?? '').trim().toLowerCase()
      if (chefSlug) {
        const chef = await prisma.creator.findFirst({
          where:  { referralLinkSlug: chefSlug },
          select: { referralLinkSlug: true },
        })
        if (chef?.referralLinkSlug) {
          await prisma.order.update({
            where: { id: order.id },
            data:  { chefSlug: chef.referralLinkSlug },
          })
        }
      }
    } catch (chefErr) {
      console.error('[POST /api/orders] chef contribution stamp failed (order still valid):',
        chefErr instanceof Error ? chefErr.message : chefErr)
    }

    return NextResponse.json(
      {
        orderId:           updated.id,
        status:            updated.status,
        estimatedDelivery: dispatch.estimatedTime,
        trackingUrl:       dispatch.trackingUrl,
        // Final amount the customer will pay = food + small fee − loyalty credit.
        total:             Math.max(0, round2(foodTotal + appliedSmallFeeCents / 100 - appliedCreditCents / 100)),
        pointsEarned,
        // Total promo/welcome discount applied (never both, D6 guard).
        discount:          round2(ref.discount + promo.discountEur),
        // Small-order fee applied to this order (0 when items subtotal ≥ threshold — V1.5).
        smallOrderFee:     round2(appliedSmallFeeCents / 100),
        // Loyalty redemption applied to this order (0 when none — L1).
        loyaltyCredit:     round2(appliedCreditCents / 100),
        pointsRedeemed:    appliedPointsSpent,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    console.error('[POST /api/orders]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── GET /api/orders ───────────────────────────────────────────────────────────
// Returns the authenticated consumer's order history, newest first.

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req })
    if (!token) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const take   = Math.min(Number(searchParams.get('take') ?? 20), 50)
    const skip   = Number(searchParams.get('skip') ?? 0)
    const status = searchParams.get('status') ?? undefined

    const where: Prisma.OrderWhereInput = { consumerId: token.sub! }
    if (status) where.status = status

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id:              true,
          status:          true,
          total:           true,
          subtotal:        true,
          deliveryFee:     true,
          estimatedTime:   true,
          trackingUrl:     true,
          pointsEarned:    true,
          deliveryAddress: true,
          paymentMethod:   true,
          createdAt:       true,
          restaurant: {
            select: { id: true, name: true, logo: true, cuisine: true },
          },
        },
      }),
      prisma.order.count({ where }),
    ])

    return NextResponse.json({ orders, total, take, skip })
  } catch (err) {
    console.error('[GET /api/orders]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
