import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionCartStamp } from '@/lib/eat-cart'

// ── /eat/track/[orderId] — ORDER + REFUND + COURIER, CROSS-ACCOUNT (P1) ──────
//
// WHAT IS WRONG IN `main`. app/[locale]/eat/track/[orderId]/page.tsx polls two
// owner-scoped endpoints every 15 s:
//
//   GET /api/orders/[id]                   → order (status, items, totals, address,
//                                            refundSummary with amounts in cents)
//   GET /api/orders/[id]/courier-position  → courier (coarsened) lat/lng + ETA + anchors
//
// The effect was keyed on `[fetchOrder, fetchCourierPos]`, which under the hood
// collapsed to `[orderId]`: `status` is not a dep, and NextAuth broadcasts
// `setSession` without flipping through 'unauthenticated' on an A → B cross-tab
// switch — so the effect did NOT re-fire on identity change. Four failure modes
// compound: (1) A's order, refund block and delivery address stayed painted on
// B's screen; (2) A's courier geolocation (an RGPD-sensitive datum, even
// coarsened) stayed on B's map; (3) no response-side owner check — a GET issued
// while React still believed A could be authenticated as B and the body adopted
// as A's; (4) a stale A-identity poll could trampoline a signed-in B through
// /eat/auth on a late 401, so the mission requires fail-closed on 401/403/404
// without redirect loops.
//
// Both GET routes serve a mixed caller set (consumer owner, restaurant operator
// of the order's establishment, admin), so the server-echoed `ownerId` MUST be
// `token.sub` — the ACTUAL caller — never `order.consumerId`: an admin reading
// someone else's order would otherwise hand the client a false identity match.
//
// HOW THIS IS PROVEN. The identity rule is the repository's own exported
// `sessionCartStamp`, CALLED here rather than restated (otherwise the test
// proves agreement with the test). The effect/response sequencing is modelled
// because it is control flow inside the page with no decision to export; the
// source pins at the bottom hold the real page to that shape and the mutation
// battery is what makes the pins non-vacuous. The route pins check the
// SERVER-authenticated token.sub, not the queried consumer id.

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
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
const PAGE = 'app/[locale]/eat/track/[orderId]/page.tsx'
const ORDER_ROUTE = 'app/api/orders/[id]/route.ts'
const COURIER_ROUTE = 'app/api/orders/[id]/courier-position/route.ts'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`

interface OrderBody {
  ownerId?: unknown
  order?: {
    id: string
    status: string
    total: number
    deliveryAddress: string
    items: Array<{ name: string; qty: number; price: number }>
    estimatedTime: number
    pointsEarned: number
    createdAt: string
    restaurant: { name: string; address: string }
    refundSummary?: {
      refundedCents: number
      pendingCents: number
      unattributedCents: number
      chargeCents: number
      isTotal: boolean
      isPartial: boolean
      refunds: Array<{ amountCents: number; at: string; source: string }>
      pointsReversed: number
      pointsRestored: number
    }
  }
}
interface CourierBody {
  ownerId?: unknown
  available: boolean
  approx?: boolean
  courier?: { lat: number; lng: number }
  pickup?: { lat: number; lng: number } | null
  dropoff?: { lat: number; lng: number } | null
  etaMinutes?: number | null
}

const ORDER_A_ID = 'ord_a_1'
const ORDER_B_ID = 'ord_b_1'

function makeOrder(id: string, address: string, refundedCents = 0): NonNullable<OrderBody['order']> {
  return {
    id,
    status: 'preparing',
    total: 14.5,
    deliveryAddress: address,
    items: [{ name: 'Gnocchi', qty: 1, price: 14.5 }],
    estimatedTime: 30,
    pointsEarned: 14,
    createdAt: '2026-10-09T10:00:00Z',
    restaurant: { name: 'Gnocchi Bar', address: 'rue des champs' },
    refundSummary: {
      refundedCents,
      pendingCents: 0,
      unattributedCents: 0,
      chargeCents: 1450,
      isTotal: refundedCents === 1450,
      isPartial: refundedCents > 0 && refundedCents < 1450,
      refunds: refundedCents > 0 ? [{ amountCents: refundedCents, at: '2026-10-09T11:00:00Z', source: 'claim' }] : [],
      pointsReversed: refundedCents === 1450 ? 14 : 0,
      pointsRestored: 0,
    },
  }
}

const ORDER_A = makeOrder(ORDER_A_ID, '12 rue de A, Paris', 1450) // A's order, fully refunded (sensitive)
const ORDER_B = makeOrder(ORDER_B_ID, '34 rue de B, Lyon', 0)      // B's order, no refund

const COURIER_A: CourierBody = {
  available: true, approx: true,
  courier: { lat: 48.8566, lng: 2.3522 },
  pickup: { lat: 48.86, lng: 2.35 },
  dropoff: { lat: 48.85, lng: 2.36 },
  etaMinutes: 12,
}
const COURIER_B: CourierBody = {
  available: true, approx: true,
  courier: { lat: 45.7640, lng: 4.8357 },
  pickup: { lat: 45.76, lng: 4.84 },
  dropoff: { lat: 45.77, lng: 4.83 },
  etaMinutes: 7,
}

/**
 * MODELLED: the page's two polling effects, with React's rule that an effect's
 * cleanup runs before the next run of that same effect. The IDENTITY decision is
 * the real exported `sessionCartStamp`. Everything the model asserts about the
 * page's shape is pinned separately against the source.
 */
function mountTrack() {
  let liveOwner: string | null = null
  let liveUserId: string | undefined
  let liveOrderId: string = ORDER_A_ID
  // owner-stamped state — read through a render-time match against the live stamp.
  let orderS: { stamp: string | null; order: NonNullable<OrderBody['order']> | null } = { stamp: null, order: null }
  let courierS: { stamp: string | null; pos: CourierBody | null } = { stamp: null, pos: null }
  let redirected: string | null = null
  let lastKey: string | undefined
  const orderInFlight: Array<{ owner: string; userId: string; alive: () => boolean }> = []
  const courierInFlight: Array<{ owner: string; userId: string; alive: () => boolean }> = []
  let cleanup: (() => void) | null = null
  const routeStamp = () => liveOwner === null ? null : JSON.stringify([liveOwner, liveOrderId])

  function runEffect(): void {
    const key = `${liveOwner ?? '?'}|${liveUserId ?? '?'}|${liveOrderId}`
    if (lastKey === key) return
    lastKey = key
    if (cleanup) cleanup()
    // FAIL CLOSED FIRST — the previous owner's values leave the screen BEFORE any request.
    orderS = { stamp: null, order: null }
    courierS = { stamp: null, pos: null }
    if (liveOwner === null) return                 // status 'loading' → no network
    if (liveOwner === 'guest') {
      redirected = '/eat/auth'                     // actually-signed-out visitor
      return
    }
    if (liveUserId === undefined) return           // defence in depth
    const requestOwner = routeStamp()!
    const requestUserId = liveUserId
    let alive = true
    orderInFlight.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    courierInFlight.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    cleanup = () => { alive = false }
  }

  const flush = () => runEffect()

  function answerOrder(index: number, body: OrderBody | null, ...serverOwnerIdOverride: unknown[]) {
    const req = orderInFlight[index]
    if (!req) throw new Error('no order request at index ' + index)
    if (!req.alive()) return
    const serverOwnerId: unknown = serverOwnerIdOverride.length > 0 ? serverOwnerIdOverride[0] : req.userId
    if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) return
    if (!body?.order) return
    orderS = { stamp: req.owner, order: body.order }
  }
  function answerCourier(index: number, body: CourierBody | null, ...serverOwnerIdOverride: unknown[]) {
    const req = courierInFlight[index]
    if (!req) throw new Error('no courier request at index ' + index)
    if (!req.alive()) return
    if (!body || body.available !== true) {
      // non-adoptable body on an alive request → clear under the request's stamp
      courierS = { stamp: req.owner, pos: null }
      return
    }
    const serverOwnerId: unknown = serverOwnerIdOverride.length > 0 ? serverOwnerIdOverride[0] : req.userId
    if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) {
      courierS = { stamp: req.owner, pos: null }
      return
    }
    courierS = { stamp: req.owner, pos: body }
  }
  function denyOrder(index: number) {
    // 401/403/404 — fail closed, no state change, no redirect
    const req = orderInFlight[index]
    if (!req || !req.alive()) return
    /* nothing */
  }
  function denyCourier(index: number) {
    const req = courierInFlight[index]
    if (!req || !req.alive()) return
    courierS = { stamp: req.owner, pos: null }
  }

  return {
    signIn(owner: string | null, userId?: string) {
      liveOwner = owner
      liveUserId = userId
      flush()
    },
    switchOrder(id: string) {
      liveOrderId = id
      flush()
    },
    // Simulates the first React render of a new route, before useEffect cleanup.
    previewRouteChange(id: string) { liveOrderId = id },
    answerOrder, answerCourier, denyOrder, denyCourier,
    tick() {
      // 15 s poll — if the current effect is still live, enqueue a new pair of requests
      if (!cleanup) return
      const owner = routeStamp()!
      const userId = liveUserId!
      let alive = true
      const req = { owner, userId, alive: () => alive }
      orderInFlight.push(req)
      courierInFlight.push(req)
      // chain alive on top of the existing cleanup
      const prev = cleanup
      cleanup = () => { prev(); alive = false }
    },
    get redirected() { return redirected },
    get pendingOrder() { return orderInFlight.length },
    get pendingCourier() { return courierInFlight.length },
    get view() {
      const oMine = orderS.stamp !== null && orderS.stamp === routeStamp()
      const cMine = courierS.stamp !== null && courierS.stamp === routeStamp()
      return {
        order: oMine ? orderS.order : null,
        courier: cMine ? courierS.pos : null,
        orderStamp: orderS.stamp,
        courierStamp: courierS.stamp,
      }
    },
  }
}

// ══ the identity is the repository's own ════════════════════════════════════

describe('the identity is the repository\'s own', () => {
  it('sessionCartStamp is CALLED, and this page does not invent a third definition', () => {
    expect(sessionCartStamp('authenticated', A)).toBe(OWN_A)
    expect(sessionCartStamp('unauthenticated', null)).toBe('guest')
    expect(sessionCartStamp('loading', A)).toBeNull()
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()

    const src = executable(read(PAGE))
    expect(src, 'the page imports the shared stamp').toMatch(
      /import \{[^}]*sessionCartStamp[^}]*\} from '@\/lib\/eat-cart'/,
    )
  })
})

// ══ A–H : the mandated matrix ═══════════════════════════════════════════════

describe('A–H — order, refund and courier never cross an account boundary', () => {
  let p: ReturnType<typeof mountTrack>
  beforeEach(() => { p = mountTrack() })

  it('A — A loaded, B signs in BEFORE A answers: B sees nothing of A (incl. refund block, address, courier)', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)                              // switch happens while A's GET is in flight
    p.answerOrder(0, { order: ORDER_A })            // honest late answer for A
    p.answerCourier(0, COURIER_A)
    expect(p.view.order, 'A\'s order (incl. refund+address) must not reach B').toBeNull()
    expect(p.view.courier, 'A\'s courier geolocation must not reach B').toBeNull()
    expect(p.view.orderStamp, 'state carries no leftover stamp').toBeNull()
    expect(p.view.courierStamp).toBeNull()
  })

  it('B — A loaded, then B loaded: each sees only its own', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })
    p.answerCourier(0, COURIER_A)
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    expect(p.view.order?.deliveryAddress).toContain('A')
    expect(p.view.order?.refundSummary?.refundedCents).toBe(1450)
    expect(p.view.courier?.courier?.lat).toBeCloseTo(48.8566)

    p.signIn(OWN_B, B)
    expect(p.view.order, 'A\'s order is dropped the moment the identity moves').toBeNull()
    expect(p.view.courier).toBeNull()
    p.answerOrder(1, { order: ORDER_B })
    p.answerCourier(1, COURIER_B)
    expect(p.view.order?.id).toBe(ORDER_B_ID)
    expect(p.view.order?.refundSummary?.refundedCents).toBe(0)
    expect(p.view.courier?.courier?.lat).toBeCloseTo(45.7640)
  })

  it('C — the refund block does not survive A → B even when it is the most sensitive line', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })             // A has pointsReversed=14, refundedCents=1450
    expect(p.view.order?.refundSummary?.pointsReversed).toBe(14)
    p.signIn(OWN_B, B)
    expect(p.view.order, 'the refund figures (money + loyalty) are the refund block\'s raison d\'être — they must drop').toBeNull()
  })

  it('D — a LATE response for A, after B has already loaded, changes nothing', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)
    p.answerOrder(1, { order: ORDER_B })
    p.answerCourier(1, COURIER_B)
    expect(p.view.order?.id).toBe(ORDER_B_ID)
    p.answerOrder(0, { order: ORDER_A })             // late, correctly-attributed response for A
    p.answerCourier(0, COURIER_A)
    expect(p.view.order?.id, 'B keeps its own, A was superseded').toBe(ORDER_B_ID)
    expect(p.view.courier?.courier?.lat).toBeCloseTo(45.7640)
  })

  it('E — access denied (401/403/404) on A → B: no state and no redirect loop', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)                               // React believes B now
    p.denyOrder(0)                                   // A's stale poll → 401/403/404
    p.denyCourier(0)
    expect(p.view.order).toBeNull()
    expect(p.view.courier).toBeNull()
    expect(p.redirected, 'a stale A poll must not trampoline B through /eat/auth').toBeNull()
  })

  it('F — logout to unauthenticated: nothing shown, redirect to /eat/auth once', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    p.signIn('guest')
    expect(p.view.order, 'A\'s order gone from the signed-out page').toBeNull()
    expect(p.view.courier).toBeNull()
    expect(p.redirected).toBe('/eat/auth')
    expect(p.pendingOrder, 'no new GET /api/orders/[id] for a guest').toBe(1)
  })

  it('G — an UNRESOLVED identity reads nothing and keeps the chrome neutral', () => {
    p.signIn(null)                                   // status 'loading'
    expect(p.pendingOrder).toBe(0)
    expect(p.pendingCourier).toBe(0)
    expect(p.view.order).toBeNull()
    expect(p.view.courier).toBeNull()
    expect(p.redirected).toBeNull()
    // …and coming back to a real identity works normally
    p.signIn(OWN_B, B)
    p.answerOrder(0, { order: ORDER_B })
    expect(p.view.order?.id).toBe(ORDER_B_ID)
  })

  it('G bis — authenticated with no resolvable id: no request, no leftover stamp', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })
    p.signIn(null)                                   // stamp null — unresolved
    expect(p.pendingOrder, 'A\'s only; no request for the unnameable identity').toBe(1)
    expect(p.view.order).toBeNull()
    expect(p.view.courier).toBeNull()
  })

  it('H — A → B → A: a fresh read is required for A, nothing is reused from memory', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })
    p.answerCourier(0, COURIER_A)
    p.signIn(OWN_B, B)
    p.answerOrder(1, { order: ORDER_B })
    p.answerCourier(1, COURIER_B)
    expect(p.view.order?.id).toBe(ORDER_B_ID)
    p.signIn(OWN_A, A)
    expect(p.view.order, 'A\'s old order is NOT reused').toBeNull()
    expect(p.view.courier, 'nor is A\'s old courier geolocation').toBeNull()
    p.answerOrder(2, { order: ORDER_A })
    p.answerCourier(2, COURIER_A)
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    expect(p.view.courier?.courier?.lat).toBeCloseTo(48.8566)
  })
})

// ══ the GET half of the TOCTOU: server-authenticated identity ═══════════════

describe('a GET response is adopted only under the identity the SERVER authenticated', () => {
  let p: ReturnType<typeof mountTrack>
  beforeEach(() => { p = mountTrack() })

  it('1 — the client believes A, the server authenticated B: order is NOT adopted', () => {
    p.signIn(OWN_A, A)
    expect(p.pendingOrder).toBe(1)
    p.answerOrder(0, { order: ORDER_B }, B)         // server says « this body belongs to B »
    expect(p.view.order, 'B\'s order never appears on A\'s screen').toBeNull()
    expect(p.view.orderStamp).toBeNull()
  })

  it('1 bis — same, but for the courier geolocation (RGPD-sensitive)', () => {
    p.signIn(OWN_A, A)
    p.answerCourier(0, COURIER_B, B)
    expect(p.view.courier, 'B\'s courier position never appears on A\'s map').toBeNull()
  })

  it('2 — client believes A, server returns ownerId=A: adopted, unchanged', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A }, A)
    p.answerCourier(0, COURIER_A, A)
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    expect(p.view.courier?.courier?.lat).toBeCloseTo(48.8566)
  })

  it('3 — a response that names NOBODY (or a wrong primitive) is refused', () => {
    for (const bad of [undefined, null, '', 0, false, {}, [], `u:${A}`]) {
      const q = mountTrack()
      q.signIn(OWN_A, A)
      q.answerOrder(0, { order: ORDER_A }, bad)
      q.answerCourier(0, COURIER_A, bad)
      expect(q.view.order, `ownerId=${JSON.stringify(bad)}`).toBeNull()
      expect(q.view.courier, `ownerId=${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('4 — A → B, then A\'s own correctly-attributed response arrives late: still refused by alive', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)
    p.answerOrder(1, { order: ORDER_B }, B)
    p.answerCourier(1, COURIER_B, B)
    expect(p.view.order?.id).toBe(ORDER_B_ID)
    p.answerOrder(0, { order: ORDER_A }, A)         // honest server, superseded request
    p.answerCourier(0, COURIER_A, A)
    expect(p.view.order?.id, 'B keeps its own').toBe(ORDER_B_ID)
    expect(p.view.courier?.courier?.lat).toBeCloseTo(45.7640)
  })

  it('4 bis — the two guards are independent: neither alone would be enough', () => {
    // `alive` catches « React already moved »; the ownerId check catches « React has not
    // moved yet ». Each case below is closed by exactly one of them.
    const q = mountTrack()
    q.signIn(OWN_A, A)
    q.signIn(OWN_B, B)
    q.answerOrder(0, { order: ORDER_A }, A)         // superseded but correctly attributed → only `alive`
    expect(q.view.order).toBeNull()

    const r = mountTrack()
    r.signIn(OWN_A, A)
    r.answerOrder(0, { order: ORDER_B }, B)         // live but wrongly attributed → only the ownerId check
    expect(r.view.order).toBeNull()
    expect(r.view.courierStamp).toBeNull()
  })

  it('guest and unresolved still issue NO GET at all', () => {
    const g = mountTrack()
    g.signIn('guest')
    expect(g.pendingOrder, 'guest never queries an owner-scoped order').toBe(0)
    expect(g.pendingCourier).toBe(0)
    const u = mountTrack()
    u.signIn(null)
    expect(u.pendingOrder).toBe(0)
    expect(u.pendingCourier).toBe(0)
  })
})

