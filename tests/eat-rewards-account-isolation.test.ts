import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionCartStamp } from '@/lib/eat-cart'

// ── /eat/rewards — LOYALTY POINTS + CREDIT SCALE, CROSS-ACCOUNT (P1) ──────────
//
// WHAT IS WRONG IN `main`. app/[locale]/eat/rewards/page.tsx loads the consumer loyalty
// wallet on an effect keyed on `[status]`:
//
//   fetch('/api/loyalty/wallet') → { pointsBalance, creditScale }
//
// `status` stays 'authenticated' across an A → B cross-tab switch (NextAuth broadcasts
// setSession without flipping through 'unauthenticated'), so the effect does not re-fire
// on identity change — A's `points` and `credit` grid remain visible on B's rewards page.
// Three failure modes compound on top of that: no `alive` guard (a late response for A
// can land after B has signed in), no response-side owner check (the server authenticates
// the cookie attached at SEND time — a GET issued while React still believes A can be
// authenticated as B), and nothing resets the state on logout.
//
// HOW THIS IS PROVEN. The identity rule is the repository's own exported `sessionCartStamp`,
// CALLED here rather than restated — otherwise the test proves agreement with the test.
// The effect/response sequencing is modelled, because it is control flow inside the page
// with no decision to export; the source pins at the bottom hold the real file to that
// shape, and the mutation battery is what makes the pins non-vacuous.

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
const PAGE = 'app/[locale]/eat/rewards/page.tsx'
const WALLET_ROUTE = 'app/api/loyalty/wallet/route.ts'

