import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT CONSUMER CART (P0) ──────────────────────────────────────────
//
// WHAT WAS WRONG. `grubano_cart` lived in sessionStorage under ONE global key with no
// owner and no clearing on sign-out (the only writeCart(null) is the one after a
// successful order). sessionStorage is scoped to the TAB, not the document, so it survives
// the sign-out navigation: account A filled a basket, A signed out, B signed in IN THE SAME
// TAB, B saw A's basket, and B's « Commander » created a REAL order — consumerId is B's
// token.sub — carrying A's items and A's free-text per-line notes. The server re-prices, so
// no money was misstated; the ORDER was still A's basket under B's name.
//
// THE RULE IS NOT THE ADDRESS BOOK'S. Addresses may never migrate upward. A cart MUST be
// able to: the « compte au paiement » flow has a guest fill a basket, tap « Commander »,
// authenticate in the checkout sheet and continue to the SAME order. So guest → user is a
// legitimate PROMOTION — but only as an explicit act of that one flow, after the SERVER has
// named the identity, and never as an inference from "a guest bucket exists and someone
// signed in". A → guest → B promotes nothing.
//
// WHAT IS MOCKED. Nothing of the library: it runs for real against an in-memory
// sessionStorage. The server guard runs the real POST handler with prisma/getToken mocked,
// the way the other order-route suites do. The UI cases are asserted on source — this
// repository has no DOM harness (vitest `environment: 'node'`), and the regressions they
// exist to stop are textual.

// ── minimal browser surface ───────────────────────────────────────────────────
class MemStorage {
  private m = new Map<string, string>()
  get length(): number { return this.m.size }
  key(i: number): string | null { return Array.from(this.m.keys())[i] ?? null }
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null }
  setItem(k: string, v: string): void { this.m.set(k, String(v)) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
  keys(): string[] { return Array.from(this.m.keys()) }
}
const store = new MemStorage()
const events: string[] = []
const win = new EventTarget()
;(globalThis as { window?: unknown }).window = win
;(globalThis as { sessionStorage?: unknown }).sessionStorage = store
;(globalThis as { localStorage?: unknown }).localStorage = new MemStorage()
win.addEventListener('grubano:cart', () => { events.push('cart') })

