import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT STALE HISTORY ON /eat/orders (P1 confidentialité) ───────────
//
// WHAT WAS WRONG. The state already carried a stamp and `reorder()` already checked it —
// so the WRITE was closed — but the RENDER read `data.current` / `data.past` raw, and the
// fetch was keyed on [status, reloadTick]. The user id was not a dependency, so
// A → logout → B login, which begins and ends at status 'authenticated', guaranteed no new
// request: `data` kept holding A's cards and every consumer read it directly — the cards,
// the tab counters, the search, the empty/list decision, the pickup code, the refund badge,
// the totals, the restaurant names, the dates, the tracking and receipt links and the
// actions. Not one frame: until a remount or a manual refresh.
//
// The API is already owner-scoped on token.sub. This was entirely client-side stale state.
//
// HOW IT IS PROVEN HERE. This repository has no DOM harness (vitest environment: 'node',
// include: tests/**/*.test.ts), so the proof is split three ways and each part says which
// it is:
//   • EXECUTED — the ownership decision runs for real: `gate()` calls the repository's own
//     sessionCartStamp, and the reorder cases drive the real lib/eat-cart against an
//     in-memory sessionStorage, so "zero writeCart" is read back out of storage.
//   • MODELLED — React's effect lifecycle (dependency comparison and cleanup) is modelled
//     in `makePage`, because that is precisely what the refetch and the response-race
//     claims are about. The model is held to the source by the pins in T/U/V.
//   • CLOSED BY ENUMERATION — case V extracts every occurrence of the identifier `data`
//     from the real file and asserts the complete set, so a new raw read fails this suite
//     instead of slipping past a pin that only sampled the reads it already knew about.

// ── minimal browser surface, for the real cart library ────────────────────────
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
const session = new MemStorage()
const win = new EventTarget()
;(globalThis as { window?: unknown }).window = win
;(globalThis as { sessionStorage?: unknown }).sessionStorage = session
;(globalThis as { localStorage?: unknown }).localStorage = new MemStorage()

import {
  sessionCartStamp, currentCartStamp, setCartOwner, clearCartOwner,
  writeCart, readCart, __resetCartOwner, type EatCartData,
} from '@/lib/eat-cart'

const A = 'user-A', B = 'user-B'
const PAGE = 'app/[locale]/eat/orders/page.tsx'

// ── A's history, with a distinctive value for every field the spec lists ──────
type Card = Record<string, unknown>
const A_RESTAURANT = 'Trattoria Isolation'
const A_PICKUP_REF = 'PICKUP-A-7731'
const A_TOTAL = 48.37
const A_TABLE = 'Table 12 — A'
const A_TRACKING = 'trk-A-0001'
const A_RESERVATION_ID = 'res-A-9'
const A_REFUND_CENTS = 1250

const A_CURRENT: Card[] = [
  {
    id: 'o-A-1', kind: 'pickup', phase: 'current', restaurantName: A_RESTAURANT,
    itemsCount: 3, total: A_TOTAL, status: 'preparing', createdAt: '2026-09-01T12:00:00.000Z',
    ref: A_PICKUP_REF, restaurantId: 'r-A', trackingId: A_TRACKING,
  },
  {
    id: A_RESERVATION_ID, kind: 'reservation', phase: 'current', restaurantName: A_RESTAURANT,
    itemsCount: 0, total: 0, status: 'confirmed', createdAt: '2026-09-02T12:00:00.000Z',
    ref: 'RES-A', date: '2026-09-20T19:30:00.000Z', guests: 4,
    depositAmount: 20, depositStatus: 'authorized', cancellable: true,
  },
  {
    id: 'o-A-3', kind: 'dinein', phase: 'current', restaurantName: A_RESTAURANT,
    itemsCount: 2, total: 31.5, status: 'open', createdAt: '2026-09-03T12:00:00.000Z',
    ref: 'DIN-A', tableLabel: A_TABLE, tableId: 'tbl-A-12',
  },
]
const A_PAST: Card[] = [
  {
    id: 'o-A-9', kind: 'delivery', phase: 'past', restaurantName: A_RESTAURANT,
    itemsCount: 1, total: 19.9, status: 'delivered', createdAt: '2026-08-01T12:00:00.000Z',
    ref: 'DEL-A', restaurantId: 'r-A', trackingId: 'trk-A-9',
    refundedCents: A_REFUND_CENTS, isPartial: true,
  },
]
/** Every value of A's that must never surface under another identity. */
const A_SENTINELS = [
  A_RESTAURANT, A_PICKUP_REF, A_TABLE, A_TRACKING, A_RESERVATION_ID,
  String(A_TOTAL), String(A_REFUND_CENTS), 'r-A', 'tbl-A-12', 'trk-A-9',
]

