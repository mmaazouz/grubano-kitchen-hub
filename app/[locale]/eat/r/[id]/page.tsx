'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatCuisineList } from '@/lib/categories'
import { ArrowLeft, Heart, Share2, Clock, MapPin, Search, ShoppingBag } from 'lucide-react'
import {
  DishCard,
  Modal,
  Button,
  Badge,
  StarRating,
  CategoryPill,
  EmptyState,
  Input,
  Skeleton,
} from '@/components/design-system'
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

const TABS = ['Menu', 'À propos', 'Galerie', 'Avis'] as const
type Tab = (typeof TABS)[number]

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

const SAMPLE_REVIEWS = [
  { name: 'Marie D.', text: 'Excellent service, plats délicieux !', rating: 5, date: 'il y a 2 j' },
  { name: 'Jean-Luc M.', text: 'Livraison rapide et nourriture chaude.', rating: 4, date: 'il y a 5 j' },
  { name: 'Sophie B.', text: 'Portions généreuses et prix raisonnables.', rating: 5, date: 'il y a 1 sem' },
]

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
  const [activeTab, setActiveTab] = useState<Tab>('Menu')
  const [menuSearch, setMenuSearch] = useState('')
  const [menuFilter, setMenuFilter] = useState('Tout')
  const [fav, setFav] = useState(false)
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [modalDish, setModalDish] = useState<MenuItem | null>(null)

  const tabLabel = (tab: Tab) => {
    const map: Record<Tab, string> = {
      Menu: t('tabMenu'),
      'À propos': t('tabAbout'),
      Galerie: t('tabGallery'),
      Avis: t('tabReviews'),
    }
    return map[tab]
  }
  const categoryLabel = (cat: string) => (cat === 'Tout' ? t('categoryAll') : cat)

  useEffect(() => {
    fetch(`/api/restaurants/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setRestaurant(d.restaurant)
        // Defensive: hours{} is additive — missing/odd payload = not configured.
        setHours(d.hours && d.hours.hoursConfigured === true ? (d.hours as PublicHoursInfo) : null)
        setMenu(d.menu ?? [])
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

  function addLine(dish: MenuItem, opts?: EatCartItemOptions) {
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
      nextItems = current.items.map((l, i) => (i === existingIdx ? { ...l, qty: l.qty + 1 } : l))
    } else {
      nextItems = [
        ...current.items,
        {
          item: { id: lineId, name: displayName, price: unitPrice, photos: dish.photos ?? [] },
          qty: 1,
          options: fullOpts,
        },
      ]
    }
    const next: EatCartData = { ...current, items: nextItems }
    setCart(next)
    writeCart(next)
    showToast(t('addedToCart', { name: dish.name }))
  }

  const cartCount = cart?.items.reduce((s, l) => s + l.qty, 0) ?? 0
  const cartTotal = cart?.items.reduce((s, l) => s + l.item.price * l.qty, 0) ?? 0

  // ── filtered menu items for current Menu tab state
  const filtered = useMemo(
    () =>
      allItems
        .filter((m) => menuFilter === 'Tout' || m.category === menuFilter)
        .filter((m) => menuSearch === '' || m.name.toLowerCase().includes(menuSearch.toLowerCase())),
    [allItems, menuFilter, menuSearch],
  )

  if (loading) {
    return (
      <div className="bg-white">
        <Skeleton className="h-[280px] w-full rounded-none" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-2 gap-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[200px]" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!restaurant) {
    return (
      <EmptyState
        emoji="😕"
        title={t('restaurantNotFound')}
        action={
          <Button variant="secondary" size="sm" onClick={() => router.back()}>
            {tc('back')}
          </Button>
        }
      />
    )
  }

  const heroCover = restaurant.coverPhoto || getRestaurantCover(restaurant.id)

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
    <div className="min-h-screen bg-white pb-24">
      {/* Hero */}
      <div className="relative">
        <FoodImage name={restaurant.name} src={heroCover} className="h-[280px] w-full" glyphClassName="text-7xl" />
        <button
          onClick={() => router.back()}
          aria-label={tc('back')}
          className="absolute left-4 top-4 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white shadow-grubano-md active:scale-90"
        >
          <ArrowLeft size={18} className="text-grubano-ink" />
        </button>
        <div className="absolute right-4 top-4 flex gap-2.5">
          <button
            onClick={() => {
              const now = toggleFav(id)
              setFav(now)
              showToast(now ? t('addedToFavorites') : t('removedFromFavorites'))
            }}
            aria-label={t('favorite')}
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-full shadow-grubano-md active:scale-90 ${fav ? 'bg-grubano-danger' : 'bg-white'}`}
          >
            <Heart size={16} className={fav ? 'fill-white text-white' : 'fill-grubano-danger text-grubano-danger'} />
          </button>
          <button
            aria-label={t('share')}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white shadow-grubano-md active:scale-90"
          >
            <Share2 size={16} className="text-grubano-ink" />
          </button>
        </div>
        {/* Thumbnail strip */}
        {allItems.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-black/35 px-4 py-2.5">
            {allItems.slice(0, 5).map((d, i) => (
              <div key={d.id} className="relative">
                <FoodImage name={d.name} src={photoFor(d)} className="h-[50px] w-[50px] rounded-[10px] border-2 border-white" glyphClassName="text-base" />
                {i === 4 && allItems.length > 5 && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/50 text-[13px] font-bold text-white">
                    +{allItems.length - 5}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky tabs */}
      <div className="sticky top-0 z-20 flex border-b border-grubano-border bg-white">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 border-b-[2.5px] py-3.5 text-grubano-sm ${
              activeTab === tab ? 'border-grubano-primary font-extrabold text-grubano-primary' : 'border-transparent font-semibold text-grubano-ink-faint'
            }`}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      {/* Info section */}
      <div className="px-4 pb-2 pt-4">
        <div className="mb-1.5 flex justify-end">
          <StarRating value={restaurant.rating} reviewCount={restaurant.reviewCount} size="sm" />
        </div>
        <h1 className="font-display text-[22px] font-extrabold text-grubano-ink">{restaurant.name}</h1>
        {/* Badge horaires — rendered ONLY when the establishment configured its
            hours (hoursConfigured=false → nothing, zero regression). */}
        {hoursBadge && (
          <div className="mb-1 mt-0.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                hoursBadge.open ? 'bg-emerald-50 text-emerald-600' : 'bg-grubano-surface-muted text-grubano-ink-muted'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${hoursBadge.open ? 'bg-emerald-500' : 'bg-grubano-ink-faint'}`} />
              {hoursBadge.label}
            </span>
            {closureLine && (
              <p className="mt-1 text-[11px] text-grubano-ink-muted">{closureLine}</p>
            )}
          </div>
        )}
        <p className="mb-1.5 text-grubano-sm text-grubano-ink-muted">
          {formatCuisineList(restaurant.cuisine, locale, '')}
        </p>
        <div className="mb-2 flex items-center gap-1">
          <MapPin size={13} className="text-grubano-ink-faint" />
          <span className="truncate text-grubano-sm text-grubano-ink-muted">
            {restaurant.address}, {restaurant.city}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1 text-xs text-grubano-ink-muted">
            <MapPin size={12} /> {restaurant.deliveryFee === 0 ? t('freeDelivery') : `${restaurant.deliveryFee.toFixed(2)} €`}
          </span>
          <span className="flex items-center gap-1 text-xs text-grubano-ink-muted">
            <Clock size={12} /> {t('minutes', { count: restaurant.deliveryTime })}
          </span>
          <button onClick={() => setActiveTab('Avis')} className="text-grubano-sm font-semibold text-grubano-primary">
            {t('tabReviews')}
          </button>
        </div>
      </div>

      {/* Menu tab */}
      {activeTab === 'Menu' && (
        <div className="px-4 pt-3">
          <p className="mb-3 text-[17px] font-extrabold text-grubano-ink">
            {t('tabMenu')} <span className="text-grubano-primary">{t('itemCount', { count: allItems.length })}</span>
          </p>

          <div className="mb-3">
            <Input
              leftIcon={<Search size={14} className="text-grubano-ink-faint" />}
              placeholder={t('searchItems')}
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
            />
          </div>

          {categories.length > 1 && (
            <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
              {categories.map((f) => (
                <CategoryPill key={f} active={menuFilter === f} onClick={() => setMenuFilter(f)}>
                  {categoryLabel(f)}
                </CategoryPill>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState compact emoji="🍽️" title={t('noItemsFound')} />
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-2">
              {filtered.map((dish) => (
                <DishCard
                  key={dish.id}
                  layout="vertical"
                  name={dish.name}
                  description={dish.description}
                  price={dish.price}
                  originalPrice={dish.comparePrice && dish.comparePrice > dish.price ? dish.comparePrice : undefined}
                  photo={photoFor(dish)}
                  popular={dish.isPopular}
                  popularLabel={tc('popular')}
                  topLabel={tc('top')}
                  soldOutLabel={tc('soldOut')}
                  quantityInCart={qtyForDish(dish.id)}
                  meta={dish.creator ? <CreatorBadge creator={dish.creator} /> : undefined}
                  onClick={() => setModalDish(dish)}
                  onAdd={() => setModalDish(dish)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* About tab */}
      {activeTab === 'À propos' && (
        <div className="p-4">
          <h2 className="mb-2.5 text-[17px] font-extrabold text-grubano-ink">{t('aboutTitle', { name: restaurant.name })}</h2>
          <p className="mb-4 text-grubano-sm leading-relaxed text-grubano-ink-muted">
            {restaurant.description || t('partnerRestaurant')}
          </p>
          <div className="space-y-3 rounded-grubano-lg bg-grubano-surface-muted p-4">
            <div className="flex items-center gap-2.5">
              <MapPin size={15} className="text-grubano-primary" />
              <span className="text-grubano-sm text-grubano-ink-muted">
                {restaurant.address}, {restaurant.city}
              </span>
            </div>
            {/* Legacy STATIC hours line ("Lun–Dim : 10h00 – 23h00") — hidden as
                soon as the establishment configured its REAL hours (the weekly
                block below is then the single source). Not configured →
                unchanged (zero regression). */}
            {!hours && (
              <div className="flex items-center gap-2.5">
                <Clock size={15} className="text-grubano-primary" />
                <span className="text-grubano-sm text-grubano-ink-muted">{t('openingHours')}</span>
              </div>
            )}
          </div>

          {/* Bloc « Horaires » — the real weekly hours, only when configured.
              Days displayed Monday→Sunday; an overnight range (close < open)
              is suffixed "(lendemain)". Not configured → block absent. */}
          {hours && hours.weeklyHours.length > 0 && (
            <div className="mt-3 rounded-grubano-lg bg-grubano-surface-muted p-4">
              <p className="mb-2.5 text-grubano-sm font-extrabold text-grubano-ink">{t('hoursWeekTitle')}</p>
              <ul className="space-y-1.5">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const day = hours.weeklyHours.find((w) => w.dayOfWeek === d)
                  const ranges = day?.ranges ?? []
                  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long' })
                    .format(new Date(Date.UTC(2024, 0, 7 + d, 12))) // 2024-01-07 = a Sunday → +d gives each weekday
                  const overnight = (open: string, close: string) => {
                    const m = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10)
                    return close !== '24:00' && m(close) < m(open)
                  }
                  return (
                    <li key={d} className="flex items-baseline justify-between gap-3 text-grubano-sm">
                      <span className="capitalize text-grubano-ink-muted">{dayName}</span>
                      <span className="text-end font-semibold text-grubano-ink">
                        {ranges.length === 0
                          ? t('hoursDayClosed')
                          : ranges.map((r, i) => (
                              <span key={i} className="block">
                                {r.open} – {r.close}
                                {overnight(r.open, r.close) ? ` (${t('hoursNextDay')})` : ''}
                              </span>
                            ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Gallery tab */}
      {activeTab === 'Galerie' && (
        <div className="grid grid-cols-3 gap-1 p-2">
          {allItems.slice(0, 9).map((d) => (
            <FoodImage key={d.id} name={d.name} src={photoFor(d)} className="aspect-square w-full rounded-grubano-sm" glyphClassName="text-2xl" />
          ))}
          {allItems.length === 0 && <EmptyState compact emoji="🖼️" title={t('gallerySoon')} className="col-span-3" />}
        </div>
      )}

      {/* Reviews tab */}
      {activeTab === 'Avis' && (
        <div className="p-4">
          <div className="mb-4 flex flex-col items-center rounded-grubano-xl bg-grubano-surface-muted py-5">
            <span className="font-display text-[48px] font-extrabold text-grubano-ink">{restaurant.rating.toFixed(1)}</span>
            <div className="my-1.5">
              <StarRating value={restaurant.rating} size="md" />
            </div>
            <span className="text-grubano-sm text-grubano-ink-muted">{t('reviewCount', { count: restaurant.reviewCount.toLocaleString('fr-FR') })}</span>
          </div>
          {SAMPLE_REVIEWS.map((r, i) => (
            <div key={i} className="mb-2.5 rounded-grubano-lg bg-grubano-surface-muted p-3.5">
              <div className="mb-2 flex items-center gap-2.5">
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-grubano-primary text-base font-bold text-white">
                  {r.name[0]}
                </div>
                <div className="flex-1">
                  <p className="text-grubano-sm font-bold text-grubano-ink">{r.name}</p>
                  <p className="text-[11px] text-grubano-ink-faint">{t(`reviewDate${i}` as 'reviewDate0')}</p>
                </div>
                <StarRating value={r.rating} size="sm" />
              </div>
              <p className="text-grubano-sm leading-5 text-grubano-ink-muted">{t(`reviewText${i}` as 'reviewText0')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-grubano-border bg-white px-4 py-3.5">
        {cartCount > 0 ? (
          <Button
            variant="primary"
            size="pill"
            fullWidth
            onClick={() => router.push('/eat/cart')}
            leftIcon={
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-grubano-primary">
                {cartCount}
              </span>
            }
            rightIcon={
              <span className="flex items-center gap-2">
                {cartTotal.toFixed(2)} € <ShoppingBag size={18} />
              </span>
            }
          >
            <span className="flex-1 text-left">{t('viewCart')}</span>
          </Button>
        ) : (
          <Button
            variant="primary"
            size="pill"
            fullWidth
            onClick={() => router.push(`/eat/r/${id}/reserver`)}
          >
            {t('reserveTable')}
          </Button>
        )}
      </div>

      {/* Customisation Modal */}
      {modalDish && (
        <DishCustomizationModal
          dish={modalDish}
          photo={photoFor(modalDish)}
          onClose={() => setModalDish(null)}
          onConfirm={(opts) => {
            addLine(modalDish, opts)
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
  onConfirm: (opts: EatCartItemOptions) => void
}

function DishCustomizationModal({ dish, photo, onClose, onConfirm }: ModalProps) {
  const t = useTranslations('eat.restaurant')
  const [size, setSize] = useState<string>('Petite')
  const [supplements, setSupplements] = useState<string[]>([])
  const [exclusions, setExclusions] = useState<string[]>([])
  const [note, setNote] = useState('')

  const sizePremium = SIZE_OPTIONS.find((s) => s.label === size)?.premium ?? 0
  const supplementsList = SUPPLEMENT_OPTIONS.filter((s) => supplements.includes(s.name))
  const supplementsTotal = supplementsList.reduce((s, x) => s + x.price, 0)
  const total = dish.price + sizePremium + supplementsTotal

  function toggle(list: string[], setList: (n: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      hideClose={false}
      title={dish.name}
      description={dish.description}
      footer={
        <Button variant="primary" size="pill" fullWidth onClick={() => onConfirm({ size, supplements: supplementsList, exclusions, note })}>
          {t('addToCartPrice', { price: total.toFixed(2) })}
        </Button>
      }
    >
      <FoodImage name={dish.name} src={photo} className="mb-4 h-40 w-full rounded-grubano-lg" glyphClassName="text-5xl" />

      <Section title={t('sectionSize')}>
        <div className="space-y-1.5">
          {SIZE_OPTIONS.map((opt) => {
            const selected = size === opt.label
            return (
              <label
                key={opt.label}
                className={`flex cursor-pointer items-center justify-between rounded-grubano-md border px-3 py-3 transition ${
                  selected ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="size"
                    value={opt.label}
                    checked={selected}
                    onChange={() => setSize(opt.label)}
                    className="h-4 w-4 accent-grubano-primary"
                  />
                  <span className="text-grubano-sm font-semibold text-grubano-ink">{opt.label}</span>
                </span>
                <span className="text-grubano-sm font-bold text-grubano-ink">
                  {opt.premium > 0 ? t('plusPrice', { price: opt.premium.toFixed(2) }) : t('included')}
                </span>
              </label>
            )
          })}
        </div>
      </Section>

      <Section title={t('sectionSupplements')}>
        <div className="space-y-1.5">
          {SUPPLEMENT_OPTIONS.map((opt) => {
            const selected = supplements.includes(opt.name)
            return (
              <label
                key={opt.name}
                className={`flex cursor-pointer items-center justify-between rounded-grubano-md border px-3 py-3 transition ${
                  selected ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(supplements, setSupplements, opt.name)}
                    className="h-4 w-4 accent-grubano-primary"
                  />
                  <span className="text-grubano-sm font-semibold text-grubano-ink">{opt.name}</span>
                </span>
                <span className="text-grubano-sm font-bold text-grubano-ink">{t('plusPrice', { price: opt.price.toFixed(2) })}</span>
              </label>
            )
          })}
        </div>
      </Section>

      <Section title={t('sectionWithout')}>
        <div className="flex flex-wrap gap-2">
          {EXCLUSION_OPTIONS.map((opt) => {
            const selected = exclusions.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(exclusions, setExclusions, opt)}
                className={`rounded-grubano-pill border px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                  selected ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-grubano-border bg-white text-grubano-ink-muted'
                }`}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title={t('sectionNote')}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={t('notePlaceholder')}
          className="w-full resize-none rounded-grubano-md border border-grubano-border bg-grubano-surface-muted p-3 text-grubano-sm text-grubano-ink placeholder:text-grubano-ink-faint focus:bg-white focus:outline-none focus:ring-2 focus:ring-grubano-primary/30"
        />
      </Section>

      <div className="mt-2 flex items-center justify-between rounded-grubano-md bg-grubano-tint p-3">
        <span className="text-grubano-sm font-semibold text-grubano-ink">{t('total')}</span>
        <span className="font-display text-[22px] font-extrabold text-grubano-primary">{total.toFixed(2)} €</span>
      </div>
      {(supplements.length > 0 || exclusions.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {supplements.map((s) => (
            <Badge key={`s-${s}`} tone="primary" size="sm">+ {s}</Badge>
          ))}
          {exclusions.map((s) => (
            <Badge key={`e-${s}`} tone="neutral" size="sm">{s}</Badge>
          ))}
        </div>
      )}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-grubano-sm font-extrabold text-grubano-ink">{title}</h3>
      {children}
    </div>
  )
}
