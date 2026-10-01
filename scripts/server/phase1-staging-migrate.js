'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase1-staging-migrate.js — ONE-SHOT, FAIL-CLOSED, IDEMPOTENT staging operator.

   Applies the PHASE 1 loyalty↔refund schema migration on STAGING and proves, by
   itself, that it is safe — so the founder runs exactly ONE command and reads a
   single PASS / FAIL, never interpreting SQL or counts by hand:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase1-staging-migrate.js

   It performs, in order, aborting NON-ZERO on the first failed invariant:
     env validation · prove STAGING · fresh timestamped backup (30/08 preserved) ·
     gzip + completion + INSERT-count verification · pre-migration baseline ·
     schema precondition + partial-state detection · apply ONLY the approved
     additive SQL · verify new columns / defaults / unique index · before/after
     count preservation · sanitized report.

   PURELY ADDITIVE. No dedup, no DROP, no --accept-data-loss, no data rewrite.
   Idempotent: a second run detects a fully-applied+verified state and returns
   ALREADY_APPLIED_AND_VERIFIED without re-applying. A PARTIAL state fails closed.

   SECRETS: reads DATABASE_URL from the server .env.local at runtime. Nothing is
   hardcoded, nothing is printed. The DSN is masked in all output.

   SCOPE: staging-only, Phase-1-only, one-off. It does NOT couple migration to
   deploy and installs no hooks. Refund freeze is untouched (this moves schema, not
   money): REFUNDS_ENABLED stays FALSE, no refund is initiated.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

// ── env: DATABASE_URL + NEXTAUTH_URL from process env or .env.local (cwd, then app root)
if (!process.env.DATABASE_URL || !process.env.NEXTAUTH_URL) {
  for (const dir of [process.cwd(), path.join(__dirname, '..', '..')]) {
    const f = path.join(dir, '.env.local')
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    if (process.env.DATABASE_URL) break
  }
}

const MYSQLDUMP = process.env.MYSQLDUMP_BIN || 'mysqldump' // overridable for local rehearsal only
const BACKUP_DIR = process.env.PHASE1_BACKUP_DIR || path.join(os.homedir(), 'grubano-backups')
const INDEX_NAME = 'LoyaltyTransaction_sourceEventId_type_key' // Prisma convention for @@unique([sourceEventId,type])

// The ONE approved additive migration. Column ALTERs are idempotent (IF NOT EXISTS);
// the unique index is applied through a code guard (checked against STATISTICS first).
const COLUMN_STATEMENTS = [
  "ALTER TABLE `LoyaltyTransaction` ADD COLUMN IF NOT EXISTS `sourceEventId` VARCHAR(191) NULL",
  "ALTER TABLE `LoyaltyTransaction` ADD COLUMN IF NOT EXISTS `actorId` VARCHAR(191) NULL",
  "ALTER TABLE `LoyaltyCustomer` ADD COLUMN IF NOT EXISTS `recoveryOffsetPoints` INTEGER NOT NULL DEFAULT 0",
]
const INDEX_STATEMENT = "CREATE UNIQUE INDEX `" + INDEX_NAME + "` ON `LoyaltyTransaction`(`sourceEventId`, `type`)"
// The stable content hash the founder / a reviewer can compare against the artifact.
const MIGRATION_HASH = crypto.createHash('sha256')
  .update([...COLUMN_STATEMENTS, INDEX_STATEMENT].join(';\n') + ';\n').digest('hex').slice(0, 16)

