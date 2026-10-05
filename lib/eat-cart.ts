'use client'

// Lightweight shared cart helpers for the consumer app (/eat).
// The cart lives in sessionStorage and is handed off from the restaurant page to the
// cart page. These helpers centralise reads + change notifications so the BottomNav
// badge and Toast can react.
//
// ── CROSS-ACCOUNT LEAK (P0), AND WHY THE CART IS NOT THE ADDRESS BOOK ───────────────
// The cart used to live under ONE global key, `grubano_cart`, with no notion of whose it
// was and no clearing on sign-out (the only writeCart(null) is the one after a successful
// order). So: A fills a basket, A signs out, B signs in IN THE SAME TAB — sessionStorage
// is scoped to the tab, not the document, so it survives the sign-out navigation — B sees
// A's basket, taps « Commander », and POST /api/orders creates a REAL order whose
// consumerId is B's token.sub, carrying A's items and A's free-text per-line notes.
//
// Fixed the way the address cache was: per-owner bucket keys, an owner stamp INSIDE the
// stored value (a key/stamp mismatch reads EMPTY), a DECLARED owner (setCartOwner, from
// components/eat/EatShell.tsx) and FAIL-CLOSED reads/writes while the identity is unknown.
//
// ⭐ BUT ONE RULE IS THE OPPOSITE OF THE ADDRESS BOOK'S. The addresses may NEVER migrate
// upward: a local list whose owner cannot be proven is never adopted into an account.
// A cart MUST be able to: the product's « compte au paiement » flow has a guest fill a
// basket, tap « Commander », authenticate in the checkout sheet, and continue to the SAME
// order. So guest → user is a legitimate PROMOTION — but only as an EXPLICIT act of that
// one flow (promoteGuestCartToUser, called by the cart page after the SERVER has confirmed
// the new identity), never as an inference from "a guest bucket exists and someone just
// signed in". A normal sign-in from /eat/auth adopts nothing.
// And user A → guest → user B never promotes anything: a promotion only ever moves the
// GUEST bucket, and only when the checkout flow asks for it.
//
// The legacy `grubano_cart` key is unattributable by construction — it is the blob that
// leaked — so it is never read: it is deleted the first time an owner is declared. A
// pre-fix basket is lost once; that is the deliberate trade, security over convenience.

/** Customizations chosen for a dish. */
export interface EatCartItemOptions {
  /** Parent menu-item id (line id may differ if size/extras vary). */
  parentDishId?: string
  /** Size label (Petite / Moyenne / Grande). */
  size?: string
  /** Chosen supplements with their per-item price. */
  supplements?: { name: string; price: number }[]
  /** Excluded ingredients (sans oignon, sans gluten…). */
  exclusions?: string[]
  /** Free-form note from the customer. */
  note?: string
}

export interface EatCartLineItem {
  /** `item.id` is the LINE id (dish id, or composite when customised). */
  item: { id: string; name: string; price: number; photos: string[] }
  qty: number
  /** Per-line customisations. Sent to /api/orders as `options[]`. */
  options?: EatCartItemOptions
}

export interface EatCartData {
  restaurantId: string
  items: EatCartLineItem[]
  restaurant: {
    name: string
    deliveryFee: number
    minOrder: number
    /** Used by the cart's pickup mode and fallback fetches. */
    address?: string
    city?: string
    deliveryTime?: number
  }
}

/** Who the cart belongs to: a signed-in operator id, or this tab's anonymous visitor. */
export type CartOwner = { kind: 'user'; id: string } | { kind: 'guest' }

/** UNATTRIBUTABLE legacy bucket — never read, deleted on the first owner declaration. */
const LEGACY_KEY = 'grubano_cart'
const PREFIX = 'grubano_cart.v2.'
export const CART_EVENT = 'grubano:cart'
export const TOAST_EVENT = 'grubano:toast'

function keyFor(o: CartOwner): string {
  return o.kind === 'user' ? `${PREFIX}u.${o.id}` : `${PREFIX}guest`
}
/** The owner stamp stored INSIDE the value — a second lock, so a bucket that was copied
 *  or landed under the wrong key cannot be read as the current owner's. */
function stampFor(o: CartOwner): string {
  return o.kind === 'user' ? `u:${o.id}` : 'guest'
}
function sameOwner(a: CartOwner | null, b: CartOwner | null): boolean {
  if (!a || !b) return false
  return stampFor(a) === stampFor(b)
}

/** null = the identity has NOT been declared ⇒ nothing is read and nothing is written. */
let owner: CartOwner | null = null

type Envelope = { owner: string; cart: EatCartData }

