import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionCartStamp } from '@/lib/eat-cart'

// ── /eat/account/edit — PROFILE NAME/PHONE, CROSS-ACCOUNT (P1 confidentialité + corruption) ──
//
// WHAT IS WRONG IN `main` (before this lot). app/[locale]/eat/account/edit/page.tsx has NO
// notion of identity at all beyond `sessionName` — no sessionCartStamp, no owner stamp on
// the loaded profile, no re-key of the load effect on identity, no server guard. The GET
// result is adopted into plain `name`/`phone` React state regardless of WHO the server
// authenticated, and the PATCH ships the current state WITHOUT naming the identity it was
// prepared for.
//
// A → logout → B inside the same tab therefore has TWO distinct leaks:
//   · READ — a GET for A is in flight when the cookie becomes B's: the server answers B,
//     the effect is still live (React has not moved yet), `active` is true, and the client
//     adopts B's name/phone as if they were A's. The next frame paints another account's
//     fields; the user is one keystroke away from writing them back.
//   · WRITE — the user types « Charlie » under A, the cookie becomes B's before the Save
//     button is clicked, the server authenticates B and persists A's text onto B's row.
//     That is CORRUPTION of B, not just a leak of A.
//
// The /eat/account/notifications lot closed the same two races, in the same shape, by:
//   · keying the load effect on the identity ([liveOwner, liveUserId, reloadNonce]),
//   · stamping the loaded state with the owner it was loaded FOR,
//   · comparing `d.ownerId` to the captured raw id BEFORE adoption,
//   · failing closed before the request, with a recoverable `loadError`,
//   · sending `expectedUserId` on every write, so the server refuses a stale mutation 409.
// This file holds `edit` to the same discipline.
//
// HOW THIS IS PROVEN. The identity rule is the repository's own exported `sessionCartStamp`
// — called, not restated. The effect/save sequencing is modelled, because it is control
// flow with no decision to export; the source pins at the bottom hold the real file to that
// shape, and the mutation battery (unit tests of the live route + the sibling suite that
// covers notifications) is what makes those pins non-vacuous.

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
const PAGE = 'app/[locale]/eat/account/edit/page.tsx'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`

/** A's saved profile — every field distinct from B's and from the defaults. */
const PROFILE_A = { name: 'Alice Dupont', phone: '0611111111' }
const PROFILE_B = { name: 'Bruno Martin', phone: '0622222222' }
/** The CD defaults the screen starts from — empty strings, so no leftover is possible. */
const DEFAULTS = { name: '', phone: '' }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * MODELLED: the load effect's sequencing and React's rule that an effect's cleanup runs
 * before the next run of that same effect. The IDENTITY decision is the real exported
 * `sessionCartStamp`. Everything the model asserts about the page's shape is pinned
 * separately against the source.
 */
function mountProfile() {
  type Profile = { name: string; phone: string }
  let liveOwner: string | null = null
  let state: { owner: string | null } & Profile = { owner: null, ...clone(DEFAULTS) }
  let loadCleanup: (() => void) | null = null
  let lastLoadOwner: string | null | undefined
  let loadFailed = false
  let nonce = 0
  // The RAW id, tracked beside the stamp exactly as the page tracks `liveUserId` beside
  // `liveOwner` — `liveOwner` IS `u:${liveUserId}` whenever the identity is a real account.
  const rawId = (o: string | null) => (o && o.startsWith('u:') ? o.slice(2) : undefined)
  const inFlight: Array<{ owner: string; userId?: string; alive: () => boolean }> = []
  /** A pending save: the identity it was PREPARED for, and what it was going to send. */
  let armedSave: { owner: string; userId: string; name: string; phone: string } | null = null
  const patches: Array<{ owner: string; userId: string; body: { name: string; phone: string } }> = []

  function runLoadEffect(force = false): void {
    if (!force && lastLoadOwner === liveOwner) return
    lastLoadOwner = liveOwner
    if (loadCleanup) loadCleanup()
    loadFailed = false
    state = { owner: null, ...clone(DEFAULTS) }  // FAIL CLOSED: drop whatever was shown
    if (liveOwner === null) return               // unresolved: no request at all
    if (liveOwner === 'guest') return            // a guest has no account to read or write
    const requestOwner = liveOwner
    const requestUserId = rawId(liveOwner)
    let alive = true
    inFlight.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    loadCleanup = () => { alive = false }
  }

  return {
    /** A session change: React re-renders, then runs the effect whose deps moved. */
    signIn(owner: string | null) { liveOwner = owner; runLoadEffect() },
    /**
     * The GET for a pending request answers. A third argument is the `ownerId` the SERVER
     * put in the body — the identity it actually authenticated. Omit it for an honest server
     * reached with the cookie the client expected; pass a different value to model the cookie
     * having already moved. REST-ARG DISTINGUISHES `undefined` FROM NOT PASSED.
     */
    answer(index: number, profile: Profile | null, ...rest: unknown[]) {
      const req = inFlight[index]
      if (!req) throw new Error('no such request')
      const serverOwnerId: unknown = rest.length > 0 ? rest[0] : req.userId
      if (!req.alive()) return
      if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) {
        loadFailed = true
        return
      }
      state = { owner: req.owner, ...clone(profile ?? DEFAULTS) }
    },
    /** The user presses « Réessayer » — the load effect re-runs. */
    retry() { nonce += 1; runLoadEffect(true) },
    /** The GET fails. A request that did not answer is not an answer: nothing is stamped. */
    failLoad(index: number) {
      const req = inFlight[index]
      if (!req || !req.alive()) return
      loadFailed = true
    },
    /** The user types in a field. REFUSED unless the on-screen values are this owner's. */
    typeName(v: string) {
      const mine = liveOwner !== null && state.owner === liveOwner
      if (!mine) return
      state = { ...state, name: v }
    },
    typePhone(v: string) {
      const mine = liveOwner !== null && state.owner === liveOwner
      if (!mine) return
      state = { ...state, phone: v }
    },
    /** The user clicks « Enregistrer ». Captures the identity it was prepared for. */
    clickSave() {
      const mine = liveOwner !== null && state.owner === liveOwner
      if (!mine) return
      if (!state.name.trim()) return                   // nameRequired → no save at all
      if (liveOwner === 'guest' || liveOwner === null) return
      const userId = rawId(liveOwner)
      if (userId === undefined) return
      armedSave = { owner: liveOwner, userId, name: state.name.trim(), phone: state.phone.trim() }
    },
    /**
     * The save LEAVES. The identity it was prepared for is compared with the LIVE identity
     * at send time — same discipline as the notifications debounce's fire-time re-check.
     */
    fireSave() {
      if (!armedSave) return
      if (armedSave.owner !== liveOwner) { armedSave = null; return }  // identity moved: refuse
      patches.push({
        owner: armedSave.owner,
        userId: armedSave.userId,
        body: { name: armedSave.name, phone: armedSave.phone },
      })
      armedSave = null
    },
    get pending() { return inFlight.length },
    get armed() { return armedSave !== null },
    get patches() { return patches },
    get nonce() { return nonce },
    /** What the screen actually shows. */
    get view() {
      const mine = liveOwner !== null && state.owner === liveOwner
      return {
        mine,
        inert: !mine,                    // the inputs/save are disabled until the row is this owner's
        name: mine ? state.name : DEFAULTS.name,
        phone: mine ? state.phone : DEFAULTS.phone,
        rawOwner: state.owner,
        loadFailed,
        retryOffered: loadFailed,
      }
    },
  }
}

// ══ the identity, reused rather than redefined ══════════════════════════════

describe('the identity is the repository\'s own', () => {
  it('sessionCartStamp is CALLED, and this page does not invent a third definition', () => {
    expect(sessionCartStamp('authenticated', A)).toBe(OWN_A)
    expect(sessionCartStamp('unauthenticated', null)).toBe('guest')
    expect(sessionCartStamp('loading', A), 'unresolved is null, never a usable owner').toBeNull()
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()

    const src = executable(read(PAGE))
    expect(src, 'the page imports the shared stamp').toMatch(
      /import \{[^}]*sessionCartStamp[^}]*\} from '@\/lib\/eat-cart'/,
    )
    expect(src, 'and derives the owner from it exactly once').toMatch(
      /const liveOwner = sessionCartStamp\(status, liveUserId\)/,
    )
    expect((src.match(/sessionCartStamp\(/g) ?? []).length, 'one call site').toBe(1)
    // The two lines that produce the owner are fixed exactly, so no `?? 'anon'` can smuggle a
    // usable owner out of an unresolved session.
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /(?<![\w$])liveUserId(?![\w$])/.test(l))).toEqual([
      'const liveUserId = (session?.user as { id?: string } | undefined)?.id',
      'const liveOwner = sessionCartStamp(status, liveUserId)',
      // captured so the RESPONSE can be held to the id the request was issued for
      'const requestUserId = liveUserId',
      // DECLARED, not suppressed: the load effect really reads the id now. It cannot add a
      // run — `liveOwner` is `u:${liveUserId}` whenever the owner is an account.
      '}, [liveOwner, liveUserId, reloadNonce])',
      // captured for the server guard, from THE SAME render that produced `saveOwner`
      'const saveUserId = liveUserId',
    ])
  })
})

// ══ A–H : the mandated matrix ═══════════════════════════════════════════════

describe('A–H — the profile never crosses an account boundary', () => {
  let p: ReturnType<typeof mountProfile>
  beforeEach(() => { p = mountProfile() })

  it('A — A loaded, then B signs in BEFORE A answers: B sees nothing of A', () => {
    p.signIn(OWN_A)
    p.signIn(OWN_B)                        // the switch happens while A's GET is in flight
    p.answer(0, PROFILE_A)                 // …and A answers late
    expect(p.view.rawOwner, 'the superseded response committed nothing').not.toBe(OWN_A)
    expect(p.view.name).toBe(DEFAULTS.name)
    expect(p.view.phone).toBe(DEFAULTS.phone)
    expect(p.view.inert, 'and the screen is inert until B\'s own profile lands').toBe(true)
    p.typeName('whatever B tries to type')
    p.clickSave()
    p.fireSave()
    expect(p.patches, 'nothing was written anywhere').toEqual([])
  })

  it('B — A loaded, then B loaded: each sees only its own', () => {
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A)
    expect(p.view.mine).toBe(true)
    expect(p.view.name).toBe(PROFILE_A.name)
    expect(p.view.phone).toBe(PROFILE_A.phone)

    p.signIn(OWN_B)
    expect(p.view.rawOwner, 'A\'s values are dropped the moment the identity moves').toBeNull()
    expect(p.view.name, 'neutral defaults, never A\'s').toBe(DEFAULTS.name)
    expect(p.view.phone).toBe(DEFAULTS.phone)
    expect(p.view.inert).toBe(true)

    p.answer(1, PROFILE_B)
    expect(p.view.mine).toBe(true)
    expect(p.view.name).toBe(PROFILE_B.name)
    expect(p.view.phone).toBe(PROFILE_B.phone)
  })

  it('C — a save armed under A does NOT PATCH after the switch to B', () => {
    // The real race the user triggers: A types the new values, the cookie flips to B before
    // the click leaves. The click captures the owner it was armed for; the fire-time check
    // sees the LIVE identity has moved and refuses — nothing of A reaches B's row.
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A)
    p.typeName('Alice updated')
    p.typePhone('0633333333')
    p.clickSave()
    expect(p.armed).toBe(true)
    p.signIn(OWN_B)                        // the session flips before the request leaves
    p.fireSave()
    expect(p.patches, 'nothing was PATCHed under B').toEqual([])
    // and B\'s own row, after its own load, is untouched
    p.answer(1, PROFILE_B)
    expect(p.view.name, 'B still has B\'s row').toBe(PROFILE_B.name)
  })

  it('D — a LATE response for A, after B has already loaded, changes nothing', () => {
    p.signIn(OWN_A)
    p.signIn(OWN_B)
    p.answer(1, PROFILE_B)                 // B answers first
    expect(p.view.name).toBe(PROFILE_B.name)
    p.answer(0, PROFILE_A)                 // A answers last
    expect(p.view.rawOwner, 'B keeps its own').toBe(OWN_B)
    expect(p.view.name).toBe(PROFILE_B.name)
    expect(p.view.phone).toBe(PROFILE_B.phone)
  })

  it('E — after the switch, a save by B sends B\'s values ONLY', () => {
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A)
    p.signIn(OWN_B)
    p.answer(1, PROFILE_B)
    p.typeName('Bruno Updated')
    p.clickSave()
    p.fireSave()
    expect(p.patches.length).toBe(1)
    const sent = p.patches[0]
    expect(sent.owner).toBe(OWN_B)
    expect(sent.userId, 'and the id captured was the raw operator id, not the stamp').toBe(B)
    expect(sent.body.name).toBe('Bruno Updated')
    expect(sent.body.phone, 'B\'s own phone, never A\'s').toBe(PROFILE_B.phone)
    // the strongest form: no value of A's appears anywhere in the payload
    const body = JSON.stringify(sent)
    expect(body).not.toContain(PROFILE_A.name)
    expect(body).not.toContain(PROFILE_A.phone)
  })

  it('F — logout to guest: no profile shown, and nothing is ever persisted', () => {
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A)
    p.signIn('guest')
    expect(p.view.name, 'a guest sees the neutral defaults').toBe(DEFAULTS.name)
    expect(p.view.phone).toBe(DEFAULTS.phone)
    expect(JSON.stringify(p.view)).not.toContain(PROFILE_A.name)
    expect(JSON.stringify(p.view)).not.toContain(PROFILE_A.phone)
    expect(p.pending, 'and no account read is even attempted beyond A\'s own').toBe(1)
    p.typeName('something')
    p.clickSave()
    p.fireSave()
    expect(p.patches, 'a guest never writes an account').toEqual([])
  })

  it('G — an UNRESOLVED identity reads nothing and writes nothing', () => {
    p.signIn(null)                         // status 'loading', or authenticated with no id
    expect(p.pending, 'no request leaves while we cannot name the owner').toBe(0)
    expect(p.view.inert).toBe(true)
    expect(p.view.name).toBe(DEFAULTS.name)
    p.typeName('x')
    p.clickSave()
    p.fireSave()
    expect(p.patches).toEqual([])
    // …and coming back to a real identity works normally
    p.signIn(OWN_B)
    p.answer(0, PROFILE_B)
    expect(p.view.mine).toBe(true)
    expect(p.view.name).toBe(PROFILE_B.name)
  })

  it('H — loading B does NOT echo B\'s own values back as a PATCH', () => {
    // There is no debounce on this screen (save is manual on click), so "echo on load" is a
    // non-issue by construction, but the invariant is still asserted: a load alone must not
    // produce a write. If the screen ever grows auto-save, this is where the regression lands.
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A)
    expect(p.armed, 'no implicit save was armed').toBe(false)
    p.signIn(OWN_B)
    p.answer(1, PROFILE_B)
    expect(p.armed).toBe(false)
    expect(p.patches).toEqual([])
  })

  it('a FAILED load is not a load: nothing is stamped, so nothing can be PATCHed over it', () => {
    p.signIn(OWN_A)
    p.failLoad(0)
    expect(p.view.mine, 'not loaded').toBe(false)
    expect(p.view.inert).toBe(true)
    p.typeName('x')
    p.clickSave()
    p.fireSave()
    expect(p.patches, 'and therefore unable to clobber the server').toEqual([])
  })

  it('A → B → A: A\'s own profile is readable again, and B never held it', () => {
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A)
    p.signIn(OWN_B)
    p.answer(1, PROFILE_B)
    expect(p.view.name).toBe(PROFILE_B.name)
    p.signIn(OWN_A)
    expect(p.view.inert, 'a fresh read is required, nothing is reused from memory').toBe(true)
    p.answer(2, PROFILE_A)
    expect(p.view.name).toBe(PROFILE_A.name)
  })
})

// ══ the GET half of the TOCTOU ══════════════════════════════════════════════

describe('a GET response is adopted only under the identity the SERVER authenticated', () => {
  let p: ReturnType<typeof mountProfile>
  beforeEach(() => { p = mountProfile() })

  it('1 — the client believes A, the server answers ownerId=B: B\'s profile is NEVER adopted', () => {
    p.signIn(OWN_A)
    expect(p.pending, 'the GET left believing it was A\'s').toBe(1)
    // the cookie had already become B's: the server authenticated B and returned B's row
    p.answer(0, PROFILE_B, B)
    expect(p.view.rawOwner, 'nothing was stamped at all').toBeNull()
    expect(p.view.mine, 'and therefore nothing is « mine »').toBe(false)
    expect(p.view.name, 'the neutral defaults, never B\'s').toBe(DEFAULTS.name)
    expect(p.view.phone).toBe(DEFAULTS.phone)
    const shown = JSON.stringify(p.view)
    expect(shown).not.toContain(PROFILE_B.name)
    expect(shown).not.toContain(PROFILE_B.phone)
    expect(p.view.inert).toBe(true)
    p.typeName('x')
    p.clickSave()
    p.fireSave()
    expect(p.patches).toEqual([])
  })

  it('2 — the client believes A and the server answers ownerId=A: adopted, unchanged', () => {
    p.signIn(OWN_A)
    p.answer(0, PROFILE_A, A)
    expect(p.view.mine).toBe(true)
    expect(p.view.rawOwner).toBe(OWN_A)
    expect(p.view.name).toBe(PROFILE_A.name)
    expect(p.view.phone).toBe(PROFILE_A.phone)
    expect(p.view.loadFailed, 'a correct response is not a failure').toBe(false)
    p.typeName('Alice v2')
    p.clickSave()
    p.fireSave()
    expect(p.patches.length).toBe(1)
    expect(p.patches[0].owner).toBe(OWN_A)
  })

  it('3 — a mismatching response with a perfectly valid profile is fail-closed, and RECOVERABLE', () => {
    p.signIn(OWN_A)
    p.answer(0, PROFILE_B, B)              // structurally valid, attributed to the wrong account
    expect(p.view.rawOwner, 'NOT stamped as loaded defaults').toBeNull()
    expect(p.view.loadFailed, 'the screen says the load failed').toBe(true)
    expect(p.view.retryOffered).toBe(true)
    expect(p.view.inert).toBe(true)
    p.typeName('x')
    p.clickSave()
    p.fireSave()
    expect(p.patches, 'nothing can be written over what we failed to read').toEqual([])

    // RECOVERABLE: the retry re-runs the load, and a correct response works normally.
    p.retry()
    expect(p.nonce).toBe(1)
    expect(p.pending, 'a fresh request left').toBe(2)
    expect(p.view.loadFailed, 'the retry clears the error').toBe(false)
    p.answer(1, PROFILE_A, A)
    expect(p.view.mine).toBe(true)
    expect(p.view.name).toBe(PROFILE_A.name)
  })

  it('3 bis — a response that names NOBODY is refused too (undefined is not a match)', () => {
    for (const bad of [undefined, null, '', 0, false, {}, [], `u:${A}`]) {
      const q = mountProfile()
      q.signIn(OWN_A)
      q.answer(0, PROFILE_A, bad)
      expect(q.view.rawOwner, `ownerId=${JSON.stringify(bad)}`).toBeNull()
      expect(q.view.mine, `ownerId=${JSON.stringify(bad)}`).toBe(false)
      expect(q.view.loadFailed, `ownerId=${JSON.stringify(bad)}`).toBe(true)
    }
    // …including the STAMP instead of the raw id: 'u:user-A' is not 'user-A'.
  })

  it('4 — A → B, then A\'s own response arrives late: still refused', () => {
    p.signIn(OWN_A)
    p.signIn(OWN_B)                        // React catches up; A's request is superseded
    p.answer(1, PROFILE_B, B)              // B loads normally
    expect(p.view.name).toBe(PROFILE_B.name)
    p.answer(0, PROFILE_A, A)              // A's honest, correctly-attributed response, late
    expect(p.view.rawOwner, 'B keeps its own').toBe(OWN_B)
    expect(p.view.name).toBe(PROFILE_B.name)
    expect(p.view.loadFailed, 'and a superseded response is not an error on B\'s screen').toBe(false)
  })

  it('4 bis — the two guards are independent: neither alone would be enough', () => {
    const q = mountProfile()
    q.signIn(OWN_A)
    q.signIn(OWN_B)
    q.answer(0, PROFILE_A, A)              // superseded but correctly attributed → only `alive`
    expect(q.view.rawOwner).toBeNull()

    const r = mountProfile()
    r.signIn(OWN_A)
    r.answer(0, PROFILE_B, B)              // live but wrongly attributed → only the ownerId check
    expect(r.view.rawOwner).toBeNull()
    expect(r.view.loadFailed).toBe(true)
  })

  it('guest and unresolved still issue NO account GET at all', () => {
    const g = mountProfile()
    g.signIn('guest')
    expect(g.pending, 'a guest has no account to read').toBe(0)
    expect(g.view.loadFailed).toBe(false)
    const u = mountProfile()
    u.signIn(null)
    expect(u.pending).toBe(0)
    expect(u.view.loadFailed).toBe(false)
  })
})

// ══ the real file ═══════════════════════════════════════════════════════════

describe('the page really implements this', () => {
  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(executable(read(PAGE))).toContain('useState')
    expect(read(PAGE)).toContain('// ── IDENTITY')
    expect(executable(read(PAGE))).not.toContain('// ── IDENTITY')
  })

  it('the load effect is keyed on the identity, and fails closed before it', () => {
    const src = executable(read(PAGE))
    // keyed on the owner — NOT on `[]` or on `[status, sessionName]` (what let B inherit A\'s)
    expect(src).toMatch(/\}, \[liveOwner, liveUserId, reloadNonce\]\)/)
    expect(src, 'the stale dep set is gone').not.toMatch(/\}, \[status, sessionName\]\)/)
    // the previous account's values are dropped BEFORE anything is requested
    expect(src).toMatch(
      /useEffect\(\(\) => \{(?:(?!useEffect\()[\s\S])*?setProfile\(\{ owner: null, \.\.\.DEFAULT_PROFILE \}\)/,
    )
    // unresolved and guest never reach the network
    expect(src).toMatch(/if \(liveOwner === null\) return/)
    expect(src).toMatch(/if \(liveOwner === 'guest'\)/)
    // the response is stamped with the owner the request was issued FOR
    expect(src).toMatch(/const requestOwner = liveOwner/)
    expect(src).toMatch(/setProfile\(\{ owner: requestOwner, name: nextName, phone: nextPhone \}\)/)
    // and a superseded request commits nothing
    expect(src).toMatch(/let alive = true/)
    // POSITION, NOT PRESENCE: the guard is the FIRST statement of the commit callback. A
    // reviewer who moves `if (!alive) return` below the stamped setProfile turns it into dead
    // code; the regex forbids that by binding to the opening of the `.then` lambda.
    expect(src).toMatch(
      /\.then\(\(d: \{ ownerId\?: unknown; name\?: unknown; phone\?: unknown \} \| null\) => \{\s*if \(!alive\) return/,
    )
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)

    // ── THE GET OWNER CHECK ────────────────────────────────────────────────────────
    // The raw id is captured BESIDE the stamp, from the same render.
    expect(src).toMatch(/const requestOwner = liveOwner\s*const requestUserId = liveUserId/)
    // POSITION: between `if (!alive) return` and the first use of the payload, so moving it
    // below the stamped setProfile (where it is dead code) cannot pass.
    expect(src).toMatch(
      /if \(!alive\) return\s*if \(typeof d\?\.ownerId !== 'string' \|\| d\.ownerId !== requestUserId\) \{\s*setLoadFailed\(true\)\s*return\s*\}\s*const nextName = /,
    )
    expect(src, 'the equality is against the CAPTURED id').toMatch(/d\.ownerId !== requestUserId/)
    expect(src, 'and a response that names nobody is not a match').toMatch(/typeof d\?\.ownerId !== 'string'/)
    expect(src, 'never compared against the live id').not.toMatch(/d\.ownerId !== liveUserId/)
    // EXACT SET over the fail-closed signal, so the mismatch cannot be routed anywhere else
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /setLoadFailed\(/.test(l))).toEqual([
      'setLoadFailed(false)',                              // cleared at the top of every load
      'setLoadFailed(true)',                               // the owner mismatch
      '.catch(() => { if (alive) setLoadFailed(true) })',  // the transport failure
    ])
    // the mismatch branch TERMINATES — a missing `return` would fall through and adopt it
    expect(src).toMatch(/setLoadFailed\(true\)\s*return\s*\}/)
    expect(src, 'and it is never stamped as loaded under default values').not.toMatch(
      /setProfile\(\{ owner: requestOwner, \.\.\.DEFAULT_PROFILE \}\)/,
    )

    // THE SERVER HALF — the check is worthless if the response does not carry the id.
    const api = executable(read('app/api/eat/account/route.ts'))
    expect(api, 'the GET returns the AUTHENTICATED id, not anything from the request').toMatch(
      /return NextResponse\.json\(\{\s*ownerId: userId,/,
    )
    // A NON-2xx IS A FAILURE, NOT AN ANSWER. Returning `null` would make the `.then` stamp
    // whatever the fallback was and the next click would PATCH values the user never chose.
    expect(src).toMatch(
      /\.then\(\(r\) => \(r\.ok \? r\.json\(\) : Promise\.reject\(new Error\('not ok'\)\)\)\)/,
    )
    expect(src, 'and the transport failure sets loadFailed').toMatch(
      /\.catch\(\(\) => \{ if \(alive\) setLoadFailed\(true\) \}\)/,
    )
  })

  it('EXACT SET — every container on this page, so none can hold an ungated copy', () => {
    const containers = executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /useState<|useState\(|useRef<|useRef\(|^let /.test(l))
    expect(containers).toEqual([
      // the live identity, mirrored so the save callback can re-check at send time
      'const liveOwnerRef = useRef<string | null>(liveOwner)',
      // THE ONE CONTAINER THAT HOLDS NAME/PHONE, with the owner inside it
      'const [profile, setProfile] = useState<ProfileState>({ owner: null, ...DEFAULT_PROFILE })',
      'const [saving, setSaving] = useState(false)',                            // a boolean
      'const [loadFailed, setLoadFailed] = useState(false)',                    // a boolean
      'const [reloadNonce, setReloadNonce] = useState(0)',                      // a counter
      'let alive = true',                                                       // per-request
    ])
  })

  it('EXACT SET — every write of the profile state', () => {
    const src = executable(read(PAGE)).split('\n').map((l) => l.trim())
    expect(src.filter((l) => /setProfile\(/.test(l))).toEqual([
      'setProfile({ owner: null, ...DEFAULT_PROFILE })',               // fail-closed on identity change
      'setProfile({ owner: requestOwner, name: nextName, phone: nextPhone })',   // GET adopted
      'setProfile((p) => (p.owner === liveOwner ? { ...p, name: v } : p))',      // user types name
      'setProfile((p) => (p.owner === liveOwner ? { ...p, phone: v } : p))',     // user types phone
      // PATCH echo adopted only if the identity hasn\'t moved since the save was armed
      'setProfile((p) => (p.owner === saveOwner ? { ...p, name: d.name ?? p.name, phone: typeof d.phone === \'string\' ? d.phone : p.phone } : p))',
    ])
  })

  it('the render is gated, so no frame can paint another account\'s profile', () => {
    const src = executable(read(PAGE))
    expect(src).toMatch(/const mine = liveOwner !== null && profile\.owner === liveOwner/)
    // every value the JSX reads comes from the gate, never from `profile` directly
    expect(src).toMatch(/const name = mine \? profile\.name : DEFAULT_PROFILE\.name/)
    expect(src).toMatch(/const phone = mine \? profile\.phone : DEFAULT_PROFILE\.phone/)
    // COUNTED: three controls — name input, phone input, save button. A bare toMatch is
    // satisfied by any one, so removing the guard from one alone would stay green. The regex
    // accepts both bare `disabled={!mine}` and `disabled={saving || !mine}`.
    expect((src.match(/disabled=\{[^}]*!mine[^}]*\}/g) ?? []).length, 'every control is inert when not mine').toBe(3)
    // COUNTED IS NOT PLACED. The two inputs and the save button are each anchored to their
    // own identifying attribute, so migrating all `disabled` markers to the back button would
    // not satisfy these counts.
    expect(src, 'the name input').toMatch(/autoComplete="name"[\s\S]{0,160}?disabled=\{!mine\}/)
    expect(src, 'the phone input').toMatch(/autoComplete="tel"[\s\S]{0,160}?disabled=\{!mine\}/)
    expect(src, 'the save button').toMatch(/className="save"[\s\S]{0,200}?disabled=\{saving \|\| !mine\}/)
    // EXACT SET over the raw state reads, so nothing bypasses the gate. Case-sensitive,
    // and the lookaround excludes `-` so the stylesheet class `gb-profile-edit` is not
    // matched — this enumeration is about the lowercase `profile` state identifier only.
    const raw = executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /(?<![\w$-])profile(?![\w$-])/.test(l))
    expect(raw).toEqual([
      'const [profile, setProfile] = useState<ProfileState>({ owner: null, ...DEFAULT_PROFILE })',
      'const mine = liveOwner !== null && profile.owner === liveOwner',
      'const name = mine ? profile.name : DEFAULT_PROFILE.name',
      'const phone = mine ? profile.phone : DEFAULT_PROFILE.phone',
    ])
  })

  it('the save captures and refuses every identity it must refuse, and re-checks at send time', () => {
    const src = executable(read(PAGE))
    // the owner and raw id are captured at CLICK time, not re-read later from the live value
    expect(src).toMatch(/const saveOwner = liveOwner/)
    expect(src).toMatch(/const saveUserId = liveUserId/)
    expect(src).toMatch(/if \(saveUserId === undefined\) return/)
    // THE MIRROR IS WRITTEN DURING RENDER, not in a trailing effect — same discipline as the
    // notifications page.
    expect(src).toMatch(
      /const liveOwnerRef = useRef<string \| null>\(liveOwner\)\s*liveOwnerRef\.current = liveOwner/,
    )
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /liveOwnerRef/.test(l))).toEqual([
      'const liveOwnerRef = useRef<string | null>(liveOwner)',
      'liveOwnerRef.current = liveOwner',
      // the response/catch toasts both consult the mirror, so a late success/error can\'t
      // surface under another account\'s mount
      "if (liveOwnerRef.current === saveOwner) showToast(t('saveOk'))",
      "if (liveOwnerRef.current === saveOwner) showToast(t('saveError'))",
    ])

    // THE MUTATION NAMES THE IDENTITY IT WAS PREPARED FOR
    expect(src).toMatch(
      /body: JSON\.stringify\(\{ expectedUserId: saveUserId, name: trimmed, phone: phone\.trim\(\) \}\)/,
    )
    // A 409 IS A STALE MUTATION: no « saveOk » for a write that did not happen.
    expect(src).toMatch(/if \(res\.status === 409\) return/)
    expect(src, 'nothing re-sends a refused payload').not.toMatch(/retr(y|ies)\s*\(/i)
    // The guest/unresolved case: save is a no-op (no network call) when the identity cannot
    // be named at click time.
    expect(src).toMatch(/if \(saving \|\| !mine\) return/)
    // EXACT SET over the network calls on this page
    const calls = executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /fetch\(/.test(l))
    expect(calls).toEqual([
      "fetch('/api/eat/account', { headers: { accept: 'application/json' } })",
      "const res = await fetch('/api/eat/account', {",
    ])
  })

  it('the endpoint stays owner-scoped on the SERVER — this lot is client-side only', () => {
    const api = executable(read('app/api/eat/account/route.ts'))
    expect(api).toMatch(/getServerSession\(authOptions\)/)
    // BOTH queries anchored
    expect((api.match(/where: \{ id: userId \}/g) ?? []).length, 'the GET and the PATCH').toBe(2)
    expect(api, 'the GET reads only the caller\'s row').toMatch(
      /prisma\.operator\.findUnique\(\{\s*where: \{ id: userId \}/,
    )
    expect(api, 'the PATCH writes only the caller\'s row').toMatch(
      /prisma\.operator\.update\(\{\s*where: \{ id: userId \}/,
    )
  })

  it('the retry button is wired to the recovery counter', () => {
    const src = executable(read(PAGE))
    // the only writer of reloadNonce is the retry button
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /setReloadNonce/.test(l))).toEqual([
      'const [reloadNonce, setReloadNonce] = useState(0)',
      '<button type="button" className="pe-retry" onClick={() => setReloadNonce((n) => n + 1)}>',
    ])
    // and the loadError block offers the retry action in the body of the screen
    expect(src).toMatch(/loadFailed && \(/)
    expect(src).toMatch(/t\('loadError'\)/)
    expect(src).toMatch(/t\('retry'\)/)
  })
})
