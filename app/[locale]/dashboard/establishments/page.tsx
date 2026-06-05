import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'
import { EmptyState } from '@/components/design-system'
import EstablishmentsManager, {
  type EstablishmentRow,
} from '@/components/dashboard/EstablishmentsManager'

// ── /dashboard/establishments ─────────────────────────────────────────────────
// Option B (commit 5B): list every establishment the operator owns, switch the
// active one, and add a new establishment (POST /api/restaurants additional:true,
// which forces isActive=false server-side for admin review). Server component:
// resolves the operator + their restaurants, hands the list to the client manager.

export const dynamic = 'force-dynamic'

export default async function EstablishmentsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/business/auth?callbackUrl=/dashboard/establishments')
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

  const allRestaurants = await prisma.restaurant.findMany({
    where:   { operatorId: operator.id },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, name: true, city: true, address: true, isActive: true },
  })

  const establishments: EstablishmentRow[] = allRestaurants.map((r) => ({
    id: r.id, name: r.name, city: r.city, address: r.address, isActive: r.isActive,
  }))

  const current = pickEstablishment(
    allRestaurants,
    cookies().get(ESTABLISHMENT_COOKIE)?.value,
  )

  return (
    <EstablishmentsManager
      establishments={establishments}
      currentId={current?.id ?? ''}
    />
  )
}
