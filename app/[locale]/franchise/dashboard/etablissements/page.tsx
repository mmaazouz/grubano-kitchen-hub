'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import './franchise-etablissements.css'

// ── FR3 · Établissements — read-only network console (CD Vague 2) ─────────────────
// Rendered inside FranchiseShell. Consultation only: list (search + status filter) ↔
// POS fiche. POS lifecycle is driven by candidature approval (FR4), not manual CRUD.
// Every figure is REAL, owner-scoped (the API scopes by the session operator) and read
// only. CENTS/euros come from the server and are never recomputed client-side; the rate
// is the real Brand.royaltyPct. Fabricated mock content (contract dates, avg-rating star,
// "franchisé depuis") is DROPPED — no source. A temporarily-closed POS shows « — » (CD).

type POS = {
  id: string; name: string; city: string | null; isActive: boolean
  restaurant: { id: string; name: string; city: string } | null
  brand_ref: { id: string; name: string; emoji: string } | null
  openedAt: string | null
  holder: string | null
  company: string | null
  restaurantAddress: string | null
  channels: { delivery: boolean; pickup: boolean } | null
  caEuros: number; orders30: number; ratePct: number; royaltyEuros: number
}

type Filter = 'all' | 'open' | 'closed'

const INITIALS = (s: string) =>
  (s.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2) || '–').toUpperCase()

