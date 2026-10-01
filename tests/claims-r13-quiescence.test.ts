// tests/claims-r13-quiescence.test.ts — T-49 round 13, J-M21 (C4, D3, D14 (0), A-S01)
//
// A payable proof of absence cannot be used before its quiescence instant: a stalled engine attempt
// that started before the proof must be overtaken by at least ATTEMPT_QUIESCENCE_MS. One parser, one
// set of refusal texts (ER-M03). The sweep never drives a proof (C4, landed in W1) — and under D′ L2
// (spec v2 S-13, R13 v1.1 D2) it drives NOTHING: step 2 is deleted, C4 lives in T1 alone, reached only by a
// direct triggerClaimRefund call. T1 and T2 (e') are wired by the T1/T2 slice; the RELEASE GATE below fails
// if a v13 proof writer lands before them, or beside a sweep driver that does not skip a recorded error.
// D1 v1.1: an approved claim whose amount is not fixed offers 'ratify' (a decision), never 'approve'.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
// ROUND 13 (slice W2): the driven claim runs T1 → T2 (fresh reads) → the engine — never the real Stripe.
const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))
import { payableWorld, wireWorld, engineOk } from './support/claims-world'

import {
  ATTEMPT_QUIESCENCE_MS, proofInstant, proofInstantFor, arbitrationRefusal, acceptedExits, MARKERS,
  APPROVE_INSTANT_UNREADABLE, APPROVE_LEGACY_PROOF, approvePrematureText, approveRevisableText, approvePermanentText,
  type ClaimFacts,
} from '@/lib/claim-action-rules'
import { runClaimAutoApproval, triggerClaimRefund } from '@/lib/claims'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const T0 = new Date('2026-09-12T08:00:00.000Z')
const marker = (at: Date) => `reconcile_required: tentative de remboursement démarrée à ${at.toISOString()} (tentative 3f1c2a9e-7b1d-4c55-9a55-2b8e0c3a1d42) — identité du remboursement pas encore liée.`
/** The G8 PAYABLE tail's last sentence, with a real instant. */
const v13 = (instant: Date) => `${MARKERS.PROOF_PAYABLE_V13} Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue). … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).`
const approved = (refundError: string | null): ClaimFacts => ({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError })

describe('J-M21 — the constant and the three instant rules', () => {
  it('ATTEMPT_QUIESCENCE_MS is at least 60 minutes', () => {
    expect(ATTEMPT_QUIESCENCE_MS).toBeGreaterThanOrEqual(3_600_000)
  })

  it('(1) a crash marker at T0 → T0 + Q, even when the proof is written later', () => {
    const now = new Date(T0.getTime() + 10 * 60 * 1000)
    expect(proofInstantFor(marker(T0), now).toISOString()).toBe(new Date(T0.getTime() + ATTEMPT_QUIESCENCE_MS).toISOString())
  })

  it('(2) a v13 pre-image carrying instant I → I (never pushed a second Q later)', () => {
    const I = new Date(T0.getTime() + ATTEMPT_QUIESCENCE_MS)
    const now = new Date(T0.getTime() + 5 * ATTEMPT_QUIESCENCE_MS)
    expect(proofInstantFor(v13(I), now).toISOString()).toBe(I.toISOString())
  })

  it('(3) a pre-image with no marker and no instant (null, FV, a lock) → now + Q', () => {
    for (const pre of [null, 'financial_verification:stripe_unreadable: Conclusion possible à partir du 2026-09-13T00:00:00.000Z.', 'no_refund_proven_rail_locked: x']) {
      expect(proofInstantFor(pre, T0).toISOString(), String(pre)).toBe(new Date(T0.getTime() + ATTEMPT_QUIESCENCE_MS).toISOString())
    }
  })

  it('a PROOF_PAYABLE_V13 text built from proofInstantFor carries « payable au plus tôt le <ISO> (UTC) » that proofInstant parses back', () => {
    const at = proofInstantFor(marker(T0), T0)
    const text = v13(at)
    expect(text).toContain(`payable au plus tôt le ${at.toISOString()} (UTC)`)
    expect(proofInstant(text)?.toISOString()).toBe(at.toISOString())
  })
})

