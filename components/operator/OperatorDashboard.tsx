'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'

// ── <OperatorDashboard /> — operator COCKPIT, VERBATIM CD v1 LOT 1 (Notion 390fd2c9-…-842e).
// Presentation-only re-skin of the /dashboard home. REAL data from GET /api/dashboard/overview
// (owner-scoped aggregates + alerts) — same endpoints the legacy ConsolidatedHome used.
//
// HONESTY: the API provides KPIs (CA/commandes/panier/note) + the « À traiter » alerts
// (marques à débloquer + stock bas). It does NOT provide live-ops counts (orders in
// progress / deliveries / tables) nor AI insights → those are rendered as honest
// « bientôt » placeholders, NEVER fake data (per the CD empty-day + the brief). N=0 →
// onboarding. No money mutation; figures displayed only.

type Unlock = { establishmentId: string; establishmentName: string; reason: string; detail: string }
type Stock = { stockItemId: string; name: string; brandName: string; quantity: number; unit: string; severity: 'out' | 'low' }
interface Overview {
  aggregates: { establishmentsCount: number; caJour: number; orders7d: number; avgBasket7d: number | null; avgRating: number | null; totalReviews: number }
  alerts: { brandsToUnlock: { count: number; items: Unlock[] }; stockOut: { count: number; items: Stock[] } }
  meta?: { generatedAt?: string }
}

