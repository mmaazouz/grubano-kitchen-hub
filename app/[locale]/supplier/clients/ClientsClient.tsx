'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import type { SupplierClient } from '@/lib/supplier-clients'
import './supplier-clients.css'

// ── ClientsClient — CD v1 Lot 4a (Clients directory). READ-ONLY. ─────────────────
// Renders the REAL aggregated clients (buyer restaurants that ordered from this
// supplier). All amounts are CENTS server-side, shown via formatMoney. No action,
// no money movement. The contact block shows ONLY real fields (city, email) — the
// CD's street address / phone have no reliable backing, so they are omitted (honest).

const STATUS_CLASS: Record<string, string> = {
  placed: 'confirm', confirmed: 'prep', preparing: 'shipped',
  delivered: 'delivered', declined: 'declined', cancelled: 'cancelled',
}
const AV_GRADS = [
  'linear-gradient(135deg,#D5372A,#A8281D)', 'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)', 'linear-gradient(135deg,#E8A63D,#B9740A)',
  'linear-gradient(135deg,#41BD78,#1E9E57)', 'linear-gradient(135deg,#6E56CF,#8B74E0)',
]
function initials(name: string | null | undefined): string {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '—'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[1][0]).toUpperCase()
}
function gradFor(seed: string): string {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AV_GRADS[h % AV_GRADS.length]
}

export default function ClientsClient({ initialClients }: { initialClients: SupplierClient[] }) {
  const t  = useTranslations('supplierClients')
  const ts = useTranslations('supplier')
  const locale = useLocale()

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selId, setSelId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const statusLabel = (s: string) => ts(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'statusPlaced')
  const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) }
  const monthYear = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d) }
  const shortRef = (id: string) => `#${id.slice(-6).toUpperCase()}`

  const filtered = query.trim() ? initialClients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())) : initialClients
  const selected = initialClients.find((c) => c.operatorId === selId) ?? null

  // ── DETAIL ──────────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const c = selected
    return (
      <section className="sup-cl">
        <button className="back-link" onClick={() => { setView('list'); setSelId(null) }}><span className="ms flip-rtl">arrow_back</span>{t('title')}</button>

        <div className="op-card det-head">
          <span className="det-head__av" style={{ background: gradFor(c.name) }}>{initials(c.name)}</span>
          <div className="det-head__m"><h1>{c.name}</h1><span>{t('clientLabel')}</span></div>
        </div>

        <div className="op-card kpi-strip">
          <div className="stat"><span className="lbl">{t('kpiTotal')}</span><b>{formatMoney(c.totalCents, locale)}</b></div>
          <div className="stat"><span className="lbl">{t('kpiOrders')}</span><b>{c.orderCount}</b></div>
          <div className="stat"><span className="lbl">{t('kpiAvg')}</span><b>{formatMoney(c.avgCents, locale)}</b></div>
          <div className="stat"><span className="lbl">{t('kpiSince')}</span><b style={{ fontSize: 14 }}>{monthYear(c.firstOrderAt)}</b></div>
        </div>

        <div className="det-grid">
          <div className="op-card"><div className="contact-block">
            {c.city && <div className="contact-row"><span className="ms">location_on</span><div className="m"><b>{t('cityLabel')}</b><span>{c.city}</span></div></div>}
            {c.email && <div className="contact-row"><span className="ms">mail</span><div className="m"><b>{t('emailLabel')}</b><span>{c.email}</span></div></div>}
            {!c.city && !c.email && <div className="contact-row"><span className="ms">info</span><div className="m"><span>{t('noContact')}</span></div></div>}
          </div></div>

          <div className="op-card">
            <div className="hist-head">{t('history')}</div>
            {c.orders.map((o) => (
              <div key={o.id} className="hist-row">
                <div className="m"><b>{t('orderRef', { ref: shortRef(o.id) })}</b><span>{fmtDate(o.createdAt)} · {t('itemsCount', { count: o.itemCount })}</span></div>
                <span className="amt">{formatMoney(o.totalCents, locale)}</span>
                <span className={`ord-status ${STATUS_CLASS[o.status] ?? 'confirm'}`}><i className="dot" />{statusLabel(o.status)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  // ── LIST ────────────────────────────────────────────────────────────────────
  return (
    <section className="sup-cl">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        {initialClients.length > 0 && (
          <div className="op-search"><span className="ms">search</span>
            <input type="text" placeholder={t('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
      </div>

      {initialClients.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms">group</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div></div>
      ) : (
        <div className="op-card">
          {filtered.length === 0 ? (
            <div className="op-emptyline"><span className="ms">search_off</span><b>{t('noMatch')}</b></div>
          ) : filtered.map((c) => (
            <div key={c.operatorId} className="cl-row" onClick={() => { setSelId(c.operatorId); setView('detail') }}>
              <span className="cl-av" style={{ background: gradFor(c.name) }}>{initials(c.name)}</span>
              <div className="cl-m"><b>{c.name}</b><span>{[c.city, t('since', { date: monthYear(c.firstOrderAt) })].filter(Boolean).join(' · ')}</span></div>
              <div className="col"><span className="lbl">{t('colOrders')}</span><span className="val">{c.orderCount}</span></div>
              <div className="col"><span className="lbl">{t('colTotal')}</span><span className="val">{formatMoney(c.totalCents, locale)}</span></div>
              <button className="cl-view-btn" onClick={(e) => { e.stopPropagation(); setSelId(c.operatorId); setView('detail') }}><span className="ms">visibility</span>{t('view')}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
