'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import './analytics.css'

// ── /analytics — operator PILOTAGE, VERBATIM CD v1 LOT 2 (Notion 390fd2c9-…-863e7a).
// Presentation-only re-skin. REAL data from GET /api/analytics (revenue 7d, brand
// rankings 30d, peak hours 7d, KPIs 30d). Rendered inside the shared OperatorShell
// (navy --op-* chrome) via AppChrome — this page emits ONLY the content <section>.
//
// HONESTY (never fake data):
//  • Sales chart = real 7-day points (this week). The previous-week comparison line has
//    no backend → honest « bientôt » note, NO invented dashed baseline.
//  • KPI trends (vs période précédente) have no backend → honest « bientôt » badge.
//  • Couverts (covers) has no backend → « — ».
//  • 7j orders/basket are not exposed by the endpoint → « — » (only 30j is real).
//  • Rank « Marques » = real brandStats. Rank « Plats » has no per-dish backend →
//    honest empty line, NOT fake dishes.
//  • Heatmap CD is jour×heure; the endpoint only gives an HOURLY aggregate (10h–23h) →
//    render an honest single « par heure » intensity strip mapped to 6 levels, with a
//    « détail jour × heure — bientôt » note. No fabricated per-day variation.
//  • « Dates personnalisées » = inert « Bientôt ».
// 🔒 No money mutation; figures displayed only.

type RevenuePoint = { date: string; label: string; amount: number }
type BrandStat = { name: string; emoji: string; amount: number; count: number }
type HourStat = { hour: number; count: number }
type AnalyticsData = {
  revenueChart: RevenuePoint[]
  brandStats: BrandStat[]
  peakHours: HourStat[]
  kpis: { todayRevenue: number; todayOrders: number; totalRevenue: number; avgOrder: number; totalOrders: number }
}

type Period = '7d' | '30d'
type RankTab = 'plats' | 'marques'

