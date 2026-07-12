import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTranslations } from 'next-intl/server'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'
import { type EstablishmentOption } from '@/components/dashboard/EstablishmentSwitcher'
import FulfillmentForm, {
  type FulfillmentSettings,
} from '@/components/dashboard/FulfillmentForm'
import './fulfillment.css'

// ── /dashboard/fulfillment ────────────────────────────────────────────────────
// Server component: resolves the current operator's restaurant from the
// session, then hands off to <FulfillmentForm /> (client) for the interactive
// form. No URL parameter needed — operators only manage their own restaurant.

export const dynamic = 'force-dynamic'

export default async function FulfillmentPage() {
  const t = await getTranslations('operator')
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
      <section className="fulfil">
        <div className="op-center">
          <div className="op-error__card">
            <span className="ms" aria-hidden="true">lock</span>
            <h2>{t('fulfillment.deniedTitle')}</h2>
            <p>{t('fulfillment.deniedBody')}</p>
          </div>
        </div>
      </section>
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
      // Barème (read-only display) — the REAL delivery-fee / minimum-order config,
      // in EUROS (Float). Shown via formatEuros, never hardcoded, never POSTed by
      // this form (editing them is out of scope → « bientôt »). Kept separate from
      // the FulfillmentSettings payload so the POST stays byte-identical.
      deliveryFee:        true,
      minOrder:           true,
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
      <section className="fulfil">
        <div className="op-center">
          <div className="op-onb__card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/grubano-symbol-color.svg" alt="" />
            <h1>{t('fulfillment.noRestoTitle')}</h1>
            <p>{t('fulfillment.noRestoBody')}</p>
            <a href="/brands" className="op-onb__cta">
              <span className="ms" aria-hidden="true">add_business</span>{t('fulfillment.noRestoCta')}
            </a>
          </div>
        </div>
      </section>
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

  // Read-only barème — REAL config in EUROS, displayed (not editable here).
  const billing = {
    deliveryFee: restaurant.deliveryFee,
    minOrder:    restaurant.minOrder,
  }

  return (
    <FulfillmentForm
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      establishments={establishments}
      initial={initial}
      billing={billing}
    />
  )
}
