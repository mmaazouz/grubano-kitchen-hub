'use client'

import * as React from 'react'
import { useLocale } from 'next-intl'
import { Clock, MapPin, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney, formatEuros } from '@/lib/format-money'
import { Badge, type BadgeTone } from './Badge'
import { PriceTag } from './PriceTag'

export type OrderStatus =
  | 'received'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'

const STATUS_META: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  received:  { label: 'Reçue',       tone: 'info'    },
  preparing: { label: 'En cuisine',  tone: 'warning' },
  ready:     { label: 'Prête',       tone: 'primary' },
  picked_up: { label: 'En route',    tone: 'primary' },
  delivered: { label: 'Livrée',      tone: 'success' },
  cancelled: { label: 'Annulée',     tone: 'danger'  },
}

export interface OrderCardItem {
  name: string
  qty: number
  price?: number
}

export interface OrderCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  /** Short ID — typically last 6 chars of cuid. */
  orderId: string
  status: OrderStatus
  /** Restaurant name (consumer view) or customer name (operator view). */
  counterparty: string
  /** Order total in euros (or cents — see cents prop). */
  total: number
  cents?: boolean
  currency?: string
  /** Created or estimated time — accepts Date, ISO string, or "12:34" pre-formatted. */
  time?: Date | string
  /** Optional address shown when present (consumer/operator tracking). */
  address?: string
  /** Itemized lines (collapsed view shows 2 + "+N more"). */
  items?: OrderCardItem[]
  /** Estimated delivery time in minutes (consumer tracking). */
  etaMinutes?: number
  /** Total click handler — turns whole card into a link. */
  onClick?: () => void
  /** Operator action override — e.g. "Marquer prête". */
  actionLabel?: string
  onAction?: () => void
}

function formatTime(t?: Date | string): string | null {
  if (!t) return null
  if (typeof t === 'string' && !t.includes('T') && !t.includes('Z')) return t
  const d = typeof t === 'string' ? new Date(t) : t
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export const OrderCard = React.forwardRef<HTMLDivElement, OrderCardProps>(function OrderCard(
  {
    orderId,
    status,
    counterparty,
    total,
    cents,
    currency,
    time,
    address,
    items,
    etaMinutes,
    onClick,
    actionLabel,
    onAction,
    className,
    ...rest
  },
  ref,
) {
  const locale = useLocale()
  const meta = STATUS_META[status]
  const interactive = typeof onClick === 'function'
  const formattedTime = formatTime(time)
  const visibleItems = items?.slice(0, 2) ?? []
  const remaining = (items?.length ?? 0) - visibleItems.length

  return (
    <div
      ref={ref}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => interactive && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick!())}
      className={cn(
        'bg-gb-surface-elevated border border-gb-stroke rounded-gb-xl p-4 flex flex-col gap-3',
        'shadow-gb-sm transition-all duration-150',
        interactive && 'cursor-pointer hover:shadow-gb-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-accent',
        className,
      )}
      {...rest}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gb-content-muted">#{orderId.slice(-6).toUpperCase()}</span>
            <Badge tone={meta.tone} size="sm" dot>
              {meta.label}
            </Badge>
          </div>
          <h3 className="font-gb-display font-bold text-base text-gb-content truncate">{counterparty}</h3>
          {(formattedTime || etaMinutes !== undefined) && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-gb-content-muted">
              <Clock size={12} />
              {etaMinutes !== undefined ? <span>~{etaMinutes} min</span> : <span>{formattedTime}</span>}
            </div>
          )}
        </div>
        <PriceTag amount={total} cents={cents} currency={currency} size="md" />
      </div>

      {visibleItems.length > 0 && (
        <ul className="text-sm text-gb-content-muted space-y-0.5">
          {visibleItems.map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">
                <span className="font-semibold text-gb-content">{it.qty}×</span> {it.name}
              </span>
              {typeof it.price === 'number' && (
                <span className="font-medium tabular-nums">
                  {cents ? formatMoney(it.price, locale) : formatEuros(it.price, locale)}
                </span>
              )}
            </li>
          ))}
          {remaining > 0 && (
            <li className="text-xs text-gb-content-muted italic">+ {remaining} autre{remaining > 1 ? 's' : ''}</li>
          )}
        </ul>
      )}

      {address && (
        <div className="flex items-start gap-1.5 text-xs text-gb-content-muted">
          <MapPin size={12} className="mt-0.5 shrink-0" />
          <span className="line-clamp-1">{address}</span>
        </div>
      )}

      {(actionLabel || interactive) && (
        <div className="flex justify-end pt-1">
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAction()
              }}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-gb-md bg-gb-accent text-gb-content-on-accent text-sm font-semibold active:scale-[0.98]"
            >
              {actionLabel}
            </button>
          ) : (
            interactive && (
              <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-gb-accent">
                Détails <ChevronRight size={16} />
              </span>
            )
          )}
        </div>
      )}
    </div>
  )
})

export default OrderCard
