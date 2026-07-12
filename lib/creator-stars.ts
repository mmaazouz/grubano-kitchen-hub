import { prisma } from '@/lib/prisma'

// ── ⭐ Étoiles Grubano (Mission 4 Creator Studio) ───────────────────────────────
//
// DOCTRINE (decided, non-negotiable): the stars measure COMMERCIAL PERFORMANCE
// PROVEN BY THE LEDGER. Never sold, never hand-granted, never followers.
// 3 levels max. Computed ON THE FLY — zero migration, zero cron.
//
//   ⭐    ≥ 1 active adoption
//   ⭐⭐   ≥ STAR2_MIN_RESTAURANTS distinct active restaurants AND
//          ≥ STAR2_MIN_SALES matured sales
//   ⭐⭐⭐  ≥ STAR3_MIN_RESTAURANTS AND ≥ STAR3_MIN_SALES AND ≥ 1 matured sale
//          in the last STAR3_FRESH_DAYS days
//
// ONLY DishSale rows with status='matured' count: the B2a earnings engine is
// the anti-cheat — a refunded/cancelled sale never counts, a pending one not yet.
// Thresholds are env-overridable (exact MIN_VERIFIED_SUBS pattern) so they can
// be tuned without redeploying code.

export const STAR2_MIN_RESTAURANTS = Number(process.env.STAR2_MIN_RESTAURANTS) || 3
export const STAR2_MIN_SALES       = Number(process.env.STAR2_MIN_SALES)       || 100
export const STAR3_MIN_RESTAURANTS = Number(process.env.STAR3_MIN_RESTAURANTS) || 10
export const STAR3_MIN_SALES       = Number(process.env.STAR3_MIN_SALES)       || 1000
export const STAR3_FRESH_DAYS      = Number(process.env.STAR3_FRESH_DAYS)      || 30

export type CreatorStarsInput = {
  /** Distinct restaurants with an ACTIVE adoption of one of the creator's recipes. */
  activeRestaurants: number
  /** DishSale rows with status='matured' across all the creator's adoptions. */
  maturedSales: number
  /** At least one matured sale within the last STAR3_FRESH_DAYS days. */
  hasFreshSale: boolean
}

export type StarLevel = 0 | 1 | 2 | 3

export function computeCreatorStars(i: CreatorStarsInput): StarLevel {
  if (
    i.activeRestaurants >= STAR3_MIN_RESTAURANTS &&
    i.maturedSales      >= STAR3_MIN_SALES &&
    i.hasFreshSale
  ) return 3
  if (
    i.activeRestaurants >= STAR2_MIN_RESTAURANTS &&
    i.maturedSales      >= STAR2_MIN_SALES
  ) return 2
  if (i.activeRestaurants >= 1) return 1
  return 0
}

export type StarProgress = {
  /** The next reachable level — null at ⭐⭐⭐ (max). */
  nextStar: 1 | 2 | 3 | null
  missingRestaurants: number
  missingSales: number
}

/** Gamification: what separates the creator from the NEXT star. */
export function nextStarProgress(i: CreatorStarsInput): StarProgress {
  const stars = computeCreatorStars(i)
  if (stars >= 3) return { nextStar: null, missingRestaurants: 0, missingSales: 0 }
  if (stars === 2) return {
    nextStar: 3,
    missingRestaurants: Math.max(0, STAR3_MIN_RESTAURANTS - i.activeRestaurants),
    missingSales:       Math.max(0, STAR3_MIN_SALES       - i.maturedSales),
  }
  if (stars === 1) return {
    nextStar: 2,
    missingRestaurants: Math.max(0, STAR2_MIN_RESTAURANTS - i.activeRestaurants),
    missingSales:       Math.max(0, STAR2_MIN_SALES       - i.maturedSales),
  }
  return { nextStar: 1, missingRestaurants: Math.max(0, 1 - i.activeRestaurants), missingSales: 0 }
}

export type CreatorStarsEntry = { stars: StarLevel; input: CreatorStarsInput }

/**
 * Batched star computation for one or many creators — 2 grouped queries total,
 * no N+1 (built for /api/dishes/available where the catalogue spans creators).
 * SILENT DEGRADE: any DB error returns an empty map → callers fall back to 0
 * stars (absence is the public signal, never an error).
 */
export async function computeStarsForCreators(
  creatorIds: string[],
): Promise<Map<string, CreatorStarsEntry>> {
  const out = new Map<string, CreatorStarsEntry>()
  const ids = Array.from(new Set(creatorIds)).filter(Boolean)
  if (ids.length === 0) return out
  try {
    const freshSince = new Date(Date.now() - STAR3_FRESH_DAYS * 24 * 60 * 60 * 1000)

    const [adoptions, maturedSales] = await Promise.all([
      prisma.dishAdoption.findMany({
        where: { status: 'active', creatorDish: { creatorId: { in: ids } } },
        select: {
          brandId: true,
          brand:       { select: { restaurantId: true } },
          creatorDish: { select: { creatorId: true } },
        },
      }),
      prisma.dishSale.findMany({
        where: { status: 'matured', adoption: { creatorDish: { creatorId: { in: ids } } } },
        select: {
          maturedAt: true,
          createdAt: true,
          adoption: { select: { creatorDish: { select: { creatorId: true } } } },
        },
      }),
    ])

    // Distinct ACTIVE restaurants per creator (brand fallback when the brand has
    // no establishment link yet — still one distinct serving point).
    const restosByCreator = new Map<string, Set<string>>()
    for (const a of adoptions) {
      const cid = a.creatorDish.creatorId
      const key = a.brand?.restaurantId ?? `brand:${a.brandId}`
      const set = restosByCreator.get(cid) ?? new Set<string>()
      set.add(key)
      restosByCreator.set(cid, set)
    }

    const salesByCreator = new Map<string, number>()
    const freshByCreator = new Map<string, boolean>()
    for (const s of maturedSales) {
      const cid = s.adoption.creatorDish.creatorId
      salesByCreator.set(cid, (salesByCreator.get(cid) ?? 0) + 1)
      const when = s.maturedAt ?? s.createdAt
      if (when >= freshSince) freshByCreator.set(cid, true)
    }

    for (const cid of ids) {
      const input: CreatorStarsInput = {
        activeRestaurants: restosByCreator.get(cid)?.size ?? 0,
        maturedSales:      salesByCreator.get(cid) ?? 0,
        hasFreshSale:      freshByCreator.get(cid) ?? false,
      }
      out.set(cid, { stars: computeCreatorStars(input), input })
    }
    return out
  } catch (err) {
    console.error('[creator-stars] batch computation failed — degrading to 0 stars',
      err instanceof Error ? err.message : err)
    return new Map()
  }
}
