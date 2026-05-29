'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, Search, Star, Clock, MapPin, ChevronDown, SlidersHorizontal } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

const BANNERS = [
  { id: '1', tag: 'Offres du Week-end !', title: "Bénéficiez d'Offres Spéciales", discount: '30' },
  { id: '2', tag: 'Nouveaux Restaurants !', title: 'Découvrez les Nouveautés', discount: '20' },
  { id: '3', tag: 'Livraison Gratuite !', title: 'Commandez Maintenant', discount: '15' },
]

const CATS = [
  { name: 'Burger', emoji: '🍔', q: 'burger' },
  { name: 'Pizza', emoji: '🍕', q: 'pizza' },
  { name: 'Nouilles', emoji: '🍜', q: 'asian' },
  { name: 'Dessert', emoji: '🧁', q: 'desserts' },
  { name: 'Salade', emoji: '🥗', q: 'healthy' },
  { name: 'Sushi', emoji: '🍣', q: 'sushi' },
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
}

function cuisineText(c: string[]) {
  return Array.isArray(c) && c.length ? c.join(', ') : 'Cuisine variée'
}

/** Horizontal "popular" card — Bolt dish-card visual (168px). */
function PopularCard({ r }: { r: Restaurant }) {
  return (
    <Link
      href={`/eat/r/${r.id}`}
      className="block w-[168px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-bolt-card active:scale-[0.97]"
    >
      <div className="relative">
        <FoodImage name={r.name} src={r.coverPhoto} className="h-[130px] w-full rounded-t-2xl" glyphClassName="text-4xl" />
        {r.deliveryFee === 0 && (
          <span className="absolute left-2 top-2 rounded-lg bg-[#22C55E] px-2 py-[3px] text-[10px] font-bold text-white">
            Gratuit
          </span>
        )}
        <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm">
          <Star size={13} className="fill-[#F97316] text-[#F97316]" />
        </span>
      </div>
      <div className="p-2.5">
        <p className="truncate text-sm font-bold text-[#1a1a1a]">{r.name}</p>
        <div className="mt-1 flex items-center gap-1">
          <Star size={12} className="fill-[#F97316] text-[#F97316]" />
          <span className="text-xs font-bold text-[#1a1a1a]">{r.rating.toFixed(1)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-[#aaa]">
          <Clock size={10} /> {r.deliveryTime} Min
          <span className="text-[#ddd]">•</span>
          <MapPin size={10} /> {r.city}
        </div>
      </div>
    </Link>
  )
}

/** Full-width restaurant row — Bolt list-row visual. */
function RestaurantRow({ r }: { r: Restaurant }) {
  return (
    <Link
      href={`/eat/r/${r.id}`}
      className="mx-4 mb-3.5 flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-bolt-card active:scale-[0.98]"
    >
      <FoodImage name={r.name} src={r.coverPhoto} className="h-20 w-20 shrink-0 rounded-xl" glyphClassName="text-2xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#1a1a1a]">{r.name}</p>
        <p className="truncate text-xs text-[#888]">{cuisineText(r.cuisine)}</p>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#aaa]">
          <MapPin size={11} />
          <span className="truncate">{r.address?.slice(0, 26) || r.city}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-[#aaa]">
          <Clock size={11} />
          {r.deliveryTime} Min • {r.deliveryFee === 0 ? 'Livraison gratuite' : `${r.deliveryFee.toFixed(2)} €`}
        </div>
      </div>
      <div className="flex items-center gap-1 self-start">
        <Star size={12} className="fill-[#F97316] text-[#F97316]" />
        <span className="text-[13px] font-bold text-[#1a1a1a]">{r.rating.toFixed(1)}</span>
      </div>
    </Link>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center justify-between px-4">
      <h2 className="font-sans text-[18px] font-extrabold text-[#1a1a1a]">{title}</h2>
      <Link href="/eat/search" className="text-[13px] font-semibold text-[#F97316]">
        Voir tout
      </Link>
    </div>
  )
}

export default function HomeScreen() {
  const router = useRouter()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBanner, setActiveBanner] = useState(0)
  const [activeCat, setActiveCat] = useState('Burger')
  const bannerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/restaurants?take=20&sort=rating')
      .then((r) => r.json())
      .then((d) => setRestaurants(d.restaurants ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function onBannerScroll() {
    const el = bannerRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / (el.clientWidth - 20))
    setActiveBanner(Math.min(BANNERS.length - 1, Math.max(0, idx)))
  }

  const topRated = restaurants.filter((r) => r.rating >= 4.7)
  const others = restaurants.filter((r) => r.rating < 4.7)
  const newRestaurants = (others.length ? others : restaurants).slice(0, 4)
  const popular = restaurants.slice(0, 8)

  return (
    <div className="bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[#FFF3ED] text-lg">
            🧑‍🍳
          </div>
          <div>
            <p className="text-[11px] text-[#aaa]">Localisation</p>
            <div className="flex items-center gap-1">
              <MapPin size={13} className="text-[#F97316]" />
              <span className="text-sm font-bold text-[#1a1a1a]">Paris, France</span>
              <ChevronDown size={13} className="text-[#F97316]" />
            </div>
          </div>
        </div>
        <Link
          href="/eat/account"
          className="relative flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-[#f0f0f0]"
        >
          <Bell size={22} strokeWidth={1.8} className="text-[#1a1a1a]" />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[#F97316]" />
        </Link>
      </div>

      {/* Search row */}
      <div className="mb-5 flex items-center gap-2.5 px-4">
        <button
          onClick={() => router.push('/eat/search')}
          className="flex flex-1 items-center gap-2 rounded-[14px] bg-[#f5f5f5] px-3.5 py-3.5 text-left active:scale-[0.99]"
        >
          <Search size={17} className="text-[#bbb]" />
          <span className="text-sm text-[#bbb]">Rechercher plat, restaurant...</span>
        </button>
        <button
          onClick={() => router.push('/eat/search')}
          className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#F97316] active:scale-95"
        >
          <SlidersHorizontal size={18} className="text-white" />
        </button>
      </div>

      {/* Offres Exclusives */}
      <SectionHeader title="Offres Exclusives" />
      <div
        ref={bannerRef}
        onScroll={onBannerScroll}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2.5"
      >
        {BANNERS.map((b) => (
          <div
            key={b.id}
            className="relative flex h-[168px] w-[calc(100%-32px)] shrink-0 snap-start overflow-hidden rounded-[20px] bg-[#F97316]"
          >
            <div className="flex flex-1 flex-col justify-between p-4">
              <span className="self-start rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white">
                {b.tag}
              </span>
              <p className="mt-1.5 text-[17px] font-extrabold leading-tight text-white">{b.title}</p>
              <div className="mt-1 flex items-end gap-1">
                <span className="text-xs text-white/90">Jusqu&apos;à</span>
                <span className="text-[38px] font-black leading-[44px] text-white">{b.discount}</span>
                <span className="mb-1 text-base font-bold text-white">%</span>
              </div>
              <button className="self-start rounded-full bg-[#1a1a1a] px-4 py-2 text-[13px] font-bold text-white active:scale-95">
                Obtenir
              </button>
            </div>
            <div className="w-[140px]">
              <FoodImage name={b.title} className="h-full w-full" glyphClassName="text-5xl" emoji="🍔" />
            </div>
          </div>
        ))}
      </div>
      <div className="mb-5 mt-1 flex justify-center gap-1.5">
        {BANNERS.map((_, i) => (
          <span
            key={i}
            className={`h-2 rounded-full transition-all ${activeBanner === i ? 'w-[22px] bg-[#F97316]' : 'w-2 bg-[#ddd]'}`}
          />
        ))}
      </div>

      {/* Categories */}
      <SectionHeader title="Explorer les Catégories" />
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
              className={`flex shrink-0 items-center gap-1.5 rounded-[25px] border-[1.5px] px-4 py-2.5 active:scale-95 ${
                active ? 'border-[#F97316] bg-[#F97316]' : 'border-transparent bg-[#f5f5f5]'
              }`}
            >
              <span className="text-base">{cat.emoji}</span>
              <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-[#555]'}`}>{cat.name}</span>
            </button>
          )
        })}
      </div>

      {/* Popular */}
      <SectionHeader title="Populaires" />
      {loading ? (
        <div className="no-scrollbar mb-5 flex gap-3 overflow-x-auto px-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[210px] w-[168px] shrink-0 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="no-scrollbar mb-5 flex gap-3 overflow-x-auto px-4 pb-1">
          {popular.map((r) => (
            <PopularCard key={r.id} r={r} />
          ))}
        </div>
      )}

      {/* New restaurants */}
      <SectionHeader title="Nouveaux Restaurants" />
      {loading ? (
        <div className="space-y-3.5 px-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-[100px] animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        newRestaurants.map((r) => <RestaurantRow key={r.id} r={r} />)
      )}

      {/* Top rated */}
      {topRated.length > 0 && (
        <>
          <SectionHeader title="Mieux Notés" />
          {topRated.map((r) => (
            <RestaurantRow key={r.id} r={r} />
          ))}
        </>
      )}

      {!loading && restaurants.length === 0 && (
        <div className="px-4 py-16 text-center">
          <div className="mb-3 text-5xl">🍳</div>
          <p className="font-bold text-[#1a1a1a]">Aucun restaurant disponible</p>
          <p className="mt-1 text-sm text-[#888]">Revenez bientôt !</p>
        </div>
      )}

      <div className="h-6" />
    </div>
  )
}
