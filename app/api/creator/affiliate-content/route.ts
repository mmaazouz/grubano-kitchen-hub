import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readCreatorRoles } from '@/lib/creator-roles'
import { buildAffiliateLink, buildAffiliateRestaurantLink } from '@/lib/affiliate-link'
import { generateAffiliateCaptions, rateLimitCheck } from '@/lib/affiliate-content'
import { LlmQuotaError } from '@/lib/llm'

// ── POST /api/creator/affiliate-content — Studio de contenu IA (Slice 2b) ──────
// Given a target (restaurant, optional dish), generate 2-3 caption variants with
// the influencer's affiliate deep link embedded, for the shareable card UI.
// Session-aware (Creator from the SESSION email, NEVER a ?creatorId → IDOR-safe),
// isInfluencer-gated, rate-limited (LLM cost), READ-ONLY on all data. Reuses the
// EXISTING LLM wiring (lib/affiliate-content → lib/creator-vetting pattern).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KNOWN_LOCALES = ['fr', 'en', 'es', 'it', 'ar']
const bodySchema = z.object({
  restaurantId: z.string().min(1),
  dishId:       z.string().min(1).optional(),
  locale:       z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, referralCode: true, referralLinkSlug: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 404 })
    }
    const roles = await readCreatorRoles(creator.id)
    if (!roles.isInfluencer) {
      return NextResponse.json({ error: 'Rôle influenceur requis' }, { status: 403 })
    }

    // Rate-limit per influencer (LLM cost) — clean 429 beyond the window cap.
    const rl = rateLimitCheck(creator.id)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: rl.resetMs },
        { status: 429 },
      )
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    const { restaurantId, dishId } = parsed.data
    const locale = KNOWN_LOCALES.includes(parsed.data.locale ?? '') ? parsed.data.locale! : 'fr'

    // ── Target public info (READ-ONLY) ──────────────────────────────────────────
    const restaurant = await prisma.restaurant.findFirst({
      where:  { id: restaurantId, archivedAt: null },
      select: { id: true, name: true, cuisine: true, coverPhoto: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    }
    const cuisine = Array.isArray(restaurant.cuisine)
      ? (restaurant.cuisine as unknown[]).filter(x => typeof x === 'string').slice(0, 2).join(', ')
      : null

    let dishName: string | null = null
    let dishPrice: number | null = null
    let dishPhoto: string | null = null
    if (dishId) {
      // Scope the dish to THIS restaurant's brands so a bad id can't leak another.
      const dish = await prisma.menuItem.findFirst({
        where:  { id: dishId, brand: { restaurantId } },
        select: { name: true, price: true, photos: true },
      })
      if (dish) {
        dishName  = dish.name
        dishPrice = dish.price
        const photos = Array.isArray(dish.photos) ? (dish.photos as unknown[]) : []
        dishPhoto = typeof photos[0] === 'string' ? (photos[0] as string) : null
      }
    }

    // Affiliate deep link (server origin → grubano.com), targeting the resto page.
    const link = buildAffiliateRestaurantLink(creator.referralLinkSlug, restaurantId, locale)
      ?? buildAffiliateLink(creator.referralLinkSlug)
      ?? ''
    const code = creator.referralCode ?? null

    // Per-partner LLM quota attribution: the influencer's own Operator (same session
    // email). Best-effort — undefined → no quota. Reuses the already-loaded session.
    const operatorId = (await prisma.operator
      .findUnique({ where: { email: session.user.email }, select: { id: true } })
      .catch(() => null))?.id

    const captions = await generateAffiliateCaptions({
      restaurantName: restaurant.name, cuisine, dishName, dishPrice, link, code, locale, operatorId,
    })
    if (!captions) {
      return NextResponse.json({ error: 'generation_unavailable' }, { status: 502 })
    }

    return NextResponse.json({
      captions,
      link,
      code,
      remaining: rl.remaining,
      target: {
        restaurantId,
        restaurantName: restaurant.name,
        dishId:   dishId ?? null,
        dishName,
        dishPrice,
        photo:    dishPhoto ?? restaurant.coverPhoto ?? null,
      },
    })
  } catch (err) {
    if (err instanceof LlmQuotaError) {
      return NextResponse.json({ error: 'Limite IA atteinte, réessaie plus tard.' }, { status: 429 })
    }
    console.error('[POST /api/creator/affiliate-content]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
