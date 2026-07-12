import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// ── GET /api/chef-visit/[slug] — chef CONTRIBUTION tracking (Mission 1) ───────
//
// Structural mirror of /api/ref/[code] but STRICTLY SEPARATE — this is the
// pivot créateur/influenceur in code form:
//   - /api/ref      → influencer rail: grubano_ref cookie, 90 d FIRST-touch,
//                     feeds ReferralOrder (30 % of the commission). INTACT.
//   - /api/chef-visit → chef rail: grubano_chef cookie, 24 h LAST-touch, pure
//                     STAT (Order.chefSlug at checkout) — zero financial impact.
//
// LAST-TOUCH on purpose: the contribution measures the CURRENT buying session
// ("this purchase came through my page"), unlike the 90-day acquisition window
// of the affiliation. A new chef page visit overwrites the previous slug.
// This handler NEVER reads nor writes the grubano_ref cookie.
//
// Soft validation: an unknown slug redirects to /eat without a cookie — a
// stale link must never break the customer journey. Every CTA of the /chef
// page funnels through here: /api/chef-visit/{slug}?to=/{locale}/eat/r/{id}.

export const dynamic = 'force-dynamic'

const COOKIE_NAME   = 'grubano_chef'
const COOKIE_MAX_AGE = 24 * 60 * 60 // 24 h — the buying session, not a window
const DEFAULT_LOCALE = 'fr'

function pickLocale(req: NextRequest): string {
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  return cookieLocale && /^[a-z]{2}$/.test(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
}

/**
 * Resolve the optional `?to=` query param to a SAFE same-origin path.
 * Same strict whitelist as /api/ref (logic copied, not imported — it is
 * private to that handler and the rails must stay independent):
 *  - single leading `/` (no `//`, no absolute URL),
 *  - no `://` anywhere, never `/api/`.
 */
function pickToPath(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get('to')
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    /* keep raw */
  }
  if (decoded.length < 2 || decoded.length > 500) return null
  if (!decoded.startsWith('/')) return null
  if (decoded.startsWith('//')) return null
  if (decoded.startsWith('/api/')) return null
  if (decoded.includes('://')) return null
  return decoded
}

/** 307 with a RELATIVE Location (Passenger/o2switch reverse-proxy safe). */
function redirectRelative(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } })
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const locale = pickLocale(req)
  const fallback = `/${locale}/eat`
  const target = pickToPath(req) ?? fallback

  try {
    const raw = decodeURIComponent(params.slug ?? '').trim()
    if (!raw) return redirectRelative(fallback)

    // The chef page slug IS referralLinkSlug (a pure URL identifier, kept even
    // when the pure-creator role loses the affiliation CODE). Case-tolerant.
    const candidates = Array.from(new Set([raw, raw.toLowerCase()]))
    const creator = await prisma.creator.findFirst({
      where:  { referralLinkSlug: { in: candidates } },
      select: { referralLinkSlug: true },
    })
    if (!creator?.referralLinkSlug) {
      // Unknown slug → no cookie, journey continues.
      return redirectRelative(target)
    }

    const res = redirectRelative(target)
    res.cookies.set({
      name:     COOKIE_NAME,
      value:    creator.referralLinkSlug, // canonical slug
      maxAge:   COOKIE_MAX_AGE,
      path:     '/',
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    })
    return res
  } catch (err) {
    console.error('[GET /api/chef-visit/:slug]', err instanceof Error ? err.message : err)
    return redirectRelative(target)
  }
}
