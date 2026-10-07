import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionCartStamp } from '@/lib/eat-cart'

// ── NOTIFICATION PREFERENCES, CROSS-ACCOUNT (P1 confidentialité + corruption) ──
//
// WHAT IS WRONG IN `main`. app/[locale]/eat/account/notifications/page.tsx has NO notion of
// identity at all — no useSession, no stamp, nothing. Grep the file: zero matches. The
// preferences are loaded once by an effect keyed on `[]` and kept in plain React state, and
// a debounced effect PATCHes `{ channels, rows, quiet }` back to /api/eat/account on any
// change. The endpoint is correctly owner-scoped on the server (getServerSession →
// `where: { id: userId }`), so the whole defect is client-side — the same shape as the
// orders, receipt, favourites and cart lots.
//
// On A → logout → B inside one mount, the load effect never re-runs, so:
//   · B's screen renders A's preferences, with no gate and no frame of safety;
//   · the moment B flips one switch, the save effect PATCHes A's values (merged with B's
//     single change) under B's cookie. The leak becomes a PERSISTENT CORRUPTION of B's
//     account, and A's preferences are what B's account now holds.
//
// Two async races make it worse, and neither is closed by the `alive` flag that is already
// in the file:
//   · the load effect's cleanup only runs on UNMOUNT (deps `[]`), so a late GET for A lands
//     into state that B is already looking at;
//   · the save effect's cleanup only runs when `[channels, rows, quiet, loaded, t]` change.
//     A session change moves none of them, so a 600 ms debounce armed under A is NOT
//     cleared and fires under B's cookie.
//
// HOW THIS IS PROVEN. The identity rule is the repository's own exported `sessionCartStamp`
// — called, not restated. The effect/timer sequencing is modelled, because it is control
// flow inside two effects with no decision to export; the source pins below hold the real
// file to that shape, and the mutation battery is what makes those pins non-vacuous.

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
const PAGE = 'app/[locale]/eat/account/notifications/page.tsx'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`

/** What A has saved — every field distinct from B's and from the defaults. */
const PREFS_A = {
  channels: { push: false, email: false, sms: true },
  rows: { status: false, courier: false, reviews: true, offers: false, newResto: true, rewards: false },
  quiet: false,
}
const PREFS_B = {
  channels: { push: true, email: false, sms: false },
  rows: { status: true, courier: false, reviews: false, offers: false, newResto: false, rewards: false },
  quiet: true,
}
/** The CD defaults the screen starts from — what a visitor with no loaded prefs must see. */
const DEFAULTS = {
  channels: { push: true, email: true, sms: false },
  rows: { status: true, courier: true, reviews: false, offers: true, newResto: false, rewards: true },
  quiet: true,
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * MODELLED: the two effects' sequencing and React's rule that an effect's cleanup runs
 * before the next run of that same effect. The IDENTITY decision is the real exported
 * `sessionCartStamp`. Everything the model asserts about the page's shape is pinned
 * separately against the source.
 */
function mountPrefs() {
  type Prefs = { channels: Record<string, boolean>; rows: Record<string, boolean>; quiet: boolean }
  let liveOwner: string | null = null
  let state: { owner: string | null } & Prefs = { owner: null, ...clone(DEFAULTS) }
  let firstSave = true
  let timer: { owner: string; payload: Prefs } | null = null
  let loadCleanup: (() => void) | null = null
  let saveCleanup: (() => void) | null = null
  let lastLoadOwner: string | null | undefined
  let loadFailed = false
  let nonce = 0
  // The RAW id, tracked beside the stamp exactly as the page tracks `liveUserId` beside
  // `liveOwner` — `liveOwner` IS `u:${liveUserId}` whenever the identity is a real account.
  const rawId = (o: string | null) => (o && o.startsWith('u:') ? o.slice(2) : undefined)
  const inFlight: Array<{ owner: string; userId?: string; alive: () => boolean }> = []
  const patches: Array<{ owner: string; payload: Prefs }> = []

  /** The load effect, keyed on the identity. */
  function runLoadEffect(force = false): void {
    // keyed on [liveOwner, reloadNonce]: no change, no re-run
    if (!force && lastLoadOwner === liveOwner) return
    lastLoadOwner = liveOwner
    if (loadCleanup) loadCleanup()
    // an identity change disarms whatever the previous one left behind
    timer = null
    firstSave = true
    loadFailed = false
    state = { owner: null, ...clone(DEFAULTS) }  // FAIL CLOSED: drop the previous account
    if (liveOwner === null) return               // unresolved: no request at all
    if (liveOwner === 'guest') {                 // a guest has no account to read or write
      state = { owner: 'guest', ...clone(DEFAULTS) }
      return
    }
    const requestOwner = liveOwner
    const requestUserId = rawId(liveOwner)       // captured beside the stamp, not re-derived later
    let alive = true
    inFlight.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    loadCleanup = () => { alive = false }
  }

  /** The save effect, keyed on the stamped prefs and the identity. */
  function runSaveEffect(): void {
    if (saveCleanup) saveCleanup()
    if (liveOwner === null) return          // narrows the type as well as the behaviour
    const mine = state.owner === liveOwner
    if (!mine) return
    if (liveOwner === 'guest') return
    if (firstSave) { firstSave = false; return }
    const saveOwner: string = liveOwner
    const payload: Prefs = { channels: clone(state.channels), rows: clone(state.rows), quiet: state.quiet }
    timer = { owner: saveOwner, payload }
    saveCleanup = () => { timer = null }
  }

  const flush = () => { runLoadEffect(); runSaveEffect() }

  return {
    /** A session change: React re-renders, then runs the effects whose deps moved. */
    signIn(owner: string | null) { liveOwner = owner; flush() },
    /**
     * The GET for a pending request answers. A third argument is the `ownerId` the SERVER
     * put in the body — the identity it actually authenticated. Omit it for an honest server
     * reached with the cookie the client expected; pass a different value to model the cookie
     * having already moved.
     *
     * TAKEN AS A REST ARGUMENT, NOT A DEFAULTED PARAMETER. `answer(0, PREFS, undefined)`
     * triggers a default parameter, so « the server omitted the field » would silently become
     * « the server named the right owner » — which is exactly the case the page's `typeof`
     * half exists to close, and the first version of this harness could not express it.
     * Arity distinguishes « not passed » from « passed undefined »; nothing else does.
     */
    answer(index: number, prefs: Prefs | null, ...rest: unknown[]) {
      const req = inFlight[index]
      if (!req) throw new Error('no such request')
      const serverOwnerId: unknown = rest.length > 0 ? rest[0] : req.userId
      if (!req.alive()) return                       // superseded: commits nothing
      // THE SERVER MUST NAME THE SAME RAW ID THIS REQUEST WAS PREPARED FOR. A response the
      // server attributed to anyone else — or to nobody, by omitting the field — is a failed
      // load, never a loaded screen.
      if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) {
        loadFailed = true
        flush()
        return
      }
      state = { owner: req.owner, ...clone(prefs ?? DEFAULTS) }
      flush()
    },
    /** The user presses « Réessayer » — `reloadNonce` moves, so the load effect re-runs. */
    retry() { nonce += 1; runLoadEffect(true); runSaveEffect() },
    /** The GET fails. A request that did not answer is not an answer: nothing is stamped. */
    failLoad(index: number) {
      const req = inFlight[index]
      if (!req || !req.alive()) return
      loadFailed = true
      flush()
    },
    /** The user flips a switch. */
    toggleQuiet() {
      const mine = liveOwner !== null && state.owner === liveOwner
      if (!mine) return
      state = { ...state, quiet: !state.quiet }
      flush()
    },
    /** The 600 ms debounce expires. */
    fireTimer() {
      if (!timer) return
      if (timer.owner !== liveOwner) return          // the identity moved while it was armed
      patches.push({ owner: timer.owner, payload: timer.payload })
      timer = null
    },
    get pending() { return inFlight.length },
    get armed() { return timer !== null },
    get patches() { return patches },
    get nonce() { return nonce },
    /** What the screen actually shows. */
    get view() {
      const mine = liveOwner !== null && state.owner === liveOwner
      return {
        mine,
        inert: !mine,                    // the switches are disabled until the prefs are this owner's
        channels: mine ? state.channels : DEFAULTS.channels,
        rows: mine ? state.rows : DEFAULTS.rows,
        quiet: mine ? state.quiet : DEFAULTS.quiet,
        rawOwner: state.owner,
        // the recoverable half: the screen SAYS the load failed and offers the retry
        loadFailed,
        retryOffered: loadFailed,
      }
    },
  }
}

// ══ the identity, reused rather than redefined ══════════════════════════════

describe('the identity is the repository\'s own', () => {
  it('sessionCartStamp is CALLED, and this page does not invent a third definition', () => {
    // Executed, not restated: the three answers this page depends on.
    expect(sessionCartStamp('authenticated', A)).toBe(OWN_A)
    expect(sessionCartStamp('unauthenticated', null)).toBe('guest')
    expect(sessionCartStamp('loading', A), 'unresolved is null, never a usable owner').toBeNull()
    // an authenticated session with no resolvable id is unresolved too — never 'guest'
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()

    const src = executable(read(PAGE))
    expect(src, 'the page imports the shared stamp').toMatch(
      /import \{[^}]*sessionCartStamp[^}]*\} from '@\/lib\/eat-cart'/,
    )
    expect(src, 'and derives the owner from it exactly once').toMatch(
      /const liveOwner = sessionCartStamp\(status, liveUserId\)/,
    )
    expect((src.match(/sessionCartStamp\(/g) ?? []).length, 'one call site').toBe(1)
    expect(src, 'no second identity definition').not.toMatch(/sessionAddressStamp/)
    // THE STAMP IS ONLY AS GOOD AS ITS ARGUMENT. A reviewer added `?? 'anon'` to the id and
    // every unresolved session became the usable owner `u:anon` — the page then read and
    // wrote an account under a stamp that identifies nobody, with the suite green. The two
    // lines that produce the owner are therefore fixed exactly.
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
      '}, [channels, rows, quiet, liveOwner, liveUserId, mine, t])',
    ])
  })
})

// ══ A–H : the mandated matrix ═══════════════════════════════════════════════

describe('A–H — preferences never cross an account boundary', () => {
  let p: ReturnType<typeof mountPrefs>
  beforeEach(() => { p = mountPrefs() })

  it('A — A loaded, then B signs in BEFORE A answers: B sees nothing of A', () => {
    p.signIn(OWN_A)
    p.signIn(OWN_B)                       // the switch happens while A's GET is in flight
    p.answer(0, PREFS_A)                  // …and A answers late
    expect(p.view.rawOwner, 'the superseded response committed nothing').not.toBe(OWN_A)
    expect(p.view.quiet).toBe(DEFAULTS.quiet)
    expect(p.view.channels).toEqual(DEFAULTS.channels)
    expect(p.view.inert, 'and the screen is inert until B\'s own prefs land').toBe(true)
    expect(p.patches, 'nothing was written anywhere').toEqual([])
  })

  it('B — A loaded, then B loaded: each sees only its own', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    expect(p.view.mine).toBe(true)
    expect(p.view.channels).toEqual(PREFS_A.channels)

    p.signIn(OWN_B)
    expect(p.view.rawOwner, 'A\'s values are dropped the moment the identity moves').toBeNull()
    expect(p.view.channels, 'neutral defaults, never A\'s').toEqual(DEFAULTS.channels)
    expect(p.view.inert).toBe(true)

    p.answer(1, PREFS_B)
    expect(p.view.mine).toBe(true)
    expect(p.view.channels).toEqual(PREFS_B.channels)
    expect(p.view.rows).toEqual(PREFS_B.rows)
    expect(p.view.quiet).toBe(PREFS_B.quiet)
  })

  it('C — a debounce armed under A does not PATCH after the switch to B', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    p.toggleQuiet()                       // arms the 600 ms debounce under A
    expect(p.armed).toBe(true)
    p.signIn(OWN_B)                       // the session flips before it expires
    expect(p.armed, 'the identity change disarmed it').toBe(false)
    p.fireTimer()                         // and even if it somehow fired…
    expect(p.patches, 'nothing was PATCHed').toEqual([])
  })

  it('C bis — and a timer that survives still refuses to write for a dead owner', () => {
    // Defence in depth: the fire-time check reads the LIVE identity, not the one captured
    // in the closure, so a timer that escaped the cleanup still commits nothing.
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    p.toggleQuiet()
    const escaped = p.armed
    expect(escaped).toBe(true)
    p.signIn(OWN_B)
    p.fireTimer()
    expect(p.patches).toEqual([])
  })

  it('D — a LATE response for A, after B has already loaded, changes nothing', () => {
    p.signIn(OWN_A)
    p.signIn(OWN_B)
    p.answer(1, PREFS_B)                  // B answers first
    expect(p.view.channels).toEqual(PREFS_B.channels)
    p.answer(0, PREFS_A)                  // A answers last
    expect(p.view.rawOwner, 'B keeps its own').toBe(OWN_B)
    expect(p.view.channels).toEqual(PREFS_B.channels)
    expect(p.view.quiet).toBe(PREFS_B.quiet)
  })

  it('E — after the switch, a toggle by B sends B\'s values ONLY', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    p.signIn(OWN_B)
    p.answer(1, PREFS_B)
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches.length).toBe(1)
    const sent = p.patches[0]
    expect(sent.owner).toBe(OWN_B)
    expect(sent.payload.channels, 'not a single field of A').toEqual(PREFS_B.channels)
    expect(sent.payload.rows).toEqual(PREFS_B.rows)
    expect(sent.payload.quiet, 'B\'s own value, flipped by B').toBe(!PREFS_B.quiet)
    // the strongest form: no value of A's appears anywhere in the payload
    const body = JSON.stringify(sent.payload)
    expect(body).not.toContain(JSON.stringify(PREFS_A.channels))
    expect(body).not.toContain(JSON.stringify(PREFS_A.rows))
  })

  it('F — logout to guest: no account prefs shown, and nothing is ever persisted', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    p.signIn('guest')
    expect(p.view.channels, 'a guest sees the neutral defaults').toEqual(DEFAULTS.channels)
    expect(p.view.quiet).toBe(DEFAULTS.quiet)
    expect(JSON.stringify(p.view)).not.toContain('"sms":true')   // A had sms on, defaults do not
    expect(p.pending, 'and no account read is even attempted').toBe(1)  // only A's
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches, 'a guest never writes an account').toEqual([])
  })

  it('G — an UNRESOLVED identity reads nothing and writes nothing', () => {
    p.signIn(null)                        // status 'loading', or authenticated with no id
    expect(p.pending, 'no request leaves while we cannot name the owner').toBe(0)
    expect(p.view.inert).toBe(true)
    expect(p.view.channels).toEqual(DEFAULTS.channels)
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches).toEqual([])
    // …and coming back to a real identity works normally
    p.signIn(OWN_B)
    p.answer(0, PREFS_B)
    expect(p.view.mine).toBe(true)
    expect(p.view.channels).toEqual(PREFS_B.channels)
  })

  it('H — loading B does NOT immediately PATCH B\'s own values back', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches.length, 'A\'s own deliberate change is saved').toBe(1)

    p.signIn(OWN_B)
    p.answer(1, PREFS_B)                  // a fresh load for a new identity
    p.fireTimer()
    expect(p.patches.length, 'loading is not a change: no echo PATCH').toBe(1)
    // …and B can still save deliberately afterwards
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches.length).toBe(2)
    expect(p.patches[1].owner).toBe(OWN_B)
  })

  it('a FAILED load is not a load: nothing is stamped, so nothing can be PATCHed over it', () => {
    // « une requête qui n'a PAS répondu n'est pas une réponse » — the orders lot. Treating a
    // failure as « you have the defaults » would let the next toggle overwrite the server's
    // real preferences with defaults the user never chose.
    p.signIn(OWN_A)
    p.failLoad(0)
    expect(p.view.mine, 'not loaded').toBe(false)
    expect(p.view.inert).toBe(true)
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches, 'and therefore unable to clobber the server').toEqual([])
  })

  it('A → B → A: A\'s own prefs are readable again, and B never held them', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A)
    p.signIn(OWN_B)
    p.answer(1, PREFS_B)
    expect(p.view.channels).toEqual(PREFS_B.channels)
    p.signIn(OWN_A)
    expect(p.view.inert, 'a fresh read is required, nothing is reused from memory').toBe(true)
    p.answer(2, PREFS_A)
    expect(p.view.channels).toEqual(PREFS_A.channels)
  })
})

// ══ the GET half of the TOCTOU ══════════════════════════════════════════════
//
// FOUND BY INDEPENDENT REVIEW OF PR #15, AND REAL. The PATCH was closed by `expectedUserId`,
// but the GET proved nothing about whose response it was. Owner-scoping the query makes
// every response CORRECT for whoever was authenticated and says NOTHING about who that was.
//
//   React/useSession still believes A   ·   the browser cookie is already B's
//   the GET leaves in that window       ·   the server authenticates B and answers B
//   the effect is still live, so `alive` is TRUE — React has not moved yet, so there was
//   nothing for the cleanup to tear down
//   the client stamps the response with requestOwner = u:A
//   → `mine` is TRUE and B's preferences render as A's own
//
// `alive` cannot close this: it only knows that the client's own belief has moved on. The
// response now carries the AUTHENTICATED id and is refused unless it matches the raw id the
// request was captured for. No new notion of identity — the same raw Operator id the PATCH
// already sends as `expectedUserId`.

describe('a GET response is adopted only under the identity the SERVER authenticated', () => {
  let p: ReturnType<typeof mountPrefs>
  beforeEach(() => { p = mountPrefs() })

  it('1 — the client believes A, the server answers ownerId=B: B\'s prefs are NEVER adopted', () => {
    p.signIn(OWN_A)
    expect(p.pending, 'the GET left believing it was A\'s').toBe(1)
    // the cookie had already become B's: the server authenticated B and returned B's row
    p.answer(0, PREFS_B, B)
    expect(p.view.rawOwner, 'nothing was stamped at all').toBeNull()
    expect(p.view.mine, 'and therefore nothing is « mine »').toBe(false)
    expect(p.view.channels, 'the neutral defaults, never B\'s').toEqual(DEFAULTS.channels)
    expect(p.view.rows).toEqual(DEFAULTS.rows)
    expect(p.view.quiet).toBe(DEFAULTS.quiet)
    // the strongest form: not one field of B's reaches the screen
    const shown = JSON.stringify(p.view)
    expect(shown).not.toContain(JSON.stringify(PREFS_B.channels))
    expect(shown).not.toContain(JSON.stringify(PREFS_B.rows))
    // …and the screen is inert, so B's values cannot be written back under A either
    expect(p.view.inert).toBe(true)
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches).toEqual([])
  })

  it('2 — the client believes A and the server answers ownerId=A: adopted, unchanged', () => {
    p.signIn(OWN_A)
    p.answer(0, PREFS_A, A)
    expect(p.view.mine).toBe(true)
    expect(p.view.rawOwner).toBe(OWN_A)
    expect(p.view.channels).toEqual(PREFS_A.channels)
    expect(p.view.rows).toEqual(PREFS_A.rows)
    expect(p.view.quiet).toBe(PREFS_A.quiet)
    expect(p.view.loadFailed, 'a correct response is not a failure').toBe(false)
    // and A can still save deliberately — the guard did not cost the screen its function
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches.length).toBe(1)
    expect(p.patches[0].owner).toBe(OWN_A)
  })

  it('3 — a mismatching response with perfectly valid prefs is fail-closed, and RECOVERABLE', () => {
    // « ne transforme pas cette discordance en defaults chargés » — a stamped default screen
    // would be writable, and the next toggle would PATCH defaults the user never chose over
    // the preferences the server actually holds. So: unstamped, said, and retryable.
    p.signIn(OWN_A)
    p.answer(0, PREFS_B, B)              // structurally valid, attributed to the wrong account
    expect(p.view.rawOwner, 'NOT stamped as loaded defaults').toBeNull()
    expect(p.view.loadFailed, 'the screen says the load failed').toBe(true)
    expect(p.view.retryOffered, 'and offers the only action that can fix it').toBe(true)
    expect(p.view.inert).toBe(true)
    p.toggleQuiet()
    p.fireTimer()
    expect(p.patches, 'nothing can be written over what we failed to read').toEqual([])

    // RECOVERABLE: the retry re-runs the load, and a correct response works normally.
    p.retry()
    expect(p.nonce).toBe(1)
    expect(p.pending, 'a fresh request left').toBe(2)
    expect(p.view.loadFailed, 'the retry clears the error').toBe(false)
    p.answer(1, PREFS_A, A)
    expect(p.view.mine).toBe(true)
    expect(p.view.channels).toEqual(PREFS_A.channels)
  })

  it('3 bis — a response that names NOBODY is refused too (undefined is not a match)', () => {
    // An older server, a cache or a proxy can answer without the field. `undefined ===
    // undefined` must never be read as « the owner matches »; the typeof half is what makes
    // that impossible.
    for (const bad of [undefined, null, '', 0, false, {}, [], `u:${A}`]) {
      const q = mountPrefs()
      q.signIn(OWN_A)
      q.answer(0, PREFS_A, bad)
      expect(q.view.rawOwner, `ownerId=${JSON.stringify(bad)}`).toBeNull()
      expect(q.view.mine, `ownerId=${JSON.stringify(bad)}`).toBe(false)
      expect(q.view.loadFailed, `ownerId=${JSON.stringify(bad)}`).toBe(true)
    }
    // …including the STAMP instead of the raw id: 'u:user-A' is not 'user-A'. The two notions
    // are kept apart on purpose, and confusing them must fail closed rather than pass.
  })

  it('4 — A → B, then A\'s own response arrives late: still refused', () => {
    p.signIn(OWN_A)
    p.signIn(OWN_B)                      // React catches up; A's request is superseded
    p.answer(1, PREFS_B, B)              // B loads normally
    expect(p.view.channels).toEqual(PREFS_B.channels)
    p.answer(0, PREFS_A, A)              // A's honest, correctly-attributed response, late
    expect(p.view.rawOwner, 'B keeps its own').toBe(OWN_B)
    expect(p.view.channels).toEqual(PREFS_B.channels)
    expect(p.view.loadFailed, 'and a superseded response is not an error on B\'s screen').toBe(false)
    expect(p.patches).toEqual([])
  })

  it('4 bis — the two guards are independent: neither alone would be enough', () => {
    // `alive` catches « React already moved »; the ownerId check catches « React has not
    // moved yet ». Each case below is closed by exactly one of them.
    const q = mountPrefs()
    q.signIn(OWN_A)
    q.signIn(OWN_B)
    q.answer(0, PREFS_A, A)              // superseded but correctly attributed → only `alive`
    expect(q.view.rawOwner).toBeNull()

    const r = mountPrefs()
    r.signIn(OWN_A)
    r.answer(0, PREFS_B, B)              // live but wrongly attributed → only the ownerId check
    expect(r.view.rawOwner).toBeNull()
    expect(r.view.loadFailed).toBe(true)
  })

  it('guest and unresolved still issue NO account GET at all', () => {
    const g = mountPrefs()
    g.signIn('guest')
    expect(g.pending, 'a guest has no account to read').toBe(0)
    expect(g.view.loadFailed, 'and nothing failed — there was nothing to do').toBe(false)
    const u = mountPrefs()
    u.signIn(null)
    expect(u.pending, 'an identity we cannot name is one we cannot attribute data to').toBe(0)
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
    // keyed on the owner — NOT on `[]`, which is what let B inherit A's preferences.
    // `reloadNonce` joined it so a failed load can be retried without a remount.
    expect(src).toMatch(/\}, \[liveOwner, liveUserId, reloadNonce\]\)/)
    expect(src, 'the empty dep array is gone').not.toMatch(/\}, \[\]\)/)
    // the previous account's values are dropped BEFORE anything is requested
    expect(src).toMatch(
      /useEffect\(\(\) => \{(?:(?!useEffect\()[\s\S])*?setPrefs\(\{ owner: null, \.\.\.DEFAULT_PREFS \}\)/,
    )
    // unresolved and guest never reach the network
    expect(src).toMatch(/if \(liveOwner === null\) return/)
    expect(src).toMatch(/if \(liveOwner === 'guest'\)/)
    // the response is stamped with the owner the request was issued FOR
    expect(src).toMatch(/const requestOwner = liveOwner/)
    expect(src).toMatch(/setPrefs\(\{ owner: requestOwner, channels: nextChannels, rows: nextRows, quiet: nextQuiet \}\)/)
    // and a superseded request commits nothing
    expect(src).toMatch(/let alive = true/)
    // POSITION, NOT PRESENCE. `toMatch(/if \(!alive\) return/)` passed with that line moved
    // BELOW the stamped setPrefs, where it is dead code — a reviewer did exactly that and
    // the suite stayed at 19/19 while a superseded response wrote A's row back into state.
    // The guard must be the FIRST statement of the commit callback.
    expect(src).toMatch(
      /\.then\(\(d: \{ ownerId\?: unknown; notifPrefs\?: unknown \} \| null\) => \{\s*if \(!alive\) return/,
    )
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)

    // ── THE GET OWNER CHECK ────────────────────────────────────────────────────────
    // The raw id is captured BESIDE the stamp, from the same render, and kept separate from
    // it: comparing the server's raw `ownerId` against the STAMP ('u:…') would never match
    // and the screen would never load, so the two notions must not be conflated.
    expect(src).toMatch(/const requestOwner = liveOwner\s*const requestUserId = liveUserId/)
    // POSITION, NOT PRESENCE — the lesson this lot already learned twice. The check must sit
    // between `if (!alive) return` and the first use of the payload, so that moving it below
    // the stamped setPrefs (where it is dead code) cannot pass. The span may not cross the
    // commit it guards.
    expect(src).toMatch(
      /if \(!alive\) return\s*if \(typeof d\?\.ownerId !== 'string' \|\| d\.ownerId !== requestUserId\) \{\s*setLoadFailed\(true\)\s*return\s*\}\s*const p = \(d\?\.notifPrefs/,
    )
    // BOTH HALVES. `typeof` alone would accept any string; the equality alone would accept a
    // response that omits the field, on `undefined === undefined`.
    expect(src, 'the equality is against the CAPTURED id').toMatch(/d\.ownerId !== requestUserId/)
    expect(src, 'and a response that names nobody is not a match').toMatch(/typeof d\?\.ownerId !== 'string'/)
    expect(src, 'never compared against the live id').not.toMatch(/d\.ownerId !== liveUserId/)
    // EXACT SET over the fail-closed signal, so the mismatch cannot be routed anywhere else
    // — in particular not into a stamped default screen, which would be writable.
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /setLoadFailed\(/.test(l))).toEqual([
      'setLoadFailed(false)',                              // cleared at the top of every load
      'setLoadFailed(true)',                               // the owner mismatch
      '.catch(() => { if (alive) setLoadFailed(true) })',  // the transport failure
    ])
    // the mismatch branch TERMINATES — a missing `return` would fall through and adopt it
    expect(src).toMatch(/setLoadFailed\(true\)\s*return\s*\}/)
    expect(src, 'and it is never stamped as loaded').not.toMatch(
      /setPrefs\(\{ owner: requestOwner, \.\.\.DEFAULT_PREFS \}\)/,
    )

    // THE SERVER HALF — the check is worthless if the response does not carry the id.
    const api = executable(read('app/api/eat/account/route.ts'))
    expect(api, 'the GET returns the AUTHENTICATED id, not anything from the request').toMatch(
      /return NextResponse\.json\(\{\s*ownerId: userId,/,
    )
    // EXACT SET over the two catch handlers, because a bare /\.catch\(\(\) => \{\}\)/ was
    // satisfied by the SAVE effect's sibling while the load's had been changed.
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim()).filter((l) => /\.catch\(/.test(l))).toEqual([
      '.catch(() => { if (alive) setLoadFailed(true) })',   // the load: says so, retryable
      '.catch(() => {})',                                   // the save: best-effort, silent
    ])
    // A NON-2xx IS A FAILURE, NOT AN ANSWER. Returning `null` here instead would make the
    // `.then` stamp the DEFAULTS as this owner's loaded preferences — and the next toggle
    // would then PATCH defaults the user never chose over what the server actually holds.
    // That mutation left the suite green until this pin existed.
    expect(src).toMatch(
      /\.then\(\(r\) => \(r\.ok \? r\.json\(\) : Promise\.reject\(new Error\('not ok'\)\)\)\)/,
    )
    expect(src, 'and the failure commits nothing at all').toMatch(/\.catch\(\(\) => \{\}\)/)
  })

  it('EXACT SET — every container on this page, so none can hold an ungated copy', () => {
    // AN ENUMERATION OVER ONE CONTAINER IS ESCAPED BY CHOOSING ANOTHER. A reviewer added a
    // `mirror` ref holding the loaded preferences and rendered it: the `prefs`/`setPrefs`
    // sets never saw it, tsc was clean, 19/19 green. So every container is listed, with what
    // it is allowed to hold.
    const containers = executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /useState<|useState\(|useRef<|useRef\(|^let /.test(l))
    expect(containers).toEqual([
      // the live identity, mirrored for the debounce to read when it fires — an owner, never data
      'const liveOwnerRef = useRef<string | null>(liveOwner)',
      // THE ONE CONTAINER THAT HOLDS PREFERENCES, with the owner inside it
      'const [prefs, setPrefs] = useState<PrefsState>({ owner: null, ...DEFAULT_PREFS })',
      'const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)',   // a handle
      'const firstSave = useRef(true)',                                          // a boolean
      'const [loadFailed, setLoadFailed] = useState(false)',                     // a boolean
      'const [reloadNonce, setReloadNonce] = useState(0)',                       // a counter
      'let alive = true',                                                        // per-request
    ])
  })

  it('EXACT SET — every write of the preferences state', () => {
    const src = executable(read(PAGE)).split('\n').map((l) => l.trim())
    expect(src.filter((l) => /setPrefs\(/.test(l))).toEqual([
      'setPrefs({ owner: null, ...DEFAULT_PREFS })',            // fail-closed on identity change
      "if (liveOwner === 'guest') { setPrefs({ owner: 'guest', ...DEFAULT_PREFS }); return }",
      'setPrefs({ owner: requestOwner, channels: nextChannels, rows: nextRows, quiet: nextQuiet })',
      'setPrefs((p) => (p.owner === liveOwner ? { ...p, channels: { ...p.channels, [k]: !p.channels[k] } } : p))',
      'setPrefs((p) => (p.owner === liveOwner ? { ...p, rows: { ...p.rows, [k]: !p.rows[k] } } : p))',
      'setPrefs((p) => (p.owner === liveOwner ? { ...p, quiet: !p.quiet } : p))',
    ])
  })

  it('the render is gated, so no frame can paint another account\'s preferences', () => {
    const src = executable(read(PAGE))
    expect(src).toMatch(/const mine = liveOwner !== null && prefs\.owner === liveOwner/)
    // every value the JSX reads comes from the gate, never from `prefs` directly
    expect(src).toMatch(/const channels = mine \? prefs\.channels : DEFAULT_PREFS\.channels/)
    expect(src).toMatch(/const rows = mine \? prefs\.rows : DEFAULT_PREFS\.rows/)
    expect(src).toMatch(/const quiet = mine \? prefs\.quiet : DEFAULT_PREFS\.quiet/)
    // COUNTED: four controls — the channel buttons, the two row groups, the quiet switch.
    // A bare toMatch was satisfied by any one of them, so removing the guard from the quiet
    // switch alone left the suite green.
    expect((src.match(/disabled=\{!mine\}/g) ?? []).length, 'every control is inert').toBe(4)
    // `aria-busy` stops claiming « in progress » once the attempt has FAILED — it used to
    // stay true for ever on a screen that was never going to load.
    expect((src.match(/aria-busy=\{!mine && !loadFailed\}/g) ?? []).length).toBe(4)
    // COUNTED IS NOT PLACED. A reviewer migrated both markers off the channel buttons onto
    // the back button and the counts still read 4/4, so each control is anchored to its own
    // identifying attribute.
    expect(src, 'the channel buttons').toMatch(/aria-pressed=\{on\}\s*disabled=\{!mine\}/)
    expect(src, 'the quiet switch').toMatch(
      /aria-label=\{t\('quietTitle'\)\}[\s\S]{0,160}?disabled=\{!mine\}/,
    )
    expect((src.match(/aria-label=\{t\(`row_\$\{r\.key\}`\)\}[\s\S]{0,160}?disabled=\{!mine\}/g) ?? []).length,
      'both row groups').toBe(2)
    expect(src, 'and the back button is NOT where they migrated to').not.toMatch(
      /className="np-back"[\s\S]{0,160}?disabled=\{!mine\}/,
    )
    // THE VISUAL HALF, which was pinned by nothing: a disabled control that still looks and
    // behaves like a live one reads as broken rather than as loading.
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /' dis'/.test(l))).toEqual([
      "className={`sw${!noChannel && rows[r.key] ? ' on' : ''}${noChannel || !mine ? ' dis' : ''}`}",
      "className={`sw${!noChannel && rows[r.key] ? ' on' : ''}${noChannel || !mine ? ' dis' : ''}`}",
      "className={`sw${quiet ? ' on' : ''}${!mine ? ' dis' : ''}`}",
    ])
    expect(read('app/[locale]/eat/account/notifications/notifications.css'),
      'and the stylesheet actually makes a disabled control look inert')
      .toMatch(/\.chan\[disabled\],[^\n]*\.sw\[disabled\]\{cursor:default/)
    // EXACT SET over the raw state reads, so nothing bypasses the gate
    const raw = executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /(?<![\w$])prefs(?![\w$])/.test(l))
    expect(raw).toEqual([
      'const [prefs, setPrefs] = useState<PrefsState>({ owner: null, ...DEFAULT_PREFS })',
      'const mine = liveOwner !== null && prefs.owner === liveOwner',
      'const channels = mine ? prefs.channels : DEFAULT_PREFS.channels',
      'const rows = mine ? prefs.rows : DEFAULT_PREFS.rows',
      'const quiet = mine ? prefs.quiet : DEFAULT_PREFS.quiet',
    ])
  })

  it('the save effect refuses every identity it must refuse, and re-checks at fire time', () => {
    const src = executable(read(PAGE))
    // COUNTED AND ANCHORED. A bare /if \(!mine\) return/ was satisfied by the two toggles'
    // own identical guard, so deleting the save effect's left the suite green. The three
    // sites are fixed, and the save effect's is anchored to the guest guard that follows it.
    expect((src.match(/if \(!mine\) return/g) ?? []).length,
      'the save effect and the two toggles that have it alone').toBe(3)
    expect(src, 'the save effect refuses before anything else').toMatch(
      /if \(!mine\) return\s*if \(liveOwner === 'guest'\) return\s*if \(firstSave\.current\)/,
    )
    expect(src).toMatch(/if \(firstSave\.current\) \{ firstSave\.current = false; return \}/)
    // the owner is captured when the debounce is armed…
    expect(src).toMatch(/const saveOwner = liveOwner/)
    // …and RE-READ from a ref when it FIRES, as the FIRST statement of the timer body. A
    // reviewer moved that check into the response handler: the PATCH then left
    // unconditionally and the surviving check only suppressed a toast, suite green.
    expect(src).toMatch(
      /saveTimer\.current = setTimeout\(\(\) => \{\s*if \(liveOwnerRef\.current !== saveOwner\) return/,
    )
    // THE MIRROR IS WRITTEN DURING RENDER, not in a trailing effect. An effect runs after
    // the paint, so between the identity changing and the effect firing the ref would still
    // name the previous account — exactly the window this check exists to close. A reviewer
    // moved it into `useEffect(() => { liveOwnerRef.current = liveOwner })` and the pin,
    // which only required the assignment to exist, could not tell the difference.
    expect(src).toMatch(
      /const liveOwnerRef = useRef<string \| null>\(liveOwner\)\s*liveOwnerRef\.current = liveOwner/,
    )
    expect(executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /liveOwnerRef/.test(l))).toEqual([
      'const liveOwnerRef = useRef<string | null>(liveOwner)',
      'liveOwnerRef.current = liveOwner',
      'if (liveOwnerRef.current !== saveOwner) return',
      "if (r.ok && liveOwnerRef.current === saveOwner) showToast(t('saved'))",
    ])
    // THE CLEANUP — the first of the two disarm layers — was pinned nowhere at all
    expect(src).toMatch(
      /return \(\) => \{ if \(saveTimer\.current\) \{ clearTimeout\(saveTimer\.current\); saveTimer\.current = null \} \}/,
    )
    // the effect is keyed on the identity too, so a switch disarms it
    expect(src).toMatch(/\}, \[channels, rows, quiet, liveOwner, liveUserId, mine, t\]\)/)
    // and the three per-identity resets happen in the load effect, together
    expect(src).toMatch(
      /if \(saveTimer\.current\) \{ clearTimeout\(saveTimer\.current\); saveTimer\.current = null \}\s*\n\s*firstSave\.current = true/,
    )
  })

  it('the PATCH body carries the gated values and nothing else', () => {
    const src = executable(read(PAGE))
    // THE MUTATION NAMES THE IDENTITY IT WAS PREPARED FOR. The client cannot close the
    // TOCTOU by itself — the browser attaches the cookie at send time — so it tells the
    // server which account this payload belongs to and the server refuses a mismatch.
    expect(src).toMatch(/body: JSON\.stringify\(\{ expectedUserId: saveUserId, notifPrefs: payload \}\)/)
    expect(src).toMatch(/const payload = \{ channels, rows, quiet \}/)
    expect(src, 'the id is captured, not re-read when the timer fires').toMatch(
      /const saveUserId = liveUserId\s*if \(saveUserId === undefined\) return/,
    )
    // A 409 IS A STALE MUTATION: no « enregistré » for a write that did not happen, and no
    // retry with the same payload. The early return is anchored BEFORE the toast branch.
    expect(src).toMatch(
      /if \(r\.status === 409\) return\s*if \(r\.ok && liveOwnerRef\.current === saveOwner\) showToast/,
    )
    expect(src, 'nothing re-sends a refused payload').not.toMatch(/retr(y|ies)\s*\(/i)
    // EXACT SET over the network calls on this page
    const calls = executable(read(PAGE)).split('\n').map((l) => l.trim())
      .filter((l) => /fetch\(/.test(l))
    expect(calls).toEqual([
      "fetch('/api/eat/account', { headers: { accept: 'application/json' } })",
      "fetch('/api/eat/account', {",
    ])
  })

  it('the neutral values this suite asserts ARE the page\'s own defaults', () => {
    // The DEFAULTS above are a copy; if the page's DEFAULT_PREFS changed, every « neutral »
    // assertion would quietly be checking the wrong thing. Read the page's literal and
    // compare, so the copy cannot drift away from what it claims to describe.
    const src = executable(read(PAGE))
    const i = src.indexOf('const DEFAULT_PREFS')
    expect(i, 'the page declares its defaults').toBeGreaterThan(-1)
    const block = src.slice(i, src.indexOf('}', src.indexOf('quiet:', i)) + 1)
    for (const [k, v] of Object.entries(DEFAULTS.channels)) {
      expect(block, `channels.${k}`).toContain(`${k}: ${String(v)}`)
    }
    for (const [k, v] of Object.entries(DEFAULTS.rows)) {
      expect(block, `rows.${k}`).toContain(`${k}: ${String(v)}`)
    }
    expect(block).toContain(`quiet: ${String(DEFAULTS.quiet)}`)
  })

  it('the endpoint stays owner-scoped on the SERVER — this lot is client-side only', () => {
    const api = executable(read('app/api/eat/account/route.ts'))
    expect(api).toMatch(/getServerSession\(authOptions\)/)
    // BOTH queries, anchored. A single toMatch was satisfied by the PATCH's clause alone, so
    // the GET's owner scoping could be removed entirely with this suite green.
    expect((api.match(/where: \{ id: userId \}/g) ?? []).length, 'the GET and the PATCH').toBe(2)
    expect(api, 'the GET reads only the caller\'s row').toMatch(
      /prisma\.operator\.findUnique\(\{\s*where: \{ id: userId \}/,
    )
    expect(api, 'the PATCH writes only the caller\'s row').toMatch(
      /prisma\.operator\.update\(\{\s*where: \{ id: userId \}/,
    )
  })
})
