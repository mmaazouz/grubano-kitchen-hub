'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Star, Clock } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

const CATEGORIES = [
  { emoji: '🍕', label: 'Italien',   value: 'italian' },
  { emoji: '🍜', label: 'Asiatique', value: 'asian' },
  { emoji: '🥙', label: 'Wraps',     value: 'wraps' },
  { emoji: '🥗', label: 'Healthy',   value: 'healthy' },
  { emoji: '🍰', label: 'Desserts',  value: 'desserts' },
  { emoji: '🍔', label: 'Burgers',   value: 'burgers' },
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
    <Link
      href={`/eat/r/${r.id}`}
      className="block overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] active:scale-[0.98]"
    >
      <div className="relative">
        <FoodImage
          name={r.name}
          src={r.coverPhoto}
          className="h-40 w-full rounded-t-2xl"
          glyphClassName="text-5xl"
        />
        {r.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.logo}
            alt={r.name}
            className="absolute -bottom-4 left-3 h-11 w-11 rounded-xl border-2 border-white object-cover shadow-md"
          />
        )}
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-semibold text-gray-800 shadow-sm backdrop-blur">
          <Star size={12} className="fill-amber-400 text-amber-400" />
          {r.rating.toFixed(1)}
        </span>
      </div>
      <div className="p-3 pt-4">
        <h3 className="truncate text-base font-bold text-[#1a1a2e]">{r.name}</h3>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {r.deliveryTime} min
          </span>
          <span className="text-gray-300">·</span>
          <span>min. {r.minOrder.toFixed(0)}€</span>
          {cuisineLabel && (
            <span className="ml-auto rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium capitalize text-[#E8593C]">
              {cuisineLabel}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white">
      <div className="h-40 w-full animate-pulse bg-gray-200" />
      <div className="space-y-2 p-3 pt-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  )
}

export default function EatHomePage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/restaurants?take=12&sort=rating')
      .then((r) => r.json())
      .then((d) => setRestaurants(d.restaurants ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    router.push(`/eat/search?${params}`)
  }

  function pickCuisine(val: string) {
    const params = new URLSearchParams()
    params.set('cuisine', val)
    router.push(`/eat/search?${params}`)
  }

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#E8593C] to-[#C2341B] px-5 pb-7 pt-12 text-white">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">
          Commander local.
          <br />
          Livré vite.
        </h1>
        <p className="mt-1.5 text-sm text-white/85">
          Les meilleurs restos près de chez vous
        </p>

        <form onSubmit={handleSearch} className="mt-5">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un plat, un resto…"
              className="w-full rounded-xl bg-white py-3.5 pl-11 pr-4 text-sm text-gray-900 shadow-[0_4px_16px_rgba(0,0,0,0.12)] transition focus:outline-none focus:ring-2 focus:ring-white/60"
            />
          </div>
        </form>
      </div>

      {/* Category pills */}
      <div className="no-scrollbar overflow-x-auto px-4 py-4">
        <div className="flex w-max gap-2.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => pickCuisine(cat.value)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                cuisine === cat.value
                  ? 'border-[#E8593C] bg-[#E8593C] text-white shadow-[0_2px_8px_rgba(232,89,60,0.35)]'
                  : 'border-black/[0.06] bg-white text-gray-700 shadow-sm hover:border-orange-200'
              }`}
            >
              <span className="text-base">{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Popular restaurants */}
      <div className="px-4 pb-2">
        <h2 className="mb-3 text-lg font-bold text-[#1a1a2e]">
          Populaires près de vous
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : restaurants.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mb-3 text-5xl">🍽️</div>
            <p className="font-semibold text-gray-700">Aucun restaurant disponible</p>
            <p className="mt-1 text-sm text-gray-400">Revenez bientôt !</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="mx-4 my-6 rounded-2xl bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/[0.06]">
        <h2 className="mb-5 text-center text-base font-bold text-[#1a1a2e]">
          Comment ça marche
        </h2>
        <div className="flex justify-around gap-3">
          {[
            { icon: '🔍', step: '1', title: 'Cherchez', desc: 'Trouvez un resto' },
            { icon: '🛒', step: '2', title: 'Commandez', desc: 'Ajoutez au panier' },
            { icon: '🛵', step: '3', title: 'Recevez', desc: 'Livré chez vous' },
          ].map((s) => (
            <div key={s.step} className="flex flex-1 flex-col items-center text-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-2xl">
                {s.icon}
              </div>
              <span className="text-sm font-bold text-[#1a1a2e]">{s.title}</span>
              <span className="mt-0.5 text-xs text-gray-400">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] px-5 pb-4 pt-4 text-center text-[11px] text-gray-400">
        <div className="mb-1.5 flex justify-center gap-4">
          <Link href="/eat" className="font-medium hover:text-[#E8593C]">Accueil</Link>
          <Link href="/eat/search" className="font-medium hover:text-[#E8593C]">Recherche</Link>
          <Link href="/eat/auth" className="font-medium hover:text-[#E8593C]">Connexion</Link>
        </div>
        © 2026 Grubano · Livraison locale
      </footer>
    </div>
  )
}
