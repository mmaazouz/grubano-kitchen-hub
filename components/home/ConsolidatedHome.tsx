'use client'

/**
 * ConsolidatedHome — the 3-level operator home (Agent 13 / UX).
 *
 * Single source of truth = Agent 2's GET /api/dashboard/overview (aggregates,
 * alerts, objectives) + GET /api/establishments (the Level-3 list). Both are
 * fetched client-side, owner-scoped via the session cookie — the page stays a
 * thin server wrapper that only injects the operator name + locale.
 *
 * HONESTY (hard rule): no fictional gauge or number. Anything Agent 2 marks
 * `available:false` (supplierToOrder, reviewsToHandle, localInfluencers) is
 * NOT shown as an alert / rendered in a neutral "coming soon" state — never
 * invented. Franchisable thresholds are provisional (from the endpoint) and
 * labelled « objectif indicatif ». The creator target below is a UI-side
 * indicative target; the numerator (adoptedRecipes) stays real.
 *
 * Levels:
 *   EN-TÊTE  — greeting · overview · N établissements · date + 4 metrics
 *   NIVEAU 1 — « À traiter aujourd'hui » : brand + stock alerts (only the
 *              signals Agent 2 confirmed computable). Zero alerts → "Tout est
 *              à jour" sober positive state.
 *   NIVEAU 2 — « Vos objectifs » : franchisable / créateur / influenceur +
 *              « Vos prochaines opportunités » underneath.
 *   NIVEAU 3 — pilotage : the clickable establishments list (reuses the hub).
 */

import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Loader2, Euro, ShoppingBag, TrendingUp, Star,
  AlertTriangle, Package, Building2, Sparkles, Users,
  CheckCircle2, ChevronRight, Store, ChefHat,
  Check, X, Minus, ArrowRight, Clock,
} from 'lucide-react'
import { Link } from '@/navigation'
import { Card, EmptyState } from '@/components/design-system'

// ── Endpoint contracts (Agent 2 — DO NOT modify the endpoint) ────────────────

type Aggregates = {
  establishmentsCount: number
  caJour: number
  orders7d: number
  avgBasket7d: number | null
  avgRating: number | null
  totalReviews: number
}
type UnlockReason = 'offline' | 'no_brand' | 'empty_menu'
type BrandToUnlock = {
  establishmentId: string
  establishmentName: string
  reason: UnlockReason
  detail: string
}
type StockSeverity = 'out' | 'low'
type StockAlert = {
  stockItemId: string
  name: string
  brandId: string
  brandName: string
  quantity: number
  unit: string
  minThreshold: number
  severity: StockSeverity
}
type Alerts = {
  brandsToUnlock: { count: number; items: BrandToUnlock[] }
  stockOut: { count: number; items: StockAlert[] }
  // supplierToOrder / reviewsToHandle are `available:false` — never rendered.
}
type Objectives = {
  franchisable: {
    thresholdsProvisional: true
    thresholds: { minAvgRating: number; minWeeklyOrders: number; minAccountAgeDays: number }
    values: { avgRating: number | null; weeklyOrders: number; accountAgeDays: number }
    criteria: { ratingMet: boolean | null; volumeMet: boolean; ageMet: boolean }
  }
  creator: { adoptedRecipes: number; linkedCreators: number }
  // localInfluencers is `available:false` — rendered neutral, no fake bar.
}
type Overview = {
  aggregates: Aggregates
  alerts: Alerts
  objectives: Objectives
  meta: { window7dDays: number; generatedAt: string }
}

type Establishment = { id: string; name: string; city: string | null; isActive: boolean }
type EstablishmentsResp = { establishments: Establishment[]; currentId: string | null }

/** UI-side indicative target for the creator objective. The numerator
 *  (adoptedRecipes) is real — only this denominator is an indicative goal,
 *  surfaced as « objectif indicatif » in the card. */
const CREATOR_TARGET_RECIPES = 5

const MAX_ALERT_ROWS = 4

interface ConsolidatedHomeProps {
  userName: string
  locale: string
}

