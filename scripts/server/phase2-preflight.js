'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase2-preflight.js — PHASE 2 PREFLIGHT — CORRECTIVE PASS (staging, one-shot, v3)

   Run ONCE on the staging server (cPanel Terminal), with the nodevenv node:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js

   v3 (2026-09-04) — after the v2 run: it wrote REFUNDS_ENABLED=false (measured), but it
   also wrote LOGISTICS_SIGNUP_ENABLED=false (WRONG: the courier WAITLIST is IN the closed
   beta — only operational delivery is out, locked by LOGISTICS_COURIER_ACTIVATION_ENABLED),
   it replaced ALERT_EMAIL=m.maazouz@grubano.com (the founder's monitored mailbox) by the QA
   address, and it FAILED at step 9 (ledger check HTTP 401) BEFORE touching restart.txt — so
   the running process never reloaded the file (measured from outside on 2026-09-04: the
   refund routes still answer 401 instead of 403 {gated}, i.e. the PROCESS still has
   REFUNDS_ENABLED=true while the FILE says false).

   Root-cause class handled here — TWO PARSERS OF THE SAME FILE:
     • the RUNTIME loader (server.js) is STRICT: /^([A-Z_][A-Z0-9_]*)=(.*)$/ on the RAW line,
       FIRST occurrence wins (`!process.env[key]`), a BOM / leading space / `KEY = v` /
       `export KEY=v` line is silently NOT loaded;
     • the v2 operator was LENIENT (trim, indexOf('='), LAST occurrence wins).
     A key can therefore read `true` for the operator and be ABSENT/`false` for the process
     (TIPS_ENABLED: file "true" for v2, `tipsEnabled:false` on the live API; INTERNAL_CRON_TOKEN:
     "present" for v2, 401 from the route). v3 parses BOTH ways, prints the divergence per key,
     writes CANONICAL lines (`KEY=value`, later duplicates neutralised as comments) so both
     parsers agree, and sends the ledger token exactly as the RUNTIME loads it.

   Steps (fail-closed on identity BEFORE any write; after the write the safety config is
   loaded FIRST — restart happens BEFORE every read-only check can abort):
     1. ENV       staging identity (schema + Phase 2/F2 build markers + NEXTAUTH_URL on
                  app.grubano.com + no "prod" database name + Stripe key TEST) ; both parses
                  of every watched key ; backup history of the watched keys (provenance).
     2. BACKUP    .env.local → .env.local.bak-phase2-<stamp> (600), content verified.
     3. MAIL      ONE safe non-financial MONEY REVIEW test e-mail to the FINAL alert mailbox
                  (m.maazouz@grubano.com — founder policy). MX of grubano.com = the app's own
                  SMTP host, so a RCPT acceptance = the mailbox exists. An explicit RCPT
                  rejection → falls back to admin-qa@grubano.com (evidence printed).
     4. WRITE     REFUNDS_ENABLED=false · LOGISTICS_SIGNUP_ENABLED=true · ALERT_EMAIL=<final>
                  · TIPS_ENABLED=false ONLY IF the runtime would load it as true while
                  LOGISTICS_PAYOUT_ENABLED is not true (versioned coupling rule — check-flags
                  D-1 "held third-party funds"; beta runbook: TIPS OFF in beta; the live
                  process runs it OFF today, so this preserves the running state) ·
                  INTERNAL_CRON_TOKEN line normalised to canonical shape ONLY IF it exists once
                  and the runtime cannot load it (value unchanged, never printed).
                  LOGISTICS_COURIER_ACTIVATION_ENABLED is NEVER written (must stay effective false).
                  Every other line byte-for-byte; re-read proves it under BOTH parsers.
     5. FLAGS     effective values (runtime parse of the re-read file) ; FAIL if any auto-money
                  flag / REFUNDS_ENABLED / CLAIMS_ENABLED / LOGISTICS_COURIER_ACTIVATION_ENABLED
                  is true → the restart is REFUSED (file restored from the backup).
     6. RESTART   touch tmp/restart.txt, then POLL the live app (read-only, unauthenticated):
                  /fr/eat 200 · /api/restaurants 200 (DB-backed) · POST /api/admin/refunds/run {}
                  → 403 {gated:true} (= the PROCESS reads REFUNDS_ENABLED false; 401 = still true)
                  · /fr/business/logistics 200 (= signup reloaded) · GET /api/restaurants/[id]
                  .tipsEnabled = expected. Deadline 240 s. Process start times via `ps` (best-effort).
     7. HEALTH    fresh post-restart responses: no 5xx, DB-backed JSON, no restart loop (3 probes).
     8. REFUNDS   READ-ONLY DB: no unexpected refund since 2026-08-29 (only the Z1 rehearsal).
     9. ORDER     READ-ONLY DB facts of GR-N5TSM0.
    10. FRANCH    READ-ONLY DB franchise reachability counts.
    11. LEDGER    GET /api/admin/ledger/check (7 days) with the RUNTIME-parsed internal token
                  (never printed) ; 401 diagnostics if it persists.

   NO refund. NO Stripe write. NO money. NO schema. NO loyalty mutation. NO secret printed.
   Every printed value is MEASURED (file / DB / live route / provider) and tagged.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const APP_ROOT       = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID       = process.env.PHASE2_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const TARGET_ALERT   = (process.env.PHASE2_ALERT_EMAIL || 'm.maazouz@grubano.com').trim()
const FALLBACK_ALERT = 'admin-qa@grubano.com'
const WINDOW_START   = new Date('2026-08-29T00:00:00Z') // start of the measured TRUE-flag window
const RELOAD_DEADLINE_MS  = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS  = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)

