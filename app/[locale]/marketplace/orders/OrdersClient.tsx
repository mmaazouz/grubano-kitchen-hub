'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatMoney } from '@/lib/format-money'
import { canRestoCancel } from '@/lib/marketplace'
import { writeSupplyCart, type SupplyCart } from '@/lib/supply-cart'

// ── My supplier orders — list + detail + timeline (flux acheteur, Lot F) ─────────
// CLIENT half of /marketplace/orders. The server passed the resto's real SupplyOrders
// (owner-scoped). Read-only history: NO order is created and NO money moves here.
// « Recommander » loads the past order's lines into the browser cart and routes to the
// Lot E cart (the real POST re-validates prices/availability server-side). « Contacter »
// is a plain mailto/tel. « Annuler » reuses the existing PATCH placed→cancelled machine.
// The timeline shows a REAL timestamp only for « Commande envoyée » (createdAt) — no
// per-step timestamp is stored, so later steps show status only, never a fabricated time.

export interface OrderLine {
  catalogItemId: string | null
  nameSnapshot: string
  unitSnapshot: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}
export interface MyOrder {
  id: string
  status: string
  totalCents: number
  createdAt: string
  desiredDate: string | null
  supplierProfileId: string
  supplier: { companyName: string; city: string | null; email: string; phone: string | null } | null
  lines: OrderLine[]
}

const STATUS_ORDER = ['placed', 'confirmed', 'preparing', 'delivered'] as const
const STATUS_CLASS: Record<string, string> = {
  placed: 'sent', confirmed: 'confirmed', preparing: 'preparing',
  delivered: 'delivered', cancelled: 'cancelled', declined: 'declined',
}
const AV_GRADIENTS = [
  'linear-gradient(135deg,#2E78F0,#1E56B8)', 'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#FF8A3D,#F2570E)', 'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#8B74E0,#6E56CF)', 'linear-gradient(135deg,#8A2C3B,#5E1A24)',
]
function avatarFor(name: string): { initials: string; gradient: string } {
  const clean = (name || '?').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0
  return { initials, gradient: AV_GRADIENTS[h % AV_GRADIENTS.length] }
}

type Tab = 'all' | 'placed' | 'confirmed' | 'preparing' | 'delivered'
type Period = '30' | '90' | 'year'

