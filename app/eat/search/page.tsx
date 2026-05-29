'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Search, X, ArrowLeft } from 'lucide-react'
import {
  RestaurantCard,
  CategoryPill,
  EmptyState,
  Skeleton,
  Button,
} from '@/components/design-system'
import { getRestaurantCover } from '@/lib/food-images'

const CUISINES = [
  { label: 'Italien', emoji: '🍕', q: 'italian' },
  { label: 'Asiatique', emoji: '🍜', q: 'asian' },
  { label: 'Burgers', emoji: '🍔', q: 'burger' },
  { label: 'Healthy', emoji: '🥗', q: 'healthy' },
  { label: 'Sushi', emoji: '🍣', q: 'sushi' },
  { label: 'Desserts', emoji: '🍰', q: 'desserts' },
]
const SORTS = [
  { label: 'Mieux notés', value: 'rating' },
  { label: 'Plus rapides', value: 'delivery' },
  { label: 'Nouveautés', value: 'newest' },
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
}

function cuisineText(c: string[]) {
  return Array.isArray(c) && c.length ? c.join(' • ') : 'Cuisine variée'
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
  const params = useSearchParams()
  const router = useRouter()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [cuisine, setCuisine] = useState(params.get('cuisine') ?? '')
  const [sort, setSort] = useState('rating')
  const [results, setResults] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true)
    const sp = new URLSearchParams()
    if (query) sp.set('q', query)
    if (cuisine) sp.set('cuisine', cuisine)
    sp.set('sort', sort)
    sp.set('take', '50')
    try {
      const res = await fetch(`/api/restaurants?${sp}`)
      const data = await res.json()
      setResults(data.restaurants ?? [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, cuisine, sort])

  useEffect(() => {
    run()
  }, [run])

  const hasFilters = Boolean(query || cuisine)

  return (
    <div className="min-h-screen bg-grubano-bg">
      {/* Sticky search header */}
      <div className="sticky top-0 z-20 space-y-3 border-b border-grubano-border bg-white px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/eat')}
            aria-label="Retour"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-grubano-surface-muted text-grubano-ink transition active:scale-90"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-display text-[22px] font-extrabold text-grubano-ink">Explorer</h1>
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
            placeholder="Rechercher plat, restaurant..."
            autoFocus
            className="flex-1 bg-transparent text-grubano-sm text-grubano-ink placeholder:text-grubano-ink-faint focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Effacer">
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
              {c.label}
            </CategoryPill>
          ))}
        </div>

        {/* Sort pills */}
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
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="space-y-3 p-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
        ) : results.length === 0 ? (
          <EmptyState
            emoji="🔍"
            title="Aucun restaurant trouvé"
            description="Essayez un autre mot ou un autre filtre."
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
                  Réinitialiser
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="text-xs font-medium text-grubano-ink-muted">
              {results.length} résultat{results.length > 1 ? 's' : ''}
            </p>
            {results.map((r) => (
              <RestaurantCard
                key={r.id}
                layout="list"
                name={r.name}
                cover={r.coverPhoto || getRestaurantCover(r.id)}
                cuisine={cuisineText(r.cuisine)}
                rating={r.rating}
                reviewCount={r.reviewCount}
                deliveryTime={r.deliveryTime}
                deliveryFee={r.deliveryFee}
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