describe('J-M21 — approve before, at and without the instant (D14 (0), C4 texts)', () => {
  const I = new Date(T0.getTime() + ATTEMPT_QUIESCENCE_MS)
  const claim = approved(v13(I))

  it('instant − 1 ms → the C4 REVISABLE text (v1.1: names the rail, never a re-approval), ratify still in the exit table (D1 v1.1, not approve), none of D14 (1)-(3)', () => {
    const before = new Date(I.getTime() - 1)
    const r = arbitrationRefusal(claim, 'approve', before)
    expect(r).toEqual({ status: 409, error: approvePrematureText(I.toISOString()) })
    expect(r!.error).toBe(`Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du ${I.toISOString()} (UTC) ; ce délai sépare toute nouvelle tentative de remboursement d’une éventuelle tentative antérieure. Rien n’est payé avant cette heure ; le rail financier (« Payer les approuvées », session admin, remboursements ouverts) pourra la sélectionner ensuite.`)
    // NEGATIVE CONTROL — the R13 v1.0 sentence (« approuvez-la à nouveau ensuite ») named a re-approval as the money path
    expect(r!.error).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
    // D1 v1.1 / D3: the pre-instant canonical v13 shape keeps its REVISABLE row as a ratification (a decision, no money)
    const exits = acceptedExits({ claim, now: before })
    expect(exits).toContain('ratify')
    expect(exits).not.toContain('approve')
    expect(exits).not.toContain('pay')
    for (const t of [APPROVE_LEGACY_PROOF, approveRevisableText(true), approveRevisableText(false), approvePermanentText(true), approvePermanentText(false)]) {
      expect(r!.error).not.toBe(t)
    }
  })

  it('at the instant → null', () => {
    expect(arbitrationRefusal(claim, 'approve', I)).toBeNull()
  })

  it('the instant text removed, or an unparsable date → the C4 unreadable text, and neither approve nor ratify is in the exit table (D1 row 2, D3; v1.1)', () => {
    const removed = approved(`${MARKERS.PROOF_PAYABLE_V13} Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue).`)
    const unparsable = approved(`${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le 2026-13-45T99:99:99.000Z (UTC).`)
    const later = new Date(I.getTime() + 86_400_000)
    for (const c of [removed, unparsable]) {
      expect(arbitrationRefusal(c, 'approve', later)).toEqual({ status: 409, error: APPROVE_INSTANT_UNREADABLE })
      // round-1 fix: an unreadable instant is not a revisable approval — reconcile re-derives it first.
      // D1 v1.1: nor is it a ratification — the exit table offers reconcile alone.
      const exits = acceptedExits({ claim: c, now: later })
      expect(exits).toEqual(['reconcile'])
      expect(exits).not.toContain('approve')
      expect(exits).not.toContain('ratify')
    }
    expect(APPROVE_INSTANT_UNREADABLE).toBe('Approbation impossible : l’heure à partir de laquelle cette preuve d’absence permet un paiement n’a pas pu être lue. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise »).')
    // NEGATIVE CONTROL: the READABLE proof before its instant keeps its REVISABLE row — as a ratification (D1 v1.1), never approve.
    expect(acceptedExits({ claim, now: new Date(I.getTime() - 1) })).toEqual(['ratify', 'reconcile'])
    // NEGATIVE CONTROL: the R13 v1.0 shape (approve on an approved claim) is not what the table returns any more.
    expect(acceptedExits({ claim, now: new Date(I.getTime() - 1) })).not.toEqual(['approve', 'reconcile'])
    expect(acceptedExits({ claim, now: later })).toEqual(['ratify', 'reconcile'])
  })

  it('NEGATIVE CONTROL — a legacy proof (no v13 tag) is never admitted by the instant check: it gets D14 (1), even with an instant in it; neither approve nor ratify', () => {
    const legacy = approved(`no_refund_proven: … payable au plus tôt le ${T0.toISOString()} (UTC).`)
    expect(arbitrationRefusal(legacy, 'approve', new Date(T0.getTime() + 10 * ATTEMPT_QUIESCENCE_MS))).toEqual({ status: 409, error: APPROVE_LEGACY_PROOF })
    expect(acceptedExits({ claim: legacy, now: T0 })).not.toContain('approve')
    expect(acceptedExits({ claim: legacy, now: T0 })).not.toContain('ratify')
  })

  it('a stalled attempt cannot be overtaken early: a proof written 10 min after an attempt start is not approvable before start + Q', () => {
    const start = T0
    const proofWrittenAt = new Date(start.getTime() + 10 * 60 * 1000)
    const c = approved(v13(proofInstantFor(marker(start), proofWrittenAt)))
    expect(arbitrationRefusal(c, 'approve', new Date(start.getTime() + ATTEMPT_QUIESCENCE_MS - 1))).not.toBeNull()
    expect(arbitrationRefusal(c, 'approve', new Date(start.getTime() + ATTEMPT_QUIESCENCE_MS))).toBeNull()
  })
})

