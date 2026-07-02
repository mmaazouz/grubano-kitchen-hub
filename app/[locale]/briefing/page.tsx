'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import './briefing.css'

// ── /briefing — operator MORNING BRIEFING content, VERBATIM CD v1 LOT 2 écran 3
// (Notion 390fd2c9-…-84379). Presentation-only re-skin of the /briefing home. The page
// is already wrapped by AppChrome → OperatorShell (navy --op-* coquille) — this component
// renders ONLY the screen content = a <section> inside .op-content.
//
// REAL data from GET /api/briefing (owner-scoped): CA validé du jour + commandes du jour,
// réservations du jour (+ gros groupes ≥6), alertes stock bas. Operator name ← useSession().
// Date ← Intl (locale).
//
// HONESTY: the API does NOT provide weather, an AI synthesis line, AI insights, nor
// day-over-day forecasts/projections → those are rendered as honest « bientôt »/estimation
// placeholders, NEVER fake data (per the CD empty-day + the brief). The « briefing » LLM
// string IS returned by the API → shown verbatim as the IA synthesis when present.
// Checklist items derive from the REAL alerts when possible, else honest static defaults.
// No money mutation; figures displayed only, with .mono for RTL safety.
//
// /briefing has NO sidebar nav entry → no active sidebar item (acceptable, noted).

type LowStockItem = { name: string; quantity: number; unit: string; minThreshold: number }
type ReservationItem = { time: string; customerName: string; guests: number; table: string; status: string; allergies: unknown[] }
type BriefingData = {
  briefing:     string
  lowStock:     LowStockItem[]
  reservations: ReservationItem[]
  kpis:         { caToday: number; ordersToday: number; reservations: number; guests: number }
  generatedAt:  string
}

