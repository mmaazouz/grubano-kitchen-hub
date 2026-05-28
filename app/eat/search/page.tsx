'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Search, Star, Clock, X, ArrowLeft } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

const CUISINE_FILTERS = ['italian', 'asian', 'wraps', 'healthy', 'desserts', 'burgers']
const CUISINE_LABELS: Record<string, string> = {
  italian: '🍕 Italien',
  asian: '🍜 Asiatique',
  wraps: '🥙 Wraps',
  healthy: '🥗 Healthy',
  desserts: '🍰 Desserts',
  burgers: '🍔 Burgers',
}
const TIME_OPTIONS = [
  { label: 'Tout', value: '' },
  { label: '< 20 min', value: '20' },
  { label: '< 30 min', value: '30' },
  { label: '< 45 min', value: '45' },
]
const RATING_OPTIONS = [
  { label: '⭐ 3+', value: '3' },
  { label: '⭐ 4+', value: '4' },
  { label: '⭐ 4.5+', value: '4.5' },
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
}

function ResultCard({ r }: { r: Restaurant }) {
  const cuisineLabel = Array.isArray(r.cuisine) ? r.cuisine[0] ?? '' : ''
  return (
    <Link
      href={`/eat/r/${r.id}`}
      className="flex gap-3.5 rounded-[20px] bg-white p-3 shadow-[0_4px_24px_rgba(0,0,0,0.05)] transition active:scale-[0.98]"
    >
      <FoodImage name={r.name} src={r.coverPhoto} className="h-[88px] w-[88px] shrink-0 rounded-2xl" glyphClassName="text-2xl" />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[15px] font-bold tracking-tight text-[#1a1a2e]">{r.name}</h3>
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-[#1a1a2e]">
            <Star size={12} className="fill-amber-400 text-amber-400" />
            {r.rating.toFixed(1)}
          </span>
        </div>
        {cuisineLabel && (
          <span className="mt-1 inline-block rounded-full bg-[#FFF7F3] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#E8593C]">
            {cuisineLabel}
          </span>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Clock size={11} /> {r.deliveryTime} min
          </span>
          <span>·</span>
          <span>Livraison {r.deliveryFee.toFixed(2)}€</span>
        </div>
      </div>
    </Link>
  )
}

function ResultSkeleton() {
  return (
    <div className="flex gap-3.5 rounded-[20px] bg-white p-3 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
      <div className="h-[88px] w-[88px] shrink-0 animate-pulse rounded-2xl bg-gray-200" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-gray-200" />
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-gray-100" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-gray-100" />
      </div>
    </div>
  )
}

function SearchContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [cuisine, setCuisine] = useState(searchParams.get('cuisine') ?? '')
  const [maxTime, setMaxTime] = useState('')
  const [minRating, setMinRating] = useState('')
  const [results, setResults] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)

  const doSearch = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (cuisine) params.set('cuisine', cuisine)
    params.set('take', '50')

    try {
      const res = await fetch(`/api/restaurants?${params}`)
      const data = await res.json()
      let list: Restaurant[] = data.restaurants ?? []
      if (maxTime) list = list.filter((r) => r.deliveryTime <= Number(maxTime))
      if (minRating) list = list.filter((r) => r.rating >= Number(minRating))
      setResults(list)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, cuisine, maxTime, minRating])

  useEffect(() => {
    doSearch()
  }, [doSearch])

  const hasFilters = Boolean(cuisine || maxTime || minRating)

  return (
    <div className="bg-[#FAFAFA]">
      {/* Sticky search header */}
      <div className="sticky top-0 z-20 space-y-3 border-b border-black/[0.05] bg-[#FAFAFA]/95 px-4 pb-3 pt-4 backdrop-blur-lg">
        <form onSubmit={(e) => { e.preventDefault(); doSearch() }} className="flex items-center gap-2">
          <button type="button" onClick={() => router.push('/eat')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm transition active:scale-90">
            <ArrowLeft size={18} className="text-gray-800" />
          </button>
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cuisine, restaurant…"
              autoFocus
              className="w-full rounded-2xl bg-white py-3 pl-11 pr-4 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
        </form>

        {/* Cuisine chips */}
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <div className="flex w-max gap-2">
            {CUISINE_FILTERS.map((c) => (
              <button
                key={c}
                onClick={() => setCuisine((prev) => (prev === c ? '' : c))}
                className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-all duration-200 active:scale-95 ${
                  cuisine === c
                    ? 'border-[#E8593C] bg-[#E8593C] text-white shadow-[0_2px_8px_rgba(232,89,60,0.3)]'
                    : 'border-black/[0.05] bg-white text-gray-700 shadow-sm'
                }`}
              >
                {CUISINE_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Time + rating chips */}
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <div className="flex w-max gap-2">
            {TIME_OPTIONS.map((o) => (
              <button
                key={`t-${o.value}`}
                onClick={() => setMaxTime(o.value)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium transition-all duration-200 active:scale-95 ${
                  maxTime === o.value ? 'border-[#1a1a2e] bg-[#1a1a2e] text-white' : 'border-black/[0.05] bg-white text-gray-600 shadow-sm'
                }`}
              >
                {o.label}
              </button>
            ))}
            {RATING_OPTIONS.map((o) => (
              <button
                key={`r-${o.value}`}
                onClick={() => setMinRating((prev) => (prev === o.value ? '' : o.value))}
                className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium transition-all duration-200 active:scale-95 ${
                  minRating === o.value ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/[0.05] bg-white text-gray-600 shadow-sm'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {hasFilters && (
          <button
            onClick={() => { setCuisine(''); setMaxTime(''); setMinRating('') }}
            className="flex items-center gap-1 text-xs font-semibold text-red-500"
          >
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </div>

      {/* Results */}
      <div className="space-y-3 p-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <ResultSkeleton key={i} />)
        ) : results.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mb-3 text-5xl">🔍</div>
            <p className="font-bold text-[#1a1a2e]">Rien trouvé pour cette recherche</p>
            <p className="mt-1 text-sm text-gray-400">Essayez un autre mot ou un autre filtre.</p>
            {hasFilters && (
              <button
                onClick={() => { setQuery(''); setCuisine(''); setMaxTime(''); setMinRating('') }}
                className="mt-4 text-sm font-semibold text-[#E8593C] active:scale-95"
              >
                Réinitialiser
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs font-medium text-gray-500">
              {results.length} résultat{results.length > 1 ? 's' : ''}
            </p>
            {results.map((r) => (
              <ResultCard key={r.id} r={r} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-4 pt-20">
          {Array.from({ length: 5 }).map((_, i) => (
            <ResultSkeleton key={i} />
          ))}
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  )
}
