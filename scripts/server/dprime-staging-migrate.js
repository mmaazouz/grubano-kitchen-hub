'use strict'
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   dprime-staging-migrate.js — ONE-SHOT, FAIL-CLOSED, IDEMPOTENT staging operator (D′ lot L3a).

   Applies the D′ schema migration (spec v2 §9) on STAGING and proves, by itself, that it is
   safe — the founder runs exactly ONE command and reads a single PASS / FAIL, never
   interpreting SQL or counts by hand:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/dprime-staging-migrate.js

   THE MIGRATION IS THREE ADDITIVE NULLABLE COLUMNS AND NOTHING ELSE:
     Claim.approvedAmountCents INT NULL      — the amount an admin approved (never the requested one)
     Claim.selection           JSON NULL     — the persisted line selection (T-50: never consumed automatically)
     Order.deliveredAt         DATETIME NULL — the delivery instant (E3/E4 anchor; never Order.updatedAt)

   No DROP, no RENAME, no NOT NULL, no DEFAULT, no index, no backfill, no data rewrite, never
   `--accept-data-loss`, never `prisma db push` (which diffs the WHOLE schema, targets production
   paths and is not deployed — see CLAUDE.md §7). SQL is a compiled constant in this file: nothing
   is read from an argument or the environment.

   ORDER (spec v2 §9): this operator runs BEFORE the code that uses the columns (L3b). A column
   that exists but is unused is inert; code that expects a missing column is a 500.

   IT MOVES NO MONEY. It opens no gate, writes no flag, reads no Stripe, sends no e-mail, and does
   not touch .env.local. REFUNDS_ENABLED / CLAIMS_* are neither read nor written.

   Steps, aborting NON-ZERO on the first failed invariant:
     1 env → 2/3 prove STAGING (fail closed on production or ambiguity) → 4 expected DB/deployed SHA
     (when the founder pins them) → 5 tables exist → 6 partial-state / idempotency → 7 verified
     mysqldump backup (gzip round-trip, completion marker, INSERT count) → 8 baseline counts →
     9 APPLY the three ALTERs → 10 verify via information_schema (present, NULLABLE, no default,
     expected type) → 11 count preservation + every new column NULL everywhere → PASS.

   SECRETS: DATABASE_URL is read from the server .env.local at runtime, never printed (the DSN is
   masked in every line of output).
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const APP_ROOT = process.env.DPRIME_APP_ROOT || path.join(__dirname, '..', '..')

// ── env: DATABASE_URL + NEXTAUTH_URL from process env or .env.local (cwd, then app root) ──
if (!process.env.DATABASE_URL || !process.env.NEXTAUTH_URL) {
  for (const dir of [process.cwd(), APP_ROOT]) {
    const f = path.join(dir, '.env.local')
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    if (process.env.DATABASE_URL) break
  }
}

const MYSQLDUMP = process.env.MYSQLDUMP_BIN || 'mysqldump' // overridable for a local rehearsal only
const BACKUP_DIR = process.env.DPRIME_BACKUP_DIR || path.join(os.homedir(), 'grubano-backups')
/** Optional founder pins: when set, a mismatch is a refusal (never a warning). */
const EXPECT_DB = process.env.DPRIME_EXPECT_DB || ''
const EXPECT_SHA = process.env.DPRIME_EXPECT_SHA || ''

/** The ONE approved migration (spec v2 §9). Additive, nullable, idempotent.
 *  `ADD COLUMN IF NOT EXISTS` is MariaDB syntax (the o2switch server): a second run is a no-op, not an error.
 *  `dataType` lists every information_schema spelling CORRECT for the declared type — MariaDB stores a JSON
 *  column as `longtext` with a json_valid CHECK, MySQL as `json`. */
