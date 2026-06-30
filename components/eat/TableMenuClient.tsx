'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import FoodImage from '@/components/eat/FoodImage'
import { getFoodImage, inferCategory, type FoodCategory } from '@/lib/food-images'

// ── <TableMenuClient /> — « Menu à table » (dine-in MENU, screen A) ────────────
//
// VERBATIM reproduction of the FROZEN CD ref « Order at table / dine-in ×4 »
// (Notion 38efd2c9-…-81db, SCREEN A « Menu à table »): the .tbanner + .chips +
// .ai + .mi cards + .cartbar. The CD design tokens live in the gb-foundation; the
// component CSS is scoped under `.gb-tablemenu` in menu.css. Material Symbols (no
// lucide).
//
// 🔒 MONEY-adjacent: this screen only LETS the guest browse + pick lines and submit
// them via the EXISTING POST /api/t/[tableId]/order — BYTE-IDENTICAL contract +
// error mapping (lifted from <OrderAtTable/>): 401 sign-in · walkin_no_order ·
// not_your_session · not_arrived / no_open_ticket. Adding lines ≠ a charge — there
// is NO money math here (the cart-bar total is a client preview; the SERVER re-reads
// each MenuItem price at insert time and freezes it). The Service 10 % / split /
// kitchen-status screens (B/C) are G1/G2/G3 — NOT built here. On 201 we route back
// to the bill (/t/[tableId]).
//
// DATA — real, never fabricated:
//   • .tbanner  → establishment name + table label (server props). No fabricated
//     server name (« Serveur Marco » dropped) — « Sur place · Table {n} ». LIVE OK.
//   • .chips    → real menu categories (GET /api/restaurants/[id]); a chip filters
//     the list client-side. The diet chip is INERT (« bientôt » placeholder).
//   • .ai       → INERT « bientôt » (verbatim).
//   • .mi cards → real items (name / description / price), image via the project's
//     getFoodImage helper (same as /eat/r/[id]). The .nf badge shows the item's
//     FIRST real `label` ONLY when present (no fabricated « Sans noix » claim).

interface MenuLine {
  id:          string
  name:        string
  description: string
  price:       number
  category:    string
  /** Real labels Json (e.g. ["Sans gluten"]) — drives the .nf badge (else omitted). */
  label:       string | null
  /** First real photo URL if any (else the deterministic food-image tile). */
  photo:       string | null
}

interface Props {
  tableId:           string
  restaurantId:      string
  establishmentName: string | null
  tableName:         string
}

