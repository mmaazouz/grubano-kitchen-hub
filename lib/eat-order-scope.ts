'use client'

// ── OWNER-SCOPED ORDER READS FOR THE AUXILIARY CONSUMER ORDER PAGES ────────────────────
//
// /eat/order/[orderId]/{pickup,rate,help} each read ONE owner-scoped document —
// GET /api/orders/[id] — and keep it in React state for as long as the component stays
// mounted. Under app/[locale]/eat/layout.tsx that mount SURVIVES an account switch: NextAuth
// broadcasts `setSession` across tabs without flipping `status` through 'unauthenticated',
// so an effect keyed on `[authStatus, orderId]` never re-fires on A → B, and the page keeps
// painting A's pickup QR / items / totals / tip / refund figures / claim scope for B.
//
// /eat/track/[orderId] (PR #21) closed this with a PAIR stamp (identity, orderId), a
// fail-closed reset BEFORE any request, a server owner echo (`ownerId === token.sub`), and
// a render-time gate. This leaf EXPORTS those decisions so the three auxiliary pages run
// the SAME code and the tests execute it instead of re-describing it (⭐ a test that models
// the discipline only proves the model agrees with its author). It is deliberately a
// client-safe leaf: it imports nothing but the shared stamp primitive.
//
// The track page itself is NOT refactored onto this module: that fix is merged and its
// behaviour is pinned byte-for-byte by tests/eat-track-account-isolation.test.ts.

import { sessionCartStamp } from '@/lib/eat-cart'

/** A value kept WITH the stamp of the (identity, orderId) pair it was read under. */
export interface Scoped<T> {
  stamp: string | null
  value: T | null
}

/** The resting shape: nothing owned, nothing stamped. */
export function emptyScoped<T>(): Scoped<T> {
  return { stamp: null, value: null }
}

/**
 * THE PAIR STAMP the SESSION + ROUTE imply right now — computed during render, so it moves
 * in the SAME frame as a new session or a new route param (effects run only after that
 * frame has committed). Identity half = the repository's own `sessionCartStamp` (null while
 * loading, null for an authenticated session without a usable id, 'guest' when signed out).
 * Route half = the order id. FAIL CLOSED: null unless BOTH halves are known. A GUEST never
 * gets a stamp either — an owner-scoped order has no meaning for a visitor, so nothing of
 * one may ever be shown or requested under 'guest'.
 */
export function orderScopeStamp(status: string, userId: string | null | undefined, orderId: unknown): string | null {
  const identity = sessionCartStamp(status, userId)
  if (identity === null || identity === 'guest') return null
  if (typeof orderId !== 'string' || orderId.length === 0) return null
  // JSON.stringify is unambiguous even when an order id contains delimiters.
  return JSON.stringify([identity, orderId])
}

/**
 * RENDER-TIME GATE. A stored value is visible only while its stamp equals the stamp the
 * live session + route imply. Unknown identity (null) matches NOTHING: a value is never
 * shown while we cannot say whose screen this is.
 */
export function scopedValue<T>(state: Scoped<T>, liveStamp: string | null): T | null {
  if (liveStamp === null || state.stamp === null) return null
  return state.stamp === liveStamp ? state.value : null
}

/**
 * « STILL LOADING » derived from the stamps, not from a separate flag that could drift:
 * the pair the session + route imply is known, and the state has not been answered FOR
 * THAT PAIR yet (neither a value nor a stamped empty). The frame right after an account
 * switch — before the effect re-runs — reads pending, never « not found », never A's data.
 */
export function scopePending<T>(state: Scoped<T>, liveStamp: string | null): boolean {
  return liveStamp !== null && state.stamp !== liveStamp
}

/**
 * ADOPT a GET /api/orders/[id] body ONLY when the SERVER named the SAME raw id the request was
 * issued under. The `typeof` half matters: a body that OMITS `ownerId` (older bundle, cache,
 * proxy) must not slip through on `undefined === undefined`. A mismatch — the browser attached
 * B's cookie to a request React still believed was A's — is a FAILED load, never a body to show.
 */
export function adoptOwnedOrder<T>(body: unknown, requestUserId: string): T | null {
  if (typeof requestUserId !== 'string' || requestUserId.length === 0) return null
  if (body === null || typeof body !== 'object') return null
  const b = body as { ownerId?: unknown; order?: unknown }
  if (typeof b.ownerId !== 'string' || b.ownerId !== requestUserId) return null
  if (b.order === null || typeof b.order !== 'object') return null
  return b.order as T
}

export interface LoadOwnedOrderArgs {
  orderId: string
  /** The pair stamp the request is issued FOR — what the result is stamped with. */
  requestStamp: string
  /** The raw next-auth id the request is issued UNDER — what the server echo must equal. */
  requestUserId: string
  /** False once the issuing effect was cleaned up (identity or route moved on). */
  isAlive: () => boolean
  fetchImpl?: typeof fetch
}

/**
 * THE WHOLE LOAD, with every failure mode closed on the same side:
 *   • 401 / 403 / 404 / 5xx → a STAMPED EMPTY (`value: null`). NO redirect: a stale request
 *     from a previous identity must never trampoline a now-signed-in user through /eat/auth.
 *     The stamp says « this pair was asked and owns nothing », which is how the page tells
 *     « not found » from « still loading » without a second piece of state that could drift.
 *   • invalid JSON, a rejected fetch, a body naming nobody or someone else → stamped empty too.
 *   • disowned while in flight (`isAlive()` false) → null: NOTHING is offered to the caller,
 *     so a late answer — success or failure — for a previous account or route cannot be
 *     committed, not even as an empty.
 * Never throws.
 */
export async function loadOwnedOrder<T>(args: LoadOwnedOrderArgs): Promise<Scoped<T> | null> {
  const { orderId, requestStamp, requestUserId, isAlive } = args
  const doFetch = args.fetchImpl ?? fetch
  const denied: Scoped<T> = { stamp: requestStamp, value: null }
  try {
    const res = await doFetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: 'no-store' })
    if (!isAlive()) return null
    if (!res.ok) return denied
    const body: unknown = await res.json()
    if (!isAlive()) return null
    const order = adoptOwnedOrder<T>(body, requestUserId)
    if (order === null) return denied
    return { stamp: requestStamp, value: order }
  } catch {
    return isAlive() ? denied : null
  }
}
