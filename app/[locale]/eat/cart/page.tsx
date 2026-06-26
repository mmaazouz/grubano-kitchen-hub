'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSession } from 'next-auth/react'
import { useRouter } from '@/navigation'
import { Minus, Plus, Trash2, MapPin, CreditCard, ShoppingBag, Bike, Package, Sparkles } from 'lucide-react'
import { Button, Badge, PriceTag } from '@/components/design-system'
import FoodImage from '@/components/eat/FoodImage'
import CheckoutAuthSheet from '@/components/eat/CheckoutAuthSheet'
import { readCart, writeCart, showToast, type EatCartData } from '@/lib/eat-cart'
import { formatEuros, formatAmount } from '@/lib/format-money'

type Fulfillment = 'delivery' | 'pickup'

export default function CartScreen() {
  const t = useTranslations('eat.cart')
  const locale = useLocale()
  const router = useRouter()
  const { status: authStatus } = useSession()
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [fulfillment, setFulfillment] = useState<Fulfillment>('delivery')
  const [address, setAddress] = useState('')
  const [payment, setPayment] = useState<'card' | 'cash'>('card')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Account-AT-payment (Agent 138) — passwordless email+code sheet for guests at checkout.
  const [authSheet, setAuthSheet] = useState(false)
  // Chantier fidélité L1 — loyalty redemption (D4: the client sends only the
  // INTENTION usePoints; the SERVER computes the euro credit, checks the balance
  // and applies the caps). The balance + conversion scale are display-only.
  const [pointsBalance, setPointsBalance] = useState(0)
  const [centsPerPoint, setCentsPerPoint] = useState(5)
  const [usePoints, setUsePoints] = useState(false)
  // Welcome-discount preview (brique 5B companion). The grubano_ref cookie is
  // httpOnly so the client can't read it — GET /api/referral/preview tells us,
  // server-side, whether this visitor is eligible. INDICATIVE only: the server
  // recomputes the real discount at checkout (never trust this amount).
  const [welcome, setWelcome] = useState<
    { eligible: boolean; discountPct: number; discountCap: number; creatorName?: string } | null
  >(null)
  // Chantier P2 — the establishment's active promos (additive block of
  // GET /api/restaurants/[id]). DISPLAY ONLY: used for the soft minOrder
  // incentive line — the server alone resolves the real discount at checkout.
  const [promos, setPromos] = useState<Array<{
    id: string; name: string; type: string; discount: number
    minOrderEur: number | null; itemIds: string[] | null
    // L2 — channels is needed to mirror the server's channel guard so a promo
    // scoped to e.g. ['delivery'] does not FALSE-BLOCK loyalty on a pickup order.
    channels?: string[] | null
    // Promo V2 — threshold_reward params (display-only progress nudge).
    thresholdEur?: number | null; rewardKind?: string | null; rewardPct?: number | null
  }>>([])
  // Small-order fee (V1.5) — global config echoed by GET /api/restaurants/[id].
  // DISPLAY-only: the SERVER recomputes + applies the fee at order time.
  const [smallOrderCfg, setSmallOrderCfg] = useState<{ feeCents: number; thresholdCents: number } | null>(null)
  // The resto menu (flat) for the 1-click "add an item" nudge to clear the fee.
  const [menuItems, setMenuItems] = useState<Array<{ id: string; name: string; price: number; photos?: string[]; category?: string }>>([])

  useEffect(() => {
    setCart(readCart())
    setHydrated(true)
  }, [])

  // Chantier P2 — load the resto's active promos once (display only).
  useEffect(() => {
    if (!cart?.restaurantId) return
    let cancelled = false
    fetch(`/api/restaurants/${cart.restaurantId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        if (Array.isArray(d.promotions)) setPromos(d.promotions)
        if (d.smallOrder && typeof d.smallOrder.feeCents === 'number' && typeof d.smallOrder.thresholdCents === 'number') {
          setSmallOrderCfg({ feeCents: d.smallOrder.feeCents, thresholdCents: d.smallOrder.thresholdCents })
        }
        if (Array.isArray(d.menu)) {
          setMenuItems(d.menu.flatMap(
            (c: { items?: Array<{ id: string; name: string; price: number; photos?: string[]; category?: string }> }) => c.items ?? [],
          ))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart?.restaurantId])

  // Loyalty balance (L1) — only for the connected consumer. The session-aware
  // wallet route returns the OWN balance when no email is passed. Display-only:
  // the server is the sole judge of the spendable credit at checkout.
  useEffect(() => {
    if (authStatus !== 'authenticated') return
    let cancelled = false
    fetch('/api/loyalty/wallet')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        if (typeof d.pointsBalance === 'number') setPointsBalance(d.pointsBalance)
        if (typeof d.centsPerPoint === 'number' && d.centsPerPoint > 0) setCentsPerPoint(d.centsPerPoint)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [authStatus])

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

  const subtotal = cart?.items.reduce((s, l) => s + l.item.price * l.qty, 0) ?? 0
  const deliveryFee = useMemo(() => {
    if (!cart) return 0
    if (fulfillment === 'pickup') return 0
    return cart.restaurant.deliveryFee || 2.99
  }, [cart, fulfillment])
  // Indicative welcome discount = min(subtotal × pct, cap), matching 5B's server
  // formula. Source of truth stays server-side at checkout.
  const welcomeAmount = useMemo(() => {
    if (!welcome?.eligible) return 0
    const raw = Math.min(subtotal * welcome.discountPct, welcome.discountCap)
    return Math.round(raw * 100) / 100
  }, [welcome, subtotal])
  // Small-order fee (V1.5) — flat fee when the ITEMS subtotal is below the
  // threshold (config echoed by the server). Added to the displayed total; the
  // server recomputes + applies the exact fee at order time. Points/promos never
  // reduce it (it is added on top of the discounted food).
  const subtotalCentsCart = Math.round(subtotal * 100)
  const smallFeeApplies = !!smallOrderCfg && subtotal > 0 && subtotalCentsCart < smallOrderCfg.thresholdCents
  const smallFeeEur = smallFeeApplies ? smallOrderCfg!.feeCents / 100 : 0
  const missingToThresholdEur = smallOrderCfg ? Math.max(0, smallOrderCfg.thresholdCents - subtotalCentsCart) / 100 : 0
  // The displayed total = full item prices + delivery − welcome discount + the
  // small-order fee. The loyalty credit is resolved + shown on the checkout
  // screen, so the cart never charges MORE than it displays (C3-fix doctrine).
  const total = Math.max(0, subtotal - welcomeAmount + deliveryFee + smallFeeEur)
  const totalItems = cart?.items.reduce((s, l) => s + l.qty, 0) ?? 0

  // The single item the nudge proposes to clear the fee in one tap: the cheapest
  // drink/dessert/side that crosses the threshold, else the cheapest of those,
  // else the cheapest item overall. Display-only convenience.
  const suggestion = useMemo(() => {
    if (!smallFeeApplies || menuItems.length === 0) return null
    const preferRe = /boisson|drink|dessert|accompagnement|side|extra|frite/i
    const pool = menuItems.filter((m) => m.price > 0)
    if (pool.length === 0) return null
    const preferred = pool.filter((m) => preferRe.test(m.category ?? ''))
    const source = (preferred.length ? preferred : pool).slice().sort((a, b) => a.price - b.price)
    return source.find((m) => m.price >= missingToThresholdEur) ?? source[0] ?? null
  }, [smallFeeApplies, menuItems, missingToThresholdEur])

  function addSuggested(m: { id: string; name: string; price: number; photos?: string[] }) {
    if (!cart) return
    const existing = cart.items.find((l) => l.item.id === m.id)
    const items = existing
      ? cart.items.map((l) => (l.item.id === m.id ? { ...l, qty: l.qty + 1 } : l))
      : [...cart.items, { item: { id: m.id, name: m.name, price: m.price, photos: m.photos ?? [] }, qty: 1 }]
    update({ ...cart, items })
  }

  // Loyalty redemption eligibility (L1, D3 promo-exclusive). Shown only for a
  // logged-in consumer WITH a balance and NO welcome discount (the server also
  // refuses loyalty whenever a promo resolves — usePoints is ignored then, so
  // the points are never burned). The displayed total is intentionally NOT
  // reduced here: the exact credit (capped by Grubano's commission, unknown
  // client-side) is resolved on the server and shown on the checkout screen, so
  // the cart never charges MORE than it displays (audit C3-fix doctrine).
  const canUsePoints = authStatus === 'authenticated' && pointsBalance > 0 && welcomeAmount === 0
  // Honest UPPER bound only: credit ≤ min(balance→€, subtotal). The commission
  // cap can only shrink it further → "jusqu'à" never under-promises the charge.
  const maxLoyaltyEur = useMemo(
    () => Math.min(pointsBalance * centsPerPoint, Math.round(subtotal * 100)) / 100,
    [pointsBalance, centsPerPoint, subtotal],
  )
  const effectiveUsePoints = canUsePoints && usePoints
  // L2 display flags — DO NOT change the intention sent to the server (D4):
  // effectiveUsePoints above is untouched, the server stays the sole judge of
  // whether the credit applies. These only drive the grayed display + message.
  // The card is now VISIBLE whenever the consumer is logged in with a balance
  // (it was hidden entirely under a welcome discount before). A promo
  // deterministically blocks loyalty (D3): the welcome discount, OR an
  // unconditional global resto promo (no itemIds) that already applies to this
  // basket — both are reliable client-side signals.
  const loyaltyVisible = authStatus === 'authenticated' && pointsBalance > 0
  // Mirror the server's deterministic promo gates (lib/promotions): an
  // unconditional GLOBAL promo blocks loyalty (D3) — but ONLY when it actually
  // applies to THIS basket: its minOrderEur must be met AND its channels (if
  // scoped) must include the chosen fulfillment. Without the channel guard a
  // ['delivery']-only promo would wrongly gray the toggle on a pickup order.
  // Targeted (itemIds) promos are intentionally NOT detected here (hard to
  // resolve client-side; the server stays the judge — choice noted).
  const promoBlocksLoyalty = welcomeAmount > 0 || promos.some(
    (p) => !p.itemIds
      && (p.minOrderEur == null || subtotal >= p.minOrderEur)
      && (!p.channels || p.channels.includes(fulfillment)),
  )
  const balanceEuros = Math.round(pointsBalance * centsPerPoint) / 100
  // Chantier P2 — soft minOrder incentive: the closest GLOBAL promo whose
  // threshold isn't reached yet. DISPLAY-only arithmetic (a gap in €) — the
  // server stays the only judge of what actually applies at checkout.
  const promoIncentive = useMemo(() => {
    const candidates = promos
      .filter((p) => !p.itemIds && p.minOrderEur != null && p.minOrderEur > subtotal)
      .sort((a, b) => (a.minOrderEur! - subtotal) - (b.minOrderEur! - subtotal))
    const next = candidates[0]
    if (!next) return null
    return { name: next.name, missing: Math.round((next.minOrderEur! - subtotal) * 100) / 100 }
  }, [promos, subtotal])
  // Promo V2 — « Ajoutez X€ pour [le dessert offert / −X%] » : the nearest
  // threshold_reward not yet reached. Display arithmetic only (the server
  // resolves the real reward at checkout).
  const thresholdIncentive = useMemo(() => {
    const candidates = promos
      .filter((p) => p.type === 'threshold_reward' && p.thresholdEur != null && p.thresholdEur > subtotal)
      .sort((a, b) => (a.thresholdEur! - subtotal) - (b.thresholdEur! - subtotal))
    const next = candidates[0]
    if (!next) return null
    const reward = next.rewardKind === 'free_item'
      ? t('rewardFreeItemShort')
      : t('rewardPctShort', { pct: next.rewardPct ?? next.discount })
    return { missing: Math.round((next.thresholdEur! - subtotal) * 100) / 100, reward }
  }, [promos, subtotal, t])
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
          // Chantier fidélité L1 (D4): INTENTION only. The server computes the
          // euro credit, checks the balance and caps it; a promo voids it (D3).
          usePoints: effectiveUsePoints,
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
      // Checkout C2: card orders go through the payment journey (recap →
      // Stripe Elements → confirmation). Cash-on-delivery keeps the legacy
      // direct-to-tracking path — C1 only gated the card flow.
      if (payment === 'card') {
        router.push(`/eat/checkout/${data.orderId}`)
      } else {
        router.push(`/eat/track/${data.orderId}`)
      }
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  // Account-AT-payment (Agent 138): a guest taps "Commander" → open the passwordless sheet (email +
  // 6-digit code, NO password). Once connected (signIn set the session cookie), continue STRAIGHT to
  // placeOrder — its POST /api/orders now carries the cookie (no 401), mirroring the password flow.
  // placeOrder keeps its own 401 → /eat/auth fallback for an expired session mid-flow.
  function handleCheckout() {
    if (authStatus !== 'authenticated') { setAuthSheet(true); return }
    placeOrder()
  }

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-gb-surface p-4">
        <div className="mb-3 h-6 w-1/3 animate-pulse rounded-gb-md bg-gb-oat-200" />
        <div className="h-40 animate-pulse rounded-gb-xl bg-gb-oat-100" />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content">
        <div className="border-b border-gb-stroke bg-gb-surface px-4 pb-4 pt-3">
          <h1 className="font-gb-display text-[22px] font-extrabold text-gb-content">{t('title')}</h1>
        </div>
        <div className="flex flex-col items-center justify-center px-10 pt-24 text-center">
          <ShoppingBag size={64} className="text-gb-accent" />
          <p className="mt-4 text-xl font-extrabold text-gb-content">{t('emptyTitle')}</p>
          <p className="mt-2 text-sm leading-relaxed text-gb-content-muted">
            {t('emptyDescription')}
          </p>
          <Button variant="gb-primary" size="pill" className="mt-6" onClick={() => router.push('/eat')}>
            {t('exploreDishes')}
          </Button>
        </div>
      </div>
    )
  }

  // The Place-order CTA is rendered twice: a fixed bottom bar on mobile (<lg) and
  // inside the sticky Summary panel on desktop (≥lg). Both call the same handler;
  // only one is ever visible (the other is display:none) — no double-submit.
  const placeOrderButton = (
    <Button
      variant="gb-primary"
      size="pill"
      fullWidth
      loading={submitting}
      onClick={handleCheckout}
    >
      <span className="flex-1 text-left">{submitting ? t('submitting') : t('placeOrder')}</span>
      {!submitting && <span>{formatEuros(total, locale)}</span>}
    </Button>
  )

  return (
    <div className="min-h-screen bg-gb-surface pb-[160px] font-gb-sans text-gb-content lg:pb-12">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gb-stroke bg-gb-surface px-4 pb-4 pt-3">
        <h1 className="font-gb-display text-[22px] font-extrabold text-gb-content">{t('title')}</h1>
        <span className="text-sm font-semibold text-gb-accent">
          {t('itemCount', { count: totalItems })}
        </span>
      </div>

      {/* Desktop ≥lg = 2 columns: cart details on the left, a STICKY Summary panel
          (totals + Place order) on the right. Mobile (<lg) = the single vertical
          flow, with the Place order CTA as a fixed bottom bar. */}
      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-6">
        {/* LEFT column */}
        <div className="lg:min-w-0">
          {/* Fulfilment tabs */}
          <div className="mx-4 mt-3 flex gap-2 rounded-gb-xl bg-gb-surface-elevated p-1 shadow-gb-sm lg:mx-0">
            {([
              { value: 'delivery', label: t('tabDelivery'), icon: <Bike size={16} /> },
              { value: 'pickup', label: t('tabPickup'), icon: <Package size={16} /> },
            ] as const).map((opt) => {
              const active = fulfillment === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setFulfillment(opt.value)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-gb-lg py-2.5 text-sm font-bold transition active:scale-[0.99] ${
                    active ? 'bg-gb-accent text-gb-content-on-accent shadow-gb-md' : 'text-gb-content-muted'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              )
            })}
          </div>

          {/* Items */}
          <div className="mx-4 mt-3 space-y-3 rounded-gb-xl bg-gb-surface-elevated p-3 shadow-gb-sm lg:mx-0">
            {cart.items.map(({ item, qty, options }) => (
              <div key={item.id} className="flex items-center gap-3 border-b border-gb-stroke pb-3 last:border-0 last:pb-0">
                <FoodImage
                  name={item.name}
                  src={item.photos?.[0]}
                  className="h-[70px] w-[70px] shrink-0 rounded-gb-lg"
                  glyphClassName="text-2xl"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gb-content">{item.name}</p>
                  {options?.note && (
                    <p className="truncate text-[11px] text-gb-content-muted">📝 {options.note}</p>
                  )}
                  {options?.supplements && options.supplements.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {options.supplements.map((s) => (
                        <Badge key={s.name} tone="primary" size="sm" skin="gb">
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
                    className="flex h-8 w-8 items-center justify-center rounded-gb-full bg-gb-error-soft active:scale-90"
                  >
                    <Trash2 size={16} className="text-gb-error" />
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQty(item.id, -1)}
                      aria-label="-"
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-gb-full border-[1.5px] border-gb-accent active:scale-90"
                    >
                      <Minus size={14} className="text-gb-accent" />
                    </button>
                    <span className="min-w-5 text-center text-[15px] font-bold text-gb-content">{qty}</span>
                    <button
                      onClick={() => updateQty(item.id, 1)}
                      aria-label="+"
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-gb-full bg-gb-accent active:scale-90"
                    >
                      <Plus size={14} className="text-gb-content-on-accent" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Address (delivery) OR pickup card */}
          {fulfillment === 'delivery' ? (
            <div className="mx-4 mt-2.5 rounded-gb-xl bg-gb-surface-elevated p-4 shadow-gb-sm lg:mx-0">
              <div className="flex items-start gap-3">
                <MapPin size={20} className="mt-0.5 shrink-0 text-gb-accent" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-gb-content">{t('deliveryAddress')}</p>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t('addressPlaceholder')}
                    className="mt-1 w-full bg-transparent text-xs text-gb-content placeholder:text-gb-content-muted focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-4 mt-2.5 rounded-gb-xl bg-gb-zest-50 p-4 lg:mx-0">
              <div className="flex items-start gap-3">
                <Package size={20} className="mt-0.5 shrink-0 text-gb-accent" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-gb-content">{t('pickupLabel')}</p>
                  <p className="mt-0.5 text-xs text-gb-oat-600">
                    {cart.restaurant.name}
                    {cart.restaurant.address ? ` — ${cart.restaurant.address}` : ''}
                    {cart.restaurant.city ? `, ${cart.restaurant.city}` : ''}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-gb-accent">
                    {t('readyAround', { time: readyAt, minutes: cart.restaurant.deliveryTime ?? 20 })}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Payment */}
          <div className="mx-4 mt-2.5 rounded-gb-xl bg-gb-surface-elevated p-4 shadow-gb-sm lg:mx-0">
            <div className="flex items-center gap-3">
              <CreditCard size={20} className="shrink-0 text-gb-accent" />
              <div className="flex-1">
                <p className="text-sm font-bold text-gb-content">{t('paymentMethod')}</p>
                <p className="mt-0.5 text-xs text-gb-content-muted">
                  {payment === 'card' ? '**** **** **** 4521' : t('cashOnDelivery')}
                </p>
              </div>
              <button onClick={() => setPayment((p) => (p === 'card' ? 'cash' : 'card'))} className="text-sm font-semibold text-gb-accent">
                {t('edit')}
              </button>
            </div>
          </div>

          {/* Loyalty redemption (chantier fidélité L1/L2) — INTENTION toggle only.
              Shown whenever the consumer is logged in with a balance. When a promo
              is active the card is GRAYED with a clear D3 message (the points stay
              available for a next order) and the toggle is disabled — the server
              stays the sole judge (effectiveUsePoints is unchanged). When usable,
              the cap is always explained (« jusqu'à X € selon ta commande »). The
              exact credit is resolved + shown on the checkout screen, so the total
              below stays the honest upper amount the customer could pay. */}
          {loyaltyVisible && (
            <div className={`mx-4 mt-2.5 rounded-gb-xl p-4 shadow-gb-sm lg:mx-0 ${promoBlocksLoyalty ? 'bg-gb-oat-100' : 'bg-gb-surface-elevated'}`}>
              <div className="flex items-center gap-3">
                <Sparkles size={20} className={`shrink-0 ${promoBlocksLoyalty ? 'text-gb-oat-600' : 'text-gb-accent'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${promoBlocksLoyalty ? 'text-gb-oat-600' : 'text-gb-content'}`}>{t('loyaltyToggleTitle')}</p>
                  <p className="mt-0.5 text-xs text-gb-oat-600">
                    {t('loyaltyBalance', { count: pointsBalance.toLocaleString('fr-FR') })}
                    {balanceEuros > 0 ? ` · ${t('loyaltyBalanceEur', { amount: formatAmount(balanceEuros, locale) })}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => { if (!promoBlocksLoyalty) setUsePoints((v) => !v) }}
                  disabled={promoBlocksLoyalty}
                  aria-pressed={usePoints && !promoBlocksLoyalty}
                  aria-label={t('loyaltyToggleTitle')}
                  className={`flex h-7 w-12 shrink-0 items-center rounded-gb-full px-0.5 transition-colors ${
                    promoBlocksLoyalty
                      ? 'justify-start bg-gb-oat-300 opacity-50'
                      : usePoints ? 'justify-end bg-gb-accent' : 'justify-start bg-gb-oat-300'
                  }`}
                >
                  <span className="h-6 w-6 rounded-gb-full bg-white shadow" />
                </button>
              </div>
              {promoBlocksLoyalty ? (
                <p className="mt-2.5 rounded-gb-lg bg-gb-oat-200 px-3 py-2 text-[12px] font-medium text-gb-oat-700">
                  {t('loyaltyPromoBlocked')}
                </p>
              ) : (
                <p className="mt-2.5 rounded-gb-lg bg-gb-zest-50 px-3 py-2 text-[12px] font-medium text-gb-accent">
                  {maxLoyaltyEur > 0 ? `${t('loyaltyUpTo', { amount: formatAmount(maxLoyaltyEur, locale) })} · ` : ''}{t('loyaltyNote')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* RIGHT column — sticky Summary panel on desktop */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          {/* Summary */}
          <div className="mx-4 mt-2.5 rounded-gb-xl bg-gb-surface-elevated p-4 shadow-gb-sm lg:mx-0">
            <p className="mb-3.5 font-gb-display text-[17px] font-extrabold text-gb-content">{t('summary')}</p>
            <div className="mb-2.5 flex justify-between text-sm">
              <span className="text-gb-content-muted">{t('subtotal')}</span>
              <span className="font-semibold text-gb-content">{formatEuros(subtotal, locale)}</span>
            </div>
            {welcomeAmount > 0 && (
              <div className="mb-2.5 flex justify-between text-sm">
                <span className="text-gb-basil-700">
                  {welcome?.creatorName
                    ? t('welcomeDiscountFrom', { creator: welcome.creatorName })
                    : t('welcomeDiscount')}
                </span>
                <span className="font-semibold text-gb-basil-700">-{formatEuros(welcomeAmount, locale)}</span>
              </div>
            )}
            <div className="mb-2.5 flex justify-between text-sm">
              <span className="text-gb-content-muted">{fulfillment === 'pickup' ? t('feePickup') : t('feeDelivery')}</span>
              <span className="font-semibold text-gb-content">{fulfillment === 'pickup' ? t('free') : formatEuros(deliveryFee, locale)}</span>
            </div>
            {/* Small-order fee (V1.5) — line + nudge with a 1-click "add an item".
                Disappears as soon as the items subtotal reaches the threshold. */}
            {smallFeeApplies && (
              <div className="mb-2.5 flex justify-between text-sm">
                <span className="text-gb-content-muted">{t('smallOrderFeeLine')}</span>
                <span className="font-semibold text-gb-content">{formatEuros(smallFeeEur, locale)}</span>
              </div>
            )}
            {smallFeeApplies && (
              <div className="mb-2.5 rounded-gb-lg bg-gb-zest-50 px-3 py-2">
                <p className="text-[12px] font-medium text-gb-accent">
                  {t('smallOrderNudge', { amount: formatAmount(missingToThresholdEur, locale) })}
                </p>
                {suggestion && (
                  <button
                    onClick={() => addSuggested(suggestion)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-gb-full bg-gb-accent px-3 py-1 text-[11px] font-bold text-gb-content-on-accent active:scale-95"
                  >
                    <Plus size={12} /> {t('smallOrderAddItem', { name: suggestion.name, price: formatAmount(suggestion.price, locale) })}
                  </button>
                )}
              </div>
            )}
            {/* Chantier P2 — soft incentive: « Encore X € pour profiter de {nom} ».
                Display arithmetic only — the server resolves the real promo. */}
            {promoIncentive && (
              <p className="mb-2.5 rounded-gb-lg bg-gb-zest-50 px-3 py-2 text-[12px] font-medium text-gb-accent">
                {t('promoIncentive', { amount: formatAmount(promoIncentive.missing, locale), name: promoIncentive.name })}
              </p>
            )}
            {/* Promo V2 — threshold-reward progress: « Ajoutez X € pour [récompense] ». */}
            {thresholdIncentive && (
              <p className="mb-2.5 rounded-gb-lg bg-gb-zest-50 px-3 py-2 text-[12px] font-medium text-gb-accent">
                {t('thresholdIncentive', { amount: formatAmount(thresholdIncentive.missing, locale), reward: thresholdIncentive.reward })}
              </p>
            )}
            <div className="mt-1 flex items-center justify-between border-t border-gb-stroke pt-3">
              <span className="text-base font-extrabold text-gb-content">{t('total')}</span>
              <PriceTag amount={total} size="lg" />
            </div>
          </div>

          {error && (
            <p className="mx-4 mt-3 rounded-gb-lg bg-gb-error-soft p-3 text-center text-sm text-gb-content lg:mx-0">
              {error}
            </p>
          )}

          {/* Desktop Place-order CTA (lives in the sticky panel) */}
          <div className="mx-4 mt-3 hidden lg:mx-0 lg:block">
            {placeOrderButton}
          </div>
        </aside>
      </div>

      {/* Mobile checkout bar (fixed, above the bottom-nav). Hidden on desktop where
          the CTA lives in the sticky Summary panel. */}
      <div className="fixed bottom-[60px] left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-gb-stroke bg-gb-surface-elevated px-4 py-3.5 lg:hidden">
        {placeOrderButton}
      </div>

      {/* Passwordless account-AT-payment (Agent 138) — guests authenticate inline, then the order
          continues. Look = current /eat (no Stellar). Password sign-in stays reachable inside it. */}
      {authSheet && (
        <CheckoutAuthSheet
          onClose={() => setAuthSheet(false)}
          onConnected={() => { setAuthSheet(false); placeOrder() }}
        />
      )}
    </div>
  )
}