export default function ConsolidatedHome({ userName, locale }: ConsolidatedHomeProps) {
  const t = useTranslations('dashboard.home.ov')
  const tHome = useTranslations('dashboard.home')
  const tHours = useTranslations('hours')

  const [overview, setOverview] = useState<Overview | null>(null)
  const [establishments, setEstablishments] = useState<Establishment[]>([])
  const [loading, setLoading] = useState(true)
  // Bloc C (chantier horaires, T1.Q3) — first OWNED establishment whose hours
  // are not configured yet. null = all configured / unknown → no encart
  // (defensive: a fetch hiccup never shows a wrong nag).
  const [hoursToConfigure, setHoursToConfigure] = useState<Establishment | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [ovRes, estRes] = await Promise.all([
          fetch('/api/dashboard/overview', { cache: 'no-store' }),
          fetch('/api/establishments', { cache: 'no-store' }),
        ])
        const ov = ovRes.ok ? ((await ovRes.json()) as Overview) : null
        const est = estRes.ok ? ((await estRes.json()) as EstablishmentsResp) : null
        if (cancelled) return
        setOverview(ov)
        setEstablishments(est?.establishments ?? [])

        // Adoption check — owner GET /hours per establishment (small N). The
        // encart shows while at least one establishment has zero hours rows
        // and disappears as soon as it's configured.
        const list = est?.establishments ?? []
        const checks = await Promise.all(list.map(async (e) => {
          try {
            const r = await fetch(`/api/restaurants/${e.id}/hours`, { cache: 'no-store' })
            if (!r.ok) return null
            const d = await r.json() as { configured?: boolean }
            return d.configured === false ? e : null
          } catch { return null }
        }))
        if (!cancelled) setHoursToConfigure(checks.find(Boolean) ?? null)
      } catch {
        if (!cancelled) setOverview(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-4">
        <div className="flex items-center justify-center gap-2 py-24 text-grubano-ink-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{t('loading')}</span>
        </div>
      </div>
    )
  }

  const agg = overview?.aggregates

  // ── Empty: no establishment yet (endpoint also degrades here on failure) ────
  if (!overview || !agg || agg.establishmentsCount === 0) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🏪"
          title={tHome('empty.noRestaurantTitle')}
          description={tHome('empty.noRestaurantDesc')}
          action={
            <Link
              href="/brands"
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white shadow-grubano-cta transition-colors hover:bg-grubano-primaryHover"
            >
              {tHome('empty.noRestaurantCta')} →
            </Link>
          }
        />
      </div>
    )
  }

  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date())

  const fmtCur0 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  const fmtCur2 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })

  const brands = overview.alerts.brandsToUnlock
  const stock = overview.alerts.stockOut
  const hasAlerts = brands.count > 0 || stock.count > 0

  const fr = overview.objectives.franchisable
  const frMet =
    (fr.criteria.ratingMet === true ? 1 : 0) +
    (fr.criteria.volumeMet ? 1 : 0) +
    (fr.criteria.ageMet ? 1 : 0)

  const cr = overview.objectives.creator
  const crProgress = Math.min(cr.adoptedRecipes / CREATOR_TARGET_RECIPES, 1)

  const reasonLabel = (r: UnlockReason): string =>
    r === 'no_brand' ? t('reasonNoBrand') : r === 'empty_menu' ? t('reasonEmptyMenu') : t('reasonOffline')

  // ── Opportunities — derived honestly from the same overview ─────────────────
  type Opp = { key: string; icon: React.ReactNode; title: string; desc: string; cta: string; href: string }
  const opps: Opp[] = []
  if (fr.criteria.ratingMet === true && fr.criteria.volumeMet && fr.criteria.ageMet) {
    opps.push({
      key: 'franchise',
      icon: <Building2 size={18} />,
      title: t('oppFranchiseTitle'),
      desc: t('oppFranchiseDesc'),
      cta: t('oppFranchiseCta'),
      href: '/franchise',
    })
  }
  if (cr.adoptedRecipes === 0) {
    opps.push({
      key: 'creator',
      icon: <ChefHat size={18} />,
      title: t('oppCreatorTitle'),
      desc: t('oppCreatorDesc'),
      cta: t('oppCreatorCta'),
      href: '/creators',
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-4">
      {/* ── EN-TÊTE ──────────────────────────────────────────────────────── */}
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-grubano-ink">
          {tHome('greeting', { name: userName })}
        </h1>
        <p className="mt-1 text-sm text-grubano-ink-muted">
          <span className="capitalize">{t('overview')}</span>
          {' · '}
          {t('establishments', { count: agg.establishmentsCount })}
          {' · '}
          <span className="capitalize">{dateLine}</span>
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric highlight icon={<Euro size={14} />} label={t('metricCa')} value={fmtCur0.format(agg.caJour)} />
        <Metric icon={<ShoppingBag size={14} />} label={t('metricOrders')} value={String(agg.orders7d)} />
        <Metric
          icon={<TrendingUp size={14} />}
          label={t('metricBasket')}
          value={agg.avgBasket7d === null ? t('empty') : fmtCur2.format(agg.avgBasket7d)}
        />
        <Metric
          icon={<Star size={14} />}
          label={t('metricRating')}
          value={agg.avgRating === null ? t('empty') : agg.avgRating.toFixed(1)}
          caption={t('metricReviews', { count: agg.totalReviews })}
        />
      </div>

      {/* ── Encart adoption horaires (bloc C, T1.Q3) — sobre, disparaît une
            fois les horaires configurés. CTA → la section Horaires de la page
            établissement. */}
      {hoursToConfigure && (
        <Card elevation="sm" padding="md" className="mb-6 border-grubano-primary/30">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-grubano-tint text-grubano-primary">
              <Clock size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-sm font-semibold text-grubano-ink">{tHours('adoptTitle')}</h3>
              <p className="mt-0.5 text-xs text-grubano-ink-muted">{tHours('adoptDesc')}</p>
            </div>
            <Link
              href={`/dashboard/establishments/${hoursToConfigure.id}#horaires`}
              className="inline-flex shrink-0 items-center gap-1 rounded-grubano-lg bg-grubano-primary px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-grubano-primaryHover"
            >
              {tHours('adoptCta')}
              <ChevronRight size={13} className="rtl:rotate-180" />
            </Link>
          </div>
        </Card>
      )}

      {/* ── NIVEAU 1 — À traiter aujourd'hui ─────────────────────────────── */}
      <section className="mb-6">
        <SectionHeader icon={<AlertTriangle size={16} className="text-grubano-primary" />} title={t('alertsTitle')} />
        {!hasAlerts ? (
          <Card elevation="sm" padding="lg">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="h-8 w-8 text-grubano-success" />
              <p className="font-display text-base font-semibold text-grubano-ink">{t('allClearTitle')}</p>
              <p className="max-w-sm text-xs text-grubano-ink-muted">{t('allClearDesc')}</p>
            </div>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {brands.count > 0 && (
              <Card elevation="sm" padding="md" className="border-grubano-warning/40">
                <div className="mb-2 flex items-center gap-1.5">
                  <Building2 size={14} className="text-grubano-warning" />
                  <h3 className="font-display text-sm font-semibold text-grubano-ink">{t('alertBrandsTitle')}</h3>
                  <span className="ml-auto rounded-full bg-grubano-warning-tint px-1.5 py-0.5 text-[10px] font-bold text-grubano-warning">
                    {brands.count}
                  </span>
                </div>
                <ul className="space-y-1">
                  {brands.items.slice(0, MAX_ALERT_ROWS).map((it) => (
                    <li key={`${it.establishmentId}-${it.reason}`}>
                      <Link
                        href={`/dashboard/establishments/${it.establishmentId}`}
                        className="group flex items-center gap-2 rounded-grubano-md px-1.5 py-1.5 hover:bg-grubano-surface-muted"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-grubano-ink">
                          {it.establishmentName}
                        </span>
                        <span className="shrink-0 truncate text-[10px] text-grubano-ink-muted">
                          {reasonLabel(it.reason)}
                        </span>
                        <ChevronRight size={13} className="shrink-0 text-grubano-ink-faint group-hover:text-grubano-primary" />
                      </Link>
                    </li>
                  ))}
                  {brands.count > MAX_ALERT_ROWS && (
                    <li className="px-1.5 text-[10px] text-grubano-ink-faint">
                      {t('more', { count: brands.count - MAX_ALERT_ROWS })}
                    </li>
                  )}
                </ul>
              </Card>
            )}

            {stock.count > 0 && (
              <Card elevation="sm" padding="md" className="border-grubano-danger/40">
                <div className="mb-2 flex items-center gap-1.5">
                  <Package size={14} className="text-grubano-danger" />
                  <h3 className="font-display text-sm font-semibold text-grubano-ink">{t('alertStockTitle')}</h3>
                  <span className="rounded-full bg-grubano-danger-tint px-1.5 py-0.5 text-[10px] font-bold text-grubano-danger">
                    {stock.count}
                  </span>
                  <Link href="/stocks" className="ml-auto text-[10px] font-semibold text-grubano-primary hover:underline">
                    {t('seeAll')}
                  </Link>
                </div>
                <ul className="space-y-1">
                  {stock.items.slice(0, MAX_ALERT_ROWS).map((it) => (
                    <li key={it.stockItemId}>
                      <Link
                        href="/stocks"
                        className="group flex items-center gap-2 rounded-grubano-md px-1.5 py-1.5 hover:bg-grubano-surface-muted"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium capitalize text-grubano-ink">{it.name}</span>
                          <span className="block truncate text-[10px] text-grubano-ink-faint">
                            {it.brandName} · {t('stockMeta', { qty: it.quantity, unit: it.unit, threshold: it.minThreshold })}
                          </span>
                        </span>
                        <span
                          className={
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ' +
                            (it.severity === 'out'
                              ? 'bg-grubano-danger-tint text-grubano-danger'
                              : 'bg-grubano-warning-tint text-grubano-warning')
                          }
                        >
                          {it.severity === 'out' ? t('severityOut') : t('severityLow')}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {stock.count > MAX_ALERT_ROWS && (
                    <li className="px-1.5 text-[10px] text-grubano-ink-faint">
                      {t('more', { count: stock.count - MAX_ALERT_ROWS })}
                    </li>
                  )}
                </ul>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* ── NIVEAU 2 — Vos objectifs ─────────────────────────────────────── */}
      <section className="mb-6">
        <SectionHeader icon={<Sparkles size={16} className="text-grubano-primary" />} title={t('objectivesTitle')} />
        <div className="grid gap-3 md:grid-cols-3">
          {/* Franchisable — real criteria, provisional thresholds */}
          <Card elevation="sm" padding="md" className="flex flex-col">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Building2 size={14} className="text-grubano-primary" />
              <h3 className="font-display text-sm font-semibold text-grubano-ink">{t('objFranchiseTitle')}</h3>
            </div>
            <IndicativePill label={t('provisional')} />
            <div className="my-2.5">
              <ProgressBar value={frMet / 3} />
              <p className="mt-1 text-[10px] text-grubano-ink-faint">{t('progressMet', { met: frMet, total: 3 })}</p>
            </div>
            <ul className="space-y-1">
              <CriterionLine label={t('objFranchiseRating', { min: fr.thresholds.minAvgRating })} met={fr.criteria.ratingMet} unknownLabel={t('critUnknown')} />
              <CriterionLine label={t('objFranchiseVolume', { min: fr.thresholds.minWeeklyOrders })} met={fr.criteria.volumeMet} unknownLabel={t('critUnknown')} />
              <CriterionLine label={t('objFranchiseAge', { min: fr.thresholds.minAccountAgeDays })} met={fr.criteria.ageMet} unknownLabel={t('critUnknown')} />
            </ul>
            <Link href="/franchise" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-grubano-primary hover:underline">
              {t('objFranchiseCta')} <ArrowRight size={12} />
            </Link>
          </Card>

          {/* Creator — real numerator, indicative target */}
          <Card elevation="sm" padding="md" className="flex flex-col">
            <div className="mb-1.5 flex items-center gap-1.5">
              <ChefHat size={14} className="text-grubano-primary" />
              <h3 className="font-display text-sm font-semibold text-grubano-ink">{t('objCreatorTitle')}</h3>
            </div>
            <IndicativePill label={t('provisional')} />
            <div className="my-2.5">
              <ProgressBar value={crProgress} />
              <p className="mt-1 text-[10px] text-grubano-ink-faint">
                {t('objCreatorRecipes', { count: cr.adoptedRecipes })} · {t('objCreatorTarget', { target: CREATOR_TARGET_RECIPES })}
              </p>
            </div>
            <ul className="space-y-1 text-xs text-grubano-ink-muted">
              <li>{t('objCreatorCreators', { count: cr.linkedCreators })}</li>
            </ul>
            <Link href="/creators" className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-bold text-grubano-primary hover:underline">
              {t('objCreatorCta')} <ArrowRight size={12} />
            </Link>
          </Card>

          {/* Influencer — data unavailable → neutral, NO fake gauge */}
          <Card elevation="sm" padding="md" className="flex flex-col">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Users size={14} className="text-grubano-ink-faint" />
              <h3 className="font-display text-sm font-semibold text-grubano-ink">{t('objInfluencerTitle')}</h3>
            </div>
            <IndicativePill label={t('objInfluencerBadge')} />
            <p className="mt-2.5 text-xs text-grubano-ink-muted">{t('objInfluencerDesc')}</p>
          </Card>
        </div>

        {/* Vos prochaines opportunités */}
        <div className="mt-5">
          <SectionHeader title={t('oppsTitle')} />
          {opps.length === 0 ? (
            <p className="text-xs text-grubano-ink-muted">{t('oppsEmpty')}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {opps.map((o) => (
                <Link key={o.key} href={o.href} className="block">
                  <Card elevation="md" padding="lg" interactive className="h-full border border-grubano-primary/30 bg-grubano-tint/40">
                    <div className="flex items-start justify-between">
                      <div className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary text-white">{o.icon}</div>
                      <ChevronRight size={16} className="text-grubano-primary" />
                    </div>
                    <h3 className="mt-3 font-display text-base font-semibold text-grubano-ink">{o.title}</h3>
                    <p className="mt-1 text-xs text-grubano-ink-muted">{o.desc}</p>
                    <p className="mt-3 text-xs font-bold text-grubano-primary">{o.cta} →</p>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── NIVEAU 3 — pilotage : établissements cliquables ──────────────── */}
      <section>
        <SectionHeader icon={<Store size={16} className="text-grubano-primary" />} title={t('estabListTitle')} />
        <p className="-mt-1 mb-3 text-xs text-grubano-ink-muted">{t('estabListHint')}</p>
        {establishments.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {establishments.map((e) => (
              <Link
                key={e.id}
                href={`/dashboard/establishments/${e.id}`}
                aria-label={t('openLabel', { name: e.name })}
                className="block"
              >
                <Card elevation="sm" padding="md" interactive className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-grubano-lg bg-grubano-tint text-grubano-primary">
                    <Store size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-grubano-ink">{e.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-grubano-ink-muted">
                      {e.city && (
                        <>
                          <span className="truncate">{e.city}</span>
                          <span className="text-grubano-ink-faint">·</span>
                        </>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <span className={'h-1.5 w-1.5 rounded-full ' + (e.isActive ? 'bg-grubano-success' : 'bg-grubano-ink-faint')} />
                        {e.isActive ? t('online') : t('offline')}
                      </span>
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-grubano-ink-faint" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ── Inline display helpers ─────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {icon}
      <h2 className="font-display text-base font-semibold text-grubano-ink">{title}</h2>
    </div>
  )
}

function Metric({
  icon, label, value, caption, highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  caption?: string
  highlight?: boolean
}) {
  return (
    <Card elevation="sm" padding="md" className={highlight ? 'bg-grubano-dark text-white' : ''}>
      <span
        className={
          'grid h-8 w-8 place-items-center rounded-grubano-md ' +
          (highlight ? 'bg-grubano-primary text-white' : 'bg-grubano-tint text-grubano-primary')
        }
      >
        {icon}
      </span>
      <p className={'mt-3 text-[10px] uppercase tracking-wider ' + (highlight ? 'text-white/60' : 'text-grubano-ink-muted')}>
        {label}
      </p>
      <p className={'mt-0.5 text-xl font-bold tracking-tight ' + (highlight ? 'text-white' : 'text-grubano-ink')}>
        {value}
      </p>
      {caption && (
        <p className={'mt-0.5 text-[10px] ' + (highlight ? 'text-white/40' : 'text-grubano-ink-faint')}>{caption}</p>
      )}
    </Card>
  )
}

function IndicativePill({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center rounded-full bg-grubano-surface-muted px-2 py-0.5 text-[10px] font-medium text-grubano-ink-muted">
      {label}
    </span>
  )
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-grubano-surface-muted">
      <div className="h-full rounded-full bg-grubano-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

function CriterionLine({
  label, met, unknownLabel,
}: {
  label: string
  met: boolean | null
  unknownLabel: string
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {met === true ? (
        <Check size={13} className="shrink-0 text-grubano-success" />
      ) : met === null ? (
        <Minus size={13} className="shrink-0 text-grubano-ink-faint" />
      ) : (
        <X size={13} className="shrink-0 text-grubano-ink-faint" />
      )}
      <span className={met === true ? 'text-grubano-ink' : 'text-grubano-ink-muted'}>{label}</span>
      {met === null && <span className="ml-auto text-[10px] text-grubano-ink-faint">{unknownLabel}</span>}
    </li>
  )
}
