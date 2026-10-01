'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import './supplier-facturation.css'

// ── FacturationClient — CD v1 Lot 5 (Facturation). MONEY ZONE, DISPLAY-ONLY. ──────
// Lists REAL invoices (SupplyOrders with a payment attempt) with amounts in CENTS
// (server-side), shown via formatMoney. Nothing is written, computed into a charge,
// or simulated — paymentStatus / chargedCents / supplierPayoutCents / grubanoMarginCents
// are read straight from the row. The reversement (commission / net) is shown ONLY when
// payoutStatus=active (decision 4); otherwise "—" — no speculative commission. Honest
// omissions vs the CD: no 20% VAT breakdown (VAT not modeled), no PDF, no sequential
// invoice number, no "Prochain versement" schedule.

export interface InvoiceLine { nameSnapshot: string; unitSnapshot: string; quantity: number; unitPriceCents: number; lineTotalCents: number }
export interface Invoice {
  id: string
  ref: string
  clientName: string
  dateISO: string
  paid: boolean
  chargedCents: number
  supplierPayoutCents: number
  grubanoMarginCents: number
  lines: InvoiceLine[]
}

const TABS = ['all', 'paid', 'pending'] as const
type Tab = (typeof TABS)[number]

export default function FacturationClient({
  invoices, payoutActive, caMonthCents, soldeCents, companyName,
}: {
  invoices: Invoice[]
  payoutActive: boolean
  caMonthCents: number
  soldeCents: number | null
  companyName: string
}) {
  const t  = useTranslations('supplierBilling')
  const ts = useTranslations('supplier')
  const locale = useLocale()

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selId, setSelId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) }
  const unitLabel = (u: string) => (u ? ts(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg') : '')

  const counts = useMemo(() => ({
    all: invoices.length,
    paid: invoices.filter((i) => i.paid).length,
    pending: invoices.filter((i) => !i.paid).length,
  }), [invoices])
  const visible = tab === 'all' ? invoices : tab === 'paid' ? invoices.filter((i) => i.paid) : invoices.filter((i) => !i.paid)
  const selected = invoices.find((i) => i.id === selId) ?? null

  function StatusBadge({ paid }: { paid: boolean }) {
    return paid
      ? <span className="inv-status paid"><i className="dot" />{t('statusPaid')}</span>
      : <span className="inv-status pending"><i className="dot" />{t('statusPending')}</span>
  }

  // ── DETAIL ──────────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const inv = selected
    const subtotalCents = inv.lines.reduce((s, l) => s + l.lineTotalCents, 0)
    return (
      <section className="sup-inv">
        <button className="back-link" onClick={() => { setView('list'); setSelId(null) }}><span className="ms flip-rtl">arrow_back</span>{t('title')}</button>

        <div className="op-card det-head">
          <span className="det-head__ic"><span className="ms">receipt_long</span></span>
          <div className="det-head__m"><h1>{inv.ref}</h1><span>{fmtDate(inv.dateISO)} · {inv.clientName}</span></div>
          <StatusBadge paid={inv.paid} />
        </div>

        <div className="det-grid">
          <div className="op-card">
            <div className="li-head-row"><span>{t('colDesignation')}</span><span style={{ textAlign: 'end' }}>{t('colQty')}</span><span style={{ textAlign: 'end' }}>{t('colUnit')}</span><span style={{ textAlign: 'end' }}>{t('colTotal')}</span></div>
            {inv.lines.map((l, i) => (
              <div key={i} className="li-row">
                <div className="m"><b>{l.nameSnapshot}</b>{l.unitSnapshot && <span>{unitLabel(l.unitSnapshot)}</span>}</div>
                <span className="qty">{l.quantity}</span>
                <span className="unitp">{formatMoney(l.unitPriceCents, locale)}</span>
                <span className="subt">{formatMoney(l.lineTotalCents, locale)}</span>
              </div>
            ))}
            <div className="tot-block">
              <div className="tot-row"><span>{t('subtotalHt')}</span><span className="val">{formatMoney(subtotalCents, locale)}</span></div>
              <div className="tot-row grand"><span>{t('total')}</span><span className="val">{formatMoney(inv.chargedCents, locale)}</span></div>
            </div>
          </div>

          <div className="op-card"><div className="rev-block">
            <div className="rev-block__head"><b>{t('reversement')}</b></div>
            <p className="rev-note">{t('reversementNote')}</p>
            <div className="rev-row"><span>{t('billed')}</span><span className="val">{formatMoney(inv.chargedCents, locale)}</span></div>
            <div className="rev-row">
              <span>{payoutActive ? t('commission1') : t('commission')}</span>
              <span className="val">{payoutActive ? `−${formatMoney(inv.grubanoMarginCents, locale)}` : '—'}</span>
            </div>
            <div className="rev-row net"><span>{t('netPaid')}</span><span className="val">{payoutActive ? formatMoney(inv.supplierPayoutCents, locale) : '—'}</span></div>
          </div></div>
        </div>
      </section>
    )
  }

  // ── LIST ────────────────────────────────────────────────────────────────────
  return (
    <section className="sup-inv">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{companyName}</p>
      </div>

      <div className="op-card stat-strip">
        <div className="stat">
          <span className="lbl">{t('balance')}</span>
          <b>{soldeCents !== null ? formatMoney(soldeCents, locale) : '—'}</b>
          {!payoutActive && <span className="activation-chip"><span className="ms">hourglass_top</span>{t('activation')}</span>}
        </div>
        <div className="stat"><span className="lbl">{t('monthRevenue')}</span><b>{formatMoney(caMonthCents, locale)}</b></div>
      </div>

      {invoices.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms">receipt_long</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div></div>
      ) : (
        <>
          <div className="inv-tabs" role="tablist">
            {TABS.map((tb) => (
              <button key={tb} className={tab === tb ? 'is-active' : ''} onClick={() => setTab(tb)}>
                {t(`tab_${tb}`)} <span className="cnt">{counts[tb]}</span>
              </button>
            ))}
          </div>

          <div className="op-card">
            {visible.length === 0 ? (
              <div className="op-emptyline"><span className="ms">receipt_long</span><b>{t('tabEmpty')}</b></div>
            ) : visible.map((inv) => (
              <div key={inv.id} className="inv-row" onClick={() => { setSelId(inv.id); setView('detail') }}>
                <span className="num">{inv.ref}</span>
                <div className="m"><b>{inv.clientName}</b><span>{fmtDate(inv.dateISO)}</span></div>
                <span className="amt">{formatMoney(inv.chargedCents, locale)}</span>
                <StatusBadge paid={inv.paid} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