// ══ ONE INSTANT PARSER — a lexer-light scan for EVERY RegExp construction ══════════════════════════
// A parser is the phrase inside a regex literal, inside the arguments of RegExp(...) / new RegExp(...),
// or inside a String.raw template (the harness builds u-flag patterns that way). A writer — the phrase in
// a plain string or template — is not a parser.
const SEP = String.raw`(?:(?:\s|\\s)[+*?]?)+`
const PHRASE = new RegExp(`payable${SEP}au${SEP}plus${SEP}t(?:ô|o|\\\\u00f4|\\\\u\\{f4\\}|\\\\x[fF]4|\\[[^\\]]*\\]|\\.)t${SEP}le`, 'i')

function skipQuoted(code: string, i: number): number {
  const q = code[i]
  let j = i + 1
  while (j < code.length && code[j] !== q && code[j] !== '\n') { if (code[j] === '\\') j++; j++ }
  return j + 1
}
function skipTemplate(code: string, i: number): number {
  let j = i + 1
  while (j < code.length && code[j] !== '`') {
    if (code[j] === '\\') { j += 2; continue }
    if (code[j] === '$' && code[j + 1] === '{') {
      let depth = 1
      j += 2
      while (j < code.length && depth > 0) {
        const ch = code[j]
        if (ch === "'" || ch === '"') { j = skipQuoted(code, j); continue }
        if (ch === '`') { j = skipTemplate(code, j); continue }
        if (ch === '{') depth++
        else if (ch === '}') depth--
        j++
      }
      continue
    }
    j++
  }
  return j + 1
}
function matchParen(code: string, open: number): number {
  let depth = 0
  for (let j = open; j < code.length; j++) {
    const ch = code[j]
    if (ch === "'" || ch === '"') { j = skipQuoted(code, j) - 1; continue }
    if (ch === '`') { j = skipTemplate(code, j) - 1; continue }
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0) return j }
  }
  return code.length - 1
}

type Construction = { kind: 'regex literal' | 'RegExp()' | 'String.raw'; text: string }
function constructions(code: string): Construction[] {
  const out: Construction[] = []
  const ctorSpans: Array<[number, number]> = []
  const insideCtor = (at: number) => ctorSpans.some(([a, b]) => at > a && at < b)
  let prev = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '/' && code[i + 1] === '/') { const e = code.indexOf('\n', i); i = e < 0 ? code.length : e; continue }
    if (ch === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 2; continue }
    if (ch === 'R' && code.startsWith('RegExp', i) && !/[\w$]/.test(code[i - 1] ?? '') && !/[\w$]/.test(code[i + 6] ?? '')) {
      const rest = code.slice(i + 6)
      const k = rest.search(/\S/)
      const open = i + 6 + (k < 0 ? 0 : k)
      if (code[open] === '(') {
        const close = matchParen(code, open)
        ctorSpans.push([open, close])
        out.push({ kind: 'RegExp()', text: code.slice(open, close + 1) })
      }
    }
    if (ch === "'" || ch === '"') { i = skipQuoted(code, i); prev = ch; continue }
    if (ch === '`') {
      const end = skipTemplate(code, i)
      if (/String\.raw\s*$/.test(code.slice(Math.max(0, i - 16), i)) && !insideCtor(i)) out.push({ kind: 'String.raw', text: code.slice(i, end) })
      i = end
      prev = '`'
      continue
    }
    if (ch === '/') {
      const exprStart = prev === '' || '(,=:[!&|?{};+-*%~^'.includes(prev)
        || /(?:^|[^\w$])(?:return|typeof|case|in|of|void|yield|await)\s*$/.test(code.slice(Math.max(0, i - 12), i))
      if (exprStart) {
        let j = i + 1
        let inClass = false
        while (j < code.length && code[j] !== '\n') {
          if (code[j] === '\\') { j += 2; continue }
          if (code[j] === '[') inClass = true
          else if (code[j] === ']') inClass = false
          else if (code[j] === '/' && !inClass) break
          j++
        }
        if (code[j] === '/') {
          if (!insideCtor(i)) out.push({ kind: 'regex literal', text: code.slice(i, j + 1) })
          i = j + 1
          prev = '/'
          continue
        }
      }
    }
    if (!/\s/.test(ch)) prev = ch
    i++
  }
  return out
}
const instantParsers = (src: string) => constructions(src).filter((c) => PHRASE.test(c.text))

