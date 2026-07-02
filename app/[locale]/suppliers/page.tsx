'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import './suppliers.css'

// ── /suppliers — operator FOURNISSEURS annuaire — re-skin CD v1 LOT 6 (Notion
// 390fd2c9-…-8df00, operator/suppliers.html). Renders inside the operator navy shell
// (AppChrome → OperatorShell); this file only renders the <section> content.
//
// 🔒 PRESENTATION-ONLY re-skin. Every data handler is kept BYTE-IDENTICAL: the mode
// state machine, fetch('/api/suppliers'), and the POST /api/suppliers/orders payloads
// (PartnerOrderForm.sendOrder + CatalogView.sendOrders) are unchanged. Only the markup
// + CSS moved to the --op- design system + Material Symbols. LEGACY /suppliers money =
// EUROS (Float) → displayed straight from formatEuros(euros, locale), NEVER recomputed;
// every amount carries className="mono" (.sup-amt / .sup-min → RTL-safe via CSS).

// ── Types ─────────────────────────────────────────────────────────────────────

type SupplierProduct = {
  id:        string
  name:      string
  unit:      string
  price:     number
  stock:     'in' | 'low' | 'out'
}

type Supplier = {
  id:         string
  name:       string
  specialty:  string | null
  zone:       string | null
  leadTime:   string
  minOrder:   number
  rating:     number
  apiEnabled: boolean
  phone:      string | null
  email:      string | null
  products:   SupplierProduct[]
}

type CartItem = { product: SupplierProduct; supplierId: string; qty: number }

// Deterministic avatar gradient from the supplier name (CD-style vivid pairs).
const AVATAR_GRADS = [
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#2E78F0,#1E56B8)',
  'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#D5372A,#A8281D)',
  'linear-gradient(135deg,#6E56CF,#4B3894)',
  'linear-gradient(135deg,#E8A63D,#B9740A)',
]
function gradFor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_GRADS[h % AVATAR_GRADS.length]
}
function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || name[0]?.toUpperCase() || '?'
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Mode = 'choice' | 'list' | 'order' | 'self'

export default function SuppliersPage() {
  const t = useTranslations('operator')
  const [mode,      setMode]      = useState<Mode>('choice')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(false)
  const [selected,  setSelected]  = useState<Supplier | null>(null)

  useEffect(() => {
    if (mode === 'list' || mode === 'order') {
      setLoading(true)
      setError(false)
      fetch('/api/suppliers')
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then(d => setSuppliers(d.suppliers ?? []))
        .catch(() => setError(true))
        .finally(() => setLoading(false))
    }
  }, [mode])

  if (mode === 'order' && !selected) {
    return (
      <SupplierList
        suppliers={suppliers}
        loading={loading}
        error={error}
        onBack={() => setMode('choice')}
        onSelect={s => setSelected(s)}
        onCatalog={() => setMode('list')}
      />
    )
  }

  if (mode === 'order' && selected) {
    return (
      <PartnerOrderForm
        supplier={selected}
        onBack={() => setSelected(null)}
      />
    )
  }

  if (mode === 'list') {
    return (
      <CatalogView
        suppliers={suppliers}
        loading={loading}
        error={error}
        onBack={() => setMode('choice')}
      />
    )
  }

  if (mode === 'self') {
    return <SelfShoppingList onBack={() => setMode('choice')} />
  }

  // ── Mode selector (Comment restocker ?) ──
  return (
    <section className="op-sup">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('suppliers.title')}</h1>
        <p className="op-dash__sub">{t('suppliers.chooseMethod')}</p>
      </div>
      <div className="sup-choices">
        <button type="button" className="sup-choice" onClick={() => setMode('list')}>
          <span className="ic smart"><span className="ms" aria-hidden="true">auto_awesome</span></span>
          <span className="m"><b>{t('suppliers.methodCatalogTitle')}</b><span>{t('suppliers.methodCatalogSub')}</span></span>
          <span className="ms" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="sup-choice" onClick={() => setMode('order')}>
          <span className="ic single"><span className="ms" aria-hidden="true">local_shipping</span></span>
          <span className="m"><b>{t('suppliers.methodSingleTitle')}</b><span>{t('suppliers.methodSingleSub')}</span></span>
          <span className="ms" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="sup-choice" onClick={() => setMode('self')}>
          <span className="ic self"><span className="ms" aria-hidden="true">shopping_basket</span></span>
          <span className="m"><b>{t('suppliers.methodSelfTitle')}</b><span>{t('suppliers.methodSelfSub')}</span></span>
          <span className="ms" aria-hidden="true">chevron_right</span>
        </button>
      </div>
    </section>
  )
}

