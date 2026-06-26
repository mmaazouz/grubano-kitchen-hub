'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatCuisineList } from '@/lib/categories'
import { formatDistance } from '@/lib/format'
import { useGeolocation } from '@/lib/use-geolocation'
import { Bell, Search, MapPin, ChevronDown, SlidersHorizontal, Navigation, X } from 'lucide-react'
import {
  RestaurantCard,
  SkeletonCard,
  EmptyState,
  Button,
} from '@/components/design-system'
import { getRestaurantCover } from '@/lib/food-images'

// Chantier P2 — the static BANNERS constant (hardcoded « jusqu'à X % » that the
// engine never honoured) IS DEAD. The single promo banner below is built from
// GET /api/eat/promos (real active promotions); zero active promo → the whole
// carousel is hidden. The home never promises what doesn't exist.
type PromoSummary = { totalPromos: number; maxPercent: number; bestFixed: number }

const CATS = [
  { name: 'Burger', nameKey: 'catBurger', emoji: '🍔', q: 'burger' },
  { name: 'Pizza', nameKey: 'catPizza', emoji: '🍕', q: 'pizza' },
  { name: 'Nouilles', nameKey: 'catNoodles', emoji: '🍜', q: 'asian' },
  { name: 'Dessert', nameKey: 'catDessert', emoji: '🧁', q: 'desserts' },
  { name: 'Salade', nameKey: 'catSalad', emoji: '🥗', q: 'healthy' },
  { name: 'Sushi', nameKey: 'catSushi', emoji: '🍣', q: 'sushi' },
]

interface Restaurant {
  id: string
  name: string
  cuisine: string[]
  rating: number
  reviewCount: number
  deliveryTime: number
  minOrder: number
  deliveryFee: number
  coverPhoto?: string
  logo?: string
  city: string
  address: string
  /** Set by /api/restaurants when lat/lng are forwarded. */
  distanceKm?: number
}

function SectionHeader({ title }: { title: string }) {
  const t = useTranslations('eat.home')
  return (
    <div className="mb-3 flex items-center justify-between px-4">
      <h2 className="font-gb-display text-[18px] font-extrabold text-gb-content">{title}</h2>
      <Link href="/eat/search" className="text-sm font-semibold text-gb-accent-strong">
        {t('seeAll')}
      </Link>
    </div>
  )
}

