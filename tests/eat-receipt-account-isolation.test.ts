import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ── CROSS-ACCOUNT STALE RECEIPT ON /eat/receipt/[id] (P1 confidentialité) ─────
//
// WHAT WAS WRONG. Both fetches were gated on `authStatus` alone. A → logout → B login
// begins and ends at 'authenticated' and the ticket id does not change, so neither effect
// re-ran: the page kept A's receipt — the amount paid, every consumed line with its
// quantity and unit price, the subtotal, the restaurant's name and official name, its
// street and city, the table, the payment timestamp, the currency and the SESSION CODE —
// and it kept A's `rateRestoId`, so B had a live « Noter ce restaurant » link into A's
// restaurant and a support mailto carrying A's session code in its subject.
//
// Both routes are already owner-scoped on the server (the receipt route compares
// reservation.userId with token.sub and answers private, no-store). This was entirely
// client-side stale state.
//
// TWO AXES. The document belongs to the PAIR (owner, ticket): navigating T1 → T2 inside the
// same mount must not paint T1 for a frame either, and that is a different axis from the
// identity.
//
// HOW THIS IS PROVEN, stated plainly because three earlier lots were caught claiming more:
//   • EXECUTED — the scope decision runs for real against the repository's own
//     sessionCartStamp, and the sentinel sweep runs over the gate's actual output.
//   • MODELLED — React's two phases, SEPARATELY: render() derives the frame and touches no
//     state, flushEffects() is what runs after the commit. They are not collapsed, because
//     collapsing them hides the window in which a late response can still commit.
//   • CLOSED BY EXACT SETS. The first version of this header said an enumeration over the
//     data "cannot be escaped, because a leak has to READ a field to paint it". The
//     principle holds; that implementation did not, because it enumerated nine of the
//     thirteen fields and leaned on two escapable container bans — a reviewer painted A's
//     street and A's dish names from a module-level holder with all 72 tests green. A
//     PREDICATE over field reads is still a predicate. What cannot be escaped is an EXACT
//     SET: the complete list of lines naming each field, of module-scope declarations, and
//     of hook calls. A leak has to add a line, and adding a line changes a set. See the
//     review-round block at the end of this file.

import { sessionCartStamp } from '@/lib/eat-cart'

const A = 'user-A', B = 'user-B', C = 'user-C'
const OWN_A = `u:${A}`, OWN_B = `u:${B}`
const T1 = 'ticket-T1', T2 = 'ticket-T2'
const PAGE = 'app/[locale]/eat/receipt/[id]/page.tsx'

// ── A's receipt, with a distinctive value in every private field ─────────────
const A_SESSION_CODE = 'SESSA-9931'
const A_AMOUNT = 148.73
const A_SUBTOTAL = 151.2
const A_RESTO = 'Brasserie Isolation-A'
const A_OFFICIAL = 'ISOLATION-A SARL'
const A_ADDRESS = '12 rue Confidentielle-A'
const A_CITY = 'Villeneuve-A'
const A_TABLE = 'Table 42-A'
const A_PAID_AT = '2026-09-14T19:42:00.000Z'
const A_LINE = 'Magret de canard A'
const A_RESTO_ID = 'resto-A-7731'

type ReceiptData = {
  paidAt: string; amountPaid: number; subtotal: number; currency: string
  lines: Array<{ name: string; unitPrice: number; quantity: number }>
  sessionCode: string; restaurantName: string; officialName: string | null
  address: string | null; city: string | null; tableName: string | null
}

const RECEIPT_A: ReceiptData = {
  paidAt: A_PAID_AT, amountPaid: A_AMOUNT, subtotal: A_SUBTOTAL, currency: 'eur',
  lines: [{ name: A_LINE, unitPrice: 32.4, quantity: 2 }],
  sessionCode: A_SESSION_CODE, restaurantName: A_RESTO, officialName: A_OFFICIAL,
  address: A_ADDRESS, city: A_CITY, tableName: A_TABLE,
}
const RECEIPT_B: ReceiptData = {
  paidAt: '2026-09-20T12:00:00.000Z', amountPaid: 21.5, subtotal: 21.5, currency: 'eur',
  lines: [{ name: 'Plat B', unitPrice: 21.5, quantity: 1 }],
  sessionCode: 'SESSB-0001', restaurantName: 'Chez B', officialName: null,
  address: null, city: null, tableName: null,
}
/** Every value of A's that must never surface under another identity. */
const A_SENTINELS = [
  A_SESSION_CODE, A_RESTO, A_OFFICIAL, A_ADDRESS, A_CITY, A_TABLE, A_LINE, A_RESTO_ID,
  A_PAID_AT, String(A_AMOUNT), String(A_SUBTOTAL),
]

// ── the page's render-time derivation, using the REAL identity primitive ─────
type Stamped = { owner: string | null; ticketId: string | null }
type ReceiptState = Stamped & { receipt: ReceiptData | null; error: string; loading: boolean }
type RateState = Stamped & { restoId: string | null }

function gate(
  authStatus: string, userId: string | undefined, ticketId: string,
  receiptState: ReceiptState, rateState: RateState,
) {
  const liveStamp = sessionCartStamp(authStatus, userId)
  const scopeOk = liveStamp !== null && liveStamp !== 'guest'
  const inScope = (st: Stamped) => scopeOk && st.owner === liveStamp && st.ticketId === ticketId
  const receipt = inScope(receiptState) ? receiptState.receipt : null
  const error = inScope(receiptState) ? receiptState.error : ''
  const loading = inScope(receiptState) ? receiptState.loading : true
  const rateRestoId = inScope(rateState) ? rateState.restoId : null
  // the page's render order: sign-in, then skeleton, then error, then the document
  const screen = authStatus === 'unauthenticated' ? 'signIn'
    : loading || authStatus === 'loading' ? 'skeleton'
      : error ? 'error'
        : receipt ? 'receipt' : 'nothing'
  return { liveStamp, scopeOk, receipt, error, loading, rateRestoId, screen }
}

