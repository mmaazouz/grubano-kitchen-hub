#!/usr/bin/env node
'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   phase2-claims-pay-window.js — D′ lot L5 (spec v2 §8.8): the FAIL-CLOSED operator that would OPEN
   a bounded REFUNDS window for the CLAIMS FINANCIAL RAIL — and that REFUSES, by construction, today.

   WHY IT EXISTS. D′ separates DECIDING from PAYING. An admin decides a claim, with an amount, inside
   the business zone, 24/7, and no money moves. The money crosses later, on the rail
   (POST /api/admin/claims/pay-approved), and only while a REFUNDS lease is open. This operator is the
   only thing that opens that lease for the claims rail: it MEASURES, it OPENS, it WATCHES, it CLOSES,
   and it PROVES the close. It never pays anything itself — no Stripe write, no refund row, no e-mail,
   no claim field. The batch is typed by a named admin in the console; this file only holds the door.

   WHY IT REFUSES TODAY. `CERTIFIED_SHAS` below is EMPTY on purpose: a deployed commit is added to it
   only after L5 has been certified. Until then every run stops at the certification precheck with
   nothing written and a non-zero exit. That is the intended state of this file in the lot that
   introduces it — it is delivered refusing.

   MODES (on the server, with the nodevenv node, as its sibling operators are run:
     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-claims-pay-window.js …)
     node scripts/server/phase2-claims-pay-window.js            → PRECHECK, READ-ONLY (default)
         Runs every precheck, prints it, opens NOTHING and exits NON-ZERO. A precheck is never a
         success here: this operator reports PASS only when a window was opened, used and proven
         closed again.
     node scripts/server/phase2-claims-pay-window.js window     → BOUNDED WINDOW
         Everything above, then — and only then — the window. It additionally requires the
         authorization sentence in PHASE2_CLAIMS_PAY_CONFIRM.

   VARIABLES
     PHASE2_CLAIMS_PAY_CONFIRM="I AUTHORIZE THE STAGING CLAIMS PAY WINDOW"   (window mode, required)
     PHASE2_CLAIMS_PAY_WINDOW_MS   default 15 min; ceiling 28 min (lease = window + 2 min ≤ 30 min)
     PHASE2_CLAIMS_PAY_POLL_MS · PHASE2_RELOAD_DEADLINE_MS · PHASE2_RELOAD_INTERVAL_MS
     PHASE2_APP_ROOT · PHASE2_BASE_URL (tests only — the reused re-freeze reads PHASE2_APP_ROOT too)

   RESULTS (last line « RESULT: … ») — only PASS exits 0
     PASS                    window opened, watched, closed, and the refund gate PROVEN closed again
     WAIT — …                nothing to pay, or T-42 funding short: NOTHING was opened
     REFUSED — …             a precheck refused, or no authorization: NOTHING was opened
     PRECHECK ONLY — …       every precheck green in read-only mode: NOTHING was opened (exit 1)
     FAIL                    an anomaly (including after a close: read the CLOSE and PROBE lines)

   WHAT IT NEVER WRITES. `CLAIMS_ENABLED`, `CLAIMS_WINDOW_UNTIL`, `CLAIMS_SURFACE_ENABLED` and
   `CLAIMS_INTAKE_ENABLED` are refused by a compiled guard (`writeRefundFlag`): the legacy rehearsal
   lease never opens this rail (S-14), and the product surface is a founder decision, not an
   operator's. The only two keys it may ever write are REFUNDS_WINDOW_UNTIL and REFUNDS_ENABLED.

   NO SECRET, NO DSN is ever printed: the database NAME is printed, never the connection string; the
   internal token used to read the census is never echoed; every error goes through `scrub`.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

/* ── REQUIRE ORDER IS LOAD-BEARING — do not move these two lines ─────────────────────────────────
   phase2-refund-gate.js registers, AT REQUIRE TIME, the signal / uncaughtException / unhandledRejection
   handlers that write REFUNDS_WINDOW_UNTIL into the past and REFUNDS_ENABLED=false before exiting. Node
   runs signal listeners in registration order and the first one that calls process.exit ends the
   process, so the re-freeze must be registered FIRST or a Ctrl-C would leave the money gate open.
   phase2-modeb-gate.js (required after it, for the shared operator lock path and its Stripe readers)
   registers handlers of its own that exit — they would run only if the re-freeze had not already
   exited. This operator therefore registers NO signal handler of its own: a second set would be dead
   code pretending to protect something. ARM the re-freeze (GATE.armRefreeze) and it is real. */
const GATE = require(path.join(__dirname, 'phase2-refund-gate.js'))
const MODEB = require(path.join(__dirname, 'phase2-modeb-gate.js'))
const H = require(path.join(__dirname, 'reconcile-helpers.js'))
const prov = require(path.join(__dirname, 'env-provenance.js'))

const MODE = process.argv[2] === 'window' ? 'window' : 'precheck'
/* The SAME expression the two reused operators compute: GATE.emergencyRefreeze touches
 * <its own APP_ROOT>/tmp/restart.txt, so a divergence here would restart the wrong application. */
const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const CONFIRM_SENTENCE = 'I AUTHORIZE THE STAGING CLAIMS PAY WINDOW'
const UA = 'grubano-phase2-claims-pay-window/1'

/* ── THE CERTIFICATION LIST (spec v2 §8.8, S-14) ─────────────────────────────────────────────────
   A deployed commit is added here ONLY after L5 has been certified on staging (full suite, fresh
   build, adversarial review of the money zone, differential controls). The list is EMPTY in the lot
   that ships this file, so the operator refuses every run by construction — that is the delivered
   state, not an oversight. Adding a SHA is a deliberate, reviewed edit of this constant; nothing at
   runtime — no argument, no environment variable — can extend it. */
const CERTIFIED_SHAS = []

/* Lease arithmetic. The application's own ceiling is compiled in lib/refund.ts
 * (REFUND_WINDOW_MAX_MS = 30 min) and is never guessed here: the lease is written at
 * window + 2 min, and a window above 28 min is REFUSED rather than silently shortened — an
 * operator that kept announcing a window the application had already closed would be lying. */
const REFUND_LEASE_MAX_MS = 30 * 60 * 1000
const LEASE_SLACK_MS = 2 * 60 * 1000
const WINDOW_MS = Number(process.env.PHASE2_CLAIMS_PAY_WINDOW_MS || 15 * 60 * 1000)
const POLL_MS = Number(process.env.PHASE2_CLAIMS_PAY_POLL_MS || 15000)
const RELOAD_DEADLINE_MS = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)
/** Any HTTP probe is bounded: a hung request must never carry the loop past the lease. */
const FETCH_TIMEOUT_MS = 20000
/** The human's « I am done » signal: `touch tmp/claims-pay-window.stop` closes the window early. */
const STOP_FILE = path.join(APP_ROOT, 'tmp', 'claims-pay-window.stop')

/* ── The ONLY two keys this operator may ever write (spec v2 §8.8) ───────────────────────────────
   REFUNDS_WINDOW_UNTIL first, then REFUNDS_ENABLED: the lease is what actually authorizes, and a
   flag without a lease authorizes nothing (lib/refund refundGateState). */
const WRITABLE_KEYS = Object.freeze(['REFUNDS_WINDOW_UNTIL', 'REFUNDS_ENABLED'])
/** Refused by the guard below, whatever any caller believes. The legacy lease never opens this rail. */
const FORBIDDEN_KEYS = Object.freeze(['CLAIMS_ENABLED', 'CLAIMS_WINDOW_UNTIL', 'CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'])

