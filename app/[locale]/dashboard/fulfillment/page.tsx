import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
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

  const restaurant = await prisma.restaurant.findFirst({
    where:  { operatorId: operator.id },
    select: {
      id:                 true,
      name:               true,
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
      initial={initial}
    />
  )
}
