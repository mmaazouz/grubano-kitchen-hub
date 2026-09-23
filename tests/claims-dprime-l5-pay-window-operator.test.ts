// tests/claims-dprime-l5-pay-window-operator.test.ts — D′ lot L5 (spec v2 §8.8): the pay-window operator.
//
// THIS OPERATOR IS THE ONLY THING THAT CAN OPEN A REFUNDS WINDOW FOR THE CLAIMS RAIL. It is delivered
// REFUSING — `CERTIFIED_SHAS` is empty — and it must refuse every other way too, BEFORE writing a single
// byte. So it is run here as a REAL CHILD PROCESS in an isolated fake world: its own app root, its own
// `.env.local`, its own `public/version.json`, a database it can never reach and a host it must never
// contact. After every run the test re-reads `.env.local` byte for byte: a refusal that silently armed
// the money gate would be the worst possible defect in this file, so it is measured, not trusted.
//
// The lesson these tests encode: an operator is certified only when its main() has been EXECUTED by a
// test. A header that says « fail-closed » is a claim; a child process that exits non-zero with the
// same file on disk is evidence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const OPERATOR = path.join(process.cwd(), 'scripts', 'server', 'phase2-claims-pay-window.js')
const read = (p: string) => fs.readFileSync(p, 'utf8')
/** The source WITHOUT comments: a header that promises something must not satisfy a scan for it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** A staging-shaped .env.local whose every precheck-relevant value is green unless a test breaks one. */
const GREEN_ENV: Record<string, string> = {
  NEXTAUTH_URL:             'https://app.grubano.com',
  NEXTAUTH_SECRET:          'a-session-secret-for-the-fake-world',
  DATABASE_URL:             'mysql://guard:guard@127.0.0.1:1/deyi0010_grubano_staging',
  STRIPE_SECRET_KEY:        'sk_test_fake_key_for_the_fake_world',
  INTERNAL_CRON_TOKEN:      'internal-cron-token-of-the-fake-world',
  CLAIMS_SURFACE_ENABLED:   'true',
  ADMIN_AUDIT_ENABLED:      'true',
}
/**
 * THE FIXTURE BUILD IS DELIBERATELY NOT `develop`.
 *
 * Step 3 of the operator cross-checks the build on disk against the build the HOST SERVES, and the probe
 * base is hard-restricted to https://app.grubano.com — there is no way to point it at a local server, by
 * design. A fixture on branch `develop` would therefore make every green-precheck run in this suite issue
 * a real request to STAGING. A test suite must not talk to staging, so the fixture stops the operator at
 * the branch clause, which is evaluated BEFORE the network. Everything from that fetch onwards is
 * unexercised here and is stated as a coverage limit rather than implied by a green suite.
 */
