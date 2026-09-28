// tests/env-provenance.test.ts — scripts/server/env-provenance.js: the decisive "present BEFORE
// the env files are loaded" test + the loader Next REALLY uses (@next/env = dotenv), value-free.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prov = require('../scripts/server/env-provenance.js') as {
  NEXT_ENV_FILES: string[]
  parseEnvDotenv: (t: string) => Record<string, string>
  parseEnvStrict: (t: string) => Record<string, string>
  countDotenvOccurrences: (t: string, k: string) => number
  mergeNextEnvFiles: (t: Record<string, string>) => { merged: Record<string, string>; definedIn: Record<string, string[]> }
  computeProvenance: (pre: Record<string, string | undefined>, texts: Record<string, string>, keys: string[]) => { at: string; loader: string; filesPresent: string[]; keys: Record<string, { presentBeforeEnvLoad: boolean; presentInEnvFiles: boolean; definedIn: string[]; occurrences: Record<string, number>; equalProcessVsFiles: boolean | null; effectiveSource: string }> }
  assertNoValues: (r: unknown) => unknown
  WATCHED_SECRET_KEYS: string[]
  // PRE-L11: the money set is DECLARED here and the watch list is derived from it (see T-88).
  MONEY_FLAGS_MUST_BE_FALSE: string[]
  MONEY_ADJACENT_KEYS: string[]
}

const LOCAL = 'INTERNAL_CRON_TOKEN=file-token-value-0001\nSTRIPE_SECRET_KEY="sk_test_filevalue"\n TIPS_ENABLED = true\nexport SMTP_PASS=p@ss # inline comment\nINTERNAL_CRON_TOKEN=second-occurrence-WINS\n'

describe('dotenv (Next) semantics vs the repo root server.js strict loader', () => {
  it('dotenv: leading whitespace, spaces around =, export prefix, inline comment, LAST occurrence wins', () => {
    const p = prov.parseEnvDotenv(LOCAL)
    expect(p.TIPS_ENABLED).toBe('true')                       // ` TIPS_ENABLED = true` IS loaded by Next
    expect(p.SMTP_PASS).toBe('p@ss')                           // export + inline comment handled
    expect(p.STRIPE_SECRET_KEY).toBe('sk_test_filevalue')      // quotes stripped
    expect(p.INTERNAL_CRON_TOKEN).toBe('second-occurrence-WINS')
    expect(prov.countDotenvOccurrences(LOCAL, 'INTERNAL_CRON_TOKEN')).toBe(2)
  })
  it('strict (root server.js, NOT deployed): first occurrence wins, non-canonical lines invisible — the divergence class', () => {
    const s = prov.parseEnvStrict(LOCAL)
    expect(s.INTERNAL_CRON_TOKEN).toBe('file-token-value-0001')
    expect(s.TIPS_ENABLED).toBeUndefined()
    expect(s.SMTP_PASS).toBeUndefined()
  })
  it('file precedence: .env.production.local beats .env.local beats .env.production beats .env (first file wins)', () => {
    const r = prov.mergeNextEnvFiles({ '.env.local': 'K=local\nONLY_LOCAL=1', '.env.production.local': 'K=prodlocal', '.env': 'K=dotenv\nONLY_DOTENV=1' })
    expect(r.merged.K).toBe('prodlocal')
    expect(r.definedIn.K).toEqual(['.env.production.local', '.env.local', '.env'])
    expect(r.merged.ONLY_LOCAL).toBe('1'); expect(r.merged.ONLY_DOTENV).toBe('1')
  })
})

