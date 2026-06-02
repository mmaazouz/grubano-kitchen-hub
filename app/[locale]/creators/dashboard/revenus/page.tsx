'use client'

/**
 * Mes revenus — 30-day earnings split by source.
 *
 * Both cards follow the same layout:
 *   [Icon] [Label]               [Rate badge]
 *   €XX.XX  ← NET, large, title tooltip = full detail
 *   context line (tiny, gray) + ⓘ tooltip
 *
 * Robinet A (Recettes): net = recipeNet30d = recipeEarnings30d − recipeGrubanoFee30d
 * Robinet B (Affiliation): net = referralEarnings30d (already net by construction —
 *   creatorEarning on ReferralOrder = 22% of Grubano's commission, no grubanoCut field)
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TrendingUp, ChefHat, Megaphone, Info } from 'lucide-react'
import { Card } from '@/components/design-system'
import type { CreatorHomeData } from '@/app/api/creators/home/route'

export default function CreatorRevenusPage() {
  const tr = useTranslations('creators.revenus')

  const [data,    setData]    = useState<CreatorHomeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/creators/home')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const recipeEarnings30d   = data?.recipeEarnings30d   ?? 0
  const recipeGrubanoFee30d = data?.recipeGrubanoFee30d ?? 0
  const recipeNet30d        = data?.recipeNet30d        ?? 0
  const referralEarnings30d = data?.referralEarnings30d ?? 0
  const totalEarnings30d    = data?.earningsThisMonth   ?? 0

  const fmt = (n: number) =>
    n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Tooltip strings — reuse existing keys, built client-side
  const recipeTooltip      = `${tr('recipeGenerated')} €${fmt(recipeEarnings30d)} · ${tr('recipeCommission')} −€${fmt(recipeGrubanoFee30d)} · ${tr('recipeNet')} €${fmt(recipeNet30d)}`
  const affiliationTooltip = tr('affiliationTooltip')

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto space-y-5">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={18} className="text-grubano-primary" />
          <h1 className="text-xl font-display font-bold">{tr('title')}</h1>
        </div>
        <p className="text-sm text-grubano-ink-muted">{tr('subtitle')}</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 animate-pulse rounded-grubano-xl bg-grubano-bg" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">

          {/* ── Recipe card ──────────────────────────────────────────────── */}
          <Card elevation="sm" padding="md">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 rounded-grubano-lg bg-grubano-primary/10 flex items-center justify-center shrink-0">
                <ChefHat size={18} className="text-grubano-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">{tr('recipeLabel')}</p>
                <p className="text-[10px] text-grubano-ink-muted">30 {tr('lastDays')}</p>
              </div>
              <span className="ml-auto rounded-grubano-pill bg-grubano-primary/10 px-2 py-0.5 text-[10px] font-bold text-grubano-primary shrink-0">
                4%
              </span>
            </div>

            {/* Net amount — primary */}
            <p
              className="text-3xl font-display font-bold text-grubano-primary tabular-nums"
              title={recipeTooltip}
            >
              €{fmt(recipeNet30d)}
            </p>

            {/* Context line + info icon */}
            <div className="flex items-center gap-1 mt-1.5">
              <p className="text-[11px] text-grubano-ink-muted">{tr('recipeContext')}</p>
              <button
                type="button"
                title={recipeTooltip}
                className="text-grubano-ink-faint hover:text-grubano-ink-muted transition shrink-0"
                aria-label={recipeTooltip}
              >
                <Info size={11} />
              </button>
            </div>
          </Card>

          {/* ── Affiliation card ─────────────────────────────────────────── */}
          <Card elevation="sm" padding="md">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 rounded-grubano-lg bg-[#3B82F6]/10 flex items-center justify-center shrink-0">
                <Megaphone size={18} className="text-[#3B82F6]" />
              </div>
              <div>
                <p className="text-sm font-bold">{tr('affiliationLabel')}</p>
                <p className="text-[10px] text-grubano-ink-muted">30 {tr('lastDays')}</p>
              </div>
              <span className="ml-auto rounded-grubano-pill bg-[#3B82F6]/10 px-2 py-0.5 text-[10px] font-bold text-[#3B82F6] shrink-0">
                22%
              </span>
            </div>

            {/* Net amount — primary */}
            <p
              className="text-3xl font-display font-bold text-[#3B82F6] tabular-nums"
              title={affiliationTooltip}
            >
              €{fmt(referralEarnings30d)}
            </p>

            {/* Context line + info icon */}
            <div className="flex items-center gap-1 mt-1.5">
              <p className="text-[11px] text-grubano-ink-muted">{tr('affiliationContext')}</p>
              <button
                type="button"
                title={affiliationTooltip}
                className="text-grubano-ink-faint hover:text-grubano-ink-muted transition shrink-0"
                aria-label={affiliationTooltip}
              >
                <Info size={11} />
              </button>
            </div>
          </Card>

          {/* ── Total card — unchanged ────────────────────────────────────── */}
          <div className="rounded-grubano-xl bg-grubano-ink p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} />
              <p className="text-sm font-bold">{tr('totalLabel')}</p>
            </div>
            <p className="text-2xl font-display font-bold tabular-nums">€{fmt(totalEarnings30d)}</p>
          </div>

        </div>
      )}
    </div>
  )
}
