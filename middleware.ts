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

  // Public routes — no auth required. /eat/* is the consumer app (auth per-page).
  const publicRoots = ['/', '/login', '/register', '/design']
  const isPublic =
    publicRoots.includes(restPath) ||
    restPath.startsWith('/eat') ||
    restPath.startsWith('/api/auth')

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
    if (restPath.startsWith('/franchise') && !['franchise', 'admin'].includes(role)) return safeFallback()
    if (restPath.startsWith('/creators') && !['creator', 'admin'].includes(role)) return safeFallback()
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
