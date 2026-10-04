import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT SUPPLY CART (P0) ────────────────────────────────────────────
//
// WHAT WAS WRONG. `grubano.supplyCart.<supplierId>` was partitioned by the SELLER and by
// nothing else — no owner in the key, none in the value, and nothing cleared on sign-out.
// It is localStorage, so it outlived both the sign-out navigation and the browser: Operator
// A chose quantities at supplier S, A signed out, Operator B signed in on the same browser
// and read the same bucket. B could open the cart and « Passer la commande », and
// POST /api/marketplace/orders creates the SupplyOrder with `operatorId: operator.id` from
// B's SESSION — a real order of B's, carrying the lines A had chosen. The server re-prices
// and re-snapshots, so no amount was ever misstated; what crossed accounts was the BASKET.
// And « Recommander » on the orders screen writes a PAST order's real lines into that same
// shared bucket, so the exposure was not only a draft but A's purchase history.
//
// THE OWNER IS THE OPERATOR — not the supplier, not a restaurant id, not an e-mail, not a
// role, not the browser. The supplier remains a SECOND axis. Three locks, because the first
// two are written by a client that can be wrong about its own identity:
//   1. the bucket is keyed by (buyer, supplier) and REPEATS both inside the value;
//   2. every consumer compares, DURING RENDER, the stamp its data was read under against
//      the stamp the live session implies — an effect runs after the frame that already
//      painted the previous buyer's quantities;
//   3. the server refuses a basket submitted on behalf of someone else, and an ABSENT
//      claim is refused exactly like a wrong one (the population that matters is the tab
//      from before this deploy: it knows nothing of the header and already carries the new
//      cookie).
//
// WHAT IS MOCKED. Nothing of lib/supply-cart: it runs for real against an in-memory
// localStorage. The server guard runs the REAL POST handler with prisma and the session
// mocked, as the sibling marketplace suites do. The UI cases are asserted on source —
// this repository has no DOM harness (vitest `environment: 'node'`) and the regressions
// they exist to stop are textual, so each one is paired with a positive control.

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
;(globalThis as { window?: unknown }).window = { localStorage: store }
;(globalThis as { localStorage?: unknown }).localStorage = store

// ── the real POST handler, with the harness the sibling marketplace suites use ─
const { db, getSession } = vi.hoisted(() => ({
  db: {
    operator:            { findUnique: vi.fn() },
    supplierProfile:     { findUnique: vi.fn() },
    supplierCatalogItem: { findMany: vi.fn() },
    supplyOrder:         { create: vi.fn() },
  },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import {
  readSupplyCart, writeSupplyCart, supplyCartCount,
  setSupplyCartOwner, clearSupplyCartOwner, getSupplyCartOwner,
  currentSupplyCartStamp, sessionSupplyCartStamp, clearSupplyCartForOwner,
  __resetSupplyCartOwner, type SupplyCart,
} from '@/lib/supply-cart'
import { POST as placeSupplyOrder } from '@/app/api/marketplace/orders/route'

const A = 'op-A', B = 'op-B', C = 'op-C'
const S = 'sup-S', S2 = 'sup-S2'
const bucket = (o: string, s: string) => `grubano.supplyCart.v2.u.${o}.s.${s}`
const legacy = (s: string) => `grubano.supplyCart.${s}`

/** A's basket at S. Quantities only — the library never holds a price. */
const CART_A: SupplyCart = { 'item-tomate': 12, 'item-truffe': 2 }
const CART_C: SupplyCart = { 'item-farine': 40 }

beforeEach(() => {
  store.clear()
  __resetSupplyCartOwner()
  vi.clearAllMocks()
})

// ══ A–D : the bucket is the pair, and nothing is shared ═══════════════════════

describe('A–D — the bucket is (buyer, supplier)', () => {
  it('A — no declared owner: reads empty, and a write leaves NOTHING behind', () => {
    expect(getSupplyCartOwner()).toBeNull()
    expect(readSupplyCart(S)).toEqual({})
    writeSupplyCart(S, CART_A)
    expect(store.keys()).toEqual([]) // an unattributed write is how the leak started
    expect(currentSupplyCartStamp()).toBeNull()
  })

  it('B — a declared owner writes ONE key that names both axes inside the value', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    expect(store.keys()).toEqual([bucket(A, S)])
    const env = JSON.parse(store.getItem(bucket(A, S)) as string)
    expect(env).toEqual({ owner: `u:${A}`, supplierId: S, cart: CART_A })
    expect(readSupplyCart(S)).toEqual(CART_A)
    expect(supplyCartCount(CART_A)).toBe(14)
  })

  it('C — THE LEAK: A fills S, B signs in on the same browser, B reads NOTHING', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    const frozen = store.getItem(bucket(A, S))

    clearSupplyCartOwner()            // sign-out
    expect(readSupplyCart(S)).toEqual({})

    setSupplyCartOwner(B)             // B signs in
    expect(readSupplyCart(S)).toEqual({})
    expect(store.getItem(bucket(B, S))).toBeNull()
    expect(store.getItem(bucket(A, S))).toBe(frozen) // A's draft untouched, not adopted
  })

  it('D — the supplier is a SECOND axis, not the only one', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    writeSupplyCart(S2, { 'item-riz': 5 })
    expect(readSupplyCart(S)).toEqual(CART_A)
    expect(readSupplyCart(S2)).toEqual({ 'item-riz': 5 })
    expect(store.keys().sort()).toEqual([bucket(A, S), bucket(A, S2)].sort())
  })
})

