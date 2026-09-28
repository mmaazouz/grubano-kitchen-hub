'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase2-refund-gate.js — PHASE 2 REFUND REHEARSAL: server-side READ-ONLY PRECHECK and the
   future FAIL-CLOSED BOUNDED REFUND WINDOW (auto-refreeze). Staging only. Stripe TEST only.

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-refund-gate.js
         → MODE precheck (default, READ-ONLY): re-measures DB + Stripe TEST + connected balance +
           payout schedule + webhook events and prints the rehearsal block. Writes NOTHING.

     … phase2-refund-gate.js window            (FUTURE — needs the founder's explicit sentence)
         → MODE window: only with env PHASE2_REFUND_WINDOW_CONFIRM="I AUTHORIZE THE STAGING REFUND REHEARSAL"
           and PHASE2_REFUND_ORDER_ID / PHASE2_REFUND_AMOUNT_CENTS matching the authorised target.
           Re-runs the whole precheck (fail-closed), then: REFUNDS_ENABLED=true (canonical line,
           backup) → restart → prove the gate is OPEN (POST /api/admin/refunds/run {} → 401, not 403)
           → WAIT for exactly ONE refund object to appear on the target PaymentIntent (the refund
           itself is executed by the GitHub dispatch workflow `refund-rehearsal.yml`, never by this
           script) or for the deadline (default 15 min) → REFUNDS_ENABLED=false → restart → prove
           the gate is CLOSED again (403 {gated:true}) → print Stripe/DB truth of the refund.
           This script NEVER calls Stripe with a write, NEVER creates a refund, NEVER writes a
           financial row. Auto-refreeze is unconditional (also on error paths).

   Evidence rule: every printed value is MEASURED (file / DB / Stripe / live route) and tagged;
   NOT MEASURED when unavailable. No secret value/length/hash ever printed.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const os = require('os')
const prov = require(path.join(__dirname, 'env-provenance.js'))
const H = require(path.join(__dirname, 'reconcile-helpers.js'))
// T-93 (d): ONE definition of « which flags does a restorable backup re-enable », owned by the
// neutralizer. Requiring it has no side effect — its main() runs only as an entry point.
const NEUT = require(path.join(__dirname, 'phase2-backup-neutralize.js'))

const MODE = process.argv[2] === 'window' ? 'window' : 'precheck'
const APP_ROOT_DEFAULT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const APP_ROOT = APP_ROOT_DEFAULT
const ORDER_ID = process.env.PHASE2_REFUND_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const AMOUNT_CENTS = Number(process.env.PHASE2_REFUND_AMOUNT_CENTS || 500)
const CONFIRM_SENTENCE = 'I AUTHORIZE THE STAGING REFUND REHEARSAL'
/* T-93 (c) — A NON-NUMERIC WINDOW LENGTH USED TO SLIP PAST THE CEILING GUARD AND THROW AFTER ARMING.
   `Number('abc')` is NaN, and the ceiling guard was `if (WINDOW_DEADLINE_MS + 120000 > 30*60*1000)` —
   `NaN > 1800000` is **false**, so the guard PASSED. The refusal then happened three lines later, inside
   `new Date(Date.now() + NaN).toISOString()`, as a RangeError — raised AFTER the emergency re-freeze had
   been armed, and reported as an unexpected crash rather than as a named refusal of a bad input. A window
   operator must refuse a malformed authorization BY NAME, before it touches anything.
   The raw text is kept so the refusal can quote what was actually set.                                */
const WINDOW_MS_RAW = process.env.PHASE2_REFUND_WINDOW_MS
const WINDOW_DEADLINE_MS = (WINDOW_MS_RAW === undefined || String(WINDOW_MS_RAW).trim() === '')
  ? 15 * 60 * 1000
  : Number(WINDOW_MS_RAW)
/** The lease is `window + 2 min` and lib/refund.ts REFUND_WINDOW_MAX_MS caps it at 30 min. */
const WINDOW_MS_LEASE_MARGIN_MS = 120000
const WINDOW_MS_HARD_CEILING_MS = 30 * 60 * 1000
/* The floor is 1 ms, deliberately, and that is a JUDGEMENT worth writing down. A SHORT window is not a
   money risk — it opens the gate for less time, not more — while a floor of one minute would make this
   operator's window mode untestable at speed, and this repository has already paid twice for operators
   whose main() no test had ever executed. So the shape and the CEILING are enforced (those are the two
   that can hurt), and an implausibly short window is REPORTED instead of refused.                     */
const WINDOW_MS_FLOOR_MS = 1
const WINDOW_MS_PLAUSIBLE_MS = 60 * 1000
/**
 * Why a window length is refused, or null when it is legal — PURE in its argument, so every shape can be
 * enumerated by a test without spawning a process. `raw` is the env value exactly as read (or undefined).
 */
function windowMsRefusalFor(raw) {
  const blank = raw === undefined || String(raw).trim() === ''
  const ms = blank ? 15 * 60 * 1000 : Number(raw)
  const shown = JSON.stringify(String(blank ? '' : raw).slice(0, 40))
  // THE SHAPE FIRST, BECAUSE NaN DEFEATS EVERY COMPARISON BELOW. `Number('abc')` is NaN and
  // `NaN > 1800000` is FALSE, which is exactly how the old ceiling guard was walked past.
  if (!blank && !/^[0-9]+$/.test(String(raw).trim())) {
    return 'PHASE2_REFUND_WINDOW_MS=' + shown + ' is not a whole number of milliseconds. `Number()` turns it into '
      + (Number.isNaN(ms) ? 'NaN' : String(ms))
      + ', and NaN passes every `>` comparison — including this operator’s own 30-minute ceiling — because '
      + 'NaN > x is FALSE. Set a positive integer (milliseconds).'
  }
  if (!Number.isFinite(ms) || !Number.isInteger(ms)) {
    return 'PHASE2_REFUND_WINDOW_MS=' + shown + ' is not a finite whole number of milliseconds.'
  }
  if (ms < WINDOW_MS_FLOOR_MS) {
    return 'PHASE2_REFUND_WINDOW_MS=' + shown + ' is not a positive number of milliseconds.'
  }
  // AUDIT FIX (batch 2, P3 honesty) — THE OPERATOR MUST NOT OUTLIVE ITS OWN AUTHORIZATION. With a window
  // above ~28 min the T-48 lease clamps at the compiled ceiling while this script keeps printing
  // 'WINDOW OPEN' — the gate is already CLOSED by the application and the human reads a false statement
  // from an EVIDENCE operator. Money is never at risk in that direction (the gate fails closed), but a
  // lying operator is exactly the defect class this train exists to remove. Refuse rather than shorten.
  if (ms + WINDOW_MS_LEASE_MARGIN_MS > WINDOW_MS_HARD_CEILING_MS) {
    return 'PHASE2_REFUND_WINDOW_MS=' + Math.round(ms / 60000)
      + ' min exceeds what the T-48 lease can cover (lease = window + 2 min, hard ceiling 30 min). '
      + 'This script would keep reporting the window OPEN after the application had already closed it. '
      + 'Set PHASE2_REFUND_WINDOW_MS to 28 min or less.'
  }
  return null
}
/** The refusal for THIS process's env. Called before the stamp, the arm and every write. */
function windowMsRefusal() { return windowMsRefusalFor(WINDOW_MS_RAW) }
const RELOAD_DEADLINE_MS = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)
const POLL_MS = Number(process.env.PHASE2_REFUND_POLL_MS || 15000)

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
/* T-108: stable aliases so `neutralizeOwnBackups` can default to THIS operator's reporter while a sibling
   passes its own. Referencing `F`/`A` directly inside the helper would have bound it to this file forever. */
const FACT = F
const ANOM = A
const mask = (s) => (typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : (s ? '***' : 'null'))
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let verdict = 'NOT MEASURED'

function done(result, failedStep) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 REFUND ' + (MODE === 'window' ? 'WINDOW' : 'REHEARSAL PRECHECK') + ' (staging) — every value below is MEASURED')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  // Wording only — never suppresses an anomaly, never changes the exit code. It prints ONLY when
  // EVERY anomaly is one of the three that a completed, authorized rehearsal necessarily produces.
  // A pending/failed refund row, a paymentStatus drift, a missing ledger/loyalty row, a non-manual
  // payout schedule or any measurement failure is NOT in this set, so it can never be explained away.
  const EXPECTED_AFTER_REHEARSAL = [
    /^3 db: a refund already exists on the order/,
    /^3 db: prior refund loyalty\/ledger evidence exists/,
    /^4 stripe: remaining refundable < /,
  ]
  if (MODE === 'precheck' && result === 'FAIL' && anomalies.length && anomalies.every((m) => EXPECTED_AFTER_REHEARSAL.some((re) => re.test(m)))) {
    console.log('NOTE: this RESULT answers "can a NEW refund of ' + AMOUNT_CENTS + ' c be executed on this order NOW?" — not "did the past refund work?". Every anomaly above is one an already-completed AUTHORIZED rehearsal necessarily produces (refund row present, prior loyalty/ledger evidence, remaining refundable below the amount), so this is EXPECTED GUARD BEHAVIOR of a post-rehearsal evidence run, NOT a failed transaction. The financial truth is established by phase2-preflight.js (direct DB ↔ Stripe reconciliation) and phase2-email-timeline.js.')
  }
  console.log('FIRST REHEARSAL: ' + verdict)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  process.exitCode = result.startsWith('PASS') || result.startsWith('WAIT') ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step) => done('FAIL', step)

