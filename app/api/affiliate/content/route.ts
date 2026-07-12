import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { isInfluencerEnabled, isAffiliateVerified } from '@/lib/influencer-verification'
import { getAffiliateByOperator } from '@/lib/affiliate-account'
import { buildAffiliateLink, buildAffiliateRestaurantLink } from '@/lib/affiliate-link'
import { generateAffiliateCaptions, rateLimitCheck } from '@/lib/affiliate-content'
import { LlmQuotaError } from '@/lib/llm'

// ── POST /api/affiliate/content — content studio for the VERIFIED affiliate (INF-2) ───
// Operator-keyed TWIN of /api/creator/affiliate-content (which stays byte-identical). The
// studio is an advantage of the VERIFIED influencer: gated by INFLUENCER_ENABLED (404 OFF)
// + isAffiliateVerified(session operator) (403 otherwise). Owner-scoped: the operator is
// the SESSION operator id (never a client value). REUSES the same capped LLM gateway
// (generateAffiliateCaptions → llmComplete 'affiliate_caption', operatorId for QUOTA) and
// the same per-id rate-limit (cost control, NOT money). READ-ONLY on all data, ZERO money.
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
    if (!isInfluencerEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const session = await getServerSession(authOptions)
    const operatorId = (session?.user as { id?: string } | undefined)?.id
    if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    // Studio = a VERIFIED-influencer advantage. Non-verified affiliates are refused.
    if (!(await isAffiliateVerified(operatorId))) {
      return NextResponse.json({ error: 'Réservé aux influenceurs vérifiés', reason: 'not_verified' }, { status: 403 })
    }
    const affiliate = await getAffiliateByOperator(operatorId)
    if (!affiliate) return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 404 })

    // Rate-limit per affiliate operator (LLM cost) — same window as the creator rail.
    const rl = rateLimitCheck(operatorId)
    if (!rl.ok) return NextResponse.json({ error: 'rate_limited', retryAfterMs: rl.resetMs }, { status: 429 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    const { restaurantId, dishId } = parsed.data
    const locale = KNOWN_LOCALES.includes(parsed.data.locale ?? '') ? parsed.data.locale! : 'fr'

    // ── Target public info (READ-ONLY) ──────────────────────────────────────────
    const restaurant = await prisma.restaurant.findFirst({
      where:  { id: restaurantId, archivedAt: null },
      select: { id: true, name: true, cuisine: true, coverPhoto: true },
    })
    if (!restaurant) return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    const cuisine = Array.isArray(restaurant.cuisine)
      ? (restaurant.cuisine as unknown[]).filter(x => typeof x === 'string').slice(0, 2).join(', ')
      : null

    let dishName: string | null = null
    let dishPrice: number | null = null
    let dishPhoto: string | null = null
    if (dishId) {
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

    const link = buildAffiliateRestaurantLink(affiliate.referralLinkSlug, restaurantId, locale)
      ?? buildAffiliateLink(affiliate.referralLinkSlug)
      ?? ''
    const code = affiliate.referralCode ?? null

    const captions = await generateAffiliateCaptions({
      restaurantName: restaurant.name, cuisine, dishName, dishPrice, link, code, locale, operatorId,
    })
    if (!captions) return NextResponse.json({ error: 'generation_unavailable' }, { status: 502 })

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
      return NextResponse.json({ error: 'Limite IA atteinte, réessayez plus tard.' }, { status: 429 })
    }
    console.error('[POST /api/affiliate/content]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
