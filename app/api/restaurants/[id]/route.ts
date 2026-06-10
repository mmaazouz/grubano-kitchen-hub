import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { geocodeAddressDetailed, isPlausibleAddress, type GeocodeStatus } from '@/lib/geocode'
import { publicHoursSummary, type PublicHours } from '@/lib/opening-hours'

// ── GET /api/restaurants/:id ──────────────────────────────────────────────────
// Returns full restaurant details + menu grouped by category

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    // Option B (step 3): the consumer menu is the brands attached to THIS
    // establishment via Brand.restaurantId — read the DIRECT link instead of the
    // transitive operator.brands path. Behaviour is identical today (the backfill
    // linked every brand to its operator's single restaurant), but the menu is now
    // scoped to the establishment, so it stays correct once an operator has several.
    // findFirst (not findUnique) so we can exclude archived establishments — an
    // archived (soft-deleted) restaurant must 404 on the consumer side too.
    const restaurant = await prisma.restaurant.findFirst({
      where:   { id: params.id, archivedAt: null },
      include: {
        brands: {
          select: {
            id:        true,
            name:      true,
            menuItems: {
              where:   { available: true },
              orderBy: [{ category: 'asc' }, { name: 'asc' }],
              select: {
                id:          true,
                name:        true,
                description: true,
                price:       true,
                comparePrice:true,
                category:    true,
                calories:    true,
                allergens:   true,
                labels:      true,
                photos:      true,
                options:     true,
                isPopular:   true,
                prepTime:    true,
              },
            },
          },
        },
      },
    })

    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    }

    // Flatten all menu items from this establishment's brands, grouped by category
    const allItems = restaurant.brands.flatMap(b =>
      b.menuItems.map(item => ({ ...item, brandId: b.id, brandName: b.name })),
    )

    // ── Creator attribution (levier 4-bis A1) ────────────────────────────────
    // Some menu items are ADOPTED creator recipes. We expose WHO signed each one
    // so the consumer menu can show a "Recette signée {créateur}" badge linking to
    // the creator's public profile. ADDITIVE: items without an active adoption are
    // returned exactly as before (no `creator` field). NO N+1 — every active
    // DishAdoption for the menu's items is preloaded in a single query, then mapped.
    // Defensive: any failure here degrades to a plain menu, never a 500.
    type ItemCreator = {
      id:        string
      name:      string
      verified:  boolean
      followers: number
      slug:      string | null
      dishPhoto: string | null
    }
    const creatorByMenuItem = new Map<string, ItemCreator>()
    try {
      const menuItemIds = allItems.map(i => i.id)
      if (menuItemIds.length > 0) {
        const adoptions = await prisma.dishAdoption.findMany({
          where:  { menuItemId: { in: menuItemIds }, status: 'active' },
          select: {
            menuItemId:  true,
            creatorDish: {
              select: {
                photo:   true,
                creator: {
                  select: {
                    id:               true,
                    name:             true,
                    verified:         true,
                    followers:        true,
                    referralLinkSlug: true,
                    referralCode:     true,
                  },
                },
              },
            },
          },
        })
        for (const a of adoptions) {
          if (!a.menuItemId || creatorByMenuItem.has(a.menuItemId)) continue
          const c = a.creatorDish?.creator
          if (!c) continue
          creatorByMenuItem.set(a.menuItemId, {
            id:        c.id,
            name:      c.name,
            verified:  c.verified,
            followers: c.followers,
            slug:      c.referralLinkSlug ?? c.referralCode ?? null,
            dishPhoto: a.creatorDish?.photo ?? null,
          })
        }
      }
    } catch (err) {
      // Never break the menu over the optional creator badge.
      console.error('[GET /api/restaurants/:id] creator attribution failed', err)
    }

    // ── Opening hours (Chantier horaires, additive) ───────────────────────────
    // The consumer badge/card data: configured?, open now?, next opening with a
    // French label, the weekly grid, and the PUBLIC reason of a blocking closure.
    // Nothing private. Defensive: a hours hiccup degrades to "not configured"
    // (no badge — current behaviour) and never breaks the restaurant card.
    let hours: PublicHours = {
      hoursConfigured: false, isOpenNow: null, nextOpening: null, weeklyHours: [], currentClosure: null,
    }
    try {
      hours = await publicHoursSummary(restaurant.id)
    } catch (err) {
      console.error('[GET /api/restaurants/:id] hours summary failed', err)
    }

    const categories = Array.from(new Set(allItems.map(i => i.category)))
    const menu = categories.map(cat => ({
      category: cat,
      items:    allItems
        .filter(i => i.category === cat)
        .map(i => {
          const creator = creatorByMenuItem.get(i.id)
          return creator ? { ...i, creator } : i
        }),
    }))

    return NextResponse.json({
      restaurant: {
        id:           restaurant.id,
        name:         restaurant.name,
        description:  restaurant.description,
        coverPhoto:   restaurant.coverPhoto,
        logo:         restaurant.logo,
        cuisine:      restaurant.cuisine,
        rating:       restaurant.rating,
        reviewCount:  restaurant.reviewCount,
        deliveryTime: restaurant.deliveryTime,
        minOrder:     restaurant.minOrder,
        deliveryFee:  restaurant.deliveryFee,
        city:         restaurant.city,
        address:      restaurant.address,
        lat:          restaurant.lat,
        lng:          restaurant.lng,
      },
      // Additive — consumer badge/card (Agent 13 étape 2). hoursConfigured=false
      // ⇒ no badge at all (T1.Q3 keeps unconfigured establishments untouched).
      hours,
      menu,
      itemCount: allItems.length,
    })
  } catch (err) {
    console.error('[GET /api/restaurants/:id]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PATCH /api/restaurants/:id ────────────────────────────────────────────────
// Operator-only profile update. When the address or city changes we re-geocode
// via the BAN and refresh lat/lng. Geocoding is a soft step — a miss saves
// the row with coords cleared so the backfill script can recover later.

const PatchInput = z.object({
  name:         z.string().min(1).max(120).optional(),
  description:  z.string().max(2000).nullable().optional(),
  cuisine:      z.array(z.string()).optional(),
  city:         z.string().min(1).max(100).optional(),
  address:      z.string().min(1).max(300).optional(),
  postalCode:   z.string().max(12).optional(),
  coverPhoto:   z.string().url().nullable().optional(),
  logo:         z.string().url().nullable().optional(),
  deliveryTime: z.number().int().min(0).max(180).optional(),
  minOrder:     z.number().min(0).max(500).optional(),
  deliveryFee:  z.number().min(0).max(50).optional(),
  isActive:     z.boolean().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })
    }

    const current = await prisma.restaurant.findUnique({
      where:  { id: params.id },
      select: { operatorId: true, address: true, city: true },
    })
    if (!current) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    }
    const isOwner = current.operatorId === operator.id
    const isAdmin = operator.role === 'admin'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const json   = await req.json().catch(() => ({}))
    const parsed = PatchInput.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { postalCode, ...input } = parsed.data

    // Address sanity check (vague 1 fix): when an address is supplied, reject an
    // implausible one (empty / too short / "gogo") before touching the DB.
    if (input.address !== undefined && !isPlausibleAddress(input.address)) {
      return NextResponse.json(
        { error: 'Adresse invalide — saisis une adresse complète (numéro et rue).', reason: 'invalid_address' },
        { status: 400 },
      )
    }

    // Re-geocode only if the address-bearing fields actually changed.
    const addressChanged =
      (input.address !== undefined && input.address !== current.address) ||
      (input.city    !== undefined && input.city    !== current.city)

    let geocoded: boolean | null = null
    let geocodeStatus: GeocodeStatus | null = null
    const data: Record<string, unknown> = { ...input }

    if (addressChanged) {
      const nextAddress = input.address ?? current.address
      const nextCity    = input.city    ?? current.city
      const geo         = await geocodeAddressDetailed(nextAddress, nextCity, postalCode)
      const coords      = geo.status === 'ok' ? geo.coords : null
      data.lat = coords?.latitude  ?? null
      data.lng = coords?.longitude ?? null
      geocoded = coords !== null
      geocodeStatus = geo.status
    }

    const restaurant = await prisma.restaurant.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json({ restaurant, geocoded, geocodeStatus })
  } catch (err) {
    console.error('[PATCH /api/restaurants/:id]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/restaurants/:id ───────────────────────────────────────────────
// Smart soft-delete, owner-scoped (the owning operator or an admin).
//   • establishment WITH order history → SOFT: archivedAt = now(), all data
//     preserved (sales history kept for accounting). It is then hidden from every
//     listing/aggregate (archivedAt = null filters).
//   • establishment with 0 orders → HARD delete, with a controlled, FK-safe
//     cascade of its attached (empty) brands/tables/menus — no orphan rows.
// Returns { mode: 'archived' | 'deleted' } so the UI shows the right message.

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })
    }

    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: params.id },
      select: { id: true, name: true, operatorId: true, archivedAt: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Établissement introuvable' }, { status: 404 })
    }
    const isOwner = restaurant.operatorId === operator.id
    const isAdmin = operator.role === 'admin'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    // Idempotent: an already-archived establishment stays archived.
    if (restaurant.archivedAt) {
      return NextResponse.json({
        mode: 'archived', id: restaurant.id, name: restaurant.name, alreadyArchived: true,
      })
    }

    const ordersCount = await prisma.order.count({ where: { restaurantId: restaurant.id } })

    // ── WITH history → archive (preserve sales data) ──────────────────────────
    if (ordersCount > 0) {
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data:  { archivedAt: new Date() },
      })
      return NextResponse.json({ mode: 'archived', id: restaurant.id, name: restaurant.name, ordersCount })
    }

    // ── EMPTY (0 orders) → hard delete, controlled FK-safe cascade ─────────────
    try {
      await prisma.$transaction(async (tx) => {
        // Tables + their reservations first (Reservation → RestaurantTable FK).
        const tables = await tx.restaurantTable.findMany({
          where:  { restaurantId: restaurant.id },
          select: { id: true },
        })
        const tableIds = tables.map(t => t.id)
        await tx.reservation.deleteMany({
          where: { OR: [{ restaurantId: restaurant.id }, { tableId: { in: tableIds } }] },
        })
        await tx.restaurantTable.deleteMany({ where: { restaurantId: restaurant.id } })

        // Brands of this establishment + everything that references them.
        const brands = await tx.brand.findMany({
          where:  { restaurantId: restaurant.id },
          select: { id: true },
        })
        const brandIds = brands.map(b => b.id)
        if (brandIds.length > 0) {
          const adoptions = await tx.dishAdoption.findMany({
            where:  { brandId: { in: brandIds } },
            select: { id: true },
          })
          const adoptionIds = adoptions.map(a => a.id)
          if (adoptionIds.length > 0) {
            await tx.dishSale.deleteMany({ where: { adoptionId: { in: adoptionIds } } })
          }
          await tx.dishAdoption.deleteMany({ where: { brandId: { in: brandIds } } })
          await tx.adoptionWaitlist.deleteMany({ where: { brandId: { in: brandIds } } })
          await tx.loyaltyOrder.deleteMany({ where: { brandId: { in: brandIds } } })
          await tx.promotion.deleteMany({ where: { brandId: { in: brandIds } } })
          await tx.stockItem.deleteMany({ where: { brandId: { in: brandIds } } })
          await tx.menuItem.deleteMany({ where: { brandId: { in: brandIds } } })
          // A PointOfSale belongs to a FRANCHISE operator — keep it, just unlink.
          await tx.pointOfSale.updateMany({
            where: { brandId: { in: brandIds } },
            data:  { brandId: null },
          })
          await tx.brand.deleteMany({ where: { restaurantId: restaurant.id } })
        }

        await tx.restaurant.delete({ where: { id: restaurant.id } })
      })
    } catch (err) {
      // A concurrent order (or any FK constraint) makes a hard delete unsafe →
      // fall back to archive so the operator's intent (remove from the UI) still
      // holds, with zero data loss.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        await prisma.restaurant.update({
          where: { id: restaurant.id },
          data:  { archivedAt: new Date() },
        })
        return NextResponse.json({ mode: 'archived', id: restaurant.id, name: restaurant.name, fallback: true })
      }
      throw err
    }

    return NextResponse.json({ mode: 'deleted', id: restaurant.id, name: restaurant.name })
  } catch (err) {
    console.error('[DELETE /api/restaurants/:id]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
