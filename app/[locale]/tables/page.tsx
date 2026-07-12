import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'
import { EmptyState } from '@/components/design-system'
import TablesShell from '@/components/tables/TablesShell'

// ── /tables — thin SERVER wrapper (Agent 13) ──────────────────────────────────
// Resolves session + the operator's restaurants[] + the active establishment
// (cookie → pickEstablishment, oldest-as-fallback). Hands a clean prop set to
// the client island so:
//   • the EstablishmentSwitcher has its options + currentId up front (no flash),
//   • fetches in the island carry an explicit ?restaurantId=<currentId>,
//   • the establishment-level defaultReservationDurationMin (Agent 2, 3d20718)
//     seeds the modal AND the Config card without an extra round trip.
//
// 0-establishment / non-restaurant role → graceful EmptyState (never a 500).

export const dynamic = 'force-dynamic'

export default async function TablesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/auth/magic')
  }

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })

  if (!operator || !['restaurant', 'admin'].includes(operator.role)) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🔒"
          title="Accès réservé aux restaurants"
          description="Cette page est uniquement disponible pour les comptes opérateurs de restaurant."
        />
      </div>
    )
  }

  // Operator's establishments, oldest first (so pickEstablishment's fallback
  // is deterministic and matches the rest of the dashboard).
  const restaurants = await prisma.restaurant.findMany({
    where:   { operatorId: operator.id, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select:  {
      id: true, name: true, city: true,
      defaultReservationDurationMin: true,
    },
  })

  const wantedId = cookies().get(ESTABLISHMENT_COOKIE)?.value
  const current  = pickEstablishment(restaurants, wantedId)

  // 0-restaurant guard — let the client shell render its empty state so it
  // stays a single source of truth for "what to do when there's nothing".
  if (!current) {
    const t = await getTranslations('tables')
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🏪"
          title={t('noEstabTitle')}
          description={t('noEstabDesc')}
        />
      </div>
    )
  }

  return (
    <TablesShell
      restaurantId={current.id}
      establishments={restaurants.map((r) => ({ id: r.id, name: r.name, city: r.city }))}
      currentId={current.id}
      defaultDurationMin={current.defaultReservationDurationMin ?? 60}
    />
  )
}
