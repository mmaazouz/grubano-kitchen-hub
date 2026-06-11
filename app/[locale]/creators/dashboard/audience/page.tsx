'use client'

/**
 * Mon affiliation — Robinet B (22% de la commission Grubano sur 90 jours)
 * Fetches /api/creators/home (read-only): referral code/link, KPIs audience,
 * social networks.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Megaphone, Copy, Check, Link2,
  Instagram, Users2, ShoppingBag, Wallet,
} from 'lucide-react'
import { Card, Button, EmptyState } from '@/components/design-system'
import { buildReferralLink } from '@/lib/referral-link'
import type { CreatorHomeData } from '@/app/api/creators/home/route'

export default function CreatorAffiliationPage() {
  const ta = useTranslations('creators.affiliation')

  const [data,    setData]    = useState<CreatorHomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied,  setCopied]  = useState(false)

  useEffect(() => {
    fetch('/api/creators/home')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const creator      = data?.creator  ?? null
  const audience     = data?.audience ?? { referralsCount: 0, ordersCount: 0, earningsTotal: 0, earningsThisMonth: 0, earningsLastMonth: 0 }
  const rates        = data?.referralRates
  const referralSlug = creator?.referralLinkSlug ?? creator?.referralCode?.toLowerCase() ?? null
  // Shared builder (B1-bis): /ref/<slug> on the page's real origin with the
  // business.* browsing host neutralized — never a hardcoded domain.
  const referralLink = buildReferralLink(referralSlug)

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto space-y-5">

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className="rounded-grubano-xl bg-gradient-to-br from-[#3B82F6] to-[#3B82F6]/70 p-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <Megaphone size={20} />
          <h1 className="text-lg font-display font-bold leading-tight">{ta('title')}</h1>
          <span className="ml-auto rounded-grubano-pill bg-white/20 px-2.5 py-0.5 text-xs font-bold shrink-0">
            {rates
              ? `${Math.round((rates.commissionPct ?? 0.22) * 100)}% · ${rates.durationDays ?? 90}j`
              : ta('badge')}
          </span>
        </div>
        <p className="text-sm opacity-90 leading-relaxed">{ta('subtitle')}</p>
      </div>

      {loading ? (
        <Card elevation="sm" padding="md">
          <div className="h-[180px] animate-pulse bg-grubano-bg rounded-grubano-lg" />
        </Card>
      ) : !creator?.referralCode ? (
        /* ── No code yet ─────────────────────────────────────────────────── */
        <Card elevation="sm" padding="md">
          <EmptyState
            compact
            emoji={<Megaphone size={28} className="text-[#3B82F6]" />}
            title={ta('noCode')}
            description={ta('noCodeDesc')}
          />
        </Card>
      ) : (
        <>
          {/* ── Code + link block ──────────────────────────────────────────── */}
          <Card elevation="sm" padding="md">
            <p className="text-[10px] text-grubano-ink-muted uppercase tracking-wide font-semibold mb-1.5">
              {ta('codeLabel')}
            </p>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 rounded-grubano-lg bg-grubano-bg px-3 py-2 text-base font-mono font-bold tracking-widest text-[#3B82F6] truncate">
                {creator.referralCode}
              </code>
              <button
                onClick={() => copyToClipboard(creator.referralCode!)}
                className="flex items-center gap-1.5 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-xs font-semibold hover:bg-grubano-bg transition shrink-0"
              >
                {copied
                  ? <><Check size={12} className="text-grubano-success" />{ta('copied')}</>
                  : <><Copy size={12} />{ta('copy')}</>
                }
              </button>
            </div>

            {referralLink && (
              <div className="flex items-center gap-2">
                <Link2 size={11} className="text-grubano-ink-faint shrink-0" />
                <p
                  className="text-[11px] text-grubano-ink-muted font-mono truncate flex-1 cursor-pointer hover:text-grubano-ink transition"
                  onClick={() => copyToClipboard(referralLink)}
                  title={ta('linkLabel')}
                >
                  {referralLink}
                </p>
                <button
                  onClick={() => copyToClipboard(referralLink)}
                  className="text-[10px] font-semibold text-[#3B82F6] hover:underline shrink-0"
                >
                  {ta('copy')}
                </button>
              </div>
            )}
          </Card>

          {/* ── KPI grid ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { icon: <Users2    size={14} className="text-[#3B82F6]" />, label: ta('kpiCustomers'),    value: String(audience.referralsCount)            },
              { icon: <ShoppingBag size={14} className="text-[#3B82F6]" />, label: ta('kpiOrders'),    value: String(audience.ordersCount)               },
              { icon: <Wallet    size={14} className="text-[#3B82F6]" />, label: ta('kpiEarnings30d'),  value: `€${(data?.referralEarnings30d ?? 0).toFixed(2)}` },
              { icon: <Wallet    size={14} className="text-[#3B82F6]" />, label: ta('kpiEarningsTotal'), value: `€${audience.earningsTotal.toFixed(2)}`  },
            ] as const).map(({ icon, label, value }) => (
              <Card key={label} elevation="sm" padding="sm">
                <div className="flex items-center gap-1.5 mb-1">{icon}</div>
                <p className="text-sm font-bold">{value}</p>
                <p className="text-[10px] text-grubano-ink-muted mt-0.5">{label}</p>
              </Card>
            ))}
          </div>

          {/* ── Social networks ──────────────────────────────────────────── */}
          {(creator.followers > 0 || creator.instagram || creator.tiktok) && (
            <Card elevation="sm" padding="md">
              <div className="flex items-center gap-2 flex-wrap">
                {creator.followers > 0 && (
                  <span className="text-xs text-grubano-ink-muted">
                    {creator.followers.toLocaleString('fr-FR')} abonnés
                  </span>
                )}
                {creator.instagram && (
                  <a
                    href={`https://instagram.com/${creator.instagram}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-grubano-ink-muted hover:text-grubano-ink transition"
                  >
                    <Instagram size={12} />
                    @{creator.instagram}
                  </a>
                )}
                {creator.tiktok && (
                  <a
                    href={`https://tiktok.com/@${creator.tiktok}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-grubano-ink-muted hover:text-grubano-ink transition"
                  >
                    @{creator.tiktok}
                  </a>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
