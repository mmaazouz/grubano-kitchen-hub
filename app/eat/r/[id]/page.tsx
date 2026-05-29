'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Heart, Share2, Star, Clock, MapPin, Search, Plus, Minus, ShoppingBag } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { readCart, writeCart, showToast, type EatCartData } from '@/lib/eat-cart'

interface MenuItem {
  id: string
  name: string
  description?: string
  price: number
  comparePrice?: number
  category: string
  photos: string[]
  isPopular: boolean
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

const TABS = ['Menu', 'À propos', 'Galerie', 'Avis'] as const
type Tab = (typeof TABS)[number]

const SAMPLE_REVIEWS = [
  { name: 'Marie D.', text: 'Excellent service, plats délicieux !', rating: 5, date: 'il y a 2 j' },
  { name: 'Jean-Luc M.', text: 'Livraison rapide et nourriture chaude.', rating: 4, date: 'il y a 5 j' },
  { name: 'Sophie B.', text: 'Portions généreuses et prix raisonnables.', rating: 5, date: 'il y a 1 sem' },
]

export default function RestaurantScreen() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [menu, setMenu] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('Menu')
  const [menuSearch, setMenuSearch] = useState('')
  const [menuFilter, setMenuFilter] = useState('Tout')
  const [fav, setFav] = useState(false)
  // qty per menu-item id
  const [qty, setQty] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch(`/api/restaurants/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setRestaurant(d.restaurant)
        setMenu(d.menu ?? [])
        // hydrate qty from an existing cart for this same restaurant
        const existing = readCart()
        if (existing && existing.restaurantId === id) {
          const map: Record<string, number> = {}
          existing.items.forEach((l) => (map[l.item.id] = l.qty))
          setQty(map)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  const allItems = menu.flatMap((c) => c.items)
  const categories = ['Tout', ...menu.map((c) => c.category)]

  function persistCart(nextQty: Record<string, number>) {
    if (!restaurant) return
    const items = allItems
      .filter((m) => nextQty[m.id] > 0)
      .map((m) => ({ item: { id: m.id, name: m.name, price: m.price, photos: m.photos ?? [] }, qty: nextQty[m.id] }))
    const data: EatCartData = {
      restaurantId: restaurant.id,
      items,
      restaurant: { name: restaurant.name, deliveryFee: restaurant.deliveryFee, minOrder: restaurant.minOrder },
    }
    writeCart(items.length ? data : null)
  }

  function add(m: MenuItem) {
    setQty((prev) => {
      const next = { ...prev, [m.id]: (prev[m.id] ?? 0) + 1 }
      persistCart(next)
      return next
    })
    showToast(`${m.name} ajouté au panier`)
  }
  function remove(m: MenuItem) {
    setQty((prev) => {
      const cur = prev[m.id] ?? 0
      const next = { ...prev }
      if (cur <= 1) delete next[m.id]
      else next[m.id] = cur - 1
      persistCart(next)
      return next
    })
  }

  const cartCount = Object.values(qty).reduce((s, n) => s + n, 0)
  const cartTotal = allItems.reduce((s, m) => s + (qty[m.id] ?? 0) * m.price, 0)

  const filtered = allItems
    .filter((m) => menuFilter === 'Tout' || m.category === menuFilter)
    .filter((m) => menuSearch === '' || m.name.toLowerCase().includes(menuSearch.toLowerCase()))
  const galleryItems = allItems.slice(0, 9)

  if (loading) {
    return (
      <div className="bg-white">
        <div className="h-[280px] w-full animate-pulse bg-gray-200" />
        <div className="space-y-3 p-4">
          <div className="h-6 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          <div className="grid grid-cols-2 gap-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[180px] animate-pulse rounded-2xl bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!restaurant) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white text-[#888]">
        <div className="text-5xl">😕</div>
        <p>Restaurant introuvable</p>
        <button onClick={() => router.back()} className="text-sm font-bold text-[#F97316]">Retour</button>
      </div>
    )
  }

  return (
    <div className={`min-h-screen bg-white ${cartCount > 0 ? 'pb-24' : 'pb-24'}`}>
      {/* Hero */}
      <div className="relative">
        <FoodImage name={restaurant.name} src={restaurant.coverPhoto} className="h-[280px] w-full" glyphClassName="text-7xl" />
        <button
          onClick={() => router.back()}
          className="absolute left-4 top-4 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] active:scale-90"
        >
          <ArrowLeft size={18} className="text-[#1a1a1a]" />
        </button>
        <div className="absolute right-4 top-4 flex gap-2.5">
          <button
            onClick={() => { setFav((v) => !v); showToast(fav ? 'Retiré des favoris' : 'Ajouté aux favoris') }}
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.12)] active:scale-90 ${fav ? 'bg-[#EF4444]' : 'bg-white'}`}
          >
            <Heart size={16} className={fav ? 'fill-white text-white' : 'fill-[#EF4444] text-[#EF4444]'} />
          </button>
          <button className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] active:scale-90">
            <Share2 size={16} className="text-[#1a1a1a]" />
          </button>
        </div>
        {/* Thumbnail strip */}
        {allItems.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-black/35 px-4 py-2.5">
            {allItems.slice(0, 5).map((d, i) => (
              <div key={d.id} className="relative">
                <FoodImage name={d.name} src={d.photos?.[0]} className="h-[50px] w-[50px] rounded-[10px] border-2 border-white" glyphClassName="text-base" />
                {i === 4 && allItems.length > 5 && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/50 text-[13px] font-bold text-white">
                    +{allItems.length - 5}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky tabs */}
      <div className="sticky top-0 z-20 flex border-b border-[#f0f0f0] bg-white">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 border-b-[2.5px] py-3.5 text-[13px] ${
              activeTab === tab ? 'border-[#F97316] font-extrabold text-[#F97316]' : 'border-transparent font-semibold text-[#aaa]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Info section */}
      <div className="px-4 pb-2 pt-4">
        <div className="mb-1.5 flex justify-end">
          <span className="flex items-center gap-1">
            <Star size={14} className="fill-[#F97316] text-[#F97316]" />
            <span className="text-[15px] font-extrabold text-[#1a1a1a]">{restaurant.rating.toFixed(1)}</span>
            <span className="text-[13px] text-[#888]">({(restaurant.reviewCount / 1000).toFixed(1)}K)</span>
          </span>
        </div>
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">{restaurant.name}</h1>
        <p className="mb-1.5 text-[13px] text-[#555]">{Array.isArray(restaurant.cuisine) ? restaurant.cuisine.join(', ') : ''}</p>
        <div className="mb-2 flex items-center gap-1">
          <MapPin size={13} className="text-[#888]" />
          <span className="truncate text-[13px] text-[#555]">{restaurant.address}, {restaurant.city}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1 text-xs text-[#888]">
            <MapPin size={12} /> {restaurant.deliveryFee === 0 ? 'Livraison gratuite' : `${restaurant.deliveryFee.toFixed(2)} €`}
          </span>
          <span className="flex items-center gap-1 text-xs text-[#888]">
            <Clock size={12} /> {restaurant.deliveryTime} Min
          </span>
          <button onClick={() => setActiveTab('Avis')} className="text-[13px] font-semibold text-[#F97316]">Avis</button>
        </div>
      </div>

      {/* Menu tab */}
      {activeTab === 'Menu' && (
        <div className="px-4 pt-3">
          <p className="mb-3 text-[17px] font-extrabold text-[#1a1a1a]">
            Menu <span className="text-[#F97316]">({allItems.length} Articles)</span>
          </p>

          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-[#f5f5f5] px-3 py-2.5">
              <Search size={14} className="text-[#bbb]" />
              <input
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Chercher des articles"
                className="flex-1 bg-transparent text-[13px] text-[#1a1a1a] placeholder:text-[#bbb] focus:outline-none"
              />
            </div>
          </div>

          {categories.length > 1 && (
            <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
              {categories.map((f) => (
                <button
                  key={f}
                  onClick={() => setMenuFilter(f)}
                  className={`shrink-0 rounded-[20px] border-[1.5px] px-3.5 py-2 text-xs font-semibold active:scale-95 ${
                    menuFilter === f ? 'border-[#F97316] bg-[#F97316] text-white' : 'border-transparent bg-[#f5f5f5] text-[#555]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#888]">Aucun article trouvé</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-2">
              {filtered.map((dish) => {
                const q = qty[dish.id] ?? 0
                return (
                  <div key={dish.id} className="rounded-[14px] bg-white pb-2.5 shadow-bolt-card">
                    <div className="relative">
                      <FoodImage name={dish.name} src={dish.photos?.[0]} className="h-[115px] w-full rounded-t-[14px]" glyphClassName="text-3xl" />
                      {dish.comparePrice && dish.comparePrice > dish.price && (
                        <span className="absolute left-1.5 top-1.5 rounded-lg bg-[#22C55E] px-1.5 py-[3px] text-[9px] font-bold text-white">
                          PROMO
                        </span>
                      )}
                      {q > 0 ? (
                        <div className="absolute -bottom-3 right-2 flex items-center gap-1 rounded-full bg-white p-1 shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
                          <button onClick={() => remove(dish)} className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FFF3ED] text-[#F97316] active:scale-90">
                            <Minus size={12} strokeWidth={3} />
                          </button>
                          <span className="w-4 text-center text-xs font-bold">{q}</span>
                          <button onClick={() => add(dish)} className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F97316] text-white active:scale-90">
                            <Plus size={12} strokeWidth={3} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => add(dish)}
                          className="absolute -bottom-3 right-2 flex h-8 w-8 items-center justify-center rounded-full border border-[#f0f0f0] bg-white text-[#F97316] shadow-[0_2px_8px_rgba(0,0,0,0.12)] active:scale-90"
                          aria-label={`Ajouter ${dish.name}`}
                        >
                          <Plus size={16} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                    <div className="px-2.5 pt-3.5">
                      <p className="truncate text-[13px] font-bold text-[#1a1a1a]">{dish.name}</p>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-[#aaa]">
                        <Star size={11} className="fill-[#F97316] text-[#F97316]" />
                        {restaurant.rating.toFixed(1)}
                      </div>
                      <p className="mt-1 text-sm font-extrabold text-[#F97316]">{dish.price.toFixed(2)} €</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* About tab */}
      {activeTab === 'À propos' && (
        <div className="p-4">
          <h2 className="mb-2.5 text-[17px] font-extrabold text-[#1a1a1a]">À propos de {restaurant.name}</h2>
          <p className="mb-4 text-sm leading-relaxed text-[#555]">{restaurant.description || 'Restaurant partenaire Grubano.'}</p>
          <div className="space-y-3 rounded-[14px] bg-[#f8f8f8] p-4">
            <div className="flex items-center gap-2.5"><MapPin size={15} className="text-[#F97316]" /><span className="text-sm text-[#444]">{restaurant.address}, {restaurant.city}</span></div>
            <div className="flex items-center gap-2.5"><Clock size={15} className="text-[#F97316]" /><span className="text-sm text-[#444]">Lun–Dim : 10h00 – 23h00</span></div>
          </div>
        </div>
      )}

      {/* Gallery tab */}
      {activeTab === 'Galerie' && (
        <div className="grid grid-cols-3 gap-1 p-2">
          {galleryItems.map((d) => (
            <FoodImage key={d.id} name={d.name} src={d.photos?.[0]} className="aspect-square w-full rounded-lg" glyphClassName="text-2xl" />
          ))}
          {galleryItems.length === 0 && <p className="col-span-3 py-12 text-center text-sm text-[#888]">Galerie bientôt disponible</p>}
        </div>
      )}

      {/* Reviews tab */}
      {activeTab === 'Avis' && (
        <div className="p-4">
          <div className="mb-4 flex flex-col items-center rounded-2xl bg-[#f8f8f8] py-5">
            <span className="text-[48px] font-extrabold text-[#1a1a1a]">{restaurant.rating.toFixed(1)}</span>
            <div className="my-1.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={18} className={s <= Math.round(restaurant.rating) ? 'fill-[#F97316] text-[#F97316]' : 'text-[#ddd]'} />
              ))}
            </div>
            <span className="text-[13px] text-[#888]">{restaurant.reviewCount.toLocaleString()} avis</span>
          </div>
          {SAMPLE_REVIEWS.map((r, i) => (
            <div key={i} className="mb-2.5 rounded-[14px] bg-[#f8f8f8] p-3.5">
              <div className="mb-2 flex items-center gap-2.5">
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F97316] text-base font-bold text-white">{r.name[0]}</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-[#1a1a1a]">{r.name}</p>
                  <p className="text-[11px] text-[#aaa]">{r.date}</p>
                </div>
                <span className="flex items-center gap-1 text-[13px] font-bold"><Star size={12} className="fill-[#F97316] text-[#F97316]" />{r.rating}</span>
              </div>
              <p className="text-[13px] leading-5 text-[#555]">{r.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar: cart (if items) else book a table */}
      <div className="fixed bottom-0 left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-[#f0f0f0] bg-white px-4 py-3.5">
        {cartCount > 0 ? (
          <button
            onClick={() => router.push('/eat/cart')}
            className="flex w-full items-center justify-between rounded-[30px] bg-[#F97316] px-6 py-4 text-white shadow-bolt-cta active:scale-[0.98]"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-[#F97316]">{cartCount}</span>
              <span className="font-bold">Voir le panier</span>
            </span>
            <span className="flex items-center gap-2 font-bold">{cartTotal.toFixed(2)} € <ShoppingBag size={18} /></span>
          </button>
        ) : (
          <button
            onClick={() => showToast('Réservation de table bientôt disponible')}
            className="w-full rounded-[30px] bg-[#F97316] py-4 text-base font-bold text-white shadow-bolt-cta active:scale-[0.98]"
          >
            Réserver une table
          </button>
        )}
      </div>
    </div>
  )
}
