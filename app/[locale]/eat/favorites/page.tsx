'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { Heart } from 'lucide-react'
import { formatCuisineList } from '@/lib/categories'
import {
  RestaurantCard,
  EmptyState,
  Button,
  Skeleton,
} from '@/components/design-system'
import { readFavs, toggleFav, FAV_EVENT, showToast } from '@/lib/eat-cart'
import { getRestaurantCover } from '@/lib/food-images'

interface Restaurant {
  id: string
  name: string
  cuisine: string[]
  rating: number
  reviewCount: number
  deliveryTime: number
  deliveryFee: number
  coverPhoto?: string
  city: string
  address: string
}

export default function FavoritesScreen() {
  const t = useTranslations('eat.favorites')
  const tc = useTranslations('common')
  const locale = useLocale()
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
    <div className="min-h-screen bg-grubano-bg">
      <div className="border-b border-grubano-border bg-white px-4 pb-4 pt-3">
        <h1 className="font-display text-[22px] font-extrabold text-grubano-ink">{t('title')}</h1>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[100px]" />)
        ) : favRestaurants.length === 0 ? (
          <EmptyState
            emoji={<Heart size={44} className="text-grubano-primary" />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Button variant="primary" size="pill" onClick={() => router.push('/eat')}>
                {t('explore')}
              </Button>
            }
          />
        ) : (
          favRestaurants.map((r) => (
            <div key={r.id} className="relative">
              <RestaurantCard
                layout="list"
                name={r.name}
                cover={r.coverPhoto || getRestaurantCover(r.id)}
                cuisine={formatCuisineList(r.cuisine, locale, t('cuisineVaried'))}
                rating={r.rating}
                reviewCount={r.reviewCount}
                deliveryTime={r.deliveryTime}
                deliveryFee={r.deliveryFee}
                freeLabel={tc('free')}
                closedLabel={tc('closed')}
                onClick={() => router.push(`/eat/r/${r.id}`)}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFav(r.id)
                  showToast(t('removedToast'))
                }}
                aria-label={t('removeAria')}
                className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-grubano-danger-tint active:scale-90"
              >
                <Heart size={15} className="fill-grubano-danger text-grubano-danger" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
