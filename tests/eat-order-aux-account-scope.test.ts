import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sessionCartStamp } from '@/lib/eat-cart'
import {
  adoptOwnedOrder, emptyScoped, loadOwnedOrder, orderScopeStamp, scopePending, scopedValue, type Scoped,
} from '@/lib/eat-order-scope'

// ── /eat/order/[orderId]/{pickup,rate,help} — SAME-TAB ACCOUNT SCOPE (P1) ─────────────
//
// WHAT WAS WRONG IN `main` @ 41ac3518 (independent read-only audit, findings P1-A/B/C).
// The three auxiliary order pages read the same owner-scoped document as /eat/track —
// GET /api/orders/[id] — and kept it in plain React state:
//
//   pickup  effect keyed on [authStatus, orderId]   → QR pass, ref, items, total, refund line,
//                                                     restaurateur name + address
//   rate    effect keyed on [orderId, router]       → restaurant, ref, total, tip, refund figures,
//                                                     net loyalty points ; 401 → router.push('/eat/auth')
//   help    effects keyed on [authStatus, orderId]  → banner (restaurant, items, total, status),
//                                                     refund figures, claim eligibility with per-line
//                                                     unitCents + existing claim id/refusal code,
//                                                     and the half-typed refund draft
//
// NextAuth broadcasts an A → B switch across tabs WITHOUT flipping `status` through
// 'unauthenticated'. Under app/[locale]/eat/layout.tsx the component stays mounted, none
// of those effects re-fired, and B inherited A's screen. No response-side owner check
// existed either, so a GET issued while React still believed A could be authenticated as
// B by the cookie and adopted as A's.
//
// HOW THIS IS PROVEN — stated plainly, because earlier lots were caught claiming more:
//   • EXECUTED. The decisions are EXPORTED by lib/eat-order-scope (stamp, gate, pending,
//     adoption, the whole load with every failure mode) and are run here for real, with a
//     controllable fetch. The identity half is the repository's own `sessionCartStamp`.
//   • MODELLED. React's two phases are kept SEPARATE: render() derives a frame and touches
//     no state; flushEffects() is what runs after the commit. They are not collapsed, because
//     collapsing them hides the window in which a late response can still commit. The
//     effect bodies mirror the three pages line for line and call the real lib.
//   • PINNED BY EXACT SETS. Every line of each page that names a stamped holder is listed;
//     a leak has to add a line, and adding a line changes a set. The positive control proves
//     the stripper left the code being judged.
//
// RED on `main`: point GRUBANO_SRC_ROOT at a checkout of 41ac3518 — the pin suites fail
// there (no stamp, no gate, effects keyed without the identity), the executed suites pass
// because the lib ships with this hotfix.

const ROOT = process.env.GRUBANO_SRC_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments first, then block and JSX comments. */
function executable(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
}
const PICKUP = 'app/[locale]/eat/order/[orderId]/pickup/page.tsx'
const RATE = 'app/[locale]/eat/order/[orderId]/rate/page.tsx'
const HELP = 'app/[locale]/eat/order/[orderId]/help/page.tsx'
const TRACK = 'app/[locale]/eat/track/[orderId]/page.tsx'
const LIB = 'lib/eat-order-scope.ts'
const ORDER_ROUTE = 'app/api/orders/[id]/route.ts'

// ── identities, orders, sentinels ───────────────────────────────────────────────────────
const A = 'user-A-7f3e', B = 'user-B-91c0'
const ORDER_A = 'ord_a_6QK2ZT', ORDER_A2 = 'ord_a_2PL9MX', ORDER_B = 'ord_b_8HH4RR'
const PAIR = (userId: string, orderId: string) => JSON.stringify([`u:${userId}`, orderId])

// Every private value of A's carries a distinctive token so a sweep over a rendered frame
// can prove that NOT ONE of them surfaces under another identity.
const A_RESTO = 'Trattoria Confidentielle-A'
const A_ADDRESS = '12 rue Secrète-A'
const A_CITY = 'Villeneuve-A'
const A_ITEM = 'Gnocchi truffe-A'
const A_TOTAL = 148.73
const A_TIP = 731
const A_REFUNDED = 14873
const A_CLAIM_ID = 'clm_A_55Z1'
const A_UNIT = 7437
// The ROUTE id is not in this list: it is the URL itself, known to whoever holds it; what must
// never surface is what the server returns FOR it (and the pass that makes it redeemable).
const A_SENTINELS = [A_RESTO, A_ADDRESS, A_CITY, A_ITEM, String(A_TOTAL), String(A_TIP), String(A_REFUNDED), A_CLAIM_ID, String(A_UNIT)]

interface Order {
  id: string
  status: string
  fulfillmentType: string
  total: number
  tipCents: number
  pointsEarned: number
  items: Array<{ name: string; qty: number; price: number }>
  restaurant: { name: string; address: string; city: string }
  refundSummary: { refundedCents: number; pendingCents: number; unattributedCents: number; isTotal: boolean; isPartial: boolean; pointsReversed: number }
  createdAt: string
}
function makeOrder(id: string, resto: string, address: string, city: string, item: string, total: number, tip: number, refunded: number): Order {
  return {
    id, status: 'ready', fulfillmentType: 'pickup', total, tipCents: tip, pointsEarned: Math.floor(total),
    items: [{ name: item, qty: 2, price: total / 2 }],
    restaurant: { name: resto, address, city },
    refundSummary: { refundedCents: refunded, pendingCents: 0, unattributedCents: 0, isTotal: refunded > 0, isPartial: false, pointsReversed: refunded > 0 ? Math.floor(total) : 0 },
    createdAt: '2026-10-09T10:00:00Z',
  }
}
const ORD_A = makeOrder(ORDER_A, A_RESTO, A_ADDRESS, A_CITY, A_ITEM, A_TOTAL, A_TIP, A_REFUNDED)
const ORD_A2 = makeOrder(ORDER_A2, 'Pizzeria A-bis', '3 rue A-bis', 'Lyon', 'Margherita', 12.5, 0, 0)
const ORD_B = makeOrder(ORDER_B, 'Chez B', '34 rue de B', 'Lyon', 'Bowl B', 21.5, 0, 0)