// ══ E–F : the legacy blob is destroyed, never adopted ═════════════════════════

describe('E–F — the unattributable legacy buckets', () => {
  it('E — they are deleted on the FIRST owner declaration and never read', () => {
    store.setItem(legacy(S), JSON.stringify(CART_A))
    store.setItem(legacy(S2), JSON.stringify({ 'item-riz': 5 }))

    setSupplyCartOwner(A)
    expect(store.keys()).toEqual([])          // gone
    expect(readSupplyCart(S)).toEqual({})     // and never attributed to A
  })

  it('F — a legacy blob is NOT migrated for any owner, in any order of arrival', () => {
    setSupplyCartOwner(A)
    store.setItem(legacy(S), JSON.stringify(CART_A)) // e.g. written by a stale open tab
    setSupplyCartOwner(B)                            // identity change sweeps it
    expect(readSupplyCart(S)).toEqual({})
    expect(store.getItem(legacy(S))).toBeNull()
    // there is deliberately no primitive that could copy a bucket between owners
    const api = readFileSync('lib/supply-cart.ts', 'utf8')
    expect(api).not.toMatch(/export function (promote|migrate|adopt|copy)/)
  })
})

// ══ G–K : the value defends the key ══════════════════════════════════════════

describe('G–K — a bucket that landed under the wrong key reads EMPTY', () => {
  it('G — A\'s value hand-copied into B\'s key is not readable as B\'s', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    const stolen = store.getItem(bucket(A, S)) as string

    store.setItem(bucket(B, S), stolen) // attacker, or a buggy future migration
    setSupplyCartOwner(B)
    expect(readSupplyCart(S)).toEqual({}) // the owner stamp inside disagrees
  })

  it('H — a value moved to another SUPPLIER\'s key is not readable either', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    store.setItem(bucket(A, S2), store.getItem(bucket(A, S)) as string)
    expect(readSupplyCart(S2)).toEqual({}) // supplierId inside disagrees
  })

  it('I — a bare quantity map under a v2 key is unattributable, so it reads empty', () => {
    setSupplyCartOwner(A)
    store.setItem(bucket(A, S), JSON.stringify(CART_A)) // the LEGACY shape, no envelope
    expect(readSupplyCart(S)).toEqual({})
    for (const junk of ['null', '[]', '"x"', '{bad json', JSON.stringify({ owner: `u:${A}`, supplierId: S, cart: [1, 2] })]) {
      store.setItem(bucket(A, S), junk)
      expect(readSupplyCart(S)).toEqual({})
    }
  })

  it('J — quantities are coerced to positive integers, nothing else survives', () => {
    setSupplyCartOwner(A)
    store.setItem(bucket(A, S), JSON.stringify({
      owner: `u:${A}`, supplierId: S,
      cart: { ok: 3, str: '4', frac: 2.7, zero: 0, neg: -5, nan: 'x', nul: null },
    }))
    expect(readSupplyCart(S)).toEqual({ ok: 3, str: 4, frac: 2 })
  })

  it('K — writing an empty cart REMOVES the bucket instead of orphaning it', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    writeSupplyCart(S, {})
    expect(store.keys()).toEqual([])
  })
})

// ══ L–M : the first frame ════════════════════════════════════════════════════

