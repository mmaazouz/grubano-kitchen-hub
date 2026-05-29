'use client'

// Lightweight shared cart helpers for the consumer app (/eat).
// The cart lives in sessionStorage under `grubano_cart` and is handed off
// from the restaurant page to the cart page. These helpers centralise reads
// + change notifications so the BottomNav badge and Toast can react.

export interface EatCartLineItem {
  item: { id: string; name: string; price: number; photos: string[] }
  qty: number
}

export interface EatCartData {
  restaurantId: string
  items: EatCartLineItem[]
  restaurant: { name: string; deliveryFee: number; minOrder: number }
}

const KEY = 'grubano_cart'
export const CART_EVENT = 'grubano:cart'
export const TOAST_EVENT = 'grubano:toast'

export function readCart(): EatCartData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as EatCartData) : null
  } catch {
    return null
  }
}

export function writeCart(data: EatCartData | null) {
  if (typeof window === 'undefined') return
  if (data) sessionStorage.setItem(KEY, JSON.stringify(data))
  else sessionStorage.removeItem(KEY)
  window.dispatchEvent(new CustomEvent(CART_EVENT))
}

export function cartCount(): number {
  const c = readCart()
  return c ? c.items.reduce((s, l) => s + l.qty, 0) : 0
}

export function showToast(message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }))
}

// ── Favorite restaurants (persisted in localStorage) ──────────────────────
const FAV_KEY = 'grubano_favs'
export const FAV_EVENT = 'grubano:favs'

export function readFavs(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(FAV_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function isFav(id: string): boolean {
  return readFavs().includes(id)
}

/** Toggle a restaurant favorite. Returns the new favorited state. */
export function toggleFav(id: string): boolean {
  const favs = readFavs()
  const exists = favs.includes(id)
  const next = exists ? favs.filter((f) => f !== id) : [...favs, id]
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(FAV_EVENT))
  } catch {
    /* ignore */
  }
  return !exists
}