const MONEY_FLAGS_MUST_BE_FALSE = [
  'REFUNDS_ENABLED', 'CLAIMS_ENABLED', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED',
  'GHOST_ORDER_AUTO_REFUND_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED',
]
const FLAGS_TO_PRINT = [
  ...MONEY_FLAGS_MUST_BE_FALSE,
  'FRANCHISE_ENABLED', 'FRANCHISE_ROYALTY_ENABLED', 'FRANCHISE_SETTLEMENT_ENABLED',
  'TIPS_ENABLED', 'LOGISTICS_PAYOUT_ENABLED', 'LOGISTICS_ENABLED', 'LOGISTICS_SIGNUP_ENABLED',
  'DELIVERY_FULFILLMENT_ENABLED', 'CHARGEBACKS_ENABLED',
  'ALLOW_PLATFORM_FALLBACK', 'RATE_LIMIT_ENABLED', 'ADMIN_AUDIT_ENABLED',
]
const WATCHED_KEYS = [
  'REFUNDS_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED',
  'TIPS_ENABLED', 'LOGISTICS_PAYOUT_ENABLED', 'ALERT_EMAIL', 'INTERNAL_CRON_TOKEN',
]
const SECRET_KEYS = new Set(['INTERNAL_CRON_TOKEN'])

const facts = []
const anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (msg) => { anomalies.push(msg); console.log('  !! ANOMALY: ' + msg) }
const mask = (s) => (typeof s === 'string' && s.length > 8 ? s.slice(0, 4) + '***' + s.slice(-4) : (s ? '***' : 'null'))
const eff = (v) => (v === undefined ? 'ABSENT → EFFECTIVE FALSE' : (v === 'true' ? 'true' : JSON.stringify(v) + ' → EFFECTIVE FALSE'))
const showVal = (k, v) => (v === undefined ? 'ABSENT' : (SECRET_KEYS.has(k) ? '(present, ' + v.length + ' chars, not printed)' : JSON.stringify(v)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function done(result, failedStep, action) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 PREFLIGHT v3 (staging) — every value below is MEASURED on the server')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('SAFE TO CONTINUE: ' + (result === 'PASS' ? 'YES' : 'NO'))
  console.log('ACTION: ' + (action || 'PASTE THIS WHOLE OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  // Let the keep-alive sockets of the live probes close before exiting (an immediate
  // process.exit() right after fetch() trips a libuv handle assertion on some platforms).
  process.exitCode = result === 'PASS' ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step, action) => done('FAIL', step, action)

// ── Env parsing — TWO semantics ─────────────────────────────────────────────────
/** RUNTIME semantics = server.js loader: strict regex on the RAW line, FIRST occurrence wins,
 *  one leading/trailing quote stripped then trim. A line the runtime cannot load is invisible. */
function parseEnvRuntime(txt) {
  const out = {}
  txt.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in out)) out[m[1]] = { value: m[2].replace(/^["']|["']$/g, '').trim(), line: i + 1 }
  })
  return out
}
/** LENIENT semantics (the v2 operator): trim, split at the first '=', paired quotes stripped,
 *  LAST occurrence wins. Kept only to DIAGNOSE the divergence — never used for a decision. */
function parseEnvLenient(txt) {
  const out = {}
  txt.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const k = line.indexOf('=')
    if (k <= 0) return
    let v = line.slice(k + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, k).trim()] = { value: v, line: i + 1 }
  })
  return out
}
/** Shape of a raw line that names `key` (why the runtime would or would not load it). */
function lineShape(raw) {
  if (/^﻿/.test(raw)) return 'bom'
  if (/^\s+\S/.test(raw)) return 'leading-whitespace'
  if (/^\s*export\s+/.test(raw)) return 'export-prefix'
  if (/^[A-Z_][A-Z0-9_]*\s+=/.test(raw)) return 'space-before-equals'
  if (/^[A-Z_][A-Z0-9_]*=/.test(raw)) return 'canonical'
  return 'other'
}
/** All raw lines that a LENIENT reader would attribute to `key` (commented lines excluded). */
function occurrencesOf(txt, key) {
  const res = []
  txt.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.replace(/^﻿/, '').trim()
    if (!t || t.startsWith('#')) return
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (m && m[1] === key) res.push({ line: i + 1, shape: lineShape(raw), runtimeLoadable: /^([A-Z_][A-Z0-9_]*)=(.*)$/.test(raw) })
  })
  return res
}
function diagnoseKey(txt, key) {
  const rt = parseEnvRuntime(txt)[key]
  const le = parseEnvLenient(txt)[key]
  const occ = occurrencesOf(txt, key)
  const agree = (rt === undefined && le === undefined) || (rt !== undefined && le !== undefined && rt.value === le.value)
  return { key, runtime: rt && rt.value, lenient: le && le.value, occurrences: occ, agree }
}
function describeDiag(d) {
  const occ = d.occurrences.length
    ? d.occurrences.map((o) => 'L' + o.line + ':' + o.shape + (o.runtimeLoadable ? '' : '(NOT runtime-loadable)')).join(', ')
    : 'no line'
  return 'runtime=' + showVal(d.key, d.runtime) + ' · lenient=' + showVal(d.key, d.lenient) + ' · ' + (d.agree ? 'AGREE' : 'DIVERGE') + ' · lines: ' + occ
}

/** Rewrite .env.local: for each key in `writes`, the FIRST lenient occurrence becomes the
 *  CANONICAL line `KEY=value`; every later occurrence of that key is neutralised as a comment
 *  (recoverable, and both parsers then agree). Missing keys are appended. Every other line is
 *  kept byte-for-byte. Returns { text, changes }. */
function rewriteEnv(txt, writes, stamp) {
  const eol = txt.includes('\r\n') ? '\r\n' : '\n'
  const lines = txt.split(/\r?\n/)
  const before = parseEnvLenient(txt)
  const seen = new Set()
  const changes = []
  const dupes = {}
  const out = lines.map((raw) => {
    const t = raw.replace(/^﻿/, '').trim()
    if (!t || t.startsWith('#')) return raw
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!m || !(m[1] in writes)) return raw
    const key = m[1]
    if (seen.has(key)) {
      dupes[key] = (dupes[key] || 0) + 1
      return '# phase2-v3 ' + stamp + ' duplicate neutralised: ' + raw.replace(/^﻿/, '')
    }
    seen.add(key)
    const canonical = key + '=' + writes[key]
    if (raw !== canonical) {
      const was = before[key] ? before[key].value : undefined
      changes.push(key + ': ' + (was === writes[key] ? 'line normalised (' + lineShape(raw) + ' → canonical, value unchanged)' : showVal(key, was) + ' → ' + showVal(key, writes[key])))
    }
    return canonical
  })
  for (const k of Object.keys(dupes)) changes.push(k + ': ' + dupes[k] + ' duplicate line(s) neutralised as comments')
  for (const k of Object.keys(writes)) {
    if (seen.has(k)) continue
    if (out.length && out[out.length - 1] !== '') out.push('')
    out.push('# Phase 2 preflight v3 (' + stamp + ') — ' + k)
    out.push(k + '=' + writes[k])
    changes.push(k + ': ABSENT → ' + showVal(k, writes[k]))
  }
  let text = out.join(eol)
  if (!text.endsWith(eol)) text += eol
  return { text, changes }
}

