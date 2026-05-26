'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin, Star, Minus, Plus, Trash2, ChevronRight, Loader2 } from 'lucide-react'

interface CartItem {
  item: { id: string; name: string; price: number; photos: string[] }
  qty: number
}
interface CartData {
  restaurantId: string
  items: CartItem[]
  restaurant: { name: string; deliveryFee: number; minOrder: number }
}

export default function CartPage() {
  const router = useRouter()
  const [cart, setCart] = useState<CartData | null>(null)
  const [address, setAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash' | 'wallet'>('card')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('grubano_cart')
      if (raw) setCart(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  function updateQty(itemId: string, delta: number) {
    setCart(prev => {
      if (!prev) return prev
      const items = prev.items
        .map(c => c.item.id === itemId ? { ...c, qty: c.qty + delta } : c)
        .filter(c => c.qty > 0)
      const updated = { ...prev, items }
      sessionStorage.setItem('grubano_cart', JSON.stringify(updated))
      return updated
    })
  }

  function removeItem(itemId: string) {
    setCart(prev => {
      if (!prev) return prev
      const updated = { ...prev, items: prev.items.filter(c => c.item.id !== itemId) }
      sessionStorage.setItem('grubano_cart', JSON.stringify(updated))
      return updated
    })
  }

  async function placeOrder() {
    if (!cart) return
    if (!address.trim()) { setError('Veuillez entrer une adresse de livraison'); return }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: cart.restaurantId,
          items: cart.items.map(c => ({
            itemId: c.item.id,
            name:   c.item.name,
            qty:    c.qty,
            price:  c.item.price,
            options: [],
          })),
          deliveryAddress: address,
          paymentMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erreur lors de la commande'); return }
      sessionStorage.removeItem('grubano_cart')
      router.push(`/eat/track/${data.orderId}`)
    } catch {
      setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  const subtotal     = cart?.items.reduce((s, c) => s + c.item.price * c.qty, 0) ?? 0
  const deliveryFee  = cart?.restaurant.deliveryFee ?? 0
  const total        = subtotal + deliveryFee
  const pointsEarned = Math.floor(total)

  if (!cart || cart.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 text-gray-500 p-6">
        <span className="text-5xl">🛒</span>
        <p className="font-semibold text-gray-700 text-center">Votre panier est vide</p>
        <button onClick={() => router.push('/eat')} className="text-orange-500 font-medium text-sm">
          Parcourir les restaurants
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 bg-white z-10 flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <button onClick={() => router.back()} className="p-1.5">
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <h1 className="font-bold text-gray-900">Mon panier</h1>
        <span className="ml-auto text-xs text-gray-400">{cart.restaurant.name}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Items */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {cart.items.map(({ item, qty }) => (
            <div key={item.id} className="flex items-center gap-3 p-3 border-b last:border-0 border-gray-50">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 flex-shrink-0 flex items-center justify-center text-xl overflow-hidden">
                {item.photos[0]
                  ? <img src={item.photos[0]} alt={item.name} className="w-full h-full object-cover" />
                  : '🍽️'
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                <p className="text-sm text-gray-700 font-medium">{(item.price * qty).toFixed(2)}€</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => updateQty(item.id, -1)} className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                  <Minus size={11} />
                </button>
                <span className="text-sm font-bold w-4 text-center">{qty}</span>
                <button onClick={() => updateQty(item.id, 1)} className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center">
                  <Plus size={11} />
                </button>
              </div>
              <button onClick={() => removeItem(item.id)} className="p-1 ml-1">
                <Trash2 size={14} className="text-red-400" />
              </button>
            </div>
          ))}
        </div>

        {/* Delivery address */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <MapPin size={15} className="text-orange-500" />
            Adresse de livraison
          </label>
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Numéro, rue, ville, code postal…"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-xl p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>

        {/* Payment method */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-900">Paiement</p>
          <div className="flex gap-2">
            {[
              { value: 'card' as const,   label: '💳 Carte' },
              { value: 'cash' as const,   label: '💵 Espèces' },
              { value: 'wallet' as const, label: '👛 Wallet' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setPaymentMethod(opt.value)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  paymentMethod === opt.value
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Points preview */}
        <div className="bg-amber-50 rounded-2xl p-3 flex items-center gap-2">
          <Star size={16} className="text-amber-500 fill-amber-500 flex-shrink-0" />
          <span className="text-sm text-amber-700">
            Vous gagnerez <strong>{pointsEarned} points</strong> fidélité avec cette commande
          </span>
        </div>

        {/* Totals */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Sous-total</span><span>{subtotal.toFixed(2)}€</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Livraison</span><span>{deliveryFee.toFixed(2)}€</span>
          </div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-100 mt-1">
            <span>Total</span><span className="text-orange-600">{total.toFixed(2)}€</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 text-center">{error}</p>
        )}

        {/* CTA */}
        <button
          onClick={placeOrder}
          disabled={submitting || cart.items.length === 0}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors text-base"
        >
          {submitting ? (
            <><Loader2 size={18} className="animate-spin" /> Envoi en cours…</>
          ) : (
            <>Commander ({total.toFixed(2)}€) <ChevronRight size={18} /></>
          )}
        </button>
      </div>
    </div>
  )
}
