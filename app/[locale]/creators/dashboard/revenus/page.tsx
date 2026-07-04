'use client'

/**
 * CR6 — Mes gains (creator studio, MONEY 🔒). Visual re-skin to the CD design
 * (CreatorShell --op-/--op-cr + Material Symbols); ZERO change to the money
 * plumbing. Over Agent 14's B2a contract:
 *
 *   GET /api/creator/earnings?page=N
 *   → { roles, code, link, totals { pendingCents, maturedCents, paidCents,
 *       cancelledCents, thresholdCents, progressPct }, orders[…20/page],
 *       ordersTotal, ordersHasMore, adoptions[…20] }
 *
 * RULES: amounts are CENTS everywhere → euros for DISPLAY only (÷100 via
 * formatMoney), NEVER recomputed client-side. Statuses come from the SERVER
 * lifecycle (pending|matured|cancelled|paid) — ZERO client-side status math.
 * The transparency rate (%) comes from the CONFIG via /api/creators/home →
 * referralRates.commissionPct — never hardcoded.
 *
 * HONESTY (payout rail CREATOR_PAYOUT/CONNECT is gated OFF):
 *  · balance hero = maturedCents (« Solde à verser ») + real 30d earned + real
 *    cumulé; NO fictive « Prochain versement »/date; « Retrait manuel » CTA is
 *    INERT; note is future-tense (« versements automatiques une fois activés »).
 *  · « Versements reçus » is wired to the REAL GET /api/partner/payouts and
 *    shows rows ONLY when enabled && payouts.length — otherwise an honest empty.
 *  · history statuses = the true server ledger states (a refund → cancelled).
 *  · read-only banner + « Lecture seule » badge + cancelled + transparency kept.
 *
 * The share-kit (code/link/QR for influencer + /chef link for chef) is REAL and
 * serves both roles — kept even though the CD CR6 mock omits it (the affiliation
 * screen is influencer-only, so the chef link lives here).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { QRCodeSVG } from 'qrcode.react'
import { buildReferralLink } from '@/lib/referral-link'
import { buildChefPageLink } from '@/lib/chef-link'
import { formatMoney } from '@/lib/format-money'
import type { CreatorHomeData } from '@/app/api/creators/home/route'
import '../creator-earnings.css'

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

// ── Real payout source (same shape CreatorPaymentsSection consumes) ───────────
interface PayoutRow {
  id: string; amountCents: number; currency: string
  status: string; paidAt: string | null; stripeTransferId: string | null; createdAt: string
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
  // Real 30-day earned window (« Gagné ce mois ») — home.earningsThisMonth is a
  // server euros figure (referral + recipe gross, 30-day rolling); null until read.
  const [earnedThisMonthEur, setEarnedThisMonthEur] = useState<number | null>(null)
  // Paginated orders, appended page by page ("Voir plus").
  const [orders,      setOrders]      = useState<EarningOrder[]>([])
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Real payouts (P4-UI) — the honest « Versements reçus » source. Rows show
  // ONLY when the rail is enabled AND rows exist; otherwise an honest empty.
  const [payoutsEnabled, setPayoutsEnabled] = useState(false)
  const [payouts,        setPayouts]        = useState<PayoutRow[]>([])
  // Copy / QR affordances.
  const [copied, setCopied] = useState<'code' | 'link' | 'cheflink' | null>(null)
  const [qrOpen, setQrOpen] = useState<'ref' | 'chef' | null>(null)
  // Adoptions folded: 5 visible, "Voir plus" unfolds by packs of 5 (client-side
  // slice — the contract already capped the list at 20).
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
        // Real 30-day earned (server euros) for the « Gagné ce mois » meta.
        const em = home?.earningsThisMonth
        if (typeof em === 'number' && em >= 0) setEarnedThisMonthEur(em)
      } catch { /* line hidden */ }
    } catch {
      setError(t('errLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  // Real payout history (read-only, best-effort — never blocks the page).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/partner/payouts', { cache: 'no-store' })
        const po = r.ok ? await r.json().catch(() => null) : null
        if (!alive || !po) return
        if (po.enabled) {
          setPayoutsEnabled(true)
          setPayouts(Array.isArray(po.payouts) ? po.payouts : [])
        }
      } catch { /* payouts section stays in its honest empty state */ }
    })()
    return () => { alive = false }
  }, [])

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

  // ── Formatting (cents → localized euros) — central source of truth ──────────
  const fmtCents = useMemo(() => (cents: number) => formatMoney(cents, locale), [locale])
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    [locale],
  )

  // ── The public tracked link ────────────────────────────────────────────────
  // The contract's link is "/ref/<slug>"; we extract the slug and hand it to the
  // shared lib/referral-link builder (single source for origin + /ref path).
  const fullLink = useMemo(() => {
    if (!data?.link) return null
    const slug = data.link.split('/').filter(Boolean).pop()
    return buildReferralLink(slug)
  }, [data?.link])

  // The CHEF kit link: the public /chef page (M1), built by lib/chef-link.
  const chefLink = useMemo(() => {
    if (!data?.link) return null
    const slug = data.link.split('/').filter(Boolean).pop()
    return buildChefPageLink(slug)
  }, [data?.link])

  // ── Server-status → CD badge (class + icon + label). Server statuses only. ──
  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending':   return { cls: 'pending',   icon: 'schedule',      label: t('statusPending') }
      case 'matured':   return { cls: 'matured',   icon: 'task_alt',      label: t('statusMatured') }
      case 'paid':      return { cls: 'paid',       icon: 'check',         label: t('statusPaid') }
      case 'cancelled': return { cls: 'cancelled', icon: 'cancel',        label: t('statusCancelled') }
      default:          return { cls: 'cancelled', icon: 'help',          label: status }
    }
  }

  const payoutIcon = (status: string) =>
    status === 'paid' ? 'check_circle' : status === 'failed' ? 'error' : 'schedule'

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section aria-busy="true" aria-label={t('loading')}>
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18 }} />
        <span className="op-sk" style={{ width: '100%', height: 60, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 170, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <section>
        <div className="earn-error">
          <div className="op-error__card">
            <span className="ms">cloud_off</span>
            <h2>{t('errTitle')}</h2>
            <p>{error || t('errLoad')}</p>
            <button type="button" className="op-btn-primary" onClick={load}>
              <span className="ms">refresh</span>{t('retry')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  const roles = data.roles ?? { isChef: true, isInfluencer: true }
  const { totals } = data
  const brandNew = data.ordersTotal === 0 && data.adoptions.length === 0
  // Real cumulative (server cents) — matured + pending + paid (excludes cancelled).
  const cumulativeCents = totals.pendingCents + totals.maturedCents + totals.paidCents

  // ── Empty (brand-new creator, no order & no adoption) ───────────────────────
  if (brandNew) {
    return (
      <section>
        <div className="op-dash__head">
          <div>
            <h1 className="op-dash__title">{t('title')}</h1>
            <p className="op-dash__sub">{t('subtitle')}</p>
          </div>
          <span className="ro-badge"><span className="ms">lock</span>{t('readOnly')}</span>
        </div>
        <div className="op-card op-empty">
          <span className="ms">savings</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div>
      </section>
    )
  }

  // ── Loaded ──────────────────────────────────────────────────────────────────
  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
        <span className="ro-badge"><span className="ms">lock</span>{t('readOnly')}</span>
      </div>

      {/* ── Read-only banner (honest posture — KEEP) ─────────────────────────── */}
      <div className="ro-banner">
        <span className="ms">verified_user</span>
        <div className="m">
          <b>{t('bannerTitle')}</b>
          <p>{t('bannerBody')}</p>
        </div>
      </div>

      {/* ── Balance hero — big number = maturedCents (« Solde à verser »).
          NO fictive « Prochain versement »/date; the CTA is INERT; the note is
          future-tense (« versements automatiques une fois activés »). ───────── */}
      <div className="op-card bal">
        <div className="bal__main">
          <div className="bal__label"><span className="ms">account_balance_wallet</span>{t('balanceLabel')}</div>
          <div className="bal__v">{fmtCents(totals.maturedCents)}</div>
          <div className="bal__meta">
            {t('earnedThisMonth')}{' '}
            <b>{fmtCents(earnedThisMonthEur !== null ? Math.round(earnedThisMonthEur * 100) : 0)}</b>
          </div>
        </div>
        <div className="bal__side">
          <div className="bal__row">
            <span className="k">{t('waiting')}</span>
            <span className="v">{fmtCents(totals.pendingCents)}</span>
          </div>
          <div className="bal__row">
            <span className="k">{t('alreadyPaid')}</span>
            <span className="v">{fmtCents(totals.paidCents)}</span>
          </div>
          <div className="bal__cta">
            <div className="payout-soon" aria-disabled="true">
              <span className="ms">lock</span>{t('manualWithdraw')} <span className="soon">{t('soon')}</span>
            </div>
          </div>
          <div className="bal__auto"><span className="ms">schedule</span>{t('autoFuture')}</div>
        </div>
      </div>

      {/* ── Total cumulé + cancelled + transparency (honest lines, KEEP) ─────── */}
      <p className="earn-line">
        {t('cumulative', { amount: fmtCents(cumulativeCents) })}
      </p>
      {totals.cancelledCents > 0 && (
        <p className="earn-line">{t('cancelledLine', { amount: fmtCents(totals.cancelledCents) })}</p>
      )}
      {ratePct !== null && (
        <p className="earn-line">{t('transparency', { pct: ratePct })}</p>
      )}

      {/* ── LE KIT DE PARTAGE (real — serves both roles; CD CR6 mock omits it).
          Influencer → the /ref affiliation link; Chef → the public /chef page. */}
      {(roles.isInfluencer || roles.isChef) && (
        <div className={`kit-grid${roles.isInfluencer && roles.isChef ? ' two' : ''}`}>
          {roles.isInfluencer && (
            <div className="op-card kit-card">
              <div className="kit-card__hd">
                <span className="ms">ios_share</span>
                <h3>{t('kitAffiliationTitle')}</h3>
                <span className="count">{t('ordersCount', { count: data.ordersTotal })}</span>
              </div>
              {data.code ? (
                <>
                  <button type="button" className="kit-copy" onClick={() => copy('code', data.code as string)}>
                    <span className="code">{data.code}</span>
                    <span className="act">
                      <span className="ms">{copied === 'code' ? 'check' : 'content_copy'}</span>
                      {copied === 'code' ? t('copied') : t('copyCode')}
                    </span>
                  </button>
                  {fullLink && (
                    <>
                      <button type="button" className="kit-copy" onClick={() => copy('link', fullLink)}>
                        <span className="lnk">{fullLink}</span>
                        <span className="act">
                          <span className="ms">{copied === 'link' ? 'check' : 'content_copy'}</span>
                          {copied === 'link' ? t('copied') : t('copyLink')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="kit-qrbtn"
                        onClick={() => setQrOpen((v) => (v === 'ref' ? null : 'ref'))}
                      >
                        <span className="ms">qr_code_2</span>{qrOpen === 'ref' ? t('hideQr') : t('showQr')}
                      </button>
                      {qrOpen === 'ref' && (
                        <div className="kit-qr">
                          <QRCodeSVG value={fullLink} size={168} includeMargin />
                          <p>{t('qrHint')}</p>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="kit-nocode">{t('noCode')}</p>
              )}
            </div>
          )}

          {roles.isChef && (
            <div className="op-card kit-card">
              <div className="kit-card__hd">
                <span className="ms">restaurant_menu</span>
                <h3>{t('kitChefTitle')}</h3>
              </div>
              {chefLink ? (
                <>
                  <button type="button" className="kit-copy" onClick={() => copy('cheflink', chefLink)}>
                    <span className="lnk">{chefLink}</span>
                    <span className="act">
                      <span className="ms">{copied === 'cheflink' ? 'check' : 'content_copy'}</span>
                      {copied === 'cheflink' ? t('copied') : t('copyLink')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="kit-qrbtn"
                    onClick={() => setQrOpen((v) => (v === 'chef' ? null : 'chef'))}
                  >
                    <span className="ms">qr_code_2</span>{qrOpen === 'chef' ? t('hideQr') : t('showQr')}
                  </button>
                  {qrOpen === 'chef' && (
                    <div className="kit-qr">
                      <QRCodeSVG value={chefLink} size={168} includeMargin />
                      <p>{t('kitChefQrHint')}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="kit-nocode">{t('noCode')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Two-column: earnings history (real server statuses) + payouts ────── */}
      <div className="earn-two">
        {/* Earnings history — orders (influencer) then adoptions (chef). */}
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('historyTitle')}</h3></div>
          <div className="hint">{t('historyHint')}</div>

          {/* Mes commandes (paginated, SERVER statuses — zero client math). */}
          {roles.isInfluencer && data.ordersTotal > 0 && (
            <>
              <div className="eh-thead">
                <span>{t('colDate')}</span>
                <span>{t('colSource')}</span>
                <span>{t('colStatus')}</span>
                <span>{t('colAmount')}</span>
              </div>
              {orders.map((o) => {
                const badge = statusBadge(o.status)
                const gain = o.creatorEarningCents + o.bonusCents
                const isCancelled = o.status === 'cancelled'
                return (
                  <div className="eh-row" key={o.id}>
                    <span className="eh-date eh-date-cell">{dateFmt.format(new Date(o.date))}</span>
                    <div className="eh-src">
                      <span className="eh-src__ic"><span className="ms">receipt_long</span></span>
                      <div>
                        <b>{o.restaurant ?? '—'}</b>
                        <span>
                          {o.orderTotalCents !== null
                            ? `${t('orderTotal')} ${fmtCents(o.orderTotalCents)}`
                            : t('orderAffiliated')}
                        </span>
                      </div>
                    </div>
                    <span className="eh-status-cell">
                      <span className={`eh-status ${badge.cls}`}>
                        <span className="ms">{badge.icon}</span>{badge.label}
                      </span>
                    </span>
                    <span className={`eh-amt${isCancelled ? ' is-cancelled' : ''}`}>{fmtCents(gain)}</span>
                    <span className="eh-mini">{dateFmt.format(new Date(o.date))} · {badge.label}</span>
                  </div>
                )
              })}
              {hasMore && (
                <button
                  type="button"
                  className="op-btn-ghost eh-loadmore"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? t('loadingMore') : t('loadMore')}
                </button>
              )}
            </>
          )}

          {/* Mes recettes adoptées (the 2% pipe — chef). */}
          {roles.isChef && (
            <div style={{ marginTop: roles.isInfluencer && data.ordersTotal > 0 ? 20 : 0 }}>
              <div className="card-pad__hd" style={{ marginBottom: 4 }}><h3 style={{ fontSize: 13.5 }}>{t('adoptionsTitle')}</h3></div>
              <div className="hint">{t('adoptionsHint')}</div>
              {data.adoptions.length === 0 ? (
                <p className="eh-empty">{t('adoptionsEmpty')}</p>
              ) : (
                <>
                  {data.adoptions.slice(0, adoptionsShown).map((a) => {
                    const badge = statusBadge(a.status)
                    const isCancelled = a.status === 'cancelled'
                    // Legacy rows carry rateApplied null/0 with a real gain: no % shown then.
                    const meta = [
                      a.brandName,
                      ...((a.rateApplied ?? 0) > 0
                        ? [t('adoptionRate', { pct: Math.round((a.rateApplied ?? 0) * 100) })]
                        : []),
                    ].filter(Boolean).join(' · ')
                    return (
                      <div className="eh-row" key={a.id}>
                        <span className="eh-date eh-date-cell">{dateFmt.format(new Date(a.date))}</span>
                        <div className="eh-src">
                          <span className="eh-src__ic"><span className="ms">lunch_dining</span></span>
                          <div>
                            <b>{a.dishName ?? '—'}</b>
                            <span>{meta || t('orderAffiliated')}</span>
                          </div>
                        </div>
                        <span className="eh-status-cell">
                          <span className={`eh-status ${badge.cls}`}>
                            <span className="ms">{badge.icon}</span>{badge.label}
                          </span>
                        </span>
                        <span className={`eh-amt${isCancelled ? ' is-cancelled' : ''}`}>{fmtCents(a.creatorEarningCents)}</span>
                        <span className="eh-mini">{dateFmt.format(new Date(a.date))} · {badge.label}</span>
                      </div>
                    )
                  })}
                  {data.adoptions.length > adoptionsShown && (
                    <button
                      type="button"
                      className="op-btn-ghost eh-loadmore"
                      onClick={() => setAdoptionsShown((n) => n + 5)}
                    >
                      {t('loadMore')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="info-note">
            <span className="ms">info</span>
            <span>{t('waitingNote')}</span>
          </div>
        </div>

        {/* Versements reçus — REAL payout rows only; honest empty otherwise.
            (1) NO fictive CRP-2026 refs. (4) PDF-statement note omitted. */}
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('payoutsTitle')}</h3></div>
          <div className="hint">{t('payoutsHint')}</div>
          {payoutsEnabled && payouts.length > 0 ? (
            payouts.map((p) => (
              <div className="po-row" key={p.id}>
                <span className={`po-ic ${p.status}`}><span className="ms">{payoutIcon(p.status)}</span></span>
                <div className="po-m">
                  <b>{t('payoutRow')}</b>
                  <span>{dateFmt.format(new Date(p.paidAt ?? p.createdAt))}</span>
                </div>
                <span className="po-amt">{fmtCents(p.amountCents)}</span>
              </div>
            ))
          ) : (
            <div className="po-empty">
              <span className="ms">account_balance</span>
              <p>{t('payoutsEmpty')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
