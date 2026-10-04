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
  supplyCartIdentity, clearSupplyCartOwnerIfMine,
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
    expect(catalog).toMatch(/supplyCartIdentity\(status, liveOperatorId, operatorId\)/)
    // the gate is the shared identity match AND an actual hydration under that stamp
    expect(catalog).toMatch(/const ownedHere = identityMatchesServer && hydratedFor === sessionStamp/)
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
    expect(orders).toMatch(/supplyCartIdentity\(status, liveOperatorId, operatorId\)/)
    expect(orders).toMatch(/const historyOwned = identityMatchesServer && loadedFor === operatorId/)
    expect(orders).toMatch(/const visibleOrders = historyOwned \? orders : NO_ORDERS/)
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
    expect(orders).toMatch(/function reorder\(o: MyOrder\) \{\s*\n(\s*\n)*\s*if \(!historyOwned\) return/)
    expect(orders).toMatch(/if \(!historyOwned \|\| currentSupplyCartStamp\(\) !== `u:\$\{operatorId\}`\) return\s*\n\s*writeSupplyCart\(o\.supplierProfileId, cart\)/)
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

  it('THE LOAD-BEARING PREMISE: session.user.id IS the Operator id', () => {
    // Every gate in this lot compares `session.user.id` (client) with the `operator.id`
    // the server resolved. If those were ever different values the gate would not be
    // safe-but-closed — it would silently close for the legitimate buyer and the supply
    // cart would stop working, which is how a security guard gets deleted later. So the
    // chain is pinned: authorize returns the Operator row's id → token.sub → session.
    const auth = executable(read('lib/auth.ts'))
    expect(auth).toMatch(/id:\s*operator\.id/)                       // authorize → user.id
    expect(auth).toMatch(/\(session\.user as \{ id\?: string \}\)\.id\s*=\s*token\.sub/)
    // callerOperator resolves the SAME row, by the session e-mail
    const resolver = executable(read('lib/operator-session.ts'))
    expect(resolver).toMatch(/prisma\.operator\s*\n?\s*\.findUnique\(\{ where: \{ email: session\.user\.email \}/)
    expect(resolver).toMatch(/select: \{ id: true, role: true \}/)
  })
})

describe('the server guard is first, and the flag was not touched', () => {
  const route = executable(read(ROUTE))

  it('the claim is checked after the role gate and BEFORE the body, the pricing and Prisma', () => {
    // SCOPED TO POST. `const operator = await callerOperator()` also opens the GET handler,
    // which comes first in the file, so an unscoped indexOf resolved there and the ordering
    // assertion held for ANY placement of the guard inside POST — including after the
    // Prisma create.
    const post = route.slice(route.indexOf('export async function POST'))
    expect(post.length, 'POST handler found').toBeGreaterThan(0)
    expect(post).not.toContain('export async function GET')
    const at = (needle: string) => {
      const i = post.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    // the pre-existing 401 and 403 still come first
    expect(at('const operator = await callerOperator()')).toBeLessThan(at("status: 401"))
    expect(at("status: 401")).toBeLessThan(at("['restaurant', 'admin'].includes(operator.role)"))
    expect(at("['restaurant', 'admin'].includes(operator.role)")).toBeLessThan(at("req.headers.get('x-supply-cart-owner')"))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('await req.json()'))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('prisma.supplierProfile.findUnique'))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('buildOrderLines(items'))
    expect(at("req.headers.get('x-supply-cart-owner')")).toBeLessThan(at('prisma.supplyOrder.create'))
    expect(post).toMatch(/if \(claimedOwner !== operator\.id\) \{/)
    expect(post).toMatch(/\{ error: 'supply_cart_owner_mismatch' \}, \{ status: 409 \}/)
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
      [executable(read(ORDERS)), 'const visibleOrders = historyOwned ? orders : NO_ORDERS'],
      [executable(read(ORDERS)), 'if (!historyOwned) return'],
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

/** A key CART_A does NOT contain, so "did B's click reach A?" is answerable. */
const INJECTED = 'item-B-injected'

const readForA = (): SupplyCart => {
  const raw = store.getItem(bucket(A, S))
  return raw ? (JSON.parse(raw) as { cart: SupplyCart }).cart : {}
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUND 2 — the render was gated, the MUTATIONS and the module OWNER were not
// ══════════════════════════════════════════════════════════════════════════════
//
// Two defects survived round 1, both the same shape: the gate decided what to SHOW and
// left everything else alone.
//
// BUG 1 — the catalogue keeps its rows mounted when the gate is shut (at qty 0, controls
//   live), so the state hydrated for A stayed MUTABLE under B. The write effect refused at
//   the time, which only DEFERRED it: when the session returned to A the effect persisted
//   B's clicks into A's bucket. Gating the render is not gating the mutation.
//
// BUG 2 — the owner effect gated on the session STATUS alone. A, logout, B login puts
//   status back to 'authenticated' while the component still carries the server prop
//   operatorId = A, so the effect declared the GLOBAL module owner as A during B's
//   session. Nothing visible leaked — and the invariant the whole module rests on was
//   still false.
//
// BUG 3 (found while fixing those two, same class) — the « commande envoyée » panel
//   outlives an identity change and named A's supplier and A's total under B.
//
// HOW THESE ARE PROVEN. There is no DOM harness here (vitest environment: 'node'), and
// transcribing a component's logic into a test proves only that the model agrees with its
// author. So the DECISION — where all the subtlety lives — was extracted into one pure
// exported function, supplyCartIdentity, which the three components call and these tests
// EXECUTE. What stays textual is a four-line effect body and the list of mutation sites,
// and that list is CLOSED by counting: R9 is an enumeration, not a sample.

/** The owner effect of the three components, in the order they run it. The source pins in
 *  R7/R8 assert each component really performs these operations, in this order — this is a
 *  driver for the real library, not a second implementation of the decision, which lives
 *  in supplyCartIdentity and is called here. */
function ownerEffect(status: string, liveId: string, serverId: string, supplierId: string) {
  const { identityMatchesServer, sessionStamp } = supplyCartIdentity(status, liveId, serverId)
  if (!identityMatchesServer) {
    clearSupplyCartOwnerIfMine(serverId)
    return { identityMatchesServer, sessionStamp, cart: {} as SupplyCart, hydratedFor: null as string | null }
  }
  setSupplyCartOwner(serverId)
  return {
    identityMatchesServer,
    sessionStamp,
    cart: readSupplyCart(supplierId),
    hydratedFor: currentSupplyCartStamp(),
  }
}
/** What the two hydrating components compute during render. */
const ownedHere = (r: { identityMatchesServer: boolean; sessionStamp: string | null; hydratedFor: string | null }) =>
  r.identityMatchesServer && r.hydratedFor === r.sessionStamp

describe('R1–R3 — the module owner follows the LIVE session, never the frozen prop', () => {
  it('R1 — page for A, session A: the owner is declared and the basket is this buyer\'s', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    __resetSupplyCartOwner()

    const r = ownerEffect('authenticated', A, A, S)
    expect(getSupplyCartOwner()).toBe(A)
    expect(r.cart).toEqual(CART_A)
    expect(r.hydratedFor).toBe('u:' + A)
    expect(ownedHere(r)).toBe(true)
  })

  it('R2 — page frozen for A, session becomes B: the owner is NULL, never A', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    const frozen = store.getItem(bucket(A, S))

    const r = ownerEffect('authenticated', B, A, S) // server prop still A, live session B
    expect(r.identityMatchesServer).toBe(false)
    expect(getSupplyCartOwner()).toBeNull()         // NOT A — this is the invariant
    expect(currentSupplyCartStamp()).toBeNull()
    expect(r.cart).toEqual({})                      // nothing of A's is held in state
    expect(ownedHere(r)).toBe(false)
    expect(store.getItem(bucket(A, S))).toBe(frozen)
  })

  it('R3 — THE BUG: A logs out, B logs in, status is authenticated again, prop still A', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)

    // the status round-trip that made the old authenticated-only guard pass
    const seen: Array<string | null> = []
    ownerEffect('authenticated', A, A, S);   seen.push(getSupplyCartOwner())
    ownerEffect('unauthenticated', '', A, S); seen.push(getSupplyCartOwner())
    ownerEffect('authenticated', B, A, S);   seen.push(getSupplyCartOwner())

    expect(seen).toEqual([A, null, null])
    // the third step is the whole point: authenticated AGAIN, so the old guard would have
    // run setSupplyCartOwner(A) while B holds the session.
    expect(getSupplyCartOwner()).not.toBe(A)
    // an identity that cannot be named is refused too (a session with no sub)
    ownerEffect('authenticated', '', A, S)
    expect(getSupplyCartOwner()).toBeNull()
  })
})

describe('R4–R5 — a click made under B can never surface under A', () => {
  it('R4 — under B the gate is shut, so no mutation of A\'s quantities is reachable', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    const hydrated = ownerEffect('authenticated', A, A, S)
    expect(hydrated.cart).toEqual(CART_A)

    // the session becomes B without a remount
    const shut = ownerEffect('authenticated', B, A, S)
    expect(ownedHere(shut)).toBe(false)
    // setQty returns on exactly this condition (pinned in R9), and the state it would have
    // mutated is no longer held at all
    expect(shut.cart).toEqual({})
    // belt and braces: a write attempted in this state is refused by the library itself,
    // because no owner is declared. INJECTED is a key CART_A does not contain — a sentinel
    // that collided with the real data could not tell contamination from the basket.
    writeSupplyCart(S, { [INJECTED]: 99 })
    expect(store.keys()).toEqual([bucket(A, S)])
    expect(readForA()).toEqual(CART_A)
  })

  it('R5 — A then B then A: A\'s bucket is byte-identical and the state is re-READ from it', () => {
    setSupplyCartOwner(A)
    writeSupplyCart(S, CART_A)
    const frozen = store.getItem(bucket(A, S))

    ownerEffect('authenticated', A, A, S)              // A
    ownerEffect('authenticated', B, A, S)              // B — gate shut, owner undeclared
    writeSupplyCart(S, { [INJECTED]: 99 })             // whatever B tries, refused
    const back = ownerEffect('authenticated', A, A, S) // A returns, still no remount

    expect(store.getItem(bucket(A, S))).toBe(frozen)   // byte-identical across the trip
    expect(back.cart).toEqual(CART_A)                  // re-READ from storage, not resumed
    expect(back.cart).not.toHaveProperty(INJECTED)
    expect(ownedHere(back)).toBe(true)
    expect(getSupplyCartOwner()).toBe(A)
  })
})