// ── Live probes (READ-ONLY, unauthenticated, no secret) ─────────────────────────
async function httpJson(url, init) {
  const res = await fetch(url, Object.assign({ redirect: 'manual' }, init || {}))
  let body = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}
/** Observe the RUNNING process (never the file):
 *  refundFlag — POST /api/admin/refunds/run with an empty body and NO credentials. The route
 *  checks the REFUNDS_ENABLED kill-switch BEFORE auth: 403 {gated:true} ⇒ the process reads it
 *  false ; 401 ⇒ the process reads it TRUE (auth then refuses — nothing is executed, nothing
 *  written, no refund can result from an unauthenticated call). */
async function probeRuntime(base) {
  const ua = { 'User-Agent': 'grubano-phase2-preflight/3' }
  const out = { refundFlag: 'unknown', refundStatus: 0, eat: 0, restaurants: 0, restaurantId: null, tips: 'unknown', signupOpen: 'unknown', signupStatus: 0, errors: [] }
  try {
    const r = await httpJson(base + '/api/admin/refunds/run', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ua), body: '{}' })
    out.refundStatus = r.status
    out.refundFlag = r.status === 403 && r.body && r.body.gated === true ? 'false' : (r.status === 401 ? 'true' : 'unknown')
  } catch (e) { out.errors.push('refund-probe: ' + e.message) }
  try {
    const r = await fetch(base + '/fr/eat', { headers: ua, redirect: 'manual' }); out.eat = r.status
    try { await r.arrayBuffer() } catch { /* drain */ }
  } catch (e) { out.errors.push('eat: ' + e.message) }
  try {
    const r = await httpJson(base + '/api/restaurants?take=1', { headers: ua }); out.restaurants = r.status
    const arr = r.body && (Array.isArray(r.body) ? r.body : (r.body.restaurants || r.body.items || []))
    if (Array.isArray(arr) && arr[0] && arr[0].id) out.restaurantId = String(arr[0].id)
  } catch (e) { out.errors.push('restaurants: ' + e.message) }
  if (out.restaurantId) {
    try {
      const r = await httpJson(base + '/api/restaurants/' + encodeURIComponent(out.restaurantId), { headers: ua })
      if (r.status === 200 && r.body && typeof r.body.tipsEnabled === 'boolean') out.tips = String(r.body.tipsEnabled)
    } catch (e) { out.errors.push('tips: ' + e.message) }
  }
  try {
    const r = await fetch(base + '/fr/business/logistics', { headers: ua, redirect: 'manual' })
    out.signupStatus = r.status
    out.signupOpen = r.status === 200 ? 'true' : (r.status === 404 ? 'false' : 'unknown')
    try { await r.arrayBuffer() } catch { /* drain */ }
  } catch (e) { out.errors.push('signup: ' + e.message) }
  return out
}
const probeLine = (p) => 'refunds(process)=' + p.refundFlag + '[' + p.refundStatus + '] · /fr/eat=' + p.eat + ' · /api/restaurants=' + p.restaurants + ' · tipsEnabled(process)=' + p.tips + ' · signup(process)=' + p.signupOpen + '[' + p.signupStatus + ']' + (p.errors.length ? ' · errors: ' + p.errors.join('; ') : '')
function probeMatches(p, expect) {
  return p.eat === 200 && p.restaurants === 200 && p.refundFlag === 'false' &&
    p.signupOpen === (expect.signupOpen ? 'true' : 'false') && p.tips === (expect.tips ? 'true' : 'false')
}
async function waitForReload(base, expect, deadlineMs, intervalMs) {
  const t0 = Date.now()
  let last = null, n = 0
  while (Date.now() - t0 < deadlineMs) {
    n++
    last = await probeRuntime(base)
    if (probeMatches(last, expect)) return { reloaded: true, elapsedMs: Date.now() - t0, probes: n, last }
    await sleep(intervalMs)
  }
  return { reloaded: false, elapsedMs: Date.now() - t0, probes: n, last }
}
function listAppProcesses() {
  try {
    const me = execSync('id -un', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const raw = execSync('ps -o pid=,etimes=,lstart=,args= -u ' + me, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const rows = raw.split('\n').map((l) => l.trim()).filter((l) => /server\.js|app\.grubano\.com/.test(l) && !/phase2-preflight|ps -o/.test(l))
    return rows.length ? rows.map((l) => l.replace(/\s+/g, ' ').slice(0, 110)).join(' | ') : 'no app process visible to this user'
  } catch { return 'NOT MEASURED (ps unavailable)' }
}
async function ledgerCheck(base, token, from, to) {
  const url = base + '/api/admin/ledger/check?from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString())
  const res = await fetch(url, { headers: { 'X-Internal-Token': token, 'User-Agent': 'grubano-phase2-preflight/3' }, redirect: 'manual' })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
function envHistory(appRoot) {
  const rows = []
  try {
    const names = fs.readdirSync(appRoot).filter((n) => /^\.env\.local\.bak/.test(n)).sort()
    for (const n of names) {
      const p = path.join(appRoot, n)
      let txt = ''
      try { txt = fs.readFileSync(p, 'utf8') } catch { continue }
      const rt = parseEnvRuntime(txt), le = parseEnvLenient(txt)
      const mt = fs.statSync(p).mtime.toISOString()
      const cells = ['TIPS_ENABLED', 'REFUNDS_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'ALERT_EMAIL'].map((k) => k + '=' + (rt[k] ? rt[k].value : 'ABSENT') + (le[k] && (!rt[k] || le[k].value !== rt[k].value) ? '(lenient:' + le[k].value + ')' : ''))
      rows.push(n + ' [' + mt + '] ' + cells.join(' '))
    }
  } catch { /* optional */ }
  return rows
}

// ── MAIN ────────────────────────────────────────────────────────────────────────
async function main() {
  // ── 1. ENV ────────────────────────────────────────────────────────────────
  console.log('[1/11] env')
  const envFile = path.join(APP_ROOT, '.env.local')
  const schemaPath = path.join(APP_ROOT, 'prisma', 'schema.prisma')
  const webhookBuilt = path.join(APP_ROOT, '.next', 'server', 'app', 'api', 'webhooks', 'stripe', 'route.js')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT, 'run from the deployed app (~/app.grubano.com)')
  if (!fs.existsSync(schemaPath)) return fail('1 env: prisma/schema.prisma not found')
  if (!fs.existsSync(webhookBuilt)) return fail('1 env: compiled webhook route not found (' + path.relative(APP_ROOT, webhookBuilt) + ')')
  const built = fs.readFileSync(webhookBuilt, 'utf8')
  if (!built.includes('refund.updated') || !built.includes('refund.failed')) return fail('1 env: deployed build lacks the Phase 2 refund status branch', 'deploy Phase 2 first')
  if (!built.includes('refund_without_reverse_transfer')) return fail('1 env: deployed build lacks the F2 hardening marker (refund_without_reverse_transfer)', 'deploy the final hardening first')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  for (const f of ['recoveryOffsetPoints', 'sourceEventId', 'royaltyClawbackCents']) {
    if (!schema.includes(f)) return fail('1 env: deployed schema lacks ' + f)
  }
  let version = 'unknown'
  try { version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public', 'version.json'), 'utf8')).shortCommit || 'unknown' } catch { /* optional */ }
  const originalTxt = fs.readFileSync(envFile, 'utf8')
  const rt0 = parseEnvRuntime(originalTxt)
  const val = (k) => (rt0[k] ? rt0[k].value : undefined)
  const dbUrl = val('DATABASE_URL') || ''
  const dbName = (dbUrl.match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (!dbUrl) return fail('1 env: DATABASE_URL absent (runtime parse)')
  if (/prod/i.test(dbName)) return fail('1 env: DATABASE_URL points at a PROD-named database (' + dbName + ')', 'refusing — staging only')
  const nextauthUrl = (val('NEXTAUTH_URL') || '').replace(/\/$/, '')
  if (!/app\.grubano\.com/.test(nextauthUrl)) return fail('1 env: NEXTAUTH_URL is not the staging origin (' + nextauthUrl + ')', 'refusing — staging only')
  const stripeKey = val('STRIPE_SECRET_KEY') || ''
  const stripeMode = stripeKey.startsWith('sk_test_') ? 'TEST' : (stripeKey.startsWith('sk_live_') ? 'LIVE' : 'ABSENT/UNKNOWN')
  if (stripeMode !== 'TEST') return fail('1 env: Stripe key mode is ' + stripeMode, 'refusing — TEST only')
  const base = (process.env.PHASE2_BASE_URL || nextauthUrl).replace(/\/$/, '')
  F('SOURCE', 'staging server ' + APP_ROOT + ' (.env.local + DB + compiled build + live routes)')
  F('DEPLOYED SHA (public/version.json)', version)
  F('PHASE 2 BUILD MARKERS', 'PRESENT (refund status branch + F2 hardening)')
  F('DATABASE', dbName + ' (staging-named)')
  F('NEXTAUTH_URL', nextauthUrl + (base !== nextauthUrl ? ' (probe base overridden: ' + base + ')' : ''))
  F('STRIPE_SECRET_KEY mode', stripeMode)
  F('STRIPE_WEBHOOK_SECRET present', String(!!val('STRIPE_WEBHOOK_SECRET')))
  F('SMTP_HOST', val('SMTP_HOST') || 'ABSENT (default mail.grubano.com)')
  F('SMTP_USER / SMTP_PASS present', !!val('SMTP_USER') + ' / ' + !!val('SMTP_PASS'))
  F('ENV FILE', originalTxt.length + ' bytes, ' + originalTxt.split(/\r?\n/).length + ' lines, BOM=' + /^﻿/.test(originalTxt) + ', CRLF=' + originalTxt.includes('\r\n'))
  const diag0 = {}
  for (const k of WATCHED_KEYS) { diag0[k] = diagnoseKey(originalTxt, k); F('KEY BEFORE ' + k, describeDiag(diag0[k])) }
  const hist = envHistory(APP_ROOT)
  F('ENV BACKUP HISTORY (watched keys, runtime parse; lenient shown when it diverges)', hist.length ? hist.join(' || ') : 'no .env.local.bak* file')

  // Live process BEFORE anything (measured, read-only).
  const before = await probeRuntime(base)
  F('RUNTIME BEFORE (live process, measured)', probeLine(before))

  // ── 2. BACKUP ─────────────────────────────────────────────────────────────
  console.log('[2/11] backup')
  const stampIso = new Date().toISOString()
  const stamp = stampIso.replace(/[:.]/g, '-')
  const backup = envFile + '.bak-phase2-' + stamp
  fs.copyFileSync(envFile, backup)
  try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
  if (fs.readFileSync(backup, 'utf8') !== originalTxt) return fail('2 backup: backup content mismatch')
  F('ENV BACKUP', path.basename(backup) + ' (mode 600, ' + originalTxt.length + ' bytes)')

  // ── 3. MAIL — decides the FINAL alert mailbox, BEFORE the write ───────────
  console.log('[3/11] test alert → ' + TARGET_ALERT)
  let finalAlert = TARGET_ALERT
  let nodemailer = null
  try { nodemailer = require(require.resolve('nodemailer', { paths: [APP_ROOT] })) } catch { A('3 mail: nodemailer not resolvable from ' + APP_ROOT) }
  if (nodemailer && !val('SMTP_PASS')) A('3 mail: SMTP_PASS absent (runtime parse) — no test alert sent')
  const smtpHost = val('SMTP_HOST') || 'mail.grubano.com'
  const sendTest = async (to) => {
    const transporter = nodemailer.createTransport({ host: smtpHost, port: 587, secure: false, auth: { user: val('SMTP_USER') || 'contact@grubano.com', pass: val('SMTP_PASS') } })
    return transporter.sendMail({
      from: '"Grubano" <contact@grubano.com>',
      to,
      subject: '[Grubano] MONEY REVIEW — TEST préflight Phase 2 v3 (aucun argent) ' + stampIso.slice(0, 16),
      html: '<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">'
        + '<h2 style="font-size:17px">Test du canal MONEY REVIEW (staging)</h2>'
        + '<p>E-mail de TEST envoyé par l’opérateur de préflight Phase 2 v3. <b>Aucun remboursement, aucun mouvement d’argent, aucune modification de données.</b></p>'
        + '<p style="font-size:13px;color:#6b7280">Horodatage : ' + stampIso + ' · Build : ' + version + ' · Destination : ' + to + '</p></div>',
    })
  }
  if (nodemailer && val('SMTP_PASS')) {
    try {
      const info = await sendTest(TARGET_ALERT)
      F('TEST ALERT to ' + TARGET_ALERT + ' accepted / rejected (provider)', JSON.stringify(info.accepted || []) + ' / ' + JSON.stringify(info.rejected || []))
      F('TEST ALERT provider response', String(info.response || '').slice(0, 120))
      F('TEST ALERT messageId', String(info.messageId || ''))
      if (!info.accepted || !info.accepted.includes(TARGET_ALERT)) {
        A('3 mail: provider did not accept ' + TARGET_ALERT + ' (explicit RCPT rejection) → falling back to ' + FALLBACK_ALERT)
        finalAlert = FALLBACK_ALERT
        try {
          const info2 = await sendTest(FALLBACK_ALERT)
          F('TEST ALERT to ' + FALLBACK_ALERT + ' accepted / rejected (provider)', JSON.stringify(info2.accepted || []) + ' / ' + JSON.stringify(info2.rejected || []))
          if (!info2.accepted || !info2.accepted.includes(FALLBACK_ALERT)) A('3 mail: provider did not accept the fallback either')
        } catch (e2) { A('3 mail: fallback send failed — ' + String(e2 && e2.message ? e2.message : e2).slice(0, 160)) }
      } else {
        F('MAILBOX EXISTS (MX grubano.com = ' + smtpHost + ', local RCPT accepted)', 'YES for ' + TARGET_ALERT)
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      const rcptRejected = /55[03]|No Such User|recipient/i.test(msg) && !/ECONN|ETIMEDOUT|EAI_AGAIN|auth/i.test(msg)
      if (rcptRejected) {
        A('3 mail: RCPT rejected for ' + TARGET_ALERT + ' (' + msg.slice(0, 120) + ') → falling back to ' + FALLBACK_ALERT)
        finalAlert = FALLBACK_ALERT
      } else {
        A('3 mail: send failed (connectivity/auth — not a mailbox rejection): ' + msg.slice(0, 160) + ' — keeping ' + TARGET_ALERT + ' (founder policy)')
      }
    }
  }
  F('TEST ALERT inbox receipt', 'NOT MEASURED (human confirmation optional)')
  F('ALERT_EMAIL FINAL (decided)', finalAlert)

  // ── 4. WRITE ──────────────────────────────────────────────────────────────
  console.log('[4/11] write')
  const writes = {
    REFUNDS_ENABLED:          'false',
    LOGISTICS_SIGNUP_ENABLED: 'true',
    ALERT_EMAIL:              finalAlert,
  }
  // TIPS_ENABLED: only if the RUNTIME would load it as true while the payout rail is not on.
  const tipsRuntimeTrue = val('TIPS_ENABLED') === 'true'
  const payoutRuntimeTrue = val('LOGISTICS_PAYOUT_ENABLED') === 'true'
  if (tipsRuntimeTrue && !payoutRuntimeTrue) {
    writes.TIPS_ENABLED = 'false'
    F('TIPS_ENABLED DECISION', 'SET false — runtime-loadable true while LOGISTICS_PAYOUT_ENABLED is ' + eff(val('LOGISTICS_PAYOUT_ENABLED')) + ' (coupling rule scripts/check-flags.mjs: held third-party funds D-1; beta runbook: TIPS OFF; live process measured tipsEnabled=' + before.tips + ' → a restart would ACTIVATE the courier-tip charge on pickup orders)')
  } else if (tipsRuntimeTrue && payoutRuntimeTrue) {
    F('TIPS_ENABLED DECISION', 'UNCHANGED (runtime true AND payout rail true) — FOUNDER DECISION REQUIRED')
  } else {
    F('TIPS_ENABLED DECISION', 'UNCHANGED — runtime parse ' + eff(val('TIPS_ENABLED')) + (diag0.TIPS_ENABLED.agree ? '' : ' (lenient parse says ' + showVal('TIPS_ENABLED', diag0.TIPS_ENABLED.lenient) + ' — line NOT runtime-loadable; founder may clean it)'))
  }
  // INTERNAL_CRON_TOKEN: normalise the line ONLY if it exists exactly once and the runtime cannot load it.
  const tokDiag = diag0.INTERNAL_CRON_TOKEN
  if (tokDiag.runtime === undefined && tokDiag.lenient !== undefined && tokDiag.occurrences.length === 1) {
    writes.INTERNAL_CRON_TOKEN = tokDiag.lenient
    F('INTERNAL_CRON_TOKEN DECISION', 'line normalised to canonical shape (was ' + tokDiag.occurrences[0].shape + ', NOT runtime-loadable → the process had NO token → 401 root cause) — value unchanged, never printed')
  } else if (tokDiag.runtime === undefined) {
    F('INTERNAL_CRON_TOKEN DECISION', 'NOT loadable by the runtime and ' + (tokDiag.lenient === undefined ? 'absent' : tokDiag.occurrences.length + ' lines') + ' — not rewritten (founder decision)')
  } else if (!tokDiag.agree) {
    F('INTERNAL_CRON_TOKEN DECISION', 'runtime and lenient parses DIVERGE (' + tokDiag.occurrences.length + ' lines) — the runtime value (first canonical line) is what the route compares; duplicates NOT touched (founder decision)')
  } else {
    F('INTERNAL_CRON_TOKEN DECISION', 'canonical, runtime-loadable — unchanged')
  }
  const { text, changes } = rewriteEnv(originalTxt, writes, stampIso.slice(0, 10))
  let envChanged = false
  if (changes.length === 0) {
    F('ENV WRITE', 'NO CHANGE NEEDED (every target key already canonical at its value)')
  } else {
    fs.writeFileSync(envFile, text, { mode: 0o600 })
    try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
    envChanged = true
    F('ENV WRITE', changes.join(' ; '))
  }
  const afterTxt = fs.readFileSync(envFile, 'utf8')
  const rtA = parseEnvRuntime(afterTxt), leA = parseEnvLenient(afterTxt)
  const restoreHint = 'restore from ' + path.basename(backup) + ' (cp) — restart NOT touched'
  for (const [k, v] of Object.entries(writes)) {
    if (!rtA[k] || rtA[k].value !== v) return fail('4 write: runtime re-read ' + k + ' = ' + showVal(k, rtA[k] && rtA[k].value) + ' (expected ' + showVal(k, v) + ')', restoreHint)
    if (!leA[k] || leA[k].value !== v) return fail('4 write: lenient re-read ' + k + ' = ' + showVal(k, leA[k] && leA[k].value) + ' (expected ' + showVal(k, v) + ')', restoreHint)
  }
  const le0 = parseEnvLenient(originalTxt)
  for (const k of Object.keys(rt0)) {
    if (k in writes) continue
    if (!rtA[k] || rtA[k].value !== rt0[k].value) return fail('4 write: unrelated key ' + k + ' changed (runtime parse)', restoreHint)
  }
  for (const k of Object.keys(le0)) {
    if (k in writes) continue
    if (!leA[k] || leA[k].value !== le0[k].value) return fail('4 write: unrelated key ' + k + ' changed (lenient parse)', restoreHint)
  }
  const preserved = Object.keys(rt0).filter((k) => !(k in writes)).length
  F('UNRELATED ENV KEYS PRESERVED', 'YES (' + preserved + ' keys byte-identical under both parsers)')
  for (const k of WATCHED_KEYS) F('KEY AFTER ' + k, describeDiag(diagnoseKey(afterTxt, k)))
  F('REFUNDS_ENABLED AFTER (file, runtime parse)', eff(rtA.REFUNDS_ENABLED && rtA.REFUNDS_ENABLED.value))
  F('LOGISTICS_SIGNUP_ENABLED AFTER (file, runtime parse)', eff(rtA.LOGISTICS_SIGNUP_ENABLED && rtA.LOGISTICS_SIGNUP_ENABLED.value))
  F('LOGISTICS_COURIER_ACTIVATION_ENABLED AFTER (file, runtime parse — NEVER written)', eff(rtA.LOGISTICS_COURIER_ACTIVATION_ENABLED && rtA.LOGISTICS_COURIER_ACTIVATION_ENABLED.value))
  F('ALERT_EMAIL AFTER (file, runtime parse)', rtA.ALERT_EMAIL ? rtA.ALERT_EMAIL.value : 'ABSENT')
  F('TIPS_ENABLED AFTER (file, runtime parse)', eff(rtA.TIPS_ENABLED && rtA.TIPS_ENABLED.value))
  for (const [k, v] of Object.entries(rtA)) if (process.env[k] === undefined) process.env[k] = v.value

  // ── 5. FLAGS (runtime parse of the re-read file) — restart refused on any money flag ─
  console.log('[5/11] flags')
  const flag = (k) => (rtA[k] ? rtA[k].value : undefined)
  for (const k of FLAGS_TO_PRINT) F('FLAG ' + k + ' (file, runtime parse)', eff(flag(k)))
  for (const k of MONEY_FLAGS_MUST_BE_FALSE) {
    if (flag(k) === 'true') {
      fs.copyFileSync(backup, envFile)
      return fail('5 flags: ' + k + ' is TRUE after the write — env RESTORED from ' + path.basename(backup) + ', restart REFUSED', 'human decision required')
    }
  }
  if (flag('LOGISTICS_SIGNUP_ENABLED') === 'true' && flag('RATE_LIMIT_ENABLED') !== 'true') {
    F('NOTE RATE_LIMIT_ENABLED', 'effective false while the public courier signup is open — docs/ops/flags.md recommends enabling it together (FOUNDER DECISION, not written)')
  }
  const expect = { signupOpen: true, tips: flag('TIPS_ENABLED') === 'true' }
  F('EXPECTED RUNTIME AFTER RESTART', 'refunds(process)=false · signup(process)=true · tipsEnabled(process)=' + expect.tips)

  // ── 6. RESTART — BEFORE any read-only check can abort ─────────────────────
  console.log('[6/11] restart + reload proof (deadline ' + Math.round(RELOAD_DEADLINE_MS / 1000) + ' s)')
  F('APP PROCESSES BEFORE RESTART (ps, best-effort)', listAppProcesses())
  let restartAt
  try {
    fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
    restartAt = new Date()
    fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), 'phase2-preflight v3 ' + restartAt.toISOString())
    F('PASSENGER RESTART', 'TOUCHED tmp/restart.txt at ' + restartAt.toISOString() + (envChanged ? ' (env changed)' : ' (env unchanged — touched anyway: the process was measured stale)'))
  } catch (e) {
    return fail('6 restart: could not touch tmp/restart.txt (' + String(e.message || e).slice(0, 100) + ')', 'env is written; touch tmp/restart.txt manually then re-run')
  }
  await sleep(3000)
  const reload = await waitForReload(base, expect, RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
  F('RUNTIME AFTER RESTART (live process, measured)', probeLine(reload.last))
  F('APP PROCESSES AFTER RESTART (ps, best-effort)', listAppProcesses())
  if (reload.reloaded) {
    F('PROCESS RELOAD PROVEN', 'YES — the live routes match the written file after ' + Math.round(reload.elapsedMs / 1000) + ' s / ' + reload.probes + ' probe(s)')
    F('DIRECT PROCESS FLAG OBSERVATION REFUNDS_ENABLED', 'YES — POST /api/admin/refunds/run (no credentials) → 403 {gated:true} = the process reads REFUNDS_ENABLED false (gate is evaluated before auth)')
  } else {
    A('6 restart: the live process did NOT match the written file within ' + Math.round(reload.elapsedMs / 1000) + ' s — last: ' + probeLine(reload.last))
  }

  // ── 7. HEALTH — fresh responses, no restart loop ──────────────────────────
  console.log('[7/11] health')
  const healthRuns = []
  for (let i = 0; i < 3; i++) { healthRuns.push(await probeRuntime(base)); if (i < 2) await sleep(4000) }
  const stable = healthRuns.every((p) => p.eat === 200 && p.restaurants === 200 && p.refundFlag === reload.last.refundFlag && p.signupOpen === reload.last.signupOpen && p.tips === reload.last.tips)
  const any5xx = healthRuns.some((p) => [p.eat, p.restaurants, p.refundStatus, p.signupStatus].some((s) => s >= 500))
  F('HEALTH ×3 (12 s)', healthRuns.map(probeLine).join(' || '))
  F('HEALTH VERDICT', (stable && !any5xx) ? 'STABLE, no 5xx, DB-backed JSON served' : 'UNSTABLE or 5xx (see above)')
  if (!stable || any5xx) A('7 health: unstable or 5xx after restart')

  // ── 8–10. DB (READ-ONLY) ──────────────────────────────────────────────────
  let PrismaClient = null
  try { ({ PrismaClient } = require(require.resolve('@prisma/client', { paths: [APP_ROOT] }))) } catch { A('8 db: @prisma/client not resolvable from ' + APP_ROOT + ' — DB facts NOT MEASURED (env written, restart done)') }
  const prisma = PrismaClient ? new PrismaClient() : null
  if (prisma) try {
    console.log('[8/11] no unexpected refund (window since ' + WINDOW_START.toISOString().slice(0, 10) + ')')
    const [refundCount, refundsInWindow, auditRuns, ledgerRefunds] = await Promise.all([
      prisma.refund.count(),
      prisma.refund.findMany({ where: { createdAt: { gte: WINDOW_START } }, select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true } }),
      prisma.adminAuditLog.findMany({ where: { action: 'refund.run', createdAt: { gte: WINDOW_START } }, select: { targetId: true, createdAt: true, actorId: true } }).catch(() => null),
      prisma.ledgerEntry.findMany({ where: { type: 'refund', createdAt: { gte: WINDOW_START } }, select: { sourceEventId: true, grossAmount: true, createdAt: true } }),
    ])
    F('DB Refund rows (all time)', String(refundCount))
    F('DB Refund rows since window start', refundsInWindow.length ? refundsInWindow.map((r) => r.createdAt.toISOString().slice(0, 10) + ':' + r.status + ':' + r.amountCents + ':order…' + r.orderId.slice(-6) + ':' + mask(r.stripeRefundId)).join(' | ') : 'none')
    F('DB AdminAuditLog refund.run since window start', auditRuns === null ? 'n/a (table/field unavailable)' : (auditRuns.length ? auditRuns.map((a) => a.createdAt.toISOString().slice(0, 16) + ':' + a.actorId + ':order…' + String(a.targetId || '').slice(-6)).join(' | ') : 'none'))
    F('DB ledger refund lines since window start', ledgerRefunds.length ? ledgerRefunds.map((l) => l.createdAt.toISOString().slice(0, 10) + ':' + mask(l.sourceEventId) + ':' + l.grossAmount).join(' | ') : 'none')
    const unexpected = refundsInWindow.filter((r) => !(r.amountCents === 1450 && r.createdAt.toISOString().startsWith('2026-08-29')))
    F('UNEXPECTED REFUND DURING TRUE-FLAG WINDOW (DB)', unexpected.length === 0 ? 'NO' : 'YES — ' + unexpected.length + ' row(s) (see above)')
    if (unexpected.length) A('8 refunds: unexpected Refund row(s) in the true-flag window — HARD STOP, reconcile before continuing')

    console.log('[9/11] order GR-' + ORDER_ID.slice(-6).toUpperCase())
    const order = await prisma.order.findUnique({
      where: { id: ORDER_ID },
      select: { id: true, restaurantId: true, consumerId: true, status: true, paymentStatus: true, subtotal: true, deliveryFee: true, total: true, pointsEarned: true, pointsRedeemed: true, loyaltyCreditCents: true, pointOfSaleId: true, stripePaymentIntentId: true, createdAt: true },
    })
    if (!order) { A('9 order: ' + ORDER_ID + ' not found on staging') } else {
      const resto = await prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true, stripeAccountStatus: true, stripeAccountId: true } })
      F('ORDER ref (DB)', 'GR-' + order.id.slice(-6).toUpperCase() + ' (id …' + order.id.slice(-8) + ')')
      F('ORDER createdAt (DB)', order.createdAt.toISOString())
      F('ORDER status / paymentStatus (DB)', order.status + ' / ' + order.paymentStatus)
      F('ORDER restaurant (DB)', (resto ? resto.name : 'unknown') + ' · connect=' + (resto ? resto.stripeAccountStatus : 'n/a') + ' · acct=' + mask(resto && resto.stripeAccountId))
      F('ORDER subtotal / deliveryFee / total € (DB)', order.subtotal + ' / ' + order.deliveryFee + ' / ' + order.total)
      F('ORDER pointsRedeemed / loyaltyCreditCents / pointsEarned (DB)', order.pointsRedeemed + ' / ' + order.loyaltyCreditCents + ' / ' + order.pointsEarned)
      F('ORDER pointOfSaleId (DB)', order.pointOfSaleId || 'null')
      F('ORDER PI (DB)', mask(order.stripePaymentIntentId))
      if (order.paymentStatus !== 'paid') A('9 order: paymentStatus is ' + order.paymentStatus + ' (expected paid)')
      if (!order.stripePaymentIntentId) A('9 order: no stripePaymentIntentId')
      const lts = await prisma.loyaltyTransaction.findMany({ where: { orderId: order.id }, select: { type: true, points: true, sourceEventId: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
      F('LOYALTY rows for order (DB)', lts.length ? lts.map((t) => t.type + ':' + t.points + (t.sourceEventId ? '(' + mask(t.sourceEventId) + ')' : '')).join(', ') : 'none')
      const refundRows = await prisma.refund.findMany({ where: { orderId: order.id }, select: { status: true, amountCents: true, stripeRefundId: true } })
      F('REFUND rows for order (DB)', refundRows.length ? refundRows.map((r) => r.status + ':' + r.amountCents + ':' + mask(r.stripeRefundId)).join(', ') : 'none')
      const ledger = order.stripePaymentIntentId ? await prisma.ledgerEntry.findMany({ where: { stripePaymentIntentId: order.stripePaymentIntentId }, select: { type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, stripeFeeAmount: true, routed: true }, orderBy: { createdAt: 'asc' } }) : []
      F('LEDGER lines for PI (DB)', ledger.length ? ledger.map((l) => l.type + '{gross ' + l.grossAmount + ', fee ' + l.applicationFeeAmount + ', net ' + l.netToRestaurant + ', stripeFee ' + l.stripeFeeAmount + ', routed ' + l.routed + '}').join(' ; ') : 'none')
      const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: { royaltyCents: true, refundedCents: true, status: true } })
      F('FRANCHISE ROYALTY row for order (DB)', royalty ? JSON.stringify(royalty) : 'none (standard restaurant)')
      try {
        const op = await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
        const lc = op ? await prisma.loyaltyCustomer.findUnique({ where: { email: op.email }, select: { pointsBalance: true, recoveryOffsetPoints: true } }) : null
        F('LOYALTY customer (DB)', lc ? 'pointsBalance ' + lc.pointsBalance + ', recoveryOffsetPoints ' + lc.recoveryOffsetPoints : 'none')
      } catch (e) { F('LOYALTY customer (DB)', 'n/a (' + String(e.message || e).slice(0, 60) + ')') }
      F('ORDER DISPOSABLE (paid, 0 refund rows)', refundRows.length === 0 && order.paymentStatus === 'paid' ? 'YES' : 'NO')
    }

    console.log('[10/11] franchise')
    const [royaltyCount, posCount, franchiseOps, ordersWithPos] = await Promise.all([
      prisma.franchiseRoyalty.count(),
      prisma.pointOfSale.count().catch(() => -1),
      prisma.operator.count({ where: { role: 'franchise' } }),
      prisma.order.count({ where: { pointOfSaleId: { not: null } } }),
    ])
    F('FRANCHISE royalty rows (DB)', String(royaltyCount))
    F('FRANCHISE points of sale (DB)', String(posCount))
    F('FRANCHISE operators role=franchise (DB)', String(franchiseOps))
    F('ORDERS attached to a POS (DB)', String(ordersWithPos))
    F('FRANCHISE_ENABLED effective (file, runtime parse)', flag('FRANCHISE_ENABLED') === 'true' ? 'ON' : 'OFF')
  } catch (e) {
    A('8-10 db: ' + String(e && e.message ? e.message : e).slice(0, 200))
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
  // The FAIL verdict must never let a step-8 refusal go unnoticed: a done() above returns
  // only from fail(); every other anomaly is listed in the final block.

  // ── 11. LEDGER CHECK (READ-ONLY route) — token exactly as the RUNTIME loads it ─
  console.log('[11/11] ledger check')
  const tok = rtA.INTERNAL_CRON_TOKEN ? rtA.INTERNAL_CRON_TOKEN.value : ''
  F('INTERNAL_CRON_TOKEN (runtime parse of the written file)', tok ? 'present (' + tok.length + ' chars, canonical line L' + rtA.INTERNAL_CRON_TOKEN.line + ')' : 'ABSENT for the runtime')
  if (!tok) {
    A('11 ledger: INTERNAL_CRON_TOKEN not loadable by the runtime parser — the route can only answer 401 (auth falls through to the session gate); ledger check NOT RUN')
  } else {
    const to = new Date(), from = new Date(to.getTime() - 7 * 24 * 3600 * 1000)
    try {
      const r = await ledgerCheck(base, tok, from, to)
      F('LEDGER CHECK http', String(r.status))
      if (r.status === 200) {
        F('LEDGER CHECK ok / internalOk / refundsOk', r.body.ok + ' / ' + r.body.internalOk + ' / ' + r.body.refundsOk)
        F('LEDGER CHECK ledgerCount / stripeCount', r.body.ledgerCount + ' / ' + r.body.stripeCount)
        F('LEDGER CHECK ledgerSum / stripeSum', r.body.ledgerSum + ' / ' + r.body.stripeSum)
        F('LEDGER CHECK ecarts', JSON.stringify(r.body.ecarts || []).slice(0, 300))
        F('LEDGER CHECK refunds', JSON.stringify(r.body.refunds || {}).slice(0, 200))
      } else if (r.status === 401) {
        A('11 ledger: HTTP 401 with the runtime-parsed token AFTER a proven reload → the running process compares a different INTERNAL_CRON_TOKEN than the file line the runtime parser selects (' + (reload.reloaded ? 'reload PROVEN' : 'reload NOT proven') + ') — escalate: route-level investigation, no auth change')
      } else {
        A('11 ledger: HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160))
      }
    } catch (e) {
      A('11 ledger: request failed — ' + String(e && e.message ? e.message : e).slice(0, 160))
    }
  }

  return anomalies.length ? done('FAIL', anomalies[0].split(':')[0]) : done('PASS')
}

module.exports = { parseEnvRuntime, parseEnvLenient, lineShape, occurrencesOf, diagnoseKey, describeDiag, rewriteEnv, probeRuntime, probeMatches, waitForReload, ledgerCheck, envHistory }

if (require.main === module) {
  main().catch((e) => fail('unexpected: ' + String(e && e.message ? e.message : e).slice(0, 200)))
}
