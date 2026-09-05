// tests/env-provenance.test.ts — scripts/server/env-provenance.js: the decisive "present BEFORE
// the env files are loaded" test + the loader Next REALLY uses (@next/env = dotenv), value-free.
import { describe, it, expect } from 'vitest'
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
