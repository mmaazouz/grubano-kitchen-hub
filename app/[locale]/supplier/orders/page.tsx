'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Inbox, ArrowLeft, Loader2, Calendar, Check, X, ChefHat, Truck } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge, Button, type BadgeTone } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import { formatMoney } from '@/lib/format-money'
import { allowedTransitions, type SupplyOrderStatus } from '@/lib/marketplace'

// ── /supplier/orders — incoming B2B orders + status actions (supplier, Slice 3)
// Gated supplier/admin. The supplier advances each order along the state machine
// (lib/marketplace) via contextual actions; only valid transitions are offered
// (and enforced server-side). Scoped server-side to the connected supplier.

interface OrderLine {
  nameSnapshot: string
  unitSnapshot: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}
interface ReceivedOrder {
  id: string
  status: string
  totalCents: number
  notes: string | null
  desiredDate: string | null
  createdAt: string
  operator: { name: string; city: string | null } | null
  lines: OrderLine[]
}

const STATUS_TONE: Record<string, BadgeTone> = {
  placed: 'info', confirmed: 'primary', preparing: 'warning',
  delivered: 'success', cancelled: 'neutral', declined: 'danger',
}
const ACTION_ICON: Record<string, React.ReactNode> = {
  confirmed: <Check size={15} />, declined: <X size={15} />,
  preparing: <ChefHat size={15} />, delivered: <Truck size={15} />,
}

export default function SupplierOrdersPage() {
  const t = useTranslations('supplier')
  const locale = useLocale()

  const [orders, setOrders] = useState<ReceivedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/supplier/orders', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function advance(id: string, status: SupplyOrderStatus) {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/supplier/orders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (res.ok) setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)))
    } finally {
      setBusyId(null)
    }
  }

  const unitLabel = (u: string) => t(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg')
  const statusLabel = (s: string) => t(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'statusPlaced')
  const actionLabel = (s: string) => t(`action${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'actionConfirm')
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Inbox size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{t('ordersTitle')}</h1>
          </div>
          <Link href="/supplier/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white">
            <ArrowLeft size={15} /> {t('catalogBack')}
          </Link>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-3xl px-5 py-6 space-y-4">
        <p className="text-sm text-grubano-ink-muted">{t('ordersSubtitle')}</p>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
        ) : error ? (
          <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
        ) : orders.length === 0 ? (
          <Card elevation="sm" padding="lg">
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Inbox size={28} className="text-grubano-ink-faint" />
              <p className="text-sm text-grubano-ink-muted">{t('ordersEmpty')}</p>
            </div>
          </Card>
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => {
              const actions = allowedTransitions('supplier', o.status)
              return (
                <li key={o.id}>
                  <Card elevation="sm" padding="lg">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display font-bold text-grubano-ink truncate">
                          {t('ordersFrom', { name: o.operator?.name || '—' })}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-grubano-ink-muted">
                          <Calendar size={12} /> {fmtDate(o.createdAt)}{o.operator?.city ? ` · ${o.operator.city}` : ''}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[o.status] ?? 'neutral'} size="md">{statusLabel(o.status)}</Badge>
                    </div>

                    <ul className="space-y-0.5 text-sm">
                      {o.lines.map((l, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate text-grubano-ink-muted">
                            <span className="font-semibold text-grubano-ink">{l.quantity}×</span> {l.nameSnapshot}
                            <span className="text-grubano-ink-faint"> ({unitLabel(l.unitSnapshot)})</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-grubano-ink-muted">{formatMoney(l.lineTotalCents, locale)}</span>
                        </li>
                      ))}
                    </ul>

                    {o.notes && (
                      <p className="mt-2 rounded-grubano-md bg-grubano-surface-muted px-3 py-2 text-[13px] text-grubano-ink-muted">
                        {t('orderNotes')}: {o.notes}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-grubano-border pt-3">
                      <span className="text-base font-bold text-grubano-ink">{formatMoney(o.totalCents, locale)}</span>
                      {actions.length > 0 && (
                        <div className="flex gap-2">
                          {actions.map((to) => (
                            <Button
                              key={to}
                              variant={to === 'declined' ? 'secondary' : 'primary'}
                              size="sm"
                              loading={busyId === o.id}
                              leftIcon={busyId === o.id ? undefined : ACTION_ICON[to]}
                              onClick={() => advance(o.id, to)}
                            >
                              {actionLabel(to)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
