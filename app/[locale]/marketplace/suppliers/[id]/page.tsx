'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatMoney } from '@/lib/format-money'
import './shop.css'

// ── /marketplace/suppliers/[id] — supplier catalogue + per-supplier cart (Slice 2)
// One order = one supplier. The cart is client-side (component state). On submit,
// POST /api/marketplace/orders snapshots prices server-side. Operator-gated.
//
// 🔒 Presentation-only re-skin to the --op- operator design (navy shell + Material
// Symbols, no lucide) — VERBATIM CD v1 (Notion 390fd2c9-…-d746b8, LOT 6, écran 3).
// ⚠️🔒 ARGENT — the client cart is DISPLAY-ONLY preview: totalCents = Σ priceCents·qty
// (formatMoney), belowMin = totalCents < minimumOrderCents (gates the CTA only). The
// REAL subtotal/total/minimum are computed SERVER-side by POST /api/marketplace/orders
// (buildOrderLines snapshot CENTS → immutable SupplyOrder). « Passer la commande » fires
// that REAL POST byte-identical (disabled when belowMin/empty); the honest « estimation
// d'affichage » note stays. Every fetch / state / handler kept byte-identical below —
// only the markup is restyled. The shell (OperatorShell) already provides .gb-op +
// .op-content — this page renders the BARE screen content (<section>…).

interface CatalogItem {
  id: string
  name: string
  description: string | null
  category: string
  priceCents: number
  unit: string
  packSize: string | null
  allergens: string[]
}
interface DiscoverSupplier {
  id: string
  companyName: string
  city: string | null
  minimumOrderCents: number
  leadTimeDays: number
  catalogItems: CatalogItem[]
}