/**
 * MODELLED: React's two phases, honestly separated. render() derives the frame and touches
 * no state; flushEffects() is what runs after the commit — the cleanup, the re-stamp and the
 * requests. Keeping them apart is what lets case K assert the real window instead of
 * pretending the cleanup always gets there first.
 */
function makePage() {
  let receiptState: ReceiptState = { owner: null, ticketId: null, receipt: null, error: '', loading: true }
  let rateState: RateState = { owner: null, ticketId: null, restoId: null }
  let deps: string | null = null
  let aliveReceipt: { v: boolean } | null = null
  let aliveRate: { v: boolean } | null = null
  let pending: { authStatus: string; userId: string | undefined; ticketId: string; tick: number } | null = null
  const receiptReqs: Array<{ owner: string; ticketId: string; ok: (r: ReceiptData) => void; fail: (msg: string | null) => void }> = []
  const rateReqs: Array<{ owner: string; ticketId: string; found: (restoId: string) => void; none: () => void }> = []

  function render(authStatus: string, userId: string | undefined, ticketId: string, tick = 0) {
    const key = JSON.stringify([String(sessionCartStamp(authStatus, userId)), ticketId, tick])
    if (key !== deps) pending = { authStatus, userId, ticketId, tick }
    return {
      ...gate(authStatus, userId, ticketId, receiptState, rateState),
      raw: { receiptState, rateState },
      effectPending: pending !== null,
      receiptReqs, rateReqs,
    }
  }

  function flushEffects() {
    if (!pending) return
    const { authStatus, userId, ticketId, tick } = pending
    pending = null
    const liveStamp = sessionCartStamp(authStatus, userId)
    const scopeOk = liveStamp !== null && liveStamp !== 'guest'
    // The tick is part of the dependency key, as it is in the page. Hardcoding 0 here meant
    // that from the first retry onwards the model re-issued a request on EVERY render, so
    // case J's "no needless request" claim silently stopped covering the retry axis.
    deps = JSON.stringify([String(liveStamp), ticketId, tick])
    if (aliveReceipt) aliveReceipt.v = false
    if (aliveRate) aliveRate.v = false
    aliveReceipt = null
    aliveRate = null
    if (!scopeOk) {
      receiptState = { owner: null, ticketId: null, receipt: null, error: '', loading: false }
      rateState = { owner: null, ticketId: null, restoId: null }
      return
    }
    const owner = liveStamp as string
    // the receipt effect: re-stamp for the new pair, then ask
    const mineR = { v: true }
    aliveReceipt = mineR
    receiptState = { owner, ticketId, receipt: null, error: '', loading: true }
    receiptReqs.push({
      owner, ticketId,
      ok: (r) => { if (mineR.v) receiptState = { owner, ticketId, receipt: r, error: '', loading: false } },
      fail: (msg) => { if (mineR.v) receiptState = { owner, ticketId, receipt: null, error: msg ?? 'loadError', loading: false } },
    })
    // the rateResto effect, independently scoped to the same pair
    const mineRate = { v: true }
    aliveRate = mineRate
    rateState = { owner, ticketId, restoId: null }
    rateReqs.push({
      owner, ticketId,
      found: (restoId) => { if (mineRate.v) rateState = { owner, ticketId, restoId } },
      none: () => {},
    })
  }

  function turn(authStatus: string, userId: string | undefined, ticketId: string, tick = 0) {
    const frame = render(authStatus, userId, ticketId, tick)
    flushEffects()
    return frame
  }
  return { render, flushEffects, turn, receiptReqs, rateReqs }
}

const loadedForA = (ticketId = T1): ReceiptState =>
  ({ owner: OWN_A, ticketId, receipt: RECEIPT_A, error: '', loading: false })
const rateForA = (ticketId = T1): RateState =>
  ({ owner: OWN_A, ticketId, restoId: A_RESTO_ID })
const NO_RATE: RateState = { owner: null, ticketId: null, restoId: null }

// ══ A–F : the pair, and the first frame ══════════════════════════════════════

