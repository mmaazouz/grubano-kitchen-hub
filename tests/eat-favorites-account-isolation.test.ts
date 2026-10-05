import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT FAVOURITES (P1 confidentialité + corruption) ────────────────
//
// WHAT WAS WRONG. `grubano_favs` was ONE localStorage key for the whole browser, with no
// identity in the key and none in the value. A favourited restaurant R; A signed out; B
// signed in on the same browser and saw R hearted on /eat, listed on /eat/favorites,
// counted in « Favoris » on /eat/account, hearted on the restaurant page and filtering
// /eat/search. And it was worse than a read: when B un-hearted R, B rewrote that same key,
// so A's favourite was DESTROYED. A leak of a preference AND a destructive corruption in
// both directions.
//
// THE OWNER IS THE SESSION. `grubano_favs.v2.u.<userId>` for an account,
// `grubano_favs.v2.guest` for a visitor, with the owner repeated INSIDE the value so a
// bucket that landed under the wrong key reads EMPTY. The ambiguous global API
// (readFavs / isFav / toggleFav) is removed rather than kept alongside: a function that
// cannot say who is reading should not be reachable.
//
// HOW IT IS PROVEN. The library runs FOR REAL against an in-memory localStorage — every
// bucket assertion below is read back out of storage. The surfaces are asserted on source
// (vitest `environment: 'node'`, no DOM harness), each with a positive control, plus a
// first-frame case that executes the gate the five screens compute during render.

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
const seen: Array<{ owner?: unknown }> = []
;(globalThis as { window?: unknown }).window = win
;(globalThis as { localStorage?: unknown }).localStorage = local
;(globalThis as { sessionStorage?: unknown }).sessionStorage = new MemStorage()

import {
  favOwner, favKeyFor, setFavOwner, getFavOwner, __resetFavOwner,
  readFavsForOwner, isFavForOwner, toggleFavForOwner,
  favEventIsMine, favStorageIsMine, FAV_EVENT,
} from '@/lib/eat-cart'

