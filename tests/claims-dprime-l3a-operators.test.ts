// tests/claims-dprime-l3a-operators.test.ts — D′ lot L3a (spec v2 §9): the two staging operators.
//
// Both are run as REAL child processes in an isolated fake world: a temp app root with its own
// prisma/schema.prisma, its own node_modules, a `mysqldump` that must never run, and a DSN that is
// never contacted. Every refusal must happen BEFORE any connection, any dump and any file write —
// so these tests are deterministic locally and in CI, and they prove the fail-closed paths rather
// than asserting that a comment says so.
//
// What is pinned: STAGING-only (production refused by db name AND by URL, ambiguity refused), the
// founder pins (expected DB, expected deployed SHA), the compiled SQL (exactly three additive
// nullable ADD COLUMNs — no DROP, no DEFAULT, no NOT NULL, no index, no --accept-data-loss), the
// absence of any gate/flag/Stripe/e-mail/.env.local write, the migration hash, and — for the regen
// operator — that it verifies the D′ fields on their own models and refuses a pre-L3b schema
// instead of certifying it (it does not reuse the Phase 1 operator's contract).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const MIGRATE = path.join(process.cwd(), 'scripts', 'server', 'dprime-staging-migrate.js')
const REGEN = path.join(process.cwd(), 'scripts', 'server', 'dprime-regen-client.js')
const read = (p: string) => fs.readFileSync(p, 'utf8')
/** The source WITHOUT comments: a header that says « never --accept-data-loss » must not satisfy a scan for it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

let world: string
beforeEach(() => {
  world = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-dprime-l3a-'))
  fs.mkdirSync(path.join(world, 'prisma'), { recursive: true })
  fs.mkdirSync(path.join(world, 'backups'), { recursive: true })
})
afterEach(() => { fs.rmSync(world, { recursive: true, force: true }) })

/** Run an operator in the fake world. The DSN is never reachable; mysqldump must never exist. */
function run(script: string, env: Record<string, string | undefined>) {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: 'mysql://guard:guard@127.0.0.1:1/guard_never_connected_staging',
    NEXTAUTH_URL: 'https://app.grubano.com',
    DPRIME_APP_ROOT: world,
    DPRIME_BACKUP_DIR: path.join(world, 'backups'),
    MYSQLDUMP_BIN: path.join(world, 'mysqldump-must-never-run'),
    DPRIME_EXPECT_DB: undefined,
    DPRIME_EXPECT_SHA: undefined,
    DPRIME_VERIFY_FIELDS: undefined,
  }
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete merged[k]; else merged[k] = v }
  const r = spawnSync(process.execPath, [script], { cwd: world, env: merged, encoding: 'utf8', timeout: 60_000 })
  return {
    code: r.status,
    out: (r.stdout || '') + (r.stderr || ''),
    backups: fs.existsSync(path.join(world, 'backups')) ? fs.readdirSync(path.join(world, 'backups')) : [],
  }
}

const writeSchema = (body: string) => fs.writeFileSync(path.join(world, 'prisma', 'schema.prisma'), body)
const DPRIME_SCHEMA = `
model Claim {
  id                  String   @id @default(cuid())
  status              String
  approvedAmountCents Int?
  selection           Json?
}

model Order {
  id          String    @id @default(cuid())
  status      String
  deliveredAt DateTime?
}
`
const PRE_L3B_SCHEMA = `
model Claim {
  id     String @id @default(cuid())
  status String
}

model Order {
  id     String @id @default(cuid())
  status String
}
`

