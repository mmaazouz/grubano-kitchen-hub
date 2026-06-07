import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'
import { EmptyState } from '@/components/design-system'
import { type EstablishmentOption } from '@/components/dashboard/EstablishmentSwitcher'
import FulfillmentForm, {
  type FulfillmentSettings,
} from '@/components/dashboard/FulfillmentForm'

// ── /dashboard/fulfillment ────────────────────────────────────────────────────
// Server component: resolves the current operator's restaurant from the
// session, then hands off to <FulfillmentForm /> (client) for the interactive
// form. No URL parameter needed — operators only manage their own restaurant.

export const dynamic = 'force-dynamic'

export default async function FulfillmentPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/eat/auth?callbackUrl=/dashboard/fulfillment')
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

  // Option B (step 5): an operator may own several establishments. Fetch the
  // full list (oldest first) and pick the one selected via the durable cookie,
  // falling back to the oldest. The header switcher lets them change it.
  const allRestaurants = await prisma.restaurant.findMany({
    where:   { operatorId: operator.id, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id:                 true,
      name:               true,
      city:               true,
      deliveryEnabled:    true,
      pickupEnabled:      true,
      reservationEnabled: true,
      deliveryRadius:     true,
      pickupPrepTime:     true,
      deliveryPrepTime:   true,
      pickupAddress:      true,
      pickupInstructions: true,
    },
  })

  const establishments: EstablishmentOption[] = allRestaurants.map((r) => ({
    id: r.id, name: r.name, city: r.city,
  }))
  const restaurant = pickEstablishment(
    allRestaurants,
    cookies().get(ESTABLISHMENT_COOKIE)?.value,
  )

  if (!restaurant) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🏪"
          title="Aucun restaurant rattaché"
          description="Créez d'abord votre fiche restaurant pour configurer les modes de service."
          action={
            <a
              href="/brands"
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white shadow-grubano-cta transition-colors hover:bg-grubano-primaryHover"
            >
              Aller à /brands →
            </a>
          }
        />
      </div>
    )
  }

  const initial: FulfillmentSettings = {
    deliveryEnabled:    restaurant.deliveryEnabled,
    pickupEnabled:      restaurant.pickupEnabled,
    reservationEnabled: restaurant.reservationEnabled,
    deliveryRadius:     restaurant.deliveryRadius,
    pickupPrepTime:     restaurant.pickupPrepTime,
    deliveryPrepTime:   restaurant.deliveryPrepTime,
    pickupAddress:      restaurant.pickupAddress,
    pickupInstructions: restaurant.pickupInstructions,
  }

  return (
    <FulfillmentForm
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      establishments={establishments}
      initial={initial}
    />
  )
}