const B_CURRENT: Card[] = [{
  id: 'o-B-1', kind: 'delivery', phase: 'current', restaurantName: 'Chez B',
  itemsCount: 2, total: 12.4, status: 'received', createdAt: '2026-09-10T12:00:00.000Z',
  ref: 'DEL-B', restaurantId: 'r-B', trackingId: 'trk-B-1',
}]

// ── the page's render-time derivation, using the REAL stamp function ─────────
type Loaded = { stamp: string | null; current: Card[]; past: Card[] } | null

function gate(status: string, liveUserId: string | undefined, data: Loaded) {
  const liveStamp = sessionCartStamp(status, liveUserId)
  const ordersOwned = liveStamp !== null && liveStamp !== 'guest' && data?.stamp === liveStamp
  const visibleData = ordersOwned ? data : null
  const safeCurrent = visibleData?.current ?? []
  const safePast = visibleData?.past ?? []
  return { liveStamp, ordersOwned, visibleData, safeCurrent, safePast }
}

/**
 * MODELLED: React's dependency comparison and cleanup, which is what the refetch and
 * response-race claims are about. Everything the model decides, it decides by calling the
 * real sessionCartStamp; the dependency array it compares is pinned against the source in
 * case T, and the gate it applies is pinned in case V.
 */
function makePage() {
  let data: Loaded = null
  let loading = true
  let deps: string | null = null
  let alive: { v: boolean } | null = null
  const requests: Array<{
    forStamp: string | null
    resolve: (d: { current: Card[]; past: Card[] }) => void
  }> = []

  function render(status: string, liveUserId: string | undefined, reloadTick = 0, query = '') {
    const key = JSON.stringify([status, liveUserId ?? null, reloadTick])
    if (key !== deps) {
      if (alive) alive.v = false // the cleanup of the previous run: `return () => { alive = false }`
      deps = key
      alive = null
      if (status === 'authenticated') {
        const mine = { v: true }
        alive = mine
        loading = true
        const forStamp = sessionCartStamp(status, liveUserId)
        requests.push({
          forStamp,
          resolve: (d) => {
            if (!mine.v) return // disowned by the cleanup
            data = { stamp: forStamp, current: d.current, past: d.past }
            loading = false
          },
        })
      }
    }
    const g = gate(status, liveUserId, data)
    const q = query.trim().toLowerCase()
    const current = g.safeCurrent.filter((c) => String(c.restaurantName).toLowerCase().includes(q))
    const past = g.safePast.filter((c) => String(c.restaurantName).toLowerCase().includes(q))
    const showLoading = status === 'loading' || loading || !g.ordersOwned
    const activeCards = current
    return {
      ...g, current, past, loading, showLoading,
      isEmpty: !showLoading && activeCards.length === 0,
      counters: { current: g.safeCurrent.length, past: g.safePast.length },
      requests,
    }
  }
  return { render, requests }
}

beforeEach(() => {
  session.clear()
  __resetCartOwner()
})

// ══ A–I : nothing of A's survives under B ════════════════════════════════════