// ── Shared states (loading skeleton / error) ──────────────────────────────────

function SupSkeleton() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}><span className="op-sk" style={{ width: 130, height: 22 }} /></div>
      <span className="op-sk" style={{ width: 240, height: 42, borderRadius: 999, marginBottom: 18, display: 'block' }} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <span className="op-sk" style={{ flex: 1, height: 42, borderRadius: 8 }} />
        <span className="op-sk" style={{ width: 300, height: 42, borderRadius: 999 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        {[0, 1, 2].map(i => <span key={i} className="op-sk" style={{ width: '100%', height: 210, borderRadius: 12 }} />)}
      </div>
    </div>
  )
}

function SupError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('operator')
  return (
    <div className="op-center">
      <div className="op-error__card">
        <span className="ms" aria-hidden="true">cloud_off</span>
        <h2>{t('suppliers.errorTitle')}</h2>
        <p>{t('dash.errorBody')}</p>
        <button type="button" className="op-btn-primary" onClick={onRetry}>
          <span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}
        </button>
      </div>
    </div>
  )
}

// ── Supplier list (annuaire — Mes fournisseurs / Découvrir) ───────────────────

function SupplierList({
  suppliers, loading, error, onBack, onSelect, onCatalog,
}: {
  suppliers: Supplier[]
  loading:   boolean
  error:     boolean
  onBack:    () => void
  onSelect:  (s: Supplier) => void
  onCatalog: () => void
}) {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [tab, setTab] = useState<'mine' | 'discover'>('mine')
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')

  const CATS: { c: string; label: string }[] = [
    { c: 'all',        label: t('suppliers.catAll') },
    { c: 'frais',      label: t('suppliers.catFresh') },
    { c: 'sec',        label: t('suppliers.catDry') },
    { c: 'boissons',   label: t('suppliers.catDrinks') },
    { c: 'emballages', label: t('suppliers.catPackaging') },
  ]

  // Filter mirrors the CD filterSuppliers(): category token + name substring.
  const filtered = suppliers.filter((s) => {
    const hay = [s.name, s.specialty, s.zone].filter(Boolean).join(' ').toLowerCase()
    const matchesCat = cat === 'all' || hay.includes(cat)
    const matchesQ   = !query.trim() || hay.includes(query.trim().toLowerCase())
    return matchesCat && matchesQ
  })

  return (
    <section className="op-sup">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('suppliers.listTitle')}</h1>
        <p className="op-dash__sub">{t('suppliers.listSub')}</p>
      </div>

      <button type="button" className="sup-back" onClick={onBack}>
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('suppliers.changeMethod')}
      </button>

      <div className="sup-tabs" role="tablist">
        <button type="button" className={tab === 'mine' ? 'is-active' : undefined} onClick={() => setTab('mine')} role="tab" aria-selected={tab === 'mine'}>
          {t('suppliers.tabMine')} <span className="cnt mono">{suppliers.length}</span>
        </button>
        <button type="button" className={tab === 'discover' ? 'is-active' : undefined} onClick={() => setTab('discover')} role="tab" aria-selected={tab === 'discover'}>
          {t('suppliers.tabDiscover')}
        </button>
      </div>

      {tab === 'mine' && (
        <>
          <div className="sup-toolbar">
            <div className="sup-search">
              <span className="ms" aria-hidden="true">search</span>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('suppliers.searchPlaceholder')} />
            </div>
            <div className="sup-cats">
              {CATS.map(({ c, label }) => (
                <button key={c} type="button" className={cat === c ? 'is-active' : undefined} onClick={() => setCat(c)}>{label}</button>
              ))}
            </div>
          </div>

          {loading ? (
            <SupSkeleton />
          ) : error ? (
            <SupError onRetry={onCatalog} />
          ) : suppliers.length === 0 ? (
            <div className="op-card">
              <div className="op-emptyline">
                <span className="ms" aria-hidden="true">local_shipping</span>
                <b>{t('suppliers.emptyTitle')}</b>
                <span>{t('suppliers.emptyBody')}</span>
                <button type="button" className="op-btn-primary" onClick={() => setTab('discover')}>
                  <span className="ms" aria-hidden="true">explore</span>{t('suppliers.browseMarketplace')}
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="op-card">
              <div className="op-emptyline">
                <span className="ms" aria-hidden="true">search_off</span>
                <b>{t('suppliers.noMatch')}</b>
              </div>
            </div>
          ) : (
            <div className="sup-grid">
              {filtered.map((s) => (
                <div key={s.id} className="sup-card">
                  <div className="sup-card__top">
                    <span className="sup-avatar" style={{ background: gradFor(s.name) }}>{initials(s.name)}</span>
                    <div className="sup-name">
                      <b>{s.name}</b>
                      {(s.specialty || s.zone) && (
                        <div className="sup-cats-line">
                          {s.specialty && <span className="sup-cat-chip">{s.specialty}</span>}
                          {s.zone && <span className="sup-cat-chip">{s.zone}</span>}
                        </div>
                      )}
                    </div>
                    {s.apiEnabled && <span className="sup-badge api"><span className="ms" style={{ fontSize: 12 }} aria-hidden="true">bolt</span>API</span>}
                  </div>
                  <div className="sup-rating">
                    <span className="ms" aria-hidden="true">star</span>{s.rating.toFixed(1)}
                  </div>
                  <div className="sup-meta">
                    <div className="row"><span>{t('suppliers.leadTime')}</span><span>{s.leadTime}</span></div>
                    {s.minOrder > 0 && (
                      <div className="row"><span>{t('suppliers.minOrder')}</span><span className="sup-min mono">{formatEuros(s.minOrder, locale)}</span></div>
                    )}
                    <div className="row"><span>{t('suppliers.products')}</span><span className="mono">{s.products.length}</span></div>
                  </div>
                  <div className="sup-actions">
                    <button type="button" className="op-btn-primary" onClick={() => onSelect(s)}>
                      <span className="ms" aria-hidden="true">add_shopping_cart</span>{t('suppliers.order')}
                    </button>
                    <button type="button" className="op-btn-ghost" onClick={onCatalog}>{t('suppliers.viewShop')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'discover' && (
        // Honest preview: the legacy /api/suppliers endpoint returns the operator's
        // OWN suppliers only — there is no marketplace-discovery list here. Rather
        // than fabricate suppliers, point to the real discovery route.
        <div className="op-card">
          <div className="sup-discover-note">
            <span className="ms" aria-hidden="true">explore</span>
            <b>{t('suppliers.discoverTitle')}</b>
            <span>{t('suppliers.discoverBody')}</span>
            <Link href="/marketplace/suppliers" className="op-btn-primary">
              <span className="ms" aria-hidden="true">storefront</span>{t('suppliers.browseMarketplace')}
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Partner order form (single supplier — legacy sendOrder preserved) ─────────

function PartnerOrderForm({ supplier, onBack }: { supplier: Supplier; onBack: () => void }) {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [qtys,    setQtys]    = useState<Record<string, number>>(
    Object.fromEntries(supplier.products.filter(p => p.stock !== 'out').map(p => [p.id, 1])),
  )
  const [sent,    setSent]    = useState(false)
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState('')

  const activeProducts = supplier.products.filter(p => p.stock !== 'out')
  const total          = activeProducts.reduce((s, p) => s + p.price * (qtys[p.id] ?? 0), 0)

  async function sendOrder() {
    setSending(true); setError('')
    const items = activeProducts
      .filter(p => (qtys[p.id] ?? 0) > 0)
      .map(p => ({ name: p.name, quantity: qtys[p.id] ?? 0, unit: p.unit, price: p.price }))

    if (!items.length) { setError(t('suppliers.noneSelected')); setSending(false); return }

    try {
      const r = await fetch('/api/suppliers/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ supplierId: supplier.id, items, total }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? 'Erreur') }
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('suppliers.sendError'))
    }
    setSending(false)
  }

  if (sent) {
    return (
      <section className="op-sup">
        <div className="op-card sup-confirm">
          <div className="ico"><span className="ms" aria-hidden="true">check_circle</span></div>
          <h2>{t('suppliers.orderConfirmed')}</h2>
          <p>
            {supplier.email ? t('suppliers.emailSent') : t('suppliers.orderSaved')}
            {' · '}{t('suppliers.deliveryUnder', { lead: supplier.leadTime })}
          </p>
          <p className="amt mono">{formatEuros(total, locale)}</p>
          <Link href="/stocks" className="op-btn-primary">
            <span className="ms" aria-hidden="true">inventory_2</span>{t('suppliers.backToStocks')}
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="op-sup sup-order">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{supplier.name}</h1>
        <p className="op-dash__sub">
          {[supplier.specialty, t('suppliers.deliveryUnder', { lead: supplier.leadTime })].filter(Boolean).join(' · ')}
        </p>
      </div>

      <button type="button" className="sup-back" onClick={onBack}>
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('suppliers.otherSupplier')}
      </button>

      {activeProducts.length === 0 ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">production_quantity_limits</span>
            <b>{t('suppliers.noProducts')}</b>
          </div>
        </div>
      ) : (
        <div className="op-card sup-order__card">
          <div className="sup-order__head">{t('suppliers.purchaseOrder')}</div>
          <div className="sup-order__list">
            {activeProducts.map(p => (
              <div key={p.id} className="row">
                <div className="m">
                  <b>{p.name}</b>
                  <span>{formatEuros(p.price, locale)}/{p.unit}</span>
                </div>
                <div className="sup-stepper">
                  <button type="button" aria-label="−" onClick={() => setQtys(s => ({ ...s, [p.id]: Math.max(0, (s[p.id] ?? 0) - 1) }))}>
                    <span className="ms" aria-hidden="true">remove</span>
                  </button>
                  <span className="qty mono">{qtys[p.id] ?? 0} <span>{p.unit}</span></span>
                  <button type="button" aria-label="+" onClick={() => setQtys(s => ({ ...s, [p.id]: (s[p.id] ?? 0) + 1 }))}>
                    <span className="ms" aria-hidden="true">add</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="sup-order__foot">
            {error && (
              <div className="op-callout danger"><span className="ms" aria-hidden="true">error</span><p>{error}</p></div>
            )}
            <div className="sup-order__total">
              <span className="lbl">{t('suppliers.estTotal')}</span>
              <span className="amt mono">{formatEuros(total, locale)}</span>
            </div>
            <button type="button" className="op-btn-primary" onClick={sendOrder} disabled={sending || total === 0}>
              {sending
                ? <><span className="ms" aria-hidden="true">progress_activity</span>{t('suppliers.sending')}</>
                : <><span className="ms" aria-hidden="true">send</span>{t('suppliers.sendVia', { channel: supplier.apiEnabled ? 'API' : supplier.email ? 'Email' : 'WhatsApp' })}</>
              }
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Catalog view (compare across suppliers — legacy sendOrders preserved) ──────

function CatalogView({
  suppliers, loading, error, onBack,
}: {
  suppliers: Supplier[]
  loading:   boolean
  error:     boolean
  onBack:    () => void
}) {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [cart, setCart]       = useState<CartItem[]>([])
  const [sent, setSent]       = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr]         = useState('')

  // Group products by name across suppliers
  const productMap: Record<string, Array<{ supplier: Supplier; product: SupplierProduct }>> = {}
  for (const s of suppliers) {
    for (const p of s.products) {
      if (!productMap[p.name]) productMap[p.name] = []
      productMap[p.name].push({ supplier: s, product: p })
    }
  }

  const productNames = Object.keys(productMap).sort()

  function getSelection(name: string) {
    return cart.find(c => c.product.name === name)
  }

  function selectOffer(supplier: Supplier, product: SupplierProduct) {
    setCart(prev => {
      const filtered = prev.filter(c => c.product.name !== product.name)
      return [...filtered, { product, supplierId: supplier.id, qty: 1 }]
    })
  }

  function updateQty(name: string, delta: number) {
    setCart(prev => prev.map(c =>
      c.product.name === name
        ? { ...c, qty: Math.max(0, c.qty + delta) }
        : c,
    ).filter(c => c.qty > 0))
  }

  const total         = cart.reduce((s, c) => s + c.product.price * c.qty, 0)
  const supplierCount = new Set(cart.map(c => c.supplierId)).size

  async function sendOrders() {
    setSending(true); setErr('')
    try {
      const bySupplier: Record<string, CartItem[]> = {}
      for (const c of cart) {
        if (!bySupplier[c.supplierId]) bySupplier[c.supplierId] = []
        bySupplier[c.supplierId].push(c)
      }
      for (const [supplierId, items] of Object.entries(bySupplier)) {
        const subTotal = items.reduce((s, c) => s + c.product.price * c.qty, 0)
        await fetch('/api/suppliers/orders', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            supplierId,
            items: items.map(c => ({ name: c.product.name, quantity: c.qty, unit: c.product.unit, price: c.product.price })),
            total: subTotal,
          }),
        })
      }
      setSent(true)
    } catch {
      setErr(t('suppliers.sendError'))
    }
    setSending(false)
  }

  if (sent) {
    return (
      <section className="op-sup">
        <div className="op-card sup-confirm">
          <div className="ico"><span className="ms" aria-hidden="true">check_circle</span></div>
          <h2>{t('suppliers.ordersSent')}</h2>
          <p>{t('suppliers.ordersSentBody', { count: supplierCount })}</p>
          <p className="amt mono">{formatEuros(total, locale)}</p>
          <Link href="/stocks" className="op-btn-primary">
            <span className="ms" aria-hidden="true">inventory_2</span>{t('suppliers.backToStocks')}
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="op-sup">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('suppliers.catalogTitle')}</h1>
        <p className="op-dash__sub">{t('suppliers.catalogSub')}</p>
      </div>

      <button type="button" className="sup-back" onClick={onBack}>
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('suppliers.changeMethod')}
      </button>

      {loading ? (
        <SupSkeleton />
      ) : error ? (
        <SupError onRetry={onBack} />
      ) : productNames.length === 0 ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">inventory_2</span>
            <b>{t('suppliers.catalogEmpty')}</b>
          </div>
        </div>
      ) : (
        <div>
          {productNames.map(name => {
            const offers   = productMap[name]
            const sel      = getSelection(name)
            const inOffers = offers.filter(o => o.product.stock !== 'out')
            return (
              <div key={name} className="op-card sup-cat-group">
                <div className="sup-cat-group__head">
                  <b>{name}</b>
                  <span className="avail">{inOffers.length}/{offers.length} {t('suppliers.available')}</span>
                </div>
                <div>
                  {offers.map(({ supplier, product: p }) => {
                    const isSelected = sel?.supplierId === supplier.id && sel.product.id === p.id
                    const isOut      = p.stock === 'out'
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => !isOut && selectOffer(supplier, p)}
                        disabled={isOut}
                        className={`sup-offer${isSelected ? ' is-selected' : ''}`}
                      >
                        <span className="left">
                          <span className="radio">{isSelected && <span className="ms" aria-hidden="true">check</span>}</span>
                          <span className="who">
                            <b>{supplier.name}</b>
                            <span className="stk">
                              {p.stock === 'in'  && <><i className="in" />{t('suppliers.inStock')} · {supplier.leadTime}</>}
                              {p.stock === 'low' && <><i className="low" />{t('suppliers.lowStock')} · {supplier.leadTime}</>}
                              {p.stock === 'out' && <><span className="ms" aria-hidden="true">close</span>{t('suppliers.outStock')}</>}
                            </span>
                          </span>
                        </span>
                        <span className="price mono">{formatEuros(p.price, locale)}<small>/{p.unit}</small></span>
                      </button>
                    )
                  })}
                </div>
                {sel && sel.product.name === name && (
                  <div className="sup-cat-group__qty">
                    <span className="lbl">{t('suppliers.quantity')}</span>
                    <div className="sup-stepper">
                      <button type="button" aria-label="−" onClick={() => updateQty(name, -1)}><span className="ms" aria-hidden="true">remove</span></button>
                      <span className="qty mono">{sel.qty} <span>{sel.product.unit}</span></span>
                      <button type="button" aria-label="+" onClick={() => updateQty(name, 1)}><span className="ms" aria-hidden="true">add</span></button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {cart.length > 0 && (
        <div className="sup-cart">
          {err && (
            <div className="op-callout danger"><span className="ms" aria-hidden="true">error</span><p>{err}</p></div>
          )}
          <div className="sup-cart__row">
            <div>
              <div className="lbl">{t('suppliers.totalSuppliers', { count: supplierCount })}</div>
              <div className="amt mono">{formatEuros(total, locale)}</div>
            </div>
            <span className="cnt">{t('suppliers.productCount', { count: cart.length })}</span>
          </div>
          <button type="button" className="op-btn-primary" onClick={sendOrders} disabled={sending}>
            {sending
              ? <><span className="ms" aria-hidden="true">progress_activity</span>{t('suppliers.sending')}</>
              : <><span className="ms" aria-hidden="true">send</span>{t('suppliers.sendOrders')}</>
            }
          </button>
        </div>
      )}
    </section>
  )
}

// ── Self shopping list ────────────────────────────────────────────────────────

function SelfShoppingList({ onBack }: { onBack: () => void }) {
  const t = useTranslations('operator')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const categories: Record<string, string[]> = {
    'Frais':     ['Poulet mariné · 4 kg', 'Champignons · 2 kg'],
    'Sauce':     ['Sauce butter chicken · 3 L'],
    'Sec':       ['Riz basmati · 5 kg'],
    'Packaging': ['Boîtes kraft · 100 u'],
  }

  return (
    <section className="op-sup">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('suppliers.shoppingListTitle')}</h1>
        <p className="op-dash__sub">{t('suppliers.shoppingListSub')}</p>
      </div>

      <button type="button" className="sup-back" onClick={onBack}>
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('suppliers.changeMethod')}
      </button>

      <div>
        {Object.entries(categories).map(([cat, items]) => (
          <div key={cat} className="op-card sup-self-cat">
            <p className="cat">{cat}</p>
            <ul>
              {items.map(item => {
                const done = checked.has(item)
                return (
                  <li key={item} className={done ? 'done' : undefined} onClick={() => {
                    setChecked(prev => {
                      const next = new Set(prev)
                      if (next.has(item)) next.delete(item); else next.add(item)
                      return next
                    })
                  }}>
                    <span className="box">{done && <span className="ms" aria-hidden="true">check</span>}</span>
                    <span className="txt">{item}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="sup-self-actions">
        <button type="button" className="wa"><span className="ms" aria-hidden="true">share</span>{t('suppliers.whatsapp')}</button>
        <button type="button"><span className="ms" aria-hidden="true">print</span>{t('suppliers.print')}</button>
      </div>
      <Link href="/stocks" className="sup-self-after">
        <span className="ms" aria-hidden="true">inventory_2</span>{t('suppliers.afterShopping')}
      </Link>
    </section>
  )
}