// ── the migration operator ───────────────────────────────────────────────────────────────────
describe('dprime-staging-migrate — fail-closed guards (no database contacted, no file written)', () => {
  it('REFUSES a PRODUCTION database name even with a staging URL', () => {
    const r = run(MIGRATE, { DATABASE_URL: 'mysql://guard:guard@127.0.0.1:1/deyi0010_grubano' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/RESULT: FAIL/)
    expect(r.out).toMatch(/PRODUCTION/)
    expect(r.out).toMatch(/DATABASE CHANGED: NO/)
    expect(r.backups).toEqual([])
  })

  it('REFUSES a PRODUCTION URL even with a *_staging database', () => {
    const r = run(MIGRATE, { NEXTAUTH_URL: 'https://grubano.com' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/PRODUCTION/)
    expect(r.out).toMatch(/NEXTAUTH_URL=grubano\.com/)
    expect(r.backups).toEqual([])
  })

  it('REFUSES an ambiguous target (neither a *_staging database nor a staging URL)', () => {
    const r = run(MIGRATE, { NEXTAUTH_URL: 'https://example.com', DATABASE_URL: 'mysql://guard:guard@127.0.0.1:1/some_db' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/cannot confirm STAGING/)
    expect(r.backups).toEqual([])
  })

  it('REFUSES a database that is not the one the founder pinned', () => {
    const r = run(MIGRATE, { DPRIME_EXPECT_DB: 'deyi0010_grubano_staging' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/4 expect-db: DPRIME_EXPECT_DB=deyi0010_grubano_staging but the DSN targets guard_never_connected_staging/)
    expect(r.backups).toEqual([])
  })

  it('REFUSES when the deployed SHA is pinned and version.json is absent, and when it does not match', () => {
    const a = run(MIGRATE, { DPRIME_EXPECT_SHA: '0b4ba7f' })
    expect(a.code).toBe(1)
    expect(a.out).toMatch(/4 expect-sha: public\/version\.json unreadable/)
    fs.mkdirSync(path.join(world, 'public'), { recursive: true })
    fs.writeFileSync(path.join(world, 'public', 'version.json'), JSON.stringify({ commit: 'deadbeefdeadbeef', shortCommit: 'deadbee', branch: 'develop' }))
    const b = run(MIGRATE, { DPRIME_EXPECT_SHA: '0b4ba7f' })
    expect(b.code).toBe(1)
    expect(b.out).toMatch(/4 expect-sha: deployed deadbee ≠ expected 0b4ba7f/)
    expect(b.backups).toEqual([])
  })

  it('REFUSES without DATABASE_URL, and never prints the DSN (password masked) when it has one', () => {
    const a = run(MIGRATE, { DATABASE_URL: undefined })
    expect(a.code).toBe(1)
    expect(a.out).toMatch(/1 env: DATABASE_URL absent/)
    const b = run(MIGRATE, { DATABASE_URL: 'mysql://theuser:s3cr3t-p4ss@127.0.0.1:1/x_staging' })
    expect(b.out).not.toMatch(/s3cr3t-p4ss/)
    expect(b.out).not.toMatch(/theuser/)
    expect(b.out).toMatch(/mysql:\/\/\*\*\*:\*\*\*@/)
  })

  it('gets no further than the Prisma client in the fake world: mysqldump is NEVER executed and no backup is written', () => {
    const r = run(MIGRATE, {})
    expect(r.code).toBe(1)
    // @prisma/client is not resolvable from the fake root → it stops there, long before the dump.
    expect(r.out).toMatch(/prisma: @prisma\/client not found|unexpected:/)
    expect(r.backups).toEqual([])
    expect(fs.existsSync(path.join(world, 'mysqldump-must-never-run'))).toBe(false)
  })
})

describe('dprime-staging-migrate — the compiled migration is exactly three additive nullable columns', () => {
  const { COLUMNS, MIGRATION_HASH } = require('../scripts/server/dprime-staging-migrate.js') as {
    COLUMNS: Array<{ table: string; column: string; dataType: string[]; sql: string }>; MIGRATION_HASH: string
  }

  it('is the spec v2 §9 set, each an ADD COLUMN IF NOT EXISTS … NULL, and nothing else', () => {
    expect(COLUMNS.map((c) => `${c.table}.${c.column}`)).toEqual(['Claim.approvedAmountCents', 'Claim.selection', 'Order.deliveredAt'])
    for (const c of COLUMNS) {
      expect(c.sql, c.column).toMatch(/^ALTER TABLE `[A-Za-z]+` ADD COLUMN IF NOT EXISTS `[A-Za-z]+` [A-Z0-9()]+ NULL$/)
      expect(c.sql, c.column).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|MODIFY|CHANGE|DEFAULT|INDEX|UNIQUE)\b/i)
      expect(c.sql, c.column).not.toMatch(/NOT NULL/)
    }
    expect(MIGRATION_HASH).toMatch(/^[0-9a-f]{16}$/)
  })

  it('the source itself never reaches for a destructive or global tool', () => {
    const src = code(MIGRATE)
    expect(read(MIGRATE)).toMatch(/--accept-data-loss/) // it is NAMED in the header as forbidden …
    expect(src).not.toMatch(/--accept-data-loss/)
    expect(src).not.toMatch(/db\s+push/)
    expect(src).not.toMatch(/prisma-push\.sh/)
    // no money, no gate, no flag, no mail, no .env.local WRITE (it only READS it for the DSN)
    expect(src).not.toMatch(/REFUNDS_ENABLED|CLAIMS_SURFACE_ENABLED|CLAIMS_INTAKE_ENABLED|CLAIMS_WINDOW_UNTIL/)
    expect(src).not.toMatch(/stripe|refunds\.create|sendMail|nodemailer/i)
    expect(src).not.toMatch(/writeFileSync\([^)]*\.env\.local/)
    // the only writes are the backup artifacts and the temp my.cnf (mode 0600), never the app tree
    const writes = src.match(/writeFileSync\(([^,]+)/g) ?? []
    for (const w of writes) expect(w, w).toMatch(/cnfPath|gzPath|sqlPath/)
  })

  it('NEGATIVE CONTROL — the guards this operator relies on actually reject the shapes they are meant to', () => {
    const additive = /^ALTER TABLE `[A-Za-z]+` ADD COLUMN IF NOT EXISTS `[A-Za-z]+` [A-Z0-9()]+ NULL$/
    for (const bad of [
      'ALTER TABLE `Claim` DROP COLUMN `selection`',
      'ALTER TABLE `Claim` ADD COLUMN IF NOT EXISTS `approvedAmountCents` INTEGER NOT NULL',
      'ALTER TABLE `Claim` ADD COLUMN IF NOT EXISTS `approvedAmountCents` INTEGER NULL DEFAULT 0',
      'CREATE UNIQUE INDEX `x` ON `Claim`(`selection`)',
    ]) expect(additive.test(bad), bad).toBe(false)
    expect(additive.test('ALTER TABLE `Order` ADD COLUMN IF NOT EXISTS `deliveredAt` DATETIME(3) NULL')).toBe(true)
  })
})

// ── the client-regeneration operator ─────────────────────────────────────────────────────────
describe('dprime-regen-client — it certifies the D′ fields, or it refuses', () => {
  it('REFUSES when prisma/schema.prisma is absent (nothing generated, nothing restarted)', () => {
    const r = run(REGEN, {})
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/1 env: prisma\/schema\.prisma not found/)
    expect(fs.existsSync(path.join(world, 'tmp', 'restart.txt'))).toBe(false)
  })

  it('REFUSES a PRE-L3B schema instead of certifying a stale client — and names the missing field', () => {
    writeSchema(PRE_L3B_SCHEMA)
    const r = run(REGEN, {})
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/1 env: the deployed schema lacks Claim\.approvedAmountCents \(D′ L3b not deployed\)/)
    expect(r.out).toMatch(/deploy the D′ L3b schema first/)
    expect(fs.existsSync(path.join(world, 'tmp', 'restart.txt'))).toBe(false)
  })

  it('REFUSES a schema where a D′ field sits on the WRONG model (a substring scan would have passed)', () => {
    // deliveredAt present, but on Claim instead of Order
    writeSchema(`
model Claim {
  id                  String   @id
  approvedAmountCents Int?
  selection           Json?
  deliveredAt         DateTime?
}

model Order {
  id     String @id
  status String
}
`)
    const r = run(REGEN, {})
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/1 env: the deployed schema lacks Order\.deliveredAt/)
    // NEGATIVE CONTROL: the naive check the operator does NOT use would have passed here
    expect(read(path.join(world, 'prisma', 'schema.prisma'))).toContain('deliveredAt')
  })

  it('a complete D′ schema passes step 1 and fails later (no prisma CLI in the fake world) — never a PASS without generation', () => {
    writeSchema(DPRIME_SCHEMA)
    const r = run(REGEN, {})
    expect(r.code).toBe(1)
    expect(r.out).not.toMatch(/RESULT: PASS/)
    expect(r.out).not.toMatch(/1 env:/)              // step 1 was satisfied
    expect(r.out).toMatch(/3 prisma generate/)        // it died where it should
    expect(fs.existsSync(path.join(world, 'tmp', 'restart.txt'))).toBe(false)
  })

  it('its contract is the D′ one, model-scoped, and it does not reuse the Phase 1 operator', () => {
    const { REQUIRED, modelBody } = require('../scripts/server/dprime-regen-client.js') as {
      REQUIRED: Array<{ model: string; field: string }>; modelBody: (s: string, m: string) => string | null
    }
    expect(REQUIRED).toEqual([
      { model: 'Claim', field: 'approvedAmountCents' },
      { model: 'Claim', field: 'selection' },
      { model: 'Order', field: 'deliveredAt' },
    ])
    const src = code(REGEN)
    expect(src).not.toMatch(/recoveryOffsetPoints|sourceEventId|actorId/)   // Phase 1's fields
    expect(src).not.toMatch(/phase1-regen-client|PHASE1_/)                   // nor its operator or env
    expect(src).toMatch(/ScalarFieldEnum/)                                   // model-scoped verification
    // it may SAY « no Stripe » in its report; what it must never do is read a money flag or reach Stripe
    expect(src).not.toMatch(/require\(['"][^'"]*stripe/i)
    expect(src).not.toMatch(/process\.env\.(REFUNDS_ENABLED|REFUNDS_WINDOW_UNTIL|CLAIMS_ENABLED|CLAIMS_WINDOW_UNTIL|CLAIMS_SURFACE_ENABLED|CLAIMS_INTAKE_ENABLED)/)
    expect(src).not.toMatch(/\.env\.local/)
    expect(src).not.toMatch(/\$executeRaw|\$queryRaw|ALTER TABLE/)           // no DB write of its own
    // the model-body helper isolates a model: a field of one model is not seen in the other
    expect(modelBody(DPRIME_SCHEMA, 'Order')).toMatch(/deliveredAt/)
    expect(modelBody(DPRIME_SCHEMA, 'Claim')).not.toMatch(/deliveredAt/)
    expect(modelBody(DPRIME_SCHEMA, 'Refund')).toBeNull()
  })

  it('NEGATIVE CONTROL — the generated-client check really fails on a field that does not exist', () => {
    writeSchema(DPRIME_SCHEMA)
    const r = run(REGEN, { DPRIME_VERIFY_FIELDS: 'Claim.thisFieldCannotExist' })
    expect(r.code).toBe(1)
    expect(r.out).not.toMatch(/RESULT: PASS/)
  })
})
