import createIntlMiddleware from 'next-intl/middleware'
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { locales, defaultLocale, type Locale } from './i18n'
import { isPartnerHostValue } from './lib/partner-host'

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: true,
})

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Strip the leading locale segment so auth rules stay locale-agnostic.
  const segments = pathname.split('/')
  const localeInPath = locales.includes(segments[1] as Locale)
    ? (segments[1] as Locale)
    : null
  const rest = localeInPath ? '/' + segments.slice(2).join('/') : pathname
  const restPath = rest === '' ? '/' : rest
  const activeLocale = localeInPath ?? defaultLocale

  // ── Partner-host routing (Brique 2C, Agent 12) ──────────────────────────────
  // On the partner subdomain (business.grubano.com) the localed ROOT resolves to
  // the account-type chooser (/business/start) instead of the operator dashboard.
  // /business/auth stays reachable directly (the "Restaurateur" card / "Se
  // connecter" link point there). Host is read from
  // x-forwarded-host first (o2switch / Passenger reverse-proxy) then host, and
  // matched via the single source of truth lib/partner-host.ts (same env override
  // PARTNER_REGISTER_ALLOW_HOST the partner API uses). ADDITIVE: this only fires
  // for isPartnerHostValue(host) — every OTHER host (app/www.grubano.com) keeps
  // the existing consumer / role-guard / dashboard behaviour untouched. The bare
  // root `/` is intentionally left to next-intl below: it gets a detected locale
  // first, then re-enters here as `/{locale}` and is routed in one hop.
  const hostHeader =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (isPartnerHostValue(hostHeader) && localeInPath && restPath === '/') {
    return NextResponse.redirect(new URL(`/${activeLocale}/business/start`, request.url))
  }

  // The /franchise and /creators ROOTS are public discovery/recruitment landing
  // pages — any visitor (any role, or none) must be able to see them, and anyone
  // may apply. Only the private /dashboard sub-routes keep a role-guard.
  const isFranchiseDashboard =
    restPath === '/franchise/dashboard' || restPath.startsWith('/franchise/dashboard/')
  const isCreatorsDashboard =
    restPath === '/creators/dashboard' || restPath.startsWith('/creators/dashboard/')

  // Public routes — no auth required. /eat/* is the consumer app (auth per-page).
  const publicRoots = ['/', '/login', '/register', '/design']
  const isPublic =
    publicRoots.includes(restPath) ||
    restPath.startsWith('/eat') ||
    // /t/[tableId] is the PUBLIC consumer "table bill" QR landing (Sunday-style).
    // Exact /t or the /t/ prefix only — never matches /tables (operator dashboard).
    restPath === '/t' || restPath.startsWith('/t/') ||
    // /business/* is the PUBLIC partner space (auth/landing) — no session
    // required, exactly like /eat. The partner host root is routed here above.
    restPath.startsWith('/business') ||
    // /chef/[slug] is the PUBLIC creator (chef) page — Mission 1 Creator
    // Studio: a shareable audience-facing page, anonymous by nature.
    restPath === '/chef' || restPath.startsWith('/chef/') ||
    // /ref/[code] is the PUBLIC influencer attribution bridge. Discovered
    // GATED during Mission 1 verification: an anonymous first-time visitor
    // (the core attribution case) was bounced to /login BEFORE the cookie
    // dropped. Additive fix — the /ref handler logic itself is untouched.
    restPath === '/ref' || restPath.startsWith('/ref/') ||
    // /auth/magic is the PUBLIC passwordless sign-in page (Phase 0 auth bridge):
    // a visitor with no session clicks an email link here to authenticate. Scoped
    // to the EXACT path (not /auth/*) so a future /auth/<protected> stays gated.
    restPath === '/auth/magic' ||
    restPath.startsWith('/api/auth') ||
    // Everything under /franchise and /creators is public EXCEPT the /dashboard
    // sub-routes (landing pages, /apply, etc. stay open to all).
    (restPath.startsWith('/franchise') && !isFranchiseDashboard) ||
    (restPath.startsWith('/creators') && !isCreatorsDashboard)

  if (!isPublic) {
    const token = await getToken({ req: request })
    if (!token) {
      return NextResponse.redirect(new URL(`/${activeLocale}/login`, request.url))
    }

    const role = token.role as string
    // Send a role-mismatched user to the PUBLIC consumer app, which always
    // renders. Never bounce to the locale root (`/{locale}`) — that path
    // redirects to /dashboard, which re-triggers this guard → infinite loop.
    const safeFallback = () =>
      NextResponse.redirect(new URL(`/${activeLocale}/eat`, request.url))

    if (restPath.startsWith('/dashboard') && !['restaurant', 'admin'].includes(role)) return safeFallback()
    // A franchisee IS a restaurateur (Mohammed): restaurant + franchise + admin.
    // Bounce to the PUBLIC /franchise landing (not /eat) so the user lands on the
    // discovery page — that page is public, so this never loops.
    if (isFranchiseDashboard && !['franchise', 'restaurant', 'admin'].includes(role))
      return NextResponse.redirect(new URL(`/${activeLocale}/franchise`, request.url))
    if (isCreatorsDashboard && !['creator', 'admin'].includes(role))
      return NextResponse.redirect(new URL(`/${activeLocale}/creators`, request.url))
    if (restPath.startsWith('/account') && !['consumer', 'admin'].includes(role)) return safeFallback()
  }

  // Locale detection + redirect of unprefixed paths to /{locale}/...
  return intlMiddleware(request)
}

export const config = {
  // next-intl recommended matcher. Excludes:
  //   api      → API routes stay un-prefixed (/api/restaurants → 200)
  //   _next    → all Next internals (static, image, data, …)
  //   _vercel  → Vercel internals
  //   .*\..*   → any path with a file extension (favicon.ico, /images/*, manifest)
  // Already-localized paths (/fr, /en, …) ARE matched on purpose so next-intl
  // can resolve the active locale; it does NOT re-redirect them.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