export default function SupplierStorefrontPage({ params }: { params: { id: string } }) {
  const t  = useTranslations('marketplace')
  const ts = useTranslations('supplier')
  const locale = useLocale()

  const [supplier, setSupplier] = useState<DiscoverSupplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [cart, setCart] = useState<Record<string, number>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState('')
  const [placed, setPlaced] = useState<{ totalCents: number } | null>(null)

  // Presentation-only UI state (does NOT touch money/order data).
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    fetch('/api/marketplace/suppliers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const found = (d.suppliers as DiscoverSupplier[]).find((s) => s.id === params.id)
        if (found) setSupplier(found)
        else setNotFound(true)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [params.id])

  const items = supplier?.catalogItems ?? []
  const setQty = (id: string, q: number) => setCart((c) => ({ ...c, [id]: Math.max(0, q) }))

  const lines = useMemo(
    () => items.filter((it) => (cart[it.id] ?? 0) > 0).map((it) => ({ it, qty: cart[it.id] })),
    [items, cart],
  )
  const totalCents = lines.reduce((s, l) => s + l.it.priceCents * l.qty, 0)
  const lineCount  = lines.reduce((s, l) => s + l.qty, 0)
  const minOrderCents = supplier?.minimumOrderCents ?? 0
  const belowMin = minOrderCents > 0 && totalCents < minOrderCents
  const shortfallCents = Math.max(minOrderCents - totalCents, 0)

  // Distinct catalogue categories (for the filter row) — presentation only.
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const it of items) if (!seen.includes(it.category)) seen.push(it.category)
    return seen
  }, [items])

  // Visible items after the (client-side, display-only) search + category filter.
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      const matchesCat = catFilter === 'all' || it.category === catFilter
      const matchesQ = !q || it.name.toLowerCase().includes(q)
      return matchesCat && matchesQ
    })
  }, [items, search, catFilter])

  async function placeOrder() {
    if (placing || !lines.length || belowMin) return
    setPlacing(true); setPlaceError('')
    try {
      const res = await fetch('/api/marketplace/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierProfileId: params.id,
          lines: lines.map((l) => ({ catalogItemId: l.it.id, quantity: l.qty })),
          notes: notes.trim() || null,
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setPlaceError(d?.error || t('errOrder')); return }
      setPlaced({ totalCents: d?.order?.totalCents ?? totalCents })
      setCart({}); setConfirmOpen(false); setDrawerOpen(false)
    } catch {
      setPlaceError(t('errOrder'))
    } finally {
      setPlacing(false)
    }
  }

  // Localised unit label, e.g. unit "kg" → ts('uKg').
  const unitLabel = (unit: string) =>
    ts(`u${unit.charAt(0).toUpperCase()}${unit.slice(1)}` as 'uKg')
  const catLabel = (cat: string) => {
    const key = `cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}`
    const label = ts(key as 'catFresh')
    return label === key ? cat : label
  }
  const logoInitials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'F'

  // ── Loading (skeleton) ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="op-skel" aria-busy="true">
        <span className="op-sk" style={{ width: 110, height: 18, marginBottom: 14, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 100, borderRadius: 12, marginBottom: 18, display: 'block' }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <span className="op-sk" style={{ flex: 1, height: 42, borderRadius: 8 }} />
          <span className="op-sk" style={{ width: 280, height: 42, borderRadius: 999 }} />
        </div>
        <div className="op-card"><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 44 }} />)}
        </div></div>
      </section>
    )
  }

  // ── Error / not found ───────────────────────────────────────────────────────
  if (notFound || !supplier) {
    return (
      <section className="op-error">
        <div className="op-center">
          <div className="op-error__card">
            <span className="ms">cloud_off</span>
            <h2>{t('supplierNotFound')}</h2>
            <Link href="/marketplace/suppliers" className="back-link" style={{ justifyContent: 'center', margin: '0 auto' }}>
              <span className="ms flip-rtl">arrow_back</span>{t('backToList')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  // ── Confirmation screen after a successful order ────────────────────────────
  if (placed) {
    return (
      <section>
        <div className="op-card op-center" style={{ padding: 0 }}>
          <div className="shop-placed">
            <span className="shop-placed__ico"><span className="ms">check_circle</span></span>
            <h1>{t('orderPlacedTitle')}</h1>
            <p>{t('orderPlacedBody', { supplier: supplier.companyName })}</p>
            <div className="placed-total mono">{formatMoney(placed.totalCents, locale)}</div>
            <Link href="/marketplace/suppliers" className="back-link">
              <span className="ms flip-rtl">arrow_back</span>{t('backToSuppliers')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const catalogueEmpty = items.length === 0

  // ── Cart contents (shared markup for desktop column + mobile drawer) ────────
  const cartInner = (
    <>
      {lineCount === 0 ? (
        <div className="cart-empty">
          <span className="ms">shopping_cart</span>
          <b>{t('cartEmptyTitle')}</b>
          <span>{t('cartEmptyBody')}</span>
        </div>
      ) : (
        <div className="cart-lines nos">
          {lines.map((l) => (
            <div key={l.it.id} className="cart-line">
              <div className="m">
                <b>{l.it.name}</b>
                <span><span className="mono">{l.qty}</span> × {l.it.packSize || unitLabel(l.it.unit)}</span>
              </div>
              <span className="line-total mono">{formatMoney(l.it.priceCents * l.qty, locale)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="cart-foot">
        <div className="cart-row">
          <span>{t('cartSubtotal')}</span>
          <b className="subtotal-val mono">{formatMoney(totalCents, locale)}</b>
        </div>
        {belowMin && lineCount > 0 && (
          <div className="shortfall-msg">
            <span className="ms">info</span>
            <span>{t('shortfallLead')} <b className="mono shortfall-amt">{formatMoney(shortfallCents, locale)}</b> {t('shortfallTail', { amount: formatMoney(minOrderCents, locale) })}</span>
          </div>
        )}
        <button
          type="button"
          className="op-btn-primary submit-order-btn"
          disabled={belowMin || lineCount === 0}
          onClick={() => { setDrawerOpen(false); setConfirmOpen(true) }}
        >
          <span className="ms">check_circle</span>{t('placeOrder')}
        </button>
        <div className="server-note">
          <span className="ms">info</span>
          <span>{t('serverNote')}</span>
        </div>
      </div>
    </>
  )

  return (
    <section className="op-catalog">
      <Link href="/marketplace/suppliers" className="back-link">
        <span className="ms flip-rtl">arrow_back</span>{t('backToList')}
      </Link>

      {/* Supplier header */}
      <div className="op-card shop-header">
        <span className="shop-header__logo">{logoInitials(supplier.companyName)}</span>
        <div className="shop-header__m">
          <b>{supplier.companyName}</b>
          <div className="shop-header__meta">
            {supplier.city && <span><span className="ms">location_on</span>{supplier.city}</span>}
            <span><span className="ms">schedule</span>{ts('leadTimeValue', { days: supplier.leadTimeDays })}</span>
          </div>
          {categories.length > 0 && (
            <div className="shop-header__cats">
              {categories.map((c) => <span key={c} className="shop-cat-chip">{catLabel(c)}</span>)}
            </div>
          )}
        </div>
        {minOrderCents > 0 && (
          <div className="shop-header__min">
            <span className="lbl">{t('minOrderLabel')}</span>
            <span className="min-val mono">{formatMoney(minOrderCents, locale)}</span>
          </div>
        )}
      </div>

      {catalogueEmpty ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms">storefront</span>
            <b>{t('catalogEmptyTitle')}</b>
            <span>{t('catalogEmptyBody')}</span>
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar — search + category filter (display-only) */}
          <div className="shop-toolbar">
            <div className="shop-search">
              <span className="ms">search</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('catalogSearchPlaceholder')}
              />
            </div>
            {categories.length > 0 && (
              <div className="shop-cats-filter">
                <button type="button" className={catFilter === 'all' ? 'is-active' : undefined} onClick={() => setCatFilter('all')}>
                  {t('filterAll')}
                </button>
                {categories.map((c) => (
                  <button key={c} type="button" className={catFilter === c ? 'is-active' : undefined} onClick={() => setCatFilter(c)}>
                    {catLabel(c)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="shop-layout">
            {/* Catalogue */}
            <div className="op-card catalog-list">
              {visibleItems.length === 0 ? (
                <div className="op-emptyline">
                  <span className="ms">search_off</span>
                  <b>{t('noMatchTitle')}</b>
                </div>
              ) : (
                visibleItems.map((it) => {
                  const qty = cart[it.id] ?? 0
                  return (
                    <div key={it.id} className="cat-item">
                      <div className="cat-item__m">
                        <b>{it.name}</b>
                        <span>{it.packSize || unitLabel(it.unit)}</span>
                      </div>
                      <span className="item-price mono">{formatMoney(it.priceCents, locale)}</span>
                      <div className="qty-ctrl">
                        {qty === 0 ? (
                          <button type="button" className="add-btn" onClick={() => setQty(it.id, 1)}>
                            <span className="ms">add</span>{t('addToCart')}
                          </button>
                        ) : (
                          <div className="stepper">
                            <button type="button" aria-label="-" onClick={() => setQty(it.id, qty - 1)}><span className="ms">remove</span></button>
                            <span className="qtyval mono">{qty}</span>
                            <button type="button" aria-label="+" onClick={() => setQty(it.id, qty + 1)}><span className="ms">add</span></button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Sticky cart (desktop) */}
            <div className="op-card cart-col desktop-only">
              <div className="cart-head"><span className="ms">shopping_cart</span><b>{t('cartTitle')}</b></div>
              {cartInner}
            </div>
          </div>
        </>
      )}

      {/* Mobile cart bar (collapsed) */}
      {lineCount > 0 && !catalogueEmpty && (
        <button type="button" className="mobile-cart-bar" onClick={() => setDrawerOpen(true)}>
          <span className="l"><span className="ms">shopping_cart</span>{t('cartCount', { count: lineCount })}</span>
          <span className="r"><b className="subtotal-val mono">{formatMoney(totalCents, locale)}</b><span className="ms flip-rtl">chevron_right</span></span>
        </button>
      )}

      {/* Mobile cart drawer */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <div className={`mobile-cart-drawer${drawerOpen ? ' open' : ''}`}>
        <div className="drawer-handle" />
        <div className="cart-head">
          <span className="ms">shopping_cart</span><b>{t('cartTitle')}</b>
          <button type="button" className="cart-head__close" aria-label={t('close')} onClick={() => setDrawerOpen(false)}><span className="ms">close</span></button>
        </div>
        {cartInner}
      </div>

      {/* Confirm modal — real POST /api/marketplace/orders */}
      {confirmOpen && (
        <div className="op-modal-backdrop" onClick={() => !placing && setConfirmOpen(false)}>
          <div className="op-modal" onClick={(e) => e.stopPropagation()}>
            <div className="op-modal__head">
              <div className="op-modal__headtext">
                <h3>{t('cartTitle')}</h3>
                <span className="sub">{supplier.companyName}</span>
              </div>
              <button type="button" className="op-modal__close" aria-label={t('close')} onClick={() => !placing && setConfirmOpen(false)}><span className="ms">close</span></button>
            </div>
            <div className="op-modal__body">
              {placeError && (
                <div className="shortfall-msg" style={{ background: 'var(--op-danger-bg)', borderColor: 'var(--op-danger-bd)' }}>
                  <span className="ms" style={{ color: 'var(--op-danger)' }}>error</span>
                  <span>{placeError}</span>
                </div>
              )}
              <div className="cart-lines nos" style={{ maxHeight: 224 }}>
                {lines.map((l) => (
                  <div key={l.it.id} className="cart-line">
                    <div className="m"><b><span className="mono">{l.qty}×</span> {l.it.name}</b></div>
                    <span className="line-total mono">{formatMoney(l.it.priceCents * l.qty, locale)}</span>
                  </div>
                ))}
              </div>
              <div className="cart-row" style={{ borderTop: '1px solid var(--op-border)', paddingTop: 10 }}>
                <span>{t('cartTotal')}</span><b className="mono">{formatMoney(totalCents, locale)}</b>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{t('notesLabel')}</label>
                <textarea
                  rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')}
                  style={{ width: '100%', borderRadius: 'var(--op-r-md)', border: '1px solid var(--op-border-strong)', background: 'var(--op-surface)', color: 'var(--op-text)', padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
              <div className="server-note">
                <span className="ms">info</span>
                <span>{t('serverNote')}</span>
              </div>
            </div>
            <div className="op-modal__foot">
              <button type="button" className="op-btn-ghost" disabled={placing} onClick={() => setConfirmOpen(false)}>{t('close')}</button>
              <button type="button" className="op-btn-primary" disabled={placing} onClick={placeOrder}>
                {placing ? <><span className="ms spin">progress_activity</span>{t('placing')}</> : <><span className="ms">check_circle</span>{t('confirmOrder')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