interface ClaimElig { canClaim: boolean; reason?: string; maxRefundableCents: number; windowHours: number; existingClaim: { id: string; status: string } | null; scope?: { lines: Array<{ index: number; name: string; maxQty: number; unitCents: number; lineCents: number }> } }
const ELIG_A: ClaimElig = { canClaim: false, reason: 'active_claim', maxRefundableCents: A_REFUNDED, windowHours: 48, existingClaim: { id: A_CLAIM_ID, status: 'restaurant_review' }, scope: { lines: [{ index: 0, name: A_ITEM, maxQty: 2, unitCents: A_UNIT, lineCents: A_UNIT * 2 }] } }
const ELIG_B: ClaimElig = { canClaim: true, maxRefundableCents: 2150, windowHours: 48, existingClaim: null, scope: { lines: [{ index: 0, name: 'Bowl B', maxQty: 2, unitCents: 1075, lineCents: 2150 }] } }

// ── a controllable fetch: every call is a deferred the test answers by hand ───────────
interface FakeResponse { ok: boolean; status: number; json: () => Promise<unknown> }
interface Pending { url: string; init?: RequestInit; resolve: (r: FakeResponse) => void; reject: (e: unknown) => void }
function makeFetch() {
  const queue: Pending[] = []
  const fetchImpl = ((url: string, init?: RequestInit) =>
    new Promise<FakeResponse>((resolve, reject) => { queue.push({ url, init, resolve, reject }) })) as unknown as typeof fetch
  return { queue, fetchImpl }
}
const reply = (status: number, body: unknown, opts: { badJson?: boolean } = {}): FakeResponse => ({
  ok: status >= 200 && status < 300, status,
  json: async () => { if (opts.badJson) throw new SyntaxError('Unexpected token') ; return body },
})
/** Let every microtask and the `.then` chains settle. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

// ══ EXECUTED — the exported decisions ══════════════════════════════════════════════════

describe('EXECUTED — orderScopeStamp is the (identity, orderId) pair, fail-closed on both halves', () => {
  it('the identity half IS the repository\'s own sessionCartStamp, not a third definition', () => {
    expect(orderScopeStamp('authenticated', A, ORDER_A)).toBe(JSON.stringify([sessionCartStamp('authenticated', A), ORDER_A]))
    expect(sessionCartStamp('authenticated', A)).toBe(`u:${A}`)
  })
  it('loading / guest / authenticated-without-id / missing orderId all read null', () => {
    expect(orderScopeStamp('loading', A, ORDER_A)).toBeNull()
    expect(orderScopeStamp('unauthenticated', undefined, ORDER_A)).toBeNull()
    expect(orderScopeStamp('authenticated', undefined, ORDER_A)).toBeNull()
    expect(orderScopeStamp('authenticated', '', ORDER_A)).toBeNull()
    expect(orderScopeStamp('authenticated', A, '')).toBeNull()
    expect(orderScopeStamp('authenticated', A, undefined)).toBeNull()
    expect(orderScopeStamp('authenticated', A, ['x'])).toBeNull()
  })
  it('two users on the same order, or one user on two orders, never share a stamp', () => {
    expect(orderScopeStamp('authenticated', A, ORDER_A)).not.toBe(orderScopeStamp('authenticated', B, ORDER_A))
    expect(orderScopeStamp('authenticated', A, ORDER_A)).not.toBe(orderScopeStamp('authenticated', A, ORDER_A2))
    // a delimiter inside an id cannot forge a collision
    expect(orderScopeStamp('authenticated', 'u', '"],["x')).not.toBe(orderScopeStamp('authenticated', 'u"],["x', ''))
  })
})

describe('EXECUTED — the render-time gate and the derived « loading »', () => {
  const live = PAIR(A, ORDER_A)
  it('a value is visible only under the exact stamp it was read under', () => {
    const s: Scoped<Order> = { stamp: live, value: ORD_A }
    expect(scopedValue(s, live)).toBe(ORD_A)
    expect(scopedValue(s, PAIR(B, ORDER_A))).toBeNull()
    expect(scopedValue(s, PAIR(A, ORDER_A2))).toBeNull()
    expect(scopedValue(s, null), 'unknown identity sees nothing').toBeNull()
    expect(scopedValue(emptyScoped<Order>(), live)).toBeNull()
    expect(scopedValue({ stamp: null, value: ORD_A }, live), 'an unstamped value is never shown').toBeNull()
  })
  it('pending = the live pair is known and has not been answered yet; a stamped empty is « not found », not pending', () => {
    expect(scopePending(emptyScoped<Order>(), live)).toBe(true)
    expect(scopePending({ stamp: PAIR(B, ORDER_A), value: ORD_B }, live), 'B\'s answer is pending for A').toBe(true)
    expect(scopePending({ stamp: live, value: null }, live), 'asked and denied → not pending').toBe(false)
    expect(scopePending({ stamp: live, value: ORD_A }, live)).toBe(false)
    expect(scopePending(emptyScoped<Order>(), null), 'no pair → nothing to wait for').toBe(false)
  })
})

describe('EXECUTED — a body is adopted only when the SERVER named the same raw id', () => {
  it('ownerId === requestUserId with an order object → adopted', () => {
    expect(adoptOwnedOrder<Order>({ ownerId: A, order: ORD_A }, A)).toBe(ORD_A)
  })
  it('a body naming NOBODY, a wrong primitive, the stamp form, or another user → refused', () => {
    for (const bad of [undefined, null, '', 0, false, {}, [], `u:${A}`, B, ` ${A}`]) {
      expect(adoptOwnedOrder<Order>({ ownerId: bad, order: ORD_A }, A), `ownerId=${JSON.stringify(bad)}`).toBeNull()
    }
  })
  it('a body without an order object, or no body, → refused', () => {
    expect(adoptOwnedOrder<Order>({ ownerId: A }, A)).toBeNull()
    expect(adoptOwnedOrder<Order>({ ownerId: A, order: null }, A)).toBeNull()
    expect(adoptOwnedOrder<Order>({ ownerId: A, order: 'x' }, A)).toBeNull()
    expect(adoptOwnedOrder<Order>(null, A)).toBeNull()
    expect(adoptOwnedOrder<Order>('string', A)).toBeNull()
  })
  it('an empty request identity can never match anything (undefined === undefined is not a match)', () => {
    expect(adoptOwnedOrder<Order>({ ownerId: undefined, order: ORD_A }, undefined as unknown as string)).toBeNull()
    expect(adoptOwnedOrder<Order>({ ownerId: '', order: ORD_A }, '')).toBeNull()
  })
})

describe('EXECUTED — loadOwnedOrder closes every failure mode on the same side', () => {
  const stamp = PAIR(A, ORDER_A)
  it('200 + matching ownerId → the value, stamped with the request pair; URL is encoded and uncached', async () => {
    const f = makeFetch()
    const p = loadOwnedOrder<Order>({ orderId: 'ord/ a?', requestStamp: stamp, requestUserId: A, isAlive: () => true, fetchImpl: f.fetchImpl })
    expect(f.queue[0].url).toBe('/api/orders/ord%2F%20a%3F')
    expect((f.queue[0].init as { cache?: string } | undefined)?.cache).toBe('no-store')
    f.queue[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    expect(await p).toEqual({ stamp, value: ORD_A })
  })
  it('401 / 403 / 404 / 500 → a stamped EMPTY, no throw, and the promise is the only side effect (no redirect exists to fire)', async () => {
    for (const status of [401, 403, 404, 500]) {
      const f = makeFetch()
      const p = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => true, fetchImpl: f.fetchImpl })
      f.queue[0].resolve(reply(status, { ownerId: A, order: ORD_A }))   // even a body on a 4xx is ignored
      expect(await p, `status ${status}`).toEqual({ stamp, value: null })
    }
  })
  it('invalid JSON and a rejected fetch → a stamped EMPTY (nothing fabricated as « mine »)', async () => {
    const f = makeFetch()
    const p = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => true, fetchImpl: f.fetchImpl })
    f.queue[0].resolve(reply(200, null, { badJson: true }))
    expect(await p).toEqual({ stamp, value: null })
    const g = makeFetch()
    const q = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => true, fetchImpl: g.fetchImpl })
    g.queue[0].reject(new TypeError('Failed to fetch'))
    expect(await q).toEqual({ stamp, value: null })
  })
  it('the server authenticated SOMEONE ELSE (cookie moved under React\'s feet) → stamped EMPTY, never B\'s body', async () => {
    const f = makeFetch()
    const p = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => true, fetchImpl: f.fetchImpl })
    f.queue[0].resolve(reply(200, { ownerId: B, order: ORD_B }))
    expect(await p).toEqual({ stamp, value: null })
    const g = makeFetch()
    const q = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => true, fetchImpl: g.fetchImpl })
    g.queue[0].resolve(reply(200, { order: ORD_A }))                     // names nobody
    expect(await q).toEqual({ stamp, value: null })
  })
  it('disowned while in flight → null: NOTHING is offered, not even an empty (success, failure, or throw)', async () => {
    let alive = true
    const f = makeFetch()
    const p = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => alive, fetchImpl: f.fetchImpl })
    alive = false
    f.queue[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    expect(await p).toBeNull()

    alive = true
    const g = makeFetch()
    const q = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => alive, fetchImpl: g.fetchImpl })
    g.queue[0].resolve({ ok: true, status: 200, json: async () => { alive = false; return { ownerId: A, order: ORD_A } } })
    expect(await q, 'disowned between the headers and the body').toBeNull()

    alive = true
    const h = makeFetch()
    const r = loadOwnedOrder<Order>({ orderId: ORDER_A, requestStamp: stamp, requestUserId: A, isAlive: () => alive, fetchImpl: h.fetchImpl })
    alive = false
    h.queue[0].reject(new Error('net'))
    expect(await r, 'a stale failure is not committed as an empty either').toBeNull()
  })
})

// ══ MODELLED — the three pages, two React phases, on top of the real lib ═══════════════

type Kind = 'pickup' | 'rate' | 'help'
type Status = 'loading' | 'authenticated' | 'unauthenticated'
interface Props { status: Status; userId?: string; orderId: string }
interface Scope { stamp: string; userId: string; isAlive: () => boolean }

/**
 * One harness for the three pages. The effect body is the page's, line for line, calling
 * the real `orderScopeStamp` / `loadOwnedOrder` / `emptyScoped`; the frame is derived by
 * the real `scopedValue` / `scopePending`. What is modelled is React itself: deps
 * comparison, cleanup-before-re-run, and the separation of render from effects.
 */