describe('A–F — the receipt belongs to (owner, ticket), checked during render', () => {
  it('A — A\'s receipt, A\'s session, A\'s ticket: visible', () => {
    const g = gate('authenticated', A, T1, loadedForA(), rateForA())
    expect(g.screen).toBe('receipt')
    expect(g.receipt?.sessionCode).toBe(A_SESSION_CODE)
    expect(g.rateRestoId).toBe(A_RESTO_ID)
  })

  it('B — same ticket, session becomes B: ZERO datum of A, on the FIRST frame', () => {
    const g = gate('authenticated', B, T1, loadedForA(), rateForA())
    expect(g.receipt).toBeNull()
    expect(g.rateRestoId).toBeNull()
    expect(g.screen).toBe('skeleton')     // not the document, and not a false emptiness
  })

  it('C/D/E — loading, authenticated-without-id, and guest all own nothing', () => {
    for (const [status, id, label] of [
      ['loading', undefined, 'loading'],
      ['authenticated', undefined, 'no id'],
      ['authenticated', '', 'empty id'],
      ['unauthenticated', undefined, 'guest'],
    ] as Array<[string, string | undefined, string]>) {
      const g = gate(status, id, T1, loadedForA(), rateForA())
      expect(g.receipt, label).toBeNull()
      expect(g.rateRestoId, label).toBeNull()
      expect(g.error, label).toBe('')
    }
    // signed out shows the existing sign-in screen, never the document
    expect(gate('unauthenticated', undefined, T1, loadedForA(), rateForA()).screen).toBe('signIn')
  })

  it('F — SAME user, URL moves T1 → T2: T1 is invisible on the first frame', () => {
    // the second axis: the identity agrees, the ticket does not
    const g = gate('authenticated', A, T2, loadedForA(T1), rateForA(T1))
    expect(g.receipt).toBeNull()
    expect(g.rateRestoId).toBeNull()
    expect(g.screen).toBe('skeleton')
  })

  it('W–Z — NOT ONE private field of A\'s appears anywhere B may read', () => {
    const g = gate('authenticated', B, T1, loadedForA(), rateForA())
    const everythingBMayRead = JSON.stringify({
      receipt: g.receipt, error: g.error, rateRestoId: g.rateRestoId, screen: g.screen,
    })
    for (const sentinel of A_SENTINELS) {
      expect(everythingBMayRead.includes(sentinel), sentinel).toBe(false)
    }
    // the control: those same sentinels ARE all present when A is the viewer, so the sweep
    // is about the gate and not about a mis-spelled sentinel
    const own = JSON.stringify(gate('authenticated', A, T1, loadedForA(), rateForA()))
    for (const sentinel of A_SENTINELS) {
      expect(own.includes(sentinel), sentinel).toBe(true)
    }
  })
})

// ══ G–J : the refetch that authStatus alone could not trigger ════════════════

describe('G–J — an identity or ticket change refetches, and nothing else does', () => {
  it('G — A → B with status never leaving \'authenticated\' asks again, for B', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.receiptReqs[0].ok(RECEIPT_A)
    expect(p.turn('authenticated', A, T1).screen).toBe('receipt')

    const asB = p.turn('authenticated', B, T1)
    expect(asB.receipt).toBeNull()                         // nothing of A's while B's loads
    expect(p.receiptReqs.map((r) => r.owner)).toEqual([OWN_A, OWN_B])
    expect(p.rateReqs.map((r) => r.owner)).toEqual([OWN_A, OWN_B])
  })

  it('H — B → A asks again too, and never reuses the earlier answer', () => {
    const p = makePage()
    p.turn('authenticated', B, T1)
    p.receiptReqs[0].ok(RECEIPT_B)
    p.turn('authenticated', A, T1)
    expect(p.receiptReqs.map((r) => r.owner)).toEqual([OWN_B, OWN_A])
    const mid = p.render('authenticated', A, T1)
    expect(mid.receipt).toBeNull()
    expect(mid.screen).toBe('skeleton')
    p.receiptReqs[1].ok(RECEIPT_A)
    expect(p.render('authenticated', A, T1).receipt?.sessionCode).toBe(A_SESSION_CODE)
  })

  it('I — T1 → T2 asks again, for the new ticket', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.receiptReqs[0].ok(RECEIPT_A)
    p.turn('authenticated', A, T2)
    expect(p.receiptReqs.map((r) => r.ticketId)).toEqual([T1, T2])
    expect(p.render('authenticated', A, T2).receipt).toBeNull()
  })

  it('J — re-rendering the same pair asks nothing further', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    for (let i = 0; i < 25; i++) p.turn('authenticated', A, T1)
    expect(p.receiptReqs).toHaveLength(1)
    expect(p.rateReqs).toHaveLength(1)
  })

  it('…and no usable identity asks for nothing at all', () => {
    const p = makePage()
    p.turn('loading', undefined, T1)
    p.turn('unauthenticated', undefined, T1)
    p.turn('authenticated', undefined, T1)
    expect(p.receiptReqs).toHaveLength(0)
    expect(p.rateReqs).toHaveLength(0)
  })
})

// ══ K–N : the races, modelled honestly ═══════════════════════════════════════

