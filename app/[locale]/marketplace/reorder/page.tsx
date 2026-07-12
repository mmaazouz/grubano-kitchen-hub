'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { reorderSearchHref } from '@/lib/marketplace'
import './reorder.css'

// ── /marketplace/reorder — stock-low → order-from-a-supplier bridge (Slice 4) ─
// Operator-gated (under /marketplace → rendered inside the navy OperatorShell via
// AppChrome). READ-ONLY list of the resto's low-stock products (from
// GET /api/marketplace/reorder, which never writes stock). Each item links to the
// Slice-2 discovery PRE-FILLED with a search by the product name — the order
// itself is the existing Slice-2 flow. No new order logic, no POST, no payment.
//
// 🔒 RE-SKIN PRESENTATION-ONLY (CD LOT 6 écran 5, Notion …8109-aaf7-…). The fetch +
// React state + the reorderSearchHref(name) NAVIGATION are kept byte-identical.
// APERÇU HONNÊTE — the API returns a FLAT low-stock list; StockItem has NO price
// and NO supplier link, so we DO NOT fabricate the CD's supplier grouping, unit
// prices, line totals, supplier minimums nor the « estimated € total ». Quantities
// are Float (mono, NOT cents). Content-only <section className="op-rq">.

interface LowItem {
  id: string
  name: string
  quantity: number
  unit: string
  minThreshold: number
  dlc: string | null
  status: 'urgent' | 'soon' | 'ok'
}

export default function ReorderPage() {
  const t = useTranslations('marketplace')
  const tOp = useTranslations('operator')

  const [items, setItems] = useState<LowItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/marketplace/reorder', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = (s: string) => (s === 'urgent' ? t('stockUrgent') : t('stockSoon'))
  // CD pill map: an item at/near rupture (urgent) → danger « Rupture »-style pill;
  // a below-threshold item (soon) → warning « Bas »-style pill.
  const pillClass = (s: string) => (s === 'urgent' ? 'out' : 'low')

  // Honest aggregate counts derived from the SAME real list (no fabricated € total).
  const urgentCount = items.filter((i) => i.status === 'urgent').length

  const head = (
    <div className="op-dash__head">
      <h1 className="op-dash__title">{t('reorderTitle')}</h1>
      <p className="op-dash__sub">{t('reorderSubtitle')}</p>
    </div>
  )

  // ── loading — CD skeleton ──
  if (loading) {
    return (
      <section className="op-rq">
        <div style={{ marginBottom: 18 }}>
          <span className="op-sk" style={{ width: 260, height: 22 }} />
        </div>
        <div className="op-card" style={{ marginBottom: 18 }}>
          <div style={{ padding: 18, display: 'flex', gap: 24 }}>
            <span className="op-sk" style={{ width: 110, height: 34 }} />
            <span className="op-sk" style={{ width: 110, height: 34 }} />
          </div>
        </div>
        <span className="op-sk" style={{ width: '100%', height: 220, borderRadius: 12, display: 'block' }} />
      </section>
    )
  }

  // ── error — CD error card ──
  if (error) {
    return (
      <section className="op-rq">
        <div className="op-error__card">
          <span className="ms">cloud_off</span>
          <h2>{tOp('dash.errorTitle')}</h2>
          <p>{tOp('dash.errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}>
            <span className="ms">refresh</span>{tOp('dash.retry')}
          </button>
        </div>
      </section>
    )
  }

  // ── empty — CD « ÉTAT HEUREUX » (all well stocked = good news) ──
  if (items.length === 0) {
    return (
      <section className="op-rq">
        {head}
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms">task_alt</span>
            <b>{t('reorderEmpty')}</b>
            <Link href="/marketplace/suppliers">
              <span className="ms">local_shipping</span>{t('browseAll')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  // ── loaded ──
  return (
    <section className="op-rq">
      {head}

      {/* HONEST stat-strip — only real counts derived from the list (no € total,
          StockItem carries no price → nothing to sum). */}
      <div className="op-card stat-strip">
        <div className="stat">
          <span className="lbl">{t('reorderStatItems')}</span>
          <b className="mono">{items.length}</b>
        </div>
        <div className="stat">
          <span className="lbl">{t('reorderStatUrgent')}</span>
          <b className="mono">{urgentCount}</b>
        </div>
        <div className="stat">
          <span className="lbl">{t('reorderStatEstimate')}</span>
          <b className="soon">{tOp('soon')}</b>
        </div>
      </div>

      {/* The low-stock items, rendered as CD lines inside one card. Each row's
          « Commander chez un fournisseur » is a NAVIGATION link (no POST). */}
      <div className="op-card rq-list">
        {items.map((it) => {
          const pc = pillClass(it.status)
          return (
            <div className="rq-line" key={it.id}>
              <span className={`rq-line__ic ${pc}`}>
                <span className="ms">{pc === 'out' ? 'error' : 'warning'}</span>
              </span>
              <div className="rq-line__m">
                <b>{it.name}</b>
                <div className="rq-line__stockrow">
                  <span className="rq-stock">
                    {it.quantity}
                    <span className="rq-unit">&nbsp;{it.unit}</span>
                    {' · '}
                    {t('stockMin', { min: it.minThreshold, unit: it.unit })}
                  </span>
                  <span className={`rq-pill ${pc}`}>
                    <i className="dot" />{statusLabel(it.status)}
                  </span>
                  {it.dlc && (
                    <span className="rq-dlc">
                      <span className="ms">event</span>
                      {t('reorderDlc', { date: it.dlc })}
                    </span>
                  )}
                </div>
              </div>
              <Link href={reorderSearchHref(it.name)} className="rq-order-btn">
                <span className="ms">add_shopping_cart</span>{t('findSuppliers')}
              </Link>
            </div>
          )
        })}
      </div>

      {/* Honest bridge note — server truth + discovery-only navigation (CD .rq-note). */}
      <div className="rq-note">
        <span className="ms">info</span>
        <span>{t('reorderBridgeNote')}</span>
      </div>
    </section>
  )
}
