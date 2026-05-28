'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Star, Clock, MapPin, ChevronRight } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

const CATEGORIES = [
  { emoji: '🍕', label: 'Italien', value: 'italian' },
  { emoji: '🍜', label: 'Asiatique', value: 'asian' },
  { emoji: '🥙', label: 'Wraps', value: 'wraps' },
  { emoji: '🥗', label: 'Healthy', value: 'healthy' },
  { emoji: '🍰', label: 'Desserts', value: 'desserts' },
  { emoji: '🍔', label: 'Burgers', value: 'burgers' },
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
      className="group block overflow-hidden rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all duration-200 active:scale-[0.98]"
    >
      <div className="relative">
        <FoodImage
          name={r.name}
          src={r.coverPhoto}
          className="h-44 w-full"
          glyphClassName="text-6xl"
        />
        {/* Rating chip */}
        <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-[#1a1a2e] shadow-sm backdrop-blur">
          <Star size={12} className="fill-amber-400 text-amber-400" />
          {r.rating.toFixed(1)}
        </span>
        {/* Delivery time chip */}
        <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-[#1a1a2e]/85 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
          <Clock size={11} />
          {r.deliveryTime} min
        </span>
      </div>
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-[17px] font-bold tracking-tight text-[#1a1a2e]">{r.name}</h3>
          {cuisineLabel && (
            <span className="shrink-0 rounded-full bg-[#FFF7F3] px-2.5 py-1 text-[11px] font-semibold capitalize text-[#E8593C]">
              {cuisineLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-[13px] text-gray-400">
          {r.reviewCount} avis · Livraison {r.deliveryFee.toFixed(2)}€ · min. {r.minOrder.toFixed(0)}€
        </p>
      </div>
    </Link>
  )
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      <div className="h-44 w-full animate-pulse bg-gray-200" />
      <div className="space-y-2 px-4 py-3.5">
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-gray-100" />
      </div>
    </div>
  )
}

export default function EatHomePage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
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

  return (
    <div className="bg-[#FAFAFA]">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-b-[28px] bg-gradient-to-br from-[#E8593C] via-[#E8593C] to-[#B11E2F] px-5 pb-14 pt-12 text-white">
        {/* decorative glow */}
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.6), transparent 60%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-1.5 text-sm font-medium text-white/85">
            <MapPin size={15} />
            Livraison à <span className="font-bold text-white">Paris</span>
          </div>
          <h1 className="mt-3 text-[30px] font-bold leading-[1.1] tracking-tight">
            Bonjour 👋
            <br />
            Que mange-t-on&nbsp;?
          </h1>
        </div>
      </div>

      {/* Floating search bar overlapping hero */}
      <div className="relative z-10 -mt-7 px-5">
        <form onSubmit={handleSearch}>
          <div className="flex items-center gap-2 rounded-2xl bg-white p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.10)]">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Plat, cuisine, restaurant…"
                className="w-full rounded-xl bg-transparent py-2.5 pl-11 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-[#E8593C] px-4 py-2.5 text-sm font-bold text-white transition active:scale-95"
            >
              Go
            </button>
          </div>
        </form>
      </div>

      {/* Category pills */}
      <div className="no-scrollbar overflow-x-auto px-5 pb-1 pt-5">
        <div className="flex w-max gap-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => router.push(`/eat/search?cuisine=${cat.value}`)}
              className="flex flex-col items-center gap-1.5 transition active:scale-95"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-[0_4px_16px_rgba(0,0,0,0.05)]">
                {cat.emoji}
              </span>
              <span className="text-[11px] font-semibold text-gray-600">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Popular restaurants */}
      <div className="px-5 pt-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[22px] font-bold tracking-tight text-[#1a1a2e]">Populaires près de vous</h2>
          <Link href="/eat/search" className="text-sm font-semibold text-[#E8593C] active:scale-95">
            Tout voir
          </Link>
        </div>

        {loading ? (
          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : restaurants.length === 0 ? (
          <div className="rounded-[20px] bg-white py-16 text-center shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
            <div className="mb-3 text-5xl">🍳</div>
            <p className="font-bold text-[#1a1a2e]">Aucun restaurant pour l&apos;instant</p>
            <p className="mt-1 text-sm text-gray-400">On vous prépare de belles surprises.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="mx-5 my-7 rounded-[20px] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
        <h2 className="mb-5 text-center text-lg font-bold tracking-tight text-[#1a1a2e]">Comment ça marche</h2>
        <div className="space-y-4">
          {[
            { icon: '🔍', title: 'Choisissez', desc: 'Parcourez les restos près de chez vous' },
            { icon: '🛒', title: 'Commandez', desc: 'Ajoutez vos plats préférés au panier' },
            { icon: '🛵', title: 'Régalez-vous', desc: 'On vous livre, vous gagnez des points' },
          ].map((s, i) => (
            <div key={s.title} className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFF7F3] text-2xl">
                {s.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#1a1a2e]">
                  <span className="text-[#E8593C]">{i + 1}.</span> {s.title}
                </p>
                <p className="text-[13px] text-gray-400">{s.desc}</p>
              </div>
              <ChevronRight size={16} className="text-gray-200" />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="px-5 pb-6 pt-2 text-center">
        <div className="mb-2 flex justify-center gap-5 text-sm font-medium text-gray-500">
          <Link href="/eat" className="hover:text-[#E8593C]">Accueil</Link>
          <Link href="/eat/search" className="hover:text-[#E8593C]">Recherche</Link>
          <Link href="/eat/auth" className="hover:text-[#E8593C]">Connexion</Link>
        </div>
        <p className="text-[11px] text-gray-400">© 2026 Grubano · Livraison locale, faite avec ❤️</p>
      </footer>
    </div>
  )
}
