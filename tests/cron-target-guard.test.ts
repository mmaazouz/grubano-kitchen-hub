/**
 * B2 — THE CRON TARGET GUARD (founder arbitration 2026-09-29).
 *
 * « livre immédiatement le garde cron B2 pour que les trois jobs soient techniquement
 *   incapables de cibler la production pendant cette phase, même si CRON_TARGET_BASE_URL est
 *   modifiée par erreur. Je veux la même doctrine que T-123 : refus explicite, pas simple
 *   surveillance. »
 *
 * WHAT THIS FILE HAS TO PROVE, and why each part exists:
 *
 *  1. THE PREDICATE IS A WHITELIST. A blocklist of production hostnames would let a MISTYPED
 *     domain through, and « I typed the wrong host » is at least as likely as « I typed
 *     production ». So an unrecognised host must be refused, not merely a known-bad one — and
 *     it must be refused EVEN WITH the production attestation, because « we authorised
 *     production » must never become « we authorised whatever someone typed ».
 *
 *  2. THE MODULE IS PURE. The attestation is read from an env object PASSED IN. If it fell back
 *     to the ambient `process.env`, a test that happens to run with the variable set would go
 *     green while the real refusal was broken — so one case asserts the refusal holds with
 *     `process.env.CRON_ALLOW_PRODUCTION` set and an EMPTY env argument.
 *
 *  3. THE GUARD IS EXECUTED, NOT READ. A source scan proves the literal is gone; only running
 *     the scripts proves they refuse. Each of the three is spawned in a throwaway tree whose
 *     root has no `.env.local` — because the loader resolves `__dirname/../../.env.local`, so a
 *     run from inside the repository would silently inherit the developer's own environment and
 *     the assertions would stop meaning anything.
 *
 *  4. THE POSITIVE CONTROLS MUST NOT TOUCH THE NETWORK. Proving « the guard lets staging
 *     through » by letting the script reach staging would mean POSTing to a real route. Instead
 *     each script is run with a valid staging target and NO `INTERNAL_CRON_TOKEN`: the token
 *     check sits immediately after the target guard, so failing THERE is the proof the guard
 *     passed — and nothing is sent anywhere.
 *
 *  5. THE LEXICAL BAN TARGETS THE EXECUTABLE CONSTRUCTION, NEVER THE WORD. The comments that
 *     explain the removal quote the old default verbatim; a naive token ban would refuse its own
 *     documentation. Comments are stripped before the scan, and a negative control proves the
 *     scanner still catches the construction.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

/* js-yaml ships no type declarations here and adding @types for one test would put a dependency on
   the critical path — the same shape as tests/prod-launch-p0.test.ts. */
const req = createRequire(import.meta.url)
const yaml = req('js-yaml') as { load: (s: string) => unknown }

const GUARD_PATH = 'scripts/cron/cron-target-guard.js'
const CRON_SCRIPTS = [
  'scripts/cron/ledger-check-probe.js',
  'scripts/cron/creator-earnings-mature.js',
  'scripts/cron/monthly-invoices.js',
] as const

const guard = req(join(process.cwd(), GUARD_PATH)) as {
  STAGING_HOSTS: string[]
  PRODUCTION_HOSTS: string[]
  ATTESTATION_VAR: string
  ATTESTATION_SENTENCE: string
  classifyCronTarget: (raw: unknown) => { kind: string; host: string | null; base: string | null; detail: string }
  assertCronTargetAllowed: (raw: unknown, env?: Record<string, string | undefined>) =>
    { ok: true; base: string; kind: string } | { ok: false; error: string }
}

const read = (p: string) => readFileSync(p, 'utf8')

/**
 * Blank BLOCK comments first — preserving newlines so line numbers and structure survive — then
 * drop whole-line `//` and `#` comments. Per-line sniffing alone misses a `/* … *\/` block whose
 * continuation lines carry no marker, which is exactly how an earlier ban in this repository
 * ended up refusing its own explanation.
 */
