'use client'

/**
 * Mes revenus — 30-day earnings split by source.
 * Robinet A (Recettes): recipeEarnings30d (DishSale, 4% du CA)
 *   → affiché en triptyque : Généré / Commission Grubano (20%) / Tu touches (net)
 * Robinet B (Affiliation): referralEarnings30d (ReferralOrder, 22%)
 *   → DishSale.grubanoCut n'existe pas sur ReferralOrder ; ce montant est déjà
 *     la part nette créateur calculée par Grubano (22% de la commission plateforme).
 *     Pas de triptyque possible ici — on affiche le montant net tel qu'exposé.
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
            <div key={i} className="h-24 animate-pulse rounded-grubano-xl bg-grubano-bg" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">

          {/* ── Recipe earnings card — triptyque ─────────────────────────── */}
          <Card elevation="sm" padding="md">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-4">
              <div className="h-9 w-9 rounded-grubano-lg bg-grubano-primary/10 flex items-center justify-center shrink-0">
                <ChefHat size={18} className="text-grubano-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">{tr('recipeLabel')}</p>
                <p className="text-[10px] text-grubano-ink-muted">4% / vente · 30 derniers jours</p>
              </div>
              <span className="ml-auto rounded-grubano-pill bg-grubano-primary/10 px-2 py-0.5 text-[10px] font-bold text-grubano-primary shrink-0">
                4%
              </span>
            </div>

            {/* Triptyque breakdown */}
            <div className="space-y-2">
              {/* Row 1 — Gross */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-grubano-ink-muted">{tr('recipeGenerated')}</p>
                <p className="text-sm font-semibold tabular-nums">€{fmt(recipeEarnings30d)}</p>
              </div>

              {/* Row 2 — Commission */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-grubano-ink-muted">{tr('recipeCommission')}</p>
                <p className="text-sm font-semibold tabular-nums text-grubano-danger">
                  −€{fmt(recipeGrubanoFee30d)}
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-grubano-border" />

              {/* Row 3 — Net (primary) */}
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{tr('recipeNet')}</p>
                <p className="text-2xl font-display font-bold text-grubano-primary tabular-nums">
                  €{fmt(recipeNet30d)}
                </p>
              </div>
            </div>
          </Card>

          {/* ── Affiliation earnings card ────────────────────────────────── */}
          <Card elevation="sm" padding="md">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-grubano-lg bg-[#3B82F6]/10 flex items-center justify-center shrink-0">
                  <Megaphone size={18} className="text-[#3B82F6]" />
                </div>
                <div>
                  <p className="text-sm font-bold">{tr('affiliationLabel')}</p>
                  <p className="text-[10px] text-grubano-ink-muted">22% · 90j · ReferralOrder</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-display font-bold text-[#3B82F6] tabular-nums">
                  €{fmt(referralEarnings30d)}
                </p>
                <span className="inline-block rounded-grubano-pill bg-[#3B82F6]/10 px-2 py-0.5 text-[10px] font-bold text-[#3B82F6]">
                  22%
                </span>
              </div>
            </div>
            {/* Affiliation note: creatorEarning is already net (no grubanoCut on ReferralOrder) */}
            <div className="flex items-start gap-1.5 rounded-grubano-md bg-grubano-bg px-2.5 py-2">
              <Info size={11} className="text-grubano-ink-faint mt-0.5 shrink-0" />
              <p className="text-[10px] text-grubano-ink-muted leading-relaxed">
                {tr('affiliationNote')}
              </p>
            </div>
          </Card>

          {/* ── Total card ───────────────────────────────────────────────── */}
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