/* T-99 (found while testing T-93) — NODE'S `fetch` HAS NO DEFAULT TIMEOUT. A probe against a host that
   accepts the connection and then says nothing hangs FOREVER, and `waitGate` is a loop of probes: the
   operator would stop at a black-holed TCP connection, having neither proved the gate nor told anyone.
   Measured, not theorised: the T-93 end-to-end test hung for the full 120 s child timeout for exactly
   this reason. Money is bounded either way by the T-48 lease, but an EVIDENCE operator that hangs has
   stopped being evidence. A refused connection already returned promptly; this covers the silent one. */
const PROBE_TIMEOUT_MS = Number(process.env.PHASE2_PROBE_TIMEOUT_MS || 15000)
const probeSignal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(PROBE_TIMEOUT_MS) : undefined)
async function probeGate(base) {
  try {
    const r = await fetch(base + '/api/admin/refunds/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'grubano-phase2-refund-gate/1' }, body: '{}', redirect: 'manual', signal: probeSignal() })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && b.gated === true) return 'CLOSED'
    if (r.status === 401) return 'OPEN'
    return 'UNKNOWN(' + r.status + ')'
  } catch { return 'UNREACHABLE' }
}
/** D′ L1: the claims-surface probe (same shape as the Mode A operator's). */
async function probeClaimsGate(base) {
  try {
    const r = await fetch(base + '/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'grubano-phase2-refund-gate/1' }, body: '{}', redirect: 'manual', signal: probeSignal() })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && (b.gated === true || b.enabled === false)) return 'CLOSED'
    if (r.status === 401) return 'OPEN'
    return 'UNKNOWN(' + r.status + ')'
  } catch { return 'UNREACHABLE' }
}
async function waitGate(base, want, deadlineMs, intervalMs) {
  const t0 = Date.now(); let last = 'n/a', n = 0
  while (Date.now() - t0 < deadlineMs) { n++; last = await probeGate(base); if (last === want) return { ok: true, elapsedMs: Date.now() - t0, probes: n, last }; await sleep(intervalMs) }
  return { ok: false, elapsedMs: Date.now() - t0, probes: n, last }
}
/** Canonical write of ONE key in .env.local (backup first). Returns { changed, backup }. */
function writeFlag(envFile, key, value, stamp) {
  const txt = fs.readFileSync(envFile, 'utf8')
  const eol = txt.includes('\r\n') ? '\r\n' : '\n'
  const lines = txt.split(/\r?\n/)
  let seen = false, changed = false
  const out = lines.map((raw) => {
    const t = raw.replace(/^﻿/, '').trim()
    if (!t || t.startsWith('#')) return raw
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!m || m[1] !== key) return raw
    if (seen) { changed = true; return '# phase2-refund-gate ' + stamp + ' duplicate neutralised: ' + raw }
    seen = true
    const canonical = key + '=' + value
    if (raw !== canonical) changed = true
    return canonical
  })
  if (!seen) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push('# phase2-refund-gate ' + stamp + ' — ' + key); out.push(key + '=' + value); changed = true }
  if (!changed) return { changed: false, backup: null }
  const backup = envFile + '.bak-refund-gate-' + stamp.replace(/[:.]/g, '-')
  fs.copyFileSync(envFile, backup); try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
  let text = out.join(eol); if (!text.endsWith(eol)) text += eol
  fs.writeFileSync(envFile, text, { mode: 0o600 }); try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
  return { changed: true, backup: path.basename(backup) }
}
function touchRestart() { fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true }); fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), 'phase2-refund-gate ' + new Date().toISOString()) }

/* ── EMERGENCY REFREEZE (audit 2026-09-09, BLOCKING) ───────────────────────────
   The `finally` block below only runs when the process reaches it. A Ctrl-C, an SSH
   hangup, a `kill`, or an uncaught throw would otherwise leave REFUNDS_ENABLED=true
   in .env.local and the refund gate OPEN. `writeFlag` and `touchRestart` are fully
   SYNCHRONOUS fs calls, so they are safe to run from a signal handler.
   Armed the moment the flag is written to true, disarmed once the normal re-freeze
   has written false. SIGKILL / a power cut cannot be caught — the printed banner
   tells the operator exactly what to check in that case.                        */
let armedRefreeze = null
/* T-93 (b) — EACH WRITE IN ITS OWN try. The three statements used to share ONE try, so a throw on the
   FIRST (the lease) suppressed both the `REFUNDS_ENABLED=false` write AND the restart touch: the one
   write that actually closes the gate was skipped because a different, less important one failed. The
   sibling operator phase2-modeb-gate.js emergencyClose() already carried this shape; this one did not.
   Order matters too: the LEASE expires first (the authorization dies of old age even if a flag resists),
   then the flag, then the restart — and the restart is attempted whatever the writes did, because a
   flag closed on disk that the live process has not re-read has closed nothing.                       */
/* `deps` exists ONLY so a test can make ONE of the two writes fail and prove the OTHER still happens.
   That asymmetry is the whole of T-93 (b), and it is not inducible from outside: both writes go through
   the same primitive, to the same backup path, on the same stamp. A test that patched `fs` would be
   testing Node, and `node:fs` exports are not redefinable in any case. Production passes nothing. */
function emergencyRefreeze(reason, deps) {
  if (!armedRefreeze) return false
  const wf = (deps && deps.writeFlagFn) || writeFlag
  const tr = (deps && deps.touchRestartFn) || touchRestart
  const { envFile, stamp } = armedRefreeze
  armedRefreeze = null // once only
  const past = new Date(Date.now() - 1000).toISOString()
  const writes = [['REFUNDS_WINDOW_UNTIL', past], ['REFUNDS_ENABLED', 'false']]
  const failedKeys = []
  let flagResult = null
  for (const [k, v] of writes) {
    try {
      const r = wf(envFile, k, v, stamp + '-emergency')
      if (k === 'REFUNDS_ENABLED') flagResult = r
    } catch (e) {
      failedKeys.push(k)
      console.log('  !! EMERGENCY REFREEZE — write ' + k + ' FAILED (' + reason + '): ' + scrub(e))
    }
  }
  let restarted = false
  try { tr(); restarted = true } catch (e) {
    console.log('  !! EMERGENCY REFREEZE — tmp/restart.txt NOT written (' + reason + '): ' + scrub(e))
  }
  if (failedKeys.length || !restarted) {
    console.log('  !! EMERGENCY REFREEZE FAILED (' + reason + '): '
      + (failedKeys.length ? 'unwritten key(s) ' + failedKeys.join(', ') : 'flags written')
      + (restarted ? ', restart requested' : ', NO restart requested — the LIVE process keeps the flag it booted with'))
    console.log('  !! HUMAN ACTION REQUIRED NOW: set REFUNDS_ENABLED=false in ' + envFile + ' and touch tmp/restart.txt')
    return false
  }
  console.log('  !! EMERGENCY REFREEZE (' + reason + '): REFUNDS_ENABLED=false written'
    + (flagResult && flagResult.changed ? ' (backup ' + flagResult.backup + ')' : ' (was already false)')
    + ', the lease expired, and tmp/restart.txt touched.')
  console.log('  !! VERIFY THE GATE MANUALLY: POST /api/admin/refunds/run {} must answer 403 {gated:true} within a few minutes.')
  console.log('  !! THEN NEUTRALIZE THE BACKUPS: node scripts/server/phase2-backup-neutralize.js '
    + '— a `.env.local.bak-refund-gate-…` copy carrying REFUNDS_ENABLED=true is restorable and would re-open the gate.')
  return true
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'SIGQUIT']) {
  try { process.on(sig, () => { emergencyRefreeze(sig); process.exit(130) }) } catch { /* signal not supported on this platform */ }
}
process.on('uncaughtException', (e) => { emergencyRefreeze('uncaughtException'); console.log('  !! ' + scrub(e)); process.exit(1) })
process.on('unhandledRejection', (e) => { emergencyRefreeze('unhandledRejection'); console.log('  !! ' + scrub(e)); process.exit(1) })

/* ── T-93 (d) — NEUTRALIZE THE BACKUP THIS OPERATOR ITSELF CREATED ────────────────────────────────
   `writeFlag` copies .env.local to `.env.local.bak-refund-gate-<stamp>` before its first change, so a
   window always leaves a restorable copy in the app root carrying REFUNDS_ENABLED=true. One `cp` over
   .env.local plus a Passenger respawn re-opens the money gate — and the window operator neither removed
   that copy nor named the control that does. phase2-backup-neutralize.js archives it outside the app
   root (mode 0700) and removes the restorable one; it REFUSES while the live flag is still true, which
   is why it is invoked only after the re-freeze.

   Deliberately a CHILD PROCESS, not a require: the neutralizer is a top-level script that calls
   process.exit, and running it in-process would take this operator down with it. Its whole stdout is
   echoed, because the human is reading one report.

   THE FAILURE MODE THAT MATTERS is silence, so every way this can go wrong is an ANOMALY carrying the
   exact command to run by hand.                                                                      */
function backupNames(root) {
  try {
    return fs.readdirSync(root || APP_ROOT_DEFAULT).filter((n) => /^\.env\.local\.bak/.test(n)).sort()
  } catch { return null }
}
/* T-108 — SHARED, NOT COPIED. phase2-claims-gate.js and phase2-modeb-gate.js write money flags to true and
   leave a restorable `.env.local.bak-…` behind, and neither invoked (nor named) the neutralizer. Copying this
   function into them would put a money-safety control in three places, which this chantier has been bitten by
   more than once. So the reporter and the app root are injectable: each operator passes its OWN `F`/`A` so the
   facts and anomalies land in ITS report, and the logic exists once, already exercised end to end by
   tests/prel11-refund-gate-window-t93.test.ts. Called with no argument it behaves exactly as before. */
