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

// P2-TIP courier tip presets (€). The same set as the post-delivery screen.
const TIP_PRESETS = [1, 2, 3, 5] as const

export default function CartScreen() {
  const t = useTranslations('eat.cart')
  const ta = useTranslations('eat.addresses')
  const locale = useLocale()
  const router = useRouter()
  const { status: authStatus } = useSession()
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [hydrated, setHydrated] = useState(false)
  // V5-2 — the delivery tab only renders when the SERVER says it would accept a
  // delivery order for this restaurant (GET /api/restaurants/[id].fulfillment,
  // computed by the exact POST /api/orders gate — pilot flag OFF ⇒ hidden).
  // Default false (safe: no flash) and default mode 'pickup' so no UI path can
  // end on the server's 403 delivery refusal. Post-pilot: one env toggle.
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup')
  const [address, setAddress] = useState('')
  // Saved delivery addresses (lib/eat-addresses, client-side) — the CD checkout selector
  // (Wave 4 screen 3). The selected address only fills the `address` string below; the
  // place-order / payment flow is byte-identical.
  const [savedAddrs, setSavedAddrs] = useState<EatAddress[]>([])
  const [selectedAddrId, setSelectedAddrId] = useState('')
  // P0-30 (vague 2 — Q2 fondateur) : le paiement en espèces est HORS PILOTE — le
  // choix est RETIRÉ de l'interface (le serveur le refuse déjà : P0-02 à la
  // création, P0-29 au paiement). La capacité peut revenir après le pilote :
  // réintroduire alors le state `useState<'card' | 'cash'>('card')`, le toggle de
  // la ligne « Méthode de paiement » du récapitulatif et la branche post-succès
  // non-carte (→ /eat/track) — cf. git log de ce fichier (commit P0-30).
  const payment = 'card' as const
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // P1-PROMO — consumer promo CODE. The input string + the server's PREVIEW
  // result. NON-authoritative: the cart shows the previewed discount, but the
  // SERVER recomputes + applies the BEST-OF(code, auto-promo) at checkout (the
  // client only passes the code string, never a discount amount).
  const [promoCode, setPromoCode] = useState('')
  const [promoState, setPromoState] = useState<'idle' | 'checking' | 'applied' | 'invalid' | 'error'>('idle')
  const [promoPreview, setPromoPreview] = useState<{ code: string; discountEur: number; label: string } | null>(null)
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
  // P4.3 ÉTAPE 5 — the distance-based delivery fee PREVIEW (null = use the flat forfait).
  const [distanceFee, setDistanceFee] = useState<number | null>(null)
  // P2-TIP — whether the courier tip selector shows (mirrors TIPS_ENABLED, echoed
  // by GET /api/restaurants/[id]). Default false → the tip UI is hidden and the
  // cart is byte-identical. The selected tip (in EUROS, UI-side) is sent as INTEGER
  // CENTS to the server, which validates + caps + charges it (the client never
  // sends a euro string nor a total). null = no tip picked.
  const [tipsEnabled, setTipsEnabled] = useState(false)
  const [tip, setTip] = useState<number | null>(null)
  const [customTip, setCustomTip] = useState('')
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
        if (typeof d.tipsEnabled === 'boolean') setTipsEnabled(d.tipsEnabled)
        // V5-2 — tolerant: absent/odd payload ⇒ delivery stays hidden (safe).
        if (d.fulfillment && d.fulfillment.delivery === true) setDeliveryAvailable(true)
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

  // P4.3 ÉTAPE 5 — distance-based delivery-fee PREVIEW. When LOGISTICS_DISTANCE_FEE_ENABLED is
  // ON, show the fee the server will actually charge (lifts the ÉTAPE 4 go-live mismatch). The
  // endpoint returns { enabled:false } (no geocode) when the flag is OFF (default) → distanceFee
  // stays null → the FLAT Restaurant.deliveryFee is displayed → byte-identical. FAIL-OPEN: any
  // error / non-distance response → null → flat fee. The cart is only a preview; the server stays
  // authoritative at order time (POST /api/orders recomputes + charges the real fee).
  const previewRestaurantId = cart?.restaurantId
  useEffect(() => {
    if (fulfillment === 'pickup' || !previewRestaurantId || !address) { setDistanceFee(null); return }
    let cancelled = false
    fetch('/api/logistics/fee-preview', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ restaurantId: previewRestaurantId, address }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d?.enabled && d.mode === 'distance' && typeof d.feeCents === 'number') setDistanceFee(d.feeCents / 100)
        else setDistanceFee(null)
      })
      .catch(() => { if (!cancelled) setDistanceFee(null) })
    return () => { cancelled = true }
  }, [fulfillment, previewRestaurantId, address])

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
    // P4.3 ÉTAPE 5 — when the distance-fee preview resolved (flag ON), show it so the cart
    // matches what the server charges. Null (flag OFF / no address / preview failed) → the FLAT
    // fee below (byte-identical to before). distanceFee can legitimately be 0.
    if (distanceFee != null) return distanceFee
    // A legit 0 € fee (e.g. free-delivery restaurant / "livraison 0 €") must display
    // as 0, not fall back to the 2.99 placeholder — nullish (??) only backfills a
    // genuinely absent value (older cart blob missing the field), never a real 0.
    return cart.restaurant.deliveryFee ?? 2.99
  }, [cart, fulfillment, distanceFee])
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
  // P1-PROMO — the PREVIEWED code discount (server-computed). The displayed total
  // subtracts it so the customer sees what the code does. The SERVER recomputes +
  // applies the BEST-OF(code, auto-promo) at checkout — this preview is never
  // trusted there. Cleared automatically when the basket changes (see effect).
  const promoDiscount = promoState === 'applied' && promoPreview ? promoPreview.discountEur : 0
  // P2-TIP — the courier tip in EUROS (UI-side). The custom field wins when filled
  // and numeric; else the selected preset. Only relevant when tipsEnabled (the UI
  // is hidden otherwise → tip/customTip stay at their initial empty values, so this
  // is 0 and the total/placeOrder are byte-identical). The server validates + caps
  // it; we send INTEGER CENTS, never this euro number.
  const customTipNum = customTip.trim() ? Number(customTip.replace(',', '.')) : NaN
  const tipEur = tipsEnabled
    ? (Number.isFinite(customTipNum) && customTipNum > 0 ? customTipNum : (tip ?? 0))
    : 0
  const tipCents = Math.max(0, Math.round(tipEur * 100))
  // The displayed total = full item prices + delivery − welcome discount − promo
  // code discount + the small-order fee + the courier tip. The loyalty credit is
  // resolved + shown on the checkout screen, so the cart never charges MORE than it
  // displays (C3-fix doctrine). The promo discount is clamped so the food can't go
  // negative. The tip is added ON TOP (never reduced by discounts — it is not food).
  const total = Math.max(0, subtotal - welcomeAmount - Math.min(promoDiscount, subtotal) + deliveryFee + smallFeeEur) + tipEur
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

  // P1-PROMO — apply a typed code: POST the (non-authoritative) PREVIEW request.
  // The server validates the code for THIS restaurant + basket and returns the
  // discount it would yield. We only DISPLAY it; the real discount is recomputed
  // at checkout. Guests can preview (session optional). { valid:false } → invalid.
  async function applyPromo() {
    if (!cart) return
    const code = promoCode.trim()
    if (!code) return
    setPromoState('checking')
    try {
      const res = await fetch('/api/eat/promos/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          restaurantId: cart.restaurantId,
          items: cart.items.map((l) => ({
            itemId: l.item.id,
            price: l.item.price,
            qty: l.qty,
            options: l.options ? [l.options as unknown as Record<string, unknown>] : [],
          })),
          fulfillmentType: fulfillment,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.valid && typeof data.discountEur === 'number' && data.discountEur > 0) {
        setPromoPreview({ code, discountEur: data.discountEur, label: typeof data.label === 'string' ? data.label : code })
        setPromoState('applied')
      } else {
        setPromoPreview(null)
        setPromoState('invalid')
      }
    } catch {
      setPromoPreview(null)
      setPromoState('error')
    }
  }

  function clearPromo() {
    setPromoCode('')
    setPromoPreview(null)
    setPromoState('idle')
  }

  // Invalidate an applied preview whenever the basket or fulfillment changes — the
  // discount it showed may no longer hold. The customer re-applies if still wanted
  // (the server is the sole judge at checkout regardless).
  useEffect(() => {
    if (promoState === 'applied' || promoState === 'invalid' || promoState === 'error') {
      setPromoPreview(null)
      setPromoState('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, totalItems, fulfillment])

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
  // LOT VÉRACITÉ : « Prêt vers HH:MM (~N min) » était un 3e calcul d'heure, CLIENT
  // (Date.now() + deliveryTime ?? 20 EN DUR) — retiré : aucun moteur ne calcule
  // d'heure, et deliveryTime n'est saisi par aucune UI.

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
          // P1-PROMO: pass the typed CODE string ONLY (never a discount amount).
          // The server resolves + applies the BEST-OF(code, auto-promo). Sent only
          // when a code is currently applied → the no-code request is unchanged.
          ...(promoState === 'applied' && promoPreview ? { promoCode: promoPreview.code } : {}),
          // P2-TIP: pass the courier tip in INTEGER CENTS, ONLY when tips are on AND
          // a positive tip is picked → the no-tip / flag-OFF request is byte-identical.
          // The server validates + caps + charges it (ignored entirely when OFF).
          ...(tipsEnabled && tipCents > 0 ? { tipCents } : {}),
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
        // WP-DZONE-01 — the address is outside this restaurant's delivery zone
        // (only ever returned when DELIVERY_ZONE_ENFORCEMENT is ON server-side).
        if (res.status === 400 && data?.code === 'out_of_zone') {
          setError(t('errOutOfZone'))
          return
        }
        setError(data.error ?? t('errorOrderFailed'))
        return
      }
      writeCart(null)
      // Checkout C2: orders go through the payment journey (recap → Stripe
      // Elements → confirmation). P0-30 : la carte est le SEUL mode — l'ancienne
      // branche non-carte (direct-to-tracking) est retirée avec le choix espèces.
      router.push(`/eat/checkout/${data.orderId}`)
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
                    {cart.restaurant.city ?? ''}
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
                {/* V5-2: the delivery tab only exists when the server would accept it. */}
                {deliveryAvailable && (
                  <button role="tab" aria-selected={fulfillment === 'delivery'} onClick={() => setFulfillment('delivery')}>
                    <span className="ms" aria-hidden="true">two_wheeler</span>{t('tabDelivery')}
                  </button>
                )}
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
                        <div className="sel-err" role="alert">{ta('selErr')}</div>
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
                    <div className="ready">{t('pickupReadyNote')}</div>
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

              {/* P2-TIP — courier tip selector. Shown ONLY when tips are enabled
                  (tipsEnabled, mirrors TIPS_ENABLED). Hidden by default → the cart
                  is byte-identical. Presets (€) + a custom € input; the chosen tip is
                  added to the total above and sent as INTEGER CENTS at checkout. */}
              {tipsEnabled && (
                <div className="tip-card">
                  <div className="tip-card__head">
                    <span className="ms" aria-hidden="true">volunteer_activism</span>
                    <div className="tip-card__txt">
                      <b>{t('tipTitle')}</b>
                      <span>{t('tipNote')}</span>
                    </div>
                  </div>
                  <div className="tip-card__row">
                    {TIP_PRESETS.map((amt) => {
                      const on = tip === amt && !customTip.trim()
                      return (
                        <button
                          key={amt}
                          type="button"
                          className={`tip-chip${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => {
                            // Toggle off if re-tapping the active preset → no tip.
                            if (on) { setTip(null) } else { setTip(amt) }
                            setCustomTip('')
                          }}
                        >
                          <bdi>{formatEuros(amt, locale)}</bdi>
                        </button>
                      )
                    })}
                    <span className="tip-custom">
                      <span className="ms" aria-hidden="true">euro</span>
                      <input
                        inputMode="decimal"
                        value={customTip}
                        onChange={(e) => { setCustomTip(e.target.value); if (e.target.value.trim()) setTip(null) }}
                        placeholder={t('tipCustomPlaceholder')}
                        aria-label={t('tipCustomPlaceholder')}
                        maxLength={6}
                      />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT column — sticky Summary panel on desktop */}
            <aside className="summary">
              <div className="summary__h">{t('summary')}</div>
              <div className="summary__b">
                {/* LOT 4 : la rangée « moyen de paiement » factice («•••• 4521»,
                    donnée fabriquée sans backend Stripe saved-cards) est RETIRÉE.
                    P0-30 reste acquis : le toggle espèces est RETIRÉ (Q2 — hors
                    pilote) ; la carte est le seul mode, payé au checkout Stripe. */}

                {/* P1-PROMO — promo-code input (gb-foundation styled). The preview
                    is server-validated; the real discount is applied at checkout. */}
                <div className="promo">
                  <div className="promo__label">
                    <span className="ms" aria-hidden="true">sell</span>{t('promoLabel')}
                  </div>
                  {promoState === 'applied' && promoPreview ? (
                    <div className="promo__applied">
                      <span className="ms" aria-hidden="true">check_circle</span>
                      <div className="promo__txt">
                        <b>{promoPreview.code}</b>
                        <span>{t('promoApplied', { amount: formatAmount(promoPreview.discountEur, locale) })}</span>
                      </div>
                      <button type="button" className="promo__clear" onClick={clearPromo}>{t('promoRemove')}</button>
                    </div>
                  ) : (
                    <>
                      <div className="promo__row">
                        <input
                          value={promoCode}
                          onChange={(e) => { setPromoCode(e.target.value); if (promoState !== 'idle') setPromoState('idle') }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo() } }}
                          placeholder={t('promoPlaceholder')}
                          aria-label={t('promoLabel')}
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          maxLength={40}
                        />
                        <button
                          type="button"
                          className="promo__apply"
                          onClick={applyPromo}
                          disabled={promoState === 'checking' || !promoCode.trim()}
                        >
                          {promoState === 'checking' ? <span className="spin" aria-hidden="true" /> : t('promoApply')}
                        </button>
                      </div>
                      {promoState === 'invalid' && <div className="promo__err">{t('promoInvalid')}</div>}
                      {promoState === 'error' && <div className="promo__err">{t('promoError')}</div>}
                    </>
                  )}
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
                {promoDiscount > 0 && promoPreview && (
                  <div className="srow disc">
                    <span>{t('promoDiscountLine', { code: promoPreview.code })}</span>
                    <span>-{formatEuros(promoDiscount, locale)}</span>
                  </div>
                )}
                <div className="srow">
                  <span>{fulfillment === 'pickup' ? t('feePickup') : t('feeDelivery')}</span>
                  <b>{fulfillment === 'pickup' ? t('free') : formatEuros(deliveryFee, locale)}</b>
                </div>
                {smallFeeApplies && (
                  <div className="srow"><span>{t('smallOrderFeeLine')}</span><b>{formatEuros(smallFeeEur, locale)}</b></div>
                )}
                {tipsEnabled && tipEur > 0 && (
                  <div className="srow"><span>{t('tipLine')}</span><b>{formatEuros(tipEur, locale)}</b></div>
                )}
                <div className="sdiv" />
                <div className="stotal"><span>{t('total')}</span><b>{formatEuros(total, locale)}</b></div>

                {/* Desktop CTA (lives in the sticky panel) */}
                {cta}
                <div className="reassure"><span className="ms" aria-hidden="true">lock</span>{t('securePayment')}</div>

                {error && (
                  /* P0-30bis — no `.ms` ligature next to the message: when the icon
                     font is unavailable the word « error » renders glued to the text
                     (« errorLa livraison… »). The refusal message displays alone. */
                  <div className="cart-err" role="alert">{error}</div>
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