describe('J-M21 — one instant parser (source scan over every RegExp construction)', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p.replace(/\\/g, '/'))
    }
  }
  walk('lib'); walk('components'); walk('app')

  it('exactly one parser of « payable au plus tôt le » in lib/, components/ and app/: the regex literal inside proofInstant; no parseQuiescenceInstant', () => {
    const hits = files.flatMap((f) => instantParsers(read(f)).map((h) => `${f} ${h.kind}`))
    expect(hits).toEqual(['lib/claim-action-rules.ts regex literal'])
    const src = stripComments(read('lib/claim-action-rules.ts'))
    const body = src.slice(src.indexOf('export function proofInstant('), src.indexOf('export function proofInstantFor('))
    expect(body).toContain('/payable au plus tôt le (\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z) \\(UTC\\)/.exec(e)')
    expect(instantParsers(body).map((h) => h.kind)).toEqual(['regex literal'])
    for (const f of files) expect(stripComments(read(f)), f).not.toContain('parseQuiescenceInstant')
  })

  it('NEGATIVE CONTROL — the SAME scanner finds a second parser however it is built, and never a writer', () => {
    const BT = '`'
    const PARSERS: Array<[string, string]> = [
      ['new RegExp with a quoted pattern', "const re = new RegExp('payable au plus tôt le (\\\\d{4}-\\\\d{2})')"],
      ['RegExp(String.raw…) with a class for ô', 'const re = RegExp(String.raw' + BT + 'payable au plus t[oô]t le (\\d{4}-\\d{2})' + BT + ", 'u')"],
      // slice W2 carry-over: the harness idiom itself — new RegExp(String.raw`…`, 'u')
      ['new RegExp(String.raw…, u) — the harness idiom', 'const re = new RegExp(String.raw' + BT + 'payable au plus tôt le (\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z)(?!\\p{L})' + BT + ", 'u')"],
      ['a String.raw pattern kept for later', 'const pattern = String.raw' + BT + 'payable au plus tôt le (\\S+) \\(UTC\\)' + BT],
      ['a regex literal copy', 'const m = /payable au plus tôt le (\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z) \\(UTC\\)/.exec(e)'],
      ['a loosened literal with \\s+ and .', 'const m = s.match(/payable\\s+au\\s+plus\\s+t.t\\s+le (\\S+)/)'],
      ['a literal after return', 'function p(e) { return /Elle est payable au plus tôt le (.+)/.exec(e) }'],
    ]
    for (const [name, src] of PARSERS) expect(instantParsers(src).length, name).toBe(1)
    const WRITERS: Array<[string, string]> = [
      ['a template writer', 'const text = ' + BT + 'Elle est payable au plus tôt le ${at.toISOString()} (UTC).' + BT],
      ['a string writer after a division', "const x = a / b; const t = 'payable au plus tôt le ' + iso"],
      ['a comment', '// payable au plus tôt le (\\d{4}) parsed by /x/'],
    ]
    for (const [name, src] of WRITERS) expect(instantParsers(src), name).toEqual([])
    // the real tree with one string-built parser added is red on the pin above
    const mutated = read('lib/claims.ts') + "\nconst second = new RegExp('payable au plus tôt le (\\\\S+)')\n"
    expect(instantParsers(mutated).length).toBe(1)
  })
})

