import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import EstablishmentHub from '@/components/hub/EstablishmentHub'

// ── /dashboard/establishments/[id] — Establishment HUB (C13-2) ────────────────
// Opening an establishment shows its BRANDS (clickable → menu). This server
// component resolves the establishment identity from Prisma, OWNER-SCOPED (an id
// the caller doesn't own bounces back to the list — never a 404 leak), and hands
// it to the client hub. Brands are fetched client-side from the existing
// /api/brands/summary (no new API). No write, no migration.

export const dynamic = 'force-dynamic'

export default async function EstablishmentHubPage(props: {
  params: { locale: string; id: string }
}) {
  setRequestLocale(props.params.locale)

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect(`/business/auth?callbackUrl=/dashboard/establishments/${props.params.id}`)
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

  // Owner-scoped lookup: a foreign / unknown id resolves to null → back to list.
  const establishment = await prisma.restaurant.findFirst({
    where:  { id: props.params.id, operatorId: operator.id },
    select: { id: true, name: true, city: true, address: true, isActive: true },
  })

  if (!establishment) {
    redirect('/dashboard/establishments')
  }

  // How many establishments the operator owns — drives the "zéro complexité à
  // N=1" adaptation (breadcrumb root + brand scoping) inside the hub.
  const establishmentsCount = await prisma.restaurant.count({
    where: { operatorId: operator.id },
  })

  return (
    <EstablishmentHub
      establishment={establishment}
      establishmentsCount={establishmentsCount}
    />
  )
}
