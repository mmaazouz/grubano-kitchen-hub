'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Star, Clock, Plus, Minus, ShoppingBag } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

interface MenuItem {
  id: string
  name: string
  description?: string
  price: number
  comparePrice?: number
  category: string
  calories?: number
  allergens: string[]
  labels: string[]
  photos: string[]
  isPopular: boolean
  prepTime?: number
  brandId: string
  brandName: string
}
interface MenuCategory {
  category: string
  items: MenuItem[]
}
interface RestaurantInfo {
  id: string
  name: string
  description?: string
  coverPhoto?: string
  logo?: string
  cuisine: string[]
  rating: number
  reviewCount: number
  deliveryTime: number
  minOrder: number
  deliveryFee: number
  city: string
  address: string
}
interface CartItem {
  item: MenuItem
  qty: number
}

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [menu, setMenu] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    fetch(`/api/restaurants/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setRestaurant(d.restaurant)
        setMenu(d.menu ?? [])
        setActiveCategory(d.menu?.[0]?.category ?? '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  function scrollToCategory(cat: string) {
    setActiveCategory(cat)
    const el = categoryRefs.current[cat]
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 64
      window.scrollTo({ top: y, behavior: 'smooth' })
    }
  }

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id)
      if (existing) return prev.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c))
      return [...prev, { item, qty: 1 }]
    })
  }
  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === itemId)
      if (!existing) return prev
      if (existing.qty <= 1) return prev.filter((c) => c.item.id !== itemId)
      return prev.map((c) => (c.item.id === itemId ? { ...c, qty: c.qty - 1 } : c))
    })
  }

  const cartCount = cart.reduce((s, c) => s + c.qty, 0)
  const cartSubtotal = cart.reduce((s, c) => s + c.item.price * c.qty, 0)

  function goToCart() {
    if (!restaurant) return
    sessionStorage.setItem(
      'grubano_cart',
      JSON.stringify({ restaurantId: id, items: cart, restaurant }),
    )
    router.push('/eat/cart')
  }

  if (loading) {
    return (
      <div>
        <div className="h-56 w-full animate-pulse bg-gray-200" />
        <div className="space-y-3 p-4">
          <div className="h-7 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="h-20 w-20 animate-pulse rounded-xl bg-gray-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!restaurant) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-gray-500">
        <div className="text-5xl">😕</div>
        <p className="font-semibold">Restaurant introuvable</p>
        <button onClick={() => router.back()} className="text-sm font-semibold text-[#E8593C] active:scale-95">
          Retour
        </button>
      </div>
    )
  }

  return (
    <div className={cartCount > 0 ? 'pb-24' : ''}>
      {/* Cover */}
      <div className="relative">
        <FoodImage
          name={restaurant.name}
          src={restaurant.coverPhoto}
          className="h-56 w-full"
          glyphClassName="text-6xl"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <button
          onClick={() => router.back()}
          className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur transition active:scale-90"
        >
          <ArrowLeft size={18} className="text-gray-800" />
        </button>
      </div>

      {/* Info card overlapping cover */}
      <div className="relative -mt-8 rounded-t-3xl bg-[#FAFAFA] px-4 pt-4">
        {restaurant.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={restaurant.logo}
            alt={restaurant.name}
            className="absolute -top-8 left-4 h-16 w-16 rounded-2xl border-4 border-white object-cover shadow-lg"
          />
        )}
        <div className={restaurant.logo ? 'pt-10' : ''}>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{restaurant.name}</h1>
          {restaurant.description && (
            <p className="mt-1 line-clamp-2 text-sm text-gray-500">{restaurant.description}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1 font-semibold text-[#1a1a2e]">
              <Star size={14} className="fill-amber-400 text-amber-400" />
              {restaurant.rating.toFixed(1)}
              <span className="font-normal text-gray-400">({restaurant.reviewCount})</span>
            </span>
            <span className="flex items-center gap-1 text-gray-600">
              <Clock size={14} />
              {restaurant.deliveryTime} min
            </span>
            <span className="text-gray-600">Livraison {restaurant.deliveryFee.toFixed(2)}€</span>
            <span className="text-gray-600">min. {restaurant.minOrder.toFixed(0)}€</span>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {restaurant.address}, {restaurant.city}
          </p>
        </div>
      </div>

      {/* Sticky category tabs */}
      {menu.length > 0 && (
        <div className="no-scrollbar sticky top-0 z-20 mt-3 overflow-x-auto border-b border-black/[0.06] bg-[#FAFAFA]/95 backdrop-blur-lg">
          <div className="flex w-max px-2">
            {menu.map((cat) => (
              <button
                key={cat.category}
                onClick={() => scrollToCategory(cat.category)}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors duration-200 ${
                  activeCategory === cat.category
                    ? 'border-[#E8593C] text-[#E8593C]'
                    : 'border-transparent text-gray-500'
                }`}
              >
                {cat.category}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Menu */}
      <div className="px-4 pb-6">
        {menu.map((cat) => (
          <div
            key={cat.category}
            ref={(el) => {
              categoryRefs.current[cat.category] = el
            }}
            className="scroll-mt-16 pt-5"
          >
            <h2 className="mb-3 text-lg font-bold text-[#1a1a2e]">{cat.category}</h2>
            <div className="space-y-3">
              {cat.items.map((item) => {
                const cartItem = cart.find((c) => c.item.id === item.id)
                return (
                  <div
                    key={item.id}
                    className="flex gap-3 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[15px] font-bold leading-tight text-[#1a1a2e]">{item.name}</p>
                        {item.isPopular && (
                          <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#E8593C]">
                            Populaire
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-[13px] text-gray-500">{item.description}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[15px] font-bold text-[#1a1a2e]">{item.price.toFixed(2)}€</span>
                        {item.comparePrice && item.comparePrice > item.price && (
                          <span className="text-xs text-gray-400 line-through">
                            {item.comparePrice.toFixed(2)}€
                          </span>
                        )}
                        {item.calories ? (
                          <span className="text-[11px] text-gray-400">{item.calories} kcal</span>
                        ) : null}
                      </div>
                    </div>

                    {/* Image + add button */}
                    <div className="relative flex-shrink-0">
                      <FoodImage
                        name={item.name}
                        src={item.photos?.[0]}
                        className="h-20 w-20 rounded-xl"
                        glyphClassName="text-2xl"
                      />
                      {cartItem ? (
                        <div className="absolute -bottom-2 right-0 flex items-center gap-1 rounded-full bg-white p-0.5 shadow-md">
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-[#E8593C] transition active:scale-90"
                          >
                            <Minus size={12} strokeWidth={3} />
                          </button>
                          <span className="w-4 text-center text-sm font-bold text-[#1a1a2e]">{cartItem.qty}</span>
                          <button
                            onClick={() => addToCart(item)}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E8593C] text-white transition active:scale-90"
                          >
                            <Plus size={12} strokeWidth={3} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => addToCart(item)}
                          className="absolute -bottom-2 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-[#E8593C] text-white shadow-md transition active:scale-90"
                          aria-label={`Ajouter ${item.name}`}
                        >
                          <Plus size={16} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {menu.length === 0 && (
          <div className="py-16 text-center">
            <div className="mb-2 text-4xl">🍽️</div>
            <p className="text-sm text-gray-500">Aucun plat disponible pour le moment</p>
          </div>
        )}
      </div>

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 px-4 pb-4">
          <button
            onClick={goToCart}
            disabled={cartSubtotal < restaurant.minOrder}
            className="flex w-full items-center justify-between rounded-2xl bg-[#E8593C] px-5 py-4 text-white shadow-[0_8px_24px_rgba(232,89,60,0.4)] transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-[#E8593C]">
                {cartCount}
              </span>
              <span className="font-semibold">
                {cartSubtotal < restaurant.minOrder
                  ? `Encore ${(restaurant.minOrder - cartSubtotal).toFixed(2)}€`
                  : 'Voir le panier'}
              </span>
            </span>
            <span className="flex items-center gap-2 font-bold">
              {cartSubtotal.toFixed(2)}€
              <ShoppingBag size={18} />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
