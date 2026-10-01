import { prisma } from '@/lib/prisma'

// ── Shared adoption mechanic (Mission 4) ───────────────────────────────────────
//
// MIRRORS the guards of POST /api/dishes/adopt EXACTLY (anti-duplicate, city
// exclusivity, commitment from config, MenuItem + DishAdoption transaction) so
// the waitlist-accept flow goes through the SAME business path. Adopt's own
// inline logic is deliberately LEFT UNTOUCHED (the additive-only constraint on
// that route): this helper is a faithful copy used ONLY by the new accept
// endpoint — the two must stay behaviourally identical. CHOICE NOTED in report.

const CONFIG_DEFAULTS = { minCommitmentDays: 60 }

export type AdoptResult =
  | { ok: true; adoption: { id: string }; menuItem: { id: string } }
  | { ok: false; status: number; body: Record<string, unknown> }

export async function adoptDish(input: {
  operatorId:    string
  isAdmin?:      boolean
  creatorDishId: string
  /** Target brand. Must belong to the operator (admins bypass ownership). */
  brandId:       string
  /** Explicit selling price; falls back to the recipe's suggestion. */
  sellingPrice?: number
}): Promise<AdoptResult> {
  const { operatorId, isAdmin, creatorDishId, brandId, sellingPrice } = input

  // Resolve the brand WITH its establishment city (Option B direct link).
  const brand = await prisma.brand.findFirst({
    where:   isAdmin ? { id: brandId } : { id: brandId, operatorId },
    include: { restaurant: { select: { city: true } } },
  })
  if (!brand) {
    return { ok: false, status: 403, body: { error: 'Marque introuvable ou non autorisée' } }
  }

  // Recipe must exist and be approved.
  const creatorDish = await prisma.creatorDish.findUnique({ where: { id: creatorDishId } })
  if (!creatorDish) {
    return { ok: false, status: 404, body: { error: 'Recette introuvable' } }
  }
  if (creatorDish.status !== 'approved') {
    return { ok: false, status: 400, body: { error: 'Cette recette n’est pas approuvée' } }
  }

  // Anti-duplicate: one active adoption per (recipe, brand).
  const existing = await prisma.dishAdoption.findFirst({
    where: { creatorDishId, brandId: brand.id, status: 'active' },
  })
  if (existing) {
    return { ok: false, status: 409, body: { error: 'Recette déjà adoptée par cette marque' } }
  }

  // City exclusivity (levier 3A): first restaurant in a city wins.
  const city = (brand.restaurant?.city ?? '').trim()
  if (city) {
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
      return {
        ok: false, status: 409,
        body: {
          ok: false, reason: 'city_taken', city,
          message: `Cette recette est déjà adoptée par un restaurant de ${city}. Exclusivité locale.`,
        },
      }
    }
  }

  // Commitment length from config (or safe default).
  const config = await prisma.adoptionConfig.findFirst({
    where:   { active: true },
    orderBy: { createdAt: 'asc' },
  })
  const minCommitmentDays = config?.minCommitmentDays ?? CONFIG_DEFAULTS.minCommitmentDays
  const price = sellingPrice ?? creatorDish.suggestedPrice
  const targetBrandId = brand.id

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

  return { ok: true, adoption, menuItem }
}