// ══ polling, cleanup, unmount, orderId switch ═══════════════════════════════

describe('the 15 s poll, cleanup and route change', () => {
  let p: ReturnType<typeof mountTrack>
  beforeEach(() => { p = mountTrack() })

  it('a poll fired AFTER A → B lands under B\'s identity, not A\'s', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })
    p.signIn(OWN_B, B)
    // one 15 s tick after the identity has flipped: the new request is B's
    p.tick()
    // index 1 is B's identity read (fired by the re-run of the effect on identity change);
    // the tick enqueues index 2 on B's effect
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.order?.id).toBe(ORDER_B_ID)
  })

  it('a stale A-identity 15 s poll that answers after A → B is disowned by alive', () => {
    p.signIn(OWN_A, A)
    p.tick()                                         // A fires a 2nd poll (index 1 under A)
    p.signIn(OWN_B, B)                               // A's effect is cleaned up → index 0 and 1 lose alive
    p.answerOrder(1, { order: ORDER_A })             // honest late poll under A
    expect(p.view.order, 'A\'s late poll must not paint on B').toBeNull()
  })

  it('switching orderId blanks the FIRST render, before cleanup, and then re-fires the effect', () => {
    p.signIn(OWN_A, A)
    p.answerOrder(0, { order: ORDER_A })
    p.answerCourier(0, COURIER_A)
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    expect(p.view.courier?.available).toBe(true)
    // First render of the new route happens BEFORE useEffect cleanup / reset.
    p.previewRouteChange('ord_a_2')
    expect(p.view.order, 'old address and refund must vanish on first new-route render').toBeNull()
    expect(p.view.courier, 'old courier geolocation must vanish on first new-route render').toBeNull()
    p.switchOrder('ord_a_2')
    expect(p.view.order, 'leaving a route drops the previous order first').toBeNull()
    // the new effect run is at index 1 under A
    const next = makeOrder('ord_a_2', '12 rue de A, Paris', 0)
    p.answerOrder(1, { order: next })
    expect(p.view.order?.id).toBe('ord_a_2')
  })
})

