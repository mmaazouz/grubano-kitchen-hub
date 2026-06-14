'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { ClipboardList, ArrowLeft, Loader2, Calendar, X } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge, Button, type BadgeTone } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'
import { canRestoCancel } from '@/lib/marketplace'

// ── /marketplace/orders — the resto's own supply orders (Slice 3) ─────────────
// Operator-gated (under /marketplace). History of the orders this restaurateur
// placed, with live status; cancel is offered ONLY while still `placed` (and
// enforced server-side). Renders inside the operator chrome.

interface OrderLine {
  nameSnapshot: string
  unitSnapshot: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}
interface MyOrder {
  id: string
  status: string
  totalCents: number
  notes: string | null
  createdAt: string
  supplierProfile: { companyName: string } | null
  lines: OrderLine[]
}

const STATUS_TONE: Record<string, BadgeTone> = {
  placed: 'info', confirmed: 'primary', preparing: 'warning',
  delivered: 'success', cancelled: 'neutral', declined: 'danger',
}

export default function MyMarketplaceOrdersPage() {
  const t  = useTranslations('marketplace')
  const ts = useTranslations('supplier')
  const locale = useLocale()

  const [orders, setOrders] = useState<MyOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/marketplace/orders', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel(id: string) {
    if (busyId || !confirm(t('cancelConfirm'))) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/marketplace/orders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
      })
      if (res.ok) setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'cancelled' } : o)))
    } finally {
      setBusyId(null)
    }
  }

  const unitLabel = (u: string) => ts(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg')
  const statusLabel = (s: string) => ts(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'statusPlaced')
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <Link href="/marketplace/suppliers" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
        <ArrowLeft size={15} /> {t('backToList')}
      </Link>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <ClipboardList size={20} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('myOrdersTitle')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('myOrdersSubtitle')}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
      ) : error ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
      ) : orders.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ClipboardList size={28} className="text-grubano-ink-faint" />
            <p className="text-sm text-grubano-ink-muted">{t('myOrdersEmpty')}</p>
          </div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Card elevation="sm" padding="lg">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display font-bold text-grubano-ink truncate">
                      {t('orderTo', { supplier: o.supplierProfile?.companyName || '—' })}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-grubano-ink-muted">
                      <Calendar size={12} /> {fmtDate(o.createdAt)}
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

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-grubano-border pt-3">
                  <span className="text-base font-bold text-grubano-ink">{formatMoney(o.totalCents, locale)}</span>
                  {canRestoCancel(o.status) && (
                    <Button variant="secondary" size="sm" loading={busyId === o.id} leftIcon={busyId === o.id ? undefined : <X size={15} />} onClick={() => cancel(o.id)}>
                      {t('actionCancel')}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