// ── the server handler, with the same harness the sibling order suites use ────
const { db, tokenMock } = vi.hoisted(() => ({
  db: {
    restaurant: { findFirst: vi.fn() },
    menuItem: { findMany: vi.fn() },
    order: { create: vi.fn(), update: vi.fn(), count: vi.fn() },
    creator: { findFirst: vi.fn() },
    affiliate: { findFirst: vi.fn() },
    referral: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
    referralOrder: { findUnique: vi.fn(), create: vi.fn() },
    dishAdoption: { findMany: vi.fn() },
    dishSale: { findFirst: vi.fn(), createMany: vi.fn() },
    creatorDish: { update: vi.fn() },
    adoptionConfig: { findFirst: vi.fn() },
    loyaltyCustomer: { findUnique: vi.fn() },
    promoRedemption: { create: vi.fn() },
    promotion: { findMany: vi.fn() },
  },
  tokenMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

import {
  readCart, writeCart, cartCount, setCartOwner, clearCartOwner, getCartOwner,
  currentCartStamp, sessionCartStamp, promoteGuestCartToUser, __resetCartOwner,
  type EatCartData,
} from '@/lib/eat-cart'
import { POST as createOrder } from '@/app/api/orders/route'

const LEGACY_KEY = 'grubano_cart'
const bucketOf = (o: string) => (o === 'guest' ? 'grubano_cart.v2.guest' : `grubano_cart.v2.u.${o}`)

/** A's basket, with the free-text note that makes this a privacy leak and not just dish ids. */
const CART_A: EatCartData = {
  restaurantId: 'r-mama',
  items: [{
    item: { id: 'd1', name: 'Tagliatelles à la truffe', price: 18, photos: [] },
    qty: 1,
    options: { note: 'interphone 4512B, 3e étage', exclusions: ['sans noix'], size: 'Grande' },
  }],
  restaurant: { name: 'Mama Trattoria', deliveryFee: 2.99, minOrder: 15 },
}
const CART_B: EatCartData = {
  restaurantId: 'r-pizza',
  items: [{ item: { id: 'd9', name: 'Margherita', price: 14, photos: [] }, qty: 2 }],
  restaurant: { name: 'Bella', deliveryFee: 1.99, minOrder: 10 },
}

function seed(owner: string, cart: EatCartData) {
  store.setItem(bucketOf(owner), JSON.stringify({ owner: owner === 'guest' ? 'guest' : `u:${owner}`, cart }))
}

beforeEach(() => {
  store.clear()
  events.length = 0
  vi.clearAllMocks()
  __resetCartOwner()
})
afterEach(() => { __resetCartOwner() })

// ── A…F : the basket belongs to whoever built it ──────────────────────────────

describe('A–F — one basket per identity', () => {
  it('[A] A builds a basket and sees it', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    expect(readCart()).toEqual(CART_A)
    expect(cartCount()).toBe(1)
    expect(store.keys()).toEqual([bucketOf('A')])
    expect(JSON.parse(store.getItem(bucketOf('A')) as string).owner).toBe('u:A')
  })

  it('[B] A → logout: the basket is NOT the guest basket, and the guest starts empty', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    setCartOwner({ kind: 'guest' })
    expect(readCart(), 'the guest must start empty').toBeNull()
    expect(cartCount()).toBe(0)
    // A's bucket survives under A — unreachable as guest.
    expect(store.getItem(bucketOf('A'))).toContain('truffe')
    expect(store.getItem(bucketOf('guest'))).toBeNull()
  })

  it('[C] A → B: B sees nothing of A, before any network call', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    setCartOwner({ kind: 'user', id: 'B' })
    expect(readCart()).toBeNull()
    expect(cartCount()).toBe(0)
  })

  it('[D] none of A’s notes, exclusions or options is reachable as B', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    setCartOwner({ kind: 'user', id: 'B' })
    const visible = JSON.stringify(readCart())
    for (const secret of ['interphone 4512B', 'sans noix', 'Grande', 'truffe']) {
      expect(visible, secret).not.toContain(secret)
    }
  })

  it('[E] B cannot modify or delete A’s basket', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    setCartOwner({ kind: 'user', id: 'B' })
    writeCart(CART_B)                       // B writes its own
    expect(store.getItem(bucketOf('A'))).toContain('truffe')   // untouched
    expect(store.getItem(bucketOf('B'))).toContain('Margherita')
    writeCart(null)                         // B empties ITS basket
    expect(store.getItem(bucketOf('B'))).toBeNull()
    expect(store.getItem(bucketOf('A')), 'A’s basket is not B’s to delete').toContain('truffe')
  })

  it('[F] B → A: each finds only its own, nothing was copied', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    setCartOwner({ kind: 'user', id: 'B' })
    writeCart(CART_B)
    setCartOwner({ kind: 'user', id: 'A' })
    expect(readCart()).toEqual(CART_A)
    expect(JSON.stringify(readCart())).not.toContain('Margherita')
    setCartOwner({ kind: 'user', id: 'B' })
    expect(readCart()).toEqual(CART_B)
  })

  it('an identity change EMITS so every badge and screen re-reads at once', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    events.length = 0
    expect(setCartOwner({ kind: 'user', id: 'B' })).toBe(true)
    expect(events).toEqual(['cart'])
    events.length = 0
    expect(setCartOwner({ kind: 'user', id: 'B' }), 'same identity is not a change').toBe(false)
    expect(events).toEqual([])
  })
})

// ── M, N, Q, R : the legacy key, the guest, and fail-closed ───────────────────

