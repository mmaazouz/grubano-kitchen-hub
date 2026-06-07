import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// ── /api/restaurants/[id]/fulfillment ─────────────────────────────────────────
// Operator-only endpoint for managing a restaurant's fulfillment settings
// (delivery / pickup / reservation toggles, prep times, pickup info).
//
// GET   → returns the current settings
// POST  → updates settings (validated). Only the owning operator or an admin
//         may modify their own restaurant.

const FulfillmentInput = z.object({
  deliveryEnabled:    z.boolean().optional(),
  pickupEnabled:      z.boolean().optional(),
  reservationEnabled: z.boolean().optional(),
  deliveryRadius:     z.number().int().min(0).max(50).optional(),
  pickupPrepTime:     z.number().int().min(0).max(180).optional(),
  deliveryPrepTime:   z.number().int().min(0).max(180).optional(),
  pickupAddress:      z.string().max(500).nullable().optional(),
  pickupInstructions: z.string().max(2000).nullable().optional(),
  // Default table-hold duration (minutes) used to pre-fill the reservation modal.
  // Bounded 15..600; a reservation can still override it at creation time.
  defaultReservationDurationMin: z.number().int().min(15).max(600).optional(),
})

// Pull only the fulfillment-relevant columns when returning to the client.
const SELECT_FULFILLMENT = {
  id:                 true,
  name:               true,
  operatorId:         true,
  deliveryEnabled:    true,
  pickupEnabled:      true,
  reservationEnabled: true,
  deliveryRadius:     true,
  pickupPrepTime:     true,
  deliveryPrepTime:   true,
  pickupAddress:      true,
  pickupInstructions: true,
  defaultReservationDurationMin: true,
} as const

// Confirm the session user owns the restaurant (or is admin). Returns the
// owning operator's id on success, or a NextResponse on failure that the
// caller should return immediately.
async function authorize(restaurantId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }

  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { operatorId: true },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }

  const isOwner = restaurant.operatorId === operator.id
  const isAdmin = operator.role === 'admin'
  if (!isOwner && !isAdmin) {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }

  return { operatorId: operator.id }
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error

    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: params.id },
      select: SELECT_FULFILLMENT,
    })
    return NextResponse.json({ restaurant })
  } catch (err) {
    console.error('[fulfillment GET]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error

    const json   = await req.json().catch(() => ({}))
    const parsed = FulfillmentInput.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // Cross-field rule: at least one fulfillment channel must remain enabled.
    // We can only check this when the caller sends one of the toggles.
    const data = parsed.data
    const touchedToggles =
      data.deliveryEnabled !== undefined ||
      data.pickupEnabled !== undefined ||
      data.reservationEnabled !== undefined
    if (touchedToggles) {
      const current = await prisma.restaurant.findUnique({
        where: { id: params.id },
        select: {
          deliveryEnabled:    true,
          pickupEnabled:      true,
          reservationEnabled: true,
        },
      })
      const next = {
        deliveryEnabled:    data.deliveryEnabled    ?? current!.deliveryEnabled,
        pickupEnabled:      data.pickupEnabled      ?? current!.pickupEnabled,
        reservationEnabled: data.reservationEnabled ?? current!.reservationEnabled,
      }
      if (!next.deliveryEnabled && !next.pickupEnabled && !next.reservationEnabled) {
        return NextResponse.json(
          { error: 'Au moins un mode (livraison, à emporter ou réservation) doit rester actif.' },
          { status: 400 },
        )
      }
    }

    const restaurant = await prisma.restaurant.update({
      where:  { id: params.id },
      data,
      select: SELECT_FULFILLMENT,
    })
    return NextResponse.json({ restaurant })
  } catch (err) {
    console.error('[fulfillment POST]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