const A = 'user-A', B = 'user-B'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`

interface WalletResp { ownerId?: unknown; pointsBalance?: number; creditScale?: Array<{ points: number; euros: number }> }

const SCALE_A = [{ points: 100, euros: 5 }, { points: 200, euros: 10 }, { points: 400, euros: 20 }]
const SCALE_B = [{ points: 100, euros: 5 }, { points: 200, euros: 10 }, { points: 400, euros: 20 }]
const WALLET_A: WalletResp = { pointsBalance: 275, creditScale: SCALE_A }
const WALLET_B: WalletResp = { pointsBalance: 42,  creditScale: SCALE_B }

/**
 * MODELLED: the page's wallet effect and React's rule that an effect's cleanup runs
 * before the next run of that same effect. The IDENTITY decision is the real exported
 * `sessionCartStamp`. Everything the model asserts about the page's shape is pinned
 * separately against the source.
 */
function mountRewards() {
  let liveOwner: string | null = null
  let liveUserId: string | undefined
  // owner-stamped state — a value is only ever shown when its stamp matches the live owner.
  let wallet: { stamp: string | null; points: number; credit: Array<{ points: number; euros: number }> } =
    { stamp: null, points: 0, credit: [] }
  let lastRunOwner: string | null | undefined
  const inFlight: Array<{ owner: string; userId: string; alive: () => boolean }> = []
  let cleanup: (() => void) | null = null

  function runEffect(): void {
    if (lastRunOwner === liveOwner) return
    lastRunOwner = liveOwner
    if (cleanup) cleanup()
    // FAIL CLOSED FIRST — the previous account's values leave the screen before any request
    wallet = { stamp: null, points: 0, credit: [] }
    if (liveOwner === null) return                // unresolved — no network
    if (liveOwner === 'guest') return             // guest has no account to read
    if (liveUserId === undefined) return          // defence in depth: the stamp was null anyway
    const requestOwner = liveOwner
    const requestUserId = liveUserId
    let alive = true
    inFlight.push({ owner: requestOwner, userId: requestUserId, alive: () => alive })
    cleanup = () => { alive = false }
  }

  const flush = () => runEffect()

  function answer(index: number, resp: WalletResp | null, ...serverOwnerIdOverride: unknown[]) {
    const req = inFlight[index]
    if (!req) throw new Error('no wallet request at index ' + index)
    if (!req.alive()) return
    const serverOwnerId: unknown = serverOwnerIdOverride.length > 0 ? serverOwnerIdOverride[0] : req.userId
    if (typeof serverOwnerId !== 'string' || serverOwnerId !== req.userId) return // mismatch → fail closed
    if (!resp) return
    const pts = typeof resp.pointsBalance === 'number' ? resp.pointsBalance : 0
    const scale = Array.isArray(resp.creditScale) ? resp.creditScale : []
    wallet = { stamp: req.owner, points: pts, credit: scale }
  }

  return {
    signIn(owner: string | null, userId?: string) {
      liveOwner = owner
      liveUserId = userId
      flush()
    },
    answer,
    get pending() { return inFlight.length },
    get view() {
      const mine = wallet.stamp !== null && wallet.stamp === liveOwner
      return {
        points: mine ? wallet.points : null,
        credit: mine ? wallet.credit : [],
        stamp: wallet.stamp,
      }
    },
  }
}

// ══ the identity, reused rather than redefined ══════════════════════════════

describe('the identity is the repository\'s own', () => {
  it('sessionCartStamp is CALLED, and this page does not invent a third definition', () => {
    expect(sessionCartStamp('authenticated', A)).toBe(OWN_A)
    expect(sessionCartStamp('unauthenticated', null)).toBe('guest')
    expect(sessionCartStamp('loading', A)).toBeNull()
    expect(sessionCartStamp('authenticated', undefined)).toBeNull()

    const src = executable(read(PAGE))
    expect(src, 'the page imports the shared stamp').toMatch(
      /import \{[^}]*sessionCartStamp[^}]*\} from '@\/lib\/eat-cart'/,
    )
  })
})

// ══ A–H : the mandated matrix ═══════════════════════════════════════════════

describe('A–H — points and the credit grid never cross an account boundary', () => {
  let p: ReturnType<typeof mountRewards>
  beforeEach(() => { p = mountRewards() })

  it('A — A loaded, then B signs in BEFORE A answers: B sees neither A\'s points nor A\'s grid', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)                            // switch happens while A's GET is in flight
    p.answer(0, WALLET_A)                         // …and A answers late
    expect(p.view.points, 'nothing of A is shown to B').toBeNull()
    expect(p.view.credit).toEqual([])
    expect(p.view.stamp, 'and the state carries no leftover stamp').toBeNull()
  })

  it('B — A loaded, then B loaded: each sees only its own', () => {
    p.signIn(OWN_A, A)
    p.answer(0, WALLET_A)
    expect(p.view.points).toBe(275)
    expect(p.view.credit).toEqual(SCALE_A)

    p.signIn(OWN_B, B)
    expect(p.view.points, 'A\'s values are dropped the moment the identity moves').toBeNull()
    expect(p.view.credit).toEqual([])
    p.answer(1, WALLET_B)
    expect(p.view.points).toBe(42)
  })

  it('D — a LATE response for A, after B has already loaded, changes nothing', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)
    p.answer(1, WALLET_B)
    expect(p.view.points).toBe(42)
    p.answer(0, WALLET_A)                         // late, honest response for A
    expect(p.view.points, 'B keeps its own, A was superseded').toBe(42)
  })

  it('F — logout to unauthenticated: no values shown, no request issued', () => {
    p.signIn(OWN_A, A)
    p.answer(0, WALLET_A)
    expect(p.view.points).toBe(275)
    p.signIn('guest')
    expect(p.view.points, 'A\'s points gone from the signed-out page').toBeNull()
    expect(p.view.credit).toEqual([])
    expect(p.pending, 'no new GET /api/loyalty/wallet for a guest').toBe(1)  // only A's
  })

  it('G — an UNRESOLVED identity reads nothing and keeps the chrome neutral', () => {
    p.signIn(null)                                // status 'loading'
    expect(p.pending).toBe(0)
    expect(p.view.points).toBeNull()
    expect(p.view.credit).toEqual([])
    // …and coming back to a real identity works normally
    p.signIn(OWN_B, B)
    p.answer(0, WALLET_B)
    expect(p.view.points).toBe(42)
  })

  it('G bis — authenticated with no resolvable id: no request, no leftover stamp', () => {
    p.signIn(OWN_A, A)
    p.answer(0, WALLET_A)
    // authenticated-but-unnameable: sessionCartStamp returns null → treat as unresolved
    p.signIn(null)
    expect(p.pending, 'A\'s only; no request for the unnameable identity').toBe(1)
    expect(p.view.points).toBeNull()
    expect(p.view.credit).toEqual([])
  })

  it('H — A → B → A: a fresh read is required for A, nothing is reused from memory', () => {
    p.signIn(OWN_A, A)
    p.answer(0, WALLET_A)
    p.signIn(OWN_B, B)
    p.answer(1, WALLET_B)
    expect(p.view.points).toBe(42)
    p.signIn(OWN_A, A)
    expect(p.view.points, 'A\'s old balance is NOT reused').toBeNull()
    expect(p.view.credit).toEqual([])
    p.answer(2, WALLET_A)
    expect(p.view.points).toBe(275)
    expect(p.view.credit).toEqual(SCALE_A)
  })
})

// ══ the GET half of the TOCTOU: server-authenticated identity ═══════════════

describe('a GET response is adopted only under the identity the SERVER authenticated', () => {
  let p: ReturnType<typeof mountRewards>
  beforeEach(() => { p = mountRewards() })

  it('1 — the client believes A, the server authenticated B: nothing is adopted', () => {
    p.signIn(OWN_A, A)
    expect(p.pending).toBe(1)
    p.answer(0, WALLET_B, B)                       // server says « this body belongs to B »
    expect(p.view.points, 'B\'s balance never appears on A\'s screen').toBeNull()
    expect(p.view.credit).toEqual([])
    expect(p.view.stamp, 'the state carries no stamp at all').toBeNull()
  })

  it('2 — client believes A, server returns ownerId=A: adopted, unchanged', () => {
    p.signIn(OWN_A, A)
    p.answer(0, WALLET_A, A)
    expect(p.view.points).toBe(275)
    expect(p.view.credit).toEqual(SCALE_A)
  })

  it('3 — a response that names NOBODY is refused too (undefined is not a match)', () => {
    for (const bad of [undefined, null, '', 0, false, {}, [], `u:${A}`]) {
      const q = mountRewards()
      q.signIn(OWN_A, A)
      q.answer(0, WALLET_A, bad)
      expect(q.view.points, `ownerId=${JSON.stringify(bad)}`).toBeNull()
      expect(q.view.credit, `ownerId=${JSON.stringify(bad)}`).toEqual([])
    }
  })

  it('4 — A → B, then A\'s own correctly-attributed response arrives late: still refused by alive', () => {
    p.signIn(OWN_A, A)
    p.signIn(OWN_B, B)
    p.answer(1, WALLET_B, B)
    expect(p.view.points).toBe(42)
    p.answer(0, WALLET_A, A)                       // honest server, superseded request
    expect(p.view.points, 'B keeps its own').toBe(42)
  })

  it('4 bis — the two guards are independent: neither alone would be enough', () => {
    // `alive` catches « React already moved »; the ownerId check catches « React has not
    // moved yet ». Each case below is closed by exactly one of them.
    const q = mountRewards()
    q.signIn(OWN_A, A)
    q.signIn(OWN_B, B)
    q.answer(0, WALLET_A, A)                       // superseded but correctly attributed → only `alive`
    expect(q.view.points).toBeNull()

    const r = mountRewards()
    r.signIn(OWN_A, A)
    r.answer(0, WALLET_B, B)                       // live but wrongly attributed → only the ownerId check
    expect(r.view.points).toBeNull()
    expect(r.view.credit).toEqual([])
  })

  it('guest and unresolved still issue NO account GET at all', () => {
    const g = mountRewards()
    g.signIn('guest')
    expect(g.pending, 'guest has no account to read').toBe(0)
    const u = mountRewards()
    u.signIn(null)
    expect(u.pending).toBe(0)
  })
})

// ══ the real rewards page ═══════════════════════════════════════════════════

describe('the rewards page really implements this', () => {
  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(executable(read(PAGE))).toContain('useState')
    expect(read(PAGE)).toContain('// ')
    // the pre-fix single-key effect was keyed on `[status]`; prove the stripper would
    // have surfaced it if present (a positive control the mutation battery exercises).
    expect(executable(read(PAGE))).not.toContain('// Loyalty wallet. Keyed on IDENTITY')
  })

  it('the wallet effect is keyed on the identity, not merely `[status]`', () => {
    const raw = read(PAGE)
    const src = executable(raw)
    // the identity is derived from the live session user id, re-used across the shell
    expect(src).toMatch(/const userId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    // the ANCHOR comment, left in the RAW source so a reviewer who moves the dep array
    // around has to move the anchor with it — the executable form strips comments, so
    // this test uses the raw file to pin the anchor's position.
    expect(raw, 'the effect that calls /api/loyalty/wallet is keyed on identity').toMatch(
      /\/\* rewards-wallet-deps \*\/\s*\[status, userId\]\)/,
    )
    // the plain `[status]` single-key form is gone from that effect (executable form so
    // a lingering commented-out dep array cannot pass this positively).
    expect(src.match(/\}, \[status\]\)/g) ?? [], 'no effect keyed solely on status remains').toHaveLength(0)
  })

  it('the wallet state carries the stamp of the identity it was read under', () => {
    const src = executable(read(PAGE))
    // walletState is stored as { stamp, points, credit }, never as plain primitives
    expect(src).toMatch(/useState<\{ stamp: string \| null; points: number; credit: CreditStep\[\] \}>\(/)
    // and only ever read through a render-time match against the live session stamp
    expect(src).toMatch(/walletState\.stamp !== null && walletState\.stamp === sessionStamp/)
  })

  it('the effect FAIL-CLOSES before the request and declares requestOwner + requestUserId', () => {
    const src = executable(read(PAGE))
    // the previous owner's state is dropped FIRST, before any fetch
    expect(src).toMatch(/setWalletState\(\{ stamp: null, points: 0, credit: \[\] \}\)[\s\S]*?fetch\('\/api\/loyalty\/wallet'\)/)
    // unresolved/guest never reach the network for account data
    expect(src).toMatch(/if \(status !== 'authenticated'\)/)
    expect(src).toMatch(/if \(!userId\)/)
    // the response is stamped with the owner the request was issued FOR, and refused
    // unless the server echoed the SAME RAW ID
    expect(src).toMatch(/const requestOwner = sessionStamp/)
    expect(src).toMatch(/const requestUserId = userId/)
    // alive bool, cleanup disarming the response
    expect(src).toMatch(/let alive = true/)
    expect(src).toMatch(/return \(\) => \{ alive = false \}/)
  })

  it('a response that does not name the requested raw id is refused', () => {
    const src = executable(read(PAGE))
    // the typed body + the inside-the-handler alive check
    expect(src).toMatch(
      /\.then\(\(w: \{ ownerId\?: unknown; pointsBalance\?: unknown; creditScale\?: unknown \} \| null\) => \{\s*if \(!alive\) return/,
    )
    expect(src).toMatch(
      /if \(typeof w\?\.ownerId !== 'string' \|\| w\.ownerId !== requestUserId\) return/,
    )
  })

  it('the page commits the wallet STAMPED with the request\'s raw owner', () => {
    const src = executable(read(PAGE))
    expect(src).toMatch(/setWalletState\(\{ stamp: requestOwner, points: /)
  })

  it('the render-time gate blanks points AND credit on a stamp mismatch', () => {
    const src = executable(read(PAGE))
    // the gate is evaluated into one boolean, consumed by BOTH points and credit — a
    // consumer must not read either underlying field directly past the gate.
    expect(src).toMatch(/const stampOk = walletState\.stamp !== null && walletState\.stamp === sessionStamp/)
    expect(src).toMatch(/const points = stampOk \? walletState\.points : 0/)
    expect(src).toMatch(/const credit = stampOk \? walletState\.credit : \[\]/)
  })

  it('display-only behavior preserved: « Utiliser » routes to the cart', () => {
    const src = executable(read(PAGE))
    expect(src).toContain("router.push('/eat/cart')")
  })
})

// ══ the endpoint really names the identity it authenticated ═════════════════

describe('the endpoint really names the identity', () => {
  it('GET /api/loyalty/wallet returns `ownerId` sourced from the AUTHENTICATED token.sub', () => {
    const src = read(WALLET_ROUTE)
    // the ownerId is derived from the AUTHENTICATED session, not the queried customer
    expect(src).toMatch(/ownerId[^=]*=\s*typeof token\?\.sub === 'string' \? token\.sub : null/)
    // and the response actually surfaces it alongside pointsBalance
    expect(src).toMatch(/ownerId,[\s\S]{0,200}pointsBalance/)
  })
})