describe('L–M — what the session implies, available in the same render', () => {
  it('L — fail closed: loading, signed out, and authenticated-without-id all give null', () => {
    expect(sessionSupplyCartStamp('loading', A)).toBeNull()
    expect(sessionSupplyCartStamp('unauthenticated', A)).toBeNull()
    expect(sessionSupplyCartStamp('authenticated', undefined)).toBeNull()
    expect(sessionSupplyCartStamp('authenticated', null)).toBeNull()
    expect(sessionSupplyCartStamp('authenticated', '')).toBeNull()
    expect(sessionSupplyCartStamp('authenticated', A)).toBe(`u:${A}`)
    // there is no guest supply cart at all — the marketplace requires an Operator
    expect(readFileSync('lib/supply-cart.ts', 'utf8')).not.toMatch(/['"]guest['"]/)
  })

  it('M — the stamps disagree exactly during the stale frame, and agree after the effect', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    const captured = currentSupplyCartStamp()
    expect(captured).toBe(`u:${A}`)
    // The render is already B's; the owner is still A because the effect has not run.
    expect(captured === sessionSupplyCartStamp('authenticated', B)).toBe(false)
    setSupplyCartOwner(B)
    expect(currentSupplyCartStamp()).toBe(sessionSupplyCartStamp('authenticated', B))
  })
})

// ══ N–R : clearing BY NAME, and the success-path race ════════════════════════

describe('N–R — the clear targets a named pair, never "whoever is current"', () => {
  it('N — it empties the named bucket and leaves every other one strictly intact', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    writeSupplyCart(S2, { 'item-riz': 5 })
    setSupplyCartOwner(C)
    writeSupplyCart(S, CART_C)
    const cFrozen = store.getItem(bucket(C, S))

    expect(clearSupplyCartForOwner(A, S)).toBe(true)
    expect(store.getItem(bucket(A, S))).toBeNull()
    expect(store.getItem(bucket(A, S2))).not.toBeNull() // A's OTHER supplier survives
    expect(store.getItem(bucket(C, S))).toBe(cFrozen)   // and C's basket is byte-identical
  })

  it('O — THE RACE: B orders at S, the session becomes C mid-flight, B\'s response lands', () => {
    // B's basket, and C's at the same supplier.
    setSupplyCartOwner(B)
    writeSupplyCart(S, CART_A)
    const orderOwner = B            // captured when the order LEFT, as the UI does
    setSupplyCartOwner(C)           // the identity changes while the POST is in flight
    writeSupplyCart(S, CART_C)
    const cFrozen = store.getItem(bucket(C, S))

    // …and now B's success response arrives.
    expect(clearSupplyCartForOwner(orderOwner, S)).toBe(true)

    expect(store.getItem(bucket(B, S))).toBeNull()      // the basket that was ordered: gone
    expect(store.getItem(bucket(C, S))).toBe(cFrozen)   // C's: untouched
    expect(readSupplyCart(S)).toEqual(CART_C)           // C still sees exactly their own
    expect(getSupplyCartOwner()).toBe(C)                // and the clear moved no identity
  })

  it('P — it refuses to delete a value whose stamps do not match the pair it names', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    store.setItem(bucket(B, S), store.getItem(bucket(A, S)) as string) // A's value, B's key
    expect(clearSupplyCartForOwner(B, S)).toBe(false)
    expect(store.getItem(bucket(B, S))).not.toBeNull()
  })

  it('Q — the clear needs BOTH names, and refuses an empty one', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    expect(clearSupplyCartForOwner('', S)).toBe(false)
    expect(clearSupplyCartForOwner(A, '')).toBe(false)
    expect(store.getItem(bucket(A, S))).not.toBeNull()
  })

  it('R — the owner is never declared on the server (module state is shared there)', async () => {
    const saved = (globalThis as { window?: unknown }).window
    delete (globalThis as { window?: unknown }).window
    try {
      expect(setSupplyCartOwner(A)).toBe(false)
      expect(getSupplyCartOwner()).toBeNull()
      expect(readSupplyCart(S)).toEqual({})
      expect(clearSupplyCartForOwner(A, S)).toBe(false)
    } finally {
      ;(globalThis as { window?: unknown }).window = saved
    }
  })
})

// ══ S–V : the server refuses a basket submitted for someone else ═════════════

