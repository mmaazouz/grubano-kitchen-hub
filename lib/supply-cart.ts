// ── Buyer-side supply cart — client localStorage bridge (flux acheteur, Lot D→E) ─
//
// One cart PER supplier (a SupplyOrder = one supplier). The catalog screen (Lot D)
// writes the chosen quantities here; the cart screen (Lot E) reads them back after
// navigation. DISPLAY/UX ONLY — this holds quantities keyed by catalogItemId, never
// a price or a total: Lot E re-fetches the supplier's REAL priceCents server-side
// and the POST /api/marketplace/orders re-snapshots + re-enforces the minimum. So a
// stale/forged localStorage value can never change what is charged — the server is
// the single source of truth for money. Client-only (uses localStorage); guarded for
// SSR so importing it in a client module never throws during prerender.

export interface SupplyCart {
  [catalogItemId: string]: number
}

const key = (supplierId: string) => `grubano.supplyCart.${supplierId}`

/** Read the saved quantities for a supplier. Returns {} on any error / SSR. */
export function readSupplyCart(supplierId: string): SupplyCart {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(key(supplierId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: SupplyCart = {}
    for (const [id, q] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Math.floor(Number(q))
      if (Number.isFinite(n) && n > 0) out[id] = n
    }
    return out
  } catch {
    return {}
  }
}

/** Persist quantities for a supplier (drops zero/negatives). No-op on SSR/error. */
export function writeSupplyCart(supplierId: string, cart: SupplyCart): void {
  if (typeof window === 'undefined') return
  try {
    const clean: SupplyCart = {}
    for (const [id, q] of Object.entries(cart)) {
      const n = Math.floor(Number(q))
      if (Number.isFinite(n) && n > 0) clean[id] = n
    }
    if (Object.keys(clean).length === 0) window.localStorage.removeItem(key(supplierId))
    else window.localStorage.setItem(key(supplierId), JSON.stringify(clean))
  } catch {
    /* storage full / disabled — ignore, cart is a UX convenience */
  }
}

/** Clear a supplier's cart (after a successful order). No-op on SSR/error. */
export function clearSupplyCart(supplierId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key(supplierId))
  } catch {
    /* ignore */
  }
}

/** Total number of units across the cart. */
export function supplyCartCount(cart: SupplyCart): number {
  return Object.values(cart).reduce((s, q) => s + (q > 0 ? q : 0), 0)
}
