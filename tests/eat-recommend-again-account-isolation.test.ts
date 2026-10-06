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
 * MODELLED: React's two phases, honestly separated. `render()` computes what the frame shows
 * and NOTHING else; `flushEffects()` is what runs after that frame has committed — the
 * cleanup, the drop and the request. Collapsing them (as the first version of this model
 * did) makes the model unable to express the window between the two, and lets an assertion
 * about the raw state pass for a reason the real page does not provide.
 *
 * Every decision it makes, it makes by calling the real favOwner; the dependency array it
 * compares, the capture order, the commit site and the non-2xx handling are all pinned
 * against the source, so the model cannot quietly be kinder than the page.
 */
function makePage() {
  let state: Stamped = { owner: null, cards: [] }
  let deps: string | null = null
  let alive: { v: boolean } | null = null
  let pending: { status: string; userId: string | undefined } | null = null
  const requests: Array<{ forOwner: string; resolve: (cards: Card[] | null) => void }> = []

  /** The RENDER phase: derive the frame. It touches no state — React would not let it. */
  function render(status: string, userId: string | undefined) {
    const key = String(favOwner(status, userId))
    if (key !== deps) pending = { status, userId }   // the deps changed: an effect is due
    return { ...gate(status, userId, state), requests, raw: state, effectPending: pending !== null }
  }

  /** AFTER the commit: cleanup, then the effect body. */
  function flushEffects() {
    if (!pending) return
    const { status, userId } = pending
    pending = null
    const liveOwner = favOwner(status, userId)
    deps = String(liveOwner)
    if (alive) alive.v = false // the cleanup: `return () => { alive = false }`
    alive = null
    if (liveOwner === null || liveOwner === 'guest') {
      // the page does not call the endpoint at all in this state
      state = { owner: null, cards: [] }
      return
    }
    const mine = { v: true }
    alive = mine
    const requestOwner = liveOwner // captured BEFORE the request leaves
    state = { owner: null, cards: [] } // the previous account's copy is dropped here
    requests.push({
      forOwner: requestOwner,
      resolve: (cards) => {
        if (!mine.v) return        // disowned by the cleanup
        if (cards === null) return // a non-2xx / transport error commits NOTHING
        state = { owner: requestOwner, cards }
      },
    })
  }

  /** A full React turn: render, commit, run effects, and return the frame that was shown. */
  function turn(status: string, userId: string | undefined) {
    const frame = render(status, userId)
    flushEffects()
    return frame
  }
  return { render, flushEffects, turn, requests }
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
    p.turn('loading', undefined)
    p.turn('unauthenticated', undefined)
    p.turn('authenticated', undefined)
    expect(p.requests).toHaveLength(0)
    // …then a real identity arrives and exactly one request goes out
    p.turn('authenticated', A)
    expect(p.requests.map((r) => r.forOwner)).toEqual([OWN_A])
  })
})

// ══ J, K, L : the refetch that `[]` could not trigger ════════════════════════

describe('J–L — an identity change refetches, and nothing else does', () => {
  it('J — A → B with status never leaving \'authenticated\' issues a new request', () => {
    const p = makePage()
    p.turn('authenticated', A)
    p.requests[0].resolve(A_CARDS)
    expect(p.turn('authenticated', A).cards).toHaveLength(2)

    // This is exactly what `[]` could not do: both ends of A → logout → B login are
    // 'authenticated', so no new request was guaranteed and B kept A's row.
    const asB = p.turn('authenticated', B)
    expect(p.requests.map((r) => r.forOwner)).toEqual([OWN_A, OWN_B])
    expect(asB.cards).toEqual([])          // and nothing of A's is shown while B's loads
    expect(asB.sectionShown).toBe(false)
  })

  it('K — B → A refetches too, and never reuses the earlier response', () => {
    const p = makePage()
    p.turn('authenticated', B)
    p.requests[0].resolve(B_CARDS)
    p.turn('authenticated', A)
    expect(p.requests.map((r) => r.forOwner)).toEqual([OWN_B, OWN_A])
    const mid = p.turn('authenticated', A)
    expect(mid.cards).toEqual([])          // B's row is not shown to A either
    p.requests[1].resolve(A_CARDS)
    expect(p.turn('authenticated', A).cards).toHaveLength(2)
  })

  it('L — re-rendering under the SAME identity issues no further request', () => {
    const p = makePage()
    p.turn('authenticated', A)
    for (let i = 0; i < 25; i++) p.turn('authenticated', A)
    expect(p.requests).toHaveLength(1)
  })
})

