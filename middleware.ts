import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request })
  const { pathname } = request.nextUrl

  // Public routes — no auth required
  const publicRoutes = ['/', '/login', '/register', '/api/auth']
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Not authenticated → redirect to login
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const role = token.role as string

  // Role-based route enforcement
  if (pathname.startsWith('/dashboard') && !['restaurant', 'admin'].includes(role)) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (pathname.startsWith('/franchise') && !['franchise', 'admin'].includes(role)) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (pathname.startsWith('/creators') && !['creator', 'admin'].includes(role)) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (pathname.startsWith('/account') && !['consumer', 'admin'].includes(role)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
