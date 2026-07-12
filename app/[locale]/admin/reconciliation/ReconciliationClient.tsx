'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import type { GhostOrderList, GhostCategory } from '@/lib/admin-reconciliation'

// ── Reconciliation queue — 2 real tabs + period filter (CD ADM3). ────────────────
// CLIENT half of /admin/reconciliation. READ-ONLY: the « Résoudre » control is a
// disabled « bientôt » (POST-resolve deferred, D5). The two tabs are the REAL
// paymentStatus split (reconcile_manual → « À réconcilier », paid → « Anomalie »).
// Mount-gated so the date/period rendering can't hydrate-mismatch.

const PERIOD_DAYS: Record<string, number> = { '7': 7, '30': 30, '90': 90 }

export default function ReconciliationClient({ data }: { data: GhostOrderList }) {
  const t = useTranslations('adminReconciliation')
  const locale = useLocale()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<GhostCategory>('reconcile')
  const [period, setPeriod] = useState('7')

  useEffect(() => { setMounted(true) }, [])

  const fmt = useMemo(() => ({
    day: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }),
  }), [locale])
  const dt = (iso: string) => { const d = new Date(iso); return `${fmt.day.format(d)} · ${fmt.time.format(d)}` }
  const shortRef = (id: string) => '#' + id.slice(-6).toUpperCase()

  const cutoff = mounted ? Date.now() - (PERIOD_DAYS[period] ?? 7) * 86400_000 : 0
  const inPeriod = (iso: string) => !mounted || new Date(iso).getTime() >= cutoff

  const periodRows = useMemo(() => data.rows.filter((r) => inPeriod(r.createdAt)), [data.rows, mounted, cutoff]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => ({
    reconcile: periodRows.filter((r) => r.category === 'reconcile').length,
    anomaly:   periodRows.filter((r) => r.category === 'anomaly').length,
  }), [periodRows])
  const shownRows = periodRows.filter((r) => r.category === tab)

  // ── loading (hydration gate) ─────────────────────────────────────────────────
  if (!mounted) {
    return (
      <section aria-busy="true">
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <span className="op-sk" style={{ width: '100%', height: 64, borderRadius: 12, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: 280, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
        <div className="op-card"><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 52 }} />)}
        </div></div>
      </section>
    )
  }

  // ── nothing at all to reconcile — the normal, healthy state ──────────────────
  if (data.rows.length === 0) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card"><div className="rec-emptyline">
          <span className="ic"><span className="ms" aria-hidden="true">task_alt</span></span>
          <b>{t('allClearTitle')}</b><span>{t('allClearBody')}</span>
        </div></div>
      </section>
    )
  }

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
      </div>

      <div className="rec-info">
        <span className="ms" aria-hidden="true">info</span>
        <div className="m"><b>{t('infoTitle')}</b><p>{t('infoBody')}</p></div>
      </div>

      <div className="rec-tabs">
        <div className="rec-tabset">
          <button type="button" data-t="reconcile" className={tab === 'reconcile' ? 'is-active' : undefined} onClick={() => setTab('reconcile')}>
            <span className="ms" aria-hidden="true" style={{ fontSize: 15 }}>rule</span>{t('tabReconcile')} <span className="cnt">{counts.reconcile}</span>
          </button>
          <button type="button" data-t="anomaly" className={tab === 'anomaly' ? 'is-active' : undefined} onClick={() => setTab('anomaly')}>
            <span className="ms" aria-hidden="true" style={{ fontSize: 15 }}>warning</span>{t('tabAnomaly')} <span className="cnt">{counts.anomaly}</span>
          </button>
        </div>
        <div className="rec-period">
          <span className="ms" aria-hidden="true" style={{ fontSize: 16 }}>calendar_today</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('periodLabel')}>
            <option value="7">{t('period7')}</option>
            <option value="30">{t('period30')}</option>
            <option value="90">{t('period90')}</option>
          </select>
        </div>
      </div>

      <div className="op-card">
        <div className="rec-thead">
          <span>{t('colOrder')}</span><span>{t('colDate')}</span><span>{t('colWho')}</span>
          <span style={{ textAlign: 'end' }}>{t('colAmount')}</span><span>{t('colStatus')}</span><span style={{ textAlign: 'end' }}>{t('colActions')}</span>
        </div>
        {shownRows.length === 0 ? (
          <div className="rec-tabempty">{t('tabEmpty')}</div>
        ) : (
          shownRows.map((r) => (
            <div className="rec-row" key={r.id}>
              <span className="num">{shortRef(r.id)}</span>
              <span className="dt">{dt(r.createdAt)}</span>
              <div className="who">
                <b>{r.restaurantName ?? t('unknownRestaurant')}</b>
                <span className="rec-origin"><span className="ms" aria-hidden="true">webhook</span>{r.category === 'reconcile' ? t('originReconcile') : t('originAnomaly')}</span>
              </div>
              <span className="amt">{formatEuros(r.amountEuros, locale)}</span>
              <span><span className={`rec-chip ${r.category}`}><i className="dot" />{r.category === 'reconcile' ? t('chipReconcile') : t('chipAnomaly')}</span></span>
              <div className="rec-actions">
                <button type="button" className="rec-btn disabled" disabled>
                  <span className="ms" aria-hidden="true">check</span>{t('resolve')} <span className="soon">{t('soon')}</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {data.capped && <p className="op-dash__sub" style={{ marginTop: 12 }}>{t('cappedNote')}</p>}
    </section>
  )
}