describe('M/N/Q/R — the legacy basket, the guest, and the unknown identity', () => {
  it('[M] the legacy `grubano_cart` is never adopted into an account — it is destroyed', () => {
    store.setItem(LEGACY_KEY, JSON.stringify(CART_A))
    setCartOwner({ kind: 'user', id: 'B' })
    expect(store.getItem(LEGACY_KEY), 'unattributable basket must not survive').toBeNull()
    expect(readCart()).toBeNull()
  })

  it('[M] a guest does not inherit it either', () => {
    store.setItem(LEGACY_KEY, JSON.stringify(CART_A))
    setCartOwner({ kind: 'guest' })
    expect(store.getItem(LEGACY_KEY)).toBeNull()
    expect(readCart()).toBeNull()
  })

  it('[N] a guest basket works normally, with no identity and no network', () => {
    setCartOwner({ kind: 'guest' })
    writeCart(CART_A)
    expect(readCart()).toEqual(CART_A)
    expect(cartCount()).toBe(1)
    expect(store.keys()).toEqual([bucketOf('guest')])
    writeCart(null)
    expect(readCart()).toBeNull()
  })

  it('[Q] an OLD guest basket from before A does not resurrect for B', () => {
    seed('guest', CART_A)                   // left by someone long before
    setCartOwner({ kind: 'user', id: 'A' })
    expect(readCart(), 'A does not inherit it').toBeNull()
    setCartOwner({ kind: 'guest' })
    setCartOwner({ kind: 'user', id: 'B' })
    expect(readCart(), 'and neither does B').toBeNull()
    expect(store.getItem(bucketOf('B'))).toBeNull()
  })

  it('[R] no declared identity ⇒ reads empty, writes refused, nothing touched', () => {
    seed('A', CART_A)
    expect(getCartOwner()).toBeNull()
    expect(readCart()).toBeNull()
    expect(cartCount()).toBe(0)
    writeCart(CART_B)
    expect(store.keys(), 'an unattributed write is how the leak started').toEqual([bucketOf('A')])
    expect(store.getItem(bucketOf('A'))).toContain('truffe')
  })

  it('[R] the identity can be UNDECLARED, and then nothing is served', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    events.length = 0
    clearCartOwner()
    expect(getCartOwner()).toBeNull()
    expect(readCart()).toBeNull()
    expect(events).toEqual(['cart'])
    expect(store.getItem(bucketOf('A'))).toContain('truffe') // kept for A's return
  })

  it('a bucket stamped with another owner, a bare basket, or junk all read empty', () => {
    store.setItem(bucketOf('B'), JSON.stringify({ owner: 'u:A', cart: CART_A }))
    setCartOwner({ kind: 'user', id: 'B' })
    expect(readCart()).toBeNull()
    store.setItem(bucketOf('B'), JSON.stringify(CART_A)) // legacy shape under a v2 key
    expect(readCart()).toBeNull()
    store.setItem(bucketOf('B'), '{ not json')
    expect(readCart()).toBeNull()
  })
})

// ── O, P : the explicit promotion ─────────────────────────────────────────────

describe('O/P — guest → user is a PROMOTION, and only the checkout flow may ask for it', () => {
  it('[O] the guest basket is promoted to the SERVER-named user, and the guest bucket goes', () => {
    setCartOwner({ kind: 'guest' })
    writeCart(CART_A)                       // built as a visitor
    expect(promoteGuestCartToUser('B')).toBe(true)
    expect(getCartOwner()).toEqual({ kind: 'user', id: 'B' })
    expect(readCart(), 'the SAME basket continues into the order').toEqual(CART_A)
    expect(store.getItem(bucketOf('B'))).toContain('truffe')
    expect(store.getItem(bucketOf('guest')), 'the anonymous basket does not survive').toBeNull()
  })

  it('[P] a normal sign-in promotes NOTHING — only setCartOwner runs', () => {
    setCartOwner({ kind: 'guest' })
    writeCart(CART_A)
    setCartOwner({ kind: 'user', id: 'B' })  // what /eat/auth does
    expect(readCart(), 'no automatic adoption').toBeNull()
    expect(store.getItem(bucketOf('guest')), 'and the guest basket is left alone').toContain('truffe')
  })

  it('the basket ON SCREEN wins over an older one the user left in this tab', () => {
    // The visitor was looking at the GUEST basket when they tapped « Commander » (the page
    // reads the current owner), so that is what must be ordered. Keeping an older u.<id>
    // basket instead would charge them for items they were never shown — worse than losing
    // a basket they abandoned themselves. Nothing crosses accounts: the source is this
    // tab's guest bucket, the destination is the server-confirmed identity.
    seed('B', CART_B)
    setCartOwner({ kind: 'guest' })
    writeCart(CART_A)
    expect(promoteGuestCartToUser('B')).toBe(true)
    expect(readCart(), 'what the screen showed is what gets ordered').toEqual(CART_A)
    expect(store.getItem(bucketOf('guest'))).toBeNull()
  })

  it('a promotion only ever moves the GUEST bucket — never another user’s', () => {
    seed('A', CART_A)
    setCartOwner({ kind: 'user', id: 'A' })
    expect(promoteGuestCartToUser('B')).toBe(false)
    expect(readCart(), 'B gets nothing of A').toBeNull()
    expect(store.getItem(bucketOf('A')), 'and A keeps its own').toContain('truffe')
  })

  it('promoting with an empty guest basket still declares the user (so the next write lands right)', () => {
    setCartOwner({ kind: 'guest' })
    expect(promoteGuestCartToUser('B')).toBe(false)
    expect(getCartOwner()).toEqual({ kind: 'user', id: 'B' })
    writeCart(CART_B)
    expect(store.getItem(bucketOf('B'))).toContain('Margherita')
  })
})

