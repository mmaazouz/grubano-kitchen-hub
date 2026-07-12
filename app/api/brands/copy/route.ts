import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/brands/copy — duplicate an existing brand (with its menu) into one
// of the operator's establishments. Option B (commit 5C).
//
// What is copied (inside ONE Prisma transaction):
//   • the Brand: new id, SAME operatorId, restaurantId = the target establishment,
//     copying name/emoji/platform/cuisineType/tagline, status forced to 'active'.
//     The franchise flags (openToFranchise / royaltyPct / setupFee /
//     franchiseZones / avgMonthlyRevenue / franchiseStatus) are intentionally NOT
//     copied — they fall back to their safe defaults so we never franchise a
//     brand by accident.
//   • the MenuItems of the source brand, EXCEPT the ones tied to an ACTIVE
//     DishAdoption (adopted creator recipes). Cloning those would create phantom
//     adoptions AND bypass the city-exclusivity control (levier 3). They are
//     returned to the caller so the UI can offer a proper re-adoption (which
//     re-runs POST /api/dishes/adopt and its city_taken check).
//
// What is NOT copied: DishAdoption, DishSale, AdoptionWaitlist, Promotion,
// StockItem, Order / LoyaltyOrder, PointOfSale.
//
// Security: auth + ownership. operatorId comes from the session, NEVER the body.
// Both the source brand AND the target establishment must belong to the caller.
// ─────────────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  sourceBrandId:      z.string().min(1),
  targetRestaurantId: z.string().min(1),
})

async function callerOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
}

export async function POST(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    const { sourceBrandId, targetRestaurantId } = parsed.data

    // Ownership — both ends must belong to the caller (operatorId from session).
    const [sourceBrand, targetRestaurant] = await Promise.all([
      prisma.brand.findFirst({ where: { id: sourceBrandId, operatorId: operator.id } }),
      prisma.restaurant.findFirst({
        where:  { id: targetRestaurantId, operatorId: operator.id },
        select: { id: true },
      }),
    ])
    if (!sourceBrand) {
      return NextResponse.json({ error: 'Marque source introuvable' }, { status: 404 })
    }
    if (!targetRestaurant) {
      return NextResponse.json({ error: 'Établissement cible introuvable' }, { status: 404 })
    }

    // Source menu + the menu items tied to an ACTIVE adoption (to exclude).
    const [sourceMenu, activeAdoptions] = await Promise.all([
      prisma.menuItem.findMany({ where: { brandId: sourceBrand.id } }),
      prisma.dishAdoption.findMany({
        where:  { brandId: sourceBrand.id, status: 'active' },
        select: {
          menuItemId:    true,
          creatorDishId: true,
          sellingPrice:  true,
          menuItem:      { select: { name: true } },
        },
      }),
    ])
    const excludedIds = new Set(
      activeAdoptions.map((a) => a.menuItemId).filter((x): x is string => !!x),
    )
    const cloneable = sourceMenu.filter((m) => !excludedIds.has(m.id))

    const newBrand = await prisma.$transaction(async (tx) => {
      const brand = await tx.brand.create({
        data: {
          operatorId:   operator.id,
          restaurantId: targetRestaurant.id,
          name:         sourceBrand.name,
          emoji:        sourceBrand.emoji,
          platform:     sourceBrand.platform,
          cuisineType:  sourceBrand.cuisineType,
          tagline:      sourceBrand.tagline,
          status:       'active',
          // franchise flags intentionally left at their safe defaults.
        },
      })

      if (cloneable.length > 0) {
        await tx.menuItem.createMany({
          data: cloneable.map((m): Prisma.MenuItemCreateManyInput => ({
            brandId:      brand.id,
            name:         m.name,
            description:  m.description,
            price:        m.price,
            comparePrice: m.comparePrice,
            category:     m.category,
            calories:     m.calories,
            allergens:    m.allergens as Prisma.InputJsonValue,
            labels:       m.labels as Prisma.InputJsonValue,
            photos:       m.photos as Prisma.InputJsonValue,
            options:      m.options as Prisma.InputJsonValue,
            available:    m.available,
            isPopular:    m.isPopular,
            prepTime:     m.prepTime,
          })),
        })
      }

      return brand
    })

    // Adopted dishes that were excluded — offered back for proper re-adoption.
    const excludedAdoptions = activeAdoptions
      .filter((a) => a.menuItemId)
      .map((a) => ({
        creatorDishId: a.creatorDishId,
        name:          a.menuItem?.name ?? '',
        sellingPrice:  a.sellingPrice,
      }))

    return NextResponse.json(
      {
        brand:            newBrand,
        copiedMenuCount:  cloneable.length,
        excludedAdoptions,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/brands/copy]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
