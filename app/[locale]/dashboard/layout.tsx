import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { unstable_setRequestLocale } from 'next-intl/server'
import { type Locale } from '@/i18n'

/**
 * Dashboard onboarding gate (Brique 1 fix).
 *
 * A partner (role=restaurant) who has no Brand yet is forced through
 * /business/onboarding before they can ever see the operator dashboard. The
 * gate is server-side so it runs BEFORE any client code (sidebar, page) tries
 * to render — no flash of an empty dashboard.
 *
 * Anti-loop guarantee: the redirect target is `/{locale}/business/onboarding`,
 * which is a different route from `/{locale}/dashboard`. The onboarding page
 * has its own gate the other way around (already-onboarded → /dashboard),
 * also keyed off `Brand.count`. Neither can chain back into the other.
 *
 * Bypasses: admin, franchise, creator, consumer, and an unauthenticated
 * request (middleware sends them to /login first).
 */
export default async function DashboardLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: Locale }
}) {
  unstable_setRequestLocale(locale)

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    // Middleware already redirects unauthenticated requests, but defensively
    // bounce here too — never render the dashboard for an anonymous request.
    redirect(`/${locale}/login`)
  }

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    redirect(`/${locale}/login`)
  }

  // Only the restaurant role is onboarded through /business/onboarding. Admins
  // (and franchise/creator/consumer who shouldn't be here anyway) skip the gate.
  //
  // A partner is "still onboarding" until BOTH the brand AND the restaurant
  // exist. This catches the bastard state where they created the brand then
  // quit — the onboarding page resumes them at step 2 (restaurant). Anti-loop:
  // the onboarding page only sends back to /dashboard once BOTH exist, so the
  // two gates can never ping-pong.
  if (operator.role === 'restaurant') {
    const [brandCount, restaurant] = await Promise.all([
      prisma.brand.count({ where: { operatorId: operator.id } }),
      prisma.restaurant.findFirst({ where: { operatorId: operator.id }, select: { id: true } }),
    ])
    if (brandCount === 0 || restaurant === null) {
      redirect(`/${locale}/business/onboarding`)
    }
  }

  return <>{children}</>
}
