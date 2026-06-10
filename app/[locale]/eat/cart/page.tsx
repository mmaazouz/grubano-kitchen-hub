'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { Minus, Plus, Trash2, Tag, MapPin, CreditCard, ShoppingBag, Bike, Package } from 'lucide-react'
import { Button, Badge, PriceTag } from '@/components/design-system'
import FoodImage from '@/components/eat/FoodImage'
import { readCart, writeCart, showToast, type EatCartData } from '@/lib/eat-cart'

type Fulfillment = 'delivery' | 'pickup'

export default function CartScreen() {
  const t = useTranslations('eat.cart')
  const router = useRouter()
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [fulfillment, setFulfillment] = useState<Fulfillment>('delivery')
  const [address, setAddress] = useState('')
  const [payment, setPayment] = useState<'card' | 'cash'>('card')
  const [promoInput, setPromoInput] = useState('')
  const [discount, setDiscount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Welcome-discount preview (brique 5B companion). The grubano_ref cookie is
  // httpOnly so the client can't read it — GET /api/referral/preview tells us,
  // server-side, whether this visitor is eligible. INDICATIVE only: the server
  // recomputes the real discount at checkout (never trust this amount).
  const [welcome, setWelcome] = useState<
    { eligible: boolean; discountPct: number; discountCap: number; creatorName?: string } | null
  >(null)

  useEffect(() => {
    setCart(readCart())
    setHydrated(true)
  }, [])

  // Ask the server (once) whether a welcome discount applies for this visitor.
  // Read-only; degrades silently to "no preview" on any error or when not
  // eligible / not logged in.
  useEffect(() => {
    let cancelled = false
    fetch('/api/referral/preview')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.eligible === 'boolean') setWelcome(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // If the cart has no restaurant.address (older cart shape), fetch it once on pickup.
  useEffect(() => {
    if (fulfillment !== 'pickup' || !cart || cart.restaurant.address) return
    let cancelled = false
    fetch(`/api/restaurants/${cart.restaurantId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.restaurant) return
        const next: EatCartData = {
          ...cart,
          restaurant: {
            ...cart.restaurant,
            address: d.restaurant.address,
            city: d.restaurant.city,
            deliveryTime: d.restaurant.deliveryTime,
          },
        }
        setCart(next)
        writeCart(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [fulfillment, cart])

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
    showToast(t('toastItemRemoved'))
  }

  function applyPromo() {
    const code = promoInput.trim().toUpperCase()
    if (code === 'FRENCH10') {
      setDiscount(0.1)
      showToast(t('toastPromoApplied'))
    } else {
      setDiscount(0)
      showToast(t('toastPromoInvalid'))
    }
  }

  const subtotal = cart?.items.reduce((s, l) => s + l.item.price * l.qty, 0) ?? 0
  const deliveryFee = useMemo(() => {
    if (!cart) return 0
    if (fulfillment === 'pickup') return 0
    return cart.restaurant.deliveryFee || 2.99
  }, [cart, fulfillment])
  const discountAmount = subtotal * discount
  // Indicative welcome discount = min(subtotal × pct, cap), matching 5B's server
  // formula. Source of truth stays server-side at checkout.
  const welcomeAmount = useMemo(() => {
    if (!welcome?.eligible) return 0
    const raw = Math.min(subtotal * welcome.discountPct, welcome.discountCap)
    return Math.round(raw * 100) / 100
  }, [welcome, subtotal])
  const total = Math.max(0, subtotal - discountAmount - welcomeAmount + deliveryFee)
  const totalItems = cart?.items.reduce((s, l) => s + l.qty, 0) ?? 0
  const readyAt = useMemo(() => {
    const minutes = cart?.restaurant.deliveryTime ?? 20
    const d = new Date(Date.now() + minutes * 60_000)
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }, [cart])

  async function placeOrder() {
    if (!cart) return
    let deliveryAddress = ''
    if (fulfillment === 'pickup') {
      const restoAddr = [cart.restaurant.address, cart.restaurant.city].filter(Boolean).join(', ')
      deliveryAddress = restoAddr
        ? t('pickupAt', { address: restoAddr })
        : t('pickupLabel')
    } else {
      if (!address.trim() || address.trim().length < 5) {
        setError(t('errorAddressRequired'))
        return
      }
      deliveryAddress = address
    }

    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: cart.restaurantId,
          items: cart.items.map((l) => ({
            itemId: l.item.id,
            name: l.item.name,
            qty: l.qty,
            price: l.item.price,
            options: l.options ? [l.options as unknown as Record<string, unknown>] : [],
          })),
          deliveryAddress,
          paymentMethod: payment,
          // The server (POST /api/orders) honours this: pickup → delivery fee 0,
          // and it's stored on Order.fulfillmentType for reporting.
          fulfillmentType: fulfillment,
        }),
      })
      if (res.status === 401) {
        router.push('/eat/auth')
        return
      }
      const data = await res.json()
      if (!res.ok) {
        // Chantier horaires — POST /api/orders answers 409 {code:'closed',
        // nextOpening?} while the establishment is closed (menu browsing and
        // future reservations stay free, T3.Q3). Spell out the next opening.
        if (res.status === 409 && data?.code === 'closed') {
          const label = data?.nextOpening?.label as string | undefined
          setError(label ? t('errClosedWithOpening', { label }) : t('errClosedNoOpening'))
          return
        }
        setError(data.error ?? t('errorOrderFailed'))
        return
      }
      writeCart(null)
      router.push(`/eat/track/${data.orderId}`)
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-grubano-bg p-4">
        <div className="mb-3 h-6 w-1/3 animate-pulse rounded bg-grubano-surface-muted" />
        <div className="h-40 animate-pulse rounded-grubano-lg bg-grubano-surface" />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-grubano-bg">
        <div className="border-b border-grubano-border bg-white px-4 pb-4 pt-3">
          <h1 className="font-display text-[22px] font-extrabold text-grubano-ink">{t('title')}</h1>
        </div>
        <div className="flex flex-col items-center justify-center px-10 pt-24 text-center">
          <ShoppingBag size={64} className="text-grubano-primary" />
          <p className="mt-4 text-xl font-extrabold text-grubano-ink">{t('emptyTitle')}</p>
          <p className="mt-2 text-grubano-sm leading-relaxed text-grubano-ink-muted">
            {t('emptyDescription')}
          </p>
          <Button variant="primary" size="pill" className="mt-6" onClick={() => router.push('/eat')}>
            {t('exploreDishes')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-grubano-bg pb-[160px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-grubano-border bg-white px-4 pb-4 pt-3">
        <h1 className="font-display text-[22px] font-extrabold text-grubano-ink">{t('title')}</h1>
        <span className="text-grubano-sm font-semibold text-grubano-primary">
          {t('itemCount', { count: totalItems })}
        </span>
      </div>

      {/* Fulfilment tabs */}
      <div className="mx-4 mt-3 flex gap-2 rounded-grubano-lg bg-grubano-surface p-1 shadow-grubano-sm">
        {([
          { value: 'delivery', label: t('tabDelivery'), icon: <Bike size={16} /> },
          { value: 'pickup', label: t('tabPickup'), icon: <Package size={16} /> },
        ] as const).map((opt) => {
          const active = fulfillment === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setFulfillment(opt.value)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-grubano-md py-2.5 text-grubano-sm font-bold transition active:scale-[0.99] ${
                active ? 'bg-grubano-primary text-white shadow-grubano-cta' : 'text-grubano-ink-muted'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Items */}
      <div className="mx-4 mt-3 space-y-3 rounded-grubano-lg bg-grubano-surface p-3 shadow-grubano-sm">
        {cart.items.map(({ item, qty, options }) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-grubano-border pb-3 last:border-0 last:pb-0">
            <FoodImage
              name={item.name}
              src={item.photos?.[0]}
              className="h-[70px] w-[70px] shrink-0 rounded-grubano-md"
              glyphClassName="text-2xl"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-grubano-sm font-bold text-grubano-ink">{item.name}</p>
              {options?.note && (
                <p className="truncate text-[11px] text-grubano-ink-faint">📝 {options.note}</p>
              )}
              {options?.supplements && options.supplements.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {options.supplements.map((s) => (
                    <Badge key={s.name} tone="primary" size="sm">
                      + {s.name}
                    </Badge>
                  ))}
                </div>
              )}
              <PriceTag amount={item.price * qty} size="sm" className="mt-1" />
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <button
                onClick={() => removeItem(item.id)}
                aria-label={t('removeAria')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-grubano-danger-tint active:scale-90"
              >
                <Trash2 size={16} className="text-grubano-danger" />
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQty(item.id, -1)}
                  aria-label="-"
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] border-grubano-primary active:scale-90"
                >
                  <Minus size={14} className="text-grubano-primary" />
                </button>
                <span className="min-w-5 text-center text-[15px] font-bold text-grubano-ink">{qty}</span>
                <button
                  onClick={() => updateQty(item.id, 1)}
                  aria-label="+"
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-grubano-primary active:scale-90"
                >
                  <Plus size={14} className="text-white" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Address (delivery) OR pickup card */}
      {fulfillment === 'delivery' ? (
        <div className="mx-4 mt-2.5 rounded-grubano-lg bg-grubano-surface p-4 shadow-grubano-sm">
          <div className="flex items-start gap-3">
            <MapPin size={20} className="mt-0.5 shrink-0 text-grubano-primary" />
            <div className="flex-1">
              <p className="text-grubano-sm font-bold text-grubano-ink">{t('deliveryAddress')}</p>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('addressPlaceholder')}
                className="mt-1 w-full bg-transparent text-xs text-grubano-ink-muted placeholder:text-grubano-ink-faint focus:outline-none"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-4 mt-2.5 rounded-grubano-lg bg-grubano-tint p-4">
          <div className="flex items-start gap-3">
            <Package size={20} className="mt-0.5 shrink-0 text-grubano-primary" />
            <div className="flex-1">
              <p className="text-grubano-sm font-bold text-grubano-ink">{t('pickupLabel')}</p>
              <p className="mt-0.5 text-xs text-grubano-ink-muted">
                {cart.restaurant.name}
                {cart.restaurant.address ? ` — ${cart.restaurant.address}` : ''}
                {cart.restaurant.city ? `, ${cart.restaurant.city}` : ''}
              </p>
              <p className="mt-1 text-xs font-semibold text-grubano-primary">
                {t('readyAround', { time: readyAt, minutes: cart.restaurant.deliveryTime ?? 20 })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Payment */}
      <div className="mx-4 mt-2.5 rounded-grubano-lg bg-grubano-surface p-4 shadow-grubano-sm">
        <div className="flex items-center gap-3">
          <CreditCard size={20} className="shrink-0 text-grubano-primary" />
          <div className="flex-1">
            <p className="text-grubano-sm font-bold text-grubano-ink">{t('paymentMethod')}</p>
            <p className="mt-0.5 text-xs text-grubano-ink-muted">
              {payment === 'card' ? '**** **** **** 4521' : t('cashOnDelivery')}
            </p>
          </div>
          <button onClick={() => setPayment((p) => (p === 'card' ? 'cash' : 'card'))} className="text-grubano-sm font-semibold text-grubano-primary">
            {t('edit')}
          </button>
        </div>
      </div>

      {/* Promo */}
      <div className="mx-4 mt-2.5 rounded-grubano-lg bg-grubano-surface p-3.5 shadow-grubano-sm">
        <div className="flex items-center gap-2.5">
          <Tag size={18} className="text-grubano-primary" />
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            placeholder={t('promoPlaceholder')}
            className="flex-1 bg-transparent text-grubano-sm text-grubano-ink placeholder:text-grubano-ink-faint focus:outline-none"
          />
          <Button variant="primary" size="sm" onClick={applyPromo}>
            {t('apply')}
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="mx-4 mt-2.5 rounded-grubano-lg bg-grubano-surface p-4 shadow-grubano-sm">
        <p className="mb-3.5 text-[17px] font-extrabold text-grubano-ink">{t('summary')}</p>
        <div className="mb-2.5 flex justify-between text-grubano-sm">
          <span className="text-grubano-ink-muted">{t('subtotal')}</span>
          <span className="font-semibold text-grubano-ink">{subtotal.toFixed(2)} €</span>
        </div>
        {discount > 0 && (
          <div className="mb-2.5 flex justify-between text-grubano-sm">
            <span className="text-grubano-success">{t('discount', { percent: discount * 100 })}</span>
            <span className="font-semibold text-grubano-success">-{discountAmount.toFixed(2)} €</span>
          </div>
        )}
        {welcomeAmount > 0 && (
          <div className="mb-2.5 flex justify-between text-grubano-sm">
            <span className="text-grubano-success">
              {welcome?.creatorName
                ? t('welcomeDiscountFrom', { creator: welcome.creatorName })
                : t('welcomeDiscount')}
            </span>
            <span className="font-semibold text-grubano-success">-{welcomeAmount.toFixed(2)} €</span>
          </div>
        )}
        <div className="mb-2.5 flex justify-between text-grubano-sm">
          <span className="text-grubano-ink-muted">{fulfillment === 'pickup' ? t('feePickup') : t('feeDelivery')}</span>
          <span className="font-semibold text-grubano-ink">{fulfillment === 'pickup' ? t('free') : `${deliveryFee.toFixed(2)} €`}</span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-grubano-border pt-3">
          <span className="text-base font-extrabold text-grubano-ink">{t('total')}</span>
          <PriceTag amount={total} size="lg" />
        </div>
      </div>

      {error && (
        <p className="mx-4 mt-3 rounded-grubano-md bg-grubano-danger-tint p-3 text-center text-grubano-sm text-grubano-danger">
          {error}
        </p>
      )}

      {/* Checkout bar (above tab bar) */}
      <div className="fixed bottom-[60px] left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-grubano-border bg-white px-4 py-3.5">
        <Button
          variant="primary"
          size="pill"
          fullWidth
          loading={submitting}
          onClick={placeOrder}
        >
          <span className="flex-1 text-left">{submitting ? t('submitting') : t('placeOrder')}</span>
          {!submitting && <span>{total.toFixed(2)} €</span>}
        </Button>
      </div>
    </div>
  )
}
