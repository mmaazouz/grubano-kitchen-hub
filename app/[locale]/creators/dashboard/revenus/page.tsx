'use client'

/**
 * Mes gains — PHASE B / B1 (Agent 13). The space where the creator LIVES
 * their earnings, over Agent 14's B2a contract:
 *
 *   GET /api/creator/earnings?page=N
 *   → { code, link, totals { pendingCents, maturedCents, paidCents,
 *       cancelledCents, thresholdCents, progressPct }, orders[…20/page],
 *       ordersTotal, ordersHasMore, adoptions[…20] }
 *
 * RULES: amounts are CENTS everywhere; the statuses come from the SERVER
 * lifecycle (pending|matured|cancelled|paid) — ZERO client-side status
 * computation. The transparency rate (30%) comes from the CONFIG via
 * /api/creators/home → referralRates.commissionPct — never hardcoded.
 *
 * Sections: vue d'ensemble (big numbers + 20 € progress bar + code/link/QR +
 * attributed-orders counter + transparency line) → Mes commandes (paginated,
 * server badges) → Mes recettes adoptées (the 2% pipe) → Versements
 * placeholder (B2b) → polished empty state for a brand-new creator.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  TrendingUp, Hourglass, CheckCircle2, Wallet, Copy, Check, QrCode,
  Loader2, AlertCircle, ShoppingBag, ChefHat, Landmark, Share2,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Card } from '@/components/design-system'
import { buildReferralLink } from '@/lib/referral-link'
import { buildChefPageLink } from '@/lib/chef-link'
import type { CreatorHomeData } from '@/app/api/creators/home/route'

// ── B2a contract (mirrored locally — the route is the source of truth) ────────
interface EarningsTotals {
  pendingCents:   number
  maturedCents:   number
  paidCents:      number
  cancelledCents: number
  thresholdCents: number
  progressPct:    number
}
interface EarningOrder {
  id:                  string
  date:                string
  restaurant:          string | null
  orderTotalCents:     number | null
  grubanoFeeCents:     number
  creatorEarningCents: number
  bonusCents:          number
  status:              'pending' | 'matured' | 'cancelled' | 'paid' | string
  maturedAt:           string | null
}
interface EarningAdoption {
  id:                  string
  date:                string
  dishName:            string | null
  brandName:           string | null
  saleAmountCents:     number
  creatorEarningCents: number
  /** Legacy rows may carry null/0 with a real gain — the UI hides the % then. */
  rateApplied:         number | null
  status:              string
  maturedAt:           string | null
}
interface EarningsPayload {
  // Mission 2 - role flags (server-read, tolerant: both true pre-migration).
  roles?:         { isChef: boolean; isInfluencer: boolean }
  code:           string | null
  link:           string | null
  totals:         EarningsTotals
  orders:         EarningOrder[]
  ordersPage:     number
  ordersPageSize: number
  ordersTotal:    number
  ordersHasMore:  boolean
  adoptions:      EarningAdoption[]
}