/**
 * Declare whose cart may be served. Called from the session-aware shell on mount and on
 * EVERY identity change. It MIGRATES NOTHING — promotion is a separate, explicit act
 * (promoteGuestCartToUser). Emits CART_EVENT on a change so every badge and screen
 * re-reads at once. Returns true when the owner actually changed.
 */
export function setCartOwner(next: CartOwner): boolean {
  // NEVER on the server: module state is shared by every concurrent request there, so
  // declaring an identity would leak one visitor's owner into another's render.
  if (typeof window === 'undefined') return false
  const changed = !sameOwner(owner, next)
  const first = owner === null
  owner = next
  if (first || changed) {
    // The legacy single-key basket cannot be attributed to anyone, and it is the blob that
    // leaked across accounts. Destroyed rather than adopted.
    try { sessionStorage.removeItem(LEGACY_KEY) } catch { /* ignore */ }
  }
  if (changed) emitCart()
  return changed
}

/** Forget the identity: reads empty, writes refused, until a new owner is declared. */
export function clearCartOwner(): void {
  if (typeof window === 'undefined') return
  const had = owner !== null
  owner = null
  if (had) emitCart()
}

/** The declared owner, or null while the identity is unknown. */
export function getCartOwner(): CartOwner | null {
  return owner
}

/** The stamp the cart currently in the store would be read under. Captured by a consumer
 *  at read time and compared, during render, with the stamp the SESSION implies. */
export function currentCartStamp(): string | null {
  return owner ? stampFor(owner) : null
}

/**
 * The stamp a next-auth session implies — available in the SAME render as the new session.
 * THE FIRST-FRAME GUARD: the owner is declared in an effect, and effects run AFTER the
 * render that introduced a new session (child effects even before the parent's), so a
 * consumer holding the cart in React state would paint the previous owner's basket for one
 * committed frame. Comparing the captured stamp with this one closes that frame.
 * FAIL CLOSED: null while loading, and null for an authenticated session with no usable id.
 */
export function sessionCartStamp(status: string, userId?: string | null): string | null {
  if (status === 'authenticated') return userId ? `u:${userId}` : null
  if (status === 'unauthenticated') return 'guest'
  return null // 'loading' — identity unknown
}

function emitCart() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CART_EVENT))
}

function readFor(o: CartOwner): EatCartData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(keyFor(o))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    // v2 envelope ONLY. A bare EatCartData is the legacy shape or a hand-written value:
    // unattributable, so it reads as empty rather than as the current owner's.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const env = parsed as Partial<Envelope>
    if (env.owner !== stampFor(o)) return null
    return env.cart && typeof env.cart === 'object' ? (env.cart as EatCartData) : null
  } catch {
    return null
  }
}

function writeFor(o: CartOwner, data: EatCartData | null) {
  if (typeof window === 'undefined') return
  try {
    if (data) sessionStorage.setItem(keyFor(o), JSON.stringify({ owner: stampFor(o), cart: data } satisfies Envelope))
    else sessionStorage.removeItem(keyFor(o))
  } catch {
    /* ignore quota errors */
  }
  emitCart()
}

export function readCart(): EatCartData | null {
  if (!owner) return null // identity not declared yet → fail closed
  return readFor(owner)
}

export function writeCart(data: EatCartData | null) {
  if (!owner) return // an unattributed write is how the leak started
  writeFor(owner, data)
}

export function cartCount(): number {
  const c = readCart()
  return c ? c.items.reduce((s, l) => s + l.qty, 0) : 0
}

/**
 * EXPLICIT guest → user promotion. The ONLY path by which a basket changes owner, and it
 * only ever moves the GUEST bucket.
 *
 * Called by the cart page from the « compte au paiement » flow, AFTER the server has
 * confirmed the new identity (the React session provider may not have caught up yet, and
 * the e-mail the visitor typed is not an identity). It declares the user as the owner
 * either way, so a sign-in with an empty guest basket still lands on the right bucket.
 *
 * The guest basket WINS over one the user may already have in this tab, and that is
 * deliberate: the page the visitor was looking at when they tapped « Commander » reads the
 * current owner, which was the guest — so that is the basket they are ordering. Keeping an
 * older `u.<id>` basket instead would charge them for items they were not shown, which is
 * worse than losing a basket they themselves abandoned. Nothing can be pulled in across
 * accounts either way: the source is only ever this tab's `…v2.guest`, and the destination
 * is the identity the SERVER just confirmed. Returns true when a basket was moved.
 */
