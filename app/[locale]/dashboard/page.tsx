import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { EmptyState } from '@/components/design-system'
import ConsolidatedHome from '@/components/home/ConsolidatedHome'

// ── Route config ─────────────────────────────────────────────────────────────
// Per-session data → never prerender, always run on demand.
export const dynamic = 'force-dynamic'

/**
 * Dashboard home — thin SERVER wrapper.
 *
 * Refonte « accueil consolidé à 3 niveaux » (Agent 13 / UX). This page no
 * longer loads or renders the establishment-scoped detail (commandes en cours,
 * graphe revenus, top plats, stock/avis détaillés) — that detail stays in the
 * sidebar pages (/orders, /analytics, /stocks, /reviews) so we don't duplicate
 * pages. The home is now a consolidated, owner-level view rendered by
 * <ConsolidatedHome/>, which fetches Agent 2's GET /api/dashboard/overview +
 * GET /api/establishments client-side.
 *
 * This wrapper only: enforces the auth guard, sets the request locale, and
 * injects the operator name + locale. The previously-imported
 * components/dashboard/{EstablishmentSwitcher,DashboardRevenueChart,LiveOrders}
 * remain intact — they are simply no longer used by the home.
 */
export default async function DashboardHomePage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  // Defence in depth — middleware should already block unauthenticated visits.
  if (!email) {
    const t = await getTranslations('dashboard.home')
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🔒"
          title={t('empty.authTitle')}
          description={t('empty.authDesc')}
        />
      </div>
    )
  }

  const tSidebar = await getTranslations('dashboard.sidebar')
  const userName = session.user?.name?.trim() || tSidebar('defaultUserName')

  return <ConsolidatedHome userName={userName} locale={props.params.locale} />
}
