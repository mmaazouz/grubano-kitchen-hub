'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   staging-backup.js — ONE-SHOT, FAIL-CLOSED, READ-ONLY: fresh VERIFIED backup of
   the STAGING database, as ONE founder command. Clean Room runbook step 1
   (docs/ops/CLEAN-ROOM-RUNBOOK.md §4) — the `--i-confirm-local-backup` attestation
   of clean-room.js must rest on THIS output, never on a stale download.

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/staging-backup.js --label pre-cleanroom

   WHAT IT DOES (and nothing else):
     1. env: DATABASE_URL (+ NEXTAUTH_URL) from process.env or the app .env.local;
     2. PROVE STAGING (refuses production db / URL, refuses ambiguity);
     3. mysqldump --single-transaction --quick --routines --triggers via a 0600
        defaults-extra-file (deleted right after) → ~/grubano-backups/staging-<label>-<ts>.sql.gz
        (timestamped, NEVER overwrites, keeps every previous backup);
     4. VERIFY the dump: size ≥ 512 B · "-- Dump completed" marker · INSERT ≥ 1 ·
        gzip round-trip equality · sha256 of the .gz ·
        MANIFEST: every base table of the schema has its CREATE TABLE in the dump
        and every NON-EMPTY table (live COUNT(*)) has ≥ 1 INSERT — a silently
        missing / under-privileged table = FAIL;
     5. print a single PASS / FAIL block with path · size · sha256 · manifest.
   NO write to the database (COUNT(*) reads only). NO Stripe. NO secret printed
   (DSN masked, password only in the transient 0600 cnf). Idempotent: every run
   makes a NEW file; a name collision = FAIL, never an overwrite.
   Overrides for LOCAL rehearsal only: MYSQLDUMP_BIN, GRUBANO_BACKUP_DIR.
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

const MYSQLDUMP = process.env.MYSQLDUMP_BIN || 'mysqldump'
const BACKUP_DIR = process.env.GRUBANO_BACKUP_DIR || path.join(os.homedir(), 'grubano-backups')
const ARGS = process.argv.slice(2)
const labelIdx = ARGS.indexOf('--label')
const LABEL = (labelIdx >= 0 && ARGS[labelIdx + 1] ? ARGS[labelIdx + 1] : 'manual').replace(/[^a-z0-9-]/gi, '-').slice(0, 40)

