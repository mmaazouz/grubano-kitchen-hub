import createIntlMiddleware from 'next-intl/middleware'
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { locales, defaultLocale, type Locale } from './i18n'
import { isPartnerHostValue } from './lib/partner-host'
import { spacesForRoles } from './lib/role-spaces'

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: true,
})

// ── Operator portal FLAT routes (security hardening) ────────────────────────
// SINGLE SOURCE OF TRUTH for the restaurateur portal's flat routes. These are
// every top-level route AppChrome wraps in the operator Sidebar (everything NOT
// in its BARE_PREFIXES) — i.e. the restaurateur app minus /dashboard, which has
// kept its own gate since day one. Phase 4 hid these from the nav for a
// non-restaurateur, but they stayed reachable by direct URL; this list re-gates
// them to restaurant/admin (see the gate below). Kept EXPLICIT (not a
// "not-public" catch-all) so a future PUBLIC top-level route is never
// accidentally locked, and a new operator route is a deliberate one-line add.
//
// Deliberately EXCLUDED (handled elsewhere / public, must NOT be operator-gated):
//   /dashboard               → already gated restaurant/admin
//   /account                 → gated consumer/admin
//   /creators, /franchise    → gated via their /dashboard sub-routes
//   /supplier                → public landing + /register; /supplier/dashboard gated
//   /eat /business /t /chef /ref /auth/magic /login /register /design → public
const OPERATOR_FLAT_PREFIXES = [
  '/menu', '/orders', '/stocks', '/loyalty', '/promotions', '/analytics',
  '/brands', '/reviews', '/wallet', '/suppliers', '/tables', '/customers',
  '/notifications', '/cashflow', '/prep', '/onboarding', '/finance',
  '/pricing', '/marketplace', '/dinein', '/more', '/briefing', '/premium',
]

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

  // ── Partner-host routing (Brique 2C, Agent 12; landing added Agent 14) ──────
  // On the partner subdomain (business.grubano.com) the localed ROOT resolves to
  // the premium partner LANDING (/business) — its [Devenir partenaire] CTA leads to
  // the account-type choice (/business/start). /business/auth + /auth/magic stay
  // reachable directly. Host is read from x-forwarded-host first (o2switch /
  // Passenger reverse-proxy) then host, and matched via the single source of truth
  // lib/partner-host.ts (same env override PARTNER_REGISTER_ALLOW_HOST the partner
  // API uses). ADDITIVE: this only fires for isPartnerHostValue(host) — every OTHER
  // host (app/www.grubano.com) keeps the existing consumer / role-guard / dashboard
  // behaviour untouched. The bare root `/` is intentionally left to next-intl below:
  // it gets a detected locale first, then re-enters here as `/{locale}` in one hop.
  const hostHeader =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (isPartnerHostValue(hostHeader) && localeInPath && restPath === '/') {
    return NextResponse.redirect(new URL(`/${activeLocale}/business`, request.url))
  }

  // The /franchise and /creators ROOTS are public discovery/recruitment landing
  // pages — any visitor (any role, or none) must be able to see them, and anyone
  // may apply. Only the private /dashboard sub-routes keep a role-guard.
  const isFranchiseDashboard =
    restPath === '/franchise/dashboard' || restPath.startsWith('/franchise/dashboard/')
  const isCreatorsDashboard =
    restPath === '/creators/dashboard' || restPath.startsWith('/creators/dashboard/')
  // B2B supplier space (Slice 0 + 1). Matched with an EXACT '/supplier' or the
  // '/supplier/' prefix so it can NEVER catch the operator's '/suppliers' directory
  // (singular vs plural). Only the landing + self-serve registration are PUBLIC;
  // EVERYTHING ELSE under /supplier (dashboard, catalog, …) is gated supplier/admin.
  const isSupplierSpace =
    restPath === '/supplier' || restPath.startsWith('/supplier/')
  const isSupplierPublic =
    restPath === '/supplier' ||
    restPath === '/supplier/register' || restPath.startsWith('/supplier/register/')
  // Logistics partner space (P1, Agent 17): the courier dashboard at /logistics.
  // The self-serve REGISTER lives under /business/logistics/register (PUBLIC via the
  // /business allow-list); the /logistics tree itself is the AUTHENTICATED space and
  // is gated logistics/admin in full (NO public sub-route here), calqued on the
  // supplier gate. Distinct prefix from /business/logistics — never collides.
  const isLogisticsSpace =
    restPath === '/logistics' || restPath.startsWith('/logistics/')
  // Admin console (B2.4 / SEC2, Agent 33): the approval console at /admin. Gated
  // to ADMIN ONLY (defence in depth — every /admin page ALSO re-checks the session
  // role server-side). Exact '/admin' or the '/admin/' prefix. NO public sub-route.
  const isAdminSpace =
    restPath === '/admin' || restPath.startsWith('/admin/')

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
    // /legal/* are the PUBLIC legal pages (mentions légales, confidentialité…):
    // anyone, no session. Static content, rendered bare (AppChrome BARE_PREFIXES).
    restPath === '/legal' || restPath.startsWith('/legal/') ||
    restPath.startsWith('/api/auth') ||
    // Everything under /franchise and /creators is public EXCEPT the /dashboard
    // sub-routes (landing pages, /apply, etc. stay open to all).
    (restPath.startsWith('/franchise') && !isFranchiseDashboard) ||
    (restPath.startsWith('/creators') && !isCreatorsDashboard) ||
    // /supplier landing + /supplier/register are public (self-serve signup); every
    // other /supplier route (dashboard, catalog, …) is gated below. (Never matches
    // /suppliers — the operator directory — gated via OPERATOR_FLAT_PREFIXES.)
    (isSupplierSpace && isSupplierPublic)

  if (!isPublic) {
    const token = await getToken({ req: request })
    if (!token) {
      return NextResponse.redirect(new URL(`/${activeLocale}/login`, request.url))
    }

    // Phase 1 multi-role — gate on the role SET (token.roles), falling back to the
    // single legacy role for old JWTs / OAuth sign-ins. For a MONO-role account
    // `roles === [role]`, so every check below is byte-identical to the previous
    // `.includes(role)` behaviour (non-regression). A MULTI-role account is let
    // through as soon as ANY of its roles satisfies the route.
    const tokenRoles = (token as { roles?: unknown }).roles
    const roles: string[] = Array.isArray(tokenRoles)
      ? (tokenRoles as string[])
      : (typeof token.role === 'string' ? [token.role] : [])
    const hasAny = (allowed: string[]) => roles.some((r) => allowed.includes(r))

    // Send a role-mismatched user to the PUBLIC consumer app, which always
    // renders. Never bounce to the locale root (`/{locale}`) — that path
    // redirects to /dashboard, which re-triggers this guard → infinite loop.
    const safeFallback = () =>
      NextResponse.redirect(new URL(`/${activeLocale}/eat`, request.url))

    if (restPath.startsWith('/dashboard') && !hasAny(['restaurant', 'admin'])) return safeFallback()
    // A franchisee IS a restaurateur (Mohammed): restaurant + franchise + admin.
    // Bounce to the PUBLIC /franchise landing (not /eat) so the user lands on the
    // discovery page — that page is public, so this never loops.
    if (isFranchiseDashboard && !hasAny(['franchise', 'restaurant', 'admin']))
      return NextResponse.redirect(new URL(`/${activeLocale}/franchise`, request.url))
    if (isCreatorsDashboard && !hasAny(['creator', 'admin']))
      return NextResponse.redirect(new URL(`/${activeLocale}/creators`, request.url))
    // Supplier space (Slice 0 + 1): every /supplier route EXCEPT the public landing/
    // register requires supplier/admin (dashboard, catalog, …). A non-supplier is
    // sent to the HOME of their primary role (role-spaces) — its own space, always
    // a route that role can reach (no redirect loop).
    if (isSupplierSpace && !isSupplierPublic && !hasAny(['supplier', 'admin'])) {
      const home = spacesForRoles(roles)[0]?.href ?? '/eat'
      return NextResponse.redirect(new URL(`/${activeLocale}${home}`, request.url))
    }
    // Logistics space (P1): the courier dashboard requires logistics/admin. A non-
    // logistics user is sent to the HOME of their primary role (role-spaces) — its
    // own space, always reachable → no redirect loop. Calqued on the supplier gate.
    if (isLogisticsSpace && !hasAny(['logistics', 'admin'])) {
      const home = spacesForRoles(roles)[0]?.href ?? '/eat'
      return NextResponse.redirect(new URL(`/${activeLocale}${home}`, request.url))
    }
    // Admin console (B2.4): ADMIN only. A non-admin is sent to the HOME of their
    // primary role (role-spaces) — its own space, always reachable → no loop.
    if (isAdminSpace && !hasAny(['admin'])) {
      const home = spacesForRoles(roles)[0]?.href ?? '/eat'
      return NextResponse.redirect(new URL(`/${activeLocale}${home}`, request.url))
    }
    if (restPath.startsWith('/account') && !hasAny(['consumer', 'admin'])) return safeFallback()

    // ── Operator FLAT routes gate (security hardening — defence in depth) ──────
    // /menu, /stocks, /suppliers, … (OPERATOR_FLAT_PREFIXES) require the SAME
    // role set as /dashboard (restaurant/admin). A multi-role {…, restaurant}
    // passes (hasAny). A non-restaurateur is sent to the HOME of their primary
    // role (Phase-4 role-spaces) — its own space, never an operator screen they
    // cannot use, and always a route THAT role can reach (no redirect loop). The
    // four gates above are unchanged; this only CLOSES the un-gated flat routes.
    const isOperatorFlat = OPERATOR_FLAT_PREFIXES.some(
      (p) => restPath === p || restPath.startsWith(`${p}/`),
    )
    if (isOperatorFlat && !hasAny(['restaurant', 'admin'])) {
      const home = spacesForRoles(roles)[0]?.href ?? '/eat'
      return NextResponse.redirect(new URL(`/${activeLocale}${home}`, request.url))
    }
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
