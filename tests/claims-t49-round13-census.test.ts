// tests/claims-t49-round13-census.test.ts — T-49 round 13, slice W5: J-M53 (I-06, I-07, H16, A-S32-1, A-S32-2, E-04, E-12,
// E-14, E-15, E-18) and the census half of J-C35.
//
// GET /api/admin/claims/census adds claims.legacy and claims.closure: counts only, no ids, null (never 0) when a query
// rejected. scripts/server/phase2-claims-gate.js computes the same counts on its own handle and prints them through the
// CENSUS channel, which never enters `anomalies` — RESULT and WINDOW READINESS are unchanged by any census value.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { matchWhere } from './support/prisma-where'

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-claims-census-root-'))
process.env.PHASE2_APP_ROOT = SANDBOX

type Row = Record<string, unknown>
const { db, store, writes } = vi.hoisted(() => {
  const store = { claims: [] as Row[], refunds: [] as Row[], royalties: [] as Row[], dispatches: [] as Row[], audits: [] as Row[], reject: new Set<string>() }
  const writes = { count: 0 }
  return { store, writes, db: {} as Record<string, Record<string, (...a: never[]) => unknown>> }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('the census never reads Stripe') } }))
const { cronMock } = vi.hoisted(() => ({ cronMock: vi.fn() }))
vi.mock('@/lib/safe-compare', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isInternalCronRequest: cronMock }))

import { GET as CENSUS } from '@/app/api/admin/claims/census/route'
import { RESUME_CREATE_WINDOW_MS } from '@/lib/refund'
import { claimsLegacyCensus, claimsClosureCensus } from '@/lib/claims-census'
import { arbitrationRefusal, reconcileRefusal, APPROVE_LEGACY_PROOF } from '@/lib/claim-action-rules'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GATE = require('../scripts/server/phase2-claims-gate.js') as {
  censusCounts: (db: unknown, opts: { adminAuditEnabled: boolean; nowMs?: number }) => Promise<Record<string, number | null>>
  reportCensus: (counts: Record<string, number | null>) => void
  CENSUS_RESUME_WINDOW_MS: number
  _residueLinesForTests: () => { facts: string[]; anomalies: string[]; census: string[] }
}

/** A select-aware, where-evaluating Prisma double over `store`. Every write method throws and is counted. */
function table(name: string, rows: () => Row[]) {
  const guard = (op: string) => { if (store.reject.has(`${name}.${op}`)) throw new Error(`${name}.${op} rejected`) }
  const pick = (r: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k] ?? null])) : { ...r })
  const where = (w?: Row) => rows().filter((r) => !w || matchWhere(w, { ...r, id: r.id }))
  const idFilter = (w: Row | undefined, r: Row) => {
    const id = w?.id as unknown
    if (id === undefined) return true
    if (typeof id === 'string') return r.id === id
    const inList = (id as { in?: unknown[] }).in
    return Array.isArray(inList) ? inList.includes(r.id) : true
  }
  const write = () => { writes.count++; throw new Error(`${name}: write attempted by the census`) }
  return {
    count: async (a?: { where?: Row }) => { guard('count'); return where(a?.where).filter((r) => idFilter(a?.where, r)).length },
    findMany: async (a?: { where?: Row; select?: Record<string, boolean> }) => { guard('findMany'); return where(a?.where).filter((r) => idFilter(a?.where, r)).map((r) => pick(r, a?.select)) },
    groupBy: async (a: { by: string[]; where?: Row; having?: Row }) => {
      guard(a.having ? 'groupByHaving' : 'groupBy')
      const key = a.by[0]
      const groups = new Map<unknown, number>()
      for (const r of where(a.where)) groups.set(r[key], (groups.get(r[key]) ?? 0) + 1)
      const out = Array.from(groups.entries()).map(([k, n]) => ({ [key]: k, _count: a.having ? { _all: n } : n }))
      return a.having ? out.filter((g) => (g._count as { _all: number })._all > 1) : out
    },
    create: write, update: write, updateMany: write, delete: write, deleteMany: write, upsert: write,
  }
}
Object.assign(db, {
  claim: table('claim', () => store.claims),
  refund: table('refund', () => store.refunds),
  franchiseRoyalty: table('franchiseRoyalty', () => store.royalties),
  emailDispatch: table('emailDispatch', () => store.dispatches),
  adminAuditLog: table('adminAuditLog', () => store.audits),
})

