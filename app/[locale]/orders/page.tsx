import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'
import { EmptyState } from '@/components/design-system'
import { type EstablishmentOption } from '@/components/dashboard/EstablishmentSwitcher'
import OrdersClient, {
  type OrderView,
  type OrderItemView,
  type BrandView,
  type MenuItemView,
  type RestaurantView,
} from '@/components/orders/OrdersClient'

// Per-session, per-current-time data → never prerender, always run on demand.
export const dynamic = 'force-dynamic'

// Raw cart-line option shape persisted in Order.items[].options[0]
// (see lib/eat-cart.ts → EatCartItemOptions).
interface RawItemOptions {
  parentDishId?: string
  size?:         string
  supplements?:  { name?: string; price?: number }[]
  exclusions?:   string[]
  note?:         string
}
interface RawOrderItem {
  itemId?:  string
  name?:    string
  qty?:     number
  price?:   number
  options?: RawItemOptions[]
}

// Resolve the "real" menu-item id behind a (possibly composite) line id, so we
// can attribute an order line back to the brand that owns the dish:
//   options[0].parentDishId  (set when the line carries customisations)
//   otherwise itemId before "::"  (the size/extras signature separator — a bare
//   cuid never contains "::", so split is a no-op for plain items).
function rawIdOf(item: RawOrderItem): string {
  const parent = item.options?.[0]?.parentDishId
  if (typeof parent === 'string' && parent.length > 0) return parent
  return (item.itemId ?? '').split('::')[0]
}

interface PageData {
  restaurant:     RestaurantView | null
  establishments: EstablishmentOption[]
  orders:         OrderView[]
  brands:         BrandView[]
  menuItems:      MenuItemView[]
}

async function loadData(
  operatorEmail: string,
  locale: string,
): Promise<PageData | null> {
  const operator = await prisma.operator.findUnique({
    where:  { email: operatorEmail },
    select: {
      id: true,
      restaurants: {
        select:  { id: true, name: true, city: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      },
      brands:     { select: { id: true, name: true, emoji: true } },
    },
  })

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
    return { restaurant: null, establishments, orders: [], brands: [], menuItems: [] }
  }

  const restaurantId = restaurant.id

  // Last 100 orders for this restaurant + every menu item across its brands
  // (used for brand attribution + the stock-out picker).
  const [ordersRaw, menuItemsRaw] = await Promise.all([
    prisma.order.findMany({
      where:   { restaurantId },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id: true, status: true, fulfillmentType: true,
        subtotal: true, deliveryFee: true, total: true,
        referralCode: true, consumerId: true, items: true, createdAt: true,
      },
    }),
    prisma.menuItem.findMany({
      where:   { brand: { operatorId: operator.id } },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, available: true, brand: { select: { name: true, emoji: true } } },
    }),
  ])

  // dishId → { brandName, emoji } for order-line attribution.
  const dishBrand = new Map<string, { name: string; emoji: string }>()
  const menuItems: MenuItemView[] = menuItemsRaw.map(m => {
    dishBrand.set(m.id, { name: m.brand.name, emoji: m.brand.emoji })
    return {
      id:        m.id,
      name:      m.name,
      available: m.available,
      brandName: m.brand.name,
      emoji:     m.brand.emoji,
    }
  })

  // Batch-resolve customers (Order.consumerId is a plain Operator.id string,
  // NOT a relation — so we look them up separately).
  const consumerIds = Array.from(new Set(ordersRaw.map(o => o.consumerId).filter(Boolean)))
  const consumers = consumerIds.length
    ? await prisma.operator.findMany({
        where:  { id: { in: consumerIds } },
        select: { id: true, name: true, email: true, phone: true },
      })
    : []
  const consumerMap = new Map(consumers.map(c => [c.id, c]))

  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })

  const orders: OrderView[] = ordersRaw.map(o => {
    const rawItems = Array.isArray(o.items) ? (o.items as RawOrderItem[]) : []

    const items: OrderItemView[] = rawItems.map(it => {
      const brand = dishBrand.get(rawIdOf(it)) ?? null
      const opt   = it.options?.[0]
      return {
        name:  it.name ?? '',
        qty:   Number(it.qty ?? 1),
        price: Number(it.price ?? 0),
        options: opt
          ? {
              size:        typeof opt.size === 'string' ? opt.size : undefined,
              supplements: Array.isArray(opt.supplements)
                ? opt.supplements.map(s => ({ name: String(s?.name ?? ''), price: Number(s?.price ?? 0) }))
                : undefined,
              exclusions:  Array.isArray(opt.exclusions) ? opt.exclusions.map(String) : undefined,
              note:        typeof opt.note === 'string' && opt.note.trim() ? opt.note : undefined,
            }
          : null,
        brandName: brand?.name ?? null,
        emoji:     brand?.emoji ?? null,
      }
    })

    const brandNames = Array.from(
      new Set(items.map(i => i.brandName).filter((b): b is string => !!b)),
    )
    const itemsPreview =
      (items.slice(0, 2).map(i => `${i.qty}× ${i.name}`).join(' · ')
        + (items.length > 2 ? ` +${items.length - 2}` : '')) || '—'

    // No explicit discount column on Order — a referral / promo discount shows
    // up as total < subtotal + deliveryFee. Derive it (never negative).
    const discount = Math.max(0, Math.round((o.subtotal + o.deliveryFee - o.total) * 100) / 100)

    const customer = consumerMap.get(o.consumerId)

    return {
      id:              o.id,
      status:          o.status,
      fulfillmentType: o.fulfillmentType,
      subtotal:        o.subtotal,
      deliveryFee:     o.deliveryFee,
      discount,
      total:           o.total,
      referralCode:    o.referralCode ?? null,
      timeLabel:       timeFmt.format(o.createdAt),
      dateLabel:       dateFmt.format(o.createdAt),
      items,
      itemsPreview,
      brandNames,
      customer: customer
        ? { name: customer.name, email: customer.email, phone: customer.phone ?? null }
        : null,
    }
  })

  return {
    restaurant,
    establishments,
    orders,
    brands: operator.brands,
    menuItems,
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
    <OrdersClient
      restaurant={d.restaurant}
      establishments={d.establishments}
      orders={d.orders}
      brands={d.brands}
      menuItems={d.menuItems}
      initialOrderId={props.searchParams.order}
    />
  )
}