async function neutralizeOwnBackups(reporter) {
  const F = (reporter && reporter.F) || FACT
  const A = (reporter && reporter.A) || ANOM
  const APP_ROOT = (reporter && reporter.appRoot) || APP_ROOT_DEFAULT
  const script = path.join(__dirname, 'phase2-backup-neutralize.js')
  const before = backupNames(APP_ROOT)
  F('BACKUPS IN APP ROOT AFTER CLOSE', before === null ? 'NOT MEASURED (app root unreadable)' : (before.length ? before.join(', ') : 'none'))
  const byHand = 'node ' + script
  if (!fs.existsSync(script)) {
    A('7 neutralize: phase2-backup-neutralize.js is not deployed next to this operator — a restorable true-flag backup may remain. Run it by hand from a checkout: ' + byHand)
    return
  }
  if (before !== null && before.length === 0) {
    F('BACKUP NEUTRALIZER', 'SKIPPED — no .env.local.bak* file exists, so there is nothing restorable')
    return
  }
  let code = null, out = ''
  try {
    /* A TIGHT env, not `process.env` wholesale. The neutralizer needs four variables and reads
       NEXTAUTH_URL from the FILES, so inheriting the rest buys nothing and can cost a lot: anything
       that injects a loader (NODE_OPTIONS above all) would run inside a child whose job is to disarm a
       money footgun, and a child that hangs is a control that silently did not run. Measured: under a
       test runner the inherited NODE_OPTIONS made this child hang until the timeout. */
    const childEnv = { PHASE2_APP_ROOT: APP_ROOT }
    for (const k of ['PATH', 'Path', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL',
      'PHASE2_EVIDENCE_DIR', 'PHASE2_BASE_URL', 'PHASE2_BACKUP_DRY_RUN']) {
      if (process.env[k] !== undefined) childEnv[k] = process.env[k]
    }
    const r = require('child_process').spawnSync(process.execPath, [script], {
      cwd: APP_ROOT,
      env: childEnv,
      encoding: 'utf8',
      timeout: 120000,
    })
    code = r.status
    out = String((r.stdout || '') + (r.stderr || ''))
    if (r.error) A('7 neutralize: could not start the neutralizer — ' + scrub(r.error))
  } catch (e) {
    A('7 neutralize: could not start the neutralizer — ' + scrub(e))
  }
  if (out) {
    console.log('  --- phase2-backup-neutralize.js output ---')
    for (const line of out.split(/\r?\n/)) if (line !== '') console.log('  | ' + line)
    console.log('  --- end of phase2-backup-neutralize.js output ---')
  }
  F('BACKUP NEUTRALIZER EXIT', code === null ? 'NOT MEASURED' : String(code))
  if (code !== 0) A('7 neutralize: the neutralizer did not report success (exit ' + String(code) + ') — a restorable true-flag backup may remain in the app root. Run by hand and read its report: ' + byHand)
  // PROOF, not trust: re-read the directory ourselves and say what is still restorable.
  const after = backupNames(APP_ROOT)
  if (after === null) { A('7 neutralize: app root unreadable after the run — restorable backups NOT MEASURED'); return }
  // THE PREDICATE IS THE NEUTRALIZER'S OWN, required not retyped. A second regex here would be a money
  // rule in two copies — and it would have been WRONG: dotenv semantics are last-occurrence-wins, so a
  // file holding `REFUNDS_ENABLED=true` followed by `=false` is SAFE while a naive regex calls it dangerous.
  const stillDangerous = after.filter((n) => {
    try { return NEUT.dangerousFlags(fs.readFileSync(path.join(APP_ROOT, n), 'utf8')).length > 0 } catch { return true }
  })
  F('RESTORABLE TRUE-FLAG BACKUP LEFT BY THIS WINDOW', stillDangerous.length ? 'YES (' + stillDangerous.join(', ') + ')' : 'NO')
  if (stillDangerous.length) A('7 neutralize: ' + stillDangerous.join(', ') + ' still carries REFUNDS_ENABLED=true in the app root — restoring it re-opens the money gate. ' + byHand)
}

/* ── T-93 (a)(b)(d) — CLOSING THE WINDOW, AS ONE AUDITABLE SEQUENCE ───────────────────────────────
   WHAT WAS WRONG, in the order it mattered:
   (b) the two flag writes and the restart shared ONE `try`, so a throw on the FIRST — the lease, the
       least important of the three — suppressed the `REFUNDS_ENABLED=false` write that actually closes
       the gate, and the restart as well.
   (a) `armedRefreeze = null` sat BETWEEN the flag write and `touchRestart()`. A signal in that gap left
       `false` on disk, no restart requested, and therefore a LIVE Passenger process still holding the
       `true` it had booted with: the gate stayed OPEN for the remainder of the lease, with the emergency
       handler already disarmed and nobody told. A flag closed on disk that the running process has not
       re-read has closed NOTHING.
   (d) nothing here invoked, or even named, phase2-backup-neutralize.js — while `writeFlag` had just left
       a `.env.local.bak-refund-gate-<stamp>` copy carrying REFUNDS_ENABLED=true in the app root.

   THE ORDER IS NOW THE ARGUMENT: lease, flag, restart, PROOF, disarm, neutralize. Each write in its own
   try; the restart attempted whatever the writes did; the handler disarmed LAST and ONLY on proof.
   Leaving the handler armed costs nothing — its writes are idempotent — while disarming it one statement
   too early cannot be recovered from.

   `waitCloseGate` is injected so a test can supply the gate proof (and its absence).                  */
async function closeRefundWindow({ envFile, stamp, base, waitCloseGate, writeFlagFn, touchRestartFn }) {
  const wait = waitCloseGate || ((b) => waitGate(b, 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS))
  const wf = writeFlagFn || writeFlag
  const tr = touchRestartFn || touchRestart
  const past = new Date(Date.now() - 1000).toISOString()
  // LEASE FIRST: the authorization dies of old age even if a flag write resists.
  const closeWrites = [['REFUNDS_WINDOW_UNTIL', past], ['REFUNDS_ENABLED', 'false']]
  const closeFailed = []
  let closed = null
  for (const [k, v] of closeWrites) {
    try {
      const r = wf(envFile, k, v, stamp + 'Z')
      if (k === 'REFUNDS_ENABLED') closed = r
    } catch (e) {
      closeFailed.push(k)
      A('7 refreeze: write ' + k + ' FAILED — ' + scrub(e))
    }
  }
  F('WINDOW CLOSE WRITE', closeFailed.length
    ? 'FAILED for ' + closeFailed.join(', ') + ' — HUMAN ACTION REQUIRED: set REFUNDS_ENABLED=false in ' + envFile
    : (closed && closed.changed ? 'REFUNDS_ENABLED=false (backup ' + closed.backup + ')' : 'no change'))
  let restartRequested = false
  try { tr(); restartRequested = true } catch (e) {
    A('7 refreeze: tmp/restart.txt NOT written — the LIVE process keeps the flag it booted with until the lease expires: ' + scrub(e))
  }
  F('RESTART REQUESTED', restartRequested ? 'YES (tmp/restart.txt touched)' : 'NO — the file says closed, the process does not')
  let proven = false
  try {
    const w2 = await wait(base)
    F('GATE AFTER CLOSE', w2.last + ' after ' + Math.round(w2.elapsedMs / 1000) + ' s')
    proven = !!w2.ok
    if (!proven) A('7 refreeze: gate NOT proven CLOSED (' + w2.last + ') — HUMAN ATTENTION REQUIRED')
  } catch (e) { A('7 refreeze: gate proof failed — ' + scrub(e)) }
  // DISARM — last, and ONLY when all three hold. Anything less keeps the handler for the next signal.
  if (proven && !closeFailed.length && restartRequested) armedRefreeze = null
  F('EMERGENCY REFREEZE HANDLER', armedRefreeze === null
    ? 'DISARMED (gate proven CLOSED, flags written, restart requested)'
    : 'STILL ARMED — the close was not fully proven; any signal from here re-writes the flags and re-touches restart.txt')
  await neutralizeOwnBackups()
  return { closeFailed, restartRequested, proven, disarmed: armedRefreeze === null }
}