describe('A–I — a list loaded under A shows nothing at all under B', () => {
  const loadedForA: Loaded = { stamp: `u:${A}`, current: A_CURRENT, past: A_PAST }

  it('A — stamp A with session A: A\'s cards are visible', () => {
    const g = gate('authenticated', A, loadedForA)
    expect(g.ordersOwned).toBe(true)
    expect(g.safeCurrent).toHaveLength(3)
    expect(g.safePast).toHaveLength(1)
  })

  it('B — stamp A with session B: ZERO card', () => {
    const g = gate('authenticated', B, loadedForA)
    expect(g.ordersOwned).toBe(false)
    expect(g.visibleData).toBeNull()
    expect(g.safeCurrent).toEqual([])
    expect(g.safePast).toEqual([])
  })

  it('C — the tab counters do not show A\'s numbers', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.requests[0].resolve({ current: A_CURRENT, past: A_PAST })
    expect(p.render('authenticated', A).counters).toEqual({ current: 3, past: 1 })
    // the session becomes B, with no remount
    expect(p.render('authenticated', B).counters).toEqual({ current: 0, past: 0 })
  })

  it('D–I — NOT ONE of A\'s values appears anywhere in what B may read', () => {
    // amounts, restaurant names, pickup codes, reservations, refund figures, table labels,
    // tracking and receipt ids — asserted as a set over the whole gated output, so a field
    // added to the card shape later is covered without editing this test.
    const g = gate('authenticated', B, loadedForA)
    const everythingBMayRead = JSON.stringify({
      visibleData: g.visibleData, safeCurrent: g.safeCurrent, safePast: g.safePast,
      counters: { current: g.safeCurrent.length, past: g.safePast.length },
    })
    for (const sentinel of A_SENTINELS) {
      expect(everythingBMayRead.includes(sentinel), sentinel).toBe(false)
    }
    // …and the control: those same sentinels ARE all present when A is the viewer, so the
    // assertion above is about the gate and not about a mis-spelled sentinel.
    const own = gate('authenticated', A, loadedForA)
    const everythingAMayRead = JSON.stringify({ c: own.safeCurrent, p: own.safePast })
    for (const sentinel of A_SENTINELS) {
      expect(everythingAMayRead.includes(sentinel), sentinel).toBe(true)
    }
  })
})

// ══ J, P, Q : what the screen SAYS while it cannot vouch for the identity ════

describe('J/P/Q — the screen never states something it cannot know', () => {
  it('J — a mismatch is a LOADING state, never « aucune commande »', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.requests[0].resolve({ current: A_CURRENT, past: A_PAST })
    const asA = p.render('authenticated', A)
    expect(asA.showLoading).toBe(false)
    expect(asA.isEmpty).toBe(false)

    const asB = p.render('authenticated', B)
    expect(asB.showLoading).toBe(true)   // skeleton
    expect(asB.isEmpty).toBe(false)      // NOT « aucune commande » — B may well have orders
  })

  it('P — the empty state is honest only after a response stamped for THIS account', () => {
    const p = makePage()
    p.render('authenticated', B)
    // before the response: loading, not empty
    expect(p.render('authenticated', B).isEmpty).toBe(false)
    // an EMPTY response, stamped B
    p.requests[0].resolve({ current: [], past: [] })
    const after = p.render('authenticated', B)
    expect(after.ordersOwned).toBe(true)
    expect(after.showLoading).toBe(false)
    expect(after.isEmpty).toBe(true)     // now it is B's own emptiness
  })

  it('Q — signed out: the stamp is \'guest\', which can never own an orders list', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.requests[0].resolve({ current: A_CURRENT, past: A_PAST })
    const out = p.render('unauthenticated', undefined)
    expect(out.liveStamp).toBe('guest')
    expect(out.ordersOwned).toBe(false)
    expect(out.safeCurrent).toEqual([])
    expect(out.safePast).toEqual([])
    // and the page returns its existing sign-in screen before reaching any card
    const src = executable(read(PAGE))
    expect(src).toContain("if (status === 'unauthenticated') {")
    expect(src.indexOf("if (status === 'unauthenticated') {"))
      .toBeLessThan(src.indexOf('const activeCards ='))
  })

  it('the session still resolving is a loading state too, not an empty one', () => {
    const g = gate('loading', undefined, { stamp: `u:${A}`, current: A_CURRENT, past: A_PAST })
    expect(g.liveStamp).toBeNull()
    expect(g.ordersOwned).toBe(false)
    // an authenticated session with no usable id fails closed as well
    expect(gate('authenticated', undefined, { stamp: `u:${A}`, current: [], past: [] }).ordersOwned).toBe(false)
  })
})

// ══ K, L : the refetch that `status` alone could not trigger ═════════════════