// ══ the real track page ═════════════════════════════════════════════════════

describe('the track page really implements this', () => {
  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(executable(read(PAGE))).toContain('useState')
    expect(read(PAGE)).toContain('// ')
    expect(executable(read(PAGE))).not.toContain('// FIRST-FRAME GUARD')
  })

  it('the polling effect is keyed on identity + orderId, not merely orderId', () => {
    const raw = read(PAGE)
    const src = executable(raw)
    expect(src).toMatch(/const userId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    // the ANCHOR comment, left in the RAW source so a reviewer who moves the dep array
    // has to move the anchor with it — the executable form strips comments.
    expect(raw, 'the effect is keyed on identity').toMatch(
      /\/\* track-deps \*\/\s*\[status, userId, orderId\]\)/,
    )
    // no effect keyed solely on orderId / orderId+router remains
    expect(src.match(/\}, \[orderId\]\)/g) ?? [], 'no effect keyed solely on orderId').toHaveLength(0)
    expect(src.match(/\}, \[orderId, router\]\)/g) ?? [], 'no effect keyed on just orderId+router').toHaveLength(0)
  })

  it('order AND courier state carry the stamp of the identity they were read under', () => {
    const src = executable(read(PAGE))
    expect(src).toMatch(/useState<\{ stamp: string \| null; order: Order \| null \}>\(/)
    expect(src).toMatch(/useState<\{ stamp: string \| null; pos: CourierPos \| null \}>\(/)
    // and only ever surfaced through a render-time match against the live session stamp
    expect(src).toMatch(/orderState\.stamp !== null && orderState\.stamp === trackStamp/)
    expect(src).toMatch(/courierState\.stamp !== null && courierState\.stamp === trackStamp/)
  })

  it('the effect FAIL-CLOSES before any request and captures requestOwner + requestUserId', () => {
    const src = executable(read(PAGE))
    // the previous owner's state is dropped FIRST, before any fetch (both stores)
    expect(src).toMatch(/setOrderState\(\{ stamp: null, order: null \}\)[\s\S]*?setCourierState\(\{ stamp: null, pos: null \}\)[\s\S]*?fetch\(`\/api\/orders\//)
    // the 'loading' branch bails out silently; the 'unauthenticated' branch REDIRECTS
    // off the LIVE session (never off a stale polled 401 — see « 401/403/404 fail CLOSED »).
    expect(src).toMatch(/if \(status === 'loading'\) return/)
    expect(src).toMatch(/if \(status === 'unauthenticated'\) \{ setLoading\(false\); router\.push\('\/eat\/auth'\); return \}/)
    expect(src).toMatch(/if \(!userId\)/)
    // response stamping + alive
    expect(src).toMatch(/const requestOwner = trackStamp/)
    expect(src).toMatch(/const requestUserId = userId/)
    expect(src).toMatch(/let alive = true/)
    expect(src).toMatch(/return \(\) => \{ alive = false; clearInterval\(poll\) \}/)
  })

  it('a response that does not name the requested raw id is refused (both routes)', () => {
    const src = executable(read(PAGE))
    // the order half
    expect(src).toMatch(
      /\.json\(\)\) as \{ ownerId\?: unknown; order\?: Order \}[\s\S]{0,200}if \(typeof data\?\.ownerId !== 'string' \|\| data\.ownerId !== requestUserId\) return/,
    )
    // the courier half
    expect(src).toMatch(
      /\.json\(\)\) as \(CourierPos & \{ ownerId\?: unknown \}\) \| null[\s\S]{0,300}if \(typeof data\.ownerId !== 'string' \|\| data\.ownerId !== requestUserId\)/,
    )
  })

  it('401/403/404 fail CLOSED without a redirect from the fetch handlers', () => {
    const src = executable(read(PAGE))
    // the pre-fix handler issued `router.push('/eat/auth')` on `res.status === 401`
    expect(src, 'no redirect from inside fetchOrder').not.toMatch(
      /res\.status === 401/,
    )
    // the only /eat/auth redirect lives OFF the live session, not inside a response handler
    const authRedirects = src.match(/router\.push\('\/eat\/auth'\)/g) ?? []
    expect(authRedirects.length, 'the live-session redirect is the only one').toBe(1)
    // ⚠ the 404 render path is DRIVEN BY the render-time gate (orderStampOk ? order : null),
    // not by the fetch handler — so a 403 lands at `!order` naturally.
    expect(src).toMatch(/if \(!order\) \{/)
  })

  it('the courier handler clears `pos` under the request\'s stamp on OFF / 403 / {available:false}', () => {
    const src = executable(read(PAGE))
    // the OFF / 403 / bad-shape branches all setCourierState({ stamp: requestOwner, pos: null })
    expect(src).toMatch(/setCourierState\(\{ stamp: requestOwner, pos: null \}\); return/)
  })

  it('the render-time gate blanks order AND courier on a stamp mismatch', () => {
    const src = executable(read(PAGE))
    expect(src).toMatch(/const orderStampOk = orderState\.stamp !== null && orderState\.stamp === trackStamp/)
    expect(src).toMatch(/const order = orderStampOk \? orderState\.order : null/)
    expect(src).toMatch(/const courierStampOk = courierState\.stamp !== null && courierState\.stamp === trackStamp/)
    expect(src).toMatch(/const courierPos = courierStampOk \? courierState\.pos : null/)
  })

  it('route identity is in the render-time stamp, not only in effect dependencies', () => {
    const src = executable(read(PAGE))
    // React renders with the NEW orderId before it executes the cleanup / reset effect.
    // Both sensitive stores must fail closed on that very first frame.
    expect(src).toMatch(/const trackStamp = sessionStamp !== null[\s\S]{0,180}orderId[\s\S]{0,100}: null/)
    expect(src).toMatch(/const requestOwner = trackStamp/)
    expect(src).toMatch(/orderState\.stamp !== null && orderState\.stamp === trackStamp/)
    expect(src).toMatch(/courierState\.stamp !== null && courierState\.stamp === trackStamp/)
  })

  it('the 15 s poll is preserved', () => {
    const src = executable(read(PAGE))
    expect(src).toMatch(/setInterval\(\(\) => \{ fetchOrder\(\); fetchCourierPos\(\) \}, 15_000\)/)
  })
})

// ══ the endpoints really name the identity they authenticated ═══════════════

describe('the endpoints name the SERVER-authenticated identity', () => {
  it('GET /api/orders/[id] returns ownerId sourced from the AUTHENTICATED token.sub (NOT order.consumerId)', () => {
    const src = read(ORDER_ROUTE)
    // ownerId is derived from the ACTUAL caller — never the queried consumer id.
    expect(src).toMatch(/ownerId[^=]*=\s*typeof token\?\.sub === 'string' \? token\.sub : null/)
    // surfaced at the top of the JSON body, alongside `order`
    expect(src).toMatch(/ownerId,\s*\n\s*order:/)
    // and NOT sourced from the queried consumer id (an admin/staff caller legitimately
    // reads someone else's order here — stamping with consumerId would be a false match)
    expect(src, 'ownerId must never be sourced from order.consumerId').not.toMatch(
      /ownerId\s*[:=][^\n]*order\.consumerId/,
    )
  })

  it('GET /api/orders/[id]/courier-position returns ownerId from token.sub too', () => {
    const src = read(COURIER_ROUTE)
    expect(src).toMatch(/ownerIdOut[^=]*=\s*typeof token\.sub === 'string' \? token\.sub : null/)
    expect(src).toMatch(/ownerId: ownerIdOut,/)
    expect(src, 'courier ownerId must not be sourced from order.consumerId').not.toMatch(
      /ownerId\s*[:=][^\n]*order\.consumerId/,
    )
    // the OFF-path ({ available: false, gated: true }) carries no owner-specific data,
    // so its 404 body must stay byte-identical when LOGISTICS_TRACKING_ENABLED is OFF.
    expect(src).toMatch(/\{ available: false, gated: true \}/)
  })
})
