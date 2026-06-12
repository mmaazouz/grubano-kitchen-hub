import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeStarsForCreators } from '@/lib/creator-stars'
import { offerExpired, WAITLIST_OFFER_TTL_HOURS } from '@/lib/waitlist-promotion'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dishes/available  — catalogue of approved creator recipes a
// restaurateur can adopt onto their menu (brique 3C-1, read-only).
//
// For each recipe we expose the display fields + the creator's name/audience,
// plus `alreadyAdopted` = true when an ACTIVE DishAdoption already exists for
// (this recipe, one of the current operator's brands) — so the UI can show
// "Déjà à ta carte" instead of an Adopt button.
//
// City exclusivity (levier 3B) adds three flags per recipe, computed with
// grouped queries (no N+1) against the operator's restaurant city:
//   - cityTaken     : an ACTIVE adoption of this recipe by ANOTHER operator's
//                     brand in the SAME city (→ offer the waitlist instead).
//   - onWaitlist    : one of this operator's brands already queued (waiting|offered).
//   - waitlistCount : how many brands are 'waiting' for this recipe in this city.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['restaurant', 'admin']

export async function GET() {
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
    if (!ALLOWED_ROLES.includes(user.role ?? '')) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    // Approved recipes + their creator's public profile.
    const dishes = await prisma.creatorDish.findMany({
      where:   { status: 'approved' },
      include: { creator: { select: { name: true, followers: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // The operator's brands → which recipes they already actively adopted.
    const brands   = await prisma.brand.findMany({ where: { operatorId }, select: { id: true } })
    const brandIds = brands.map((b) => b.id)

    const activeAdoptions = brandIds.length
      ? await prisma.dishAdoption.findMany({
          where:  { brandId: { in: brandIds }, status: 'active' },
          select: { creatorDishId: true },
        })
      : []
    const adoptedDishIds = new Set(activeAdoptions.map((a) => a.creatorDishId))

    // ── City-exclusivity signals (levier 3B) — resolve the operator's city once ──
    // findFirst (not findUnique) so this no longer depends on Restaurant.operatorId
    // being unique (Option B step 3). Identical result while an operator has one resto.
    const restaurant = await prisma.restaurant.findFirst({
      where:  { operatorId, archivedAt: null },
      select: { city: true },
    })
    const myCity = (restaurant?.city ?? '').trim()

    // Recipes ACTIVELY adopted by ANOTHER operator's brand in my city → taken.
    // City resolved through the DIRECT Brand.restaurantId link (no transitive
    // operator.restaurant path, which would break at the cardinality flip).
    const cityAdoptions = myCity
      ? await prisma.dishAdoption.findMany({
          where: {
            status: 'active',
            brand:  { operatorId: { not: operatorId }, restaurant: { city: myCity } },
          },
          select: { creatorDishId: true },
        })
      : []
    const cityTakenIds = new Set(cityAdoptions.map((a) => a.creatorDishId))

    // Recipes one of MY brands already queued for (waiting|offered).
    const myWaitlist = brandIds.length
      ? await prisma.adoptionWaitlist.findMany({
          where:  { brandId: { in: brandIds }, status: { in: ['waiting', 'offered'] } },
          select: { creatorDishId: true },
        })
      : []
    const onWaitlistIds = new Set(myWaitlist.map((w) => w.creatorDishId))

    // How many brands are 'waiting' per recipe in my city (single grouped query).
    const waitlistGroups = myCity
      ? await prisma.adoptionWaitlist.groupBy({
          by:      ['creatorDishId'],
          where:   { city: myCity, status: 'waiting' },
          _count:  { _all: true },
        })
      : []
    const waitlistCountByDish = new Map(
      waitlistGroups.map((g) => [g.creatorDishId, g._count._all]),
    )

    // ── ADDITIVE (Mission 4) — live 'offered' state for MY brands ────────────────
    // The slot that just freed up: which recipes have a NON-EXPIRED 'offered'
    // entry for one of my brands, and how many hours are left (TTL at read).
    const now = new Date()
    const myOffers = brandIds.length
      ? await prisma.adoptionWaitlist.findMany({
          where:  { brandId: { in: brandIds }, status: 'offered' },
          select: { creatorDishId: true, offeredAt: true, offerExpiresAt: true },
        })
      : []
    const offerHoursByDish = new Map<string, number>()
    for (const o of myOffers) {
      if (offerExpired(o, now)) continue
      const exp = o.offerExpiresAt
        ?? (o.offeredAt ? new Date(o.offeredAt.getTime() + WAITLIST_OFFER_TTL_HOURS * 3_600_000) : null)
      const hoursLeft = exp
        ? Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 3_600_000))
        : WAITLIST_OFFER_TTL_HOURS
      offerHoursByDish.set(o.creatorDishId, hoursLeft)
    }

    // ── ADDITIVE (Mission 4) — ⭐ Étoiles Grubano per creator (batch, silent 0) ───
    const creatorIds = dishes.map((d) => d.creatorId)
    const starsByCreator = await computeStarsForCreators(creatorIds)

    // ── ADDITIVE (point dur E) — adoption conditions READ FROM CONFIG ────────────
    // No more « 2% / 60 jours / 300 € » hardcoded in the resto UI.
    let conditions = { commissionPct: 0.02, minCommitmentDays: 60, successThresholdEur: 300 }
    try {
      const cfg = await prisma.adoptionConfig.findFirst({
        where:   { active: true },
        orderBy: { createdAt: 'asc' },
        select:  { creatorCommissionPctReferred: true, minCommitmentDays: true, successThresholdEur: true },
      })
      if (cfg) {
        conditions = {
          commissionPct:       cfg.creatorCommissionPctReferred ?? 0.02,
          minCommitmentDays:   cfg.minCommitmentDays ?? 60,
          successThresholdEur: cfg.successThresholdEur ?? 300,
        }
      }
    } catch { /* keep safe defaults */ }

    const result = dishes.map((d) => ({
      id:               d.id,
      name:             d.name,
      description:      d.description,
      photo:            d.photo,
      cuisineType:      d.cuisineType,
      suggestedPrice:   d.suggestedPrice,
      commission:       d.commission,
      creatorName:      d.creator?.name ?? '',
      creatorFollowers: d.creator?.followers ?? 0,
      alreadyAdopted:   adoptedDishIds.has(d.id),
      cityTaken:        cityTakenIds.has(d.id),
      onWaitlist:       onWaitlistIds.has(d.id),
      waitlistCount:    waitlistCountByDish.get(d.id) ?? 0,
      // Mission 4 additive fields:
      creatorStars:     starsByCreator.get(d.creatorId)?.stars ?? 0,
      offerHoursLeft:   offerHoursByDish.get(d.id) ?? null,  // non-null ⇒ live 'offered'
    }))

    return NextResponse.json({ dishes: result, hasBrand: brandIds.length > 0, conditions })
  } catch (err) {
    console.error('[GET /api/dishes/available]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