describe('K/L — an identity change refetches, even authenticated → authenticated', () => {
  it('K — A → B with status never leaving \'authenticated\' issues a new request', () => {
    const p = makePage()
    p.render('authenticated', A)
    expect(p.requests).toHaveLength(1)
    expect(p.requests[0].forStamp).toBe(`u:${A}`)

    // re-renders under the SAME identity must not spam the endpoint
    p.render('authenticated', A)
    p.render('authenticated', A)
    expect(p.requests).toHaveLength(1)

    // …and the identity change must issue one, which is exactly what [status, reloadTick]
    // could not do: both ends of A → logout → B login are 'authenticated'.
    p.render('authenticated', B)
    expect(p.requests).toHaveLength(2)
    expect(p.requests[1].forStamp).toBe(`u:${B}`)
  })

  it('L — B → A refetches as well, and never reuses the earlier response', () => {
    const p = makePage()
    p.render('authenticated', B)
    p.requests[0].resolve({ current: B_CURRENT, past: [] })
    p.render('authenticated', A)
    expect(p.requests).toHaveLength(2)
    // until A's own response lands, nothing of B's is shown to A
    const mid = p.render('authenticated', A)
    expect(mid.ordersOwned).toBe(false)
    expect(mid.safeCurrent).toEqual([])
    expect(mid.showLoading).toBe(true)
    p.requests[1].resolve({ current: A_CURRENT, past: A_PAST })
    expect(p.render('authenticated', A).safeCurrent).toHaveLength(3)
  })
})

// ══ M, N : the in-flight request, in both orders ═════════════════════════════

describe('M/N — a response for A can never become B\'s visible data', () => {
  it('M — A in flight, session becomes B, B resolves, THEN A resolves late', () => {
    const p = makePage()
    p.render('authenticated', A)          // A's request starts
    p.render('authenticated', B)          // identity changes: the cleanup disowns A's
    p.requests[1].resolve({ current: B_CURRENT, past: [] })   // B lands first
    const afterB = p.render('authenticated', B)
    expect(afterB.safeCurrent).toHaveLength(1)
    expect(afterB.safeCurrent[0].id).toBe('o-B-1')

    p.requests[0].resolve({ current: A_CURRENT, past: A_PAST }) // A lands LATE
    const afterLateA = p.render('authenticated', B)
    expect(afterLateA.safeCurrent).toHaveLength(1)              // B's list is intact
    expect(afterLateA.safeCurrent[0].id).toBe('o-B-1')
    expect(JSON.stringify(afterLateA.safeCurrent)).not.toContain(A_RESTAURANT)
  })

  it('N — A in flight, session becomes B, A resolves FIRST, then B', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.render('authenticated', B)
    p.requests[0].resolve({ current: A_CURRENT, past: A_PAST }) // A lands first
    const afterA = p.render('authenticated', B)
    expect(afterA.ordersOwned).toBe(false)   // A's response was disowned, nothing committed
    expect(afterA.safeCurrent).toEqual([])
    expect(afterA.showLoading).toBe(true)

    p.requests[1].resolve({ current: B_CURRENT, past: [] })
    const afterBoth = p.render('authenticated', B)
    expect(afterBoth.safeCurrent.map((c) => c.id)).toEqual(['o-B-1'])
  })

  it('the SECOND lock: even a committed response for A is invisible under B', () => {
    // `alive` is the first lock. This is the second, and it is the one that makes the
    // claim unconditional: a response carries the stamp of the identity it was asked for,
    // and the render compares that stamp with the live session. So a commit that got
    // through — a future refactor losing the guard, a path nobody thought of — still shows
    // nothing of A's. What the disown discipline actually prevents is the other harm:
    // B's loaded list being CLOBBERED by a late response for A.
    const committedForA: Loaded = { stamp: `u:${A}`, current: A_CURRENT, past: A_PAST }
    const g = gate('authenticated', B, committedForA)
    expect(g.ordersOwned).toBe(false)
    expect(g.safeCurrent).toEqual([])
    expect(JSON.stringify(g)).not.toContain(A_RESTAURANT)
    // …and the harm the first lock prevents, stated plainly: without it, B's own list is
    // replaced by a list B may not see — so B is shown a skeleton instead of their orders.
    const clobbered = gate('authenticated', B, committedForA)
    expect(clobbered.safeCurrent).toEqual([])
    expect(clobbered.ordersOwned).toBe(false)
  })

  it('O — a response stamped for this account is visible, which is the point of the gate', () => {
    const p = makePage()
    p.render('authenticated', B)
    p.requests[0].resolve({ current: B_CURRENT, past: [] })
    const g = p.render('authenticated', B)
    expect(g.ordersOwned).toBe(true)
    expect(g.counters).toEqual({ current: 1, past: 0 })
    expect(g.showLoading).toBe(false)
  })
})

// ══ R, S : the basket write stays closed ════════════════════════════════════

