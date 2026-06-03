'use client'

import { Link } from '@/navigation'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store, Plus, UtensilsCrossed, Sparkles, TrendingUp, Filter, Lock, Loader2 } from 'lucide-react'

type BrandSummary = {
  id:               string
  name:             string
  emoji:            string
  platform:         string
  status:           string
  menuCount:        number
  adoptedDishCount: number
}

type Performance = {
  windowDays:  number
  caBrut:      number
  ordersTotal: number
}

type SortKey  = 'most' | 'least'
type Platform = 'grubano' | 'all'

// Brand.status defaults to "active"; anything else (e.g. "paused") is treated as
// not-active. We never invent a status — we read Brand.status as stored.
const isActive = (s: string) => s === 'active'

// Soft tile tints, cycled by index so brands stay visually distinct without
// inventing per-brand data.
const TILE_BG = ['bg-orange-50', 'bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50', 'bg-pink-50'] as const

export default function BrandsPage() {
  const t = useTranslations('brands')

  const [loading, setLoading]   = useState(true)
  const [brands, setBrands]     = useState<BrandSummary[]>([])
  const [perf, setPerf]         = useState<Performance>({ windowDays: 30, caBrut: 0, ordersTotal: 0 })

  const [platform, setPlatform] = useState<Platform>('grubano')
  const [status,   setStatus]   = useState<'all' | 'active' | 'paused'>('all')
  const [sort,     setSort]     = useState<SortKey>('most')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch('/api/brands/summary', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        if (Array.isArray(data?.brands)) setBrands(data.brands)
        if (data?.performance) setPerf(data.performance)
      } catch {
        // Degrade silently to the empty state — never break the page.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const activeCount = brands.filter(b => isActive(b.status)).length

  const filtered = [...brands]
    .filter(b => {
      if (status === 'all')    return true
      if (status === 'active') return isActive(b.status)
      return !isActive(b.status)
    })
    .sort((a, b) => sort === 'most' ? b.menuCount - a.menuCount : a.menuCount - b.menuCount)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">{t('title')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('conceptsActive', { count: activeCount })}</p>

      {/* Performance globale — operator-level, NOT split per brand (honest). */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={15} className="text-primary" />
          <div>
            <h2 className="text-sm font-bold leading-tight">{t('perfTitle')}</h2>
            <p className="text-[10px] text-muted-foreground">{t('perfSubtitle')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/30 p-3">
            <p className="text-lg font-bold text-foreground">€{perf.caBrut.toLocaleString('fr-FR')}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('perfRevenue')}</p>
          </div>
          <div className="rounded-xl bg-muted/30 p-3">
            <p className="text-lg font-bold text-foreground">{perf.ordersTotal}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('perfOrders')}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        <button
          onClick={() => setPlatform('grubano')}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            platform === 'grubano' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}
        >
          {t('filterGrubano')}
        </button>
        <button
          onClick={() => setPlatform('all')}
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            platform === 'all' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}
        >
          <Lock size={9} /> {t('filterAllPlatforms')}
        </button>
        <span className="mx-1 h-3 w-px bg-border" />
        {([['all', t('statusAll')], ['active', t('statusActive')], ['paused', t('statusPaused')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k as 'all' | 'active' | 'paused')}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              status === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        {([['most', t('sortMost')], ['least', t('sortLeast')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSort(k as SortKey)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              sort === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {platform === 'all' && (
        <Link href="/premium" className="mb-3 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
          <Lock size={14} className="text-primary" />
          <p className="flex-1 text-[11px] font-semibold">{t('proBanner')}</p>
          <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">{t('proPrice')}</span>
        </Link>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> {t('loading')}
        </div>
      )}

      {/* Empty: no brands at all */}
      {!loading && brands.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card py-12 text-center">
          <Store size={28} className="text-muted-foreground" />
          <p className="text-sm font-bold">{t('emptyTitle')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{t('emptyDesc')}</p>
        </div>
      )}

      {/* Empty: brands exist but the filter excludes them all */}
      {!loading && brands.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">
          {t('emptyFiltered')}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((b, i) => (
            <article key={b.id} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-3 p-4">
                <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-2xl ${TILE_BG[i % TILE_BG.length]}`}>
                  {b.emoji}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold">{b.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      isActive(b.status) ? 'bg-success/15 text-success' : 'bg-warning/20 text-warning'
                    }`}>
                      {isActive(b.status) ? t('badgeActive') : t('badgePaused')}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t('darkKitchen')}</p>
                </div>
                <Store size={16} className="text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 divide-x divide-border border-t border-border bg-muted/30">
                <Stat icon={UtensilsCrossed} label={t('statMenu')}     value={String(b.menuCount)} />
                <Stat icon={Sparkles}        label={t('statAdopted')}  value={String(b.adoptedDishCount)} />
              </div>
            </article>
          ))}
        </div>
      )}

      <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card py-4 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary">
        <Plus size={16} /> {t('addBrand')}
      </button>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-2 py-3">
      <Icon size={12} className="text-muted-foreground" />
      <p className="text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}
