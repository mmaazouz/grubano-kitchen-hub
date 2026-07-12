import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { adoptDish } from '@/lib/dish-adoption'
import { offerExpired, sweepAndPromote } from '@/lib/waitlist-promotion'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dishes/waitlist/accept  — a waitlisted restaurant takes the freed
// city-exclusive slot (Mission 4, levier 3B completed).
//
// Path: find this brand's 'offered' entry for the recipe → TTL check AT READ
// (offered + WAITLIST_OFFER_TTL_HOURS exceeded ⇒ treat as expired, mark it,
// promote the next, return 409/expired) → create the adoption via the SAME
// business path as /adopt (adoptDish: anti-duplicate + city exclusivity — if
// someone adopted in between, 409 propagated) → mark the entry 'accepted'.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['restaurant', 'admin'] as const

const bodySchema = z.object({
  creatorDishId: z.string().min(1),
  brandId:       z.string().min(1).optional(),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const user       = session.user as { id?: string; role?: string }
    const operatorId = user.id
    if (!operatorId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const isAdmin = user.role === 'admin'
    if (!ALLOWED_ROLES.includes((user.role ?? '') as (typeof ALLOWED_ROLES)[number])) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const { creatorDishId, brandId } = bodySchema.parse(body)

    // Resolve the brand (same as adopt) — needed to scope the waitlist entry.
    const brand = brandId
      ? await prisma.brand.findFirst({
          where:  isAdmin ? { id: brandId } : { id: brandId, operatorId },
          select: { id: true, restaurant: { select: { city: true } } },
        })
      : await prisma.brand.findFirst({
          where:   { operatorId },
          orderBy: { createdAt: 'asc' },
          select:  { id: true, restaurant: { select: { city: true } } },
        })
    if (!brand) {
      return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 403 })
    }

    // The 'offered' entry for this (recipe, brand).
    const entry = await prisma.adoptionWaitlist.findFirst({
      where:  { creatorDishId, brandId: brand.id, status: 'offered' },
      select: { id: true, city: true, offeredAt: true, offerExpiresAt: true },
    })
    if (!entry) {
      return NextResponse.json(
        { error: 'Aucune offre d’exclusivité en cours pour cette recette.', code: 'no_offer' },
        { status: 409 },
      )
    }

    // TTL check at READ — an expired offer is closed and the next is promoted.
    if (offerExpired(entry)) {
      await prisma.adoptionWaitlist.update({ where: { id: entry.id }, data: { status: 'expired' } })
      // Lazy promotion of the next in line (best-effort).
      await sweepAndPromote(creatorDishId, entry.city)
      return NextResponse.json(
        { error: 'L’offre d’exclusivité a expiré (72 h dépassées).', code: 'expired' },
        { status: 409 },
      )
    }

    // Create the adoption via the SAME business path as /adopt.
    const result = await adoptDish({ operatorId, isAdmin, creatorDishId, brandId: brand.id })
    if (!result.ok) {
      // e.g. the slot was taken in between → 409 city_taken, surfaced verbatim.
      return NextResponse.json(result.body, { status: result.status })
    }

    // Mark the waitlist entry accepted (the offer was honoured).
    await prisma.adoptionWaitlist.update({ where: { id: entry.id }, data: { status: 'accepted' } })

    return NextResponse.json({ ok: true, adoption: result.adoption, menuItem: result.menuItem }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/dishes/waitlist/accept]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