function mountAux(kind: Kind, initial: Props) {
  const f = makeFetch()
  let props: Props = { ...initial }
  // state
  let orderState: Scoped<Order> = emptyScoped()
  let claimState: Scoped<{ enabled: boolean; eligibility: ClaimElig | null }> = emptyScoped()
  let scopeRef: Scope | null = null
  let stars = 4, tags: string[] = ['delicious', 'hot'], done = false
  let view: 'help' | 'refund' | 'chat' = 'help'
  let picked: Record<number, number> = {}, desc = ''
  let submitted = false, submitState: 'idle' | 'sending' | 'done' | 'error' = 'idle', submitError: string | null = null
  const redirects: string[] = []
  // React bookkeeping
  let lastDeps: string | undefined
  let cleanup: (() => void) | null = null

  async function loadEligibility(scope: Scope, forOrderId: string): Promise<void> {
    let next: { enabled: boolean; eligibility: ClaimElig | null } = { enabled: false, eligibility: null }
    try {
      const r = await f.fetchImpl(`/api/claims?orderId=${encodeURIComponent(forOrderId)}`, { cache: 'no-store' })
      if (!scope.isAlive()) return
      if (r.ok) {
        const d = (await r.json()) as { enabled?: unknown; eligibility?: ClaimElig }
        if (d?.enabled === true) next = { enabled: true, eligibility: d.eligibility ?? null }
      }
    } catch { /* enabled stays false */ }
    if (!scope.isAlive()) return
    claimState = { stamp: scope.stamp, value: next }
  }

  function effect(): void {
    const { status: authStatus, userId, orderId } = props
    // FAIL CLOSED FIRST
    orderState = emptyScoped()
    if (kind === 'rate') { stars = 4; tags = ['delicious', 'hot']; done = false }
    if (kind === 'help') {
      claimState = emptyScoped(); view = 'help'; picked = {}; desc = ''; submitted = false
      submitState = 'idle'; submitError = null; scopeRef = null
    }
    if (kind === 'rate') {
      if (authStatus === 'loading') return
      if (authStatus === 'unauthenticated') { redirects.push('/eat/auth'); return }
    } else if (authStatus !== 'authenticated') return
    const requestStamp = orderScopeStamp(authStatus, userId, orderId)
    const requestUserId = userId
    if (requestStamp === null || !requestUserId) return
    let alive = true
    const scope: Scope = { stamp: requestStamp, userId: requestUserId, isAlive: () => alive }
    if (kind === 'help') scopeRef = scope
    void loadOwnedOrder<Order>({ orderId, requestStamp, requestUserId, isAlive: () => alive, fetchImpl: f.fetchImpl })
      .then((r) => {
        if (!alive || !r) return
        orderState = r
        if (kind === 'help' && r.value !== null) void loadEligibility(scope, orderId)
      })
    cleanup = () => { alive = false; if (scopeRef === scope) scopeRef = null }
  }

  function flushEffects(): void {
    const deps = JSON.stringify([props.status, props.userId ?? null, props.orderId])
    if (deps === lastDeps) return
    lastDeps = deps
    if (cleanup) { cleanup(); cleanup = null }
    effect()
  }

  /** The committed frame — a pure derivation, no state is touched. */
  function render() {
    const liveStamp = orderScopeStamp(props.status, props.userId, props.orderId)
    const order = scopedValue(orderState, liveStamp)
    const loading = kind === 'rate'
      ? props.status !== 'authenticated' || scopePending(orderState, liveStamp)
      : props.status === 'loading' || scopePending(orderState, liveStamp)
    const claims = scopedValue(claimState, liveStamp)
    const claimsEnabled = order !== null && claims?.enabled === true
    const eligibility = claimsEnabled ? claims?.eligibility ?? null : null
    return {
      liveStamp, order, loading,
      notFound: !loading && order === null,
      signedOut: props.status === 'unauthenticated',
      stars, tags, done, view, picked, desc, submitted, submitState, submitError,
      claimsEnabled, eligibility,
      redirects: [...redirects],
      // the pickup QR encodes the ref of the ROUTE id — rendered only when the order is owned
      qr: kind === 'pickup' && order ? `GR-${props.orderId.slice(-6).toUpperCase()}` : null,
    }
  }

  // test-side helpers
  const orderReqs = () => f.queue.filter((q) => q.url.startsWith('/api/orders/'))
  const claimReqs = () => f.queue.filter((q) => q.url.startsWith('/api/claims?'))
  const postReqs = () => f.queue.filter((q) => q.url === '/api/claims' && q.init?.method === 'POST')

  async function submitClaim(selection: Record<number, number>, text: string): Promise<void> {
    const frame = render()
    if (!frame.claimsEnabled || !frame.eligibility?.canClaim) return
    const scope = scopeRef
    if (!scope || scope.stamp !== frame.liveStamp) return
    picked = selection; desc = text
    submitState = 'sending'; submitError = null
    try {
      const res = await f.fetchImpl('/api/claims', { method: 'POST', body: JSON.stringify({ orderId: props.orderId, items: selection, description: text }) })
      if (!scope.isAlive()) return
      if (res.status === 201) {
        submitState = 'done'; picked = {}; desc = ''
        await loadEligibility(scope, props.orderId)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { gated?: boolean; reason?: string }
      if (!scope.isAlive()) return
      if (res.status === 403 && data?.gated) {
        claimState = { stamp: scope.stamp, value: { enabled: false, eligibility: null } }
        submitState = 'idle'; submitError = null
        return
      }
      submitState = 'error'; submitError = data?.reason ?? 'claimError'
    } catch {
      if (!scope.isAlive()) return
      submitState = 'error'; submitError = 'claimError'
    }
  }

  return {
    /** Props change = a new render is scheduled; effects run only on flushEffects(). */
    set(next: Partial<Props>) { props = { ...props, ...next } },
    render, flushEffects,
    /** set + render + flushEffects, the common path when the test does not care about the first frame. */
    commit(next: Partial<Props>) { this.set(next); const first = render(); flushEffects(); return first },
    orderReqs, claimReqs, postReqs, settle, submitClaim,
    draft(s: number, tg: string[], dn: boolean) { stars = s; tags = tg; done = dn },
    pick(p: Record<number, number>, d: string) { picked = p; desc = d; view = 'refund' },
  }
}
const AUTH_A: Props = { status: 'authenticated', userId: A, orderId: ORDER_A }
const sweep = (frame: unknown) => {
  const text = JSON.stringify(frame)
  return A_SENTINELS.filter((s) => text.includes(s))
}

for (const kind of ['pickup', 'rate', 'help'] as const) {
  describe(`MODELLED /eat/order/[orderId]/${kind} — A → B inside one mount`, () => {
    let p: ReturnType<typeof mountAux>
    beforeEach(() => { p = mountAux(kind, AUTH_A); p.flushEffects() })

    it('A — A\'s own order, answered for A: visible (the legitimate flow still works)', async () => {
      expect(p.render().loading).toBe(true)
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
      await settle()
      const fr = p.render()
      expect(fr.loading).toBe(false)
      expect(fr.order?.id).toBe(ORDER_A)
      expect(fr.order?.restaurant.name).toBe(A_RESTO)
      if (kind === 'pickup') expect(fr.qr).toBe('GR-6QK2ZT')
    })

    it('B — the session becomes B (status never leaves \'authenticated\'): ZERO datum of A on the FIRST frame, before any effect', async () => {
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
      await settle()
      expect(sweep(p.render()), 'precondition: A really is painted for A').not.toHaveLength(0)
      p.set({ userId: B })
      const first = p.render()                       // render BEFORE the effect re-runs
      expect(first.order).toBeNull()
      expect(first.qr).toBeNull()
      expect(first.loading, 'reads as loading, not as « not found »').toBe(true)
      expect(first.notFound).toBe(false)
      expect(sweep(first)).toEqual([])
    })

    it('C — after the effect re-runs, B gets a FRESH request under B, and A\'s late answer changes nothing', async () => {
      p.commit({ userId: B })
      expect(p.orderReqs()).toHaveLength(2)
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))   // honest, late, for A
      await settle()
      expect(sweep(p.render())).toEqual([])
      p.orderReqs()[1].resolve(reply(404, { error: 'not found' }))          // B does not own ORDER_A
      await settle()
      const fr = p.render()
      expect(fr.loading).toBe(false)
      expect(fr.notFound).toBe(true)
      expect(fr.redirects, 'a 404 under B never redirects').toEqual([])
    })

    it('D — THE REAL WINDOW: A\'s answer lands between the B render and the cleanup — committed with A\'s stamp, invisible to B, then reset', async () => {
      p.set({ userId: B })
      p.render()
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))   // alive is still true here
      await settle()
      expect(sweep(p.render()), 'the gate alone must hold this frame').toEqual([])
      p.flushEffects()
      expect(sweep(p.render())).toEqual([])
      p.orderReqs()[1].resolve(reply(200, { ownerId: B, order: ORD_B }))
      await settle()
      expect(p.render().order?.id).toBe(ORDER_B)
    })

    it('E — the cookie moved before React did: a request issued for A answered as B is refused', async () => {
      p.orderReqs()[0].resolve(reply(200, { ownerId: B, order: ORD_B }))
      await settle()
      const fr = p.render()
      expect(fr.order, 'B\'s order never appears on A\'s screen').toBeNull()
      expect(fr.notFound).toBe(true)
    })

    it('F — a stale 401 for A while React already believes B: no state, NO redirect', async () => {
      p.commit({ userId: B })
      p.orderReqs()[0].resolve(reply(401, { error: 'auth' }))
      await settle()
      const fr = p.render()
      expect(fr.order).toBeNull()
      expect(fr.redirects).toEqual([])
      expect(fr.loading, 'B\'s own request is still pending').toBe(true)
    })

    it('G — logout: nothing of A on the signed-out frame; login as B asks afresh; A → B → A re-reads A', async () => {
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
      await settle()
      const out = p.commit({ status: 'unauthenticated', userId: undefined })
      expect(sweep(out)).toEqual([])
      expect(p.orderReqs(), 'a guest never queries an owner-scoped order').toHaveLength(1)
      if (kind === 'rate') expect(p.render().redirects).toEqual(['/eat/auth'])
      else expect(p.render().signedOut).toBe(true)
      p.commit({ status: 'authenticated', userId: B })
      expect(p.orderReqs()).toHaveLength(2)
      p.orderReqs()[1].resolve(reply(200, { ownerId: B, order: ORD_B }))
      await settle()
      expect(p.render().order?.id).toBe(ORDER_B)
      p.commit({ userId: A })
      expect(p.render().order, 'A\'s earlier order is NOT reused from memory').toBeNull()
      expect(p.orderReqs()).toHaveLength(3)
      p.orderReqs()[2].resolve(reply(200, { ownerId: A, order: ORD_A }))
      await settle()
      expect(p.render().order?.id).toBe(ORDER_A)
    })

    it('H — identity unknown (\'loading\') shows nothing and asks nothing; an authenticated session without an id asks nothing either', async () => {
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
      await settle()
      const fr = p.commit({ status: 'loading' })
      expect(sweep(fr)).toEqual([])
      expect(fr.loading).toBe(true)
      expect(p.orderReqs()).toHaveLength(1)
      const g = p.commit({ status: 'authenticated', userId: undefined })
      expect(sweep(g)).toEqual([])
      expect(p.orderReqs()).toHaveLength(1)
      expect(g.order).toBeNull()
    })

    it('I — SAME user, URL moves to another order: the first order is invisible on the first frame and re-read never reuses it', async () => {
      p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
      await settle()
      p.set({ orderId: ORDER_A2 })
      const first = p.render()
      expect(sweep(first)).toEqual([])
      expect(first.loading).toBe(true)
      p.flushEffects()
      p.orderReqs()[1].resolve(reply(200, { ownerId: A, order: ORD_A2 }))
      await settle()
      expect(p.render().order?.id).toBe(ORDER_A2)
      // and back: a fresh read, the earlier body is gone
      p.commit({ orderId: ORDER_A })
      expect(p.render().order).toBeNull()
      expect(p.orderReqs()).toHaveLength(3)
    })

    it('J — re-rendering the same pair asks nothing further', () => {
      p.commit({})
      p.commit({ status: 'authenticated', userId: A, orderId: ORDER_A })
      expect(p.orderReqs()).toHaveLength(1)
    })

    it('K — a stale FAILURE for A (network error after the switch) is not committed as B\'s « not found »', async () => {
      p.commit({ userId: B })
      p.orderReqs()[0].reject(new TypeError('Failed to fetch'))
      await settle()
      const fr = p.render()
      expect(fr.loading, 'B is still waiting for B\'s own answer').toBe(true)
      expect(fr.notFound).toBe(false)
    })
  })
}