// ── sanitized reporting ──────────────────────────────────────────────────────
function maskDsn(dsn) { try { const u = new URL(dsn); return `${u.protocol}//***:***@${u.host}${u.pathname}` } catch { return '(unparseable, masked)' } }
function passReport(o) {
  console.log('========================================')
  console.log('GRUBANO PHASE 1 STAGING MIGRATION')
  console.log('RESULT: PASS' + (o.alreadyApplied ? '  (ALREADY_APPLIED_AND_VERIFIED)' : ''))
  console.log('BACKUP: ' + (o.backup || 'NOT NEEDED (already applied)'))
  console.log('BASELINE: ' + (o.baseline || 'CAPTURED'))
  console.log('MIGRATION: ' + (o.migration || 'APPLIED'))
  console.log('POST-MIGRATION INTEGRITY: PASS')
  console.log('SAFE TO CONTINUE MERGE/DEPLOY: YES')
  console.log('========================================')
  process.exit(0)
}
function failReport(step, changed, action) {
  console.log('========================================')
  console.log('GRUBANO PHASE 1 STAGING MIGRATION')
  console.log('RESULT: FAIL')
  console.log('FAILED STEP: ' + step)
  console.log('DATABASE CHANGED: ' + changed)
  console.log('SAFE TO CONTINUE: NO')
  console.log('ACTION: ' + (action || 'RETURN THIS OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(1)
}

;(async () => {
  // ── STEP 1 — env validation ────────────────────────────────────────────────
  const DSN = process.env.DATABASE_URL
  if (!DSN) return failReport('1 env: DATABASE_URL absent', 'NO', 'set DATABASE_URL / .env.local, retry')
  let url
  try { url = new URL(DSN) } catch { return failReport('1 env: DATABASE_URL unparseable', 'NO') }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  console.log('[phase1-migrate] target:', maskDsn(DSN), '| migration hash:', MIGRATION_HASH)

  // ── STEP 2/3 — PROVE STAGING (fail closed on prod / ambiguity) ─────────────
  const nextUrl = (process.env.NEXTAUTH_URL || '').toLowerCase()
  const dbLooksStaging = /_staging$/.test(dbName)
  const urlLooksStaging = nextUrl.includes('app.grubano.com') || nextUrl.includes('business.grubano.com') || nextUrl.includes('localhost')
  const dbLooksProd = dbName === 'deyi0010_grubano' || /grubano$/.test(dbName) && !dbLooksStaging
  const urlLooksProd = /(^|\/\/)grubano\.com/.test(nextUrl) && !nextUrl.includes('app.grubano.com') && !nextUrl.includes('business.grubano.com')
  if (dbLooksProd || urlLooksProd) return failReport(
    `2 staging-proof: target looks like PRODUCTION (${urlLooksProd ? 'NEXTAUTH_URL=grubano.com' : 'db=' + dbName})`,
    'NO', 'run on STAGING only')
  if (!dbLooksStaging && !urlLooksStaging) return failReport(`3 staging-proof: cannot confirm STAGING (db=${dbName}, url=${nextUrl || 'unset'})`, 'NO', 'confirm staging env')

  // ── Prisma client (server-generated) ───────────────────────────────────────
  let PrismaClient
  try { ({ PrismaClient } = require('@prisma/client')) } catch { return failReport('prisma: @prisma/client not found', 'NO', 'run inside ~/app.grubano.com') }
  const prisma = new PrismaClient()
  const q = (sql, ...a) => prisma.$queryRawUnsafe(sql, ...a)
  const colInfo = (table, col) => q(
    'SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    dbName, table, col)
  const indexRows = () => q(
    'SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX',
    dbName, 'LoyaltyTransaction', INDEX_NAME)
  const count = async (model) => { try { return await prisma[model].count() } catch { return null } }

  try {
    // Sanity: the loyalty tables must exist at all.
    const tblCheck = await q('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)', dbName, 'LoyaltyTransaction', 'LoyaltyCustomer')
    if (Number(tblCheck?.[0]?.n ?? 0) < 2) { await prisma.$disconnect(); return failReport('precheck: LoyaltyTransaction/LoyaltyCustomer tables not found', 'NO', 'wrong database?') }

    // ── STEP 11/12 — schema precondition + partial-state / idempotency ────────
    const hasSrc = (await colInfo('LoyaltyTransaction', 'sourceEventId')).length > 0
    const hasActor = (await colInfo('LoyaltyTransaction', 'actorId')).length > 0
    const hasOffset = (await colInfo('LoyaltyCustomer', 'recoveryOffsetPoints')).length > 0
    const idx = await indexRows()
    const idxOk = idx.length === 2 && idx.every((r) => Number(r.NON_UNIQUE) === 0) &&
      idx[0].COLUMN_NAME === 'sourceEventId' && idx[1].COLUMN_NAME === 'type'
    const appliedParts = [hasSrc, hasActor, hasOffset, idxOk].filter(Boolean).length

    if (appliedParts === 4) {
      // Fully applied — verify defaults/nullability then return idempotently.
      const okDefaults = await verifyColumns(colInfo)
      await prisma.$disconnect()
      if (!okDefaults.ok) return failReport('idempotent-verify: ' + okDefaults.why, 'NO')
      return passReport({ alreadyApplied: true, backup: 'NOT NEEDED (already applied)', baseline: 'N/A', migration: 'ALREADY_APPLIED_AND_VERIFIED' })
    }
    if (appliedParts !== 0) {
      await prisma.$disconnect()
      return failReport(`12 partial-state: ${appliedParts}/4 migration parts present (src=${hasSrc} actor=${hasActor} offset=${hasOffset} idx=${idxOk}) — refusing to touch an unexpected partial schema`, 'PARTIAL', 'restore from backup / investigate')
    }

    // ── STEP 4-9 — FRESH BACKUP (30/08 preserved via timestamped filename) ────
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '')
    const sqlPath = path.join(BACKUP_DIR, `staging-pre-phase1-${stamp}.sql`)
    const gzPath = sqlPath + '.gz'
    const cnfPath = path.join(BACKUP_DIR, `.my-${stamp}.cnf`)
    fs.writeFileSync(cnfPath,
      `[client]\nhost=${url.hostname}\nport=${url.port || 3306}\nuser=${decodeURIComponent(url.username)}\npassword="${decodeURIComponent(url.password)}"\n`,
      { mode: 0o600 })
    try {
      execFileSync(MYSQLDUMP, ['--defaults-extra-file=' + cnfPath, '--single-transaction', '--quick', '--routines', '--triggers', '--default-character-set=utf8mb4', dbName],
        { stdio: ['ignore', fs.openSync(sqlPath, 'w'), 'pipe'], maxBuffer: 1024 * 1024 * 1024 })
    } catch (e) {
      try { fs.unlinkSync(cnfPath) } catch {}
      await prisma.$disconnect()
      return failReport('4 backup: mysqldump failed (' + String(e.message || e).split('\n')[0].slice(0, 120) + ')', 'NO', 'check mysqldump availability / credentials')
    } finally { try { fs.unlinkSync(cnfPath) } catch {} }

    const sqlText = fs.readFileSync(sqlPath, 'utf8')
    const sizeBytes = Buffer.byteLength(sqlText)
    const insertCount = (sqlText.match(/^INSERT INTO /gm) || []).length
    const completed = /-- Dump completed/.test(sqlText)
    if (sizeBytes < 512) { cleanup(sqlPath); await prisma.$disconnect(); return failReport(`6 backup: dump trivially small (${sizeBytes} bytes, < 512)`, 'NO') }
    if (!completed) { cleanup(sqlPath); await prisma.$disconnect(); return failReport('8 backup: no "-- Dump completed" marker (truncated dump)', 'NO') }
    if (insertCount < 1) { cleanup(sqlPath); await prisma.$disconnect(); return failReport('9 backup: 0 INSERT statements (empty dump)', 'NO') }
    // gzip via zlib + integrity (decompress round-trip must equal the source).
    const gz = zlib.gzipSync(Buffer.from(sqlText))
    fs.writeFileSync(gzPath, gz)
    let gzOk = false
    try { gzOk = zlib.gunzipSync(fs.readFileSync(gzPath)).equals(Buffer.from(sqlText)) } catch { gzOk = false }
    if (!gzOk) { cleanup(sqlPath); await prisma.$disconnect(); return failReport('7 backup: gzip integrity check failed', 'NO') }
    cleanup(sqlPath) // keep only the .gz
    const gzSize = fs.statSync(gzPath).size
    console.log(`[phase1-migrate] backup: ${gzPath} (${(gzSize / 1024).toFixed(1)} KB gz, ${insertCount} INSERTs, dump completed)`)

    // ── STEP 10 — pre-migration baseline ──────────────────────────────────────
    const before = {
      order: await count('order'), loyaltyTransaction: await count('loyaltyTransaction'),
      loyaltyCustomer: await count('loyaltyCustomer'), refund: await count('refund'), ledgerEntry: await count('ledgerEntry'),
    }
    const beforePointsSum = await sumPoints(q, dbName)
    console.log('[phase1-migrate] baseline:', JSON.stringify(before), '| Σpoints:', beforePointsSum)

    // ── STEP 14 — APPLY the additive migration (idempotent) ───────────────────
    for (const s of COLUMN_STATEMENTS) { await prisma.$executeRawUnsafe(s) }
    // Unique index: create only if not already present (guarded — no IF NOT EXISTS on old MariaDB indexes).
    if ((await indexRows()).length === 0) { await prisma.$executeRawUnsafe(INDEX_STATEMENT) }

    // ── STEP 15-17 — verify columns / defaults / nullability / unique index ───
    const okCols = await verifyColumns(colInfo)
    if (!okCols.ok) { await prisma.$disconnect(); return failReport('15 verify-columns: ' + okCols.why, 'YES', 'restore from backup ' + gzPath) }
    const idx2 = await indexRows()
    const idx2Ok = idx2.length === 2 && idx2.every((r) => Number(r.NON_UNIQUE) === 0) &&
      idx2[0].COLUMN_NAME === 'sourceEventId' && idx2[1].COLUMN_NAME === 'type'
    if (!idx2Ok) { await prisma.$disconnect(); return failReport('17 verify-index: unique index not present/incorrect', 'YES', 'restore from backup ' + gzPath) }

    // ── STEP 18/19 — before/after preservation ────────────────────────────────
    const after = {
      order: await count('order'), loyaltyTransaction: await count('loyaltyTransaction'),
      loyaltyCustomer: await count('loyaltyCustomer'), refund: await count('refund'), ledgerEntry: await count('ledgerEntry'),
    }
    const afterPointsSum = await sumPoints(q, dbName)
    for (const k of Object.keys(before)) {
      if (before[k] !== after[k]) { await prisma.$disconnect(); return failReport(`18 preservation: ${k} count changed ${before[k]}→${after[k]}`, 'YES', 'restore from backup ' + gzPath) }
    }
    if (beforePointsSum !== afterPointsSum) { await prisma.$disconnect(); return failReport(`19 preservation: Σ pointsBalance changed ${beforePointsSum}→${afterPointsSum}`, 'YES', 'restore from backup ' + gzPath) }
    // The new offset column must be 0 for every existing row (default, no backfill).
    const nonZeroOffset = await q('SELECT COUNT(*) AS n FROM `LoyaltyCustomer` WHERE `recoveryOffsetPoints` <> 0')
    if (Number(nonZeroOffset?.[0]?.n ?? 0) !== 0) { await prisma.$disconnect(); return failReport('19 preservation: some recoveryOffsetPoints ≠ 0 after additive migration', 'YES', 'restore from backup ' + gzPath) }

    await prisma.$disconnect()
    return passReport({
      backup: 'VERIFIED (' + path.basename(gzPath) + ', ' + (gzSize / 1024).toFixed(1) + ' KB)',
      baseline: 'CAPTURED (' + JSON.stringify(before) + ')',
      migration: 'APPLIED (+sourceEventId +actorId +recoveryOffsetPoints +' + INDEX_NAME + ')',
    })
  } catch (e) {
    try { await prisma.$disconnect() } catch {}
    return failReport('unexpected: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160), 'UNKNOWN', 'RETURN THIS OUTPUT TO CLAUDE CODE (do not retry blindly)')
  }
})()

function cleanup(p) { try { fs.unlinkSync(p) } catch {} }

async function verifyColumns(colInfo) {
  const src = await colInfo('LoyaltyTransaction', 'sourceEventId')
  const actor = await colInfo('LoyaltyTransaction', 'actorId')
  const off = await colInfo('LoyaltyCustomer', 'recoveryOffsetPoints')
  if (src.length !== 1 || src[0].IS_NULLABLE !== 'YES') return { ok: false, why: 'sourceEventId missing or not NULLABLE' }
  if (actor.length !== 1 || actor[0].IS_NULLABLE !== 'YES') return { ok: false, why: 'actorId missing or not NULLABLE' }
  if (off.length !== 1 || off[0].IS_NULLABLE !== 'NO' || String(off[0].COLUMN_DEFAULT) !== '0') return { ok: false, why: 'recoveryOffsetPoints missing / nullable / default≠0' }
  return { ok: true }
}

async function sumPoints(q, dbName) {
  try { const r = await q('SELECT COALESCE(SUM(`pointsBalance`),0) AS s FROM `LoyaltyCustomer`'); return String(r?.[0]?.s ?? '0') } catch { return 'NA' }
}
