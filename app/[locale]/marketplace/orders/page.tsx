'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import { canRestoCancel } from '@/lib/marketplace'
import './supply-orders.css'

// ── /marketplace/orders — the resto's own supply orders (Slice 3) ─────────────
// Operator-gated (under /marketplace, rendered UNDER the navy OperatorShell chrome).
// History of the orders this restaurateur placed to wholesalers, with live status.
//
// 🔒 ZONE ARGENT — RE-SKIN PRESENTATION ONLY (CD 390fd2c9-…-da3fab7c3355). The data
// layer is kept BYTE-IDENTICAL from the previous version:
//   • GET  /api/marketplace/orders            → list (all amounts in Int CENTS)
//   • PATCH /api/marketplace/orders/[id]       {status:'cancelled'}  (only while `placed`)
//   • POST /api/marketplace/orders/[id]/pay    → { url } real Stripe Checkout redirect
//       (gate isSupplierConnectEnabled(); when OFF the server returns 403 → shown honestly)
// The payment is NEVER simulated, no fake success is fabricated, the Stripe redirect
// stays as-is. Amounts come from the server (CENTS) and are only formatted for display
// via formatMoney(cents) — NEVER recomputed. Tab filtering is client-side / presentational.

interface OrderLine {
  nameSnapshot: string
  unitSnapshot: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}
interface MyOrder {
  id: string
  status: string
  totalCents: number
  notes: string | null
  createdAt: string
  paymentStatus: string
  supplierProfile: { companyName: string; payoutStatus?: string } | null
  lines: OrderLine[]
}

type FordTab = 'all' | 'topay' | 'ongoing' | 'delivered'

// order status → CSS class + label key (label reused from `supplier.status*`)
const STATUS_CLASS: Record<string, string> = {
  placed: 'placed', confirmed: 'confirmed', preparing: 'preparing',
  delivered: 'delivered', cancelled: 'cancelled', declined: 'declined',
}

// A stable 2-letter avatar + deterministic gradient from the supplier name.
const AV_GRADIENTS = [
  'linear-gradient(135deg,#2E78F0,#1E56B8)',
  'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#8B74E0,#6E56CF)',
  'linear-gradient(135deg,#D5372A,#A8281D)',
]
function avatarFor(name: string): { initials: string; gradient: string } {
  const clean = (name || '?').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0
  return { initials, gradient: AV_GRADIENTS[h % AV_GRADIENTS.length] }
}

