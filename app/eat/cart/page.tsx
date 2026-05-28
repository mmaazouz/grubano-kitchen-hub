'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin, Minus, Plus, Trash2, Gift, Loader2 } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

interface CartItem {
  item: { id: string; name: string; price: number; photos: string[] }
  qty: number
}
interface CartData {
  restaurantId: string
  items: CartItem[]
  restaurant: { name: string; deliveryFee: number; minOrder: number }
}

const PAYMENT_METHODS = [
  { value: 'card' as const, label: 'Carte', icon: '💳' },
  { value: 'wallet' as const, label: 'Apple Pay', icon: '' },
  { value: 'cash' as const, label: 'Google Pay', icon: 'G' },
]

export default function CartPage() {
  const router = useRouter()
  const [cart, setCart] = useState<CartData | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [address, setAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash' | 'wallet'>('card')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('grubano_cart')
      if (raw) setCart(JSON.parse(raw))
    } catch {
      /* ignore */
    } finally {
      setHydrated(true)
    }
  }, [])

  function persist(updated: CartData) {
    sessionStorage.setItem('grubano_cart', JSON.stringify(updated))
  }

  function updateQty(itemId: string, delta: number) {
    setCart((prev) => {
      if (!prev) return prev
      const items = prev.items
        .map((c) => (c.item.id === itemId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
      const updated = { ...prev, items }
      persist(updated)
      return updated
    })
  }

  function removeItem(itemId: string) {
    setCart((prev) => {
      if (!prev) return prev
      const updated = { ...prev, items: prev.items.filter((c) => c.item.id !== itemId) }
      persist(updated)
      return updated
    })
  }

  async function placeOrder() {
    if (!cart) return
    if (!address.trim()) {
      setError('Veuillez entrer une adresse de livraison')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: cart.restaurantId,
          items: cart.items.map((c) => ({
            itemId: c.item.id,
            name: c.item.name,
            qty: c.qty,
            price: c.item.price,
            options: [],
          })),
          deliveryAddress: address,
          paymentMethod,
        }),
      })
      if (res.status === 401) {
        router.push('/eat/auth')
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la commande')
        return
      }
      sessionStorage.removeItem('grubano_cart')
      router.push(`/eat/track/${data.orderId}`)
    } catch {
      setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  const subtotal = cart?.items.reduce((s, c) => s + c.item.price * c.qty, 0) ?? 0
  const deliveryFee = cart?.restaurant.deliveryFee ?? 1.99
  const total = subtotal + deliveryFee
  const pointsEarned = Math.floor(total)
  const minOrder = cart?.restaurant.minOrder ?? 0
  const belowMin = subtotal < minOrder

  if (!hydrated) {
    return (
      <div className="space-y-4 p-5">
        <div className="h-6 w-1/3 animate-pulse rounded-full bg-gray-200" />
        <div className="h-28 animate-pulse rounded-[20px] bg-gray-200" />
        <div className="h-36 animate-pulse rounded-[20px] bg-gray-100" />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#FAFAFA] p-6 text-center">
        <div className="text-6xl">🛒</div>
        <p className="text-lg font-bold text-[#1a1a2e]">Votre panier est vide</p>
        <p className="-mt-2 text-sm text-gray-400">Ajoutez de bons petits plats pour commencer</p>
        <button
          onClick={() => router.push('/eat')}
          className="mt-2 rounded-2xl bg-[#E8593C] px-6 py-3.5 text-sm font-bold text-white shadow-[0_4px_24px_rgba(232,89,60,0.35)] transition active:scale-95"
        >
          Parcourir les restaurants
        </button>
      </div>
    )
  }

  return (
    <div className="bg-[#FAFAFA] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-black/[0.05] bg-[#FAFAFA]/95 px-4 py-3 backdrop-blur-lg">
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm transition active:scale-90"
        >
          <ArrowLeft size={19} className="text-gray-800" />
        </button>
        <div>
          <h1 className="text-[17px] font-bold tracking-tight text-[#1a1a2e]">Mon panier</h1>
          <p className="text-xs text-gray-400">{cart.restaurant.name}</p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Items */}
        <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          {cart.items.map(({ item, qty }) => (
            <div key={item.id} className="flex items-center gap-3 border-b border-gray-50 p-3.5 last:border-0">
              <FoodImage name={item.name} src={item.photos?.[0]} className="h-16 w-16 shrink-0 rounded-2xl" glyphClassName="text-2xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[#1a1a2e]">{item.name}</p>
                <p className="mt-0.5 text-sm font-bold text-[#E8593C]">{(item.price * qty).toFixed(2)}€</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateQty(item.id, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition active:scale-90"
                >
                  <Minus size={13} strokeWidth={3} />
                </button>
                <span className="w-5 text-center text-sm font-bold">{qty}</span>
                <button
                  onClick={() => updateQty(item.id, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8593C] text-white transition active:scale-90"
                >
                  <Plus size={13} strokeWidth={3} />
                </button>
              </div>
              <button onClick={() => removeItem(item.id)} className="ml-1 p-1 transition active:scale-90">
                <Trash2 size={15} className="text-gray-300 hover:text-red-400" />
              </button>
            </div>
          ))}
        </div>

        {/* Delivery address */}
        <div className="space-y-2 rounded-[20px] bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          <label className="flex items-center gap-2 text-sm font-bold text-[#1a1a2e]">
            <MapPin size={16} className="text-[#E8593C]" />
            Adresse de livraison
          </label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Numéro, rue, ville, code postal…"
            rows={2}
            className="w-full resize-none rounded-2xl border border-black/[0.06] bg-[#FAFAFA] p-3 text-sm transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>

        {/* Payment methods */}
        <div className="space-y-2 rounded-[20px] bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          <p className="text-sm font-bold text-[#1a1a2e]">Paiement</p>
          <div className="flex gap-2">
            {PAYMENT_METHODS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPaymentMethod(opt.value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl border py-3 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                  paymentMethod === opt.value
                    ? 'border-[#E8593C] bg-[#FFF7F3] text-[#E8593C]'
                    : 'border-black/[0.06] bg-white text-gray-600'
                }`}
              >
                <span>{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Points preview */}
        <div className="flex items-center gap-3 rounded-[20px] bg-gradient-to-r from-[#FFF7F3] to-amber-50 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Gift size={19} className="text-amber-500" />
          </div>
          <p className="text-sm text-amber-900">
            Vous gagnerez <strong>{pointsEarned} points</strong> fidélité 🎁
          </p>
        </div>

        {/* Summary */}
        <div className="space-y-2 rounded-[20px] bg-white p-4 text-sm shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between text-gray-500">
            <span>Sous-total</span>
            <span className="font-medium text-gray-700">{subtotal.toFixed(2)}€</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Frais de livraison</span>
            <span className="font-medium text-gray-700">{deliveryFee.toFixed(2)}€</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-gray-100 pt-3 text-base font-bold text-[#1a1a2e]">
            <span>Total</span>
            <span>{total.toFixed(2)}€</span>
          </div>
        </div>

        {belowMin && (
          <p className="rounded-2xl bg-amber-50 p-3 text-center text-xs font-medium text-amber-700">
            Commande minimum {minOrder.toFixed(2)}€ — ajoutez encore {(minOrder - subtotal).toFixed(2)}€
          </p>
        )}
        {error && <p className="rounded-2xl bg-red-50 p-3 text-center text-sm text-red-600">{error}</p>}
      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-black/[0.05] bg-white/95 px-5 py-3.5 backdrop-blur-lg">
        <button
          onClick={placeOrder}
          disabled={submitting || belowMin}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E8593C] py-4 text-base font-bold text-white shadow-[0_4px_24px_rgba(232,89,60,0.35)] transition active:scale-[0.98] disabled:bg-orange-300"
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Envoi en cours…
            </>
          ) : (
            <>Commander · {total.toFixed(2)}€</>
          )}
        </button>
      </div>
    </div>
  )
}
