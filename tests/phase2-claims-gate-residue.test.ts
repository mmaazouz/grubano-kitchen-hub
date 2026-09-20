// tests/phase2-claims-gate-residue.test.ts — round 7 (round-6 audit, P2)
//
// The design record said the rehearsal residue was reported "on the abort paths too". It was not:
// every `return fail(...)` inside main() and the main().catch() skipped it, so an abort AFTER the
// window opened — the case where residue is most likely — printed nothing. `fail` now awaits the
// residue report whenever a DB handle exists. These tests drive the report itself through the
// exported seams and never call done() (which sets process.exitCode and schedules process.exit).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-claims-residue-root-'))
process.env.PHASE2_APP_ROOT = SANDBOX

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GATE = require('../scripts/server/phase2-claims-gate.js') as {
  reportResidue: () => Promise<void>
  claimTableReport: (total: number, byStatus: Array<{ status: string; _count: number }> | null) => { fact: string; anomaly: string | null }
  _setResidueForTests: (prisma: unknown, baseline: Set<string> | Map<string, { status: string; refundAttempted: boolean }> | null) => void
  _residueLinesForTests: () => { facts: string[]; anomalies: string[] }
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })

describe('reportResidue — the abort path has the same eyes as the happy path', () => {
  it('with a DB handle and a baseline, the report lists BY ID what the window left non-terminal', async () => {
    const before = GATE._residueLinesForTests()
    const fakePrisma = {
      claim: {
        findMany: async () => [
          { id: 'old', status: 'refunded', orderId: 'o0' },
          { id: 'new1', status: 'refunding', orderId: 'o1' },
          { id: 'new2', status: 'refunded', orderId: 'o2' },
        ],
        count: async ({ where }: { where: { status: string } }) => (where.status === 'refunding' ? 1 : 0),
      },
    }
    GATE._setResidueForTests(fakePrisma, new Set(['old']))
    await GATE.reportResidue()
    const after = GATE._residueLinesForTests()
    const facts = after.facts.slice(before.facts.length).join('\n')
    const anomalies = after.anomalies.slice(before.anomalies.length).join('\n')
    expect(facts).toContain('CLAIMS CREATED BY THIS REHEARSAL')
    expect(facts).toMatch(/new1:refunding/)
    expect(facts).toMatch(/NON-TERMINAL RESIDUE[^\n]*1 - new1:refunding/)
    expect(facts).toMatch(/POST-CLOSE MONEY STATES[^\n]*refunding 1/)
    expect(anomalies).toMatch(/1 claim\(s\) left NON-TERMINAL/)
  })

  it('without a DB handle it says NOT MEASURED — never "clean"', async () => {
    const before = GATE._residueLinesForTests()
    GATE._setResidueForTests(null, null)
    await GATE.reportResidue()
    const after = GATE._residueLinesForTests()
    const anomalies = after.anomalies.slice(before.anomalies.length).join('\n')
    expect(anomalies).toContain('NOT MEASURED')
    expect(after.facts.slice(before.facts.length).join('\n')).not.toContain('NONE')
  })

  it('a DB read failure is an anomaly, not silence', async () => {
    const before = GATE._residueLinesForTests()
    GATE._setResidueForTests({ claim: { findMany: async () => { throw new Error('ECONNREFUSED') }, count: async () => 0 } }, new Set())
    await GATE.reportResidue()
    const anomalies = GATE._residueLinesForTests().anomalies.slice(before.anomalies.length).join('\n')
    expect(anomalies).toMatch(/4 residue: .*ECONNREFUSED/)
  })

  it('SOURCE PIN — fail() awaits the report when a handle exists; the sync signal paths honestly cannot', () => {
    const src = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8')
    expect(src).toMatch(/const fail = async \(step\) => \{\s*if \(residuePrisma\) await reportResidue\(\)\s*return done\('FAIL', step\)/)
    // and the limit is stated where it applies, not papered over
    expect(src).toMatch(/SYNCHRONOUS signal \/ uncaught-exception paths still cannot/)
  })

  it('ROUND-9 (P2): an APPROVED-and-UNPAID claim left by the window is named as such — the residue nothing moves with REFUNDS closed', async () => {
    const before = GATE._residueLinesForTests()
    const fakePrisma = {
      claim: {
        findMany: async () => [
          { id: 'old', status: 'refunded', orderId: 'o0', refundAttempted: true, arbitrationDecision: null },
          { id: 'appr1', status: 'approved', orderId: 'o1', refundAttempted: false, arbitrationDecision: 'approved' },
          { id: 'rev1', status: 'restaurant_review', orderId: 'o2', refundAttempted: false, arbitrationDecision: null },
        ],
        count: async () => 0,
      },
    }
    GATE._setResidueForTests(fakePrisma, new Set(['old']))
    await GATE.reportResidue()
    const anomalies = GATE._residueLinesForTests().anomalies.slice(before.anomalies.length).join('\n')
    expect(anomalies).toMatch(/1 claim\(s\) APPROVED and UNPAID \(appr1\)/)
    expect(anomalies).toContain('FOUNDER DECISION required')
    expect(anomalies).not.toMatch(/APPROVED and UNPAID \([^)]*rev1/)
  })

  it('ROUND-13 (P2): a PRE-EXISTING claim moved during the window is reported — ids alone hid it', async () => {
    const before = GATE._residueLinesForTests()
    const fakePrisma = {
      claim: {
        findMany: async () => [
          { id: 'old_refused', status: 'approved', orderId: 'o0', refundAttempted: false, arbitrationDecision: 'approved' },
          { id: 'old_done', status: 'refunded', orderId: 'o1', refundAttempted: true, arbitrationDecision: null },
        ],
        count: async () => 0,
      },
    }
    GATE._setResidueForTests(fakePrisma, new Map([
      ['old_refused', { status: 'refused', refundAttempted: false }],
      ['old_done', { status: 'refunded', refundAttempted: true }],
    ]))
    await GATE.reportResidue()
    const after = GATE._residueLinesForTests()
    const facts = after.facts.slice(before.facts.length).join('\n')
    const anomalies = after.anomalies.slice(before.anomalies.length).join('\n')
    expect(facts).toMatch(/PRE-EXISTING CLAIMS CHANGED DURING THIS REHEARSAL[^\n]*old_refused:refused→approved/)
    expect(facts).not.toMatch(/old_done:/)
    expect(anomalies).toMatch(/1 PRE-EXISTING claim\(s\) moved to a NON-TERMINAL state/)
    expect(anomalies).toMatch(/APPROVED and UNPAID \(old_refused\)/)
    expect(anomalies).not.toMatch(/changes to PRE-EXISTING claims are NOT MEASURED/)
  })

  it('ROUND-13 (P2): a snapshot without statuses says the pre-existing changes are NOT MEASURED', async () => {
    const before = GATE._residueLinesForTests()
    GATE._setResidueForTests({ claim: { findMany: async () => [], count: async () => 0 } }, new Set(['x']))
    await GATE.reportResidue()
    expect(GATE._residueLinesForTests().anomalies.slice(before.anomalies.length).join('\n')).toMatch(/changes to PRE-EXISTING claims are NOT MEASURED/)
  })

  it('ROUND-13 (P3): the claim-table precheck line says NOT MEASURED and raises an anomaly when groupBy failed', () => {
    expect(GATE.claimTableReport(7, null)).toEqual({
      fact: 'reachable · 7 row(s) · byStatus NOT MEASURED (groupBy failed)',
      anomaly: '2 db: claim groupBy failed — the per-status population is NOT MEASURED',
    })
    expect(GATE.claimTableReport(0, [])).toEqual({ fact: 'reachable · 0 row(s) · no rows', anomaly: null })
    expect(GATE.claimTableReport(2, [{ status: 'refused', _count: 2 }]).fact).toBe('reachable · 2 row(s) · refused:2')
    const src = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain('const tableReport = claimTableReport(total, byStatus)')
    expect(src).toContain('if (tableReport.anomaly) A(tableReport.anomaly)')
    // …and an anomaly refuses the window.
    expect(src).toContain("if (anomalies.length) return fail('3 window: precheck anomalies — window REFUSED, nothing changed')")
  })
})

// ROUND 13 (J-C35 / I-07, slice W5): the census lines of the precheck. The full fixture and the route parity are in
// tests/claims-t49-round13-census.test.ts; here the printer's channel is pinned on the script's own report arrays.
describe('I-07 — census lines never enter the anomalies array', () => {
  const G = GATE as unknown as {
    reportCensus: (c: Record<string, number | null>) => void
    _residueLinesForTests: () => { facts: string[]; anomalies: string[]; census: string[] }
  }
  const ZERO = {
    legacyPayableProofs: 0, refundedBoundToFailedRow: 0, refundedRowUnproven: 0, ownRowResumeMismatchNonTerminal: 0, ownRowResumeMismatchTerminal: 0,
    terminalDeclarationWithArbitrationReason: 0, refundedAfterContradictionAttribution: 0, refundedBoundToOtherClaimStamp: 0, rowsBoundToMultipleClaims: 0,
    pendingRowsOver20hWithSettledRoyalty: 0, approvedUnpaid: 0, closureMissing: 0, closureTerminalWithoutRecord: 0,
    // MODE B commit B: les lignes LIBEREES sont recensees comme toute autre population.
    voidedRefundRows: 0,
  }

  it('a non-zero count and a NOT MEASURED count each print one « CENSUS » line; RESULT inputs (anomalies) are identical to the all-zero run', () => {
    const b0 = G._residueLinesForTests()
    G.reportCensus(ZERO)
    const a0 = G._residueLinesForTests()
    expect(a0.census.length).toBe(b0.census.length)
    expect(a0.anomalies).toEqual(b0.anomalies)
    G.reportCensus({ ...ZERO, approvedUnpaid: 4, rowsBoundToMultipleClaims: null })
    const a1 = G._residueLinesForTests()
    expect(a1.census.slice(a0.census.length)).toEqual([
      'CENSUS rowsBoundToMultipleClaims: NOT MEASURED',
      'CENSUS approvedUnpaid: 4 approved and unpaid claims, exits gated by CLAIMS+REFUNDS (E-10)',
    ])
    expect(a1.anomalies).toEqual(a0.anomalies)
    expect([...a1.facts, ...a1.census].join('\n')).not.toContain('ADMIN_AUDIT_ENABLED')
  })

  it('the census code adds no fetch: the two gate probes stay the only fetch calls', () => {
    const src = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8')
    expect((src.match(/\bfetch\(/g) ?? []).length).toBe(2)
  })
})
