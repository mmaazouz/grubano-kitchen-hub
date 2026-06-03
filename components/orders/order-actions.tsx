'use client'

/**
 * Shared order-status action primitives.
 *
 * The dashboard "live orders" queue (components/dashboard/LiveOrders) and the
 * full operator Orders page (components/orders/OrdersClient) both let the
 * restaurateur advance an order, Uber-Eats style. To guarantee they behave
 * IDENTICALLY (same transitions, same toasts, same labels) the logic lives here
 * once and is imported by both:
 *
 *   received        → "Accepter" → preparing   (+ "Refuser" → cancelled)
 *   preparing       → "Marquer prête"          → ready
 *   ready + pickup  → "Remise au client"       → picked_up  (+ waiting label)
 *   ready + delivery→ (waiting-for-courier label, no button)
 *   picked_up       → "Marquer livrée"         → delivered
 *   delivered/cancelled → terminal, no action
 *
 * All mutations go through the EXISTING route PATCH /api/orders/[id]/status
 * (server-enforced state machine + restaurant/admin gate — NOT touched here).
 *
 * i18n: every label reuses the dashboard.home.liveOrders.* namespace so the two
 * surfaces stay in lockstep with one set of translations.
 *
 * Consumers MUST be mounted inside a <ToastProvider> (operator pages have no
 * global one — each page mounts its own).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Check, X, CheckCheck, PackageCheck, CheckCircle2, Hourglass,
} from 'lucide-react'
import { Button, useToast } from '@/components/design-system'

export const KNOWN_STATUS = new Set([
  'received', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled',
])

export type StatusTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral'

export function statusTone(status: string): StatusTone {
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

/** Minimal shape the action buttons need to decide which to render. */
export interface AdvanceableOrder {
  id:              string
  status:          string
  fulfillmentType: string
}

/**
 * Advance hook — owns the pending state + PATCH call + toasts + refresh.
 * Returns a stable `advance(orderId, target)`, the current `pendingId`, and a
 * `statusLabel(status)` helper. Call once per surface (its ToastProvider).
 */
export function useOrderAdvance() {
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
      // Server re-reads the queue → terminal orders fall out, others refresh.
      router.refresh()
    } catch {
      toast.error(t('actionError'), { description: t('networkError') })
    } finally {
      setPendingId(null)
    }
  }

  return { advance, pendingId, statusLabel }
}

/**
 * Contextual action button(s) for one order. Pure presentational — receives the
 * shared `advance` + `pendingId` from useOrderAdvance() so a single pending
 * state is shared across the card and any open detail view.
 */
export function OrderStatusActions({
  order, pendingId, advance, className,
}: {
  order:     AdvanceableOrder
  pendingId: string | null
  advance:   (orderId: string, target: string) => void
  className?: string
}) {
  const t = useTranslations('dashboard.home.liveOrders')

  if (order.status === 'delivered' || order.status === 'cancelled') return null

  const busy = pendingId === order.id
  const wrap = className ?? 'flex flex-wrap items-center gap-2'

  if (order.status === 'received') {
    return (
      <div className={wrap}>
        <Button
          variant="primary" size="sm" loading={busy}
          leftIcon={<Check size={14} />}
          onClick={() => advance(order.id, 'preparing')}
        >
          {t('accept')}
        </Button>
        <Button
          variant="ghost" size="sm" disabled={busy}
          leftIcon={<X size={14} />}
          onClick={() => advance(order.id, 'cancelled')}
        >
          {t('refuse')}
        </Button>
      </div>
    )
  }

  if (order.status === 'preparing') {
    return (
      <div className={wrap}>
        <Button
          variant="primary" size="sm" loading={busy}
          leftIcon={<CheckCheck size={14} />}
          onClick={() => advance(order.id, 'ready')}
        >
          {t('markReady')}
        </Button>
      </div>
    )
  }

  if (order.status === 'ready') {
    const isPickup = order.fulfillmentType === 'pickup'
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
            onClick={() => advance(order.id, 'picked_up')}
          >
            {t('handToCustomer')}
          </Button>
        )}
      </div>
    )
  }

  if (order.status === 'picked_up') {
    // Closes the loyalty loop for pickup hand-offs; courier deliveries are
    // closed by the delivery flow (TODO) but the action stays valid here.
    return (
      <div className={wrap}>
        <Button
          variant="secondary" size="sm" loading={busy}
          leftIcon={<CheckCircle2 size={14} />}
          onClick={() => advance(order.id, 'delivered')}
        >
          {t('markDelivered')}
        </Button>
      </div>
    )
  }

  return null
}
