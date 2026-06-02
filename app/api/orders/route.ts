import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

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
  // brique 5B: optional manual referral code. The `grubano_ref` cookie is the
  // primary source; this body field is a future-proof fallback for manual entry.
  // .optional() keeps the existing request contract intact.
  referralCode:    z.string().optional(),
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

    // Verify restaurant exists and is active
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: data.restaurantId, isActive: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable ou fermé' }, { status: 404 })
    }

    // Calculate totals. minOrder is enforced on the PRE-discount subtotal: the
    // customer genuinely ordered enough, so the referral welcome discount (5B)
    // applied below is a gift on top and must never retroactively block the order.
    const subtotal = data.items.reduce((sum, item) => sum + item.price * item.qty, 0)

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
    // GRUBANO_FEE_PCT mirrors scripts/seed-demo-data.js (Grubano's commission on
    // a basket) so the checkout freezes grubanoFee with the same rate the seed and
    // creator reporting assume.
    const GRUBANO_FEE_PCT = 0.10
    const ref = {
      code:                    null as string | null, // Order.referralCode — set whenever a valid creator code is seen, regardless of expiry
      discount:                0,                      // welcome discount, FIRST referred order only
      createReferralCreatorId: null as string | null, // CAS 1 → create a new Referral with this creator
      reuseReferralId:         null as string | null,  // CAS 2 (valid window) → reuse this referral for the ReferralOrder
      expiredReferralId:       null as string | null,  // CAS 2 (expired window) → deactivate, no payout
      commissionPct:           0.22,                    // ReferralConfig.commissionPctOfGrubanoFee
      durationDays:            90,                      // ReferralConfig.durationDays
    }
    try {
      const rawCode = (data.referralCode ?? req.cookies.get('grubano_ref')?.value ?? '').trim().toUpperCase()
      if (rawCode) {
        const creator = await prisma.creator.findFirst({ where: { referralCode: rawCode } })
        // Anti-self-referral: a creator cannot refer themselves. The Creator↔
        // Operator link is by EMAIL (there is no Creator.operatorId column), so we
        // compare the buyer's token email to the creator's email. If the token
        // carries no email we skip the self-check (best-effort) — to be refined if
        // a direct Creator→Operator FK is ever added.
        const buyerEmail = typeof token.email === 'string' ? token.email.toLowerCase() : null
        const isSelf = !!creator && !!buyerEmail && creator.email.toLowerCase() === buyerEmail
        if (creator && !isSelf) {
          const cfg = await prisma.referralConfig.findFirst({ where: { active: true } })
          ref.commissionPct = cfg?.commissionPctOfGrubanoFee ?? 0.22
          ref.durationDays  = cfg?.durationDays ?? 90
          const discountPct = cfg?.customerDiscountPct ?? 0.10
          const discountCap = cfg?.customerDiscountCapEur ?? 5
          ref.code = rawCode // tag the order for reporting, independent of expiry

          // Binding is per-customer: once a customer is linked to a creator via
          // first-touch, we stay on that link while it is active.
          const existing = await prisma.referral.findFirst({
            where: { customerId: token.sub!, active: true },
          })
          if (!existing) {
            // CAS 1 — first referred order for this customer → bind + discount.
            ref.createReferralCreatorId = creator.id
            ref.discount = round2(Math.min(subtotal * discountPct, discountCap))
          } else if (existing.expiresAt > new Date()) {
            // CAS 2 — window still open → reuse the binding, NO discount.
            ref.reuseReferralId = existing.id
          } else {
            // CAS 2 — window expired → no payout, no discount (close it later).
            ref.expiredReferralId = existing.id
          }
        }
      }
    } catch (refErr) {
      console.error('[POST /api/orders] referral resolution failed (order proceeds normally):', refErr)
    }

    // Apply the welcome discount to the paid total (clamped ≥ 0).
    const total        = Math.max(0, round2(subtotal + restaurant.deliveryFee - ref.discount))
    // Points: 1 point per euro actually spent (rounded down).
    const pointsEarned = Math.floor(total)

    // Create order in DB (referralCode stored for reporting; 5B writes follow).
    const order = await prisma.order.create({
      data: {
        consumerId:      token.sub!,
        restaurantId:    data.restaurantId,
        items:           data.items as unknown as Prisma.InputJsonValue,
        subtotal,
        deliveryFee:     restaurant.deliveryFee,
        total,
        deliveryAddress: data.deliveryAddress,
        paymentMethod:   data.paymentMethod,
        pointsEarned,
        referralCode:    ref.code,
        status:          'received',
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
      const adoptions = await prisma.dishAdoption.findMany({
        where:  { status: 'active', menuItemId: { in: rawIds } },
        select: { id: true, menuItemId: true, creatorDishId: true },
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
          const creatorPct = cfg?.creatorCommissionPct ?? 0.04
          const grubanoPct = cfg?.grubanoCutPct ?? 0.20
          const round2 = (n: number) => Math.round(n * 100) / 100

          const byMenuItem = new Map(adoptions.map((a) => [a.menuItemId as string, a]))
          const sales: Prisma.DishSaleCreateManyInput[] = []
          const salesPerDish = new Map<string, number>()

          // One DishSale per matched order LINE (each customisation is a distinct
          // sale): same dish with different options counts as separate sales.
          for (const item of data.items) {
            const adoption = byMenuItem.get(rawIdOf(item))
            if (!adoption) continue // not an adopted dish → ignore this line
            const amount         = round2(item.price * item.qty)        // CA of this line
            const creatorEarning = round2(amount * creatorPct)          // FROZEN
            const grubanoCut     = round2(creatorEarning * grubanoPct)  // FROZEN
            sales.push({ adoptionId: adoption.id, orderId: order.id, amount, creatorEarning, grubanoCut })
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

      // CAS 1 → create the customer↔creator binding with a FROZEN expiresAt.
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
      }

      // CAS 1 or CAS 2-valid → one ReferralOrder (orderId @unique → anti-doublon).
      if (referralId) {
        const exists = await prisma.referralOrder.findUnique({ where: { orderId: order.id } })
        if (!exists) {
          const grubanoFee     = round2(subtotal * GRUBANO_FEE_PCT)     // FROZEN
          const creatorEarning = round2(grubanoFee * ref.commissionPct) // FROZEN
          await prisma.referralOrder.create({
            data: { referralId, orderId: order.id, grubanoFee, creatorEarning },
          })
        }
      }
    } catch (refErr) {
      // Never break checkout because of referral bookkeeping.
      console.error('[POST /api/orders] referral writes failed (order still valid):', refErr)
    }

    return NextResponse.json(
      {
        orderId:           updated.id,
        status:            updated.status,
        estimatedDelivery: dispatch.estimatedTime,
        trackingUrl:       dispatch.trackingUrl,
        total:             updated.total,
        pointsEarned,
        discount:          ref.discount, // 5B: welcome discount applied (0 if none)
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
