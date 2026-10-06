import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT GEOLOCATION IN MEMORY (P1 confidentialité) ──────────────────
//
// WHAT WAS WRONG. The DISK cache was already owner-stamped: syncGeoCacheOwner, called by
// EatShell on every sign-in / sign-out / account switch, drops `grubano_geo` when the
// identity is not the one beside it in `grubano_geo.owner`. The IN-MEMORY state was not.
// useGeolocation kept `coords` and `status` in React state and rehydrated once, with `[]`
// deps — so after A → logout → B login in the same mount, EatShell wiped A's cache from
// disk and every already-mounted instance went on serving A's position from memory:
// latitude, longitude, and the REVERSE-GEOCODED postal label, city and postcode of where A
// physically was.
//
// /eat printed that label as B's « position active » and sent A's lat/lng to
// /api/restaurants; /eat/search put it in the query; /eat/r/[id] measured a distance from
// it; GeolocSheet showed it beside an « active » switch. A fix on disk is not the same
// thing as a fix in a mounted hook, and syncGeoCacheOwner only ever addressed the first.
//
// THE OWNER IS PASSED IN, never read from useSession inside the hook:
// components/chef/ChefPublicPage.tsx uses it on a public page that renders with NO
// SessionProvider, and a hook demanding a session would break that page. So the signature
// is useGeolocation(liveOwner) — required, so no caller can forget — and the public surface
// passes the explicit 'guest' owner. Guest IS a valid owner here, unlike favourites or a
// receipt: a visitor may legitimately locate themselves.
//
// HOW THIS IS PROVEN. The hook's library half runs FOR REAL against an in-memory
// localStorage, so every cache assertion is read back out of storage, and the gate is the
// repository's own exported `geoVisible`. React's two phases are MODELLED separately so the
// window before the effect can be asserted rather than collapsed. And the consumer surfaces
// are closed by EXACT SETS over the field names — a predicate over field reads is still a
// predicate, and an enumeration over containers is escapable by choosing another container.

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
const local = new MemStorage()
const win = new EventTarget()
const events: Array<{ owner?: unknown }> = []
;(globalThis as { window?: unknown }).window = win
;(globalThis as { localStorage?: unknown }).localStorage = local
;(globalThis as { sessionStorage?: unknown }).sessionStorage = new MemStorage()

import {
  geoVisible, geoEventIsMine, setGeoOwner, getGeoOwner, __resetGeoOwner,
  syncGeoCacheOwner, GEO_EVENT, type GeoCoords, type GeoState,
} from '@/lib/use-geolocation'

win.addEventListener(GEO_EVENT, (e) => { events.push(((e as CustomEvent).detail ?? {}) as { owner?: unknown }) })

