'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Search, Star, Clock, SlidersHorizontal, X, ShoppingBag } from 'lucide-react'

const CUISINE_FILTERS = ['italian', 'asian', 'wraps', 'healthy', 'desserts', 'burgers', 'pizza']
const CUISINE_LABELS: Record<string, string> = {
  italian: '🍕 Italien', asian: '🍜 Asiatique', wraps: '🥙 Wraps',
  healthy: '🥗 Healthy', desserts: '🍰 Desserts', burgers: '🍔 Burgers', pizza: '🍕 Pizza',
}
const TIME_OPTIONS = [
  { label: 'Toute durée', value: '' },
  { label: '< 20 min',   value: '20' },
  { label: '< 30 min',   value: '30' },
  { label: '< 45 min',   value: '45' },
]

interface Restaurant {
  id: string; name: string; cuisine: string[]; rating: number
  reviewCount: number; deliveryTime: number; minOrder: number
  deliveryFee: number; coverPhoto?: string; logo?: string
}

function RestaurantCard({ r }: { r: Restaurant }) {
  const cuisineLabel = Array.isArray(r.cuisine) ? r.cuisine[0] ?? '' : ''
  return (
    <Link href={`/eat/r/${r.id}`} className="flex gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div
        className="w-20 h-20 rounded-xl flex-shrink-0"
        style={r.coverPhoto
          ? { backgroundImage: `url(${r.coverPhoto})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(135deg, #f97316, #ea580c)' }
        }
      />
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 text-sm truncate">{r.name}</h3>
        {cuisineLabel && (
          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{cuisineLabel}</span>
        )}
        <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
          <span className="flex items-center gap-0.5">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            {r.rating.toFixed(1)}
          </span>
          <span className="flex items-center gap-0.5">
            <Clock size={11} />
            {r.deliveryTime} min
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span>Livraison {r.deliveryFee.toFixed(2)}€</span>
          <span className="text-orange-600 font-medium">min. {r.minOrder.toFixed(0)}€</span>
        </div>
      </div>
    </Link>
  )
}

function SearchContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [query, setQuery]     = useState(searchParams.get('q') ?? '')
  const [city, setCity]       = useState(searchParams.get('city') ?? '')
  const [cuisine, setCuisine] = useState(searchParams.get('cuisine') ?? '')
  const [maxTime, setMaxTime] = useState('')
  const [minRating, setMinRating] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(false)

  const doSearch = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (query)   params.set('q', query)
    if (city)    params.set('city', city)
    if (cuisine) params.set('cuisine', cuisine)
    params.set('take', '50')

    try {
      const res = await fetch(`/api/restaurants?${params}`)
      const data = await res.json()
      let list: Restaurant[] = data.restaurants ?? []
      if (maxTime)   list = list.filter(r => r.deliveryTime <= Number(maxTime))
      if (minRating) list = list.filter(r => r.rating >= Number(minRating))
      setResults(list)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, city, cuisine, maxTime, minRating])

  useEffect(() => { doSearch() }, [doSearch])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    doSearch()
  }

  return (
    <div>
      {/* Search header */}
      <div className="bg-white sticky top-0 z-20 shadow-sm px-4 pt-4 pb-3 space-y-2">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Cuisine, restaurant…"
              className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm bg-gray-100 focus:bg-white focus:ring-2 focus:ring-orange-300 focus:outline-none transition"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            className={`p-2.5 rounded-xl border transition-colors ${showFilters ? 'bg-orange-500 text-white border-orange-500' : 'bg-gray-100 text-gray-600 border-gray-100'}`}
          >
            <SlidersHorizontal size={16} />
          </button>
        </form>

        {/* Cuisine pills */}
        <div className="overflow-x-auto">
          <div className="flex gap-2 w-max pb-0.5">
            {CUISINE_FILTERS.map(c => (
              <button
                key={c}
                onClick={() => setCuisine(prev => prev === c ? '' : c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                  cuisine === c ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                {CUISINE_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="space-y-2 pt-1">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Délai max</label>
              <div className="flex gap-2">
                {TIME_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setMaxTime(o.value)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                      maxTime === o.value ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Note minimum</label>
              <div className="flex gap-2">
                {['', '3', '4', '4.5'].map(v => (
                  <button
                    key={v}
                    onClick={() => setMinRating(v)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                      minRating === v ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {v ? `⭐ ${v}+` : 'Toutes'}
                  </button>
                ))}
              </div>
            </div>
            {(cuisine || maxTime || minRating) && (
              <button
                onClick={() => { setCuisine(''); setMaxTime(''); setMinRating('') }}
                className="flex items-center gap-1 text-xs text-red-500 font-medium"
              >
                <X size={12} /> Effacer les filtres
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="p-4 space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))
        ) : results.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <ShoppingBag size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-semibold text-gray-700">Aucun restaurant trouvé</p>
            <p className="text-sm mt-1">Essayez d&apos;autres critères de recherche</p>
            <button
              onClick={() => { setQuery(''); setCity(''); setCuisine(''); setMaxTime(''); setMinRating('') }}
              className="mt-4 text-sm text-orange-500 font-medium"
            >
              Réinitialiser
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500">{results.length} résultat{results.length > 1 ? 's' : ''}</p>
            {results.map(r => <RestaurantCard key={r.id} r={r} />)}
          </>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}
