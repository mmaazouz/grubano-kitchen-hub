import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

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

    // Calculate totals
    const subtotal = data.items.reduce((sum, item) => sum + item.price * item.qty, 0)
    const total    = subtotal + restaurant.deliveryFee

    if (subtotal < restaurant.minOrder) {
      return NextResponse.json(
        { error: `Commande minimum: €${restaurant.minOrder.toFixed(2)}` },
        { status: 400 },
      )
    }

    // Points: 1 point per euro spent (rounded down)
    const pointsEarned = Math.floor(total)

    // Create order in DB
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
      const itemIds = data.items.map((i) => i.itemId)
      // One query (no N+1): the active adoptions whose menuItem is in this order.
      const adoptions = await prisma.dishAdoption.findMany({
        where:  { status: 'active', menuItemId: { in: itemIds } },
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

          for (const item of data.items) {
            const adoption = byMenuItem.get(item.itemId)
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

    return NextResponse.json(
      {
        orderId:           updated.id,
        status:            updated.status,
        estimatedDelivery: dispatch.estimatedTime,
        trackingUrl:       dispatch.trackingUrl,
        total:             updated.total,
        pointsEarned,
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