describe('MODELLED /rate — the rating draft belongs to the pair, and the only redirect is off the live session', () => {
  it('A\'s half-done rating (stars, tags, « Merci » view) is reset when B arrives', async () => {
    const p = mountAux('rate', AUTH_A); p.flushEffects()
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    p.draft(1, ['generous'], true)
    expect(p.render().done).toBe(true)
    p.commit({ userId: B })
    const fr = p.render()
    expect(fr.stars).toBe(4)
    expect(fr.tags).toEqual(['delicious', 'hot'])
    expect(fr.done, 'B must not land on A\'s « Merci » screen with A\'s tip and points').toBe(false)
  })
  it('an actually-signed-out visitor is sent to /eat/auth exactly once, off the live session, not off a 401', async () => {
    const p = mountAux('rate', { status: 'unauthenticated', orderId: ORDER_A }); p.flushEffects()
    expect(p.render().redirects).toEqual(['/eat/auth'])
    expect(p.orderReqs()).toHaveLength(0)
    p.commit({})
    expect(p.render().redirects, 'no second push on a re-render').toEqual(['/eat/auth'])
  })
})

describe('MODELLED /help — claim scope, refund draft and the claim POST follow the pair', () => {
  let p: ReturnType<typeof mountAux>
  beforeEach(() => { p = mountAux('help', AUTH_A); p.flushEffects() })

  it('the claims GET is issued ONLY after the order was adopted under the same scope', async () => {
    expect(p.claimReqs()).toHaveLength(0)
    p.orderReqs()[0].resolve(reply(404, {}))
    await settle()
    expect(p.claimReqs(), 'no order → no eligibility request, and the inert path stays').toHaveLength(0)
    expect(p.render().claimsEnabled).toBe(false)
    const q = mountAux('help', AUTH_A); q.flushEffects()
    q.orderReqs()[0].resolve(reply(200, { ownerId: B, order: ORD_A }))   // refused adoption
    await settle()
    expect(q.claimReqs()).toHaveLength(0)
  })

  it('A\'s eligibility (existing claim id, per-line unitCents) is visible to A and gone on B\'s first frame', async () => {
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    expect(p.claimReqs()).toHaveLength(1)
    p.claimReqs()[0].resolve(reply(200, { enabled: true, eligibility: ELIG_A }))
    await settle()
    const mine = p.render()
    expect(mine.claimsEnabled).toBe(true)
    expect(mine.eligibility?.existingClaim?.id).toBe(A_CLAIM_ID)
    p.set({ userId: B })
    const first = p.render()
    expect(first.claimsEnabled).toBe(false)
    expect(first.eligibility).toBeNull()
    expect(sweep(first)).toEqual([])
  })

  it('a LATE eligibility answer for A, after B arrived, is disowned and never enables B\'s form', async () => {
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    p.commit({ userId: B })
    p.claimReqs()[0].resolve(reply(200, { enabled: true, eligibility: ELIG_A }))
    await settle()
    expect(p.render().claimsEnabled).toBe(false)
    expect(sweep(p.render())).toEqual([])
    // B's own flow still works end to end
    p.orderReqs()[1].resolve(reply(200, { ownerId: B, order: ORD_B }))
    await settle()
    p.claimReqs()[1].resolve(reply(200, { enabled: true, eligibility: ELIG_B }))
    await settle()
    const fr = p.render()
    expect(fr.claimsEnabled).toBe(true)
    expect(fr.eligibility?.canClaim).toBe(true)
    expect(fr.eligibility?.scope?.lines[0].unitCents).toBe(1075)
  })

  it('A\'s refund draft (view, ticked lines, description, submit state) is reset when B arrives', async () => {
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    p.pick({ 0: 2 }, 'Il manquait les gnocchi-A')
    expect(p.render().view).toBe('refund')
    p.commit({ userId: B })
    const fr = p.render()
    expect(fr.view).toBe('help')
    expect(fr.picked).toEqual({})
    expect(fr.desc).toBe('')
    expect(fr.submitState).toBe('idle')
    expect(fr.submitError).toBeNull()
    expect(fr.submitted).toBe(false)
  })

  it('a claim POST filed by A that answers after the switch to B touches nothing of B\'s screen', async () => {
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    p.claimReqs()[0].resolve(reply(200, { enabled: true, eligibility: ELIG_B }))   // make A eligible
    await settle()
    const submit = p.submitClaim({ 0: 1 }, 'souci')
    expect(p.render().submitState).toBe('sending')
    p.commit({ userId: B })
    expect(p.render().submitState, 'the switch resets the lifecycle').toBe('idle')
    p.postReqs()[0].resolve(reply(201, { id: 'clm_new' }))
    await submit
    await settle()
    const fr = p.render()
    expect(fr.submitState, 'A\'s 201 must not paint « réclamation envoyée » for B').toBe('idle')
    expect(fr.claimsEnabled).toBe(false)
    expect(p.claimReqs(), 'no eligibility refetch under the dead scope').toHaveLength(1)
    // the error branch is disowned the same way
    const q = mountAux('help', AUTH_A); q.flushEffects()
    q.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A })); await settle()
    q.claimReqs()[0].resolve(reply(200, { enabled: true, eligibility: ELIG_B })); await settle()
    const s2 = q.submitClaim({ 0: 1 }, 'x')
    q.commit({ userId: B })
    q.postReqs()[0].resolve(reply(422, { reason: 'qty_over_purchased' }))
    await s2; await settle()
    expect(q.render().submitState).toBe('idle')
    expect(q.render().submitError).toBeNull()
  })

  it('a claim cannot be filed under a scope that no longer matches the live pair', async () => {
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    p.claimReqs()[0].resolve(reply(200, { enabled: true, eligibility: ELIG_B }))
    await settle()
    p.set({ userId: B })                      // rendered as B, effect not yet run
    await p.submitClaim({ 0: 1 }, 'x')
    expect(p.postReqs(), 'no POST is issued from a stale scope').toHaveLength(0)
  })

  it('the legitimate flow: A files a claim, sees « envoyée », and the eligibility is refetched under A', async () => {
    p.orderReqs()[0].resolve(reply(200, { ownerId: A, order: ORD_A }))
    await settle()
    p.claimReqs()[0].resolve(reply(200, { enabled: true, eligibility: ELIG_B }))
    await settle()
    const submit = p.submitClaim({ 0: 1 }, 'souci')
    p.postReqs()[0].resolve(reply(201, { id: 'clm_new' }))
    await settle()
    expect(p.claimReqs()).toHaveLength(2)
    p.claimReqs()[1].resolve(reply(200, { enabled: true, eligibility: { ...ELIG_B, canClaim: false, reason: 'active_claim', existingClaim: { id: 'clm_new', status: 'restaurant_review' } } }))
    await submit
    const fr = p.render()
    expect(fr.submitState).toBe('done')
    expect(fr.picked).toEqual({})
    expect(fr.eligibility?.existingClaim?.id).toBe('clm_new')
  })
})

