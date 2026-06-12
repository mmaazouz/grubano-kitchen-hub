'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { ArrowLeft, Tag, MapPin, ChevronRight } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { getRestaurantCover } from '@/lib/food-images'

/**
 * /eat/promos — THE REAL showcase (chantier P2).
 *
 * Backed by GET /api/eat/promos: the restaurants with ≥ 1 ACTIVE promotion
 * (P1 engine data — window + active + V1 types), each with its best offer.
 * ZERO active promo → a clean EmptyState. NEVER invented content (the old
 * fake-offers page died in C3-fix; this one only shows what the engine holds).
 */

type PromoRestaurant = {
  id: string
  name: string
  city: string
  photo: string | null
  promo: { id: string; name: string; type: string; discount: number; minOrderEur: number | null }
  promoCount: number
}

export default function PromosScreen() {
  const t = useTranslations('eat.promos')
  const router = useRouter()
  const [restaurants, setRestaurants] = useState<PromoRestaurant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/eat/promos')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && Array.isArray(d?.restaurants)) setRestaurants(d.restaurants) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const promoLabel = (p: PromoRestaurant['promo']): string =>
    p.type === 'percent'
      ? p.minOrderEur
        ? t('offerPercentMin', { pct: p.discount, min: p.minOrderEur })
        : t('offerPercent', { pct: p.discount })
      : p.minOrderEur
        ? t('offerFixedMin', { eur: p.discount, min: p.minOrderEur })
        : t('offerFixed', { eur: p.discount })

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="flex items-center gap-3 border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] active:scale-90">
          <ArrowLeft size={20} className="text-[#1a1a1a]" />
        </button>
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[88px] animate-pulse rounded-[20px] bg-white shadow-bolt-card" />
            ))}
          </>
        ) : restaurants.length === 0 ? (
          /* ZERO active promo → the honest empty state, never invented offers. */
          <div className="rounded-[20px] bg-white p-8 text-center shadow-bolt-card">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FFF3ED] text-[#F97316]">
              <Tag size={24} />
            </span>
            <p className="mt-4 text-[17px] font-extrabold text-[#1a1a1a]">{t('emptyTitle')}</p>
            <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-[#888]">{t('emptyBody')}</p>
          </div>
        ) : (
          restaurants.map((r) => (
            <button
              key={r.id}
              onClick={() => router.push(`/eat/r/${r.id}`)}
              className="flex w-full items-center gap-3 rounded-[20px] bg-white p-3 text-left shadow-bolt-card active:scale-[0.99]"
            >
              <FoodImage
                name={r.name}
                src={r.photo || getRestaurantCover(r.id)}
                className="h-[64px] w-[64px] shrink-0 rounded-[14px]"
                glyphClassName="text-2xl"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-extrabold text-[#1a1a1a]">{r.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#888]">
                  <MapPin size={10} /> {r.city}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#FFF3ED] px-2 py-0.5 text-[11px] font-bold text-[#F97316]">
                  <Tag size={10} /> {promoLabel(r.promo)}
                  {r.promoCount > 1 ? ` · ${t('moreOffers', { count: r.promoCount - 1 })}` : ''}
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-[#ccc]" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