async function main() {
  console.log('[1] identity + env (mode ' + MODE + ')')
  const envFile = path.join(APP_ROOT, '.env.local')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT)
  const texts = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const merged = prov.mergeNextEnvFiles(texts).merged
  const dbName = ((merged.DATABASE_URL || '').match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  // PRE-L11 — THE NAME TEST WIDENED, and it is the sibling's expression. `/prod/i` alone passes
  // `deyi0010_grubano`, which IS the production database: it contains no « prod ». The staging one ends in
  // `_staging`, so anything that looks like the bare product name and is not staging-named is refused.
  const dbLooksStaging = /_staging$/.test(dbName)
  const dbLooksProd = /prod/i.test(dbName) || dbName === 'deyi0010_grubano' || (/grubano$/.test(dbName) && !dbLooksStaging)
  if (dbLooksProd) return fail('1 env: the database name looks like PRODUCTION (' + dbName + ') — refusing before any read')
  if (dbName === 'unknown') return fail('1 env: no DATABASE_URL in the file view — the target database is AMBIGUOUS, refusing')
  // PRE-L11 — THE GUARD JUDGED THE FILES; THE PRISMA CLIENT BELOW CONNECTS WITH THE SHELL. Found by this
  // lot's adversarial review, and it is the same hole the sibling operator already closes
  // (phase2-claims-pay-window.js): `@next/env` never overrides a pre-existing `process.env` value, and the
  // house protocol teaches PREFIXING operator commands — so a DSN exported in the shell (or left over in an
  // SSH session) is the one `new PrismaClient({ url: process.env.DATABASE_URL })` uses at line ~227, while
  // every check above read `.env.local`. Step 1 would then pass on a staging file view and the whole report
  // would measure a database it does not name. Values are never printed, only the fact that they diverge.
  const shellDsn = (process.env.DATABASE_URL || '').trim()
  const fileDsn = (merged.DATABASE_URL || '').trim()
  if (shellDsn && fileDsn && shellDsn !== fileDsn) {
    return fail('1 env: the shell DATABASE_URL diverges from the files — the database this operator would MEASURE is not the one the application uses. Refusing to be moved off target (values never printed)')
  }
  if (shellDsn && !fileDsn) {
    return fail('1 env: a DATABASE_URL is exported in the shell but absent from the files — the target database is AMBIGUOUS, refusing')
  }
  const shellStripe = (process.env.STRIPE_SECRET_KEY || '').trim()
  const fileStripe = (merged.STRIPE_SECRET_KEY || '').trim()
  if (shellStripe && fileStripe && shellStripe !== fileStripe) {
    return fail('1 env: the shell STRIPE_SECRET_KEY diverges from the files — the Stripe account this operator would MEASURE is not the one the application charges. Refusing (values never printed)')
  }
  const nextauthUrl = (merged.NEXTAUTH_URL || '').replace(/\/$/, '')
  if (!/app\.grubano\.com/.test(nextauthUrl)) return fail('1 env: NEXTAUTH_URL is not staging')
  const base = (process.env.PHASE2_BASE_URL || nextauthUrl).replace(/\/$/, '')
  try { const bu = new URL(base); const loop = bu.hostname === '127.0.0.1' || bu.hostname === 'localhost'; if (!(bu.protocol === 'https:' && bu.hostname === 'app.grubano.com') && !loop) return fail('1 env: probe base not staging') } catch { return fail('1 env: base unparsable') }
  let envLoad = { loader: 'NOT LOADED' }
  try { envLoad = H.loadRuntimeEnv(APP_ROOT) } catch (e) { envLoad = { loader: 'FAILED: ' + scrub(e) } }
  const rt = H.envFacts(process.env)
  if (rt.stripeMode !== 'TEST') return fail('1 env: Stripe key mode ' + rt.stripeMode + ' — refusing (TEST only)')
  F('MODE', MODE + (MODE === 'window' ? ' (BOUNDED REFUND WINDOW — auto-refreeze)' : ' (READ-ONLY)'))
  F('SOURCE', 'staging ' + APP_ROOT + ' · env loader ' + envLoad.loader)
  F('DATABASE', dbName + ' (staging-named) · DATABASE_URL available ' + (rt.databaseUrl ? 'YES' : 'NO'))
  F('STRIPE MODE', rt.stripeMode)
  F('REFUNDS_ENABLED (file, Next view)', merged.REFUNDS_ENABLED === undefined ? 'ABSENT → false' : JSON.stringify(merged.REFUNDS_ENABLED))
  F('ALLOW_PLATFORM_FALLBACK (file, Next view)', merged.ALLOW_PLATFORM_FALLBACK === 'true' ? 'true — REFUSING (routine treasury advance forbidden)' : (merged.ALLOW_PLATFORM_FALLBACK === undefined ? 'ABSENT → effective false' : JSON.stringify(merged.ALLOW_PLATFORM_FALLBACK)))
  if (merged.ALLOW_PLATFORM_FALLBACK === 'true') return fail('1 env: ALLOW_PLATFORM_FALLBACK=true')
  F('ADMIN_AUDIT_ENABLED (file, Next view)', merged.ADMIN_AUDIT_ENABLED === 'true' ? 'true' : (merged.ADMIN_AUDIT_ENABLED === undefined ? 'ABSENT → false (audit rows would be SKIPPED)' : JSON.stringify(merged.ADMIN_AUDIT_ENABLED)))
  // D′ L1 (spec v2 §3.4, S-14): a refund rehearsal window never opens beside the claims PRODUCT flags — under them
  // the claims surface is live for real customers, and the legacy lease this family of operators reasons about is
  // inert. Refused BY NAME, in precheck and in window.
  for (const k of ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED']) {
    const v = merged[k]
    F(k + ' (file, Next view)', v === undefined ? 'ABSENT → effective false' : JSON.stringify(v) + (v === 'true' ? ' — effective TRUE' : ' — effective false'))
    if (v === 'true') A('1 env: ' + k + ' is true — the claims PRODUCT flags (D′) are active; a refund rehearsal window is refused beside a live claims surface')
  }
  for (const k of ['CLAIMS_ENABLED', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED', 'GHOST_ORDER_AUTO_REFUND_ENABLED', 'TIPS_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED']) {
    const v = merged[k]
    F(k + ' (file, Next view)', v === undefined ? 'ABSENT → effective false' : JSON.stringify(v) + (v === 'true' ? ' — effective TRUE' : ' — effective false'))
    if (v === 'true' && /^(CLAIMS_ENABLED|CLAIMS_AUTO_APPROVE_ENABLED|CLAIM_AUTO_RESOLVE_ENABLED|GHOST_ORDER_AUTO_REFUND_ENABLED)$/.test(k)) A('1 env: ' + k + ' is true in the env files — must be effective false for a refund rehearsal')
  }
  const gate0 = await probeGate(base)
  F('REFUND GATE (live process, unauthenticated probe)', gate0 + ' (CLOSED = 403 gated = REFUNDS_ENABLED false in the process)')
  // D′ L1: the live CLAIMS surface is probed too (POST /api/claims {} unauthenticated): CLOSED = 403 {gated:true};
  // OPEN = 401; UNKNOWN(403) = intake_closed (product surface open, intake paused). Anything but CLOSED beside a
  // refund window is an anomaly — printed, and refused in window mode with the rest.
  const claimsGate0 = await probeClaimsGate(base)
  F('CLAIMS GATE (live process, POST /api/claims unauthenticated)', claimsGate0 + ' (CLOSED = 403 gated ; OPEN = 401 ; UNKNOWN(403) = intake_closed = product surface open)')
  if (claimsGate0 !== 'CLOSED') A('1 gate: the live claims surface is ' + claimsGate0 + ' — a refund rehearsal window never runs beside an open claims surface (D′ L1, S-14)')
  if (MODE === 'precheck' && gate0 !== 'CLOSED') A('1 gate: the live refund gate is not CLOSED — the technical freeze is not observed right now')

  // ── Stripe (READ-ONLY REST) ─────────────────────────────────────────────────
  console.log('[2] stripe TEST truth')
  let stripe
  try { stripe = H.makeStripeClient(process.env.STRIPE_SECRET_KEY, APP_ROOT, { apiBase: process.env.PHASE2_STRIPE_API_BASE, allowLoopback: process.env.PHASE2_ALLOW_LOOPBACK === '1' }).client } catch (e) { return fail('2 stripe: client — ' + scrub(e)) }
  // The REST read-only client (standalone runtime has no SDK) exposes whitelisted GET getters.
  const rest = stripe.kind === 'rest-readonly' ? stripe : null
  const retrieve = async (kind, id, params) => {
    if (rest) return rest.retrieveAny(kind, id, params)
    if (kind === 'payment_intents') return stripe.paymentIntents.retrieve(id, params)
    if (kind === 'charges') return stripe.charges.retrieve(id)
    if (kind === 'transfers') return stripe.transfers.retrieve(id)
    if (kind === 'application_fees') return stripe.applicationFees.retrieve(id)
    if (kind === 'accounts') return stripe.accounts.retrieve(id)
    throw new Error('unsupported ' + kind)
  }

  // ── DB (READ-ONLY) ──────────────────────────────────────────────────────────
  console.log('[3] database facts')
  let prisma = null
  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  if (prismaRes.ok && rt.databaseUrl) { try { const { PrismaClient } = require(prismaRes.path); prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) } catch (e) { A('3 db: prisma construction failed (' + scrub(e) + ')') } }
  else A('3 db: prisma not available (' + (prismaRes.ok ? 'no DATABASE_URL' : prismaRes.error) + ') — DB facts NOT MEASURED')

  let order = null, piId = null, consumerEmailDomain = 'NOT MEASURED', loyalty = null, refundRows = [], claims = 0, audits = 0, ledgerRefundLines = 0, preState = null
  if (prisma) try {
    order = await prisma.order.findUnique({ where: { id: ORDER_ID }, select: { id: true, status: true, paymentStatus: true, subtotal: true, total: true, pointsRedeemed: true, loyaltyCreditCents: true, pointsEarned: true, stripePaymentIntentId: true, pointOfSaleId: true, consumerId: true, restaurantId: true, fulfillmentType: true } })
    if (!order) return fail('3 db: order ' + ORDER_ID + ' not found')
    piId = order.stripePaymentIntentId
    F('ORDER (DB)', 'GR-' + order.id.slice(-6).toUpperCase() + ' · status ' + order.status + ' · paymentStatus ' + order.paymentStatus + ' · fulfillment ' + order.fulfillmentType + ' · subtotal € ' + order.subtotal + ' · total € ' + order.total + ' · pointsRedeemed ' + order.pointsRedeemed + ' · loyaltyCreditCents ' + order.loyaltyCreditCents + ' · pointsEarned ' + order.pointsEarned + ' · POS ' + (order.pointOfSaleId || 'null') + ' · PI ' + mask(piId))
    refundRows = await prisma.refund.findMany({ where: { orderId: order.id }, select: { id: true, status: true, amountCents: true, stripeRefundId: true, idempotencyKey: true, createdAt: true } })
    F('REFUND ROWS (DB)', refundRows.length ? refundRows.map((r) => r.status + ':' + r.amountCents + ':' + mask(r.stripeRefundId)).join(' | ') : 'none')
    claims = await prisma.claim.count({ where: { orderId: order.id } }).catch(() => -1)
    audits = await prisma.adminAuditLog.count({ where: { targetId: order.id, action: 'refund.run' } }).catch(() => -1)
    ledgerRefundLines = piId ? await prisma.ledgerEntry.count({ where: { stripePaymentIntentId: piId, type: 'refund' } }) : 0
    F('CLAIMS / refund.run AUDITS / LEDGER refund lines for order (DB)', claims + ' / ' + audits + ' / ' + ledgerRefundLines)
    const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: { royaltyCents: true, status: true } })
    F('FRANCHISE ROYALTY row (DB)', royalty ? JSON.stringify(royalty) + ' — NOT a standard order, refusing' : 'none (standard restaurant)')
    if (royalty) A('3 db: franchise royalty present — franchise is OUT OF BETA')
    const lts = await prisma.loyaltyTransaction.findMany({ where: { orderId: order.id }, select: { type: true, points: true, sourceEventId: true, customerId: true } })
    F('LOYALTY rows for order (DB)', lts.length ? lts.map((t) => t.type + ':' + t.points + (t.sourceEventId ? '(' + mask(t.sourceEventId) + ')' : '')).join(', ') : 'none')
    const earnRow = lts.find((t) => t.type === 'earn')
    const custId = (lts[0] && lts[0].customerId) || null
    const consumer = await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
    consumerEmailDomain = consumer && consumer.email ? consumer.email.replace(/^[^@]*@/, '…@') : 'none'
    const lc = consumer ? await prisma.loyaltyCustomer.findUnique({ where: { email: consumer.email }, select: { id: true, pointsBalance: true, recoveryOffsetPoints: true } }) : null
    // L6.1 — THE EFFECT ALREADY APPLIED, READ FROM THE ROWS, and its high-water key. This is what the
    // convergence subtracts from the target, so the operator's expectation cannot be stated without it:
    // `appliedMagnitude(rows, sign)` in lib/loyalty-refund-apply is Σ(sign × points) over the rows of one side
    // (D1 `earn_reversal`, NEGATIVE points, sign -1 → a positive magnitude ; D2 `refund`, POSITIVE, sign +1).
    // The keys are `prorata:v1:<orderId>:<cum>`, so the largest `<cum>` is the FLOOR the reconciliation will
    // not go below — a proof set that shrank never hands points back.
    const appliedEarn = lts.filter((t) => t.type === 'earn_reversal').reduce((a, t) => a + -1 * Math.floor(Number(t.points) || 0), 0)
    const appliedSpent = lts.filter((t) => t.type === 'refund').reduce((a, t) => a + Math.floor(Number(t.points) || 0), 0)
    const prorataCums = lts
      .map((t) => (typeof t.sourceEventId === 'string' ? /^prorata:v1:[^:]+:(\d+)$/.exec(t.sourceEventId) : null))
      .filter(Boolean).map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
    const highWaterCum = prorataCums.length ? Math.max.apply(null, prorataCums) : 0
    // REVIEW P2 — THE ENGINE'S FIRST DECISION IS NOT AN ARITHMETIC ONE. lib/loyalty-refund-apply checks the
    // GRANDFATHER GUARD before any target is computed: an order carrying a legacy `refund` row with a NULL
    // `sourceEventId` (written by the pre-Phase-1 webhook, which fully re-credited the spent points) is left
    // exactly as it stands and the reconciliation returns `grandfathered` having written NOTHING. The gate
    // printed a DELTA TO WRITE for such an order, i.e. announced a write the engine refuses by design. The
    // signal is already in `lts` — no extra query.
    const legacyRefundRow = lts.some((t) => t.type === 'refund' && t.sourceEventId === null)
    loyalty = { earnRow: !!earnRow, earnPoints: earnRow ? earnRow.points : 0, balance: lc ? lc.pointsBalance : null, offset: lc ? lc.recoveryOffsetPoints : null, custId: lc ? lc.id : custId,
      appliedEarn: appliedEarn, appliedSpent: appliedSpent, highWaterCum: highWaterCum, prorataKeys: prorataCums.length,
      grandfathered: legacyRefundRow }
    F('LOYALTY EFFECT ALREADY APPLIED (DB rows, L6.1 magnitudes)', 'D1 earn clawback ' + appliedEarn + ' pt · D2 spent restore ' + appliedSpent + ' pt · prorata keys ' + prorataCums.length + ' · high-water cum ' + highWaterCum + ' c')
    F('LOYALTY customer (DB)', lc ? 'pointsBalance ' + lc.pointsBalance + ' · recoveryOffsetPoints ' + lc.recoveryOffsetPoints : 'none')
    F('CONSUMER EMAIL DOMAIN (DB, masked)', consumerEmailDomain)
    // ── BEFORE-STATE (evidence for the post-refund reconciliation; captured BEFORE any gate action) ──
    const ledgerLines = piId ? await prisma.ledgerEntry.findMany({ where: { stripePaymentIntentId: piId }, select: { type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, sourceEventId: true }, orderBy: { createdAt: 'asc' } }) : []
    const sumL = (t) => ledgerLines.reduce((a, l) => a + (l[t] || 0), 0)
    const redeemRow = lts.find((t) => t.type === 'redeem')
    const priorRefundLoyalty = lts.filter((t) => t.type === 'refund' || t.type === 'earn_reversal')
    const priorRefundLedger = ledgerLines.filter((l) => l.type === 'refund')
    F('BEFORE · DB REFUND ROWS FOR ORDER', String(refundRows.length))
    F('BEFORE · LEDGER LINES FOR PI (type{gross,fee,net})', ledgerLines.length ? ledgerLines.map((l) => l.type + '{' + l.grossAmount + ',' + l.applicationFeeAmount + ',' + l.netToRestaurant + '}').join(' ; ') : 'none')
    F('BEFORE · LEDGER GROSS / FEE / NET (Σ all lines for PI)', sumL('grossAmount') + ' / ' + sumL('applicationFeeAmount') + ' / ' + sumL('netToRestaurant'))
    F('BEFORE · CUSTOMER LOYALTY BALANCE', lc ? String(lc.pointsBalance) : 'NOT MEASURED')
    F('BEFORE · RECOVERY OFFSET POINTS', lc ? String(lc.recoveryOffsetPoints) : 'NOT MEASURED')
    F('BEFORE · ORDER LOYALTY REDEEMED', order.pointsRedeemed + ' points (' + order.loyaltyCreditCents + ' c)')
    F('BEFORE · ORDER LOYALTY EARNED', order.pointsEarned + ' points')
    F('BEFORE · EARN EVENT STATE', earnRow ? 'PRESENT (' + earnRow.points + ' pts)' : 'ABSENT (no earn row → earned reversal 0)')
    F('BEFORE · REDEEM EVENT STATE', redeemRow ? 'PRESENT (' + redeemRow.points + ' pts)' : 'ABSENT')
    F('BEFORE · PRIOR REFUND LOYALTY EVENT', priorRefundLoyalty.length ? 'YES (' + priorRefundLoyalty.map((t) => t.type + ':' + t.points).join(',') + ')' : 'NO')
    F('BEFORE · PRIOR REFUND LEDGER ENTRY', priorRefundLedger.length ? 'YES (' + priorRefundLedger.length + ')' : 'NO')
    preState = { refundRows: refundRows.length, ledgerLines: ledgerLines.length, lc: !!lc, earn: !!earnRow, redeem: !!redeemRow, priorRefundLoyalty: priorRefundLoyalty.length, priorRefundLedger: priorRefundLedger.length }
    if (!ledgerLines.length) A('3 db: no ledger line for the PI — BEFORE-state incomplete')
    if (!lc) A('3 db: loyalty customer not found — BEFORE-state incomplete')
    if (priorRefundLoyalty.length || priorRefundLedger.length) A('3 db: prior refund loyalty/ledger evidence exists — not the first rehearsal')
    if (order.paymentStatus !== 'paid') A('3 db: paymentStatus ' + order.paymentStatus + ' ≠ paid')
    if (refundRows.some((r) => r.status === 'pending')) A('3 db: a PENDING refund row exists — unknown in-flight refund')
    if (refundRows.some((r) => r.status === 'failed')) A('3 db: a FAILED refund row exists — engine fail-closed lock active')
    if (refundRows.some((r) => r.status === 'succeeded') && MODE === 'precheck') A('3 db: a refund already exists on the order — not the first rehearsal any more')
  } catch (e) { A('3 db: ' + scrub(e)) } finally { if (prisma) await prisma.$disconnect().catch(() => {}) }

  // ── Stripe objects ──────────────────────────────────────────────────────────
  console.log('[4] stripe objects')
  let pi = null, ch = null, tr = null, fee = null, refunds = [], dest = null
  if (!piId) piId = process.env.PHASE2_REFUND_PI || null
  if (!piId) A('4 stripe: no PaymentIntent id (DB not measured) — Stripe object precheck NOT MEASURED')
  else try {
    pi = await retrieve('payment_intents', piId, { expand: ['latest_charge'] })
    ch = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    dest = pi.transfer_data && pi.transfer_data.destination ? (typeof pi.transfer_data.destination === 'string' ? pi.transfer_data.destination : pi.transfer_data.destination.id) : null
    F('PAYMENT INTENT (Stripe)', mask(pi.id) + ' · status ' + pi.status + ' · amount ' + pi.amount + ' · amount_received ' + pi.amount_received + ' · fee ' + pi.application_fee_amount + ' · destination ' + mask(dest) + ' · on_behalf_of ' + mask(pi.on_behalf_of))
    if (ch) {
      F('CHARGE (Stripe)', mask(ch.id) + ' · status ' + ch.status + ' · captured ' + ch.amount_captured + ' · amount_refunded ' + ch.amount_refunded + ' · refunded ' + ch.refunded + ' · disputed ' + ch.disputed)
      F('REMAINING CASH REFUNDABLE (Stripe)', String(ch.amount_captured - ch.amount_refunded))
      if (ch.amount_captured - ch.amount_refunded < AMOUNT_CENTS) A('4 stripe: remaining refundable < ' + AMOUNT_CENTS)
      // PRE-MODE-B V1 — une charge contestée ne doit JAMAIS entrer dans une fenêtre de remboursement :
      // le chargeback a déjà sorti l'argent sans toucher amount_refunded.
      if (ch.disputed === true) A('4 stripe: charge DISPUTED — remboursement interdit (litige)')
      if (ch.application_fee) { fee = await retrieve('application_fees', typeof ch.application_fee === 'string' ? ch.application_fee : ch.application_fee.id); F('APPLICATION FEE (Stripe)', mask(fee.id) + ' · amount ' + fee.amount + ' · amount_refunded ' + fee.amount_refunded) }
      if (ch.transfer) { tr = await retrieve('transfers', ch.transfer); F('TRANSFER (Stripe)', mask(tr.id) + ' · amount ' + tr.amount + ' · amount_reversed ' + tr.amount_reversed + ' · destination ' + mask(tr.destination)) }
    }
    refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 100 }).autoPagingToArray({ limit: 100 })
    const by = {}; for (const r of refunds) by[r.status] = (by[r.status] || 0) + 1
    F('REFUNDS on PI (Stripe)', refunds.length + ' ' + JSON.stringify(by))
    if (pi.status !== 'succeeded') A('4 stripe: PI status ' + pi.status)
  } catch (e) { A('4 stripe: ' + scrub(e)) }

  // ── Engine vector (inputs only — the vector itself is pinned by tests/rehearsal-vector-n5tsm0.test.ts) ─
  const T = ch ? ch.amount_captured : null, Fee = fee ? fee.amount : (pi ? pi.application_fee_amount : null), Cprev = ch ? ch.amount_refunded : null
  if (T != null && Fee != null && Cprev != null) {
    // Same arithmetic as lib/refund.ts computeRefundSplit (cumulative rounded fee target) — printed
    // as EXPECTED for comparison with the pinned test vector; the engine remains authoritative.
    const feeCum = (x) => Math.round((Fee * x) / T)
    const C = Math.min(Cprev + AMOUNT_CENTS, T)
    const feeRefund = feeCum(C) - feeCum(Cprev)
    const reversal = AMOUNT_CENTS - feeRefund
    F('EXPECTED VECTOR (' + AMOUNT_CENTS + ' c cash; formula of computeRefundSplit with MEASURED inputs T=' + T + ' F=' + Fee + ' Cprev=' + Cprev + ')', 'fee refund ' + feeRefund + ' · restaurant reversal ' + reversal + ' · royalty 0 (standard)')
    F('EXPECTED STRIPE OBJECTS', 'Transfer.amount_reversed +' + AMOUNT_CENTS + ' (GROSS = cash amount) · ApplicationFee.amount_refunded +' + feeRefund + ' (credited back to the connected account) · connected NET effect −' + reversal)
    F('REQUIRED CONNECT FUNDING (GROSS transfer reversal — T-42)', String(AMOUNT_CENTS))
    F('CONNECTED NET EFFECT (engine restaurantReverse)', String(reversal))
    if (C === T) F('FULL REFUND EXPECTATION', 'remaining refundable 0 · charge.refunded true · Transfer.amount_reversed = ' + T + ' · ApplicationFee.amount_refunded = ' + Fee)
    if (order && loyalty) {
      // ══ LOYALTY EXPECTATION — THE CUMULATIVE CONTRACT (L6.1), NOT THE PER-EVENT MODEL ═════════════════
      //
      // WHAT THIS BLOCK USED TO PRINT, AND WHY IT WAS THE PRE-L11 BLOCKER. It printed
      // `cum(E,C) - cum(E,Cprev)` under the label « planLoyaltyRefund formula » — the PER-EVENT model.
      // lib/loyalty-refund.ts says so in its own header: « planLoyaltyRefund … they are the pure statement of
      // the per-event model, they are what the refund-gate operator's expected vector mirrors … they are no
      // longer what persists the effect ». Since L6.1 the reconciliation CONVERGES: each pass reduces the
      // proven set to ONE number (Σ refunded cents, deduplicated by `re_`), computes the §9 target for that
      // number, READS the effect really applied in the ledger, and writes only the difference.
      //
      // For an in-order prefix the two agree, which is exactly why the old line looked correct for three
      // years of rehearsals. They DIVERGE whenever: an older refund arrives late (the per-event delta prices
      // it from a cumulative of zero and over-books), a pre-L6.1 row over-applied by one point, the base or
      // the charge amount moved, or a prior effect was only partly applied. In any of those the operator
      // would read a MISMATCH that is not one — or, worse, treat the per-event number as the oracle and
      // conclude the engine misbehaved. A human gate that disagrees with the contract it certifies is not a
      // gate. So the expectation below is the DELTA TO THE TARGET, and the per-event figure is printed only
      // as a cross-check, explicitly labelled NOT the oracle.
      //
      // THE CANONICAL EXAMPLE (the founder's, and the one the suite pins): T=1410, E=14, three refunds of
      // 470 ⇒ targets 5, 9, 14 ⇒ deltas −5 / −4 / −5. NEVER −5 / −5 / −5.
      //
      // THE ARITHMETIC IS RESTATED HERE, and that duplication is deliberate: this file runs on the o2switch
      // server as plain Node, where lib/*.ts cannot be required (the deploy ships the compiled bundle, not
      // the sources). tests/prel11-refund-gate-loyalty.test.ts pins every line of it against
      // loyaltyPointsCumulative / loyaltyConvergenceDelta on a shared fixture, so the restatement cannot
      // drift from the engine without a red test.
      const clamp = (v, hi) => Math.max(0, Math.min(v, hi))
      const targetFor = (base, cumCents) => clamp(Math.round((Number(base) || 0) * cumCents / T), Number(base) || 0)

      // (1) THE PROVEN CUMULATIVE. Stripe's `charge.amount_refunded` IS Σ of the succeeded refunds, so it is
      //     the same number `cumulativeRefundedCents(refunds)` computes after deduplicating by `re_`. Both are
      //     printed: a disagreement would mean our view of the set is not Stripe's, which is an anomaly and
      //     not something to average.
      // Σ OF THE SUCCEEDED REFUNDS, DEDUPLICATED BY `re_` — and THAT is the cumulative, not
      // `charge.amount_refunded`. Found by this lot's adversarial review, in this very block: the first version
      // computed this number as a « cross-check » and then priced the target on `Cprev` anyway.
      // `charge.amount_refunded` COUNTS PENDING REFUNDS (a fact this repository has already paid for once — see
      // `amount_refunded` in lib/refund.ts's ceiling reasoning), while `cumulativeRefundedCents` in
      // lib/loyalty-refund.ts sums the PROVEN set. On a charge carrying a pending refund the two differ, and the
      // operator would have read a target, and a DELTA TO WRITE, that the engine will not produce — under a
      // label saying it is the expectation. So the proven set decides, and `amount_refunded` becomes what it
      // actually is: a cross-check, and an upper bound worth naming when it disagrees.
      const listRead = Array.isArray(refunds)
      const succeeded = (refunds || []).filter((r) => r && r.status === 'succeeded')
      const seen = {}
      let cumFromList = 0
      for (const r of succeeded) { if (!seen[r.id]) { seen[r.id] = 1; cumFromList += r.amount } }
      const pendingOnCharge = (refunds || []).filter((r) => r && r.status === 'pending')
      // NOT MEASURED, never a measured 0: an unread refunds list is not an empty one, and the file's own
      // evidence rule forbids printing the difference. Without the list there is no proven set, so there is no
      // honest expectation either — the block says so and stops rather than pricing on a number it distrusts.
      F('CUM REFUNDED BEFORE (Σ succeeded refunds, deduped by re_ — THE PROVEN SET, what the engine uses)',
        listRead ? cumFromList + ' c (' + Object.keys(seen).length + ' distinct succeeded refund' + (Object.keys(seen).length === 1 ? '' : 's') + ')' : 'NOT MEASURED')
      F('CUM REFUNDED BEFORE (Stripe charge.amount_refunded — CROSS-CHECK; INCLUDES PENDING)', Cprev + ' c'
        + (listRead ? (cumFromList === Cprev ? ' — AGREES with the proven set' : ' — DISAGREES: ' + (Cprev > cumFromList ? 'higher, i.e. a refund is PENDING or unproven' : 'LOWER than the proven set, which should be impossible')) : ''))
      if (listRead && pendingOnCharge.length) {
        A('5 loyalty: ' + pendingOnCharge.length + ' PENDING refund(s) on this charge — charge.amount_refunded counts them, the loyalty target does NOT; the expectation below is priced on the PROVEN set only')
      }
      if (listRead && cumFromList !== Cprev && !pendingOnCharge.length) {
        A('5 loyalty: Σ deduped succeeded refunds ' + cumFromList + ' c ≠ charge.amount_refunded ' + Cprev + ' c with NO pending refund to explain it — our view of the proven set is not Stripe\'s')
      }
      if (!listRead) A('5 loyalty: the Stripe refunds list was not read — no proven set, so NO loyalty expectation is stated')
      const cumBefore = listRead ? cumFromList : null
      const cumAfter = cumBefore === null ? null : Math.min(cumBefore + AMOUNT_CENTS, T)
      F('CUM REFUNDED AFTER this ' + AMOUNT_CENTS + ' c (clamped to T=' + T + ')', cumAfter === null ? 'NOT MEASURED' : cumAfter + ' c')

      // (2) THE FLOOR. `cumEff = max(cumProven, highWaterCum(rows))`: a proof set that shrank never hands
      //     points back, and when the floor engages the reconciliation says so rather than passing silently.
      const cumEff = cumAfter === null ? null : Math.max(cumAfter, loyalty.highWaterCum || 0)
      if (cumEff !== null && cumEff > cumAfter) {
        F('L6.1 FLOOR ENGAGED', 'high-water key cum ' + loyalty.highWaterCum + ' c > proven ' + cumAfter
          + ' c → the target is priced on the HIGH WATER; nothing is handed back')
        A('5 loyalty: the proof set is SMALLER than what this order was already reconciled against (high water '
          + loyalty.highWaterCum + ' c > proven ' + cumAfter + ' c)')
      }

      // (3) THE TARGET, THE APPLIED EFFECT, AND THE ONLY NUMBER THAT WILL BE WRITTEN: their difference.
      // THE D1 BASE IS THE EARN ROW'S POINTS, NOT `Order.pointsEarned`. Also from the review: the engine reads
      // `earnTx.points` (lib/loyalty-refund-apply, « if that row is absent the base is 0 ») because the ROW is
      // what was actually credited at `delivered`, while the column is written at creation and can differ. The
      // column is printed beside it, and a divergence is an anomaly rather than a choice to make quietly.
      const baseEarn = loyalty.earnRow ? Math.max(0, Math.floor(Number(loyalty.earnPoints) || 0)) : 0
      if (loyalty.earnRow && baseEarn !== order.pointsEarned) {
        A('5 loyalty: the earn ROW credits ' + baseEarn + ' pt while Order.pointsEarned says ' + order.pointsEarned + ' — the engine prices D1 on the ROW; the column is not the base')
      }
      const tgtEarn = cumEff === null ? null : targetFor(baseEarn, cumEff)
      const tgtSpent = cumEff === null ? null : targetFor(order.pointsRedeemed, cumEff)
      const dEarn = tgtEarn === null ? null : tgtEarn - (loyalty.appliedEarn || 0)
      const dSpent = tgtSpent === null ? null : tgtSpent - (loyalty.appliedSpent || 0)
      // REVIEW P2 — TWO SIGN CONVENTIONS, ONE LINE APART. `loyaltyConvergenceDelta` is a MAGNITUDE to claw
      // back (positive = take more points), while the founder's canonical « −5 / −4 / −5 » are the movements of
      // the CUSTOMER'S BALANCE. Both are correct and they are opposite, so the convention is now stated on the
      // line itself: a gate whose two numbers disagree in sign teaches the operator to distrust the right one.
      F('LOYALTY SIGN CONVENTION', 'DELTA TO WRITE is a MAGNITUDE: +N = claw N more points back ⇒ the customer\'s balance moves −N. A NEGATIVE delta gives points BACK.')
      if (loyalty.grandfathered) {
        F('EXPECTED LOYALTY — GRANDFATHERED', 'this order carries a legacy `refund` row with a NULL sourceEventId ⇒ lib/loyalty-refund-apply returns `grandfathered` BEFORE computing any target and writes NOTHING. The figures below are the contract\'s arithmetic, NOT an expected write.')
        A('5 loyalty: GRANDFATHERED order — the reconciliation writes NOTHING whatever the delta below says')
      }
      F('EXPECTED LOYALTY — D1 EARN CLAWBACK (L6.1 convergence)', tgtEarn === null ? 'NOT MEASURED (no proven set)'
        : 'target ' + tgtEarn + ' pt (round(' + baseEarn + '×' + cumEff + '/' + T + '), clamped; base = the earn ROW'
        + (loyalty.earnRow ? '' : ', ABSENT ⇒ 0') + ')'
        + ' · already applied ' + (loyalty.appliedEarn || 0) + ' pt · DELTA TO WRITE ' + (dEarn > 0 ? '+' : '') + dEarn + ' pt'
        + (dEarn === 0 ? ' — CONVERGED, the reconciliation writes NOTHING'
          : loyalty.grandfathered ? ' — BUT GRANDFATHERED: nothing is written'
            : ' — what reaches the VISIBLE BALANCE may be smaller: a clawback beyond it becomes recovery offset, a give-back releases offset debt first (see the offset line)'))
      F('EXPECTED LOYALTY — D2 SPENT RESTORE (L6.1 convergence)', tgtSpent === null ? 'NOT MEASURED (no proven set)'
        : 'target ' + tgtSpent + ' pt (round(' + order.pointsRedeemed + '×' + cumEff + '/' + T + '), clamped)'
        + ' · already applied ' + (loyalty.appliedSpent || 0) + ' pt · DELTA TO WRITE ' + (dSpent > 0 ? '+' : '') + dSpent + ' pt'
        + (dSpent === 0 ? ' — CONVERGED, the reconciliation writes NOTHING'
          : loyalty.grandfathered ? ' — BUT GRANDFATHERED: nothing is written' : ''))
      F('EXPECTED LOYALTY KEY (L6.1)', cumEff === null ? 'NOT MEASURED' : 'prorata:v1:' + order.id + ':' + cumEff
        + ' — the key names the TRANSITION (the cumulative), never a `re_`: a key naming ONE refund cannot express a total an older refund must move')

      // (4) THE PER-EVENT FIGURE, PRINTED AND DISOWNED. Kept because a difference between the two is
      //     information (it says the set arrived out of order, or an old row over-applied), and removing it
      //     would hide that. It is NOT what the engine will write.
      const perEventEarn = cumAfter === null ? null : targetFor(baseEarn, cumAfter) - targetFor(baseEarn, cumBefore)
      const perEventSpent = cumAfter === null ? null : targetFor(order.pointsRedeemed, cumAfter) - targetFor(order.pointsRedeemed, cumBefore)
      F('PER-EVENT MODEL (planLoyaltyRefund) — CROSS-CHECK ONLY, **NOT THE ORACLE**', perEventEarn === null ? 'NOT MEASURED'
        : 'D1 ' + perEventEarn + ' pt · D2 ' + perEventSpent + ' pt'
        + ((perEventEarn === dEarn && perEventSpent === dSpent)
          ? ' — equal to the convergence delta here (in-order prefix, nothing already over-applied)'
          : ' — DIFFERS from the convergence delta: the engine writes the DELTA above, and this difference is itself evidence (late arrival, or a pre-L6.1 row that over-applied)'))
      F('LOYALTY CONTRACT (canonical example, pinned by the suite)',
        'T=1410 E=14, three refunds of 470 ⇒ cumulative clawback targets 5/9/14 pt ⇒ DELTA TO WRITE +5/+4/+5 pt, '
        + 'i.e. the balance moves −5/−4/−5 — never −5/−5/−5 (that is the per-event model, which books the same 5 three times)')

      // (5) The offset side, unchanged in meaning: a clawback larger than the visible balance becomes
      //     internal debt rather than a negative balance. Priced on the DELTA, which is what gets applied.
      // A GIVE-BACK IS NOT A ZERO. When the delta is NEGATIVE (more was applied than the target — reachable on a
      // pre-L6.1 row, or when the base moves) the engine does not add offset, it RELEASES it against the debt,
      // and printing « 0 » there would describe the wrong operation. Third finding of the review in this block.
      F('EXPECTED RECOVERY OFFSET DELTA (clawback beyond the visible balance)',
        dEarn === null || loyalty.balance == null ? 'NOT MEASURED'
          : dEarn < 0 ? 'GIVE-BACK of ' + (-dEarn) + ' pt — offset is RELEASED against the debt first, not increased (lib/loyalty-refund.applyGiveBackAgainstOffset)'
            : String(Math.max(0, dEarn - Math.max(0, loyalty.balance))))
    }
    var requiredReversal = AMOUNT_CENTS // GROSS (T-42): Stripe needs the full cash amount available on the connected account
  } else { A('5 vector: inputs NOT MEASURED'); var requiredReversal = null }

  // ── Connected account balance + payout schedule (READ-ONLY) ─────────────────
  console.log('[5] connected account balance + payout schedule')
  let available = null, pending = null, schedule = null
  if (dest) try {
    const bal = rest ? await rest.balanceFor(dest) : await stripe.balance.retrieve({}, { stripeAccount: dest })
    const eurA = (bal.available || []).find((x) => x.currency === 'eur'), eurP = (bal.pending || []).find((x) => x.currency === 'eur')
    available = eurA ? eurA.amount : 0; pending = eurP ? eurP.amount : 0
    const others = [...(bal.available || []), ...(bal.pending || [])].filter((x) => x.currency !== 'eur').map((x) => x.currency + ':' + x.amount)
    F('CONNECTED ACCOUNT', mask(dest))
    F('CONNECTED AVAILABLE EUR (cents)', String(available))
    F('CONNECTED PENDING EUR (cents)', String(pending))
    F('OTHER CURRENCY BALANCES', others.length ? others.join(' ') : 'none')
    F('BALANCE MEASURED AT', new Date().toISOString())
    const ac = await retrieve('accounts', dest)
    schedule = ac.settings && ac.settings.payouts && ac.settings.payouts.schedule
    F('PAYOUT SCHEDULE (connected TEST account)', JSON.stringify(schedule) + ' · payouts_enabled ' + ac.payouts_enabled + ' · charges_enabled ' + ac.charges_enabled)
    if (!schedule || schedule.interval !== 'manual') A('5 payout: schedule is not manual — an automatic payout could sweep the funds (PAYOUT SCHEDULE RISK = OPEN); NOT changed by this script')
    if (requiredReversal != null) {
      F('AVAILABLE BALANCE SUFFICIENT (available >= GROSS transfer reversal)', available >= requiredReversal ? 'YES (margin ' + (available - requiredReversal) + ' c)' : 'NO (' + available + ' < ' + requiredReversal + ')')
      if (available < requiredReversal) verdict = 'WAIT — connected AVAILABLE ' + available + ' c < GROSS transfer reversal ' + requiredReversal + ' c (pending ' + pending + ' c; no manufactured funds, no platform advance)'
    }
  } catch (e) { A('5 balance: ' + scrub(e)) }
  else A('5 balance: destination account unknown — NOT MEASURED')

  // ── Webhook config (READ-ONLY) ──────────────────────────────────────────────
  console.log('[6] webhooks')
  try {
    const wes = rest ? await rest.listWebhookEndpoints() : (await stripe.webhookEndpoints.list({ limit: 10 })).data
    for (const w of wes) {
      const u = new URL(w.url)
      const has = (ev) => w.enabled_events.includes(ev) || w.enabled_events.includes('*')
      F('WEBHOOK ' + mask(w.id), u.hostname + u.pathname + ' · ' + w.status + ' · livemode ' + w.livemode + ' · charge.refunded ' + (has('charge.refunded') ? 'SUBSCRIBED' : 'NOT') + ' · refund.updated ' + (has('refund.updated') ? 'SUBSCRIBED' : 'NOT') + ' · refund.failed ' + (has('refund.failed') ? 'SUBSCRIBED' : 'NOT'))
    }
    const ok = wes.some((w) => w.status === 'enabled' && !w.livemode && /app\.grubano\.com/.test(w.url) && ['charge.refunded', 'refund.updated', 'refund.failed'].every((ev) => w.enabled_events.includes(ev) || w.enabled_events.includes('*')))
    F('WEBHOOK PRECHECK', ok ? 'PASS' : 'FAIL')
    if (!ok) A('6 webhook: no enabled TEST endpoint on app.grubano.com carries all three refund events')
  } catch (e) { A('6 webhook: ' + scrub(e)) }

  if (verdict === 'NOT MEASURED') verdict = anomalies.length ? 'BLOCKED — see anomalies' : 'READY FOR FOUNDER AUTHORIZATION (no refund executed by this script)'

  if (MODE === 'precheck') return done(anomalies.length ? 'FAIL' : (verdict.startsWith('WAIT') ? 'WAIT' : 'PASS'))

  // ── WINDOW MODE (future; fail-closed; auto-refreeze) ─────────────────────────
  console.log('[7] refund window')
  if (process.env.PHASE2_REFUND_WINDOW_CONFIRM !== CONFIRM_SENTENCE) return fail('7 window: confirm sentence missing — nothing changed')
  if (anomalies.length) return fail('7 window: precheck anomalies — window REFUSED, nothing changed')
  // FAIL CLOSED: the BEFORE-state (DB refund rows, ledger, loyalty) must be fully captured
  // before REFUNDS_ENABLED may ever be set to true.
  if (!preState || !order || !loyalty || !preState.ledgerLines || !preState.lc) return fail('7 window: BEFORE-state incomplete (DB / ledger / loyalty) — window REFUSED, nothing changed')
  F('WINDOW PRE-STATE CAPTURE', 'PASS (refund rows ' + preState.refundRows + ', ledger lines ' + preState.ledgerLines + ', loyalty customer YES, earn ' + (preState.earn ? 'PRESENT' : 'ABSENT') + ', redeem ' + (preState.redeem ? 'PRESENT' : 'ABSENT') + ', prior refund evidence NO)')
  if (!verdict.startsWith('READY')) return fail('7 window: precheck verdict ' + verdict + ' — window REFUSED, nothing changed')
  if (gate0 !== 'CLOSED') return fail('7 window: gate not CLOSED before opening — refusing')
  // T-93 (c): the window LENGTH is validated by name HERE — before the stamp, before the arm, before any
  // write — so a malformed authorization changes nothing. The check it replaces was bypassable: it
  // compared a possibly-NaN duration with `>`, and NaN fails every comparison.
  const windowMsBad = windowMsRefusal()
  if (windowMsBad) return fail('7 window: ' + windowMsBad + ' Nothing changed.')
  F('WINDOW LENGTH', Math.round(WINDOW_DEADLINE_MS / 1000) + ' s (validated: a positive whole number of ms, '
    + 'and window + 2 min ≤ the 30 min lease ceiling)'
    + (WINDOW_DEADLINE_MS < WINDOW_MS_PLAUSIBLE_MS
      ? ' — NOTE: under ' + (WINDOW_MS_PLAUSIBLE_MS / 1000) + ' s. Legal and SAFER (the gate is open for less '
        + 'time), but too short to observe a real refund: this is a test-harness length, not a rehearsal length.'
      : ''))
  const stamp = new Date().toISOString()
  const refundsBefore = refunds.length
  let opened = null
  try {
    armedRefreeze = { envFile, stamp } // ARM BEFORE the write: a signal between write and arm would else escape
    // T-48: the flag alone authorizes NOTHING any more. The window also writes an ABSOLUTE
    // expiry that the application re-checks on every refund call, so the authorization dies of
    // old age even if this process is killed and never runs its cleanup.
    const leaseUntil = new Date(Date.now() + Math.min(WINDOW_DEADLINE_MS + 120000, 30 * 60 * 1000)).toISOString()
    writeFlag(envFile, 'REFUNDS_WINDOW_UNTIL', leaseUntil, stamp)
    opened = writeFlag(envFile, 'REFUNDS_ENABLED', 'true', stamp)
    F('T-48 AUTHORIZATION LEASE', 'REFUNDS_WINDOW_UNTIL=' + leaseUntil + ' — after this instant the gate is CLOSED by the application itself, with nobody acting (SIGKILL / host crash included)')
    F('WINDOW OPEN WRITE', opened.changed ? 'REFUNDS_ENABLED=true (backup ' + opened.backup + ')' : 'no change')
    F('EMERGENCY REFREEZE', 'ARMED (SIGINT/SIGTERM/SIGHUP/SIGQUIT/SIGBREAK + uncaught throw ⇒ REFUNDS_ENABLED=false is written synchronously before exit; SIGKILL cannot be caught)')
    touchRestart()
    const w1 = await waitGate(base, 'OPEN', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
    F('GATE AFTER OPEN', w1.last + ' after ' + Math.round(w1.elapsedMs / 1000) + ' s')
    if (!w1.ok) throw new Error('gate did not open (still ' + w1.last + ')')
    F('WINDOW', 'OPEN at ' + new Date().toISOString() + ' — the ONE refund is executed by the GitHub dispatch workflow refund-rehearsal.yml (secrets.INTERNAL_CRON_TOKEN); this script only WAITS. Deadline ' + Math.round(WINDOW_DEADLINE_MS / 60000) + ' min')
    const t0 = Date.now(); let seen = null
    while (Date.now() - t0 < WINDOW_DEADLINE_MS) {
      const list = await stripe.refunds.list({ payment_intent: piId, limit: 100 }).autoPagingToArray({ limit: 100 })
      if (list.length > refundsBefore) { seen = list; break }
      await sleep(POLL_MS)
    }
    if (seen) {
      const extra = seen.length - refundsBefore
      F('REFUND OBSERVED (Stripe)', extra + ' new refund object(s): ' + seen.map((r) => mask(r.id) + ':' + r.status + ':' + r.amount).join(' '))
      if (extra !== 1) A('7 window: expected exactly ONE new refund, saw ' + extra)
      if (seen.some((r) => r.status !== 'succeeded')) F('REFUND STATUS TRUTH', 'at least one refund is NOT succeeded — do NOT claim success (pending/failed follow refund.updated/refund.failed)')
    } else F('REFUND OBSERVED (Stripe)', 'NONE within the window — nothing executed')
  } catch (e) { A('7 window: ' + scrub(e)) } finally {
    /* UNCONDITIONAL RE-FREEZE — the whole sequence lives in closeRefundWindow() so that a TEST can
       exercise its partial-failure paths (a write that throws, a restart that throws, a gate that never
       proves closed) without opening a real window. Three of T-93's four defects were HERE, and none of
       them was reachable by any test, because the sequence was inline in main(). */
    await closeRefundWindow({ envFile, stamp, base })
  }
  return done(anomalies.length ? 'FAIL' : 'PASS')
}

// Running the file executes the operator exactly as before; requiring it (tests) only exposes the
// fail-closed primitives so the emergency re-freeze can be proven without delivering a real signal.
if (require.main === module) main().catch((e) => fail('unexpected: ' + scrub(e)))

module.exports = {
  writeFlag,
  emergencyRefreeze,
  armRefreeze: (envFile, stamp) => { armedRefreeze = { envFile, stamp } },
  isRefreezeArmed: () => armedRefreeze !== null,
  // T-93: the pieces a test must be able to exercise WITHOUT opening a window.
  windowMsRefusalFor,
  windowMsRefusal,
  backupNames,
  neutralizeOwnBackups,
  // T-108: the sibling operators call this with their own reporter.
  closeRefundWindow,
  WINDOW_MS_FLOOR_MS,
  WINDOW_MS_LEASE_MARGIN_MS,
  WINDOW_MS_HARD_CEILING_MS,
}