win.addEventListener(FAV_EVENT, (e) => {
  seen.push(((e as CustomEvent).detail ?? {}) as { owner?: unknown })
})

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`
const R1 = 'resto-R', R2 = 'resto-R2'
const LEGACY = 'grubano_favs'
const bucket = (owner: string) => favKeyFor(owner)

/** Declare an owner and toggle, the way every surface does. */
const toggleAs = (owner: string, id: string) => {
  setFavOwner(owner)
  return toggleFavForOwner(owner, id)
}

beforeEach(() => {
  local.clear()
  seen.length = 0
  __resetFavOwner()
})

// ══ A–E : the buckets, and the corruption that is now impossible ═════════════

describe('A–E — one bucket per owner, and B cannot touch A\'s', () => {
  it('A — A favourites R: it lands in A\'s bucket, named in the key AND in the value', () => {
    expect(toggleAs(OWN_A, R1)).toBe(true)
    expect(local.keys()).toEqual([`grubano_favs.v2.u.${A}`])
    expect(JSON.parse(local.getItem(bucket(OWN_A)) as string)).toEqual({ owner: OWN_A, ids: [R1] })
    expect(readFavsForOwner(OWN_A)).toEqual([R1])
    expect(isFavForOwner(OWN_A, R1)).toBe(true)
  })

  it('B — B signs in on the same browser: B\'s bucket is EMPTY', () => {
    toggleAs(OWN_A, R1)
    setFavOwner(OWN_B)
    expect(readFavsForOwner(OWN_B)).toEqual([])
    expect(local.getItem(bucket(OWN_B))).toBeNull()
  })

  it('C — B does not see R as a favourite', () => {
    toggleAs(OWN_A, R1)
    setFavOwner(OWN_B)
    expect(isFavForOwner(OWN_B, R1)).toBe(false)
  })

  it('D — THE CORRUPTION: B un-hearting R leaves A\'s bucket untouched', () => {
    toggleAs(OWN_A, R1)
    const frozen = local.getItem(bucket(OWN_A))

    // B tries to remove R (it is not in B's bucket, so this ADDS it to B's own)
    expect(toggleAs(OWN_B, R1)).toBe(true)
    expect(readFavsForOwner(OWN_B)).toEqual([R1])
    // …and B adds another, and removes it again
    toggleAs(OWN_B, R2)
    toggleAs(OWN_B, R2)

    expect(local.getItem(bucket(OWN_A))).toBe(frozen)   // byte-identical throughout
    expect(readFavsForOwner(OWN_A)).toEqual([R1])
  })

  it('E — B → A: A\'s favourite comes back intact, in its original order', () => {
    toggleAs(OWN_A, R1)
    toggleAs(OWN_A, R2)
    expect(readFavsForOwner(OWN_A)).toEqual([R1, R2])

    setFavOwner(OWN_B)
    toggleAs(OWN_B, R2)                 // B's own, independent
    expect(readFavsForOwner(OWN_B)).toEqual([R2])

    setFavOwner(OWN_A)                  // back to A, no remount
    expect(readFavsForOwner(OWN_A)).toEqual([R1, R2])
    // removing the last one removes the bucket rather than orphaning an empty array
    toggleAs(OWN_A, R1)
    toggleAs(OWN_A, R2)
    expect(local.getItem(bucket(OWN_A))).toBeNull()
    expect(readFavsForOwner(OWN_B)).toEqual([R2])   // and B's is still its own
  })
})

// ══ F, G : the legacy bucket is inert ════════════════════════════════════════

describe('F–G — the old global key is never adopted, by anyone', () => {
  it('F — legacy ["R"] + A signs in: NOT adopted', () => {
    local.setItem(LEGACY, JSON.stringify([R1]))
    setFavOwner(OWN_A)
    expect(readFavsForOwner(OWN_A)).toEqual([])
    expect(isFavForOwner(OWN_A, R1)).toBe(false)
    // left inert, not destroyed: this lot was asked to ignore it, not to delete it
    expect(local.getItem(LEGACY)).toBe(JSON.stringify([R1]))
  })

  it('G — legacy + B signs in: NOT adopted either, and A\'s own bucket is unaffected', () => {
    local.setItem(LEGACY, JSON.stringify([R1, R2]))
    toggleAs(OWN_A, R2)
    setFavOwner(OWN_B)
    expect(readFavsForOwner(OWN_B)).toEqual([])
    expect(readFavsForOwner(OWN_A)).toEqual([R2])
    // and a write never touches it
    toggleAs(OWN_B, R1)
    expect(local.getItem(LEGACY)).toBe(JSON.stringify([R1, R2]))
  })

  it('a legacy value that WOULD pass the envelope check is still not adopted', () => {
    // F and G seed the legacy key with a bare array, which the envelope check rejects on
    // SHAPE whatever key it came from — so they prove the shape check, not the
    // non-adoption. This fixture is a perfectly well-formed envelope for A, sitting under
    // the legacy key: the ONLY thing between it and A is that the key is never read.
    local.setItem(LEGACY, JSON.stringify({ owner: OWN_A, ids: [R1] }))
    setFavOwner(OWN_A)
    expect(readFavsForOwner(OWN_A)).toEqual([])
    expect(isFavForOwner(OWN_A, R1)).toBe(false)
    // …and the same for the guest, and for an account that never existed before
    expect(readFavsForOwner('guest')).toEqual([])
    expect(readFavsForOwner(OWN_B)).toEqual([])
    expect(local.getItem(LEGACY)).toBe(JSON.stringify({ owner: OWN_A, ids: [R1] }))
    // the bucket A does own stays the only thing A can read
    toggleAs(OWN_A, R2)
    expect(readFavsForOwner(OWN_A)).toEqual([R2])
  })

  it('the legacy SHAPE is unattributable even under a v2 key — a bare array reads empty', () => {
    setFavOwner(OWN_A)
    local.setItem(bucket(OWN_A), JSON.stringify([R1]))        // the old shape, new key
    expect(readFavsForOwner(OWN_A)).toEqual([])
    // …and a value hand-copied from A's bucket into B's reads empty too: the owner is
    // repeated INSIDE, so the value contradicts the key
    local.setItem(bucket(OWN_A), JSON.stringify({ owner: OWN_A, ids: [R1] }))
    local.setItem(bucket(OWN_B), local.getItem(bucket(OWN_A)) as string)
    expect(readFavsForOwner(OWN_B)).toEqual([])
  })
})

// ══ H : the first frame, as the five screens compute it ══════════════════════

/** The gate the surfaces derive during render. */
const gate = (status: string, userId: string | undefined, state: { owner: string | null; ids: string[] }) => {
  const owner = favOwner(status, userId)
  const ids = owner !== null && state.owner === owner ? state.ids : []
  return { owner, ids }
}

describe('H — the first frame A → B, before any effect runs', () => {
  it('state hydrated for A is invisible under B, with no effect involved', () => {
    const hydratedForA = { owner: OWN_A, ids: [R1, R2] }
    // A's own render
    expect(gate('authenticated', A, hydratedForA)).toEqual({ owner: OWN_A, ids: [R1, R2] })
    // THE FIRST FRAME under B: same state object, no effect has run
    const first = gate('authenticated', B, hydratedForA)
    expect(first.owner).toBe(OWN_B)
    expect(first.ids).toEqual([])
    expect(JSON.stringify(first)).not.toContain(R1)
  })

  it('fail closed while the identity cannot be named', () => {
    const hydratedForA = { owner: OWN_A, ids: [R1] }
    expect(favOwner('loading', A)).toBeNull()
    expect(favOwner('authenticated', undefined)).toBeNull()
    expect(favOwner('authenticated', '')).toBeNull()
    expect(gate('loading', undefined, hydratedForA).ids).toEqual([])
    expect(gate('authenticated', undefined, hydratedForA).ids).toEqual([])
  })

  it('P/Q — signing out gives the GUEST bucket, which is nobody\'s account', () => {
    toggleAs(OWN_A, R1)
    expect(favOwner('unauthenticated', undefined)).toBe('guest')
    // A's hearts are NOT shown as the guest's…
    expect(readFavsForOwner('guest')).toEqual([])
    expect(gate('unauthenticated', undefined, { owner: OWN_A, ids: [R1] }).ids).toEqual([])
    // …the guest has a bucket of its own…
    expect(toggleAs('guest', R2)).toBe(true)
    expect(local.keys().sort()).toEqual([`grubano_favs.v2.guest`, `grubano_favs.v2.u.${A}`].sort())
    expect(readFavsForOwner('guest')).toEqual([R2])
    expect(readFavsForOwner(OWN_A)).toEqual([R1])
    // …and signing in adopts NOTHING from it, in either direction
    setFavOwner(OWN_B)
    expect(readFavsForOwner(OWN_B)).toEqual([])
    expect(readFavsForOwner('guest')).toEqual([R2])
  })
})

// ══ M, N, O : events, and the stale handler ══════════════════════════════════

describe('M–O — another owner\'s event, and a handler captured under A', () => {
  it('M — the FAV_EVENT names its owner, and a foreign one is ignored', () => {
    toggleAs(OWN_A, R1)
    expect(seen).toEqual([{ owner: OWN_A }])            // the event carried A

    // a listener running under B must not react to it
    const eventFromA = new CustomEvent(FAV_EVENT, { detail: { owner: OWN_A } })
    expect(favEventIsMine(eventFromA, OWN_B)).toBe(false)
    expect(favEventIsMine(eventFromA, OWN_A)).toBe(true)
    // FAIL CLOSED: an event with no owner at all (an old bundle in another tab) is foreign
    expect(favEventIsMine(new CustomEvent(FAV_EVENT), OWN_A)).toBe(false)
    expect(favEventIsMine(new CustomEvent(FAV_EVENT, { detail: {} }), OWN_A)).toBe(false)
    // …and an unknown identity accepts nothing
    expect(favEventIsMine(eventFromA, null)).toBe(false)
  })

  it('N — a native storage event for A\'s bucket is ignored under B', () => {
    const forA = { key: bucket(OWN_A) } as StorageEvent
    expect(favStorageIsMine(forA, OWN_B)).toBe(false)
    expect(favStorageIsMine(forA, OWN_A)).toBe(true)
    // the legacy key concerns nobody
    expect(favStorageIsMine({ key: LEGACY } as StorageEvent, OWN_A)).toBe(false)
    // clear() has a null key and concerns everyone
    expect(favStorageIsMine({ key: null } as StorageEvent, OWN_A)).toBe(true)
    expect(favStorageIsMine({ key: null } as StorageEvent, null)).toBe(false)
  })

  it('O — a handler captured under A, clicked after the session became B, writes NOTHING', () => {
    setFavOwner(OWN_A)
    toggleFavForOwner(OWN_A, R1)
    const frozenA = local.getItem(bucket(OWN_A))
    const before = local.keys().length

    // the page rendered under A captured `favsOwner = OWN_A`; the session is now B
    setFavOwner(OWN_B)
    expect(toggleFavForOwner(OWN_A, R1)).toBeNull()      // REFUSED
    expect(toggleFavForOwner(OWN_A, R2)).toBeNull()

    expect(local.getItem(bucket(OWN_A))).toBe(frozenA)   // A's bucket untouched…
    expect(local.getItem(bucket(OWN_B))).toBeNull()      // …and nothing landed in B's
    expect(local.keys().length).toBe(before)
    expect(seen).toEqual([{ owner: OWN_A }])             // no second event was emitted

    // and with NO declared owner at all, every write is refused
    __resetFavOwner()
    expect(toggleFavForOwner(OWN_B, R1)).toBeNull()
    expect(toggleFavForOwner(OWN_A, R1)).toBeNull()
    expect(local.getItem(bucket(OWN_A))).toBe(frozenA)
  })

  it('the owner is never DECLARED on the server, where module state is shared', () => {
    // This one needs liveFavOwner to start null, so it cannot also carry a declared owner.
    const saved = (globalThis as { window?: unknown }).window
    delete (globalThis as { window?: unknown }).window
    try {
      setFavOwner(OWN_A)
      expect(getFavOwner()).toBeNull()
    } finally {
      ;(globalThis as { window?: unknown }).window = saved
    }
  })

  it('…and neither a READ nor a WRITE touches storage on the server', () => {
    // The earlier version asserted all three in one case, and the other two passed for
    // unrelated reasons: beforeEach had just cleared the store, so the read returned []
    // because the bucket was ABSENT, and the write returned null through the
    // declared-owner check — not through either window guard. Here the bucket EXISTS and
    // the owner IS declared before window disappears, so the window guards are the only
    // thing left to refuse.
    toggleAs(OWN_A, R1)
    expect(readFavsForOwner(OWN_A)).toEqual([R1])   // it really is readable first
    const frozen = local.getItem(bucket(OWN_A))

    const saved = (globalThis as { window?: unknown }).window
    delete (globalThis as { window?: unknown }).window
    try {
      expect(getFavOwner()).toBe(OWN_A)             // still declared from the client side
      expect(readFavsForOwner(OWN_A)).toEqual([])   // …and yet reads nothing: the SSR guard
      expect(toggleFavForOwner(OWN_A, R1)).toBeNull()
      expect(toggleFavForOwner(OWN_A, R2)).toBeNull()
    } finally {
      ;(globalThis as { window?: unknown }).window = saved
    }
    expect(local.getItem(bucket(OWN_A))).toBe(frozen)   // nothing was written either
    expect(readFavsForOwner(OWN_A)).toEqual([R1])       // and the client can read it again
  })
})

// ══ R : hostile storage ══════════════════════════════════════════════════════

describe('R — a malformed value fails safe, and leaks nothing', () => {
  it('every junk shape reads [] without throwing', () => {
    setFavOwner(OWN_A)
    for (const junk of [
      'null', '[]', '"x"', '{bad json', '42', 'undefined',
      JSON.stringify({ ids: [R1] }),                       // no owner
      JSON.stringify({ owner: OWN_B, ids: [R1] }),          // someone else's
      JSON.stringify({ owner: OWN_A, ids: 'R1' }),          // ids not an array
      JSON.stringify({ owner: OWN_A }),                     // no ids
    ]) {
      local.setItem(bucket(OWN_A), junk)
      expect(readFavsForOwner(OWN_A), junk).toEqual([])
      expect(isFavForOwner(OWN_A, R1), junk).toBe(false)
    }
  })

  it('entries are coerced: only non-empty strings, de-duplicated, order preserved', () => {
    setFavOwner(OWN_A)
    local.setItem(bucket(OWN_A), JSON.stringify({
      owner: OWN_A, ids: [R1, '', null, 7, R2, R1, { x: 1 }],
    }))
    expect(readFavsForOwner(OWN_A)).toEqual([R1, R2])
  })

  it('a disabled storage does not throw, it just has no favourites', () => {
    const saved = (globalThis as { localStorage?: unknown }).localStorage
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
    }
    try {
      setFavOwner(OWN_A)
      expect(readFavsForOwner(OWN_A)).toEqual([])
      expect(toggleFavForOwner(OWN_A, R1)).toBe(true)   // reports the new state, persists nothing
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = saved
    }
  })
})

// ══ I, J, K, L + the surfaces, read as source ════════════════════════════════

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

const HOME = 'app/[locale]/eat/page.tsx'
const SEARCH = 'app/[locale]/eat/search/page.tsx'
const FAVS = 'app/[locale]/eat/favorites/page.tsx'
const ACCOUNT = 'app/[locale]/eat/account/page.tsx'
const RESTO = 'app/[locale]/eat/r/[id]/page.tsx'
const SURFACES: Array<[string, string]> = [
  [HOME, 'home'], [SEARCH, 'search'], [FAVS, 'favorites'], [ACCOUNT, 'account'], [RESTO, 'resto'],
]

describe('I–L — the five surfaces, each gated on the live owner', () => {
  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    for (const [p, name] of SURFACES) {
      const src = executable(read(p))
      expect(src.includes('export default function'), name).toBe(true)
      expect(src.includes('favOwner('), name).toBe(true)
    }
    expect(read(HOME)).toContain('// ── FAVOURITES OWNER')
    expect(executable(read(HOME))).not.toContain('// ── FAVOURITES OWNER')
  })

  it('all five resolve the owner from the LIVE session, uniformly', () => {
    for (const [p, name] of SURFACES) {
      const src = executable(read(p))
      expect(/const favLiveUserId = \(\w+\?\.user as \{ id\?: string \} \| undefined\)\?\.id/.test(src), name).toBe(true)
      expect(/const favsOwner = favOwner\(\w+, favLiveUserId\)/.test(src), name).toBe(true)
    }
  })

  it('the AMBIGUOUS global API is gone, and no surface can reach it', () => {
    const lib = executable(read('lib/eat-cart.ts'))
    for (const dead of ['export function readFavs(', 'export function isFav(', 'export function toggleFav(']) {
      expect(lib.includes(dead), dead).toBe(false)
    }
    expect(lib).not.toMatch(/const FAV_KEY = 'grubano_favs'/)
    expect(lib).toMatch(/const FAV_PREFIX = 'grubano_favs\.v2\.'/)
    // and nobody calls the old names anywhere in the app
    for (const [p, name] of SURFACES) {
      const src = executable(read(p))
      expect(/(?<![\w$])readFavs\(/.test(src), name).toBe(false)
      expect(/(?<![\w$])isFav\(/.test(src), name).toBe(false)
      expect(/(?<![\w$])toggleFav\(/.test(src), name).toBe(false)
    }
  })

  it('every surface holds its favourites OWNER-STAMPED and derives what it shows', () => {
    // home / search / favorites hold a list…
    for (const [p, name] of [[HOME, 'home'], [SEARCH, 'search'], [FAVS, 'favorites']] as Array<[string, string]>) {
      const src = executable(read(p))
      expect(/const \[favsState, setFavsState\] = useState<\{ owner: string \| null; ids: string\[\] \}>\(\{ owner: null, ids: \[\] \}\)/.test(src), name).toBe(true)
      expect(/const favs = favsOwner !== null && favsState\.owner === favsOwner \? favsState\.ids : NO_FAVS/.test(src), name).toBe(true)
      expect(/const NO_FAVS: string\[\] = Object\.freeze\(\[\]\) as unknown as string\[\]/.test(src), name).toBe(true)
    }
    // J — account holds a COUNT, which is data too
    const account = executable(read(ACCOUNT))
    expect(account).toMatch(/const \[favCountState, setFavCountState\] = useState<\{ owner: string \| null; n: number \}>\(\{ owner: null, n: 0 \}\)/)
    expect(account).toMatch(/const favCount = favsOwner !== null && favCountState\.owner === favsOwner \? favCountState\.n : 0/)
    // L — the restaurant page holds one boolean
    const resto = executable(read(RESTO))
    expect(resto).toMatch(/const \[favState, setFavState\] = useState<\{ owner: string \| null; on: boolean \}>\(\{ owner: null, on: false \}\)/)
    expect(resto).toMatch(/const fav = favsOwner !== null && favState\.owner === favsOwner && favState\.on/)
  })

  it('every LISTENING surface filters BOTH events by owner', () => {
    // Four of the five listen for live changes. The restaurant page does not listen at all
    // — asserted below — so it cannot adopt a foreign event either; that is a different
    // way of being safe, not a missing guard, and this lot does not add live sync it was
    // not asked for.
    for (const [p, name] of [[HOME, 'home'], [SEARCH, 'search'], [FAVS, 'favorites'], [ACCOUNT, 'account']] as Array<[string, string]>) {
      const src = executable(read(p))
      expect(/if \(favEventIsMine\(e, favsOwner\)\) sync\(\)/.test(src), name).toBe(true)
      expect(/if \(favStorageIsMine\(e, favsOwner\)\) sync\(\)/.test(src), name).toBe(true)
      expect(/window\.addEventListener\(FAV_EVENT, onFav\)/.test(src), name).toBe(true)
      expect(/window\.addEventListener\('storage', onStore\)/.test(src), name).toBe(true)
    }
    // the restaurant page subscribes to NEITHER, so there is nothing to filter
    const resto = executable(read(RESTO))
    expect(resto).not.toMatch(/addEventListener\(FAV_EVENT/)
    expect(resto).not.toMatch(/favEventIsMine|favStorageIsMine/)
  })

  it('every surface re-derives its favourites when the identity changes', () => {
    // the dependency is what makes the state follow the session instead of the mount
    for (const [p, name] of SURFACES) {
      const src = executable(read(p))
      expect(/\}, \[.*favsOwner\]\)/.test(src), name).toBe(true)
    }
  })

  it('every WRITE names its owner and respects a refusal', () => {
    // the four writing surfaces (account only reads)
    for (const [p, name] of [[HOME, 'home'], [SEARCH, 'search'], [FAVS, 'favorites'], [RESTO, 'resto']] as Array<[string, string]>) {
      const src = executable(read(p))
      expect(/if \(favsOwner === null\) return/.test(src), name).toBe(true)
      expect(/toggleFavForOwner\(favsOwner, id\)/.test(src), name).toBe(true)
      // and the owner is DECLARED, so the library can refuse a stale handler
      expect(/setFavOwner\(favsOwner\)/.test(src), name).toBe(true)
    }
    // THE REFUSAL, anchored per surface on its own exact form. The earlier pin was
    // /=== null\) return/, which is equally satisfied by `if (favsOwner === null) return`
    // two lines above — a pin a neighbour can satisfy is not a pin, and deleting the real
    // refusal left the suite green.
    for (const [p, name] of [[HOME, 'home'], [RESTO, 'resto']] as Array<[string, string]>) {
      const src = executable(read(p))
      expect(
        /const now = toggleFavForOwner\(favsOwner, id\)\s*\n\s*if \(now === null\) return/.test(src),
        name + ': a refusal is not shown as a success',
      ).toBe(true)
    }
    for (const [p, name] of [[SEARCH, 'search'], [FAVS, 'favorites']] as Array<[string, string]>) {
      const src = executable(read(p))
      expect(
        /if \(toggleFavForOwner\(favsOwner, id\) === null\) return/.test(src),
        name + ': a refusal is not shown as a success',
      ).toBe(true)
    }
    // account reads only: it declares nothing and writes nothing
    const account = executable(read(ACCOUNT))
    expect(account).not.toMatch(/toggleFavForOwner/)
    expect(account).not.toMatch(/setFavOwner\(/)
  })

  it('…and the enumeration is not the ONLY guard: each surface renders from the GATED name', () => {
    // The enumeration says where the raw state may be NAMED. These say what the screens
    // actually render from, so neither surface depends on that one assertion alone.
    const home = executable(read(HOME))
    expect(home).toMatch(/const on = favs\.includes\(r\.id\)/)
    const account = executable(read(ACCOUNT))
    expect(account).toMatch(/<span className="val">\{favCount\}<\/span>/)
    const favsPage = executable(read(FAVS))
    expect(favsPage).toMatch(/const favRestaurants = favs/)
    const resto = executable(read(RESTO))
    expect(resto).toMatch(/className=\{`hd__ic\$\{fav \? ' is-fav' : ''\}`\}/)
    expect(resto).toMatch(/aria-pressed=\{fav\}/)
  })

  it('K — the favourites FILTER on search works off the gated list', () => {
    const src = executable(read(SEARCH))
    // favCount and the per-row heart both read `favs`, which is the gated list
    expect(src).toMatch(/const favCount = useMemo\(\(\) => results\.filter\(\(r\) => favs\.includes\(r\.id\)\)\.length, \[results, favs\]\)/)
    expect(src).toMatch(/const fav = favs\.includes\(r\.id\)/)
    expect(src).not.toMatch(/favsState\.ids\.includes/)
  })

  it('I — /eat/favorites builds its list from the gated ids, and says nothing without an owner', () => {
    const src = executable(read(FAVS))
    expect(src).toMatch(/const favRestaurants = favs\s*\n\s*\.map\(\(id\) => all\.find/)
    // « aucun favori » is a claim about THIS account, so it waits for an identity
    expect(src).toMatch(/const restoEmpty = !loading && favsOwner !== null && favRestaurants\.length === 0/)
  })

  it('CLOSED ENUMERATION: the raw stamped state is read only where it is gated', () => {
    for (const [p, name, raw] of [
      [HOME, 'home', 'favsState'], [SEARCH, 'search', 'favsState'], [FAVS, 'favorites', 'favsState'],
      [ACCOUNT, 'account', 'favCountState'], [RESTO, 'resto', 'favState'],
    ] as Array<[string, string, string]>) {
      const src = executable(read(p))
      const re = new RegExp(`(?<![\\w$])${raw}(?![\\w$])`)
      const lines = src.split('\n').filter((l) => re.test(l)).map((l) => l.trim())
      // EXACTLY TWO places may name the raw state: its declaration and the gate. The
      // earlier predicate also exempted "a line that starts with a setter" and "a line
      // containing setFav", which tested how a line BEGINS and not what it READS — so
      // `setFavFilter(favsState.ids.length > 0)`, an ungated read that would switch B's
      // Favoris chip on because A had favourites, passed. Those clauses were dead weight
      // on the real code anyway (the setters are `setFavsState`, which does not contain
      // the lowercase name this regex looks for), so they bought nothing and let a bypass
      // through. A whitelist with a clause nobody needs is a hole.
      expect(lines.length, `${name}: expected the declaration and the gate`).toBe(2)
      for (const l of lines) {
        const ok = l.startsWith(`const [${raw},`)          // the declaration
          || l.includes(`${raw}.owner === favsOwner`)       // the gate
        expect(ok, `${name}: ungated read -> ${l}`).toBe(true)
      }
    }
  })
})

describe('the lot touched nothing it was told not to touch', () => {
  it('the cart, addresses, supply cart and orders are untouched by this change', () => {
    const lib = read('lib/eat-cart.ts')
    // the cart half still has its own owner model and its explicit promotion — the
    // favourites rule (never promote) does NOT transpose to it
    expect(lib).toMatch(/export function promoteGuestCartToUser/)
    expect(lib).toMatch(/export function clearUserCart/)
    expect(lib).toMatch(/const PREFIX = 'grubano_cart\.v2\.'/)
    // and favourites never reach for the cart's buckets
    // ANCHORED ON CODE, and a miss is a FAILURE. The anchor used to be the banner comment,
    // and indexOf returns -1 on a miss — String.slice(-1) is the file's LAST CHARACTER, so
    // both bans below passed against a one-character haystack. Rewording a comment was
    // enough to void them.
    const favAt = lib.indexOf("const FAV_PREFIX = 'grubano_favs.v2.'")
    expect(favAt, 'the favourites anchor moved — this guard would be vacuous').toBeGreaterThan(-1)
    const favPart = lib.slice(favAt)
    expect(favPart).not.toMatch(/grubano_cart/)
    expect(favPart).not.toMatch(/sessionStorage/)
    for (const f of ['lib/eat-addresses.ts', 'lib/supply-cart.ts', 'app/[locale]/eat/orders/page.tsx']) {
      expect(read(f).length, f).toBeGreaterThan(100)
    }
  })
})
