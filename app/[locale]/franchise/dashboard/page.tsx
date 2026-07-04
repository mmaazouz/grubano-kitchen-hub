'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import OnboardingChat from '@/components/onboarding/OnboardingChat'
import './franchise-dashboard.css'

// ── FR2 · Franchise network dashboard (CD Vague 1) ───────────────────────────────
// Rendered inside FranchiseShell. All figures are REAL, owner-scoped (the API scopes by
// the session operator) and read-only. Fabricated mock content is DROPPED, per the CD
// note: no "+1 ce trimestre" delta, no "2 à examiner en priorité", no invented activity —
// the activity feed derives from real POS-opening dates, the queues from real states.
// Money: CA/royalties come from the server (euros already converted from CENTS server-side)
// and are NEVER recomputed client-side; the royalty rate is the REAL Brand.royaltyPct (or
// "—" when it varies), never a hardcoded percentage. When the held-back rail is gated OFF
// (default) the monthly royalty is honestly 0.

type Dash = {
  revenueThisMonth:    number
  royaltiesDue:        number
  royaltyEnabled?:     boolean
  posOpenCount:        number
  posClosedCount:      number
  posTotalCount:       number
  cityCount:           number
  pendingApplications: number
  monthRoyalties:      number
  royaltyRatePct:      number | null
  topPos:              { id: string; name: string; city: string; revenue: number }[]
  recentActivity:      { type: 'pos_open'; name: string; city: string; at: string }[]
}

const INITIALS = (name: string) =>
  (name.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2) || '–').toUpperCase()

