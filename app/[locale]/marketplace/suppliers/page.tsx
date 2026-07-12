'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Store, MapPin, Clock3, Package, ChevronRight, Loader2, ClipboardList, Search } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'
import { itemMatchesQuery } from '@/lib/marketplace'

// ── /marketplace/suppliers — B2B supplier discovery (resto side, Slice 2/4) ───
// Renders inside the operator chrome (operator-gated). Lists ACTIVE platform
// suppliers; click → that supplier's catalogue + cart. Slice 4: an optional `?q`
// search (the stock→reorder bridge pre-fills it by product name) filters suppliers
// to those offering a matching available item and surfaces the matches inline.

interface DiscoverItem { id: string; name: string; priceCents: number; unit: string }
interface DiscoverSupplier {
  id: string
  companyName: string
  city: string | null
  categories: string[]
  deliveryZones: string[]
  minimumOrderCents: number
  leadTimeDays: number
  catalogItems: DiscoverItem[]
}

function DiscoverInner() {
  const t  = useTranslations('marketplace')
  const ts = useTranslations('supplier')
  const locale = useLocale()
  const params = useSearchParams()

  const [suppliers, setSuppliers] = useState<DiscoverSupplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState(params.get('q') ?? '')

  useEffect(() => {
    fetch('/api/marketplace/suppliers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSuppliers(Array.isArray(d.suppliers) ? d.suppliers : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const active = query.trim().length > 0
  const matchesFor = (s: DiscoverSupplier) =>
    active ? s.catalogItems.filter((it) => itemMatchesQuery(it.name, query)) : []
  const filtered = useMemo(
    () => (active ? suppliers.filter((s) => s.catalogItems.some((it) => itemMatchesQuery(it.name, query))) : suppliers),
    [suppliers, query, active],
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
            <Store size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('discoverTitle')}</h1>
            <p className="text-sm text-grubano-ink-muted">{t('discoverSubtitle')}</p>
          </div>
        </div>
        <Link href="/marketplace/orders" className="inline-flex shrink-0 items-center gap-1 rounded-grubano-lg border border-grubano-border px-3 py-2 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
          <ClipboardList size={15} /> {t('myOrdersNav')}
        </Link>
      </div>

      {/* Search (pre-filled by the stock→reorder bridge via ?q) */}
      <div className="mb-5 flex items-center gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 focus-within:border-grubano-primary">
        <Search size={16} className="shrink-0 text-grubano-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full bg-transparent py-2.5 text-sm text-grubano-ink focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
      ) : error ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
      ) : filtered.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Store size={28} className="text-grubano-ink-faint" />
            <p className="text-sm text-grubano-ink-muted">{active ? t('noMatch', { q: query.trim() }) : t('discoverEmpty')}</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((s) => {
            const matches = matchesFor(s)
            return (
              <Link key={s.id} href={`/marketplace/suppliers/${s.id}`} className="block">
                <Card elevation="sm" padding="md" className="h-full transition-shadow hover:shadow-grubano-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-grubano-ink truncate">{s.companyName}</h2>
                      {s.city && (
                        <p className="flex items-center gap-1 text-xs text-grubano-ink-muted">
                          <MapPin size={12} /> {s.city}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                  </div>
                  {s.categories.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.categories.slice(0, 4).map((c) => (
                        <Badge key={c} tone="neutral" size="sm">{ts(`cat${c.charAt(0).toUpperCase()}${c.slice(1)}` as 'catFresh')}</Badge>
                      ))}
                    </div>
                  )}
                  {/* Inline matches when searching (Slice 4 bonus). */}
                  {matches.length > 0 && (
                    <ul className="mt-2 space-y-0.5 rounded-grubano-md bg-grubano-tint/40 px-2.5 py-1.5">
                      {matches.slice(0, 3).map((it) => (
                        <li key={it.id} className="flex justify-between gap-2 text-[12px]">
                          <span className="min-w-0 truncate font-medium text-grubano-ink">{it.name}</span>
                          <span className="shrink-0 tabular-nums text-grubano-ink-muted">{formatMoney(it.priceCents, locale)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-grubano-ink-muted">
                    <span className="inline-flex items-center gap-1"><Package size={13} /> {t('products', { count: s.catalogItems.length })}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 size={13} /> {ts('leadTimeValue', { days: s.leadTimeDays })}</span>
                    {s.minimumOrderCents > 0 && <span>{t('minOrder', { amount: formatMoney(s.minimumOrderCents, locale) })}</span>}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function MarketplaceSuppliersPage() {
  // useSearchParams must sit under a Suspense boundary (Next.js 14 App Router).
  return (
    <Suspense fallback={null}>
      <DiscoverInner />
    </Suspense>
  )
}