const post = (owner: string | null, body: unknown = { supplierProfileId: S, lines: [{ catalogItemId: 'a', quantity: 2 }] }) =>
  new Request('http://x/api/marketplace/orders', {
    method: 'POST',
    headers: owner === null ? {} : { 'x-supply-cart-owner': owner },
    body: JSON.stringify(body),
  })

function arrangeHappyPath(operatorId: string) {
  getSession.mockResolvedValue({ user: { email: 'r@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: operatorId, role: 'restaurant' })
  db.supplierProfile.findUnique.mockResolvedValue({ id: S, status: 'active', minimumOrderCents: 0 })
  db.supplierCatalogItem.findMany.mockResolvedValue([{ id: 'a', name: 'Tomate', unit: 'kg', priceCents: 250, available: true }])
  db.supplyOrder.create.mockResolvedValue({ id: 'o1', status: 'placed', totalCents: 500 })
}

describe('S–V — POST /api/marketplace/orders refuses a basket that is not the caller\'s', () => {
  it('S — an honest claim places the order, with operatorId from the SESSION', async () => {
    arrangeHappyPath(B)
    const res = await placeSupplyOrder(post(B))
    expect(res.status).toBe(201)
    expect(db.supplyOrder.create.mock.calls[0][0].data.operatorId).toBe(B)
  })

  it('V — the exact P0: A\'s basket submitted under B\'s cookie is REFUSED', async () => {
    arrangeHappyPath(B)
    const res = await placeSupplyOrder(post(A)) // the bucket was A's, the session is B's
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'supply_cart_owner_mismatch' })
    // nothing downstream of the guard ran: no body parsed into a supplier read, no
    // pricing, no row. This is the whole point of checking before req.json().
    expect(db.supplierProfile.findUnique).not.toHaveBeenCalled()
    expect(db.supplierCatalogItem.findMany).not.toHaveBeenCalled()
    expect(db.supplyOrder.create).not.toHaveBeenCalled()
  })

  it('T — an ABSENT claim is refused exactly like a wrong one (the pre-deploy tab)', async () => {
    arrangeHappyPath(B)
    const res = await placeSupplyOrder(post(null))
    expect(res.status).toBe(409)
    expect(db.supplyOrder.create).not.toHaveBeenCalled()
    // and an empty one, which is what a naive `headers.get(...) ?? ''` would produce
    const res2 = await placeSupplyOrder(post(''))
    expect(res2.status).toBe(409)
    expect(db.supplyOrder.create).not.toHaveBeenCalled()
  })

  it('U — the 409 leaks nothing, and the pre-existing 401/403 still come first', async () => {
    arrangeHappyPath(B)
    const body = await (await placeSupplyOrder(post(A))).text()
    expect(body).not.toContain(A)
    expect(body).not.toContain(B)
    expect(body).not.toContain('r@x.fr')

    getSession.mockResolvedValue(null) // no session at all: still 401, not 409
    expect((await placeSupplyOrder(post(null))).status).toBe(401)

    getSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ id: 'op-consumer', role: 'consumer' })
    expect((await placeSupplyOrder(post('op-consumer'))).status).toBe(403) // role before owner
  })
})

// ══ the three consumers, read as source ══════════════════════════════════════
//
// There is no DOM harness here, so the render-time guards are asserted textually. Each
// group carries a POSITIVE CONTROL: a pin that bans absent code bans nothing, and a
// stripper that silently blanks the file would make every ban pass.

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments FIRST, then blank block comments: a line comment may
 *  legitimately contain a path glob, which a block-comment stripper run first would read
 *  as an opening delimiter and blind itself with the rest of the file. */
