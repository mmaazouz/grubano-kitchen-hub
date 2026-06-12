'use client'

/**
 * Mes recettes — Robinet A (taux réel AdoptionConfig — jamais en dur)
 * Fetches /api/creators/home (read-only) and shows the creator's dishes
 * with real adoption counts, earnings, and per-adopter accordion.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChefHat, Upload, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Store,
} from 'lucide-react'

// locale-aware currency formatter (2 dec, fr-FR like the rest of the portal)
function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
import { Link } from '@/navigation'
import { Card, Button, Badge, EmptyState, SkeletonList } from '@/components/design-system'
import type { CreatorHomeData, CreatorHomeDish, DishAdopter } from '@/app/api/creators/home/route'

export default function CreatorRecipesPage() {
  const t  = useTranslations('creators.home')
  const tr = useTranslations('creators.recipes')
  const tn = useTranslations('creators.rolesGate')

  const [data,       setData]       = useState<CreatorHomeData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/creators/home')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Status badge ───────────────────────────────────────────────────────────
  function StatusBadge({ status }: { status: string }) {
    if (status === 'approved' || status === 'live')
      return <Badge tone="success" size="sm" icon={<CheckCircle2 size={9} />}>{t('dishStatusActive')}</Badge>
    if (status === 'pending')
      return <Badge tone="warning" size="sm" icon={<Clock size={9} />}>{t('dishStatusPending')}</Badge>
    return <Badge tone="danger" size="sm">{t('dishStatusRejected')}</Badge>
  }

  if (loading) {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto space-y-4">
        <SkeletonList count={4} />
      </div>
    )
  }

  const dishes = (data?.dishes ?? []) as CreatorHomeDish[]

  // Mission 2 - chef role disabled -> clean gate + one-tap re-enable.
  if (data?.roles && data.roles.isChef === false) {
    return (
      <div className="px-4 pt-12 max-w-2xl mx-auto">
        <EmptyState
          emoji="🍳"
          title={tn('chefOffTitle')}
          description={tn('chefOffBody')}
          action={
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch('/api/creators/me/roles', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isChef: true }),
                  })
                  if (r.ok) window.location.reload()
                } catch { /* retryable */ }
              }}
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white"
            >
              {tn('enableCta')}
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto space-y-5">

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className="rounded-grubano-xl bg-gradient-to-br from-grubano-primary to-grubano-primary/70 p-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <ChefHat size={20} />
          <h1 className="text-lg font-display font-bold leading-tight">{tr('title')}</h1>
          <span className="ml-auto rounded-grubano-pill bg-white/20 px-2.5 py-0.5 text-xs font-bold shrink-0">
            {tr('badge', { pct: Math.round((data?.adoptionCommissionPct ?? 0.02) * 100) })}
          </span>
        </div>
        <p className="text-sm opacity-90 leading-relaxed">{tr('subtitle')}</p>
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      {data && (
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: tr('kpiEarnings'),  value: `€${(data.dishEarningsTotal  ?? 0).toFixed(2)}` },
            { label: tr('kpiAdoptions'), value: String(data.dishAdoptionsTotal ?? 0) },
            { label: tr('kpiSales'),     value: String(data.dishSalesTotal     ?? 0) },
          ] as const).map(({ label, value }) => (
            <Card key={label} elevation="sm" padding="sm">
              <p className="text-sm font-bold text-grubano-primary">{value}</p>
              <p className="text-[10px] text-grubano-ink-muted mt-0.5 leading-tight">{label}</p>
            </Card>
          ))}
        </div>
      )}

      {/* ── Dish list ────────────────────────────────────────────────────── */}
      <Card elevation="sm" padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <ChefHat size={14} className="text-grubano-primary" />
            {t('dishesTitle')}
          </h2>
          <Link href="/creators/dashboard">
            <Button variant="ghost" size="sm" leftIcon={<Upload size={11} />}>
              {t('dishSubmitCta')}
            </Button>
          </Link>
        </div>

        {dishes.length === 0 ? (
          <EmptyState
            compact
            emoji={<ChefHat size={24} />}
            title={t('dishesEmpty')}
            description={t('dishesEmptyDesc')}
            action={
              <Link href="/creators/dashboard">
                <Button variant="primary" size="sm">{t('dishSubmitCta')}</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-0">
            {dishes.map(dish => {
              const isExpanded  = expandedId === dish.id
              const hasAdopters = dish.adopters.length > 0
              return (
                <div key={dish.id} className="border-b border-grubano-border last:border-0">
                  {/* Dish row */}
                  <button
                    onClick={() => hasAdopters && setExpandedId(isExpanded ? null : dish.id)}
                    className={[
                      'w-full flex items-center justify-between py-2 text-left',
                      hasAdopters ? 'cursor-pointer' : 'cursor-default',
                    ].join(' ')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{dish.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <StatusBadge status={dish.status} />
                        {dish.adoptions > 0 && (
                          <span className="text-[10px] text-grubano-ink-muted flex items-center gap-0.5">
                            <Store size={9} />
                            {t('dishAdoptions', { count: dish.adoptions })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 shrink-0">
                      <div
                        className="text-right"
                        title={`Généré €${fmt(dish.earnings)} · Commission Grubano −€${fmt(dish.grubanoFee ?? 0)} · Net €${fmt(dish.earningsNet ?? dish.earnings)}`}
                      >
                        <p className="text-[9px] text-grubano-ink-faint uppercase tracking-wide leading-none mb-0.5">
                          {t('dishNetLabel')}
                        </p>
                        <p className="text-xs font-bold text-grubano-success">€{fmt(dish.earningsNet ?? dish.earnings)}</p>
                        <p className="text-[10px] text-grubano-ink-muted">{t('dishSales', { count: dish.totalSales })}</p>
                      </div>
                      {hasAdopters && (
                        isExpanded
                          ? <ChevronUp  size={12} className="text-grubano-ink-muted" />
                          : <ChevronDown size={12} className="text-grubano-ink-muted" />
                      )}
                    </div>
                  </button>

                  {/* Adopters accordion */}
                  {isExpanded && (
                    <div className="pb-2 space-y-1.5">
                      {dish.adopters.map((adopter: DishAdopter) => {
                        const sinceDate = new Date(adopter.adoptedAt)
                          .toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                        return (
                          <div
                            key={adopter.adoptionId}
                            className="flex items-center justify-between rounded-grubano-md bg-grubano-bg px-2.5 py-1.5"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm shrink-0">{adopter.brandEmoji}</span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold truncate">{adopter.brandName}</p>
                                <p className="text-[10px] text-grubano-ink-muted">
                                  {t('dishAdopterSince', { date: sinceDate })}
                                  {' · '}€{adopter.sellingPrice.toFixed(2)}
                                </p>
                              </div>
                            </div>
                            {adopter.commitmentMet ? (
                              <span className="ml-2 shrink-0 flex items-center gap-0.5 rounded-grubano-pill bg-grubano-success/10 px-2 py-0.5 text-[9px] font-semibold text-grubano-success">
                                <CheckCircle2 size={9} />
                                {t('dishAdopterCommitmentMet')}
                              </span>
                            ) : (
                              <span className="ml-2 shrink-0 rounded-grubano-pill bg-grubano-bg border border-grubano-border px-2 py-0.5 text-[9px] font-medium text-grubano-ink-muted">
                                {t('dishAdopterDaysLeft', { days: adopter.daysRemaining })}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
