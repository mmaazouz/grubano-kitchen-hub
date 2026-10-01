'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import { allowedTransitions, type SupplyOrderStatus } from '@/lib/marketplace'
import './supplier-orders.css'

// ── OrdersClient — CD v1 Lot 3 (Commandes reçues). MONEY ZONE, display-only. ──────
// Lists the caller's REAL SupplyOrders (owner-scoped server-side) and drives the
// SUPPLIER state machine via PATCH /api/supplier/orders/[id] — the SINGLE action
// engine (lib/marketplace.allowedTransitions), never duplicated. Amounts are CENTS
// server-side, shown via formatMoney. paymentStatus is READ-ONLY (from Stripe, never
// simulated, never flipped here). No money is moved on this screen.

export interface ReceivedOrder {
  id: string
  status: string
  paymentStatus: string
  totalCents: number
  notes: string | null
  desiredDate: string | null
  createdAt: string
  operator: { name: string; city: string | null } | null
  lines: { nameSnapshot: string; unitSnapshot: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[]
}

// real status → CD badge style (the CD's "shipped/Expédiée" has no real counterpart:
// the machine is placed→confirmed→preparing→delivered, so preparing wears the
// "shipped" (in-progress) style — the extra CD step is mapped, never invented).
const STATUS_CLASS: Record<string, string> = {
  placed: 'confirm', confirmed: 'prep', preparing: 'shipped',
  delivered: 'delivered', declined: 'declined', cancelled: 'cancelled',
}
const ACTION_ICON: Record<string, string> = {
  confirmed: 'check', preparing: 'restaurant', delivered: 'local_shipping',
}
const AV_GRADS = [
  'linear-gradient(135deg,#FF8A3D,#F2570E)', 'linear-gradient(135deg,#D5372A,#A8281D)',
  'linear-gradient(135deg,#E8A63D,#B9740A)', 'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
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

const TABS = ['all', 'placed', 'confirmed', 'preparing', 'delivered'] as const
type Tab = (typeof TABS)[number]

export default function OrdersClient({ initialOrders, companyName }: { initialOrders: ReceivedOrder[]; companyName: string }) {
  const t  = useTranslations('supplierOrders')
  const ts = useTranslations('supplier')  // status/action/unit labels (existing)
  const locale = useLocale()

  const [orders, setOrders] = useState<ReceivedOrder[]>(initialOrders)
  const [view, setView]     = useState<'list' | 'detail'>('list')
  const [selId, setSelId]   = useState<string | null>(null)
  const [tab, setTab]       = useState<Tab>('all')
  const [busy, setBusy]     = useState(false)

  const statusLabel = (s: string) => ts(`status${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'statusPlaced')
  const actionLabel = (s: string) => ts(`action${s.charAt(0).toUpperCase()}${s.slice(1)}` as 'actionConfirmed')
  const unitLabel   = (u: string) => ts(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg')
  const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) }
  const shortRef = (id: string) => `#${id.slice(-6).toUpperCase()}`
  const isPaid = (o: ReceivedOrder) => o.paymentStatus === 'paid'

  // KPIs (display-only)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const kpiToConfirm = orders.filter((o) => o.status === 'placed').length
  const kpiToShip    = orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing').length
  const kpiRevenueC  = orders.filter((o) => { const d = new Date(o.createdAt); return !Number.isNaN(d.getTime()) && d >= startToday }).reduce((s, o) => s + (o.totalCents ?? 0), 0)

  const counts = useMemo(() => ({
    all: orders.length,
    placed: orders.filter((o) => o.status === 'placed').length,
    confirmed: orders.filter((o) => o.status === 'confirmed').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
  }), [orders])
  const visible = tab === 'all' ? orders : orders.filter((o) => o.status === tab)
  const selected = orders.find((o) => o.id === selId) ?? null

  async function advance(id: string, to: SupplyOrderStatus) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/supplier/orders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
      })
      if (res.ok) setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: to } : o)))
    } finally { setBusy(false) }
  }

  function PayBadge({ o }: { o: ReceivedOrder }) {
    return isPaid(o)
      ? <span className="pay-status paid"><span className="ms">check_circle</span>{t('payPaid')}</span>
      : <span className="pay-status pending"><span className="ms">schedule</span>{t('payPending')}</span>
  }
  function StatusBadge({ status }: { status: string }) {
    return <span className={`ord-status ${STATUS_CLASS[status] ?? 'confirm'}`}><i className="dot" />{statusLabel(status)}</span>
  }

  // ── DETAIL ──────────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const o = selected
    const allowed = allowedTransitions('supplier', o.status)
    const primary = allowed.find((s) => s !== 'declined') ?? null
    const canReject = allowed.includes('declined')
    const finalLabel = o.status === 'delivered' ? t('doneDelivered') : o.status === 'declined' ? t('doneDeclined') : o.status === 'cancelled' ? t('doneCancelled') : null
    return (
      <section className="sup-ord">
        <button className="back-link" onClick={() => { setView('list'); setSelId(null) }}><span className="ms flip-rtl">arrow_back</span>{t('title')}</button>

        <div className="op-card det-head">
          <span className="det-head__av" style={{ background: gradFor(o.operator?.name || o.id) }}>{initials(o.operator?.name)}</span>
          <div className="det-head__m">
            <h1>{o.operator?.name ?? '—'}</h1>
            <span className="meta">{t('orderRef', { ref: shortRef(o.id) })} · {fmtDate(o.createdAt)}</span>
          </div>
          <div className="det-head__badges"><StatusBadge status={o.status} /><PayBadge o={o} /></div>
        </div>

        <div className="det-grid">
          <div className="op-card">
            <div className="li-head-row"><span>{t('colProduct')}</span><span style={{ textAlign: 'end' }}>{t('colQty')}</span><span style={{ textAlign: 'end' }}>{t('colUnit')}</span><span style={{ textAlign: 'end' }}>{t('colSubtotal')}</span></div>
            {o.lines.map((l, i) => (
              <div key={i} className="li-row">
                <div className="m"><b>{l.nameSnapshot}</b>{l.unitSnapshot && <span>{unitLabel(l.unitSnapshot)}</span>}</div>
                <span className="qty">{l.quantity}</span>
                <span className="unitp">{formatMoney(l.unitPriceCents, locale)}</span>
                <span className="subt">{formatMoney(l.lineTotalCents, locale)}</span>
              </div>
            ))}
            <div className="tot-block">
              <div className="tot-row"><span>{t('totalHt')}</span><span className="val">{formatMoney(o.totalCents, locale)}</span></div>
              <div className="tot-row grand"><span>{t('totalDue')}</span><span className="val">{formatMoney(o.totalCents, locale)}</span></div>
            </div>
          </div>

          <div className="side-col">
            <div className="op-card"><div className="client-block">
              <div className="client-row"><span className="ms">storefront</span><div className="m"><b>{o.operator?.name ?? '—'}</b><span>{t('clientLabel')}</span></div></div>
              {o.operator?.city && <div className="client-row"><span className="ms">location_on</span><div className="m"><b>{t('cityLabel')}</b><span>{o.operator.city}</span></div></div>}
              {o.desiredDate && <div className="client-row"><span className="ms">event</span><div className="m"><b>{t('desiredLabel')}</b><span>{fmtDate(o.desiredDate)}</span></div></div>}
              {o.notes && <div className="client-row"><span className="ms">sticky_note_2</span><div className="m"><b>{t('notesLabel')}</b><span>{o.notes}</span></div></div>}
            </div></div>
          </div>
        </div>

        <div className="op-card workflow-bar">
          {canReject
            ? <button className="secondary-action" onClick={() => advance(o.id, 'declined')} disabled={busy}>{t('reject')}</button>
            : <span />}
          {primary
            ? <button className="primary-action" onClick={() => advance(o.id, primary)} disabled={busy}><span className="ms">{ACTION_ICON[primary] ?? 'check'}</span>{actionLabel(primary)}</button>
            : <button className="primary-action done" disabled><span className="ms">check_circle</span>{finalLabel ?? statusLabel(o.status)}</button>}
        </div>
      </section>
    )
  }

  // ── LIST ────────────────────────────────────────────────────────────────────
  return (
    <section className="sup-ord">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{companyName} — {new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</p>
      </div>

      {orders.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms">receipt_long</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div></div>
      ) : (
        <>
          <div className="op-card stat-strip">
            <div className="stat"><span className="lbl">{t('kpiToConfirm')}</span><b>{kpiToConfirm}</b></div>
            <div className="stat"><span className="lbl">{t('kpiToShip')}</span><b>{kpiToShip}</b></div>
            <div className="stat"><span className="lbl">{t('kpiRevenue')}</span><b>{formatMoney(kpiRevenueC, locale)}</b></div>
          </div>

          <div className="ord-tabs" role="tablist">
            {TABS.map((tb) => (
              <button key={tb} className={tab === tb ? 'is-active' : ''} onClick={() => setTab(tb)}>
                {t(`tab_${tb}`)} <span className="mono">{counts[tb]}</span>
              </button>
            ))}
          </div>

          <div className="op-card">
            {visible.length === 0 ? (
              <div className="op-emptyline"><span className="ms">inbox</span><b>{t('tabEmpty')}</b></div>
            ) : visible.map((o) => {
              const actionable = allowedTransitions('supplier', o.status).length > 0
              return (
                <div key={o.id} className="ord-row" onClick={() => { setSelId(o.id); setView('detail') }}>
                  <span className="ord-row__av" style={{ background: gradFor(o.operator?.name || o.id) }}>{initials(o.operator?.name)}</span>
                  <div className="ord-row__m"><b>{o.operator?.name ?? '—'}</b><span>{fmtDate(o.createdAt)} · {t('itemsCount', { count: o.lines.reduce((s, l) => s + l.quantity, 0) })}</span></div>
                  <span className="amt">{formatMoney(o.totalCents, locale)}</span>
                  <StatusBadge status={o.status} />
                  <PayBadge o={o} />
                  <button className="ord-action" onClick={(e) => { e.stopPropagation(); setSelId(o.id); setView('detail') }}><span className="ms">visibility</span>{actionable ? t('process') : t('view')}</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
