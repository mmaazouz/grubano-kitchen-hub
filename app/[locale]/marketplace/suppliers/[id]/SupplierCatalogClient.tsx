'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatMoney } from '@/lib/format-money'
import {
  readSupplyCart, writeSupplyCart, setSupplyCartOwner, clearSupplyCartOwnerIfMine, currentSupplyCartStamp,
  supplyCartIdentity, type SupplyCart,
} from '@/lib/supply-cart'
import { useSession } from 'next-auth/react'

// ── Buyer catalogue — interactive rows + sticky cart bar (flux acheteur, Lot D) ──
// CLIENT half of /marketplace/suppliers/[id]. The parent server page fetched the real
// supplier + catalogue and rendered the header; this component owns the quantity
// steppers, the (display-only) search/category filter, and the sticky progress bar
// toward the supplier's REAL minimumOrderCents. It creates NO order and moves NO
// money — « Voir le panier » just persists the chosen quantities (lib/supply-cart,
// keyed by supplier) and navigates to the cart (Lot E), which recomputes everything
// server-side. Prices are the server's priceCents, shown via formatMoney.

/** Stable identity for the fail-closed empty cart: a fresh {} per render would churn
 *  every useMemo below. Frozen, because it is shared. */
const NO_CART: SupplyCart = Object.freeze({}) as SupplyCart

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
  operatorId,
  minimumOrderCents,
  items,
}: {
  supplierId: string
  /** The buyer, resolved by the SERVER page with callerOperator(). Authoritative for the
   *  bucket; still cross-checked against the live session below, because a server-rendered
   *  prop is frozen and an identity change in another tab would leave it stale. */
  operatorId: string
  minimumOrderCents: number
  items: CatalogItem[]
}) {
  const t  = useTranslations('marketplaceCatalog')
  const ts = useTranslations('supplier')
  const locale = useLocale()
  const router = useRouter()

  const { data: session, status } = useSession()

  // RAW state — read only through the ownership gate below.
  const [cartState, setCart] = useState<SupplyCart>({})
  /** The identity the quantities were hydrated under; null until they have been. */
  const [hydratedFor, setHydratedFor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  // ── CART OWNERSHIP, EVALUATED DURING RENDER ────────────────────────────────────
  // Three things must agree before a single quantity is shown or written: the stamp the
  // state was hydrated under, the stamp the LIVE session implies (which changes in the
  // same render as the session — an effect cannot, it runs after), and the operatorId the
  // SERVER resolved for this page. Any disagreement — including a stale server prop after
  // an identity change elsewhere — means these quantities are not this buyer's.
  const liveOperatorId = (session?.user as { id?: string } | undefined)?.id ?? ''
  /** ONE definition of the gate, shared by the three marketplace screens and executed
   *  directly by the tests — see lib/supply-cart.supplyCartIdentity. */
  const { sessionStamp, identityMatchesServer } = supplyCartIdentity(status, liveOperatorId, operatorId)
  /** …and the quantities on screen were actually hydrated UNDER that identity. */
  const ownedHere = identityMatchesServer && hydratedFor === sessionStamp
  const cart = ownedHere ? cartState : NO_CART

  // Declare the owner from the SERVER-resolved id, then hydrate for it. Re-runs on an
  // identity change, so the quantities are re-read instead of being frozen at mount.
  useEffect(() => {
    if (!identityMatchesServer) {
      // UNDECLARE: the module owner is global, so leaving it on A while B holds the
      // session is the invariant broken, whatever this screen happens to render. And
      // drop the in-memory copy with it — nothing of A's is kept here, so nothing of
      // A's can be mutated here and persisted later.
      clearSupplyCartOwnerIfMine(operatorId)
      setCart({})
      setHydratedFor(null)
      return
    }
    setSupplyCartOwner(operatorId)
    setCart(readSupplyCart(supplierId))
    setHydratedFor(currentSupplyCartStamp())
  }, [identityMatchesServer, liveOperatorId, operatorId, supplierId])

  // Persist — but ONLY once the quantities on screen are this buyer's. Without the guard,
  // the initial {} of this effect removed the bucket before hydration had run (effects fire
  // in order, so the write saw the pre-hydration state), and after an identity change it
  // would have written a stale state into the new buyer's bucket.
  useEffect(() => {
    if (!ownedHere) return
    writeSupplyCart(supplierId, cartState)
  }, [ownedHere, supplierId, cartState])


  // A page rendered for one buyer, now being viewed by another: ask the SERVER to
  // re-render it for whoever is signed in. At most ONE refresh per live identity (the
  // ref is keyed by it), so this cannot loop — if the refresh does not change
  // operatorId the screen simply stays inert and nothing further is attempted. It also
  // reaches what no client guard can: this page computes its delivery-zone badge from
  // the BUYER's own restaurant cities, server-side, before the client boundary.
  const refreshedFor = useRef('')
  useEffect(() => {
    if (identityMatchesServer || status !== 'authenticated' || !liveOperatorId) return
    if (refreshedFor.current === liveOperatorId) return
    refreshedFor.current = liveOperatorId
    router.refresh()
  }, [identityMatchesServer, status, liveOperatorId, router])

  // Only available items are addable; a stored qty for a now-unavailable item is ignored.
  const availableById = useMemo(() => {
    const m = new Map<string, CatalogItem>()
    for (const it of items) if (it.available) m.set(it.id, it)
    return m
  }, [items])

  // FAIL CLOSED. The rows stay on screen under a divergent identity (at qty 0), so the
  // RENDER gate alone left the state mutable: a click by B landed in the state hydrated
  // for A and the write effect would persist it as soon as the session returned to A.
  // Gating the render is not gating the mutation.
  const setQty = (id: string, q: number) => {
    if (!ownedHere) return
    setCart((c) => {
      const next = { ...c }
      if (q > 0) next[id] = q
      else delete next[id]
      return next
    })
  }

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
    // EXPLICIT, not inherited from canProceed being false because the gated cart is
    // empty: this call WRITES, and an empty write removes the bucket.
    if (!ownedHere || !canProceed) return
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
            // Inert while the quantities are not this buyer's — reusing the EXISTING
            // disabled control, never the « rupture de stock » tag, which would be a lie
            // about why. The stepper branch is unreachable here (qty is 0 under the gate);
            // naming the condition makes that provable instead of incidental.
            const locked = !ownedHere
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
                  {out || locked ? (
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