// ══ PINNED — the real files implement exactly this ═════════════════════════════════════

/** Every line of `src` that names `name` as a whole identifier, trimmed. */
const linesNaming = (src: string, name: string) =>
  src.split('\n').filter((l) => new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(l)).map((l) => l.trim())

describe('PINNED — positive controls', () => {
  it('the stripper left the code being judged, and really strips', () => {
    for (const f of [PICKUP, RATE, HELP]) {
      expect(executable(read(f))).toContain('useState')
      expect(read(f)).toContain('// ')
      expect(executable(read(f))).not.toContain('P1 SAME-TAB ACCOUNT SCOPE')
    }
  })
  it('linesNaming matches whole identifiers only', () => {
    expect(linesNaming('const orderState = 1\nconst orderStateX = 2\nfoo.orderState\n', 'orderState')).toEqual(['const orderState = 1'])
  })
})

const SHARED_IMPORT = /import \{ emptyScoped, loadOwnedOrder, orderScopeStamp, scopePending, scopedValue, type Scoped \} from '@\/lib\/eat-order-scope'/

function pinCommon(file: string, anchor: string, deps: string, holderType: string) {
  const raw = read(file)
  const src = executable(raw)
  it('imports the shared decisions and derives the identity once, the way /eat/track does', () => {
    expect(src).toMatch(SHARED_IMPORT)
    expect(src).toMatch(/const \{ data: session, status: authStatus \} = useSession\(\)/)
    expect(linesNaming(src, 'userId').filter((l) => l.startsWith('const userId'))).toEqual([
      'const userId = (session?.user as { id?: string } | undefined)?.id',
    ])
    expect(src).toContain('const liveStamp = orderScopeStamp(authStatus, userId, orderId)')
  })
  it('the effect is keyed on identity + orderId (anchored), and no effect keyed without the identity remains', () => {
    expect(raw).toMatch(new RegExp(`\\/\\* ${anchor} \\*\\/ \\[${deps.replace(/[[\]]/g, '')}\\]\\)`))
    expect(src.match(/\}, \[authStatus, orderId\]\)/g) ?? []).toHaveLength(0)
    expect(src.match(/\}, \[orderId, router\]\)/g) ?? []).toHaveLength(0)
    expect(src.match(/\[fetchOrder\]/g) ?? []).toHaveLength(0)
    expect(src.match(/\[authStatus, refetchEligibility\]/g) ?? []).toHaveLength(0)
  })
  it('FAIL-CLOSES before the request, captures the pair + raw id from its own deps, and disowns on cleanup', () => {
    const effectStart = src.indexOf('useEffect(() => {')
    const load = src.indexOf('loadOwnedOrder<')
    const reset = src.indexOf('setOrderState(emptyScoped())')
    expect(effectStart).toBeGreaterThan(-1)
    expect(reset, 'the reset is inside the effect, before the load').toBeGreaterThan(effectStart)
    expect(reset).toBeLessThan(load)
    expect(src).toContain('const requestStamp = orderScopeStamp(authStatus, userId, orderId)')
    expect(src).toContain('const requestUserId = userId')
    expect(src).toContain('if (requestStamp === null || !requestUserId) return')
    expect(src).toContain('let alive = true')
    expect(src).toMatch(/loadOwnedOrder<\w+>\(\{ orderId, requestStamp, requestUserId, isAlive: \(\) => alive \}\)/)
    expect(src).toMatch(/return \(\) => \{ alive = false/)
  })
  it('the stamped holder is an EXACT SET: declared, reset, written from the load, read through the gate — nothing else', () => {
    const lines = linesNaming(src, 'orderState')
    expect(lines).toEqual([
      `const [orderState, setOrderState] = useState<Scoped<${holderType}>>(emptyScoped)`,
      'const order = scopedValue(orderState, liveStamp)',
      ...(file === RATE
        ? ["const loading = authStatus !== 'authenticated' || scopePending(orderState, liveStamp)"]
        : ["const loading = authStatus === 'loading' || scopePending(orderState, liveStamp)"]),
    ])
    // and `loading` is DERIVED — there is no setLoading left to drift
    expect(src).not.toMatch(/setLoading|useState\(true\)/)
    // no raw fetch of the order document remains outside the shared load
    expect(src).not.toMatch(/fetch\(`\/api\/orders\//)
    expect(src).not.toContain('setOrder(')
  })
}

describe('PINNED — /eat/order/[orderId]/pickup', () => {
  pinCommon(PICKUP, 'pickup-deps', '[authStatus, userId, orderId]', 'Order')
  it('writes the holder only from an alive, non-null load result', () => {
    expect(executable(read(PICKUP))).toContain('.then((r) => { if (alive && r) setOrderState(r) })')
  })
  it('the QR, items and total all descend from the gated `order`', () => {
    const src = executable(read(PICKUP))
    expect(src).toContain('if (!order) {')
    expect(src).toContain("const items = useMemo<OrderItem[]>(() => (Array.isArray(order?.items) ? order!.items : []), [order])")
    expect(src).toContain('<QRCodeSVG value={code} size={124} level="M" marginSize={0} />')
    expect(src).toContain('formatEuros(order.total, locale)')
  })
})

describe('PINNED — /eat/order/[orderId]/rate', () => {
  pinCommon(RATE, 'rate-deps', '[authStatus, userId, orderId, router]', 'OrderLite')
  const src = executable(read(RATE))
  it('the rating draft is reset INSIDE the effect, before the load', () => {
    const effectStart = src.indexOf('useEffect(() => {')
    const load = src.indexOf('loadOwnedOrder<')
    for (const reset of ['setStars(4)', "setTags(['delicious', 'hot'])", 'setDone(false)']) {
      const i = src.indexOf(reset)
      expect(i, reset).toBeGreaterThan(effectStart)
      expect(i, reset).toBeLessThan(load)
    }
  })
  it('the ONLY /eat/auth redirect is off the LIVE session; the response handler no longer redirects', () => {
    expect(linesNaming(src, 'router').filter((l) => l.includes("router.push('/eat/auth')"))).toEqual([
      "if (authStatus === 'unauthenticated') { router.push('/eat/auth'); return }",
    ])
    expect(src).not.toMatch(/res\.status === 401/)
    expect(src).not.toContain('useCallback')
  })
  it('the normalised recap is written only from an alive, non-null load result, and « not found » is derived', () => {
    expect(src).toContain('if (!alive || !r) return')
    expect(src).toContain('const notFound = !loading && order === null')
    expect(src).not.toContain('setNotFound')
  })
})

describe('PINNED — /eat/order/[orderId]/help', () => {
  pinCommon(HELP, 'help-deps', '[authStatus, userId, orderId]', 'Order')
  const src = executable(read(HELP))
  it('the claim gate + eligibility are a second stamped holder — an EXACT SET too', () => {
    expect(linesNaming(src, 'claimState')).toEqual([
      'const [claimState, setClaimState] = useState<Scoped<{ enabled: boolean; eligibility: ClaimEligibility | null }>>(emptyScoped)',
      'const claims = scopedValue(claimState, liveStamp)',
    ])
    expect(linesNaming(src, 'setClaimState')).toEqual([
      'const [claimState, setClaimState] = useState<Scoped<{ enabled: boolean; eligibility: ClaimEligibility | null }>>(emptyScoped)',
      'setClaimState({ stamp: scope.stamp, value: next })',
      'setClaimState(emptyScoped())',
      'setClaimState({ stamp: scope.stamp, value: { enabled: false, eligibility: null } })',
    ])
    expect(src).toContain("const claimsEnabled = order !== null && claims?.enabled === true")
    expect(src).toContain('const eligibility = claimsEnabled ? claims?.eligibility ?? null : null')
    expect(src).not.toMatch(/setClaimsEnabled|setEligibility|refetchEligibility|useCallback/)
  })
  it('the claims GET is chained AFTER adoption of the order under the same scope, and disowned with it', () => {
    expect(src).toMatch(/\.then\(\(r\) => \{\s*if \(!alive \|\| !r\) return\s*setOrderState\(r\)\s*if \(r\.value !== null\) void loadEligibility\(scope, orderId\)\s*\}\)/)
    expect(src).toContain('const scope = { stamp: requestStamp, userId: requestUserId, isAlive: () => alive }')
    expect(src).toContain('scopeRef.current = scope')
    expect(src).toContain('return () => { alive = false; if (scopeRef.current === scope) scopeRef.current = null }')
    // inside loadEligibility: checked after the headers and again before the write
    expect(src).toMatch(/async function loadEligibility\(scope[\s\S]*?if \(!scope\.isAlive\(\)\) return[\s\S]*?if \(!scope\.isAlive\(\)\) return\s*setClaimState\(\{ stamp: scope\.stamp, value: next \}\)/)
  })
  it('every order-bound draft is reset INSIDE the effect, before the load', () => {
    const effectStart = src.indexOf('useEffect(() => {')
    const load = src.indexOf('loadOwnedOrder<')
    for (const reset of ['setClaimState(emptyScoped())', "setView('help')", 'setPicked({})', "setDesc('')", 'setSubmitted(false)', "setSubmitState('idle')", 'setSubmitError(null)', 'scopeRef.current = null']) {
      const i = src.indexOf(reset)
      expect(i, reset).toBeGreaterThan(effectStart)
      expect(i, reset).toBeLessThan(load)
    }
  })
  it('the claim POST is filed under the captured scope and every continuation is guarded', () => {
    const submit = src.slice(src.indexOf('async function submitClaim'), src.indexOf('const eligibilityLabel'))
    expect(submit).toContain('const scope = scopeRef.current')
    expect(submit).toContain('if (!scope || scope.stamp !== liveStamp) return')
    expect(submit.match(/if \(!scope\.isAlive\(\)\) return/g) ?? [], 'after the POST, after the json, in the catch').toHaveLength(3)
    expect(submit).toContain('await loadEligibility(scope, orderId)')
    expect(submit).not.toContain('refetchEligibility')
  })
  it('the sign-in CTA is the only /eat/auth push (no redirect from a response)', () => {
    expect(linesNaming(src, 'router').filter((l) => l.includes("router.push('/eat/auth')"))).toHaveLength(1)
    expect(src).not.toMatch(/res\.status === 401/)
  })
})

describe('PINNED — the shared module and its authorities were not weakened', () => {
  it('lib/eat-order-scope derives the identity from sessionCartStamp and refuses guest + unknown', () => {
    const src = executable(read(LIB))
    expect(src).toMatch(/import \{ sessionCartStamp \} from '@\/lib\/eat-cart'/)
    expect(src).toContain("if (identity === null || identity === 'guest') return null")
    expect(src).toContain("if (typeof b.ownerId !== 'string' || b.ownerId !== requestUserId) return null")
    expect(src).not.toMatch(/router|redirect|\/eat\/auth/)
  })
  it('GET /api/orders/[id] still names the SERVER-authenticated token.sub as ownerId', () => {
    const src = read(ORDER_ROUTE)
    expect(src).toMatch(/ownerId[^=]*=\s*typeof token\?\.sub === 'string' \? token\.sub : null/)
    expect(src).toMatch(/ownerId,\s*\n\s*order:/)
    expect(src).not.toMatch(/ownerId\s*[:=][^\n]*order\.consumerId/)
  })
  it('/eat/track (PR #21) was not refactored onto this module — its merged fix stays as pinned by its own suite', () => {
    expect(read(TRACK)).not.toContain('eat-order-scope')
  })
})
