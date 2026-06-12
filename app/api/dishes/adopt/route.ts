import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { sendDishAdoptedToCreator } from '@/lib/transactional-emails'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dishes/adopt  — a restaurateur adopts an approved creator recipe.
//
// Brique 3B (adoption mechanic). On adoption we:
//   1. create a MenuItem in the brand's menu (inherited from the CreatorDish),
//   2. create the DishAdoption row (status=active, minCommitmentDays from config).
// Both inside a Prisma transaction so a partial adoption can never persist.
//
// The actual per-sale DishSale rows are produced later by the order flow
// (étape 5) — not here. This route only opens the adoption.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['restaurant', 'admin'] as const

// Safe defaults mirror AdoptionConfig's schema defaults, used when no active
// config row exists yet (e.g. before the first seed).
const CONFIG_DEFAULTS = {
  minCommitmentDays:    60,
  successThresholdEur:  300,
  creatorCommissionPct: 0.04,
  grubanoCutPct:        0.20,
}

const bodySchema = z.object({
  creatorDishId: z.string().min(1),
  brandId:       z.string().min(1).optional(),
  sellingPrice:  z.number().positive().optional(),
})

export async function POST(req: Request) {
  try {
    // ── Auth + role ─────────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const user       = session.user as { id?: string; role?: string }
    const operatorId = user.id
    if (!operatorId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.includes((user.role ?? '') as (typeof ALLOWED_ROLES)[number])) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    const { creatorDishId, brandId, sellingPrice } = bodySchema.parse(body)

    // ── Resolve the target brand ────────────────────────────────────────────────
    // If a brandId is supplied it must belong to this operator; otherwise we pick
    // the operator's first brand (admins still operate within a concrete brand).
    // Load the brand WITH its establishment's city (Option B direct link), so the
    // city-exclusivity check below no longer depends on Restaurant.operatorId being
    // unique.
    let brand
    if (brandId) {
      brand = await prisma.brand.findFirst({
        where:   { id: brandId, operatorId },
        include: { restaurant: { select: { city: true } } },
      })
      if (!brand) {
        return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 403 })
      }
    } else {
      brand = await prisma.brand.findFirst({
        where:   { operatorId },
        orderBy: { createdAt: 'asc' },
        include: { restaurant: { select: { city: true } } },
      })
      if (!brand) {
        return NextResponse.json({ error: 'Aucune marque pour ce compte' }, { status: 400 })
      }
    }

    // ── Validate the creator recipe ──────────────────────────────────────────────
    const creatorDish = await prisma.creatorDish.findUnique({ where: { id: creatorDishId } })
    if (!creatorDish) {
      return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    }
    if (creatorDish.status !== 'approved') {
      return NextResponse.json({ error: 'Cette recette n’est pas approuvée' }, { status: 400 })
    }

    // ── Anti-duplicate: one active adoption per (recipe, brand) ───────────────────
    const existing = await prisma.dishAdoption.findFirst({
      where: { creatorDishId, brandId: brand.id, status: 'active' },
    })
    if (existing) {
      return NextResponse.json({ error: 'Recette déjà adoptée par cette marque' }, { status: 409 })
    }

    // ── City exclusivity (levier 3A): first restaurant in a city wins ─────────────
    // Resolve the adopting brand's city via its DIRECT establishment link
    // (Brand.restaurantId, Option B step 3). No establishment / city on file
    // (e.g. an orphan brand) → can't enforce locality, so we DON'T block.
    const city = (brand.restaurant?.city ?? '').trim()
    if (city) {
      // Is the recipe already actively adopted by ANOTHER brand in the same city?
      const cityConflict = await prisma.dishAdoption.findFirst({
        where: {
          creatorDishId,
          status: 'active',
          brand:  { restaurant: { city } },
          NOT:    { brandId: brand.id },
        },
        select: { id: true },
      })
      if (cityConflict) {
        return NextResponse.json(
          {
            ok:      false,
            reason:  'city_taken',
            city,
            message: `Cette recette est déjà adoptée par un restaurant de ${city}. Exclusivité locale.`,
          },
          { status: 409 },
        )
      }
    }

    // ── Commitment length from config (or safe default) ───────────────────────────
    const config = await prisma.adoptionConfig.findFirst({
      where:   { active: true },
      orderBy: { createdAt: 'asc' },
    })
    const minCommitmentDays = config?.minCommitmentDays ?? CONFIG_DEFAULTS.minCommitmentDays

    // Price the menu entry: explicit sellingPrice wins, else the recipe's suggestion.
    const price = sellingPrice ?? creatorDish.suggestedPrice

    // Capture as a const so the narrowing survives inside the transaction closure
    // (TypeScript won't narrow a mutable `let` captured by a nested function).
    const targetBrandId = brand.id

    // ── Transaction: MenuItem + DishAdoption ──────────────────────────────────────
    const { adoption, menuItem } = await prisma.$transaction(async (tx) => {
      const menuItem = await tx.menuItem.create({
        data: {
          brandId:     targetBrandId,
          name:        creatorDish.name,
          description: creatorDish.description,
          photos:      creatorDish.photo ? [creatorDish.photo] : [],
          price,
          category:    creatorDish.cuisineType,
          available:   true,
        },
      })
      const adoption = await tx.dishAdoption.create({
        data: {
          creatorDishId,
          brandId:           targetBrandId,
          menuItemId:        menuItem.id,
          sellingPrice:      price,
          minCommitmentDays,
          status:            'active',
        },
      })
      return { adoption, menuItem }
    })

    // ── ADDITIVE (Mission 4, point H) — notify the creator, BEST-EFFORT ───────────
    // Pattern 5C: a try/catch that NEVER lets an email failure fail the adoption.
    // The royalty pct is read from AdoptionConfig (never hardcoded): B0 sets both
    // tiers to 0.02 — we surface the "referred" tier as the headline rate.
    try {
      const creator = await prisma.creator.findUnique({
        where:  { id: creatorDish.creatorId },
        select: { email: true, name: true },
      })
      if (creator?.email) {
        const royaltyPct = config?.creatorCommissionPctReferred
          ?? config?.creatorCommissionPct
          ?? CONFIG_DEFAULTS.creatorCommissionPct
        await sendDishAdoptedToCreator({
          to:             creator.email,
          creatorName:    creator.name ?? '',
          restaurantName: brand.name,
          city,
          dishName:       creatorDish.name,
          priceEur:       price,
          royaltyPct,
        })
      }
    } catch (err) {
      console.error('[POST /api/dishes/adopt] creator notification failed (adoption kept)',
        err instanceof Error ? err.message : err)
    }

    return NextResponse.json({ adoption, menuItem }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/dishes/adopt]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
