'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import {
  MapPin, Clock, CalendarDays, Plus, ChevronRight, UtensilsCrossed,
  Sparkles, Store, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Breadcrumb, type Crumb } from './Breadcrumb'

// ── Establishment HUB (C13-2) ─────────────────────────────────────────────────
// "Quand on ouvre un établissement, on voit ses MARQUES." The central section is
// the clickable brand cards (→ that brand's menu); a sober header + a discreet
// access strip sit above. Server props carry the establishment identity (read
// from Prisma in the route); brands are fetched client-side from the EXISTING
// /api/brands/summary (no new API).
//
// ZÉRO COMPLEXITÉ À N=1 : at a single establishment the breadcrumb root and the
// establishment chrome are trimmed — the operator lands straight on their brands.

type HubEstablishment = {
  id:       string
  name:     string
  city:     string
  address:  string
  isActive: boolean
}

// /api/brands/summary item. `restaurantId` is NOT returned today — typed optional
// so the hub is forward-compatible: the day Agent 2 adds it, multi-establishment
// scoping turns on with no further change here.
type BrandSummary = {
  id:               string
  name:             string
  emoji:            string
  status:           string
  menuCount:        number
  adoptedDishCount: number
  restaurantId?:    string | null
}

const isActiveBrand = (s: string) => s === 'active'

// Soft tile tints, cycled by index so brands stay visually distinct.
const TILE_BG = ['bg-orange-50', 'bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50', 'bg-pink-50'] as const

export default function EstablishmentHub({
  establishment,
  establishmentsCount,
}: {
  establishment:       HubEstablishment
  establishmentsCount: number
}) {
  const t = useTranslations('dashboard.hub')

  const [brands, setBrands]   = useState<BrandSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/brands/summary', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const list: BrandSummary[] = Array.isArray(d?.brands) ? d.brands : []
        setBrands(list)
      })
      .catch(() => { if (alive) setBrands([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // Forward-compatible scoping: only filter by establishment when we have a real
  // brand→establishment link AND more than one establishment exists. At N=1 (the
  // priority path) every brand belongs to the single establishment → show all.
  const multi  = establishmentsCount > 1
  const scoped = multi && brands.some((b) => b.restaurantId != null)
    ? brands.filter((b) => b.restaurantId === establishment.id)
    : brands

  // Breadcrumb: full trail only when the hierarchy is real (N≥2). At N=1 it would
  // just expose complexity for no navigational value, so we drop it.
  const crumbs: Crumb[] = multi
    ? [{ label: t('bcRoot'), href: '/dashboard/establishments' }, { label: establishment.name }]
    : []

  const location = [establishment.city, establishment.address].filter(Boolean).join(' · ')

  return (
    <div className="mx-auto max-w-lg px-5 pb-24 pt-4 md:max-w-3xl">
      {crumbs.length > 0 && <Breadcrumb items={crumbs} className="mb-3" />}

      {/* ── Sober header ──────────────────────────────────────────────────── */}
      <header className="mb-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
            <Store size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                {establishment.name}
              </h1>
              {/* Discreet online/offline — a dot + label, not a loud chip. */}
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', establishment.isActive ? 'bg-success' : 'bg-muted-foreground/40')} />
                {establishment.isActive ? t('online') : t('offline')}
              </span>
            </div>
            {location && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
                <MapPin size={12} className="shrink-0" />
                <span className="truncate">{location}</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Discreet access strip (low emphasis) ────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AccessChip href="/dashboard/fulfillment" icon={Clock} label={t('accessHours')} />
          <AccessChip href="/tables" icon={CalendarDays} label={t('accessTables')} />
        </div>
      </header>

      {/* ── Central section: the brands (the point of the hub) ────────────── */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">{t('brandsTitle')}</h2>
        {!loading && scoped.length > 0 && (
          <p className="text-[11px] text-muted-foreground">{t('brandsHint')}</p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> {t('loading')}
        </div>
      ) : scoped.length === 0 ? (
        /* 0 brand → this establishment has no menu container yet. A menu belongs
           to a brand, so the ONLY way forward is to create one — surfaced as a
           clear, actionable CTA (never a dead-end message). */
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-primary">
            <Store size={22} />
          </span>
          <p className="text-sm font-bold text-foreground">{t('emptyTitle')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{t('emptyDesc')}</p>
          <Link
            href="/brands"
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={16} /> {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {scoped.map((b, i) => (
            <Link
              key={b.id}
              href={`/menu?brand=${b.id}`}
              aria-label={t('openMenu')}
              className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary"
            >
              <div className="flex items-center gap-3">
                <div className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl', TILE_BG[i % TILE_BG.length])}>
                  {b.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-bold text-foreground">{b.name}</h3>
                  <span className={cn(
                    'mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium',
                    isActiveBrand(b.status) ? 'text-success' : 'text-warning',
                  )}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', isActiveBrand(b.status) ? 'bg-success' : 'bg-warning')} />
                    {isActiveBrand(b.status) ? t('statusActive') : t('statusPaused')}
                  </span>
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary rtl:rotate-180" />
              </div>

              <div className="flex items-center gap-4 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <UtensilsCrossed size={12} /> <strong className="font-bold text-foreground">{b.menuCount}</strong> {t('statMenu')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={12} /> <strong className="font-bold text-foreground">{b.adoptedDishCount}</strong> {t('statCreators')}
                </span>
                <span className="ms-auto inline-flex items-center gap-1 font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t('openMenu')}
                </span>
              </div>
            </Link>
          ))}

          {/* Add a brand → /brands (scratch or copy, existing flow). */}
          <Link
            href="/brands"
            className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-card p-4 text-center transition-colors hover:border-primary"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
              <Plus size={18} />
            </span>
            <span className="text-sm font-semibold text-foreground">{t('addBrand')}</span>
            <span className="text-[11px] text-muted-foreground">{t('addBrandHint')}</span>
          </Link>
        </div>
      )}
    </div>
  )
}

function AccessChip({ href, icon: Icon, label }: { href: string; icon: typeof Clock; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      <Icon size={12} className="shrink-0" />
      {label}
    </Link>
  )
}