/* Machine paths that must not be armed while money may move. The first six are the union of what
 * phase2-refund-gate.js and phase2-modeb-gate.js already treat as dangerous; TIPS_ENABLED is added
 * because a tip charged without the courier payout rail is third-party money held indefinitely. */
const DANGEROUS_FLAGS = Object.freeze([
  'ALLOW_PLATFORM_FALLBACK', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED',
  'GHOST_ORDER_AUTO_REFUND_ENABLED', 'PUNITIVE_CAPTURE_ENABLED', 'REFUND_VOID_ENABLED', 'TIPS_ENABLED',
])

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
const mask = (s) => (typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : (s ? '***' : 'null'))
/** The house masking chain: Stripe key, then any URL, then any 24-char-or-longer token, then 160 chars. */
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m))
  .replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***')
  .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>')
  .replace(/[A-Za-z0-9_-]{24,}/g, '…')
  .slice(0, 160)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** true only once the window has actually been opened — the report never implies a write that did not happen. */
let openedWindow = false
/**
 * true from the instant the FIRST .env.local write is ATTEMPTED. It is deliberately not the same fact
 * as `openedWindow`: a throw between the lease write and the flag write leaves the gate closed (no
 * money can move) but the file rewritten and a backup created, and the report's headline about its own
 * side effects must say so rather than claim the file was untouched.
 */
let touchedEnv = false

function done(result, failedStep) {
  releaseLock()
  console.log('========================================')
  console.log('GRUBANO D′ L5 — CLAIMS PAY WINDOW (' + (MODE === 'window' ? 'BOUNDED REFUNDS WINDOW' : 'PRECHECK, READ-ONLY') + ') — every value below is MEASURED')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  console.log('WINDOW OPENED BY THIS RUN: ' + (openedWindow
    ? 'YES — read the CLOSE and PROBE lines below'
    : touchedEnv
      ? 'NO — the gate was never armed, BUT .env.local WAS written (a write failed between the lease and the flag): read the CLOSE lines and check the file and its backups'
      : 'NO — nothing was written to .env.local'))
  console.log('MONEY MOVED BY THIS SCRIPT: NO — it never calls Stripe with a write, never creates a refund row, never sends an e-mail')
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  // PASS only. A green precheck is deliberately non-zero: nothing was opened, so nothing succeeded.
  process.exitCode = result.startsWith('PASS') ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const refuse = (step) => { A(step); done('REFUSED — ' + step, step); return null }

/* ── .env.local writes: the reused primitive, behind a compiled key guard ────────────────────────
   GATE.writeFlag is phase2-refund-gate.js's own canonical write (backup first, duplicates
   neutralised, mode 600) — reused, never copied. Its marker and its backup name therefore say
   `phase2-refund-gate`; the stamp this operator passes carries `claims-pay-window`, and the backup
   names are printed, so nobody reads a backup as the work of another operator. */
function writeRefundFlag(envFile, key, value, stamp) {
  if (FORBIDDEN_KEYS.includes(key)) throw new Error('refusing to write ' + key + ' — this operator never touches a CLAIMS flag')
  if (!WRITABLE_KEYS.includes(key)) throw new Error('refusing to write ' + key + ' — only ' + WRITABLE_KEYS.join(' and ') + ' are writable here')
  return GATE.writeFlag(envFile, key, value, stamp)
}
function touchRestart() {
  fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), 'phase2-claims-pay-window ' + new Date().toISOString())
}

/* ── the shared phase2 operator lock ─────────────────────────────────────────────────────────────
   The PATH is phase2-modeb-gate.js's (one lock for the whole family, so a pay window and a Mode B
   rehearsal can never run together); only the `op` label is written by this file, because a lock
   claiming to be held by another operator is a lie a reader would act on. SCOPE, honestly:
   phase2-refund-gate.js and phase2-claims-gate.js still do not take it, so it excludes a second
   Mode B or a second pay window, not every sibling. On a signal the re-freeze exits first (see the
   require-order note), so the lock is left behind — the next run sees a dead pid and reclaims it. */
const LOCK_FILE = MODEB.LOCK_FILE
function takeLock() {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true })
  if (fs.existsSync(LOCK_FILE)) {
    let held = null
    try { held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) } catch { held = { pid: null, op: 'unknown' } }
    let alive = false
    if (held && held.pid) { try { process.kill(held.pid, 0); alive = true } catch { alive = false } }
    if (alive) return { ok: false, held }
    F('STALE OPERATOR LOCK', 'pid ' + (held && held.pid) + ' (' + (held && held.op) + ') no longer running — reclaimed')
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, op: 'phase2-claims-pay-window', at: new Date().toISOString() }), { mode: 0o600 })
  return { ok: true }
}
function releaseLock() {
  try {
    const held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
    if (held && held.pid === process.pid) fs.unlinkSync(LOCK_FILE)
  } catch { /* best-effort: never remove a lock that is not ours */ }
}

/* ── runtime probes (the same shapes the sibling operators use) ──────────────────────────────────
   CLOSED = 403 with gated:true / enabled:false · OPEN = 401 · anything else is UNKNOWN. A 429 is a
   rate limit hit BEFORE the gate and proves nothing (Mode A lesson), so it is never read as closed. */
async function probe(base, pathname) {
  try {
    const r = await fetch(base + pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: '{}', redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && (b.gated === true || b.enabled === false)) return 'CLOSED'
    if (r.status === 401) return 'OPEN'
    return 'UNKNOWN(' + r.status + ')'
  } catch { return 'UNREACHABLE' }
}
const probeRefunds = (base) => probe(base, '/api/admin/refunds/run')
const probeClaims = (base) => probe(base, '/api/claims')
async function waitRefundGate(base, want, deadlineMs, intervalMs) {
  const t0 = Date.now(); let last = 'n/a', n = 0
  while (Date.now() - t0 < deadlineMs) {
    n++; last = await probeRefunds(base)
    if (last === want) return { ok: true, elapsedMs: Date.now() - t0, probes: n, last }
    await sleep(intervalMs)
  }
  return { ok: false, elapsedMs: Date.now() - t0, probes: n, last }
}

/**
 * The census (GET /api/admin/claims/census, internal token) — the ONLY view of what the RUNNING
 * process believes: its gates, its schema probe, and the closure notices it has not sent. Counts
 * only: no id, no amount, no free text. The token is used and never printed.
 */
