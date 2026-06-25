'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { formatCuisineList } from '@/lib/categories'
import { formatDistance } from '@/lib/format'
import { useGeolocation } from '@/lib/use-geolocation'
import { Search, X, ArrowLeft, Sparkles } from 'lucide-react'
import {
  RestaurantCard,
  CategoryPill,
  EmptyState,
  Skeleton,
  Button,
} from '@/components/design-system'
import { getRestaurantCover } from '@/lib/food-images'

const CUISINES = [
  { labelKey: 'cuisineItalian', emoji: '🍕', q: 'italian' },
  { labelKey: 'cuisineAsian', emoji: '🍜', q: 'asian' },
  { labelKey: 'cuisineBurgers', emoji: '🍔', q: 'burger' },
  { labelKey: 'cuisineHealthy', emoji: '🥗', q: 'healthy' },
  { labelKey: 'cuisineSushi', emoji: '🍣', q: 'sushi' },
  { labelKey: 'cuisineDesserts', emoji: '🍰', q: 'desserts' },
]
const SORTS = [
  { labelKey: 'sortRating', value: 'rating' },
  { labelKey: 'sortDelivery', value: 'delivery' },
  { labelKey: 'sortNewest', value: 'newest' },
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
  city: string
  address: string
  distanceKm?: number
}

interface SearchResponse {
  restaurants?: Restaurant[]
  /** Set by the API when the requested category had no hits and the list
   *  fell back to nearest-of-any. Always show alternatives, never empty. */
  categoryHadNoMatch?: boolean
}

function RowSkeleton() {
  return (
    <div className="flex gap-3 rounded-gb-lg border border-gb-stroke bg-gb-surface-elevated p-3 shadow-gb-sm">
      <Skeleton className="h-24 w-24 rounded-gb-md" />
      <div className="flex-1 space-y-2 py-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

function SearchContent() {
  const t = useTranslations('eat.search')
  const tc = useTranslations('common')
  const locale = useLocale()
  const params = useSearchParams()
  const router = useRouter()
  const { coords, status, request } = useGeolocation()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [cuisine, setCuisine] = useState(params.get('cuisine') ?? '')
  const [sort, setSort] = useState('rating')
  const [results, setResults] = useState<Restaurant[]>([])
  const [fallback, setFallback] = useState(false)
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true)
    const sp = new URLSearchParams()
    if (query) sp.set('q', query)
    if (cuisine) sp.set('category', cuisine)
    if (coords) {
      sp.set('lat', String(coords.lat))
      sp.set('lng', String(coords.lng))
    } else {
      sp.set('sort', sort)
    }
    sp.set('take', '50')
    try {
      const res = await fetch(`/api/restaurants?${sp}`)
      const data: SearchResponse = await res.json()
      setResults(data.restaurants ?? [])
      setFallback(Boolean(data.categoryHadNoMatch))
    } catch {
      setResults([])
      setFallback(false)
    } finally {
      setLoading(false)
    }
  }, [query, cuisine, sort, coords])

  useEffect(() => {
    run()
  }, [run])

  const hasFilters = Boolean(query || cuisine)
  const activeCuisineLabel = (() => {
    const m = CUISINES.find((c) => c.q === cuisine)
    return m ? t(m.labelKey) : cuisine
  })()

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

  return (
    <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content">
      {/* Sticky search header */}
      <div className="sticky top-0 z-20 space-y-3 border-b border-gb-stroke bg-gb-surface-elevated px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/eat')}
            aria-label={tc('back')}
            className="flex h-10 w-10 items-center justify-center rounded-gb-full bg-gb-oat-100 text-gb-content transition active:scale-90"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-gb-display text-[22px] font-extrabold text-gb-content">{t('title')}</h1>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
          className="flex items-center gap-2 rounded-gb-lg bg-gb-oat-100 px-3.5 py-3"
        >
          <Search size={17} className="text-gb-content-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoFocus
            className="flex-1 bg-transparent text-sm text-gb-content placeholder:text-gb-content-muted focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label={t('clear')}>
              <X size={16} className="text-gb-content-muted" />
            </button>
          )}
        </form>

        {/* Cuisine pills */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {CUISINES.map((c) => (
            <CategoryPill
              key={c.q}
              emoji={c.emoji}
              active={cuisine === c.q}
              onClick={() => setCuisine((prev) => (prev === c.q ? '' : c.q))}
            >
              {t(c.labelKey)}
            </CategoryPill>
          ))}
        </div>

        {/* Sort pills (only meaningful when location is not driving the order) */}
        {!coords && (
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {SORTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSort(s.value)}
                className={`shrink-0 rounded-gb-full border-[1.5px] px-3.5 py-2 text-xs font-medium transition active:scale-95 ${
                  sort === s.value
                    ? 'border-transparent bg-gb-ink-800 text-white'
                    : 'border-gb-stroke bg-gb-surface-elevated text-gb-content-muted'
                }`}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Geo hint when location is off — friendly nudge, dismissible by tapping */}
      {!coords && status !== 'requesting' && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-gb-md bg-gb-zest-50 px-3 py-2 text-xs text-gb-content-muted">
          <span>{t('geoOffHint')}</span>
          {/* gb-ghost = dark Ink text (text-gb-content) — readable on the light
              zest-50 hint banner (accent-strong #C7430A would fail AA there). */}
          <Button
            variant="gb-ghost"
            size="sm"
            onClick={request}
            disabled={status === 'unavailable'}
          >
            {t('geoEnable')}
          </Button>
        </div>
      )}

      {/* Category-fallback banner — never empty; show alternatives explicitly */}
      {fallback && cuisine && !loading && results.length > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-gb-lg border border-gb-stroke bg-gb-warning-soft px-3.5 py-3">
          <Sparkles size={18} className="mt-0.5 shrink-0 text-gb-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gb-content">
              {t('categoryFallbackTitle', { category: activeCuisineLabel })}
            </p>
            <p className="text-[11px] text-gb-content-muted">{t('categoryFallbackSubtitle')}</p>
          </div>
          <button
            onClick={() => setCuisine('')}
            aria-label={t('clearCategory')}
            className="rounded-gb-full p-1 text-gb-content-muted hover:text-gb-content"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Results — 1 column (mobile) → 2 columns (desktop ≥lg, inside the shared
          rail+1200 ossature from Agent 150). */}
      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            skin="gb"
            emoji="🔍"
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              hasFilters ? (
                <Button
                  variant="gb-secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                    setCuisine('')
                  }}
                >
                  {t('reset')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="mb-3 text-xs font-medium text-gb-content-muted">
              {t('resultsCount', { count: results.length })}
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {results.map((r) => (
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
      </div>
    </div>
  )
}

export default function ExploreScreen() {
  return (
    <Suspense
      fallback={
        <div className="grid grid-cols-1 gap-3 p-4 pt-24 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  )
}