const BRAND_GRADS = [
  'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#6E56CF,#8B74E0)',
  'linear-gradient(135deg,#2E78F0,#6FB6F5)',
]

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export default function AnalyticsPage() {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [stage, setStage] = useState<'loading' | 'error' | 'ready'>('loading')
  const [period, setPeriod] = useState<Period>('30d')
  const [rankTab, setRankTab] = useState<RankTab>('marques')

  useEffect(() => {
    fetch('/api/analytics', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: AnalyticsData & { error?: string }) => {
        if (d.error) return Promise.reject()
        setData(d)
        setStage('ready')
      })
      .catch(() => setStage('error'))
  }, [])

  const eur0 = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), [locale])
  const eur2 = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  // Compact axis labels (« 4k », « 850 ») so the 40px y-axis column never overflows.
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale])
  const updatedAt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date()), [locale])

  // ── loading skeleton ──
  if (stage === 'loading') {
    return (
      <section aria-busy="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div><span className="op-sk" style={{ width: 160, height: 22, marginBottom: 8 }} /><span className="op-sk" style={{ width: 240, height: 12 }} /></div>
          <span className="op-sk" style={{ width: 220, height: 34, borderRadius: 999 }} />
        </div>
        <div className="op-kpis">{[0, 1, 2, 3].map((i) => (
          <div key={i} className="op-kpi"><span className="op-sk" style={{ width: '70%', height: 12, marginBottom: 14 }} /><span className="op-sk" style={{ width: '60%', height: 26, marginBottom: 10 }} /><span className="op-sk" style={{ width: '50%', height: 20, borderRadius: 6 }} /></div>
        ))}</div>
        <div className="op-card" style={{ marginBottom: 16 }}>
          <div className="op-card__head"><span className="op-sk" style={{ width: 180, height: 14 }} /></div>
          <div style={{ padding: 18 }}><span className="op-sk" style={{ width: '100%', height: 180, borderRadius: 10 }} /></div>
        </div>
        <div className="op-row2">
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 160, height: 14 }} /></div><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 22 }} />)}</div></div>
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 100, height: 14 }} /></div><div className="op-rank__list">{[0, 1, 2].map((i) => <div key={i} className="rk-row"><span className="op-sk" style={{ width: 22, height: 22, borderRadius: 7 }} /><div className="m" style={{ flex: 1 }}><span className="op-sk" style={{ width: '80%', height: 12, marginBottom: 8 }} /><span className="op-sk" style={{ width: '100%', height: 5 }} /></div></div>)}</div></div>
        </div>
      </section>
    )
  }

  // ── error ──
  if (stage === 'error' || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('analytics.errorTitle')}</h2>
          <p>{t('dash.errorBody')}</p>
          <button type="button" className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}</button>
        </div>
      </div></section>
    )
  }

  const { revenueChart, brandStats, peakHours, kpis } = data
  const hasData = revenueChart.some((p) => p.amount > 0) || brandStats.length > 0 || kpis.totalOrders > 0

  // ── empty (establishment too recent — not enough data) ──
  if (!hasData) {
    return (
      <section>
        <div className="op-dash__head">
          <div><h1 className="op-dash__title">{t('analytics.title')}</h1><p className="op-dash__sub">{t('analytics.updatedAt')} <span className="mono">{updatedAt}</span></p></div>
        </div>
        <div className="op-card"><div className="op-emptyline" style={{ padding: '60px 20px' }}>
          <span className="ms" aria-hidden="true">insights</span>
          <b>{t('analytics.emptyTitle')}</b>
          <span>{t('analytics.emptyBody')}</span>
          <Link href="/orders"><span className="ms" aria-hidden="true" style={{ fontSize: 15 }}>receipt_long</span>{t('analytics.emptyCta')}</Link>
        </div></div>
      </section>
    )
  }

  // ── derived KPI values (REAL, per period; unavailable → null) ──
  const rev7 = revenueChart.reduce((s, p) => s + p.amount, 0)
  const kCa = period === '7d' ? rev7 : kpis.totalRevenue
  const kOrders = period === '7d' ? null : kpis.totalOrders       // 7d order count not exposed
  const kBasket = period === '7d' ? null : kpis.avgOrder          // 7d basket not exposed
  // Couverts (reservations covers): no backend → always null (honest « — »)

  // ── best day (real) ──
  const best = revenueChart.length ? revenueChart.reduce((a, b) => (b.amount > a.amount ? b : a)) : null

  // ── SVG sales line (computed from REAL 7-day amounts) ──
  const W = 640, H = 190, PADL = 46, PADR = 620, TOP = 10, BOT = 170
  const maxAmt = Math.max(...revenueChart.map((p) => p.amount), 1)
  const stepX = revenueChart.length > 1 ? (PADR - PADL) / (revenueChart.length - 1) : 0
  const pts = revenueChart.map((p, i) => {
    const x = PADL + i * stepX
    const y = BOT - (p.amount / maxAmt) * (BOT - TOP)
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, amount: p.amount }
  })
  const linePoints = pts.map((p) => `${p.x},${p.y}`).join(' ')
  const areaPoints = pts.length
    ? `${pts[0].x},${BOT} ${linePoints} ${pts[pts.length - 1].x},${BOT}`
    : ''
  const peakIdx = pts.reduce((mi, p, i, arr) => (p.amount > arr[mi].amount ? i : mi), 0)

  // ── peak-hours hourly intensity (REAL aggregate, mapped to 6 levels) ──
  const maxPeak = Math.max(...peakHours.map((h) => h.count), 1)
  const heatLevel = (count: number) => (count === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((count / maxPeak) * 5))))
  const busiest = peakHours.length ? peakHours.reduce((a, b) => (b.count > a.count ? b : a)) : null

  // ── rankings (Marques = real; Plats = no backend) ──
  const maxBrand = Math.max(...brandStats.map((b) => b.amount), 1)

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('analytics.title')}</h1>
          <p className="op-dash__sub">{t('analytics.updatedAt')} <span className="mono">{updatedAt}</span></p>
        </div>
        <div className="op-an__controls">
          <div className="op-period" role="tablist" aria-label={t('analytics.periodLabel')}>
            <button type="button" role="tab" aria-selected={period === '7d'} className={period === '7d' ? 'is-active' : ''} onClick={() => setPeriod('7d')}>{t('analytics.p7')}</button>
            <button type="button" role="tab" aria-selected={period === '30d'} className={period === '30d' ? 'is-active' : ''} onClick={() => setPeriod('30d')}>{t('analytics.p30')}</button>
          </div>
          <button type="button" className="op-daterange-btn" disabled title={t('soon')}><span className="ms" aria-hidden="true">calendar_month</span>{t('analytics.customDates')}<span className="tag-soon">{t('soon')}</span></button>
          <button type="button" className="op-refresh" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('analytics.refresh')}</button>
        </div>
      </div>

      {/* KPIs — real (CA per period) + honest « — »/« bientôt » where no backend */}
      <div className="op-kpis">
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">payments</span><span className="op-kpi__lbl">{t('analytics.kpiRevenue')}</span></div>
          <div className="op-kpi__val mono">{eur0.format(kCa)}</div>
          <span className="op-kpi__trend soon"><span className="ms" aria-hidden="true">trending_flat</span>{t('analytics.trendSoon')}</span>
        </div>
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">receipt_long</span><span className="op-kpi__lbl">{t('analytics.kpiOrders')}</span></div>
          <div className={`op-kpi__val mono${kOrders == null ? ' na' : ''}`}>{kOrders == null ? '—' : nf.format(kOrders)}</div>
          <span className="op-kpi__trend soon"><span className="ms" aria-hidden="true">trending_flat</span>{kOrders == null ? t('analytics.only30') : t('analytics.trendSoon')}</span>
        </div>
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">shopping_basket</span><span className="op-kpi__lbl">{t('analytics.kpiBasket')}</span></div>
          <div className={`op-kpi__val mono${kBasket == null ? ' na' : ''}`}>{kBasket == null ? '—' : eur2.format(kBasket)}</div>
          <span className="op-kpi__trend soon"><span className="ms" aria-hidden="true">trending_flat</span>{kBasket == null ? t('analytics.only30') : t('analytics.trendSoon')}</span>
        </div>
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">event_seat</span><span className="op-kpi__lbl">{t('analytics.kpiCovers')}</span></div>
          <div className="op-kpi__val mono na">—</div>
          <span className="op-kpi__trend soon"><span className="ms" aria-hidden="true">hourglass_empty</span>{t('soon')}</span>
        </div>
      </div>

      {/* Sales evolution — REAL 7-day line (previous-week comparison = honest « bientôt ») */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">show_chart</span>{t('analytics.chartTitle')}</h2><span className="op-card__hint">{t('analytics.chartHint')}</span></div>
        <div className="op-chart__stats">
          <div className="stat"><span>{t('analytics.total7')}</span><b className="mono">{eur0.format(rev7)}</b></div>
          {best && <div className="stat"><span>{t('analytics.bestDay')}</span><b style={{ fontSize: 14 }}>{best.label} · <span className="mono">{eur0.format(best.amount)}</span></b></div>}
        </div>
        <div className="op-chart__legend">
          <span><i className="sw" />{t('analytics.thisWeek')}</span>
          <span style={{ color: 'var(--op-muted-2)' }}><span className="ms" aria-hidden="true" style={{ fontSize: 13 }}>hourglass_empty</span>{t('analytics.prevWeekSoon')}</span>
        </div>
        <div className="op-chart-wrap" dir="ltr">
          <div className="op-chart-inner">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('analytics.chartTitle')}>
              <defs>
                <linearGradient id="anLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FF8A3D" /><stop offset="1" stopColor="#F2570E" /></linearGradient>
                <linearGradient id="anArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF6A1F" stopOpacity="0.20" /><stop offset="1" stopColor="#FF6A1F" stopOpacity="0" /></linearGradient>
              </defs>
              {[10, 50, 90, 130, 170].map((y) => (
                <line key={y} x1={PADL} y1={y} x2={PADR} y2={y} stroke={y === 170 ? 'var(--op-border-strong)' : 'var(--op-border)'} strokeWidth="1" />
              ))}
              {[
                { y: 13, v: maxAmt },
                { y: 53, v: maxAmt * 0.75 },
                { y: 93, v: maxAmt * 0.5 },
                { y: 133, v: maxAmt * 0.25 },
                { y: 173, v: 0 },
              ].map((g, i) => (
                <text key={i} x="40" y={g.y} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="var(--op-muted-2)">{g.v === 0 ? '0' : compact.format(g.v)}</text>
              ))}
              {areaPoints && <polygon points={areaPoints} fill="url(#anArea)" />}
              {linePoints && <polyline points={linePoints} fill="none" stroke="url(#anLine)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={i === peakIdx ? 4.5 : 3.5} fill="#F2570E" stroke={i === peakIdx ? '#fff' : undefined} strokeWidth={i === peakIdx ? 1.5 : undefined} />
              ))}
            </svg>
            <div className="op-chart__xaxis">
              {revenueChart.map((p) => <span key={p.date} style={{ textTransform: 'capitalize' }}>{p.label}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="op-row2">
        {/* Peak hours — REAL hourly aggregate as an intensity strip (day×hour = « bientôt ») */}
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">local_fire_department</span>{t('analytics.peakTitle')}</h2><span className="op-card__hint">{t('analytics.peakHint')}</span></div>
          {peakHours.length > 0 ? (
            <>
              <div className="op-heat-wrap" dir="ltr">
                <div className="op-heat">
                  <span className="hh" />
                  {peakHours.map((h) => <span key={h.hour} className="hh">{h.hour}h</span>)}
                  <span className="hd">{t('analytics.allHours')}</span>
                  {peakHours.map((h) => <i key={h.hour} data-lvl={heatLevel(h.count)} title={`${h.hour}h · ${nf.format(h.count)}`} />)}
                </div>
              </div>
              <div className="op-heat-legend">
                {t('analytics.calm')}
                <i style={{ background: 'rgba(255,106,31,.14)' }} /><i style={{ background: 'rgba(255,106,31,.30)' }} /><i style={{ background: 'rgba(255,106,31,.48)' }} />
                <i style={{ background: 'rgba(255,106,31,.68)' }} /><i style={{ background: 'rgba(255,106,31,.9)' }} />
                {t('analytics.busy')}
              </div>
              <p className="op-heat-note">
                <span className="ms" aria-hidden="true">schedule</span>
                {busiest && <>{t('analytics.busiestHour', { hour: `${busiest.hour}h` })} · </>}{t('analytics.dayHourSoon')}
              </p>
            </>
          ) : (
            <div className="op-emptyline"><span className="ms" aria-hidden="true">local_fire_department</span><b>{t('analytics.emptyTitle')}</b><span>{t('analytics.emptyBody')}</span></div>
          )}
        </div>

        {/* Rankings — Marques (REAL) / Plats (no per-dish backend → honest empty) */}
        <div className="op-card">
          <div className="op-card__head">
            <h2>{t('analytics.rankTitle')}</h2>
            <div className="op-rank__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={rankTab === 'plats'} className={rankTab === 'plats' ? 'is-active' : ''} onClick={() => setRankTab('plats')}>{t('analytics.tabDishes')}</button>
              <button type="button" role="tab" aria-selected={rankTab === 'marques'} className={rankTab === 'marques' ? 'is-active' : ''} onClick={() => setRankTab('marques')}>{t('analytics.tabBrands')}</button>
            </div>
          </div>
          <div className="op-rank__list">
            {rankTab === 'marques' ? (
              brandStats.length > 0 ? (
                brandStats.slice(0, 5).map((b, i) => (
                  <div key={b.name} className="rk-row">
                    <span className="av" style={{ background: BRAND_GRADS[i % BRAND_GRADS.length] }}>{b.emoji || initials(b.name)}</span>
                    <div className="m"><b>{b.name}</b><span className="bar"><i style={{ width: `${Math.max(4, (b.amount / maxBrand) * 100)}%` }} /></span></div>
                    <span className="val"><b className="mono">{eur0.format(b.amount)}</b><span>{t('analytics.salesCount', { count: nf.format(b.count) })}</span></span>
                  </div>
                ))
              ) : (
                <div className="op-emptyline"><span className="ms" aria-hidden="true">branding_watermark</span><b>{t('analytics.emptyTitle')}</b><span>{t('analytics.emptyBody')}</span></div>
              )
            ) : (
              <div className="op-emptyline"><span className="ms" aria-hidden="true">restaurant_menu</span><b>{t('analytics.dishesSoonTitle')}</b><span>{t('analytics.dishesSoonBody')}</span></div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