export default function FranchiseEtablissementsPage() {
  const t = useTranslations('franchise.locations')
  const locale = useLocale()
  const [list, setList] = useState<POS[] | null>(null)
  const [error, setError] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let alive = true
    fetch('/api/franchise/pos', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (alive) setList(d.pointsOfSale ?? []) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [])

  const nf  = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const eur = (v: number) => `${nf.format(Math.round(v))} €`
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }), [locale])
  const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—')

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
  const filtered = useMemo(() => {
    const all = list ?? []
    const byStatus = all.filter(p => filter === 'all' ? true : filter === 'open' ? p.isActive : !p.isActive)
    if (!q.trim()) return byStatus
    const nq = norm(q)
    return byStatus.filter(p => norm(`${p.name} ${p.city ?? ''} ${p.holder ?? ''}`).includes(nq))
  }, [list, filter, q])

  const openCount   = (list ?? []).filter(p => p.isActive).length
  const closedCount = (list ?? []).filter(p => !p.isActive).length
  const detail      = (list ?? []).find(p => p.id === sel) ?? null

  if (!list && !error) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 18 }}>
          {[0, 1, 2].map(i => <span key={i} className="op-sk" style={{ width: '100%', height: 78, borderRadius: 12 }} />)}
        </div>
        <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
      </section>
    )
  }

  if (error) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  if ((list ?? []).length === 0) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card op-empty">
          <span className="ms" aria-hidden="true">storefront</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyNetworkDesc')}</span>
          <div style={{ marginTop: 18 }}>
            <Link href="/franchise/dashboard/candidatures" className="op-btn-primary"><span className="ms" aria-hidden="true">how_to_reg</span>{t('seeApplications')}</Link>
          </div>
        </div>
      </section>
    )
  }

  // ── DETAIL / FICHE ──
  if (detail) {
    const d = detail
    const caShown = d.isActive && d.caEuros > 0
    return (
      <section>
        <button className="op-back" onClick={() => setSel(null)}><span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('title')}</button>

        <div className="op-card es-dt-top">
          <span className="es-dt-logo">{INITIALS(d.name)}</span>
          <div className="es-dt-m">
            <h2>{d.name}</h2>
            <div className="sub">
              {(d.restaurantAddress || d.city) && <span><span className="ms" aria-hidden="true">place</span>{d.restaurantAddress || d.city}</span>}
              {d.holder && <span><span className="ms" aria-hidden="true">person</span>{d.holder}</span>}
              <span className={`pill ${d.isActive ? 'open' : 'closed'}`}><i className="dot" />{d.isActive ? t('statusOpen') : t('statusClosed')}</span>
            </div>
          </div>
          <div className="es-dt-actions">
            {/* No franchisor-accessible link to the resto's own operator console yet. */}
            <span className="op-soon"><span className="ms" aria-hidden="true">open_in_new</span>{t('estDashboard')}<span className="tag">{t('soon')}</span></span>
          </div>
        </div>

        <div className="es-cols">
          <div>
            <div className="op-card es-sec">
              <h3><span className="ms" aria-hidden="true">badge</span>{t('holderTitle')}</h3>
              <div className="info-row"><span className="k">{t('holderName')}</span><span className="v">{d.holder || '—'}</span></div>
              {d.company && <div className="info-row"><span className="k">{t('company')}</span><span className="v">{d.company}</span></div>}
            </div>

            <div className="op-card es-sec">
              <h3><span className="ms" aria-hidden="true">info</span>{t('estTitle')}</h3>
              <div className="info-row"><span className="k">{t('address')}</span><span className="v">{d.restaurantAddress || d.city || '—'}</span></div>
              <div className="info-row"><span className="k">{t('openedOn')}</span><span className="v mono">{day(d.openedAt)}</span></div>
              <div className="info-row"><span className="k">{t('channels')}</span><span className="v">{
                d.channels
                  ? [d.channels.delivery ? t('chanDelivery') : null, d.channels.pickup ? t('chanPickup') : null].filter(Boolean).join(' · ') || '—'
                  : '—'
              }</span></div>
            </div>
          </div>

          <div>
            <div className="es-kpis">
              <div className="op-card es-kpi"><div className="l"><span className="ms" aria-hidden="true">lock</span>{t('kpiCa')}</div><div className="v">{caShown ? eur(d.caEuros) : '—'}</div></div>
              <div className="op-card es-kpi"><div className="l"><span className="ms" aria-hidden="true">lock</span>{t('kpiOrders')}</div><div className="v">{caShown ? nf.format(d.orders30) : '—'}</div></div>
              <div className="op-card es-kpi"><div className="l"><span className="ms" aria-hidden="true">lock</span>{t('kpiRoyalty', { pct: d.ratePct })}</div><div className="v">{caShown ? eur(d.royaltyEuros) : '—'}</div></div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ── LIST ──
  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('networkSub')}</p>
        </div>
        <span className="ro-badge"><span className="ms" aria-hidden="true">lock</span>{t('consolidatedRo')}</span>
      </div>

      <div className="stat-strip">
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">storefront</span>{t('statTotal')}</div><div className="v">{nf.format((list ?? []).length)}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">check_circle</span>{t('statOpen')}</div><div className="v">{nf.format(openCount)}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">pause_circle</span>{t('statClosed')}</div><div className="v">{nf.format(closedCount)}</div></div>
      </div>

      <div className="es-toolbar">
        <div className="es-search"><span className="ms" aria-hidden="true">search</span>
          <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>
      </div>
      <div className="es-chips">
        {(['all', 'open', 'closed'] as Filter[]).map(f => (
          <button key={f} type="button" className={`es-chip${filter === f ? ' is-active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? t('filterAll') : f === 'open' ? t('statusOpen') : t('statusClosed')}
          </button>
        ))}
      </div>

      <div className="op-card" style={{ marginTop: 16 }}>
        <div className="es-thead">
          <span>{t('colEstablishment')}</span><span>{t('colFranchisee')}</span><span>{t('colStatus')}</span><span style={{ textAlign: 'end' }}>{t('colCa')}</span>
        </div>
        {filtered.length === 0 ? (
          <div className="op-empty" style={{ padding: '48px 20px' }}><span className="ms" aria-hidden="true">search_off</span><b>{t('noMatch')}</b></div>
        ) : filtered.map(p => {
          const caShown = p.isActive && p.caEuros > 0
          return (
            <button className="es-row" key={p.id} onClick={() => setSel(p.id)}>
              <div className="es-est">
                <span className="es-logo">{INITIALS(p.name)}</span>
                <div className="es-est__t"><b>{p.name}</b><span><span className="ms" aria-hidden="true">place</span>{p.city || '—'}</span></div>
              </div>
              <div className="es-fr">{p.holder || '—'}</div>
              <div className="es-status-cell"><span className={`pill ${p.isActive ? 'open' : 'closed'}`}><i className="dot" />{p.isActive ? t('statusOpen') : t('statusClosed')}</span></div>
              <div className="es-ca">{caShown ? eur(p.caEuros) : '—'}<small>{caShown ? <><span className="ms" aria-hidden="true">lock</span>{t('readOnly')}</> : <><span className="ms" aria-hidden="true">pause_circle</span>{t('closedShort')}</>}</small></div>
              <div className="es-mini">{p.holder || '—'}{caShown ? <> · <span className="mono">{eur(p.caEuros)}</span></> : <> · {t('closedShort')}</>}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
