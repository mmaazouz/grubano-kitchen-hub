'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Search, Loader2, PackageSearch, Store } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge, Button, type BadgeTone } from '@/components/design-system'
import { reorderSearchHref } from '@/lib/marketplace'

// ── /marketplace/reorder — stock-low → order-from-a-supplier bridge (Slice 4) ─
// Operator-gated (under /marketplace). READ-ONLY list of the resto's low-stock
// products (from /api/marketplace/reorder, which never writes stock). Each item
// links to the Slice-2 discovery PRE-FILLED with a search by the product name —
// the order itself is the existing Slice-2 flow. No new order logic here.

interface LowItem {
  id: string
  name: string
  quantity: number
  unit: string
  minThreshold: number
  dlc: string | null
  status: 'urgent' | 'soon' | 'ok'
}

const STATUS_TONE: Record<string, BadgeTone> = { urgent: 'danger', soon: 'warning', ok: 'success' }

export default function ReorderPage() {
  const t = useTranslations('marketplace')

  const [items, setItems] = useState<LowItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/marketplace/reorder', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = (s: string) => (s === 'urgent' ? t('stockUrgent') : t('stockSoon'))

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <PackageSearch size={20} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('reorderTitle')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('reorderSubtitle')}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
      ) : error ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
      ) : items.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <PackageSearch size={28} className="text-grubano-ink-faint" />
            <p className="text-sm text-grubano-ink-muted">{t('reorderEmpty')}</p>
            <Link href="/marketplace/suppliers" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
              <Store size={14} /> {t('browseAll')}
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id}>
              <Card elevation="sm" padding="md">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-grubano-lg ${it.status === 'urgent' ? 'bg-grubano-danger-tint text-grubano-danger' : 'bg-grubano-warning-tint text-grubano-warning'}`}>
                    <AlertTriangle size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-grubano-ink truncate">{it.name}</p>
                      <Badge tone={STATUS_TONE[it.status] ?? 'neutral'} size="sm">{statusLabel(it.status)}</Badge>
                    </div>
                    <p className="text-xs text-grubano-ink-muted">
                      {it.quantity} {it.unit} · {t('stockMin', { min: it.minThreshold, unit: it.unit })}
                    </p>
                  </div>
                  <Link href={reorderSearchHref(it.name)} className="shrink-0">
                    <Button variant="primary" size="sm" leftIcon={<Search size={14} />}>{t('findSuppliers')}</Button>
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
