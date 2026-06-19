'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, TrendingUp, MousePointerClick, Trophy, Flame, Award } from 'lucide-react'
import { Card, Badge } from '@/components/design-system'
import type { BadgeTone } from '@/components/design-system'

// ── AffiliateDashboardClient — top-level affiliate dashboard (Brique C, Agent 60) ─────
// READ-ONLY: fetches /api/affiliate/stats (owner-scoped, flag-gated server-side) and renders
// the balance/earnings (from Brique B), the gamification (tiers/streak/badges/leaderboard,
// the SAME pure engine as the creator rail), and the click→conversion funnel. No money.

type Stats = {
  earnings: { maturedCents: number; pendingCents: number }
  balance:  { availableCents: number; paidCents: number }
  clicks:   { total: number; conversions: number; conversionRatePct: number }
  tier:     { key: string; nextKey: string | null; progressPct: number } | null
  streak:   { weeks: number }
  badges:   { key: string; achieved: boolean }[]
  leaderboard: { top: { rank: number; name: string; tierKey: string; isMe: boolean }[]; myRank: number | null; total: number } | null
  commissionPct: number | null
}

const eur = (cents: number) => (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const TIER_TONE: Record<string, BadgeTone> = { bronze: 'neutral', silver: 'info', gold: 'warning', platinum: 'primary' }

export default function AffiliateDashboardClient() {
  const t = useTranslations('affiliate')
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch('/api/affiliate/stats')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setStats)
      .catch(() => setError(t('statsLoadError')))
      .finally(() => setLoading(false))
  }, [t])

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-grubano-ink-muted"><Loader2 size={20} className="animate-spin" /></div>
  }
  if (error || !stats) {
    return <Card elevation="sm" padding="md"><p className="text-sm text-grubano-danger">{error || t('statsLoadError')}</p></Card>
  }

  const tierLabel = (k: string) => t(`tier_${k}` as 'tier_bronze')

  return (
    <div className="space-y-4">
      {/* Earnings + balance */}
      <Card elevation="sm" padding="md">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-grubano-primary" />
          <p className="text-sm font-bold">{t('statsTitle')}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: t('balancePending'),   value: stats.earnings.pendingCents, cls: 'text-grubano-ink' },
            { label: t('balanceMatured'),   value: stats.earnings.maturedCents, cls: 'text-grubano-success' },
            { label: t('balanceAvailable'), value: stats.balance.availableCents, cls: 'text-grubano-primary' },
          ] as const).map(({ label, value, cls }) => (
            <div key={label} className="rounded-grubano-md bg-grubano-bg px-2 py-2 text-center">
              <p className={`text-base font-bold ${cls}`}>{eur(value)} €</p>
              <p className="text-[10px] text-grubano-ink-muted">{label}</p>
            </div>
          ))}
        </div>
        {stats.commissionPct != null && (
          <p className="mt-2 text-[11px] text-grubano-ink-faint">{t('commissionLine', { pct: stats.commissionPct })}</p>
        )}
      </Card>

      {/* Click → conversion funnel */}
      <Card elevation="sm" padding="md">
        <div className="flex items-center gap-2 mb-2">
          <MousePointerClick size={16} className="text-grubano-primary" />
          <p className="text-sm font-bold">{t('clicksTitle')}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: t('clicks'),      value: String(stats.clicks.total) },
            { label: t('conversions'), value: String(stats.clicks.conversions) },
            { label: t('convRate'),    value: `${stats.clicks.conversionRatePct}%` },
          ] as const).map(({ label, value }) => (
            <div key={label} className="rounded-grubano-md bg-grubano-bg px-2 py-2 text-center">
              <p className="text-base font-bold">{value}</p>
              <p className="text-[10px] text-grubano-ink-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Tier + streak */}
      {stats.tier && (
        <Card elevation="sm" padding="md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Award size={16} className="text-grubano-primary" />
              <p className="text-sm font-bold">{t('tierTitle')}</p>
            </div>
            <Badge tone={TIER_TONE[stats.tier.key] ?? 'neutral'} size="sm">{tierLabel(stats.tier.key)}</Badge>
          </div>
          <div className="h-2 w-full rounded-grubano-pill bg-grubano-bg overflow-hidden">
            <div className="h-full bg-grubano-primary rtl:ml-auto" style={{ width: `${stats.tier.progressPct}%` }} />
          </div>
          {stats.tier.nextKey && (
            <p className="mt-1.5 text-[11px] text-grubano-ink-muted">{t('tierNext', { tier: tierLabel(stats.tier.nextKey) })}</p>
          )}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Flame size={15} className="text-grubano-warning" />
            <span className="text-grubano-ink-muted">{t('streakValue', { weeks: stats.streak.weeks })}</span>
          </div>
        </Card>
      )}

      {/* Badges */}
      <Card elevation="sm" padding="md">
        <p className="text-sm font-bold mb-2">{t('badgesTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {stats.badges.map(b => (
            <span
              key={b.key}
              className={`rounded-grubano-pill px-2.5 py-1 text-[11px] font-semibold ${b.achieved ? 'bg-grubano-tint text-grubano-primary' : 'bg-grubano-surface-muted text-grubano-ink-faint'}`}
            >
              {b.achieved ? '★ ' : ''}{t(`badge_${b.key}` as 'badge_firstSale')}
            </span>
          ))}
        </div>
      </Card>

      {/* Leaderboard (privacy-safe: rank + name + tier only) */}
      {stats.leaderboard && stats.leaderboard.top.length > 0 && (
        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={16} className="text-grubano-primary" />
            <p className="text-sm font-bold">{t('leaderboardTitle')}</p>
          </div>
          <ol className="space-y-1.5">
            {stats.leaderboard.top.map(row => (
              <li key={row.rank} className={`flex items-center justify-between rounded-grubano-md px-2 py-1.5 ${row.isMe ? 'bg-grubano-tint' : 'bg-grubano-bg'}`}>
                <span className="flex items-center gap-2 text-sm">
                  <span className="font-bold text-grubano-ink-muted w-5">{row.rank}</span>
                  <span className={row.isMe ? 'font-bold text-grubano-primary' : 'text-grubano-ink'}>{row.isMe ? t('leaderboardYou') : row.name}</span>
                </span>
                <Badge tone={TIER_TONE[row.tierKey] ?? 'neutral'} size="sm">{tierLabel(row.tierKey)}</Badge>
              </li>
            ))}
          </ol>
          {stats.leaderboard.myRank != null && (
            <p className="mt-2 text-[11px] text-grubano-ink-muted">{t('myRank', { rank: stats.leaderboard.myRank, total: stats.leaderboard.total })}</p>
          )}
        </Card>
      )}
    </div>
  )
}
