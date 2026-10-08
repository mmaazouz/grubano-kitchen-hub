import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionCartStamp } from '@/lib/eat-cart'

// ── EatShell — LOYALTY POINTS + ACTIVE-ORDER BADGE, CROSS-ACCOUNT (P1) ─────────
//
// WHAT IS WRONG IN `main`. components/eat/EatShell.tsx loads TWO account-scoped values on
// the SPA shell that wraps every /eat page:
//
//   fetch('/api/loyalty/wallet') → points balance (rail card + mobile pill)
//   fetch('/api/orders?take=50') → active-order count (badge on « Commandes »)
//
// Both are kept in PLAIN React state (`points`, `activeOrders`) and loaded in an effect
// keyed on `[status]`. `status` is the useSession status string ('authenticated' |
// 'unauthenticated' | 'loading'). On an A → logout → B switch inside the SAME mount the
// status trajectory is 'authenticated' → 'unauthenticated' → 'authenticated' and the effect
// re-fires only on each transition, NOT when the authenticated identity CHANGES from A to B
// via a cross-tab broadcast (NextAuth calls setSession without flipping to 'loading' or
// 'unauthenticated' in between — the id moves, `status` does not). A → B then re-renders
// the shell with B's session while `points` / `activeOrders` still hold A's values — the
// previous account's loyalty balance and badge are visible on B's screen.
//
// Three async failure modes stack on top of that, and NONE are closed by the current code:
//   1) The effect has NO cleanup, so a late GET /api/loyalty/wallet armed under A can land
//      and `setPoints(A_balance)` AFTER B has signed in — a race, not a timer.
//   2) The response carries no identity: the server reads `token.email` (loyalty) or
//      `token.sub` (orders) from the cookie, so a GET issued while the client still
//      believes A can be authenticated as B (the browser attaches the cookie at SEND time).
//      The client has NO way to tell « correct for the account at hand » from « correct for
//      the next account », because nothing in the body says whose it was.
//   3) On transition to unauthenticated the effect `return`s without resetting `points` or
//      `activeOrders` — the signed-out shell shows the previous account's balance/badge.
//
// HOW THIS IS PROVEN. The identity rule is the repository's own exported `sessionCartStamp`
// — called, not restated. The effect/response sequencing is modelled, because it is control
// flow inside the shell effect with no decision to export; the source pins at the bottom
// hold the real file to that shape, and the mutation battery is what makes the pins
// non-vacuous.

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
const SHELL = 'components/eat/EatShell.tsx'
const WALLET_ROUTE = 'app/api/loyalty/wallet/route.ts'
const ORDERS_ROUTE = 'app/api/orders/route.ts'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`

interface WalletResp { ownerId?: unknown; pointsBalance?: number }
interface OrdersResp { ownerId?: unknown; orders?: Array<{ status?: string }> }

const WALLET_A: WalletResp = { pointsBalance: 275 }
const WALLET_B: WalletResp = { pointsBalance: 42 }
const ORDERS_A: OrdersResp = { orders: [{ status: 'preparing' }, { status: 'picked_up' }, { status: 'delivered' }] }
const ORDERS_B: OrdersResp = { orders: [{ status: 'received' }] }

/**
 * MODELLED: the shell's effect sequencing and React's rule that an effect's cleanup runs
 * before the next run of that same effect. The IDENTITY decision is the real exported
 * `sessionCartStamp`. Everything the model asserts about the shell's shape is pinned
 * separately against the source.
 */
function mountShell() {
  let liveOwner: string | null = null
  let liveUserId: string | undefined
  // owner-stamped state — a value is only ever shown when its stamp matches the live owner.
  let points: { stamp: string | null; value: number } = { stamp: null, value: 0 }
  let activeOrders: { stamp: string | null; value: number } = { stamp: null, value: 0 }
  let lastRunOwner: string | null | undefined
  // the raw id captured beside the stamp — this is what the server MUST echo back
  const inFlightLoyalty: Array<{ owner: string; userId: string; alive: () => boolean }> = []
  const inFlightOrders: Array<{ owner: string; userId: string; alive: () => boolean }> = []
  let cleanup: (() => void) | null = null

  function runEffect(): void {
    if (lastRunOwner === liveOwner) return
    lastRunOwner = liveOwner
    if (cleanup) cleanup()
    // FAIL CLOSED FIRST — the previous account's values leave the screen before any request
    points = { stamp: null, value: 0 }
    activeOrders = { stamp: null, value: 0 }
    if (liveOwner === null) return                // unresolved — no network
    if (liveOwner === 'guest') return             // guest has no account to read
    if (liveUserId === undefined) return          // defence in depth: the stamp was null anyway
    const requestOwner = liveOwner
    const requestUserId = liveUserId
    let alive = true
    inFlightLoyalty.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    inFlightOrders.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    cleanup = () => { alive = false }
  }

  const flush = () => runEffect()

  function answerLoyalty(index: number, resp: WalletResp | null, ...serverOwnerIdOverride: unknown[]) {
    const req = inFlightLoyalty[index]
    if (!req) throw new Error('no loyalty request at index ' + index)
    if (!req.alive()) return
    const serverOwnerId: unknown = serverOwnerIdOverride.length > 0 ? serverOwnerIdOverride[0] : req.userId
    if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) return // mismatch → fail closed
    if (!resp) return
    const v = typeof resp.pointsBalance === 'number' ? resp.pointsBalance : 0
    points = { stamp: req.owner, value: v }
  }

  function answerOrders(index: number, resp: OrdersResp | null, ...serverOwnerIdOverride: unknown[]) {
    const req = inFlightOrders[index]
    if (!req) throw new Error('no orders request at index ' + index)
    if (!req.alive()) return
    const serverOwnerId: unknown = serverOwnerIdOverride.length > 0 ? serverOwnerIdOverride[0] : req.userId
    if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) return // mismatch → fail closed
    if (!resp) return
    const active = Array.isArray(resp.orders)
      ? resp.orders.filter((o) => ['received', 'preparing', 'ready', 'picked_up'].includes(o.status ?? '')).length
      : 0
    activeOrders = { stamp: req.owner, value: active }
  }

  return {
    /** A session change: React re-renders, then runs the effect if its deps moved. */
    signIn(owner: string | null, userId?: string) {
      liveOwner = owner
      liveUserId = userId
      flush()
    },
    answerLoyalty,
    answerOrders,
    get pendingLoyalty() { return inFlightLoyalty.length },
    get pendingOrders() { return inFlightOrders.length },
    get view() {
      // ownership verdict, re-evaluated at render time
      const pointsMine = points.stamp !== null && points.stamp === liveOwner
      const ordersMine = activeOrders.stamp !== null && activeOrders.stamp === liveOwner
      return {
        points: pointsMine ? points.value : null,
        pointsStamp: points.stamp,
        activeOrders: ordersMine ? activeOrders.value : 0,
        activeOrdersStamp: activeOrders.stamp,
      }
    },
  }
}

// ══ the identity, reused rather than redefined ══════════════════════════════

describe('the identity is the repository\'s own', () => {
  it('sessionCartStamp is CALLED, and this shell does not invent a third definition', () => {
    expect(sessionCartStamp('authenticated', A)).toBe(OWN_A)
    expect(sessionCartStamp('unauthenticated', null)).toBe('guest')
    expect(sessionCartStamp('loading', A)).toBeNull()
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()

    const src = executable(read(SHELL))
    expect(src, 'the shell imports the shared stamp').toMatch(
      /import \{[^}]*sessionCartStamp[^}]*\} from '@\/lib\/eat-cart'/,
    )
  })
})

// ══ A–H : the mandated matrix ═══════════════════════════════════════════════

describe('A–H — points and the active-order badge never cross an account boundary', () => {
  let p: ReturnType<typeof mountShell>
  beforeEach(() => { p = mountShell() })

  it('A — A loaded, then B signs in BEFORE A answers: B sees neither A\'s points nor A\'s badge', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)                            // switch happens while A's GETs are in flight
    p.answerLoyalty(0, WALLET_A)                  // …and A answers late
    p.answerOrders(0, ORDERS_A)
    expect(p.view.points, 'nothing of A is shown to B').toBeNull()
    expect(p.view.activeOrders).toBe(0)
    expect(p.view.pointsStamp, 'and the state carries no leftover stamp').toBeNull()
    expect(p.view.activeOrdersStamp).toBeNull()
  })

  it('B — A loaded, then B loaded: each sees only its own', () => {
    p.signIn(OWN_A, A)
    p.answerLoyalty(0, WALLET_A)
    p.answerOrders(0, ORDERS_A)
    expect(p.view.points).toBe(275)
    expect(p.view.activeOrders, '`received`/`preparing`/`ready`/`picked_up` count').toBe(2)

    p.signIn(OWN_B, B)
    expect(p.view.points, 'A\'s values are dropped the moment the identity moves').toBeNull()
    expect(p.view.activeOrders).toBe(0)
    p.answerLoyalty(1, WALLET_B)
    p.answerOrders(1, ORDERS_B)
    expect(p.view.points).toBe(42)
    expect(p.view.activeOrders).toBe(1)
  })

  it('D — a LATE response for A, after B has already loaded, changes nothing', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)
    p.answerLoyalty(1, WALLET_B)
    p.answerOrders(1, ORDERS_B)
    expect(p.view.points).toBe(42)
    expect(p.view.activeOrders).toBe(1)
    p.answerLoyalty(0, WALLET_A)                  // late, honest response for A
    p.answerOrders(0, ORDERS_A)
    expect(p.view.points, 'B keeps its own, A was superseded').toBe(42)
    expect(p.view.activeOrders).toBe(1)
  })

  it('F — logout to unauthenticated: no account values shown, no request issued', () => {
    p.signIn(OWN_A, A)
    p.answerLoyalty(0, WALLET_A)
    p.answerOrders(0, ORDERS_A)
    expect(p.view.points).toBe(275)
    p.signIn('guest')
    expect(p.view.points, 'A\'s points gone from the signed-out shell').toBeNull()
    expect(p.view.activeOrders, 'and the badge gone too').toBe(0)
    expect(p.pendingLoyalty, 'no new GET /api/loyalty/wallet for a guest').toBe(1)  // only A's
    expect(p.pendingOrders).toBe(1)
  })

  it('G — an UNRESOLVED identity reads nothing and keeps the chrome neutral', () => {
    p.signIn(null)                                // status 'loading'
    expect(p.pendingLoyalty).toBe(0)
    expect(p.pendingOrders).toBe(0)
    expect(p.view.points).toBeNull()
    expect(p.view.activeOrders).toBe(0)
    // …and coming back to a real identity works normally
    p.signIn(OWN_B, B)
    p.answerLoyalty(0, WALLET_B)
    p.answerOrders(0, ORDERS_B)
    expect(p.view.points).toBe(42)
    expect(p.view.activeOrders).toBe(1)
  })

  it('G bis — authenticated with no resolvable id: no request, no leftover stamp', () => {
    p.signIn(OWN_A, A)
    p.answerLoyalty(0, WALLET_A)
    p.answerOrders(0, ORDERS_A)
    // authenticated-but-unnameable: sessionCartStamp returns null → treat as unresolved
    p.signIn(null)
    expect(p.pendingLoyalty, 'A\'s only; no request for the unnameable identity').toBe(1)
    expect(p.view.points).toBeNull()
    expect(p.view.activeOrders).toBe(0)
  })

  it('H — A → B → A: a fresh read is required for A, nothing is reused from memory', () => {
    p.signIn(OWN_A, A)
    p.answerLoyalty(0, WALLET_A)
    p.answerOrders(0, ORDERS_A)
    p.signIn(OWN_B, B)
    p.answerLoyalty(1, WALLET_B)
    p.answerOrders(1, ORDERS_B)
    expect(p.view.points).toBe(42)
    p.signIn(OWN_A, A)
    expect(p.view.points, 'A\'s old balance is NOT reused').toBeNull()
    expect(p.view.activeOrders).toBe(0)
    p.answerLoyalty(2, WALLET_A)
    p.answerOrders(2, ORDERS_A)
    expect(p.view.points).toBe(275)
    expect(p.view.activeOrders).toBe(2)
  })
})

// ══ the GET half of the TOCTOU: server-authenticated identity ═══════════════

describe('a GET response is adopted only under the identity the SERVER authenticated', () => {
  let p: ReturnType<typeof mountShell>
  beforeEach(() => { p = mountShell() })

  it('1 — the client believes A, the server authenticated B: nothing is adopted', () => {
    p.signIn(OWN_A, A)
    expect(p.pendingLoyalty).toBe(1)
    p.answerLoyalty(0, WALLET_B, B)               // server says « this body belongs to B »
    p.answerOrders(0, ORDERS_B, B)
    expect(p.view.points, 'B\'s balance never appears on A\'s screen').toBeNull()
    expect(p.view.activeOrders).toBe(0)
    expect(p.view.pointsStamp, 'the state carries no stamp at all').toBeNull()
  })

  it('2 — client believes A, server returns ownerId=A: adopted, unchanged', () => {
    p.signIn(OWN_A, A)
    p.answerLoyalty(0, WALLET_A, A)
    p.answerOrders(0, ORDERS_A, A)
    expect(p.view.points).toBe(275)
    expect(p.view.activeOrders).toBe(2)
  })

  it('3 — a response that names NOBODY is refused too (undefined is not a match)', () => {
    for (const bad of [undefined, null, '', 0, false, {}, [], `u:${A}`]) {
      const q = mountShell()
      q.signIn(OWN_A, A)
      q.answerLoyalty(0, WALLET_A, bad)
      q.answerOrders(0, ORDERS_A, bad)
      expect(q.view.points, `ownerId=${JSON.stringify(bad)}`).toBeNull()
      expect(q.view.activeOrders, `ownerId=${JSON.stringify(bad)}`).toBe(0)
    }
  })

  it('4 — A → B, then A\'s own correctly-attributed response arrives late: still refused by alive', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)
    p.answerLoyalty(1, WALLET_B, B)
    p.answerOrders(1, ORDERS_B, B)
    expect(p.view.points).toBe(42)
    p.answerLoyalty(0, WALLET_A, A)               // honest server, superseded request
    p.answerOrders(0, ORDERS_A, A)
    expect(p.view.points, 'B keeps its own').toBe(42)
    expect(p.view.activeOrders).toBe(1)
  })

  it('4 bis — the two guards are independent: neither alone would be enough', () => {
    // `alive` catches « React already moved »; the ownerId check catches « React has not
    // moved yet ». Each case below is closed by exactly one of them.
    const q = mountShell()
    q.signIn(OWN_A, A)
    q.signIn(OWN_B, B)
    q.answerLoyalty(0, WALLET_A, A)               // superseded but correctly attributed → only `alive`
    q.answerOrders(0, ORDERS_A, A)
    expect(q.view.points).toBeNull()

    const r = mountShell()
    r.signIn(OWN_A, A)
    r.answerLoyalty(0, WALLET_B, B)               // live but wrongly attributed → only the ownerId check
    r.answerOrders(0, ORDERS_B, B)
    expect(r.view.points).toBeNull()
    expect(r.view.activeOrders).toBe(0)
  })

  it('guest and unresolved still issue NO account GET at all', () => {
    const g = mountShell()
    g.signIn('guest')
    expect(g.pendingLoyalty, 'guest has no account to read').toBe(0)
    expect(g.pendingOrders).toBe(0)
    const u = mountShell()
    u.signIn(null)
    expect(u.pendingLoyalty).toBe(0)
    expect(u.pendingOrders).toBe(0)
  })
})

// ══ the real EatShell file ══════════════════════════════════════════════════

describe('the shell really implements this', () => {
  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(executable(read(SHELL))).toContain('useState')
    expect(read(SHELL)).toContain('// ')
    expect(executable(read(SHELL))).not.toContain('// Loyalty (rail card + user tier)')
  })

  it('the loyalty/orders effect is keyed on the identity, not merely `[status]`', () => {
    const raw = read(SHELL)
    const src = executable(raw)
    // the identity is derived from the live session user id, re-used by cart + address
    expect(src).toMatch(/const addressOwnerId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    // the ANCHOR comment, left in the RAW source so a reviewer who moves the dep array
    // around has to move the anchor with it — the executable form strips comments, so
    // this test uses the raw file to pin the anchor's position.
    expect(raw, 'the effect that calls loyalty/wallet + /api/orders is keyed on identity').toMatch(
      /\/\* loyalty-active-orders-deps \*\/\s*\[status, addressOwnerId\]\)/,
    )
    // the plain `[status]` single-key form is gone from that effect (executable form so
    // a lingering commented-out dep array cannot pass this positively).
    expect(src.match(/\}, \[status\]\)/g) ?? [], 'no effect keyed solely on status remains').toHaveLength(0)
  })

  it('both state slots carry the stamp of the identity they were read under', () => {
    const src = executable(read(SHELL))
    // points and activeOrders are stored as { stamp, value }, never as plain primitives
    expect(src).toMatch(/useState<\{ stamp: string \| null; value: number \}>\(/)
    // and only ever read through a render-time match against the live session stamp
    expect(src).toMatch(/pointsState\.stamp !== null && pointsState\.stamp === sessionStamp/)
    expect(src).toMatch(/activeOrdersState\.stamp !== null && activeOrdersState\.stamp === sessionStamp/)
  })

  it('the effect FAIL-CLOSES before the request and declares requestOwner + requestUserId', () => {
    const src = executable(read(SHELL))
    // the previous owner's state is dropped FIRST, before any fetch
    expect(src).toMatch(/setPointsState\(\{ stamp: null, value: 0 \}\)[\s\S]*?setActiveOrdersState\(\{ stamp: null, value: 0 \}\)/)
    // unresolved/guest never reach the network for account data
    expect(src).toMatch(/if \(status !== 'authenticated'\) return/)
    expect(src).toMatch(/if \(!addressOwnerId\) return/)
    // the response is stamped with the owner the request was issued FOR, and refused
    // unless the server echoed the SAME RAW ID
    expect(src).toMatch(/const requestOwner = sessionStamp/)
    expect(src).toMatch(/const requestUserId = addressOwnerId/)
    // alive bool, cleanup disarming both responses
    expect(src).toMatch(/let alive = true/)
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)
  })

  it('a response that does not name the requested raw id is refused for BOTH endpoints', () => {
    const src = executable(read(SHELL))
    // the loyalty branch
    expect(src).toMatch(
      /\.then\(\(w: \{ ownerId\?: unknown; pointsBalance\?: unknown \} \| null\) => \{\s*if \(!alive\) return/,
    )
    expect(src).toMatch(
      /if \(typeof w\?\.ownerId !== 'string' \|\| w\.ownerId !== requestUserId\) return/,
    )
    // the orders branch
    expect(src).toMatch(
      /\.then\(\(d: \{ ownerId\?: unknown; orders\?: unknown \} \| null\) => \{\s*if \(!alive\) return/,
    )
    expect(src).toMatch(
      /if \(typeof d\?\.ownerId !== 'string' \|\| d\.ownerId !== requestUserId\) return/,
    )
  })

  it('the shell commits each value STAMPED with the request\'s raw owner', () => {
    const src = executable(read(SHELL))
    expect(src).toMatch(/setPointsState\(\{ stamp: requestOwner, value: /)
    expect(src).toMatch(/setActiveOrdersState\(\{ stamp: requestOwner, value: active \}\)/)
  })

  it('the active-order count still filters on the same four statuses', () => {
    const src = executable(read(SHELL))
    expect(src).toContain(`['received', 'preparing', 'ready', 'picked_up']`)
  })
})

// ══ the two endpoints really name the identity they authenticated ═══════════

describe('the two endpoints really name the identity', () => {
  it('GET /api/loyalty/wallet returns `ownerId` sourced from the AUTHENTICATED token.sub', () => {
    const src = read(WALLET_ROUTE)
    // the ownerId is derived from the AUTHENTICATED session, not the queried customer
    expect(src).toMatch(/ownerId[^=]*=\s*typeof token\?\.sub === 'string' \? token\.sub : null/)
    // and the response actually surfaces it alongside pointsBalance
    expect(src).toMatch(/ownerId,[\s\S]{0,200}pointsBalance/)
  })

  it('GET /api/orders returns `ownerId: token.sub`', () => {
    const src = read(ORDERS_ROUTE)
    expect(src).toMatch(/ownerId:\s*token\.sub/)
    // additive — the orders list field is still there
    expect(src).toMatch(/orders: withBadges/)
  })
})
