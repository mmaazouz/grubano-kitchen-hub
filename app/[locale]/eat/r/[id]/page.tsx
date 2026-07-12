'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros, formatAmount } from '@/lib/format-money'
import { formatCuisineList } from '@/lib/categories'
import FoodImage from '@/components/eat/FoodImage'
import CreatorBadge from '@/components/eat/CreatorBadge'
import {
  readCart,
  writeCart,
  showToast,
  isFav,
  toggleFav,
  type EatCartData,
  type EatCartLineItem,
  type EatCartItemOptions,
} from '@/lib/eat-cart'
import { getFoodImage, getRestaurantCover, inferCategory, type FoodCategory } from '@/lib/food-images'
import './restaurant.css'
import './dish-detail.css'

interface MenuItem {
  id: string
  name: string
  description?: string
  price: number
  comparePrice?: number
  category: string
  photos: string[]
  isPopular: boolean
  /** Present only on adopted creator recipes (4-bis A) — drives the badge. */
  creator?: {
    id: string
    name: string
    verified: boolean
    followers: number
    slug: string | null
    dishPhoto: string | null
  }
}
interface MenuCategory {
  category: string
  items: MenuItem[]
}
interface RestaurantInfo {
  id: string
  name: string
  description?: string
  coverPhoto?: string
  logo?: string
  cuisine: string[]
  rating: number
  reviewCount: number
  deliveryTime: number
  minOrder: number
  deliveryFee: number
  city: string
  address: string
}

// Chantier horaires — the additive hours{} block of GET /api/restaurants/[id]
// (Agent 2's contract). hoursConfigured=false → NO badge, NO change (defensive
// degradation, zero regression). Local mirror of lib/opening-hours.PublicHours
// so this client page never imports server code.
interface PublicHoursInfo {
  hoursConfigured: boolean
  isOpenNow: boolean | null
  nextOpening: { dateStr: string; time: string; label: string } | null
  weeklyHours: Array<{ dayOfWeek: number; ranges: Array<{ open: string; close: string }> }>
  currentClosure: { reason: string | null; until: string } | null
}

// Chantier P2 — the additive promotions block of GET /api/restaurants/[id].
// DISPLAY ONLY: every figure below was computed server-side by the P1 engine
// (evaluatePromotion) — this page never computes a discount locally.
interface PublicPromo {
  id: string
  name: string
  type: string            // percent | fixed | second_item | threshold_reward
  discount: number
  minOrderEur: number | null
  itemIds: string[] | null
  channels: string[] | null
  // Promo V2 (display only).
  thresholdEur?: number | null
  rewardKind?: string | null
  rewardPct?: number | null
  endsAt?: string
}
interface ItemPromo {
  promotionId: string
  name: string
  type: string
  discount: number
  discountedUnitPrice: number
  secondItemPct?: number
}

// 3-mode fulfilment toggle (CD restaurant ref). VISUAL ONLY on this page — the
// cart never persists a fulfilment mode (lib/eat-cart has none); the REAL choice
// (delivery / pickup) is made on the cart/checkout screen. Default = Livraison.
const MODES = ['delivery', 'takeaway', 'dinein'] as const
type Mode = (typeof MODES)[number]
const MODE_ICON: Record<Mode, string> = { delivery: 'two_wheeler', takeaway: 'storefront', dinein: 'table_restaurant' }

const SIZE_OPTIONS = [
  { label: 'Petite', premium: 0 },
  { label: 'Moyenne', premium: 2 },
  { label: 'Grande', premium: 4 },
] as const

const SUPPLEMENT_OPTIONS = [
  { name: 'Fromage', price: 1 },
  { name: 'Bacon', price: 1.5 },
  { name: 'Œuf', price: 1 },
  { name: 'Champignons', price: 1 },
  { name: 'Avocat', price: 1.5 },
] as const

const EXCLUSION_OPTIONS = ['Sans oignon', 'Sans gluten', 'Sans lactose', 'Sans gras']

/** Stable signature for grouping cart lines by their customisation. */
function signatureOf(opts?: EatCartItemOptions): string {
  if (!opts) return ''
  const parts = [
    opts.size ?? '',
    (opts.supplements ?? []).map((s) => s.name).sort().join('+'),
    (opts.exclusions ?? []).slice().sort().join('+'),
    (opts.note ?? '').trim(),
  ]
  return parts.join('|')
}

