import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { isLegalInfoComplete, LEGAL_INFO, type LegalInfo } from '../lib/legal-info'

/* js-yaml ships no type declarations in this repo, and adding @types just for a test would put a
   dependency on the critical path. Required through createRequire with the one shape used here —
   parsing the workflow properly matters: a regex over YAML would assert on text that is not the
   structure GitHub Actions actually executes. */
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (s: string) => unknown }

/**
 * P0 GO-TO-PRODUCTION — the four changes that make a first production deploy possible and survivable.
 *
 * Context: production has NEVER been deployed. `deploy-production.yml` had exactly one run (2026-05-26,
 * on develop, failure, 0 s). Two FTP fixes and three verification steps existed only on the PROVEN
 * staging pipeline, and the emergency-hotfix script could drop production tables. None of this was a
 * ticket — it surfaced from asking "how do we actually launch".
 */

const read = (p: string) => readFileSync(p, 'utf8')
const wf = (f: string) => yaml.load(read(`.github/workflows/${f}`)) as {
  jobs: Record<string, { needs?: unknown; steps: Array<{
    name?: string
    run?: string
    with?: { exclude?: string }
    /* the real YAML key is hyphenated; TypeScript needs it spelled as it appears in the file */
    'continue-on-error'?: boolean
  }> }>
}
const deploySteps = (f: string) => wf(f).jobs.deploy.steps
const stepNamed = (f: string, re: RegExp) => deploySteps(f).find((s) => re.test(s.name ?? ''))
const excludes = (f: string) => {
  const s = deploySteps(f).find((x) => x.with?.exclude)
  return (s!.with!.exclude as string).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
}

