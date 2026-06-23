'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { StellarCard, StellarPriceTag } from '@/components/stellar'

// SCREEN 7/7 — SUIVI réel (Agent 134 → Agent 135 i18n). READ-ONLY: polls the SAME endpoint
// /eat/track uses (GET /api/orders/[id], 15s) and shows the REAL order status. No write, no money
// call. Reached after a confirmed payment (checkout → /eat-next/track/[orderId]). Stellar tokens.

interface TrackedOrder {
  id: string
  status: string
  total: number
  paymentStatus: string | null
  restaurant?: { name?: string } | null
}

// Consumer fulfillment steps (B2C). awaiting_payment precedes; cancelled/expired are terminal.
// `status` = the real Order.status; `key` = the i18n label key under eatNext.track.steps.
const STEPS = [
  { status: 'received', key: 'received' },
  { status: 'preparing', key: 'preparing' },
  { status: 'ready', key: 'ready' },
  { status: 'picked_up', key: 'enRoute' },
  { status: 'delivered', key: 'delivered' },
] as const

export default function EatNextTrackOrder({ params }: { params: { orderId: string } }) {
  const t = useTranslations('eatNext.track')
  const { orderId } = params
  const [order, setOrder] = useState<TrackedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) return // 401 / transient — keep the last good state, retry on next tick
      const data = await res.json().catch(() => null)
      if (data?.order) setOrder(data.order as TrackedOrder)
    } catch {
      /* network blip — retry on next tick */
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    fetchOrder()
    const poll = setInterval(fetchOrder, 15_000) // mirror /eat/track (read-only polling)
    return () => clearInterval(poll)
  }, [fetchOrder])

  if (loading && !order) {
    return <div className="p-6 text-center text-sm text-stellar-muted-fg">{t('loading')}</div>
  }
  if (notFound || !order) {
    return (
      <div className="space-y-4 p-6 text-center">
        <p className="text-stellar-muted-fg">{t('notFound')}</p>
        <Link href="/eat-next" className="inline-block rounded-stellar-lg border border-stellar-primary px-4 py-2 font-stellar-display font-semibold text-stellar-primary">{t('backHome')}</Link>
      </div>
    )
  }

  const cancelled = order.status === 'cancelled' || order.status === 'expired'
  const awaiting = order.status === 'awaiting_payment'
  const currentIndex = STEPS.findIndex((s) => s.status === order.status)

  return (
    <div className="space-y-5 p-4">
      <StellarCard elevation="elev" padding="lg" className="bg-stellar-primary-soft text-center">
        <p className="text-3xl" aria-hidden>{cancelled ? '⚠️' : awaiting ? '⏳' : '✅'}</p>
        <p className="font-stellar-display text-lg font-extrabold text-stellar-accent-fg">
          {cancelled ? t('cancelled') : awaiting ? t('awaiting') : t('confirmed')}
        </p>
        <p className="text-sm text-stellar-fg">
          {order.restaurant?.name ? `${order.restaurant.name} · ` : ''}<StellarPriceTag amountEur={order.total} size="sm" />
        </p>
        <p className="mt-1 text-xs text-stellar-muted-fg">{t('reference', { id: order.id })}</p>
      </StellarCard>

      {!cancelled && !awaiting && (
        <ol className="space-y-3">
          {STEPS.map((s, i) => {
            const done = currentIndex >= 0 && i < currentIndex
            const active = i === currentIndex
            return (
              <li key={s.key} className="flex items-center gap-3">
                <span className={`grid h-7 w-7 place-items-center rounded-full font-stellar-mono text-xs ${done ? 'bg-stellar-primary text-stellar-primary-fg' : active ? 'border-2 border-stellar-primary text-stellar-primary' : 'border border-stellar-border text-stellar-muted-fg'}`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={`font-stellar-display ${active ? 'font-semibold text-stellar-fg' : done ? 'text-stellar-fg' : 'text-stellar-muted-fg'}`}>{t(`steps.${s.key}`)}</span>
              </li>
            )
          })}
        </ol>
      )}

      {awaiting && (
        <p className="rounded-stellar-lg border border-stellar-border bg-stellar-surface-1 p-4 text-center text-sm text-stellar-muted-fg">
          {t('awaitingNote')}
        </p>
      )}

      <p className="text-center text-xs text-stellar-muted-fg">{t('autoUpdate')}</p>

      <Link href="/eat-next" className="block rounded-stellar-lg border border-stellar-primary py-3 text-center font-stellar-display font-semibold text-stellar-primary">
        {t('backHome')}
      </Link>
    </div>
  )
}