export function promoteGuestCartToUser(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false
  const guest: CartOwner = { kind: 'guest' }
  const user: CartOwner = { kind: 'user', id: userId }
  const pending = readFor(guest)
  let moved = false
  if (pending) {
    writeFor(user, pending)
    moved = true
    writeFor(guest, null) // the anonymous basket does not survive the promotion
  }
  owner = user
  emitCart()
  return moved
}

/**
 * Empty ONE named user's basket, without consulting — or touching — the mutable current
 * owner. For the success path of an order: the order was created for a PROVEN identity, so
 * that is the basket to clear.
 *
 * WHY THIS EXISTS. `writeCart(null)` acts on whatever the module owner is AT THAT MOMENT.
 * After a successful POST the response can arrive late: if the identity changed while the
 * request was in flight (a sign-in in another tab, EatShell declaring the new owner), the
 * old code would have emptied the NEW account's basket — a cross-account DESTRUCTION on
 * the one path that is supposed to be the happy one.
 *
 * It verifies the stored stamp before deleting, so it can only ever remove a value that
 * really is that user's; it leaves the declared owner untouched; and it emits CART_EVENT so
 * the badge and the screens re-read. There is deliberately NO general "move a basket from
 * one owner to another" primitive: the only cross-identity move in this module is the
 * guest-to-user promotion below, which reads one fixed source.
 */
export function clearUserCart(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false
  const target: CartOwner = { kind: 'user', id: userId }
  try {
    const raw = sessionStorage.getItem(keyFor(target))
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
      if ((parsed as Partial<Envelope>).owner !== stampFor(target)) return false
    }
    sessionStorage.removeItem(keyFor(target))
  } catch {
    return false
  }
  emitCart()
  return true
}

/** One-shot, tab-scoped authorisation for the promotion below. */
const PROMOTE_INTENT_KEY = PREFIX + 'promote'

/**
 * Record that the CART's checkout parcours is handing the visitor off to authenticate
 * elsewhere (« utiliser mon mot de passe » → /eat/auth, or the e-mailed magic LINK →
 * /eat/magic). Those paths leave this page, so they cannot call the promotion themselves;
 * this is the explicit authorisation that lets the identity authority do it once on their
 * behalf. Written ONLY by that parcours — never by a sign-in, never inferred.
 */
export function markGuestCartPromotionIntent(): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(PROMOTE_INTENT_KEY, '1') } catch { /* ignore */ }
}

/** Read AND clear the authorisation. One shot: a second sign-in in this tab promotes nothing. */
export function consumeGuestCartPromotionIntent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const had = sessionStorage.getItem(PROMOTE_INTENT_KEY) === '1'
    sessionStorage.removeItem(PROMOTE_INTENT_KEY)
    return had
  } catch {
    return false
  }
}

/** Test-only: forget the declared identity between cases. */
export function __resetCartOwner(): void {
  owner = null
}

export function showToast(message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }))
}

// ── Favorite restaurants, PER OWNER (persisted in localStorage) ───────────
//
// WHAT WAS WRONG. One key, `grubano_favs`, for the whole browser, with no identity in the
// key and none in the value. A favourited restaurant R; A signed out; B signed in on the
// same browser and saw R hearted, counted in « Favoris », listed on /eat/favorites and
// filtering /eat/search. And it was worse than a read: when B un-hearted R, B rewrote that
// same key, so A's favourite was DESTROYED. A cross-account leak of a preference, and a
// destructive corruption in both directions.
//
// THE OWNER IS THE SESSION. `grubano_favs.v2.u.<userId>` for a signed-in account,
// `grubano_favs.v2.guest` for a visitor, and the stored envelope REPEATS the owner, so a
// value that landed under the wrong key — or was copied there — reads EMPTY instead of
// reading as the current owner's.
//
// GUEST: a separate bucket, and NO promotion in either direction, ever. A visitor's hearts
// stay the visitor's; signing in does not adopt them and signing out does not inherit the
// account's. There is no product requirement for a transfer here, and inventing one is how
// a preference crosses accounts. (The consumer CART does promote, on an explicit act of the
// « compte au paiement » flow — that rule is the cart's and does not transpose.)
//
// LEGACY: the old global key is UNATTRIBUTABLE — it is the blob that leaked, and it may
// hold hearts belonging to someone who is not the person signing in now. It is never read
// and never written, by anyone: it is not migrated to the first account that connects, and
// it is not deleted either, because destroying data this lot was only asked to ignore is
// not ours to do. It simply becomes inert.
//
// The ambiguous global API (readFavs / isFav / toggleFav) is REMOVED rather than kept
// alongside: a function that cannot say WHO is reading should not be reachable at all.
const FAV_PREFIX = 'grubano_favs.v2.'
export const FAV_EVENT = 'grubano:favs'