describe('R5b — two screens mounted at once must not undeclare each other', () => {
  it('a STALE page for A may not undeclare a CORRECT declaration of B', () => {
    // App Router keeps the OUTGOING page mounted while the incoming one renders, so a
    // stale catalogue rendered for A and a fresh cart rendered for B coexist for a moment,
    // sharing one module owner. The fresh page declares B correctly…
    ownerEffect('authenticated', B, B, S)
    expect(getSupplyCartOwner()).toBe(B)

    // …then the stale page's effect runs, sees its own mismatch, and must NOT clear B.
    const stale = ownerEffect('authenticated', B, A, S)
    expect(stale.identityMatchesServer).toBe(false)
    expect(getSupplyCartOwner()).toBe(B)   // still declared — B's writes keep working

    // and it is not merely inert: it DOES undeclare its own declaration
    ownerEffect('authenticated', A, A, S)
    expect(getSupplyCartOwner()).toBe(A)
    ownerEffect('authenticated', B, A, S)
    expect(getSupplyCartOwner()).toBeNull()
  })

  it('the unconditional clear would have broken the invariant it was meant to keep', () => {
    // It left B's screen believing it owned its basket while every write silently became a
    // no-op — fail-closed, but a basket that stops saving, and its effect deps never
    // change again so it would never re-declare. Here the declaration survives.
    ownerEffect('authenticated', B, B, S)
    ownerEffect('authenticated', B, A, S)          // the stale A page's effect
    writeSupplyCart(S, { 'item-riz': 7 })          // B edits its basket
    expect(store.getItem(bucket(B, S))).not.toBeNull()
    expect(readSupplyCart(S)).toEqual({ 'item-riz': 7 })
    expect(store.getItem(bucket(A, S))).toBeNull() // and nothing landed in A's
  })
})