describe('K–N — a response for A can never become B\'s receipt', () => {
  it('K — THE REAL WINDOW: A\'s response lands between the B commit and the cleanup', () => {
    // React flushes passive effects AFTER paint, so this window exists. A response landing
    // in it still has `alive === true` and still commits a state stamped for A. That is
    // acceptable ONLY because the render-time gate hides it — which is what this asserts,
    // instead of pretending the cleanup always gets there first.
    const p = makePage()
    p.turn('authenticated', A, T1)
    const frame = p.render('authenticated', B, T1)      // committed, effects not flushed
    expect(frame.effectPending).toBe(true)
    p.receiptReqs[0].ok(RECEIPT_A)                      // A's answer arrives in the window
    const stillB = p.render('authenticated', B, T1)
    expect(stillB.raw.receiptState.owner).toBe(OWN_A)   // it DID commit, stamped for A…
    expect(stillB.receipt).toBeNull()                   // …and it is invisible, by the stamp
    expect(stillB.screen).toBe('skeleton')
    expect(JSON.stringify({ r: stillB.receipt, e: stillB.error, id: stillB.rateRestoId })).not.toContain(A_SESSION_CODE)
    // …and once the effects run, it is physically replaced by B's own pending scope
    p.flushEffects()
    const after = p.render('authenticated', B, T1)
    expect(after.raw.receiptState.owner).toBe(OWN_B)
    expect(JSON.stringify(after.raw)).not.toContain(A_SESSION_CODE)
  })

  it('L — a LATE response for A does not clobber a receipt already committed for B', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.turn('authenticated', B, T1)                      // cleanup disowns A's request
    p.receiptReqs[1].ok(RECEIPT_B)
    expect(p.render('authenticated', B, T1).receipt?.sessionCode).toBe('SESSB-0001')
    p.receiptReqs[0].ok(RECEIPT_A)                      // A lands late
    const after = p.render('authenticated', B, T1)
    expect(after.receipt?.sessionCode).toBe('SESSB-0001')
    expect(JSON.stringify(after.raw)).not.toContain(A_SESSION_CODE)
  })

  it('M — A\'s response BEFORE B\'s: never visible, and B\'s own answer still lands', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.turn('authenticated', B, T1)
    p.receiptReqs[0].ok(RECEIPT_A)
    const afterA = p.render('authenticated', B, T1)
    expect(afterA.receipt).toBeNull()
    expect(afterA.screen).toBe('skeleton')
    p.receiptReqs[1].ok(RECEIPT_B)
    expect(p.render('authenticated', B, T1).receipt?.sessionCode).toBe('SESSB-0001')
  })

  it('N — A → B → C with three requests in flight: each owner sees only its own', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.turn('authenticated', B, T1)
    p.turn('authenticated', C, T1)
    expect(p.receiptReqs.map((r) => r.owner)).toEqual([OWN_A, OWN_B, `u:${C}`])
    p.receiptReqs[1].ok(RECEIPT_B)                      // B's, while C is live
    expect(p.render('authenticated', C, T1).receipt).toBeNull()
    p.receiptReqs[0].ok(RECEIPT_A)                      // A's, while C is live
    expect(p.render('authenticated', C, T1).receipt).toBeNull()
    p.receiptReqs[2].ok({ ...RECEIPT_B, sessionCode: 'SESSC-0001', restaurantName: 'Chez C' })
    const asC = p.render('authenticated', C, T1)
    expect(asC.receipt?.sessionCode).toBe('SESSC-0001')
    expect(JSON.stringify(asC)).not.toContain(A_SESSION_CODE)
    expect(JSON.stringify(asC)).not.toContain('SESSB-0001')
  })
})

// ══ O–S : failures, and the error's own scope ════════════════════════════════

describe('O–S — a failure never resurrects A, and an error has an owner too', () => {
  it('O/P/Q — a non-2xx, invalid JSON and a rejected fetch all show nothing of A\'s', () => {
    for (const label of ['non-2xx', 'invalid json', 'rejected']) {
      const p = makePage()
      p.turn('authenticated', A, T1)
      p.receiptReqs[0].ok(RECEIPT_A)
      p.turn('authenticated', B, T1)
      p.receiptReqs[1].fail(label === 'non-2xx' ? 'Accès refusé' : null)
      const g = p.render('authenticated', B, T1)
      expect(g.receipt, label).toBeNull()
      expect(JSON.stringify(g.raw), label).not.toContain(A_SESSION_CODE)
      expect(g.screen, label).toBe('error')
    }
  })

  it('R — an error obtained under A is invisible under B', () => {
    const errorForA: ReceiptState = { owner: OWN_A, ticketId: T1, receipt: null, error: 'Accès refusé (A)', loading: false }
    const g = gate('authenticated', B, T1, errorForA, NO_RATE)
    expect(g.error).toBe('')
    expect(g.screen).toBe('skeleton')     // not A's error, and not a blank screen
  })

  it('S — an error B really received for this ticket IS shown to B', () => {
    // B asking for A's ticket legitimately gets a 403; that answer is B's own.
    const p = makePage()
    p.turn('authenticated', B, T1)
    p.receiptReqs[0].fail('Accès refusé')
    const g = p.render('authenticated', B, T1)
    expect(g.error).toBe('Accès refusé')
    expect(g.screen).toBe('error')
    expect(g.receipt).toBeNull()
  })
})

// ══ T–V, AB : the rate link and the retry ════════════════════════════════════

describe('T–V / AB — the review link and the retry', () => {
  it('T — a rateRestoId found for A is gone on B\'s first frame', () => {
    const g = gate('authenticated', B, T1, loadedForA(), rateForA())
    expect(g.rateRestoId).toBeNull()
  })

  it('U — a LATE rateResto answer for A never creates a link under B', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.turn('authenticated', B, T1)                       // cleanup disowns A's rate request
    p.rateReqs[0].found(A_RESTO_ID)                      // A's answer arrives late
    const g = p.render('authenticated', B, T1)
    expect(g.rateRestoId).toBeNull()
    expect(JSON.stringify(g.raw.rateState)).not.toContain(A_RESTO_ID)
  })

  it('V — B\'s own rateResto answer gives B\'s link, and only that', () => {
    const p = makePage()
    p.turn('authenticated', B, T1)
    p.rateReqs[0].found('resto-B-1')
    expect(p.render('authenticated', B, T1).rateRestoId).toBe('resto-B-1')
    // and it is scoped to the ticket as well
    p.turn('authenticated', B, T2)
    expect(p.render('authenticated', B, T2).rateRestoId).toBeNull()
  })

  it('AB — retry after A → B is attributed to B, never to A', () => {
    // The retry handler carries no scope: it bumps a counter, and the effect re-issues with
    // the CURRENT pair. So a handler captured under A, clicked under B, cannot fetch as A.
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.receiptReqs[0].fail('boom')
    p.turn('authenticated', B, T1)
    p.turn('authenticated', B, T1, 1)                    // the stale button, clicked under B
    expect(p.receiptReqs.map((r) => r.owner)).toEqual([OWN_A, OWN_B, OWN_B])
    expect(p.receiptReqs[2].ticketId).toBe(T1)
  })
})

