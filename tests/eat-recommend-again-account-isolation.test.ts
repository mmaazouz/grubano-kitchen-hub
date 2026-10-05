import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT « RECOMMANDER » ON /eat (P1 confidentialité) ────────────────
//
// WHAT WAS WRONG. The row fetched GET /api/eat/orders into state with an EMPTY dependency
// array and no owner stamp. The endpoint is owner-scoped on token.sub, so those cards are
// the signed-in account's real orders — a restaurant name, an item count, a euro total and
// a link into that restaurant, per card. After A → logout → B login in the same mount the
// effect never re-ran (both ends of that transition are status 'authenticated'), so `recent`
// kept A's cards for the life of the mount and tapping one navigated B into A's restaurant.
//
// Same class as the /eat/orders lot, in a SECOND consumer of the same endpoint. In this very
// component, in the same frame, the favourites hearts already went blank for B while this
// row did not: the live identity was two blocks above.
//
// HOW IT IS PROVEN, said plainly:
//   • EXECUTED — the ownership decision runs for real: `gate()` calls the repository's own
//     favOwner (which delegates to sessionCartStamp), and the sentinel sweep is executed
//     over the gate's actual output.
//   • MODELLED — React's dependency comparison and cleanup, in `makePage`, because that is
//     exactly what the refetch and response-race claims are about. The model is held to the
//     source by the pins on the dependency array and the commit site.
//   • CLOSED BY ENUMERATION — case S extracts every occurrence of `recentState` from the
//     real file and asserts the complete set, so a new raw read fails this suite rather
//     than slipping past a pin that only sampled what it already knew about.