export default function OrdersClient({ orders: initial }: { orders: MyOrder[] }) {
  const t  = useTranslations('marketplaceOrders')
  const ts = useTranslations('supplier')
  const locale = useLocale()
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [orders, setOrders] = useState<MyOrder[]>(initial)
  const [tab, setTab] = useState<Tab>('all')
  const [period, setPeriod] = useState<Period>('30')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const fmt = useMemo(() => ({
    date: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    day:  new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }),
  }), [locale])
  const fDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : fmt.date.format(d) }
  const fDay  = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : fmt.day.format(d) }
  const fTime = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : fmt.time.format(d) }

  const unitLabel = (u: string) => {
    const k = `u${u.charAt(0).toUpperCase()}${u.slice(1)}`
    const label = ts(k as 'uKg')
    return label === k ? u : label
  }
  const statusLabel = (s: string) => {
    const key = `st${s.charAt(0).toUpperCase()}${s.slice(1)}`
    const label = t(key as 'stPlaced')
    return label === key ? s : label
  }
  const shortNum = (id: string) => '#' + id.slice(-6).toUpperCase()

  // Period filter (client-only, after mount so SSR/hydration match).
  const periodCutoff = useMemo(() => {
    if (!mounted) return 0
    const now = new Date()
    if (period === 'year') return new Date(now.getFullYear(), 0, 1).getTime()
    const days = period === '90' ? 90 : 30
    return now.getTime() - days * 86400_000
  }, [mounted, period])

  const inPeriod = (o: MyOrder) => !mounted || new Date(o.createdAt).getTime() >= periodCutoff

  const counts = useMemo(() => {
    const base = orders.filter(inPeriod)
    return {
      all: base.length,
      placed: base.filter((o) => o.status === 'placed').length,
      confirmed: base.filter((o) => o.status === 'confirmed').length,
      preparing: base.filter((o) => o.status === 'preparing').length,
      delivered: base.filter((o) => o.status === 'delivered').length,
    }
  }, [orders, mounted, periodCutoff]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(
    () => orders.filter(inPeriod).filter((o) => tab === 'all' || o.status === tab),
    [orders, tab, mounted, periodCutoff], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const detail = selectedId ? orders.find((o) => o.id === selectedId) ?? null : null

  function reorder(o: MyOrder) {
    const cart: SupplyCart = {}
    for (const l of o.lines) if (l.catalogItemId) cart[l.catalogItemId] = (cart[l.catalogItemId] ?? 0) + l.quantity
    writeSupplyCart(o.supplierProfileId, cart)
    router.push(`/marketplace/suppliers/${o.supplierProfileId}/panier`)
  }

  async function cancel(id: string) {
    if (busyId || !window.confirm(t('cancelConfirm'))) return
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

  // Ordered timeline steps with honest states + timestamps.
  function timeline(o: MyOrder) {
    if (o.status === 'cancelled' || o.status === 'declined') {
      return [
        { key: 'placed', label: t('tlPlaced'), state: 'done', sub: `${fDay(o.createdAt)} · ${fTime(o.createdAt)}`, icon: 'check' },
        { key: o.status, label: o.status === 'cancelled' ? t('tlCancelled') : t('tlDeclined'), state: 'current', sub: '', icon: o.status === 'cancelled' ? 'cancel' : 'block' },
      ]
    }
    const idx = STATUS_ORDER.indexOf(o.status as (typeof STATUS_ORDER)[number])
    const labelKey: Record<string, string> = { placed: 'tlPlaced', confirmed: 'tlConfirmed', preparing: 'tlPreparing', delivered: 'tlDelivered' }
    const futureIcon: Record<string, string> = { placed: 'send', confirmed: 'check', preparing: 'inventory_2', delivered: 'local_shipping' }
    return STATUS_ORDER.map((k, i) => {
      const state = i < idx ? 'done' : i === idx ? 'current' : 'future'
      let sub = ''
      if (k === 'placed') sub = `${fDay(o.createdAt)} · ${fTime(o.createdAt)}`
      else if (k === 'delivered' && state !== 'done') sub = o.desiredDate ? t('expectedOn', { date: fDay(o.desiredDate) }) : t('pending')
      else if (state === 'future') sub = t('pending')
      return { key: k, label: t(labelKey[k] as 'tlPlaced'), state, sub, icon: state === 'future' ? futureIcon[k] : 'check' }
    })
  }

  // ── loading (hydration gate) ─────────────────────────────────────────────────
  if (!mounted) {
    return (
      <section className="mkt-orders" aria-busy="true">
        <span className="op-sk" style={{ width: 260, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: 320, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
        <div className="op-card"><div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 54 }} />)}
        </div></div>
      </section>
    )
  }

  // ── empty ─────────────────────────────────────────────────────────────────────
  if (orders.length === 0) {
    return (
      <section className="mkt-orders">
        <div className="op-dash__head"><h1 className="op-dash__title">{t('title')}</h1></div>
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">shopping_bag</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
          <Link href="/marketplace/suppliers" className="op-btn-primary"><span className="ms" aria-hidden="true">storefront</span>{t('emptyCta')}</Link>
        </div></div>
      </section>
    )
  }

  // ── detail view ─────────────────────────────────────────────────────────────
  if (detail) {
    const av = avatarFor(detail.supplier?.companyName || '?')
    const steps = timeline(detail)
    const contactHref = detail.supplier?.phone ? `tel:${detail.supplier.phone}` : detail.supplier?.email ? `mailto:${detail.supplier.email}` : null
    return (
      <section className="mkt-orders">
        <button type="button" className="op-back" onClick={() => setSelectedId(null)}>
          <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToList')}
        </button>

        <div className="op-card mo-detail__top">
          <span className="mo-detail__logo" style={{ background: av.gradient }}>{av.initials}</span>
          <div className="mo-detail__m">
            <h2>{detail.supplier?.companyName || '—'}</h2>
            <div className="meta">
              <span><span className="ms" aria-hidden="true">tag</span><b className="mono">{shortNum(detail.id)}</b></span>
              <span><span className="ms" aria-hidden="true">event</span>{t('placedOn', { date: fDate(detail.createdAt) })} · <span className="mono">{fTime(detail.createdAt)}</span></span>
              {detail.desiredDate && <span><span className="ms" aria-hidden="true">local_shipping</span>{t('expectedDelivery', { date: fDay(detail.desiredDate) })}</span>}
            </div>
          </div>
          <span className={`ord-status ${STATUS_CLASS[detail.status] ?? 'sent'}`} style={{ alignSelf: 'flex-start' }}><i className="dot" />{statusLabel(detail.status)}</span>
        </div>

        <div className="mo-cols">
          <div>
            <div className="op-card mo-lines">
              <h3>{t('articlesOrdered')}</h3>
              {detail.lines.map((l, i) => (
                <div className="ol-row" key={i}>
                  <span className="ol-q mono">×{l.quantity}</span>
                  <div className="ol-m">
                    <b>{l.nameSnapshot}</b>
                    <span>{unitLabel(l.unitSnapshot)} · <span className="mono">{formatMoney(l.unitPriceCents, locale)}</span></span>
                  </div>
                  <span className="ol-sub mono">{formatMoney(l.lineTotalCents, locale)}</span>
                </div>
              ))}
              <div className="ol-total"><b>{t('total')}</b><span className="v mono">{formatMoney(detail.totalCents, locale)}</span></div>
            </div>

            <div className="op-card mo-timeline">
              <h3>{t('trackingTitle')}</h3>
              <div className="tl">
                {steps.map((s) => (
                  <div key={s.key} className={`tl-step ${s.state}`}>
                    <span className="tl-dot"><span className="ms" aria-hidden="true">{s.icon}</span></span>
                    <div className="tl-m"><b>{s.label}</b>{s.sub && <span className="mono">{s.sub}</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mo-side">
            <button type="button" className="op-btn-primary" onClick={() => reorder(detail)}>
              <span className="ms" aria-hidden="true">refresh</span>{t('reorder')}
            </button>
            {contactHref && (
              <a href={contactHref} className="op-btn-ghost"><span className="ms" aria-hidden="true">chat</span>{t('contact')}</a>
            )}
            {canRestoCancel(detail.status) && (
              <button type="button" className="op-btn-ghost mo-cancel" disabled={busyId === detail.id} onClick={() => cancel(detail.id)}>
                <span className={`ms${busyId === detail.id ? ' spin' : ''}`} aria-hidden="true">{busyId === detail.id ? 'progress_activity' : 'close'}</span>{t('cancel')}
              </button>
            )}
          </div>
        </div>
      </section>
    )
  }

  // ── list view ────────────────────────────────────────────────────────────────
  return (
    <section className="mkt-orders">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{t('subtitle')}</p>
      </div>

      <div className="mo-toolbar">
        <div className="mo-tabs" role="tablist">
          {(['all', 'placed', 'confirmed', 'preparing', 'delivered'] as Tab[]).map((k) => (
            <button key={k} type="button" className={tab === k ? 'is-active' : ''} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {t(`tab_${k}` as 'tab_all')} <span className="mono">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="mo-period">
          <span className="ms" aria-hidden="true" style={{ fontSize: 16 }}>calendar_today</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label={t('periodLabel')}>
            <option value="30">{t('period30')}</option>
            <option value="90">{t('period90')}</option>
            <option value="year">{t('periodYear')}</option>
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">filter_list_off</span>
          <b>{t('tabEmpty')}</b>
        </div></div>
      ) : (
        <div className="op-card">
          <div className="mo-thead">
            <span>{t('colOrder')}</span><span>{t('colSupplier')}</span><span>{t('colItems')}</span>
            <span style={{ textAlign: 'end' }}>{t('colTotal')}</span><span>{t('colStatus')}</span><span />
          </div>
          {shown.map((o) => {
            const av = avatarFor(o.supplier?.companyName || '?')
            const units = o.lines.reduce((s, l) => s + l.quantity, 0)
            return (
              <div className="mo-row" key={o.id} onClick={() => setSelectedId(o.id)}>
                <div className="num mono">{shortNum(o.id)}<small>{fDate(o.createdAt)}</small></div>
                <div className="mo-sup">
                  <span className="mo-sup__logo" style={{ background: av.gradient }}>{av.initials}</span>
                  <div className="mo-sup__t"><b>{o.supplier?.companyName || '—'}</b>{o.supplier?.city && <span>{o.supplier.city}</span>}</div>
                </div>
                <div className="mo-items mono">{t('itemsCount', { count: units })}</div>
                <div className="mo-total mono">{formatMoney(o.totalCents, locale)}</div>
                <div className="mo-status-cell"><span className={`ord-status ${STATUS_CLASS[o.status] ?? 'sent'}`}><i className="dot" />{statusLabel(o.status)}</span></div>
                <div className="mo-act">
                  <button type="button" className="op-btn-ghost" onClick={(e) => { e.stopPropagation(); setSelectedId(o.id) }}>
                    <span className="ms" aria-hidden="true">visibility</span>{t('view')}
                  </button>
                </div>
                <div className="mo-mini"><span className="ms" aria-hidden="true">inventory_2</span>{t('itemsCount', { count: units })} · <span className="mono">{formatMoney(o.totalCents, locale)}</span></div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
