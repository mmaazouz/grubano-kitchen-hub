// qa-env-gate.mjs — STANDALONE environment gate for the local QA passes.
//
//   DATABASE_URL=… node scripts/qa/qa-env-gate.mjs
//
// Verifies, SEPARATELY and in order, that the local QA database is the one the
// QA procedure expects — then exits 0, or exits NON-ZERO with the cause:
//   ① the TCP port of DATABASE_URL has a listener            (else exit 10, A)
//   ② a REAL SQL query succeeds (SELECT 1)                    (else exit 11, B)
//   ③ the instance is the QA one: SELECT @@datadir = fiche    (else exit 12, C)
//   ④ the expected database + Operator table exist           (else exit 13, D)
//   ⑤ the QA operator seed row exists in the expected state   (else exit 14, E)
// Exit 2 = configuration error (DATABASE_URL missing/unparseable).
//
// THE GATE REPAIRS NOTHING: it never starts or kills mysqld, creates no base, no
// user, no row, changes no setting. It prints the EXACT relaunch command of the
// QA fiche when the instance is down, and refuses. Secrets are never printed.
//
// Overrides (all optional): QA_DB_DATADIR (expected datadir, default = fiche),
// QA_EMAIL (default qa+op@grubano.test), QA_DB_ROLE (restaurant), QA_DB_STATUS (active).
import net from 'node:net'
import { createRequire } from 'node:module'
import { classifyEnv, EXIT, QA_DATADIR_FICHE } from './qa-env-gate-classify.mjs'

const require = createRequire(import.meta.url)

function fail(kind, message) {
  console.error('✗ QA ENV GATE — ' + kind + ': ' + message)
  process.exit(EXIT[kind] ?? 1)
}

// ── configuration (no secret ever printed) ────────────────────────────────────
const rawUrl = process.env.DATABASE_URL || ''
if (!rawUrl) fail('config-error', 'DATABASE_URL is empty — export it (never print it).')
let url
try { url = new URL(rawUrl) } catch { fail('config-error', 'DATABASE_URL is not a parseable URL.') }
const expected = {
  host: url.hostname,
  port: Number(url.port || 3306),
  database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  table: 'Operator',
  datadir: process.env.QA_DB_DATADIR || QA_DATADIR_FICHE,
  email: process.env.QA_EMAIL || 'qa+op@grubano.test',
  role: process.env.QA_DB_ROLE || 'restaurant',
  status: process.env.QA_DB_STATUS || 'active',
}
const obs = { expected }
let prisma = null
const line = (n, label, ok, detail) => console.log(`${ok ? '✓' : '✗'} ${n} ${label}${detail ? ' — ' + detail : ''}`)

// ── ① TCP listener ────────────────────────────────────────────────────────────
obs.portOpen = await new Promise((resolve) => {
  const s = net.connect({ host: expected.host, port: expected.port })
  const done = (v, err) => { try { s.destroy() } catch {} ; if (err) obs.portError = err; resolve(v) }
  s.setTimeout(3000, () => done(false, 'timeout'))
  s.once('connect', () => done(true))
  s.once('error', (e) => done(false, e.code || String(e)))
})
line('①', `port ${expected.host}:${expected.port}`, obs.portOpen, obs.portOpen ? 'listener present' : obs.portError)
if (!obs.portOpen) await finish()

// ── ② real SQL query ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client')
prisma = new PrismaClient({ log: [] })
try {
  const r = await prisma.$queryRawUnsafe('SELECT 1 AS ok')
  obs.sqlOk = Array.isArray(r) && r.length === 1
} catch (e) {
  obs.sqlOk = false
  obs.sqlError = String(e?.message || e).split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0]
}
line('②', 'real SQL query (SELECT 1)', obs.sqlOk, obs.sqlOk ? '1 row' : obs.sqlError)
if (!obs.sqlOk) await finish()

// ── ③ instance identity — by QUERY, never by port/PID ────────────────────────
try {
  const r = await prisma.$queryRawUnsafe('SELECT @@datadir AS datadir, CAST(@@port AS CHAR) AS port, @@version AS version')
  obs.datadir = r[0]?.datadir ?? null
  obs.serverPort = r[0]?.port ?? null
  obs.serverVersion = r[0]?.version ?? null
} catch (e) {
  obs.datadir = null
}
const ident = classifyEnv(obs)
line('③', 'instance identity (SELECT @@datadir)', ident.kind !== 'wrong-instance' && ident.kind !== 'config-error',
  `observed ${JSON.stringify(obs.datadir)} · expected ${JSON.stringify(expected.datadir)} · server ${obs.serverVersion ?? '?'} on port ${obs.serverPort ?? '?'}`)
if (ident.kind === 'wrong-instance' || ident.kind === 'config-error') await finish()

// ── ④ schema: current database + Operator table ──────────────────────────────
try {
  const db = await prisma.$queryRawUnsafe('SELECT DATABASE() AS db')
  obs.database = db[0]?.db ?? null
  const t = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ${expected.database} AND table_name = ${expected.table}`
  obs.tableCount = Number(t[0]?.n ?? 0)
  obs.schemaOk = obs.database === expected.database && obs.tableCount === 1
} catch (e) {
  obs.schemaOk = false
  obs.schemaError = String(e?.message || e).split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0]
}
line('④', `schema ${expected.database}.${expected.table}`, obs.schemaOk, obs.schemaOk ? 'present' : (obs.schemaError || `database=${obs.database} tables=${obs.tableCount}`))
if (!obs.schemaOk) await finish()

// ── ⑤ QA seed: the operator account in the expected state ────────────────────
try {
  const rows = await prisma.$queryRaw`SELECT role, status FROM Operator WHERE email = ${expected.email}`
  if (rows.length === 1 && rows[0].role === expected.role && rows[0].status === expected.status) obs.seedOk = true
  else { obs.seedOk = false; obs.seedObserved = rows.length === 0 ? 'no row' : `${rows.length} row(s): ` + rows.map((r) => `role=${r.role} status=${r.status}`).join(', ') }
} catch (e) {
  obs.seedOk = false
  obs.seedObserved = String(e?.message || e).split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0]
}
line('⑤', `QA seed ${expected.email} (${expected.role}/${expected.status})`, obs.seedOk, obs.seedOk ? 'present' : obs.seedObserved)
await finish()

async function finish() {
  try { await prisma?.$disconnect?.() } catch {}
  const v = classifyEnv(obs)
  if (v.pass) {
    console.log('\nPASS — ' + v.message)
    process.exit(0)
  }
  console.error('\nFAIL [' + v.kind + ', exit ' + v.code + '] — ' + v.message)
  console.error('  property : ' + v.property)
  console.error('  expected : ' + v.expected)
  console.error('  observed : ' + v.observed)
  if (v.action) console.error('  action   : ' + v.action)
  process.exit(v.code)
}
