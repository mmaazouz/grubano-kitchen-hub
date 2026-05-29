'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Minus, Plus, Trash2, Tag, MapPin, CreditCard, ShoppingBag, Loader2 } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { readCart, writeCart, showToast, type EatCartData } from '@/lib/eat-cart'

export default function CartScreen() {
  const router = useRouter()
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [address, setAddress] = useState('')
  const [payment, setPayment] = useState<'card' | 'cash'>('card')
  const [promoInput, setPromoInput] = useState('')
  const [discount, setDiscount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setCart(readCart())
    setHydrated(true)
  }, [])

  function update(next: EatCartData | null) {
    setCart(next)
    writeCart(next)
  }

  function updateQty(itemId: string, delta: number) {
    if (!cart) return
    const items = cart.items
      .map((l) => (l.item.id === itemId ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0)
    update(items.length ? { ...cart, items } : null)
  }
  function removeItem(itemId: string) {
    if (!cart) return
    const items = cart.items.filter((l) => l.item.id !== itemId)
    update(items.length ? { ...cart, items } : null)
    showToast('Article retiré')
  }

  function applyPromo() {
    const code = promoInput.trim().toUpperCase()
    if (code === 'FRENCH10') {
      setDiscount(0.1)
      showToast('Code promo appliqué ! -10%')
    } else {
      setDiscount(0)
      showToast('Code promo invalide')
    }
  }

  async function placeOrder() {
    if (!cart) return
    if (!address.trim() || address.trim().length < 5) {
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
          items: cart.items.map((l) => ({ itemId: l.item.id, name: l.item.name, qty: l.qty, price: l.item.price, options: [] })),
          deliveryAddress: address,
          paymentMethod: payment,
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
      writeCart(null)
      router.push(`/eat/track/${data.orderId}`)
    } catch {
      setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  const subtotal = cart?.items.reduce((s, l) => s + l.item.price * l.qty, 0) ?? 0
  const deliveryFee = cart && cart.items.length ? cart.restaurant.deliveryFee || 2.99 : 0
  const discountAmount = subtotal * discount
  const total = subtotal - discountAmount + deliveryFee
  const totalItems = cart?.items.reduce((s, l) => s + l.qty, 0) ?? 0

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] p-4">
        <div className="mb-3 h-6 w-1/3 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded-2xl bg-white" />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-[#f5f5f5]">
        <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
          <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">Mon Panier</h1>
        </div>
        <div className="flex flex-col items-center justify-center px-10 pt-24 text-center">
          <ShoppingBag size={64} className="text-[#F97316]" />
          <p className="mt-4 text-xl font-extrabold text-[#1a1a1a]">Votre panier est vide</p>
          <p className="mt-2 text-sm leading-relaxed text-[#888]">Ajoutez des plats pour commencer votre commande.</p>
          <button
            onClick={() => router.push('/eat')}
            className="mt-6 rounded-[30px] bg-[#F97316] px-7 py-3.5 text-[15px] font-bold text-white active:scale-95"
          >
            Explorer les plats
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] pb-[160px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">Mon Panier</h1>
        <span className="text-sm font-semibold text-[#F97316]">{totalItems} article{totalItems > 1 ? 's' : ''}</span>
      </div>

      {/* Items */}
      <div className="mx-4 mt-3 space-y-3 rounded-2xl bg-white p-3 shadow-bolt-soft">
        {cart.items.map(({ item, qty }) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-[#f5f5f5] pb-3 last:border-0 last:pb-0">
            <FoodImage name={item.name} src={item.photos?.[0]} className="h-[70px] w-[70px] shrink-0 rounded-xl" glyphClassName="text-2xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-[#1a1a1a]">{item.name}</p>
              <p className="mt-1 text-[15px] font-bold text-[#F97316]">{(item.price * qty).toFixed(2)} €</p>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <button onClick={() => removeItem(item.id)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FEE2E2] active:scale-90">
                <Trash2 size={16} className="text-[#EF4444]" />
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => updateQty(item.id, -1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] border-[#F97316] active:scale-90">
                  <Minus size={14} className="text-[#F97316]" />
                </button>
                <span className="min-w-5 text-center text-[15px] font-bold text-[#1a1a1a]">{qty}</span>
                <button onClick={() => updateQty(item.id, 1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#F97316] active:scale-90">
                  <Plus size={14} className="text-white" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Address */}
      <div className="mx-4 mt-2.5 rounded-2xl bg-white p-4 shadow-bolt-soft">
        <div className="flex items-start gap-3">
          <MapPin size={20} className="mt-0.5 shrink-0 text-[#F97316]" />
          <div className="flex-1">
            <p className="text-sm font-bold text-[#1a1a1a]">Adresse de livraison</p>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Numéro, rue, ville, code postal…"
              className="mt-1 w-full bg-transparent text-xs text-[#555] placeholder:text-[#bbb] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Payment */}
      <div className="mx-4 mt-2.5 rounded-2xl bg-white p-4 shadow-bolt-soft">
        <div className="flex items-center gap-3">
          <CreditCard size={20} className="shrink-0 text-[#F97316]" />
          <div className="flex-1">
            <p className="text-sm font-bold text-[#1a1a1a]">Méthode de paiement</p>
            <p className="mt-0.5 text-xs text-[#888]">{payment === 'card' ? '**** **** **** 4521' : 'Espèces à la livraison'}</p>
          </div>
          <button
            onClick={() => setPayment((p) => (p === 'card' ? 'cash' : 'card'))}
            className="text-[13px] font-semibold text-[#F97316]"
          >
            Modifier
          </button>
        </div>
      </div>

      {/* Promo */}
      <div className="mx-4 mt-2.5 rounded-2xl bg-white p-3.5 shadow-bolt-soft">
        <div className="flex items-center gap-2.5">
          <Tag size={18} className="text-[#F97316]" />
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            placeholder="Code promo (essayez FRENCH10)"
            className="flex-1 bg-transparent text-sm text-[#1a1a1a] placeholder:text-[#bbb] focus:outline-none"
          />
          <button onClick={applyPromo} className="rounded-[10px] bg-[#F97316] px-3.5 py-2 text-[13px] font-bold text-white active:scale-95">
            Appliquer
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="mx-4 mt-2.5 rounded-2xl bg-white p-4 shadow-bolt-soft">
        <p className="mb-3.5 text-[17px] font-extrabold text-[#1a1a1a]">Récapitulatif</p>
        <div className="mb-2.5 flex justify-between text-sm"><span className="text-[#888]">Sous-total</span><span className="font-semibold text-[#1a1a1a]">{subtotal.toFixed(2)} €</span></div>
        {discount > 0 && (
          <div className="mb-2.5 flex justify-between text-sm"><span className="text-[#22C55E]">Réduction (-{discount * 100}%)</span><span className="font-semibold text-[#22C55E]">-{discountAmount.toFixed(2)} €</span></div>
        )}
        <div className="mb-2.5 flex justify-between text-sm"><span className="text-[#888]">Frais de livraison</span><span className="font-semibold text-[#1a1a1a]">{deliveryFee.toFixed(2)} €</span></div>
        <div className="mt-1 flex justify-between border-t border-[#f5f5f5] pt-3"><span className="text-base font-extrabold text-[#1a1a1a]">Total</span><span className="text-lg font-extrabold text-[#F97316]">{total.toFixed(2)} €</span></div>
      </div>

      {error && <p className="mx-4 mt-3 rounded-xl bg-[#FEE2E2] p-3 text-center text-sm text-[#DC2626]">{error}</p>}

      {/* Checkout bar (above tab bar) */}
      <div className="fixed bottom-[60px] left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-[#f0f0f0] bg-white px-4 py-3.5">
        <button
          onClick={placeOrder}
          disabled={submitting}
          className="flex w-full items-center justify-between rounded-[30px] bg-[#F97316] px-6 py-4 text-white shadow-bolt-cta active:scale-[0.98] disabled:opacity-70"
        >
          {submitting ? (
            <span className="mx-auto flex items-center gap-2 font-bold"><Loader2 size={18} className="animate-spin" /> Envoi…</span>
          ) : (
            <>
              <span className="text-base font-bold">Passer la commande</span>
              <span className="text-base font-bold">{total.toFixed(2)} €</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