async function fetchCensus(base, token) {
  const r = await fetch(base + '/api/admin/claims/census', {
    headers: { 'X-Internal-Token': token, 'User-Agent': UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (r.status !== 200) throw new Error('census_http_' + r.status)
  const b = await r.json().catch(() => null)
  if (!b || typeof b !== 'object' || !b.schema || typeof b.schema.ready !== 'boolean' || !b.gates || !b.claims) {
    throw new Error('census_shape_unknown')
  }
  return b
}

/** The notices the application says it could not send — printed, never interpreted away. */
function printNotices(label, census) {
  const c = (census && census.claims && census.claims.closure) || null
  const missing = c && c.missing !== undefined ? c.missing : null
  const without = c && c.terminalWithoutRecord !== undefined ? c.terminalWithoutRecord : null
  F(label, 'closure notices NOT SENT = ' + (missing === null ? 'NOT MEASURED' : missing) +
    ' · terminal claims with NO closure record = ' + (without === null ? 'NOT MEASURED' : without))
}

/**
 * T-42 funding, PER CONNECT DESTINATION (spec v2 §8.8). Stripe reverses a transfer against the
 * connected account's AVAILABLE balance, gross, so the question is per account and not per platform:
 * « does each destination hold at least the sum of the approved amounts routed to it? »
 *
 * READ-ONLY throughout (PaymentIntent, balance, account); a fact that cannot be read is an anomaly,
 * never a zero. Returns the groups so the report can print them and the verdict can be re-derived.
 */
async function measureFundingByAccount(adapter, entries, core) {
  const groups = new Map()
  const piCache = new Map()
  for (const e of entries) {
    if (!e.paymentIntentId) { A('7 funding: claim ' + mask(e.claimId) + ' — its order carries no PaymentIntent, the destination account is NOT KNOWABLE'); continue }
    let pi = piCache.get(e.paymentIntentId)
    if (!pi) {
      try { pi = await adapter.retrievePaymentIntent(e.paymentIntentId) } catch (err) {
        A('7 funding: PaymentIntent of claim ' + mask(e.claimId) + ' unreadable (' + scrub(err) + ') — funding NOT PROVEN')
        continue
      }
      piCache.set(e.paymentIntentId, pi)
    }
    if (pi.livemode === true) { A('7 funding: a LIVE PaymentIntent is in the selection — this operator is Stripe TEST only'); continue }
    if (pi.currency !== 'eur') { A('7 funding: PaymentIntent of claim ' + mask(e.claimId) + ' is in « ' + pi.currency + ' » — the EUR balance comparison would not hold'); continue }
    const ch = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    if (!ch) { A('7 funding: no readable charge on the PaymentIntent of claim ' + mask(e.claimId) + ' — funding NOT PROVEN'); continue }
    // A disputed charge has already moved the money out without touching amount_refunded: it must
    // never enter a refund window (PRE-MODE-B V1).
    if (typeof ch.disputed !== 'boolean') { A('7 funding: `disputed` unreadable on the charge of claim ' + mask(e.claimId) + ' — dispute NOT DISPROVEN'); continue }
    if (ch.disputed === true) { A('7 funding: the charge of claim ' + mask(e.claimId) + ' is DISPUTED — refunding it is forbidden'); continue }
    const dest = pi.transfer_data && pi.transfer_data.destination
      ? (typeof pi.transfer_data.destination === 'string' ? pi.transfer_data.destination : pi.transfer_data.destination.id) : null
    if (!dest) { A('7 funding: no Connect destination on the PaymentIntent of claim ' + mask(e.claimId) + ' — funding NOT VERIFIABLE'); continue }
    if (!groups.has(dest)) groups.set(dest, { dest, rows: [], grossCents: 0, available: null, schedule: null })
    groups.get(dest).rows.push(e)
  }
  for (const g of groups.values()) {
    // ONE definition of the sum, the core's: the operator sizes funding on exactly the amounts the
    // rail would offer to the engine.
    g.grossCents = core.sumApprovedCents(g.rows)
    try {
      const bal = MODEB.readAvailableEur(await adapter.balanceFor(g.dest))
      g.available = bal.available
      g.pending = bal.pending
    } catch (err) {
      A('7 funding: connected balance of ' + mask(g.dest) + ' unreadable (' + scrub(err) + ') — funding NOT PROVEN')
      continue
    }
    try {
      g.schedule = MODEB.readPayoutSchedule(await adapter.retrieveAccount(g.dest))
      if (g.schedule !== 'manual') A('7 funding: payout schedule « ' + g.schedule + ' » on ' + mask(g.dest) + ' — an automatic payout could sweep the funds during the window')
    } catch (err) { A('7 funding: payout schedule of ' + mask(g.dest) + ' unreadable (' + scrub(err) + ') — precondition NOT PROVEN') }
  }
  return groups
}

/**
 * Any refund attempt in flight ANYWHERE, not only on the claims this window was opened for: a `Refund`
 * row still `pending`, or a claim parked in `refunding` by the rail's T1 CAS for the duration of its
 * Stripe call. Returns null when the state could not be read — « not measured », never « nothing ».
 */
async function inFlightAttempts(prisma) {
  try {
    const rows = await prisma.refund.findMany({ where: { status: 'pending' }, select: { id: true } })
    const refunding = await prisma.claim.findMany({ where: { status: 'refunding' }, select: { id: true } })
    return { rows, refunding }
  } catch (e) {
    A('9 settle: read — ' + scrub(e))
    return null
  }
}

/** The T-42 verdict, per account: every group must be readable and funded. */
function fundingShortfalls(groups) {
  const out = []
  for (const g of groups.values()) {
    if (g.available === null) { out.push({ dest: g.dest, grossCents: g.grossCents, available: null }); continue }
    if (g.available < g.grossCents) out.push({ dest: g.dest, grossCents: g.grossCents, available: g.available })
  }
  return out
}

async function main() {
  console.log('')
  console.log('GRUBANO D′ L5 — CLAIMS PAY WINDOW OPERATOR (' + (MODE === 'window' ? 'BOUNDED WINDOW' : 'PRECHECK, READ-ONLY') + ')')
  console.log('It opens a REFUNDS lease for the claims rail. It pays nothing itself.')
  console.log('')
  F('MODE', MODE)
  // Stated up front, as a FACT and not a refusal: the sentence is verified at step 9, after every
  // measurement, so the founder reads what a window WOULD do before authorizing one. Printing it
  // here removes the surprise, and adds no way past the check.
  F('AUTHORIZATION SENTENCE (PHASE2_CLAIMS_PAY_CONFIRM)', process.env.PHASE2_CLAIMS_PAY_CONFIRM === CONFIRM_SENTENCE
    ? 'PRESENT and exact — a window WILL be opened if every precheck passes'
    : (MODE === 'window' ? 'ABSENT or incorrect — the window will be REFUSED at step 9, nothing will be opened' : 'not read in precheck mode — nothing can be opened'))

  const lock = takeLock()
  if (!lock.ok) return refuse('0 lock: another phase2 operator holds the lock (pid ' + lock.held.pid + ', ' + lock.held.op + ') — nothing changed')

  // ── [1] TARGET: STAGING ONLY, proven, never assumed ───────────────────────────────────────────
  console.log('[1] target + env')
  const envFile = path.join(APP_ROOT, '.env.local')
  if (!fs.existsSync(envFile)) return refuse('1 env: .env.local not found under the app root')
  // An app root that NAMES production is refused before anything is read. `~/grubano.com` is
  // production; `~/app.grubano.com` is staging; the difference is one prefix, so it is anchored.
  const rootPosix = path.resolve(APP_ROOT).split(path.sep).join('/')
  const rootIsProd = /(^|\/)grubano\.com(\/|$)/.test(rootPosix) && !/(^|\/)app\.grubano\.com(\/|$)/.test(rootPosix)
  F('APP ROOT', rootPosix)
  if (rootIsProd) return refuse('1 target: the app root names PRODUCTION (grubano.com without the app. prefix) — refusing before any read')

  let envLoad = { loader: 'NOT LOADED' }
  try { envLoad = H.loadRuntimeEnv(APP_ROOT) } catch (e) { return refuse('1 env: runtime env loader failed — ' + scrub(e)) }
  let merged = {}
  // ⚠️ SIGNATURE: readNextEnvFiles(fs, path, dir) — called with the root alone it silently returns {}.
  try { merged = prov.mergeNextEnvFiles(prov.readNextEnvFiles(fs, path, APP_ROOT)).merged || {} } catch (e) { return refuse('1 env: reading the .env files — ' + scrub(e)) }
  if (!Object.keys(merged).length) return refuse('1 env: no key read from the .env files — the FILE view is empty, nothing is provable')
  F('ENV LOADER', envLoad.loader)

  // The FILE view, never the shell: the house protocol prefixes commands with NEXTAUTH_URL=…, and a
  // production guard that reads what the human typed guards nothing.
  const fileUrl = (merged.NEXTAUTH_URL || '').replace(/\/$/, '')
  const shellUrl = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  F('NEXTAUTH_URL (files)', fileUrl || 'ABSENT')
  if (!/^https:\/\/app\.grubano\.com$/i.test(fileUrl)) return refuse('1 target: NEXTAUTH_URL in the FILES is not exactly https://app.grubano.com — this operator is STAGING ONLY (production forbidden, ambiguity refused)')
  if (shellUrl && shellUrl !== fileUrl) return refuse('1 target: the shell NEXTAUTH_URL (' + shellUrl + ') diverges from the files — refusing to be moved off target')
  const base = (process.env.PHASE2_BASE_URL || fileUrl).replace(/\/$/, '')
  if (!/^https:\/\/app\.grubano\.com$/i.test(base)) return refuse('1 target: probe base ' + base + ' — only https://app.grubano.com is allowed')

  // The database NAME only (the DSN is never printed, here or anywhere else).
  const dbName = ((merged.DATABASE_URL || process.env.DATABASE_URL || '').match(/\/([A-Za-z0-9_-]+)(\?|$)/) || [])[1] || 'unknown'
  const dbLooksStaging = /_staging$/.test(dbName)
  const dbLooksProd = /prod/i.test(dbName) || dbName === 'deyi0010_grubano' || (/grubano$/.test(dbName) && !dbLooksStaging)
  F('DATABASE (name only)', dbName + (dbLooksStaging ? ' (staging-named)' : ' — staging proven by NEXTAUTH_URL, not by this name'))
  if (dbLooksProd) return refuse('1 target: the database name looks like PRODUCTION (' + dbName + ') — refusing before any read')
  if (dbName === 'unknown') return refuse('1 target: no DATABASE_URL in the file view — the target database is AMBIGUOUS, refusing')

  // ── THE SAME SYMMETRY AS NEXTAUTH_URL, for the two other keys that decide what is measured ──────
  // @next/env never overrides a pre-existing process.env value (env-provenance), and the house protocol
  // teaches prefixing operator commands. So a shell-exported DSN is the one the PrismaClient below
  // connects with, while the guard above judged the FILE's — every claim, order, destination account and
  // T-42 sum would then be measured against a database this report does not name, and the window would
  // be opened in the staging application anyway. Same for the Stripe key: `envFacts` proves the SHELL
  // key is sk_test_, never that the FILE key the application itself uses is.
  const shellDsn = (process.env.DATABASE_URL || '').trim()
  const fileDsn = (merged.DATABASE_URL || '').trim()
  if (shellDsn && fileDsn && shellDsn !== fileDsn) {
    return refuse('1 target: the shell DATABASE_URL diverges from the files — the database this operator would MEASURE is not the one the application uses. Refusing to be moved off target (values never printed)')
  }
  if (shellDsn && !fileDsn) {
    return refuse('1 target: a DATABASE_URL is exported in the shell but absent from the files — the target database is AMBIGUOUS, refusing')
  }
  const shellStripe = (process.env.STRIPE_SECRET_KEY || '').trim()
  const fileStripe = (merged.STRIPE_SECRET_KEY || '').trim()
  if (shellStripe && fileStripe && shellStripe !== fileStripe) {
    return refuse('1 target: the shell STRIPE_SECRET_KEY diverges from the files — the Stripe account this operator would MEASURE is not the one the application charges. Refusing (values never printed)')
  }
  // The FILE key is what the application uses, so it is the one that must be TEST.
  const fileStripeMode = fileStripe.startsWith('sk_test_') ? 'TEST' : fileStripe ? 'LIVE-OR-UNKNOWN' : 'ABSENT'
  const rt = H.envFacts(process.env)
  F('STRIPE MODE', rt.stripeMode + ' (shell) · ' + fileStripeMode + ' (files — the one the application uses)')
  if (rt.stripeMode !== 'TEST') return refuse('1 target: the Stripe key is not sk_test_ — this operator is Stripe TEST only')
  if (fileStripeMode !== 'TEST') return refuse('1 target: the Stripe key IN THE FILES is not sk_test_ (' + fileStripeMode + ') — the application would charge a non-TEST account. Refusing')

  // ── [2] FLAGS (FILE VIEW) ─────────────────────────────────────────────────────────────────────
  console.log('[2] flags (file view)')
  const show = (k) => (merged[k] === undefined ? 'ABSENT → effective false' : JSON.stringify(merged[k]))
  for (const k of ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED', 'CLAIMS_ENABLED', 'ADMIN_AUDIT_ENABLED', 'REFUNDS_ENABLED']) F('FLAG ' + k, show(k))
  // The product surface, strictly: PAYER requires isRefundsEnabled() ∧ isClaimsSurfaceEnabled(); a
  // window opened without the surface would be a lease nobody can use.
  if (merged.CLAIMS_SURFACE_ENABLED !== 'true') return refuse('2 flag: CLAIMS_SURFACE_ENABLED is not exactly « true » — the rail refuses PAYER without the product surface (S-14). Nothing changed')
  // The legacy rehearsal lease never opens this rail; its presence beside a pay window means two
  // authorization systems are live at once.
  if (!(merged.CLAIMS_ENABLED === undefined || merged.CLAIMS_ENABLED === 'false')) {
    return refuse('2 flag: CLAIMS_ENABLED is ' + show('CLAIMS_ENABLED') + ' — the legacy rehearsal lease must be absent or false; it never opens the claims rail (S-14). Nothing changed')
  }
  // S-30: no audit, no payment. A rail that cannot say who paid what must not pay.
  if (merged.ADMIN_AUDIT_ENABLED !== 'true') return refuse('2 flag: ADMIN_AUDIT_ENABLED is not « true » — PAYER answers 409 audit_disabled (S-30). Nothing changed')
  for (const k of DANGEROUS_FLAGS) {
    // Both views: @next/env never overrides a pre-existing process.env value, so a shell-exported flag is
    // the one the application would read. « Effective false » must mean both, or the line is not measured.
    const shell = process.env[k]
    F('FLAG ' + k, show(k) + (shell === undefined ? '' : ' · shell ' + JSON.stringify(shell)))
    if (merged[k] === 'true') return refuse('2 flag: ' + k + ' is true — no money automation may be armed while a refund window is open. Nothing changed')
    if (shell === 'true') return refuse('2 flag: ' + k + ' is true IN THE SHELL — the application would read it as armed. Nothing changed')
  }
  // The auto-approve ceiling is a NUMBER, so « off » is 0 / absent: a positive value arms a machine
  // path that decides money without a human.
  const capRaw = (merged.CLAIM_AUTO_APPROVE_MAX_CENTS === undefined ? '' : String(merged.CLAIM_AUTO_APPROVE_MAX_CENTS)).trim()
  F('FLAG CLAIM_AUTO_APPROVE_MAX_CENTS', capRaw === '' ? 'ABSENT → 0 (disabled)' : JSON.stringify(capRaw))
  if (!(capRaw === '' || /^0+$/.test(capRaw))) return refuse('2 flag: CLAIM_AUTO_APPROVE_MAX_CENTS is ' + JSON.stringify(capRaw) + ' — an auto-approval ceiling is armed. Nothing changed')
  // The gate must already be closed: opening on top of an open window would hide whose window it is.
  if (merged.REFUNDS_ENABLED === 'true') return refuse('2 flag: REFUNDS_ENABLED is already true in the files — another window is open or was left open; refusing to write on top of it')
  // Presence only, never a value: without the session secret the rail cannot sign a batch (503
  // token_unsignable) and the window would authorize a rail nobody can use.
  if (!((merged.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET || '').length)) return refuse('2 env: NEXTAUTH_SECRET is absent — the rail could not sign a dryRun batch, so the window would be useless')
  const internalToken = (merged.INTERNAL_CRON_TOKEN || process.env.INTERNAL_CRON_TOKEN || '').trim()
  F('INTERNAL_CRON_TOKEN (presence only)', internalToken ? 'present' : 'ABSENT')
  if (!internalToken) return refuse('2 env: INTERNAL_CRON_TOKEN is absent — the schema probe (census) cannot be read, so schema readiness is NOT PROVABLE')

  // ── [3] THE DEPLOYED BUILD MUST BE CERTIFIED ──────────────────────────────────────────────────
  console.log('[3] deployed build vs CERTIFIED_SHAS')
  let version = null
  try { version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public', 'version.json'), 'utf8')) } catch { version = null }
  if (!version || !version.commit) return refuse('3 certification: public/version.json unreadable — the deployed build cannot be identified')
  const deployedSha = String(version.shortCommit || String(version.commit).slice(0, 7))
  F('DEPLOYED BUILD (file)', deployedSha + ' (branch ' + (version.branch || '?') + ', built ' + (version.buildDate || '?') + ')')
  if (version.branch && version.branch !== 'develop') return refuse('3 certification: the deployed branch is « ' + version.branch + ' » — this operator runs on develop/staging only')
  // Cross-check what the host actually serves: files on disk that do not match the served artifact
  // mean the deploy is half-applied, and half a deploy is not a certified build.
  let served = null
  try { served = await (await fetch(base + '/version.json', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json() } catch (e) { return refuse('3 certification: GET /version.json unreadable (' + scrub(e) + ') — the running deployment cannot be identified') }
  const servedShort = served && (served.shortCommit || String(served.commit || '').slice(0, 7))
  F('DEPLOYED BUILD (served)', servedShort || 'NOT MEASURED')
  if (!servedShort || servedShort !== deployedSha) return refuse('3 certification: the served build (' + (servedShort || 'unreadable') + ') differs from the files on disk (' + deployedSha + ') — refusing a half-applied deploy')
  // A malformed entry must never widen the list: `deployedSha.startsWith('')` is true for EVERY build, so a
  // stray empty or short string added by a careless edit would certify the whole repository. Refused here,
  // before the match, rather than trusted to the care of a future editor of a money gate.
  const badPins = CERTIFIED_SHAS.filter((s) => typeof s !== 'string' || !/^[0-9a-f]{7,40}$/i.test(String(s).trim()))
  if (badPins.length) return refuse('3 certification: CERTIFIED_SHAS holds ' + badPins.length + ' malformed entr' + (badPins.length > 1 ? 'ies' : 'y') + ' (a commit is 7 to 40 hex characters) — a malformed pin would certify builds it was never meant to. Nothing changed')
  F('CERTIFIED_SHAS', CERTIFIED_SHAS.length ? CERTIFIED_SHAS.join(', ') : 'EMPTY — no build has been certified for the claims pay rail yet')
  if (!CERTIFIED_SHAS.some((s) => String(s).startsWith(deployedSha) || deployedSha.startsWith(String(s).slice(0, 7)))) {
    return refuse('3 certification: the deployed build ' + deployedSha + ' is NOT in CERTIFIED_SHAS — a window is never opened on an uncertified build (S-14). Nothing changed')
  }

  // ── [4] THE LIVE PROCESS ──────────────────────────────────────────────────────────────────────
  console.log('[4] live process (gates + schema probe)')
  const refundGate0 = await probeRefunds(base)
  F('REFUND GATE (live, unauthenticated probe)', refundGate0 + ' (CLOSED = 403 gated = REFUNDS_ENABLED false in the process)')
  if (refundGate0 !== 'CLOSED') return refuse('4 gate: the live refund gate is ' + refundGate0 + ' — it must be CLOSED before a window is opened. Nothing changed')
  const claimsGate0 = await probeClaims(base)
  F('CLAIMS SURFACE (live, POST /api/claims)', claimsGate0 + ' (OPEN = 401 ; UNKNOWN(403) = intake_closed, surface live ; CLOSED = surface off)')
  if (claimsGate0 === 'CLOSED') return refuse('4 gate: the live claims surface is CLOSED in the process — whatever the files say, PAYER would answer 403 surface_closed. Nothing changed')
  if (claimsGate0 === 'UNREACHABLE') return refuse('4 gate: the application is unreachable — nothing about the live process is provable')

  let census = null
  try { census = await fetchCensus(base, internalToken) } catch (e) { return refuse('4 census: GET /api/admin/claims/census unreadable (' + scrub(e) + ') — the process view is NOT MEASURED') }
  const g = census.gates || {}
  F('PROCESS GATES (census)', 'claimsSurfaceEnabled ' + g.claimsSurfaceEnabled + ' · claimsIntakeEnabled ' + g.claimsIntakeEnabled + ' · legacy claimsEnabled ' + g.claimsEnabled + ' · refundsEnabled ' + g.refundsEnabled)
  if (g.claimsSurfaceEnabled !== true) return refuse('4 census: the RUNNING process reports claimsSurfaceEnabled false — the deployed process has not picked up the product flag. Nothing changed')
  if (g.claimsEnabled === true) return refuse('4 census: the RUNNING process reports the legacy claims lease OPEN — it never opens this rail (S-14). Nothing changed')
  if (g.refundsEnabled === true) return refuse('4 census: the RUNNING process already reports refundsEnabled true — another window is live. Nothing changed')
  // spec v2 §9 / S-27: without the three D′ columns the rail answers 503 and nothing is payable.
  F('SCHEMA PROBE (census)', 'ready ' + census.schema.ready + ' · client ' + census.schema.clientReady + ' · db ' + census.schema.dbReady + (census.schema.why ? ' · ' + census.schema.why : ''))
  if (census.schema.ready !== true) return refuse('4 schema: the process reports schema.ready false — the D′ columns are not usable, the rail answers 503 (S-27). Run dprime-regen-client.js. Nothing changed')
  printNotices('NOTICES BEFORE (census)', census)

  // ── [5] THE SELECTION, RECOMPUTED IN THE DATABASE ─────────────────────────────────────────────
  // ONE definition of « payable », the rail's own: lib/claims-payable-core.js, required from the
  // DEPLOYED app root. A second copy of the WHERE here could open a window for a set the rail then
  // refuses — or close one while it still had work.
  console.log('[5] payable selection (lib/claims-payable-core.js, the rail’s own query)')
  const corePath = path.join(APP_ROOT, 'lib', 'claims-payable-core.js')
  if (!fs.existsSync(corePath)) return refuse('5 selection: payable core not shipped (' + path.relative(APP_ROOT, corePath).split(path.sep).join('/') + ' absent) — the selection cannot be recomputed with the rail’s own query. Nothing changed')
  let core
  try { core = require(corePath) } catch (e) { return refuse('5 selection: payable core unloadable — ' + scrub(e)) }
  if (typeof core.selectPayableClaims !== 'function' || typeof core.sumApprovedCents !== 'function' || !core.MAX_BATCH) {
    return refuse('5 selection: the payable core does not expose the expected surface — refusing to guess the selection')
  }
  F('PAYABLE CORE', path.relative(APP_ROOT, corePath).split(path.sep).join('/') + ' · MAX_BATCH ' + core.MAX_BATCH)

  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  if (!prismaRes.ok || !rt.databaseUrl) return refuse('5 db: prisma unavailable (' + (prismaRes.ok ? 'no DATABASE_URL' : prismaRes.error) + ') — the selection is NOT MEASURABLE')
  let prisma = null
  try { const { PrismaClient } = require(prismaRes.path); prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) }
  catch (e) { return refuse('5 db: prisma client construction failed — ' + scrub(e)) }

  let selected = []
  let entries = []
  let groups = new Map()
  try {
    selected = await core.selectPayableClaims(prisma, { take: core.MAX_BATCH })
    F('PAYABLE CLAIMS (DB, the rail’s own WHERE/ORDER/TAKE)', String(selected.length))
    for (const c of selected) {
      const why = core.approvedAmountRefusal(c)
      if (why) A('5 selection: claim ' + mask(c.id) + ' — ' + why + ' (the engine would refuse it without writing anything)')
    }
    if (!selected.length) {
      await prisma.$disconnect().catch(() => {})
      return done('WAIT — the payable selection is EMPTY: there is nothing to pay, so there is no reason to open a refund window. Nothing changed')
    }
    F('TOTAL APPROVED IN SELECTION (cents)', String(core.sumApprovedCents(selected)))

    // ── [6] the orders behind the selection (for the destination accounts) ──────────────────────
    console.log('[6] orders behind the selection')
    const orderIds = Array.from(new Set(selected.map((c) => c.orderId)))
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, paymentStatus: true, stripePaymentIntentId: true },
    })
    const byOrder = new Map(orders.map((o) => [o.id, o]))
    for (const c of selected) {
      const o = byOrder.get(c.orderId) || null
      if (!o) { A('6 order: the order of claim ' + mask(c.id) + ' is unreadable — its funding is NOT PROVABLE'); continue }
      if (o.paymentStatus !== 'paid') A('6 order: the order of claim ' + mask(c.id) + ' is « ' + o.paymentStatus + ' », not « paid »')
      entries.push({ claimId: c.id, orderId: c.orderId, approvedAmountCents: c.approvedAmountCents, paymentIntentId: o.stripePaymentIntentId })
    }
    F('ORDERS READ', orders.length + ' / ' + orderIds.length)

    // ── [7] T-42 FUNDING, PER CONNECT DESTINATION ACCOUNT ───────────────────────────────────────
    console.log('[7] T-42 funding per Connect destination (READ-ONLY Stripe)')
    let stripe = null
    try { stripe = H.makeStripeClient(process.env.STRIPE_SECRET_KEY, APP_ROOT, { apiBase: process.env.PHASE2_STRIPE_API_BASE }).client }
    catch (e) { A('7 stripe: client — ' + scrub(e)) }
    let adapter = null
    if (stripe) { try { adapter = MODEB.stripeAdapter(stripe) } catch (e) { A('7 stripe: client shape unusable (' + scrub(e) + ') — funding NOT MEASURED') } }
    if (!adapter) {
      await prisma.$disconnect().catch(() => {})
      return refuse('7 funding: no usable Stripe read client — the T-42 funding of the selection is NOT PROVABLE. Nothing changed')
    }
    F('STRIPE CLIENT', adapter.kind === 'rest-readonly' ? 'REST read-only (standalone runtime, no SDK)' : 'full SDK')
    groups = await measureFundingByAccount(adapter, entries, core)
    F('DESTINATION ACCOUNTS IN THE SELECTION', String(groups.size))
    for (const grp of groups.values()) {
      F('ACCOUNT ' + mask(grp.dest), grp.rows.length + ' claim(s) · GROSS ' + grp.grossCents + ' c · available ' +
        (grp.available === null ? 'NOT MEASURED' : grp.available + ' c') + (grp.pending === undefined ? '' : ' · pending ' + grp.pending + ' c') +
        ' · payout schedule ' + (grp.schedule || 'NOT MEASURED'))
    }
    const placed = Array.from(groups.values()).reduce((n, x) => n + x.rows.length, 0)
    F('CLAIMS PLACED ON A DESTINATION ACCOUNT', placed + ' / ' + entries.length)
    if (placed !== entries.length) A('7 funding: ' + (entries.length - placed) + ' selected claim(s) could not be attached to a destination account — their funding is NOT PROVEN')
    // Zero groups would make every verdict below vacuously true: « sufficient on every account » is
    // not something an operator may print when it measured no account at all.
    if (!groups.size) {
      await prisma.$disconnect().catch(() => {})
      return refuse('7 funding: no destination account could be established for any of the ' + selected.length + ' selected claim(s) — T-42 is NOT PROVEN, and an unproven funding is a refusal, not a pass. Nothing changed')
    }
    const shortfalls = fundingShortfalls(groups)
    if (shortfalls.length) {
      for (const s of shortfalls) {
        F('FUNDING SHORTFALL ' + mask(s.dest), s.available === null ? 'available NOT MEASURED vs GROSS ' + s.grossCents + ' c' : s.available + ' c available < ' + s.grossCents + ' c gross')
      }
      await prisma.$disconnect().catch(() => {})
      return done('WAIT — T-42: ' + shortfalls.length + ' destination account(s) do not hold the gross sum of their approved amounts (no manufactured funds, no platform advance). NOTHING was opened')
    }
    F('T-42 FUNDING', 'SUFFICIENT on every destination account (available ≥ Σ approvedAmountCents, gross)')
  } catch (e) {
    await prisma.$disconnect().catch(() => {})
    return refuse('5-7 measurement: ' + scrub(e) + ' — nothing changed')
  }

  // ── [8] lease arithmetic ──────────────────────────────────────────────────────────────────────
  F('LEASE CEILING', 'application ceiling ' + (REFUND_LEASE_MAX_MS / 60000) + ' min (lib/refund REFUND_WINDOW_MAX_MS) ⇒ window ≤ ' + ((REFUND_LEASE_MAX_MS - LEASE_SLACK_MS) / 60000) + ' min, lease = window + ' + (LEASE_SLACK_MS / 60000) + ' min')
  if (!Number.isFinite(WINDOW_MS) || WINDOW_MS <= 0) { await prisma.$disconnect().catch(() => {}); return refuse('8 window: PHASE2_CLAIMS_PAY_WINDOW_MS is not a positive duration') }
  if (WINDOW_MS + LEASE_SLACK_MS > REFUND_LEASE_MAX_MS) {
    await prisma.$disconnect().catch(() => {})
    return refuse('8 window: PHASE2_CLAIMS_PAY_WINDOW_MS=' + Math.round(WINDOW_MS / 60000) + ' min exceeds what the lease can cover (lease = window + 2 min, hard ceiling 30 min). This operator would keep reporting a window the application had already closed. Use 28 min or less. Nothing changed')
  }
  F('REQUESTED WINDOW', Math.round(WINDOW_MS / 60000) + ' min')

  if (anomalies.length && MODE === 'precheck') { await prisma.$disconnect().catch(() => {}); return done('REFUSED — precheck anomalies (see below); nothing was opened') }
  if (MODE === 'precheck') {
    await prisma.$disconnect().catch(() => {})
    // Deliberately NON-ZERO: a precheck opened nothing, so it succeeded at nothing. The founder’s
    // authorization is the only thing that turns this into a window.
    return done('PRECHECK ONLY — every precheck is green and NOTHING was opened. Re-run with the `window` argument and the authorization sentence to open one (exit code 1 by design)')
  }

  // ── [9] WINDOW MODE ───────────────────────────────────────────────────────────────────────────
  console.log('[9] window')
  if (process.env.PHASE2_CLAIMS_PAY_CONFIRM !== CONFIRM_SENTENCE) {
    await prisma.$disconnect().catch(() => {})
    return refuse('9 window: the authorization sentence is missing or incorrect (PHASE2_CLAIMS_PAY_CONFIRM) — nothing changed')
  }
  if (anomalies.length) { await prisma.$disconnect().catch(() => {}); return refuse('9 window: precheck anomalies — WINDOW REFUSED, nothing changed') }

  // A stop file left by an earlier run would close this window on its first poll, so it is cleared
  // BEFORE anything opens: a stop signal only ever means « stop the window that is open now ».
  try { if (fs.existsSync(STOP_FILE)) { fs.unlinkSync(STOP_FILE); F('STALE STOP FILE', 'removed before opening (it predates this window)') } }
  catch (e) { await prisma.$disconnect().catch(() => {}); return refuse('9 window: a stop file exists and could not be removed (' + scrub(e) + ') — the window would close on its first poll; nothing changed') }

  const stamp = new Date().toISOString() + '-claims-pay-window'
  // The pre-open snapshot, kept for the REPORT only. Neither the drain nor the settle check may be
  // scoped to it: deciding is 24/7, so the rail pays claims that joined the queue after this instant.
  const selectedIds = new Set(selected.map((c) => c.id))
  const leaseUntil = new Date(Date.now() + Math.min(WINDOW_MS + LEASE_SLACK_MS, REFUND_LEASE_MAX_MS)).toISOString()
  let stoppedBy = null
  try {
    // ARM BEFORE the first write: a signal between the write and the arming would escape the
    // re-freeze. The armed handler belongs to phase2-refund-gate.js and writes the same two keys.
    GATE.armRefreeze(envFile, stamp)
    // The LEASE first: if the flag write below fails, the authorization is already dead of old age.
    // `touchedEnv` is set BEFORE the write, not after it: the report's own headline about side effects
    // must not depend on a flag that a throw between the two writes would leave false — the file would
    // already carry a rewritten lease and a fresh backup.
    touchedEnv = true
    const lease = writeRefundFlag(envFile, 'REFUNDS_WINDOW_UNTIL', leaseUntil, stamp)
    const opened = writeRefundFlag(envFile, 'REFUNDS_ENABLED', 'true', stamp)
    openedWindow = true
    F('T-42 SCOPE (stated)', 'the funding verdict above covers the ' + selectedIds.size + ' claim(s) selected at OPEN time. Deciding is 24/7: a claim arbitrated with an amount WHILE this window is open is payable by the rail and is NOT covered by that verdict. The drain and the settle check below are therefore LIVE and unfiltered.')
    F('T-48 LEASE', 'REFUNDS_WINDOW_UNTIL=' + leaseUntil + ' — after this instant the application closes the gate by itself, with nobody acting (SIGKILL and host crash included)')
    F('OPEN WRITE', 'REFUNDS_ENABLED=true' + (opened.changed ? ' (backup ' + opened.backup + ')' : ' (already true)') + (lease.changed ? ' · lease backup ' + lease.backup : ''))
    F('BACKUP PROVENANCE', 'the backups above are named `.bak-refund-gate-…` because the canonical write primitive is phase2-refund-gate.js’s, reused rather than copied; the stamp carries `claims-pay-window`')
    F('EMERGENCY REFREEZE', 'ARMED (phase2-refund-gate.js handlers: SIGINT/SIGTERM/SIGHUP/SIGQUIT/SIGBREAK + uncaught throw ⇒ lease expired and REFUNDS_ENABLED=false written synchronously before exit; SIGKILL cannot be caught)')
    touchRestart()

    // The PROBE is the proof of the restart — not the touch.
    const w1 = await waitRefundGate(base, 'OPEN', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
    F('REFUND GATE AFTER OPEN', w1.last + ' after ' + Math.round(w1.elapsedMs / 1000) + ' s (' + w1.probes + ' probes)')
    if (!w1.ok) throw new Error('the refund gate did not open (still ' + w1.last + ')')

    // The deadline is re-anchored on the LEASE: opening may have consumed minutes of reload, and this
    // loop must never outlive the authorization it is watching.
    const leaseEndMs = new Date(leaseUntil).getTime()
    const deadline = Math.min(Date.now() + WINDOW_MS, leaseEndMs - LEASE_SLACK_MS)
    F('WINDOW', 'OPEN at ' + new Date().toISOString() + ' — the batch is typed by a named ADMIN in the console (dryRun, then confirm PAYER). This script only WATCHES. Until ' + new Date(deadline).toISOString() + ' (lease ' + leaseUntil + ')')
    F('EARLY STOP', 'touch ' + path.relative(APP_ROOT, STOP_FILE).split(path.sep).join('/') + ' to close the window before the deadline')

    let blips = 0
    while (Date.now() < deadline) {
      if (fs.existsSync(STOP_FILE)) { stoppedBy = 'operator_stop_file'; break }
      const rr = await probeRefunds(base)
      if (rr !== 'OPEN') {
        // One isolated probe can be a 429 (rate limit BEFORE the gate) or a network cut: neither
        // proves a closed gate. Two consecutive readings do.
        blips++
        if (blips >= 2) { stoppedBy = 'gate_inconsistent'; A('9 window: the refund gate read « ' + rr + ' » twice in a row — closing immediately'); break }
      } else blips = 0
      // The SAME query the rail uses, LIVE and unfiltered. Deciding is 24/7 (spec §1, D-3): a claim
      // arbitrated with an amount WHILE this window is open enters the payable set immediately, and the
      // rail's dryRun re-runs the selection at request time. Filtering this drain by the set captured
      // before the window existed would declare the queue empty while the rail was paying a claim that
      // joined it — and the close restarts Passenger. The drain is the LIVE queue, plus nothing in
      // flight; the pre-open set is reported for information only.
      try {
        const still = await core.selectPayableClaims(prisma, { take: core.MAX_BATCH })
        const inFlight = await inFlightAttempts(prisma)
        if (!still.length && inFlight && !inFlight.rows.length && !inFlight.refunding.length) {
          stoppedBy = 'selection_drained'
          const fromThisWindow = still.filter((c) => selectedIds.has(c.id)).length
          F('SELECTION DRAINED', 'the LIVE payable queue is empty and no attempt is in flight (of the ' + selectedIds.size + ' claims this window was opened for, ' + fromThisWindow + ' remain payable)')
          break
        }
      } catch (e) { A('9 window: the selection became unreadable (' + scrub(e) + ') — the drain is NOT MEASURED') }
      await sleep(POLL_MS)
    }
    if (!stoppedBy) stoppedBy = 'deadline'
    F('STOPPED BY', stoppedBy)

    // Never cut an attempt in flight: closing restarts Passenger, and a restart during a Stripe call
    // is exactly the absorbing state this whole train exists to avoid. Bounded by the lease.
    const settleUntil = Math.min(Date.now() + 90_000, leaseEndMs - 15_000)
    let unresolved = null
    let settleReadFailed = false
    while (Date.now() < settleUntil) {
      // UNFILTERED, for the same reason as the drain above: what must not be cut is ANY attempt in
      // flight, not only an attempt on a claim this window was opened for. A claim arbitrated while the
      // window was open is paid by the same rail, through the same Stripe call, and a restart during it
      // lands in exactly the absorbing state this train exists to avoid.
      const inFlight = await inFlightAttempts(prisma)
      if (!inFlight) { A('9 settle: read failed — the state before the close is NOT MEASURED'); settleReadFailed = true; break }
      unresolved = inFlight
      if (!inFlight.rows.length && !inFlight.refunding.length) break
      await sleep(5000)
    }
    if (unresolved && (unresolved.rows.length || unresolved.refunding.length)) {
      A('9 settle: an attempt is still UNRESOLVED at close (pending refund rows ' + unresolved.rows.length + ', claims refunding ' + unresolved.refunding.length + ') — the close and the restart happen anyway because the lease expires; human reconciliation required')
    } else if (!unresolved) {
      if (!settleReadFailed) A('9 settle: NOT MEASURED — the lease left no time to read the state before closing')
    } else F('SETTLE BEFORE CLOSE', 'no pending refund row, no claim in « refunding » — closing without cutting an attempt')
  } catch (e) {
    A('9 window: ' + scrub(e))
  } finally {
    // ── UNCONDITIONAL CLOSE — the LEASE first, then the flag ────────────────────────────────────
    try {
      const past = new Date(Date.now() - 1000).toISOString()
      writeRefundFlag(envFile, 'REFUNDS_WINDOW_UNTIL', past, stamp + '-close')
      const closed = writeRefundFlag(envFile, 'REFUNDS_ENABLED', 'false', stamp + '-close')
      F('CLOSE WRITE', 'REFUNDS_ENABLED=' + (closed.changed ? 'false (backup ' + closed.backup + ')' : 'false (already false)') + ' · lease expired at ' + past)
      touchRestart()
      const w2 = await waitRefundGate(base, 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
      F('REFUND GATE AFTER CLOSE', w2.last + ' after ' + Math.round(w2.elapsedMs / 1000) + ' s (' + w2.probes + ' probes)')
      if (!w2.ok) A('10 refreeze: the refund gate is NOT PROVEN closed (' + w2.last + ') — HUMAN ATTENTION REQUIRED NOW')
      // The rail itself: POST /api/admin/claims/pay-approved answers 403 « Accès refusé » to an
      // unauthenticated caller WHATEVER the lease says (resolveAdmin comes first), so this probe is
      // reported as what it is — a reachability check, not a proof of the gate. The proof of the
      // gate is the refunds probe above, and the census line below.
      const railStatus = await (async () => {
        try {
          const r = await fetch(base + '/api/admin/claims/pay-approved', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ dryRun: true }), redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          })
          return String(r.status)
        } catch (e) { return 'UNREACHABLE (' + scrub(e) + ')' }
      })()
      F('RAIL PROBE (POST /api/admin/claims/pay-approved, unauthenticated)', railStatus + ' — 403 here is « Accès refusé » (no admin session); it does NOT by itself prove the lease is closed')
      if (railStatus !== '403') A('10 rail: the unauthenticated rail probe answered ' + railStatus + ' instead of 403 — the admin guard did not answer as expected')
      // The re-freeze handler is deliberately LEFT ARMED after a clean close: it can only ever write
      // `false` again, so a signal during the steps below costs one redundant write and one restart,
      // whereas disarming it would create a stretch in which a signal did nothing at all.
      F('EMERGENCY REFREEZE AFTER CLOSE', GATE.isRefreezeArmed() ? 'still ARMED on purpose (it can only write false again)' : 'already consumed')
    } catch (e) {
      A('10 refreeze: ' + scrub(e))
      // The two writes shared one try: if the first threw, the second never happened. The armed
      // emergency re-freeze retries key by key, lease first, and restarts.
      const stillArmed = GATE.isRefreezeArmed()
      GATE.emergencyRefreeze('close write failed')
      if (stillArmed) {
        try {
          const w3 = await waitRefundGate(base, 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
          F('REFUND GATE AFTER EMERGENCY REFREEZE', w3.last + ' after ' + Math.round(w3.elapsedMs / 1000) + ' s')
          if (!w3.ok) A('10 refreeze: the refund gate is NOT PROVEN closed after the emergency re-freeze — HUMAN ATTENTION REQUIRED NOW')
        } catch (e2) { A('10 refreeze: probes after the emergency re-freeze — ' + scrub(e2)) }
      }
    }

    // ── the notices the rail could not send, read from the application itself ───────────────────
    try {
      const after = await fetchCensus(base, internalToken)
      printNotices('NOTICES AFTER (census)', after)
      F('PROCESS GATES AFTER (census)', 'refundsEnabled ' + (after.gates || {}).refundsEnabled + ' · claimsSurfaceEnabled ' + (after.gates || {}).claimsSurfaceEnabled + ' · legacy claimsEnabled ' + (after.gates || {}).claimsEnabled)
      if ((after.gates || {}).refundsEnabled === true) A('11 close: the RUNNING process still reports refundsEnabled true — the window is NOT closed in the process; HUMAN ATTENTION REQUIRED NOW')
    } catch (e) { A('11 census: the census is unreadable after the close (' + scrub(e) + ') — the notices not sent are NOT MEASURED') }

    // ── the backup the close itself produced carries REFUNDS_ENABLED=true and is restorable ─────
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, 'phase2-backup-neutralize.js')], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, env: process.env,
      })
      for (const line of String(out).split('\n')) if (/^RESULT:|RESTORABLE TRUE-FLAG BACKUP|BACKUP SAFETY|STALE TRUE-FLAG BACKUP REMEDIATED/.test(line)) F('BACKUP NEUTRALIZE', line.trim())
    } catch (e) {
      const out = String((e && (e.stdout || e.message)) || e)
      for (const line of out.split('\n')) if (/^RESULT:|RESTORABLE TRUE-FLAG BACKUP|BACKUP SAFETY/.test(line)) F('BACKUP NEUTRALIZE', line.trim())
      A('12 backup: phase2-backup-neutralize.js did not report PASS — a restorable REFUNDS_ENABLED=true backup may still sit in the app root')
    }

    try { await prisma.$disconnect() } catch { /* best-effort */ }
  }

  // PASS means the window was opened, watched and PROVEN closed again. Anything less is not a pass.
  return done(anomalies.length ? 'FAIL' : 'PASS — window opened, watched (' + (stoppedBy || 'never started') + ') and the refund gate PROVEN closed again')
}

// Running the file executes the operator. Requiring it (a test) exposes the guards and the pure
// helpers ONLY — nothing is measured, nothing is written, no window is ever opened by a require.
if (require.main === module) main().catch((e) => { GATE.emergencyRefreeze('unexpected'); refuse('unexpected: ' + scrub(e)) })

module.exports = {
  CERTIFIED_SHAS,
  CONFIRM_SENTENCE,
  WRITABLE_KEYS,
  FORBIDDEN_KEYS,
  DANGEROUS_FLAGS,
  REFUND_LEASE_MAX_MS,
  LEASE_SLACK_MS,
  LOCK_FILE,
  writeRefundFlag,
  measureFundingByAccount,
  fundingShortfalls,
  printNotices,
}