describe('env-provenance — decisive pre-load test', () => {
  it('key pre-existing before any env load → presentBeforeEnvLoad YES, effective = process, equality boolean false when it differs', () => {
    const r = prov.computeProvenance({ INTERNAL_CRON_TOKEN: 'hosting-token-value-0002' }, { '.env.local': LOCAL }, ['INTERNAL_CRON_TOKEN'])
    const k = r.keys.INTERNAL_CRON_TOKEN
    expect(k.presentBeforeEnvLoad).toBe(true)
    expect(k.presentInEnvFiles).toBe(true)
    expect(k.definedIn).toEqual(['.env.local'])
    expect(k.occurrences).toEqual({ '.env.local': 2 })
    expect(k.equalProcessVsFiles).toBe(false)   // hosting value ≠ file value → the 401 class
    expect(k.effectiveSource).toBe('process')   // Next never overrides a pre-existing value
    expect(r.filesPresent).toEqual(['.env.local'])
  })
  it('key absent before load → presentBeforeEnvLoad NO, effective = the first file defining it', () => {
    const r = prov.computeProvenance({}, { '.env.local': LOCAL, '.env': 'INTERNAL_CRON_TOKEN=older' }, ['INTERNAL_CRON_TOKEN'])
    const k = r.keys.INTERNAL_CRON_TOKEN
    expect(k.presentBeforeEnvLoad).toBe(false)
    expect(k.equalProcessVsFiles).toBeNull()
    expect(k.effectiveSource).toBe('.env.local')
    expect(k.definedIn).toEqual(['.env.local', '.env'])
  })
  it('a second env file shadowing .env.local is reported as the effective source', () => {
    const r = prov.computeProvenance({}, { '.env.production.local': 'INTERNAL_CRON_TOKEN=shadow', '.env.local': LOCAL }, ['INTERNAL_CRON_TOKEN'])
    expect(r.keys.INTERNAL_CRON_TOKEN.effectiveSource).toBe('.env.production.local')
  })
  it('equal values → equalProcessVsFiles:true (boolean only)', () => {
    const r = prov.computeProvenance({ INTERNAL_CRON_TOKEN: 'second-occurrence-WINS' }, { '.env.local': LOCAL }, ['INTERNAL_CRON_TOKEN'])
    expect(r.keys.INTERNAL_CRON_TOKEN.equalProcessVsFiles).toBe(true)
  })
  it('absent everywhere → effective none', () => {
    const r = prov.computeProvenance({}, { '.env.local': LOCAL }, ['NEXTAUTH_SECRET'])
    expect(r.keys.NEXTAUTH_SECRET).toEqual({ presentBeforeEnvLoad: false, presentInEnvFiles: false, definedIn: [], occurrences: {}, equalProcessVsFiles: null, effectiveSource: 'none' })
  })
  it('NEVER prints a value: the serialised report contains no value, no length, no prefix, no hash', () => {
    const r = prov.computeProvenance({ INTERNAL_CRON_TOKEN: 'hosting-token-value-0002', SMTP_PASS: 'p@ss' }, { '.env.local': LOCAL }, prov.WATCHED_SECRET_KEYS)
    const json = JSON.stringify(prov.assertNoValues(r))
    for (const s of ['hosting-token', 'file-token', 'second-occurrence', 'sk_test', 'p@ss', 'filevalue', '0001', '0002']) expect(json).not.toContain(s)
    expect(json).not.toMatch(/length|prefix|suffix|hash|sha\d/i)
    expect(Object.keys(r.keys)).toEqual(prov.WATCHED_SECRET_KEYS)
  })
  it('assertNoValues rejects a report smuggling a string or an unknown field', () => {
    const bad = prov.computeProvenance({}, { '.env.local': LOCAL }, ['INTERNAL_CRON_TOKEN']) as unknown as { keys: Record<string, Record<string, unknown>> }
    bad.keys.INTERNAL_CRON_TOKEN.leak = 'file-token-value-0001'
    expect(() => prov.assertNoValues(bad)).toThrow(/string value not allowed|unexpected field/)
    const bad2 = prov.computeProvenance({}, { '.env.local': LOCAL }, ['INTERNAL_CRON_TOKEN']) as unknown as { keys: Record<string, Record<string, unknown>> }
    bad2.keys.INTERNAL_CRON_TOKEN.definedIn = ['file-token-value-0001']
    expect(() => prov.assertNoValues(bad2)).toThrow(/unexpected array item/)
  })
})