// ══ the source: §13 and §15 ══════════════════════════════════════════════════

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

describe('§13/§15 — the real file, pinned and closed over the FIELDS', () => {
  const src = executable(read(PAGE))
  /** Every trimmed line of the real file that names a given identifier. */
  const linesNaming = (name: string) =>
    src.split('\n').filter((l) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(l)).map((l) => l.trim())

  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    expect(src).toContain('export default function DineinReceiptScreen')
    expect(src).toContain('/api/eat/tickets/${encodeURIComponent(requestTicketId)}/receipt')
    expect(read(PAGE)).toContain('// ── OWNER + TICKET, RESOLVED DURING RENDER')
    expect(src).not.toContain('// ── OWNER + TICKET, RESOLVED DURING RENDER')
  })

  it('the identity comes from the shared primitive, with no second derivation', () => {
    expect(src).toMatch(/const liveUserId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    expect(src).toMatch(/const liveStamp = sessionCartStamp\(authStatus, liveUserId\)/)
    expect(src).toMatch(/const scopeOk = liveStamp !== null && liveStamp !== 'guest'/)
    expect((src.match(/sessionCartStamp\(/g) ?? []).length, 'one identity derivation').toBe(1)
    expect(src).not.toMatch(/favOwner\(/)
  })

  it('the gate carries BOTH axes, and every derivation goes through it', () => {
    expect(src).toMatch(
      /const inScope = \(st: \{ owner: string \| null; ticketId: string \| null \}\) =>\s*\n\s*scopeOk && st\.owner === liveStamp && st\.ticketId === id/,
    )
    expect(src).toMatch(/const receipt = inScope\(receiptState\) \? receiptState\.receipt : null/)
    expect(src).toMatch(/const error = inScope\(receiptState\) \? receiptState\.error : ''/)
    expect(src).toMatch(/const loading = inScope\(receiptState\) \? receiptState\.loading : true/)
    expect(src).toMatch(/const rateRestoId = inScope\(rateState\) \? rateState\.restoId : null/)
  })

  it('§15 CLOSED ENUMERATION over the raw holders — only the gate may name them', () => {
    expect(linesNaming('receiptState')).toEqual([
      'const [receiptState, setReceiptState] = useState<{',
      'const receipt = inScope(receiptState) ? receiptState.receipt : null',
      "const error = inScope(receiptState) ? receiptState.error : ''",
      'const loading = inScope(receiptState) ? receiptState.loading : true',
    ])
    expect(linesNaming('rateState')).toEqual([
      'const [rateState, setRateState] = useState<{',
      'const rateRestoId = inScope(rateState) ? rateState.restoId : null',
    ])
  })

  it('§15 the nine fields whose reads all descend from the gated receipt', () => {
    // NARROWED: this case proves those nine fields are read only through the gate. It does
    // NOT prove no other container exists, and it does not cover `lines`, `address` or the
    // per-line fields — the review-round block at the end of this file closes all thirteen
    // with exact sets, and closes module scope and the hook set too. The predicate below is
    // also escapable on its own terms (`<container>.receipt.<field>` satisfies it), which is
    // the second reason the exact sets exist.
    for (const [field, expected] of [
      ['sessionCode', 4], ['amountPaid', 4], ['subtotal', 3], ['restaurantName', 3],
      ['officialName', 1], ['tableName', 3], ['paidAt', 3], ['currency', 2], ['city', 2],
    ] as Array<[string, number]>) {
      const got = linesNaming(field)
      expect(got.length, `${field}: ${JSON.stringify(got)}`).toBe(expected)
      // every read beyond the interface declaration descends from the gated value
      for (const l of got) {
        const ok = new RegExp(`^${field}[?]?:`).test(l)        // the interface
          || /receipt[?]?\./.test(l)                            // through the gated receipt
        expect(ok, `${field}: ungated read -> ${l}`).toBe(true)
      }
    }
    // the session code reaches the support mailto only through the gated value
    expect(src).toMatch(/t\('issueSubject', \{ code: receipt\.sessionCode \}\)/)
    // …and the review link only through the gated id
    expect(src).toMatch(/href=\{`\/eat\/r\/\$\{rateRestoId\}\/reviews`\}/)
    // a useRef is banned outright; module scope and the whole hook set are closed by exact
    // sets in the review-round block (the `/^let /` form used here was anchored at column
    // zero, so one leading space defeated it)
    expect(src).not.toMatch(/useRef/)
    // THREE declarations, counted on the declaration form so the import line cannot pad
    // the number: the receipt scope, the rate scope, and the retry counter.
    const decls = (src.match(/const \[\w+, set\w+\] = useState/g) ?? [])
    expect(decls.length, `declarations: ${JSON.stringify(decls)}`).toBe(3)
  })

  it('both effects are keyed on the PAIR and stamp with what they asked for', () => {
    expect((src.match(/const requestOwner = liveStamp/g) ?? []).length).toBe(2)
    expect((src.match(/const requestTicketId = id/g) ?? []).length).toBe(2)
    // keyed on the pair, not on authStatus
    expect((src.match(/\}, \[liveStamp, scopeOk, id\]\)/g) ?? []).length).toBe(1)   // rate
    expect(src).toMatch(/\}, \[liveStamp, scopeOk, id, retryTick, t\]\)/)           // receipt
    expect(src).not.toMatch(/\}, \[authStatus, id\]\)/)
    expect(src).not.toMatch(/\}, \[authStatus, load\]\)/)
    // every commit is stamped with the CAPTURED pair, never with the live one
    // SIX commits carry the captured pair, counted not guessed: the rate effect stamps
    // twice (its re-stamp and its find), the receipt effect four times (its re-stamp, the
    // server-error commit, the success commit and the catch commit).
    expect((src.match(/owner: requestOwner, ticketId: requestTicketId/g) ?? []).length).toBe(6)
    // …and the WRITE SITES are enumerated, which counting alone does not do: a reviewer
    // added a seventh commit stamped `owner: 'u:someone-else'` and the count above did not
    // move, because it only counts the GOOD pattern. The complete set is asserted instead.
    const writes = (name: string) =>
      src.split('\n').filter((l) => new RegExp(`(?<![\\w$])${name}\\(`).test(l)).map((l) => l.trim())
    expect(writes('setReceiptState')).toEqual([
      "setReceiptState({ owner: null, ticketId: null, receipt: null, error: '', loading: false })",
      "setReceiptState({ owner: requestOwner, ticketId: requestTicketId, receipt: null, error: '', loading: true })",
      'setReceiptState({',   // the server-error commit
      'setReceiptState({',   // the success commit
      'setReceiptState({',   // the catch commit
    ])
    expect(writes('setRateState')).toEqual([
      "if (!scopeOk || !id) { setRateState({ owner: null, ticketId: null, restoId: null }); return }",
      'setRateState({ owner: requestOwner, ticketId: requestTicketId, restoId: null })',
      'if (mine?.restaurantId) setRateState({ owner: requestOwner, ticketId: requestTicketId, restoId: mine.restaurantId })',
    ])
    // no commit may name an owner literally, nor the live pair
    expect(src).not.toMatch(/owner: 'u:/)
    expect(src).not.toMatch(/owner: liveStamp/)
    expect(src).not.toMatch(/owner: liveStamp, ticketId: id/)
    // and the request itself is built from the captured ticket
    expect(src).toMatch(/fetch\(`\/api\/eat\/tickets\/\$\{encodeURIComponent\(requestTicketId\)\}\/receipt`\)/)
    expect(src).toMatch(/c\?\.id === requestTicketId/)
  })

  it('the race guard exists, and the source names the mechanism that actually protects', () => {
    expect((src.match(/let alive = true/g) ?? []).length).toBe(2)
    expect((src.match(/return \(\) => \{ alive = false \}/g) ?? []).length).toBe(2)
    // COUNTED, not matched. `toMatch` was satisfied by the OTHER occurrence: the receipt
    // effect checks the flag twice (after the await and in the catch), so deleting one left
    // the pin green — and the behavioural case could not see it either, because the model
    // implements the `alive` discipline itself. The model-agrees-with-its-author trap, a
    // fourth time in this project; counting the real sites is what closes it.
    expect((src.match(/if \(!alive\) return/g) ?? []).length, 'the receipt effect checks it twice').toBe(2)
    expect((src.match(/if \(!alive \|\| !d\) return/g) ?? []).length, 'the rate effect checks it once').toBe(1)
    // the comment must NOT claim the cleanup prevents the commit — it does not, and saying
    // so is how the stamp that really protects gets removed later
    expect(read(PAGE)).toContain('WHAT GUARANTEES SAFETY HERE')
    expect(read(PAGE)).not.toMatch(/disowned before it can resolve/)
  })

  it('§10 the retry carries no scope of its own', () => {
    expect(src).toMatch(/const retry = \(\) => setRetryTick\(\(n\) => n \+ 1\)/)
    expect(src).toMatch(/onClick=\{retry\}/)
    // it cannot issue a request itself, so it cannot issue one as the previous identity
    expect(src).not.toMatch(/onClick=\{load\}/)
    expect(src).not.toMatch(/const load = useCallback/)
  })

  it('the server routes were not touched, and they are the real authority', () => {
    const receiptRoute = read('app/api/eat/tickets/[id]/receipt/route.ts')
    expect(receiptRoute).toMatch(/token\.sub/)
    expect(receiptRoute).toMatch(/private, no-store/)
    const ordersRoute = read('app/api/eat/orders/route.ts')
    expect(ordersRoute).toMatch(/getToken/)
    expect(ordersRoute).toMatch(/token\.sub/)
    // this page sends no identity of its own to either
    expect(src).toMatch(/fetch\('\/api\/eat\/orders'\)/)
  })
})