export default function FranchiseDashboardPage() {
  const t      = useTranslations('franchise.dashboard')
  const locale = useLocale()
  const [data,    setData]    = useState<Dash | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/franchise/my-dashboard')
      .then(r => r.json())
      .then(d => { if (alive) { d.error ? setError(true) : setData(d) } })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const nf  = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const eur = (v: number) => `${nf.format(Math.round(v))} €`
  const pct = (v: number) => `${nf.format(v)} %`
  const rel = (iso: string) => t('relDays', { days: Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) })

  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
          {[0, 1, 2, 3].map(i => <span key={i} className="op-sk" style={{ width: '100%', height: 130, borderRadius: 12 }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}>
            <span className="ms" aria-hidden="true">refresh</span>{t('retry')}
          </button>
        </div>
      </div></section>
    )
  }

  const isEmpty = data.posTotalCount === 0 && data.pendingApplications === 0
  if (isEmpty) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card op-empty">
          <span className="ms" aria-hidden="true">hub</span>
          <b>{t('emptyNetTitle')}</b>
          <span>{t('emptyNetDesc')}</span>
          <div style={{ marginTop: 18 }}>
            <Link href="/franchise/dashboard/candidatures" className="op-btn-primary">
              <span className="ms" aria-hidden="true">how_to_reg</span>{t('emptyNetCta')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const total     = data.posTotalCount
  const openPctN  = total > 0 ? Math.round((data.posOpenCount / total) * 100) : 0
  const closedPctN = total > 0 ? Math.round((data.posClosedCount / total) * 100) : 0
  const hasTop    = data.topPos.some(p => p.revenue > 0)

  // Real action queue — derived from real states only.
  const todo: { icon: string; cls: string; b: string; s: string; n: number; href: string }[] = []
  if (data.pendingApplications > 0)
    todo.push({ icon: 'how_to_reg', cls: 'fr', b: t('todoApplications'), s: t('todoApplicationsSub'), n: data.pendingApplications, href: '/franchise/dashboard/candidatures' })
  if (data.posClosedCount > 0)
    todo.push({ icon: 'pause_circle', cls: 'info', b: t('todoClosed'), s: t('todoClosedSub'), n: data.posClosedCount, href: '/franchise/dashboard/etablissements' })

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('netSub')}</p>
        </div>
        {data.posOpenCount > 0 && (
          <span className="ro-badge">
            <span className="ms" aria-hidden="true">hub</span>
            {t('netBadge', { count: data.posOpenCount, cities: data.cityCount })}
          </span>
        )}
      </div>

      {/* Self-gating onboarding copilote — renders null unless its flag is ON (byte-identical default). */}
      <OnboardingGuide role="franchisor" />
      <OnboardingChat role="franchisor" />

      {/* KPIs — no fabricated deltas */}
      <div className="kpi-grid">
        <div className="op-card kpi">
          <div className="kpi__top"><span className="kpi__ic"><span className="ms">storefront</span></span><span className="kpi__label">{t('kpiOpen')}</span></div>
          <div className="kpi__val">{nf.format(data.posOpenCount)}</div>
        </div>
        <div className="op-card kpi">
          <div className="kpi__top"><span className="kpi__ic"><span className="ms">how_to_reg</span></span><span className="kpi__label">{t('kpiPending')}</span></div>
          <div className="kpi__val">{nf.format(data.pendingApplications)}</div>
        </div>
        <div className="op-card kpi">
          <div className="kpi__top"><span className="kpi__ic"><span className="ms">payments</span></span><span className="kpi__label">{t('kpiNetworkCA')}</span></div>
          <div className="kpi__val">{eur(data.revenueThisMonth)}</div>
          <div className="kpi__ro"><span className="ms" aria-hidden="true">lock</span>{t('roConsolidated')}</div>
        </div>
        <div className="op-card kpi">
          <div className="kpi__top"><span className="kpi__ic"><span className="ms">account_balance_wallet</span></span><span className="kpi__label">{t('kpiMonthRoyalties')}</span></div>
          <div className="kpi__val">{eur(data.monthRoyalties)}</div>
          <div className="kpi__ro"><span className="ms" aria-hidden="true">lock</span>
            {data.royaltyEnabled
              ? (data.royaltyRatePct != null ? t('royaltyLockRate', { pct: data.royaltyRatePct }) : t('royaltyLockNoRate'))
              : t('royaltyInactiveShort')}
          </div>
        </div>
      </div>

      <div className="ov-cols">
        {/* Network distribution — open vs temporarily closed (no invented "opening" bucket) */}
        <div className="op-card ov-card">
          <h3>{t('distTitle')}</h3>
          <div className="hint">{t('distHint')}</div>
          {total === 0 ? (
            <p className="op-dash__sub" style={{ margin: 0 }}>{t('distEmpty')}</p>
          ) : (
            <>
              <div className="net-row">
                <span className="net-ic"><span className="ms">check_circle</span></span>
                <div className="net-m"><div className="top"><b>{t('distOpen')}</b><span className="n">{nf.format(data.posOpenCount)} · {pct(openPctN)}</span></div><div className="net-track"><i className="open" style={{ width: `${openPctN}%` }} /></div></div>
              </div>
              {data.posClosedCount > 0 && (
                <div className="net-row">
                  <span className="net-ic"><span className="ms">pause_circle</span></span>
                  <div className="net-m"><div className="top"><b>{t('distClosed')}</b><span className="n">{nf.format(data.posClosedCount)} · {pct(closedPctN)}</span></div><div className="net-track"><i className="closed" style={{ width: `${closedPctN}%` }} /></div></div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Top establishments by real 30-day CA */}
        <div className="op-card ov-card">
          <h3>{t('topTitle')}</h3>
          <div className="hint">{t('topHint')}</div>
          {!hasTop ? (
            <p className="op-dash__sub" style={{ margin: 0 }}>{t('topEmpty')}</p>
          ) : (
            <div className="top-list">
              {data.topPos.filter(p => p.revenue > 0).map((p, i) => (
                <div className="top-item" key={p.id}>
                  <span className="top-rank">{i + 1}</span>
                  <span className="top-logo">{INITIALS(p.name)}</span>
                  <div className="top-m"><b>{p.name}</b><span>{p.city || '—'}</span></div>
                  <div className="top-val">{eur(p.revenue)}<small>{t('val30j')}</small></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Royalty strip — read-only; rate is the REAL Brand.royaltyPct or "—" */}
      <div className="op-card roy">
        <div className="cell"><div className="l"><span className="ms" aria-hidden="true">payments</span>{t('royCA')}</div><div className="v">{eur(data.revenueThisMonth)}</div><div className="s">{t('royCASub')}</div></div>
        <div className="cell"><div className="l"><span className="ms" aria-hidden="true">percent</span>{t('royRate')}</div><div className="v">{data.royaltyRatePct != null ? pct(data.royaltyRatePct) : '—'}</div><div className="s">{t('royRateSub')}</div></div>
        <div className="cell"><div className="l"><span className="ms" aria-hidden="true">lock</span>{t('royEst')}</div><div className="v">{eur(data.royaltiesDue)}</div><div className="s">{data.royaltyEnabled ? t('royEstSub') : t('royaltyInactiveShort')}</div></div>
      </div>

      <div className="ov-cols">
        {/* À traiter — real states only */}
        <div className="op-card ov-card">
          <h3>{t('todoTitle')}</h3>
          <div className="hint">{t('todoHint')}</div>
          {todo.length === 0 ? (
            <p className="op-dash__sub" style={{ margin: 0 }}>{t('todoEmpty')}</p>
          ) : (
            <div className="sup-list">
              {todo.map((it) => (
                <Link className="sup-item" href={it.href} key={it.b}>
                  <span className={`sup-item__ic ${it.cls}`}><span className="ms">{it.icon}</span></span>
                  <div className="sup-item__m"><b>{it.b}</b><span>{it.s}</span></div>
                  <span className="sup-item__n">{nf.format(it.n)}</span><span className="ms go flip-rtl">chevron_right</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Activité récente — real POS-opening events only */}
        <div className="op-card ov-card">
          <h3>{t('actTitle')}</h3>
          <div className="hint">{t('actHint')}</div>
          {data.recentActivity.length === 0 ? (
            <p className="op-dash__sub" style={{ margin: 0 }}>{t('actEmpty')}</p>
          ) : (
            <div className="sup-list">
              {data.recentActivity.map((a, i) => (
                <div className="sup-item" key={i}>
                  <span className="sup-item__ic fr"><span className="ms">celebration</span></span>
                  <div className="sup-item__m"><b>{t('actOpenedLabel', { name: a.name })}</b><span>{a.city ? `${a.city} · ${rel(a.at)}` : rel(a.at)}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