function lineKeyFor(dishId: string, opts?: EatCartItemOptions): string {
  const sig = signatureOf(opts)
  return sig ? `${dishId}::${sig}` : dishId
}

/** 2-letter monogram from a chef name ("Lucia Moretti" → "LM"), for the encart
 *  avatar. Defensive: falls back to the first letter, then a chef glyph. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '👨‍🍳'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Build a short human description like "Moyenne · Fromage, Bacon · sans oignon". */
function summariseOptions(opts?: EatCartItemOptions): string | null {
  if (!opts) return null
  const bits: string[] = []
  if (opts.size) bits.push(opts.size)
  if (opts.supplements?.length) bits.push(opts.supplements.map((s) => s.name).join(', '))
  if (opts.exclusions?.length) bits.push(opts.exclusions.join(', '))
  return bits.length ? bits.join(' · ') : null
}

export default function RestaurantScreen() {
  const t = useTranslations('eat.restaurant')
  const tc = useTranslations('common')
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [hours, setHours] = useState<PublicHoursInfo | null>(null)
  const [menu, setMenu] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [menuFilter, setMenuFilter] = useState('Tout')
  const [mode, setMode] = useState<Mode>('delivery')
  const [fav, setFav] = useState(false)
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [modalDish, setModalDish] = useState<MenuItem | null>(null)
  // Chantier P2 — server-computed promo display data (never computed here).
  const [promotions, setPromotions] = useState<PublicPromo[]>([])
  const [itemPromo, setItemPromo] = useState<Record<string, ItemPromo>>({})

  const modeLabel = (m: Mode) =>
    m === 'delivery' ? t('modeDelivery') : m === 'takeaway' ? t('modeTakeaway') : t('modeDineIn')
  const categoryLabel = (cat: string) => (cat === 'Tout' ? t('categoryAll') : cat)

  // ⭐ « Avis » entry point → the full /eat/r/[id]/reviews page (next-intl router).
  const goToReviews = () => router.push(`/eat/r/${id}/reviews`)

  useEffect(() => {
    fetch(`/api/restaurants/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setRestaurant(d.restaurant)
        // Defensive: hours{} is additive — missing/odd payload = not configured.
        setHours(d.hours && d.hours.hoursConfigured === true ? (d.hours as PublicHoursInfo) : null)
        setMenu(d.menu ?? [])
        setPromotions(Array.isArray(d.promotions) ? d.promotions : [])
        setItemPromo(d.itemPromo && typeof d.itemPromo === 'object' ? d.itemPromo : {})
        const existing = readCart()
        if (existing && existing.restaurantId === id) setCart(existing)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (id) setFav(isFav(id))
  }, [id])

  const allItems = useMemo(() => menu.flatMap((c) => c.items), [menu])
  const categories = useMemo(() => ['Tout', ...menu.map((c) => c.category)], [menu])

  /** Pick a stable photo for a dish using the design-system catalogue. */
  function photoFor(dish: MenuItem): string {
    if (dish.photos?.[0]) return dish.photos[0]
    const cuisineHint = restaurant?.cuisine?.[0] ?? ''
    const cat: FoodCategory = inferCategory(dish.category || cuisineHint)
    return getFoodImage(cat, dish.id)
  }

  /** Total qty in cart for a given parent dish (across all customisations). */
  function qtyForDish(dishId: string): number {
    if (!cart) return 0
    return cart.items
      .filter((l) => (l.options?.parentDishId ?? l.item.id) === dishId)
      .reduce((s, l) => s + l.qty, 0)
  }

  function addLine(dish: MenuItem, opts?: EatCartItemOptions, qty = 1) {
    if (!restaurant) return
    const fullOpts: EatCartItemOptions | undefined = opts && (opts.size || opts.supplements?.length || opts.exclusions?.length || opts.note)
      ? { ...opts, parentDishId: dish.id }
      : undefined
    const lineId = lineKeyFor(dish.id, fullOpts)
    const sizePremium = SIZE_OPTIONS.find((s) => s.label === opts?.size)?.premium ?? 0
    const supplementsTotal = (opts?.supplements ?? []).reduce((s, x) => s + x.price, 0)
    const unitPrice = dish.price + sizePremium + supplementsTotal
    const summary = summariseOptions(fullOpts)
    const displayName = summary ? `${dish.name} (${summary})` : dish.name

    const current = cart ?? {
      restaurantId: restaurant.id,
      items: [] as EatCartLineItem[],
      restaurant: {
        name: restaurant.name,
        deliveryFee: restaurant.deliveryFee,
        minOrder: restaurant.minOrder,
        address: restaurant.address,
        city: restaurant.city,
        deliveryTime: restaurant.deliveryTime,
      },
    }

    const existingIdx = current.items.findIndex((l) => l.item.id === lineId)
    let nextItems: EatCartLineItem[]
    if (existingIdx >= 0) {
      nextItems = current.items.map((l, i) => (i === existingIdx ? { ...l, qty: l.qty + qty } : l))
    } else {
      nextItems = [
        ...current.items,
        {
          item: { id: lineId, name: displayName, price: unitPrice, photos: dish.photos ?? [] },
          qty,
          options: fullOpts,
        },
      ]
    }
    const next: EatCartData = { ...current, items: nextItems }
    setCart(next)
    writeCart(next)
    showToast(t('addedToCart', { name: dish.name }))
  }

  /** Cart-panel stepper: adjust an existing LINE's quantity (qty only — never the
   *  unit price, which is frozen at add time). delta −1 on a 1-qty line removes it.
   *  Pure quantity mutation; the unit-price + supplements math is untouched. */
  function setLineQty(lineId: string, delta: number) {
    if (!cart) return
    const nextItems = cart.items
      .map((l) => (l.item.id === lineId ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0)
    const next: EatCartData | null = nextItems.length ? { ...cart, items: nextItems } : null
    setCart(next)
    writeCart(next)
  }

  const cartCount = cart?.items.reduce((s, l) => s + l.qty, 0) ?? 0
  const cartTotal = cart?.items.reduce((s, l) => s + l.item.price * l.qty, 0) ?? 0

  // ── filtered menu items for current Menu tab state
  const filtered = useMemo(
    () => allItems.filter((m) => menuFilter === 'Tout' || m.category === menuFilter),
    [allItems, menuFilter],
  )
  // Group the filtered items back into CD-style category sections.
  const filteredSections = useMemo(() => {
    const order = menu.map((c) => c.category)
    const byCat = new Map<string, MenuItem[]>()
    for (const m of filtered) {
      const arr = byCat.get(m.category) ?? []
      arr.push(m)
      byCat.set(m.category, arr)
    }
    return order
      .filter((cat) => byCat.has(cat))
      .map((cat) => ({ category: cat, items: byCat.get(cat)! }))
  }, [filtered, menu])

  if (loading) {
    return (
      <div className="gb gb-resto" aria-busy="true">
        <div className="rmain">
          <div className="topbar"><span className="sk" style={{ height: 22, width: 180, display: 'block' }} /></div>
          <div className="content-pad">
            <span className="sk" style={{ height: 230, borderRadius: 'var(--gb-r-xl)', display: 'block' }} />
            <span className="sk" style={{ height: 14, width: '45%', margin: '18px 0 0', display: 'block' }} />
            <div className="dishes" style={{ marginTop: 22 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="sk" style={{ height: 122 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!restaurant) {
    return (
      <div className="gb gb-resto">
        <div className="rmain">
          <div className="content-pad">
            <div className="empty">
              <span className="emoji" aria-hidden="true">😕</span>
              <p>{t('restaurantNotFound')}</p>
              <button type="button" className="cc-checkout ghost" style={{ marginTop: 14, width: 'auto', display: 'inline-flex' }} onClick={() => router.back()}>
                <span>{tc('back')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const heroCover = restaurant.coverPhoto || getRestaurantCover(restaurant.id)

  // ── Chantier P2 — promo banner (GLOBAL promos only; targeted ones badge
  // their dishes instead). Display heuristic: best percent first, else best
  // fixed — the checkout server alone picks the TRUE best on the real basket.
  const globalPromos = promotions.filter((p) => !p.itemIds)
  const promoLabel = (p: PublicPromo): string => {
    if (p.type === 'second_item') return t('promoSecondItem', { pct: p.discount })
    if (p.type === 'threshold_reward') {
      const min = p.thresholdEur ?? 0
      return p.rewardKind === 'free_item'
        ? t('promoThresholdFree', { min })
        : t('promoThresholdPct', { pct: p.rewardPct ?? p.discount, min })
    }
    return p.type === 'percent'
      ? (p.minOrderEur ? t('promoPercentMin', { pct: p.discount, min: p.minOrderEur }) : t('promoPercentAll', { pct: p.discount }))
      : (p.minOrderEur ? t('promoFixedMin', { eur: p.discount, min: p.minOrderEur }) : t('promoFixedAll', { eur: p.discount }))
  }
  // Anti-gaspi flash: a promo ending within 24h shows « jusqu'à HH:MM ».
  const flashLabel = (p: PublicPromo): string | null => {
    if (!p.endsAt) return null
    const end = new Date(p.endsAt).getTime()
    if (!Number.isFinite(end) || end <= Date.now() || end - Date.now() > 86_400_000) return null
    return t('promoFlashUntil', { time: new Date(end).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })
  }
  const sortedGlobals = [...globalPromos].sort((a, b) =>
    a.type !== b.type ? (a.type === 'percent' ? -1 : 1) : b.discount - a.discount)
  const bestGlobal = sortedGlobals[0] ?? null
  const otherGlobals = sortedGlobals.slice(1)

  // ── Chantier horaires — consumer badge (only when hoursConfigured) ─────────
  // "Ouvert" / "Fermé" / "Ouvre à 19h00" — the next-opening label is composed
  // client-side from nextOpening {dateStr, time} so it localises with the app
  // (the server label is FR-only); fallback = the raw server label.
  const todayStr = new Date().toISOString().split('T')[0]
  const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().split('T')[0]
  let hoursBadge: { label: string; open: boolean } | null = null
  let closureLine: string | null = null
  if (hours) {
    if (hours.isOpenNow) {
      hoursBadge = { label: t('hoursOpenNow'), open: true }
    } else {
      const n = hours.nextOpening
      const label = !n
        ? t('hoursClosedNow')
        : n.dateStr === todayStr
          ? t('hoursOpensAt', { time: n.time })
          : n.dateStr === tomorrowStr
            ? t('hoursOpensTomorrow', { time: n.time })
            : t('hoursOpensOn', {
                date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(n.dateStr + 'T12:00:00')),
                time: n.time,
              })
      hoursBadge = { label, open: false }
      if (hours.currentClosure?.reason) {
        closureLine = t('hoursClosureReason', {
          reason: hours.currentClosure.reason,
          date:   new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date(hours.currentClosure.until + 'T12:00:00')),
        })
      }
    }
  }

  return (
    <div className="gb gb-resto">
      {/* ══ MAIN column ══ CD v2 (Notion 390fd2c9-…-6f64) — supersedes the v1
          headcard-overlap. Resto top bar + clean hero + info line + segmented modes
          + category chips + dish cards. NO Menu/À propos/Galerie/Avis tabs, NO menu
          search bar (removed per CD v2). */}
      <div className="rmain">
        {/* top bar — back · name · ★(→ reviews route) | share · ♥ (real favorite) */}
        <div className="topbar">
          <div className="tb-name">
            <button type="button" className="tb-back" onClick={() => router.back()} aria-label={tc('back')}>
              <span className="ms" aria-hidden="true">arrow_back</span>
            </button>
            <span className="tb-title">{restaurant.name}</span>
            <button type="button" className="tb-rate" onClick={goToReviews} aria-label={t('tabReviews')}>
              <span className="ms" aria-hidden="true">star</span>{restaurant.rating.toFixed(1).replace('.', locale === 'en' ? '.' : ',')}
            </button>
          </div>
          <div className="tb-actions">
            <button type="button" className="tb-btn" aria-label={t('share')}>
              <span className="ms" aria-hidden="true">ios_share</span>
            </button>
            <button
              type="button"
              className={`tb-btn${fav ? ' fav' : ''}`}
              onClick={() => {
                const now = toggleFav(id)
                setFav(now)
                showToast(now ? t('addedToFavorites') : t('removedFromFavorites'))
              }}
              aria-label={t('favorite')}
              aria-pressed={fav}
            >
              <span className="ms" aria-hidden="true">favorite</span>
            </button>
          </div>
        </div>

        <div className="content-pad">
          {/* clean hero — rectangular rounded banner, nothing overlaid (CD v2) */}
          <div className="hero">
            <FoodImage name={restaurant.name} src={heroCover} className="hero__img h-full w-full" glyphClassName="text-7xl" />
          </div>

          {/* info line — cuisine · hours · free delivery (plain text row) */}
          <div className="il">
            <span>{formatCuisineList(restaurant.cuisine, locale, '')}</span>
            {hoursBadge && (
              <span className={`ok${hoursBadge.open ? '' : ' closed'}`}>
                <span className="ms" aria-hidden="true">schedule</span>{hoursBadge.label}
              </span>
            )}
            <span className="ok">
              <span className="ms" aria-hidden="true">pedal_bike</span>
              {restaurant.deliveryFee === 0 ? t('freeDelivery') : formatEuros(restaurant.deliveryFee, locale)}
            </span>
          </div>
          {closureLine && <p className="closure">{closureLine}</p>}

          {/* promo strip — KEPT feature (real active promotions), slim single line */}
          {bestGlobal && (
            <div className="promo-strip">
              <span className="promo__main"><span className="ms" aria-hidden="true">sell</span>{promoLabel(bestGlobal)}</span>
              {flashLabel(bestGlobal) && (
                <span className="promo__flash"><span className="ms" aria-hidden="true">bolt</span>{flashLabel(bestGlobal)}</span>
              )}
              {bestGlobal.name && <span className="promo__name">{bestGlobal.name}</span>}
              {otherGlobals.length > 0 && (
                <span className="promo__more">{otherGlobals.map((p) => promoLabel(p)).join(' · ')}</span>
              )}
            </div>
          )}

          {/* 3-mode segmented control (Livraison / Click & collect / Sur place). VISUAL. */}
          <div className="modes" role="tablist" aria-label={t('fulfilmentMode')}>
            {MODES.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
                <span className="ms" aria-hidden="true">{MODE_ICON[m]}</span>{modeLabel(m)}
              </button>
            ))}
          </div>

          {/* category chips (real categories; filter the menu — replaces the old
              catnav; the removed Menu/tabs + search are gone per CD v2) */}
          {categories.length > 1 && (
            <div className="chips">
              {categories.map((f) => (
                <span
                  key={f}
                  className={`chip${menuFilter === f ? ' on' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setMenuFilter(f)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenuFilter(f) } }}
                >
                  {categoryLabel(f)}
                </span>
              ))}
            </div>
          )}

          {/* menu sections (real dishes; « + » → Détail plat modal, unchanged) */}
          {filteredSections.length === 0 ? (
            <div className="empty"><span className="emoji" aria-hidden="true">🍽️</span><p>{t('noItemsFound')}</p></div>
          ) : (
            filteredSections.map((sec) => (
              <section key={sec.category} className="catsec">
                <h2>{categoryLabel(sec.category)}</h2>
                <div className="dishes">
                  {sec.items.map((dish) => {
                    // Chantier P2 — targeted promo badge: discounted unit price
                    // was computed SERVER-side by evaluatePromotion (never locally).
                    const promo = itemPromo[dish.id]
                    const hasUnitDiscount = !!promo && promo.discountedUnitPrice < dish.price
                    const shownPrice = hasUnitDiscount ? promo!.discountedUnitPrice : dish.price
                    const wasPrice = hasUnitDiscount
                      ? dish.price
                      : dish.comparePrice && dish.comparePrice > dish.price ? dish.comparePrice : undefined
                    const qty = qtyForDish(dish.id)
                    const promoPill = promo
                      ? promo.secondItemPct != null
                        ? t('promoPillSecond', { pct: promo.secondItemPct })
                        : promo.type === 'percent'
                          ? t('promoPill', { pct: promo.discount })
                          : t('promoPillFixed', { eur: promo.discount })
                      : null
                    return (
                      <div
                        key={dish.id}
                        className="dish"
                        role="button"
                        tabIndex={0}
                        onClick={() => setModalDish(dish)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalDish(dish) } }}
                      >
                        <div className="dish__b">
                          <b>{dish.name}</b>
                          {dish.description && <p>{dish.description}</p>}
                          <div className="pr">
                            <span className="price">{formatEuros(shownPrice, locale)}</span>
                            {wasPrice != null && <span className="price was">{formatEuros(wasPrice, locale)}</span>}
                            {promoPill && <span className="tag promo">{promoPill}</span>}
                            {dish.creator && <CreatorBadge creator={dish.creator} />}
                          </div>
                        </div>
                        <div className="dish__img">
                          <div className="gb-resto-thumb">
                            <FoodImage name={dish.name} src={photoFor(dish)} className="h-full w-full" glyphClassName="text-2xl" />
                          </div>
                          {qty > 0 && <span className="dish__qty">{qty}</span>}
                          <button
                            type="button"
                            className="dish__add"
                            aria-label={t('addToCart')}
                            onClick={(e) => { e.stopPropagation(); setModalDish(dish) }}
                          >
                            <span className="ms" aria-hidden="true">add</span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))
          )}

          {/* « À propos » relocated as a COLLAPSED section (no tabs on this page).
              « Avis » → the ★ in the top bar links to the existing reviews route.
              The Gallery tab is dropped: its content was the very dish photos already
              shown in the cards above → no orphaned content. */}
          <details className="about">
            <summary>{t('tabAbout')}<span className="ms" aria-hidden="true">expand_more</span></summary>
            <div className="about__body">
              <p>{restaurant.description || t('partnerRestaurant')}</p>
              <div className="info-row">
                <span className="ms" aria-hidden="true">place</span>
                <span>{restaurant.address}, {restaurant.city}</span>
              </div>
              {!hours && (
                <div className="info-row">
                  <span className="ms" aria-hidden="true">schedule</span>
                  <span>{t('openingHours')}</span>
                </div>
              )}
              {hours && hours.weeklyHours.length > 0 && (
                <ul className="hours-list">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const day = hours.weeklyHours.find((w) => w.dayOfWeek === d)
                    const ranges = day?.ranges ?? []
                    const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long' })
                      .format(new Date(Date.UTC(2024, 0, 7 + d, 12)))
                    const overnight = (open: string, close: string) => {
                      const m = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10)
                      return close !== '24:00' && m(close) < m(open)
                    }
                    return (
                      <li key={d}>
                        <span className="day">{dayName}</span>
                        <span className="ranges">
                          {ranges.length === 0
                            ? t('hoursDayClosed')
                            : ranges.map((r, i) => (
                                <span key={i}>
                                  {r.open} – {r.close}
                                  {overnight(r.open, r.close) ? ` (${t('hoursNextDay')})` : ''}
                                </span>
                              ))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </details>
        </div>
      </div>

      {/* ══ CART column — full height, sticky, starts at top (CD v2). REAL cart
          (lib/eat-cart, byte-identical). Hidden <1080 → « view cart » bar. ══ */}
      <aside className="cartcol">
        <div className="cc-head">
          <b>{t('yourOrder')}</b>
          {cartCount > 0 && <span>{t('itemCountShort', { count: cartCount })}</span>}
        </div>
        {cartCount > 0 ? (
          <>
            <div className="cc-items">
              {(cart?.items ?? []).map((l) => (
                <div key={l.item.id} className="cc-item">
                  <span className="im">
                    <FoodImage name={l.item.name} src={l.item.photos?.[0] ?? null} className="h-full w-full" glyphClassName="text-base" />
                  </span>
                  <div className="main">
                    <b>{l.item.name}</b>
                    <span className="step">
                      <button type="button" className="ms" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => setLineQty(l.item.id, -1)} aria-label={t('decrease')}>remove</button>
                      <b>{l.qty}</b>
                      <button type="button" className="ms" style={{ background: 'none', border: 'none', padding: 0 }} onClick={() => setLineQty(l.item.id, 1)} aria-label={t('increase')}>add</button>
                    </span>
                  </div>
                  <span className="price">{formatEuros(l.item.price * l.qty, locale)}</span>
                </div>
              ))}
            </div>
            {/* Footer — Subtotal + Checkout(total). The real per-order DISCOUNT (promo)
                is computed SERVER-side and shown on /eat/cart + /eat/checkout; this
                quick panel never fabricates one. « Checkout » → the real path (/eat/cart
                → checkout), byte-identical. */}
            <div className="cc-foot">
              <div className="cc-row"><span>{t('subtotal')}</span><b>{formatEuros(cartTotal, locale)}</b></div>
              <button type="button" className="cc-checkout" onClick={() => router.push('/eat/cart')}>
                <span>{t('viewCart')}</span><b>{formatEuros(cartTotal, locale)}</b>
              </button>
            </div>
          </>
        ) : (
          <div className="cc-empty">
            <span className="emoji" aria-hidden="true">🛒</span>
            <p>{t('cartEmpty')}</p>
            <button type="button" className="cc-checkout ghost" onClick={() => router.push(`/eat/r/${id}/reserver`)}>
              <span>{t('reserveTable')}</span>
            </button>
          </div>
        )}
      </aside>

      {/* ══ Mobile « view cart » sticky bar (<1080; hidden on desktop) ══ */}
      {cartCount > 0 && (
        <button type="button" className="mcartbar" onClick={() => router.push('/eat/cart')}>
          <span className="l"><span className="ms" aria-hidden="true">shopping_bag</span>{t('viewCartCount', { count: cartCount })}</span>
          <b>{formatEuros(cartTotal, locale)}</b>
        </button>
      )}

      {/* Customisation Modal — UNCHANGED (Wave 2). « + » on a dish opens it. */}
      {modalDish && (
        <DishCustomizationModal
          dish={modalDish}
          photo={photoFor(modalDish)}
          onClose={() => setModalDish(null)}
          onConfirm={(opts, qty) => {
            addLine(modalDish, opts, qty)
            setModalDish(null)
          }}
        />
      )}

    </div>
  )
}

// ── Customisation Modal ─────────────────────────────────────────────────────

interface ModalProps {
  dish: MenuItem
  photo: string
  onClose: () => void
  onConfirm: (opts: EatCartItemOptions, qty: number) => void
}

function DishCustomizationModal({ dish, photo, onClose, onConfirm }: ModalProps) {
  const t = useTranslations('eat.restaurant')
  const tcr = useTranslations('eat.chefRecipe')
  const locale = useLocale()
  const router = useRouter()
  const [size, setSize] = useState<string>('Petite')
  const [supplements, setSupplements] = useState<string[]>([])
  const [exclusions, setExclusions] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)
  const [liked, setLiked] = useState(false)

  const sizePremium = SIZE_OPTIONS.find((s) => s.label === size)?.premium ?? 0
  const supplementsList = SUPPLEMENT_OPTIONS.filter((s) => supplements.includes(s.name))
  const supplementsTotal = supplementsList.reduce((s, x) => s + x.price, 0)
  const total = (dish.price + sizePremium + supplementsTotal) * qty

  function toggle(list: string[], setList: (n: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }
  const key = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }
  const iconBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0 }

  return (
    <div className="gb gb-dish" role="dialog" aria-modal="true" aria-label={dish.name}>
      <div className="backdrop" onClick={onClose}>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <section className="dish" onClick={(e) => e.stopPropagation()}>
          <div className="dish__hero" style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
            <button type="button" className="close" onClick={onClose} aria-label={t('close')}><span className="ms" aria-hidden="true">close</span></button>
            <button type="button" className={`fav${liked ? ' on' : ''}`} onClick={() => setLiked((v) => !v)} aria-label={t('favorite')} aria-pressed={liked}><span className="ms" aria-hidden="true">favorite</span></button>
          </div>
          <div className="dish__body">
            <h1 className="dish__title">{dish.name}</h1>
            <div className="dish__price">{t('fromPrice', { price: formatEuros(dish.price, locale) })}</div>
            {dish.description && <p className="dish__desc">{dish.description}</p>}

            {/* « Encart Recette du chef » (CD 81c4) — INERT/decorative. Shown ONLY
                when the dish is an ADOPTED creator recipe (real `dish.creator`):
                real chef name + real verified pastille + real /chef/{slug} link.
                The « Suivre » button and the IA-accords block are inert (« bientôt »);
                no fabricated quote / city / other-dishes are rendered. */}
            {dish.creator && (
              <div className="cr">
                <div className="cr__head">
                  <span className="cr__av" aria-hidden="true">
                    {initialsOf(dish.creator.name)}
                    {dish.creator.verified && (
                      <span className="cr-vrf"><span className="ms">check</span></span>
                    )}
                  </span>
                  <div className="cr__id">
                    <span className="cr-ov"><span className="ms" aria-hidden="true">restaurant_menu</span>{tcr('overline')}</span>
                    <b><bdi>{dish.creator.name}</bdi></b>
                    <span>{tcr('attribution')}</span>
                  </div>
                  <button type="button" className="cr__follow" disabled aria-disabled="true" title={tcr('soon')}>
                    {tcr('follow')}
                  </button>
                </div>
                <div className="cr__quote">
                  <span className="cr-qm" aria-hidden="true">&ldquo;</span>
                  <p>{tcr('quotePlaceholder')}</p>
                </div>
                <div className="cr__ai">
                  <span className="ms" aria-hidden="true">auto_awesome</span>
                  <span>{tcr('aiPairings')}</span>
                  <span className="cr-soon">{tcr('soon')}</span>
                </div>
                {dish.creator.slug && (
                  <div className="cr__more">
                    <div className="cr-h">
                      <b>{tcr('moreTitle')}</b>
                      <a
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/chef/${dish.creator!.slug}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/chef/${dish.creator!.slug}`) } }}
                      >
                        {tcr('seeChef')}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grp">
              <div className="grp__head"><b>{t('chooseSize')}</b><span className="grp__req required">{t('requiredTag')}</span></div>
              {SIZE_OPTIONS.map((opt) => {
                const on = size === opt.label
                return (
                  <div key={opt.label} className={`opt${on ? ' on' : ''}`} role="radio" aria-checked={on} tabIndex={0} onClick={() => setSize(opt.label)} onKeyDown={key(() => setSize(opt.label))}>
                    <span className="opt__sel"><span className="ms" aria-hidden="true">check</span></span>
                    <span className="opt__main">{opt.label}</span>
                    <span className={`opt__price${opt.premium === 0 ? ' free' : ''}`}>{opt.premium > 0 ? t('plusPrice', { price: formatAmount(opt.premium, locale) }) : t('included')}</span>
                  </div>
                )
              })}
            </div>

            <div className="grp">
              <div className="grp__head"><b>{t('addExtras')}</b><span className="grp__req optional">{t('optionalTag')}</span></div>
              {SUPPLEMENT_OPTIONS.map((opt) => {
                const on = supplements.includes(opt.name)
                return (
                  <div key={opt.name} className={`opt${on ? ' on' : ''}`} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => toggle(supplements, setSupplements, opt.name)} onKeyDown={key(() => toggle(supplements, setSupplements, opt.name))}>
                    <span className="opt__sel box"><span className="ms" aria-hidden="true">check</span></span>
                    <span className="opt__main">{opt.name}</span>
                    <span className="opt__price">{t('plusPrice', { price: formatAmount(opt.price, locale) })}</span>
                  </div>
                )
              })}
            </div>

            <div className="grp">
              <div className="grp__head"><b>{t('sectionWithout')}</b><span className="grp__req optional">{t('optionalTag')}</span></div>
              {EXCLUSION_OPTIONS.map((opt) => {
                const on = exclusions.includes(opt)
                return (
                  <div key={opt} className={`opt${on ? ' on' : ''}`} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => toggle(exclusions, setExclusions, opt)} onKeyDown={key(() => toggle(exclusions, setExclusions, opt))}>
                    <span className="opt__sel box"><span className="ms" aria-hidden="true">check</span></span>
                    <span className="opt__main">{opt}</span>
                  </div>
                )
              })}
            </div>

            <div className="note-field">
              <label htmlFor="dish-note">{t('addNote')}</label>
              <div className="note-control"><span className="ms" aria-hidden="true">edit_note</span>
                <textarea id="dish-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
              </div>
              <div className="aller-line"><span className="ms" aria-hidden="true">auto_awesome</span><span>{t('checkAllergens')}</span><span className="d-ai-soon">{t('aiSoon')}</span></div>
            </div>
          </div>
          <div className="dish__foot">
            <div className="qty">
              <button type="button" className="ms" style={iconBtn} onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t('decrease')}>remove</button>
              <b>{qty}</b>
              <button type="button" className="ms" style={iconBtn} onClick={() => setQty((q) => q + 1)} aria-label={t('increase')}>add</button>
            </div>
            <button type="button" className="add-btn" onClick={() => onConfirm({ size, supplements: supplementsList, exclusions, note }, qty)}>
              <span>{t('addToCart')}</span><b>{formatEuros(total, locale)}</b>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