// ══════════════════════════════════════════════════════════════════════════════
// REVIEW ROUND — my enumeration was escapable, and the page was under-proven
// ══════════════════════════════════════════════════════════════════════════════
//
// Thirty-five findings confirmed, and they collapse into one dominant defect: the §15
// enumeration above closes NINE of the receipt's THIRTEEN fields. `lines`, `address` and the
// per-line `name` / `unitPrice` / `quantity` were never enumerated, and the two container
// bans that were supposed to back it up are both escapable — `/^let /` is anchored at column
// zero, so one leading space defeats it, and the state count only matches the
// array-destructured form of useState. A reviewer measured it: a module-level holder (an
// indented `let`, or a `const` whose object property is named `receipt`) plus a span placed
// OUTSIDE every branch of the cascade paints A's street, A's dish name and A's unit price on
// every frame — and all 72 tests stayed green. The per-field predicate was escapable too:
// /receipt[?]?\./ is satisfied by any `<container>.receipt.<field>`.
//
// That is the model/pin-agrees-with-its-author family a FIFTH time, and this time in the
// very assertion I added as the answer to the fourth. The lesson I had drawn — "enumerate
// the data, not the container" — was right; my implementation of it was not, because a
// PREDICATE over field reads is still a predicate. What cannot be escaped is an EXACT SET:
// the complete list of lines naming each field, and the complete list of module-scope
// declarations and hook calls. A leak has to add a line, and adding a line changes a set.
//
// So everything below is an exact set. No predicate decides what is allowed.

