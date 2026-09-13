// tests/claim-closure-record.test.ts — T-49 round 13, slice W6: J-C23 (H05 — one writer, the seven sites, only after a won
// CAS, never in a transaction), J-C37 (H01 — at most two closure notices per claim, in the only permitted order), and the
// ER-R31 regression (a declared resume_mismatch claim is not a binder and never settles).
//
// IMPLEMENTATION NOTE (W6) on J-C23: H05 site 5 (attributeWithEvidence's C7 re-read branch) is written in its helper
// bindingNotObserved, which attributeWithEvidence calls on every transaction error; the call-site map names the helper.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { Prisma } from '@prisma/client'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, engineOk, type World } from './support/claims-world'
import { matchWhere } from './support/prisma-where'

type Row = Record<string, unknown>
const { db, stripeMock, mail, st } = vi.hoisted(() => ({
  st: {
    dispatch: [] as Array<{ trigger: string; dedupeKey: string }>,
    recordFails: null as null | 'p2002' | 'error',
    consumer: { email: 'lea@x.fr', name: 'Léa', locale: null } as Record<string, unknown> | null,
  },
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    operator: { findUnique: vi.fn() },
    emailDispatch: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
    emailLog: { create: vi.fn() },
  },
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
  mail: { sendMail: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn(async () => true) }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mail.sendMail }) } }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/onboarding-nudge', () => ({ resolveNudgeLocale: () => 'fr' }))

import {
  triggerClaimRefund, arbitrateClaim, resolveStuckClaim, reconcileClaimForRefund, reconcileClaimEvidence, boundToWhere,
} from '@/lib/claims'
import { sendClaimClosureEmail } from '@/lib/claim-emails'
import { MARKERS, CLOSURE_TRIGGER, claimClosureKind, customerClaimStatus, type ClosureKind } from '@/lib/claim-action-rules'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, '/')
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p]
})
const P2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
const REC = 'claim_closure_record'