export default function MyMarketplaceOrdersPage() {
  const t  = useTranslations('marketplace')
  const ts = useTranslations('supplier')
  const to = useTranslations('operator')
  const locale = useLocale()

  const [orders, setOrders] = useState<MyOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<FordTab>('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payError, setPayError] = useState('')

  useEffect(() => {
    fetch('/api/marketplace/orders', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel(id: string) {
    if (busyId || !confirm(t('cancelConfirm'))) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/marketplace/orders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
      })
      if (res.ok) setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'cancelled' } : o)))
    } finally {
      setBusyId(null)
    }
  }

  async function pay(id: string) {
    if (busyId) return
    setBusyId(id); setError(''); setPayError('')
    try {
      const res = await fetch(`/api/marketplace/orders/${id}/pay`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.url) { window.location.href = d.url; return } // → Stripe Checkout (TEST)
      setPayError(d?.error || t('payError'))
    } catch {
      setPayError(t('payError'))
    } finally {
      setBusyId(null)
    }
  }

  const unitLabel = (u: string) => ts(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg')
  const statusLabel = (s: string) => ts(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'statusPlaced')
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  // short id for the "N° commande" column (server ids can be long CUIDs)
  const shortNum = (id: string) => '#' + id.slice(-6).toUpperCase()
  const isPayable = (o: MyOrder) => o.status === 'confirmed' && o.paymentStatus !== 'paid'
  const isOngoing = (s: string) => s === 'placed' || s === 'confirmed' || s === 'preparing'

  // client-side (presentational) tab counts
  const counts = useMemo(() => ({
    all: orders.length,
    topay: orders.filter(isPayable).length,
    ongoing: orders.filter((o) => isOngoing(o.status)).length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
  }), [orders])

  const shown = useMemo(() => {
    if (tab === 'topay') return orders.filter(isPayable)
    if (tab === 'ongoing') return orders.filter((o) => isOngoing(o.status))
    if (tab === 'delivered') return orders.filter((o) => o.status === 'delivered')
    return orders
  }, [orders, tab])

  const detail = detailId ? orders.find((o) => o.id === detailId) ?? null : null

  // ── loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="op-supply">
        <div style={{ marginBottom: 18 }}><span className="op-sk" style={{ width: 240, height: 24 }} /></div>
        <div className="op-card" style={{ marginBottom: 18 }}>
          <div style={{ padding: 18, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span className="op-sk" style={{ width: 110, height: 34 }} />
            <span className="op-sk" style={{ width: 110, height: 34 }} />
            <span className="op-sk" style={{ width: 110, height: 34 }} />
          </div>
        </div>
        <span className="op-sk" style={{ width: 300, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
        <div className="op-card"><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="op-sk" style={{ width: '100%', height: 50 }} />
          <span className="op-sk" style={{ width: '100%', height: 50 }} />
          <span className="op-sk" style={{ width: '100%', height: 50 }} />
        </div></div>
      </section>
    )
  }

  // ── error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <section className="op-supply"><div className="op-center">
        <div className="op-error__card">
          <span className="ms">cloud_off</span>
          <h2>{to('dash.errorTitle')}</h2>
          <p>{error}</p>
          <button className="op-btn-primary" onClick={() => window.location.reload()}>
            <span className="ms">refresh</span>{to('dash.retry')}
          </button>
        </div>
      </div></section>
    )
  }

  return (
    <section className="op-supply">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('myOrdersTitle')}</h1>
        <p className="op-dash__sub">{t('myOrdersSubtitle')}</p>
      </div>

      {orders.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms">local_shipping</span>
          <b>{t('myOrdersEmpty')}</b>
          <span>{t('myOrdersEmptyHint')}</span>
        </div></div>
      ) : (
        <>
          {/* honest counts only — no fabricated € spend / delivery-date figures */}
          <div className="op-card stat-strip">
            <div className="stat"><span className="lbl">{t('statTotal')}</span><b className="mono">{counts.all}</b></div>
            <div className="stat"><span className="lbl">{t('statToPay')}</span><b className={`mono${counts.topay ? ' alert' : ''}`}>{counts.topay}</b></div>
            <div className="stat"><span className="lbl">{t('statOngoing')}</span><b className="mono">{counts.ongoing}</b></div>
          </div>

          <div className="ford-tabs" role="tablist">
            {(['all', 'topay', 'ongoing', 'delivered'] as FordTab[]).map((k) => (
              <button key={k} type="button" className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>
                {t(`tab_${k}` as 'tab_all')} <span className="cnt mono">{counts[k]}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="op-card"><div className="op-emptyline">
              <span className="ms">filter_list_off</span>
              <b>{t('tabEmpty')}</b>
            </div></div>
          ) : (
            <>
              {/* desktop table */}
              <div className="op-card">
                <div className="o-head-row">
                  <span>{t('colNum')}</span><span>{t('colSupplier')}</span><span>{t('colDate')}</span>
                  <span>{t('colItems')}</span><span>{t('colTotal')}</span><span>{t('colStatus')}</span><span />
                </div>
                {shown.map((o) => {
                  const av = avatarFor(o.supplierProfile?.companyName || '?')
                  return (
                    <div className="o-row" key={o.id}>
                      <span className="o-num mono">{shortNum(o.id)}</span>
                      <div className="o-sup">
                        <span className="o-sup__av" style={{ background: av.gradient }}>{av.initials}</span>
                        <b>{o.supplierProfile?.companyName || '—'}</b>
                      </div>
                      <span className="o-date">{fmtDate(o.createdAt)}</span>
                      <span className="o-items-n mono">{o.lines.length}</span>
                      <span className="o-total">{formatMoney(o.totalCents, locale)}</span>
                      <span className={`o-status ${STATUS_CLASS[o.status] ?? 'placed'}`}><i className="dot" />{statusLabel(o.status)}</span>
                      <RowActions o={o} busyId={busyId} isPayable={isPayable} onCancel={cancel} onPay={pay} onDetail={() => { setPayError(''); setDetailId(o.id) }} t={t} />
                    </div>
                  )
                })}
              </div>

              {/* mobile cards */}
              <div className="ford-cards">
                {shown.map((o) => {
                  const av = avatarFor(o.supplierProfile?.companyName || '?')
                  return (
                    <div className="o-card" key={o.id}>
                      <div className="o-card__top">
                        <b className="o-num mono">{shortNum(o.id)}</b>
                        <span className={`o-status ${STATUS_CLASS[o.status] ?? 'placed'}`}><i className="dot" />{statusLabel(o.status)}</span>
                      </div>
                      <div className="o-sup">
                        <span className="o-sup__av" style={{ background: av.gradient }}>{av.initials}</span>
                        <b>{o.supplierProfile?.companyName || '—'}</b>
                      </div>
                      <div className="o-card__meta">
                        <span>{fmtDate(o.createdAt)} · {t('cartCount', { count: o.lines.length })}</span>
                        <b>{formatMoney(o.totalCents, locale)}</b>
                      </div>
                      <div className="o-card__acts">
                        <button className="o-action" onClick={() => { setPayError(''); setDetailId(o.id) }}>
                          <span className="ms">visibility</span>{t('viewDetail')}
                        </button>
                        {canRestoCancel(o.status) && (
                          <button className="o-action danger" disabled={busyId === o.id} onClick={() => cancel(o.id)}>
                            <span className={`ms${busyId === o.id ? ' spin' : ''}`}>{busyId === o.id ? 'progress_activity' : 'close'}</span>{t('actionCancel')}
                          </button>
                        )}
                        {isPayable(o) && (
                          <button className="o-action pay" disabled={busyId === o.id} onClick={() => pay(o.id)}>
                            <span className={`ms${busyId === o.id ? ' spin' : ''}`}>{busyId === o.id ? 'progress_activity' : 'payments'}</span>{t('actionPay')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── detail modal (real lines + total; real Stripe pay trigger) ── */}
      {detail && (() => {
        const av = avatarFor(detail.supplierProfile?.companyName || '?')
        const payable = isPayable(detail)
        return (
          <div className="op-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDetailId(null) }}>
            <div className="op-modal" role="dialog" aria-modal="true">
              <div className="op-modal__head">
                <h3 className="mono">{shortNum(detail.id)}</h3>
                <button className="op-modal__close" onClick={() => setDetailId(null)} aria-label={t('close')}><span className="ms">close</span></button>
              </div>
              <div className="op-modal__body">
                <div className="od-sup-box">
                  <span className="av" style={{ background: av.gradient }}>{av.initials}</span>
                  <div>
                    <b>{detail.supplierProfile?.companyName || '—'}</b>
                    <span>{t('orderedOn', { date: fmtDate(detail.createdAt) })}</span>
                  </div>
                </div>

                <div className="od-status-row">
                  <div>
                    <span className="lbl">{t('payStatusLabel')}</span>
                    <span className={`o-pay ${detail.paymentStatus === 'paid' ? 'paid' : 'topay'}`}>
                      <span className="ms">{detail.paymentStatus === 'paid' ? 'check_circle' : 'schedule'}</span>
                      {detail.paymentStatus === 'paid' ? t('payBadgePaid') : t('payBadgeUnpaid')}
                    </span>
                  </div>
                  <div>
                    <span className="lbl">{t('orderStatusLabel')}</span>
                    <span className={`o-status ${STATUS_CLASS[detail.status] ?? 'placed'}`}><i className="dot" />{statusLabel(detail.status)}</span>
                  </div>
                </div>

                <div className="od-items">
                  {detail.lines.map((l, i) => (
                    <div className="od-row" key={i}>
                      <span className="qty mono">{l.quantity}×</span>
                      <div className="m">
                        <b>{l.nameSnapshot}</b>
                        <span>{formatMoney(l.unitPriceCents, locale)} / {unitLabel(l.unitSnapshot)}</span>
                      </div>
                      <span className="price">{formatMoney(l.lineTotalCents, locale)}</span>
                    </div>
                  ))}
                </div>

                {/* total is the SERVER total (CENTS) — no fabricated fee/subtotal split */}
                <div className="od-total">
                  <div className="row grand"><span>{t('cartTotal')}</span><span className="od-total-val">{formatMoney(detail.totalCents, locale)}</span></div>
                </div>

                <div className="op-callout">
                  <span className="ms">info</span>
                  <p>{t('payServerNote')}</p>
                </div>
              </div>

              <div className="op-modal__foot">
                {payError && <p className="od-payerror">{payError}</p>}
                <button className="op-btn-ghost" onClick={() => setDetailId(null)}>{t('close')}</button>
                {canRestoCancel(detail.status) && (
                  <button className="o-action danger" disabled={busyId === detail.id} onClick={() => cancel(detail.id)}>
                    <span className={`ms${busyId === detail.id ? ' spin' : ''}`}>{busyId === detail.id ? 'progress_activity' : 'close'}</span>{t('actionCancel')}
                  </button>
                )}
                {payable && (
                  <button className="o-action pay stripe-btn" disabled={busyId === detail.id} onClick={() => pay(detail.id)}>
                    <span className={`ms${busyId === detail.id ? ' spin' : ''}`}>{busyId === detail.id ? 'progress_activity' : 'lock'}</span>{t('payWithStripe')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

// ── desktop row action cell (view / cancel / pay per status) ──────────────────
function RowActions({
  o, busyId, isPayable, onCancel, onPay, onDetail, t,
}: {
  o: MyOrder
  busyId: string | null
  isPayable: (o: MyOrder) => boolean
  onCancel: (id: string) => void
  onPay: (id: string) => void
  onDetail: () => void
  t: ReturnType<typeof useTranslations<'marketplace'>>
}) {
  const busy = busyId === o.id
  return (
    <div className="o-actioncell">
      {isPayable(o) ? (
        <button className="o-action pay" disabled={busy} onClick={() => onPay(o.id)}>
          <span className={`ms${busy ? ' spin' : ''}`}>{busy ? 'progress_activity' : 'payments'}</span>{t('actionPay')}
        </button>
      ) : canRestoCancel(o.status) ? (
        <button className="o-action danger" disabled={busy} onClick={() => onCancel(o.id)}>
          <span className={`ms${busy ? ' spin' : ''}`}>{busy ? 'progress_activity' : 'close'}</span>{t('actionCancel')}
        </button>
      ) : (
        <button className="o-action" onClick={onDetail}>
          <span className="ms">visibility</span>{t('viewDetail')}
        </button>
      )}
    </div>
  )
}