// ══ PROD-1 ═══════════════════════════════════════════════════════════════════════════════════════
describe('PROD-1 — no script can drop production tables', () => {
  it('no EXECUTABLE line anywhere in scripts/ runs `prisma db push --accept-data-loss`', () => {
    /* It lived at deploy-production.sh:69 and deploy-staging.sh:51, and the production file's own
       header invited the operator to use it "for emergency hot-fixes when you need to deploy without
       CI" — i.e. on the night something is already going wrong, against real orders. Its only backup
       was `.next/server`; the database was not backed up at all. `--accept-data-loss` authorises
       Prisma to DROP columns and tables on any drift. */
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
    const files = walk('scripts').filter((f) => /\.(sh|js|mjs|cjs|ts)$/.test(f))
    expect(files.length).toBeGreaterThan(20)

    /* Only a line that would RUN it counts. Per-line prefix sniffing is NOT enough, and that is how
       this check first failed: the two staging migrate operators discuss the flag inside a block
       comment whose continuation lines begin with a backtick, so both were reported as offenders.
       Block comments are blanked first (newlines preserved so line numbers stay true), then line
       comments are skipped — the same two-stage shape the S-21 scanner needed. */
    const BLOCK = new RegExp('/\\*[\\s\\S]*?\\*/', 'g')
    const offenders: string[] = []
    for (const f of files) {
      const stripped = read(f).replace(BLOCK, (m) => m.replace(/[^\n]/g, ' '))
      stripped.split('\n').forEach((l, i) => {
        if (!l.includes('accept-data-loss')) return
        const t = l.trimStart()
        if (t.startsWith('#') || t.startsWith('//')) return
        offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('and the two scripts still SAY why it is gone, so nobody re-adds it', () => {
    for (const f of ['scripts/server/deploy-production.sh', 'scripts/server/deploy-staging.sh']) {
      expect(read(f), f).toMatch(/PROD-1/)
      expect(read(f), f).toMatch(/accept-data-loss/)   // in a comment — asserted above
    }
  })
})

// ══ PROD-2 ═══════════════════════════════════════════════════════════════════════════════════════
describe('PROD-2 — the production pipeline is the PROVEN staging pipeline', () => {
  it('every FTP exclusion staging relies on is present in production', () => {
    /* Each of these was added to staging AFTER a measured failure that ABORTED THE WHOLE SYNC —
       leaving post-deploy, restart and health check all skipped:
         node_modules/**  → 550 "Can't change directory to node_modules" (the path is a symlink)
         .htaccess        → 553 Permission denied on STOR
         @vercel/og/**    → thousands of nested binary STORs
       Production had none of the three. */
    const S = excludes('deploy-staging.yml')
    const P = excludes('deploy-production.yml')
    expect(S.filter((x) => !P.includes(x)), 'in staging but missing from production').toEqual([])
    for (const must of ['node_modules', 'node_modules/**', '.htaccess', '.env*',
                        'node_modules/next/dist/compiled/@vercel/og/**']) {
      expect(P, must).toContain(must)
    }
  })

  it('production no longer WRITES an .htaccess into the upload', () => {
    /* Two outcomes, both bad: 553 aborts the sync, or it succeeds and replaces the live
       Apache/Passenger configuration with a 7-directive printf — destroying the apex→www redirect.
       Passenger is demonstrably already configured on the host (it serves its own error page). */
    const src = read('.github/workflows/deploy-production.yml')
    expect(src).not.toMatch(/> deploy-temp\/\.htaccess/)
    expect(src).toMatch(/PROD-2 — \.htaccess is DELIBERATELY NOT WRITTEN/)
  })

  it('production ships the two shared cores its server operators require()', () => {
    const src = read('.github/workflows/deploy-production.yml')
    for (const lib of ['lib/ledger-check-core.js', 'lib/claims-payable-core.js']) {
      expect(src, lib).toContain(lib)
    }
  })

  it('the health check is anchored on THIS run\'s SHA, and the old always-green check is gone', () => {
    /* The old gate was `curl -sL www.grubano.com/dashboard == 200`. It could not fail for the reason
       it existed: /dashboard is auth-gated, middleware redirects to the login page, -L follows it,
       200 comes back — from ANY build, including a process that never restarted. */
    const src = read('.github/workflows/deploy-production.yml')
    /* Narrowed: the replacement comment QUOTES the old command in order to explain why it is gone, so
       a bare ban on the string refuses its own documentation. What must not exist is a line that RUNS
       it. (Third time this session a source-scanning assertion had to be taught not to read itself.) */
    const runsOldCheck = src.split('\n')
      .filter((l) => /grubano\.com\/dashboard/.test(l))
      .filter((l) => !l.trimStart().startsWith('#'))
    expect(runsOldCheck).toEqual([])
    const hc = stepNamed('deploy-production.yml', /Health check .*expected SHA/)
    expect(hc, 'the SHA-anchored health check is missing').toBeTruthy()
    expect(hc!.run).toContain('EXPECTED="${{ github.sha }}"')
    expect(hc!.run).toContain('grubano.com/version.json')
    expect(hc!.run).toMatch(/SERVED" = "\$EXPECTED"/)
    // and the extraction is byte-identical to the proven staging one
    const line = (t: string) => t.split('\n').find((l) => l.includes('sed -n'))!.trim()
    expect(line(hc!.run!)).toBe(line(stepNamed('deploy-staging.yml', /Health check/)!.run!))
  })

  it('a stale Prisma client can no longer pass as a healthy deploy', () => {
    /* version.json is STATIC: it proves the upload, never that the process reaches the database. The
       post-deploy `prisma generate` runs in an SSH step that is continue-on-error and has timed out
       3/3 against this host; staging has already served "new schema + new code + STALE client". */
    const db = stepNamed('deploy-production.yml', /Database reachable/)
    expect(db, 'the DB-reachability gate is missing').toBeTruthy()
    expect(db!.run).toContain('/api/restaurants')
    expect(db!.run).toMatch(/exit 1/)
  })

  it('client bundle integrity is enforced, byte-identical to staging\'s proven matcher', () => {
    const p = stepNamed('deploy-production.yml', /bundle integrity/)
    const s = stepNamed('deploy-staging.yml', /bundle integrity/)
    expect(p, 'the bundle-integrity gate is missing').toBeTruthy()
    const assets = (t: string) => t.split('\n').find((l) => l.includes('ASSETS='))!.trim()
    expect(assets(p!.run!)).toBe(assets(s!.run!))
    expect(p!.run).toContain('chunks/webpack-')
  })

  it('a restart no longer depends on SSH alone', () => {
    /* Both SSH steps are continue-on-error and o2switch has timed out SSH from GitHub runners 3/3.
       When that happens the files land and the OLD process keeps serving. */
    const ftps = stepNamed('deploy-production.yml', /FTPS/)
    expect(ftps, 'the FTPS restart fallback is missing').toBeTruthy()
    expect(ftps!.run).toContain('ftp://muscadier.o2switch.net/grubano.com/tmp/restart.txt')
    // continue-on-error is deliberate: this step can only ADD a restart attempt, never remove one.
    expect(ftps!['continue-on-error']).toBe(true)
  })

  it('the three blocking gates sit AFTER the restart, and the deploy job still needs test', () => {
    const names = deploySteps('deploy-production.yml').map((s) => s.name ?? '')
    const at = (re: RegExp) => names.findIndex((n) => re.test(n))
    expect(at(/FTPS/)).toBeLessThan(at(/Health check/))
    expect(at(/Health check/)).toBeLessThan(at(/Database reachable/))
    expect(at(/Database reachable/)).toBeLessThan(at(/bundle integrity/))
    expect(wf('deploy-production.yml').jobs.deploy.needs).toBe('test')
  })

  it('both workflows still parse, and the money-OUT build gate (T-123) survived', () => {
    for (const f of ['deploy-production.yml', 'deploy-staging.yml']) {
      const d = wf(f)
      expect(Object.keys(d.jobs), f).toContain('deploy')
      expect(read(`.github/workflows/${f}`), f).toContain('npm run check:flags')
    }
  })
})

// ══ PROD-3 ═══════════════════════════════════════════════════════════════════════════════════════
describe('PROD-3 — production can be backed up, by the SAME verified code', () => {
  const OP = join(process.cwd(), 'scripts/server/staging-backup.js')
  const PROD_DSN = 'mysql://u:p@h/deyi0010_grubano'
  const STAGING_DSN = 'mysql://u:p@h/deyi0010_grubano_staging'
  const ATTEST = 'I AUTHORIZE A PRODUCTION DATABASE BACKUP'

  /** Run the REAL operator in a throwaway cwd. A guard that has never been EXECUTED is not a guard. */
  const run = (args: string[], env: Record<string, string | undefined>) => {
    const dir = mkdtempSync(join(tmpdir(), 'grubano-bk-'))
    try {
      mkdirSync(join(dir, 'out'), { recursive: true })
      const merged: NodeJS.ProcessEnv = { ...process.env, GRUBANO_BACKUP_DIR: join(dir, 'out'), ...env }
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete merged[k]
      const r = spawnSync(process.execPath, [OP, ...args], { cwd: dir, env: merged, encoding: 'utf8', timeout: 60_000 })
      return `${r.stdout ?? ''}${r.stderr ?? ''}`
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  it('DEFAULT is staging, and a production DSN is refused there (unchanged behaviour)', () => {
    const out = run([], { DATABASE_URL: PROD_DSN, NEXTAUTH_URL: 'https://grubano.com', GRUBANO_BACKUP_CONFIRM: undefined })
    expect(out).toContain('TARGET=STAGING')
    expect(out).toMatch(/staging-proof: target looks like PRODUCTION/)
  })

  it('--production without the exact attestation is refused BEFORE any environment comparison', () => {
    const out = run(['--production'], { DATABASE_URL: PROD_DSN, NEXTAUTH_URL: 'https://grubano.com', GRUBANO_BACKUP_CONFIRM: undefined })
    expect(out).toMatch(/production-proof: GRUBANO_BACKUP_CONFIRM is not the exact attestation/)
  })

  it('--production pointed at STAGING is refused — a false backup is worse than none', () => {
    /* This is the dangerous case: someone runs --production, gets a PASS, and the file in
       ~/grubano-backups is the one they will restore from. */
    const out = run(['--production'], { DATABASE_URL: STAGING_DSN, NEXTAUTH_URL: 'https://app.grubano.com', GRUBANO_BACKUP_CONFIRM: ATTEST })
    expect(out).toMatch(/production-proof: --production was asked for but the target looks like STAGING/)
  })

  it('POSITIVE CONTROLS — both targets pass their guard and reach the manifest stage', () => {
    // Without these two, every assertion above is satisfied by an operator that refuses everything.
    const staging = run([], { DATABASE_URL: STAGING_DSN, NEXTAUTH_URL: 'https://app.grubano.com', GRUBANO_BACKUP_CONFIRM: undefined })
    expect(staging).toContain('TARGET=STAGING')
    expect(staging).toMatch(/3 (prisma|manifest)/)          // past the guard; fails later on a fake DB

    const prod = run(['--production'], { DATABASE_URL: PROD_DSN, NEXTAUTH_URL: 'https://grubano.com', GRUBANO_BACKUP_CONFIRM: ATTEST })
    expect(prod).toContain('TARGET=PRODUCTION')
    expect(prod).toMatch(/3 (prisma|manifest)/)
  })

  it('the dump filename carries the target, so two dumps cannot be confused', () => {
    expect(read('scripts/server/staging-backup.js')).toContain('`${TARGET}-${LABEL}-${stamp}.sql`')
  })

  it('the verification block exists ONCE — no copied twin operator', () => {
    /* A money-safety control in three places is something this repository has already paid for
       (T-108). The size / marker / INSERT / gzip round-trip / sha256 / manifest checks must live in
       exactly one file. */
    const withDumpMarker = readdirSync('scripts/server')
      .filter((f) => f.endsWith('.js'))
      .filter((f) => read(join('scripts/server', f)).includes('-- Dump completed'))
    expect(withDumpMarker.sort()).toEqual(['dprime-staging-migrate.js', 'phase1-staging-migrate.js', 'staging-backup.js'])
  })
})

// ══ PROD-4 ═══════════════════════════════════════════════════════════════════════════════════════
describe('PROD-4 — no numbered invoice is issued with a placeholder legal identity', () => {
  const ROUTE = 'app/api/admin/invoices/generate/route.ts'

  it('the guard refuses before auth and before any issuance', () => {
    /* A numbered invoice cannot be unissued. lib/invoice.issuerIdentity() reads LEGAL_INFO.editor
       verbatim, and scripts/cron/monthly-invoices.js calls this route unattended on a cPanel
       schedule (0 7 1 * *) — the first of the month after go-live would mint a legally defective,
       non-rescindable series. Order is the property: the refusal must precede everything. */
    const src = read(ROUTE)
    const guard = src.indexOf('isLegalInfoComplete()')
    expect(guard, 'the guard is absent').toBeGreaterThan(0)
    // …compared against the CALL, not the import: `getServerSession` and `issueInvoice` both appear in
    // the import block at the top of the file, which is trivially before any guard.
    expect(guard).toBeLessThan(src.indexOf('getServerSession(authOptions)'))
    expect(guard).toBeLessThan(src.indexOf('await issueInvoice('))
    expect(src).toContain("code:  'legal_identity_incomplete'")
    expect(src).toMatch(/409/)
  })

  it('it has no bypass — no env flag can open it', () => {
    const src = read(ROUTE)
    const block = src.slice(src.indexOf('PROD-4'), src.indexOf('legal_identity_incomplete') + 200)
    expect(block).not.toMatch(/process\.env/)
  })

  it('the guard is LIVE today: the real legal identity is still incomplete', () => {
    expect(isLegalInfoComplete()).toBe(false)
  })

  it('POSITIVE CONTROL — with every required fact filled, the guard opens', () => {
    // Otherwise the assertion above is indistinguishable from a function that always returns false,
    // and the founder could fill legal-info and still be refused.
    const filled = JSON.parse(JSON.stringify(LEGAL_INFO)) as LegalInfo
    const fill = (o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && v.startsWith('[[À COMPLÉTER')) o[k] = 'valeur réelle'
        else if (v && typeof v === 'object') fill(v as Record<string, unknown>)
      }
    }
    fill(filled as unknown as Record<string, unknown>)
    expect(isLegalInfoComplete(filled)).toBe(true)
  })
})