let w: World
function setWorld(next: World) {
  w = next
  wireWorld(w, db, stripeMock)
  db.emailDispatch.create.mockImplementation(async ({ data }: { data: { trigger: string; dedupeKey: string } }) => {
    if (data.trigger === REC && st.recordFails === 'error') throw new Error('db down')
    if (data.trigger === REC && st.recordFails === 'p2002') throw P2002()
    if (st.dispatch.some((d) => d.trigger === data.trigger && d.dedupeKey === data.dedupeKey)) throw P2002()
    st.dispatch.push({ trigger: data.trigger, dedupeKey: data.dedupeKey })
    return { id: `d${st.dispatch.length}`, ...data }
  })
  db.emailDispatch.findFirst.mockImplementation(async ({ where }: { where: { trigger: string; dedupeKey: string } }) =>
    st.dispatch.find((d) => d.trigger === where.trigger && d.dedupeKey === where.dedupeKey) ?? null)
  db.emailDispatch.deleteMany.mockImplementation(async ({ where }: { where: { trigger: string; dedupeKey: string } }) => {
    const before = st.dispatch.length
    st.dispatch = st.dispatch.filter((d) => !(d.trigger === where.trigger && d.dedupeKey === where.dedupeKey))
    return { count: before - st.dispatch.length }
  })
  db.emailLog.create.mockResolvedValue({ id: 'l1' })
  db.operator.findUnique.mockImplementation(async () => st.consumer)
}
const records = () => st.dispatch.filter((d) => d.trigger === REC).map((d) => d.dedupeKey)
/** H05's noNoticeSource console line (J-C23: only reconcileClaimForRefund logs it). */
const DECISION_MISS = '[EMAIL MISS] [claim_decision_refunded]'
const claimTriggers = () => st.dispatch.filter((d) => d.trigger !== REC).map((d) => d.trigger)
const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf_b, mais Stripe rapporte aujourd’hui son remboursement re_b « failed ».`

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, refundsFlag, mail.sendMail]) m.mockReset()
  st.dispatch = []
  st.recordFails = null
  st.consumer = { email: 'lea@x.fr', name: 'Léa', locale: null }
  refundsFlag.mockReturnValue(true)
  execMock.mockResolvedValue(engineOk())
  mail.sendMail.mockResolvedValue({ messageId: 'm1' })
  process.env.SMTP_PASS = 'x'
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  setWorld(payableWorld())
})
afterEach(() => {
  errSpy.mockRestore()
  delete process.env.SMTP_PASS
})
const errLines = () => errSpy.mock.calls.map((c) => c.map(String).join(' '))

// ══ J-C23 — static ═══════════════════════════════════════════════════════════════════════════════
/** Every `recordClaimClosure(` call in lib/claims.ts, by the top-level function that contains it. */
function recordCallSites(src: string): Record<string, number> {
  const sf = ts.createSourceFile('claims.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: Record<string, number> = {}
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue
    const name = stmt.name.text
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'recordClaimClosure') out[name] = (out[name] ?? 0) + 1
      ts.forEachChild(n, visit)
    }
    visit(stmt.body)
  }
  return out
}
/** W6 fixer (J-C23): every `recordClaimClosure(` call that passes a SECOND argument (the noNoticeSource option), by top-level function. */
function recordCallsWithOptions(src: string): Record<string, number> {
  const sf = ts.createSourceFile('claims.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: Record<string, number> = {}
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue
    const name = stmt.name.text
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'recordClaimClosure' && n.arguments.length >= 2) out[name] = (out[name] ?? 0) + 1
      ts.forEachChild(n, visit)
    }
    visit(stmt.body)
  }
  return out
}
/** recordClaimClosure referenced inside any $transaction callback of the file. */
function recordInsideTransaction(src: string): number {
  const sf = ts.createSourceFile('claims.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let hits = 0
  const visit = (n: ts.Node, inTx: boolean): void => {
    let tx = inTx
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === '$transaction') {
      const cb = n.arguments[0]
      if (cb) ts.forEachChild(cb, (c) => visit(c, true))
      n.arguments.slice(1).forEach((a) => visit(a, inTx))
      visit(n.expression, inTx)
      return
    }
    if (tx && ts.isIdentifier(n) && n.text === 'recordClaimClosure') hits++
    ts.forEachChild(n, (c) => visit(c, tx))
  }
  visit(sf, false)
  return hits
}
/** Writers, senders and deleters of the record trigger outside recordClaimClosure. */
function recordTriggerViolations(files: Record<string, string>): string[] {
  const out: string[] = []
  const mentions = /CLOSURE_RECORD_TRIGGER|'claim_closure_record'|"claim_closure_record"/
  for (const [f, raw] of Object.entries(files)) {
    const code = strip(raw)
    for (const m of Array.from(code.matchAll(/\b(emailDispatch\.(create|createMany|upsert|update|updateMany|delete|deleteMany)|sendTransactional|sendOnce)\s*\(/g))) {
      const call = code.slice(m.index ?? 0, (m.index ?? 0) + 240)
      if (!mentions.test(call)) continue
      const isTheWriter = f === 'lib/claims.ts' && m[2] === 'create'
        && code.lastIndexOf('async function recordClaimClosure(', m.index ?? 0) > code.lastIndexOf('\n}\n', m.index ?? 0)
      if (!isTheWriter) out.push(`${f}: ${m[1]} with the closure record trigger`)
    }
  }
  return out.sort()
}
const sourceTree = () => Object.fromEntries(['lib', 'app', 'scripts', 'components'].flatMap(walk).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f)).map((f) => [f, read(f)]))

describe('J-C23 — the closure record: single writer, exact sites, never in a transaction (static)', () => {
  it('recordClaimClosure is called at exactly the seven H05 sites', () => {
    expect(recordCallSites(read('lib/claims.ts'))).toEqual({
      triggerClaimRefund: 1,       // (1) T4 'ours' → refunded
      arbitrateClaim: 1,           // (6) refuse_final
      reconcileClaimForRefund: 1,  // (2) its refunded CAS (noNoticeSource unless the caller records)
      resolveStuckClaim: 1,        // (7) every declaration
      applyRowTruth: 2,            // (3) row_terminal succeeded, at_stripe succeeded
      bindingNotObserved: 1,       // (5) the C7 re-read branch
      attributeWithEvidence: 1,    // (4) after the observed commit
    })
  })

  it('W6 fixer — the ONLY recordClaimClosure call with an options argument (noNoticeSource) is the one inside reconcileClaimForRefund', () => {
    expect(recordCallsWithOptions(read('lib/claims.ts'))).toEqual({ reconcileClaimForRefund: 1 })
  })

  it('NEGATIVE CONTROL — a synthetic noNoticeSource at another site is counted under that site', () => {
    const synthetic = [
      'async function reconcileClaimForRefund() { await recordClaimClosure(id, { noNoticeSource: true }) }',
      'async function triggerClaimRefund() { await recordClaimClosure(id, { noNoticeSource: true }) }',
      'async function resolveStuckClaim() { await recordClaimClosure(id) }',
    ].join('\n')
    expect(recordCallsWithOptions(synthetic)).toEqual({ reconcileClaimForRefund: 1, triggerClaimRefund: 1 })
  })

  it('none inside a $transaction callback; none in the Stripe webhook route', () => {
    expect(recordInsideTransaction(read('lib/claims.ts'))).toBe(0)
    const wh = strip(read('app/api/webhooks/stripe/route.ts'))
    expect(wh).not.toMatch(/recordClaimClosure|emailDispatch|claim_closure_record/)
  })

  it('the record trigger is written only by recordClaimClosure, never sent and never deleted, anywhere in lib/, app/, scripts/, components/', () => {
    expect(recordTriggerViolations(sourceTree())).toEqual([])
  })

  it('NEGATIVE CONTROL — a synthetic emailDispatch.create of the record trigger in app/x.ts is flagged; a synthetic call inside a transaction is counted', () => {
    expect(recordTriggerViolations({ 'app/x.ts': "await prisma.emailDispatch.create({ data: { trigger: 'claim_closure_record', dedupeKey: 'claim:x' } })" }))
      .toEqual(['app/x.ts: emailDispatch.create with the closure record trigger'])
    expect(recordInsideTransaction('async function f() { await db.$transaction(async (tx) => { await recordClaimClosure(x) }) }')).toBe(1)
  })

  it('no deploy-epoch constant anywhere; no eligibility code reads AdminAuditLog', () => {
    const tree = sourceTree()
    expect(Object.entries(tree).filter(([, s]) => /NOTICE_EPOCH|DEPLOY_EPOCH|noticeEpoch/.test(s)).map(([f]) => f)).toEqual([])
    for (const f of ['lib/claim-emails.ts', 'app/api/admin/claims/[id]/closure-notice/route.ts']) expect(strip(read(f)), f).not.toMatch(/adminAuditLog/i)
  })
})

// ══ J-C23 — behaviour at the sites this slice wires, and the record's failure modes ════════════════
describe('J-C23 — each site records only after its CAS matched one row', () => {
  it('(1) triggerClaimRefund: the T4 ours CAS won → one record; the T4 CAS lost → no record', async () => {
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'refunded', refundId: 'rf_new', amountCents: 500 })
    expect(records()).toEqual(['claim:cl1'])
    // W6 fixer: site 1 records WITHOUT noNoticeSource — the arbitrate route sends the decision e-mail itself.
    expect(errLines().filter((l) => l.includes(DECISION_MISS))).toEqual([])

    st.dispatch = []
    setWorld(payableWorld())
    w.beforeClaimWrite = (_n, { data }) => { if (data.status === 'refunded') claimOf(w).refundError = 'réécrite entre-temps' }
    const lost = await triggerClaimRefund('cl1')
    expect(lost).toMatchObject({ state: 'failed', error: 'attempt_superseded' })
    expect(records()).toEqual([])
  })

  it('(6) arbitrateClaim refuse_final: CAS won → one record; lost → 409, no record', async () => {
    setWorld(payableWorld({ status: 'arbitration', arbitrationDecision: null, restaurantResponse: 'refused', activeOrderKey: 'o1' }))
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'adm', decision: 'refuse_final', reason: 'x' })
    expect(r.ok).toBe(true)
    expect(records()).toEqual(['claim:cl1'])
    expect(errLines().filter((l) => l.includes(DECISION_MISS))).toEqual([])

    st.dispatch = []
    setWorld(payableWorld({ status: 'arbitration', arbitrationDecision: null, restaurantResponse: 'refused', activeOrderKey: 'o1' }))
    w.beforeClaimWrite = () => { claimOf(w).status = 'refused_final' }
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'adm', decision: 'refuse_final' })).toMatchObject({ ok: false, status: 409 })
    expect(records()).toEqual([])
  })

  const e06 = (refundError: string | null = REVERTED) => {
    const next = payableWorld({ status: 'refunded', refundAttempted: true, refundId: 'rf_b', refundError, activeOrderKey: null })
    next.refunds.push(refundRow('rf_b', { status: 'succeeded', stripeRefundId: 're_b', reason: 'claim:cl1' }))
    return next
  }

  it('(7) resolveStuckClaim, both resolutions (DECLARED_AFTER_REVERT included): count 1 → one record; count 0 → no record', async () => {
    for (const resolution of ['settled_out_of_band', 'closed_no_payment'] as const) {
      st.dispatch = []
      setWorld(e06())
      errSpy.mockClear()
      expect((await resolveStuckClaim({ claimId: 'cl1', adminId: 'adm', resolution })).ok, resolution).toBe(true)
      expect(records(), resolution).toEqual(['claim:cl1'])
      // W6 fixer: site 7 records WITHOUT noNoticeSource — the resolve-stuck route attempts the closure notice itself.
      expect(errLines().filter((l) => l.includes(DECISION_MISS)), resolution).toEqual([])

      st.dispatch = []
      setWorld(e06())
      w.beforeClaimWrite = () => { claimOf(w).refundError = `${MARKERS.DECLARED_AFTER_REVERT} déclaration concurrente` }
      expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'adm', resolution }), resolution).toMatchObject({ ok: false, status: 409 })
      expect(records(), resolution).toEqual([])
    }
  })

  const bound = () => {
    const next = payableWorld({ status: 'refunding', refundAttempted: true, refundId: 'rf_x', refundError: null })
    next.refunds.push(refundRow('rf_x', { status: 'succeeded', stripeRefundId: 're_x', reason: 'claim:cl1' }))
    next.stripeRefunds.push(stripeRefund('re_x', { status: 'succeeded' }))
    return next
  }
  // ROUND 13 (slice W8, H05 site 2): the line names every path that reaches it, not only the webhook or the sweep.
  const WEBHOOK_LINE = '[EMAIL MISS] [claim_decision_refunded] claim cl1 settled on its refund row by a path that sends no customer notice'

  it('(2) reconcileClaimForRefund (webhook / recovery caller) → one record and exactly one noNoticeSource line; (3) applyRowTruth → one record and no such line', async () => {
    setWorld(bound())
    expect(await reconcileClaimForRefund({ refundRowId: 'rf_x', status: 'succeeded', stripeRefundId: 're_x' })).toMatchObject({ reconciled: true, to: 'refunded' })
    expect(records()).toEqual(['claim:cl1'])
    expect(errLines().filter((l) => l.startsWith(WEBHOOK_LINE))).toHaveLength(1)

    st.dispatch = []
    errSpy.mockClear()
    setWorld(bound())
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', evidence: 'stripe_read' })
    expect(records()).toEqual(['claim:cl1'])
    expect(errLines().filter((l) => l.startsWith('[EMAIL MISS] [claim_decision_refunded]'))).toEqual([])
  })

  it('(2) count 0 — the claim was rewritten between the binder read and the refunded CAS → no record and no noNoticeSource line', async () => {
    setWorld(bound())
    w.beforeClaimWrite = () => { claimOf(w).refundError = 'réécrite entre-temps' }
    expect(await reconcileClaimForRefund({ refundRowId: 'rf_x', status: 'succeeded', stripeRefundId: 're_x' })).toEqual({ reconciled: false, reason: 'already_final' })
    expect(records()).toEqual([])
    expect(errLines().filter((l) => l.includes(DECISION_MISS))).toEqual([])
  })

  // ER-R29 / H05, W6 fixer: the caller's opt-out is scoped to the claim the caller records itself.
  const twoBound = () => {
    const RM = "resume_mismatch: le moteur a abouti sur un remboursement (rf_x) qui n'appartient PAS à cette réclamation — montant identique, identité différente."
    const next = payableWorld({ status: 'refunding', refundAttempted: true, refundId: 'rf_x', refundError: RM })
    next.claims.push({ ...next.claims[0], id: 'cl2', refundError: null, activeOrderKey: null })
    next.refunds.push(refundRow('rf_x', { status: 'succeeded', stripeRefundId: 're_x', reason: 'claim:cl2' }))
    return next
  }

  it('(2) REGRESSION — an opt-out for claim cl1 never suppresses the record of ANOTHER claim (cl2) the reconciler settles on the same row', async () => {
    setWorld(twoBound())
    expect(await reconcileClaimForRefund({ refundRowId: 'rf_x', status: 'succeeded', stripeRefundId: 're_x', closureRecordedFor: 'cl1' }))
      .toEqual({ reconciled: true, claimId: 'cl2', from: 'refunding', to: 'refunded' })
    expect(records()).toEqual(['claim:cl2'])
    expect(errLines().filter((l) => l.includes(`${DECISION_MISS} claim cl2 `))).toHaveLength(1)
    expect(claimOf(w, 'cl1').status).toBe('refunding')
  })

  it('(2) NEGATIVE CONTROL — the opt-out for the claim actually settled writes nothing here (its caller records it)', async () => {
    setWorld(twoBound())
    expect(await reconcileClaimForRefund({ refundRowId: 'rf_x', status: 'succeeded', stripeRefundId: 're_x', closureRecordedFor: 'cl2' }))
      .toMatchObject({ reconciled: true, claimId: 'cl2' })
    expect(records()).toEqual([])
    expect(errLines().filter((l) => l.includes(DECISION_MISS))).toEqual([])
  })

  it('P2002 → silent, the caller\'s return unchanged; any other error → the [EMAIL MISS] [claim_closure_record] line, the caller\'s return unchanged', async () => {
    const run = async (fails: typeof st.recordFails) => {
      st.dispatch = []
      st.recordFails = fails
      errSpy.mockClear()
      setWorld(payableWorld())
      const r = await triggerClaimRefund('cl1')
      return { r, lines: errLines().filter((l) => l.includes('[EMAIL MISS] [claim_closure_record]')) }
    }
    const ok = await run(null)
    const dup = await run('p2002')
    const broken = await run('error')
    expect(dup.r).toEqual(ok.r)
    expect(broken.r).toEqual(ok.r)
    expect(ok.lines).toEqual([])
    expect(dup.lines).toEqual([])
    expect(broken.lines).toEqual([expect.stringContaining('[EMAIL MISS] [claim_closure_record] claim cl1 — record NOT written')])

    for (const fails of ['p2002', 'error'] as const) {
      st.dispatch = []
      st.recordFails = fails
      setWorld(e06())
      const r = await resolveStuckClaim({ claimId: 'cl1', adminId: 'adm', resolution: 'closed_no_payment' })
      expect(r.ok, fails).toBe(true)
      expect((r as { claim: Row }).claim.status, fails).toBe('refused_final')
    }
  })
})

// ══ J-C37 — at most two closure notices, in the only permitted order ═══════════════════════════════
describe('J-C37 — closure notices per claim', () => {
  const settled = (o: Row = {}) => {
    const next = payableWorld({ status: 'refunded', refundAttempted: true, refundId: 'rf_b', refundError: null, activeOrderKey: null, ...o })
    next.refunds.push(refundRow('rf_b', { status: 'succeeded', stripeRefundId: 're_b', reason: 'claim:cl1', amountCents: 300 }))
    return next
  }
  const EV = { basis: 'stripe_read' as const, amountCents: 300 }
  const prior = (...triggers: string[]) => { st.dispatch = [{ trigger: REC, dedupeKey: 'claim:cl1' }, ...triggers.map((t) => ({ trigger: t, dedupeKey: 'claim:cl1' }))] }
  const allowed = (kinds: ClosureKind[]) => kinds.map((k) => CLOSURE_TRIGGER[k])

  it('(1) the engine refunded e-mail was sent → a resend answers duplicate, nothing sent', async () => {
    setWorld(settled())
    prior('claim_decision_refunded')
    expect(await sendClaimClosureEmail({ claimId: 'cl1', evidence: EV, claimsOpen: true })).toEqual({ status: 'duplicate', kind: 'refunded' })
    expect(mail.sendMail).not.toHaveBeenCalled()
    expect(claimTriggers()).toEqual(['claim_decision_refunded'])
  })

  it('(2) engine e-mail → REVERTED (no notice) → DECLARED_AFTER_REVERT → claim_closed_by_support is the second and last notice; the record is kept (P2002 silent)', async () => {
    setWorld(settled())
    prior('claim_decision_refunded')
    claimOf(w).refundError = REVERTED
    expect(await sendClaimClosureEmail({ claimId: 'cl1', evidence: EV, claimsOpen: true })).toEqual({ status: 'not_applicable', kind: null, why: 'not_a_closure' })
    expect((await resolveStuckClaim({ claimId: 'cl1', adminId: 'adm', resolution: 'settled_out_of_band' })).ok).toBe(true)
    expect(records()).toEqual(['claim:cl1'])
    expect(errLines().filter((l) => l.includes('[claim_closure_record]'))).toEqual([])
    expect(await sendClaimClosureEmail({ claimId: 'cl1', claimsOpen: true })).toEqual({ status: 'sent', kind: 'settled_by_declaration' })
    expect(await sendClaimClosureEmail({ claimId: 'cl1', claimsOpen: true })).toEqual({ status: 'duplicate', kind: 'settled_by_declaration' })
    expect(claimTriggers()).toEqual(['claim_decision_refunded', 'claim_closed_by_support'])
    expect(claimTriggers()).toEqual(allowed(['refunded', 'settled_by_declaration']))
  })

  it('(3) refused_final e-mail → resend duplicate; (4) closed_by_declaration e-mail → resend duplicate', async () => {
    setWorld(payableWorld({ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused', refundError: null, activeOrderKey: null }))
    prior('claim_decision_refused_final')
    expect(await sendClaimClosureEmail({ claimId: 'cl1', claimsOpen: true })).toMatchObject({ status: 'duplicate', kind: 'refused_confirmed' })

    setWorld(payableWorld({ status: 'refused_final', arbitrationDecision: 'approved', refundError: 'engine_failed: x', activeOrderKey: null }))
    prior('claim_closed_by_support')
    expect(await sendClaimClosureEmail({ claimId: 'cl1', claimsOpen: true })).toEqual({ status: 'duplicate', kind: 'closed_by_declaration' })
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('(5) after a refunded notice, any further closure attempt uses CLOSURE_TRIGGER[kind] only — never claim_decision_refused_final', async () => {
    setWorld(settled())
    prior('claim_decision_refunded')
    for (let i = 0; i < 3; i++) await sendClaimClosureEmail({ claimId: 'cl1', evidence: EV, claimsOpen: true })
    const attempted = (db.emailDispatch.create.mock.calls as Array<[{ data: { trigger: string } }]>).map((c) => c[0].data.trigger)
    expect(attempted.every((t) => t === CLOSURE_TRIGGER[claimClosureKind(claimOf(w) as never) as ClosureKind])).toBe(true)
    expect(claimTriggers()).toEqual(['claim_decision_refunded'])
  })

  it('NEGATIVE CONTROL — refunded → closed_by_support without the REVERTED stage is impossible: resolveStuckClaim refuses a settled claim', async () => {
    setWorld(settled())
    prior('claim_decision_refunded')
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'adm', resolution: 'settled_out_of_band' })).toEqual({ ok: false, status: 409, error: 'Cette réclamation est déjà clôturée.' })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundError: null })
    expect(await sendClaimClosureEmail({ claimId: 'cl1', evidence: EV, claimsOpen: true })).toEqual({ status: 'duplicate', kind: 'refunded' })
    expect(claimTriggers()).toEqual(['claim_decision_refunded'])
  })
})

// ══ W6 fixer (P2) — H11 / E-16: the frozen stripeNotConfirmed toast names a W7 control ══════════════
describe('W6 fixer (P2, H11 / E-16) — stripeNotConfirmed cannot surface while claims are closed, and the W6 → W7 ordering is recorded', () => {
  // ROUND 13 (slice W8): W7 landed (4d3e442); the precheck now states the verifiable condition on the deployed build.
  const ORDER_LINE = 'AUCUN bail CLAIMS sur un environnement dont le build déployé ne contient pas le commit W7'
  const PRECHECK = 'docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md'
  /** True when some console component (comments stripped) calls the closure-notice route — the H10 control. */
  const consoleCallsClosureNotice = (files: Record<string, string>) => Object.values(files).some((s) => /closure-notice/.test(strip(s)))
  /** The ordering is violated when the control is absent AND the operator precheck does not block the lease on W7. */
  const orderingViolated = (components: Record<string, string>, precheck: string) => !consoleCallsClosureNotice(components) && !precheck.includes(ORDER_LINE)

  it('behaviour: a proven refunded closure with a record and no Stripe evidence → claims_disabled while closed; stripe_not_confirmed only once open', async () => {
    const next = payableWorld({ status: 'refunded', refundAttempted: true, refundId: 'rf_b', refundError: null, activeOrderKey: null })
    next.refunds.push(refundRow('rf_b', { status: 'succeeded', stripeRefundId: 're_b', reason: 'claim:cl1', amountCents: 300 }))
    setWorld(next)
    st.dispatch = [{ trigger: REC, dedupeKey: 'claim:cl1' }]
    expect(await sendClaimClosureEmail({ claimId: 'cl1', claimsOpen: false })).toMatchObject({ status: 'skipped', why: 'claims_disabled' })
    // NEGATIVE CONTROL: the same fixture with claims open reaches step 7 — the toast that names the W7 control.
    expect(await sendClaimClosureEmail({ claimId: 'cl1', claimsOpen: true })).toMatchObject({ status: 'skipped', why: 'stripe_not_confirmed' })
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('while no console component calls the closure-notice route, the operator precheck blocks every CLAIMS lease on W7 (H10)', () => {
    const components = Object.fromEntries(walk('components').filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, read(f)]))
    expect(orderingViolated(components, read(PRECHECK))).toBe(false)
  })

  it('NEGATIVE CONTROL — a precheck without the line and a console without the control is flagged; a console that calls the route is not', () => {
    expect(orderingViolated({ 'components/x.tsx': '// closure-notice is only named in a comment\nexport const X = 1' }, '# précheck')).toBe(true)
    expect(orderingViolated({ 'components/x.tsx': 'await fetch(`/api/admin/claims/${id}/closure-notice`, { method: "POST" })' }, '# précheck')).toBe(false)
  })
})

// ══ ER-R31 — D11's WHY NO MONEY, corrected ═════════════════════════════════════════════════════════
describe('ER-R31 — a declared resume_mismatch claim is not a binder, keeps its refundError and never settles', () => {
  it('declaration on a disowned binding → settled_by_declaration, not counted by boundToWhere, and a later settlement of the row does not touch it', async () => {
    const RM = "resume_mismatch: le moteur a abouti sur un remboursement (rf_o) qui n'appartient PAS à cette réclamation — montant identique, identité différente."
    const next = payableWorld({ status: 'refunding', refundAttempted: true, refundId: 'rf_o', refundError: RM })
    next.refunds.push(refundRow('rf_o', { status: 'succeeded', stripeRefundId: 're_o', reason: 'claim:cl9' }))
    setWorld(next)
    expect((await resolveStuckClaim({ claimId: 'cl1', adminId: 'adm', resolution: 'settled_out_of_band' })).ok).toBe(true)
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'refunded', refundId: 'rf_o', refundError: RM })
    expect(claimClosureKind(c as never)).toBe('settled_by_declaration')
    expect(customerClaimStatus(c as never, null, true)).toBe('closed_by_support')
    // Not a binder of rf_o for another claim's attribution:
    expect(matchWhere(boundToWhere('rf_o', 'cl9') as Row, c)).toBe(false)
    // …and a settlement event on rf_o never settles it (terminal, disowned).
    const before = { ...c }
    expect((await reconcileClaimForRefund({ refundRowId: 'rf_o', status: 'succeeded', stripeRefundId: 're_o' })).reconciled).toBe(false)
    expect(claimOf(w)).toEqual(before)
  })
})