export default function TableMenuClient({ tableId, restaurantId, establishmentName, tableName }: Props) {
  const t      = useTranslations('eat.tableMenu')
  const tTable = useTranslations('eat.table')
  const tOrder = useTranslations('premium.order')
  const locale = useLocale()
  const router = useRouter()

  const [menu,      setMenu]      = useState<MenuLine[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)   // null = all / first
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [qty,       setQty]       = useState<Record<string, number>>({})
  const [sending,   setSending]   = useState(false)
  const [error,     setError]     = useState('')

  // ── Menu fetch (public consumer endpoint, grouped by category) ────────────────
  useEffect(() => {
    if (!restaurantId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    fetch(`/api/restaurants/${restaurantId}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('load_failed')
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        // { menu: [{ category, items: [{ id, name, description, price, labels, photos }] }] }
        const groups = Array.isArray(body?.menu) ? body.menu : []
        const cats: string[] = []
        const flat: MenuLine[] = []
        for (const g of groups) {
          const cat   = typeof g?.category === 'string' ? g.category : ''
          const items = Array.isArray(g?.items) ? g.items : []
          if (cat && !cats.includes(cat)) cats.push(cat)
          for (const it of items) {
            if (it?.id && it?.name && typeof it?.price === 'number') {
              const labels = Array.isArray(it.labels) ? it.labels.filter((l: unknown) => typeof l === 'string' && l.trim()) : []
              const photos = Array.isArray(it.photos) ? it.photos.filter((p: unknown) => typeof p === 'string' && p) : []
              flat.push({
                id:          it.id,
                name:        it.name,
                description: typeof it.description === 'string' ? it.description : '',
                price:       it.price,
                category:    typeof it.category === 'string' ? it.category : cat,
                label:       labels[0] ?? null,
                photo:       photos[0] ?? null,
              })
            }
          }
        }
        setMenu(flat)
        setCategories(cats)
        setActiveCat(cats[0] ?? null)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [restaurantId])

  // ── Cart (local qty map) — byte-identical submission contract to <OrderAtTable/> ─
  const cart = useMemo(
    () => menu.filter((m) => (qty[m.id] ?? 0) > 0).map((m) => ({ ...m, quantity: qty[m.id] })),
    [menu, qty],
  )
  const cartCount = useMemo(() => cart.reduce((s, l) => s + l.quantity, 0), [cart])
  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.quantity, 0), [cart])

  function bump(id: string, delta: number) {
    setQty((prev) => {
      const next = Math.max(0, Math.min(99, (prev[id] ?? 0) + delta))
      return { ...prev, [id]: next }
    })
  }

  /** Filtered list for the active chip (client-side category filter, CD .chips). */
  const visible = useMemo(
    () => (activeCat ? menu.filter((m) => m.category === activeCat) : menu),
    [menu, activeCat],
  )

  /** Deterministic dish photo (same catalogue as /eat/r/[id]). */
  function photoFor(dish: MenuLine): string {
    if (dish.photo) return dish.photo
    const cat: FoodCategory = inferCategory(dish.category)
    return getFoodImage(cat, dish.id)
  }

  // ── Submit — EXISTING POST /api/t/[tableId]/order (byte-identical). On 201 → bill ─
  async function submit() {
    if (sending || cart.length === 0) return
    setSending(true)
    setError('')
    try {
      const r = await fetch(`/api/t/${tableId}/order`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.slice(0, 50).map((l) => ({ menuItemId: l.id, quantity: l.quantity })),
        }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        const code = body?.code as string | undefined
        if (r.status === 401)                 setError(tOrder('errAuth'))
        else if (code === 'walkin_no_order')  setError(tOrder('errWalkin'))
        else if (code === 'not_your_session') setError(tOrder('errNotYours'))
        else if (code === 'not_arrived' || code === 'no_open_ticket') setError(tOrder('errNotArrived'))
        else setError((body?.error as string) || tOrder('errGeneric'))
        return
      }
      // Order sent — back to the cumulated bill (the bill's 3s poll picks up the lines).
      router.push(`/t/${tableId}`)
    } catch {
      setError(tOrder('errGeneric'))
    } finally {
      setSending(false)
    }
  }

  const tableLabel = tableName || tTable('tableFallback')

  // ── Table banner (CD .tbanner, verbatim — real identity, no fabricated server) ──
  const Banner = () => (
    <div className="tbanner">
      <span className="ic"><span className="ms" aria-hidden="true">table_restaurant</span></span>
      <div className="m">
        <b>{establishmentName || tTable('establishmentFallback')}</b>
        <span>{t('bannerMeta', { table: tableLabel })}</span>
      </div>
      <span className="live">{tTable('live')}</span>
    </div>
  )

  return (
    <>
      <Banner />

      <div className="body nos">
        {/* chips — real categories + the INERT diet placeholder (CD .chips) */}
        {categories.length > 0 && (
          <div className="chips" role="tablist" aria-label={t('categoriesLabel')}>
            {categories.map((cat) => {
              const on = activeCat === cat
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`chip ${on ? 'on' : 'off'}`}
                  onClick={() => setActiveCat(cat)}
                >
                  {cat}
                </button>
              )
            })}
            {/* diet chip — INERT (« bientôt »), no real diet filter (verbatim placeholder) */}
            <span className="chip diet" title={t('soon')} aria-disabled="true">
              <span className="ms" aria-hidden="true">eco</span>{t('dietChip')}
            </span>
          </div>
        )}

        {/* AI inline tip — INERT « bientôt » (verbatim CD copy) */}
        <div className="ai">
          <div className="ai__in">
            <span className="ms" aria-hidden="true">auto_awesome</span>
            <p><b>{t('aiLabel')}</b> {t('aiBody')}<span className="soon">{t('soon')}</span></p>
          </div>
        </div>

        {/* menu list — real items (CD .mi cards) */}
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="tm-skel" aria-hidden="true">
              <div className="tm-skel-t">
                <span className="sk sk-line" style={{ width: '70%' }} />
                <span className="sk sk-line sm" style={{ width: '90%' }} />
                <span className="sk sk-line" style={{ width: 48 }} />
              </div>
              <span className="sk tm-skel-img" />
            </div>
          ))
        ) : loadError || !restaurantId ? (
          <div className="state">
            <span className="ms" aria-hidden="true">error</span>
            <p>{t('loadError')}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="state">
            <span className="ms" aria-hidden="true">restaurant</span>
            <p>{tOrder('menuEmpty')}</p>
          </div>
        ) : (
          visible.map((dish) => {
            const q = qty[dish.id] ?? 0
            return (
              <div key={dish.id} className="mi">
                <div className="t">
                  <b>{dish.name}</b>
                  {dish.description && <p>{dish.description}</p>}
                  <div className="pr">
                    <span className="price">{formatEuros(dish.price, locale)}</span>
                    {/* .nf badge — ONLY a REAL label (no fabricated « Sans noix » claim) */}
                    {dish.label && <span className="nf">{dish.label}</span>}
                  </div>
                </div>
                <div className="img">
                  <span className="tm-thumb">
                    <FoodImage name={dish.name} src={photoFor(dish)} className="h-full w-full" glyphClassName="text-2xl" />
                  </span>
                  {q > 0 ? (
                    <span className="step">
                      <button type="button" onClick={() => bump(dish.id, -1)} aria-label={t('decrease')}>
                        <span className="ms" aria-hidden="true">remove</span>
                      </button>
                      <b>{q}</b>
                      <button type="button" className="more" onClick={() => bump(dish.id, 1)} aria-label={t('increase')}>
                        <span className="ms" aria-hidden="true">add</span>
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="add" onClick={() => bump(dish.id, 1)} aria-label={t('add', { name: dish.name })}>
                      <span className="ms" aria-hidden="true">add</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="foot">
        {error && (
          <p className="err" role="alert">
            <span className="ms" aria-hidden="true">error</span>
            <span>{error}</span>
          </p>
        )}
        {/* cart-bar (CD .cartbar) — count + total preview; tap → POST /order → bill */}
        <button
          type="button"
          className="cartbar"
          onClick={submit}
          disabled={sending || cartCount === 0}
        >
          <span>{sending ? tOrder('submitting') : t('viewOrder', { count: cartCount })}</span>
          <b>{formatEuros(cartTotal, locale)}</b>
        </button>
      </div>
    </>
  )
}