export default function CreatorEarningsPage() {
  const t = useTranslations('creators.earnings')
  const locale = useLocale()

  const [data,    setData]    = useState<EarningsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  // Config rate for the transparency line (fraction, e.g. 0.30) — from the
  // referral config via /api/creators/home → referralRates, NEVER hardcoded.
  const [ratePct, setRatePct] = useState<number | null>(null)
  // Paginated orders, appended page by page (mobile-first "Voir plus").
  const [orders,      setOrders]      = useState<EarningOrder[]>([])
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Copy / QR affordances.
  const [copied, setCopied] = useState<'code' | 'link' | 'cheflink' | null>(null)
  const [qrOpen, setQrOpen] = useState<'ref' | 'chef' | null>(null)
  // B1-bis FIX 3 — adoptions folded: 5 visible, "Voir plus" unfolds by packs
  // of 5 (client-side slice — the contract already capped the list at 20).
  const [adoptionsShown, setAdoptionsShown] = useState(5)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [earningsRes, homeRes] = await Promise.all([
        fetch('/api/creator/earnings', { cache: 'no-store' }),
        fetch('/api/creators/home',    { cache: 'no-store' }),
      ])
      if (earningsRes.status === 404) { setError(t('noProfile')); return }
      if (!earningsRes.ok) throw new Error('load_failed')
      const body = await earningsRes.json() as EarningsPayload
      setData(body)
      setOrders(body.orders ?? [])
      setPage(body.ordersPage ?? 1)
      setHasMore(Boolean(body.ordersHasMore))
      // Best-effort rate — the line is simply hidden if the config read fails.
      try {
        const home = homeRes.ok ? (await homeRes.json()) as CreatorHomeData : null
        const pct = home?.referralRates?.commissionPct
        if (typeof pct === 'number' && pct > 0) setRatePct(Math.round(pct * 100))
      } catch { /* line hidden */ }
    } catch {
      setError(t('errLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const r = await fetch(`/api/creator/earnings?page=${page + 1}`, { cache: 'no-store' })
      if (!r.ok) return
      const body = await r.json() as EarningsPayload
      setOrders((prev) => [...prev, ...(body.orders ?? [])])
      setPage(body.ordersPage ?? page + 1)
      setHasMore(Boolean(body.ordersHasMore))
    } catch { /* keep the button usable */ } finally {
      setLoadingMore(false)
    }
  }

  async function copy(kind: 'code' | 'link' | 'cheflink', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard unavailable — no crash */ }
  }

  // ── Formatting (cents → localized euros) ────────────────────────────────────
  const fmtCents = useMemo(() => {
    const f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
    return (cents: number) => f.format(cents / 100)
  }, [locale])
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  )

  // ── The public tracked link ────────────────────────────────────────────────
  // The contract's link is "/ref/<slug>" (fixed server-side, C3-fix §3 — the
  // old "/r/" workaround is gone). We extract the slug and hand it to the
  // shared lib/referral-link builder, the single source for the origin
  // (business.* browsing host neutralized) and the /ref path.
  const fullLink = useMemo(() => {
    if (!data?.link) return null
    const slug = data.link.split('/').filter(Boolean).pop()
    return buildReferralLink(slug)
  }, [data?.link])

  // Mission 2 - the CHEF kit link: the public /chef page (M1), built by the
  // dedicated lib/chef-link (imports consumerOrigin, never touches the
  // influencer builder).
  const chefLink = useMemo(() => {
    if (!data?.link) return null
    const slug = data.link.split('/').filter(Boolean).pop()
    return buildChefPageLink(slug)
  }, [data?.link])

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
        <button
          type="button"
          onClick={load}
          className="mt-3 w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface py-2.5 text-sm font-semibold text-grubano-ink"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  const roles = data.roles ?? { isChef: true, isInfluencer: true }
  const { totals } = data
  const brandNew = data.ordersTotal === 0 && data.adoptions.length === 0
  const progressReached = totals.maturedCents >= totals.thresholdCents

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp size={18} className="text-grubano-primary" />
          <h1 className="font-display text-xl font-bold">{t('title')}</h1>
        </div>
        <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
      </div>

      {/* ── Vue d'ensemble — the money, BIG ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-1.5 text-grubano-warning">
            <Hourglass size={13} />
            <p className="text-[11px] font-bold uppercase tracking-wider">{t('pending')}</p>
          </div>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-grubano-ink">
            {fmtCents(totals.pendingCents)}
          </p>
          <p className="mt-0.5 text-[10px] text-grubano-ink-faint">{t('pendingHint')}</p>
        </Card>

        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-1.5 text-grubano-success">
            <CheckCircle2 size={13} />
            <p className="text-[11px] font-bold uppercase tracking-wider">{t('matured')}</p>
          </div>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-grubano-ink">
            {fmtCents(totals.maturedCents)}
          </p>
          {/* Progress to the payout threshold — straight from the contract. */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-grubano-surface-muted">
            <div
              className={`h-full rounded-full transition-all ${progressReached ? 'bg-grubano-success' : 'bg-grubano-primary'}`}
              style={{ width: `${totals.progressPct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-grubano-ink-faint">
            {progressReached
              ? t('progressReached')
              : t('progressLabel', { amount: fmtCents(totals.maturedCents), threshold: fmtCents(totals.thresholdCents) })}
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3.5 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-grubano-ink">
          <Wallet size={13} className="text-grubano-primary" /> {t('paid')}
        </span>
        <span className="font-display text-base font-extrabold tabular-nums text-grubano-ink">
          {fmtCents(totals.paidCents)}
        </span>
      </div>
      {totals.cancelledCents > 0 && (
        <p className="px-1 text-[11px] text-grubano-ink-faint">
          {t('cancelledLine', { amount: fmtCents(totals.cancelledCents) })}
        </p>
      )}

      {/* Transparency — the rate comes from the CONFIG, never hardcoded. */}
      {ratePct !== null && (
        <p className="px-1 text-[11px] text-grubano-ink-muted">
          {t('transparency', { pct: ratePct })}
        </p>
      )}

      {/* ── LE KIT DE PARTAGE (Mission 2) — one block per ACTIVE role,
          clearly labelled: this is where the creator understands their two
          tools. Influencer -> the /ref affiliation link (existing rail);
          Chef -> the public /chef page (M1 contribution rail). Both roles ->
          both blocks side by side. */}
      {(roles.isInfluencer || roles.isChef) && (
        <div className={`grid gap-3 ${roles.isInfluencer && roles.isChef ? 'md:grid-cols-2' : ''}`}>
          {roles.isInfluencer && (
            <Card elevation="sm" padding="md">
              <div className="mb-2 flex items-center gap-2">
                <Share2 size={14} className="text-grubano-primary" />
                <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('kitAffiliationTitle')}</h2>
                <span className="ms-auto text-[11px] text-grubano-ink-muted">
                  {t('ordersCount', { count: data.ordersTotal })}
                </span>
              </div>
              {data.code ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => copy('code', data.code as string)}
                    className="flex w-full items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3.5 py-3 active:scale-[0.99]"
                  >
                    <span className="font-mono text-base font-extrabold tracking-widest text-grubano-ink">{data.code}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-grubano-primary">
                      {copied === 'code' ? <Check size={13} /> : <Copy size={13} />}
                      {copied === 'code' ? t('copied') : t('copyCode')}
                    </span>
                  </button>
                  {fullLink && (
                    <button
                      type="button"
                      onClick={() => copy('link', fullLink)}
                      className="flex w-full items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3.5 py-3 active:scale-[0.99]"
                    >
                      <span className="min-w-0 flex-1 truncate text-start text-[12px] text-grubano-ink-muted">{fullLink}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-grubano-primary">
                        {copied === 'link' ? <Check size={13} /> : <Copy size={13} />}
                        {copied === 'link' ? t('copied') : t('copyLink')}
                      </span>
                    </button>
                  )}
                  {fullLink && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setQrOpen((v) => (v === 'ref' ? null : 'ref'))}
                        className="inline-flex items-center gap-1.5 text-[12px] font-bold text-grubano-primary"
                      >
                        <QrCode size={13} /> {qrOpen === 'ref' ? t('hideQr') : t('showQr')}
                      </button>
                      {qrOpen === 'ref' && (
                        <div className="mt-2 flex flex-col items-center gap-2 rounded-grubano-lg border border-grubano-border bg-white p-4">
                          <QRCodeSVG value={fullLink} size={168} includeMargin />
                          <p className="max-w-xs text-center text-[11px] text-grubano-ink-muted">{t('qrHint')}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-grubano-lg bg-grubano-surface-muted px-3 py-2.5 text-[12px] text-grubano-ink-muted">
                  {t('noCode')}
                </p>
              )}
            </Card>
          )}

          {roles.isChef && (
            <Card elevation="sm" padding="md">
              <div className="mb-2 flex items-center gap-2">
                <ChefHat size={14} className="text-grubano-primary" />
                <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('kitChefTitle')}</h2>
              </div>
              {chefLink ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => copy('cheflink', chefLink)}
                    className="flex w-full items-center justify-between gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3.5 py-3 active:scale-[0.99]"
                  >
                    <span className="min-w-0 flex-1 truncate text-start text-[12px] text-grubano-ink-muted">{chefLink}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-grubano-primary">
                      {copied === 'cheflink' ? <Check size={13} /> : <Copy size={13} />}
                      {copied === 'cheflink' ? t('copied') : t('copyLink')}
                    </span>
                  </button>
                  <div>
                    <button
                      type="button"
                      onClick={() => setQrOpen((v) => (v === 'chef' ? null : 'chef'))}
                      className="inline-flex items-center gap-1.5 text-[12px] font-bold text-grubano-primary"
                    >
                      <QrCode size={13} /> {qrOpen === 'chef' ? t('hideQr') : t('showQr')}
                    </button>
                    {qrOpen === 'chef' && (
                      <div className="mt-2 flex flex-col items-center gap-2 rounded-grubano-lg border border-grubano-border bg-white p-4">
                        <QRCodeSVG value={chefLink} size={168} includeMargin />
                        <p className="max-w-xs text-center text-[11px] text-grubano-ink-muted">{t('kitChefQrHint')}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-grubano-lg bg-grubano-surface-muted px-3 py-2.5 text-[12px] text-grubano-ink-muted">
                  {t('noCode')}
                </p>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── Brand-new creator — guide, never an empty screen ──────────────── */}
      {brandNew && (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-grubano-tint text-grubano-primary">
              <Share2 size={20} />
            </span>
            <p className="font-display text-base font-semibold text-grubano-ink">{t('emptyTitle')}</p>
            <p className="max-w-sm text-xs text-grubano-ink-muted">{t('emptyBody')}</p>
          </div>
        </Card>
      )}

      {/* ── Mes commandes (paginated, SERVER statuses — zero client math) ──── */}
      {roles.isInfluencer && data.ordersTotal > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <ShoppingBag size={14} className="text-grubano-primary" />
            <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('ordersTitle')}</h2>
          </div>
          <div className="space-y-2">
            {orders.map((o) => {
              const badge = statusBadge(o.status)
              const gain = o.creatorEarningCents + o.bonusCents
              return (
                <Card key={o.id} elevation="sm" padding="md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-grubano-ink">
                        {o.restaurant ?? '—'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-grubano-ink-faint">
                        {dateFmt.format(new Date(o.date))}
                        {o.orderTotalCents !== null && ` · ${t('orderTotal')} ${fmtCents(o.orderTotalCents)}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-[13px] font-extrabold tabular-nums text-grubano-ink">
                        <span className="font-medium text-grubano-ink-muted">{t('orderGain')}</span>{' '}
                        <span className="text-grubano-primary">{fmtCents(gain)}</span>
                      </p>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface py-2.5 text-sm font-semibold text-grubano-ink disabled:opacity-60"
            >
              {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
              {loadingMore ? t('loadingMore') : t('loadMore')}
            </button>
          )}
        </section>
      )}

      {/* ── Mes recettes adoptées (the 2% pipe — present in the contract) ──── */}
      {roles.isChef && (
      <section>
        <div className="mb-2 flex items-center gap-2">
          <ChefHat size={14} className="text-grubano-primary" />
          <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('adoptionsTitle')}</h2>
        </div>
        <p className="mb-2 text-[11px] text-grubano-ink-muted">{t('adoptionsHint')}</p>
        {data.adoptions.length === 0 ? (
          <p className="rounded-grubano-lg border border-dashed border-grubano-border bg-grubano-surface px-3 py-5 text-center text-[12px] text-grubano-ink-muted">
            {t('adoptionsEmpty')}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {data.adoptions.slice(0, adoptionsShown).map((a) => {
                const badge = statusBadge(a.status)
                return (
                  <Card key={a.id} elevation="sm" padding="md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-grubano-ink">
                          {a.dishName ?? '—'}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-grubano-ink-faint">
                          {/* B1-bis FIX 2 — legacy rows carry rateApplied null/0
                              with a real gain: no percentage shown at all then;
                              non-zero rates display as-is (data truth). */}
                          {[
                            a.brandName,
                            dateFmt.format(new Date(a.date)),
                            ...((a.rateApplied ?? 0) > 0
                              ? [t('adoptionRate', { pct: Math.round((a.rateApplied ?? 0) * 100) })]
                              : []),
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="text-[13px] font-extrabold tabular-nums text-grubano-primary">
                          {fmtCents(a.creatorEarningCents)}
                        </p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
            {data.adoptions.length > adoptionsShown && (
              <button
                type="button"
                onClick={() => setAdoptionsShown((n) => n + 5)}
                className="mt-3 w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface py-2.5 text-sm font-semibold text-grubano-ink"
              >
                {t('loadMore')}
              </button>
            )}
          </>
        )}
      </section>
      )}

      {/* ── Versements — elegant placeholder (B2b) ─────────────────────────── */}
      <Card elevation="sm" padding="md" className="border-dashed">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-grubano-surface-muted text-grubano-ink-faint">
            <Landmark size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('payoutsTitle')}</h2>
            <p className="mt-0.5 text-[11px] text-grubano-ink-muted">{t('payoutsSoon')}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
