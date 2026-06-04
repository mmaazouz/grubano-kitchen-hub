import createIntlMiddleware from 'next-intl/middleware'
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { locales, defaultLocale, type Locale } from './i18n'

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

  // The /franchise and /creators ROOTS are public discovery/recruitment landing
  // pages — any visitor (any role, or none) must be able to see them, and anyone
  // may apply. Only the private /dashboard sub-routes keep a role-guard.
  const isFranchiseDashboard =
    restPath === '/franchise/dashboard' || restPath.startsWith('/franchise/dashboard/')
  const isCreatorsDashboard =
    restPath === '/creators/dashboard' || restPath.startsWith('/creators/dashboard/')

  // Metadata image routes (Next.js file conventions: opengraph-image,
  // twitter-image). These are crawled by social/search bots with no session and
  // MUST stay public — otherwise the auth gate 307-redirects them to /login and
  // every OG/Twitter card breaks. Matches both the locale-root images
  // (/{locale}/opengraph-image) and any nested segment's colocated image.
  const isMetadataImage =
    restPath === '/opengraph-image' ||
    restPath === '/twitter-image' ||
    restPath.endsWith('/opengraph-image') ||
    restPath.endsWith('/twitter-image')

  // Public routes — no auth required. /eat/* is the consumer app (auth per-page).
  const publicRoots = ['/', '/login', '/register', '/design']
  const isPublic =
    isMetadataImage ||
    publicRoots.includes(restPath) ||
    restPath.startsWith('/eat') ||
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
