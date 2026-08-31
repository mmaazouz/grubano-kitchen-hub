'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros, formatAmount } from '@/lib/format-money'
import { formatDistance } from '@/lib/format'
import { formatCuisineList } from '@/lib/categories'
import { useGeolocation } from '@/lib/use-geolocation'
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
  /** Allergen labels ENTERED by the restaurateur (Json → string[]; may be absent).
   *  Normalised client-side by normalizeAllergens — displayed verbatim, never invented. */
  allergens?: string[]
  /** MenuItem.calories (Int?) — displayed ONLY when non-null (contract §10). */
  calories?: number | null
  /** MenuItem.labels (Json → string[]) — the 4 operator labels, verbatim, never translated. */
  labels?: string[]
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
  rating: number | null // V4-2 : null tant qu'aucun avis réel (l'API gate la colonne fabriquée)
  reviewCount: number
  deliveryTime: number
  minOrder: number
  deliveryFee: number
  city: string
  address: string
  /** Served by GET /api/restaurants/[id]; null on most beta restaurants. */
  lat?: number | null
  lng?: number | null
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

// Fulfilment modes. VISUAL ONLY on this page — the cart never persists a mode
// (lib/eat-cart has none); the REAL choice is made on the cart/checkout screen.
// Default = 'takeaway' (pilot = pickup-only), never a mode the server refuses.
// ⚠️ CONTRACT §3 rule 2: with delivery OFF the delivery card — and its two-wheeler
// glyph — is never rendered; the count of cards is NEVER hardcoded, it stays a
// consequence of the server gate below (V5-2).
const MODES = ['delivery', 'takeaway', 'dinein'] as const
type Mode = (typeof MODES)[number]
const MODE_ICON: Record<Mode, string> = { delivery: 'two_wheeler', takeaway: 'storefront', dinein: 'table_restaurant' }

// The 4 operator labels and their Material glyph — source of truth is the
// operator menu editor (app/[locale]/menu/page.tsx). Unknown value ⇒ neutral
// glyph: a label is NEVER invented, and its string is shown verbatim.
const LABEL_ICON: Record<string, string> = {
  Veggie: 'eco',
  Halal: 'verified',
  'Sans gluten': 'grain',
  'Épicé': 'local_fire_department',
}

// LOT 2 « carte honnête » — the hardcoded SIZE/SUPPLEMENT/EXCLUSION option lists
// (fictional, shown on EVERY dish of EVERY restaurant and actually billed) were
// REMOVED: the unit price is now exactly dish.price. Only the free-form note
// remains as a per-line customisation. signatureOf/lineKeyFor/summariseOptions
// keep their contract (EatCartItemOptions is untouched) so old cart lines that
// still carry size/supplements/exclusions render and group unchanged.

/** MenuItem.allergens arrives as raw Json — keep only non-empty strings (never invent). */
function normalizeAllergens(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
    : []
}

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