function maskDsn(dsn) { try { const u = new URL(dsn); return `${u.protocol}//***:***@${u.host}${u.pathname}` } catch { return '(unparseable, masked)' } }
function cleanup(p) { try { fs.unlinkSync(p) } catch {} }
function pass(o) {
  console.log('========================================')
  console.log('GRUBANO STAGING BACKUP')
  console.log('RESULT: PASS')
  console.log('BACKUP FILE: ' + o.file)
  console.log('SIZE: ' + o.size)
  console.log('SHA256: ' + o.sha256)
  console.log('DUMP: ' + o.dump)
  console.log('MANIFEST: ' + o.manifest)
  console.log('DATABASE CHANGED: NO')
  console.log('NEXT: download this file OFF the server (cPanel File Manager), check sha256 locally, then Clean Room step 2.')
  console.log('========================================')
  process.exit(0)
}
function fail(step, action) {
  console.log('========================================')
  console.log('GRUBANO STAGING BACKUP')
  console.log('RESULT: FAIL')
  console.log('FAILED STEP: ' + step)
  console.log('DATABASE CHANGED: NO')
  console.log('SAFE TO CONTINUE: NO')
  console.log('ACTION: ' + (action || 'RETURN THIS OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(1)
}

;(async () => {
  // ── 1. env ───────────────────────────────────────────────────────────────
  const DSN = process.env.DATABASE_URL
  if (!DSN) return fail('1 env: DATABASE_URL absent', 'run inside ~/app.grubano.com (reads .env.local)')
  let url
  try { url = new URL(DSN) } catch { return fail('1 env: DATABASE_URL unparseable') }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  console.log('[staging-backup] target:', maskDsn(DSN), '| label:', LABEL)

  // ── 2. PROVE STAGING (same predicates as phase1-staging-migrate.js) ─────
  const nextUrl = (process.env.NEXTAUTH_URL || '').toLowerCase()
  const dbLooksStaging = /_staging$/.test(dbName)
  const urlLooksStaging = nextUrl.includes('app.grubano.com') || nextUrl.includes('business.grubano.com') || nextUrl.includes('localhost')
  const dbLooksProd = dbName === 'deyi0010_grubano' || (/grubano$/.test(dbName) && !dbLooksStaging)
  const urlLooksProd = /(^|\/\/)grubano\.com/.test(nextUrl) && !nextUrl.includes('app.grubano.com') && !nextUrl.includes('business.grubano.com')
  if (dbLooksProd || urlLooksProd) return fail(`2 staging-proof: target looks like PRODUCTION (${urlLooksProd ? 'NEXTAUTH_URL=grubano.com' : 'db=' + dbName})`, 'run on STAGING only')
  if (!dbLooksStaging && !urlLooksStaging) return fail(`2 staging-proof: cannot confirm STAGING (db=${dbName}, url=${nextUrl || 'unset'})`, 'confirm staging env')

  // ── 3. live manifest (READ ONLY) via the server Prisma client ────────────
  let PrismaClient
  try { ({ PrismaClient } = require('@prisma/client')) } catch { return fail('3 prisma: @prisma/client not found', 'run inside ~/app.grubano.com') }
  const prisma = new PrismaClient()
  let tables = []
  const live = new Map()
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY TABLE_NAME', dbName, 'BASE TABLE')
    tables = rows.map((r) => String(r.t)).filter((t) => t !== '_prisma_migrations')
    if (tables.length < 10) { await prisma.$disconnect(); return fail(`3 manifest: only ${tables.length} base tables found in ${dbName}`, 'wrong database?') }
    for (const t of tables) {
      const r = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS n FROM `' + t.replace(/`/g, '') + '`')
      live.set(t, Number(r?.[0]?.n ?? 0))
    }
  } catch (e) {
    await prisma.$disconnect()
    return fail('3 manifest: live COUNT(*) failed (' + String(e.message || e).split('\n')[0].slice(0, 120) + ')')
  }
  await prisma.$disconnect()
  const totalRows = [...live.values()].reduce((a, b) => a + b, 0)

  // ── 4. mysqldump → .sql (0600 cnf, deleted in finally) ───────────────────
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '')
  const sqlPath = path.join(BACKUP_DIR, `staging-${LABEL}-${stamp}.sql`)
  const gzPath = sqlPath + '.gz'
  if (fs.existsSync(gzPath) || fs.existsSync(sqlPath)) return fail('4 backup: target file already exists (never overwritten): ' + gzPath, 'retry in a second')
  const cnfPath = path.join(BACKUP_DIR, `.my-${stamp}.cnf`)
  fs.writeFileSync(cnfPath,
    `[client]\nhost=${url.hostname}\nport=${url.port || 3306}\nuser=${decodeURIComponent(url.username)}\npassword="${decodeURIComponent(url.password)}"\n`,
    { mode: 0o600 })
  try {
    execFileSync(MYSQLDUMP, ['--defaults-extra-file=' + cnfPath, '--single-transaction', '--quick', '--routines', '--triggers', '--default-character-set=utf8mb4', dbName],
      { stdio: ['ignore', fs.openSync(sqlPath, 'w'), 'pipe'], maxBuffer: 1024 * 1024 * 1024 })
  } catch (e) {
    cleanup(cnfPath); cleanup(sqlPath)
    return fail('4 backup: mysqldump failed (' + String(e.message || e).split('\n')[0].slice(0, 120) + ')', 'check mysqldump availability / credentials')
  } finally { cleanup(cnfPath) }

  // ── 5. verify the dump ───────────────────────────────────────────────────
  const sqlText = fs.readFileSync(sqlPath, 'utf8')
  const sizeBytes = Buffer.byteLength(sqlText)
  const insertCount = (sqlText.match(/^INSERT INTO /gm) || []).length
  const completed = /-- Dump completed/.test(sqlText)
  if (sizeBytes < 512) { cleanup(sqlPath); return fail(`5 verify: dump trivially small (${sizeBytes} bytes, < 512)`) }
  if (!completed) { cleanup(sqlPath); return fail('5 verify: no "-- Dump completed" marker (truncated dump)') }
  if (insertCount < 1) { cleanup(sqlPath); return fail('5 verify: 0 INSERT statements (empty dump)') }
  // MANIFEST: every schema table has a CREATE TABLE; every non-empty table has ≥ 1 INSERT.
  const missingCreate = tables.filter((t) => !sqlText.includes('CREATE TABLE `' + t + '`'))
  const missingInsert = tables.filter((t) => live.get(t) > 0 && !new RegExp('^INSERT INTO `' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '` ', 'm').test(sqlText))
  if (missingCreate.length) { cleanup(sqlPath); return fail('5 manifest: CREATE TABLE missing in dump for ' + missingCreate.slice(0, 8).join(',') + (missingCreate.length > 8 ? '…' : '')) }
  if (missingInsert.length) { cleanup(sqlPath); return fail('5 manifest: non-empty table(s) without INSERT in dump: ' + missingInsert.slice(0, 8).join(',') + (missingInsert.length > 8 ? '…' : ''), 'dump privileges / truncated?') }
  // gzip via zlib + round-trip equality; sha256 of the .gz (what the founder downloads).
  const gz = zlib.gzipSync(Buffer.from(sqlText))
  fs.writeFileSync(gzPath, gz)
  let gzOk = false
  try { gzOk = zlib.gunzipSync(fs.readFileSync(gzPath)).equals(Buffer.from(sqlText)) } catch { gzOk = false }
  if (!gzOk) { cleanup(sqlPath); cleanup(gzPath); return fail('5 verify: gzip integrity check failed') }
  cleanup(sqlPath) // keep only the .gz
  const gzBuf = fs.readFileSync(gzPath)
  const sha256 = crypto.createHash('sha256').update(gzBuf).digest('hex')
  const nonEmpty = tables.filter((t) => live.get(t) > 0)
  const manifest = `${tables.length} tables (all CREATE present) · ${nonEmpty.length} non-empty all with INSERT · ${totalRows} rows · ` +
    nonEmpty.map((t) => `${t}=${live.get(t)}`).join(' ')
  return pass({
    file: gzPath,
    size: `${gzBuf.length} bytes gz (${(gzBuf.length / 1024).toFixed(1)} KB) · ${sizeBytes} bytes sql`,
    sha256,
    dump: `completed marker OK · ${insertCount} INSERT statements · gzip round-trip OK`,
    manifest,
  })
})().catch((e) => fail('unexpected: ' + String(e && e.message || e).slice(0, 160)))
