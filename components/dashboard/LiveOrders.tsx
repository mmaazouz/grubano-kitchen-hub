'use client'

/**
 * LiveOrders — operator-facing live order queue with contextual status actions.
 *
 * Consumes the EXISTING route PATCH /api/orders/[id]/status (server-enforced
 * state machine + restaurant/admin role gate — neither touched here). This
 * island only renders the button(s) valid for the current status and lets the
 * restaurateur advance an order, Uber-Eats style:
 *
 *   received        → "Accepter la commande" → preparing   (+ "Refuser" → cancelled)
 *   preparing       → "Marquer prête"         → ready
 *   ready + pickup  → "Remise au client"      → picked_up   (+ waiting-for-customer label)
 *   ready + delivery→ (waiting-for-courier label, no button)
 *   picked_up       → "Marquer livrée"        → delivered
 *   delivered/cancelled → terminal badge, no action
 *
 * Data flows down from the dashboard server component (already fetched). We
 * render straight from props (no derived state) and, after a successful PATCH,
 * call router.refresh() so the server re-reads the queue: non-terminal orders
 * show their new badge/button, terminal ones drop out of the active list.
 *
 * Mounts its OWN ToastProvider — operator pages have no global one (same pattern
 * as components/dashboard/FulfillmentForm).
 *
 * TODO (intentionally NOT built — out of scope per brief):
 *  - Order refusal with a reason + item-level modification flow. Only a bare
 *    "Refuser" → cancelled is offered (safe, no side effects beyond the state
 *    machine).
 *  - Real-time push (sound / web-push) when a new 'received' order lands. Today
 *    the queue only refreshes on navigation or after an action.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Check, X, CheckCheck, PackageCheck, CheckCircle2,
  ShoppingBasket, Truck, Clock, Hourglass,
} from 'lucide-react'
import { Link } from '@/navigation'
import { Badge, Button, Card, ToastProvider, useToast } from '@/components/design-system'

export interface LiveOrder {
  id:              string
  status:          string
  total:           number
  fulfillmentType: string
  itemsPreview:    string
  /** Pre-formatted server-side (locale-aware) to avoid hydration drift. */
  timeLabel:       string
}

const KNOWN_STATUS = new Set([
  'received', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled',
])

function statusTone(status: string): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'received':  return 'info'
    case 'preparing': return 'warning'
    case 'ready':     return 'warning'
    case 'picked_up': return 'success'
    case 'delivered': return 'success'
    case 'cancelled': return 'danger'
    default:          return 'neutral'
  }
}

export default function LiveOrders({ orders }: { orders: LiveOrder[] }) {
  return (
    <ToastProvider>
      <LiveOrdersInner orders={orders} />
    </ToastProvider>
  )
}

function LiveOrdersInner({ orders }: { orders: LiveOrder[] }) {
  const t      = useTranslations('dashboard.home.liveOrders')
  const toast  = useToast()
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const statusLabel = (status: string): string =>
    KNOWN_STATUS.has(status) ? t(`status_${status}`) : t('status_unknown')

  async function advance(orderId: string, target: string) {
    setPendingId(orderId)
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: target }),
      })
      const data = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        // 422 → the server returns { error: "Transition invalide: X → Y", allowed }.
        const desc = typeof data?.error === 'string' ? data.error : t('transitionRefused')
        toast.error(t('actionError'), { description: desc })
        return
      }
      toast.success(t('toastUpdated'), { description: t('nowStatus', { status: statusLabel(target) }) })
      // Server re-reads the queue → terminal orders fall out, others get fresh state.
      router.refresh()
    } catch {
      toast.error(t('actionError'), { description: t('networkError') })
    } finally {
      setPendingId(null)
    }
  }

  /** Contextual action(s) for one order. Plain JSX helper (closes over t/advance). */
  function renderActions(o: LiveOrder) {
    if (o.status === 'delivered' || o.status === 'cancelled') return null

    const busy = pendingId === o.id
    const wrap = 'mt-3 flex flex-wrap items-center gap-2 border-t border-grubano-border pt-3'

    if (o.status === 'received') {
      return (
        <div className={wrap}>
          <Button
            variant="primary" size="sm" loading={busy}
            leftIcon={<Check size={14} />}
            onClick={() => advance(o.id, 'preparing')}
          >
            {t('accept')}
          </Button>
          <Button
            variant="ghost" size="sm" disabled={busy}
            leftIcon={<X size={14} />}
            onClick={() => advance(o.id, 'cancelled')}
          >
            {t('refuse')}
          </Button>
        </div>
      )
    }

    if (o.status === 'preparing') {
      return (
        <div className={wrap}>
          <Button
            variant="primary" size="sm" loading={busy}
            leftIcon={<CheckCheck size={14} />}
            onClick={() => advance(o.id, 'ready')}
          >
            {t('markReady')}
          </Button>
        </div>
      )
    }

    if (o.status === 'ready') {
      const isPickup = o.fulfillmentType === 'pickup'
      return (
        <div className={wrap}>
          <span className="flex items-center gap-1.5 text-xs font-medium text-grubano-ink-muted">
            <Hourglass size={13} className="text-grubano-warning" />
            {isPickup ? t('waitingCustomer') : t('waitingCourier')}
          </span>
          {isPickup && (
            <Button
              variant="secondary" size="sm" loading={busy} className="ml-auto"
              leftIcon={<PackageCheck size={14} />}
              onClick={() => advance(o.id, 'picked_up')}
            >
              {t('handToCustomer')}
            </Button>
          )}
        </div>
      )
    }

    if (o.status === 'picked_up') {
      // Closes the loyalty loop for pickup hand-offs; courier deliveries are
      // closed by the delivery flow (TODO) but the action stays valid here.
      return (
        <div className={wrap}>
          <Button
            variant="secondary" size="sm" loading={busy}
            leftIcon={<CheckCircle2 size={14} />}
            onClick={() => advance(o.id, 'delivered')}
          >
            {t('markDelivered')}
          </Button>
        </div>
      )
    }

    return null
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

              {/* Tap the order info to open its detail page; buttons sit below
                  (siblings, not nested) so there's no nested-interactive issue. */}
              <Link href={`/orders/${o.id}`} className="min-w-0 flex-1">
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
                  <Badge tone={statusTone(o.status)} size="sm">{statusLabel(o.status)}</Badge>
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

            {renderActions(o)}
          </Card>
        )
      })}
    </div>
  )
}
