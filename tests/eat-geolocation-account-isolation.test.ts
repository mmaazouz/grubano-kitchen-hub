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

import { sessionCartStamp } from '@/lib/eat-cart'
import { sessionAddressStamp } from '@/lib/eat-addresses'
import {
  geoVisible, geoEventIsMine, setGeoOwner, getGeoOwner, __resetGeoOwner,
  syncGeoCacheOwner, GEO_EVENT, type GeoCoords, type GeoState,
  // THE REAL DECISIONS. Nothing below restates them. An independent review proved why:
  // the model's copy of the cache read had no age limit (so it could not see that rule at
  // all) while its copy of the reverse commit had a guard the source did NOT have (so it
  // proved a safety that did not exist). A copy can be kinder or blinder than the source,
  // and either way all it proves is that the copy agrees with its author.
  geoRehydrate, geoCommit, geoStillMine, geoClear, geoInvalidateInFlight, getGeoEpoch,
  readCachedFor, persistFor,
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
// RELATIVE TO NOW, because readCachedFor really does refuse a fix older than a week and
// these fixtures are now read THROUGH it. They used to be fixed epoch values eight months
// in the past: the model that read them had no age check, so the suite could not tell that
// the cache it was asserting on would in fact have been refused by the hook.
const FRESH = Date.now() - 60_000
const COORDS_A: GeoCoords = {
  lat: A_LAT, lng: A_LNG, capturedAt: FRESH,
  label: A_LABEL, city: A_CITY, postcode: A_POSTCODE,
}
const COORDS_B: GeoCoords = {
  lat: 48.8566, lng: 2.3522, capturedAt: FRESH + 1_000,
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
  /**
   * The hook's rehydration -- THE REAL FUNCTION, not a restatement of it. This block used
   * to re-implement the stamp check, and a reviewer measured the cost: disabling the real
   * check in lib/use-geolocation.ts left every case here green, because each case was
   * checking the copy sitting next to it.
   */
  const rehydrate = (liveOwner: string | null): GeoState => {
    setGeoOwner(liveOwner)
    return geoRehydrate(liveOwner)
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
 * MODELLED: only the SEQUENCING -- which callback fires, when, and in what order. Every
 * DECISION is the repository's own exported function (geoRehydrate, geoCommit, geoClear,
 * geoStillMine, persistFor), so this model can be neither kinder nor blinder than the hook.
 * What stays modelled is legitimately a test's job: React's two phases, and holding a
 * browser permission prompt open across an identity change.
 */
function makeHook() {
  let state: GeoState = { owner: null, coords: null, status: 'idle' }
  const pending: Array<{
    owner: string
    position: (c: GeoCoords) => void
    reverse: (label: string, city: string, postcode: string) => void
    fail: (denied: boolean) => void
  }> = []

  function mountFor(liveOwner: string | null) {
    setGeoOwner(liveOwner)
    state = geoRehydrate(liveOwner)
  }

  function request(liveOwner: string | null) {
    if (liveOwner === null) return
    const requestOwner = liveOwner
    // captured together, exactly where the hook captures them
    const requestEpoch = getGeoEpoch()
    const commit = (next: Partial<GeoState>) => {
      state = geoCommit(state, requestOwner, requestEpoch, next)
    }
    // the position this request captured, held in ITS closure -- which is what makes a
    // late reverse answer able to resurrect a fix that has since been cleared
    let captured: GeoCoords | null = null
    commit({ status: 'requesting' })
    pending.push({
      owner: requestOwner,
      position: (c) => {
        if (!geoStillMine(requestOwner, requestEpoch)) return   // the prompt outlived it
        captured = c
        commit({ coords: c, status: 'granted' })
        persistFor(requestOwner, c)
      },
      reverse: (label, city, postcode) => {
        // the POSTAL ADDRESS: the most sensitive thing the hook ever holds, checked again
        if (!geoStillMine(requestOwner, requestEpoch)) return
        if (!captured) return
        const enriched: GeoCoords = { ...captured, label, city, postcode }
        commit({ coords: enriched, status: 'granted' })
        persistFor(requestOwner, enriched)
      },
      fail: (denied) => {
        if (!geoStillMine(requestOwner, requestEpoch)) return
        commit({ status: denied ? 'denied' : 'unavailable' })
      },
    })
  }

  function clear(liveOwner: string | null) {
    if (liveOwner === null) return
    state = geoClear(state, liveOwner)
    persistFor(liveOwner, null)
    geoInvalidateInFlight()
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

// ══ W–Z : what an independent adversarial review found ══════════════════════

describe('W–Z — the four defects a review proved, now closed', () => {
  beforeEach(() => { local.clear(); events.length = 0; __resetGeoOwner() })

  it('W — a fix older than the cache window is refused, for its own owner too', () => {
    // THE AGE LIMIT WAS INVISIBLE TO THIS SUITE. The fixtures were fixed epoch values eight
    // months in the past and the model that read them had no age check, so every cache case
    // was asserting on a value the real hook would have thrown away. Now the real function
    // runs, and the rule it enforces is asserted rather than bypassed.
    seedCache(OWN_A, { ...COORDS_A, capturedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 })
    setGeoOwner(OWN_A)
    expect(readCachedFor(OWN_A), 'a week-old fix is stale').toBeNull()
    expect(geoRehydrate(OWN_A).coords).toBeNull()
    expect(geoRehydrate(OWN_A).status).toBe('idle')
    // and a fresh one for the same owner still is reused — the cache has a point
    seedCache(OWN_A, COORDS_A)
    expect(geoRehydrate(OWN_A).coords?.label).toBe(A_LABEL)
  })

  it('X — « disable », then the reverse answer lands: the position does NOT come back', () => {
    // The reverse answer is built from the position captured in its own closure, so the
    // owner check alone let it through: clear() emptied the state and the disk, then the
    // answer put the position back AND rewrote the POSTAL ADDRESS to storage, undoing an
    // explicit opt-out. The epoch is what rules it out.
    const h = makeHook()
    h.mountFor(OWN_A)
    h.request(OWN_A)
    h.pending[0].position({ lat: A_LAT, lng: A_LNG, capturedAt: Date.now() })
    expect(h.view(OWN_A).coords?.lat).toBe(A_LAT)
    expect(local.getItem(STORAGE_KEY)).not.toBeNull()

    h.clear(OWN_A)                                   // the user switches location OFF
    expect(h.view(OWN_A).coords).toBeNull()
    expect(local.getItem(STORAGE_KEY)).toBeNull()

    h.pending[0].reverse(A_LABEL, A_CITY, A_POSTCODE)   // …and only now the answer arrives
    expect(h.view(OWN_A).coords, 'the opt-out outranks an answer in flight').toBeNull()
    expect(h.view(OWN_A).status).toBe('idle')
    expect(local.getItem(STORAGE_KEY), 'and the address was not rewritten').toBeNull()
    for (const sentinel of A_SENTINELS) {
      expect(JSON.stringify(local.keys().map((k) => local.getItem(k))), sentinel).not.toContain(sentinel)
    }
  })

  it('X bis — an identity change also invalidates an answer already in flight', () => {
    const h = makeHook()
    h.mountFor(OWN_A)
    h.request(OWN_A)
    h.mountFor(OWN_B)                                // A → B, same mount, no remount
    h.pending[0].position({ lat: A_LAT, lng: A_LNG, capturedAt: Date.now() })
    h.pending[0].reverse(A_LABEL, A_CITY, A_POSTCODE)
    expect(h.view(OWN_B).coords).toBeNull()
    expect(local.getItem(STORAGE_KEY)).toBeNull()
  })

  it('Y — a STATUS-ONLY commit does not erase the position it did not mention', () => {
    // `coords: next.coords ?? null` erased it, which is not a leak but is a real break: a
    // commit({ status: 'requesting' }) over a cached fix nulled the coords, and on /eat the
    // effect keyed on `coords` then re-fetched the catalogue WITHOUT lat/lng, losing the
    // nearest-first order, and flipped the « position active » banner and back.
    setGeoOwner(OWN_A)
    const epoch = getGeoEpoch()
    const held: GeoState = { owner: OWN_A, coords: COORDS_A, status: 'granted' }
    const after = geoCommit(held, OWN_A, epoch, { status: 'requesting' })
    expect(after.coords?.label, 'the position survives a status-only update').toBe(A_LABEL)
    expect(after.status).toBe('requesting')
    // …while an EXPLICIT null still clears, which is how the error paths and clear work
    expect(geoCommit(held, OWN_A, epoch, { coords: null, status: 'denied' }).coords).toBeNull()
  })

  it('the three decisions refuse directly, each called with a hostile argument', () => {
    // THE MUTATION BATTERY FOUND THESE THREE STILL GREEN, each for the same reason: the
    // guard was protected only by a caller that happened to check the same thing first, so
    // deleting it changed nothing observable through the model. Calling the exported
    // decision DIRECTLY is what makes a redundant guard testable at all — a defence in
    // depth has no behaviour of its own as long as something upstream still holds.

    // geoCommit — the re-validation INSIDE the updater. A deferred React update sees a
    // newer module state than its closure did, so this is the check that actually decides.
    setGeoOwner(OWN_B)
    const held: GeoState = { owner: OWN_B, coords: COORDS_B, status: 'granted' }
    const epochNow = getGeoEpoch()
    // …A's answer, arriving with A's owner: refused, state untouched
    expect(geoCommit(held, OWN_A, epochNow, { coords: COORDS_A, status: 'granted' })).toBe(held)
    // …and the right owner but a stale epoch (a « disable » happened since): also refused
    expect(geoCommit(held, OWN_B, epochNow - 1, { coords: COORDS_A, status: 'granted' })).toBe(held)
    // …while the live owner at the current epoch does commit, so this is not vacuous
    expect(geoCommit(held, OWN_B, epochNow, { status: 'requesting' }).status).toBe('requesting')

    // geoClear — a « disable » captured under A must not touch what B holds
    expect(geoClear(held, OWN_A), 'a clear for A leaves B alone').toBe(held)
    expect(geoClear(held, OWN_B).coords, 'and B can clear their own').toBeNull()
    // THE CASE THAT SEPARATES THE TWO GUARDS. The one above passes with the live-owner
    // check deleted, because `prev.owner === owner` already refuses it: the state is B's.
    // The check only bites when the state IS this owner's and that owner is no longer the
    // live one — a « disable » tapped under A, arriving after the session became B. Not a
    // leak: a stale handler acting at all is the class of bug this whole lot is about, and
    // without the check geoClear's answer depends on which identity happens to be live
    // rather than on which one the handler was captured under.
    const aHeld: GeoState = { owner: OWN_A, coords: COORDS_A, status: 'granted' }
    expect(geoClear(aHeld, OWN_A), 'A\'s own clear is inert once A is gone').toBe(aHeld)
    setGeoOwner(OWN_A)
    expect(geoClear(aHeld, OWN_A).coords, 'and live again, it clears').toBeNull()
    setGeoOwner(OWN_B)

    // persistFor — refuses for an owner that is not the declared one
    local.clear()
    expect(persistFor(OWN_A, COORDS_A), 'A is not live').toBe(false)
    expect(local.getItem(STORAGE_KEY)).toBeNull()
  })

  it('POSITIVE CONTROL — a successful persist really does emit its event', () => {
    // `expect(events).toEqual([])` elsewhere asserts that NOTHING was emitted, and a
    // reviewer showed what that costs: deleting the dispatch entirely left every such
    // assertion green, because an assertion of emptiness cannot notice that the channel is
    // dead. The empty-assertions are only meaningful next to this one.
    local.clear()
    events.length = 0
    setGeoOwner(OWN_A)
    expect(persistFor(OWN_A, COORDS_A)).toBe(true)
    expect(events, 'exactly one event, naming its owner').toEqual([{ owner: OWN_A }])
    // and the clearing branch announces itself too, so siblings drop the fix
    events.length = 0
    expect(persistFor(OWN_A, null)).toBe(true)
    expect(events).toEqual([{ owner: OWN_A }])
  })

  it('Z — a half-written cache pair is unreadable, not readable as the other account\'s', () => {
    // Two keys, two writes, and the second can fail (quota, private browsing). Value-then-
    // stamp left the NEW owner's fix under the OLD stamp. The stamp is now dropped first,
    // so any failure leaves an unstamped blob and readCachedFor refuses it.
    seedCache(OWN_A, COORDS_A)
    setGeoOwner(OWN_B)
    const realSet = local.setItem.bind(local)
    let calls = 0
    ;(local as unknown as { setItem: (k: string, v: string) => void }).setItem = (k, v) => {
      calls += 1
      if (k === OWNER_KEY && calls > 1) throw new Error('QuotaExceededError')
      realSet(k, v)
    }
    try {
      persistFor(OWN_B, COORDS_B)
    } finally {
      ;(local as unknown as { setItem: (k: string, v: string) => void }).setItem = realSet
    }
    // B's fix may or may not be on disk, but NOBODY can read it as theirs
    expect(readCachedFor(OWN_A), 'A must not inherit B\'s fix').toBeNull()
    expect(readCachedFor(OWN_B), 'and an unstamped pair is refused even to its owner').toBeNull()
  })
})


// ══ AA–AG : a superseded request must be INERT, not merely invisible ═════════

/**
 * MODELLED: the interleaving of two catalogue requests -- when each promise settles, and
 * React's rule that an effect's cleanup runs BEFORE the next effect body. That ordering is
 * legitimately a test's job; there is no decision function to export here, because the
 * discipline is control flow inside an effect.
 *
 * WHAT BINDS THE REAL FILES is therefore not this model. It is the EXACT SET over every
 * `alive` line of each page further down, plus the mutation battery: each of the eight
 * guards, deleted one at a time, turns this suite red. The model proves the discipline is
 * sufficient; the sets and the mutations prove the pages implement it.
 */
function mountCatalogue(kind: 'home' | 'search') {
  const state = {
    rows: { owner: null as string | null, rows: [] as string[] },
    nearest: { owner: null as string | null, km: null as number | null },
    fallback: false,
    fetching: true,
  }
  let liveOwner: string | null = null
  let cleanup: (() => void) | null = null

  interface Req {
    owner: string
    success(rows: string[], km: number | null, noMatch?: boolean): void
    fail(): void
    settle(): void
  }
  const reqs: Req[] = []

  /** The effect body. `alive` is captured per run, exactly as the page captures it. */
  function runEffect(): void {
    if (cleanup) cleanup()                 // React runs the previous cleanup first
    const requestOwner = liveOwner
    if (requestOwner === null) return
    let alive = true
    // synchronous, before any await: this request IS the current one at this instant
    state.fetching = true
    reqs.push({
      owner: requestOwner,
      success: (rows, km, noMatch) => {
        if (!alive) return
        state.rows = { owner: requestOwner, rows }
        if (kind === 'home') state.nearest = { owner: requestOwner, km }
        else state.fallback = Boolean(noMatch)
      },
      fail: () => {
        if (!alive) return
        state.rows = { owner: requestOwner, rows: [] }
        if (kind === 'search') state.fallback = false
      },
      settle: () => { if (alive) state.fetching = false },
    })
    cleanup = () => { alive = false }
  }

  return {
    /** A session change re-runs the identity-keyed effect. No remount. */
    signIn(owner: string | null) { liveOwner = owner; runEffect() },
    unmount() { if (cleanup) cleanup() },
    reqs,
    view() {
      const rowsAreMine = liveOwner !== null && state.rows.owner === liveOwner
      return {
        rowsAreMine,
        rows: rowsAreMine ? state.rows.rows : [],
        nearestKm: liveOwner !== null && state.nearest.owner === liveOwner ? state.nearest.km : null,
        loading: state.fetching || !rowsAreMine,
        fallback: state.fallback,
        rawRowsOwner: state.rows.owner,
        rawNearestOwner: state.nearest.owner,
      }
    },
  }
}

describe('AA–AG — /eat: a late response for the previous identity commits nothing', () => {
  it('AA — B SUCCESS, then A SUCCESS late: the state stays B and B never returns to loading', () => {
    // THE DEFECT. The stamp made A's late answer INVISIBLE; it never made it INERT. A
    // re-stamped the state as A's, `rowsAreMine` went false, and `loading` — derived from
    // it — went back to true: B sat on the skeleton until some dependency happened to
    // change. No identity leaked and B's screen was wrong anyway.
    const c = mountCatalogue('home')
    c.signIn(OWN_A)                       // 1. A's request starts
    c.signIn(OWN_B)                       // 2-3. session becomes B, B's request starts
    c.reqs[1].success(['b1', 'b2'], 1.4)  // 4. B answers
    c.reqs[1].settle()
    expect(c.view().rows).toEqual(['b1', 'b2'])
    expect(c.view().loading).toBe(false)

    c.reqs[0].success(['a1', 'a2', 'a3'], 9.9)   // 5. A answers LATE
    c.reqs[0].settle()
    expect(c.view().rows, 'B keeps its own rows').toEqual(['b1', 'b2'])
    expect(c.view().nearestKm, 'and its own distance').toBe(1.4)
    expect(c.view().rawRowsOwner, 'A never got to re-stamp the state').toBe(OWN_B)
    expect(c.view().rawNearestOwner).toBe(OWN_B)
    expect(c.view().loading, 'and B is NOT put back on the skeleton').toBe(false)
  })

  it('AB — A SUCCESS first: invisible on the first frame, then B\'s own answer shows', () => {
    // The window the stamp still has to cover: render B → A's answer → cleanup has already
    // run, so nothing commits; but even if it did, the gate hides it.
    const c = mountCatalogue('home')
    c.signIn(OWN_A)
    c.signIn(OWN_B)
    c.reqs[0].success(['a1'], 9.9)        // A answers BEFORE B
    c.reqs[0].settle()
    expect(c.view().rows, 'nothing of A is visible').toEqual([])
    expect(c.view().nearestKm).toBeNull()
    expect(c.view().loading, 'and the skeleton stays up rather than showing nothing').toBe(true)

    c.reqs[1].success(['b1'], 2.1)
    c.reqs[1].settle()
    expect(c.view().rows).toEqual(['b1'])
    expect(c.view().nearestKm).toBe(2.1)
    expect(c.view().loading).toBe(false)
  })

  it('AC — a late FAILURE for A does not empty what B has', () => {
    const c = mountCatalogue('home')
    c.signIn(OWN_A)
    c.signIn(OWN_B)
    c.reqs[1].success(['b1', 'b2'], 1.4)
    c.reqs[1].settle()
    c.reqs[0].fail()                      // A's request fails, late
    c.reqs[0].settle()
    expect(c.view().rows, 'B is untouched by A\'s failure').toEqual(['b1', 'b2'])
    expect(c.view().rawRowsOwner).toBe(OWN_B)
    expect(c.view().loading).toBe(false)
  })

  it('AD — a late `finally` for A does not close the skeleton while B is still in flight', () => {
    const c = mountCatalogue('home')
    c.signIn(OWN_A)
    c.signIn(OWN_B)                       // B's request is in flight, nothing committed yet
    expect(c.view().loading).toBe(true)
    c.reqs[0].settle()                    // A's `finally` fires
    expect(c.view().loading, 'B is still loading, because B has not answered').toBe(true)
    c.reqs[1].success(['b1'], 1.0)
    c.reqs[1].settle()
    expect(c.view().loading).toBe(false)
  })

  it('AE — A → B → C with three in flight: C survives every response order', () => {
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1], [1, 2, 0], [2, 0, 1]]) {
      const c = mountCatalogue('home')
      c.signIn(OWN_A)
      c.signIn(OWN_B)
      c.signIn(OWN_C)
      for (const i of order) {
        if (i === 2) c.reqs[2].success(['c1'], 3.3)
        else c.reqs[i].success([`stale-${i}`], 9.9)
        c.reqs[i].settle()
      }
      expect(c.view().rows, `order ${order.join('')}`).toEqual(['c1'])
      expect(c.view().nearestKm, `order ${order.join('')}`).toBe(3.3)
      expect(c.view().rawRowsOwner, `order ${order.join('')}`).toBe(OWN_C)
      expect(c.view().loading, `order ${order.join('')}`).toBe(false)
    }
  })

  it('AF — and after unmount, nothing commits at all', () => {
    const c = mountCatalogue('home')
    c.signIn(OWN_A)
    c.unmount()
    c.reqs[0].success(['a1'], 9.9)
    c.reqs[0].settle()
    expect(c.view().rawRowsOwner, 'the response had nowhere to land').toBeNull()
  })
})

describe('AG — /eat/search: the same matrix, plus `fallback`', () => {
  it('a late A response may not overwrite B\'s fallback flag', () => {
    // `fallback` drives « aucun résultat dans cette catégorie, voici autre chose ». It is
    // not owner-stamped and cannot usefully be: it is a property of the REQUEST, which is
    // exactly why a superseded request must not write it.
    const c = mountCatalogue('search')
    c.signIn(OWN_A)
    c.signIn(OWN_B)
    c.reqs[1].success(['b1'], null, false)      // B: the category matched
    c.reqs[1].settle()
    expect(c.view().fallback).toBe(false)
    c.reqs[0].success(['a1'], null, true)       // A, late: the category had no match
    c.reqs[0].settle()
    expect(c.view().fallback, 'B\'s answer stands').toBe(false)
    expect(c.view().rows).toEqual(['b1'])
    expect(c.view().loading).toBe(false)
  })

  it('a late A catch may not clear B\'s rows, fallback or loading', () => {
    const c = mountCatalogue('search')
    c.signIn(OWN_A)
    c.signIn(OWN_B)
    c.reqs[1].success(['b1', 'b2'], null, true)  // B legitimately fell back
    c.reqs[1].settle()
    expect(c.view().fallback).toBe(true)
    c.reqs[0].fail()                             // A's catch, late
    c.reqs[0].settle()
    expect(c.view().rows, 'rows kept').toEqual(['b1', 'b2'])
    expect(c.view().fallback, 'fallback kept — the catch would have set it false').toBe(true)
    expect(c.view().loading, 'loading kept').toBe(false)
  })

  it('B SUCCESS then A SUCCESS late: the rows stay B\'s, and B never reloads', () => {
    const c = mountCatalogue('search')
    c.signIn(OWN_A)
    c.signIn(OWN_B)
    c.reqs[1].success(['b1'], null, false)
    c.reqs[1].settle()
    c.reqs[0].success(['a1', 'a2'], null, false)
    c.reqs[0].settle()
    expect(c.view().rows).toEqual(['b1'])
    expect(c.view().rawRowsOwner).toBe(OWN_B)
    expect(c.view().loading).toBe(false)
  })

  it('three in flight: the newest survives every order', () => {
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
      const c = mountCatalogue('search')
      c.signIn(OWN_A)
      c.signIn(OWN_B)
      c.signIn(OWN_C)
      for (const i of order) {
        c.reqs[i].success(i === 2 ? ['c1'] : [`stale-${i}`], null, i !== 2)
        c.reqs[i].settle()
      }
      expect(c.view().rows, `order ${order.join('')}`).toEqual(['c1'])
      expect(c.view().fallback, `order ${order.join('')}`).toBe(false)
      expect(c.view().loading, `order ${order.join('')}`).toBe(false)
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
    // THE REHYDRATION'S OWN STATE WRITE, pinned. Nothing held it before, and a reviewer
    // rewrote it to `coords: cached ?? prev.coords`: after a swap the effect RE-STAMPED A's
    // coords as B's, so B saw A's postal label, sent A's lat/lng, and persistFor wrote them
    // under B's stamp — the original P1 reopened in full, 65/65 green. The write is now the
    // exported decision, so there is one shape to pin and the test executes it.
    expect(src).toMatch(
      /setGeoOwner\(liveOwner\)\s*\n\s*setState\(geoRehydrate\(liveOwner\)\)\s*\n\s*if \(liveOwner === null\) return/,
    )
    // and it is the ONLY state-write shape in the effect: the event listener re-uses it
    expect((src.match(/setState\(geoRehydrate\(liveOwner\)\)/g) ?? []).length,
      'mount and the sibling event, nothing else').toBe(2)
  })

  it('EXACT SET — the hook holds the position in ONE container, and no other', () => {
    // AN ENUMERATION OVER ONE CONTAINER IS ESCAPABLE BY CHOOSING ANOTHER. A reviewer did
    // exactly that: a module-level `let lastFix` written by both callbacks and read through
    // a new export put A's postal address on B's /eat, fully ungated, with the suite green —
    // because the only container this file enumerated was `state`. So the set is over EVERY
    // container the hook could stash a position in.
    const containers = executable(read(HOOK)).split('\n').map((l) => l.trim())
      .filter((l) => /^let\s|useRef|useState/.test(l))
    expect(containers).toEqual([
      "import { useCallback, useEffect, useState } from 'react'",
      // Module scope, and NONE of these three holds a position — that is the property this
      // set exists for, and it is why each one is listed with what it does hold. The third
      // was added by the acquisition fix and this assertion caught it, which is the point:
      // a new module-scope mutable has to be looked at before it is allowed.
      'let liveGeoOwner: GeoOwner | null = null',   // an identity string
      'let geoEpoch = 0',                            // a counter
      'let inFlightEpoch: number | null = null',     // a counter, or null
      // the one container that holds a position, with the owner it belongs to beside it
      "const [state, setState] = useState<GeoState>({ owner: null, coords: null, status: 'idle' })",
    ])
  })

  it('EXACT SET — every disk access in the hook, so none can be smuggled past the stamp', () => {
    // The guards inside persistFor and readCachedFor are worth nothing if a write can go
    // round them. A reviewer added a localStorage.setItem BEFORE the reverse guard: A's
    // address landed in the cache while B was live, under B's stamp, and the suite stayed
    // green because nothing enumerated the disk accesses themselves.
    expect(linesOf(HOOK, 'localStorage')).toEqual([
      // syncGeoCacheOwner — EatShell's identity effect (unchanged by this lot)
      'if (localStorage.getItem(OWNER_KEY) !== stamp) {',
      'localStorage.removeItem(STORAGE_KEY)',
      'localStorage.setItem(OWNER_KEY, stamp)',
      // readCachedFor — the stamp is checked BEFORE the value is even read
      'if (localStorage.getItem(OWNER_KEY) !== owner) return null',
      'const raw = localStorage.getItem(STORAGE_KEY)',
      // persistFor — stamp dropped FIRST, so a half-written pair is unreadable rather
      // than readable as somebody else's
      'localStorage.removeItem(OWNER_KEY)',
      'localStorage.setItem(STORAGE_KEY, JSON.stringify(coords))',
      'localStorage.setItem(OWNER_KEY, owner)',
      // persistFor, the clearing branch
      'localStorage.removeItem(STORAGE_KEY)',
    ])
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
    // A COUNT IS NOT A POSITION. This used to assert only that three guards existed; a
    // reviewer pointed out that moving one of them AFTER the commit it is supposed to
    // protect keeps the count at three. Each guard is therefore anchored to its own site,
    // and the EXACT SET below also fixes the total.
    expect(linesOf(HOOK, 'stillMine')).toEqual([
      'const stillMine = () => geoStillMine(requestOwner, requestEpoch)',
      'if (!stillMine()) return',   // the browser's position callback
      'if (!stillMine()) return',   // the reverse-geocode answer
      'if (!stillMine()) return',   // the error callback
    ])
    // ANCHORED: each guard is the first statement of its callback, before any commit.
    expect(src).toMatch(/\(pos\) => \{\s*\n\s*if \(!stillMine\(\)\) return\s*\n\s*const next: GeoCoords = \{/)
    expect(src).toMatch(/if \(!stillMine\(\)\) return\s*\n\s*if \(!d \|\| d\.status !== 'ok' \|\| !d\.label\) return/)
    expect(src).toMatch(/\(err\) => \{\s*\n\s*if \(!stillMine\(\)\) return/)
    // the owner AND the epoch are captured together, once, before the prompt opens
    expect(src).toMatch(/const requestOwner = liveOwner\s*\n\s*const requestEpoch = geoEpoch/)
    expect((src.match(/const requestOwner = liveOwner/g) ?? []).length).toBe(1)
    // the decision itself is ONE exported predicate, not restated anywhere
    expect(src).toMatch(
      /export function geoStillMine\(requestOwner: GeoOwner, requestEpoch: number\): boolean \{\s*\n\s*return liveGeoOwner === requestOwner && geoEpoch === requestEpoch\s*\n\}/,
    )
    // EVERY commit in `request` goes through the exported decision — no bare setState
    expect(src).toMatch(/const commit = \(next: Partial<GeoState>\) =>\s*\n\s*setState\(\(prev\) => geoCommit\(prev, requestOwner, requestEpoch, next\)\)/)
    // a status-only commit must not erase the position (`in`, not `?? null`)
    expect(src).toMatch(/const coords = 'coords' in next \? next\.coords \?\? null : prev\.coords/)
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
    // ANCHORED AND ORDERED: the state write, the disk write, and the invalidation, in that
    // order. The invalidation is what stops a reverse answer already on the wire putting the
    // position back and rewriting the postal address after an explicit « disable ».
    expect(src).toMatch(
      /setState\(\(prev\) => geoClear\(prev, owner\)\)\s*\n\s*persistFor\(owner, null\)\s*\n\s*geoInvalidateInFlight\(\)/,
    )
    // the cache is read only when the stamp names this owner
    expect(src).toMatch(/if \(localStorage\.getItem\(OWNER_KEY\) !== owner\) return null/)
  })

  it('H — /eat sends no lat/lng of the previous account, and its distance is gated too', () => {
    const src = executable(read(HOME))
    expect(src).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(liveOwner\)/)
    // the request is built from the GATED coords…
    // FIVE lines now, measured. The query and the effect's dep array no longer name
    // `coords`: the two numbers are pulled out of the GATED object and everything
    // position-dependent reads those instead, so a reverse-geocode enrichment — same place,
    // new object identity — cannot re-fire the catalogue request. The property this set
    // exists for is unchanged and still holds at every site: nothing reads a position that
    // did not come through the gate, because `lat`/`lng` are derived FROM `coords`.
    expect(linesOf(HOME, 'coords')).toEqual([
      'const { coords, status, request, clear } = useGeolocation(liveOwner)',
      'const lat = coords?.lat ?? null',
      'const lng = coords?.lng ?? null',
      "const geoActive = status === 'granted' && !!coords",
      '{coords?.label && <span>{coords.label}</span>}',
    ])
    // and the numbers themselves are read ONLY where they belong: the query and the deps
    expect(linesOf(HOME, 'lat')).toEqual([
      'const lat = coords?.lat ?? null',
      'if (lat !== null && lng !== null) {',
      "sp.set('lat', String(lat))",
      '}, [lat, lng, liveOwner])',
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


  it('H bis — THE DISTANCE VECTOR: the rows themselves are owner-stamped', () => {
    // FOUND BY AN INDEPENDENT REVIEW, and it was a real cross-account leak that this lot
    // had half-fixed. app/api/restaurants/route.ts attaches `distanceKm` TO EVERY ROW at
    // 0.1 km resolution and sorts by it, so a 20-row response is 20 distances measured from
    // the account's home. `nearestKm` — which this lot did gate — is only the MINIMUM of
    // that vector. The vector itself sat in an unstamped useState, so after an A → B swap
    // the first frame painted « à env. 1,2 km » on every card for B: restaurants whose
    // coordinates are public, so twenty distances locate A by multilateration.
    const home = executable(read(HOME))
    expect(linesOf(HOME, 'restaurantState')).toEqual([
      'const [restaurantState, setRestaurantState] = useState<{ owner: string | null; rows: Restaurant[] }>({ owner: null, rows: [] })',
      'const rowsAreMine = liveOwner !== null && restaurantState.owner === liveOwner',
      'const restaurants = rowsAreMine ? restaurantState.rows : NO_ROWS',
    ])
    // the write names the owner the request was issued for — and so does the FAILURE path.
    // This used to be `.catch(() => {})`: a refetch that failed for B left A's rows painted
    // for the whole mount, because setLoading(false) closed the skeleton over them. A
    // request that has not answered is not an answer.
    expect(home).toMatch(/setRestaurantState\(\{ owner: requestOwner, rows: d\.restaurants \?\? \[\] \}\)/)
    expect(home).toMatch(/\.catch\(\(\) => \{\s*\n\s*if \(!alive\) return\s*\n\s*setRestaurantState\(\{ owner: requestOwner, rows: \[\] \}\)\s*\n\s*\}\)/)
    // NARROWED, because a blanket ban was wrong: the other silent swallow on this page is
    // SAFE, and the difference is the whole point. The recent-orders effect commits to
    // `recentState`, which IS stamped, so a failed refetch leaves A's cards sitting in
    // state where the render gate hides them — nothing is fabricated and nothing of A's is
    // shown. The restaurants effect had no stamp, so the identical swallow left A's
    // distances painted. Counted, so a third swallow cannot appear unseen.
    expect((home.match(/\.catch\(\(\) => \{\}\)/g) ?? []).length,
      'only the stamped recent-orders effect may swallow').toBe(1)
    // and the skeleton stays up on a mismatch instead of telling an account with
    // restaurants that there are none
    expect(linesOf(HOME, 'loading')).toEqual([
      'const loading = fetching || !rowsAreMine',
      '{loading ? (',
    ])
    expect(linesOf(HOME, 'fetching')).toEqual([
      'const [fetching, setFetching] = useState(true)',
      'const loading = fetching || !rowsAreMine',
    ])
  })

  it('I bis — /eat/search holds up to FIFTY of those distances, stamped the same way', () => {
    const search = executable(read(SEARCH))
    expect(linesOf(SEARCH, 'resultState')).toEqual([
      'const [resultState, setResultState] = useState<{ owner: string | null; rows: Restaurant[] }>({ owner: null, rows: [] })',
      'const rowsAreMine = favsOwner !== null && resultState.owner === favsOwner',
      'const results = rowsAreMine ? resultState.rows : NO_ROWS',
    ])
    expect(search).toMatch(/const requestOwner = favsOwner/)
    expect(search).toMatch(/setResultState\(\{ owner: requestOwner, rows: data\.restaurants \?\? \[\] \}\)/)
    expect(search).toMatch(/setResultState\(\{ owner: requestOwner, rows: \[\] \}\)/)   // the catch
    expect(linesOf(SEARCH, 'fetching')).toEqual([
      'const [fetching, setFetching] = useState(true)',
      'const loading = fetching || !rowsAreMine',
    ])
  })

  it('EXACT SET — every useState of /eat, so no row of account content escapes a gate', () => {
    // An enumeration over containers is escapable by choosing another container, which is
    // why the hook's own containers are enumerated separately above. This set exists for a
    // narrower reason: it is the list that a reviewer showed was WRONG about one of its
    // members. `restaurants` was described in the neighbouring suite as « identity-free,
    // the same rows for everyone signed in or not » — true of the legacy branch of
    // /api/restaurants, false of the geo branch, which is the one this screen uses.
    const decls = executable(read(HOME)).split('\n').map((l) => l.trim())
      .filter((l) => /= useState/.test(l))
    expect(decls).toEqual([
      'const [restaurantState, setRestaurantState] = useState<{ owner: string | null; rows: Restaurant[] }>({ owner: null, rows: [] })',
      'const [nearestState, setNearestState] = useState<{ owner: string | null; km: number | null }>({ owner: null, km: null })',
      'const [recentState, setRecentState] = useState<{ owner: string | null; cards: RecentOrder[] }>({ owner: null, cards: [] })',
      "const [favsState, setFavsState] = useState<{ owner: string | null; ids: string[] }>({ owner: null, ids: [] })",
      'const [fetching, setFetching] = useState(true)',
    ])
    // four hold account content, and all four are gated on a live identity in RENDER
    const src = executable(read(HOME))
    expect(src).toMatch(/const rowsAreMine = liveOwner !== null && restaurantState\.owner === liveOwner/)
    expect(src).toMatch(/const nearestKm = liveOwner !== null && nearestState\.owner === liveOwner/)
    expect(src).toMatch(/const recent = liveOwner !== null/)
    expect(src).toMatch(/const favs = favsOwner !== null/)
    // the fifth is a boolean, and it is not read raw: `loading` is derived from it
    expect(src).toMatch(/const loading = fetching \|\| !rowsAreMine/)
  })

  it('EXACT SET — every invalidation guard on /eat, so no commit site is left open', () => {
    // A SUPERSEDED REQUEST MUST BE INERT, NOT MERELY INVISIBLE. The stamp decides what may
    // be SEEN; this flag decides what may be WRITTEN. An independent review found the gap:
    // a late response for A, landing after B's had already committed, re-stamped the state
    // as A's — the gate then hid it from B and `rowsAreMine` went false, so `loading`, which
    // is derived from it, went back to true and B sat on the skeleton until a dependency
    // happened to change. No identity leaked, and B's screen was wrong regardless.
    //
    // This is the EXACT SET, not a count: every line of this file naming the flag, in both
    // effects. The recentState effect below has had its cleanup since the Recommander lot;
    // the catalogue effect, which this lot extended, never had one.
    expect(linesOf(HOME, 'alive')).toEqual([
      // the catalogue effect — declaration, success, catch, finally, cleanup
      'let alive = true',
      'if (!alive) return',
      'if (!alive) return',
      '.finally(() => { if (alive) setFetching(false) })',
      'return () => { alive = false }',
      // the recent-orders effect (the Recommander lot) — unchanged here
      'let alive = true',
      'if (!alive || !d) return',
      'return () => { alive = false }',
    ])
    const home = executable(read(HOME))
    // ANCHORED: each guard is the FIRST statement of its callback, before any commit —
    // a guard that sits AFTER the commit it protects would keep every count intact.
    expect(home).toMatch(
      /\.then\(\(d\) => \{\s*\n\s*if \(!alive\) return\s*\n\s*setRestaurantState\(/,
    )
    // and BOTH stamped states are written inside that same guarded block: the distance was
    // committed one line after the rows, so a guard covering only the rows would have let a
    // stale request re-stamp the number
    expect(home).toMatch(
      /if \(!alive\) return\s*\n\s*setRestaurantState\(\{ owner: requestOwner, rows: d\.restaurants \?\? \[\] \}\)[\s\S]{0,320}?setNearestState\(\{ owner: requestOwner, km:/,
    )
    // BOUND AS A BLOCK, not as a bag of lines. `linesOf` compares trimmed line TEXT in
    // file order and says nothing about what encloses a line; a review proved three kills
    // that walk straight past a set of lines. So the opening of the effect, the owner
    // capture, the flag and the first commit are matched in ONE expression, adjacent:
    //   · the opener must be a useEffect — a useCallback cannot be invalidated, because
    //     React never calls the cleanup it returns;
    //   · `let alive = true` must be INSIDE it — hoisted to module scope the flag is
    //     initialised once per module load, the first cleanup latches it false for ever,
    //     and the page is pinned on the skeleton (worse than the bug being fixed);
    //   · nothing may be inserted before the flag — a one-line early return there
    //     neutralises the whole request path and leaves `fetching` true for ever.
    // `setFetching(true)` is deliberately NOT guarded: it runs synchronously in the effect
    // body, before any await, so at that instant this request IS the current one.
    expect(home).toMatch(
      /useEffect\(\(\) => \{\s*\n\s*const requestOwner = liveOwner\s*\n\s*let alive = true\s*\n\s*setFetching\(true\)/,
    )
    // the cleanup is the LAST statement OF THAT SAME EFFECT. The span cannot cross another
    // `useEffect(`, so the sibling effect twenty lines below cannot satisfy this.
    expect(home).toMatch(
      /useEffect\(\(\) => \{(?:(?!useEffect\()[\s\S])*?return \(\) => \{ alive = false \}\s*\n\s*\}, \[lat, lng, liveOwner\]\)/,
    )
    // NO MUTABLE MODULE-SCOPE STATE on this page: that is the general form of the hoist,
    // and the one container enumeration that a hoisted flag cannot hide in.
    expect(executable(read(HOME)).split('\n').filter((l) => /^(let|var)\s/.test(l)),
      'nothing mutable at module scope').toEqual([])
  })

  it('EXACT SET — every invalidation guard on /eat/search, including `fallback`', () => {
    // The fetch used to live in a useCallback, which cannot be invalidated by a cleanup, so
    // it is inlined into the one effect that called it. That removes the SHAPE of the bug:
    // the request can no longer be started by anything that does not own a cleanup.
    expect(linesOf(SEARCH, 'alive')).toEqual([
      'let alive = true',
      'if (!alive) return',
      'if (!alive) return',
      'if (alive) setFetching(false)',
      'return () => { alive = false }',
    ])
    const search = executable(read(SEARCH))
    // success: the guard precedes BOTH writes — the rows and `fallback`. `fallback` is a
    // property of the REQUEST and cannot be owner-stamped, which is exactly why a
    // superseded request must not write it: A's « no match in this category » would
    // otherwise replace B's answer.
    expect(search).toMatch(
      /if \(!alive\) return\s*\n\s*setResultState\(\{ owner: requestOwner, rows: data\.restaurants \?\? \[\] \}\)\s*\n\s*setFallback\(Boolean\(data\.categoryHadNoMatch\)\)/,
    )
    // catch: the same, and it would set `fallback` back to false
    expect(search).toMatch(
      /if \(!alive\) return\s*\n\s*setResultState\(\{ owner: requestOwner, rows: \[\] \}\)\s*\n\s*setFallback\(false\)/,
    )
    // finally: a stale `finally` must not close the skeleton over a newer request
    expect(search).toMatch(/\} finally \{\s*\n\s*if \(alive\) setFetching\(false\)\s*\n\s*\}/)
    // BOUND AS A BLOCK — see the /eat case above for why a set of lines is not enough.
    // This one expression is what forbids re-extracting the body into a callback, hoisting
    // the flag, and inserting anything before it.
    expect(search).toMatch(
      /useEffect\(\(\) => \{\s*\n\s*const requestOwner = favsOwner\s*\n\s*let alive = true\s*\n\s*setFetching\(true\)/,
    )
    expect(search).toMatch(
      /useEffect\(\(\) => \{(?:(?!useEffect\()[\s\S])*?return \(\) => \{ alive = false \}\s*\n\s*\}, \[query, cuisine, sort, lat, lng, favsOwner\]\)/,
    )
    // THE SHAPE, NOT THE NAME. These two bans used to read `/const run = useCallback/` and
    // `/\brun\(\)/`: renaming the extraction to `load` satisfied both while restoring the
    // un-invalidatable entry point they existed to forbid. A cleanup returned from a
    // useCallback is returned to its CALLER and dropped — React never sees it.
    expect(search, 'no cleanup may be returned from a callback').not.toMatch(
      /=\s*useCallback\((?:(?!useEffect\()[\s\S])*?alive = false/,
    )
    expect(search, 'the fetch is started by an effect, never by a callback').not.toMatch(
      /=\s*useCallback\((?:(?!useEffect\()[\s\S])*?fetch\(`\/api\/restaurants/,
    )
    expect(executable(read(SEARCH)).split('\n').filter((l) => /^(let|var)\s/.test(l)),
      'nothing mutable at module scope').toEqual([])
  })

  it('EVERY write of the four states goes through a guarded block — enumerated', () => {
    // A guard is worth nothing if a write can be added beside it. These are the complete
    // lists of write sites, so a new unguarded one cannot appear without turning this red.
    const home = executable(read(HOME)).split('\n').map((l) => l.trim())
    // MEASURED. The useState declarations are NOT in these sets: they read `, setX]`, and
    // a search for `setX(` cannot match that. I wrote them in from memory and the suite
    // caught it — the same trap as `setNearestState(` last round, from the other end.
    expect(home.filter((l) => /setRestaurantState\(|setNearestState\(/.test(l))).toEqual([
      'setRestaurantState({ owner: requestOwner, rows: d.restaurants ?? [] })',
      "setNearestState({ owner: requestOwner, km: typeof d.nearestKm === 'number' ? d.nearestKm : null })",
      'setRestaurantState({ owner: requestOwner, rows: [] })',
    ])
    expect(home.filter((l) => /setFetching\(/.test(l))).toEqual([
      'setFetching(true)',
      '.finally(() => { if (alive) setFetching(false) })',
    ])
    const search = executable(read(SEARCH)).split('\n').map((l) => l.trim())
    expect(search.filter((l) => /setResultState\(|setFallback\(/.test(l))).toEqual([
      'setResultState({ owner: requestOwner, rows: data.restaurants ?? [] })',
      'setFallback(Boolean(data.categoryHadNoMatch))',
      'setResultState({ owner: requestOwner, rows: [] })',
      'setFallback(false)',
    ])
    expect(search.filter((l) => /setFetching\(/.test(l))).toEqual([
      'setFetching(true)',
      'if (alive) setFetching(false)',
    ])
  })

  it('I — /eat/search builds its query from the gated coords only', () => {
    // FIVE lines now, measured — see the /eat case for why the query left this set.
    expect(linesOf(SEARCH, 'coords')).toEqual([
      'const { coords } = useGeolocation(favsOwner)',
      'const lat = coords?.lat ?? null',
      'const lng = coords?.lng ?? null',
      'if (coords) return // geo drives the order — sort is inert when location is on',
      '<button type="button" className="sort" onClick={cycleSort} disabled={Boolean(coords)}>',
    ])
    expect(linesOf(SEARCH, 'lat')).toEqual([
      'const lat = coords?.lat ?? null',
      'if (lat !== null && lng !== null) {',
      "sp.set('lat', String(lat))",
      '}, [query, cuisine, sort, lat, lng, favsOwner])',
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
    // `X || true` CANNOT FAIL. It was here, and a reviewer deleted the address line this
    // case claims to judge with the suite still green. The property is real, so it is now
    // asserted as a property: the sheet renders the gated label and nothing else.
    // TWO lines now, measured. The second was added by the acquisition fix: the sheet
    // finished an acquisition in silence on the search step, so a success line was added
    // there. Both render the SAME gated value — `coords` is null unless its owner is the
    // live one — which is the property this case exists for, now asserted at two sites
    // instead of one.
    expect(linesOf(SHEET, 'coords').filter((l) => /coords\?\.label|coords\.label/.test(l))).toEqual([
      '<span className="geo-on-txt">{coords?.label || t(\'statusOnSub\')}</span>',
      "<span>{coords?.label || t('statusOnSub')}</span>",
    ])
  })

  it('V — the public chef page keeps working, with an explicit guest owner', () => {
    const src = executable(read(CHEF))
    expect(src).toMatch(/useGeolocation\('guest'\)/)
    // it must NOT acquire a session: that page renders without a SessionProvider
    expect(src).not.toMatch(/useSession/)
    expect(src).not.toMatch(/sessionCartStamp|favOwner\(/)
  })

  it('the forbidden areas still hold the invariants that would break if they were touched', () => {
    // RENAMED AND REWRITTEN. The old version asserted `read(f).length > 100` for each
    // forbidden file, which cannot detect any modification whatsoever, and matched
    // `syncGeoCacheOwner(me)` with a bare toMatch that `if (false) syncGeoCacheOwner(me)`
    // would satisfy. Worse, the claim was not a source property at all: « the diff touched
    // nothing else » is a property of the COMMIT, verified with git outside the suite
    // (`git diff --name-only`), and no assertion over file contents can stand in for it.
    // What a test CAN do is hold the invariants whose breakage would matter.
    const shell = executable(read('components/eat/EatShell.tsx'))
    // ANCHORED, because a bare toMatch is satisfied by `if (false) syncGeoCacheOwner(me)`.
    // The call sits with its two siblings in the identity effect, so a dead one is visible.
    expect(shell).toMatch(
      /setAddressOwner\(me\)\s*\n\s*setCartOwner\(me\)\s*\n\s*syncGeoCacheOwner\(me\)/,
    )
    expect(shell).toMatch(
      /setAddressOwner\(\{ kind: 'guest' \}\)\s*\n\s*setCartOwner\(\{ kind: 'guest' \}\)\s*\n\s*syncGeoCacheOwner\(\{ kind: 'guest' \}\)/,
    )
    // The neighbouring lots' guards, each asserted as the invariant it is rather than by
    // file length. These are the lines whose removal would re-open a merged hotfix.
    expect(executable(read('lib/eat-cart.ts'))).toMatch(/export function sessionCartStamp\(status: string, userId\?: string \| null\): string \| null/)
    expect(executable(read('lib/eat-addresses.ts'))).toMatch(/export function sessionAddressStamp\(status: string, userId\?: string \| null\): string \| null/)
    // measured, not remembered: both gate on `liveStamp`, and both exclude the guest
    // bucket — an order history and a paid receipt have no guest reading
    expect(executable(read('app/[locale]/eat/orders/page.tsx')))
      .toMatch(/const ordersOwned = liveStamp !== null && liveStamp !== 'guest' && data\?\.stamp === liveStamp/)
    expect(executable(read('app/[locale]/eat/receipt/[id]/page.tsx')))
      .toMatch(/const scopeOk = liveStamp !== null && liveStamp !== 'guest'/)
  })

  it('the two identity definitions AGREE — they are separate bodies, and must not drift', () => {
    // NOT A SOURCE PIN: both functions are CALLED, across every case, and their answers
    // compared. A reviewer found that this app has TWO byte-identical implementations of
    // « who is signed in » — sessionCartStamp (passed by /eat, /eat/search, /eat/r/[id])
    // and sessionAddressStamp (passed by GeolocSheet) — while a comment in the hook claims
    // there is only one. The module-level declared owner is last-writer-wins, so if these
    // two ever diverge the sheet would declare a different owner from the page it sits on.
    //
    // ALIASING ONE ONTO THE OTHER IS THE REAL FIX, and it is NOT done here: lib/eat-addresses
    // is on this lot's do-not-touch list. Reported as its own lot. Until then, divergence
    // is red rather than silent.
    for (const status of ['authenticated', 'unauthenticated', 'loading', 'nonsense']) {
      for (const id of ['user-A', 'user-B', '', null, undefined]) {
        expect(sessionAddressStamp(status, id), `${status}/${String(id)}`)
          .toBe(sessionCartStamp(status, id))
      }
    }
    // and neither can ever produce the literal guest bucket for a signed-in account
    expect(sessionCartStamp('authenticated', 'guest')).toBe('u:guest')
  })
})