const VERSION_GREEN = { commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', shortCommit: 'deadbee', branch: 'main', buildDate: '2026-09-23T12:00:00.000Z' }

let world: string
let envPath: string

beforeEach(() => {
  world = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-l5-paywindow-'))
  fs.mkdirSync(path.join(world, 'public'), { recursive: true })
  fs.mkdirSync(path.join(world, 'tmp'), { recursive: true })
  envPath = path.join(world, '.env.local')
  writeEnv(GREEN_ENV)
  fs.writeFileSync(path.join(world, 'public', 'version.json'), JSON.stringify(VERSION_GREEN))
})
afterEach(() => { fs.rmSync(world, { recursive: true, force: true }) })

function writeEnv(vars: Record<string, string>): void {
  fs.writeFileSync(envPath, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}
const envOverride = (over: Record<string, string | null>) => {
  const merged = { ...GREEN_ENV }
  for (const [k, v] of Object.entries(over)) { if (v === null) delete merged[k]; else merged[k] = v }
  writeEnv(merged)
}

interface Run { code: number | null; out: string; env: string; before: string; envFiles: string[] }
const readEnv = () => (fs.existsSync(envPath) ? read(envPath) : '<absent>')

/**
 * Run the operator in the fake world. The DSN points at a closed port, the fake host is never
 * reachable, and `.env.local` is captured before and compared after.
 */
function run(argv: string[] = [], shellEnv: Record<string, string | undefined> = {}): Run {
  const before = readEnv()
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    PHASE2_APP_ROOT: world,
    // The shell view is deliberately EMPTY of the things the operator must read from the FILES.
    NEXTAUTH_URL: undefined,
    DATABASE_URL: undefined,
    STRIPE_SECRET_KEY: 'sk_test_fake_key_for_the_fake_world',
    PHASE2_CLAIMS_PAY_CONFIRM: undefined,
    PHASE2_RELOAD_DEADLINE_MS: '1000',
    PHASE2_RELOAD_INTERVAL_MS: '500',
    // vitest.config.ts exports ALLOW_PLATFORM_FALLBACK=true for the WHOLE suite (a QA danger flag for the
    // Connect gate). The operator now refuses a dangerous flag armed in the SHELL as well as in the files,
    // so the harness clears them: a fixture must set what it is testing, never inherit it.
    ALLOW_PLATFORM_FALLBACK: undefined,
    CLAIMS_AUTO_APPROVE_ENABLED: undefined,
    CLAIM_AUTO_RESOLVE_ENABLED: undefined,
    GHOST_ORDER_AUTO_REFUND_ENABLED: undefined,
    PUNITIVE_CAPTURE_ENABLED: undefined,
    REFUND_VOID_ENABLED: undefined,
    TIPS_ENABLED: undefined,
  }
  for (const [k, v] of Object.entries(shellEnv)) { if (v === undefined) delete merged[k]; else merged[k] = v }
  const r = spawnSync(process.execPath, [OPERATOR, ...argv], { cwd: world, env: merged, encoding: 'utf8', timeout: 120_000 })
  return {
    code:     r.status,
    out:      (r.stdout || '') + (r.stderr || ''),
    env:      readEnv(),
    before,
    envFiles: fs.readdirSync(world).filter((f) => f.startsWith('.env')),
  }
}

/**
 * The one assertion every refusal shares, and the strongest available: the env file is BYTE-IDENTICAL to
 * what it was before the run, and no backup was produced. Comparing against the file as it WAS — rather
 * than against a fixture — also covers the cases whose fixture legitimately already carries a flag.
 */
function nothingOpened(r: Run): void {
  expect(r.code, 'a refusal must exit non-zero').not.toBe(0)
  expect(r.env, 'the operator wrote to .env.local while refusing').toBe(r.before)
  expect(r.envFiles, 'a refusal must leave no .env.local backup').toEqual(r.before === '<absent>' ? [] : ['.env.local'])
  expect(r.out).toMatch(/WINDOW OPENED BY THIS RUN: NO/)
  expect(r.out).toMatch(/MONEY MOVED BY THIS SCRIPT: NO/)
}

// ══ 1. IT IS DELIVERED REFUSING ═══════════════════════════════════════════════════════════════════

describe('D′ L5 — the pay-window operator refuses by construction in the lot that ships it', () => {
  it('⭐ CERTIFIED_SHAS is EMPTY, so no deployed build can ever open a window in this lot', () => {
    expect(code(OPERATOR)).toMatch(/const CERTIFIED_SHAS = \[\s*\]/)
    // …and the refusal that reads it names the invariant rather than merely logging.
    expect(read(OPERATOR)).toMatch(/is NOT in CERTIFIED_SHAS/)
    // Nothing at runtime may extend the list: no env var, no argument feeds it.
    expect(code(OPERATOR)).not.toMatch(/CERTIFIED_SHAS\s*[=.]\s*(process\.env|JSON\.parse|argv)/)
    expect(code(OPERATOR)).not.toMatch(/CERTIFIED_SHAS\.(push|concat|unshift)/)
  })

  it('⭐ run with no argument it is a READ-ONLY precheck: it exits non-zero and opens nothing', () => {
    const r = run()
    nothingOpened(r)
    expect(r.out).toMatch(/PRECHECK, READ-ONLY/)
  })

  it('⭐ run in window mode WITHOUT the authorization sentence it refuses, whatever else is green', () => {
    const r = run(['window'])
    nothingOpened(r)
    // It never reaches the window step here (an earlier precheck stops it), and that is itself the point:
    // every refusal is « nothing changed ». The sentence is compiled, never derived from the environment.
    expect(code(OPERATOR)).toMatch(/const CONFIRM_SENTENCE = 'I AUTHORIZE THE STAGING CLAIMS PAY WINDOW'/)
    expect(code(OPERATOR)).toMatch(/process\.env\.PHASE2_CLAIMS_PAY_CONFIRM !== CONFIRM_SENTENCE/)
  })
})

// ══ 2. THE TARGET: STAGING ONLY, PROVEN ═══════════════════════════════════════════════════════════

describe('D′ L5 — the operator refuses any target it cannot prove is staging', () => {
  it('no .env.local under the app root → refused before anything is read, and none is created', () => {
    fs.unlinkSync(envPath)
    const r = run()
    nothingOpened(r)
    expect(r.out).toMatch(/1 env: \.env\.local not found/)
    expect(fs.existsSync(envPath), 'a refusal must not create an env file').toBe(false)
  })

  it('⭐ an app root that NAMES production is refused before any read', () => {
    const prod = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-l5-prod-'))
    const root = path.join(prod, 'grubano.com')
    fs.mkdirSync(path.join(root, 'public'), { recursive: true })
    fs.writeFileSync(path.join(root, '.env.local'), read(envPath))
    fs.writeFileSync(path.join(root, 'public', 'version.json'), JSON.stringify(VERSION_GREEN))
    const r = spawnSync(process.execPath, [OPERATOR], {
      cwd: root, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, PHASE2_APP_ROOT: root, NEXTAUTH_URL: undefined, DATABASE_URL: undefined },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).not.toBe(0)
    expect(out).toMatch(/names PRODUCTION/)
    expect(read(path.join(root, '.env.local'))).not.toMatch(/REFUNDS_ENABLED\s*=\s*true/)
    fs.rmSync(prod, { recursive: true, force: true })
    // NEGATIVE CONTROL — `app.grubano.com` is staging and is NOT refused by this rule.
    expect(run().out).not.toMatch(/names PRODUCTION/)
  })

  it('⭐ the FILE view decides, not the shell: a production NEXTAUTH_URL in the files is refused, and a shell that diverges is refused too', () => {
    envOverride({ NEXTAUTH_URL: 'https://grubano.com' })
    const prod = run()
    nothingOpened(prod)
    expect(prod.out).toMatch(/STAGING ONLY/)
    // A shell prefix that points somewhere else than the files is refused rather than followed.
    writeEnv(GREEN_ENV)
    const moved = run([], { NEXTAUTH_URL: 'https://grubano.com' })
    nothingOpened(moved)
    expect(moved.out).toMatch(/diverges from the files/)
  })

  it('⭐ a production-looking database name, and an ambiguous one, are both refused', () => {
    for (const [dsn, why] of [
      ['mysql://u:p@127.0.0.1:1/deyi0010_grubano', /looks like PRODUCTION/],
      ['mysql://u:p@127.0.0.1:1/grubano_prod', /looks like PRODUCTION/],
    ] as const) {
      envOverride({ DATABASE_URL: dsn })
      const r = run()
      expect(r.code, dsn).not.toBe(0)
      expect(r.out, dsn).toMatch(why)
      expect(r.env, dsn).not.toMatch(/REFUNDS_ENABLED\s*=\s*true/)
    }
    envOverride({ DATABASE_URL: null })
    const ambiguous = run()
    expect(ambiguous.code).not.toBe(0)
    expect(ambiguous.out).toMatch(/AMBIGUOUS|no DATABASE_URL/)
  })

  it('⭐ the DSN is never printed: only the database NAME appears in the output', () => {
    const r = run()
    expect(r.out).not.toContain('mysql://')
    expect(r.out).not.toContain('guard:guard')
    expect(r.out).toMatch(/DATABASE \(name only\) = deyi0010_grubano_staging/)
    // Nor is any secret echoed.
    expect(r.out).not.toContain(GREEN_ENV.NEXTAUTH_SECRET)
    expect(r.out).not.toContain(GREEN_ENV.INTERNAL_CRON_TOKEN)
    expect(r.out).not.toContain(GREEN_ENV.STRIPE_SECRET_KEY)
    // The presence of the two it needs IS reported — presence only.
    expect(r.out).toMatch(/INTERNAL_CRON_TOKEN \(presence only\) = present/)
  })

  it('⭐ a live Stripe key is refused — and so is a shell key that DIVERGES from the files, because the files are what the application charges', () => {
    // A shell key next to a different file key: the operator would measure one Stripe account while the
    // application charged another. Refused before the mode is even judged.
    const diverged = run([], { STRIPE_SECRET_KEY: 'sk_live_not_in_a_rehearsal' })
    nothingOpened(diverged)
    expect(diverged.out).toMatch(/shell STRIPE_SECRET_KEY diverges from the files/)
    expect(diverged.out).not.toContain('sk_live_not_in_a_rehearsal')
    // A LIVE key in the FILES — the one the application actually uses — is refused too.
    envOverride({ STRIPE_SECRET_KEY: 'sk_live_not_in_a_rehearsal' })
    const live = run([], { STRIPE_SECRET_KEY: 'sk_live_not_in_a_rehearsal' })
    nothingOpened(live)
    expect(live.out).toMatch(/Stripe TEST only|Stripe key IN THE FILES is not sk_test_/)
  })

  it('⭐ a shell DATABASE_URL that diverges from the files is refused: the database MEASURED must be the one the application uses', () => {
    const diverged = run([], { DATABASE_URL: 'mysql://other:other@127.0.0.1:1/deyi0010_grubano_staging_two' })
    nothingOpened(diverged)
    expect(diverged.out).toMatch(/shell DATABASE_URL diverges from the files/)
    // The values are compared, never printed.
    expect(diverged.out).not.toContain('mysql://')
    expect(diverged.out).not.toContain('other:other')
    // A shell DSN with none in the files is ambiguous, not « the shell one wins ».
    envOverride({ DATABASE_URL: null })
    const ambiguous = run([], { DATABASE_URL: 'mysql://x:y@127.0.0.1:1/deyi0010_grubano_staging' })
    nothingOpened(ambiguous)
    expect(ambiguous.out).toMatch(/AMBIGUOUS/)
    // NEGATIVE CONTROL — the same DSN in both places is not a divergence.
    writeEnv(GREEN_ENV)
    expect(run([], { DATABASE_URL: GREEN_ENV.DATABASE_URL }).out).not.toMatch(/diverges from the files/)
  })
})

// ══ 3. THE FLAGS ══════════════════════════════════════════════════════════════════════════════════

describe('D′ L5 — the operator refuses every flag configuration the rail could not use, or must not run beside', () => {
  const cases: Array<[string, Record<string, string | null>, RegExp]> = [
    ['the product surface is off — PAYER would answer 403', { CLAIMS_SURFACE_ENABLED: null }, /CLAIMS_SURFACE_ENABLED is not exactly/],
    ['the product surface is not exactly « true »', { CLAIMS_SURFACE_ENABLED: 'TRUE' }, /CLAIMS_SURFACE_ENABLED is not exactly/],
    ['⭐ the LEGACY rehearsal lease is armed — it never opens this rail (S-14)', { CLAIMS_ENABLED: 'true' }, /legacy rehearsal lease must be absent or false/],
    ['⭐ the admin audit is off — no audit, no payment (S-30)', { ADMIN_AUDIT_ENABLED: null }, /ADMIN_AUDIT_ENABLED is not/],
    ['a refunds window is ALREADY open in the files', { REFUNDS_ENABLED: 'true' }, /already true in the files/],
    ['the session secret is absent — the rail could not sign a batch', { NEXTAUTH_SECRET: null }, /NEXTAUTH_SECRET is absent/],
    ['the internal token is absent — schema readiness is not provable', { INTERNAL_CRON_TOKEN: null }, /INTERNAL_CRON_TOKEN is absent/],
    ['an auto-approval ceiling is armed', { CLAIM_AUTO_APPROVE_MAX_CENTS: '5000' }, /auto-approval ceiling is armed/],
  ]
  for (const [name, over, why] of cases) {
    it(name, () => {
      envOverride(over)
      const r = run()
      expect(r.code, name).not.toBe(0)
      expect(r.out, name).toMatch(why)
      expect(r.env, name).toBe(r.before)
      expect(r.envFiles, name).toEqual(['.env.local'])
    })
  }

  it('⭐ every dangerous money automation is refused, one by one', () => {
    const flags = ['ALLOW_PLATFORM_FALLBACK', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED',
      'GHOST_ORDER_AUTO_REFUND_ENABLED', 'PUNITIVE_CAPTURE_ENABLED', 'REFUND_VOID_ENABLED', 'TIPS_ENABLED']
    for (const f of flags) {
      envOverride({ [f]: 'true' })
      const r = run()
      expect(r.code, f).not.toBe(0)
      expect(r.out, f).toMatch(new RegExp(`2 flag: ${f} is true`))
      expect(r.envFiles, f).toEqual(['.env.local'])
    }
    // NEGATIVE CONTROL — the same flags set to false do not refuse.
    envOverride(Object.fromEntries(flags.map((f) => [f, 'false'])))
    expect(run().out).not.toMatch(/no money automation may be armed/)
  })

  it('⭐ a dangerous automation armed in the SHELL is refused too — @next/env never overrides process.env, so the shell one is what the application reads', () => {
    writeEnv(GREEN_ENV)
    for (const f of ['ALLOW_PLATFORM_FALLBACK', 'GHOST_ORDER_AUTO_REFUND_ENABLED', 'TIPS_ENABLED']) {
      const r = run([], { [f]: 'true' })
      expect(r.code, f).not.toBe(0)
      expect(r.out, f).toMatch(new RegExp(`2 flag: ${f} is true IN THE SHELL`))
      expect(r.env, f).toBe(r.before)
    }
    // NEGATIVE CONTROL — 'false' in the shell is not armed.
    expect(run([], { TIPS_ENABLED: 'false' }).out).not.toMatch(/IN THE SHELL/)
  })
})

// ══ 4. THE DEPLOYED BUILD ═════════════════════════════════════════════════════════════════════════

describe('D′ L5 — the operator refuses a build it cannot identify or that is not develop', () => {
  it('no version.json → the deployed build cannot be identified', () => {
    fs.unlinkSync(path.join(world, 'public', 'version.json'))
    const r = run()
    nothingOpened(r)
    expect(r.out).toMatch(/version\.json unreadable/)
  })

  it('⭐ a build from another branch is refused before the host is contacted at all', () => {
    const r = run()
    nothingOpened(r)
    expect(r.out).toMatch(/the deployed branch is « main »/)
    // Proof it stopped BEFORE the network: the live-process step never printed.
    expect(r.out).not.toMatch(/\[4\] live process/)
  })

  it('⭐ NO RUN IN THIS SUITE CONTACTS STAGING: every path stops before the live-process step', () => {
    // The probe base is compiled to https://app.grubano.com, so a run that reached step 4 would issue a
    // real request to the staging host. Each representative path is re-run here and asserted to stop
    // earlier. What lies beyond is a stated coverage limit, never a silently-skipped guarantee.
    const paths: Array<[string, () => Run]> = [
      ['green fixture',        () => run()],
      ['window mode',          () => run(['window'])],
      ['authorized window',    () => run(['window'], { PHASE2_CLAIMS_PAY_CONFIRM: 'I AUTHORIZE THE STAGING CLAIMS PAY WINDOW' })],
      ['surface off',          () => { envOverride({ CLAIMS_SURFACE_ENABLED: null }); return run() }],
      ['legacy lease armed',   () => { envOverride({ CLAIMS_ENABLED: 'true' }); return run() }],
    ]
    for (const [name, go] of paths) {
      const r = go()
      expect(r.out, name).not.toMatch(/\[4\] live process/)
      expect(r.out, name).not.toMatch(/REFUND GATE \(live/)
      expect(r.code, name).not.toBe(0)
      writeEnv(GREEN_ENV)
    }
  })
})

// ══ 5. THE COMPILED GUARANTEES ════════════════════════════════════════════════════════════════════

describe('D′ L5 — what the operator can never do, whatever any caller asks', () => {
  it('⭐ it may write exactly two keys, and a CLAIMS flag is refused by a compiled guard', () => {
    const src = code(OPERATOR)
    expect(src).toMatch(/const WRITABLE_KEYS = Object\.freeze\(\['REFUNDS_WINDOW_UNTIL', 'REFUNDS_ENABLED'\]\)/)
    expect(src).toMatch(/const FORBIDDEN_KEYS = Object\.freeze\(\['CLAIMS_ENABLED', 'CLAIMS_WINDOW_UNTIL', 'CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'\]\)/)
    expect(src).toMatch(/if \(FORBIDDEN_KEYS\.includes\(key\)\) throw/)
    expect(src).toMatch(/if \(!WRITABLE_KEYS\.includes\(key\)\) throw/)
    // Every write goes through that guard: the reused primitive is never called directly with a key.
    const direct = Array.from(src.matchAll(/GATE\.writeFlag\(/g))
    expect(direct, 'GATE.writeFlag is called once, inside the guard').toHaveLength(1)
  })

  it('⭐ it never moves money itself: no Stripe write verb, no refund row, no claim write, no e-mail', () => {
    const src = code(OPERATOR)
    expect(src).not.toMatch(/refunds\.create|transfers\.create|createReversal|paymentIntents\.(create|capture|confirm)/)
    expect(src).not.toMatch(/\.refund\.create|\.claim\.(update|updateMany|upsert|create)/)
    expect(src).not.toMatch(/sendTransactional|sendClaim|nodemailer|@getbrevo/)
    expect(src).not.toMatch(/executeRefund|triggerClaimRefund/)
    // Its only Stripe reads are balance and payment reads for the T-42 funding measurement.
    for (const m of src.match(/stripe\.[a-zA-Z.]+/g) ?? []) {
      expect(m, 'an unexpected Stripe surface').toMatch(/^stripe\.(balance|paymentIntents|charges|accounts)\.(retrieve|list)$/)
    }
  })

  it('⭐ the OPEN writes the lease first and the CLOSE expires the lease first — a flag without a lease authorizes nothing', () => {
    const src = read(OPERATOR)
    const open = src.indexOf("writeRefundFlag(envFile, 'REFUNDS_WINDOW_UNTIL', leaseUntil")
    const openFlag = src.indexOf("writeRefundFlag(envFile, 'REFUNDS_ENABLED', 'true'")
    expect(open).toBeGreaterThan(0)
    expect(openFlag).toBeGreaterThan(open)
    const closeLease = src.indexOf("writeRefundFlag(envFile, 'REFUNDS_WINDOW_UNTIL', past")
    const closeFlag = src.indexOf("writeRefundFlag(envFile, 'REFUNDS_ENABLED', 'false'")
    expect(closeLease).toBeGreaterThan(openFlag)
    expect(closeFlag).toBeGreaterThan(closeLease)
    // The re-freeze is armed BEFORE the first write, or a signal in between would escape it.
    expect(src.indexOf('GATE.armRefreeze(envFile, stamp)')).toBeLessThan(open)
  })

  it('⭐ the lease is bounded by the application’s own compiled ceiling, and a longer window is REFUSED, never shortened', () => {
    const src = code(OPERATOR)
    expect(src).toMatch(/const REFUND_LEASE_MAX_MS = 30 \* 60 \* 1000/)
    expect(src).toMatch(/Math\.min\(WINDOW_MS \+ LEASE_SLACK_MS, REFUND_LEASE_MAX_MS\)/)
    const r = run(['window'], { PHASE2_CLAIMS_PAY_WINDOW_MS: String(40 * 60 * 1000) })
    nothingOpened(r)
  })

  it('the selection is recomputed with the SHIPPED shared core, never with a copy of the query', () => {
    const src = code(OPERATOR)
    expect(src).toMatch(/claims-payable-core/)
    expect(src).not.toMatch(/arbitrationDecision:\s*'approved'/)
    expect(src).not.toMatch(/approvedAmountCents:\s*\{\s*not:\s*null\s*\}/)
    expect(read(OPERATOR)).toMatch(/payable core not shipped/)
  })

  /**
   * The module guards its own entry point (`require.main === module`), so its seams can be exercised
   * directly. It is still done in a CHILD process: requiring it here would install
   * phase2-refund-gate's signal and uncaught-error handlers in the vitest worker, which call
   * process.exit — inert with respect to writes (the re-freeze refuses unless armed), but they would
   * mask an unrelated failure of this suite.
   */
  function seam(body: string): { code: number | null; out: string } {
    const script = `const OP = require(${JSON.stringify(OPERATOR)});\n${body}`
    const r = spawnSync(process.execPath, ['-e', script], {
      cwd: world, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, PHASE2_APP_ROOT: world, NEXTAUTH_URL: undefined, DATABASE_URL: undefined },
    })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  it('⭐ requiring the module opens nothing: the entry point is guarded and the env file is untouched', () => {
    const before = read(envPath)
    const r = seam('console.log("REQUIRED", typeof OP.writeRefundFlag, OP.CERTIFIED_SHAS.length)')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/REQUIRED function 0/)
    expect(read(envPath)).toBe(before)
    expect(fs.readdirSync(world).filter((f) => f.startsWith('.env'))).toEqual(['.env.local'])
  })

  it('⭐ writeRefundFlag THROWS for every CLAIMS key and for any key outside the two writable ones, and writes nothing', () => {
    const before = read(envPath)
    const r = seam(`
      const env = ${JSON.stringify(envPath)};
      const refused = [];
      for (const k of [...OP.FORBIDDEN_KEYS, 'DATABASE_URL', 'TIPS_ENABLED', 'NEXTAUTH_SECRET']) {
        try { OP.writeRefundFlag(env, k, 'true', 'seam'); refused.push(k + ':WROTE') }
        catch (e) { refused.push(k + ':THREW') }
      }
      console.log(JSON.stringify(refused));
    `)
    expect(r.code).toBe(0)
    const refused = JSON.parse(r.out.trim().split('\n').pop() as string) as string[]
    expect(refused.every((x) => x.endsWith(':THREW')), r.out).toBe(true)
    expect(refused).toContain('CLAIMS_ENABLED:THREW')
    expect(refused).toContain('CLAIMS_SURFACE_ENABLED:THREW')
    expect(read(envPath), 'a refused write must leave the file byte-identical').toBe(before)
    expect(fs.readdirSync(world).filter((f) => f.startsWith('.env'))).toEqual(['.env.local'])
  })

  it('⭐ T-42: a short balance and an UNREADABLE balance are both shortfalls — « not measured » is never « funded »', () => {
    const r = seam(`
      const groups = new Map([
        ['acct_funded',     { dest: 'acct_funded',     grossCents: 500,  available: 500 }],
        ['acct_short',      { dest: 'acct_short',      grossCents: 1000, available: 999 }],
        ['acct_unreadable', { dest: 'acct_unreadable', grossCents: 100,  available: null }],
      ]);
      console.log(JSON.stringify(OP.fundingShortfalls(groups).map((s) => s.dest)));
    `)
    expect(r.code).toBe(0)
    const short = JSON.parse(r.out.trim().split('\n').pop() as string) as string[]
    // Exactly at the gross sum is funded; one cent short is not; unreadable is a shortfall by default.
    expect(short.sort()).toEqual(['acct_short', 'acct_unreadable'])
  })

  it('⭐ T-42 groups by Connect destination and sizes each group with the shared core’s own sum', () => {
    const r = seam(`
      const pi = (id, dest, opts) => ({ id, currency: 'eur', livemode: false,
        transfer_data: dest ? { destination: dest } : null,
        latest_charge: { id: 'ch_' + id, disputed: (opts && opts.disputed) === true } });
      const world = {
        pi_a: pi('pi_a', 'acct_1'), pi_b: pi('pi_b', 'acct_1'),
        pi_c: pi('pi_c', 'acct_2'), pi_d: pi('pi_d', null), pi_e: pi('pi_e', 'acct_3', { disputed: true }),
      };
      const adapter = {
        retrievePaymentIntent: async (id) => world[id],
        balanceFor: async () => ({ available: [{ currency: 'eur', amount: 100000 }], pending: [] }),
        retrieveAccount: async () => ({ settings: { payouts: { schedule: { interval: 'manual' } } } }),
      };
      const core = require(${JSON.stringify(path.join(process.cwd(), 'lib', 'claims-payable-core.js').replace(/\\\\/g, '/'))});
      const entries = [
        { claimId: 'c1', paymentIntentId: 'pi_a', approvedAmountCents: 500 },
        { claimId: 'c2', paymentIntentId: 'pi_b', approvedAmountCents: 250 },
        { claimId: 'c3', paymentIntentId: 'pi_c', approvedAmountCents: 700 },
        { claimId: 'c4', paymentIntentId: 'pi_d', approvedAmountCents: 900 },
        { claimId: 'c5', paymentIntentId: 'pi_e', approvedAmountCents: 100 },
        { claimId: 'c6', paymentIntentId: null,   approvedAmountCents: 100 },
      ];
      OP.measureFundingByAccount(adapter, entries, core).then((g) => {
        console.log(JSON.stringify(Array.from(g.values()).map((x) => [x.dest, x.grossCents, x.rows.length])));
      });
    `)
    expect(r.code).toBe(0)
    const groups = JSON.parse(r.out.trim().split('\n').pop() as string) as Array<[string, number, number]>
    // acct_1 carries both of its claims and their SUM; acct_2 its own. A payment with no destination,
    // a DISPUTED charge and a claim with no payment are each left out with an anomaly — never grouped
    // into a total that would make a window look funded.
    expect(groups).toEqual([['acct_1', 750, 2], ['acct_2', 700, 1]])
    expect(r.out).toMatch(/no Connect destination/)
    expect(r.out).toMatch(/is DISPUTED/)
    expect(r.out).toMatch(/carries no PaymentIntent/)
  })

  it('it takes the shared phase2 operator lock, so a pay window and a Mode B rehearsal can never run together', () => {
    const src = code(OPERATOR)
    expect(src).toMatch(/const LOCK_FILE = MODEB\.LOCK_FILE/)
    expect(src).toMatch(/takeLock\(\)/)
    // A live lock refuses; a dead one is reclaimed and named.
    expect(read(OPERATOR)).toMatch(/another phase2 operator holds the lock/)
    expect(read(OPERATOR)).toMatch(/STALE OPERATOR LOCK/)
  })
})