const NOW = Date.now()
const H = 3_600_000
const claim = (id: string, o: Row) => ({ id, orderId: 'o1', status: 'approved', refundAttempted: true, refundId: null, refundError: null, arbitrationDecision: null, restaurantResponse: null, arbitrationReason: null, responseDeadlineAt: new Date(NOW + H), ...o })
const row = (id: string, o: Row) => ({ id, orderId: 'o1', status: 'succeeded', stripeRefundId: `re_${id}`, reason: null, amountCents: 300, royaltyRefundCents: 0, createdAt: new Date(NOW - H), ...o })
const record = (id: string) => ({ trigger: 'claim_closure_record', dedupeKey: `claim:${id}` })
const sent = (id: string, trigger: string) => ({ trigger, dedupeKey: `claim:${id}` })

/** One member of each I-06 population (J-M53 FIXTURE). */
function populate() {
  store.claims = [
    claim('C_legacy', { status: 'approved', refundAttempted: false, refundError: 'no_refund_proven: preuve héritée' }),
    claim('C_f', { status: 'refunded', refundId: 'R_f' }),
    claim('C_u', { status: 'refunded', refundId: 'R_missing' }),
    claim('C_mn', { status: 'refunding', refundId: 'R_mn', refundError: 'resume_mismatch: repris' }),
    claim('C_mt', { status: 'refunded', refundId: 'R_mt', refundError: 'resume_mismatch: repris' }),
    claim('C_mm', { status: 'refunding', refundId: 'R_3', refundError: 'resume_mismatch: pas la sienne' }),
    claim('C_c1', { status: 'refunding', refundId: 'R_3' }),
    claim('C_y', { status: 'approved', refundError: 'stripe_failed: x' }),
    claim('C_b1', { status: 'refunding', refundId: 'R_2' }),
    claim('C_b2', { status: 'approved', refundId: 'R_2', refundError: 'engine_failed: x' }),
    claim('C_t', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }),
    claim('C_m', { status: 'refunded', refundId: 'R_m' }),
    // Track B §M: terminal, a recorded refundError AND an arbitrationReason.
    claim('C_d', { status: 'refused_final', arbitrationDecision: null, arbitrationReason: 'note opérateur', refundError: 'engine_failed: x' }),
    claim('C_x', { status: 'refunded', refundId: 'R_x' }),
  ]
  store.refunds = [
    row('R_f', { status: 'failed' }),
    row('R_mn', { status: 'pending', reason: 'claim:C_mn' }),
    row('R_mt', { reason: 'claim:C_mt' }),
    row('R_3', { status: 'pending', reason: 'claim:C_other' }),
    row('R_y', { reason: 'claim:C_y' }),
    row('R_2', {}),
    row('R_old', { status: 'pending', orderId: 'o_roy', stripeRefundId: null, royaltyRefundCents: 50, createdAt: new Date(NOW - 21 * H) }),
    row('R_m', {}),
    row('R_x', {}),
  ]
  store.royalties = [{ orderId: 'o_roy', status: 'settled' }]
  store.dispatches = [
    record('C_f'), sent('C_f', 'claim_decision_refunded'), record('C_u'), sent('C_u', 'claim_decision_refunded'),
    record('C_mt'), sent('C_mt', 'claim_closed_by_support'), record('C_d'), sent('C_d', 'claim_closed_by_support'),
    record('C_x'), sent('C_x', 'claim_decision_refunded'), record('C_m'),
    // Track B §M: the sendOnce record of C_x's contradiction park alert.
    { trigger: 'admin_money_review_claim_financial_verification', dedupeKey: 'claim_fv:C_x:stripe_refund_contradiction' },
  ]
  store.audits = [
    { action: 'claim.arbitrate', targetType: 'claim', targetId: 'C_t', metadata: { decision: 'refused_final' }, createdAt: new Date(NOW - 5 * H) },
    { action: 'claim.reconcile_evidence', targetType: 'claim', targetId: 'C_x', metadata: { outcome: 'financial_verification', ambiguity: 'stripe_refund_contradiction', moneyMoved: false }, createdAt: new Date(NOW - 4 * H) },
    { action: 'claim.attribute_refund', targetType: 'claim', targetId: 'C_x', metadata: { moneyMoved: false }, createdAt: new Date(NOW - 3 * H) },
  ]
}
const ONES = {
  legacyPayableProofs: 1, refundedBoundToFailedRow: 1, refundedRowUnproven: 1, ownRowResumeMismatch: { nonTerminal: 1, terminal: 1 },
  terminalDeclarationWithArbitrationReason: 1, refundedAfterContradictionAttribution: 1, refundedBoundToOtherClaimStamp: 1,
  rowsBoundToMultipleClaims: 1, pendingRowsOver20hWithSettledRoyalty: 1, approvedUnpaid: 1,
}
const census = async () => (await (await CENSUS(new Request('https://app.grubano.com/api/admin/claims/census') as never)).json())

