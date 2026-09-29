// tests/claims-closure-imports.test.ts — T-49 round 13, slice W5: J-C48 (I-10, R-D8, H09 (9)).
//
// No scheduled job and no infra change; the two new alert kinds stay confined to their sender modules; no cron route —
// nor reconcile-refunds — reaches a closure notice, the closure record or the claim-marking helper; no closure-notice
// sweep exists. IMPLEMENTATION NOTE (W5) on J-C48 / ER-C23: app/api/cron does not exist; the cron routes are read from
// .github/workflows/cron.yml (stale-alerts and reconcile-refunds included). The J-C29 import walk belongs to the email slice.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, '/')
  return statSync(p).isDirectory() ? walk(p) : [p]
})

/**
 * Pinned list of the repository's cron configuration: the workflows and scripts/cron, with their 40da45e hashes (LF) —
 * except deploy-staging.yml, which D′ L5 moved; see the note beside its pin.
 */
const CRON_CONFIG_40DA45E: Record<string, string> = {
  /* T-123 — MOVED ON AN EXPLICIT FOUNDER ARBITRATION (2026-09-28), and the pin is why it had to be said
     out loud. « Je préfère un build qui échoue si l'un de ces rails money-OUT est accidentellement ouvert
     plutôt qu'une simple surveillance qui laisse compiler. » Both deploy workflows gained ONE step —
     `npm run check:flags`, inside the gating `test` job, before the compile gate — because the check was
     invoked only in tests.yml, a SEPARATE workflow that does not block a deploy, so the required-false rule
     had no teeth on the path that actually ships. Measured: 18 insertions, 0 deletions, the same 9-line
     block in each file; no schedule, no new job, no new workflow file, no secret. The invariant this pin
     protects — « no infra change » — is intact in substance: nothing was added that RUNS anything new
     against staging or production. */
  '.github/workflows/claims-census.yml':        'f55626c91a4dc332a60284d9f3aee36f064ed44def7c71b4cbb89470a674c2b9',
  /* B2 — cron.yml MOVED and scripts/cron GAINED A FILE, on an explicit founder arbitration (2026-09-29):
     « livre immédiatement le garde cron B2 pour que les trois jobs soient techniquement incapables de cibler la
     production pendant cette phase, même si CRON_TARGET_BASE_URL est modifiée par erreur. Je veux la même doctrine
     que T-123 : refus explicite, pas simple surveillance. » The guard job used to check ONE thing — that the repo
     variable was not EMPTY — so the protection was a CONFIGURATION, not a CONSTRAINT: one mistaken edit would have
     sent the e-mail catch-up and the onboarding nudges at production on the next 20-minute tick, and the invoice
     batch on the 1st. Separately the three Node scripts fell back to https://www.grubano.com when SITE_URL was
     absent — a SILENT DEFAULT TO THE MOST DANGEROUS TARGET, and the cPanel crontab sets no SITE_URL on its command
     lines. The decision now lives once, in scripts/cron/cron-target-guard.js, which REFUSES anything that is not
     positively staging and reaches production only through an exact attestation sentence.
     WHAT THIS PIN PROTECTS IS INTACT: no schedule was added or changed (the three cadences are pinned by
     tests/cron-target-guard.test.ts), no job, no workflow file, no secret — and nothing new RUNS anywhere. The
     guard job gained a checkout and one `node` call; every other job is untouched and still derives its target
     from `needs.guard.outputs.base`. cron-target-guard.js is a LIBRARY in scripts/cron/ because that is the only
     bucket of `scripts/` the deploy ships besides scripts/server/, and the three cPanel cron jobs need it.
     THE WORKFLOW HALF OF THIS PIN IS DUPLICATED IN tests/claims-r13-absent-surfaces.test.ts. I moved this copy
     first and the full suite caught the other one — the T-108 shape, paid again: a control in two places is a
     control that gets half-updated. Whoever moves one must move the other. */
  '.github/workflows/cron.yml':                 '08d6de07c4add9d3f81dc13e64757d3f7f17919094c2c821b9293360bd7f9a87',
  /* PROD-2 (2026-09-29) — deploy-production.yml MOVED, deliberately and on the founder's GO-TO-PRODUCTION decision. Production had never run and was NOT the proven staging pipeline: it lacked the three FTP exclusions that each fix a measured sync-aborting failure, it WROTE an .htaccess it did not exclude, its only blocking gate was a curl of an auth-gated page that returns 200 from any build, and it had no SSH-independent restart. Ported from deploy-staging.yml, plus one gate staging does not have (the database must be reachable through the DEPLOYED Prisma client). deploy-staging.yml is UNCHANGED in this lot — its hash above is the same. What this pin protects is intact: nothing new RUNS against staging, and no schedule, job, workflow or secret was added. */
  '.github/workflows/deploy-production.yml':    'c37f9c7b6b164e1bb84405871e591ce2192841400111a30078c152a9a4356870',
  // D′ L5 — moved from 03912758…7813 (40da45e): the staging workflow now also copies lib/claims-payable-core.js into
  // deploy-temp/lib, because the pay-window operator must recompute the rail's selection with the SAME query the rail
  // uses (spec v2 §8.8). One `cp` line: no schedule, no new job, no new workflow file.
  /* PROD-15 (2026-09-29) — deploy-staging.yml MOVED on an explicit founder arbitration: « staging ne doit jamais
     considérer un déploiement vert uniquement parce que version.json a été téléversé », et « si toutes les méthodes de
     restart échouent, le workflow doit être rouge ». The three restart steps gained ids (their `conclusion` is masked by
     continue-on-error, their `outcome` is not), plus TWO blocking steps: an aggregate that fails when every restart path
     failed, and the database-reachability gate ported from production so at least one request traverses the LIVE Prisma
     client. Measured cause: the run that deployed adfb4981 showed three GREEN restart steps and proving the restart
     required opening the raw log by hand. NO new secret (the set is pinned at seven by
     tests/rehearsal-refunds-and-prod15.test.ts), no new schedule, no job, production untouched. */
  '.github/workflows/deploy-staging.yml':       'ec7540d9ca4a887d6a2da6c438b12b590fe822a394f7e76d61d783b0a6fd6c1f',
  '.github/workflows/internal-token-probe.yml': 'd171c534104f46fb3ac60b910bb12fcea98f3aebe61fbca556a5762e4d19db65',
  '.github/workflows/refund-rehearsal.yml':     '5d825384520defb44f6977324e92a2555b667204f1e4db35da9724ca1ca235a4',
  '.github/workflows/tests.yml':                '593120f3009bca35eac5be8556710036d2aec9644e88538333b5a44e0be26287',
  'scripts/cron/cron-target-guard.js':          '0f6a3f69020caff6ae47920a617b5d8021ec36242406fd6fefd9cddb8011f6ae',
  'scripts/cron/creator-earnings-mature.js':    '9ad9d4796d5d3b94dd90f6eef511142ff6d93dfc059eb671d7d9bb61427f801a',
  'scripts/cron/ledger-check-probe.js':         '533f7f62f929fcada48ff14ed4e4f9d3c88b059c15c6944e4dad178faaebfd2a',
  'scripts/cron/monthly-invoices.js':           'fdbd8af2c8907f7457c1e7dd8d24c31f8d723e2b767bd553fca91f70addddbc7',
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
  it('the workflow and cron files equal their pinned hashes (40da45e, deploy-staging at its D′ L5 value; and the pinned list is the whole set)', () => {
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

// ══ ROUND 13 (slice W6) — J-C29 (H15, H09, I-10): the senders are never in the webhook or a cron bundle ════════════
// IMPLEMENTATION NOTE (W6) on ER-C17 / ER-C23: the roots are the webhook, reconcile-refunds and every route cron.yml calls
// (app/api/cron does not exist). The importers of lib/claim-emails are the 10 H15 routes (8 + the D′ L4 withdrawal + the D′ L5 rail); H10 / H16's missing-notice list
// (financial-verification and census routes) is not in this slice — census counts closure.missing from its own reads.
type Reader = (p: string) => string | null
const fsReader: Reader = (p) => { try { return statSync(p).isFile() ? read(p) : null } catch { return null } }
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const specifiers = (src: string) => Array.from(stripComments(src).matchAll(IMPORT_RE)).map((m) => m[1] ?? m[2])
function resolveImport(spec: string, from: string, rd: Reader): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec))
  else return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx|js|mjs)$/.test(c) && rd(c) !== null) return c
  }
  return null
}
/** Every file reachable from the roots, with the import chain that reaches it. */
function reach(roots: string[], rd: Reader): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = roots.filter((r) => rd(r) !== null).map((r) => [r, [r]] as [string, string[]])
  for (const [f, chain] of queue) seen.set(f, chain)
  while (queue.length) {
    const [f, chain] = queue.shift()!
    for (const spec of specifiers(rd(f) ?? '')) {
      const target = resolveImport(spec, f, rd)
      if (target && !seen.has(target)) {
        seen.set(target, [...chain, target])
        queue.push([target, [...chain, target]])
      }
    }
  }
  return seen
}
const walkIfExists = (d: string) => { try { return walk(d) } catch { return [] } }
const ROOTS = () => Array.from(new Set(['app/api/webhooks/stripe/route.ts', 'app/api/admin/claims/reconcile-refunds/route.ts', ...cronRoutes(), ...walkIfExists('app/api/cron').filter((f) => f.endsWith('route.ts'))]))
const SENDER_MODULES = ['lib/claim-emails.ts', 'lib/claim-email-toast.ts']
const H15_IMPORTERS = [
  'app/api/admin/claims/[id]/arbitrate/route.ts',
  'app/api/admin/claims/[id]/attribute/route.ts',
  'app/api/admin/claims/[id]/closure-notice/route.ts',
  'app/api/admin/claims/[id]/reconcile/route.ts',
  'app/api/admin/claims/[id]/resolve-stuck/route.ts',
  // D′ L4 (T-09): the withdrawal route tells the customer the approval was taken back BEFORE any payment.
  'app/api/admin/claims/[id]/withdraw-approval/route.ts',
  // D′ L5 (§8.6): the financial rail tells the customer about a claim it PAID — the first post-money sender site.
  'app/api/admin/claims/pay-approved/route.ts',
  'app/api/claims/[id]/respond/route.ts',
  'app/api/claims/route.ts',
  'app/api/orders/[id]/status/route.ts',
]

