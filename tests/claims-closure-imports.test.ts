// tests/claims-closure-imports.test.ts — T-49 round 13, slice W5: J-C48 (I-10, R-D8, H09 (9)).
//
// No scheduled job and no infra change; the two new alert kinds stay confined to their sender modules; no cron route —
// nor reconcile-refunds — reaches a closure notice, the closure record or the claim-marking helper; no closure-notice
// sweep exists. IMPLEMENTATION NOTE (W5) on J-C48 / ER-C23: app/api/cron does not exist; the cron routes are read from
// .github/workflows/cron.yml (stale-alerts and reconcile-refunds included). The J-C29 import walk belongs to the email slice.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, '/')
  return statSync(p).isDirectory() ? walk(p) : [p]
})

/** Pinned list of the repository's cron configuration: the workflows and scripts/cron, with their 40da45e hashes (LF). */
const CRON_CONFIG_40DA45E: Record<string, string> = {
  '.github/workflows/claims-census.yml':        'f55626c91a4dc332a60284d9f3aee36f064ed44def7c71b4cbb89470a674c2b9',
  '.github/workflows/cron.yml':                 'fb2e484d1eb21cfbf308bdc86c35ce650384d4ea39c2a5be0257bbc317a1bd2a',
  '.github/workflows/deploy-production.yml':    'b15b2cde6cbf37c3c74e21e4a0b66ac41732bb06a675cbf7996c4e3409775d4a',
  '.github/workflows/deploy-staging.yml':       '03912758350db266030e9dc7368f5acdcc8646d5601497315896efb4f37d7813',
  '.github/workflows/internal-token-probe.yml': 'd171c534104f46fb3ac60b910bb12fcea98f3aebe61fbca556a5762e4d19db65',
  '.github/workflows/refund-rehearsal.yml':     '5d825384520defb44f6977324e92a2555b667204f1e4db35da9724ca1ca235a4',
  '.github/workflows/tests.yml':                '593120f3009bca35eac5be8556710036d2aec9644e88538333b5a44e0be26287',
  'scripts/cron/creator-earnings-mature.js':    '19fd7b07b104c2d36762dd33f7cfe257a6b9776f34c9860452ba5eda7ab2b465',
  'scripts/cron/ledger-check-probe.js':         'afe6bf017f34b2af9c1de660a972819bf96b235ab7030167f03848ca9c45bfeb',
  'scripts/cron/monthly-invoices.js':           '6ddcf2f2fca50c7f840def1a1264e13090090156002d417756e9aa4c2664ce4f',
}

const CLOSURE_REFERENCES = /\b(listMissingClaimClosureNotices|sendClaimClosureEmail|markClaimsForRevertedRefundRow)\b|claim_closure_record/
const KINDS = /claim_payment_blocked|claim_attempt_superseded/
function cronRoutes(): string[] {
  const paths = Array.from(read('.github/workflows/cron.yml').matchAll(/\$BASE(\/api\/[a-z0-9/_-]+)/g)).map((m) => `app${m[1]}/route.ts`)
  return Array.from(new Set([...paths, 'app/api/admin/claims/reconcile-refunds/route.ts'])).sort()
}
function violations(files: Record<string, string>): string[] {
  const out: string[] = []
  for (const [f, src] of Object.entries(files)) {
    const code = stripComments(src)
    const isCron = f.startsWith('app/api/cron/') || cronRoutes().includes(f)
    if (isCron && CLOSURE_REFERENCES.test(code)) out.push(`${f}: closure reference`)
    if (isCron && KINDS.test(code)) out.push(`${f}: claim alert kind`)
    if (!f.startsWith('tests/') && f !== 'lib/admin-alerts.ts' && f !== 'lib/claims.ts' && KINDS.test(src)) out.push(`${f}: kind outside its senders`)
  }
  return out.sort()
}
const tree = () => Object.fromEntries(['app', 'lib', 'components', 'scripts'].flatMap(walk).filter((f) => /\.(ts|tsx|js)$/.test(f)).map((f) => [f, read(f)]))

describe('J-C48 — no scheduled job, no infra change, alert kinds confined', () => {
  it('the workflow and cron files equal their 40da45e hashes (and the pinned list is the whole set)', () => {
    const now = [...walk('.github/workflows').filter((f) => f.endsWith('.yml')), ...walk('scripts/cron')].sort()
    expect(now).toEqual(Object.keys(CRON_CONFIG_40DA45E).sort())
    for (const [f, h] of Object.entries(CRON_CONFIG_40DA45E)) expect(sha(read(f)), f).toBe(h)
  })

  it('the cron routes read from cron.yml (reconcile-refunds and stale-alerts included) reference no closure notice, record or marking helper; the kinds stay in their senders', () => {
    expect(cronRoutes()).toEqual(expect.arrayContaining(['app/api/admin/claims/reconcile-refunds/route.ts', 'app/api/admin/claims/stale-alerts/route.ts']))
    expect(violations(tree())).toEqual([])
  })

  it('no file matches /closure.?notice.?sweep/i', () => {
    const files = ['app', 'lib', 'components', 'scripts', '.github'].flatMap(walk)
    expect(files.filter((f) => /closure.?notice.?sweep/i.test(f))).toEqual([])
    expect(Object.entries(tree()).filter(([, s]) => /closure.?notice.?sweep/i.test(stripComments(s))).map(([f]) => f)).toEqual([])
  })

  it('NEGATIVE CONTROL — a synthetic « claim_payment_blocked » in app/api/cron/x/route.ts is flagged', () => {
    expect(violations({ ...tree(), 'app/api/cron/x/route.ts': "export const k = 'claim_payment_blocked'" }))
      .toEqual(['app/api/cron/x/route.ts: claim alert kind', 'app/api/cron/x/route.ts: kind outside its senders'])
  })

  it('BREAK/RESTORE witness — sendAdminMoneyReviewAlert({ kind: claim_payment_blocked }) added to a copy of stale-alerts is flagged; the marking helper added to a copy of reconcile-refunds too', () => {
    const t = tree()
    const stale = 'app/api/admin/claims/stale-alerts/route.ts'
    expect(violations({ ...t, [stale]: t[stale] + "\nvoid sendAdminMoneyReviewAlert({ kind: 'claim_payment_blocked', dedupeKey: 'x', title: 'x', facts: {} })\n" }))
      .toEqual([`${stale}: claim alert kind`, `${stale}: kind outside its senders`])
    const rr = 'app/api/admin/claims/reconcile-refunds/route.ts'
    expect(violations({ ...t, [rr]: t[rr] + "\nimport { markClaimsForRevertedRefundRow } from '@/lib/claims'\n" })).toEqual([`${rr}: closure reference`])
  })
})