describe('R/S — reorder refuses, before and after its await', () => {
  /** The two guards of reorder(), driving the REAL cart library. */
  function tryReorder(
    status: string, liveUserId: string | undefined, data: Loaded,
    duringAwait?: () => void,
  ): boolean {
    const g = gate(status, liveUserId, data)
    if (!g.ordersOwned || !g.visibleData) return false       // the guard before the fetch
    const loadedFor = g.visibleData.stamp
    if (duringAwait) duringAwait()                            // the identity moves mid-flight
    if (currentCartStamp() !== loadedFor) return false        // the guard after the await
    writeCart({
      restaurantId: 'r-A',
      items: [{ item: { id: 'd1', name: 'Plat A', price: 12, photos: [] }, qty: 1 }],
      restaurant: { name: A_RESTAURANT, deliveryFee: 0, minOrder: 0 },
    } as EatCartData)
    return true
  }

  it('R — a card loaded under A cannot seed a basket under B: zero writeCart', () => {
    setCartOwner({ kind: 'user', id: B })
    const wrote = tryReorder('authenticated', B, { stamp: `u:${A}`, current: A_CURRENT, past: A_PAST })
    expect(wrote).toBe(false)
    expect(readCart()).toBeNull()                 // read back out of real storage
    expect(session.keys()).toEqual([])
  })

  it('S — the identity changing DURING the await still refuses, before the write', () => {
    setCartOwner({ kind: 'user', id: A })
    const wrote = tryReorder(
      'authenticated', A, { stamp: `u:${A}`, current: A_CURRENT, past: A_PAST },
      () => { setCartOwner({ kind: 'user', id: B }) },   // A → B while the order is fetched
    )
    expect(wrote).toBe(false)
    expect(readCart()).toBeNull()
    expect(session.keys()).toEqual([])
  })

  it('…and the control: under a settled, matching identity it DOES write', () => {
    setCartOwner({ kind: 'user', id: A })
    const wrote = tryReorder('authenticated', A, { stamp: `u:${A}`, current: A_CURRENT, past: A_PAST })
    expect(wrote).toBe(true)
    expect(readCart()?.restaurant.name).toBe(A_RESTAURANT)
    // a guest cannot reach it at all
    clearCartOwner()
    expect(tryReorder('unauthenticated', undefined, { stamp: 'guest', current: A_CURRENT, past: [] })).toBe(false)
  })
})

// ══ T, U, V : the source itself ═════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments FIRST, then blank block comments and JSX comments: a line
 *  comment may legitimately contain a path glob, which a block-comment stripper run first
 *  would read as an opening delimiter and blind itself with the rest of the file. */
function executable(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
}

