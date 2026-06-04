'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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

const BANNERS = [
  { id: '1', tagKey: 'bannerWeekendTag', titleKey: 'bannerWeekendTitle', discount: '30' },
  { id: '2', tagKey: 'bannerNewTag', titleKey: 'bannerNewTitle', discount: '20' },
  { id: '3', tagKey: 'bannerFreeTag', titleKey: 'bannerFreeTitle', discount: '15' },
]

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
      <h2 className="font-display text-[18px] font-extrabold text-grubano-ink">{title}</h2>
      <Link href="/eat/search" className="text-grubano-sm font-semibold text-grubano-primary">
        {t('seeAll')}
      </Link>
    </div>
  )
}

export default function HomeClient() {
  const t = useTranslations('eat.home')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { coords, status, request, clear } = useGeolocation()

  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBanner, setActiveBanner] = useState(0)
  const [activeCat, setActiveCat] = useState('Burger')
  const bannerRef = useRef<HTMLDivElement>(null)

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

  function onBannerScroll() {
    const el = bannerRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / (el.clientWidth - 20))
    setActiveBanner(Math.min(BANNERS.length - 1, Math.max(0, idx)))
  }

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
    <div className="bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-grubano-tint text-lg">
            🧑‍🍳
          </div>
          <div>
            <p className="text-[11px] text-grubano-ink-faint">{t('location')}</p>
            <div className="flex items-center gap-1">
              <MapPin size={13} className="text-grubano-primary" />
              <span className="text-grubano-sm font-bold text-grubano-ink">
                {geoActive ? t('myPosition') : 'Paris, France'}
              </span>
              <ChevronDown size={13} className="text-grubano-primary" />
            </div>
          </div>
        </div>
        <Link
          href="/eat/account"
          className="relative flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-grubano-border"
          aria-label={t('notifications')}
        >
          <Bell size={22} strokeWidth={1.8} className="text-grubano-ink" />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-grubano-primary" />
        </Link>
      </div>

      {/* Search row */}
      <div className="mb-3 flex items-center gap-2.5 px-4">
        <button
          onClick={() => router.push('/eat/search')}
          className="flex flex-1 items-center gap-2 rounded-grubano-lg bg-grubano-surface-muted px-3.5 py-3.5 text-left transition active:scale-[0.99]"
        >
          <Search size={17} className="text-grubano-ink-faint" />
          <span className="text-grubano-sm text-grubano-ink-faint">{t('searchPlaceholder')}</span>
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
        <div className="mx-4 mb-5 flex items-center gap-3 rounded-grubano-lg border border-grubano-border bg-grubano-tint px-3.5 py-3">
          <Navigation size={18} className="shrink-0 text-grubano-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-grubano-sm font-semibold text-grubano-ink">{t('geoBannerTitle')}</p>
            <p className="text-[11px] text-grubano-ink-muted">
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
        <div className="mx-4 mb-5 flex items-center gap-2 rounded-grubano-pill bg-grubano-success-tint px-3 py-1.5 text-xs font-medium text-grubano-ink-muted">
          <Navigation size={13} className="text-grubano-success" />
          <span className="flex-1">{t('geoActive')}</span>
          <button
            onClick={clear}
            aria-label={t('geoDisable')}
            className="rounded-full p-0.5 text-grubano-ink-faint hover:text-grubano-ink"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Offres Exclusives */}
      <SectionHeader title={t('exclusiveOffers')} />
      <div
        ref={bannerRef}
        onScroll={onBannerScroll}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2.5"
      >
        {BANNERS.map((b) => (
          <div
            key={b.id}
            className="relative flex h-[188px] w-[calc(100%-32px)] shrink-0 snap-start overflow-hidden rounded-grubano-xl bg-grubano-primary text-white"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
              <span className="self-start rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold">
                {t(b.tagKey)}
              </span>
              <p className="line-clamp-2 text-[17px] font-extrabold leading-tight">{t(b.titleKey)}</p>
              <div className="flex items-end gap-1">
                <span className="text-xs text-white/90">{t('upTo')}</span>
                <span className="text-[36px] font-black leading-none">{b.discount}</span>
                <span className="mb-0.5 text-base font-bold">%</span>
              </div>
              <button
                onClick={() => router.push('/eat/promos')}
                className="mt-auto self-start rounded-full bg-grubano-dark px-4 py-2 text-[13px] font-bold text-white transition active:scale-95"
              >
                {t('getOffer')}
              </button>
            </div>
            <div className="w-[140px] bg-white/10" aria-hidden>
              <div className="grid h-full place-items-center text-5xl">🍔</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mb-5 mt-1 flex justify-center gap-1.5">
        {BANNERS.map((_, i) => (
          <span
            key={i}
            className={`h-2 rounded-full transition-all ${activeBanner === i ? 'w-[22px] bg-grubano-primary' : 'w-2 bg-grubano-border-strong'}`}
          />
        ))}
      </div>

      {/* Categories */}
      <SectionHeader title={t('exploreCategories')} />
      <div className="no-scrollbar mb-5 flex gap-2.5 overflow-x-auto px-4">
        {CATS.map((cat) => {
          const active = activeCat === cat.name
          return (
            <button
              key={cat.name}
              onClick={() => {
                setActiveCat(cat.name)
                router.push(`/eat/search?cuisine=${cat.q}`)
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-grubano-pill border-[1.5px] px-4 py-2.5 transition active:scale-95 ${
                active ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-transparent bg-grubano-surface-muted text-grubano-ink-muted'
              }`}
            >
              <span className="text-base">{cat.emoji}</span>
              <span className="text-grubano-sm font-semibold">{t(cat.nameKey)}</span>
            </button>
          )
        })}
      </div>

      {/* Popular / Near you */}
      <SectionHeader title={popularTitle} />
      {loading ? (
        <div className="no-scrollbar mb-5 flex gap-3 overflow-x-auto px-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-[210px] shrink-0">
              <SkeletonCard />
            </div>
          ))}
        </div>
      ) : popular.length === 0 ? null : (
        <div className="no-scrollbar mb-5 flex gap-3 overflow-x-auto px-4 pb-1">
          {popular.map((r) => (
            <div key={r.id} className="w-[210px] shrink-0">
              <RestaurantCard
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
            </div>
          ))}
        </div>
      )}

      {/* New restaurants — only in non-geo mode */}
      {!geoActive && (
        <>
          <SectionHeader title={t('newRestaurants')} />
          <div className="space-y-3 px-4">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-[100px] animate-pulse rounded-grubano-lg bg-grubano-surface-muted" />
              ))
            ) : (
              newRestaurants.map((r) => (
                <RestaurantCard
                  key={r.id}
                  layout="list"
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
          <div className="space-y-3 px-4">
            {topRated.map((r) => (
              <RestaurantCard
                key={r.id}
                layout="list"
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

      {/* In geo mode, the full "Near you" list lives below the carousel as rows */}
      {geoActive && restaurants.length > 8 && (
        <>
          <SectionHeader title={t('moreNearYou')} />
          <div className="space-y-3 px-4">
            {restaurants.slice(8).map((r) => (
              <RestaurantCard
                key={r.id}
                layout="list"
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
