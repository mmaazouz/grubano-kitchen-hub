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
  _setResidueForTests: (prisma: unknown, baseline: Set<string> | null) => void
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
})
