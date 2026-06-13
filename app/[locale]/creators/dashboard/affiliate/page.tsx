'use client'

/**
 * Mon affiliation — Dashboard Affiliés Slice 2a (Agent 14). The INFLUENCER's
 * home for their /ref rail, built future-proof over:
 *
 *   GET /api/creator/affiliate-stats
 *   → { isInfluencer, links{base,code,slug}, earnings{maturedCents,pendingCents,
 *       byMonth[]}, referrals{newCustomers, orders[]}, payout{claimableCents,
 *       status:'activation_pending'}, tier:null, commissionPct }
 *
 * READ-ONLY: amounts are CENTS; statuses are the SERVER lifecycle (pending |
 * matured) — zero client-side status math. Links are built by the shared pure
 * helper (lib/affiliate-link) over the EXISTING /ref attribution — including
 * deep links (?to=) to a precise restaurant.
 *
 * Sections: PULSE → MES LIENS & CODES (+ QR + deep-link generator) → GAINS
 * (transparent, on the NET) → ACTIVITÉ (feed) → VERSEMENT (honest 'activation
 * pending') → placeholders « bientôt » (Studio / Paliers / Performance). Non-
 * influencer / brand-new states are clean, never an empty screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  Megaphone, TrendingUp, TrendingDown, Users, ShoppingBag, Copy, Check, QrCode,
  Loader2, AlertCircle, Landmark, Activity, Sparkles, BarChart3, Award, Link2, Store,
  Trophy, Flame, Medal,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Card } from '@/components/design-system'
import { buildAffiliateLink, buildAffiliateRestaurantLink } from '@/lib/affiliate-link'
import AffiliateStudio from '@/components/creators/AffiliateStudio'

// ── Contract (mirrored locally — the route is the source of truth) ────────────
interface ByMonth { month: string; gainCents: number }
interface AffOrder {
  id: string; date: string; restaurant: string | null; orderTotalCents: number | null
  grubanoFeeCents: number; creatorEarningCents: number; bonusCents: number
  status: 'pending' | 'matured' | 'cancelled' | 'paid' | string; maturedAt: string | null
}
interface AffiliatePayload {
  isInfluencer: boolean
  links:     { base: string | null; code: string | null; slug: string | null }
  earnings:  { maturedCents: number; pendingCents: number; byMonth: ByMonth[] }
  referrals: { newCustomers: number; orders: AffOrder[] }
  payout:    { claimableCents: number; status: string }
  tier:      null | { key: string; floorCents: number; nextKey: string | null; nextFloorCents: number | null; progressPct: number }
  streak:    { weeks: number }
  badges:    { key: string; achieved: boolean }[]
  leaderboard: null | { top: { rank: number; name: string; tierKey: string; isMe: boolean }[]; myRank: number | null; total: number }
  commissionPct: number | null
}

export default function AffiliateDashboardPage() {
  const t = useTranslations('creators.affiliate')
  const locale = useLocale()

  const [data, setData]       = useState<AffiliatePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState<string | null>(null)
  const [qrOpen, setQrOpen]   = useState<'base' | 'deep' | null>(null)
  // Deep-link generator: a small restaurant picker (public list, read-only).
  const [restos, setRestos]   = useState<{ id: string; name: string }[]>([])
  const [restoId, setRestoId] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/creator/affiliate-stats', { cache: 'no-store' })
      if (res.status === 404) { setError(t('noProfile')); return }
      if (!res.ok) throw new Error('load_failed')
      setData(await res.json() as AffiliatePayload)
    } catch {
      setError(t('errLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  // Public restaurant list for the deep-link generator (best-effort, read-only).
  useEffect(() => {
    let cancelled = false
    fetch('/api/restaurants?take=50', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        const list = Array.isArray(d) ? d : (d.restaurants ?? d.items ?? [])
        if (Array.isArray(list)) {
          setRestos(list.filter((x) => x && x.id && x.name).map((x) => ({ id: String(x.id), name: String(x.name) })))
        }
      })
      .catch(() => { /* picker simply stays empty */ })
    return () => { cancelled = true }
  }, [])

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key); setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard unavailable — no crash */ }
  }

  const fmtCents = useMemo(() => {
    const f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
    return (c: number) => f.format(c / 100)
  }, [locale])
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  )
  // Relative time for the activity feed ("il y a 2 h") — precursor of live pings.
  const rel = useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return (iso: string) => {
      const diffMs = new Date(iso).getTime() - Date.now()
      const mins = Math.round(diffMs / 60000)
      if (Math.abs(mins) < 60) return rtf.format(mins, 'minute')
      const hrs = Math.round(mins / 60)
      if (Math.abs(hrs) < 24) return rtf.format(hrs, 'hour')
      return rtf.format(Math.round(hrs / 24), 'day')
    }
  }, [locale])

  const slug = data?.links.slug ?? null
  const baseLink = useMemo(() => buildAffiliateLink(slug), [slug])
  const deepLink = useMemo(
    () => (restoId ? buildAffiliateRestaurantLink(slug, restoId, locale) : null),
    [slug, restoId, locale],
  )

  // PULSE: current month vs previous (UTC month keys from the server).
  const pulse = useMemo(() => {
    const bm = data?.earnings.byMonth ?? []
    const now = new Date()
    const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const idx = bm.findIndex((m) => m.month === key)
    const thisMonth = idx >= 0 ? bm[idx].gainCents : 0
    const prevMonth = bm.length >= 2 && idx >= 1 ? bm[idx - 1].gainCents : (bm.length && idx < 0 ? bm[bm.length - 1].gainCents : 0)
    return { thisMonth, prevMonth, up: thisMonth >= prevMonth }
  }, [data])

  // Tier / badge i18n labels (dynamic key → the seed defines every one).
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const tierLabel  = (k: string) => t(`tier${cap(k)}`)
  const badgeLabel = (k: string) => t(`badge${cap(k)}`)

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending':   return { label: `⏳ ${t('statusPending')}`, cls: 'bg-grubano-warning-tint text-grubano-warning' }
      case 'matured':   return { label: `✓ ${t('statusMatured')}`,  cls: 'bg-grubano-success-tint text-grubano-success' }
      case 'paid':      return { label: t('statusPaid'),            cls: 'bg-grubano-tint text-grubano-primary' }
      case 'cancelled': return { label: t('statusCancelled'),       cls: 'bg-grubano-surface-muted text-grubano-ink-faint' }
      default:          return { label: status,                     cls: 'bg-grubano-surface-muted text-grubano-ink-faint' }
    }
  }

  // ── Loading / error shells ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 px-4 py-24 text-grubano-ink-muted">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">{t('loading')}</span>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-10">
        <p className="flex items-start gap-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error || t('errLoad')}</span>
        </p>
        <button type="button" onClick={load} className="mt-3 w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface py-2.5 text-sm font-semibold text-grubano-ink">
          {t('retry')}
        </button>
      </div>
    )
  }

  // ── Non-influencer → clean locked state ───────────────────────────────────────
  if (!data.isInfluencer) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-10">
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-grubano-surface-muted text-grubano-ink-faint">
              <Megaphone size={20} />
            </span>
            <p className="font-display text-base font-semibold text-grubano-ink">{t('lockedTitle')}</p>
            <p className="max-w-sm text-xs text-grubano-ink-muted">{t('lockedBody')}</p>
          </div>
        </Card>
      </div>
    )
  }

  const { earnings, referrals, payout } = data
  const brandNew = referrals.orders.length === 0 && earnings.maturedCents === 0 && earnings.pendingCents === 0

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Megaphone size={18} className="text-grubano-primary" />
          <h1 className="font-display text-xl font-bold">{t('title')}</h1>
        </div>
        <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
      </div>

      {/* ── PULSE ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <Card elevation="sm" padding="md" className="col-span-3 sm:col-span-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-grubano-ink-muted">{t('pulseMonth')}</p>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-grubano-ink">{fmtCents(pulse.thisMonth)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-grubano-ink-faint">
            {pulse.up ? <TrendingUp size={12} className="text-grubano-success" /> : <TrendingDown size={12} className="text-grubano-danger" />}
            {t('pulseVsPrev', { amount: fmtCents(pulse.prevMonth) })}
          </p>
        </Card>
        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-1.5 text-grubano-primary"><Users size={13} /><p className="text-[11px] font-bold uppercase tracking-wider">{t('pulseCustomers')}</p></div>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-grubano-ink">{referrals.newCustomers}</p>
        </Card>
        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-1.5 text-grubano-primary"><ShoppingBag size={13} /><p className="text-[11px] font-bold uppercase tracking-wider">{t('pulseOrders')}</p></div>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-grubano-ink">{referrals.orders.length}</p>
        </Card>
      </div>

      {/* ── MES LIENS & CODES ──────────────────────────────────────────────── */}
      <Card elevation="sm" padding="md">
        <div className="mb-2 flex items-center gap-2">
          <Link2 size={14} className="text-grubano-primary" />
          <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('linksTitle')}</h2>
        </div>
        {data.links.code || baseLink ? (
          <div className="space-y-2">
            {data.links.code && (
              <button type="button" onClick={() => copy('code', data.links.code as string)}
                className="flex w-full items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3.5 py-3 active:scale-[0.99]">
                <span className="font-mono text-base font-extrabold tracking-widest text-grubano-ink">{data.links.code}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-grubano-primary">
                  {copied === 'code' ? <Check size={13} /> : <Copy size={13} />}{copied === 'code' ? t('copied') : t('copyCode')}
                </span>
              </button>
            )}
            {baseLink && (
              <>
                <button type="button" onClick={() => copy('base', baseLink)}
                  className="flex w-full items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3.5 py-3 active:scale-[0.99]">
                  <span className="min-w-0 flex-1 truncate text-start text-[12px] text-grubano-ink-muted">{baseLink}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-grubano-primary">
                    {copied === 'base' ? <Check size={13} /> : <Copy size={13} />}{copied === 'base' ? t('copied') : t('copyLink')}
                  </span>
                </button>
                <button type="button" onClick={() => setQrOpen((v) => (v === 'base' ? null : 'base'))}
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-grubano-primary">
                  <QrCode size={13} /> {qrOpen === 'base' ? t('hideQr') : t('showQr')}
                </button>
                {qrOpen === 'base' && (
                  <div className="flex flex-col items-center gap-2 rounded-grubano-lg border border-grubano-border bg-white p-4">
                    <QRCodeSVG value={baseLink} size={168} includeMargin />
                    <p className="max-w-xs text-center text-[11px] text-grubano-ink-muted">{t('qrHint')}</p>
                  </div>
                )}
              </>
            )}

            {/* Deep-link generator — pick a restaurant, get an attributed link. */}
            <div className="mt-1 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3.5 py-3">
              <p className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-grubano-ink">
                <Store size={13} className="text-grubano-primary" /> {t('deepLinkTitle')}
              </p>
              <select value={restoId} onChange={(e) => { setRestoId(e.target.value); setQrOpen(null) }}
                className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface-muted px-2.5 py-2 text-[12px] text-grubano-ink">
                <option value="">{t('deepLinkPick')}</option>
                {restos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {deepLink && (
                <div className="mt-2 space-y-2">
                  <button type="button" onClick={() => copy('deep', deepLink)}
                    className="flex w-full items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3.5 py-2.5 active:scale-[0.99]">
                    <span className="min-w-0 flex-1 truncate text-start text-[12px] text-grubano-ink-muted">{deepLink}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-grubano-primary">
                      {copied === 'deep' ? <Check size={13} /> : <Copy size={13} />}{copied === 'deep' ? t('copied') : t('copyLink')}
                    </span>
                  </button>
                  <button type="button" onClick={() => setQrOpen((v) => (v === 'deep' ? null : 'deep'))}
                    className="inline-flex items-center gap-1.5 text-[12px] font-bold text-grubano-primary">
                    <QrCode size={13} /> {qrOpen === 'deep' ? t('hideQr') : t('showQr')}
                  </button>
                  {qrOpen === 'deep' && (
                    <div className="flex flex-col items-center gap-2 rounded-grubano-lg border border-grubano-border bg-white p-4">
                      <QRCodeSVG value={deepLink} size={168} includeMargin />
                      <p className="max-w-xs text-center text-[11px] text-grubano-ink-muted">{t('qrHint')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-grubano-lg bg-grubano-surface-muted px-3 py-2.5 text-[12px] text-grubano-ink-muted">{t('noCode')}</p>
        )}
      </Card>

      {/* ── GAINS (transparent, on the NET) ────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 gap-3">
          <Card elevation="sm" padding="md">
            <p className="text-[11px] font-bold uppercase tracking-wider text-grubano-warning">{t('pending')}</p>
            <p className="mt-1 font-display text-xl font-extrabold tabular-nums text-grubano-ink">{fmtCents(earnings.pendingCents)}</p>
            <p className="mt-0.5 text-[10px] text-grubano-ink-faint">{t('pendingHint')}</p>
          </Card>
          <Card elevation="sm" padding="md">
            <p className="text-[11px] font-bold uppercase tracking-wider text-grubano-success">{t('matured')}</p>
            <p className="mt-1 font-display text-xl font-extrabold tabular-nums text-grubano-ink">{fmtCents(earnings.maturedCents)}</p>
            <p className="mt-0.5 text-[10px] text-grubano-ink-faint">{t('maturedHint')}</p>
          </Card>
        </div>
        {/* THE differentiator: no black box — explain the calculation. */}
        {data.commissionPct !== null && (
          <p className="mt-2 px-1 text-[11px] text-grubano-ink-muted">{t('transparency', { pct: data.commissionPct })}</p>
        )}

        {referrals.orders.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2"><ShoppingBag size={14} className="text-grubano-primary" /><h2 className="font-display text-sm font-semibold text-grubano-ink">{t('gainsTitle')}</h2></div>
            {referrals.orders.map((o) => {
              const badge = statusBadge(o.status)
              const gain = o.creatorEarningCents + o.bonusCents
              return (
                <Card key={o.id} elevation="sm" padding="md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-grubano-ink">{o.restaurant ?? '—'}</p>
                      <p className="mt-0.5 text-[11px] text-grubano-ink-faint">
                        {dateFmt.format(new Date(o.date))}
                        {o.orderTotalCents !== null && ` · ${t('orderTotal')} ${fmtCents(o.orderTotalCents)}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-[13px] font-extrabold tabular-nums"><span className="font-medium text-grubano-ink-muted">{t('orderGain')}</span> <span className="text-grubano-primary">{fmtCents(gain)}</span></p>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* ── ACTIVITÉ (feed — precursor of live pings) ──────────────────────── */}
      {referrals.orders.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2"><Activity size={14} className="text-grubano-primary" /><h2 className="font-display text-sm font-semibold text-grubano-ink">{t('activityTitle')}</h2></div>
          <Card elevation="sm" padding="md">
            <ul className="space-y-2.5">
              {referrals.orders.slice(0, 6).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="min-w-0 flex-1 truncate text-grubano-ink">
                    {t('activityLine', { amount: fmtCents(o.creatorEarningCents + o.bonusCents), restaurant: o.restaurant ?? '—' })}
                  </span>
                  <span className="shrink-0 text-[11px] text-grubano-ink-faint">{rel(o.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* ── Brand-new influencer — guide, never an empty screen ────────────── */}
      {brandNew && (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-grubano-tint text-grubano-primary"><Sparkles size={20} /></span>
            <p className="font-display text-base font-semibold text-grubano-ink">{t('emptyTitle')}</p>
            <p className="max-w-sm text-xs text-grubano-ink-muted">{t('emptyBody')}</p>
          </div>
        </Card>
      )}

      {/* ── VERSEMENT (honest: gated on activation) ────────────────────────── */}
      <Card elevation="sm" padding="md" className="border-dashed">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-grubano-surface-muted text-grubano-ink-faint"><Landmark size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('payoutTitle')}</h2>
              <span className="font-display text-sm font-extrabold tabular-nums text-grubano-ink">{fmtCents(payout.claimableCents)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-grubano-ink-muted">{t('payoutActivationPending')}</p>
          </div>
        </div>
      </Card>

      {/* ── STATUT & CLASSEMENT (Slice 2c) — STATUS/recognition only, computed,
          ZERO effect on the commission rate (30 % for everyone). ──────────── */}
      {data.tier && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-grubano-primary" />
            <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('statusTitle')}</h2>
          </div>

          {/* Tier + progress to the next */}
          <Card elevation="sm" padding="md">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2">
                <Medal size={16} className="text-grubano-primary" />
                <span className="font-display text-base font-extrabold text-grubano-ink">{tierLabel(data.tier.key)}</span>
              </span>
              <span className="text-[11px] uppercase tracking-wide text-grubano-ink-faint">{t('tierLabel')}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-grubano-surface-muted">
              <div className="h-full rounded-full bg-grubano-primary transition-all" style={{ width: `${data.tier.progressPct}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-grubano-ink-faint">
              {data.tier.nextKey && data.tier.nextFloorCents !== null
                ? t('tierProgress', { amount: fmtCents(Math.max(0, data.tier.nextFloorCents - earnings.maturedCents)), tier: tierLabel(data.tier.nextKey) })
                : t('tierMax')}
            </p>
          </Card>

          {/* Streak + badges */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card elevation="sm" padding="md">
              <div className="flex items-center gap-1.5 text-grubano-primary"><Flame size={14} /><p className="text-[11px] font-bold uppercase tracking-wider">{t('streakTitle')}</p></div>
              <p className="mt-1 text-sm font-semibold text-grubano-ink">
                {data.streak.weeks > 0 ? t('streakWeeks', { count: data.streak.weeks }) : t('streakNone')}
              </p>
            </Card>
            <Card elevation="sm" padding="md">
              <div className="mb-1.5 flex items-center gap-1.5 text-grubano-primary"><Award size={14} /><p className="text-[11px] font-bold uppercase tracking-wider">{t('badgesTitle')}</p></div>
              <div className="flex flex-wrap gap-1.5">
                {data.badges.map((b) => (
                  <span key={b.key} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${b.achieved ? 'bg-grubano-success-tint text-grubano-success' : 'bg-grubano-surface-muted text-grubano-ink-faint opacity-60'}`}>
                    {b.achieved ? '✓ ' : ''}{badgeLabel(b.key)}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          {/* Mini-leaderboard — NAME + RANK + TIER only, never others' € (privacy). */}
          <Card elevation="sm" padding="md">
            <div className="mb-2 flex items-center gap-2"><BarChart3 size={14} className="text-grubano-primary" /><h3 className="font-display text-sm font-semibold text-grubano-ink">{t('leaderboardTitle')}</h3></div>
            {data.leaderboard && data.leaderboard.top.length > 0 ? (
              <ul className="space-y-1.5">
                {data.leaderboard.top.map((e) => (
                  <li key={e.rank} className={`flex items-center justify-between gap-2 rounded-grubano-md px-2.5 py-1.5 text-[12px] ${e.isMe ? 'bg-grubano-tint font-bold text-grubano-primary' : 'text-grubano-ink'}`}>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span className="tabular-nums text-grubano-ink-faint">#{e.rank}</span>
                      <span className="truncate">{e.isMe ? t('leaderboardMe') : e.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-grubano-ink-faint">{tierLabel(e.tierKey)}</span>
                  </li>
                ))}
                {data.leaderboard.myRank && data.leaderboard.myRank > data.leaderboard.top.length && (
                  <li className="flex items-center justify-between gap-2 rounded-grubano-md bg-grubano-tint px-2.5 py-1.5 text-[12px] font-bold text-grubano-primary">
                    <span className="inline-flex items-center gap-2"><span className="tabular-nums">#{data.leaderboard.myRank}</span><span>{t('leaderboardMe')}</span></span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="rounded-grubano-md border border-dashed border-grubano-border px-3 py-3 text-center text-[12px] text-grubano-ink-muted">{t('leaderboardEmpty')}</p>
            )}
          </Card>
        </section>
      )}

      {/* ── STUDIO DE CONTENU IA (Slice 2b) — replaces the « Studio (bientôt) »
          placeholder: pick a target → AI captions + a shareable card. ──────── */}
      <AffiliateStudio restos={restos} />

      {/* ── Placeholder « bientôt » (Performance/clicks — needs click tracking,
          a future infra slice). Tiers & Studio are now REAL above. ─────────── */}
      <div className="grid grid-cols-1 gap-3">
        {([
          { icon: BarChart3,title: t('soonPerfTitle'),   body: t('soonPerfBody') },
        ]).map((p) => {
          const Icon = p.icon
          return (
            <Card key={p.title} elevation="sm" padding="md" className="border-dashed opacity-80">
              <div className="flex items-center gap-2 text-grubano-ink-faint">
                <Icon size={14} />
                <p className="text-[12px] font-semibold text-grubano-ink">{p.title}</p>
              </div>
              <p className="mt-1 text-[11px] text-grubano-ink-faint">{p.body}</p>
              <span className="mt-2 inline-block rounded-full bg-grubano-surface-muted px-2 py-0.5 text-[10px] font-bold text-grubano-ink-faint">{t('soonBadge')}</span>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