import { favOwner } from '@/lib/eat-cart'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`
const PAGE = 'app/[locale]/eat/page.tsx'

// ── A's recent orders, with a distinctive value for each field the row renders ──
const A_RESTAURANT = 'Trattoria Recommander-A'
const A_RESTAURANT_ID = 'resto-A-7731'
const A_ITEMS = 4813
const A_TOTAL = 61.57
const A_ORDER_ID = 'order-A-0001'

type Card = { id: string; restaurantName: string; itemsCount: number; total: number; restaurantId?: string }

const A_CARDS: Card[] = [
  { id: A_ORDER_ID, restaurantName: A_RESTAURANT, itemsCount: A_ITEMS, total: A_TOTAL, restaurantId: A_RESTAURANT_ID },
  { id: 'order-A-0002', restaurantName: 'Chez A Deux', itemsCount: 2, total: 18.4, restaurantId: 'resto-A-2' },
]
/** Every value of A's that must never surface under another identity. */
const A_SENTINELS = [
  A_RESTAURANT, A_RESTAURANT_ID, A_ORDER_ID, String(A_ITEMS), String(A_TOTAL),
  'Chez A Deux', 'resto-A-2',
]
const B_CARDS: Card[] = [
  { id: 'order-B-1', restaurantName: 'Chez B', itemsCount: 1, total: 9.9, restaurantId: 'resto-B-1' },
]

// ── the page's render-time derivation, using the REAL identity function ───────
type Stamped = { owner: string | null; cards: Card[] }

function gate(status: string, userId: string | undefined, state: Stamped) {
  const liveOwner = favOwner(status, userId)
  const cards = liveOwner !== null && liveOwner !== 'guest' && state.owner === liveOwner
    ? state.cards
    : []
  return { liveOwner, cards, sectionShown: cards.length > 0 }
}

/**
 * MODELLED: React's dependency comparison and cleanup. Every decision it makes, it makes by
 * calling the real favOwner; the dependency array it compares is pinned against the source
 * in case J, and the gate it applies is pinned in case S.
 */
function makePage() {
  let state: Stamped = { owner: null, cards: [] }
  let deps: string | null = null
  let alive: { v: boolean } | null = null
  const requests: Array<{ forOwner: string; resolve: (cards: Card[] | null) => void }> = []

  function render(status: string, userId: string | undefined) {
    const liveOwner = favOwner(status, userId)
    const key = String(liveOwner)
    if (key !== deps) {
      if (alive) alive.v = false // the cleanup: `return () => { alive = false }`
      deps = key
      alive = null
      if (liveOwner === null || liveOwner === 'guest') {
        // the page does not call the endpoint at all in this state
        state = { owner: null, cards: [] }
      } else {
        const mine = { v: true }
        alive = mine
        const requestOwner = liveOwner // captured BEFORE the request leaves
        // the page drops the previous account's copy here (pinned in the source tests), so
        // a failing request for B leaves nothing of A's held either
        state = { owner: null, cards: [] }
        requests.push({
          forOwner: requestOwner,
          resolve: (cards) => {
            if (!mine.v) return      // disowned by the cleanup
            if (cards === null) return // a non-2xx / transport error commits NOTHING
            state = { owner: requestOwner, cards }
          },
        })
      }
    }
    return { ...gate(status, userId, state), requests, raw: state }
  }
  return { render, requests }
}

// ══ A–F : nothing of A's survives under B ════════════════════════════════════

describe('A–F — a row loaded under A shows nothing at all under B', () => {
  const loadedForA: Stamped = { owner: OWN_A, cards: A_CARDS }

  it('A — state A with session A: A\'s cards are visible', () => {
    const g = gate('authenticated', A, loadedForA)
    expect(g.liveOwner).toBe(OWN_A)
    expect(g.cards).toHaveLength(2)
    expect(g.sectionShown).toBe(true)
  })

  it('B — state A with session B: ZERO card, on the FIRST frame', () => {
    // No effect has run and none needs to: the value is derived during render.
    const g = gate('authenticated', B, loadedForA)
    expect(g.liveOwner).toBe(OWN_B)
    expect(g.cards).toEqual([])
    expect(g.sectionShown).toBe(false)   // the section is omitted entirely
  })

  it('C–F — NOT ONE of A\'s values appears anywhere in what B may read', () => {
    // restaurant name, item count, euro total, restaurantId and order id — asserted as a
    // set over the whole gated output, so a field added to the card shape later is covered
    // without editing this test.
    const g = gate('authenticated', B, loadedForA)
    const everythingBMayRead = JSON.stringify({ cards: g.cards, sectionShown: g.sectionShown })
    for (const sentinel of A_SENTINELS) {
      expect(everythingBMayRead.includes(sentinel), sentinel).toBe(false)
    }
    // …and the control: those same sentinels ARE all present when A is the viewer, so the
    // sweep above is about the gate and not about a mis-spelled sentinel.
    const own = JSON.stringify(gate('authenticated', A, loadedForA).cards)
    for (const sentinel of A_SENTINELS) {
      expect(own.includes(sentinel), sentinel).toBe(true)
    }
  })
})

// ══ G, H, I : every identity the gate must fail closed on ════════════════════

describe('G–I — an identity that cannot be named owns nothing', () => {
  const loadedForA: Stamped = { owner: OWN_A, cards: A_CARDS }

  it('G — status loading with state A: zero', () => {
    const g = gate('loading', undefined, loadedForA)
    expect(g.liveOwner).toBeNull()
    expect(g.cards).toEqual([])
  })

  it('H — authenticated with no usable id, and state A: zero', () => {
    for (const id of [undefined, '']) {
      const g = gate('authenticated', id, loadedForA)
      expect(g.liveOwner, String(id)).toBeNull()
      expect(g.cards, String(id)).toEqual([])
    }
  })

  it('I — GUEST with state A: zero, and a guest can never own this row', () => {
    const g = gate('unauthenticated', undefined, loadedForA)
    expect(g.liveOwner).toBe('guest')
    expect(g.cards).toEqual([])
    // not even a row genuinely stamped 'guest': a signed-out visitor has no order history,
    // so the gate excludes that owner by name rather than relying on the bucket being empty
    expect(gate('unauthenticated', undefined, { owner: 'guest', cards: A_CARDS }).cards).toEqual([])
  })

  it('…and the page does not even CALL the endpoint without a usable identity', () => {
    const p = makePage()
    p.render('loading', undefined)
    p.render('unauthenticated', undefined)
    p.render('authenticated', undefined)
    expect(p.requests).toHaveLength(0)
    // …then a real identity arrives and exactly one request goes out
    p.render('authenticated', A)
    expect(p.requests.map((r) => r.forOwner)).toEqual([OWN_A])
  })
})

// ══ J, K, L : the refetch that `[]` could not trigger ════════════════════════

describe('J–L — an identity change refetches, and nothing else does', () => {
  it('J — A → B with status never leaving \'authenticated\' issues a new request', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.requests[0].resolve(A_CARDS)
    expect(p.render('authenticated', A).cards).toHaveLength(2)

    // This is exactly what `[]` could not do: both ends of A → logout → B login are
    // 'authenticated', so no new request was guaranteed and B kept A's row.
    const asB = p.render('authenticated', B)
    expect(p.requests.map((r) => r.forOwner)).toEqual([OWN_A, OWN_B])
    expect(asB.cards).toEqual([])          // and nothing of A's is shown while B's loads
    expect(asB.sectionShown).toBe(false)
  })

  it('K — B → A refetches too, and never reuses the earlier response', () => {
    const p = makePage()
    p.render('authenticated', B)
    p.requests[0].resolve(B_CARDS)
    p.render('authenticated', A)
    expect(p.requests.map((r) => r.forOwner)).toEqual([OWN_B, OWN_A])
    const mid = p.render('authenticated', A)
    expect(mid.cards).toEqual([])          // B's row is not shown to A either
    p.requests[1].resolve(A_CARDS)
    expect(p.render('authenticated', A).cards).toHaveLength(2)
  })

  it('L — re-rendering under the SAME identity issues no further request', () => {
    const p = makePage()
    p.render('authenticated', A)
    for (let i = 0; i < 25; i++) p.render('authenticated', A)
    expect(p.requests).toHaveLength(1)
  })
})

// ══ M, N, O, P, Q : the in-flight request, in both orders ════════════════════

describe('M–Q — a response for A can never become B\'s row', () => {
  it('M — A in flight, session becomes B, B resolves, THEN A resolves late', () => {
    const p = makePage()
    p.render('authenticated', A)                 // A's request starts
    p.render('authenticated', B)                 // the cleanup disowns it
    p.requests[1].resolve(B_CARDS)               // B lands first
    expect(p.render('authenticated', B).cards.map((c) => c.id)).toEqual(['order-B-1'])

    p.requests[0].resolve(A_CARDS)               // A lands LATE
    const after = p.render('authenticated', B)
    expect(after.cards.map((c) => c.id)).toEqual(['order-B-1'])   // B's row intact
    expect(JSON.stringify(after.cards)).not.toContain(A_RESTAURANT)
  })

  it('N — A in flight, session becomes B, A resolves FIRST, then B', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.render('authenticated', B)
    p.requests[0].resolve(A_CARDS)               // A lands first, already disowned
    const afterA = p.render('authenticated', B)
    expect(afterA.cards).toEqual([])
    expect(afterA.sectionShown).toBe(false)
    expect(JSON.stringify(afterA.raw)).not.toContain(A_RESTAURANT)   // not even in state

    p.requests[1].resolve(B_CARDS)
    expect(p.render('authenticated', B).cards.map((c) => c.id)).toEqual(['order-B-1'])
  })

  it('O — a response for THIS identity is visible, which is the point of the gate', () => {
    const p = makePage()
    p.render('authenticated', B)
    p.requests[0].resolve(B_CARDS)
    const g = p.render('authenticated', B)
    expect(g.cards).toHaveLength(1)
    expect(g.sectionShown).toBe(true)
  })

  it('P — an EMPTY response for B omits the section honestly', () => {
    const p = makePage()
    p.render('authenticated', B)
    p.requests[0].resolve([])
    const g = p.render('authenticated', B)
    expect(g.cards).toEqual([])
    expect(g.sectionShown).toBe(false)     // omitted, and it is B's own emptiness
    expect(g.raw).toEqual({ owner: OWN_B, cards: [] })
  })

  it('Q — a non-2xx for B commits NOTHING: no card of A\'s, and no fabricated row for B', () => {
    const p = makePage()
    p.render('authenticated', A)
    p.requests[0].resolve(A_CARDS)
    p.render('authenticated', B)
    p.requests[1].resolve(null)            // 401 / 500 / unparseable body
    const g = p.render('authenticated', B)
    expect(g.cards).toEqual([])
    expect(g.sectionShown).toBe(false)
    // the state was NOT overwritten with an empty row stamped for B — a failure does not
    // establish that B has never ordered; the row is simply absent
    expect(g.raw.owner).not.toBe(OWN_B)
    expect(JSON.stringify(g)).not.toContain(A_RESTAURANT)
  })
})

// ══ R, S + the source ═══════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments FIRST, then blank block and JSX comments: a line comment may
 *  legitimately contain a path glob, which a block-comment stripper run first would read as
 *  an opening delimiter and blind itself with the rest of the file. */
function executable(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
}
/** An anchored index: a needle that moved turns this RED instead of passing as -1 < n. */
const at = (src: string, re: RegExp) => {
  const m = re.exec(src)
  expect(m, String(re)).not.toBeNull()
  return (m as RegExpExecArray).index
}

describe('R/S — the page derives the row from the gated value, and only from it', () => {
  const src = executable(read(PAGE))

  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(src).toContain('export default function HomeScreen')
    expect(src).toContain("fetch('/api/eat/orders')")
    expect(src).toContain('const recent =')
    expect(read(PAGE)).toContain('// KEYED ON THE IDENTITY')
    expect(src).not.toContain('// KEYED ON THE IDENTITY')
  })

  it('the live identity is the EXISTING one, not a second definition', () => {
    // the favourites block already resolved it; this lot aliases that value rather than
    // re-deriving it, because a second definition of identity is a second thing to get wrong
    expect(src).toMatch(/const favsOwner = favOwner\(favSessionStatus, favLiveUserId\)/)
    expect(src).toMatch(/const liveOwner = favsOwner/)
    expect((src.match(/favOwner\(/g) ?? []).length, 'one call to favOwner').toBe(1)
    expect(src).not.toMatch(/sessionCartStamp\(/)
  })

  it('the state is owner-stamped and the row is DERIVED during render', () => {
    expect(src).toMatch(
      /const \[recentState, setRecentState\] = useState<\{ owner: string \| null; cards: RecentOrder\[\] \}>\(\{ owner: null, cards: \[\] \}\)/,
    )
    expect(src).toMatch(
      /const recent = liveOwner !== null && liveOwner !== 'guest' && recentState\.owner === liveOwner\s*\n\s*\? recentState\.cards\s*\n\s*: NO_RECENT/,
    )
    expect(src).toMatch(/const NO_RECENT: RecentOrder\[\] = Object\.freeze\(\[\]\) as unknown as RecentOrder\[\]/)
    // DERIVED, not reset in an effect — an effect is one committed frame too late
    expect(src).not.toMatch(/setRecentState\(\{ owner: null, cards: \[\] \}\)\s*\n\s*\}, \[liveOwner\]\)/)
  })

  it('J (source) — the effect is keyed on the identity and stamps with the one it asked for', () => {
    expect(src).toMatch(/const requestOwner = liveOwner/)
    expect(src).toMatch(/setRecentState\(\{ owner: requestOwner, cards: out \}\)/)
    // the previous account's copy is DROPPED before the new request leaves, so a failing
    // request leaves nothing of theirs held in memory. Anchored on the two adjacent lines
    // so it is provably this reset and not the guest bail-out's.
    expect(src).toMatch(
      /const requestOwner = liveOwner\s*\n\s*setRecentState\(\{ owner: null, cards: \[\] \}\)\s*\n\s*let alive = true/,
    )
    // NEVER stamped with the identity at response time
    expect(src).not.toMatch(/setRecentState\(\{ owner: liveOwner, cards: out \}\)/)
    expect(src).toMatch(/\}, \[liveOwner\]\)/)
    expect(src).not.toMatch(/\}, \[\]\)\s*\n\s*\n\s*const cuisineWithMeta/)
    // the race guard, and its cleanup
    expect(src).toMatch(/let alive = true/)
    expect(src).toMatch(/if \(!alive \|\| !d\) return/)
    // A NON-2XX YIELDS NOTHING TO COMMIT. Pinned on the source because the model in
    // makePage implements this discipline itself: without this pin, making the page
    // fabricate `{ current: [], past: [] }` on a 401/500 — an empty row stamped for B, as
    // if the server had said « B has never ordered » — left case Q green, which would have
    // made it a proof about the model rather than about the page.
    expect(src).toMatch(/\.then\(\(r\) => \(r\.ok \? r\.json\(\) : null\)\)/)
    expect(src).not.toMatch(/r\.ok \? r\.json\(\) : \{/)
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)
    // the capture happens BEFORE the request leaves, and the commit AFTER it returns
    expect(at(src, /const requestOwner = liveOwner/))
      .toBeLessThan(at(src, /fetch\('\/api\/eat\/orders'\)/))
    expect(at(src, /fetch\('\/api\/eat\/orders'\)/))
      .toBeLessThan(at(src, /setRecentState\(\{ owner: requestOwner, cards: out \}\)/))
  })

  it('no request is issued without a usable identity', () => {
    expect(src).toMatch(
      /if \(liveOwner === null \|\| liveOwner === 'guest'\) \{\s*\n\s*setRecentState\(\{ owner: null, cards: \[\] \}\)\s*\n\s*return\s*\n\s*\}/,
    )
    // and that bail-out comes BEFORE the fetch, so a guest never calls the endpoint
    expect(at(src, /if \(liveOwner === null \|\| liveOwner === 'guest'\) \{/))
      .toBeLessThan(at(src, /fetch\('\/api\/eat\/orders'\)/))
  })

  it('R — the ONLY JSX consumers are the gated value', () => {
    expect(src).toMatch(/\{recent\.length > 0 && \(/)
    expect(src).toMatch(/\{recent\.map\(\(o, i\) => \(/)
    // exactly two JSX reads, and neither touches the raw state
    expect((src.match(/\{recent\./g) ?? []).length, 'JSX reads of the gated row').toBe(2)
    expect(src).not.toMatch(/recentState\.cards\.length/)
    expect(src).not.toMatch(/recentState\.cards\.map/)
    expect(src).not.toMatch(/\{recentState/)
  })

  it('S — CLOSED ENUMERATION: every occurrence of the raw `recentState`', () => {
    // Not a sample: every line naming the raw state is extracted from the real file and the
    // whole set is asserted, so a new raw read fails this test instead of slipping past the
    // pins above. EXACTLY two places may name it — its declaration and the gate.
    const lines = src.split('\n').filter((l) => /(?<![\w$])recentState(?![\w$])/.test(l)).map((l) => l.trim())
    expect(lines).toEqual([
      'const [recentState, setRecentState] = useState<{ owner: string | null; cards: RecentOrder[] }>({ owner: null, cards: [] })',
      "const recent = liveOwner !== null && liveOwner !== 'guest' && recentState.owner === liveOwner",
      '? recentState.cards',
    ])
  })
})

// ══ §11 — the rest of /eat, re-inventoried ══════════════════════════════════

describe('the COMPLETE useState inventory of /eat', () => {
  it('every piece of state is accounted for, and none of it can speak for another account', () => {
    // The whole list is asserted, so adding state later fails this test and forces the
    // author to say why it is safe — which is the only way an inventory stays true.
    const src = executable(read(PAGE))
    const body = src.slice(src.indexOf('export default function HomeScreen'))
    expect(body.length, 'the component body was found').toBeGreaterThan(0)
    const states = Array.from(body.matchAll(/const \[(\w+), set\w+\] = useState/g)).map((m) => m[1])
    expect(states).toEqual([
      // 1. the public restaurant catalogue — GET /api/restaurants is identity-free, and the
      //    same rows are served to everyone, signed in or not.
      'restaurants',
      // 2. the distance to the nearest geocoded restaurant. Derived from the DEVICE's
      //    position (lib/use-geolocation), which belongs to the browser and not to an
      //    account: it is the same number for whoever is signed in on this device.
      'nearestKm',
      // 3. this lot — the account's recent orders, owner-stamped and gated.
      'recentState',
      // 4. the favourites ids, owner-stamped and gated (the previous lot).
      'favsState',
      // 5. a boolean: the catalogue request is in flight. No account content.
      'loading',
    ])
    // the two that hold account CONTENT are both gated, by the same live identity
    expect(src).toMatch(/const recent = liveOwner !== null/)
    expect(src).toMatch(/const favs = favsOwner !== null/)
  })

  it('the geolocation state really is device-scoped, not account-scoped', () => {
    // Stated rather than assumed: nearestKm is computed from the restaurant list and the
    // device coords, with no identity anywhere in its derivation.
    const src = executable(read(PAGE))
    expect(src).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(\)/)
    const nearest = src.slice(src.indexOf('setNearestKm'))
    expect(nearest.slice(0, 400)).not.toMatch(/liveOwner|favsOwner|favLiveUserId/)
  })

  it('the lot touched nothing it was told not to touch', () => {
    // the endpoint is already owner-scoped on token.sub; this was client-side stale state
    const api = read('app/api/eat/orders/route.ts')
    expect(api).toMatch(/getToken/)
    expect(api).toMatch(/token\.sub/)
    // the favourites architecture of the previous lot is intact and still the source of the
    // identity this lot reuses
    const lib = read('lib/eat-cart.ts')
    expect(lib).toMatch(/export function favOwner/)
    expect(lib).toMatch(/const FAV_PREFIX = 'grubano_favs\.v2\.'/)
    expect(lib).toMatch(/export function toggleFavForOwner/)
    for (const f of ['app/[locale]/eat/orders/page.tsx', 'lib/eat-addresses.ts', 'lib/supply-cart.ts']) {
      expect(read(f).length, f).toBeGreaterThan(100)
    }
  })
})
