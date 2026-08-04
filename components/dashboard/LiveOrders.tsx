'use client'

/**
 * LiveOrders — operator-facing live order queue with contextual status actions.
 *
 * Consumes the EXISTING route PATCH /api/orders/[id]/status (server-enforced
 * state machine + restaurant/admin role gate — neither touched here). The
 * advance logic + contextual buttons + status tones now live in the shared
 * module components/orders/order-actions so this queue and the full Orders page
 * behave IDENTICALLY. This island only lays out the cards.
 *
 * Data flows down from the dashboard server component (already fetched). We
 * render straight from props (no derived state) and, after a successful PATCH,
 * call router.refresh() so the server re-reads the queue: non-terminal orders
 * show their new badge/button, terminal ones drop out of the active list.
 *
 * Tapping an order deep-links to the full Orders page with its detail open
 * (?order=<id>). Mounts its OWN ToastProvider — operator pages have no global
 * one (same pattern as components/dashboard/FulfillmentForm).
 */

import { useTranslations } from 'next-intl'
import { ShoppingBasket, Truck, Clock } from 'lucide-react'
import { Link } from '@/navigation'
import { Badge, Card, ToastProvider } from '@/components/design-system'
import {
  KNOWN_STATUS, statusTone, useOrderAdvance, OrderStatusActions,
} from '@/components/orders/order-actions'

export interface LiveOrder {
  id:              string
  status:          string
  total:           number
  fulfillmentType: string
  itemsPreview:    string
  /** Pre-formatted server-side (locale-aware) to avoid hydration drift. */
  timeLabel:       string
}

export default function LiveOrders({ orders }: { orders: LiveOrder[] }) {
  return (
    <ToastProvider>
      <LiveOrdersInner orders={orders} />
    </ToastProvider>
  )
}

function LiveOrdersInner({ orders }: { orders: LiveOrder[] }) {
  const t = useTranslations('dashboard.home.liveOrders')
  const { advance, pendingId } = useOrderAdvance()

  // P0-19 — pickup orders never show delivery vocabulary ("En route"/"Livrée"):
  // 'picked_up'/'delivered' mean "collected by the client". Display only.
  const statusLabel = (status: string, fulfillmentType?: string): string => {
    if (fulfillmentType === 'pickup' && (status === 'picked_up' || status === 'delivered')) return t('status_collected')
    return KNOWN_STATUS.has(status) ? t(`status_${status}`) : t('status_unknown')
  }

  return (
    <div className="space-y-2">
      {orders.map(o => {
        const isPickup = o.fulfillmentType === 'pickup'
        const isNew    = o.status === 'received'
        return (
          <Card
            key={o.id}
            elevation="sm"
            padding="md"
            className={isNew ? 'border border-grubano-primary/40 bg-grubano-tint/15 ring-1 ring-grubano-primary/20' : ''}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-surface-muted text-grubano-ink-muted">
                {isPickup ? <ShoppingBasket size={16} /> : <Truck size={16} />}
              </div>

              {/* Tap the order info to open its detail on the Orders page; the
                  action buttons sit below (siblings, not nested). */}
              <Link href={`/orders?order=${o.id}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {isNew && (
                    <span className="relative flex h-2 w-2" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-grubano-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-grubano-primary" />
                    </span>
                  )}
                  <span className="text-xs font-bold text-grubano-ink">
                    #{o.id.slice(-6).toUpperCase()}
                  </span>
                  <Badge tone={statusTone(o.status)} size="sm">{statusLabel(o.status, o.fulfillmentType)}</Badge>
                  <Badge
                    tone="neutral"
                    size="sm"
                    icon={isPickup ? <ShoppingBasket size={10} /> : <Truck size={10} />}
                  >
                    {isPickup ? t('typePickup') : t('typeDelivery')}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-grubano-ink-muted">{o.itemsPreview}</p>
              </Link>

              <div className="text-right">
                <p className="text-sm font-bold text-grubano-ink">€{o.total.toFixed(2)}</p>
                <p className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-grubano-ink-faint">
                  <Clock size={10} />
                  {o.timeLabel}
                </p>
              </div>
            </div>

            <OrderStatusActions
              order={o}
              pendingId={pendingId}
              advance={advance}
              className="mt-3 flex flex-wrap items-center gap-2 border-t border-grubano-border pt-3"
            />
          </Card>
        )
      })}
    </div>
  )
}
