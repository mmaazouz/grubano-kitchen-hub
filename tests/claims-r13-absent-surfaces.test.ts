// tests/claims-r13-absent-surfaces.test.ts — T-49 round 13, slice W5: J-M54 (I-10, I-02, I-03, I-04, I-05 sender sites).
//
// No scheduled job and no infra change: the workflow files equal their pinned hashes (40da45e, plus the one D′ L5 copy
// line in deploy-staging.yml), no cron path exists under app/api/cron, the cron routes gain no alert helper or
// claim-marking import, and every claim alert is sent from the request or webhook that performs the write.
// (J-M41, the D13 absent-exit scan, belongs to another slice.)
// IMPLEMENTATION NOTE (W5) on J-M54 / ER-C23: app/api/cron does not exist; the cron routes are the ones
// .github/workflows/cron.yml calls, read from that file, plus the auto-approve route the rule names.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, '/')
  return statSync(p).isDirectory() ? walk(p) : [p]
})

/**
 * sha256 of each workflow file, CRLF normalized (git show <sha>:<file> | tr -d '\r' | sha256sum): 40da45e for every
 * file but deploy-staging.yml, which D′ L5 moved — see the note beside its pin.
 */
const WORKFLOWS_40DA45E: Record<string, string> = {
  '.github/workflows/claims-census.yml':        'f55626c91a4dc332a60284d9f3aee36f064ed44def7c71b4cbb89470a674c2b9',
  /* B2 — cron.yml MOVED on an explicit founder arbitration (2026-09-29): « je veux la même doctrine que T-123 :
     refus explicite, pas simple surveillance ». The guard job used to require only that vars.CRON_TARGET_BASE_URL be
     NON-EMPTY, so the protection was a CONFIGURATION rather than a CONSTRAINT — one mistaken edit would have aimed
     the e-mail catch-up and the onboarding nudges at production on the next 20-minute tick. The decision now lives
     once, in scripts/cron/cron-target-guard.js, which refuses anything not positively staging and reaches production
     only through an exact attestation sentence. The guard job gained a checkout and one `node` call; no schedule
     (the three cadences are pinned by tests/cron-target-guard.test.ts), no job, no workflow file, no secret, and
     nothing new RUNS anywhere — so what this pin protects is intact.
     THE SAME PIN EXISTS IN tests/claims-closure-imports.test.ts (which also covers scripts/cron). Two copies of one
     control is the T-108 shape: whoever moves one must move the other, and this sentence is here so they find it. */
  '.github/workflows/cron.yml':                 '08d6de07c4add9d3f81dc13e64757d3f7f17919094c2c821b9293360bd7f9a87',
  /* PROD-2 (2026-09-29) — deploy-production.yml MOVED, deliberately and on the founder's GO-TO-PRODUCTION decision. Production had never run and was NOT the proven staging pipeline: it lacked the three FTP exclusions that each fix a measured sync-aborting failure, it WROTE an .htaccess it did not exclude, its only blocking gate was a curl of an auth-gated page that returns 200 from any build, and it had no SSH-independent restart. Ported from deploy-staging.yml, plus one gate staging does not have (the database must be reachable through the DEPLOYED Prisma client). deploy-staging.yml is UNCHANGED in this lot — its hash above is the same. What this pin protects is intact: nothing new RUNS against staging, and no schedule, job, workflow or secret was added. */
  '.github/workflows/deploy-production.yml':    'c37f9c7b6b164e1bb84405871e591ce2192841400111a30078c152a9a4356870',
  // D′ L5 — moved from 03912758…7813 (40da45e): the staging workflow now also copies lib/claims-payable-core.js into
  // deploy-temp/lib, because the pay-window operator must recompute the rail's selection with the SAME query the rail
  // uses (spec v2 §8.8). One `cp` line: no schedule, no new job, no new workflow file.
  '.github/workflows/deploy-staging.yml':       'ed4b9012516c52ec8cfc877958e65893340c7567ae717aed4c4a8c9f6605df84',
  '.github/workflows/internal-token-probe.yml': 'd171c534104f46fb3ac60b910bb12fcea98f3aebe61fbca556a5762e4d19db65',
  '.github/workflows/refund-rehearsal.yml':     '5d825384520defb44f6977324e92a2555b667204f1e4db35da9724ca1ca235a4',
  '.github/workflows/tests.yml':                '593120f3009bca35eac5be8556710036d2aec9644e88538333b5a44e0be26287',
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** The cron routes: every `$BASE/api/...` path cron.yml calls, plus the auto-approve sweep route. */
function cronRouteFiles(cronYml: string): string[] {
  const paths = Array.from(cronYml.matchAll(/\$BASE(\/api\/[a-z0-9/_-]+)/g)).map((m) => `app${m[1]}/route.ts`)
  return Array.from(new Set([...paths, 'app/api/admin/claims/auto-approve/route.ts'])).sort()
}
const FORBIDDEN_IN_CRON = /\b(alertClaimPaymentBlocked|markClaimsForRevertedRefundRow|enterFinancialVerification)\b|claim_payment_blocked|claim_attempt_superseded|claim_refunded_row_unfinalized/
function cronViolations(files: Record<string, string>): string[] {
  return Object.entries(files).filter(([, src]) => FORBIDDEN_IN_CRON.test(stripComments(src))).map(([f]) => f)
}
/** Files (outside tests) where the two I-01 / I-03 kinds appear. */
function kindHolders(files: Record<string, string>): string[] {
  return Object.entries(files).filter(([, src]) => /claim_payment_blocked|claim_attempt_superseded/.test(src)).map(([f]) => f).sort()
}

describe('J-M54 — no scheduled job, no infra change (I-10, R-D8)', () => {
  it('the workflow files equal their pinned hashes (40da45e, deploy-staging at its D′ L5 value), and no workflow was added', () => {
    const now = walk('.github/workflows').filter((f) => f.endsWith('.yml')).sort()
    expect(now).toEqual(Object.keys(WORKFLOWS_40DA45E).sort())
    for (const [f, h] of Object.entries(WORKFLOWS_40DA45E)) expect(sha(read(f)), f).toBe(h)
  })

  it('BREAK/RESTORE witness — a schedule line added to a copy of deploy-staging.yml changes its hash', () => {
    const src = read('.github/workflows/deploy-staging.yml')
    const broken = src.replace(/^on:\n/m, "on:\n  schedule:\n    - cron: '0 3 * * *'\n")
    expect(broken).not.toBe(src)
    expect(sha(broken)).not.toBe(WORKFLOWS_40DA45E['.github/workflows/deploy-staging.yml'])
  })

  it('no cron path exists under app/api/cron', () => {
    expect(existsSync('app/api/cron')).toBe(false)
  })

  it('the cron routes (reconcile-refunds, stale-alerts, auto-approve, …) gain no claim alert helper nor markClaimsForRevertedRefundRow', () => {
    const routes = cronRouteFiles(read('.github/workflows/cron.yml'))
    expect(routes).toEqual(expect.arrayContaining(['app/api/admin/claims/reconcile-refunds/route.ts', 'app/api/admin/claims/stale-alerts/route.ts', 'app/api/admin/claims/auto-approve/route.ts']))
    const files = Object.fromEntries(routes.map((f) => [f, read(f)]))
    expect(cronViolations(files)).toEqual([])
  })

  it('NEGATIVE CONTROL — a synthetic import of alertClaimPaymentBlocked into app/api/cron/reconcile-refunds/route.ts (in memory) is caught', () => {
    const synthetic = { 'app/api/cron/reconcile-refunds/route.ts': "import { alertClaimPaymentBlocked } from '@/lib/claims'\nexport async function POST() { await alertClaimPaymentBlocked('c', 'safety_hold', {} as never) }\n" }
    expect(cronViolations(synthetic)).toEqual(['app/api/cron/reconcile-refunds/route.ts'])
  })
})

describe('J-M54 — every claim alert is sent from the writing request (I-01 … I-05 sender sites)', () => {
  const sources = () => Object.fromEntries(['lib', 'app', 'components', 'scripts', 'messages'].flatMap(walk)
    .filter((f) => /\.(ts|tsx|js|json)$/.test(f)).map((f) => [f, read(f)]))

  it("'claim_payment_blocked' and 'claim_attempt_superseded' appear only in lib/admin-alerts.ts and lib/claims.ts (outside tests)", () => {
    expect(kindHolders(sources())).toEqual(['lib/admin-alerts.ts', 'lib/claims.ts'])
  })

  it('NEGATIVE CONTROL — a synthetic occurrence elsewhere is caught', () => {
    expect(kindHolders({ ...sources(), 'app/api/admin/claims/stale-alerts/route.ts': "kind: 'claim_payment_blocked'" })).toContain('app/api/admin/claims/stale-alerts/route.ts')
  })

  const fnBody = (src: string, head: string) => { const a = src.indexOf(head); return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a)) }
  const claims = () => stripComments(read('lib/claims.ts'))

  it('claim_financial_verification is sent only by alertFinancialVerification, itself called only from enterFinancialVerification (I-02)', () => {
    const src = claims()
    expect((src.match(/kind:\s*'claim_financial_verification'/g) ?? []).length).toBe(1)
    expect(fnBody(src, 'async function alertFinancialVerification(')).toMatch(/kind:\s*'claim_financial_verification'/)
    const callers = Array.from(src.matchAll(/\balertFinancialVerification\(/g)).map((m) => m.index ?? 0)
      .filter((i) => !src.slice(Math.max(0, i - 20), i).includes('function '))
    const enter = src.indexOf('export async function enterFinancialVerification(')
    const enterEnd = src.indexOf('\n}\n', enter)
    expect(callers.length).toBeGreaterThan(0)
    expect(callers.every((i) => i > enter && i < enterEnd)).toBe(true)
  })

  it('claim_refunded_row_unfinalized is sent only from applyRowTruth and attributeWithEvidence (I-04)', () => {
    const src = claims()
    const at = Array.from(src.matchAll(/kind:\s*'claim_refunded_row_unfinalized'/g)).map((m) => m.index ?? 0)
    const spans = ['async function applyRowTruth(', 'export async function attributeWithEvidence('].map((h) => { const a = src.indexOf(h); return [a, src.indexOf('\n}\n', a)] })
    expect(at).toHaveLength(2)
    expect(at.every((i) => spans.some(([a, b]) => i > a && i < b))).toBe(true)
    const app = walk('app').filter((f) => f.endsWith('.ts')).filter((f) => read(f).includes('claim_refunded_row_unfinalized'))
    expect(app).toEqual([])
  })

  it('the refund:<re> alert is sent only from the Stripe webhook route and the unchanged engine (I-05); claim_attempt_superseded only from triggerClaimRefund (I-03)', () => {
    // I-05: « markRefundRowFailed's refund_failed alert and the external failed-refund alert are unchanged » — lib/refund.ts
    // (byte-identical, J-M06) keeps its own refund:<re> send; no Claims module and no other route sends that key.
    const holders = Object.entries(sources()).filter(([f, s]) => !f.startsWith('messages/') && /dedupeKey:\s*`refund:\$\{/.test(s)).map(([f]) => f).sort()
    // D′ L9 (E3) — TWO BECAME FOUR, and the addition is named here so it stays a decision. `EmailDispatch` is
    // unique on the PAIR (trigger, dedupeKey), so what this pin really protects is that no second sender can
    // claim the SAME pair and silently suppress a message. The two new holders form `refund:<re_>` under
    // triggers of their own:
    //   lib/support-refund-notices  → refund_confirmation              (the CUSTOMER's notice — and the whole
    //                                 point of E3 is that exactly one of these can exist per refund)
    //   .../rows/[rowId]/notify     → admin_money_review_support_row_reverted (an ADMIN alert)
    // Neither can collide with lib/refund's own refund_failed alert or with the webhook's, which is asserted
    // below rather than assumed — a shared trigger AND a shared key would be the real defect.
    expect(holders).toEqual([
      'app/api/admin/refunds/rows/[rowId]/notify/route.ts',
      'app/api/webhooks/stripe/route.ts',
      'lib/refund.ts',
      'lib/support-refund-notices.ts',
    ])
    // The trigger each holder pairs that key with, so the four cannot converge on one pair.
    // What each holder PAIRS that key with. The notify route legitimately names BOTH triggers: it sends the
    // customer notice under `refund_confirmation` (through lib/transactional-emails) and raises its admin
    // alerts under `admin_money_review_*`, and since the adversarial review it also READS the confirmation
    // trigger back to verify its own dedupe marker landed. So the assertion is on the SET each file reaches.
    const triggersOf = (f: string) => {
      const s = sources()[f]
      const out: string[] = []
      if (/REFUND_CONFIRMATION_TRIGGER|trigger:\s*'refund_confirmation'|sendRefundConfirmation/.test(s)) out.push('refund_confirmation')
      if (/sendAdminMoneyReviewAlert/.test(s)) out.push('admin_money_review_*')
      return out.sort()
    }
    expect(triggersOf('lib/support-refund-notices.ts')).toEqual(['refund_confirmation'])
    expect(triggersOf('app/api/admin/refunds/rows/[rowId]/notify/route.ts')).toEqual(['admin_money_review_*', 'refund_confirmation'])
    expect(triggersOf('lib/refund.ts')).toEqual(['admin_money_review_*'])
    // THE PROPERTY THAT MATTERS: no two holders can claim the same (trigger, dedupeKey) pair for one refund.
    // lib/refund and the webhook only ever ALERT; only the notify path can dispatch a customer confirmation.
    expect(triggersOf('app/api/webhooks/stripe/route.ts')).toEqual(['admin_money_review_*'])
    const src = claims()
    const trigger = fnBody(src, 'export async function triggerClaimRefund(')
    expect((src.match(/kind:\s*'claim_attempt_superseded'/g) ?? []).length).toBe((trigger.match(/kind:\s*'claim_attempt_superseded'/g) ?? []).length)
  })
})

// ══ ROUND 13 (slice W7) — J-M41 (D13, E0 REMOVED): exits and surfaces that do not exist in round 13 ═══════════════════
// IMPLEMENTATION NOTE (W7) on J-M41: « no operator route re-verifies E-09 claims in bulk » and « no recovery pass 2 over refunded
// claims » are superseded by AMF-1 (D13 W5 note): POST /api/admin/claims/reconcile-refunds runs reverifySettledClaimRefunds for an
// admin session. What stays pinned is its confinement — one caller, read-only toward Stripe, never an exit.
describe('J-M41 — exits and surfaces that do not exist in round 13', () => {
  const fnBody = (src: string, head: string) => { const a = src.indexOf(head); return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a)) }
  const claims = () => stripComments(read('lib/claims.ts'))
  const tree = () => Object.fromEntries(['app', 'lib', 'components', 'messages', 'scripts'].flatMap(walk)
    .filter((f) => /\.(ts|tsx|js|json)$/.test(f)).map((f) => [f, read(f)]))
  const REMOVED = /listRevertedAfterRefundClaims|revertedAfterRefund|refund_reverted_claim|terminalBeforeEpoch|settled_by_support|annuler l[’']approbation|cancel_approval/i
  const offenders = (files: Record<string, string>) => Object.entries(files)
    .filter(([f, s]) => REMOVED.test(f.endsWith('.json') ? s : stripComments(s))).map(([f]) => f)

  it('no apply-row-failure route directory; no « annuler l’approbation » action or key; none of the E0 REMOVED identifiers or keys', () => {
    expect(walk('app').filter((f) => f.includes('apply-row-failure'))).toEqual([])
    expect(offenders(tree())).toEqual([])
  })

  it('isStuckResolvable has no financial_verification branch: a FV claim is never closable by declaration, whatever its error', async () => {
    const { isStuckResolvable } = await import('@/lib/claim-action-rules')
    for (const refundError of [null, 'financial_verification:stripe_unreadable: x', 'engine_failed: x', 'stripe_failed: x']) {
      expect(isStuckResolvable({ status: 'financial_verification', refundError }), String(refundError)).toBe(false)
    }
    const src = stripComments(read('lib/claim-action-rules.ts'))
    expect(fnBody(src, 'export function isStuckResolvable(')).not.toMatch(/FINANCIAL_VERIFICATION|financial_verification/)
  })

  it('recoverStrandedClaimReconciliations is imported only by the cron route; reverifySettledClaimRefunds is called only from it (AMF-1)', () => {
    const files = Object.entries(tree()).filter(([f]) => !f.startsWith('messages/'))
    const importers = files.filter(([f, s]) => f !== 'lib/claims.ts' && /\brecoverStrandedClaimReconciliations\b/.test(stripComments(s))).map(([f]) => f)
    expect(importers).toEqual(['app/api/admin/claims/reconcile-refunds/route.ts'])
    expect(files.filter(([f, s]) => f !== 'lib/claims.ts' && /\breverifySettledClaimRefunds\b/.test(stripComments(s))).map(([f]) => f)).toEqual([])
    const src = claims()
    const calls = Array.from(src.matchAll(/\breverifySettledClaimRefunds\(/g)).map((m) => m.index ?? 0)
      .filter((i) => !src.slice(Math.max(0, i - 25), i).includes('function '))
    const recover = src.indexOf('export async function recoverStrandedClaimReconciliations(')
    expect(calls.length).toBe(1)
    expect(calls[0]).toBeGreaterThan(recover)
  })

  it('NEGATIVE CONTROL — the ungated routes reconcile, attribute, resolve-stuck and closure-notice exist and call resolveAdmin', () => {
    for (const r of ['reconcile', 'attribute', 'resolve-stuck', 'closure-notice']) {
      const f = `app/api/admin/claims/[id]/${r}/route.ts`
      expect(existsSync(f), f).toBe(true)
      expect(stripComments(read(f)), f).toMatch(/await resolveAdmin\(\)/)
    }
  })

  it('BREAK/RESTORE witness — claims.status.settled_by_support added to a copy of fr.json is caught', () => {
    const fr = JSON.parse(read('messages/fr.json'))
    fr.claims.status.settled_by_support = 'Dossier soldé par le support'
    expect(offenders({ 'messages/fr.json': JSON.stringify(fr) })).toEqual(['messages/fr.json'])
  })
})
