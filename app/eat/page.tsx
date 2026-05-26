'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Star, Clock, ShoppingBag } from 'lucide-react'

const CATEGORIES = [
  { emoji: '🍕', label: 'Italien',   value: 'italian' },
  { emoji: '🍜', label: 'Asiatique', value: 'asian' },
  { emoji: '🥙', label: 'Wraps',     value: 'wraps' },
  { emoji: '🥗', label: 'Healthy',   value: 'healthy' },
  { emoji: '🍰', label: 'Desserts',  value: 'desserts' },
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

function RestaurantCard({ r }: { r: Restaurant }) {
  const cuisineLabel = Array.isArray(r.cuisine) ? r.cuisine[0] ?? '' : ''
  return (
    <Link href={`/eat/r/${r.id}`} className="block rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      {/* Cover */}
      <div
        className="h-36 w-full relative"
        style={r.coverPhoto
          ? { backgroundImage: `url(${r.coverPhoto})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }
        }
      >
        {r.logo && (
          <img src={r.logo} alt={r.name} className="absolute bottom-2 left-3 w-10 h-10 rounded-xl border-2 border-white object-cover shadow" />
        )}
      </div>
      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold text-gray-900 truncate">{r.name}</h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span className="flex items-center gap-0.5">
            <Star size={12} className="fill-amber-400 text-amber-400" />
            {r.rating.toFixed(1)}
            <span className="text-gray-400">({r.reviewCount})</span>
          </span>
          <span className="flex items-center gap-0.5">
            <Clock size={12} />
            {r.deliveryTime} min
          </span>
          <span className="ml-auto bg-orange-50 text-orange-600 font-medium px-1.5 py-0.5 rounded-full text-[10px]">
            min. {r.minOrder.toFixed(0)}€
          </span>
        </div>
        {cuisineLabel && (
          <span className="mt-1.5 inline-block text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {cuisineLabel}
          </span>
        )}
      </div>
    </Link>
  )
}

export default function EatHomePage() {
  const router = useRouter()
  const [city, setCity]         = useState('')
  const [cuisine, setCuisine]   = useState('')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/restaurants?take=12&sort=rating')
      .then(r => r.json())
      .then(d => setRestaurants(d.restaurants ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (city)    params.set('city', city)
    if (cuisine) params.set('cuisine', cuisine)
    router.push(`/eat/search?${params}`)
  }

  function filterByCuisine(val: string) {
    const next = val === cuisine ? '' : val
    setCuisine(next)
    const params = new URLSearchParams()
    if (next) params.set('cuisine', next)
    router.push(`/eat/search?${params}`)
  }

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-orange-500 to-orange-700 px-5 pt-12 pb-8 text-white">
        <h1 className="text-2xl font-bold leading-tight">
          Commander local.<br />Livré vite.
        </h1>
        <p className="text-orange-100 text-sm mt-1">Les meilleurs restos près de chez vous</p>

        <form onSubmit={handleSearch} className="mt-5 flex gap-2">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Ville, quartier…"
              className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <button
            type="submit"
            className="bg-white text-orange-600 font-semibold px-4 rounded-xl text-sm hover:bg-orange-50 transition-colors"
          >
            Go
          </button>
        </form>
      </div>

      {/* Categories */}
      <div className="px-4 py-4 overflow-x-auto">
        <div className="flex gap-2 w-max">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => filterByCuisine(cat.value)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
                cuisine === cat.value
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300'
              }`}
            >
              <span>{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Restaurant grid */}
      <div className="px-4 pb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          {loading ? 'Chargement…' : `${restaurants.length} restaurants`}
        </h2>

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-44 rounded-2xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : restaurants.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <ShoppingBag size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">Aucun restaurant disponible</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {restaurants.map(r => <RestaurantCard key={r.id} r={r} />)}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="mx-4 my-6 bg-orange-50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4 text-center">Comment ça marche</h2>
        <div className="flex justify-around gap-2">
          {[
            { icon: '🔍', step: '1', title: 'Cherchez', desc: 'Trouvez un resto' },
            { icon: '🛒', step: '2', title: 'Commandez', desc: 'Ajoutez au panier' },
            { icon: '🚀', step: '3', title: 'Recevez', desc: 'Livré chez vous' },
          ].map(s => (
            <div key={s.step} className="flex flex-col items-center text-center flex-1">
              <span className="text-2xl mb-1">{s.icon}</span>
              <span className="text-xs font-semibold text-orange-600 bg-orange-100 rounded-full w-5 h-5 flex items-center justify-center mb-1">
                {s.step}
              </span>
              <span className="text-xs font-semibold text-gray-800">{s.title}</span>
              <span className="text-[10px] text-gray-500">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="px-5 pb-4 pt-2 border-t border-gray-100 text-center text-[11px] text-gray-400">
        <div className="flex justify-center gap-4 mb-1">
          <Link href="/eat" className="hover:text-orange-500">Accueil</Link>
          <Link href="/eat/search" className="hover:text-orange-500">Recherche</Link>
          <Link href="/eat/auth" className="hover:text-orange-500">Connexion</Link>
        </div>
        © 2026 Grubano
      </footer>
    </div>
  )
}
