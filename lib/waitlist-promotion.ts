import { prisma } from '@/lib/prisma'
import { sendWaitlistOfferToRestaurant } from '@/lib/transactional-emails'

// ── Waitlist promotion mechanic (Mission 4, levier 3B completed) ───────────────
//
// The 'offered' state existed on the model with no flow. This module is the
// flow: when a city slot frees up (withdraw / decline / lazy expiry), the
// OLDEST 'waiting' entry for the SAME recipe in the SAME city becomes 'offered'
// (offeredAt + offerExpiresAt = now + TTL) and the restaurant is emailed.
//
// TTL is enforced AT READ TIME — no cron: an 'offered' row past its expiry is
// treated as 'expired' wherever it is read (accept/decline/available) and the
// promotion moves to the next in line at that moment, lazily.
//
// EVERYTHING here is BEST-EFFORT: a promotion or email failure never makes the
// calling action (withdraw, decline, catalogue read) fail.

export const WAITLIST_OFFER_TTL_HOURS = Number(process.env.WAITLIST_OFFER_TTL_HOURS) || 72

const HOUR = 60 * 60 * 1000

/** TTL check at read time. A row with neither date is NOT expired (legacy). */
export function offerExpired(w: { offeredAt: Date | null; offerExpiresAt: Date | null }, now = new Date()): boolean {
  if (w.offerExpiresAt) return w.offerExpiresAt.getTime() < now.getTime()
  if (w.offeredAt)      return w.offeredAt.getTime() + WAITLIST_OFFER_TTL_HOURS * HOUR < now.getTime()
  return false
}

/**
 * Expire stale offers for (recipe, city), then — if no live offer remains —
 * promote the oldest 'waiting' entry to 'offered' and email its restaurant.
 * Never throws.
 */
export async function sweepAndPromote(creatorDishId: string, city: string): Promise<void> {
  try {
    const cleanCity = (city ?? '').trim()
    if (!creatorDishId || !cleanCity) return

    // 1) Lazy expiry of stale offers (TTL at read).
    const offered = await prisma.adoptionWaitlist.findMany({
      where: { creatorDishId, city: cleanCity, status: 'offered' },
      select: { id: true, offeredAt: true, offerExpiresAt: true },
    })
    const now = new Date()
    const staleIds = offered.filter((w) => offerExpired(w, now)).map((w) => w.id)
    if (staleIds.length > 0) {
      await prisma.adoptionWaitlist.updateMany({
        where: { id: { in: staleIds } },
        data:  { status: 'expired' },
      })
    }

    // A live (non-expired) offer is still pending → nobody else to promote yet.
    if (offered.length > staleIds.length) return

    // 2) Promote the OLDEST waiting entry.
    const next = await prisma.adoptionWaitlist.findFirst({
      where:   { creatorDishId, city: cleanCity, status: 'waiting' },
      orderBy: { createdAt: 'asc' },
      select:  { id: true, brandId: true },
    })
    if (!next) return

    const offerExpiresAt = new Date(now.getTime() + WAITLIST_OFFER_TTL_HOURS * HOUR)
    await prisma.adoptionWaitlist.update({
      where: { id: next.id },
      data:  { status: 'offered', offeredAt: now, offerExpiresAt },
    })

    // 3) Email the promoted restaurant (best-effort inside best-effort).
    try {
      const [brand, dish] = await Promise.all([
        prisma.brand.findUnique({
          where:  { id: next.brandId },
          select: { name: true, operator: { select: { email: true } } },
        }),
        prisma.creatorDish.findUnique({
          where:  { id: creatorDishId },
          select: { name: true },
        }),
      ])
      if (brand?.operator?.email && dish) {
        await sendWaitlistOfferToRestaurant({
          to:             brand.operator.email,
          restaurantName: brand.name,
          dishName:       dish.name,
          city:           cleanCity,
          hours:          WAITLIST_OFFER_TTL_HOURS,
        })
      }
    } catch (err) {
      console.error('[waitlist-promotion] offer email failed (promotion kept)',
        err instanceof Error ? err.message : err)
    }
  } catch (err) {
    console.error('[waitlist-promotion] sweepAndPromote failed (action unaffected)',
      err instanceof Error ? err.message : err)
  }
}