/** `u:<userId>` or `guest` — the same token lib/eat-cart already uses for the cart. */
export type FavOwner = string

/** null = the identity is unknown (session still resolving, or no usable id) ⇒ fail closed. */
let liveFavOwner: FavOwner | null = null

type FavEnvelope = { owner: string; ids: string[] }

/**
 * The favourites owner a next-auth session implies. Available in the SAME render as the new
 * session, which is what makes a first-frame guard possible: the owner is declared in an
 * effect, and effects run AFTER the render that introduced the new session, so a component
 * holding ids in state would paint the previous account's hearts for one committed frame.
 *
 * Delegates to sessionCartStamp so there is ONE definition of what a session's identity is,
 * under a name that says favourites.
 */
export function favOwner(status: string, userId?: string | null): FavOwner | null {
  return sessionCartStamp(status, userId)
}

/** The bucket for an owner. Both the key and the value name it. */
export function favKeyFor(owner: FavOwner): string {
  if (owner === 'guest') return `${FAV_PREFIX}guest`
  return `${FAV_PREFIX}u.${owner.slice('u:'.length)}`
}

/**
 * Declare the owner the browser currently belongs to, from the live session. Writes are
 * re-validated against it, so a handler captured under A cannot write as A once the session
 * is B — the guard the stale closure carries is not the one that decides.
 */
export function setFavOwner(owner: FavOwner | null): void {
  if (typeof window === 'undefined') return // module state is shared across requests there
  liveFavOwner = owner
}

export function getFavOwner(): FavOwner | null {
  return liveFavOwner
}

/** This owner's favourites. [] for an unknown owner, and [] for anything unattributable. */
export function readFavsForOwner(owner: FavOwner | null): string[] {
  if (typeof window === 'undefined' || !owner) return []
  try {
    const raw = localStorage.getItem(favKeyFor(owner))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    // v2 envelope ONLY. A bare array is the legacy shape or a hand-written value:
    // unattributable, so it reads empty rather than as this owner's.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const env = parsed as Partial<FavEnvelope>
    if (env.owner !== owner || !Array.isArray(env.ids)) return []
    const out: string[] = []
    for (const v of env.ids) if (typeof v === 'string' && v && !out.includes(v)) out.push(v)
    return out
  } catch {
    return []
  }
}

export function isFavForOwner(owner: FavOwner | null, id: string): boolean {
  if (!owner || !id) return false
  return readFavsForOwner(owner).includes(id)
}

/**
 * Toggle one restaurant for a NAMED owner. Returns the new state, or null when the write
 * was REFUSED — which the caller must treat as "nothing happened".
 *
 * It refuses unless the owner it was asked to write for is the one currently declared. That
 * is the whole point: the page that captured this handler may have been rendered under A,
 * and the click may arrive after the session became B.
 */
export function toggleFavForOwner(owner: FavOwner | null, id: string): boolean | null {
  if (typeof window === 'undefined' || !owner || !id) return null
  if (liveFavOwner === null || owner !== liveFavOwner) return null
  const favs = readFavsForOwner(owner)
  const exists = favs.includes(id)
  const next = exists ? favs.filter((f) => f !== id) : [...favs, id]
  try {
    const key = favKeyFor(owner)
    if (next.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ owner, ids: next } as FavEnvelope))
    // The event NAMES its owner, so a listener can tell its own change from someone else's.
    window.dispatchEvent(new CustomEvent(FAV_EVENT, { detail: { owner } }))
  } catch {
    /* storage full / disabled — a favourite is a convenience */
  }
  return !exists
}

/**
 * Is this FAV_EVENT this owner's? FAIL CLOSED: an event with no owner in its detail — an
 * old bundle in another tab, or anything else dispatching the bare event — is foreign, so
 * it is ignored rather than taken as a reason to re-read.
 */
export function favEventIsMine(e: Event, owner: FavOwner | null): boolean {
  if (!owner) return false
  const detail = (e as CustomEvent).detail as { owner?: unknown } | undefined
  return !!detail && detail.owner === owner
}

/**
 * Does this native `storage` event touch THIS owner's bucket? A change to another account's
 * bucket must not even cause a re-read, let alone an adoption. `key === null` is
 * localStorage.clear(), which concerns everyone.
 */
export function favStorageIsMine(e: StorageEvent, owner: FavOwner | null): boolean {
  if (!owner) return false
  return e.key === null || e.key === favKeyFor(owner)
}

/** Test-only: forget the declared owner between cases. */
export function __resetFavOwner(): void {
  liveFavOwner = null
}
