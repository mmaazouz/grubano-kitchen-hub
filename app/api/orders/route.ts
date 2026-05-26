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
