'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Star, Clock, MapPin, Heart } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { readFavs, toggleFav, FAV_EVENT, showToast } from '@/lib/eat-cart'

interface Restaurant {
  id: string
  name: string
  cuisine: string[]
  rating: number
  deliveryTime: number
  deliveryFee: number
  coverPhoto?: string
  city: string
  address: string
}

export default function FavoritesScreen() {
  const router = useRouter()
  const [all, setAll] = useState<Restaurant[]>([])
  const [favs, setFavs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setFavs(readFavs())
    const sync = () => setFavs(readFavs())
    window.addEventListener(FAV_EVENT, sync)
    window.addEventListener('storage', sync)
    fetch('/api/restaurants?take=50')
      .then((r) => r.json())
      .then((d) => setAll(d.restaurants ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => {
      window.removeEventListener(FAV_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const favRestaurants = all.filter((r) => favs.includes(r.id))

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">Mes Favoris</h1>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[100px] animate-pulse rounded-2xl bg-white shadow-bolt-card" />)
        ) : favRestaurants.length === 0 ? (
          <div className="flex flex-col items-center px-10 pt-20 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#FFF3ED]"><Heart size={44} className="text-[#F97316]" /></div>
            <p className="mt-5 text-xl font-extrabold text-[#1a1a1a]">Aucun favori</p>
            <p className="mt-2 text-sm leading-relaxed text-[#888]">Touchez le cœur sur un restaurant pour l&apos;ajouter ici.</p>
            <button onClick={() => router.push('/eat')} className="mt-6 rounded-[30px] bg-[#F97316] px-7 py-3.5 text-[15px] font-bold text-white active:scale-95">
              Explorer les restos
            </button>
          </div>
        ) : (
          favRestaurants.map((r) => (
            <div key={r.id} className="relative">
              <Link href={`/eat/r/${r.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-bolt-card active:scale-[0.98]">
                <FoodImage name={r.name} src={r.coverPhoto} className="h-20 w-20 shrink-0 rounded-xl" glyphClassName="text-2xl" />
                <div className="min-w-0 flex-1 pr-8">
                  <p className="text-sm font-bold text-[#1a1a1a]">{r.name}</p>
                  <p className="truncate text-xs text-[#888]">{Array.isArray(r.cuisine) && r.cuisine.length ? r.cuisine.join(', ') : 'Cuisine variée'}</p>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#aaa]"><MapPin size={11} /><span className="truncate">{r.address?.slice(0, 24) || r.city}</span></div>
                  <div className="flex items-center gap-1 text-[11px] text-[#aaa]"><Clock size={11} />{r.deliveryTime} Min</div>
                </div>
                <span className="flex items-center gap-1 self-start"><Star size={12} className="fill-[#F97316] text-[#F97316]" /><span className="text-[13px] font-bold text-[#1a1a1a]">{r.rating.toFixed(1)}</span></span>
              </Link>
              <button
                onClick={() => { toggleFav(r.id); showToast('Retiré des favoris') }}
                className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#FEE2E2] active:scale-90"
                aria-label="Retirer des favoris"
              >
                <Heart size={15} className="fill-[#EF4444] text-[#EF4444]" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