// ══ M, N, O, P, Q : the in-flight request, in both orders ════════════════════

describe('M–Q — a response for A can never become B\'s row', () => {
  it('M — A in flight, session becomes B, B resolves, THEN A resolves late', () => {
    const p = makePage()
    p.turn('authenticated', A)                 // A's request starts
    p.turn('authenticated', B)                 // the cleanup disowns it
    p.requests[1].resolve(B_CARDS)               // B lands first
    expect(p.turn('authenticated', B).cards.map((c) => c.id)).toEqual(['order-B-1'])

    p.requests[0].resolve(A_CARDS)               // A lands LATE
    const after = p.turn('authenticated', B)
    expect(after.cards.map((c) => c.id)).toEqual(['order-B-1'])   // B's row intact
    expect(JSON.stringify(after.cards)).not.toContain(A_RESTAURANT)
  })

  it('N — A in flight, session becomes B, A resolves FIRST, then B', () => {
    const p = makePage()
    p.turn('authenticated', A)
    p.turn('authenticated', B)
    p.requests[0].resolve(A_CARDS)               // A lands first, already disowned
    const afterA = p.turn('authenticated', B)
    expect(afterA.cards).toEqual([])
    expect(afterA.sectionShown).toBe(false)
    expect(JSON.stringify(afterA.raw)).not.toContain(A_RESTAURANT)   // not even in state

    p.requests[1].resolve(B_CARDS)
    expect(p.turn('authenticated', B).cards.map((c) => c.id)).toEqual(['order-B-1'])
  })

  it('O — a response for THIS identity is visible, which is the point of the gate', () => {
    const p = makePage()
    p.turn('authenticated', B)
    p.requests[0].resolve(B_CARDS)
    const g = p.turn('authenticated', B)
    expect(g.cards).toHaveLength(1)
    expect(g.sectionShown).toBe(true)
  })

  it('P — an EMPTY response for B omits the section honestly', () => {
    const p = makePage()
    p.turn('authenticated', B)
    p.requests[0].resolve([])
    const g = p.turn('authenticated', B)
    expect(g.cards).toEqual([])
    expect(g.sectionShown).toBe(false)     // omitted, and it is B's own emptiness
    expect(g.raw).toEqual({ owner: OWN_B, cards: [] })
  })

  it('Q — a non-2xx for B commits NOTHING: no card of A\'s, and no fabricated row for B', () => {
    const p = makePage()
    p.turn('authenticated', A)
    p.requests[0].resolve(A_CARDS)
    p.turn('authenticated', B)
    p.requests[1].resolve(null)            // 401 / 500 / unparseable body
    const g = p.turn('authenticated', B)
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

describe('the useState inventory of /eat', () => {
  it('every useState is accounted for — and see the field enumeration for the real closure', () => {
    // NARROWED, because the earlier title and comment claimed completeness this matcher
    // does not have: it sees `const [x, setX] = useState` and nothing else, so a useRef, a
    // module-level `let`, or the same useState with a setter not named `set*` all escape
    // it. A reviewer proved that by inserting a useRef holding the cards and rendering
    // A's restaurant name on the first frame — 25/25 green. What actually closes the
    // question is the enumeration over the FIELD names in the review-round block below:
    // an enumeration over containers can always be escaped by choosing another container,
    // an enumeration over the data cannot, because a leak has to read a field to paint it.
    const src = executable(read(PAGE))
    const body = src.slice(src.indexOf('export default function HomeScreen'))
    expect(body.length, 'the component body was found').toBeGreaterThan(0)
    const states = Array.from(body.matchAll(/const \[(\w+), set\w+\] = useState/g)).map((m) => m[1])
    expect(states).toEqual([
      // 1. the public restaurant catalogue — GET /api/restaurants is identity-free, and the
      //    same rows are served to everyone, signed in or not.
      'restaurants',
      // 2. the distance to the nearest geocoded restaurant -- NOW OWNER-STAMPED. This
      //    entry used to read `nearestKm`, and this comment used to call the position
      //    device-scoped: the same number for whoever is signed in on this device.
      //    That was wrong, for the reason the case below gives: /api/geo/reverse turns
      //    the fix into a postal label which this page renders, so the repository
      //    itself treats it as account content. The geolocation lot replaced the raw
      //    number with an { owner, km } pair, so the NAME changed with it. Refreshing
      //    the list keeps the invariant this case exists for -- that no useState of
      //    this page holds account content without a gate -- and strengthens it:
      //    three of the five are now gated, where two were.
      'nearestState',
      // 3. this lot — the account's recent orders, owner-stamped and gated.
      'recentState',
      // 4. the favourites ids, owner-stamped and gated (the previous lot).
      'favsState',
      // 5. a boolean: the catalogue request is in flight. No account content.
      'loading',
    ])
    // the three that hold account CONTENT are all gated, on a live identity
    expect(src).toMatch(/const recent = liveOwner !== null/)
    expect(src).toMatch(/const favs = favsOwner !== null/)
    expect(src).toMatch(/const nearestKm = liveOwner !== null && nearestState\.owner === liveOwner/)
  })

  it('the position nearestKm derives from IS account-scoped -- the deferred question is answered', () => {
    // REFRESHED, with its conclusion REVERSED on purpose. Two earlier forms of this case
    // were wrong in opposite directions. The first was titled "the geolocation state
    // really is device-scoped, not account-scoped" and sliced 400 characters from the
    // first `setNearestKm` -- landing on the declaration and a neighbouring doc comment,
    // not on the derivation it claimed to judge. The second withdrew that conclusion but
    // still asserted the derivation names NO identity, and deferred the real question:
    // whether the hook's IN-MEMORY coords survive an identity change in an open mount
    // was called "a separate subsystem, reported for its own lot".
    //
    // That lot has run, and the answer was yes -- they did survive. So the derivation now
    // names the owner it was computed FOR, and this case asserts the OPPOSITE of what it
    // used to: the write site MUST mention the identity. That is the fix, not a drift.
    const src = executable(read(PAGE))
    // the hook is handed the live identity; it does not read a session itself, because one
    // of its five callers renders with no SessionProvider at all
    expect(src).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(liveOwner\)/)
    // ONE write site, counted -- a second could stamp a different owner, or none, without
    // moving any assertion below (a toMatch is satisfied by whichever occurrence matches)
    expect(src.split('setNearestState(').length - 1,
      'exactly one write site: a second could skip the stamp unseen').toBe(1)
    // and it stamps the owner the request was issued for, so a response landing after an
    // account change cannot be attributed to whoever happens to be live when it arrives
    expect(src).toMatch(
      /setNearestState\(\{ owner: requestOwner, km: typeof d\.nearestKm === 'number' \? d\.nearestKm : null \}\)/,
    )
    // the read is gated on that stamp matching the live owner, in RENDER -- not in an
    // effect, which would run only after the first frame had already painted A's distance
    expect(src).toMatch(
      /const nearestKm = liveOwner !== null && nearestState\.owner === liveOwner \? nearestState\.km : null/,
    )
    // the reverse-geocoded label is still rendered here -- now gated at the source, since
    // the hook returns `coords` only while the owner it was captured for is the live one
    expect(src).toMatch(/\{coords\?\.label && <span>\{coords\.label\}<\/span>\}/)
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


// ══════════════════════════════════════════════════════════════════════════════
// REVIEW ROUND — what an independent adversarial pass found in this suite
// ══════════════════════════════════════════════════════════════════════════════
//
// Twenty findings confirmed. Most were here, in the proofs, not in the page — and the
// worst of them was that THE SUITE STAYS GREEN AGAINST A REAL RE-LEAK. The inventory
// below enumerates `useState` tuples whose setter is named `set*`, so a `useRef`, a
// module-level `let`, or the very same useState with a setter called `assignLeak` all
// escape it. A reviewer inserted a useRef holding the fetched cards and rendered
// `{leakRef.current[0].restaurantName}` on the first frame — exactly the P1 this lot
// fixes, in a different container — and the suite reported 25/25.
//
// THE LESSON, and it generalises past this file: an enumeration over CONTAINERS can
// always be escaped by choosing another container. An enumeration over the DATA cannot:
// a leak has to READ a field to paint it. So the closed set below is over the field
// names, not over the state names.

describe('the review round — closed over the DATA, not over the container', () => {
  const src = executable(read(PAGE))

  /** Every trimmed line of the real file that names a field, in order. */
  const linesNaming = (field: string) =>
    src.split('\n').filter((l) => new RegExp(`(?<![\\w$])${field}(?![\\w$])`).test(l)).map((l) => l.trim())

  it('CLOSED ENUMERATION over restaurantName — a second holder cannot paint it', () => {
    expect(linesNaming('restaurantName')).toEqual([
      'restaurantName: string',                                     // the interface
      'id: string; restaurantName: string; itemsCount: number; total: number; restaurantId?: string', // the cast
      'out.push({ id: c.id, restaurantName: c.restaurantName, itemsCount: c.itemsCount, total: c.total, restaurantId: c.restaurantId })',
      '<b>{o.restaurantName}</b>',                                  // inside recent.map, the ONLY render
    ])
  })

  it('CLOSED ENUMERATION over itemsCount and the euro total', () => {
    expect(linesNaming('itemsCount')).toEqual([
      'itemsCount: number',
      'id: string; restaurantName: string; itemsCount: number; total: number; restaurantId?: string',
      'out.push({ id: c.id, restaurantName: c.restaurantName, itemsCount: c.itemsCount, total: c.total, restaurantId: c.restaurantId })',
      "<span>{t('itemsAndTotal', { count: o.itemsCount, total: formatEuros(o.total, locale) })}</span>",
    ])
  })

  it('CLOSED ENUMERATION over restaurantId — the link B must never be able to follow', () => {
    expect(linesNaming('restaurantId')).toEqual([
      'restaurantId?: string',
      'id: string; restaurantName: string; itemsCount: number; total: number; restaurantId?: string',
      'const k = c.restaurantId ?? c.id',                           // the de-dup key
      'out.push({ id: c.id, restaurantName: c.restaurantName, itemsCount: c.itemsCount, total: c.total, restaurantId: c.restaurantId })',
      'onClick={() => o.restaurantId && router.push(`/eat/r/${o.restaurantId}`)}',
      'style={o.restaurantId ? { backgroundImage: `url(${getRestaurantCover(o.restaurantId)})` } : undefined}',
    ])
  })

  it('…and there is NO other container that could hold the cards', () => {
    // The three the reviewer actually used to escape the useState inventory.
    expect(src).not.toMatch(/useRef/)
    expect(src.split('\n').filter((l) => /^let /.test(l)), 'module-level mutable state').toEqual([])
    // exactly ONE piece of state is typed to hold the cards
    expect((src.match(/useState<\{ owner: string \| null; cards: RecentOrder\[\] \}>/g) ?? []).length).toBe(1)
    // FOUR mentions of the card array type, counted not guessed: twice on the NO_RECENT
    // line (the annotation and the cast), once in the state's type, once on the local the
    // de-dup loop fills. A fifth would be a new holder.
    expect((src.match(/RecentOrder\[\]/g) ?? []).length, 'every mention of the card array type').toBe(4)
    expect(src).toMatch(/const NO_RECENT: RecentOrder\[\] = Object\.freeze\(\[\]\) as unknown as RecentOrder\[\]/)
    expect(src).toMatch(/const out: RecentOrder\[\] = \[\]/)
  })

  it('CLOSED ENUMERATION over the WRITE sites, not only the reads', () => {
    // Case S closes the READ side. A reviewer added a commit site stamped for the wrong
    // owner and the suite stayed green, because nothing enumerated the writes.
    const writes = src.split('\n').filter((l) => /setRecentState\(/.test(l)).map((l) => l.trim())
    expect(writes).toEqual([
      'setRecentState({ owner: null, cards: [] })',                 // no usable identity
      'setRecentState({ owner: null, cards: [] })',                 // the drop, before the request
      'setRecentState({ owner: requestOwner, cards: out })',        // the only commit of data
    ])
    // the only commit of DATA is stamped with the captured owner, never with anything else
    expect((src.match(/setRecentState\(\{ owner: requestOwner/g) ?? []).length).toBe(1)
    expect(src).not.toMatch(/setRecentState\(\{ owner: liveOwner/)
    expect(src).not.toMatch(/setRecentState\(\{ owner: favsOwner/)
  })

  it('the gate is pinned WHOLE, so widening the identity cannot stay green', () => {
    // The earlier pins were prefix matches (`const recent = liveOwner !== null`), which
    // survive dropping the guest term or the stamp comparison. Both halves are pinned as
    // one expression now.
    expect(src).toMatch(
      /const recent = liveOwner !== null && liveOwner !== 'guest' && recentState\.owner === liveOwner\s*\n\s*\? recentState\.cards\s*\n\s*: NO_RECENT/,
    )
    expect(src).toMatch(
      /if \(liveOwner === null \|\| liveOwner === 'guest'\) \{\s*\n\s*setRecentState\(\{ owner: null, cards: \[\] \}\)\s*\n\s*return\s*\n\s*\}/,
    )
  })

  it('ANGLE 3 — what is guaranteed in the window before the effect runs', () => {
    // The project owner is right that the drop happens in the EFFECT, after the B render
    // has committed, so the data is NOT removed at the same instant the session changes.
    // The model now has React's two phases, so the window exists and can be asserted
    // honestly instead of being collapsed away.
    const p = makePage()
    p.turn('authenticated', A)
    p.requests[0].resolve(A_CARDS)
    expect(p.turn('authenticated', A).cards).toHaveLength(2)

    // THE FRAME ITSELF: render for B, nothing else has run yet.
    const frame = p.render('authenticated', B)
    expect(frame.effectPending).toBe(true)        // the effect has NOT run
    expect(frame.cards).toEqual([])               // …and nothing of A's is shown
    expect(frame.sectionShown).toBe(false)
    expect(frame.raw.owner).toBe(`u:${A}`)        // it IS still held — stated, not hidden
    expect(JSON.stringify(frame.raw)).toContain(A_RESTAURANT)

    // What makes that harmless is the gate, and the fact that no card exists to carry a
    // handler: the row is built by recent.map over the GATED value.
    expect(src).toMatch(/\{recent\.map\(\(o, i\) => \(/)
    expect(src).toMatch(/onClick=\{\(\) => o\.restaurantId && router\.push\(`\/eat\/r\/\$\{o\.restaurantId\}`\)\}/)

    // …and then the effect runs and it is physically gone.
    p.flushEffects()
    const after = p.render('authenticated', B)
    expect(after.raw).toEqual({ owner: null, cards: [] })
    expect(JSON.stringify(after)).not.toContain(A_RESTAURANT)
  })

  it('ANGLE 2/6 — a late response for A commits, and the GATE is what makes it harmless', () => {
    // The page comment used to claim the cleanup disowns A's request « before it can
    // resolve ». React flushes passive effects after paint, so a response landing between
    // the B commit and the effect still has alive === true and still commits. Asserting
    // the real behaviour rather than the comfortable one.
    const p = makePage()
    p.turn('authenticated', A)
    const frame = p.render('authenticated', B)    // committed, effects not flushed
    expect(frame.effectPending).toBe(true)
    p.requests[0].resolve(A_CARDS)                // A's response lands in the window
    const stillB = p.render('authenticated', B)
    expect(stillB.raw.owner).toBe(`u:${A}`)       // it DID commit…
    expect(stillB.cards).toEqual([])              // …and it is invisible, by the stamp
    expect(stillB.sectionShown).toBe(false)
    // the source now names the right mechanism
    expect(read(PAGE)).toContain('WHAT ACTUALLY GUARANTEES SAFETY HERE')
    expect(read(PAGE)).not.toMatch(/disowned before it can\s*\n?\s*\/\/ resolve/)
  })

  it('A → B → C with three requests in flight: no owner ever sees another\'s row', () => {
    const C = 'user-C'
    const p = makePage()
    p.turn('authenticated', A)
    p.turn('authenticated', B)
    p.turn('authenticated', C)
    expect(p.requests.map((r) => r.forOwner)).toEqual([`u:${A}`, `u:${B}`, `u:${C}`])
    // every arrival order, with C live throughout
    p.requests[1].resolve(B_CARDS)
    expect(p.render('authenticated', C).cards).toEqual([])
    p.requests[0].resolve(A_CARDS)
    expect(p.render('authenticated', C).cards).toEqual([])
    p.requests[2].resolve([{ id: 'order-C-1', restaurantName: 'Chez C', itemsCount: 1, total: 5, restaurantId: 'resto-C' }])
    const asC = p.render('authenticated', C)
    expect(asC.cards.map((c) => c.id)).toEqual(['order-C-1'])
    expect(JSON.stringify(asC)).not.toContain(A_RESTAURANT)
    expect(JSON.stringify(asC)).not.toContain('Chez B')
  })

  it('the component body is located by an assertion that can actually fail', () => {
    // `expect(body.length).toBeGreaterThan(0)` could never fail: an indexOf miss yields
    // slice(-1), whose length is 1. The -1 trap, for the third time in this project.
    const i = src.indexOf('export default function HomeScreen')
    expect(i, 'the component body anchor moved — the inventory would be vacuous').toBeGreaterThan(-1)
  })
})