// ══ C4 → D′ L2 — THE SWEEP DRIVES NOTHING: no step 2, no approved-row read, no engine ═══════════════
// R13 W1 made the sweep's step 2 skip every approved claim carrying a refundError (C4). D′ L2 (spec v2 S-13,
// R13 v1.1 D2) deletes step 2 altogether: runClaimAutoApproval only routes expired restaurant_review claims to
// arbitration. C4 now lives in T1 alone (a v13 proof before its instant, a legacy proof, a lock, AWAITING, a hold
// are refused there), reached only by a DIRECT triggerClaimRefund call — the L5 rail's entry point.
describe('J-M21 / J-M47 (D′ L2) — runClaimAutoApproval has no step 2: approved rows are never read, written or driven', () => {
  const past = new Date(Date.now() - 2 * ATTEMPT_QUIESCENCE_MS)
  const future = new Date(Date.now() + 2 * ATTEMPT_QUIESCENCE_MS)
  const RECORDED = [
    { id: 'cl_v13_past', refundError: v13(past) },
    { id: 'cl_v13_future', refundError: v13(future) },
    { id: 'cl_legacy', refundError: 'no_refund_proven: aucun remboursement …' },
    { id: 'cl_lock', refundError: 'no_refund_proven_rail_locked: … MAIS le rail financier ne paierait pas cette réclamation : …' },
    { id: 'cl_await', refundError: `${MARKERS.AWAITING_FINALIZATION} … la plus ancienne ligne en attente …` },
    { id: 'cl_hold', refundError: `${MARKERS.SAFETY_HOLD} …` },
  ]
  /** The states T1 refuses on its pre-image read (C4 and its siblings) — a v13 proof PAST its instant is admitted by T1. */
  const T1_REFUSED = RECORDED.filter((r) => r.id !== 'cl_v13_past')
  const EMPTY_SWEEP = { scannedExpired: 0, routedToArbitration: 0, skippedSafety: 0, skippedAlreadyHandled: 0 }

  beforeEach(() => {
    vi.clearAllMocks()
    for (const m of [db.claim.findMany, db.claim.findUnique, db.claim.updateMany, db.claim.update, db.refund.findUnique, execMock, refundsFlag]) m.mockReset()
    refundsFlag.mockReturnValue(true)
    db.claim.updateMany.mockResolvedValue({ count: 1 })
    db.claim.update.mockResolvedValue({})
    db.claim.findUnique.mockResolvedValue({ orderId: 'o1', requestedAmountCents: 500 })
    execMock.mockResolvedValue({ ok: true, refundId: 'rf1', amountCents: 500 })
  })

  it('v13 (past and before its instant), legacy proof, lock, AWAITING, safety hold AND a null-error approved claim → the sweep scans restaurant_review only: 0 approved reads, 0 T1 reads, 0 writes, 0 engine, 0 lease reads', async () => {
    db.claim.findMany.mockImplementation(async ({ where }: { where: { status?: string } }) => (where.status === 'approved' ? [...RECORDED, { id: 'cl_null', refundError: null }] : []))
    const summary = await runClaimAutoApproval()
    expect(summary).toEqual(EMPTY_SWEEP)
    // the dab754d summary fields are gone with step 2
    for (const k of ['scannedPending', 'autoApproved', 'refundsTriggered', 'refundsPending', 'refundsFailed']) expect(summary).not.toHaveProperty(k)
    const scans = (db.claim.findMany.mock.calls as Array<[{ where: { status?: string } }]>).map((c) => c[0].where.status)
    expect(scans).toEqual(['restaurant_review'])
    expect(db.claim.findUnique).not.toHaveBeenCalled()  // T1's pre-image read
    expect(db.claim.updateMany).not.toHaveBeenCalled()  // T1's attempt CAS is triggerClaimRefund's first write
    expect(execMock).not.toHaveBeenCalled()
    expect(refundsFlag).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the same world, driven by hand: the sweep still touches nothing, but the DIRECT triggerClaimRefund on the approved null-error claim IS driven exactly once; T1 refuses the recorded states before any write', async () => {
    // ROUND 13 (slice W2): the driven claim goes through T1 → T2 on fresh reads; an in-memory world holds them all.
    const w = payableWorld({ id: 'cl_null' })
    w.claims.push(...RECORDED.map((r) => ({ ...w.claims[0], ...r })))
    wireWorld(w, db, stripeMock)
    execMock.mockResolvedValue(engineOk())
    expect(await runClaimAutoApproval()).toEqual(EMPTY_SWEEP)
    expect(execMock).not.toHaveBeenCalled()
    expect(w.writes).toEqual([])
    expect(w.reads).toBe(0)
    // C4 and its siblings live in T1: each refused state answers already_handled with no write and no engine
    for (const r of T1_REFUSED) expect(await triggerClaimRefund(r.id), r.id).toEqual({ state: 'already_handled' })
    expect(execMock).not.toHaveBeenCalled()
    expect(w.writes).toEqual([])
    // the null-error approved claim: T1 → T2 → the engine, once, for this claim
    expect(await triggerClaimRefund('cl_null')).toMatchObject({ state: 'refunded', refundId: 'rf_new' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock.mock.calls[0][0]).toMatchObject({ reason: 'claim:cl_null' })
    expect(w.writes.length).toBeGreaterThan(0)
    expect(w.writes.every((x) => x.where.id === 'cl_null')).toBe(true)
    expect(w.writes[0].where).toMatchObject({ id: 'cl_null', status: 'approved', refundAttempted: false, refundError: null })
    // and the sweep, run again beside the driven claim, still reads and writes nothing
    const writesBefore = w.writes.length
    expect(await runClaimAutoApproval()).toEqual(EMPTY_SWEEP)
    expect(w.writes).toHaveLength(writesBefore)
    expect(execMock).toHaveBeenCalledTimes(1)
  })
})

// ══ RELEASE GATE (C2 / C3 / C4 ordering) ═══════════════════════════════════════════════════════════
// T1/T2 must land no later than the first writer of PROOF_PAYABLE_V13. Until then triggerClaimRefund's CAS
// is round-12 and nothing may write a v13 proof. This pin fails the day a writer exists without them.
// C4 (the sweep): a sweep that DRIVES triggerClaimRefund must skip every recorded refundError. D′ L2 removed the
// sweep driver altogether (no call site of triggerClaimRefund in runClaimAutoApproval): that is the green shape
// now, and the only one the shipped tree may have; a driver that comes back without the skip is red.
const V13_WRITER = [
  /\b(?:proofPrefixFor|deriveNoRowOutcome)\s*\(/,
  /\$\{[^}]*PROOF_PAYABLE_V13[^}]*\}/,
  /PROOF_PAYABLE_V13\s*\+/,
  /refundError\s*:[^\n]*PROOF_PAYABLE_V13/,
  /['"`]no_refund_proven:v13:/,
]
function releaseGateViolations(sources: Record<string, string>): string[] {
  const writers = Object.entries(sources)
    .filter(([f]) => f !== 'lib/claim-action-rules.ts')
    .filter(([, s]) => V13_WRITER.some((re) => re.test(stripComments(s))))
    .map(([f]) => f)
  if (!writers.length) return []
  const claims = stripComments(sources['lib/claims.ts'] ?? '')
  const bodyOf = (name: string) => {
    const a = claims.indexOf(name)
    if (a < 0) return ''
    const b = claims.indexOf('\nexport ', a + name.length)
    return claims.slice(a, b < 0 ? undefined : b)
  }
  const out: string[] = []
  const t1 = bodyOf('export async function triggerClaimRefund')
  const derive = t1.indexOf('deriveNoRowOutcome(')
  const engine = t1.indexOf('executeRefund(')
  if (engine >= 0 && (derive < 0 || derive > engine)) {
    out.push(`${writers.join(', ')} write a v13 proof while triggerClaimRefund calls executeRefund with no deriveNoRowOutcome before it (C3 T2)`)
  }
  const sweep = bodyOf('export async function runClaimAutoApproval')
  if (sweepDrivesTrigger(sweep) && !/if \(c\.refundError\) continue/.test(sweep)) {
    out.push(`${writers.join(', ')} write a v13 proof while the sweep drives triggerClaimRefund without skipping a recorded refundError (C4)`)
  }
  return out
}
/** D′ L2: the sweep body (comments stripped) calls triggerClaimRefund or executeRefund. */
const sweepDrivesTrigger = (sweepBody: string) => /\b(?:triggerClaimRefund|executeRefund)\s*\(/.test(sweepBody)
const sweepBodyOf = (claimsSource: string) => {
  const claims = stripComments(claimsSource)
  const a = claims.indexOf('export async function runClaimAutoApproval')
  const b = a < 0 ? -1 : claims.indexOf('\nexport ', a + 1)
  return a < 0 ? '' : claims.slice(a, b < 0 ? undefined : b)
}

describe('RELEASE GATE — no PROOF_PAYABLE_V13 writer before T1/T2 and the sweep skip', () => {
  const sources: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) sources[p.replace(/\\/g, '/')] = read(p)
    }
  }
  walk('lib'); walk('app'); walk('components')

  it('the shipped tree has no violation — and the green shape is not vacuous: the tree HAS v13 writers, and the shipped sweep has NO driver at all (D′ L2)', () => {
    expect(sources['lib/claims.ts']).toBeTruthy()
    expect(releaseGateViolations(sources)).toEqual([])
    // the gate is armed: at least one v13 writer exists outside the rules module (else the gate checks nothing)
    const writers = Object.entries(sources).filter(([f]) => f !== 'lib/claim-action-rules.ts').filter(([, s]) => V13_WRITER.some((re) => re.test(stripComments(s)))).map(([f]) => f)
    expect(writers).toContain('lib/claims.ts')
    // D′ L2: the sweep body neither drives the trigger nor the engine, and carries no C4 skip (there is nothing to skip)
    const sweep = sweepBodyOf(sources['lib/claims.ts'])
    expect(sweep).toContain('routeClaimToArbitration(c.id')
    expect(sweepDrivesTrigger(sweep)).toBe(false)
    expect(sweep).not.toMatch(/if \(c\.refundError\) continue/)
    expect(sweep).not.toMatch(/status:\s*'approved'/)
  })

  it('NEGATIVE CONTROL — a v13 writer with the round-12 trigger (no derivation, or one after the engine) is red; the shipped T2 order is green; a sweep driver WITHOUT the skip is red, WITH it green (R13 shape), and the shipped no-driver sweep is green', () => {
    // ROUND 13 (slice W2): T2 is shipped, so the round-12 trigger is reconstructed by REMOVING the derivation.
    const writer = '\nconst w = { refundError: `${MARKERS.PROOF_PAYABLE_V13} Stripe ne rapporte …` }\n'
    const shipped = sources['lib/claims.ts']
    expect(releaseGateViolations({ ...sources, 'lib/claims.ts': shipped + writer })).toEqual([])
    const round12 = shipped.replace('const outcome = deriveNoRowOutcome(read, claimId)', 'const outcome = null as never')
    expect(round12).not.toBe(shipped)
    expect(releaseGateViolations({ ...sources, 'lib/claims.ts': round12 + writer }).join(' | ')).toContain('no deriveNoRowOutcome before it')
    const afterEngine = round12.replace('const t4Write = async', 'void deriveNoRowOutcome(read, claimId)\n    const t4Write = async')
    expect(afterEngine).not.toBe(round12)
    expect(releaseGateViolations({ ...sources, 'lib/claims.ts': afterEngine + writer }).join(' | ')).toContain('no deriveNoRowOutcome before it')
    // C4: the dab754d sweep driver brought back without its skip → red; with the R13 skip → the C4 clause is green
    const ROUTE = "const r = await routeClaimToArbitration(c.id, 'auto_timeout')"
    expect(shipped).toContain(ROUTE)
    const driverNoSkip = shipped.replace(ROUTE, 'const r = await triggerClaimRefund(c.id)')
    expect(driverNoSkip).not.toBe(shipped)
    expect(sweepDrivesTrigger(sweepBodyOf(driverNoSkip))).toBe(true)
    expect(releaseGateViolations({ ...sources, 'lib/claims.ts': driverNoSkip + writer }).join(' | ')).toContain('without skipping a recorded refundError')
    const driverWithSkip = shipped.replace(ROUTE, 'if (c.refundError) continue\n    const r = await triggerClaimRefund(c.id)')
    expect(sweepDrivesTrigger(sweepBodyOf(driverWithSkip))).toBe(true)
    expect(releaseGateViolations({ ...sources, 'lib/claims.ts': driverWithSkip + writer })).toEqual([])
    // a driver named in a comment line is not a driver (the scan strips comment lines), so the shipped sweep is read as it is
    const commentOnly = shipped.replace(ROUTE, `${ROUTE}\n    // triggerClaimRefund(c.id)`)
    expect(sweepDrivesTrigger(sweepBodyOf(commentOnly))).toBe(false)
    expect(releaseGateViolations({ ...sources, 'lib/claims.ts': commentOnly + writer })).toEqual([])
  })
})
