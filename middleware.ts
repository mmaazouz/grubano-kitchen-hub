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
    const home = () =>
      NextResponse.redirect(new URL(`/${activeLocale}`, request.url))

    if (restPath.startsWith('/dashboard') && !['restaurant', 'admin'].includes(role)) return home()
    if (restPath.startsWith('/franchise') && !['franchise', 'admin'].includes(role)) return home()
    if (restPath.startsWith('/creators') && !['creator', 'admin'].includes(role)) return home()
    if (restPath.startsWith('/account') && !['consumer', 'admin'].includes(role)) return home()
  }

  // Locale detection + redirect of unprefixed paths to /{locale}/...
  return intlMiddleware(request)
}

export const config = {
  // Exclude API routes, Next internals, and any path with a file extension
  // (favicons, images, manifest) so they are never locale-prefixed.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