export default function HomeScreen() {
  const t = useTranslations('eat.home')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { coords, status, request, clear } = useGeolocation()

  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCat, setActiveCat] = useState('Burger')
  // Chantier P2 — real promo data; null until loaded (banner hidden then too).
  const [promoSummary, setPromoSummary] = useState<PromoSummary | null>(null)

  // First visit of the session → play the splash once.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('grubano_splash_seen')) {
        router.replace('/eat/splash')
      }
    } catch {
      /* ignore */
    }
  }, [router])

  // Re-fetch whenever coords change (granted / cleared).
  useEffect(() => {
    setLoading(true)
    const sp = new URLSearchParams({ take: '20' })
    if (coords) {
      sp.set('lat', String(coords.lat))
      sp.set('lng', String(coords.lng))
      // Server sorts by distance when lat/lng are present.
    } else {
      sp.set('sort', 'rating')
    }
    fetch(`/api/restaurants?${sp}`)
      .then((r) => r.json())
      .then((d) => setRestaurants(d.restaurants ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [coords])

  // Chantier P2 — fetch the REAL active-promo summary once (display only).
  useEffect(() => {
    let alive = true
    fetch('/api/eat/promos')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.totalPromos === 'number') {
          setPromoSummary({
            totalPromos: d.totalPromos,
            maxPercent:  typeof d.maxPercent === 'number' ? d.maxPercent : 0,
            bestFixed:   typeof d.bestFixed  === 'number' ? d.bestFixed  : 0,
          })
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Compose the meta line shown inside each card. When the API returned a
  // distanceKm, append it to the cuisine slot so it surfaces on every layout
  // (grid / list / hero) without needing a design-system extension.
  const cuisineWithDistance = useCallback(
    (r: Restaurant) => {
      const base = formatCuisineList(r.cuisine, locale, t('cuisineVaried'))
      if (typeof r.distanceKm === 'number') {
        return `${base} · ${formatDistance(r.distanceKm, locale, tc('km'))}`
      }
      return base
    },
    [locale, t, tc],
  )

  const geoActive = status === 'granted' && !!coords
  // When the API has location it returns nearest-first; honour that order.
  const popular = restaurants.slice(0, 8)
  // Only split into top-rated/new buckets in non-geo mode (geo mode is already
  // a meaningful "near you" ordering and we don't want to disrupt it).
  const topRated = geoActive ? [] : restaurants.filter((r) => r.rating >= 4.7)
  const others = geoActive ? [] : restaurants.filter((r) => r.rating < 4.7)
  const newRestaurants = (others.length ? others : restaurants).slice(0, 4)

  const popularTitle = geoActive ? t('nearYou') : t('popular')

  return (
    <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-gb-full bg-gb-zest-50 text-lg">
            🧑‍🍳
          </div>
          <div>
            <p className="text-[11px] text-gb-content-muted">{t('location')}</p>
            <div className="flex items-center gap-1">
              <MapPin size={13} className="text-gb-accent" />
              <span className="text-sm font-bold text-gb-content">
                {geoActive ? t('myPosition') : 'Paris, France'}
              </span>
              <ChevronDown size={13} className="text-gb-accent" />
            </div>
          </div>
        </div>
        <Link
          href="/eat/account"
          className="relative flex h-11 w-11 items-center justify-center rounded-gb-full border-[1.5px] border-gb-stroke bg-gb-surface-elevated"
          aria-label={t('notifications')}
        >
          <Bell size={22} strokeWidth={1.8} className="text-gb-content" />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-gb-full bg-gb-accent" />
        </Link>
      </div>

      {/* Search row */}
      <div className="mb-3 flex items-center gap-2.5 px-4 lg:max-w-3xl">
        <button
          onClick={() => router.push('/eat/search')}
          className="flex flex-1 items-center gap-2 rounded-gb-lg border border-gb-stroke bg-gb-surface-elevated px-3.5 py-3.5 text-left shadow-gb-sm transition active:scale-[0.99]"
        >
          <Search size={17} className="text-gb-content-muted" />
          <span className="text-sm text-gb-content-muted">{t('searchPlaceholder')}</span>
        </button>
        <Button
          variant="primary"
          size="md"
          onClick={() => router.push('/eat/search')}
          aria-label={t('filters')}
          className="h-12 w-12 px-0"
        >
          <SlidersHorizontal size={18} />
        </Button>
      </div>

      {/* Geolocation opt-in banner */}
      {!geoActive ? (
        <div className="mx-4 mb-5 flex items-center gap-3 rounded-gb-lg border border-gb-stroke bg-gb-zest-50 px-3.5 py-3">
          <Navigation size={18} className="shrink-0 text-gb-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gb-content">{t('geoBannerTitle')}</p>
            <p className="text-[11px] text-gb-content-muted">
              {status === 'denied'
                ? t('geoBannerDenied')
                : status === 'unavailable'
                  ? t('geoBannerUnavailable')
                  : t('geoBannerSubtitle')}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={request}
            loading={status === 'requesting'}
            disabled={status === 'unavailable'}
          >
            {t('geoEnable')}
          </Button>
        </div>
      ) : (
        <div className="mx-4 mb-5 flex items-center gap-2 rounded-gb-full bg-gb-success-soft px-3 py-1.5 text-xs font-medium text-gb-content-muted">
          <Navigation size={13} className="text-gb-success" />
          <span className="flex-1">{t('geoActive')}</span>
          <button
            onClick={clear}
            aria-label={t('geoDisable')}
            className="rounded-gb-full p-0.5 text-gb-content-muted hover:text-gb-content"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Offres Exclusives — ONE REAL banner from active promotions (P2).
          Zero active promo → the section is entirely hidden: the home never
          promises what doesn't exist. */}
      {promoSummary && promoSummary.totalPromos > 0 && (
        <>
          <SectionHeader title={t('exclusiveOffers')} />
          <div className="mb-5 px-4">
            <div className="relative flex h-[188px] w-full overflow-hidden rounded-gb-xl bg-gb-sunrise text-white lg:h-[228px]">
              {/* Text-zone scrim — covers the WHOLE copy column (left ~72%) so white
                  text keeps ≥4.5:1 across its full width on the Sunrise gradient (DS
                  reserves the bare gradient for big decorative titles; here it carries
                  copy). The right ~28% (decorative tile) stays full-vibrancy sunrise. */}
              <div aria-hidden className="absolute inset-y-0 left-0 right-[28%] bg-gradient-to-r from-black/60 via-black/50 to-black/40" />
              <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2 p-4">
                <span className="self-start rounded-gb-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-gb-accent-strong">
                  {t('bannerRealTag')}
                </span>
                <p className="line-clamp-2 text-[17px] font-extrabold leading-tight">
                  {t('bannerRealTitle', { count: promoSummary.totalPromos })}
                </p>
                {promoSummary.maxPercent > 0 ? (
                  <div className="flex items-end gap-1">
                    <span className="text-xs font-medium text-white">{t('upTo')}</span>
                    <span className="text-[36px] font-black leading-none">−{promoSummary.maxPercent}</span>
                    <span className="mb-0.5 text-base font-bold">%</span>
                  </div>
                ) : (
                  <div className="flex items-end gap-1">
                    <span className="text-xs font-medium text-white">{t('upTo')}</span>
                    <span className="text-[36px] font-black leading-none">−{promoSummary.bestFixed}</span>
                    <span className="mb-0.5 text-base font-bold">€</span>
                  </div>
                )}
                <button
                  onClick={() => router.push('/eat/promos')}
                  className="mt-auto self-start rounded-gb-full bg-gb-ink-800 px-4 py-2 text-[13px] font-bold text-white transition active:scale-95"
                >
                  {t('getOffer')}
                </button>
              </div>
              <div className="relative z-10 w-[34%] max-w-[150px]" aria-hidden>
                <div className="grid h-full place-items-center text-5xl">🏷️</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Categories — Claude-Design tiles: emoji in a rounded square + label below.
          Keeps the app's REAL category list (CATS) — no fabricated CD list. */}
      <SectionHeader title={t('exploreCategories')} />
      <div className="mb-5 grid grid-cols-3 gap-2.5 px-4 min-[400px]:grid-cols-6">
        {CATS.map((cat) => {
          const active = activeCat === cat.name
          return (
            <button
              key={cat.name}
              onClick={() => {
                setActiveCat(cat.name)
                router.push(`/eat/search?cuisine=${cat.q}`)
              }}
              className="flex flex-col items-center gap-1.5 transition active:scale-95"
            >
              <span className={`grid aspect-square w-full max-w-[72px] place-items-center rounded-gb-xl border text-[26px] transition-colors ${
                active
                  ? 'border-transparent bg-gb-accent-strong text-white shadow-gb-md'
                  : 'border-gb-stroke bg-gb-surface-elevated'
              }`}>
                {cat.emoji}
              </span>
              <span className={`text-[12px] font-semibold ${active ? 'text-gb-accent-strong' : 'text-gb-oat-600'}`}>
                {t(cat.nameKey)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Popular / Near you — responsive GRID (1 col → 2 → 3 on desktop), aligned
          with the Claude-Design desktop home. */}
      <SectionHeader title={popularTitle} />
      {loading ? (
        <div className="mb-5 grid grid-cols-1 gap-3 px-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : popular.length === 0 ? null : (
        <div className="mb-5 grid grid-cols-1 gap-3 px-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {popular.map((r) => (
            <RestaurantCard
              key={r.id}
              layout="grid"
              name={r.name}
              cover={r.coverPhoto || getRestaurantCover(r.id)}
              cuisine={cuisineWithDistance(r)}
              rating={r.rating}
              reviewCount={r.reviewCount}
              deliveryTime={r.deliveryTime}
              deliveryFee={r.deliveryFee}
              freeLabel={tc('free')}
              closedLabel={tc('closed')}
              onClick={() => router.push(`/eat/r/${r.id}`)}
            />
          ))}
        </div>
      )}

      {/* New restaurants — only in non-geo mode. Responsive card grid: 1 column on
          small phones, 2 columns once the column is wide enough (reflows by width). */}
      {!geoActive && (
        <>
          <SectionHeader title={t('newRestaurants')} />
          <div className="mb-5 grid grid-cols-1 gap-3 px-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              newRestaurants.map((r) => (
                <RestaurantCard
                  key={r.id}
                  layout="grid"
                  name={r.name}
                  cover={r.coverPhoto || getRestaurantCover(r.id)}
                  cuisine={cuisineWithDistance(r)}
                  rating={r.rating}
                  reviewCount={r.reviewCount}
                  deliveryTime={r.deliveryTime}
                  deliveryFee={r.deliveryFee}
                  freeLabel={tc('free')}
                  closedLabel={tc('closed')}
                  onClick={() => router.push(`/eat/r/${r.id}`)}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* Top rated — only in non-geo mode */}
      {!geoActive && topRated.length > 0 && (
        <>
          <div className="mt-5">
            <SectionHeader title={t('topRated')} />
          </div>
          <div className="grid grid-cols-1 gap-3 px-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {topRated.map((r) => (
              <RestaurantCard
                key={r.id}
                layout="grid"
                name={r.name}
                cover={r.coverPhoto || getRestaurantCover(r.id)}
                cuisine={cuisineWithDistance(r)}
                rating={r.rating}
                reviewCount={r.reviewCount}
                deliveryTime={r.deliveryTime}
                deliveryFee={r.deliveryFee}
                freeLabel={tc('free')}
                closedLabel={tc('closed')}
                ribbon={{ label: t('topBadge'), tone: 'success' }}
                onClick={() => router.push(`/eat/r/${r.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {/* In geo mode, the full "Near you" list lives below the carousel as a grid */}
      {geoActive && restaurants.length > 8 && (
        <>
          <SectionHeader title={t('moreNearYou')} />
          <div className="grid grid-cols-1 gap-3 px-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {restaurants.slice(8).map((r) => (
              <RestaurantCard
                key={r.id}
                layout="grid"
                name={r.name}
                cover={r.coverPhoto || getRestaurantCover(r.id)}
                cuisine={cuisineWithDistance(r)}
                rating={r.rating}
                reviewCount={r.reviewCount}
                deliveryTime={r.deliveryTime}
                deliveryFee={r.deliveryFee}
                freeLabel={tc('free')}
                closedLabel={tc('closed')}
                onClick={() => router.push(`/eat/r/${r.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {!loading && restaurants.length === 0 && (
        <div className="px-4">
          <EmptyState
            emoji="🍳"
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        </div>
      )}

      <div className="h-6" />
    </div>
  )
}
