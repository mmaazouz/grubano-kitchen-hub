// Shared order-feed logic for the operator Orders screen — factored out so the
// SERVER page (app/[locale]/orders/page.tsx) and the LIGHT live endpoint
// (GET /api/orders/live, polled every 15 s) build the EXACT same filtered list
// from ONE place (no duplicated filtering/mapping).
import { prisma } from '@/lib/prisma'

// ── Ghost-orders filter (a1b3724) — THE source of truth, REUSED not rewritten ──
// A CARD order not yet webhook-confirmed ('awaiting_payment') and an abandoned
// checkout ('expired') are NEVER shown to the resto — not in the list, the
// counter, the tabs, or any notification derived from this feed.
export const HIDDEN_ORDER_STATUSES = ['awaiting_payment', 'expired'] as const

// ── Serializable view types (shared: server page, live endpoint, client) ──────
export interface OrderItemView {
  name:      string
  qty:       number
  price:     number
  options:   {
    size?:        string
    supplements?: { name: string; price: number }[]
    exclusions?:  string[]
    note?:        string
  } | null
  brandName: string | null
  emoji:     string | null
}

export interface OrderView {
  id:              string
  status:          string
  fulfillmentType: string
  subtotal:        number
  deliveryFee:     number
  discount:        number
  total:           number
  referralCode:    string | null
  timeLabel:       string
  dateLabel:       string
  items:           OrderItemView[]
  itemsPreview:    string
  brandNames:      string[]
  customer:        { name: string; email: string; phone: string | null } | null
}

// ── Status → resto tab (Orders v2) — ONE place, no scattered magic ────────────
//   todo       : 'received'        — fresh, awaiting the resto's accept/refuse.
//   inProgress : preparing / ready / picked_up (en route) — AND any unknown or
//                edge status, which must NEVER be lost → falls here by default.
//   done       : delivered / cancelled — history.
// NB: picked_up = "en route to the customer" (delivery courier has it) → kept in
// inProgress, consistent with the existing ACTIVE_STATUSES split (delivered &
// cancelled are the only terminal/done states). The state machine is untouched.
export type OrderTab = 'todo' | 'inProgress' | 'done'

export function tabForStatus(status: string): OrderTab {
  if (status === 'received') return 'todo'
  if (status === 'delivered' || status === 'cancelled') return 'done'
  return 'inProgress'
}

// Raw cart-line option shape persisted in Order.items[].options[0].
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

// Resolve the "real" menu-item id behind a (possibly composite) line id, so an
// order line attributes back to the brand that owns the dish.
function rawIdOf(item: RawOrderItem): string {
  const parent = item.options?.[0]?.parentDishId
  if (typeof parent === 'string' && parent.length > 0) return parent
  return (item.itemId ?? '').split('::')[0]
}

/**
 * Build the resto's order views for ONE establishment — the ghost filter, brand
 * attribution, customer lookup and locale formatting, factored from the page.
 * Last 100 orders, newest first. Pure read (no writes — the lazy-expiry side
 * effect stays in the page; awaiting_payment/expired are hidden by status here
 * regardless of age).
 */
export async function buildOrderViews(opts: {
  restaurantId: string
  operatorId:   string
  locale:       string
}): Promise<OrderView[]> {
  const { restaurantId, operatorId, locale } = opts

  const [ordersRaw, menuItemsRaw] = await Promise.all([
    prisma.order.findMany({
      where:   { restaurantId, status: { notIn: [...HIDDEN_ORDER_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id: true, status: true, fulfillmentType: true,
        subtotal: true, deliveryFee: true, total: true,
        referralCode: true, consumerId: true, items: true, createdAt: true,
      },
    }),
    prisma.menuItem.findMany({
      where:  { brand: { operatorId } },
      select: { id: true, brand: { select: { name: true, emoji: true } } },
    }),
  ])

  const dishBrand = new Map<string, { name: string; emoji: string }>()
  for (const m of menuItemsRaw) dishBrand.set(m.id, { name: m.brand.name, emoji: m.brand.emoji })

  // Order.consumerId is a plain Operator.id string (not a relation) → batch.
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

  return ordersRaw.map(o => {
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

    // No explicit discount column drives the list view — a referral/promo
    // discount shows as total < subtotal + deliveryFee. Derive it (never < 0).
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
}
