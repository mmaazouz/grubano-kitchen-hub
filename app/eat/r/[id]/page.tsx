'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Star, Clock, ChevronRight, Plus, Minus, ShoppingCart, X } from 'lucide-react'

interface MenuItem {
  id: string; name: string; description?: string; price: number
  comparePrice?: number; category: string; calories?: number
  allergens: string[]; labels: string[]; photos: string[]
  isPopular: boolean; prepTime?: number; brandId: string; brandName: string
}
interface MenuCategory { category: string; items: MenuItem[] }
interface RestaurantInfo {
  id: string; name: string; description?: string; coverPhoto?: string; logo?: string
  cuisine: string[]; rating: number; reviewCount: number; deliveryTime: number
  minOrder: number; deliveryFee: number; city: string; address: string
}
interface CartItem { item: MenuItem; qty: number }

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [menu, setMenu]       = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('')
  const [cart, setCart]       = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    fetch(`/api/restaurants/${id}`)
      .then(r => r.json())
      .then(d => {
        setRestaurant(d.restaurant)
        setMenu(d.menu ?? [])
        setActiveCategory(d.menu?.[0]?.category ?? '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  function scrollToCategory(cat: string) {
    setActiveCategory(cat)
    categoryRefs.current[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function addToCart(item: MenuItem) {
    setCart(prev => {
      const existing = prev.find(c => c.item.id === item.id)
      if (existing) return prev.map(c => c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { item, qty: 1 }]
    })
  }
  function removeFromCart(itemId: string) {
    setCart(prev => {
      const existing = prev.find(c => c.item.id === itemId)
      if (!existing) return prev
      if (existing.qty <= 1) return prev.filter(c => c.item.id !== itemId)
      return prev.map(c => c.item.id === itemId ? { ...c, qty: c.qty - 1 } : c)
    })
  }

  const cartCount    = cart.reduce((s, c) => s + c.qty, 0)
  const cartSubtotal = cart.reduce((s, c) => s + c.item.price * c.qty, 0)

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-44 bg-gray-100 animate-pulse rounded-2xl" />
        <div className="h-6 bg-gray-100 animate-pulse rounded-xl w-2/3" />
        <div className="h-4 bg-gray-100 animate-pulse rounded w-1/2" />
      </div>
    )
  }
  if (!restaurant) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
        <p>Restaurant introuvable</p>
        <button onClick={() => router.back()} className="text-orange-500 text-sm font-medium">Retour</button>
      </div>
    )
  }

  return (
    <div>
      {/* Cover */}
      <div
        className="h-44 w-full relative"
        style={restaurant.coverPhoto
          ? { backgroundImage: `url(${restaurant.coverPhoto})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }
        }
      >
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 bg-white/80 backdrop-blur-sm p-2 rounded-full shadow"
        >
          <ArrowLeft size={18} className="text-gray-700" />
        </button>
        {restaurant.logo && (
          <img src={restaurant.logo} alt={restaurant.name}
            className="absolute -bottom-5 left-4 w-14 h-14 rounded-2xl border-2 border-white object-cover shadow-lg" />
        )}
      </div>

      {/* Info */}
      <div className="px-4 pt-8 pb-3">
        <h1 className="text-xl font-bold text-gray-900">{restaurant.name}</h1>
        {restaurant.description && (
          <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{restaurant.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <Star size={13} className="fill-amber-400 text-amber-400" />
            <strong className="text-gray-900">{restaurant.rating.toFixed(1)}</strong>
            <span className="text-gray-400 text-xs">({restaurant.reviewCount})</span>
          </span>
          <span className="flex items-center gap-1">
            <Clock size={13} />
            {restaurant.deliveryTime} min
          </span>
          <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-medium ml-auto">
            Livraison {restaurant.deliveryFee.toFixed(2)}€
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-1">{restaurant.address}, {restaurant.city}</p>
      </div>

      {/* Category tabs */}
      {menu.length > 0 && (
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 overflow-x-auto">
          <div className="flex gap-0 w-max px-4">
            {menu.map(cat => (
              <button
                key={cat.category}
                onClick={() => scrollToCategory(cat.category)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeCategory === cat.category
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {cat.category}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Menu */}
      <div className="pb-4">
        {menu.map(cat => (
          <div
            key={cat.category}
            ref={el => { categoryRefs.current[cat.category] = el }}
            className="pt-4"
          >
            <h2 className="px-4 text-base font-bold text-gray-900 mb-2">{cat.category}</h2>
            <div className="space-y-1">
              {cat.items.map(item => {
                const cartItem = cart.find(c => c.item.id === item.id)
                return (
                  <div key={item.id} className="mx-3 flex gap-3 p-3 bg-white rounded-2xl border border-gray-100">
                    {item.photos[0] ? (
                      <img src={item.photos[0]} alt={item.name} className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 flex-shrink-0 flex items-center justify-center text-2xl">
                        🍽️
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <p className="font-semibold text-sm text-gray-900 leading-tight">{item.name}</p>
                          {item.isPopular && (
                            <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">
                              Populaire
                            </span>
                          )}
                        </div>
                        {cartItem ? (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => removeFromCart(item.id)} className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center">
                              <Minus size={11} />
                            </button>
                            <span className="text-sm font-bold w-4 text-center">{cartItem.qty}</span>
                            <button onClick={() => addToCart(item)} className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center">
                              <Plus size={11} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => addToCart(item)} className="w-7 h-7 bg-orange-500 text-white rounded-full flex items-center justify-center flex-shrink-0">
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm font-bold text-gray-900">{item.price.toFixed(2)}€</span>
                        {item.comparePrice && item.comparePrice > item.price && (
                          <span className="text-xs text-gray-400 line-through">{item.comparePrice.toFixed(2)}€</span>
                        )}
                        {item.calories && (
                          <span className="text-[10px] text-gray-400">{item.calories} kcal</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Floating cart button */}
      {cartCount > 0 && !showCart && (
        <button
          onClick={() => setShowCart(true)}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-orange-500 text-white px-5 py-3 rounded-2xl shadow-lg flex items-center gap-3 font-semibold text-sm"
        >
          <span className="bg-white text-orange-600 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {cartCount}
          </span>
          <ShoppingCart size={16} />
          Voir le panier
          <span className="ml-1 font-bold">{cartSubtotal.toFixed(2)}€</span>
        </button>
      )}

      {/* Cart sidebar (sheet) */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCart(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[80vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Mon panier</h2>
              <button onClick={() => setShowCart(false)} className="p-1">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            {cart.map(({ item, qty }) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => removeFromCart(item.id)} className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                    <Minus size={11} />
                  </button>
                  <span className="text-sm font-bold w-4 text-center">{qty}</span>
                  <button onClick={() => addToCart(item)} className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center">
                    <Plus size={11} />
                  </button>
                </div>
                <span className="flex-1 text-sm text-gray-800">{item.name}</span>
                <span className="text-sm font-semibold">{(item.price * qty).toFixed(2)}€</span>
              </div>
            ))}
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Sous-total</span><span>{cartSubtotal.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Livraison</span><span>{restaurant.deliveryFee.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between font-bold text-base mt-2">
                <span>Total</span><span>{(cartSubtotal + restaurant.deliveryFee).toFixed(2)}€</span>
              </div>
            </div>
            {cartSubtotal < restaurant.minOrder ? (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-2.5 text-center">
                Minimum de commande: {restaurant.minOrder.toFixed(2)}€
                (encore {(restaurant.minOrder - cartSubtotal).toFixed(2)}€)
              </p>
            ) : (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('grubano_cart', JSON.stringify({ restaurantId: id, items: cart, restaurant }))
                  }
                  router.push('/eat/cart')
                }}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-colors"
              >
                Commander · {(cartSubtotal + restaurant.deliveryFee).toFixed(2)}€
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
