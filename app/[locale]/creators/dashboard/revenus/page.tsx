'use client'

/**
 * Mes revenus — 30-day earnings split by source.
 * Robinet A: recipeEarnings30d  (DishSale, 4%)
 * Robinet B: referralEarnings30d (ReferralOrder, 22%)
 * Fetches /api/creators/home (read-only).
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TrendingUp, ChefHat, Megaphone } from 'lucide-react'
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
  const referralEarnings30d = data?.referralEarnings30d ?? 0
  const totalEarnings30d    = data?.earningsThisMonth   ?? 0

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

          {/* ── Recipe earnings card ─────────────────────────────────────── */}
          <Card elevation="sm" padding="md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-grubano-lg bg-grubano-primary/10 flex items-center justify-center shrink-0">
                  <ChefHat size={18} className="text-grubano-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold">{tr('recipeLabel')}</p>
                  <p className="text-[10px] text-grubano-ink-muted">4% / vente · DishSale</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-display font-bold text-grubano-primary">
                  €{recipeEarnings30d.toFixed(2)}
                </p>
                <span className="inline-block rounded-grubano-pill bg-grubano-primary/10 px-2 py-0.5 text-[10px] font-bold text-grubano-primary">
                  4%
                </span>
              </div>
            </div>
          </Card>

          {/* ── Affiliation earnings card ────────────────────────────────── */}
          <Card elevation="sm" padding="md">
            <div className="flex items-center justify-between">
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
                <p className="text-2xl font-display font-bold text-[#3B82F6]">
                  €{referralEarnings30d.toFixed(2)}
                </p>
                <span className="inline-block rounded-grubano-pill bg-[#3B82F6]/10 px-2 py-0.5 text-[10px] font-bold text-[#3B82F6]">
                  22%
                </span>
              </div>
            </div>
          </Card>

          {/* ── Total card ───────────────────────────────────────────────── */}
          <div className="rounded-grubano-xl bg-grubano-ink p-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} />
              <p className="text-sm font-bold">{tr('totalLabel')}</p>
            </div>
            <p className="text-2xl font-display font-bold">€{totalEarnings30d.toFixed(2)}</p>
          </div>

        </div>
      )}
    </div>
  )
}
