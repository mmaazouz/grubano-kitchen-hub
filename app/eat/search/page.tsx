'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Search, Star, Clock, MapPin, X } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

const CUISINES = [
  { label: '🍕 Italien', q: 'italian' },
  { label: '🍜 Asiatique', q: 'asian' },
  { label: '🍔 Burgers', q: 'burger' },
  { label: '🥗 Healthy', q: 'healthy' },
  { label: '🍣 Sushi', q: 'sushi' },
  { label: '🍰 Desserts', q: 'desserts' },
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

function Row({ r }: { r: Restaurant }) {
  return (
    <Link href={`/eat/r/${r.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-bolt-card active:scale-[0.98]">
      <FoodImage name={r.name} src={r.coverPhoto} className="h-20 w-20 shrink-0 rounded-xl" glyphClassName="text-2xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#1a1a1a]">{r.name}</p>
        <p className="truncate text-xs text-[#888]">{Array.isArray(r.cuisine) && r.cuisine.length ? r.cuisine.join(', ') : 'Cuisine variée'}</p>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#aaa]"><MapPin size={11} /><span className="truncate">{r.address?.slice(0, 26) || r.city}</span></div>
        <div className="flex items-center gap-1 text-[11px] text-[#aaa]"><Clock size={11} />{r.deliveryTime} Min • {r.deliveryFee === 0 ? 'Gratuit' : `${r.deliveryFee.toFixed(2)} €`}</div>
      </div>
      <span className="flex items-center gap-1 self-start"><Star size={12} className="fill-[#F97316] text-[#F97316]" /><span className="text-[13px] font-bold text-[#1a1a1a]">{r.rating.toFixed(1)}</span></span>
    </Link>
  )
}

function RowSkeleton() {
  return <div className="h-[100px] animate-pulse rounded-2xl bg-white shadow-bolt-card" />
}

function ExploreContent() {
  const params = useSearchParams()
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

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Sticky search header */}
      <div className="sticky top-0 z-20 space-y-3 border-b border-[#f0f0f0] bg-white px-4 pb-3 pt-3">
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">Explorer</h1>
        <form onSubmit={(e) => { e.preventDefault(); run() }} className="flex items-center gap-2 rounded-[14px] bg-[#f5f5f5] px-3.5 py-3">
          <Search size={17} className="text-[#bbb]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher plat, restaurant..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-[#1a1a1a] placeholder:text-[#bbb] focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')}><X size={16} className="text-[#bbb]" /></button>
          )}
        </form>

        {/* Cuisine pills */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {CUISINES.map((c) => (
            <button
              key={c.q}
              onClick={() => setCuisine((prev) => (prev === c.q ? '' : c.q))}
              className={`shrink-0 rounded-[25px] border-[1.5px] px-3.5 py-2 text-xs font-semibold active:scale-95 ${
                cuisine === c.q ? 'border-[#F97316] bg-[#F97316] text-white' : 'border-transparent bg-[#f5f5f5] text-[#555]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Sort pills */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {SORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSort(s.value)}
              className={`shrink-0 rounded-[25px] border-[1.5px] px-3.5 py-2 text-xs font-medium active:scale-95 ${
                sort === s.value ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white' : 'border-transparent bg-[#f5f5f5] text-[#555]'
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
          <div className="py-20 text-center">
            <div className="mb-3 text-5xl">🔍</div>
            <p className="font-bold text-[#1a1a1a]">Aucun restaurant trouvé</p>
            <p className="mt-1 text-sm text-[#888]">Essayez un autre mot ou un autre filtre.</p>
            {(query || cuisine) && (
              <button onClick={() => { setQuery(''); setCuisine('') }} className="mt-4 text-sm font-bold text-[#F97316]">Réinitialiser</button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs font-medium text-[#888]">{results.length} résultat{results.length > 1 ? 's' : ''}</p>
            {results.map((r) => <Row key={r.id} r={r} />)}
          </>
        )}
      </div>
    </div>
  )
}

export default function ExploreScreen() {
  return (
    <Suspense fallback={<div className="space-y-3 p-4 pt-24">{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div>}>
      <ExploreContent />
    </Suspense>
  )
}