// ── PRE-L11 (adversarial review P1) — EVERY MONEY FLAG IS WATCHED, BY DERIVATION ═════════════════════
//
// The watch list was maintained by hand next to a separate money-flag list in phase2-preflight.js, and the
// two had drifted: seven of the nine flags that MUST be false for money safety were unwatched. That matters
// on this host specifically, because `@next/env` never overrides `process.env`: a flag set in the cPanel
// Node.js selector is TRUE in the running process while every env FILE stays silent, so the operator read
// « ABSENT → EFFECTIVE FALSE » and « RESULT: PASS » about an OPEN flag. Hosting-level injection here is a
// measured fact, not a hypothesis. These assertions are what keeps the two lists from parting again.
describe('PRE-L11 — the money flags and the provenance watch list cannot drift apart', () => {
  it('every flag that must be false is watched', () => {
    for (const k of prov.MONEY_FLAGS_MUST_BE_FALSE) {
      expect(prov.WATCHED_SECRET_KEYS, `money flag ${k} is not watched`).toContain(k)
    }
    expect(prov.MONEY_FLAGS_MUST_BE_FALSE.length).toBeGreaterThanOrEqual(9)
  })

  it('the lease keys are watched too — CLAIMS_ENABLED is a DISJUNCT with CLAIMS_WINDOW_UNTIL', () => {
    // Watching the flag without the lease bounds nothing: either one opens the surface on its own.
    for (const k of ['ALLOW_PLATFORM_FALLBACK', 'CLAIMS_WINDOW_UNTIL', 'REFUNDS_WINDOW_UNTIL']) {
      expect(prov.WATCHED_SECRET_KEYS, k).toContain(k)
    }
    // T-100 widened this list; the pin is on the MEMBERSHIP each entry earns, not on the exact array, so
    // adding a key a future finding justifies does not have to break a test that was not about it.
    for (const k of ['ALLOW_PLATFORM_FALLBACK', 'CLAIMS_WINDOW_UNTIL', 'REFUNDS_WINDOW_UNTIL']) {
      expect(prov.MONEY_ADJACENT_KEYS, k).toContain(k)
    }
  })

  it('T-119 — the two money-OUT rail flags are required FALSE, not merely printed', () => {
    /* Found by the final invariant review. These two are the sole gates on the only writes in the repository
       that PAY a third party rather than recover from one — a franchisor settlement and a partner payout —
       and both sat in MONEY_ADJACENT_KEYS, i.e. reported as a line of text. A value injected through the
       cPanel Node.js selector (the channel the spec forbids, and one this repository has already measured
       live for three keys) would therefore have been printed while the rail it opens stayed open. */
    for (const k of ['FRANCHISE_SETTLEMENT_ENABLED', 'CREATOR_PAYOUT_ENABLED']) {
      expect(prov.MONEY_FLAGS_MUST_BE_FALSE, k).toContain(k)
      expect(prov.WATCHED_SECRET_KEYS, k).toContain(k)
      // never in both lists: a key required false that is also merely 'adjacent' invites a future demotion
      expect(prov.MONEY_ADJACENT_KEYS, k).not.toContain(k)
    }
    // and each really is the sole in-module gate on a `transfers.create` — measured, not assumed
    const settlement = readFileSync('lib/franchise-settlement.ts', 'utf8')
    expect(settlement).toContain("process.env.FRANCHISE_SETTLEMENT_ENABLED === 'true'")
    expect(settlement).toContain('transfers.create(')
    const payout = readFileSync('lib/creator-payout.ts', 'utf8')
    expect(payout).toContain("process.env.CREATOR_PAYOUT_ENABLED === 'true'")
    expect(payout).toContain('transfers.create(')
  })

  it('T-100 — CHARGEBACKS_ENABLED is required false, because it is the ONLY gate on two transfer reversals', () => {
    // lib/dispute.ts:242 debits the RESTAURANT's connected account and :264 the FRANCHISOR's, and the
    // only thing holding them back is this flag — read in ONE place, from a PUBLIC signed webhook, with
    // no re-check inside the module. It was watched by nothing.
    expect(prov.MONEY_FLAGS_MUST_BE_FALSE).toContain('CHARGEBACKS_ENABLED')
    expect(prov.WATCHED_SECRET_KEYS).toContain('CHARGEBACKS_ENABLED')
    // the gate really is that flag, and really is read in exactly one place — measured, not assumed
    const dispute = readFileSync('lib/dispute.ts', 'utf8')
    expect(dispute).toContain("process.env.CHARGEBACKS_ENABLED === 'true'")
    expect(dispute).toContain('transfers.createReversal')
    const webhook = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8')
    expect(webhook).toContain('if (!isChargebacksEnabled())')
  })

  it('T-100 — the franchise rail that CREATES the reversible transfers is watched too', () => {
    // A clawback can only exist because a settlement transfer exists. Those flags are PRINTED rather than
    // required false (the project's own choice, phase2-preflight FLAGS_TO_PRINT) — but their SOURCE is now
    // reported, which is what « the cPanel selector can set anything » makes necessary.
    for (const k of ['FRANCHISE_ENABLED', 'FRANCHISE_ROYALTY_ENABLED', 'FRANCHISE_SETTLEMENT_ENABLED']) {
      expect(prov.WATCHED_SECRET_KEYS, k).toContain(k)
    }
  })

  it('phase2-preflight declares NO second copy of the list', () => {
    // The drift was possible only because there were two. A future editor adding a flag to one of them
    // would reintroduce exactly this defect, so the source is asserted to hold one declaration.
    const src = readFileSync('scripts/server/phase2-preflight.js', 'utf8')
    expect(src).toContain('const MONEY_FLAGS_MUST_BE_FALSE = prov.MONEY_FLAGS_MUST_BE_FALSE')
    expect(src).not.toMatch(/const MONEY_FLAGS_MUST_BE_FALSE = \[/)
  })

  it('the watch list has no duplicate, so the report keys stay 1:1 with it', () => {
    const seen = new Set(prov.WATCHED_SECRET_KEYS)
    expect(seen.size).toBe(prov.WATCHED_SECRET_KEYS.length)
    const r = prov.computeProvenance({}, { '.env.local': LOCAL }, prov.WATCHED_SECRET_KEYS)
    expect(Object.keys(r.keys)).toEqual(prov.WATCHED_SECRET_KEYS)
  })

  it('a hosting-injected money flag IS reported as coming from the process, not from the files', () => {
    // The whole point: the report must be able to SAY it. With LOGISTICS_PAYOUT_ENABLED exported by the
    // hosting layer and absent from every file, `effectiveSource` is 'process' — which is the anomaly an
    // operator needs, and which was structurally unreachable while the key was unwatched.
    const r = prov.computeProvenance({ LOGISTICS_PAYOUT_ENABLED: 'true' }, { '.env.local': LOCAL }, prov.WATCHED_SECRET_KEYS)
    expect(r.keys.LOGISTICS_PAYOUT_ENABLED.presentBeforeEnvLoad).toBe(true)
    expect(r.keys.LOGISTICS_PAYOUT_ENABLED.presentInEnvFiles).toBe(false)
    expect(r.keys.LOGISTICS_PAYOUT_ENABLED.effectiveSource).toBe('process')
    // And no VALUE leaks, which is the invariant that lets this be printed at all. The ban is on the
    // string `"true"` — the report is full of legitimate JSON booleans, and banning the bare token would
    // report the report's own structure as the leak. Fourth time in this chantier that a lexical ban has
    // to be narrowed from the token to the shape.
    expect(JSON.stringify(prov.assertNoValues(r))).not.toContain('"true"')
  })
})