export default function OperatorDashboard({ userName }: { userName: string; locale: string }) {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [ov, setOv] = useState<Overview | null>(null)
  const [stage, setStage] = useState<'loading' | 'error' | 'ready'>('loading')

  useEffect(() => {
    fetch('/api/dashboard/overview', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setOv(d as Overview); setStage('ready') })
      .catch(() => setStage('error'))
  }, [])

  const eur0 = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), [locale])
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const updatedAt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date()), [locale])
  const dateLabel = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), [locale])

  // ── loading skeleton ──
  if (stage === 'loading') {
    return (
      <section className="op-skel" aria-busy="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div><span className="op-sk" style={{ width: 180, height: 22, marginBottom: 8 }} /><span className="op-sk" style={{ width: 260, height: 12 }} /></div>
          <span className="op-sk" style={{ width: 110, height: 34, borderRadius: 8 }} />
        </div>
        <div className="op-kpis">{[0, 1, 2, 3].map((i) => (
          <div key={i} className="op-kpi"><span className="op-sk" style={{ width: '70%', height: 12, marginBottom: 14 }} /><span className="op-sk" style={{ width: '60%', height: 26, marginBottom: 10 }} /><span className="op-sk" style={{ width: '50%', height: 20, borderRadius: 6 }} /></div>
        ))}</div>
        <div className="op-row2">
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 160, height: 14 }} /></div><div className="op-live__grid">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="op-live__tile"><span className="op-sk" style={{ width: 22, height: 22, borderRadius: 6, marginBottom: 4 }} /><span className="op-sk" style={{ width: 30, height: 18 }} /></div>)}</div></div>
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 100, height: 14 }} /></div><div className="op-queue__list">{[0, 1, 2].map((i) => <div key={i} className="op-queue__row"><span className="op-sk" style={{ width: 32, height: 32, borderRadius: 9 }} /><div className="m" style={{ flex: 1 }}><span className="op-sk" style={{ width: '80%', height: 12, marginBottom: 6 }} /><span className="op-sk" style={{ width: '50%', height: 10 }} /></div></div>)}</div></div>
        </div>
      </section>
    )
  }

  // ── error ──
  if (stage === 'error' || !ov) {
    return (
      <section className="op-error"><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('dash.errorTitle')}</h2>
          <p>{t('dash.errorBody')}</p>
          <button type="button" className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}</button>
        </div>
      </div></section>
    )
  }

  const a = ov.aggregates
  const multi = a.establishmentsCount >= 2

  // ── onboarding (N=0) ──
  if (a.establishmentsCount === 0) {
    return (
      <section className="op-onboarding"><div className="op-center">
        <div className="op-onb__card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="Grubano" />
          <h1>{t('onb.title')}</h1>
          <p>{t('onb.body')}</p>
          <Link href="/business/onboarding" className="op-onb__cta"><span className="ms" aria-hidden="true">add_business</span>{t('onb.cta')}</Link>
          <div className="op-onb__steps">
            <div className="step"><span className="n">1</span><b>{t('onb.s1t')}</b><span>{t('onb.s1d')}</span></div>
            <div className="step"><span className="n">2</span><b>{t('onb.s2t')}</b><span>{t('onb.s2d')}</span></div>
            <div className="step"><span className="n">3</span><b>{t('onb.s3t')}</b><span>{t('onb.s3d')}</span></div>
          </div>
        </div>
      </div></section>
    )
  }

  const queue = [
    ...ov.alerts.brandsToUnlock.items.map((u) => ({ ic: 'warn', ms: 'storefront', title: u.establishmentName, sub: u.detail, href: '/dashboard/establishments' })),
    ...ov.alerts.stockOut.items.map((s) => ({ ic: s.severity === 'out' ? 'danger' : 'warn', ms: 'inventory_2', title: `${s.name} · ${s.brandName}`, sub: t('queue.stockSub', { qty: nf.format(s.quantity), unit: s.unit }), href: '/stocks' })),
  ]
  const queueCount = ov.alerts.brandsToUnlock.count + ov.alerts.stockOut.count

  // ── loaded ──
  return (
    <section className="op-dash">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('dash.title')}</h1>
          <p className="op-dash__sub">{multi && <>{t('dash.agg', { count: a.establishmentsCount })} · </>}{dateLabel} · {t('dash.updatedAt')} <span className="mono">{updatedAt}</span></p>
        </div>
        <button type="button" className="op-refresh" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.refresh')}</button>
      </div>

      {/* KPIs (real: CA / commandes 7j / panier / note) */}
      <div className="op-kpis">
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">payments</span><span className="op-kpi__lbl">{t('kpi.revenue')}</span></div>
          <div className="op-kpi__val">{eur0.format(a.caJour)}</div>
          <span style={{ fontSize: 11, color: 'var(--op-muted)' }}>{t('kpi.revenueSub')}</span>
        </div>
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">receipt_long</span><span className="op-kpi__lbl">{t('kpi.orders7d')}</span></div>
          <div className="op-kpi__val">{nf.format(a.orders7d)}</div>
        </div>
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">shopping_basket</span><span className="op-kpi__lbl">{t('kpi.basket')}</span></div>
          <div className="op-kpi__val" style={a.avgBasket7d == null ? { color: 'var(--op-muted-2)' } : undefined}>{a.avgBasket7d == null ? '—' : formatEuros(a.avgBasket7d, locale)}</div>
        </div>
        <div className="op-kpi">
          <div className="op-kpi__top"><span className="ms" aria-hidden="true">star</span><span className="op-kpi__lbl">{t('kpi.rating')}</span></div>
          <div className="op-kpi__val" style={a.avgRating == null ? { color: 'var(--op-muted-2)' } : undefined}>{a.avgRating == null ? '—' : a.avgRating.toFixed(1).replace('.', locale === 'en' ? '.' : ',')}</div>
          {a.avgRating != null && <span style={{ fontSize: 11, color: 'var(--op-muted)' }}>{t('kpi.ratingSub', { count: nf.format(a.totalReviews) })}</span>}
        </div>
      </div>

      <div className="op-row2">
        {/* Opérationnel en direct — no live backend yet → honest « bientôt » */}
        <div className="op-card">
          <div className="op-card__head"><h2>{t('live.title')}</h2></div>
          <div className="op-live__grid">
            {[
              { ms: 'receipt_long', l: 'live.orders' },
              { ms: 'event_seat', l: 'live.reservations' },
              { ms: 'two_wheeler', l: 'live.deliveries' },
              { ms: 'table_restaurant', l: 'live.tables' },
              { ms: 'skillet', l: 'live.kitchen' },
            ].map((x) => (
              <div key={x.l} className="op-live__tile soon">
                <span className="ms" aria-hidden="true">{x.ms}</span>
                <b>—</b><span>{t(x.l)}</span><span className="tag-soon">{t('soon')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* À traiter — REAL alerts */}
        <div className="op-card">
          <div className="op-card__head"><h2>{t('queue.title')}</h2>{queueCount > 0 && <span className="op-queue__count">{queueCount}</span>}</div>
          {queue.length === 0 ? (
            <div className="op-emptyline"><span className="ms" aria-hidden="true">task_alt</span><b>{t('queue.emptyTitle')}</b><span>{t('queue.emptyBody')}</span></div>
          ) : (
            <div className="op-queue__list">
              {queue.slice(0, 6).map((q, i) => (
                <Link key={i} href={q.href} className="op-queue__row">
                  <span className={`ic ${q.ic}`}><span className="ms" aria-hidden="true">{q.ms}</span></span>
                  <div className="m"><b>{q.title}</b><span>{q.sub}</span></div>
                  <span className="ms" aria-hidden="true">chevron_right</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Copilote IA — no insight backend yet → honest « bientôt » */}
      <div className="op-card op-ai-band">
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">auto_awesome</span>{t('ai.title')}</h2><span className="op-ai-tag">{t('ai.tag')}</span></div>
        <div className="op-emptyline"><span className="ms" aria-hidden="true" style={{ color: 'var(--op-ai)' }}>hourglass_empty</span><b>{t('ai.soonTitle')}</b><span>{t('ai.soonBody')}</span></div>
      </div>

      {/* quick actions — real links */}
      <div className="op-quick">
        <Link href="/orders"><button type="button"><span className="ms" aria-hidden="true">receipt_long</span>{t('quick.orders')}</button></Link>
        <Link href="/tables"><button type="button"><span className="ms" aria-hidden="true">event_available</span>{t('quick.reservation')}</button></Link>
        <Link href="/dashboard/fulfillment"><button type="button"><span className="ms" aria-hidden="true">pause_circle</span>{t('quick.pause')}</button></Link>
        <Link href="/menu"><button type="button"><span className="ms" aria-hidden="true">add_box</span>{t('quick.menu')}</button></Link>
        <Link href="/marketplace/orders"><button type="button"><span className="ms" aria-hidden="true">request_quote</span>{t('quick.invoices')}</button></Link>
      </div>
    </section>
  )
}