function stripComments(src: string): string {
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return blanked
    .split(/\r?\n/)
    .map((l) => (/^\s*(\/\/|#)/.test(l) ? '' : l))
    .join('\n')
}

/** The construction that used to pick production in silence, as an EXECUTABLE occurrence. */
const SILENT_PRODUCTION_DEFAULT = /process\s*\.\s*env\s*\.\s*SITE_URL\s*\|\|/

/** Any hard-coded Grubano host in executable code. */
const HARDCODED_HOST = /['"`]https?:\/\/(?:www\.)?grubano\.com/

describe('B2 — the cron target guard REFUSES; it does not watch', () => {
  // ── 1. the predicate ─────────────────────────────────────────────────────────────────────
  it('classifies every shape that matters, and a whitelist is what decides', () => {
    const cases: Array<[unknown, string]> = [
      ['https://app.grubano.com',        'staging'],
      ['https://app.grubano.com/',       'staging'],
      ['  https://business.grubano.com ','staging'],
      ['HTTPS://APP.GRUBANO.COM',        'staging'],   // host comparison is case-insensitive
      ['https://grubano.com',            'production'],
      ['https://www.grubano.com',        'production'],
      ['http://app.grubano.com',         'insecure'],  // the cron token travels in a header
      ['https://app.grubano.com/api',    'has_path'],
      ['https://app.grubano.com?x=1',    'has_path'],
      ['https://app.grubano.com#f',      'has_path'],
      ['app.grubano.com',                'malformed'], // no scheme
      ['ftp://app.grubano.com',          'malformed'],
      ['https://u:p@app.grubano.com',    'malformed'], // credentials in the URL
      ['',                               'empty'],
      ['   ',                            'empty'],
      [undefined,                        'empty'],
      [null,                             'empty'],
      [42,                               'empty'],
      // LOOK-ALIKES — each one is why the rule is a whitelist and not a blocklist.
      ['https://app.grubano.com.attacker.test', 'unknown'],
      ['https://grubano.com.attacker.test',     'unknown'],
      ['https://appgrubano.com',                'unknown'],
      ['https://app.grubano.co',                'unknown'],
      ['https://evil.example.com',              'unknown'],
    ]
    for (const [input, kind] of cases) {
      expect(guard.classifyCronTarget(input).kind, JSON.stringify(input)).toBe(kind)
    }
  })

  it('POSITIVE CONTROL — staging is ALLOWED and the normalised base comes back, so the guard is not refusing everything', () => {
    for (const h of guard.STAGING_HOSTS) {
      const r = guard.assertCronTargetAllowed(`https://${h}/`, {})
      expect(r.ok, h).toBe(true)
      if (r.ok) {
        expect(r.kind).toBe('staging')
        expect(r.base).toBe(`https://${h}`)     // trailing slash normalised away
      }
    }
  })

  // ── 2. production is a NAMED decision, never a typo ──────────────────────────────────────
  it('refuses production, and the refusal says « point it back at staging » instead of inviting a wider host list', () => {
    for (const h of guard.PRODUCTION_HOSTS) {
      const r = guard.assertCronTargetAllowed(`https://${h}`, {})
      expect(r.ok, h).toBe(false)
      if (!r.ok) {
        expect(r.error).toMatch(/PRODUCTION/)
        expect(r.error).toMatch(/point it back at staging/i)
        expect(r.error).toContain(guard.ATTESTATION_VAR)
      }
    }
  })

  it('production is reachable ONLY with the exact attestation sentence — every near miss is refused', () => {
    const ok = guard.assertCronTargetAllowed('https://grubano.com', { [guard.ATTESTATION_VAR]: guard.ATTESTATION_SENTENCE })
    expect(ok.ok).toBe(true)                                     // POSITIVE CONTROL for the attestation
    if (ok.ok) expect(ok.kind).toBe('production')

    const nearMisses = [
      guard.ATTESTATION_SENTENCE.toLowerCase(),
      guard.ATTESTATION_SENTENCE + ' ',
      ' ' + guard.ATTESTATION_SENTENCE,
      guard.ATTESTATION_SENTENCE.replace(/ /g, '_'),
      guard.ATTESTATION_SENTENCE.slice(0, -1),
      'true', 'yes', '1', '',
    ]
    for (const v of nearMisses) {
      expect(guard.assertCronTargetAllowed('https://grubano.com', { [guard.ATTESTATION_VAR]: v }).ok, JSON.stringify(v)).toBe(false)
    }
  })

  it('the attestation unlocks PRODUCTION ONLY — an unknown host stays refused with it', () => {
    const attested = { [guard.ATTESTATION_VAR]: guard.ATTESTATION_SENTENCE }
    for (const u of ['https://evil.example.com', 'https://app.grubano.com.attacker.test', 'http://grubano.com', 'https://grubano.com/api']) {
      const r = guard.assertCronTargetAllowed(u, attested)
      expect(r.ok, u).toBe(false)
    }
  })

  // ── 3. purity: the ambient process must not be able to unlock anything ───────────────────
  it('reads the attestation from the env it is GIVEN, never from the ambient process', () => {
    const prior = process.env[guard.ATTESTATION_VAR]
    process.env[guard.ATTESTATION_VAR] = guard.ATTESTATION_SENTENCE
    try {
      // Empty env argument: the ambient variable is set, and it must change nothing.
      expect(guard.assertCronTargetAllowed('https://grubano.com', {}).ok).toBe(false)
      expect(guard.assertCronTargetAllowed('https://grubano.com').ok).toBe(false)
    } finally {
      if (prior === undefined) delete process.env[guard.ATTESTATION_VAR]
      else process.env[guard.ATTESTATION_VAR] = prior
    }
  })
})

describe('B2 — the workflow cannot reach production either', () => {
  const wf = yaml.load(read('.github/workflows/cron.yml')) as {
    on: { schedule: Array<{ cron: string }> }
    jobs: Record<string, { needs?: string | string[]; outputs?: Record<string, string>; steps?: Array<Record<string, unknown>> }>
  }

  it('the guard job checks out the repository and DELEGATES the decision to the guard module', () => {
    const steps = wf.jobs.guard.steps ?? []
    expect(steps.some((s) => typeof s.uses === 'string' && (s.uses as string).startsWith('actions/checkout'))).toBe(true)
    const check = steps.find((s) => s.id === 'check')
    expect(check, 'the `check` step must still exist — the outputs reference it').toBeTruthy()
    const run = String(check!.run ?? '')
    expect(run).toContain(GUARD_PATH)
    expect(run).toContain('$GITHUB_OUTPUT')
    // The attestation must be plumbed in, or production could never be unlocked deliberately.
    expect(JSON.stringify(check!.env ?? {})).toContain(guard.ATTESTATION_VAR)
  })

  it('the guard job no longer decides by itself: no inline host test survives in its shell', () => {
    const steps = wf.jobs.guard.steps ?? []
    const shell = steps.map((s) => String(s.run ?? '')).join('\n')
    expect(shell).not.toMatch(HARDCODED_HOST)
  })

  it('EVERY other job derives its target from the guard output, and none hard-codes a host', () => {
    const others = Object.entries(wf.jobs).filter(([name]) => name !== 'guard')
    expect(others.length).toBeGreaterThanOrEqual(4)            // sweep-positions, sweep-order-emails, daily, monthly
    for (const [name, job] of others) {
      const needs = Array.isArray(job.needs) ? job.needs : [job.needs]
      expect(needs, name).toContain('guard')
      const body = JSON.stringify(job)
      expect(body, name).toContain('needs.guard.outputs.base')
      expect(body, name).not.toMatch(HARDCODED_HOST)
      // `$BASE` is load-bearing elsewhere: tests/claims-closure-imports.test.ts derives the cron
      // ROUTES by parsing `$BASE/api/...` out of this file. Renaming it would silently empty that list.
      expect(body, name).toContain('BASE')
    }
  })

  it('the three schedules are unchanged — this lot added no cadence', () => {
    expect((wf.on.schedule ?? []).map((s) => s.cron)).toEqual(['*/20 * * * *', '20 3 * * *', '0 7 1 * *'])
  })
})

describe('B2 — the three cron scripts: the silent production default is gone, and the refusal is EXECUTED', () => {
  it('no executable line in the guard or the three scripts defaults SITE_URL, or hard-codes a Grubano host', () => {
    for (const f of [GUARD_PATH, ...CRON_SCRIPTS]) {
      const code = stripComments(read(f))
      expect(code, f).not.toMatch(SILENT_PRODUCTION_DEFAULT)
      expect(code, f).not.toMatch(HARDCODED_HOST)
    }
  })

  it('NEGATIVE CONTROL — the scan still catches the old construction when it is put back', () => {
    const restored = stripComments(read(CRON_SCRIPTS[0]))
      + "\nconst SITE_URL = (process.env.SITE_URL || 'https://www.grubano.com')\n"
    expect(restored).toMatch(SILENT_PRODUCTION_DEFAULT)
    expect(restored).toMatch(HARDCODED_HOST)
  })

  it('each script requires the ONE guard module — the decision is not re-implemented three times', () => {
    for (const f of CRON_SCRIPTS) {
      const code = stripComments(read(f))
      expect(code, f).toContain('assertCronTargetAllowed')
      expect(code, f).toContain('cron-target-guard.js')
    }
  })

  /**
   * Run each script in a throwaway tree. The root has no `.env.local`, which matters: the loader
   * resolves `__dirname/../../.env.local`, so running from the repository would inherit the
   * developer's own SITE_URL / INTERNAL_CRON_TOKEN and every assertion below would be vacuous.
   * The scripts require only Node built-ins at load time, so no node_modules is needed.
   */
  function runInCleanWorld(script: string, env: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'grubano-b2-'))
    try {
      const dir = join(root, 'scripts', 'cron')
      mkdirSync(dir, { recursive: true })
      copyFileSync(GUARD_PATH, join(dir, 'cron-target-guard.js'))
      copyFileSync(script, join(dir, 'entry.js'))
      const r = spawnSync(process.execPath, [join(dir, 'entry.js')], {
        cwd: root,
        /* A CLEAN environment: PATH (node needs nothing else here) plus what the case supplies.
           NODE_ENV is included because this repository's `next-env.d.ts` makes it REQUIRED on
           NodeJS.ProcessEnv, so omitting it would be a type error rather than a smaller env. */
        env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 30_000,
      })
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  for (const script of CRON_SCRIPTS) {
    const name = script.split('/').pop()

    it(`${name} — SITE_URL ABSENT is a refusal, not production`, () => {
      const r = runInCleanWorld(script, {})
      expect(r.status).toBe(1)
      expect(r.out).toContain('[CRON TARGET] FATAL')
      expect(r.out).not.toContain('www.grubano.com/api')       // nothing was aimed at production
    })

    it(`${name} — SITE_URL pointing at PRODUCTION is refused by name`, () => {
      const r = runInCleanWorld(script, { SITE_URL: 'https://www.grubano.com', INTERNAL_CRON_TOKEN: 'tok' })
      expect(r.status).toBe(1)
      expect(r.out).toContain('CRON TARGET REFUSED')
      expect(r.out).toMatch(/PRODUCTION/)
    })

    it(`${name} — an UNKNOWN host is refused even with the production attestation`, () => {
      const r = runInCleanWorld(script, {
        SITE_URL: 'https://evil.example.com',
        INTERNAL_CRON_TOKEN: 'tok',
        [guard.ATTESTATION_VAR]: guard.ATTESTATION_SENTENCE,
      })
      expect(r.status).toBe(1)
      expect(r.out).toContain('CRON TARGET REFUSED')
    })

    it(`${name} — POSITIVE CONTROL: a staging target PASSES the guard and fails on the NEXT check instead (no network)`, () => {
      const r = runInCleanWorld(script, { SITE_URL: 'https://app.grubano.com' })
      expect(r.status).toBe(1)
      expect(r.out).toContain('INTERNAL_CRON_TOKEN missing')     // the check right after the guard
      expect(r.out).not.toContain('CRON TARGET')                 // ⇒ the guard let it through
    })

    it(`${name} — POSITIVE CONTROL: production WITH the exact attestation passes the guard too (still no network)`, () => {
      const r = runInCleanWorld(script, {
        SITE_URL: 'https://grubano.com',
        [guard.ATTESTATION_VAR]: guard.ATTESTATION_SENTENCE,
      })
      expect(r.status).toBe(1)
      expect(r.out).toContain('INTERNAL_CRON_TOKEN missing')
      expect(r.out).not.toContain('CRON TARGET')
    })
  }
})