/** Great-circle distance in km. Inlined (like lib/courier-tracking.ts) to keep
 *  this consumer page free of lib/geocode, which bundles the IGN HTTP client.
 *  CONTRACT §3 rule 3: this is an AS-THE-CROW-FLIES distance — it is displayed
 *  as « à env. X km », never as a road distance and never turned into a duration. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371 // Earth radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat))
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export default function RestaurantScreen() {
  const t = useTranslations('eat.restaurant')
  const tc = useTranslations('common')
  // The small-order-fee wording belongs to the CART vocabulary and already exists
  // in all 5 locales — reused verbatim so this panel and /eat/cart say the same
  // thing about the same fee (see the note block in the cart footer below).
  const tcart = useTranslations('eat.cart')
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [hours, setHours] = useState<PublicHoursInfo | null>(null)
  const [menu, setMenu] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [menuFilter, setMenuFilter] = useState('Tout')
  // V5-2 — delivery is only OFFERED when the server says it would ACCEPT it
  // (GET /api/restaurants/[id].fulfillment.delivery, computed by the exact
  // POST /api/orders gate). Default false (pilot = pickup-only) so the chip
  // never flashes; default mode follows: 'takeaway', never a refused mode.
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  // V5-1b — the booking flow is only ENTERED when it can succeed in principle
  // (server-computed: at least one configured table). Default false: a resto
  // without tables (dark kitchen) never exposes a dead-end entry point.
  const [reservable, setReservable] = useState(false)
  const [mode, setMode] = useState<Mode>('takeaway')
  const [fav, setFav] = useState(false)
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [modalDish, setModalDish] = useState<MenuItem | null>(null)
  const [aboutOpen, setAboutOpen] = useState(true)
  // Chantier P2 — server-computed promo display data (never computed here).
  const [promotions, setPromotions] = useState<PublicPromo[]>([])
  const [itemPromo, setItemPromo] = useState<Record<string, ItemPromo>>({})
  // V1.5 small-order-fee CONFIG in cents, echoed by the SAME endpoint this page
  // already fetches (app/api/restaurants/[id]/route.ts). DISPLAY ONLY — the
  // server recomputes and applies the fee at order time. Read here so the cart
  // note can only claim « no fee » when that is actually true (see below).
  const [smallOrderCfg, setSmallOrderCfg] = useState<{ feeCents: number; thresholdCents: number } | null>(null)
  // PASSIVE read of the cached position only — this page NEVER calls request()
  // (geolocation is out of S1.1 scope): no permission prompt, no network call.
  const { coords } = useGeolocation()

  const modeLabel = (m: Mode) =>
    m === 'delivery' ? t('modeDelivery') : m === 'takeaway' ? t('modeTakeaway') : t('modeDineIn')
  const modeSub = (m: Mode) =>
    m === 'delivery' ? t('modeDeliverySub') : m === 'takeaway' ? t('modeTakeawaySub') : t('modeDineInSub')
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
        // LOT 2 — keep the per-item `allergens` the API already serves (Json →
        // string[]; tolerant of null/undefined/odd shapes, values shown verbatim).
        // S1.1 — same defensive normalisation for `labels` (identical Json shape).
        const rawMenu: MenuCategory[] = Array.isArray(d.menu) ? d.menu : []
        setMenu(rawMenu.map((c) => ({
          ...c,
          items: (Array.isArray(c.items) ? c.items : []).map((it) => ({
            ...it,
            allergens: normalizeAllergens((it as { allergens?: unknown }).allergens),
            labels: normalizeAllergens((it as { labels?: unknown }).labels),
          })),
        })))
        setPromotions(Array.isArray(d.promotions) ? d.promotions : [])
        setItemPromo(d.itemPromo && typeof d.itemPromo === 'object' ? d.itemPromo : {})
        // Defensive, same shape check as /eat/cart: an odd payload leaves the
        // config null and the panel simply says nothing about a fee.
        if (d.smallOrder && typeof d.smallOrder.feeCents === 'number' && typeof d.smallOrder.thresholdCents === 'number') {
          setSmallOrderCfg({ feeCents: d.smallOrder.feeCents, thresholdCents: d.smallOrder.thresholdCents })
        }
        // V5-2 — tolerant: absent/odd payload ⇒ delivery stays hidden (safe).
        if (d.fulfillment && d.fulfillment.delivery === true) setDeliveryAvailable(true)
        // V5-1b — tolerant: absent/odd payload ⇒ booking entry stays hidden.
        if (d.reservable === true) setReservable(true)
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

  // CONTRACT §3 rule 3 — honest distance. Rendered ONLY when BOTH the cached user
  // position and the restaurant coordinates exist; a missing coordinate makes the
  // whole item disappear (no "—", no "distance inconnue").
  const distanceLabel = useMemo(() => {
    const rLat = restaurant?.lat
    const rLng = restaurant?.lng
    if (!coords || typeof rLat !== 'number' || typeof rLng !== 'number') return null
    const km = haversineKm({ lat: coords.lat, lng: coords.lng }, { lat: rLat, lng: rLng })
    const value = formatDistance(km, locale, tc('km'))
    return value ? t('distanceApprox', { distance: value }) : null
  }, [coords, restaurant?.lat, restaurant?.lng, locale, t, tc])

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
    // LOT 2 « carte honnête » — no fictional premiums: the unit price is the
    // restaurateur's price, exactly as served by the API.
    const unitPrice = dish.price
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

  // ── §3 rule 2 — the fee note, made TRUE at render time ──────────────────────
  // POST /api/orders adds a flat small-order fee with NO fulfilment gating
  // (app/api/orders/route.ts → lib/pricing.smallOrderFeeCents) as soon as the
  // ITEMS subtotal is under the threshold, and /eat/cart bills it on the very
  // next screen. A blanket « aucun frais ajouté » here would therefore be the
  // same class of false money claim as the « 1,99 € » that §3 rule 2 deleted, so
  // below the threshold the panel shows the REAL nudge instead (same wording as
  // /eat/cart). Above it, only the verifiable half is kept: no DELIVERY fee.
  const cartTotalCents = Math.round(cartTotal * 100)
  const smallFeeApplies = !!smallOrderCfg && cartTotal > 0 && cartTotalCents < smallOrderCfg.thresholdCents
  const missingToThresholdEur = smallOrderCfg
    ? Math.max(0, smallOrderCfg.thresholdCents - cartTotalCents) / 100
    : 0

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
        <header className="hd">
          <div className="hd__in"><span className="sk" style={{ height: 22, width: 180, display: 'block' }} /></div>
        </header>
        <div className="body">
          <div className="col">
            <span className="sk" style={{ height: 230, borderRadius: 'var(--s1-r-xl)', display: 'block' }} />
            <span className="sk" style={{ height: 14, width: '45%', margin: '18px 0 0', display: 'block' }} />
            <div className="dishes" style={{ marginTop: 22 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="sk" style={{ height: 134 }} />
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
        <header className="hd">
          <div className="hd__in">
            <button type="button" className="hd__back" onClick={() => router.back()} aria-label={tc('back')}>
              <span className="ms" aria-hidden="true">arrow_back</span>
            </button>
          </div>
        </header>
        <div className="body">
          <div className="col">
            <div className="empty">
              <span className="emoji" aria-hidden="true">😕</span>
              <p>{t('restaurantNotFound')}</p>
              <button type="button" className="btn-go" onClick={() => router.back()}>{tc('back')}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

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

  // ── §12 — « Ouvert aujourd'hui · HH:MM – HH:MM ». REAL ranges only: with no
  // configured hours the whole column disappears (the fabricated « Lun–Dim :
  // 10h00 – 23h00 » fallback is gone — contract §10).
  const overnight = (open: string, close: string) => {
    const m = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10)
    return close !== '24:00' && m(close) < m(open)
  }
  const todayDow = new Date().getDay()
  // Defensive: weeklyHours is an additive API block — an odd payload must never throw.
  const weeklyHours = Array.isArray(hours?.weeklyHours) ? hours!.weeklyHours : []
  const todayRanges = weeklyHours.find((w) => w.dayOfWeek === todayDow)?.ranges ?? []
  const todayRangeText = todayRanges.map((r) => `${r.open} – ${r.close}`).join(' · ')
  const hoursNowLabel = !hoursBadge
    ? null
    : hoursBadge.open && todayRangeText
      ? t('openToday', { range: todayRangeText })
      : hoursBadge.label

  // ── §5/§12 — every value below is REAL or absent. No stock cover photo, no
  // « Restaurant partenaire Grubano. » filler description, no invented hours.
  const heroCover = restaurant.coverPhoto || null
  // Defensive: `cuisine` is a MySQL Json column — tolerate a non-array payload.
  const cuisineLabel = formatCuisineList(
    Array.isArray(restaurant.cuisine) ? restaurant.cuisine.slice(0, 1) : [], locale, '',
  )
  const description = (restaurant.description ?? '').trim()
  const addressLine = [restaurant.address, restaurant.city].filter(Boolean).join(', ')
  // « Ouvrir dans Plans » — hands the REAL address (or coordinates) to the map
  // app; the route and its duration are computed there, never here.
  const mapsDest = typeof restaurant.lat === 'number' && typeof restaurant.lng === 'number'
    ? `${restaurant.lat},${restaurant.lng}`
    : addressLine
  const mapsUrl = mapsDest ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsDest)}` : null
  const hasHours = weeklyHours.length > 0
  const hasAbout = !!description || !!addressLine || hasHours

  return (
    <div className="gb gb-resto">
      {/* ══ §4 HEADER — 60px sticky: back · name · (★ real rating) | share · fav ══ */}
      <header className="hd">
        <div className="hd__in">
          <button type="button" className="hd__back" onClick={() => router.back()} aria-label={tc('back')}>
            <span className="ms" aria-hidden="true">arrow_back</span>
          </button>
          <span className="hd__t">{restaurant.name}</span>
          {restaurant.rating != null && (
            <button type="button" className="hd__rate" onClick={goToReviews} aria-label={t('tabReviews')}>
              <span className="ms" aria-hidden="true">star</span>{restaurant.rating.toFixed(1).replace('.', locale === 'en' ? '.' : ',')}
            </button>
          )}
          <div className="hd__act">
            {/* P1 PRE-CLEAN (2026-08-29) — le bouton Partager était VISIBLE mais sans
                handler (dead control du reality check). Minimal : navigator.share si
                dispo (annulation utilisateur = silence), sinon copie du lien + toast. */}
            <button
              type="button"
              className="hd__ic"
              aria-label={t('share')}
              onClick={async () => {
                const url = window.location.href
                if (typeof navigator.share === 'function') {
                  try { await navigator.share({ title: restaurant.name, url }) } catch { /* annulé par l'utilisateur */ }
                  return
                }
                try {
                  await navigator.clipboard.writeText(url)
                  showToast(t('shareCopied'))
                } catch {
                  showToast(t('shareError'))
                }
              }}
            >
              <span className="ms" aria-hidden="true">ios_share</span>
            </button>
            <button
              type="button"
              className={`hd__ic${fav ? ' is-fav' : ''}`}
              onClick={() => {
                const now = toggleFav(id)
                setFav(now)
                showToast(now ? t('addedToFavorites') : t('removedFromFavorites'))
              }}
              aria-label={fav ? t('favoriteRemove') : t('favoriteAdd')}
              aria-pressed={fav}
            >
              <span className="ms" aria-hidden="true">{fav ? 'favorite' : 'favorite_border'}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="body">
        <div className="col">
          {/* ══ §5 HERO — real cover or neutral weave; identity over the veil.
              NO ETA, NO delivery fee, NO delivery glyph (contract §3). ══ */}
          <div className="hero">
            {heroCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="hero__img" src={heroCover} alt="" />
            ) : (
              <div className="hero__img" aria-hidden="true" />
            )}
            <div className="hero__veil" aria-hidden="true" />
            <div className="hero__id">
              <div className="hero__nm">
                <h1>{restaurant.name}</h1>
                <div className="hero__meta">
                  {cuisineLabel && (
                    <span className="it"><span className="ms" aria-hidden="true">restaurant</span>{cuisineLabel}</span>
                  )}
                  {cuisineLabel && restaurant.city && <span className="sep" aria-hidden="true" />}
                  {restaurant.city && (
                    <span className="it"><span className="ms" aria-hidden="true">place</span>{restaurant.city}</span>
                  )}
                  {distanceLabel && (cuisineLabel || restaurant.city) && <span className="sep" aria-hidden="true" />}
                  {distanceLabel && (
                    <span className="it"><span className="ms" aria-hidden="true">near_me</span>{distanceLabel}</span>
                  )}
                </div>
              </div>
              {hoursBadge && (
                <span className={`badge-open${hoursBadge.open ? '' : ' is-closed'}`}>
                  <i aria-hidden="true" />{hoursBadge.label}
                </span>
              )}
            </div>
          </div>

          {closureLine && <p className="closure">{closureLine}</p>}

          {/* promo strip — KEPT feature (real active promotions, computed server-side) */}
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

          {/* ══ §6 SERVICE MODES — 2 cards while delivery is OFF. The count is a
              CONSEQUENCE of the server gate (V5-2), never hardcoded: the delivery
              card (and its two-wheeler glyph) only exists if the server would
              accept a delivery order. ══ */}
          <div className="modes" role="group" aria-label={t('serviceModeAria')}>
            {MODES.filter((m) => m !== 'delivery' || deliveryAvailable).map((m) => (
              // V5-1b: the « Sur place » card is the entry point clients try
              // naturally — when the restaurant CAN take a reservation (has
              // tables), tapping it OPENS the real booking flow (mobile AND
              // desktop). Not reservable ⇒ plain visual toggle, no dead end.
              //
              // §6/§19 — ONE semantic per control. A card that navigates must not
              // claim to be a toggle: in the reservable case it drops
              // `aria-pressed` (which could never become `true`: the click leaves
              // the page) and takes a name that says where it goes. It keeps the
              // navigation because the cart panel's « Réserver une table » — the
              // only other entry — is `display:none` below 560px, so removing it
              // would leave mobile with no way into the booking funnel at all.
              <button
                key={m}
                type="button"
                className={`mode${mode === m ? ' is-on' : ''}`}
                aria-pressed={m === 'dinein' && reservable ? undefined : mode === m}
                aria-label={m === 'dinein' && reservable ? t('dineInReserveAria', { mode: modeLabel(m) }) : undefined}
                onClick={() =>
                  m === 'dinein' && reservable ? router.push(`/eat/r/${id}/reserver`) : setMode(m)
                }
              >
                <span className="ms" aria-hidden="true">{MODE_ICON[m]}</span>
                <span><b>{modeLabel(m)}</b><span className="mode__sub">{modeSub(m)}</span></span>
              </button>
            ))}
          </div>

          {/* ══ §7 CATEGORY NAV — sticky under the header, real categories ══ */}
          {categories.length > 1 && (
            <nav className="cats" aria-label={t('menuCategoriesAria')}>
              {categories.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`cat${menuFilter === f ? ' is-on' : ''}`}
                  onClick={() => setMenuFilter(f)}
                >
                  {categoryLabel(f)}
                </button>
              ))}
            </nav>
          )}

          {/* ══ §8 DISH CARDS — the WHOLE card opens the modal ══ */}
          {filteredSections.length === 0 ? (
            <div className="empty"><span className="emoji" aria-hidden="true">🍽️</span><p>{t('noItemsFound')}</p></div>
          ) : (
            filteredSections.map((sec) => (
              <section key={sec.category} className="catsec">
                <div className="sec-h">
                  <h2>{categoryLabel(sec.category)}</h2>
                  <span>{t('dishCount', { count: sec.items.length })}</span>
                </div>
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
                    const allergens = dish.allergens ?? []
                    const photo = dish.photos?.[0] ?? null
                    const promoPill = promo
                      ? promo.secondItemPct != null
                        ? t('promoPillSecond', { pct: promo.secondItemPct })
                        : promo.type === 'percent'
                          ? t('promoPill', { pct: promo.discount })
                          : t('promoPillFixed', { eur: promo.discount })
                      : null
                    return (
                      // §8 « toute la carte ouvre la modale » — the card is a plain
                      // <article> and the whole-card target is a STRETCHED button
                      // nested in the <h3> (see .dish__hit::after). The dish name
                      // therefore stays a real heading: a heading placed INSIDE a
                      // <button> is folded into that button's accessible name and
                      // vanishes from heading navigation (§19 reading order).
                      <article key={dish.id} className="dish">
                        <div className="dish__m">
                          <h3>
                            <button type="button" className="dish__hit" onClick={() => setModalDish(dish)}>
                              {dish.name}
                            </button>
                          </h3>
                          {/* §11 — allergen reminder, first of the two passes. Empty ⇒ absent. */}
                          {allergens.length > 0 && (
                            <span className="dish__al">
                              <span className="ms" aria-hidden="true">info</span>
                              {t('allergensOnCard', { list: allergens.join(' · ') })}
                            </span>
                          )}
                          <div className="dish__p">
                            <span className="price">{formatEuros(shownPrice, locale)}</span>
                            {wasPrice != null && <span className="price was">{formatEuros(wasPrice, locale)}</span>}
                            {promoPill && <span className="tag promo">{promoPill}</span>}
                            {/* Creator attribution (« recette signée … » → /chef/{slug}),
                                lever 4-bis A1. REAL adopted-recipe data preloaded by
                                GET /api/restaurants/[id]; absent creator ⇒ absent badge.
                                Kept ON THE CARD, not only in the modal: the modal only
                                opens once the dish is already chosen, which is after the
                                discovery this badge exists for. Declared CONTRACT §21.1. */}
                            {dish.creator && <CreatorBadge creator={dish.creator} />}
                          </div>
                        </div>
                        <div className="dish__ph">
                          {photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photo} alt="" loading="lazy" />
                          ) : (
                            <span className="fb" aria-hidden="true"><span className="ms">restaurant</span></span>
                          )}
                          {qty > 0 && <span className="dish__qty">{qty}</span>}
                          <span className="dish__add" aria-hidden="true"><span className="ms">add</span></span>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* ══ §9 CART PANEL — REAL cart (lib/eat-cart, byte-identical handlers).
            Empty ⇒ icon + title + one line + DISABLED CTA. Mobile ⇒ hidden,
            replaced by the sticky bottom bar. ══ */}
        <aside className="cart" aria-label={t('yourOrder')}>
          <div className="cart__h">
            <h2>{t('yourOrder')}</h2>
            <span className="n">{t('itemCountShort', { count: cartCount })}</span>
          </div>
          <div className="cart__mode">
            <span className="ms" aria-hidden="true">{MODE_ICON[mode]}</span>
            {t('cartModeLine', { mode: modeLabel(mode), restaurant: restaurant.name })}
          </div>
          <div className="cart__b">
            {cartCount === 0 ? (
              <div className="cart__empty">
                <span className="ms" aria-hidden="true">shopping_bag</span>
                <b>{t('cartEmpty')}</b>
                <p>{t('cartEmptyHint')}</p>
              </div>
            ) : (
              (cart?.items ?? []).map((l) => (
                <div key={l.item.id} className="ci">
                  <span className="ci__ph">
                    {l.item.photos?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.item.photos[0]} alt="" loading="lazy" />
                    ) : null}
                  </span>
                  <div className="ci__m">
                    <b>{l.item.name}</b>
                    <div className="pr">{formatEuros(l.item.price * l.qty, locale)}</div>
                    <div className="qty">
                      <button type="button" onClick={() => setLineQty(l.item.id, -1)} aria-label={t('decrease')}>
                        <span className="ms" aria-hidden="true">remove</span>
                      </button>
                      <span>{l.qty}</span>
                      <button type="button" onClick={() => setLineQty(l.item.id, 1)} aria-label={t('increase')}>
                        <span className="ms" aria-hidden="true">add</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Footer — Subtotal + CTA. The real per-order DISCOUNT (promo) is computed
              SERVER-side and shown on /eat/cart + /eat/checkout; this quick panel never
              fabricates one — and never a delivery fee (contract §3 rule 2). */}
          <div className="cart__f">
            <div className="tot"><span>{t('subtotal')}</span><span className="v">{formatEuros(cartTotal, locale)}</span></div>
            {/* §9 lists this note as a fixed part of the panel and §3 rule 2 makes
                it the standing replacement for the removed delivery fee. Two of
                the contract's literal claims are NOT true against the live server
                and are therefore not rendered (declared CONTRACT §21.2):
                  • « aucun frais ajouté » — the small-order fee is charged one tap
                    later on any basket under the threshold, ungated by mode, so
                    that clause only shows at/above the threshold;
                  • « à régler au retrait / sur place » — cash is out of the pilot
                    and refused server-side (/eat/cart hardcodes card), so no
                    payment MOMENT is claimed at all.
                Delivery is the one mode that gets NO note: with
                DELIVERY_FULFILLMENT_ENABLED on, a delivery order DOES carry a fee. */}
            {mode !== 'delivery' && (
              <div className="tot__note">
                {smallFeeApplies
                  ? tcart('smallOrderNudge', { amount: formatAmount(missingToThresholdEur, locale) })
                  : t('noDeliveryFeeNote')}
              </div>
            )}
            <button type="button" className="btn-go" disabled={cartCount === 0} onClick={() => router.push('/eat/cart')}>
              <span className="ms" aria-hidden="true">arrow_forward</span>{t('viewCart')}
            </button>
            {/* V5-1b: same operability gate as the « Sur place » card — a resto
                without tables must not expose a dead-end booking entry. This link
                and that card are the ONLY two entries to the booking funnel. */}
            {reservable && (
              <button type="button" className="cart__reserve" onClick={() => router.push(`/eat/r/${id}/reserver`)}>
                <span className="ms" aria-hidden="true">event_seat</span>{t('reserveTable')}
              </button>
            )}
          </div>
        </aside>

        {/* ══ §12 ABOUT — description / address / real opening hours. Every empty
            field removes its own block; no hours configured ⇒ no hours column
            (the fabricated « Lun–Dim : 10h00 – 23h00 » line is gone). ══ */}
        {hasAbout && (
          <section className="about">
            {/* §19 — standard disclosure: the <h2> stays a heading and CONTAINS the
                button. The reverse (heading inside the button) makes the section
                title part of the button's accessible name, and « À propos » drops
                out of the page's heading structure entirely. */}
            <h2 className="about__h">
              <button
                type="button"
                className="about__h-btn"
                aria-expanded={aboutOpen}
                onClick={() => setAboutOpen((v) => !v)}
              >
                {t('tabAbout')}
                <span className="ms" aria-hidden="true">{aboutOpen ? 'expand_less' : 'expand_more'}</span>
              </button>
            </h2>
            {aboutOpen && (
              // §10 — one block only (no hours configured, or no description and
              // no address) ⇒ ONE track: an absent field never reserves half the card.
              <div className={`about__b${hasHours && (description || addressLine) ? '' : ' is-single'}`}>
                {(description || addressLine) && (
                  <div>
                    {description && <p className="about__desc">{description}</p>}
                    {addressLine && (
                      <div className="about__addr">
                        <span className="ms" aria-hidden="true">place</span>
                        <span>{addressLine}</span>
                      </div>
                    )}
                    {mapsUrl && (
                      <a className="about__map" href={mapsUrl} target="_blank" rel="noopener noreferrer">
                        {t('openInMaps')}<span className="ms" aria-hidden="true">open_in_new</span>
                      </a>
                    )}
                  </div>
                )}
                {hasHours && (
                  <div className="hours">
                    {hoursNowLabel && (
                      <div className={`hours__now${hoursBadge?.open ? '' : ' is-closed'}`}>
                        <span className="ms" aria-hidden="true">schedule</span>{hoursNowLabel}
                      </div>
                    )}
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const day = weeklyHours.find((w) => w.dayOfWeek === d)
                      const ranges = day?.ranges ?? []
                      const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long' })
                        .format(new Date(Date.UTC(2024, 0, 7 + d, 12)))
                      return (
                        <div key={d} className={`hrow${d === todayDow ? ' today' : ''}`}>
                          <span className="d">{dayName}</span>
                          <span className="h">
                            {ranges.length === 0
                              ? t('hoursDayClosed')
                              : ranges.map((r, i) => (
                                  <span key={i}>
                                    {r.open} – {r.close}
                                    {overnight(r.open, r.close) ? ` (${t('hoursNextDay')})` : ''}
                                  </span>
                                ))}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ══ §9 MOBILE CART BAR — always present, disabled while the cart is empty.
          Sticky ABOVE the shell's fixed bottom-nav (which stays in `is-framed`). ══ */}
      <div className="mbar">
        <button type="button" className="btn-go" disabled={cartCount === 0} onClick={() => router.push('/eat/cart')}>
          <span>{cartCount === 0 ? t('cartBarEmpty') : t('viewCartCount', { count: cartCount })}</span>
          <span>{formatEuros(cartTotal, locale)}</span>
        </button>
      </div>

      {/* Dish modal — opening it adds NOTHING; closing it adds NOTHING. Only the
          footer CTA adds to the cart. */}
      {modalDish && (
        <DishDetailModal
          dish={modalDish}
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

// ── §10 Dish detail modal ────────────────────────────────────────────────────
// Imposed order: photo → name + price → description → labels → calories →
// ALLERGENS → note → stepper + CTA. Each optional block DISAPPEARS when its
// field is empty — no placeholder, no "non renseigné", no reserved space. The
// allergen block stays the most salient of the three optional blocks and never
// precedes the price.

interface ModalProps {
  dish: MenuItem
  onClose: () => void
  onConfirm: (opts: EatCartItemOptions, qty: number) => void
}

function DishDetailModal({ dish, onClose, onConfirm }: ModalProps) {
  const t = useTranslations('eat.restaurant')
  const tcr = useTranslations('eat.chefRecipe')
  const locale = useLocale()
  const router = useRouter()
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)

  // LOT 2 « carte honnête » — no fictional size/supplement premium: the total is
  // exactly the restaurateur's price × qty.
  const total = dish.price * qty
  const allergens = dish.allergens ?? []
  const labels = dish.labels ?? []
  const photo = dish.photos?.[0] ?? null
  const description = (dish.description ?? '').trim()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div className="ov" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pm" role="dialog" aria-modal="true" aria-labelledby="pm-title">
        <div className="pm__ph">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" />
          ) : null}
          <button type="button" className="pm__x" onClick={onClose} aria-label={t('close')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>
        <div className="pm__b">
          <div className="pm__t">
            <h2 id="pm-title">{dish.name}</h2>
            <span className="pr">{formatEuros(dish.price, locale)}</span>
          </div>

          {/* DESCRIPTION — display if non-empty */}
          {description && <p className="pm__desc">{description}</p>}

          {/* LABELS — display if length > 0. Operator values, shown verbatim. */}
          {labels.length > 0 && (
            <div className="pm__labels">
              {labels.map((l) => (
                <span key={l} className="pm__lab">
                  <span className="ms" aria-hidden="true">{LABEL_ICON[l] ?? 'label'}</span>{l}
                </span>
              ))}
            </div>
          )}

          {/* CALORIES — display if non-null */}
          {typeof dish.calories === 'number' && (
            <span className="pm__kcal">
              <span className="ms" aria-hidden="true">local_fire_department</span>
              {t('caloriesValue', { count: dish.calories })}
            </span>
          )}

          {/* §11 ALLERGENS — attention block, icon + text. Values entered by the
              restaurateur, shown VERBATIM (never re-accented, never completed).
              Empty list ⇒ the block disappears: no reassuring false statement. */}
          {allergens.length > 0 && (
            <div className="alg">
              <div className="alg__h"><span className="ms" aria-hidden="true">warning</span>{t('allergensTitle')}</div>
              <div className="alg__l">
                {allergens.map((a) => (
                  <span key={a} className="alg__i"><span className="ms" aria-hidden="true">check_circle</span>{a}</span>
                ))}
              </div>
              <p className="alg__n">{t('allergensNotice')}</p>
            </div>
          )}

          {/* NOTE — real, free-form; never presented as a guaranteed customisation. */}
          <div className="note-f">
            <label htmlFor="dish-note">{t('addNote')}</label>
            <textarea id="dish-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
          </div>

          {/* « Encart Recette du chef » (CD 81c4) — INERT/decorative, out of S1.1
              scope. Shown ONLY when the dish is an ADOPTED creator recipe (real
              `dish.creator`): real chef name + real verified pastille + real
              /chef/{slug} link. « Suivre » and the AI-pairings block are inert.
              §10 — this insert is NOT one of the contract's blocks, so it sits
              AFTER the imposed sequence (photo → nom+prix → description → labels
              → calories → allergènes → note), never inside it. It used to split
              allergens from the note. Declared in CONTRACT.md §21. */}
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
                {/* Inert by design (CD ref): `disabled` + the unavailability
                    reason carried by the ACCESSIBLE NAME, not only by a `title`
                    tooltip a touch user can never open. Visible label « Suivre »
                    stays inside the name (WCAG 2.5.3). */}
                <button
                  type="button"
                  className="cr__follow"
                  disabled
                  aria-disabled="true"
                  title={tcr('soon')}
                  aria-label={`${tcr('follow')} — ${tcr('soon')}`}
                >
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
        </div>
        <div className="pm__f">
          <div className="qty">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t('decrease')}>
              <span className="ms" aria-hidden="true">remove</span>
            </button>
            <span>{qty}</span>
            <button type="button" onClick={() => setQty((q) => q + 1)} aria-label={t('increase')}>
              <span className="ms" aria-hidden="true">add</span>
            </button>
          </div>
          <button type="button" className="btn-go" onClick={() => onConfirm({ note }, qty)}>
            <span>{t('addToCart')}</span><span>{formatEuros(total, locale)}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