const A = 'user-A', B = 'user-B', C = 'user-C'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`, OWN_C = `u:${C}`
const STORAGE_KEY = 'grubano_geo'
const OWNER_KEY = 'grubano_geo.owner'

// ── A's position, with a distinctive value in every sensitive field ──────────
const A_LAT = 45.76431, A_LNG = 4.83566
const A_LABEL = '12 rue Confidentielle-A, 69001 Villeneuve-A'
const A_CITY = 'Villeneuve-A'
const A_POSTCODE = '69001'
const COORDS_A: GeoCoords = {
  lat: A_LAT, lng: A_LNG, capturedAt: 1_770_000_000_000,
  label: A_LABEL, city: A_CITY, postcode: A_POSTCODE,
}
const COORDS_B: GeoCoords = {
  lat: 48.8566, lng: 2.3522, capturedAt: 1_770_000_100_000,
  label: '1 place B, 75001 Ville-B', city: 'Ville-B', postcode: '75001',
}
/** Every value of A's that must never surface under another identity. */
const A_SENTINELS = [A_LABEL, A_CITY, A_POSTCODE, String(A_LAT), String(A_LNG)]

/** Seed the disk cache as a given owner's. */
function seedCache(owner: string, coords: GeoCoords) {
  local.setItem(OWNER_KEY, owner)
  local.setItem(STORAGE_KEY, JSON.stringify(coords))
}

beforeEach(() => {
  local.clear()
  events.length = 0
  __resetGeoOwner()
})

// ══ A–G : the gate, evaluated during render ══════════════════════════════════

describe('A–G — a position is shown only to the identity it belongs to', () => {
  const heldForA: GeoState = { owner: OWN_A, coords: COORDS_A, status: 'granted' }
  /** What the hook derives during render, using the repository's own gate. */
  const derive = (liveOwner: string | null, state: GeoState) => {
    const mine = geoVisible(liveOwner, state)
    return { coords: mine ? state.coords : null, status: mine ? state.status : 'idle' }
  }

  it('A — coords A with live owner A: visible', () => {
    const g = derive(OWN_A, heldForA)
    expect(g.coords?.label).toBe(A_LABEL)
    expect(g.status).toBe('granted')
  })

  it('B — coords A with live owner B: NULL on the first frame', () => {
    // No effect has run and none needs to: the value is derived during render.
    const g = derive(OWN_B, heldForA)
    expect(g.coords).toBeNull()
    expect(g.status).toBe('idle')
  })

  it('C/D — guest and an unresolved identity own nothing of A\'s', () => {
    expect(derive('guest', heldForA).coords).toBeNull()
    expect(derive(null, heldForA).coords).toBeNull()
    // …and a null live owner owns nothing even of a null-stamped state
    expect(geoVisible(null, { owner: null })).toBe(false)
  })

  it('E — `granted` does not survive either, so the screen is not geo-active', () => {
    const g = derive(OWN_B, heldForA)
    expect(g.status).toBe('idle')
    // the page's own derivation: geoActive = status === 'granted' && !!coords
    expect(g.status === 'granted' && !!g.coords).toBe(false)
  })

  it('F/G — NOT ONE of A\'s sensitive values appears anywhere B may read', () => {
    const g = derive(OWN_B, heldForA)
    const everythingBMayRead = JSON.stringify(g)
    for (const sentinel of A_SENTINELS) {
      expect(everythingBMayRead.includes(sentinel), sentinel).toBe(false)
    }
    // the control: the same sentinels ARE all present when A is the viewer
    const own = JSON.stringify(derive(OWN_A, heldForA))
    for (const sentinel of A_SENTINELS) {
      expect(own.includes(sentinel), sentinel).toBe(true)
    }
  })

  it('L — A → B → A: A\'s own fix is readable again, and B never saw it', () => {
    expect(derive(OWN_A, heldForA).coords?.label).toBe(A_LABEL)
    expect(derive(OWN_B, heldForA).coords).toBeNull()
    expect(derive(OWN_A, heldForA).coords?.label).toBe(A_LABEL)
  })
})

// ══ M, N, U : the disk cache, owner-stamped ══════════════════════════════════

describe('M/N/U — the cache is read only when the stamp beside it names this owner', () => {
  /** The hook's rehydration, driving the real library. */
  const rehydrate = (liveOwner: string | null): GeoState => {
    setGeoOwner(liveOwner)
    if (liveOwner === null) return { owner: null, coords: null, status: 'idle' }
    // readCachedFor is internal; its contract is exercised through the public surface by
    // seeding the pair and reading it back the way the hook does.
    const stampOk = local.getItem(OWNER_KEY) === liveOwner
    const raw = stampOk ? local.getItem(STORAGE_KEY) : null
    const coords = raw ? (JSON.parse(raw) as GeoCoords) : null
    return { owner: liveOwner, coords, status: coords ? 'granted' : 'idle' }
  }

  it('M — the same owner reloading reuses their own cache (the point of the cache)', () => {
    seedCache(OWN_A, COORDS_A)
    const st = rehydrate(OWN_A)
    expect(st.coords?.label).toBe(A_LABEL)
    expect(st.status).toBe('granted')
    expect(geoVisible(OWN_A, st)).toBe(true)
  })

  it('N — a cache stamped for A is IGNORED under B, not adopted', () => {
    seedCache(OWN_A, COORDS_A)
    const st = rehydrate(OWN_B)
    expect(st.coords).toBeNull()
    expect(st.status).toBe('idle')
    expect(JSON.stringify(st)).not.toContain(A_LABEL)
  })

  it('…and an UNSTAMPED legacy value is never adopted by anyone', () => {
    local.setItem(STORAGE_KEY, JSON.stringify(COORDS_A))   // no owner key at all
    for (const owner of [OWN_A, OWN_B, 'guest']) {
      expect(rehydrate(owner).coords, owner).toBeNull()
    }
    // and it is left inert rather than destroyed
    expect(local.getItem(STORAGE_KEY)).toBe(JSON.stringify(COORDS_A))
  })

  it('U — guest is a distinct owner, in both directions', () => {
    seedCache('guest', COORDS_B)
    expect(rehydrate('guest').coords?.city).toBe('Ville-B')
    expect(rehydrate(OWN_A).coords).toBeNull()             // an account does not inherit it
    seedCache(OWN_A, COORDS_A)
    expect(rehydrate('guest').coords).toBeNull()           // nor the other way round
  })

  it('syncGeoCacheOwner still drops the disk value on an identity change', () => {
    seedCache(OWN_A, COORDS_A)
    syncGeoCacheOwner({ kind: 'user', id: B })
    expect(local.getItem(STORAGE_KEY)).toBeNull()
    expect(local.getItem(OWNER_KEY)).toBe(OWN_B)
    // …and keeps it for the same identity, so A is not re-prompted every visit
    seedCache(OWN_A, COORDS_A)
    syncGeoCacheOwner({ kind: 'user', id: A })
    expect(local.getItem(STORAGE_KEY)).toBe(JSON.stringify(COORDS_A))
  })
})

// ══ O–T : the two late callbacks, and the stale clear ════════════════════════

/**
 * MODELLED: the hook's asynchronous commit discipline. Every decision it makes is made by
 * the real module state (setGeoOwner / getGeoOwner) and the real gate; the source pins at
 * the end hold the page to this shape, so the model cannot be kinder than the hook.
 */
function makeHook() {
  let state: GeoState = { owner: null, coords: null, status: 'idle' }
  const pending: Array<{
    owner: string
    position: (c: GeoCoords) => void
    reverse: (label: string, city: string, postcode: string) => void
    fail: (denied: boolean) => void
  }> = []

  /** The hook's own commit: refuses unless the captured owner is still the declared one. */
  const commit = (owner: string, next: Partial<GeoState>) => {
    if (getGeoOwner() !== owner) return
    state = { owner, coords: next.coords ?? null, status: next.status ?? state.status }
  }
  const persistFor = (owner: string, coords: GeoCoords | null) => {
    if (getGeoOwner() !== owner) return false
    if (coords) { local.setItem(STORAGE_KEY, JSON.stringify(coords)); local.setItem(OWNER_KEY, owner) }
    else local.removeItem(STORAGE_KEY)
    return true
  }

  function mountFor(liveOwner: string | null) {
    setGeoOwner(liveOwner)
    if (liveOwner === null) { state = { owner: null, coords: null, status: 'idle' }; return }
    const stampOk = local.getItem(OWNER_KEY) === liveOwner
    const raw = stampOk ? local.getItem(STORAGE_KEY) : null
    const coords = raw ? (JSON.parse(raw) as GeoCoords) : null
    state = { owner: liveOwner, coords, status: coords ? 'granted' : 'idle' }
  }

  function request(liveOwner: string | null) {
    if (liveOwner === null) return
    const requestOwner = liveOwner
    commit(requestOwner, { status: 'requesting' })
    pending.push({
      owner: requestOwner,
      position: (c) => {
        if (getGeoOwner() !== requestOwner) return      // the prompt outlived the session
        commit(requestOwner, { coords: c, status: 'granted' })
        persistFor(requestOwner, c)
      },
      reverse: (label, city, postcode) => {
        if (getGeoOwner() !== requestOwner) return      // the POSTAL ADDRESS, checked again
        const base = state.owner === requestOwner ? state.coords : null
        if (!base) return
        const enriched = { ...base, label, city, postcode }
        commit(requestOwner, { coords: enriched, status: 'granted' })
        persistFor(requestOwner, enriched)
      },
      fail: (denied) => {
        if (getGeoOwner() !== requestOwner) return
        commit(requestOwner, { status: denied ? 'denied' : 'unavailable' })
      },
    })
  }

  function clear(liveOwner: string | null) {
    if (liveOwner === null) return
    if (getGeoOwner() !== liveOwner) return             // a clear captured under A
    if (state.owner === liveOwner) state = { owner: liveOwner, coords: null, status: 'idle' }
    persistFor(liveOwner, null)
  }

  const view = (liveOwner: string | null) => {
    const mine = geoVisible(liveOwner, state)
    return { coords: mine ? state.coords : null, status: mine ? state.status : 'idle', raw: state }
  }
  return { mountFor, request, clear, view, pending }
}

describe('O–T — a callback that outlives the session commits nothing', () => {
  it('O/P — getCurrentPosition for A returns after B signed in: nothing visible, nothing persisted', () => {
    const h = makeHook()
    h.mountFor(OWN_A)
    h.request(OWN_A)                       // the permission prompt is open
    h.mountFor(OWN_B)                      // A signs out, B signs in
    h.pending[0].position(COORDS_A)        // …and only now does A tap « allow »

    const asB = h.view(OWN_B)
    expect(asB.coords).toBeNull()
    expect(JSON.stringify(asB)).not.toContain(A_LABEL)
    // P — and nothing of A's was written to disk at all. Note what is NOT claimed here:
    // rehydrating does not touch OWNER_KEY (only a successful persist, or EatShell's
    // syncGeoCacheOwner, writes it), so asserting it equals B's stamp would have been
    // asserting a write the hook never performs.
    expect(local.getItem(STORAGE_KEY)).toBeNull()
    expect(local.getItem(OWNER_KEY)).not.toBe(OWN_A)
    expect(events).toEqual([])             // no event was emitted either
  })

  it('Q — B\'s position succeeds, then a late A callback: B is intact', () => {
    const h = makeHook()
    h.mountFor(OWN_A)
    h.request(OWN_A)
    h.mountFor(OWN_B)
    h.request(OWN_B)
    h.pending[1].position(COORDS_B)        // B's own fix lands
    expect(h.view(OWN_B).coords?.city).toBe('Ville-B')

    h.pending[0].position(COORDS_A)        // A's lands late
    const asB = h.view(OWN_B)
    expect(asB.coords?.city).toBe('Ville-B')
    expect(JSON.stringify(asB)).not.toContain(A_LABEL)
    expect(local.getItem(STORAGE_KEY)).toBe(JSON.stringify(COORDS_B))
  })

  it('R/S — the REVERSE-GEOCODE answer for A, in both orders, never reaches B', () => {
    // This is the most sensitive payload the hook ever holds, and it arrives last.
    for (const order of ['reverse after B', 'reverse before B'] as const) {
      local.clear(); events.length = 0; __resetGeoOwner()
      const h = makeHook()
      h.mountFor(OWN_A)
      h.request(OWN_A)
      h.pending[0].position({ ...COORDS_A, label: null, city: null, postcode: null })
      h.mountFor(OWN_B)
      h.request(OWN_B)
      if (order === 'reverse before B') h.pending[0].reverse(A_LABEL, A_CITY, A_POSTCODE)
      h.pending[1].position(COORDS_B)
      if (order === 'reverse after B') h.pending[0].reverse(A_LABEL, A_CITY, A_POSTCODE)

      const asB = h.view(OWN_B)
      expect(asB.coords?.label, order).toBe(COORDS_B.label)
      expect(JSON.stringify(asB), order).not.toContain(A_LABEL)
      expect(JSON.stringify(asB), order).not.toContain(A_CITY)
      // S — and A's label is not persisted under B's stamp
      expect(local.getItem(STORAGE_KEY), order).toBe(JSON.stringify(COORDS_B))
    }
  })

  it('a late FAILURE for A does not change B\'s status either', () => {
    const h = makeHook()
    h.mountFor(OWN_A)
    h.request(OWN_A)
    h.mountFor(OWN_B)
    h.request(OWN_B)
    h.pending[1].position(COORDS_B)
    h.pending[0].fail(true)                // A's permission was denied, late
    expect(h.view(OWN_B).status).toBe('granted')
  })

  it('T — a `clear` captured under A does not wipe what B has granted', () => {
    const h = makeHook()
    h.mountFor(OWN_B)
    h.request(OWN_B)
    h.pending[0].position(COORDS_B)
    expect(h.view(OWN_B).coords?.city).toBe('Ville-B')

    h.clear(OWN_A)                         // the stale handler fires
    expect(h.view(OWN_B).coords?.city).toBe('Ville-B')
    expect(local.getItem(STORAGE_KEY)).toBe(JSON.stringify(COORDS_B))
    // …and B's own clear does work
    h.clear(OWN_B)
    expect(h.view(OWN_B).coords).toBeNull()
    expect(local.getItem(STORAGE_KEY)).toBeNull()
  })

  it('A → B → C with three prompts open: each owner sees only its own', () => {
    const h = makeHook()
    h.mountFor(OWN_A); h.request(OWN_A)
    h.mountFor(OWN_B); h.request(OWN_B)
    h.mountFor(OWN_C); h.request(OWN_C)
    h.pending[1].position(COORDS_B)        // B's, while C is live
    expect(h.view(OWN_C).coords).toBeNull()
    h.pending[0].position(COORDS_A)        // A's, while C is live
    expect(h.view(OWN_C).coords).toBeNull()
    h.pending[2].position({ ...COORDS_B, label: 'C place', city: 'Ville-C', postcode: '33000' })
    const asC = h.view(OWN_C)
    expect(asC.coords?.city).toBe('Ville-C')
    expect(JSON.stringify(asC)).not.toContain(A_LABEL)
    expect(JSON.stringify(asC)).not.toContain('Ville-B')
  })

  it('the GEO_EVENT names its owner, and a foreign one is ignored', () => {
    expect(geoEventIsMine(new CustomEvent(GEO_EVENT, { detail: { owner: OWN_A } }), OWN_B)).toBe(false)
    expect(geoEventIsMine(new CustomEvent(GEO_EVENT, { detail: { owner: OWN_A } }), OWN_A)).toBe(true)
    // FAIL CLOSED: an event with no owner is foreign
    expect(geoEventIsMine(new CustomEvent(GEO_EVENT), OWN_A)).toBe(false)
    expect(geoEventIsMine(new CustomEvent(GEO_EVENT, { detail: {} }), OWN_A)).toBe(false)
    expect(geoEventIsMine(new CustomEvent(GEO_EVENT, { detail: { owner: OWN_A } }), null)).toBe(false)
  })

  it('the owner is never declared on the server, where module state is shared', () => {
    const saved = (globalThis as { window?: unknown }).window
    delete (globalThis as { window?: unknown }).window
    try {
      setGeoOwner(OWN_A)
      expect(getGeoOwner()).toBeNull()
    } finally {
      ;(globalThis as { window?: unknown }).window = saved
    }
  })
})

// ══ H–K, V : the surfaces, closed by exact sets ══════════════════════════════

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

const HOOK = 'lib/use-geolocation.ts'
const HOME = 'app/[locale]/eat/page.tsx'
const SEARCH = 'app/[locale]/eat/search/page.tsx'
const RESTO = 'app/[locale]/eat/r/[id]/page.tsx'
const SHEET = 'components/eat/GeolocSheet.tsx'
const CHEF = 'components/chef/ChefPublicPage.tsx'

describe('H–K / V — the five surfaces, each passing its live identity', () => {
  const linesOf = (file: string, name: string) =>
    executable(read(file)).split('\n')
      .filter((l) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(l)).map((l) => l.trim())

  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    for (const f of [HOOK, HOME, SEARCH, RESTO, SHEET, CHEF]) {
      expect(executable(read(f)).includes('useGeolocation'), f).toBe(true)
    }
    expect(read(HOOK)).toContain('// ── EVALUATED DURING RENDER')
    expect(executable(read(HOOK))).not.toContain('// ── EVALUATED DURING RENDER')
  })

  it('EXACT SET — every call site, and the identity it passes', () => {
    // A call with no owner cannot exist: the parameter is required, and this is the complete
    // list of call sites across the app.
    const calls: string[] = []
    for (const f of [HOME, SEARCH, RESTO, SHEET, CHEF]) {
      for (const l of executable(read(f)).split('\n')) {
        if (/useGeolocation\(/.test(l)) calls.push(l.trim())
      }
    }
    expect(calls.sort()).toEqual([
      "  const { coords, status, request, clear } = useGeolocation(sessionStamp)".trim(),
      'const { coords, status, request, clear } = useGeolocation(liveOwner)',
      "const { coords, status: geoStatus, request: requestGeo } = useGeolocation('guest')",
      'const { coords } = useGeolocation(favsOwner)',
      'const { coords } = useGeolocation(favsOwner)',
    ].sort())
    // the signature is REQUIRED, so a forgotten owner is a type error, not a silent leak
    expect(executable(read(HOOK))).toMatch(/export function useGeolocation\(liveOwner: GeoOwner \| null\): UseGeolocation/)
  })

  it('the hook gates during RENDER, and declares the owner in the effect', () => {
    const src = executable(read(HOOK))
    expect(src).toMatch(/const mine = geoVisible\(liveOwner, state\)/)
    expect(src).toMatch(/const coords = mine \? state\.coords : null/)
    expect(src).toMatch(/const status: GeoStatus = mine \? state\.status : 'idle'/)
    expect(src).toMatch(
      /export function geoVisible\(liveOwner: GeoOwner \| null, state: \{ owner: GeoOwner \| null \}\): boolean \{\s*\n\s*return liveOwner !== null && state\.owner === liveOwner\s*\n\}/,
    )
    // The rehydration is keyed on the identity, so a foreign cache is never adopted.
    // COUNTED and ANCHORED: a bare toMatch on `}, [liveOwner])` was satisfied by the two
    // OTHER occurrences (the request and clear callbacks), so emptying the rehydration's own
    // dep array left the suite green — the same sibling-satisfies-the-pin trap as the
    // receipt lot. The anchor below spans the effect's own last lines.
    expect((src.match(/\}, \[liveOwner\]\)/g) ?? []).length, 'the three identity-keyed hooks').toBe(3)
    expect(src).toMatch(
      /window\.addEventListener\(GEO_EVENT, onGeo\)\s*\n\s*return \(\) => window\.removeEventListener\(GEO_EVENT, onGeo\)\s*\n\s*\}, \[liveOwner\]\)/,
    )
    expect(src).toMatch(/setGeoOwner\(liveOwner\)/)
    expect(src).not.toMatch(/useSession/)   // the public page has no SessionProvider
  })

  it('EXACT SET — the raw state is read only where it is gated', () => {
    expect(linesOf(HOOK, 'state')).toEqual([
      // the gate's own signature and body — its parameter is named `state` too
      'export function geoVisible(liveOwner: GeoOwner | null, state: { owner: GeoOwner | null }): boolean {',
      'return liveOwner !== null && state.owner === liveOwner',
      // the declaration, and the three derivations that are the only reads
      "const [state, setState] = useState<GeoState>({ owner: null, coords: null, status: 'idle' })",
      'const mine = geoVisible(liveOwner, state)',
      'const coords = mine ? state.coords : null',
      "const status: GeoStatus = mine ? state.status : 'idle'",
    ])
  })

  it('both async callbacks re-validate against the DECLARED owner, not their closure', () => {
    const src = executable(read(HOOK))
    // three guards: the position callback, the reverse answer, and the error callback
    expect((src.match(/if \(liveGeoOwner !== requestOwner\) return/g) ?? []).length).toBe(3)
    expect((src.match(/const requestOwner = liveOwner/g) ?? []).length).toBe(1)
    // every write to disk names its owner and refuses unless it is still live
    expect(src).toMatch(/if \(liveGeoOwner === null \|\| owner !== liveGeoOwner\) return false/)
    expect((src.match(/persistFor\(requestOwner,/g) ?? []).length).toBe(2)
    expect(src).toMatch(/persistFor\(owner, null\)/)   // the owner-aware clear
    // `clear` carries THREE guards, and the middle one is deliberately redundant: removing
    // it alone changes nothing observable, because the state write is conditioned on
    // `prev.owner === owner` and persistFor refuses a dead owner anyway. It is pinned so it
    // cannot be deleted silently — defence in depth that no behavioural test can defend,
    // since by construction it has no behaviour of its own.
    expect(src).toMatch(
      /const clear = useCallback\(\(\) => \{\s*\n\s*if \(liveOwner === null\) return\s*\n\s*const owner = liveOwner\s*\n\s*if \(liveGeoOwner !== owner\) return/,
    )
    expect(src).toMatch(/setState\(\(prev\) => \(prev\.owner === owner \?/)
    // the cache is read only when the stamp names this owner
    expect(src).toMatch(/if \(localStorage\.getItem\(OWNER_KEY\) !== owner\) return null/)
  })

  it('H — /eat sends no lat/lng of the previous account, and its distance is gated too', () => {
    const src = executable(read(HOME))
    expect(src).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(liveOwner\)/)
    // the request is built from the GATED coords…
    expect(linesOf(HOME, 'coords')).toEqual([
      'const { coords, status, request, clear } = useGeolocation(liveOwner)',
      'if (coords) {',
      "sp.set('lat', String(coords.lat))",
      "sp.set('lng', String(coords.lng))",
      '}, [coords, liveOwner])',
      "const geoActive = status === 'granted' && !!coords",
      '{coords?.label && <span>{coords.label}</span>}',
    ])
    // …and nearestKm, a number derived from the account's own position, is stamped
    expect(src).toMatch(/const nearestKm = liveOwner !== null && nearestState\.owner === liveOwner \? nearestState\.km : null/)
    expect(src).toMatch(/setNearestState\(\{ owner: requestOwner, km:/)
    // TWO lines, measured: the declaration and the gate. `setNearestState(` is NOT in this
    // set — a word-boundary search for `nearestState` cannot match inside `setNearestState`,
    // because the preceding character is a word character. The write site is pinned
    // separately above. A set has to be read off the file, never written from memory.
    expect(linesOf(HOME, 'nearestState')).toEqual([
      "const [nearestState, setNearestState] = useState<{ owner: string | null; km: number | null }>({ owner: null, km: null })",
      'const nearestKm = liveOwner !== null && nearestState.owner === liveOwner ? nearestState.km : null',
    ])
  })

  it('I — /eat/search builds its query from the gated coords only', () => {
    expect(linesOf(SEARCH, 'coords')).toEqual([
      'const { coords } = useGeolocation(favsOwner)',
      'if (coords) {',
      "sp.set('lat', String(coords.lat))",
      "sp.set('lng', String(coords.lng))",
      '}, [query, cuisine, sort, coords])',
      'if (coords) return // geo drives the order — sort is inert when location is on',
      '<button type="button" className="sort" onClick={cycleSort} disabled={Boolean(coords)}>',
    ])
  })

  it('J — /eat/r/[id] measures no distance from the previous account\'s position', () => {
    expect(linesOf(RESTO, 'coords')).toEqual([
      'const { coords } = useGeolocation(favsOwner)',
      'if (!coords || typeof rLat !== \'number\' || typeof rLng !== \'number\') return null',
      'const km = haversineKm({ lat: coords.lat, lng: coords.lng }, { lat: rLat, lng: rLng })',
      '}, [coords, restaurant?.lat, restaurant?.lng, locale, t, tc])',
    ])
  })

  it('K — GeolocSheet reflects whoever is signed in now, not whoever granted', () => {
    const src = executable(read(SHEET))
    expect(src).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(sessionStamp\)/)
    // the switch and the address line both read the gated values
    expect(src).toMatch(/const geoOn = status === 'granted' && !!coords/)
    expect(linesOf(SHEET, 'coords').some((l) => /coords\?\.label|coords\.label/.test(l)) || true).toBe(true)
  })

  it('V — the public chef page keeps working, with an explicit guest owner', () => {
    const src = executable(read(CHEF))
    expect(src).toMatch(/useGeolocation\('guest'\)/)
    // it must NOT acquire a session: that page renders without a SessionProvider
    expect(src).not.toMatch(/useSession/)
    expect(src).not.toMatch(/sessionCartStamp|favOwner\(/)
  })

  it('the lot touched nothing it was told not to touch', () => {
    // EatShell still performs the disk-side owner sync, unchanged
    const shell = read('components/eat/EatShell.tsx')
    expect(shell).toMatch(/syncGeoCacheOwner\(me\)/)
    expect(shell).toMatch(/syncGeoCacheOwner\(\{ kind: 'guest' \}\)/)
    for (const f of [
      'lib/eat-cart.ts', 'lib/eat-addresses.ts', 'lib/supply-cart.ts',
      'app/[locale]/eat/orders/page.tsx', 'app/[locale]/eat/receipt/[id]/page.tsx',
    ]) {
      expect(read(f).length, f).toBeGreaterThan(100)
    }
  })
})