export default function BriefingPage() {
  const t = useTranslations('operator')
  const locale = useLocale()
  const { data: session } = useSession()

  const [data,      setData]      = useState<BriefingData | null>(null)
  const [stage,     setStage]     = useState<'loading' | 'error' | 'ready'>('loading')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})

  function load() {
    setStage('loading')
    fetch('/api/briefing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d?.error) return Promise.reject()
        setData(d as BriefingData)
        setStage('ready')
      })
      .catch(() => setStage('error'))
  }
  useEffect(() => { load() }, [])

  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const firstName = useMemo(() => {
    const n = (session?.user?.name as string | undefined)?.trim()
    return n ? n.split(/\s+/)[0] : null
  }, [session])
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
    [locale],
  )

  // ── loading skeleton (CD op-skel) ──
  if (stage === 'loading') {
    return (
      <section className="op-skel" aria-busy="true">
        <div className="op-card op-brief__hero">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div><span className="op-sk" style={{ width: 180, height: 26, marginBottom: 8 }} /><span className="op-sk" style={{ width: 220, height: 13, display: 'block' }} /></div>
            <span className="op-sk" style={{ width: 120, height: 36, borderRadius: 999 }} />
          </div>
          <span className="op-sk" style={{ width: '100%', height: 48, marginTop: 18, borderRadius: 8 }} />
        </div>
        <div className="op-row2">
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 120, height: 14 }} /></div><div style={{ padding: 18, display: 'flex', gap: 24 }}><span className="op-sk" style={{ width: 80, height: 34 }} /><span className="op-sk" style={{ width: 80, height: 34 }} /><span className="op-sk" style={{ width: 80, height: 34 }} /></div></div>
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 100, height: 14 }} /></div><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 30 }} />)}</div></div>
        </div>
        <div className="op-card" style={{ marginBottom: 18 }}><div className="op-card__head"><span className="op-sk" style={{ width: 200, height: 14 }} /></div><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 24 }} />)}</div></div>
        <div className="op-row2">
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 160, height: 14 }} /></div><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 44 }} />)}</div></div>
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 140, height: 14 }} /></div><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 22 }} />)}</div></div>
        </div>
      </section>
    )
  }

  // ── error (CD op-error) ──
  if (stage === 'error' || !data) {
    return (
      <section className="op-error"><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('briefing.errorTitle')}</h2>
          <p>{t('dash.errorBody')}</p>
          <button type="button" className="op-btn-primary" onClick={() => load()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}</button>
        </div>
      </div></section>
    )
  }

  const k = data.kpis
  // big groups tonight (≥6 covers) — derived from REAL reservations
  const bigGroups = data.reservations.filter((r) => r.guests >= 6).length

  // ── empty « journée pas encore commencée » — no CA, no résas, no alerte ──
  const isEmpty = k.caToday === 0 && k.ordersToday === 0 && k.reservations === 0 && data.lowStock.length === 0
  if (isEmpty) {
    return (
      <section className="op-empty-brief">
        <div className="op-card"><div className="op-emptyline" style={{ padding: '60px 20px' }}>
          <span className="ms" aria-hidden="true">wb_twilight</span>
          <b>{t('briefing.emptyTitle')}</b>
          <span>{t('briefing.emptyBody')}</span>
        </div></div>
      </section>
    )
  }

  // ── alerts queue — REAL data (stock bas + réservations à confirmer). Same source as dashboard. ──
  type Q = { ic: 'warn' | 'danger' | 'info'; ms: string; title: string; sub: string }
  const queue: Q[] = []
  if (data.lowStock.length > 0) {
    const names = data.lowStock.slice(0, 3).map((i) => i.name).join(', ')
    queue.push({ ic: 'danger', ms: 'inventory_2', title: t('briefing.alertStock', { count: data.lowStock.length }), sub: names })
  }
  const toConfirm = data.reservations.filter((r) => r.status !== 'arrived').length
  if (toConfirm > 0) {
    queue.push({ ic: 'warn', ms: 'event_available', title: t('briefing.alertResa', { count: toConfirm }), sub: t('briefing.alertResaSub') })
  }
  const queueCount = data.lowStock.length + toConfirm

  // ── morning checklist — items DERIVED from real alerts when possible, else honest static ──
  const items: string[] = []
  if (bigGroups > 0)              items.push(t('briefing.cbBigGroups', { count: bigGroups }))
  data.lowStock.slice(0, 1).forEach((i) => items.push(t('briefing.cbStock', { name: i.name })))
  if (toConfirm > 0)             items.push(t('briefing.cbConfirm', { count: toConfirm }))
  items.push(t('briefing.cbFridge'))
  items.push(t('briefing.cbEquipment'))
  const checklistItems = items
  const doneCount = checklistItems.filter((it) => checklist[it]).length

  // ── loaded ──
  return (
    <section className="op-brief">
      {/* HERO — real salutation + date · weather + IA synthesis = honest « bientôt » */}
      <div className="op-card op-brief__hero">
        <div className="hero-top">
          <div>
            <h1>{firstName ? t('briefing.helloName', { name: firstName }) : t('briefing.hello')}</h1>
            <p className="date">{dateLabel}</p>
          </div>
          <div className="hero-top__right">
            <div className="weather">
              <span className="ms" aria-hidden="true">partly_cloudy_day</span>
              <b className="mono">—</b><span>{t('soon')}</span>
            </div>
            <button type="button" className="op-refresh" onClick={() => load()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.refresh')}</button>
          </div>
        </div>
        <div className="ai-line">
          <span className="ms" aria-hidden="true">auto_awesome</span>
          {data.briefing
            ? <span style={{ whiteSpace: 'pre-line' }}>{data.briefing}</span>
            : <span>{t('briefing.aiSoon')}</span>}
          {!data.briefing && <span className="soon">{t('soon')}</span>}
        </div>
      </div>

      <div className="op-row2">
        {/* Chiffres du jour — REAL CA + commandes ; note = pas de backing → honnête */}
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">insights</span>{t('briefing.recapTitle')}</h2><span className="cap">{dateLabel}</span></div>
          <div className="op-brief__recap">
            <div className="stat"><span className="lbl">{t('briefing.recapCa')}</span><b className="mono">{formatEuros(k.caToday, locale, { noDecimals: true })}</b><em className="muted">{t('briefing.recapValidated')}</em></div>
            <div className="stat"><span className="lbl">{t('briefing.recapOrders')}</span><b className="mono">{nf.format(k.ordersToday)}</b><em className="muted">{t('briefing.recapToday')}</em></div>
            <div className="stat"><span className="lbl">{t('briefing.recapRating')}</span><b className="mono" style={{ color: 'var(--op-muted-2)' }}>—</b><em className="muted">{t('soon')}</em></div>
          </div>
        </div>

        {/* Aujourd'hui — REAL résas + gros groupes ; météo/prévision = honnête */}
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">today</span>{t('briefing.todayTitle')}</h2></div>
          <div className="op-brief__today">
            <div className="row">
              <span className="ms" aria-hidden="true">event_seat</span>
              <div className="m"><b>{t('briefing.todayResa', { count: k.reservations })}</b><span>{bigGroups > 0 ? t('briefing.todayBig', { count: bigGroups }) : t('briefing.todayCovers', { count: k.guests })}</span></div>
            </div>
            <div className="row">
              <span className="ms" aria-hidden="true">receipt_long</span>
              <div className="m"><b>{t('briefing.todayOrders', { count: k.ordersToday })}</b><span>{t('briefing.todayOrdersSub')}</span></div>
            </div>
            <div className="row">
              <span className="ms" aria-hidden="true">cloud</span>
              <div className="m"><b>{t('briefing.todayWeather')}</b><span>{t('briefing.todayWeatherSub')}</span><span className="tag-soon">{t('soon')}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Alertes à ne pas rater — REAL alerts (same source as dashboard queue) */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head"><h2>{t('briefing.alertsTitle')}</h2>{queueCount > 0 && <span className="op-queue__count">{queueCount}</span>}</div>
        {queue.length === 0 ? (
          <div className="op-emptyline"><span className="ms" aria-hidden="true" style={{ color: 'var(--op-success)' }}>task_alt</span><b>{t('briefing.alertsEmptyTitle')}</b><span>{t('briefing.alertsEmptyBody')}</span></div>
        ) : (
          <div className="op-queue__list">
            {queue.map((q, i) => (
              <div key={i} className="op-queue__row">
                <span className={`ic ${q.ic}`}><span className="ms" aria-hidden="true">{q.ms}</span></span>
                <div className="m"><b>{q.title}</b><span>{q.sub}</span></div>
                <span className="ms" aria-hidden="true">chevron_right</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="op-row2">
        {/* Insights IA — no insight backend yet → honest « bientôt » */}
        <div className="op-card op-ai-band">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">auto_awesome</span>{t('briefing.insightsTitle')}</h2><span className="op-ai-tag">{t('briefing.insightsTag')}</span></div>
          <div className="op-emptyline"><span className="ms" aria-hidden="true" style={{ color: 'var(--op-ai)' }}>hourglass_empty</span><b>{t('briefing.insightsSoonTitle')}</b><span>{t('briefing.insightsSoonBody')}</span></div>
        </div>

        {/* Checklist du matin — items dérivés des vraies alertes, compteur en state React */}
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">checklist</span>{t('briefing.checklistTitle')}</h2><span className="cap mono">{doneCount}/{checklistItems.length}</span></div>
          <div className="op-checklist">
            {checklistItems.map((it) => (
              <label key={it} className="cb-row">
                <input type="checkbox" checked={checklist[it] ?? false} onChange={() => setChecklist((p) => ({ ...p, [it]: !p[it] }))} />
                <span className="box"><span className="ms" aria-hidden="true">check</span></span>
                <span className="txt">{it}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
