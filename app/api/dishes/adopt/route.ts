import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'

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
    let brand
    if (brandId) {
      brand = await prisma.brand.findFirst({ where: { id: brandId, operatorId } })
      if (!brand) {
        return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 403 })
      }
    } else {
      brand = await prisma.brand.findFirst({ where: { operatorId }, orderBy: { createdAt: 'asc' } })
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

    return NextResponse.json({ adoption, menuItem }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/dishes/adopt]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
