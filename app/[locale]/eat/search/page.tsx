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
    <div className="flex gap-3 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3 shadow-grubano-sm">
      <Skeleton className="h-24 w-24 rounded-grubano-md" />
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
    <div className="min-h-screen bg-grubano-bg">
      {/* Sticky search header */}
      <div className="sticky top-0 z-20 space-y-3 border-b border-grubano-border bg-white px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/eat')}
            aria-label={tc('back')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-grubano-surface-muted text-grubano-ink transition active:scale-90"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-display text-[22px] font-extrabold text-grubano-ink">{t('title')}</h1>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
          className="flex items-center gap-2 rounded-grubano-lg bg-grubano-surface-muted px-3.5 py-3"
        >
          <Search size={17} className="text-grubano-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoFocus
            className="flex-1 bg-transparent text-grubano-sm text-grubano-ink placeholder:text-grubano-ink-faint focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label={t('clear')}>
              <X size={16} className="text-grubano-ink-faint" />
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
                className={`shrink-0 rounded-grubano-pill border-[1.5px] px-3.5 py-2 text-xs font-medium transition active:scale-95 ${
                  sort === s.value
                    ? 'border-grubano-dark bg-grubano-dark text-white'
                    : 'border-transparent bg-grubano-surface-muted text-grubano-ink-muted'
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
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-grubano-md bg-grubano-tint px-3 py-2 text-xs text-grubano-ink-muted">
          <span>{t('geoOffHint')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={request}
            disabled={status === 'unavailable'}
            className="text-grubano-primary"
          >
            {t('geoEnable')}
          </Button>
        </div>
      )}

      {/* Category-fallback banner — never empty; show alternatives explicitly */}
      {fallback && cuisine && !loading && results.length > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-grubano-lg border border-grubano-warning/30 bg-grubano-warning-tint px-3.5 py-3">
          <Sparkles size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-grubano-sm font-bold text-grubano-ink">
              {t('categoryFallbackTitle', { category: activeCuisineLabel })}
            </p>
            <p className="text-[11px] text-grubano-ink-muted">{t('categoryFallbackSubtitle')}</p>
          </div>
          <button
            onClick={() => setCuisine('')}
            aria-label={t('clearCategory')}
            className="rounded-full p-1 text-grubano-ink-faint hover:text-grubano-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Results */}
      <div className="space-y-3 p-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
        ) : results.length === 0 ? (
          <EmptyState
            emoji="🔍"
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
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
            <p className="text-xs font-medium text-grubano-ink-muted">
              {t('resultsCount', { count: results.length })}
            </p>
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
        <div className="space-y-3 p-4 pt-24">
          {Array.from({ length: 5 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  )
}
