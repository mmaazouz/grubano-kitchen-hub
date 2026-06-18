'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TrendingUp, TrendingDown, MapPin, ChevronDown, ChevronUp, PlusCircle, ArrowRight } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, EmptyState, SkeletonList } from '@/components/design-system'

type BrandPerf = {
  id:        string
  name:      string
  emoji:     string
  revenue:   number
  orders:    number
  royalties: number
  topDishes: string[]
}

type DashData = {
  revenueThisMonth: number
  revenueLastMonth: number
  royaltiesDue:     number
  networkAvg:       number
  brands:           BrandPerf[]
  // B6 — authoritative held-back (real), euros. royaltiesDue is the live estimate.
  royaltyEnabled?:  boolean
  royaltiesAccrued?: number
  royaltiesSettled?: number
  royaltiesPending?: number
}

export default function FranchiseDashboard() {
  const t = useTranslations('franchise.dashboard')

  const [data,     setData]     = useState<DashData | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/franchise/my-dashboard')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError(t('errorNetwork')))
      .finally(() => setLoading(false))
  }, [t])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="px-4 pt-5 max-w-2xl mx-auto">
        <SkeletonList count={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 pt-10 max-w-2xl mx-auto">
        <EmptyState
          emoji="⚠️"
          title={error}
          action={
            <Link href="/franchise">
              <Button variant="ghost" size="sm">{t('backToPortal')}</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const evoPct     = data && data.revenueLastMonth
    ? Math.round(((data.revenueThisMonth - data.revenueLastMonth) / data.revenueLastMonth) * 100)
    : null
  const vsNetwork  = data ? data.revenueThisMonth - data.networkAvg : 0
  const hasBrands  = (data?.brands.length ?? 0) > 0
  const fmt        = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted mt-1">{t('subtitle')}</p>
        </div>
        <Link href="/franchise/apply">
          <Button variant="primary" size="sm" leftIcon={<PlusCircle size={13} />}>
            {t('addLocation')}
          </Button>
        </Link>
      </div>

      {/* KPI grid — consolidated totals */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {/* CA ce mois */}
        <Card elevation="sm" padding="md">
          <p className="text-xs text-grubano-ink-muted mb-1">{t('kpiRevenue')}</p>
          <p className="text-xl font-bold">{fmt(data?.revenueThisMonth ?? 0)}€</p>
          {evoPct !== null && (
            <div className={`flex items-center gap-1 text-xs mt-1 ${evoPct >= 0 ? 'text-grubano-success' : 'text-grubano-danger'}`}>
              {evoPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {evoPct >= 0
                ? t('kpiTrendUp',   { pct: evoPct })
                : t('kpiTrendDown', { pct: evoPct })}
            </div>
          )}
        </Card>

        {/* Royalties — live ESTIMATE (projection of the window), distinct from the real
            held-back shown in the "real royalties" block below. */}
        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-xs text-grubano-ink-muted">{t('kpiRoyaltiesEstimate')}</p>
            <Badge tone="neutral" size="sm">{t('estimateBadge')}</Badge>
          </div>
          <p className="text-xl font-bold text-grubano-danger">{fmt(data?.royaltiesDue ?? 0)}€</p>
          <p className="text-xs text-grubano-ink-muted mt-1">
            {data?.royaltyEnabled ? t('kpiRoyaltiesHint') : t('royaltyInactiveHint')}
          </p>
        </Card>

        {/* Mois précédent */}
        <Card elevation="sm" padding="md">
          <p className="text-xs text-grubano-ink-muted mb-1">{t('kpiLastMonth')}</p>
          <p className="text-xl font-bold">{fmt(data?.revenueLastMonth ?? 0)}€</p>
        </Card>

        {/* vs réseau */}
        <Card
          elevation="sm"
          padding="md"
          className={vsNetwork >= 0 ? 'border-grubano-success/30 bg-grubano-success-tint' : 'border-grubano-danger/30 bg-grubano-danger-tint'}
        >
          <p className="text-xs text-grubano-ink-muted mb-1">{t('kpiNetwork')}</p>
          <p className={`text-xl font-bold ${vsNetwork >= 0 ? 'text-grubano-success' : 'text-grubano-danger'}`}>
            {vsNetwork >= 0 ? '+' : ''}{fmt(vsNetwork)}€
          </p>
          <p className="text-xs text-grubano-ink-muted mt-1">
            {t('kpiNetworkAvg', { amount: fmt(data?.networkAvg ?? 7800) })}
          </p>
        </Card>
      </div>

      {/* Royalties réelles — AUTHORITATIVE held-back read from FranchiseRoyalty/Payout
          (B6). Distinct from the live estimate above; links to the Finances page. */}
      <Card elevation="sm" padding="md" className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-bold">{t('realRoyaltiesTitle')}</p>
            <p className="text-[11px] text-grubano-ink-muted">{t('realRoyaltiesHint')}</p>
          </div>
          <Link
            href="/franchise/dashboard/finances"
            className="inline-flex items-center gap-1 text-xs font-semibold text-grubano-primary hover:underline shrink-0"
          >
            {t('financesLink')} <ArrowRight size={12} className="rtl:rotate-180" />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: t('realAccrued'), value: data?.royaltiesAccrued ?? 0, cls: '' },
            { label: t('realSettled'), value: data?.royaltiesSettled ?? 0, cls: 'text-grubano-success' },
            { label: t('realPending'), value: data?.royaltiesPending ?? 0, cls: 'text-grubano-primary' },
          ] as const).map(({ label, value, cls }) => (
            <div key={label} className="rounded-grubano-md bg-grubano-bg px-2 py-1.5 text-center">
              <p className={`text-sm font-bold ${cls}`}>{fmt(value)}€</p>
              <p className="text-[10px] text-grubano-ink-muted">{label}</p>
            </div>
          ))}
        </div>
        {!data?.royaltyEnabled && (
          <p className="text-[11px] text-grubano-ink-muted mt-2">{t('realInactiveNote')}</p>
        )}
      </Card>

      {/* Points de vente */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-display font-bold">{t('locationsTitle')}</h2>
        {hasBrands && (
          <span className="text-xs text-grubano-ink-muted">
            {t('locationsHint', { count: data!.brands.length })}
          </span>
        )}
      </div>

      {!hasBrands ? (
        <EmptyState
          emoji={<MapPin size={28} />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
          action={
            <Link href="/franchise/apply">
              <Button variant="primary" size="sm">{t('applyCta')}</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {data!.brands.map(brand => {
            const isOpen = expanded.has(brand.id)
            return (
              <Card key={brand.id} elevation="sm" padding="md">
                {/* Location header — always visible */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{brand.emoji}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm">{brand.name}</p>
                        <Badge tone="success" size="sm">Actif</Badge>
                      </div>
                      <p className="text-[11px] text-grubano-ink-muted">
                        {t('brandOrders', { count: brand.orders })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-bold text-sm">{fmt(brand.revenue)}€</p>
                      <p className="text-[11px] text-grubano-danger">
                        −{fmt(brand.royalties)}€ {t('brandRoyalties')}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleExpand(brand.id)}
                      className="text-grubano-ink-muted hover:text-grubano-ink transition"
                      aria-label={isOpen ? 'Réduire' : 'Détails'}
                    >
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Drill-down details */}
                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-grubano-border space-y-3">
                    {/* KPI breakdown */}
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { label: t('drillRevenue'),   value: `${fmt(brand.revenue)}€`   },
                        { label: t('drillRoyalties'), value: `${fmt(brand.royalties)}€` },
                        { label: t('drillOrders'),    value: String(brand.orders)        },
                      ] as const).map(({ label, value }) => (
                        <div key={label} className="rounded-grubano-md bg-grubano-bg px-2 py-1.5 text-center">
                          <p className="text-xs font-bold">{value}</p>
                          <p className="text-[10px] text-grubano-ink-muted">{label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Top dishes */}
                    {brand.topDishes.length > 0 && (
                      <>
                        <p className="text-[10px] text-grubano-ink-muted uppercase font-semibold tracking-wide">
                          {t('brandTopDishes')}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {brand.topDishes.map(dish => (
                            <span key={dish} className="rounded-grubano-pill bg-grubano-tint px-2 py-0.5 text-[10px] text-grubano-primary font-medium">
                              {dish}
                            </span>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Compare vs network */}
                    <div className="flex items-center justify-between rounded-grubano-lg bg-grubano-bg p-2">
                      <span className="text-[11px] text-grubano-ink-muted">{t('kpiNetwork')}</span>
                      <span className={`text-xs font-bold ${brand.revenue >= (data?.networkAvg ?? 7800) ? 'text-grubano-success' : 'text-grubano-danger'}`}>
                        {brand.revenue >= (data?.networkAvg ?? 7800) ? '+' : ''}
                        {fmt(brand.revenue - (data?.networkAvg ?? 7800))}€
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