// ── I, J, K, L, U : the server guard ─────────────────────────────────────────

const ORDER_BODY = {
  restaurantId: 'r1',
  items: [{ itemId: 'd1', name: 'Gnocchi', qty: 1, price: 12 }],
  deliveryAddress: '12 rue de la République, Orange',
  paymentMethod: 'card',
  fulfillmentType: 'pickup',
}
const orderReq = (headers: Record<string, string>) =>
  new Request('http://x/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(ORDER_BODY),
  })
/** Every DB call the handler could make. None may happen on a refusal. */
const dbCalls = () =>
  Object.values(db).flatMap((model) => Object.values(model as Record<string, { mock: { calls: unknown[] } }>))
    .reduce((n, fn) => n + fn.mock.calls.length, 0)

describe('I/J/K/L/U — POST /api/orders refuses a basket sent for another identity', () => {
  beforeEach(() => { tokenMock.mockResolvedValue({ sub: 'B', role: 'consumer' }) })

  it('[I] header ABSENT → 409, before the body is parsed and with zero DB access', async () => {
    const res = await createOrder(orderReq({}) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('cart_owner_mismatch')
    expect(dbCalls(), 'not one Prisma call').toBe(0)
  })

  it('[I] the refusal is parse-independent: an UNPARSEABLE body still answers 409', async () => {
    // Proof that the guard runs BEFORE req.json(): a body that would throw never gets read.
    const res = await createOrder(new Request('http://x/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json',
    }) as never)
    expect(res.status).toBe(409)
    expect(dbCalls()).toBe(0)
  })

  it('[J] header A + session B → 409, zero write', async () => {
    const res = await createOrder(orderReq({ 'x-cart-owner': 'A' }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('cart_owner_mismatch')
    expect(dbCalls()).toBe(0)
    expect(db.order.create).not.toHaveBeenCalled()
  })

  it('[K] header B + session B → the guard lets it through (it fails later, on its merits)', async () => {
    db.restaurant.findFirst.mockResolvedValue(null) // not found → 404, i.e. PAST the guard
    const res = await createOrder(orderReq({ 'x-cart-owner': 'B' }) as never)
    expect(res.status).not.toBe(409)
    expect(db.restaurant.findFirst, 'the handler reached its own logic').toHaveBeenCalled()
  })

  it('[L] a PRE-DEPLOY bundle (no header) is refused under B, whatever it holds', async () => {
    const res = await createOrder(orderReq({}) as never)
    expect(res.status).toBe(409)
    // …and the refusal says nothing about the cart or the account.
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('B')
    expect(body).not.toContain('Gnocchi')
    expect(body.length).toBeLessThan(60)
  })

  it('a session with no sub is refused even with a matching-looking header', async () => {
    tokenMock.mockResolvedValue({ role: 'consumer' })
    const res = await createOrder(orderReq({ 'x-cart-owner': 'undefined' }) as never)
    expect(res.status).toBe(409)
    expect(dbCalls()).toBe(0)
  })

  it('no token at all is still 401 (the guard did not displace the auth check)', async () => {
    tokenMock.mockResolvedValue(null)
    expect((await createOrder(orderReq({ 'x-cart-owner': 'B' }) as never)).status).toBe(401)
  })

  it('[U] /eat-next sends NO header, so it is fail-closed while its own cart is unscoped', () => {
    const next = readFileSync('app/[locale]/eat-next/checkout/page.tsx', 'utf8')
    expect(next).toContain("fetch('/api/orders'")
    expect(next, 'this lot must not hand it a header').not.toContain('x-cart-owner')
    // And its surface is flag-gated, so nothing is reachable today either way.
    const flag = readFileSync('lib/consumer-redesign.ts', 'utf8')
    expect(flag).toMatch(/process\.env\.CONSUMER_REDESIGN_ENABLED === 'true'/)
    expect(readFileSync('app/[locale]/eat-next/layout.tsx', 'utf8')).toMatch(/if \(!isConsumerRedesignEnabled\(\)\) notFound\(\)/)
  })
})

// ── G, H, S, T : the first frame and the money guard, read as source ──────────

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments FIRST, then blank block comments: a line comment may
 *  legitimately contain a path glob, which a block-comment stripper run first would read
 *  as an opening delimiter and blind itself with. */
function executable(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

describe('G/H/S/T — the first frame, and the money guard', () => {
  it('the stamps disagree exactly during the stale frame and agree after the effect', () => {
    setCartOwner({ kind: 'user', id: 'A' })
    writeCart(CART_A)
    const captured = currentCartStamp()
    expect(captured).toBe('u:A')
    // The render is already for B; the owner is still A (the effect has not run).
    expect(captured === sessionCartStamp('authenticated', 'B')).toBe(false)
    setCartOwner({ kind: 'user', id: 'B' })
    expect(currentCartStamp()).toBe(sessionCartStamp('authenticated', 'B'))
  })

  it('sessionCartStamp is fail-closed while loading and for an unnameable session', () => {
    expect(sessionCartStamp('authenticated', 'A')).toBe('u:A')
    expect(sessionCartStamp('unauthenticated', undefined)).toBe('guest')
    expect(sessionCartStamp('loading', undefined)).toBeNull()
    expect(sessionCartStamp('loading', 'A')).toBeNull()
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()
  })

  it('[G] the shell declares the cart owner and gates the badge on the comparison', () => {
    const shell = executable(read('components/eat/EatShell.tsx'))
    expect(shell).toContain("import { readCart, cartCount, setCartOwner, clearCartOwner, currentCartStamp, sessionCartStamp, CART_EVENT } from '@/lib/eat-cart'")
    expect(shell).toMatch(/setCartOwner\(me\)/)
    expect(shell).toMatch(/setCartOwner\(\{ kind: 'guest' \}\)/)
    expect(shell).toMatch(/if \(!addressOwnerId\) \{ clearAddressOwner\(\); clearCartOwner\(\); return \}/)
    expect(shell).toMatch(/setCartView\(\{ stamp, count: cartCount\(\), subtotal: s \}\)/)
    expect(shell).toMatch(/const cartStampOk = cartView\.stamp !== null && cartView\.stamp === sessionCartStamp\(status, addressOwnerId\)/)
    expect(shell).toMatch(/const count = cartStampOk \? cartView\.count : 0/)
    expect(shell).toMatch(/const subtotal = cartStampOk \? cartView\.subtotal : 0/)
    // The raw numbers are never rendered.
    expect(shell).not.toMatch(/setCount\(cartCount\(\)\)/)
  })

  it('[G/H] the cart page derives the basket from the gate, and placeOrder refuses otherwise', () => {
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
    // the raw state is unreachable: `cart` IS the gated value
    expect(cart).toMatch(/const \[cartState, setCart\] = useState<EatCartData \| null>\(null\)/)
    expect(cart).toMatch(/const cartOwnedHere = cartStamp !== null && cartStamp === cartSessionStamp/)
    expect(cart).toMatch(/const cart = cartOwnedHere \? cartState : null/)
    expect(cart).toMatch(/const cartOwnerId = cartOwnedHere && cartStamp\.startsWith\('u:'\) \? cartStamp\.slice\(2\) : ''/)
    // [H] the money guard: no owner or no owned basket ⇒ not one fetch
    expect(cart).toMatch(/if \(!orderCart \|\| !ownerId\) \{ setError\(t\('errorCartOwner'\)\); return \}/)
    const placeOrder = cart.slice(cart.indexOf('async function placeOrder'), cart.indexOf("fetch('/api/orders'"))
    expect(placeOrder).toContain('if (!orderCart || !ownerId)')
    expect(placeOrder.indexOf('if (!orderCart || !ownerId)')).toBeLessThan(placeOrder.length)
    // the claim travels, and it comes from the CART
    expect(cart).toMatch(/'x-cart-owner': ownerId/)
    expect(cart).toMatch(/const ownerId = proven\?\.ownerId \?\? cartOwnerId/)
    expect(cart).toMatch(/const orderCart = proven\?\.cart \?\? cart/)
    // The ORDER payload is the owned basket, never the raw state. (Scoped to the order
    // request: the promo PREVIEW call legitimately reads `cart`, which IS the gated value —
    // a ban on the pattern everywhere would have been a ban on correct code.)
    const orderFetch = cart.slice(cart.indexOf("fetch('/api/orders'"), cart.indexOf('deliveryAddress,'))
    expect(orderFetch.length).toBeGreaterThan(100)
    expect(orderFetch).toMatch(/restaurantId: orderCart\.restaurantId/)
    expect(orderFetch).toMatch(/items: orderCart\.items\.map/)
    expect(orderFetch).not.toMatch(/\bcart\.items\.map/)
    expect(orderFetch).not.toMatch(/restaurantId: cart\.restaurantId/)
    // …and the promo preview reads the gated value too, behind its own `if (!cart) return`.
    expect(cart).toMatch(/async function applyPromo\(\) \{\s*\n\s*if \(!cart\) return/)
    // and it stays live instead of being frozen at mount
    expect(cart).toContain('window.addEventListener(CART_EVENT, sync)')
  })

  it('[O] the cart page promotes only after the SERVER names the identity', () => {
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
    expect(cart).toMatch(/const uid = await confirmedUserId\(\)/)
    expect(cart).toMatch(/promoteGuestCartToUser\(uid\)/)
    expect(cart).toMatch(/await placeOrder\(\{ ownerId: uid, cart: promoted \}\)/)
    // the id comes from /api/auth/session, never from the typed e-mail or the React session
    const helper = cart.slice(cart.indexOf('async function confirmedUserId'), cart.indexOf('async function placeOrder'))
    expect(helper).toContain("fetch('/api/auth/session', { cache: 'no-store' })")
    expect(helper).not.toContain('email')
    // promotion happens ONLY there
    expect((cart.match(/promoteGuestCartToUser\(/g) ?? [])).toHaveLength(1)
  })

  it('[S] the restaurant page fails closed before writing, and a guest still builds', () => {
    const resto = executable(read('app/[locale]/eat/r/[id]/page.tsx'))
    expect(resto).toMatch(/const cartOwnedHere =\s*\n\s*cartStamp !== null &&/)
    expect(resto).toMatch(/const cart = cartOwnedHere \? cartState : null/)
    expect(resto).toMatch(/setCartStamp\(currentCartStamp\(\)\)/)
    // the two mutations refuse on a mismatch — `cart` being null is NOT enough, it would
    // start a fresh basket in the previous owner's bucket
    expect(resto).toMatch(/function addLine\([\s\S]{0,400}?if \(!cartOwnedHere\) return/)
    expect(resto).toMatch(/if \(!cartOwnedHere \|\| !cart\) return/)
  })

  it('[T] « Recommander » needs the history and the session to be the same identity', () => {
    const orders = executable(read('app/[locale]/eat/orders/page.tsx'))
    expect(orders).toMatch(/const ownStamp = sessionCartStamp\(status, \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id\)/)
    expect(orders).toMatch(/setData\(\{ stamp: ownStamp, current:/)
    expect(orders).toMatch(/const ordersStampOk =/)
    expect(orders).toMatch(/async function reorder\(c: Card\) \{\s*\n\s*if \(!ordersStampOk\) return/)
    // …and the check is REPEATED after the network round trip: the first one ran before an
    // await, so an identity change during it would otherwise have written this history into
    // the new owner's bucket.
    expect(orders).toMatch(/const loadedFor = data\.stamp/)
    expect(orders).toMatch(/if \(currentCartStamp\(\) !== loadedFor\) return\s*\n\s*writeCart\(\{/)
  })

  it('NEGATIVE CONTROLS — each guard, removed, is detectable', () => {
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
    expect(cart.replace('const cart = cartOwnedHere ? cartState : null', 'const cart = cartState'))
      .not.toMatch(/const cart = cartOwnedHere \? cartState : null/)
    expect(cart.replace("if (!orderCart || !ownerId) { setError(t('errorCartOwner')); return }", ''))
      .not.toContain('if (!orderCart || !ownerId)')
    const route = executable(read('app/api/orders/route.ts'))
    expect(route.replace("if (!token.sub || claimedCartOwner !== token.sub) {", 'if (false) {'))
      .not.toContain('claimedCartOwner !== token.sub')
  })
})

// ── the server guard's placement, and what this lot did not touch ─────────────

describe('the guard is first, and nothing else moved', () => {
  const route = executable(read('app/api/orders/route.ts'))

  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(route).toContain('export async function POST(req: NextRequest)')
    expect(route).toContain('const token = await getToken({ req })')
    expect(read('app/api/orders/route.ts')).toContain('// ── CART OWNER CLAIM')
    expect(route).not.toContain('// ── CART OWNER CLAIM')
  })

  it('the claim is checked after the token and BEFORE the body, the pricing and Prisma', () => {
    const at = (needle: string) => {
      const i = route.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    expect(at('const token = await getToken({ req })')).toBeLessThan(at("req.headers.get('x-cart-owner')"))
    expect(at("req.headers.get('x-cart-owner')")).toBeLessThan(at('const body = await req.json()'))
    expect(at('const body = await req.json()')).toBeLessThan(at('prisma.restaurant.findFirst'))
    expect(at("req.headers.get('x-cart-owner')")).toBeLessThan(at('prisma.'))
    expect(route).toMatch(/if \(!token\.sub \|\| claimedCartOwner !== token\.sub\) \{/)
    expect(route).toMatch(/status: 409/)
    // absent must NOT be tolerated
    expect(route).not.toMatch(/!claimedCartOwner \|\|/)
    expect(route).not.toMatch(/claimedCartOwner \?\?/)
  })

  it('no price, fee, commission, promo, loyalty or payment rule was touched', () => {
    // The guard is the ONLY thing this lot adds to the money route: every pre-existing
    // authority is asserted present and unchanged in substance.
    expect(route).toContain('consumerId:      token.sub!,')
    expect(route).toMatch(/computeApplicationFee/)
    expect(route).toMatch(/pickBestPromotion/)
    expect(route).toMatch(/resolveLoyaltyCredit/)
    expect(route).toMatch(/smallOrderFeeCents/)
    // exactly one claim check, and it never becomes the identity
    expect((route.match(/x-cart-owner/g) ?? [])).toHaveLength(1)
    expect(route).not.toMatch(/token\.sub = /)
    expect(route).not.toMatch(/consumerId:\s*claimedCartOwner/)
  })

  it('the files this lot must not touch are untouched', () => {
    // Asserted by content, not by digest: these are large files and the point is that the
    // cart fix is client-side plus one server guard.
    const cartLib = read('lib/eat-cart.ts')
    expect(cartLib, 'favourites are a SEPARATE lot').toContain("const FAV_KEY = 'grubano_favs'")
    expect(cartLib).toMatch(/export function toggleFav/)
    expect(cartLib).not.toMatch(/favOwner|FAV_PREFIX/)
    for (const f of ['lib/eat-addresses.ts', 'lib/use-geolocation.ts', 'lib/supply-cart.ts']) {
      expect(read(f).length, f).toBeGreaterThan(100) // present and not emptied
    }
    expect(read('lib/eat-cart.ts')).not.toMatch(/stripe/i)
  })
})
