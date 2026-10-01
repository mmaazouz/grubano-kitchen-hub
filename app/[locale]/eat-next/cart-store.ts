'use client'

import { useEffect, useState } from 'react'

// ── /eat-next REAL cart store (Phase 2, Agent 133) ─────────────────────────────
// A shared, client-only cart for the /eat-next redesign, ISOLATED from the current /eat cart
// (lib/eat-cart, key 'grubano_cart'): this one lives under a DEDICATED key 'grubano:eat-next:cart'
// in sessionStorage, so adding to the /eat-next cart never touches /eat and vice-versa. Calques the
// lib/eat-cart pattern (module helpers + a CustomEvent for cross-component sync) WITHOUT importing or
// modifying it. MONO-RESTAURANT: a cart holds a single restaurantId (the order has one). ZERO money:
// the "total" is a NAÏVE display sum (price×qty) — NO lib/pricing, NO lib/commission, NO /api/orders.
// The real total/fees/commission are computed SERVER-SIDE at order creation (brick 2e). Client state
// only — NO DB write.

export interface EatNextCartItem {
  itemId: string
  name: string
  priceEur: number // EUROS — matches the future POST /api/orders items[].price
  qty: number
  options?: Record<string, unknown>[]
}

export interface EatNextCart {
  restaurantId: string
  restaurantName: string
  items: EatNextCartItem[]
}

// DEDICATED key — intentionally DIFFERENT from /eat's 'grubano_cart' (isolation).
export const EAT_NEXT_CART_KEY = 'grubano:eat-next:cart'
export const EAT_NEXT_CART_EVENT = 'grubano:eat-next:cart'

// Line identity = itemId + serialized options (forward-compatible with per-line options).
const lineKey = (itemId: string, options?: Record<string, unknown>[]): string =>
  itemId + '|' + (options && options.length ? JSON.stringify(options) : '')

// ── PURE reducers (no DOM, unit-testable) ─────────────────────────────────────

/** Add an item. MONO-RESTAURANT: an item from a DIFFERENT restaurant REPLACES the whole cart. */
export function addToCart(
  cart: EatNextCart | null,
  restaurant: { restaurantId: string; restaurantName: string },
  item: EatNextCartItem,
): EatNextCart {
  const qty = Math.max(1, Math.floor(item.qty || 1))
  if (!cart || cart.restaurantId !== restaurant.restaurantId || cart.items.length === 0) {
    return { restaurantId: restaurant.restaurantId, restaurantName: restaurant.restaurantName, items: [{ ...item, qty }] }
  }
  const key = lineKey(item.itemId, item.options)
  const idx = cart.items.findIndex((l) => lineKey(l.itemId, l.options) === key)
  const items = idx >= 0
    ? cart.items.map((l, i) => (i === idx ? { ...l, qty: l.qty + qty } : l))
    : [...cart.items, { ...item, qty }]
  return { ...cart, items }
}

/** Set a line's quantity. qty ≤ 0 removes the line; emptying the cart returns null. */
export function setQtyInCart(
  cart: EatNextCart | null, itemId: string, qty: number, options?: Record<string, unknown>[],
): EatNextCart | null {
  if (!cart) return null
  const key = lineKey(itemId, options)
  const items = cart.items
    .map((l) => (lineKey(l.itemId, l.options) === key ? { ...l, qty: Math.max(0, Math.floor(qty)) } : l))
    .filter((l) => l.qty > 0)
  return items.length ? { ...cart, items } : null
}

export function removeFromCart(
  cart: EatNextCart | null, itemId: string, options?: Record<string, unknown>[],
): EatNextCart | null {
  if (!cart) return null
  const key = lineKey(itemId, options)
  const items = cart.items.filter((l) => lineKey(l.itemId, l.options) !== key)
  return items.length ? { ...cart, items } : null
}

export function cartCount(cart: EatNextCart | null): number {
  return cart ? cart.items.reduce((s, l) => s + l.qty, 0) : 0
}

/** NAÏVE display subtotal (Σ price×qty). NOT a money calc — real total/fees = server (brick 2e). */
export function cartSubtotalEur(cart: EatNextCart | null): number {
  return cart ? cart.items.reduce((s, l) => s + l.priceEur * l.qty, 0) : 0
}

// ── sessionStorage-backed store (ISOLATED key) + CustomEvent sync ──────────────

export function readCart(): EatNextCart | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(EAT_NEXT_CART_KEY)
    return raw ? (JSON.parse(raw) as EatNextCart) : null
  } catch {
    return null
  }
}

function writeCart(cart: EatNextCart | null) {
  if (typeof window === 'undefined') return
  try {
    if (cart && cart.items.length) sessionStorage.setItem(EAT_NEXT_CART_KEY, JSON.stringify(cart))
    else sessionStorage.removeItem(EAT_NEXT_CART_KEY)
  } catch {
    /* storage full / disabled — ignore (cart is best-effort client state) */
  }
  window.dispatchEvent(new CustomEvent(EAT_NEXT_CART_EVENT))
}

// Imperative actions (read → pure reducer → write + notify).
export function addItem(restaurant: { restaurantId: string; restaurantName: string }, item: EatNextCartItem): EatNextCart {
  const next = addToCart(readCart(), restaurant, item)
  writeCart(next)
  return next
}
export function setItemQty(itemId: string, qty: number, options?: Record<string, unknown>[]) {
  writeCart(setQtyInCart(readCart(), itemId, qty, options))
}
export function removeItem(itemId: string, options?: Record<string, unknown>[]) {
  writeCart(removeFromCart(readCart(), itemId, options))
}
export function clearCart() {
  writeCart(null)
}

// React hook — subscribe to the cart event so every /eat-next screen stays in sync.
export function useEatNextCart() {
  const [cart, setCart] = useState<EatNextCart | null>(null)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const sync = () => setCart(readCart())
    sync()
    setHydrated(true)
    window.addEventListener(EAT_NEXT_CART_EVENT, sync)
    return () => window.removeEventListener(EAT_NEXT_CART_EVENT, sync)
  }, [])
  return {
    cart,
    hydrated,
    count: cartCount(cart),
    subtotalEur: cartSubtotalEur(cart),
    addItem,
    setItemQty,
    removeItem,
    clearCart,
  }
}