describe('T/U/V — the page derives everything from the gated source, and only from it', () => {
  const src = executable(read(PAGE))

  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(src).toContain('export default function OrdersPage()')
    expect(src).toContain('async function reorder(c: Card)')
    expect(src).toContain("fetch('/api/eat/orders')")
    expect(read(PAGE)).toContain('// ── THE LIVE IDENTITY')
    expect(src).not.toContain('// ── THE LIVE IDENTITY')
  })

  it('the live identity is read once and drives the fetch, the gate AND the deps', () => {
    expect(src).toMatch(/const liveUserId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    expect(src).toMatch(/const liveStamp = sessionCartStamp\(status, liveUserId\)/)
    // THE REFETCH HALF OF THE FIX: the identity is a dependency. `status` alone cannot see
    // A → logout → B login, which ends where it began.
    expect(src).toMatch(/\}, \[status, liveUserId, reloadTick\]\)/)
    expect(src).not.toMatch(/\}, \[status, reloadTick\]\)/)
    // the request labels itself with the identity it was asked for
    expect(src).toMatch(/const ownStamp = sessionCartStamp\(status, liveUserId\)/)
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)
    // EVERY commit site is disowned by that cleanup. Pinned on the source because the
    // model in makePage implements this discipline itself: without these three pins,
    // deleting `if (alive)` from the page left cases M and N green, which would have made
    // them proofs about the model rather than about the page.
    expect(src).toMatch(/\.then\(\(d\) => \{ if \(alive\) setData\(/)
    expect(src).toMatch(/\.catch\(\(\) => \{ if \(alive\) setData\(/)
    expect(src).toMatch(/\.finally\(\(\) => \{ if \(alive\) setLoading\(false\) \}\)/)
    expect((src.match(/if \(alive\)/g) ?? []).length, 'commit sites guarded').toBe(3)
  })

  it('the gate, and the two lists everything else is built from', () => {
    expect(src).toMatch(
      /const ordersOwned = liveStamp !== null && liveStamp !== 'guest' && data\?\.stamp === liveStamp/,
    )
    expect(src).toMatch(/const visibleData = ordersOwned \? data : null/)
    // the gated empty is a FROZEN module constant: stable identity, so the search memos
    // are not recomputed on every render, and unmutatable since every gated render shares
    // the one array.
    expect(src).toMatch(/const NO_CARDS: Card\[\] = Object\.freeze\(\[\]\) as unknown as Card\[\]/)
    expect(src).toMatch(/const safeCurrent = visibleData\?\.current \?\? NO_CARDS/)
    expect(src).toMatch(/const safePast = visibleData\?\.past \?\? NO_CARDS/)
  })

  it('T — the tab counters read the gated lists', () => {
    expect(src).toMatch(/<span className="count">\{safeCurrent\.length\}<\/span>/)
    expect(src).toMatch(/<span className="count">\{safePast\.length\}<\/span>/)
    expect(src).not.toMatch(/data\?\.current/)
    expect(src).not.toMatch(/data\?\.past/)
  })

  it('U — the search filters the gated lists, and the cards render from the result', () => {
    expect(src).toMatch(/return safeCurrent\.filter\(\(c\) => c\.restaurantName\.toLowerCase\(\)\.includes\(q\)\)/)
    expect(src).toMatch(/return safePast\.filter\(\(c\) => c\.restaurantName\.toLowerCase\(\)\.includes\(q\)\)/)
    expect(src).toMatch(/const activeCards = tab === 'current' \? current : past/)
    // the lists are rendered from those memos, and nothing else maps over cards
    const maps = Array.from(src.matchAll(/(\w+)\.map\(\(c, i\) =>/g)).map((m) => m[1])
    expect(maps.sort()).toEqual(['current', 'past'])
  })

  it('the loading state covers every case in which the identity cannot be vouched for', () => {
    expect(src).toMatch(/const showLoading = status === 'loading' \|\| loading \|\| !ordersOwned/)
    expect(src).toMatch(/const isEmpty = !showLoading && activeCards\.length === 0/)
    // the skeletons follow it, and `loading` alone no longer decides anything rendered
    expect((src.match(/showLoading \? \[0, 1/g) ?? []).length).toBe(2)
    expect(src).not.toMatch(/\{loading \? \[0, 1/)
  })

  it('the reorder guards read the gated source, before and after the await', () => {
    expect(src).toMatch(/if \(!ordersOwned \|\| !visibleData\) return/)
    expect(src).toMatch(/const loadedFor = visibleData\.stamp/)
    expect(src).toMatch(/if \(currentCartStamp\(\) !== loadedFor\) return\s*\n\s*writeCart\(\{/)
    // the post-await re-check sits between the fetch and the write, not before the fetch
    expect(src.indexOf("await fetch(`/api/orders/${c.trackingId}`)"))
      .toBeLessThan(src.indexOf('if (currentCartStamp() !== loadedFor) return'))
  })

  it('V — CLOSED ENUMERATION: every occurrence of the raw `data` identifier', () => {
    // Not a sample. Every use of the identifier is extracted from the real file and the
    // whole set is asserted, so a new raw read — a counter, a card, a filter — fails this
    // test rather than slipping past the pins above.
    const lines = src.split('\n')
    const uses: string[] = []
    lines.forEach((l) => {
      if (/(?<![\w$])data(?![\w$])/.test(l)) uses.push(l.trim())
    })
    expect(uses).toEqual([
      // the session, renamed — not the orders state
      'const { data: session, status } = useSession()',
      // the raw state itself
      'const [data, setData] = useState<{ stamp: string | null; current: Card[]; past: Card[] } | null>(null)',
      // the gate reads ONE field of it: the stamp
      "const ordersOwned = liveStamp !== null && liveStamp !== 'guest' && data?.stamp === liveStamp",
      // …and the single place the rows pass through
      'const visibleData = ordersOwned ? data : null',
      // a JSX attribute name, not a read
      '<div className="gb gb-orders" data-tab={tab} data-state={state}>',
    ])
  })

  it('the lot touched nothing it was told not to touch', () => {
    // the API is already owner-scoped on token.sub; this was client-side stale state
    const api = read('app/api/eat/orders/route.ts')
    expect(api).toMatch(/getToken/)
    expect(api).toMatch(/token\.sub/)
    // and the page still sends no identity of its own to it
    expect(src).toMatch(/fetch\('\/api\/eat\/orders'\)/)
  })
})
