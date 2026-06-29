'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSession } from 'next-auth/react'
import { useRouter } from '@/navigation'
import CheckoutAuthSheet from '@/components/eat/CheckoutAuthSheet'
import { readCart, writeCart, showToast, type EatCartData } from '@/lib/eat-cart'
import { readAddresses, getDefaultAddress, formatAddress, ADDRESS_EVENT, type EatAddress } from '@/lib/eat-addresses'
import { formatEuros, formatAmount } from '@/lib/format-money'
import './cart.css'
import './cart-address.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// /eat/cart — « Mon panier ». VERBATIM re-skin of the FROZEN CD ref
// (Notion 38efd2c9-…-819d, file eat/cart.html). 🔒 MONEY page → VISUAL re-skin ONLY:
// the cart/totals/place-order logic below is byte-identical to the prior version
// (lib/eat-cart, placeOrder(), the saved-address selector, every total/fee/discount
// computation). Material Symbols replace lucide; the IA upsell is INERT (« bientôt »);
// the payment-method row is a placeholder (no Stripe saved-cards backend). Renders
// inside EatShell (is-bare) — page content only, never the nav shell.

type Fulfillment = 'delivery' | 'pickup'

export default function CartScreen() {
  const t = useTranslations('eat.cart')
  const ta = useTranslations('eat.addresses')
  const locale = useLocale()
  const router = useRouter()
  const { status: authStatus } = useSession()
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [fulfillment, setFulfillment] = useState<Fulfillment>('delivery')
  const [address, setAddress] = useState('')
  // Saved delivery addresses (lib/eat-addresses, client-side) — the CD checkout selector
  // (Wave 4 screen 3). The selected address only fills the `address` string below; the
  // place-order / payment flow is byte-identical.
  const [savedAddrs, setSavedAddrs] = useState<EatAddress[]>([])
  const [selectedAddrId, setSelectedAddrId] = useState('')
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

  // Load saved addresses + keep the selection valid (default-first); live via ADDRESS_EVENT.
  useEffect(() => {
    const sync = () => {
      const list = readAddresses()
      setSavedAddrs(list)
      setSelectedAddrId((cur) => (list.find((a) => a.id === cur) ?? getDefaultAddress())?.id ?? '')
    }
    sync()
    window.addEventListener(ADDRESS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADDRESS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // The selected saved address fills the delivery `address` string (the place-order input).
  useEffect(() => {
    const chosen = savedAddrs.find((a) => a.id === selectedAddrId)
    if (chosen) setAddress(formatAddress(chosen))
  }, [selectedAddrId, savedAddrs])

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

  // ── Rendering (CD verbatim markup, scoped under .gb / .gb-cart) ────────────────

  if (!hydrated) {
    return (
      <div className="gb">
        <main className="gb-cart">
          <div className="cart-top"><h1>{t('title')}</h1></div>
          <div className="layout">
            <div>
              <div className="c-skel" />
              <div className="c-skel" />
            </div>
            <div className="c-skel" style={{ height: 220 }} />
          </div>
        </main>
      </div>
    )
  }

  const isEmpty = !cart || cart.items.length === 0

  // The CTA is rendered twice: inside the sticky Summary panel (desktop ≥820px)
  // and in the fixed mobile pay bar (<820px). Both call the SAME handler; the CSS
  // shows only one at a time (.mbar is display:none on desktop) — no double-submit.
  const cta = (
    <button className="cta" onClick={handleCheckout} disabled={submitting} aria-busy={submitting}>
      <span>{submitting ? t('submitting') : `${t('placeOrder')} · ${formatEuros(total, locale)}`}</span>
      {submitting ? <span className="spin" aria-hidden="true" /> : <span className="ms" aria-hidden="true">arrow_forward</span>}
    </button>
  )

  return (
    <div className="gb">
      <main className="gb-cart">
        {/* Header */}
        <div className="cart-top">
          <h1>{t('title')}</h1>
          {!isEmpty && (
            <span className="clear">
              {totalItems > 0 ? t('itemCount', { count: totalItems }) : ''}
            </span>
          )}
        </div>

        {isEmpty ? (
          /* Empty state (CD .empty, verbatim) — real empty cart */
          <div className="empty">
            <div className="empty__ico"><span className="ms" aria-hidden="true">shopping_bag</span></div>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyDescription')}</p>
            <button className="ct-btn" onClick={() => router.push('/eat')}>
              <span className="ms" aria-hidden="true">search</span>{t('exploreDishes')}
            </button>
          </div>
        ) : (
          <div className="layout">
            {/* LEFT column */}
            <div>
              {/* Resto banner */}
              <div className="resto">
                <span className="thumb" aria-hidden="true" />
                <div className="main">
                  <b>{cart.restaurant.name}</b>
                  <span>
                    {[
                      cart.restaurant.city,
                      cart.restaurant.deliveryTime ? `~${cart.restaurant.deliveryTime} min` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {cart.restaurantId && (
                  <button className="change" onClick={() => router.push(`/eat/r/${cart.restaurantId}`)}>{t('changeResto')}</button>
                )}
              </div>

              {/* Fulfilment mode toggle (real `fulfillment` state). Note: CD shows a
                  third « Sur place » mode, omitted — no dine-in order path exists in
                  placeOrder (Fulfillment is 'delivery' | 'pickup'). */}
              <div className="modes" role="tablist">
                <button role="tab" aria-selected={fulfillment === 'delivery'} onClick={() => setFulfillment('delivery')}>
                  <span className="ms" aria-hidden="true">two_wheeler</span>{t('tabDelivery')}
                </button>
                <button role="tab" aria-selected={fulfillment === 'pickup'} onClick={() => setFulfillment('pickup')}>
                  <span className="ms" aria-hidden="true">storefront</span>{t('tabPickup')}
                </button>
              </div>

              {/* Items */}
              <div className="items">
                {cart.items.map(({ item, qty, options }) => {
                  const optParts = [
                    options?.size,
                    ...(options?.supplements?.map((s) => `+ ${s.name}`) ?? []),
                    ...(options?.exclusions ?? []),
                    options?.note ? `📝 ${options.note}` : null,
                  ].filter(Boolean)
                  return (
                    <div className="ct-item" key={item.id}>
                      {item.photos?.[0]
                        ? <span className="ct-item__img" style={{ backgroundImage: `url(${item.photos[0]})`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
                        : <span className="ct-item__img" aria-hidden="true" />}
                      <div className="ct-item__b">
                        <div className="ct-item__row">
                          <b>{item.name}</b>
                          <span className="price">{formatEuros(item.price * qty, locale)}</span>
                        </div>
                        {optParts.length > 0 && <div className="ct-item__opt">{optParts.join(' · ')}</div>}
                        <div className="ct-item__foot">
                          <span className="stepper">
                            <button onClick={() => updateQty(item.id, -1)} aria-label="-"><span className="ms" aria-hidden="true">remove</span></button>
                            <b>{qty}</b>
                            <button onClick={() => updateQty(item.id, 1)} aria-label="+"><span className="ms" aria-hidden="true">add</span></button>
                          </span>
                          <button className="ct-item__del" onClick={() => removeItem(item.id)} aria-label={t('removeAria')}>
                            <span className="ms" aria-hidden="true">delete</span>{t('removeAria')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Add more */}
              {cart.restaurantId && (
                <button className="addmore" onClick={() => router.push(`/eat/r/${cart.restaurantId}`)}>
                  <span className="ms" aria-hidden="true">add</span>{t('addMore')}
                </button>
              )}

              {/* IA upsell — INERT (« bientôt », decorative, no add-to-cart) */}
              <div className="upsell" aria-hidden="true">
                <div className="upsell__in">
                  <div className="upsell__h">
                    <span className="ic"><span className="ms">auto_awesome</span></span>
                    <b>{t('upsellTitle')}</b>
                    <span className="soon">{t('upsellSoon')}</span>
                  </div>
                  <div className="upsell__row">
                    {[1, 2, 3].map((i) => (
                      <div className="upcard" key={i}>
                        <div className="uim" />
                        <b>&nbsp;</b>
                        <div className="ur"><span>&nbsp;</span><span className="plus"><span className="ms">add</span></span></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Address (delivery) OR pickup card */}
              {fulfillment === 'delivery' ? (
                savedAddrs.length > 0 ? (
                  <div className="gb-addr-sel" data-err="0" style={{ marginTop: 14 }}>
                    <div className="sel-card">
                      <div className="sel-card__head">
                        <span className="ms" aria-hidden="true">local_shipping</span><b>{ta('selTitle')}</b>
                        <button type="button" className="change" onClick={() => router.push('/eat/account/addresses')}>{ta('selChange')}</button>
                      </div>
                      <div className="sel-list">
                        {savedAddrs.map((a) => (
                          <button type="button" key={a.id} className={`opt${a.id === selectedAddrId ? ' sel' : ''}`} onClick={() => setSelectedAddrId(a.id)} aria-pressed={a.id === selectedAddrId}>
                            <span className="radio" />
                            <span className="opt__ico"><span className="ms" aria-hidden="true">{a.kind === 'home' ? 'home' : a.kind === 'work' ? 'work' : 'location_on'}</span></span>
                            <span className="opt__main">
                              <span className="opt__title"><b>{a.label}</b>{a.isDefault && <span className="badge-default"><span className="ms" style={{ fontSize: 11 }} aria-hidden="true">check</span>{ta('defaultBadge')}</span>}</span>
                              <span className="opt__line">{formatAddress(a)}</span>
                              {a.note && <span className="opt__note"><span className="ms" aria-hidden="true">info</span>{a.note}</span>}
                            </span>
                          </button>
                        ))}
                        <div className="sel-err"><span className="ms" aria-hidden="true">error</span>{ta('selErr')}</div>
                        <button type="button" className="sel-add" onClick={() => router.push('/eat/account/addresses')}><span className="ms" aria-hidden="true">add_location_alt</span>{ta('selAdd')}</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="addr-input">
                    <span className="ms" aria-hidden="true">location_on</span>
                    <div className="f">
                      <b>{t('deliveryAddress')}</b>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t('addressPlaceholder')}
                      />
                    </div>
                  </div>
                )
              ) : (
                <div className="pickup">
                  <span className="ms" aria-hidden="true">storefront</span>
                  <div className="f">
                    <b>{t('pickupLabel')}</b>
                    <div className="line">
                      {cart.restaurant.name}
                      {cart.restaurant.address ? ` — ${cart.restaurant.address}` : ''}
                      {cart.restaurant.city ? `, ${cart.restaurant.city}` : ''}
                    </div>
                    <div className="ready">{t('readyAround', { time: readyAt, minutes: cart.restaurant.deliveryTime ?? 20 })}</div>
                  </div>
                </div>
              )}

              {/* Loyalty redemption (chantier fidélité L1/L2) — INTENTION toggle only.
                  Shown whenever the consumer is logged in with a balance. When a promo
                  is active the card is GRAYED with the D3 message and the toggle is
                  disabled — the server stays the sole judge (effectiveUsePoints
                  unchanged). The displayed total stays the honest upper amount. */}
              {loyaltyVisible && (
                <div className={`loyalty${promoBlocksLoyalty ? ' blocked' : ''}`}>
                  <div className="loyalty__head">
                    <span className="ms" aria-hidden="true">auto_awesome</span>
                    <div className="loyalty__txt">
                      <b>{t('loyaltyToggleTitle')}</b>
                      <span>
                        {t('loyaltyBalance', { count: pointsBalance.toLocaleString('fr-FR') })}
                        {balanceEuros > 0 ? ` · ${t('loyaltyBalanceEur', { amount: formatAmount(balanceEuros, locale) })}` : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => { if (!promoBlocksLoyalty) setUsePoints((v) => !v) }}
                      disabled={promoBlocksLoyalty}
                      aria-pressed={usePoints && !promoBlocksLoyalty}
                      aria-label={t('loyaltyToggleTitle')}
                      className={`toggle${promoBlocksLoyalty ? ' off-disabled' : usePoints ? ' on' : ''}`}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                  {promoBlocksLoyalty ? (
                    <div className="loyalty__note blocked">{t('loyaltyPromoBlocked')}</div>
                  ) : (
                    <div className="loyalty__note">
                      {maxLoyaltyEur > 0 ? `${t('loyaltyUpTo', { amount: formatAmount(maxLoyaltyEur, locale) })} · ` : ''}{t('loyaltyNote')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT column — sticky Summary panel on desktop */}
            <aside className="summary">
              <div className="summary__h">{t('summary')}</div>
              <div className="summary__b">
                {/* Payment-method row — INERT placeholder (no Stripe saved-cards
                    backend). The « Modifier » button toggles the real card/cash
                    paymentMethod state; the «•••• 4521» line is decorative. */}
                <div className="pay">
                  <span className="ms" aria-hidden="true">credit_card</span>
                  <div className="pay__txt">
                    <b>{t('paymentMethod')}</b>
                    <span>{payment === 'card' ? '•••• •••• •••• 4521' : t('cashOnDelivery')}</span>
                  </div>
                  <button onClick={() => setPayment((p) => (p === 'card' ? 'cash' : 'card'))}>{t('edit')}</button>
                </div>

                {/* Incentive nudges (real display-only arithmetic) */}
                {smallFeeApplies && (
                  <div className="nudge">
                    {t('smallOrderNudge', { amount: formatAmount(missingToThresholdEur, locale) })}
                    {suggestion && (
                      <button className="nudge__add" onClick={() => addSuggested(suggestion)}>
                        <span className="ms" aria-hidden="true">add</span>
                        {t('smallOrderAddItem', { name: suggestion.name, price: formatAmount(suggestion.price, locale) })}
                      </button>
                    )}
                  </div>
                )}
                {promoIncentive && (
                  <div className="nudge">{t('promoIncentive', { amount: formatAmount(promoIncentive.missing, locale), name: promoIncentive.name })}</div>
                )}
                {thresholdIncentive && (
                  <div className="nudge">{t('thresholdIncentive', { amount: formatAmount(thresholdIncentive.missing, locale), reward: thresholdIncentive.reward })}</div>
                )}

                {/* Totals (CD .srow / .stotal, verbatim) — REAL computed amounts */}
                <div className="srow"><span>{t('subtotal')}</span><b>{formatEuros(subtotal, locale)}</b></div>
                {welcomeAmount > 0 && (
                  <div className="srow disc">
                    <span>{welcome?.creatorName ? t('welcomeDiscountFrom', { creator: welcome.creatorName }) : t('welcomeDiscount')}</span>
                    <span>-{formatEuros(welcomeAmount, locale)}</span>
                  </div>
                )}
                <div className="srow">
                  <span>{fulfillment === 'pickup' ? t('feePickup') : t('feeDelivery')}</span>
                  <b>{fulfillment === 'pickup' ? t('free') : formatEuros(deliveryFee, locale)}</b>
                </div>
                {smallFeeApplies && (
                  <div className="srow"><span>{t('smallOrderFeeLine')}</span><b>{formatEuros(smallFeeEur, locale)}</b></div>
                )}
                <div className="sdiv" />
                <div className="stotal"><span>{t('total')}</span><b>{formatEuros(total, locale)}</b></div>

                {/* Desktop CTA (lives in the sticky panel) */}
                {cta}
                <div className="reassure"><span className="ms" aria-hidden="true">lock</span>{t('securePayment')}</div>

                {error && (
                  <div className="cart-err"><span className="ms" aria-hidden="true">error</span>{error}</div>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Mobile sticky pay bar (CD .mbar) — hidden on desktop (the CTA lives in the
          sticky Summary). Only shown when the cart has items. */}
      {!isEmpty && <div className="mbar">{cta}</div>}

      {/* Passwordless account-AT-payment (Agent 138) — guests authenticate inline, then the order
          continues. Password sign-in stays reachable inside it. */}
      {authSheet && (
        <CheckoutAuthSheet
          onClose={() => setAuthSheet(false)}
          onConnected={() => { setAuthSheet(false); placeOrder() }}
        />
      )}
    </div>
  )
}