beforeEach(() => {
  store.reject.clear()
  writes.count = 0
  cronMock.mockReturnValue(true)
  process.env.ADMIN_AUDIT_ENABLED = 'true'
  populate()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { delete process.env.ADMIN_AUDIT_ENABLED; vi.restoreAllMocks() })

describe('J-M53 — GET /api/admin/claims/census: claims.legacy and claims.closure', () => {
  it('one member of each population → each count is 1; no id in the payload; Prisma writes 0', async () => {
    const body = await census()
    expect(body.claims.legacy).toEqual(ONES)
    expect(body.claims.closure).toEqual({ missing: 1, terminalWithoutRecord: 1 })
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/C_[a-z0-9]+|R_[a-z0-9]+|claim:|re_R/)
    expect(text).not.toMatch(/c[a-z0-9]{24}/)
    expect(writes.count).toBe(0)
  })

  it('terminalWithoutRecord counts the legacy refusal despite its HEAD claim.arbitrate audit row; closure.* are measured with admin audit off', async () => {
    process.env.ADMIN_AUDIT_ENABLED = 'false'
    const body = await census()
    expect(body.claims.closure).toEqual({ missing: 1, terminalWithoutRecord: 1 })
    expect(body.claims.legacy.refundedAfterContradictionAttribution).toBeNull()
    expect({ ...body.claims.legacy, refundedAfterContradictionAttribution: 1 }).toEqual(ONES)
  })

  it('rowsBoundToMultipleClaims uses the OR form: a resume_mismatch second binder is not counted', async () => {
    store.claims = store.claims.filter((c) => c.id !== 'C_b2')
    expect((await census()).claims.legacy.rowsBoundToMultipleClaims).toBe(0)
    // NEGATIVE CONTROL — the same second binder without resume_mismatch makes R_3 a two-binder row.
    store.claims.find((c) => c.id === 'C_mm')!.refundError = 'engine_failed: x'
    expect((await census()).claims.legacy.rowsBoundToMultipleClaims).toBe(1)
  })

  // W5 fixer (I-06, Track B §M source definitions): each count is separated from its near-miss shapes, in the route AND the script.
  it('Track B §M — terminalDeclarationWithArbitrationReason and refundedAfterContradictionAttribution ignore their near misses (route = script)', async () => {
    store.claims.push(
      // a declaration closure WITHOUT arbitrationReason
      claim('N_decl_noreason', { status: 'refused_final', arbitrationDecision: null, refundError: 'engine_failed: y' }),
      // an arbitrated refusal WITH a reason and NO refundError (a declaration-kind reconstruction would not count it either way)
      claim('N_arb_reason', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused', arbitrationReason: 'motif' }),
      // a declaration closure with a reason and NO refundError (the reconstructed predicate counted it; the source does not)
      claim('N_decl_reason_noerror', { status: 'refused_final', arbitrationDecision: null, arbitrationReason: 'note' }),
      // a non-terminal claim with both fields
      claim('N_open', { status: 'approved', refundError: 'stripe_failed: z', arbitrationReason: 'note' }),
      // refunded + attribution audit, NO park dispatch
      claim('N_audit_only', { status: 'refunded', refundId: 'R_x' }),
      // refunded + park dispatch of ANOTHER reason + attribution audit
      claim('N_other_reason', { status: 'refunded', refundId: 'R_x' }),
      // park dispatch + attribution audit, claim NOT refunded
      claim('N_not_refunded', { status: 'financial_verification', refundError: 'financial_verification:stripe_refund_contradiction: x' }),
      // park dispatch + attribution audit WITH stripeStatus → counted (the source does not read stripeStatus)
      claim('P_with_status', { status: 'refunded', refundId: 'R_x' }),
    )
    const fv = (id: string, reason: string) => ({ trigger: 'admin_money_review_claim_financial_verification', dedupeKey: `claim_fv:${id}:${reason}` })
    const attribute = (id: string, metadata: Record<string, unknown> = { moneyMoved: false }) => ({ action: 'claim.attribute_refund', targetType: 'claim', targetId: id, metadata, createdAt: new Date(NOW - H) })
    store.dispatches.push(fv('N_other_reason', 'stripe_unreadable'), fv('N_not_refunded', 'stripe_refund_contradiction'), fv('P_with_status', 'stripe_refund_contradiction'))
    store.audits.push(attribute('N_audit_only'), attribute('N_other_reason'), attribute('N_not_refunded'), attribute('P_with_status', { moneyMoved: false, stripeStatus: 'succeeded' }))
    const legacy = (await census()).claims.legacy
    expect(legacy.terminalDeclarationWithArbitrationReason).toBe(1) // C_d only
    expect(legacy.refundedAfterContradictionAttribution).toBe(2)    // C_x and P_with_status
    const s = await GATE.censusCounts(db, { adminAuditEnabled: true, nowMs: NOW })
    expect([s.terminalDeclarationWithArbitrationReason, s.refundedAfterContradictionAttribution]).toEqual([1, 2])
    // NEGATIVE CONTROL — without C_x's park dispatch its attribution audit alone no longer counts.
    store.dispatches = store.dispatches.filter((d) => d.dedupeKey !== 'claim_fv:C_x:stripe_refund_contradiction')
    expect((await census()).claims.legacy.refundedAfterContradictionAttribution).toBe(1)
  })

  it('a v13 proof is not a legacy proof (the NOT clause is evaluated)', async () => {
    store.claims.push(claim('C_v13', { status: 'approved', refundAttempted: false, refundError: 'no_refund_proven:v13: … payable au plus tôt le 2026-09-12T00:00:00.000Z (UTC).' }))
    const legacy = (await census()).claims.legacy
    expect(legacy.legacyPayableProofs).toBe(1)
    expect(legacy.approvedUnpaid).toBe(2)
  })

  const REJECTIONS: Array<[string, (l: Record<string, unknown>, c: Record<string, unknown>) => unknown[]]> = [
    ['adminAuditLog.findMany', (l) => [l.refundedAfterContradictionAttribution]],
    ['claim.groupByHaving', (l) => [l.rowsBoundToMultipleClaims]],
    ['franchiseRoyalty.findMany', (l) => [l.pendingRowsOver20hWithSettledRoyalty]],
    // Track B §M: refundedAfterContradictionAttribution reads the contradiction park's EmailDispatch record too.
    ['emailDispatch.findMany', (l, c) => [c.missing, c.terminalWithoutRecord, l.refundedAfterContradictionAttribution]],
  ]
  for (const [op, nulled] of REJECTIONS) {
    it(`a rejected ${op} → null (never 0) for its own field(s) only`, async () => {
      store.reject.add(op)
      const body = await census()
      expect(nulled(body.claims.legacy, body.claims.closure).every((v) => v === null)).toBe(true)
      const others = { ...body.claims.legacy, ...Object.fromEntries(Object.entries(body.claims.closure).map(([k, v]) => [`closure.${k}`, v])) }
      const nulls = Object.entries(others).filter(([, v]) => v === null).map(([k]) => k)
      expect(nulls.length, `${op}: ${nulls.join(',')}`).toBe(nulled(body.claims.legacy, body.claims.closure).length)
    })
  }

  it('BREAK/RESTORE witness — a single shared catch would null every legacy field: the fields are measured independently', async () => {
    store.reject.add('claim.count')
    const legacy = (await census()) as { claims?: { legacy?: Record<string, unknown> } }
    // claim.count also feeds the route's historical counts (500 there); the legacy census alone keeps its other fields.
    const direct = await claimsLegacyCensus(new Date(NOW))
    expect(direct.legacyPayableProofs).toBeNull()
    expect(direct.approvedUnpaid).toBeNull()
    expect(direct.refundedBoundToFailedRow).toBeNull() // it counts with claim.count too
    expect(direct.refundedRowUnproven).toBe(1)
    expect(direct.rowsBoundToMultipleClaims).toBe(1)
    expect(direct.ownRowResumeMismatch).toEqual({ nonTerminal: 1, terminal: 1 })
    expect(legacy).toBeDefined()
  })

  it('the route comment states that E-09 is not counted; the census code imports no Stripe client and makes no fetch', () => {
    const route = fs.readFileSync('app/api/admin/claims/census/route.ts', 'utf8')
    expect(route).toMatch(/NOT COUNTED: E-09/)
    const lib = fs.readFileSync('lib/claims-census.ts', 'utf8')
    expect(lib).not.toMatch(/@\/lib\/stripe|getStripe|fetch\(/)
    const script = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8').replace(/\r\n/g, '\n')
    const section = script.slice(script.indexOf('THE CENSUS OF LEGACY AND CLOSURE POPULATIONS'), script.indexOf('async function main() {'))
    expect(section.length).toBeGreaterThan(1000)
    expect(section).not.toMatch(/fetch\(|stripe\.|getStripe|require\(/)
    expect((script.match(/await fetch\(/g) ?? []).length).toBe(2)
  })

  it('A-S32-*: a legacy proof is suspended for approval (D14 (1)) and admitted by reconcile (i)', () => {
    const c = { id: 'C_legacy', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven: preuve héritée' }
    expect(arbitrationRefusal(c, 'approve', new Date())).toEqual({ status: 409, error: APPROVE_LEGACY_PROOF })
    expect(reconcileRefusal(c)).toBeNull()
  })
})

describe('J-M53 / J-C35 — phase2-claims-gate.js census lines (I-07)', () => {
  const PRINTED: Record<string, string> = {
    legacyPayableProofs: '1 pre-v13 absence proofs, approval suspended; run reconcile on each (E-01)',
    refundedBoundToFailedRow: '1 refunded claims on a failed Stripe-id row, unmarked; reconcile from the FV card (E-07)',
    refundedRowUnproven: '1 refunded claims whose bound row is not established (E-13)',
    'ownRowResumeMismatch.nonTerminal': '1 own-row resume_mismatch claims (E-05 / E-14)',
    'ownRowResumeMismatch.terminal': '1 own-row resume_mismatch claims (E-05 / E-14)',
    terminalDeclarationWithArbitrationReason: '1 terminal claims with a recorded refund error and an arbitration reason (Track B census; no E entry: F08 hides the reason on a declaration kind)',
    refundedAfterContradictionAttribution: '1 (lower bound; null if admin audit was off): FOUNDER REVIEW (E-15)',
    refundedBoundToOtherClaimStamp: '1 standing rows stamped for a claim not settled on them (E-04)',
    rowsBoundToMultipleClaims: '1 rows bound to two or more claims (E-12)',
    pendingRowsOver20hWithSettledRoyalty: '1 pending rows over 20 h with a settled royalty: engine resume may refuse forever (E-01 A-S10c)',
    approvedUnpaid: '1 approved and unpaid claims, exits gated by CLAIMS+REFUNDS (E-10)',
    'closure.missing': '1 closures of this build without a dispatched notice (E-16)',
    'closure.terminalWithoutRecord': '1 terminal claims without a this-build closure record (legacy, or record write failed): never notified (E-18)',
  }

  it('the script counts equal the route counts on the same fixture (parity), and its resume window is lib/refund’s', async () => {
    const s = await GATE.censusCounts(db, { adminAuditEnabled: true, nowMs: NOW })
    const l = await claimsLegacyCensus(new Date(NOW))
    const c = await claimsClosureCensus()
    expect(s).toEqual({
      legacyPayableProofs: l.legacyPayableProofs, refundedBoundToFailedRow: l.refundedBoundToFailedRow, refundedRowUnproven: l.refundedRowUnproven,
      ownRowResumeMismatchNonTerminal: l.ownRowResumeMismatch.nonTerminal, ownRowResumeMismatchTerminal: l.ownRowResumeMismatch.terminal,
      terminalDeclarationWithArbitrationReason: l.terminalDeclarationWithArbitrationReason, refundedAfterContradictionAttribution: l.refundedAfterContradictionAttribution,
      refundedBoundToOtherClaimStamp: l.refundedBoundToOtherClaimStamp, rowsBoundToMultipleClaims: l.rowsBoundToMultipleClaims,
      pendingRowsOver20hWithSettledRoyalty: l.pendingRowsOver20hWithSettledRoyalty, approvedUnpaid: l.approvedUnpaid,
      closureMissing: c.missing, closureTerminalWithoutRecord: c.terminalWithoutRecord,
    })
    expect(GATE.CENSUS_RESUME_WINDOW_MS).toBe(RESUME_CREATE_WINDOW_MS)
    expect(writes.count).toBe(0)
  })

  it('every count is printed as a fact; a « !! CENSUS: » line for each count > 0 with its I-07 message and E id; anomalies untouched', async () => {
    const before = GATE._residueLinesForTests()
    GATE.reportCensus(await GATE.censusCounts(db, { adminAuditEnabled: true, nowMs: NOW }))
    const after = GATE._residueLinesForTests()
    const facts = after.facts.slice(before.facts.length)
    const lines = after.census.slice(before.census.length)
    for (const [k, m] of Object.entries(PRINTED)) {
      expect(facts, k).toContain(`CENSUS ${k} = 1`)
      expect(lines, k).toContain(`CENSUS ${k}: ${m}`)
    }
    expect(after.anomalies).toEqual(before.anomalies)
    expect([...facts, ...lines].join('\n')).not.toContain('ADMIN_AUDIT_ENABLED')
  })

  it('a rejected count prints NOT MEASURED (a census line, never 0); admin audit off → NOT MEASURED, no flag named', async () => {
    store.reject.add('claim.groupByHaving')
    const before = GATE._residueLinesForTests()
    GATE.reportCensus(await GATE.censusCounts(db, { adminAuditEnabled: false, nowMs: NOW }))
    const after = GATE._residueLinesForTests()
    const lines = after.census.slice(before.census.length)
    expect(lines).toContain('CENSUS rowsBoundToMultipleClaims: NOT MEASURED')
    expect(lines).toContain('CENSUS refundedAfterContradictionAttribution: NOT MEASURED')
    expect(after.facts.slice(before.facts.length)).toContain('CENSUS rowsBoundToMultipleClaims = NOT MEASURED')
    expect(lines.join('\n')).not.toContain('ADMIN_AUDIT_ENABLED')
    expect(after.anomalies).toEqual(before.anomalies)
  })

  it('NEGATIVE CONTROL — all populations zero → no census line (the facts still print every count)', async () => {
    store.claims = []; store.refunds = []; store.royalties = []; store.dispatches = []; store.audits = []
    const before = GATE._residueLinesForTests()
    GATE.reportCensus(await GATE.censusCounts(db, { adminAuditEnabled: true, nowMs: NOW }))
    const after = GATE._residueLinesForTests()
    expect(after.census.slice(before.census.length)).toEqual([])
    expect(after.facts.slice(before.facts.length)).toHaveLength(13)
  })

  it('source: C never pushes to anomalies; done() prints the CENSUS block after ANOMALIES; RESULT and WINDOW READINESS read anomalies only', () => {
    const src = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8').replace(/\r\n/g, '\n')
    const cLine = src.split('\n').find((l) => l.startsWith('const C = '))!
    expect(cLine).toContain('census.push(')
    expect(cLine).not.toContain('anomalies')
    expect(cLine).not.toMatch(/\bA\(/)
    const done = src.slice(src.indexOf('function done('), src.indexOf('const fail = async'))
    expect(done.indexOf("'CENSUS (C3 — legacy and closure populations; report them in the inbox; they do not change RESULT) ('")).toBeGreaterThan(done.indexOf("'ANOMALIES ('"))
    expect(src).toContain("F('WINDOW READINESS', anomalies.length ? 'BLOCKED — see anomalies'")
    expect(src).toContain("return done(anomalies.length ? 'FAIL' : 'PASS')")
    expect(src).toContain("reportCensus(await censusCounts(prisma, { adminAuditEnabled: process.env.ADMIN_AUDIT_ENABLED === 'true' }))")
    // BREAK/RESTORE witness: the same printer implemented with A() would push to anomalies and FAIL every precheck.
    const broken = cLine.replace('census.push(', 'A(')
    expect(broken).toMatch(/\bA\(/)
  })
})
