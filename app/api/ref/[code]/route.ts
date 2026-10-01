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
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { recordAffiliateClick } from '@/lib/affiliate-clicks'
import { isAttributionCookiesEnabled } from '@/lib/attribution-cookies'
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

/**
 * Drop the first-touch attribution cookie, SHARED by the creator and the
 * affiliate rails (Brique B2, Agent 61). Centralising it guarantees BOTH rails
 * write `grubano_ref` with byte-identical attributes (httpOnly / 90-day window
 * from ReferralConfig / SameSite=lax / path=/ / secure in prod) and the SAME
 * first-touch semantics — the first referrer wins, an existing cookie is never
 * overwritten. `code` is the CANONICAL referralCode (upper-case) the order path
 * (5B) looks up. This is the exact logic that was previously inlined for the
 * creator rail (steps 4-6) — behaviour is unchanged for creators.
 */
async function applyFirstTouchCookie(
  req: NextRequest,
  homePath: string,
  code: string,
): Promise<NextResponse> {
  // First-touch: keep an existing attribution if any (the first referrer wins).
  const existing = req.cookies.get(COOKIE_NAME)?.value
  if (existing && existing.trim().length > 0) {
    return redirectRelative(homePath)
  }

  // Resolve cookie lifetime from ReferralConfig (single row), 90-day fallback.
  let durationDays = FALLBACK_DURATION_DAYS
  try {
    const cfg = await prisma.referralConfig.findFirst({ select: { durationDays: true } })
    if (cfg && Number.isFinite(cfg.durationDays) && cfg.durationDays > 0) {
      durationDays = cfg.durationDays
    }
  } catch {
    /* fallback already in place */
  }

  const res = redirectRelative(homePath)
  // Lot 7 closed beta — attribution cookies are gated OFF by default
  // (ATTRIBUTION_COOKIES_ENABLED, règle « tracker non essentiel → OFF plutôt que
  // CMP »). ONLY the Set-Cookie is gated: the redirect, the code validation, the
  // affiliate click tracking and the first-touch semantics above stay byte-identical.
  if (isAttributionCookiesEnabled()) {
    res.cookies.set({
      name:     COOKIE_NAME,
      value:    code, // stored canonical, e.g. "DEMO20"
      maxAge:   durationDays * 24 * 60 * 60,
      path:     '/',
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    })
  }
  return res
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

  // 1-bis. Brique C (Agent 60) — best-effort, flag-gated, privacy-safe AFFILIATE click
  // tracking. Records a click ONLY when the code belongs to a top-level affiliate; stores
  // no PII. Wrapped + awaited in try/catch so a failure can NEVER affect the cookie or the
  // redirect below (those stay BYTE-IDENTICAL). Skipped entirely when AFFILIATE_ENABLED is
  // OFF. The cookie-drop itself is UNCHANGED (still creator-only) — an affiliate link's
  // cookie attribution is tracked separately as a follow-up; this only counts the click.
  if (isAffiliateEnabled()) {
    try {
      await recordAffiliateClick(upper)
    } catch (clickErr) {
      console.error('[GET /api/ref/:code] affiliate click record failed (non-fatal):',
        clickErr instanceof Error ? clickErr.message : clickErr)
    }
  }

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

  // 3. Not a CREATOR code. Brique B2 (Agent 61) — CLOSE THE AFFILIATE LOOP: when
  //    AFFILIATE_ENABLED is ON and the code belongs to a top-level AFFILIATE, drop
  //    the SAME first-touch cookie so the order path (5B) credits the affiliate
  //    (today the click is counted by Brique C but no cookie was ever set for an
  //    affiliate code). Resolution mirrors recordAffiliateClick EXACTLY (referralCode
  //    upper / referralLinkSlug lower) so the click and the cookie resolve to the
  //    SAME affiliate. Codes are unique cross-table (Brique A) and the creator is
  //    tried FIRST → one deterministic referrer. The cookie stores the canonical
  //    referralCode (upper-case), the value 5B looks up. Lookup is best-effort
  //    (a DB hiccup falls through to the unchanged no-cookie redirect).
  //    FLAG OFF / UNKNOWN code → byte-identical: no cookie, just redirect home.
  if (!creator || !creator.referralCode) {
    if (isAffiliateEnabled()) {
      let affiliate: { referralCode: string } | null = null
      try {
        affiliate = await prisma.affiliate.findFirst({
          where:  { OR: [{ referralCode: upper }, { referralLinkSlug: lower }] },
          select: { referralCode: true },
        })
      } catch (affErr) {
        console.error('[GET /api/ref/:code] affiliate lookup failed', affErr)
      }
      if (affiliate?.referralCode) {
        return applyFirstTouchCookie(req, homePath, affiliate.referralCode)
      }
    }
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

  // 4-6. Drop the creator attribution cookie via the SHARED helper (first-touch +
  //      ReferralConfig duration + identical cookie attributes). Behaviour is
  //      unchanged from the previous inline steps 4-6.
  return applyFirstTouchCookie(req, homePath, creator.referralCode)
}
