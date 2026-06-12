/**
 * Creator referral capture — Brick 5A.
 *
 * GET /api/ref/{code} → validates the code against Creator.referralCode (or
 * Creator.referralLinkSlug), drops an attribution cookie, and redirects to the
 * consumer app. Per the 5A decision, the click does NOT create a Referral row:
 * binding happens at the first checkout (Brick 5B).
 *
 * Design choices:
 *  - **First-touch** attribution: if the user already carries a `grubano_ref`
 *    cookie, we keep it (rewards the creator who brought them first). Bad
 *    re-click never demotes an existing attribution.
 *  - **Soft validation**: an unknown / inactive code redirects to /eat without
 *    error and without a cookie — a stale link must never break the customer
 *    journey.
 *  - **Cookie window**: lifetime is read from `ReferralConfig.durationDays`
 *    (single global row) with a 90-day fallback. Same source-of-truth Agent 2
 *    uses for the Referral.expiresAt freeze.
 *  - **Cookie flags**: httpOnly (server-only at checkout in 5B, no JS access),
 *    sameSite=lax (survives the redirect + same-site navigation), secure in
 *    production, path=/ (visible to every later request).
 *  - **Idempotent**: re-clicking the same or another code never throws and
 *    never overwrites a first-touch attribution.
 *
 * Middleware: the next-intl matcher (middleware.ts) is `(!api|_next|_vercel|.*\..*).*` —
 * /api/* is excluded, so this handler is reached directly with no locale prefix.
 *
 * ── Fix (relative Location) ─────────────────────────────────────────────────
 * Behind the o2switch / Passenger reverse-proxy, `req.url` carries the INTERNAL
 * host (e.g. muscadier.o2switch.net:3000), not the public domain. Building
 * `new URL('/x', req.url)` produced absolute redirects pointing at the internal
 * host → ERR_CONNECTION_TIMED_OUT for the customer + the attribution cookie
 * never got applied. We now return a manual NextResponse with a **relative**
 * `Location` header so the browser resolves it against the public domain in
 * the address bar (works behind any reverse proxy, depends on no env var).
 * `res.cookies.set()` still works on a hand-rolled NextResponse — Next's
 * cookies layer writes to the response headers, not to redirect-only helpers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readCreatorRoles } from '@/lib/creator-roles'
import { locales, defaultLocale } from '@/i18n'

const COOKIE_NAME = 'grubano_ref'
const FALLBACK_DURATION_DAYS = 90

function pickLocale(req: NextRequest): string {
  // Honour an explicit NEXT_LOCALE cookie (set by the in-app language switcher
  // and by next-intl middleware). Fall back to the project default locale.
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
    return cookieLocale
  }
  return defaultLocale
}

/**
 * Resolve the optional `?to=` query param to a SAFE same-origin path.
 *
 * Used by the creator-public-page → restaurant funnel (Levier 4-bis B): the CTA
 * sends the visitor through /ref/{code}?to=/{locale}/eat/r/{restaurantId}, so
 * we both drop the attribution cookie AND land on the adopting restaurant.
 *
 * Strict whitelist to avoid open-redirect abuse:
 *  - Must start with a single `/` (no protocol-relative `//`, no absolute URL).
 *  - Must not contain `://` anywhere (defends against decoded `http://` etc.).
 *  - Must not start with `/api/` (we never want to round-trip the API).
 *
 * Returns the validated path, or `null` if missing/invalid (caller falls back).
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

/**
 * Build a 307 with a RELATIVE Location. The browser resolves it against the
 * public URL in the address bar — sidesteps the internal-host issue caused
 * by Passenger / o2switch's reverse-proxy.
 */
function redirectRelative(path: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: path },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const locale = pickLocale(req)
  // Funnel target: explicit ?to= path (whitelisted) wins over the default home.
  // This lets the creator public page send the visitor straight to the adopting
  // restaurant while still posting the attribution cookie on the same hop.
  const homePath = pickToPath(req) ?? `/${locale}/eat`

  // 1. Normalise the URL slug. Codes are usually stored upper-case ("DEMO20").
  let raw = ''
  try {
    raw = decodeURIComponent(params.code ?? '').trim()
  } catch {
    raw = (params.code ?? '').trim()
  }
  if (!raw) {
    return redirectRelative(homePath)
  }
  const upper = raw.toUpperCase()
  const lower = raw.toLowerCase()

  // 2. Look up the creator. The displayed link is grubano.com/ref/{slug} where
  //    slug is either `referralLinkSlug` (vanity) or `referralCode.toLowerCase()`
  //    (fallback) — see app/[locale]/creators/dashboard/audience/page.tsx. Try
  //    both fields with both casings; MySQL collation is usually case-insensitive
  //    but we don't want to depend on that.
  let creator: { id: string; referralCode: string | null; referralLinkSlug: string | null } | null = null
  try {
    creator = await prisma.creator.findFirst({
      where: {
        OR: [
          { referralCode: upper },
          { referralCode: raw },
          { referralLinkSlug: raw },
          { referralLinkSlug: lower },
        ],
      },
      select: { id: true, referralCode: true, referralLinkSlug: true },
    })
  } catch (err) {
    // DB hiccup → degrade gracefully (no cookie, just send the user home).
    console.error('[GET /api/ref/:code] lookup failed', err)
    return redirectRelative(homePath)
  }

  // 3. Unknown / no canonical referralCode → no attribution, but never block.
  if (!creator || !creator.referralCode) {
    return redirectRelative(homePath)
  }

  // 3-bis. ⚠️ FINANCIAL RAIL GATE (Mission 2 Creator Studio — the ONLY change
  // this mission is allowed to make in this file). The affiliation rail (this
  // cookie → ReferralOrder 30 %) belongs to the INFLUENCER role. A creator who
  // explicitly switched their influencer role OFF must not attribute anymore:
  // NO cookie, but the visitor's journey continues to the target untouched
  // (soft, same pattern as an unknown slug / as /api/chef-visit).
  // TOLERANT read (lib/creator-roles): the isInfluencer column not migrated
  // yet → considered TRUE — with the default-true flags, NOTHING changes at
  // deploy; this gate only ever bites a creator who opted out.
  // Cookie / first-touch / whitelist / redirect logic below: INTACT.
  const roleFlags = await readCreatorRoles(creator.id)
  if (roleFlags.isInfluencer === false) {
    return redirectRelative(homePath)
  }

  // 4. First-touch: keep an existing attribution if any.
  const existing = req.cookies.get(COOKIE_NAME)?.value
  if (existing && existing.trim().length > 0) {
    // Already attributed — leave the cookie untouched.
    return redirectRelative(homePath)
  }

  // 5. Resolve cookie lifetime from ReferralConfig (single row).
  let durationDays = FALLBACK_DURATION_DAYS
  try {
    const cfg = await prisma.referralConfig.findFirst({ select: { durationDays: true } })
    if (cfg && Number.isFinite(cfg.durationDays) && cfg.durationDays > 0) {
      durationDays = cfg.durationDays
    }
  } catch {
    /* fallback already in place */
  }

  // 6. Drop the attribution cookie (canonical referralCode, upper-case)
  //    on the same relative-redirect response.
  const res = redirectRelative(homePath)
  res.cookies.set({
    name:    COOKIE_NAME,
    value:   creator.referralCode, // stored canonical, e.g. "DEMO20"
    maxAge:  durationDays * 24 * 60 * 60,
    path:    '/',
    httpOnly: true,
    sameSite: 'lax',
    secure:  process.env.NODE_ENV === 'production',
  })
  return res
}