function executable(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

const CATALOG = 'app/[locale]/marketplace/suppliers/[id]/SupplierCatalogClient.tsx'
const CART = 'app/[locale]/marketplace/suppliers/[id]/panier/CartClient.tsx'
const ORDERS = 'app/[locale]/marketplace/orders/OrdersClient.tsx'
const ROUTE = 'app/api/marketplace/orders/route.ts'

describe('the catalogue, the cart and the history each gate on the render\'s identity', () => {
  const catalog = executable(read(CATALOG))
  const cart = executable(read(CART))
  const orders = executable(read(ORDERS))

  it('POSITIVE CONTROL — the stripper left the code being judged, and only the comments went', () => {
    expect(catalog).toContain('export default function SupplierCatalogClient')
    expect(cart).toContain('async function placeOrder()')
    expect(orders).toContain('function reorder(o: MyOrder)')
    expect(read(ROUTE)).toContain('// ── SUPPLY-CART OWNERSHIP')
    expect(executable(read(ROUTE))).not.toContain('// ── SUPPLY-CART OWNERSHIP')
  })

  it('the catalogue owns its quantities before showing or persisting them', () => {
    // the dangerous pattern this replaced — read on [supplierId], write on [supplierId, cart]
    // — could write {} or a stale state into the wrong bucket on an identity change.
    expect(catalog).toMatch(/const sessionStamp = sessionSupplyCartStamp\(status, \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id\)/)
    // all three conjuncts, in one expression: a named session, agreeing with the server's
    // operatorId, and quantities actually hydrated UNDER that same stamp.
    expect(catalog).toMatch(
      /const ownedHere =\s*sessionStamp !== null &&\s*sessionStamp === `u:\$\{operatorId\}` &&\s*hydratedFor === sessionStamp/,
    )
    // the gated empty is a FROZEN module constant: stable identity for the memos below,
    // and unmutatable, since every gated render shares the one object.
    expect(catalog).toMatch(/const cart = ownedHere \? cartState : NO_CART/)
    expect(catalog).toMatch(/const NO_CART: SupplyCart = Object\.freeze\(\{\}\) as SupplyCart/)
    expect(catalog).toMatch(/setHydratedFor\(currentSupplyCartStamp\(\)\)/)
    expect(catalog).toMatch(/if \(!ownedHere\) return\s*\n\s*writeSupplyCart\(supplierId, cartState\)/)
  })

  it('the cart refuses before the fetch, declares the owner, and clears BY NAME after', () => {
    expect(cart).toMatch(/const cart = ownedHere \? cartState : NO_CART/)
    expect(cart).toMatch(/const cartOwnerId = ownedHere \? operatorId : ''/)
    expect(cart).toMatch(/if \(!cartOwnerId\) \{ setPlaceError\(t\('errOrderOwner'\)\); return \}/)
    expect(cart).toMatch(/const orderOwner = cartOwnerId/)
    expect(cart).toMatch(/'x-supply-cart-owner': orderOwner/)
    // the clear names the buyer the order was placed for — NOT the current module owner
    expect(cart).toMatch(/clearSupplyCartForOwner\(orderOwner, supplierId\)/)
    expect(cart).not.toMatch(/clearSupplyCart\(supplierId\)/)
    // …and no confirmation of one buyer's order is ever painted under another's session
    expect(cart).toMatch(/const stillMine = await confirmedOperatorId\(\)/)
    expect(cart).toMatch(/if \(stillMine !== orderOwner\) \{ setPlaceError\(t\('errOrderOtherAccount'\)\); return \}/)
    const confirmThenShow = cart.indexOf('const stillMine = await confirmedOperatorId()')
    expect(confirmThenShow).toBeGreaterThan(-1)
    expect(confirmThenShow).toBeLessThan(cart.indexOf('setPlaced({ totalCents:'))
  })

  it('the history is masked under a mismatched identity, and « Recommander » cannot write', () => {
    expect(orders).toMatch(/const historyStampOk = sessionStamp !== null && sessionStamp === `u:\$\{operatorId\}`/)
    expect(orders).toMatch(/const visibleOrders = historyStampOk \? orders : NO_ORDERS/)
    // every derivation the screen renders reads the GATED list, not the raw state
    for (const pin of [
      'const base = visibleOrders.filter(inPeriod)',
      "() => visibleOrders.filter(inPeriod).filter((o) => tab === 'all' || o.status === tab),",
      'const detail = selectedId ? visibleOrders.find((o) => o.id === selectedId) ?? null : null',
      'if (visibleOrders.length === 0) {',
    ]) expect(orders.includes(pin), pin).toBe(true)
    // the ONLY remaining reads of the raw state are its declaration and the cancel mapper
    const rawReads = orders.split('\n').filter((l) => /\borders\b/.test(l) && !/visibleOrders|NO_ORDERS|marketplace\/orders|mkt-orders|orders: initial|orders: MyOrder\[\]/.test(l))
    expect(rawReads).toEqual([
      '  const [orders, setOrders] = useState<MyOrder[]>(initial)',
    ])
    // the reorder write is guarded on entry AND again immediately before the write
    expect(orders).toMatch(/function reorder\(o: MyOrder\) \{\s*\n(\s*\n)*\s*if \(!historyStampOk\) return/)
    expect(orders).toMatch(/if \(!historyStampOk \|\| currentSupplyCartStamp\(\) !== `u:\$\{operatorId\}`\) return\s*\n\s*writeSupplyCart\(o\.supplierProfileId, cart\)/)
  })

  it('all three take the buyer from the SERVER page, which resolves it with callerOperator', () => {
    for (const p of [
      'app/[locale]/marketplace/suppliers/[id]/page.tsx',
      'app/[locale]/marketplace/suppliers/[id]/panier/page.tsx',
      'app/[locale]/marketplace/orders/page.tsx',
    ]) {
      const src = executable(read(p))
      expect(src.includes('callerOperator()'), p).toBe(true)
      expect(src.includes('operatorId={operator!.id}'), p).toBe(true)
    }
    // …and server authority still comes from the session, never from that prop
    expect(executable(read(ROUTE))).toContain('const operator = await callerOperator()')
    expect(executable(read(ROUTE))).not.toMatch(/operatorId:\s*claimedOwner/)
  })
})

describe('the server guard is first, and the flag was not touched', () => {
  const route = executable(read(ROUTE))

  it('the claim is checked after the role gate and BEFORE the body, the pricing and Prisma', () => {
    const at = (needle: string) => {
      const i = route.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    expect(at('const operator = await callerOperator()')).toBeLessThan(at("req.headers.get('x-supply-cart-owner')"))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('await req.json()'))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('prisma.supplierProfile.findUnique'))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('buildOrderLines(items'))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('prisma.supplyOrder.create'))
    expect(route).toMatch(/if \(claimedOwner !== operator\.id\) \{/)
    expect(route).toMatch(/\{ error: 'supply_cart_owner_mismatch' \}, \{ status: 409 \}/)
    // absent must NOT be tolerated, and the claim must not be allowed to default
    expect(route).not.toMatch(/!claimedOwner \|\|/)
    expect(route).not.toMatch(/claimedOwner \?\?/)
    expect(route).not.toMatch(/claimedOwner \|\|/)
  })

  it('SUPPLIER_ENABLED was not touched, and no money path moved with it', () => {
    const lot = [CATALOG, CART, ORDERS, ROUTE, 'lib/supply-cart.ts'].map(read).join('\n')
    expect(lot).not.toMatch(/SUPPLIER_ENABLED/)
    // the cart still sends only {catalogItemId, quantity} — never an amount
    expect(executable(read(CART))).not.toMatch(/totalCents:\s*totalCents\s*,?\s*\n?\s*\}\),/)
    expect(executable(read(ROUTE))).toContain('totalCents:        built.totalCents')
  })

  it('the source pins are ANCHORED on text that exists (a ban on absent code bans nothing)', () => {
    // NOT a tautological negative control: the real mutation proof for this lot is executed
    // against the WORKING TREE at the command line — drop the owner from keyFor, accept an
    // absent header, swap the explicit clear for a current-owner clear, delete a first-frame
    // guard, delete the reorder guard; each turns this suite red. What belongs here is the
    // weaker, honest claim: every string these pins anchor on is really present, so not one
    // of them is vacuous.
    for (const [src, needle] of [
      [executable(read(CATALOG)), 'const cart = ownedHere ? cartState : NO_CART'],
      [executable(read(CART)), "if (!cartOwnerId) { setPlaceError(t('errOrderOwner')); return }"],
      [executable(read(CART)), 'clearSupplyCartForOwner(orderOwner, supplierId)'],
      [executable(read(ORDERS)), 'const visibleOrders = historyStampOk ? orders : NO_ORDERS'],
      [executable(read(ORDERS)), 'if (!historyStampOk) return'],
      [executable(read(ROUTE)), "req.headers.get('x-supply-cart-owner')"],
      [read('lib/supply-cart.ts'), 'return `${PREFIX}u.${operatorId}.s.${supplierId}`'],
    ] as [string, string][]) {
      expect(src.includes(needle), needle).toBe(true)
    }
  })

  it('both refusal messages exist in all five locales, and neither invites a retry', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const ns = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8')).marketplaceCart
      expect(ns.errOrderOwner, loc).toBeTruthy()
      expect(ns.errOrderOtherAccount, loc).toBeTruthy()
      // the order EXISTS in that branch — telling the buyer to try again would invite a double
      expect(ns.errOrderOtherAccount, loc).not.toMatch(/réessay|try again|de nuevo|riprov|حاول مرة/i)
    }
  })
})
