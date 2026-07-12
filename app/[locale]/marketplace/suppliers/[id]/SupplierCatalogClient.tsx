'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatMoney } from '@/lib/format-money'
import { readSupplyCart, writeSupplyCart, type SupplyCart } from '@/lib/supply-cart'

// ── Buyer catalogue — interactive rows + sticky cart bar (flux acheteur, Lot D) ──
// CLIENT half of /marketplace/suppliers/[id]. The parent server page fetched the real
// supplier + catalogue and rendered the header; this component owns the quantity
// steppers, the (display-only) search/category filter, and the sticky progress bar
// toward the supplier's REAL minimumOrderCents. It creates NO order and moves NO
// money — « Voir le panier » just persists the chosen quantities (lib/supply-cart,
// keyed by supplier) and navigates to the cart (Lot E), which recomputes everything
// server-side. Prices are the server's priceCents, shown via formatMoney.

interface CatalogItem {
  id: string
  name: string
  category: string
  priceCents: number
  unit: string
  packSize: string | null
  available: boolean
}

export default function SupplierCatalogClient({
  supplierId,
  minimumOrderCents,
  items,
}: {
  supplierId: string
  minimumOrderCents: number
  items: CatalogItem[]
}) {
  const t  = useTranslations('marketplaceCatalog')
  const ts = useTranslations('supplier')
  const locale = useLocale()
  const router = useRouter()

  const [cart, setCart] = useState<SupplyCart>({})
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  // Hydrate the cart from storage AFTER mount (avoids SSR/client mismatch), then
  // keep storage in sync so the cart survives navigation to the cart screen.
  useEffect(() => { setCart(readSupplyCart(supplierId)) }, [supplierId])
  useEffect(() => { writeSupplyCart(supplierId, cart) }, [supplierId, cart])

  // Only available items are addable; a stored qty for a now-unavailable item is ignored.
  const availableById = useMemo(() => {
    const m = new Map<string, CatalogItem>()
    for (const it of items) if (it.available) m.set(it.id, it)
    return m
  }, [items])

  const setQty = (id: string, q: number) =>
    setCart((c) => {
      const next = { ...c }
      if (q > 0) next[id] = q
      else delete next[id]
      return next
    })

  const unitLabel = (unit: string) => {
    const k = `u${unit.charAt(0).toUpperCase()}${unit.slice(1)}`
    const label = ts(k as 'uKg')
    return label === k ? unit : label
  }
  const catLabel = (cat: string) => {
    const k = `cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}`
    const label = ts(k as 'catFresh')
    return label === k ? cat : label
  }

  // Distinct catalogue categories (real) for the filter chips.
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const it of items) if (!seen.includes(it.category)) seen.push(it.category)
    return seen
  }, [items])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      const matchesCat = catFilter === 'all' || it.category === catFilter
      const matchesQ = !q || it.name.toLowerCase().includes(q)
      return matchesCat && matchesQ
    })
  }, [items, search, catFilter])

  // Cart total (CENTS) — only counts available items at their server price.
  const totalCents = useMemo(() => {
    let sum = 0
    for (const [id, q] of Object.entries(cart)) {
      const it = availableById.get(id)
      if (it && q > 0) sum += it.priceCents * q
    }
    return sum
  }, [cart, availableById])
  const count = useMemo(() => Object.values(cart).reduce((s, q) => s + (q > 0 ? q : 0), 0), [cart])

  const hasMin = minimumOrderCents > 0
  const shortfallCents = Math.max(minimumOrderCents - totalCents, 0)
  const reachedMin = !hasMin || totalCents >= minimumOrderCents
  const canProceed = count > 0 && reachedMin
  const pct = hasMin ? Math.min(100, Math.round((totalCents / minimumOrderCents) * 100)) : totalCents > 0 ? 100 : 0

  function goToCart() {
    if (!canProceed) return
    writeSupplyCart(supplierId, cart)
    router.push(`/marketplace/suppliers/${supplierId}/panier`)
  }

  return (
    <>
      {/* Toolbar — product search (client-side filter) */}
      <div className="sd-toolbar">
        <div className="mk-search">
          <span className="ms" aria-hidden="true">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
          />
        </div>
      </div>

      {/* Category filter chips (real categories) */}
      {categories.length > 0 && (
        <div className="sd-chips">
          <button type="button" className={`mk-chip${catFilter === 'all' ? ' is-active' : ''}`} onClick={() => setCatFilter('all')}>
            {t('filterAll')}
          </button>
          {categories.map((c) => (
            <button key={c} type="button" className={`mk-chip${catFilter === c ? ' is-active' : ''}`} onClick={() => setCatFilter(c)}>
              {catLabel(c)}
            </button>
          ))}
        </div>
      )}

      {/* Catalogue rows */}
      <div className="op-card cat-list">
        {visibleItems.length === 0 ? (
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">search_off</span>
            <b>{t('noMatchTitle')}</b>
          </div>
        ) : (
          visibleItems.map((it) => {
            const qty = cart[it.id] ?? 0
            const out = !it.available
            return (
              <div key={it.id} className={`cat-row${out ? ' is-out' : ''}${qty > 0 ? ' has-qty' : ''}`}>
                <span className="cat-thumb"><span className="ms" aria-hidden="true">nutrition</span></span>
                <div className="cat-m">
                  <b>{it.name}</b>
                  <div className="pack">{it.packSize || unitLabel(it.unit)}</div>
                  {out && (
                    <span className="cat-out-tag"><span className="ms" aria-hidden="true">block</span>{t('outOfStock')}</span>
                  )}
                </div>
                <div className="cat-price">{formatMoney(it.priceCents, locale)}<small>{unitLabel(it.unit)}</small></div>
                <div className="cat-ctrl">
                  {out ? (
                    <button type="button" className="cat-add is-disabled" disabled aria-label={t('addLabel')}>
                      <span className="ms" aria-hidden="true">add</span>
                    </button>
                  ) : qty > 0 ? (
                    <div className="stepper">
                      <button type="button" aria-label={t('decLabel')} onClick={() => setQty(it.id, qty - 1)}><span className="ms" aria-hidden="true">remove</span></button>
                      <span className="q mono">{qty}</span>
                      <button type="button" aria-label={t('incLabel')} onClick={() => setQty(it.id, qty + 1)}><span className="ms" aria-hidden="true">add</span></button>
                    </div>
                  ) : (
                    <button type="button" className="cat-add" aria-label={t('addLabel')} onClick={() => setQty(it.id, 1)}>
                      <span className="ms" aria-hidden="true">add</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Sticky cart bar — progress toward the REAL minimum */}
      <div className="sd-cartbar">
        <div className="sd-cartbar__prog">
          <div className="sd-cartbar__line">
            <span className="tot mono">{formatMoney(totalCents, locale)}</span>
            {reachedMin && count > 0 ? (
              <span className="ok"><span className="ms" aria-hidden="true">check_circle</span>{hasMin ? t('minReached') : t('cartReady')}</span>
            ) : hasMin ? (
              <span className="lbl">{t('shortfallLead')} <b className="mono">{formatMoney(shortfallCents, locale)}</b> {t('shortfallTail')}</span>
            ) : (
              <span className="lbl">{t('cartAdd')}</span>
            )}
          </div>
          {hasMin && (
            <div className={`sd-track${reachedMin ? ' is-full' : ''}`}><i style={{ width: `${pct}%` }} /></div>
          )}
        </div>
        <div className="sd-cartbar__cta">
          <button type="button" className="op-btn-primary" disabled={!canProceed} onClick={goToCart}>
            <span className="ms" aria-hidden="true">shopping_cart</span>{t('viewCart')}
          </button>
        </div>
      </div>
    </>
  )
}