describe('the review round — exact sets, not predicates', () => {
  const src = executable(read(PAGE))
  /** Every trimmed line of the real file naming an identifier, in file order. */
  const lines = (name: string) =>
    src.split('\n').filter((l) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(l)).map((l) => l.trim())

  const IFACE_LINE = 'lines: Array<{ name: string; unitPrice: number; quantity: number }>'
  const PUSH_META = "<span>{receipt.tableName ? t('bannerTable', { name: receipt.tableName }) : t('bannerDinein')}</span>"
  const QTY_LINE = '<span className="rc-line__qty mono"><bdi>{l.quantity}×</bdi></span> {l.name}'
  const AMOUNT_LINE = '<span className="rc-line__amount"><bdi>{money(l.unitPrice * l.quantity)}</bdi></span>'

  it('EXACT SET — `lines`, the itemised bill (the field the enumeration used to miss)', () => {
    expect(lines('lines')).toEqual([
      IFACE_LINE,
      '<section className="rc-lines">',                                  // a CSS class, not a read
      "<span className=\"rc-lines__count mono\" aria-label={t('linesCount', { count: receipt.lines.length })}>{receipt.lines.length}</span>",
      '{receipt.lines.map((l, i) => (',
    ])
  })

  it('EXACT SET — `address`, A\'s street', () => {
    expect(lines('address')).toEqual([
      "import { receiptAddressLines } from '@/lib/receipt-address'",      // the import
      'address: string | null',                                          // the interface
      'const addressLines = receiptAddressLines(receipt?.address ?? null, receipt?.city ?? null)',
    ])
  })

  it('EXACT SET — the per-line fields, which descend from receipt.lines.map', () => {
    expect(lines('unitPrice')).toEqual([
      IFACE_LINE,
      "<small>{t.rich('unitPrice', { price: money(l.unitPrice), m: (chunks) => <bdi>{chunks}</bdi> })}</small>",
      AMOUNT_LINE,
    ])
    expect(lines('quantity')).toEqual([IFACE_LINE, QTY_LINE, AMOUNT_LINE])
    expect(lines('name')).toEqual([IFACE_LINE, PUSH_META, QTY_LINE])
    // `l` is the map callback's parameter, so every one of those reads descends from the
    // GATED receipt — there is exactly one map, over receipt.lines.
    expect((src.match(/\.map\(\(l, i\) => \(/g) ?? []).length, 'one map over the lines').toBe(1)
    expect(src).toMatch(/\{receipt\.lines\.map\(\(l, i\) => \(/)
  })

  it('EXACT SET — module scope. Nothing mutable may live there, at any indentation', () => {
    // The old ban was /^let / at column zero. This is the whole of module scope instead:
    // one frozen string constant, and that is all. An indented `let`, a `var`, or a `const`
    // holding a mutable object all change this set.
    const moduleDecls = src.split('\n').filter((l) => /^\s*(let|var|const)\s/.test(l) && !/^\s{2,}/.test(l)).map((l) => l.trim())
    expect(moduleDecls).toEqual(["const PARIS = 'Europe/Paris'"])
    // belt: every mutable binding in the file, enumerated. Two function-scope race flags,
    // and nothing else — a new `let` anywhere changes this set.
    expect(src.split('\n').filter((l) => /^\s*(let|var)\s/.test(l)).map((l) => l.trim()))
      .toEqual(['let alive = true', 'let alive = true'])
  })

  it('EXACT SET — the hooks. A new container cannot appear without changing this', () => {
    const hooks = Array.from(new Set(src.match(/\buse[A-Z]\w*(?=\s*[(<])/g) ?? [])).sort()
    expect(hooks).toEqual([
      'useEffect', 'useLocale', 'useParams', 'useRouter', 'useSession', 'useState', 'useTranslations',
    ])
    // counted on a form that does not depend on destructuring: `const x = useState(...)`
    // escaped the old pin, which required `const [x, setX] =`.
    expect((src.match(/useState[<(]/g) ?? []).length, 'every useState call').toBe(3)
  })

  it('the two-axis gate is an EXACT SET too, so no disjunction can be appended', () => {
    // The gate — the literal subject of this PR — used to rest on one format-sensitive
    // toMatch, and every behavioural case runs against the suite's reimplementation, so a
    // trailing `|| true`-shaped disjunction restored the original defect with 72/72 green.
    // the declaration's continuation line names `scopeOk`, not `inScope` — it is covered by
    // the scopeOk set below, which is what makes the two sets together close the gate.
    expect(lines('inScope')).toEqual([
      'const inScope = (st: { owner: string | null; ticketId: string | null }) =>',
      'const receipt = inScope(receiptState) ? receiptState.receipt : null',
      "const error = inScope(receiptState) ? receiptState.error : ''",
      'const loading = inScope(receiptState) ? receiptState.loading : true',
      'const rateRestoId = inScope(rateState) ? rateState.restoId : null',
    ])
    expect(lines('scopeOk')).toEqual([
      "const scopeOk = liveStamp !== null && liveStamp !== 'guest'",
      'scopeOk && st.owner === liveStamp && st.ticketId === id',
      'if (!scopeOk || !id) { setRateState({ owner: null, ticketId: null, restoId: null }); return }',
      '}, [liveStamp, scopeOk, id])',
      'if (!scopeOk || !id) {',
      '}, [liveStamp, scopeOk, id, retryTick, t])',
    ])
  })

  it('the render cascade is pinned, so « false emptiness » cannot be introduced', () => {
    // `loading ||` was unpinned: changing it to `loading &&` kept the suite green while
    // B's first frame became exactly the false-empty screen case B exists to exclude.
    expect(src).toMatch(/\{authStatus === 'unauthenticated' \? \(/)
    expect(src).toMatch(/\) : loading \|\| authStatus === 'loading' \? \(/)
    expect(src).toMatch(/\) : error \? \(/)
    expect(src).toMatch(/\) : receipt \? \(/)
    // the order matters as much as the operators
    const at = (needle: string) => {
      const i = src.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    expect(at("{authStatus === 'unauthenticated' ? (")).toBeLessThan(at(') : loading || '))
    expect(at(') : loading || ')).toBeLessThan(at(') : error ? ('))
    expect(at(') : error ? (')).toBeLessThan(at(') : receipt ? ('))
  })

  it('the error text comes from the page, not from the test\'s imagination', () => {
    // The error path was proven only against a model that fabricated the message: deleting
    // the page's error text entirely stayed green and left a blank dead end.
    expect(src).toMatch(/error: \(body\?\.error as string\) \|\| t\('loadError'\)/)
    expect((src.match(/t\('loadError'\)/g) ?? []).length, 'the fallback, in both failure paths').toBe(2)
    expect(src).toMatch(/<p>\{error\}<\/p>/)
    expect(src).toMatch(/onClick=\{retry\}>\{t\('retry'\)\}/)
    // and the key really exists, in all five locales
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const ns = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8')).eat.receipt
      expect(ns.loadError, `${loc}/loadError`).toBeTruthy()
      expect(ns.retry, `${loc}/retry`).toBeTruthy()
    }
  })

  it('N (repaired) — three identities, and C\'s isolation is asserted on LOADED data', () => {
    // The old case asserted C's isolation against a state that held nothing for anyone:
    // both cross-account assertions were vacuous. Here A's and B's receipts are actually
    // committed, so the assertion has something to be wrong about.
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.receiptReqs[0].ok(RECEIPT_A)
    expect(p.render('authenticated', A, T1).receipt?.sessionCode).toBe(A_SESSION_CODE)   // A's, loaded

    p.turn('authenticated', B, T1)
    p.receiptReqs[1].ok(RECEIPT_B)
    expect(p.render('authenticated', B, T1).receipt?.sessionCode).toBe('SESSB-0001')     // B's, loaded

    p.turn('authenticated', C, T1)                                   // now C arrives
    const asC = p.render('authenticated', C, T1)
    expect(asC.receipt).toBeNull()                                   // neither A's nor B's
    expect(asC.raw.receiptState.owner).toBe(`u:${C}`)                // re-stamped for C
    expect(JSON.stringify(asC)).not.toContain(A_SESSION_CODE)
    expect(JSON.stringify(asC)).not.toContain('SESSB-0001')
    // …and C's own answer is the only thing C can see
    p.receiptReqs[2].ok({ ...RECEIPT_B, sessionCode: 'SESSC-0001', restaurantName: 'Chez C' })
    const loaded = p.render('authenticated', C, T1)
    expect(loaded.receipt?.sessionCode).toBe('SESSC-0001')
    expect(JSON.stringify(loaded)).not.toContain(A_RESTO)
  })

  it('N bis — the SAME three-identity case for rateRestoId, which had none', () => {
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.rateReqs[0].found(A_RESTO_ID)
    expect(p.render('authenticated', A, T1).rateRestoId).toBe(A_RESTO_ID)

    p.turn('authenticated', B, T1)
    p.rateReqs[1].found('resto-B-1')
    expect(p.render('authenticated', B, T1).rateRestoId).toBe('resto-B-1')

    p.turn('authenticated', C, T1)
    expect(p.render('authenticated', C, T1).rateRestoId).toBeNull()
    // every late arrival, in both orders, while C is live
    p.rateReqs[0].found(A_RESTO_ID)
    p.rateReqs[1].found('resto-B-1')
    const asC = p.render('authenticated', C, T1)
    expect(asC.rateRestoId).toBeNull()
    expect(JSON.stringify(asC.raw.rateState)).not.toContain(A_RESTO_ID)
    expect(JSON.stringify(asC.raw.rateState)).not.toContain('resto-B-1')
  })

  it('and the receipt and the rate can never be MIXED across owners', () => {
    // receipt B with rate A, or receipt A with rate B — neither is reachable, because both
    // derive from the same pair.
    const p = makePage()
    p.turn('authenticated', A, T1)
    p.turn('authenticated', B, T1)
    p.receiptReqs[1].ok(RECEIPT_B)       // B's receipt lands
    p.rateReqs[0].found(A_RESTO_ID)      // A's rate lands late
    const g = p.render('authenticated', B, T1)
    expect(g.receipt?.sessionCode).toBe('SESSB-0001')
    expect(g.rateRestoId).toBeNull()     // NOT A's restaurant
    // the mirror: A's receipt late, B's rate fresh
    const q = makePage()
    q.turn('authenticated', A, T1)
    q.turn('authenticated', B, T1)
    q.rateReqs[1].found('resto-B-1')
    q.receiptReqs[0].ok(RECEIPT_A)
    const h = q.render('authenticated', B, T1)
    expect(h.receipt).toBeNull()         // NOT A's receipt
    expect(h.rateRestoId).toBe('resto-B-1')
  })
})
