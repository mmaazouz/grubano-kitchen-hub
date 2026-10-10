import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionCartStamp } from '@/lib/eat-cart'
import { sessionAddressStamp } from '@/lib/eat-addresses'

// ── /eat/checkout/[orderId] — ORDER RECAP + LIVE STRIPE PAYMENTINTENT, CROSS-ACCOUNT (P1) ──
//
// WHAT WAS WRONG IN `main` (independent audit P1-D, after PR #21 fixed /eat/track).
// app/[locale]/eat/checkout/[orderId]/page.tsx loaded the recap through
//
//   GET  /api/orders/[id]       → items, subtotal, deliveryFee, total, promotion,
//                                 loyalty credit, delivery address, restaurant
//   POST /api/orders/[id]/pay   → { clientSecret, publishableKey, amount, currency }
//                                 — a LIVE Stripe PaymentIntent for THAT order
//
// in an effect keyed on `[orderId, loadOrder]`, i.e. on `[orderId]`: `status` stays
// 'authenticated' across an A → B switch inside the same tab (NextAuth broadcasts
// `setSession` without passing through 'unauthenticated'), so nothing re-fired. The
// order, the stage and — worst — `payInit` (A's clientSecret) stayed in plain React
// state: B inherited A's recap AND a mounted <StripeTicketPayment/> / <WalletPaymentButton/>
// bound to A's PaymentIntent. Confirming it would charge B's card for A's order, and
// the server-side owner check of POST /pay never ran again because the secret was
// already in the client. A stale 401 also `router.push('/eat/auth')`-ed a signed-in B.
//
// THE FIX (this file is the regression gate for it):
//   • ONE stamped record { stamp, order, payInit, stage } holds everything account- or
//     order-specific; `stamp` = JSON.stringify([sessionCartStamp(status, userId), orderId]).
//   • RENDER-TIME GATE: `inScope = scoped.stamp === checkoutStamp` — computed in the SAME
//     render as the new session, BEFORE any effect: order, payInit, stage and the error text
//     fall back to loading/null synchronously, so no frame of A paints under B and the Stripe
//     Elements unmount on that very frame.
//   • The load effect is keyed on [status, userId, orderId, reloadTick], FAIL-CLOSES FIRST
//     (record reset before any request), captures requestOwner/requestUserId/requestOrderId,
//     refuses a body whose server-echoed `ownerId` is not the SAME RAW ID or whose
//     `order.id` is not the route's, and disowns late answers through `alive`.
//   • POST /pay (no ownerId echo on that route — backend untouched) is bound to a scope
//     GENERATION captured at click time: a response that lands after the identity/route/
//     retry generation moved is discarded, and adoption is a functional update that only
//     applies to a record still carrying the SAME stamp.
//   • `setStage` is scope-bound too: the `onPaid` closure Stripe holds cannot flip B's
//     record to 'paid' after an A → B switch (no false « Commande confirmée »).
//   • 401/403/404 FAIL CLOSED (neutral error + retry) without any redirect from a response
//     handler; the only /eat/auth redirect is taken OFF THE LIVE SESSION.
//
// HOW THIS IS PROVEN. The identity rule is the repository's own exported `sessionCartStamp`,
// CALLED here rather than restated. The effect/response/click sequencing is modelled because
// it is control flow inside a 'use client' page with no DOM harness; the source pins at the
// bottom hold the real page to that shape and the mutation battery makes the pins non-vacuous.
// No Stripe code runs here: the model only tracks WHETHER the Elements would be mounted and
// with WHICH clientSecret.

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
const PAGE = 'app/[locale]/eat/checkout/[orderId]/page.tsx'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`
const ORDER_A_ID = 'ord_a_1'
const ORDER_A2_ID = 'ord_a_2'
const ORDER_B_ID = 'ord_b_1'

type Status = 'loading' | 'authenticated' | 'unauthenticated'
type Stage = 'loading' | 'review' | 'pay' | 'paid' | 'already-paid' | 'error'

interface OrderInfo {
  id: string
  status: string
  fulfillmentType: string
  items: Array<{ name: string; qty: number; price: number }>
  subtotal: number
  deliveryFee: number
  total: number
  paymentStatus?: string | null
  deliveryAddress?: string | null
  restaurant?: { id: string; name: string } | null
}
interface OrderBody { ownerId?: unknown; order?: OrderInfo }
interface PayInit { clientSecret: string; publishableKey: string; amount: number; currency: string }
interface PayAnswer { status: number; body: Record<string, unknown> | null }

function makeOrder(id: string, address: string, paymentStatus: string | null = 'pending'): OrderInfo {
  return {
    id,
    status: 'received',
    fulfillmentType: 'delivery',
    items: [{ name: 'Gnocchi', qty: 2, price: 7.25 }],
    subtotal: 14.5,
    deliveryFee: 2.5,
    total: 17,
    paymentStatus,
    deliveryAddress: address,
    restaurant: { id: 'r1', name: 'Gnocchi Bar' },
  }
}
const ORDER_A = makeOrder(ORDER_A_ID, '12 rue de A, Paris')
const ORDER_A2 = makeOrder(ORDER_A2_ID, '12 rue de A, Paris')
const ORDER_B = makeOrder(ORDER_B_ID, '34 rue de B, Lyon')

const PAY_A: PayInit = { clientSecret: 'pi_A_secret_AAAA', publishableKey: 'pk_test_x', amount: 1700, currency: 'eur' }
const PAY_B: PayInit = { clientSecret: 'pi_B_secret_BBBB', publishableKey: 'pk_test_x', amount: 1700, currency: 'eur' }

interface Scoped { stamp: string | null; order: OrderInfo | null; payInit: PayInit | null; stage: Stage }
const EMPTY: Scoped = { stamp: null, order: null, payInit: null, stage: 'loading' }

/**
 * MODELLED: the page's load effect, its render-time gate, the « Payer » click handler and
 * the onPaid closure handed to the Stripe components — with React's rules that (1) a render
 * happens with the NEW session/route before any effect runs, (2) an effect's cleanup runs
 * before its next run. The IDENTITY decision is the real exported `sessionCartStamp`.
 * Everything the model asserts about the page's shape is pinned separately on the source.
 */
function mountCheckout() {
  let liveStatus: Status = 'loading'
  let liveUserId: string | undefined
  let liveOrderId = ORDER_A_ID
  let reloadTick = 0
  let scoped: Scoped = EMPTY
  let error = ''
  let starting = false
  let redirected: string | null = null
  let redirectCount = 0
  let lastKey: string | undefined
  let cleanup: (() => void) | null = null
  let scopeGen = 0
  const orderReqs: Array<{ owner: string; userId: string; orderId: string; alive: () => boolean }> = []
  const payReqs: Array<{ owner: string | null; orderId: string; gen: number }> = []

  const identity = () => sessionCartStamp(liveStatus, liveUserId)
  const checkoutStamp = () => {
    const s = identity()
    return s !== null && liveOrderId.length > 0 ? JSON.stringify([s, liveOrderId]) : null
  }

  // ── what one render would show (computed BEFORE effects) ──────────────────
  function render() {
    const stamp = checkoutStamp()
    const inScope = scoped.stamp !== null && scoped.stamp === stamp
    const order = inScope ? scoped.order : null
    const payInit = inScope ? scoped.payInit : null
    const identityUnusable = liveStatus === 'authenticated' && !liveUserId
    const stage: Stage = inScope ? scoped.stage : (identityUnusable ? 'error' : 'loading')
    const stripeMounted = stage === 'pay' && payInit !== null
    return {
      order, payInit, stage, stripeMounted,
      clientSecret: stripeMounted ? payInit!.clientSecret : null,
      errorText: inScope ? error : '',
      stampAtRender: stamp,
    }
  }

  // ── the load effect (runs after a render when its deps changed) ───────────
  function commit() {
    const key = `${liveStatus}|${liveUserId ?? '?'}|${liveOrderId}|${reloadTick}`
    if (lastKey === key) return
    lastKey = key
    if (cleanup) { cleanup(); cleanup = null }
    scopeGen += 1
    // FAIL CLOSED FIRST — the previous scope leaves the screen BEFORE any request.
    scoped = EMPTY
    error = ''
    if (liveStatus === 'loading') return
    if (liveStatus === 'unauthenticated') { redirected = '/eat/auth'; redirectCount += 1; return }
    if (!liveUserId) return
    const requestOwner = checkoutStamp()
    const requestUserId = liveUserId
    const requestOrderId = liveOrderId
    if (requestOwner === null) return
    let alive = true
    orderReqs.push({ owner: requestOwner, userId: requestUserId, orderId: requestOrderId, alive: () => alive })
    cleanup = () => { alive = false }
  }

  const failClosed = (req: { owner: string; alive: () => boolean }) => {
    if (req.alive()) scoped = { stamp: req.owner, order: null, payInit: null, stage: 'error' }
  }
  /** The page's scope-bound `setStage`: a closure created in a render carries THAT render's
   *  checkoutStamp and only touches a record still stamped with it. */
  const setStageFrom = (stampAtRender: string | null, next: Stage) => {
    if (scoped.stamp !== null && scoped.stamp === stampAtRender) scoped = { ...scoped, stage: next }
  }

  return {
    signIn(status: Status, userId?: string) { liveStatus = status; liveUserId = userId; commit() },
    switchOrder(id: string) { liveOrderId = id; commit() },
    /** The first React render of a new route, BEFORE useEffect cleanup / reset. */
    previewRouteChange(id: string) { liveOrderId = id },
    retry() { reloadTick += 1; commit() },

    answerOrder(index: number, body: OrderBody | null, ...serverOwnerIdOverride: unknown[]) {
      const req = orderReqs[index]
      if (!req) throw new Error('no order request at index ' + index)
      if (!req.alive()) return
      const serverOwnerId: unknown = serverOwnerIdOverride.length > 0 ? serverOwnerIdOverride[0] : req.userId
      if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) { failClosed(req); return }
      if (!body?.order || body.order.id !== req.orderId) { failClosed(req); return }
      scoped = {
        stamp: req.owner, order: body.order, payInit: null,
        stage: body.order.paymentStatus === 'paid' ? 'already-paid' : 'review',
      }
    },
    /** 401 / 403 / 404 / network failure — fail closed, no redirect. */
    denyOrder(index: number) {
      const req = orderReqs[index]
      if (!req) throw new Error('no order request at index ' + index)
      failClosed(req)
    },

    /** « Payer » — only ever issued off the GATED order, binding the current generation. */
    clickPay() {
      const v = render()
      if (!v.order || starting) return
      starting = true
      error = ''
      payReqs.push({ owner: checkoutStamp(), orderId: v.order.id, gen: scopeGen })
    },
    answerPay(index: number, answer: PayAnswer) {
      const req = payReqs[index]
      if (!req) throw new Error('no pay request at index ' + index)
      starting = false
      if (scopeGen !== req.gen) return                       // identity / route / retry moved
      const body = answer.body
      if (answer.status === 409) {
        if (body?.code === 'payment_method_mismatch') { error = String(body.error ?? 'errPayInit'); return }
        setStageFrom(req.owner, 'already-paid'); return
      }
      if (answer.status < 200 || answer.status >= 300 || !body?.clientSecret || !body?.publishableKey) {
        error = String(body?.error ?? 'errPayInit'); return
      }
      const init: PayInit = {
        clientSecret: String(body.clientSecret), publishableKey: String(body.publishableKey),
        amount: Number(body.amount), currency: String(body.currency),
      }
      if (scoped.stamp !== null && scoped.stamp === req.owner) scoped = { ...scoped, payInit: init, stage: 'pay' }
    },
    /** The `onPaid` closure the Stripe Elements hold: captured in the render that mounted them. */
    captureOnPaid() {
      const v = render()
      if (!v.stripeMounted) return null
      const stampAtRender = v.stampAtRender
      return { fire: () => setStageFrom(stampAtRender, 'paid') }
    },

    get redirected() { return redirected },
    get redirectCount() { return redirectCount },
    get pendingOrder() { return orderReqs.length },
    get pendingPay() { return payReqs.length },
    get rawStamp() { return scoped.stamp },
    get rawPayInit() { return scoped.payInit },
    get view() { return render() },
  }
}

// ══ the identity is the repository's own ════════════════════════════════════

describe('the identity is the repository\'s own', () => {
  it('sessionCartStamp is CALLED, and the page imports it rather than inventing a definition', () => {
    expect(sessionCartStamp('authenticated', A)).toBe(OWN_A)
    expect(sessionCartStamp('unauthenticated', null)).toBe('guest')
    expect(sessionCartStamp('loading', A)).toBeNull()
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()
    const src = executable(read(PAGE))
    expect(src, 'the page imports the shared stamp').toMatch(
      /import \{[^}]*sessionCartStamp[^}]*\} from '@\/lib\/eat-cart'/,
    )
  })

  it('the address stamp the page already used agrees with the cart stamp on every input (one identity, two names)', () => {
    for (const status of ['loading', 'authenticated', 'unauthenticated', 'weird']) {
      for (const id of [undefined, null, '', A, B]) {
        expect(sessionAddressStamp(status, id), `${status}/${String(id)}`).toBe(sessionCartStamp(status, id))
      }
    }
  })
})

// ══ A–H : the mandated matrix ═══════════════════════════════════════════════

describe('A–H — recap, stage and PaymentIntent never cross an account boundary', () => {
  let p: ReturnType<typeof mountCheckout>
  beforeEach(() => { p = mountCheckout() })

  it('A — A loaded, B signs in BEFORE A answers: B sees nothing of A', () => {
    p.signIn('authenticated', A)
    expect(p.pendingOrder).toBe(1)
    p.signIn('authenticated', B)                  // switch while A's GET is in flight
    p.answerOrder(0, { order: ORDER_A })          // honest late answer for A
    expect(p.view.order, 'A\'s recap must not reach B').toBeNull()
    expect(p.view.stage, 'B waits on its own load').toBe('loading')
    expect(p.rawStamp, 'state carries no leftover stamp').toBeNull()
  })

  it('B — A loaded, then B loaded: each sees only its own', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    expect(p.view.stage).toBe('review')
    expect(p.view.order?.deliveryAddress).toContain('rue de A')
    p.signIn('authenticated', B)
    expect(p.view.order, 'A\'s recap is dropped the moment the identity moves').toBeNull()
    expect(p.view.stage).toBe('loading')
    p.denyOrder(1)                                // B does not own A's order → server 404
    expect(p.view.stage, 'neutral error, nothing of A').toBe('error')
    expect(p.view.order).toBeNull()
    p.switchOrder(ORDER_B_ID)                     // B opens its own order
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.order?.id).toBe(ORDER_B_ID)
    expect(p.view.order?.deliveryAddress).toContain('rue de B')
  })

  it('C — A at the PAY stage (Stripe Elements mounted on A\'s PaymentIntent): the FIRST render under B unmounts them', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    p.clickPay()
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stage).toBe('pay')
    expect(p.view.stripeMounted).toBe(true)
    expect(p.view.clientSecret).toBe(PAY_A.clientSecret)
    p.signIn('authenticated', B)
    expect(p.view.stripeMounted, 'no Stripe Elements under B').toBe(false)
    expect(p.view.clientSecret, 'A\'s clientSecret is unreachable from B\'s render').toBeNull()
    expect(p.view.payInit).toBeNull()
    expect(p.view.stage, 'the stale pay stage is not shown').toBe('loading')
    expect(p.rawPayInit, 'the fail-closed reset also purged the secret from state').toBeNull()
    p.denyOrder(1)                                // B does not own A's order → server 404
    expect(p.view.stage, 'B gets a neutral error, never A\'s pay stage').toBe('error')
    expect(p.view.payInit).toBeNull()
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.stage, 'B\'s own order lands on review — a fresh « Payer » is required').toBe('review')
    expect(p.view.payInit).toBeNull()
  })

  it('D — a LATE order response for A, after B has already loaded, changes nothing', () => {
    p.signIn('authenticated', A)
    p.signIn('authenticated', B)
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.order?.id).toBe(ORDER_B_ID)
    p.answerOrder(0, { order: ORDER_A })          // late, correctly-attributed response for A
    p.answerOrder(1, { order: ORDER_A })          // late answer to B's superseded request on A's route
    expect(p.view.order?.id, 'B keeps its own, A was superseded').toBe(ORDER_B_ID)
  })

  it('E — access denied (401/403/404) on A\'s stale load after A → B: no state and no redirect', () => {
    p.signIn('authenticated', A)
    p.signIn('authenticated', B)
    p.denyOrder(0)
    expect(p.view.order).toBeNull()
    expect(p.view.stage).toBe('loading')
    expect(p.redirected, 'a stale A response must not trampoline B through /eat/auth').toBeNull()
  })

  it('E bis — access denied for the LIVE identity fails closed to a neutral error, still no redirect', () => {
    p.signIn('authenticated', B)
    p.denyOrder(0)
    expect(p.view.stage).toBe('error')
    expect(p.view.order).toBeNull()
    expect(p.redirected).toBeNull()
  })

  it('F — logout to unauthenticated: nothing shown, redirect to /eat/auth once, no new GET', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    p.signIn('unauthenticated')
    expect(p.view.order, 'A\'s recap gone from the signed-out page').toBeNull()
    expect(p.view.stage).toBe('loading')
    expect(p.redirected).toBe('/eat/auth')
    expect(p.redirectCount).toBe(1)
    expect(p.pendingOrder, 'no GET /api/orders/[id] for a guest').toBe(1)
  })

  it('G — an UNRESOLVED identity reads nothing and keeps the chrome neutral', () => {
    p.signIn('loading')
    expect(p.pendingOrder).toBe(0)
    expect(p.view.order).toBeNull()
    expect(p.view.stage).toBe('loading')
    expect(p.redirected).toBeNull()
    p.previewRouteChange(ORDER_B_ID)              // B's own order URL
    p.signIn('authenticated', B)
    p.answerOrder(0, { order: ORDER_B })
    expect(p.view.order?.id).toBe(ORDER_B_ID)
  })

  it('G bis — authenticated with no resolvable id: no request, fail closed VISIBLY (error, not a stale recap)', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    p.signIn('authenticated', undefined)
    expect(p.pendingOrder, 'A\'s only; no request for the unnameable identity').toBe(1)
    expect(p.view.order).toBeNull()
    expect(p.view.stage).toBe('error')
    expect(p.redirected).toBeNull()
  })

  it('H — A → B → A: a fresh read is required for A, nothing (order OR secret) is reused from memory', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    p.clickPay()
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.clientSecret).toBe(PAY_A.clientSecret)
    p.signIn('authenticated', B)
    p.denyOrder(1)                                // B does not own A's order
    expect(p.view.stage).toBe('error')
    p.signIn('authenticated', A)
    expect(p.view.order, 'A\'s old recap is NOT reused').toBeNull()
    expect(p.view.stripeMounted, 'A\'s old PaymentIntent is NOT reused').toBe(false)
    expect(p.view.stage).toBe('loading')
    p.answerOrder(2, { order: ORDER_A })
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    expect(p.view.stage, 'back to review — the pay stage needs a fresh « Payer »').toBe('review')
  })
})

// ══ the GET half of the TOCTOU: server-authenticated identity + route binding ═

describe('a GET response is adopted only under the identity the SERVER authenticated and the route\'s order', () => {
  let p: ReturnType<typeof mountCheckout>
  beforeEach(() => { p = mountCheckout() })

  it('1 — the client believes A, the server authenticated B: the order is NOT adopted', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_B }, B)
    expect(p.view.order, 'B\'s recap never appears on A\'s screen').toBeNull()
    expect(p.view.stage, 'a mismatch is a FAILED load').toBe('error')
  })

  it('2 — client believes A, server echoes A: adopted, unchanged', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A }, A)
    expect(p.view.order?.id).toBe(ORDER_A_ID)
    expect(p.view.stage).toBe('review')
  })

  it('2 bis — a paid order lands on already-paid (legit flow preserved)', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: makeOrder(ORDER_A_ID, 'x', 'paid') }, A)
    expect(p.view.stage).toBe('already-paid')
  })

  it('3 — a response that names NOBODY (or a wrong primitive) is refused', () => {
    for (const bad of [undefined, null, '', 0, false, {}, [], OWN_A]) {
      const q = mountCheckout()
      q.signIn('authenticated', A)
      q.answerOrder(0, { order: ORDER_A }, bad)
      expect(q.view.order, `ownerId=${JSON.stringify(bad)}`).toBeNull()
      expect(q.view.stage, `ownerId=${JSON.stringify(bad)}`).toBe('error')
    }
  })

  it('3 bis — a body whose order.id is not the route\'s orderId is refused even with the right owner', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A2 }, A)      // A's OTHER order served under this route
    expect(p.view.order).toBeNull()
    expect(p.view.stage).toBe('error')
    const q = mountCheckout()
    q.signIn('authenticated', A)
    q.answerOrder(0, { ownerId: A }, A)           // no order at all
    expect(q.view.order).toBeNull()
  })

  it('4 — A → B, then A\'s own correctly-attributed response arrives late: still refused by alive', () => {
    p.signIn('authenticated', A)
    p.signIn('authenticated', B)
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B }, B)
    p.answerOrder(0, { order: ORDER_A }, A)
    expect(p.view.order?.id, 'B keeps its own').toBe(ORDER_B_ID)
  })

  it('4 bis — the two guards are independent: neither alone would be enough', () => {
    const q = mountCheckout()
    q.signIn('authenticated', A)
    q.signIn('authenticated', B)
    q.answerOrder(0, { order: ORDER_A }, A)       // superseded but correctly attributed → only `alive`
    expect(q.view.order).toBeNull()
    const r = mountCheckout()
    r.signIn('authenticated', A)
    r.answerOrder(0, { order: ORDER_B }, B)       // live but wrongly attributed → only the ownerId check
    expect(r.view.order).toBeNull()
  })

  it('guest and unresolved still issue NO GET at all', () => {
    const g = mountCheckout()
    g.signIn('unauthenticated')
    expect(g.pendingOrder).toBe(0)
    const u = mountCheckout()
    u.signIn('loading')
    expect(u.pendingOrder).toBe(0)
  })
})

// ══ the Stripe lifecycle: POST /pay, the mounted Elements, onPaid ═══════════

describe('the PaymentIntent is bound to the scope that asked for it', () => {
  let p: ReturnType<typeof mountCheckout>
  beforeEach(() => {
    p = mountCheckout()
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
  })

  it('P1 — legit: A clicks « Payer », /pay answers, Stripe mounts on A\'s secret', () => {
    p.clickPay()
    expect(p.pendingPay).toBe(1)
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stage).toBe('pay')
    expect(p.view.clientSecret).toBe(PAY_A.clientSecret)
  })

  it('P2 — A clicks « Payer », B signs in BEFORE /pay answers: the secret is NEVER adopted (before AND after B loads)', () => {
    p.clickPay()
    p.signIn('authenticated', B)
    p.answerPay(0, { status: 200, body: { ...PAY_A } })   // A's PaymentIntent arrives under B
    expect(p.view.stripeMounted).toBe(false)
    expect(p.rawPayInit, 'the secret never even enters state').toBeNull()
    p.denyOrder(1)                                // B does not own A's order
    expect(p.view.stage).toBe('error')
    expect(p.view.payInit).toBeNull()
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.stage).toBe('review')
    expect(p.view.payInit).toBeNull()
  })

  it('P2 bis — same, but /pay answers AFTER B\'s order has loaded: B\'s review is not flipped to A\'s pay stage', () => {
    p.clickPay()
    p.signIn('authenticated', B)
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B })
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stage).toBe('review')
    expect(p.view.clientSecret).toBeNull()
    expect(p.rawPayInit).toBeNull()
  })

  it('P3 — A → B → A: a /pay answer from A\'s FIRST generation is stale and discarded; A must tap « Payer » again', () => {
    p.clickPay()
    p.signIn('authenticated', B)
    p.signIn('authenticated', A)
    p.answerOrder(2, { order: ORDER_A })
    expect(p.view.stage).toBe('review')
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stage, 'a secret minted in a previous generation is not reused').toBe('review')
    expect(p.rawPayInit).toBeNull()
    p.clickPay()
    p.answerPay(1, { status: 200, body: { ...PAY_A } })
    expect(p.view.clientSecret).toBe(PAY_A.clientSecret)
  })

  it('P4 — the onPaid closure captured under A fires after A → B (B on review): no false « Commande confirmée » for B', () => {
    p.clickPay()
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    const onPaid = p.captureOnPaid()
    expect(onPaid).not.toBeNull()
    p.signIn('authenticated', B)
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.stage).toBe('review')
    onPaid!.fire()                                 // Stripe resolves A's confirmation late
    expect(p.view.stage, 'B\'s unpaid order is not shown as paid').toBe('review')
  })

  it('P4 bis — onPaid fires after A → B while B is still loading: B\'s record is not stamped paid', () => {
    p.clickPay()
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    const onPaid = p.captureOnPaid()!
    p.signIn('authenticated', B)
    onPaid.fire()
    expect(p.view.stage).toBe('loading')
    p.switchOrder(ORDER_B_ID)
    p.answerOrder(2, { order: ORDER_B })
    expect(p.view.stage).toBe('review')
  })

  it('P5 — legit: onPaid under A moves A to paid', () => {
    p.clickPay()
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    const onPaid = p.captureOnPaid()!
    onPaid.fire()
    expect(p.view.stage).toBe('paid')
    expect(p.view.order?.id).toBe(ORDER_A_ID)
  })

  it('P6 — 409 variants under the SAME identity keep their meaning; after a switch they say nothing', () => {
    p.clickPay()
    p.answerPay(0, { status: 409, body: { code: 'payment_method_mismatch', error: 'Mode de paiement incompatible' } })
    expect(p.view.stage).toBe('review')
    expect(p.view.errorText).toBe('Mode de paiement incompatible')
    p.clickPay()
    p.answerPay(1, { status: 409, body: { error: 'Commande déjà payée.' } })
    expect(p.view.stage).toBe('already-paid')

    const q = mountCheckout()
    q.signIn('authenticated', A)
    q.answerOrder(0, { order: ORDER_A })
    q.clickPay()
    q.signIn('authenticated', B)
    q.switchOrder(ORDER_B_ID)
    q.answerOrder(2, { order: ORDER_B })
    q.answerPay(0, { status: 409, body: { code: 'payment_method_mismatch', error: 'Mode de paiement incompatible' } })
    expect(q.view.errorText, 'A\'s pay error must not be painted in B\'s review').toBe('')
    expect(q.view.stage).toBe('review')
    q.clickPay()
    q.signIn('authenticated', A)
    q.switchOrder(ORDER_A_ID)
    q.answerOrder(4, { order: ORDER_A })
    q.answerPay(1, { status: 409, body: { error: 'Commande déjà payée.' } })
    expect(q.view.stage, 'B\'s 409 cannot mark A\'s order as already paid').toBe('review')
  })

  it('P7 — « Payer » is refused off a gated (out-of-scope) order: no POST /pay is issued under a moved identity', () => {
    p.signIn('authenticated', B)                   // B's load pending → order gated null
    p.clickPay()
    expect(p.pendingPay, 'no /pay without an in-scope order').toBe(0)
    p.signIn('loading')
    p.clickPay()
    expect(p.pendingPay).toBe(0)
  })
})

// ══ route change, retry, cancellation ═══════════════════════════════════════

describe('route change, retry and cancellation', () => {
  let p: ReturnType<typeof mountCheckout>
  beforeEach(() => { p = mountCheckout() })

  it('switching orderId blanks the FIRST render (recap + Elements), before cleanup, then re-fires', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    p.clickPay()
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stripeMounted).toBe(true)
    p.previewRouteChange(ORDER_A2_ID)
    expect(p.view.order, 'old recap vanishes on the first new-route render').toBeNull()
    expect(p.view.stripeMounted, 'old PaymentIntent vanishes on the first new-route render').toBe(false)
    expect(p.view.stage).toBe('loading')
    p.switchOrder(ORDER_A2_ID)
    expect(p.rawPayInit).toBeNull()
    p.answerOrder(1, { order: ORDER_A2 })
    expect(p.view.order?.id).toBe(ORDER_A2_ID)
    expect(p.view.stage).toBe('review')
  })

  it('a /pay answer for the PREVIOUS route is discarded after an orderId switch', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    p.clickPay()
    p.switchOrder(ORDER_A2_ID)
    p.answerOrder(1, { order: ORDER_A2 })
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stage).toBe('review')
    expect(p.rawPayInit).toBeNull()
  })

  it('retry after a failed load issues a NEW request under the same scope and disowns the old one', () => {
    p.signIn('authenticated', A)
    p.denyOrder(0)
    expect(p.view.stage).toBe('error')
    p.retry()
    expect(p.view.stage, 'retry fails closed first').toBe('loading')
    expect(p.pendingOrder).toBe(2)
    p.answerOrder(0, { order: ORDER_A })           // the OLD request answers late
    expect(p.view.order, 'disowned by cleanup').toBeNull()
    p.answerOrder(1, { order: ORDER_A })
    expect(p.view.order?.id).toBe(ORDER_A_ID)
  })

  it('retry does not resurrect a secret from before the retry', () => {
    p.signIn('authenticated', A)
    p.answerOrder(0, { order: ORDER_A })
    p.clickPay()
    p.retry()
    p.answerOrder(1, { order: ORDER_A })
    p.answerPay(0, { status: 200, body: { ...PAY_A } })
    expect(p.view.stage).toBe('review')
    expect(p.rawPayInit).toBeNull()
  })

  it('the identity moving mid-flight and back again never lets the OTHER order\'s secret through', () => {
    p.previewRouteChange(ORDER_B_ID)
    p.signIn('authenticated', B)
    p.answerOrder(0, { order: ORDER_B })
    p.clickPay()
    p.signIn('authenticated', A)
    p.switchOrder(ORDER_A_ID)
    p.answerOrder(2, { order: ORDER_A })
    p.answerPay(0, { status: 200, body: { ...PAY_B } })
    expect(p.view.clientSecret).toBeNull()
    expect(p.rawPayInit).toBeNull()
  })
})

// ══ the real checkout page ══════════════════════════════════════════════════

describe('the checkout page really implements this', () => {
  const raw = read(PAGE)
  const src = executable(raw)

  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(src).toContain('useState')
    expect(raw).toContain('// ')
    expect(raw).toContain('// RENDER-TIME GATE')
    expect(src).not.toContain('// RENDER-TIME GATE')
  })

  it('identity + route stamp are derived in render, from the shared primitive', () => {
    expect(src).toMatch(/const userId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    expect(src).toMatch(/const identityStamp = sessionCartStamp\(status, userId\)/)
    expect(src).toMatch(/const checkoutStamp = identityStamp !== null && orderId\.length > 0\s*\n?\s*\? JSON\.stringify\(\[identityStamp, orderId\]\) : null/)
    // the address selector keeps its own (pinned elsewhere) stamp line — same identity rule
    expect(src).toMatch(/const sessionStamp = sessionAddressStamp\(status, userId\)/)
  })

  it('ONE stamped record holds order + payInit + stage; no plain account-sensitive state remains', () => {
    expect(src).toMatch(/interface ScopedState \{[\s\S]*?stamp:\s*string \| null[\s\S]*?order:\s*OrderInfo \| null[\s\S]*?payInit:\s*PayInit \| null[\s\S]*?stage:\s*Stage[\s\S]*?\}/)
    expect(src).toMatch(/const EMPTY_SCOPE: ScopedState = \{ stamp: null, order: null, payInit: null, stage: 'loading' \}/)
    expect(src).toMatch(/const \[scoped, setScoped\] = useState<ScopedState>\(EMPTY_SCOPE\)/)
    expect(src, 'no bare order state').not.toMatch(/useState<OrderInfo \| null>/)
    expect(src, 'no bare payInit state').not.toMatch(/useState<PayInit \| null>/)
    expect(src, 'no bare stage state').not.toMatch(/useState<Stage>/)
    expect(src, 'no bare setters').not.toMatch(/\bsetOrder\(|\bsetPayInit\(/)
  })

  it('the load effect is keyed on identity + orderId + retry tick, not merely orderId', () => {
    expect(raw, 'the anchored dep array').toMatch(/\/\* checkout-deps \*\/\s*\[status, userId, orderId, reloadTick\]\)/)
    expect(src.match(/\}, \[orderId, loadOrder\]\)/g) ?? [], 'the old effect is gone').toHaveLength(0)
    expect(src, 'no useCallback-wrapped loader keyed on the router').not.toMatch(/\[orderId, router, t\]/)
    expect(src).not.toMatch(/\bloadOrder\b/)
  })

  it('the effect FAIL-CLOSES before any request and captures requestOwner + requestUserId + requestOrderId', () => {
    expect(src).toMatch(/setScoped\(EMPTY_SCOPE\)\s*\n\s*setError\(''\)[\s\S]*?fetch\(`\/api\/orders\/\$\{requestOrderId\}`, \{ cache: 'no-store' \}\)/)
    expect(src).toMatch(/if \(status === 'loading'\) return/)
    expect(src).toMatch(/if \(status === 'unauthenticated'\) \{ router\.push\('\/eat\/auth'\); return \}/)
    expect(src).toMatch(/if \(!userId\) return/)
    expect(src).toMatch(/const requestOwner = checkoutStamp\s*\n\s*const requestUserId = userId\s*\n\s*const requestOrderId = orderId\s*\n\s*if \(requestOwner === null\) return/)
    expect(src).toMatch(/let alive = true/)
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)
    // every write from the effect is under the request's stamp or guarded by alive
    expect(src).toMatch(/const failClosed = \(\) => \{\s*if \(alive\) setScoped\(\{ stamp: requestOwner, order: null, payInit: null, stage: 'error' \}\)\s*\}/)
    expect(src).toMatch(/if \(!alive\) return\s*\n\s*if \(!r\.ok\) \{ failClosed\(\); return \}/)
  })

  it('a response that does not name the requested raw id, or another order, is refused', () => {
    expect(src).toMatch(
      /\(await r\.json\(\)\) as \{ ownerId\?: unknown; order\?: OrderInfo \}\s*\n\s*if \(!alive\) return\s*\n\s*if \(typeof body\?\.ownerId !== 'string' \|\| body\.ownerId !== requestUserId\) \{ failClosed\(\); return \}\s*\n\s*if \(!body\.order \|\| body\.order\.id !== requestOrderId\) \{ failClosed\(\); return \}/,
    )
    expect(src).toMatch(/setScoped\(\{\s*stamp:\s*requestOwner,\s*order:\s*body\.order,\s*payInit:\s*null,\s*stage:\s*body\.order\.paymentStatus === 'paid' \? 'already-paid' : 'review',?\s*\}\)/)
  })

  it('401/403/404 fail CLOSED without a redirect from any response handler', () => {
    expect(src).not.toMatch(/r\.status === 401/)
    expect(src).not.toMatch(/res\.status === 401/)
    const authRedirects = src.match(/router\.push\('\/eat\/auth'\)/g) ?? []
    expect(authRedirects.length, 'the live-session redirect is the only one').toBe(1)
  })

  it('the RENDER-TIME GATE blanks order, payInit, stage and error text on a stamp mismatch', () => {
    expect(src).toMatch(/const inScope = scoped\.stamp !== null && scoped\.stamp === checkoutStamp/)
    expect(src).toMatch(/const order\s*=\s*inScope \? scoped\.order : null/)
    expect(src).toMatch(/const payInit\s*=\s*inScope \? scoped\.payInit : null/)
    expect(src).toMatch(/const identityUnusable = status === 'authenticated' && !userId/)
    expect(src).toMatch(/const stage: Stage\s*=\s*inScope \? scoped\.stage : \(identityUnusable \? 'error' : 'loading'\)/)
    expect(src).toMatch(/const errorText = inScope \? error : ''/)
    // the gate is computed BEFORE the click handler and BEFORE the JSX that mounts Stripe
    expect(src.indexOf('const inScope = ')).toBeLessThan(src.indexOf('async function startPayment'))
    expect(src.indexOf('const inScope = ')).toBeLessThan(src.indexOf('<StripeTicketPayment'))
  })

  it('Stripe Elements mount ONLY off the gated payInit, and the raw record never reaches them', () => {
    expect(src).toMatch(/\{stage === 'pay' && payInit && \(/)
    expect(src).not.toMatch(/scoped\.payInit\.clientSecret/)
    expect(src).not.toMatch(/scoped\.payInit\?\.clientSecret/)
    expect((src.match(/clientSecret=\{payInit\.clientSecret\}/g) ?? []).length).toBe(2)
    expect((src.match(/amount=\{payInit\.amount\}/g) ?? []).length, 'existing wallet contract').toBe(2)
    expect((src.match(/onPaid=\{\(\) => setStage\('paid'\)\}/g) ?? []).length, 'existing wallet contract').toBe(2)
    // the error text shown in review / error panels is the gated one
    expect(src).not.toMatch(/\{error && stage === 'review'/)
    expect(src).toMatch(/\{errorText && stage === 'review'/)
    expect(src).toMatch(/\{errorText \|\| t\('errLoad'\)\}/)
  })

  it('setStage is scope-bound: a closure created in a render can only touch a record still carrying that render\'s stamp', () => {
    expect(src).toMatch(/const setStage = \(next: Stage\) =>\s*\n?\s*setScoped\(\(cur\) => \(cur\.stamp !== null && cur\.stamp === checkoutStamp \? \{ \.\.\.cur, stage: next \} : cur\)\)/)
    // the confirm-email effect reads the GATED stage (derived), not the raw record
    expect(src).toMatch(/if \(stage !== 'paid' \|\| confirmFiredRef\.current \|\| !orderId\) return/)
  })

  it('POST /pay is bound to the scope generation captured at click time, adopted only into a same-stamp record', () => {
    expect(src).toMatch(/const scopeGenRef = useRef\(0\)/)
    expect(src).toMatch(/useEffect\(\(\) => \{\s*\n\s*scopeGenRef\.current \+= 1\s*\n\s*setScoped\(EMPTY_SCOPE\)/)
    expect(src).toMatch(/async function startPayment\(\) \{\s*\n\s*if \(!order \|\| starting\) return\s*\n\s*const requestOwner = checkoutStamp\s*\n\s*const requestGen = scopeGenRef\.current/)
    expect(src).toMatch(/const body = await r\.json\(\)\.catch\(\(\) => null\)\s*\n\s*if \(scopeGenRef\.current !== requestGen\) return/)
    expect(src).toMatch(/setScoped\(\(cur\) => \(cur\.stamp !== null && cur\.stamp === requestOwner \? \{ \.\.\.cur, payInit: init, stage: 'pay' \} : cur\)\)/)
    expect(src).toMatch(/\} catch \{\s*\n\s*if \(scopeGenRef\.current === requestGen\) setError\(t\('errPayInit'\)\)/)
    // the existing P0-29 contract (mismatch vs already-paid) is intact inside the guarded block
    expect(src).toMatch(/payment_method_mismatch'\)\s*\{\s*setError\(\(body\?\.error as string\) \|\| t\('errPayInit'\)\)\s*return\s*\}/)
    expect(src.indexOf('if (scopeGenRef.current !== requestGen) return')).toBeLessThan(src.indexOf('payment_method_mismatch'))
  })

  it('retry re-arms the effect through a tick (never a captured loader)', () => {
    expect(src).toMatch(/const \[reloadTick, setReloadTick\] = useState\(0\)/)
    expect(src).toMatch(/onClick=\{\(\) => setReloadTick\(\(n\) => n \+ 1\)\}/)
  })

  it('the address selector discipline (pinned in the addresses lot) is untouched', () => {
    expect(src).toMatch(/const visibleAddrs = addrStamp !== null && addrStamp === sessionStamp \? addresses : \[\]/)
    expect(src).toMatch(/const selAddr = visibleAddrs\.find/)
    expect(src).toContain('window.addEventListener(ADDRESS_EVENT, sync)')
  })
})

// ══ mutation battery — the pins above cannot pass on a regressed page ════════

describe('NEGATIVE CONTROLS — each regression below would be caught by a pin above', () => {
  const src = executable(read(PAGE))
  const mutate = (from: string | RegExp, to: string) => {
    const out = src.replace(from, to)
    expect(out, `mutation must hit: ${String(from)}`).not.toBe(src)
    return out
  }

  it('dropping identity from the dep array', () => {
    const raw = read(PAGE)
    const m = raw.replace('/* checkout-deps */ [status, userId, orderId, reloadTick])', '/* checkout-deps */ [orderId, reloadTick])')
    expect(m).not.toBe(raw)
    expect(m).not.toMatch(/\/\* checkout-deps \*\/\s*\[status, userId, orderId, reloadTick\]\)/)
  })

  it('un-gating payInit (Stripe would inherit the previous account\'s secret)', () => {
    const m = mutate(/const payInit\s*=\s*inScope \? scoped\.payInit : null/, 'const payInit = scoped.payInit')
    expect(m).not.toMatch(/const payInit\s*=\s*inScope \? scoped\.payInit : null/)
  })

  it('un-gating the order', () => {
    const m = mutate(/const order\s*=\s*inScope \? scoped\.order : null/, 'const order = scoped.order')
    expect(m).not.toMatch(/const order\s*=\s*inScope \? scoped\.order : null/)
  })

  it('accepting a body with no ownerId (undefined === undefined)', () => {
    const m = mutate("typeof body?.ownerId !== 'string' || ", '')
    expect(m).not.toMatch(/if \(typeof body\?\.ownerId !== 'string' \|\| body\.ownerId !== requestUserId\) \{ failClosed\(\); return \}/)
  })

  it('dropping the order-id binding', () => {
    const m = mutate('if (!body.order || body.order.id !== requestOrderId) { failClosed(); return }', 'if (!body.order) { failClosed(); return }')
    expect(m).not.toMatch(/if \(!body\.order \|\| body\.order\.id !== requestOrderId\) \{ failClosed\(\); return \}/)
  })

  it('dropping the generation check on /pay', () => {
    const m = mutate('if (scopeGenRef.current !== requestGen) return', '')
    expect(m).not.toMatch(/const body = await r\.json\(\)\.catch\(\(\) => null\)\s*\n\s*if \(scopeGenRef\.current !== requestGen\) return/)
  })

  it('adopting the secret unconditionally', () => {
    const m = mutate(/setScoped\(\(cur\) => \(cur\.stamp !== null && cur\.stamp === requestOwner \? \{ \.\.\.cur, payInit: init, stage: 'pay' \} : cur\)\)/, "setScoped((cur) => ({ ...cur, payInit: init, stage: 'pay' }))")
    expect(m).not.toMatch(/cur\.stamp === requestOwner \? \{ \.\.\.cur, payInit: init, stage: 'pay' \}/)
  })

  it('an unbound setStage (onPaid could mark the next account\'s order paid)', () => {
    const m = mutate(/const setStage = \(next: Stage\) =>\s*\n?\s*setScoped\(\(cur\) => \(cur\.stamp !== null && cur\.stamp === checkoutStamp \? \{ \.\.\.cur, stage: next \} : cur\)\)/, 'const setStage = (next: Stage) => setScoped((cur) => ({ ...cur, stage: next }))')
    expect(m).not.toMatch(/cur\.stamp === checkoutStamp \? \{ \.\.\.cur, stage: next \}/)
  })

  it('a redirect from a response handler', () => {
    const m = mutate('if (!r.ok) { failClosed(); return }', "if (r.status === 401) { router.push('/eat/auth'); return }\n        if (!r.ok) { failClosed(); return }")
    expect((m.match(/router\.push\('\/eat\/auth'\)/g) ?? []).length).toBe(2)
    expect(m).toMatch(/r\.status === 401/)
  })

  it('a fetch issued before the fail-closed reset', () => {
    const m = mutate(/setScoped\(EMPTY_SCOPE\)\s*\n\s*setError\(''\)/, '')
    expect(m).not.toMatch(/setScoped\(EMPTY_SCOPE\)\s*\n\s*setError\(''\)[\s\S]*?fetch\(`\/api\/orders\/\$\{requestOrderId\}`/)
  })
})
