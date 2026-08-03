import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'
import { EmptyState, ToastProvider } from '@/components/design-system'
import { type EstablishmentOption } from '@/components/dashboard/EstablishmentSwitcher'
import OrdersClient, {
  type OrderView,
  type BrandView,
  type MenuItemView,
  type RestaurantView,
} from '@/components/orders/OrdersClient'
import { buildOrderViews } from '@/lib/orders-feed'
import { isClaimsEnabled } from '@/lib/claims'
import RestaurantClaimsPanel from '@/components/claims/RestaurantClaimsPanel'
import './orders.css'

// Per-session, per-current-time data → never prerender, always run on demand.
export const dynamic = 'force-dynamic'

interface PageData {
  restaurant:     RestaurantView | null
  establishments: EstablishmentOption[]
  orders:         OrderView[]
  brands:         BrandView[]
  menuItems:      MenuItemView[]
  // SEC1 — only an admin can bring an establishment online (isActive:true). The
  // operator's "Réactiver" control is gated on this so an owner sees an
  // "awaiting validation" state instead of an action that the server refuses.
  canPublish:     boolean
}

async function loadData(
  operatorEmail: string,
  locale: string,
): Promise<PageData | null> {
  const operator = await prisma.operator.findUnique({
    where:  { email: operatorEmail },
    select: {
      id:   true,
      role: true, // SEC1 — admin may publish (isActive:true); owner may not
      restaurants: {
        select:  { id: true, name: true, city: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      },
      brands:     { select: { id: true, name: true, emoji: true } },
    },
  })

  const canPublish = operator?.role === 'admin'

  // Option B (step 5): Operator.restaurants is a list; the operator picks the
  // active establishment via the header switcher (durable cookie). Absent/stale
  // cookie → the oldest restaurant, so a mono operator behaves exactly as before.
  const allRestaurants = operator?.restaurants ?? []
  const establishments: EstablishmentOption[] = allRestaurants.map((r) => ({
    id: r.id, name: r.name, city: r.city,
  }))
  const restaurant = pickEstablishment(
    allRestaurants,
    cookies().get(ESTABLISHMENT_COOKIE)?.value,
  )

  if (!operator || !restaurant) {
    return { restaurant: null, establishments, orders: [], brands: [], menuItems: [], canPublish }
  }

  const restaurantId = restaurant.id

  // Ghost-orders fix — lazy expiry (zero cron, waitlist pattern): a card order
  // stuck in 'awaiting_payment' for > 24 h is an abandoned checkout → marked
  // 'expired' in passing since this read renders the resto screen anyway.
  // Best-effort: a hiccup here never blocks the page.
  try {
    await prisma.order.updateMany({
      where: {
        restaurantId,
        status:    'awaiting_payment',
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      data: { status: 'expired' },
    })
  } catch (err) {
    console.error('[orders page] lazy expiry failed (page proceeds):', err)
  }

  // Menu items across the operator's brands — for the stock-out picker (the
  // order-line brand attribution now lives inside buildOrderViews).
  const menuItemsRaw = await prisma.menuItem.findMany({
    where:   { brand: { operatorId: operator.id } },
    orderBy: { name: 'asc' },
    select:  { id: true, name: true, available: true, brand: { select: { name: true, emoji: true } } },
  })
  const menuItems: MenuItemView[] = menuItemsRaw.map(m => ({
    id:        m.id,
    name:      m.name,
    available: m.available,
    brandName: m.brand.name,
    emoji:     m.brand.emoji,
  }))

  // Orders list — the ghost filter + attribution + customer lookup + formatting
  // factored into lib/orders-feed (shared with GET /api/orders/live).
  const orders = await buildOrderViews({ restaurantId, operatorId: operator.id, locale })

  return {
    restaurant,
    establishments,
    orders,
    brands: operator.brands,
    menuItems,
    canPublish,
  }
}

async function loadDataSafe(email: string, locale: string): Promise<PageData | null> {
  try {
    return await loadData(email, locale)
  } catch (err) {
    console.error('[orders page] data load failed:', err)
    return null
  }
}

export default async function OrdersPage(props: {
  params: { locale: string }
  searchParams: { order?: string }
}) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('orders')

  const session = await getServerSession(authOptions)
  const email   = session?.user?.email

  if (!email) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="🔒" title={t('empty.authTitle')} description={t('empty.authDesc')} />
      </div>
    )
  }

  const d = await loadDataSafe(email, props.params.locale)

  if (!d || !d.restaurant) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="🏪" title={t('empty.noRestaurantTitle')} description={t('empty.noRestaurantDesc')} />
      </div>
    )
  }

  return (
    <>
      {/* P4.5-C1 — claims awaiting response (server-gated; renders nothing when the
          flag is OFF or there are no pending claims → byte-identical otherwise).
          P0-14 — the panel calls useToast() on mount, and the page's only
          ToastProvider lives INSIDE OrdersClient, so mounting it bare threw
          "useToast must be used inside <ToastProvider>" and blanked the whole
          page whenever CLAIMS_ENABLED was on. It gets its own provider here —
          the same pattern every other operator client island uses (OrdersClient,
          LiveOrders, FulfillmentForm…): operator pages have no global one. */}
      {isClaimsEnabled() && (
        <ToastProvider>
          <RestaurantClaimsPanel />
        </ToastProvider>
      )}
      <OrdersClient
        restaurant={d.restaurant}
        establishments={d.establishments}
        orders={d.orders}
        brands={d.brands}
        menuItems={d.menuItems}
        canPublish={d.canPublish}
        initialOrderId={props.searchParams.order}
      />
    </>
  )
}