describe('J-C29 — import topology (H15)', () => {
  it('no webhook, reconcile-refunds or cron root reaches lib/claim-emails.ts or lib/claim-email-toast.ts', () => {
    expect(ROOTS()).toEqual(expect.arrayContaining(['app/api/webhooks/stripe/route.ts', 'app/api/admin/claims/reconcile-refunds/route.ts', 'app/api/admin/claims/stale-alerts/route.ts']))
    const reached = reach(ROOTS(), fsReader)
    expect(reached.has('lib/claims.ts')).toBe(true) // the walk does follow the webhook into lib/claims
    expect(SENDER_MODULES.filter((m) => reached.has(m)).map((m) => reached.get(m)!.join(' → '))).toEqual([])
  })

  it('lib/claims.ts never names the senders; lib/claim-emails.ts imports exactly the eight H15 modules and never reaches lib/claims, lib/refund or lib/stripe', () => {
    expect(read('lib/claims.ts')).not.toMatch(/claim-emails|claim-email-toast/)
    // D′ L7 (T-50) — SIX BECAME SEVEN, and the seventh is named here so the addition is a decision and
    // not a drift. The acknowledgement now tells the customer WHICH articles they claimed, so it reads the
    // persisted snapshot through `@/lib/claim-selection`. That module is PURE — no Prisma, no Stripe, no
    // lib/claims — which is why the reach assertions below are unchanged and still meaningful: what H15
    // protects is that a sender can never pull the claim state machine, the refund engine or Stripe into
    // the e-mail path, not that the list has six entries.
    //
    // D′ L8 (T-46) — SEVEN BECAME EIGHT. The restaurant's post-money notice states the CONFIRMED figures
    // of a refund, whose type lives in `@/lib/claim-financial-effect`. That module is a LEAF: it imports
    // NOTHING AT ALL, and the assertion two lines below proves it (an empty specifier list). So the sender
    // can name the type without gaining any reach, and the FIGURES are still computed by the caller and
    // passed in — the same discipline as ClosureEvidence, and the reason a sender never reads a ledger.
    expect(Array.from(new Set(specifiers(read('lib/claim-financial-effect.ts'))))).toEqual([])
    // D′ L9.1 — EIGHT BECAME TEN, named here so each addition is a decision. The restaurant's post-money
    // notice had to stop depending on a claimId (a SUPPORT refund legitimately has no Claim, and spec v2
    // §6.3 asked for a notice the old signature could not produce), so the sender moved to
    // `@/lib/refund-restaurant-notice` and this module DELEGATES to it — one refund, one sender, one key.
    // `@/lib/claim-email-shell` is the chrome the two senders share instead of rendering the same notice
    // twice. BOTH are leaves or near-leaves and neither adds reach to lib/claims, lib/refund or lib/stripe,
    // which is what the assertions below prove rather than assume.
    expect(Array.from(new Set(specifiers(read('lib/claim-emails.ts')))).sort()).toEqual(
      ['@/lib/claim-action-rules', '@/lib/claim-email-shell', '@/lib/claim-financial-effect', '@/lib/claim-selection', '@/lib/onboarding-nudge', '@/lib/order-ref', '@/lib/prisma', '@/lib/refund-restaurant-notice', '@/lib/transactional-emails', 'next-intl/server'])
    // The chrome is a LEAF, asserted the same way lib/claim-financial-effect is: an empty specifier list is
    // what makes sharing it safe for the import graph.
    expect(Array.from(new Set(specifiers(read('lib/claim-email-shell.ts'))))).toEqual([])
    // The claim-agnostic sender's own list, closed and named. It reads the LEDGER for its figures and the
    // transactional rail to send; it never names the refund engine, Stripe, or the claim state machine.
    // `@/lib/claim-action-rules` is where the trigger and BOTH key shapes are declared — one definition
    // shared with the admin lists, because a dedupe key that disagrees with itself sends twice or never. It
    // is already in the senders' reach set (lib/claim-emails imports it), so naming it adds nothing new.
    expect(Array.from(new Set(specifiers(read('lib/refund-restaurant-notice.ts')))).sort()).toEqual(
      ['@/lib/claim-action-rules', '@/lib/claim-email-shell', '@/lib/claim-financial-effect', '@/lib/onboarding-nudge', '@/lib/order-ref', '@/lib/prisma', '@/lib/transactional-emails', 'next-intl/server'])
    expect(read('lib/refund-restaurant-notice.ts')).not.toMatch(/@\/lib\/(refund|stripe|claims)['"]/)
    const fromNotice = reach(['lib/refund-restaurant-notice.ts'], fsReader)
    expect(['lib/claims.ts', 'lib/refund.ts', 'lib/stripe.ts'].filter((f) => fromNotice.has(f))).toEqual([])
    for (const m of SENDER_MODULES) expect(read(m), m).not.toMatch(/@\/lib\/(refund|stripe|claims)['"]/)
    const fromSenders = reach(SENDER_MODULES, fsReader)
    expect(['lib/claims.ts', 'lib/refund.ts', 'lib/stripe.ts'].filter((f) => fromSenders.has(f))).toEqual([])
  })

  it('D′ L9.1 — the importers of lib/refund-restaurant-notice are a CLOSED list of two, and the webhook is not one', () => {
    // The founder asked for an explicit, closed list of authorised callsites rather than a relaxed wildcard.
    // Only two paths may tell a restaurant that a refund happened:
    //   lib/claim-emails.ts — the CLAIM closure path, which delegates here so one refund has one sender;
    //   .../refunds/rows/[rowId]/notify — the SUPPORT path, for refunds with no claim behind them.
    const files = ['app', 'lib', 'components', 'scripts'].flatMap(walk).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
    const importers = files.filter((f) => specifiers(read(f)).some((s) => resolveImport(s, f, fsReader) === 'lib/refund-restaurant-notice.ts'))
    // IMPORTERS of the module — TWO, and they are the two callsites. An adversarial review of this lot's own
    // work tightened this from three: lib/claim-closure-lists first imported the key helpers from HERE, which
    // made the admin list an importer of a sender module for no reason and put the trigger literal in two
    // files. Both keys and the trigger now come from lib/claim-action-rules, the module that exists so the
    // sender and the admin lists can share ONE definition without importing each other.
    expect(importers.sort()).toEqual([
      'app/api/admin/refunds/rows/[rowId]/notify/route.ts',
      'lib/claim-emails.ts',
    ])
    // ONE DEFINITION, asserted rather than trusted: the notice module re-exports what claim-action-rules
    // declares, so the two spellings cannot drift apart into two literals.
    expect(read('lib/refund-restaurant-notice.ts')).not.toMatch(/=\s*'claim_restaurant_refunded'/)
    expect(read('lib/refund-restaurant-notice.ts')).not.toMatch(/=\s*\(stripeRefundId: string\) =>/)
    expect(read('lib/claim-closure-lists.ts')).not.toContain('refund-restaurant-notice')
    // CALLSITES of the sender — the closed list of two the founder asked for. Only these may tell a
    // restaurant that a refund happened: the CLAIM closure path (through lib/claim-emails, which delegates)
    // and the SUPPORT path. A third caller appearing here is a product decision, not a refactor.
    // The module itself is excluded: it DEFINES the function, which is not a callsite.
    const callsites = files.filter((f) => f !== 'lib/refund-restaurant-notice.ts' && /sendRefundRestaurantNotice\s*\(/.test(read(f)))
    expect(callsites.sort()).toEqual([
      'app/api/admin/refunds/rows/[rowId]/notify/route.ts',
      'lib/claim-emails.ts',
    ])
    // and lib/claim-closure-lists really does NOT call it — asserted, so « importer, not callsite » is a fact
    expect(read('lib/claim-closure-lists.ts')).not.toMatch(/sendRefundRestaurantNotice\s*\(/)
  })

  it('NEGATIVE CONTROL (H15) — no webhook, reconcile-refunds or cron root reaches the restaurant notice sender', () => {
    // H15 exists so a webhook retry storm can never become a mail storm. The new sender is post-money and
    // ungated, which makes this the assertion that matters most about it: reachable from a human action,
    // never from an event the platform delivers at its own pace.
    const reached = reach(ROOTS(), fsReader)
    expect(reached.has('app/api/webhooks/stripe/route.ts')).toBe(true)  // the walk really did start there
    const forbidden = ['lib/refund-restaurant-notice.ts', ...SENDER_MODULES]
      .filter((m) => reached.has(m))
      .map((m) => `${m} ← ${reached.get(m)!.join(' → ')}`)
    expect(forbidden).toEqual([])
    // …and the webhook does not NAME it either, so a future dynamic import cannot slip past the walk.
    expect(read('app/api/webhooks/stripe/route.ts')).not.toMatch(/refund-restaurant-notice|sendRefundRestaurantNotice/)
  })

  it('the importers of lib/claim-emails are exactly the 10 H15 routes (D′ L4 adds withdraw-approval, D′ L5 the pay rail)', () => {
    const files = ['app', 'lib', 'components', 'scripts'].flatMap(walk).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
    const importers = files.filter((f) => specifiers(read(f)).some((s) => resolveImport(s, f, fsReader) === 'lib/claim-emails.ts'))
    expect(importers.sort()).toEqual([...H15_IMPORTERS].sort())
  })

  it('NEGATIVE CONTROL — the walker over a tree where lib/claim-action-rules.ts gains `import \'@/lib/claim-emails\'` reports the webhook path', () => {
    const patched: Reader = (p) => (p === 'lib/claim-action-rules.ts' ? `import '@/lib/claim-emails'\n${read(p)}` : fsReader(p))
    const chain = reach(['app/api/webhooks/stripe/route.ts'], patched).get('lib/claim-emails.ts')
    expect(chain?.[0]).toBe('app/api/webhooks/stripe/route.ts')
    expect(chain).toEqual(expect.arrayContaining(['lib/claim-action-rules.ts', 'lib/claim-emails.ts']))
    // BREAK/RESTORE witness: the same import added to lib/claims.ts is reached too, and trips the name pin.
    const viaClaims: Reader = (p) => (p === 'lib/claims.ts' ? `import { sendClaimClosureEmail } from '@/lib/claim-emails'\n${read(p)}` : fsReader(p))
    expect(reach(['app/api/webhooks/stripe/route.ts'], viaClaims).has('lib/claim-emails.ts')).toBe(true)
  })
})

// ══ ROUND 13 (slice W6) — J-C21 (H02, H13), amended by D′ L1 (spec v2 §6.2, FIN-EMAIL-01, S-25) ═══════════════════
// Every claim sender call reads its gate at send time. Since D′ L1 the value is no longer the lease itself but the notice
// CLASS of the calling file: `claimsOpen: claimNoticeGate('pre_money')` in the files sending a pre-money notice (ack, the
// restaurant decision, the arbitration decision), `claimNoticeGate('closure')` in the files sending an explicit terminal
// closure (attribute, closure-notice, reconcile, resolve-stuck), and since D′ L5 `claimNoticeGate('post_money')` in the
// financial rail, the only file that notifies AFTER Stripe moved the money. The class is fixed PER FILE: a literal `true`, the lease
// (`isClaimsEnabled()`), the surface (`claimsSurfaceOpen()`) or the WRONG class are violations. The gate is imported from
// lib/claim-flags (never through lib/claims). IMPLEMENTATION NOTE (W6) on ER-C17: the files CALLING sendClaimAckEmail /
// sendClaimDecisionEmail / sendClaimClosureEmail are the 10 H15 routes minus app/api/orders/[id]/status/route.ts, which
// imports only the order-cancellation senders (H13) and reads `claimsOpenNow = claimNoticeGate('pre_money')` at send time.
type NoticeClass = 'pre_money' | 'post_money' | 'closure'
/** spec v2 §6.2 — the notice class of each sender-calling file (D′ L1). */
const NOTICE_CLASS: Record<string, NoticeClass> = {
  'app/api/claims/route.ts':                            'pre_money',
  'app/api/claims/[id]/respond/route.ts':               'pre_money',
  'app/api/admin/claims/[id]/arbitrate/route.ts':       'pre_money',
  // D′ L4 (T-09): withdrawing an approval is a PRE-MONEY notice — nothing was paid, nothing is closed.
  'app/api/admin/claims/[id]/withdraw-approval/route.ts': 'pre_money',
  // D′ L5 (§8.6): the rail notifies a claim it PAID — the first post_money file in the codebase, exactly as §6.1
  // predicted. Its notice is ungated on purpose (FIN-EMAIL-01, S-25): money that reached a customer is never silent.
  'app/api/admin/claims/pay-approved/route.ts':         'post_money',
  'app/api/admin/claims/[id]/attribute/route.ts':       'closure',
  'app/api/admin/claims/[id]/closure-notice/route.ts':  'closure',
  'app/api/admin/claims/[id]/reconcile/route.ts':       'closure',
  'app/api/admin/claims/[id]/resolve-stuck/route.ts':   'closure',
}
const CLAIM_FLAGS_IMPORT = /import\s*\{[^}]*\bclaimNoticeGate\b[^}]*\}\s*from\s*'@\/lib\/claim-flags'/
function senderCalls(files: Record<string, string>, classes: Record<string, NoticeClass> = NOTICE_CLASS): { callers: string[]; violations: string[] } {
  const callers = new Set<string>()
  const out: string[] = []
  for (const [f, src] of Object.entries(files)) {
    const code = stripComments(src)
    for (const m of Array.from(code.matchAll(/\b(sendClaimAckEmail|sendClaimDecisionEmail|sendClaimClosureEmail)\s*\(/g))) {
      callers.add(f)
      let i = (m.index ?? 0) + m[0].length
      while (/\s/.test(code[i] ?? '')) i++
      if (code[i] !== '{') { out.push(`${f}: ${m[1]} without an object literal`); continue }
      let depth = 0
      let j = i
      for (; j < code.length; j++) {
        if (code[j] === '{') depth++
        else if (code[j] === '}' && --depth === 0) break
      }
      const literal = code.slice(i, j + 1)
      const cls = classes[f]
      if (!cls) { out.push(`${f}: ${m[1]} in a file with no notice class (spec v2 §6.2)`); continue }
      const value = /\bclaimsOpen:\s*([^,\n}]+)/.exec(literal)?.[1].trim()
      const found = value ? /^claimNoticeGate\('(pre_money|post_money|closure)'\)$/.exec(value)?.[1] : undefined
      if (found === undefined) out.push(`${f}: ${m[1]} without claimsOpen: claimNoticeGate('${cls}') (got ${value === undefined ? 'no claimsOpen' : JSON.stringify(value)})`)
      else if (found !== cls) out.push(`${f}: ${m[1]} carries the wrong notice class '${found}' (this file sends '${cls}')`)
    }
  }
  return { callers: Array.from(callers).sort(), violations: out.sort() }
}
const appTree = () => Object.fromEntries(walk('app').filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, read(f)]))

describe('J-C21 (D′ L1) — the sender call sites', () => {
  it("each call passes claimsOpen: claimNoticeGate(<class>) with the calling file's class; the calling files are the 9 claim routes; the gate comes from lib/claim-flags", () => {
    const { callers, violations: v } = senderCalls(appTree())
    expect(v).toEqual([])
    expect(callers).toEqual(Object.keys(NOTICE_CLASS).sort())
    expect(callers).toEqual(H15_IMPORTERS.filter((f) => f !== 'app/api/orders/[id]/status/route.ts').sort())
    for (const f of callers) {
      const code = stripComments(read(f))
      expect(code, f).toMatch(CLAIM_FLAGS_IMPORT)
      // the legacy reader is never named in a sender-calling file (the lease no longer decides a notice)
      expect(code, f).not.toMatch(/\bisClaimsEnabled\b/)
    }
  })

  it("orders status: the pre-money gate is read in the send branch (claimsOpenNow = claimNoticeGate('pre_money')), after the SURFACE read at entry (claimsOn = claimsSurfaceOpen()), and the claim-mentioning variant requires it", () => {
    const code = stripComments(read('app/api/orders/[id]/status/route.ts'))
    expect(code).toMatch(CLAIM_FLAGS_IMPORT)
    const entry = code.indexOf('const claimsOn = claimsSurfaceOpen()')
    const def = code.indexOf("const claimsOpenNow = claimNoticeGate('pre_money')")
    const recipientRead = code.indexOf("prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true, name: true } })")
    expect(entry).toBeGreaterThan(-1)
    expect(recipientRead).toBeGreaterThan(-1)
    expect(def).toBeGreaterThan(entry)
    expect(def).toBeGreaterThan(recipientRead)
    expect(code).toMatch(/if \(paidCancellation && claimsOpenNow\) \{\s*await sendOrderCancelledPaidEmail\(/)
    expect(code).toMatch(/\} else if \(paidCancelled\) \{\s*await sendOrderCancelledPaidOffEmail\(/)
    // the 05152b6 shapes are gone: neither read goes through the lease, and the send-time value is never the entry value
    expect(code).not.toMatch(/\bisClaimsEnabled\b/)
    expect(code).not.toMatch(/const claimsOpenNow = (claimsOn|true|claimsSurfaceOpen\(\)|claimsIntakeOpen\(\))/)
    expect(code).not.toMatch(/claimsOpenNow = claimNoticeGate\('(closure|post_money)'\)/)
  })

  it('NEGATIVE CONTROL — `claimsOpen: true`, the entry value, the lease (05152b6), the surface and a file with no class are all flagged', () => {
    const synthetic = {
      'app/a/route.ts': 'await sendClaimDecisionEmail({ claimId, claimsOpen: true })',
      'app/b/route.ts': 'const claimsOn = claimsSurfaceOpen()\nawait sendClaimAckEmail({ claimId, claimsOn, claimsOpen: claimsOn })',
      'app/c/route.ts': 'await sendClaimClosureEmail({ claimId, claimsOpen: isClaimsEnabled() })',
      'app/d/route.ts': 'await sendClaimClosureEmail({ claimId, claimsOpen: claimsSurfaceOpen() })',
      'app/e/route.ts': "await sendClaimAckEmail({ claimId })",
      'app/f/route.ts': "await sendClaimAckEmail({ claimId, claimsOpen: claimNoticeGate('pre_money') })",
    }
    const classes: Record<string, NoticeClass> = { 'app/a/route.ts': 'pre_money', 'app/b/route.ts': 'pre_money', 'app/c/route.ts': 'closure', 'app/d/route.ts': 'closure', 'app/e/route.ts': 'pre_money' }
    expect(senderCalls(synthetic, classes).violations).toEqual([
      "app/a/route.ts: sendClaimDecisionEmail without claimsOpen: claimNoticeGate('pre_money') (got \"true\")",
      "app/b/route.ts: sendClaimAckEmail without claimsOpen: claimNoticeGate('pre_money') (got \"claimsOn\")",
      "app/c/route.ts: sendClaimClosureEmail without claimsOpen: claimNoticeGate('closure') (got \"isClaimsEnabled()\")",
      "app/d/route.ts: sendClaimClosureEmail without claimsOpen: claimNoticeGate('closure') (got \"claimsSurfaceOpen()\")",
      "app/e/route.ts: sendClaimAckEmail without claimsOpen: claimNoticeGate('pre_money') (got no claimsOpen)",
      'app/f/route.ts: sendClaimAckEmail in a file with no notice class (spec v2 §6.2)',
    ])
  })

  it('NEGATIVE CONTROL — the REAL routes broken: respond with the gate replaced by true, or by the lease; closure-notice and respond with the WRONG class', () => {
    const respond = 'app/api/claims/[id]/respond/route.ts'
    const notice = 'app/api/admin/claims/[id]/closure-notice/route.ts'
    const swap = (f: string, from: string, to: string) => {
      const src = read(f)
      expect(src, `${f} must contain ${from}`).toContain(from)
      return src.replace(from, to)
    }
    expect(senderCalls({ [respond]: swap(respond, "claimsOpen:     claimNoticeGate('pre_money')", 'claimsOpen:     true') }).violations)
      .toEqual([`${respond}: sendClaimDecisionEmail without claimsOpen: claimNoticeGate('pre_money') (got "true")`])
    expect(senderCalls({ [respond]: swap(respond, "claimsOpen:     claimNoticeGate('pre_money')", 'claimsOpen:     isClaimsEnabled()') }).violations)
      .toEqual([`${respond}: sendClaimDecisionEmail without claimsOpen: claimNoticeGate('pre_money') (got "isClaimsEnabled()")`])
    expect(senderCalls({ [respond]: swap(respond, "claimNoticeGate('pre_money')", "claimNoticeGate('closure')") }).violations)
      .toEqual([`${respond}: sendClaimDecisionEmail carries the wrong notice class 'closure' (this file sends 'pre_money')`])
    expect(senderCalls({ [notice]: swap(notice, "claimNoticeGate('closure')", "claimNoticeGate('pre_money')") }).violations)
      .toEqual([`${notice}: sendClaimClosureEmail carries the wrong notice class 'pre_money' (this file sends 'closure')`])
    // the status route pin: the send-time read replaced by the entry value, or by the lease, no longer matches
    const status = stripComments(read('app/api/orders/[id]/status/route.ts'))
    for (const bad of ['const claimsOpenNow = claimsOn', 'const claimsOpenNow = isClaimsEnabled()']) {
      const broken = status.replace("const claimsOpenNow = claimNoticeGate('pre_money')", bad)
      expect(broken).not.toBe(status)
      expect(broken.indexOf("const claimsOpenNow = claimNoticeGate('pre_money')")).toBe(-1)
    }
  })
})