const COLUMNS = [
  { table: 'Claim', column: 'approvedAmountCents', type: 'INTEGER', dataType: ['int'],
    sql: 'ALTER TABLE `Claim` ADD COLUMN IF NOT EXISTS `approvedAmountCents` INTEGER NULL' },
  { table: 'Claim', column: 'selection', type: 'JSON', dataType: ['json', 'longtext'],
    sql: 'ALTER TABLE `Claim` ADD COLUMN IF NOT EXISTS `selection` JSON NULL' },
  { table: 'Order', column: 'deliveredAt', type: 'DATETIME(3)', dataType: ['datetime'],
    sql: 'ALTER TABLE `Order` ADD COLUMN IF NOT EXISTS `deliveredAt` DATETIME(3) NULL' },
]
/** The stable content hash a reviewer can compare against this artifact. */
const MIGRATION_HASH = crypto.createHash('sha256')
  .update(COLUMNS.map((c) => c.sql).join(';\n') + ';\n').digest('hex').slice(0, 16)
/** Every statement this operator may ever execute — nothing else is allowed through. */
const FORBIDDEN = /\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|MODIFY|CHANGE|NOT\s+NULL|DEFAULT|INDEX|UNIQUE)\b/i

// ── sanitized reporting ───────────────────────────────────────────────────────────────────────
function maskDsn(dsn) { try { const u = new URL(dsn); return `${u.protocol}//***:***@${u.host}${u.pathname}` } catch { return '(unparseable, masked)' } }
function passReport(o) {
  console.log('========================================')
  console.log('GRUBANO D′ L3a STAGING MIGRATION')
  console.log('RESULT: PASS' + (o.alreadyApplied ? '  (ALREADY_APPLIED_AND_VERIFIED)' : ''))
  console.log('MIGRATION HASH: ' + MIGRATION_HASH)
  console.log('BACKUP: ' + (o.backup || 'NOT NEEDED (already applied)'))
  console.log('BASELINE: ' + (o.baseline || 'N/A'))
  console.log('MIGRATION: ' + (o.migration || 'APPLIED'))
  console.log('POST-MIGRATION INTEGRITY: PASS')
  console.log('MONEY MOVED: NO — no gate, no flag, no Stripe, no e-mail')
  console.log('NEXT: deploy the D′ L3b schema/code, then run dprime-regen-client.js')
  console.log('========================================')
  process.exit(0)
}
function failReport(step, changed, action) {
  console.log('========================================')
  console.log('GRUBANO D′ L3a STAGING MIGRATION')
  console.log('RESULT: FAIL')
  console.log('FAILED STEP: ' + step)
  console.log('DATABASE CHANGED: ' + changed)
  console.log('SAFE TO CONTINUE: NO')
  console.log('ACTION: ' + (action || 'RETURN THIS OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(1)
}

// Guarded so `require()` (a test reading the constants) never runs the migration.
if (require.main === module) main()

async function main() {
  // ── STEP 1 — env validation ─────────────────────────────────────────────────────────────────
  const DSN = process.env.DATABASE_URL
  if (!DSN) return failReport('1 env: DATABASE_URL absent', 'NO', 'set DATABASE_URL / .env.local, retry')
  let url
  try { url = new URL(DSN) } catch { return failReport('1 env: DATABASE_URL unparseable', 'NO') }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  // Self-check: the compiled SQL is additive and nothing else (a future edit that adds a DROP,
  // a DEFAULT or a NOT NULL fails here, before any connection).
  for (const c of COLUMNS) {
    const tail = c.sql.replace(/^ALTER TABLE `[A-Za-z]+` ADD COLUMN IF NOT EXISTS `[A-Za-z]+` /, '')
    if (!/^ALTER TABLE `[A-Za-z]+` ADD COLUMN IF NOT EXISTS `[A-Za-z]+` [A-Z0-9()]+ NULL$/.test(c.sql) || FORBIDDEN.test(tail.replace(/ NULL$/, ''))) {
      return failReport('1 self-check: a compiled statement is not a purely additive nullable ADD COLUMN (' + c.table + '.' + c.column + ')', 'NO', 'do not edit the SQL of this operator')
    }
  }
  console.log('[dprime-migrate] target:', maskDsn(DSN), '| migration hash:', MIGRATION_HASH)

  // ── STEP 2/3 — PROVE STAGING (fail closed on production / ambiguity) ────────────────────────
  const nextUrl = (process.env.NEXTAUTH_URL || '').toLowerCase()
  const dbLooksStaging = /_staging$/.test(dbName)
  const urlLooksStaging = nextUrl.includes('app.grubano.com') || nextUrl.includes('business.grubano.com') || nextUrl.includes('localhost')
  const dbLooksProd = dbName === 'deyi0010_grubano' || (/grubano$/.test(dbName) && !dbLooksStaging)
  const urlLooksProd = /(^|\/\/)grubano\.com/.test(nextUrl) && !nextUrl.includes('app.grubano.com') && !nextUrl.includes('business.grubano.com')
  if (dbLooksProd || urlLooksProd) return failReport(
    `2 staging-proof: target looks like PRODUCTION (${urlLooksProd ? 'NEXTAUTH_URL=grubano.com' : 'db=' + dbName})`,
    'NO', 'run on STAGING only — production is a separate, founder-authorized operator')
  if (!dbLooksStaging && !urlLooksStaging) return failReport(`3 staging-proof: cannot confirm STAGING (db=${dbName}, url=${nextUrl || 'unset'})`, 'NO', 'confirm the staging env')

  // ── STEP 4 — founder pins: expected database and deployed SHA ───────────────────────────────
  if (EXPECT_DB && EXPECT_DB !== dbName) return failReport(`4 expect-db: DPRIME_EXPECT_DB=${EXPECT_DB} but the DSN targets ${dbName}`, 'NO', 'point at the intended database')
  if (EXPECT_SHA) {
    let deployed = null
    const vf = path.join(APP_ROOT, 'public', 'version.json')
    try { deployed = JSON.parse(fs.readFileSync(vf, 'utf8')) } catch { /* absent */ }
    if (!deployed || !deployed.commit) return failReport('4 expect-sha: public/version.json unreadable — the deployed build cannot be identified', 'NO', 'check the deploy')
    if (!String(deployed.commit).startsWith(EXPECT_SHA.slice(0, 7)) && !String(deployed.shortCommit || '').startsWith(EXPECT_SHA.slice(0, 7))) {
      return failReport(`4 expect-sha: deployed ${deployed.shortCommit || deployed.commit} ≠ expected ${EXPECT_SHA}`, 'NO', 'deploy the expected SHA first')
    }
    console.log('[dprime-migrate] deployed build:', deployed.shortCommit || deployed.commit, '(branch ' + (deployed.branch || '?') + ')')
  }

  // ── Prisma client (server-generated) ────────────────────────────────────────────────────────
  let PrismaClient
  try { ({ PrismaClient } = require(require.resolve('@prisma/client', { paths: [APP_ROOT] }))) }
  catch { return failReport('prisma: @prisma/client not found', 'NO', 'run inside ~/app.grubano.com with the nodevenv node') }
  const prisma = new PrismaClient()
  const q = (sql, ...a) => prisma.$queryRawUnsafe(sql, ...a)
  const colInfo = (table, col) => q(
    'SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    dbName, table, col)
  const count = async (model) => { try { return await prisma[model].count() } catch { return null } }

  try {
    // ── STEP 5 — the target tables must exist ────────────────────────────────────────────────
    const tbl = await q('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)', dbName, 'Claim', 'Order')
    const names = tbl.map((r) => r.TABLE_NAME)
    if (!names.includes('Claim') || !names.includes('Order')) {
      await prisma.$disconnect()
      return failReport('5 precheck: table(s) not found (' + names.join(',') + ') — expected Claim and Order', 'NO', 'wrong database?')
    }

    // ── STEP 6 — partial-state detection / idempotency ───────────────────────────────────────
    const present = []
    for (const c of COLUMNS) present.push((await colInfo(c.table, c.column)).length > 0)
    const applied = present.filter(Boolean).length
    if (applied === COLUMNS.length) {
      const v = await verifyColumns(colInfo)
      await prisma.$disconnect()
      if (!v.ok) return failReport('6 idempotent-verify: ' + v.why, 'NO', 'the columns exist but do not match the contract')
      return passReport({ alreadyApplied: true, migration: 'ALREADY_APPLIED_AND_VERIFIED (' + COLUMNS.map((c) => c.table + '.' + c.column).join(', ') + ')' })
    }
    if (applied !== 0) {
      await prisma.$disconnect()
      return failReport('6 partial-state: ' + applied + '/' + COLUMNS.length + ' columns present (' +
        COLUMNS.map((c, i) => c.table + '.' + c.column + '=' + present[i]).join(' ') + ') — refusing to touch a half-migrated schema',
        'NO', 'RETURN THIS OUTPUT TO CLAUDE CODE')
    }

    // ── STEP 7 — VERIFIED backup (timestamped: nothing earlier is overwritten) ───────────────
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '')
    const sqlPath = path.join(BACKUP_DIR, `staging-pre-dprime-${stamp}.sql`)
    const gzPath = sqlPath + '.gz'
    const cnfPath = path.join(BACKUP_DIR, `.my-dprime-${stamp}.cnf`)
    fs.writeFileSync(cnfPath,
      `[client]\nhost=${url.hostname}\nport=${url.port || 3306}\nuser=${decodeURIComponent(url.username)}\npassword="${decodeURIComponent(url.password)}"\n`,
      { mode: 0o600 })
    try {
      execFileSync(MYSQLDUMP, ['--defaults-extra-file=' + cnfPath, '--single-transaction', '--quick', '--routines', '--triggers', '--default-character-set=utf8mb4', dbName],
        { stdio: ['ignore', fs.openSync(sqlPath, 'w'), 'pipe'], maxBuffer: 1024 * 1024 * 1024 })
    } catch (e) {
      try { fs.unlinkSync(cnfPath) } catch {}
      cleanup(sqlPath)
      await prisma.$disconnect()
      return failReport('7 backup: mysqldump failed (' + String(e.message || e).split('\n')[0].slice(0, 120) + ')', 'NO', 'check mysqldump availability / credentials')
    } finally { try { fs.unlinkSync(cnfPath) } catch {} }

    const sqlText = fs.readFileSync(sqlPath, 'utf8')
    const sizeBytes = Buffer.byteLength(sqlText)
    const insertCount = (sqlText.match(/^INSERT INTO /gm) || []).length
    if (sizeBytes < 512) { cleanup(sqlPath); await prisma.$disconnect(); return failReport(`7 backup: dump trivially small (${sizeBytes} bytes, < 512)`, 'NO') }
    if (!/-- Dump completed/.test(sqlText)) { cleanup(sqlPath); await prisma.$disconnect(); return failReport('7 backup: no "-- Dump completed" marker (truncated dump)', 'NO') }
    if (insertCount < 1) { cleanup(sqlPath); await prisma.$disconnect(); return failReport('7 backup: 0 INSERT statements (empty dump)', 'NO') }
    if (!/CREATE TABLE `Claim`/.test(sqlText) || !/CREATE TABLE `Order`/.test(sqlText)) {
      cleanup(sqlPath); await prisma.$disconnect()
      return failReport('7 backup: the dump does not contain the Claim and Order tables it is supposed to protect', 'NO')
    }
    const gz = zlib.gzipSync(Buffer.from(sqlText))
    fs.writeFileSync(gzPath, gz)
    let gzOk = false
    try { gzOk = zlib.gunzipSync(fs.readFileSync(gzPath)).equals(Buffer.from(sqlText)) } catch { gzOk = false }
    if (!gzOk) { cleanup(sqlPath); cleanup(gzPath); await prisma.$disconnect(); return failReport('7 backup: gzip integrity check failed', 'NO') }
    cleanup(sqlPath) // keep only the .gz
    const gzSize = fs.statSync(gzPath).size
    console.log(`[dprime-migrate] backup: ${gzPath} (${(gzSize / 1024).toFixed(1)} KB gz, ${insertCount} INSERTs, dump completed)`)

    // ── STEP 8 — baseline ────────────────────────────────────────────────────────────────────
    const before = { claim: await count('claim'), order: await count('order'), refund: await count('refund'), ledgerEntry: await count('ledgerEntry') }
    console.log('[dprime-migrate] baseline:', JSON.stringify(before))

    // ── STEP 9 — APPLY (three additive ALTERs, idempotent) ───────────────────────────────────
    for (const c of COLUMNS) await prisma.$executeRawUnsafe(c.sql)

    // ── STEP 10 — verify each column: present, NULLABLE, no default, expected type ───────────
    const v = await verifyColumns(colInfo)
    if (!v.ok) { await prisma.$disconnect(); return failReport('10 verify-columns: ' + v.why, 'YES', 'restore from backup ' + gzPath) }

    // ── STEP 11 — preservation: counts unchanged, every new column NULL everywhere ───────────
    const after = { claim: await count('claim'), order: await count('order'), refund: await count('refund'), ledgerEntry: await count('ledgerEntry') }
    for (const k of Object.keys(before)) {
      if (before[k] !== after[k]) { await prisma.$disconnect(); return failReport(`11 preservation: ${k} count changed ${before[k]}→${after[k]}`, 'YES', 'restore from backup ' + gzPath) }
    }
    for (const c of COLUMNS) {
      const r = await q('SELECT COUNT(*) AS n FROM `' + c.table + '` WHERE `' + c.column + '` IS NOT NULL')
      if (Number(r?.[0]?.n ?? 0) !== 0) {
        await prisma.$disconnect()
        return failReport(`11 preservation: ${c.table}.${c.column} is non-NULL on ${r[0].n} row(s) — an additive column must be NULL everywhere (no backfill)`, 'YES', 'restore from backup ' + gzPath)
      }
    }

    await prisma.$disconnect()
    return passReport({
      backup: 'VERIFIED (' + path.basename(gzPath) + ', ' + (gzSize / 1024).toFixed(1) + ' KB)',
      baseline: 'CAPTURED (' + JSON.stringify(before) + ')',
      migration: 'APPLIED (' + COLUMNS.map((c) => '+' + c.table + '.' + c.column).join(' ') + ', all NULL)',
    })
  } catch (e) {
    try { await prisma.$disconnect() } catch {}
    return failReport('unexpected: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160), 'UNKNOWN', 'RETURN THIS OUTPUT TO CLAUDE CODE (do not retry blindly)')
  }
}

function cleanup(p) { try { fs.unlinkSync(p) } catch {} }

/** Every column present, NULLABLE, with NO default, and of the expected type. */
async function verifyColumns(colInfo) {
  for (const c of COLUMNS) {
    const rows = await colInfo(c.table, c.column)
    if (rows.length !== 1) return { ok: false, why: `${c.table}.${c.column} missing` }
    const r = rows[0]
    if (r.IS_NULLABLE !== 'YES') return { ok: false, why: `${c.table}.${c.column} is NOT NULL (the migration is additive and nullable)` }
    if (r.COLUMN_DEFAULT !== null && String(r.COLUMN_DEFAULT).toUpperCase() !== 'NULL') return { ok: false, why: `${c.table}.${c.column} carries a default (${r.COLUMN_DEFAULT})` }
    if (!c.dataType.includes(String(r.DATA_TYPE).toLowerCase())) return { ok: false, why: `${c.table}.${c.column} is ${r.DATA_TYPE}, expected ${c.dataType.join(' or ')}` }
  }
  return { ok: true }
}

module.exports = { COLUMNS, MIGRATION_HASH }