describe('R6 — the one-shot recovery is bounded by construction', () => {
  it('at most one refresh per live identity, so the guard cannot loop or brick the screen', () => {
    // A model of the four lines in the components (pinned textually in R11). What is being
    // checked is the BOUND, which is a property of the ref key, not of React.
    let refreshes = 0
    const ref = { current: '' }
    const tick = (status: string, liveId: string, serverId: string) => {
      const { identityMatchesServer } = supplyCartIdentity(status, liveId, serverId)
      if (identityMatchesServer || status !== 'authenticated' || !liveId) return
      if (ref.current === liveId) return
      ref.current = liveId
      refreshes++
    }
    // a stale page for A under B, re-rendered many times (every keystroke, every poll)
    for (let i = 0; i < 50; i++) tick('authenticated', B, A)
    expect(refreshes).toBe(1)
    // the server answers with B's page: no further refresh, ever
    for (let i = 0; i < 50; i++) tick('authenticated', B, B)
    expect(refreshes).toBe(1)
    // a different account arrives: exactly one more
    tick('authenticated', C, A)
    expect(refreshes).toBe(2)
    // and never while the session is unresolved or signed out
    tick('loading', '', A)
    tick('unauthenticated', '', A)
    expect(refreshes).toBe(2)
  })
})

describe('R7–R11 — every mutation site is guarded, and the list is CLOSED by counting', () => {
  const cat = executable(read(CATALOG))
  const crt = executable(read(CART))
  const ord = executable(read(ORDERS))

  it('R7 — the three screens derive the gate from the ONE shared function', () => {
    for (const [src, name] of [[cat, 'catalogue'], [crt, 'cart'], [ord, 'orders']] as [string, string][]) {
      expect(src.includes("const liveOperatorId = (session?.user as { id?: string } | undefined)?.id ?? ''"), name).toBe(true)
      expect(src.includes('supplyCartIdentity(status, liveOperatorId, operatorId)'), name).toBe(true)
      // nobody re-derives it locally any more — two definitions is how they drift apart
      expect(src.includes('sessionSupplyCartStamp('), name).toBe(false)
    }
    // and the shared function compares the LIVE id with the SERVER id — bug 2, in one line
    const lib = executable(read('lib/supply-cart.ts'))
    expect(lib).toMatch(
      /const identityMatchesServer =\s*sessionStamp !== null && !!serverOperatorId && sessionStamp === stampFor\(serverOperatorId\)/,
    )
  })

  it('R8 — the undeclare is INSIDE the branch, and the branch TERMINATES before the declaration', () => {
    // ONE anchored regex per screen, not three independent pins. Three pins saying "the
    // branch exists", "the clear exists" and "the deps are right" cannot see whether the
    // clear is inside the branch, nor whether the branch RETURNS before the
    // setSupplyCartOwner it exists to prevent. Two screens were in fact missing that
    // terminator — so BUG 2 was live, in the cart and in the history, with this suite
    // green. The regex below spans header, body, return, closing brace, and the
    // declaration that must be unreachable from the branch.
    for (const [src, name] of [[cat, 'catalogue'], [crt, 'cart'], [ord, 'orders']] as [string, string][]) {
      expect(
        /if \(!identityMatchesServer\) \{[\s\S]{0,700}?clearSupplyCartOwnerIfMine\(operatorId\)[\s\S]{0,400}?\n\s*return\n\s*\}\n\s*setSupplyCartOwner\(operatorId\)/
          .test(src),
        name + ': undeclare inside the branch, branch returns before the declaration',
      ).toBe(true)
      // …and NEVER the unconditional clear: a component must not undeclare a declaration
      // that is not its own (R5b).
      expect(src.includes('clearSupplyCartOwner()'), name).toBe(false)
      // the deps must carry the LIVE id: the session status alone is what let bug 2 through
      expect(/\}, \[identityMatchesServer, liveOperatorId, operatorId/.test(src), name).toBe(true)
    }
    // the two hydrating screens also drop the in-memory copy, so nothing of the other
    // account is held here — and therefore nothing of it is mutable here
    for (const [src, name] of [[cat, 'catalogue'], [crt, 'cart']] as [string, string][]) {
      expect(/clearSupplyCartOwnerIfMine\(operatorId\)\s*\n\s*setCart\(\{\}\)\s*\n\s*setHydratedFor\(null\)/.test(src), name).toBe(true)
    }
  })

  it('R9 — CLOSED ENUMERATION: every setCart / writeSupplyCart site, and its guard', () => {
    // Counts, so that adding an unguarded mutation later fails this test rather than
    // slipping past a pin that only sampled the sites it already knew about.
    // Counted PER SCREEN: the catalogue has three state-mutation sites, the cart four.
    // Assuming they are symmetrical is how a site goes uncounted — and this assertion is
    // what caught the fourth when round 3 added it.
    expect((cat.match(/setCart\(/g) ?? []).length, 'catalogue setCart sites').toBe(3)
    expect((crt.match(/setCart\(/g) ?? []).length, 'cart setCart sites').toBe(4)
    for (const [src, name] of [[cat, 'catalogue'], [crt, 'cart']] as [string, string][]) {
      //   1. setCart({})                  — inside the !identityMatchesServer branch
      //   2. setCart(readSupplyCart(…))    — inside the matching branch
      //   3. setCart((c) => …) in setQty   — behind "if (!ownedHere) return"
      //   4. (cart only) setCart({}) on the success path — reachable only after a 201 for
      //      `orderOwner`, which placeOrder refuses to send unless cartOwnerId is set,
      //      i.e. unless ownedHere held. It SPENDS the basket; it cannot fill one.
      expect(/const setQty = \(id: string, q: number\) => \{\s*\n\s*if \(!ownedHere\) return/.test(src), name + ' setQty guard').toBe(true)
      // the sync-to-storage write, behind the same gate. ANCHORED ON THE NEGATION: the
      // earlier pin matched `ownedHere) return`, which is equally true of the INVERTED
      // guard `if (ownedHere) return` — a pin that passes against the broken code.
      expect(/if \((?:!mounted \|\| )?!ownedHere\) return\s*\n\s*writeSupplyCart\(supplierId, cartState\)/.test(src), name + ' sync write guard').toBe(true)
    }
    // The write sites, counted per screen: the catalogue has TWO (the sync effect and the
    // navigation hand-off), the cart ONE (its sync effect — it hands off to the server, not
    // to another screen). Measured, not assumed symmetrical.
    expect((cat.match(/writeSupplyCart\(/g) ?? []).length, 'catalogue write sites').toBe(2)
    expect((crt.match(/writeSupplyCart\(/g) ?? []).length, 'cart write sites').toBe(1)
    // the catalogue's second write is the navigation hand-off: guarded EXPLICITLY, not
    // merely by canProceed being false because the gated cart is empty
    expect(cat).toMatch(/if \(!ownedHere \|\| !canProceed\) return\s*\n\s*writeSupplyCart\(supplierId, cart\)/)
    // the rows go inert through the EXISTING disabled control — never through the stock
    // tag, which would state a false reason
    expect(cat).toMatch(/const locked = !ownedHere/)
    expect(cat).toMatch(/\{out \|\| locked \? \(/)
    expect(cat).toMatch(/\{out && \(/) // « rupture de stock » still keys on stock alone
    // orders: the only writer is reorder, guarded on entry and again before the write
    expect((ord.match(/writeSupplyCart\(/g) ?? []).length).toBe(1)
    expect(ord).toMatch(/function reorder\(o: MyOrder\) \{\s*\n(\s*\n)*\s*if \(!historyOwned\) return/)
    expect(ord).toMatch(/if \(!historyOwned \|\| currentSupplyCartStamp\(\) !== .u:\$\{operatorId\}.\) return\s*\n\s*writeSupplyCart\(o\.supplierProfileId, cart\)/)
    // …and cancel, which has a real await, is checked on BOTH sides of it
    expect(ord).toMatch(/async function cancel\(id: string\) \{\s*\n(\s*\n)*\s*if \(!historyOwned\) return/)
    expect(ord).toMatch(/if \(res\.ok && historyOwned\) \{/)
  })

  it('R10 — the confirmation panel is stamped, and never painted for another buyer', () => {
    expect(crt).toMatch(/useState<\{ totalCents: number; owner: string \} \| null>\(null\)/)
    expect(crt).toMatch(/setPlaced\(\{ totalCents: d\?\.order\?\.totalCents \?\? totalCents, owner: orderOwner \}\)/)
    expect(crt).toMatch(/if \(placed && identityMatchesServer && placed\.owner === liveOperatorId\) \{/)
  })

  it('R11 — the history never says « aucune commande » while the identity diverges', () => {
    // the safe branch must come FIRST and must cover the mismatch…
    expect(ord).toMatch(/if \(!mounted \|\| status === 'loading' \|\| !historyOwned\) \{/)
    // …so the empty state is reachable only once the identity agrees
    const safe = ord.indexOf("if (!mounted || status === 'loading' || !historyOwned) {")
    const empty = ord.indexOf('if (visibleOrders.length === 0) {')
    expect(safe).toBeGreaterThan(-1)
    expect(empty).toBeGreaterThan(safe)
    // and the recovery is the bounded one-shot proven in R6 — in ALL THREE screens, not
    // only here: an inert screen with no way out is the pressure that gets a guard
    // deleted, and the supplier page's delivery-zone badge is computed from the BUYER's
    // own restaurant cities server-side, where no client guard can reach it.
    for (const [src, name] of [[cat, 'catalogue'], [crt, 'cart'], [ord, 'orders']] as [string, string][]) {
      // ONE regex spanning the whole effect, INCLUDING its dep array. R6 proves the BOUND
      // against a model; nothing proved the effect actually re-evaluates, so `}, [])`
      // would have bricked every stale screen with a green suite. Anchored on the
      // recovery effect's own body so the owner effect's deps cannot satisfy it.
      expect(
        /const refreshedFor = useRef\(''\)\s*\n\s*useEffect\(\(\) => \{\s*\n\s*if \(identityMatchesServer \|\| status !== 'authenticated' \|\| !liveOperatorId\) return\s*\n\s*if \(refreshedFor\.current === liveOperatorId\) return\s*\n\s*refreshedFor\.current = liveOperatorId\s*\n\s*router\.refresh\(\)\s*\n\s*\}, \[identityMatchesServer, status, liveOperatorId, router\]\)/
          .test(src),
        name + ': the recovery effect, its one-shot ref AND its dep array',
      ).toBe(true)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ROUND 3 — the recovery re-opened the leak, and four pins could not fail
// ══════════════════════════════════════════════════════════════════════════════
//
// An independent adversarial review of round 2 confirmed fifteen defects. The worst was
// mine, and it was the recovery itself: router.refresh() re-renders the SERVER component
// without remounting the client one — exactly why it was chosen — and useState IGNORES a
// changed initial value. So OrdersClient ended up holding B's props with A's rows in
// state, the identity gate (which compares the live session with the PROP) read TRUE
// again, and B was shown A's suppliers, totals and line snapshots with a working
// « Recommander ». The original P0, reintroduced by its own fix.
//
// The two hydrating screens were immune only because their gate also demands
// hydratedFor === sessionStamp. The comment on the history screen — "nothing was read out
// of storage that could belong to someone else" — was the false premise: the rows were
// captured in STATE, under the previous identity.

describe('R12 — the server-rendered history cannot outlive the buyer it was fetched for', () => {
  it('a changed server buyer must invalidate the rows BEFORE the gate can read them', () => {
    // The structural half: three screens take a key, so a different buyer is a different
    // component instance and no client state survives at all.
    for (const [p, name] of [
      ['app/[locale]/marketplace/orders/page.tsx', 'orders'],
      ['app/[locale]/marketplace/suppliers/[id]/panier/page.tsx', 'cart'],
      ['app/[locale]/marketplace/suppliers/[id]/page.tsx', 'catalogue'],
    ] as [string, string][]) {
      expect(executable(read(p)).includes('key={operator!.id}'), name).toBe(true)
    }
    // The client half, which does not depend on a parent remembering the key: the rows
    // carry the buyer they were fetched for, and a mismatch re-seeds DURING RENDER,
    // because the gate is a render-time derivation and an effect is one frame too late.
    const ord = executable(read(ORDERS))
    expect(ord).toMatch(/const \[loadedFor, setLoadedFor\] = useState\(operatorId\)/)
    expect(ord).toMatch(
      /if \(loadedFor !== operatorId\) \{\s*\n\s*setLoadedFor\(operatorId\)\s*\n\s*setOrders\(initial\)\s*\n\s*setSelectedId\(null\)\s*\n\s*\}/,
    )
    // and the re-seed happens BEFORE the gate that would otherwise read the stale rows
    expect(ord.indexOf('if (loadedFor !== operatorId) {')).toBeLessThan(ord.indexOf('const historyOwned ='))
  })

  it('the gate keeps the second conjunct, so removing either half does not silently re-open the other', () => {
    const ord = executable(read(ORDERS))
    expect(ord).toMatch(/const historyOwned = identityMatchesServer && loadedFor === operatorId/)
    // every consumer reads the gated list, and the raw state is still read in exactly the
    // two places the closed enumeration allows
    const rawReads = ord.split('\n').filter((l) => /\borders\b/.test(l)
      && !/visibleOrders|NO_ORDERS|marketplace\/orders|mkt-orders|orders: initial|orders: MyOrder\[\]|setOrders\(initial\)/.test(l))
    expect(rawReads).toEqual(['  const [orders, setOrders] = useState<MyOrder[]>(initial)'])
  })
})

describe('R13 — the cart resets the FORM, not only the basket', () => {
  it('the free-text note to the supplier does not survive an identity change', () => {
    const crt = executable(read(CART))
    // the note is submitted with the order (notes: notes || null), so A's delivery
    // instructions would otherwise travel on B's SupplyOrder
    expect(crt).toMatch(
      /if \(!identityMatchesServer\) \{[\s\S]{0,700}?setNotes\(''\)\s*\n\s*setDesiredDate\(null\)\s*\n\s*return/,
    )
    // …and the day chips re-seed for the new buyer afterwards
    expect(crt).toMatch(/\}, \[supplierId, leadTimeDays, locale, identityMatchesServer\]\)/)
  })

  it('« Votre panier est vide » is only reachable once the basket is proven and hydrated', () => {
    const crt = executable(read(CART))
    expect(crt).toMatch(/if \(!mounted \|\| status === 'loading' \|\| !ownedHere\) \{/)
    const safe = crt.indexOf("if (!mounted || status === 'loading' || !ownedHere) {")
    expect(safe).toBeGreaterThan(-1)
    // the empty-cart copy comes after it
    expect(crt.indexOf("t('emptyTitle')")).toBeGreaterThan(safe)
  })
})

describe('R14 — after a successful order, the screen never says something it cannot know', () => {
  it('the probe distinguishes « I could not tell » from « nobody »', () => {
    const crt = executable(read(CART))
    expect(crt).toMatch(/async function confirmedOperatorId\(\): Promise<string \| null>/)
    // the catch returns null, not '' — '' would mean "signed out", which is a claim
    expect(crt).toMatch(/\} catch \{\s*\n\s*return null\s*\n\s*\}/)
    expect(crt).toMatch(/if \(stillMine === null\) \{ setPlaceError\(t\('errOrderUnverified'\)\); return \}/)
    expect(crt).toMatch(/if \(stillMine !== orderOwner\) \{ setPlaceError\(t\('errOrderOtherAccount'\)\); return \}/)
  })

  it('the basket is spent as soon as the order exists, so no branch can leave it re-submittable', () => {
    const crt = executable(read(CART))
    // the stored bucket AND the state, before the probe can send us down any branch
    expect(crt).toMatch(/clearSupplyCartForOwner\(orderOwner, supplierId\)\s*\n\s*setCart\(\{\}\)/)
    const spend = crt.indexOf('clearSupplyCartForOwner(orderOwner, supplierId)')
    const probe = crt.indexOf('const stillMine = await confirmedOperatorId()')
    expect(spend).toBeGreaterThan(-1)
    expect(probe).toBeGreaterThan(spend)
  })

  it('all three post-order messages exist in five locales, and none invites a retry', () => {
    // POSITIVE CONTROL on the ban itself: a regex that matches nothing bans nothing, so
    // prove it catches a string that SHOULD be refused before trusting it on real copy.
    const invitesRetry = (s: string) => /réessay|try again|de nuevo|riprov|حاول مرة|أعد المحاولة/i.test(s)
    expect(invitesRetry('Veuillez réessayer plus tard')).toBe(true)
    expect(invitesRetry('Please try again')).toBe(true)
    expect(invitesRetry('حاول مرة أخرى')).toBe(true)
    expect(invitesRetry('Votre commande a bien été envoyée.')).toBe(false)

    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const ns = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8')).marketplaceCart
      for (const k of ['errOrderOwner', 'errOrderOtherAccount', 'errOrderUnverified']) {
        expect(ns[k], `${loc}/${k}`).toBeTruthy()
      }
      // the order EXISTS in both post-order branches: a retry would duplicate it
      expect(invitesRetry(ns.errOrderOtherAccount), loc).toBe(false)
      expect(invitesRetry(ns.errOrderUnverified), loc).toBe(false)
    }
  })
})
