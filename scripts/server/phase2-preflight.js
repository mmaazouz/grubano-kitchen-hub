'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase2-preflight.js — PHASE 2 FINAL FINANCIAL RECONCILIATION (staging, one-shot, v5)
   LEDGER RECONCILIATION (direct, Track A) + INTERNAL AUTH FORENSICS (Track B, document only)

   v5 (2026-09-05) — v4 did NOT find a financial mismatch: it broke its own execution
   environment (Prisma without DATABASE_URL because v4 never populated process.env; `stripe`
   not resolvable because Next bundles it into the route chunks — it is absent from the
   standalone node_modules). v5 loads the env EXACTLY like the deployed app (@next/env, present
   in the standalone runtime), hands Prisma the URL explicitly, and uses a READ-ONLY Stripe
   REST client (GET only, api.stripe.com pinned) when the SDK is absent — see
   scripts/server/reconcile-helpers.js (unit-tested). Every `not_in_stripe_window` ecart is
   classified WINDOW_EDGE_ONLY (proven: same PI, succeeded, same amount, created before the
   window) or TRUE_FINANCIAL_MISMATCH. Nothing in this operator touches .htaccess.

   Run ONCE on the staging server (cPanel Terminal), with the nodevenv node:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js

   v4 (2026-09-05) — after v3 PASSED everything except step 11: the internal HTTP ledger
   route answers 401 although .env.local carries a canonical INTERNAL_CRON_TOKEN line and
   the process reload was proven. Two INDEPENDENT tracks, two INDEPENDENT verdicts:

   TRACK A — FINANCIAL RECONCILIATION, DIRECT. The very same reconciliation the HTTP route
     runs (lib/ledger-check-core.js, shipped by the deploy) is executed HERE, on the server,
     against the staging DB + Stripe TEST — READ-ONLY. Stripe actual truth vs Grubano ledger.
     The HTTP wrapper's auth layer is not needed for the financial proof.
   TRACK B — TOKEN PROVENANCE. The DEPLOYED Passenger entry is Next's generated
     .next/standalone/server.js (the deploy copies `.next/standalone/.`; the repo-root
     server.js is NOT shipped). Env is therefore loaded by @next/env (dotenv semantics):
       files  .env.production.local › .env.local › .env.production › .env   (first file wins)
       a key ALREADY in process.env (hosting / Passenger / cPanel) is NEVER overridden
       within a file: `export K=`, leading spaces, `K = v`, quotes, `# comment` accepted;
       LAST occurrence wins.
     scripts/fix-server.js injects a preamble that snapshots process.env BEFORE Next loads
     any file and writes ~/.grubano/env-provenance.json (outside the docroot; booleans + file names only). This operator
     reads it → "INTERNAL_CRON_TOKEN PRESENT BEFORE ENV LOAD = YES/NO" and
     "hosting value == file value = YES/NO" without printing anything secret-derived.
     It also scans the hosting config files for the key NAME (presence only) and calls the
     HTTP route once (status only) as the separate HTTP-AUTH verdict.

   The v3 safety block is kept (idempotent): canonical REFUNDS_ENABLED=false,
   LOGISTICS_SIGNUP_ENABLED=true, ALERT_EMAIL, money-flag guard on the MERGED Next view, restart
   + live reload proof ONLY if something changed or the provenance file is missing/stale.

   NO refund. NO Stripe write. NO money. NO schema. NO loyalty mutation. NO secret printed
   (no value, no length, no prefix, no hash). Every printed value is MEASURED and tagged.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

// ── SHELL PRE-LOAD FACT (the terminal environment — NOT the Passenger environment) ──
const SHELL_HAS_TOKEN = typeof process.env.INTERNAL_CRON_TOKEN !== 'undefined'

const prov = require(path.join(__dirname, 'env-provenance.js'))
const H = require(path.join(__dirname, 'reconcile-helpers.js'))

const APP_ROOT       = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID       = process.env.PHASE2_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const TARGET_ALERT   = (process.env.PHASE2_ALERT_EMAIL || 'm.maazouz@grubano.com').trim()
const FALLBACK_ALERT = 'admin-qa@grubano.com'
const WINDOW_START   = new Date('2026-08-29T00:00:00Z')
const RELOAD_DEADLINE_MS = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)
const NODEVENV_ACTIVATE  = process.env.PHASE2_NODEVENV_ACTIVATE || path.join(os.homedir(), 'nodevenv', 'app.grubano.com', '24', 'bin', 'activate')

const MONEY_FLAGS_MUST_BE_FALSE = [
  'REFUNDS_ENABLED', 'CLAIMS_ENABLED', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED',
  'GHOST_ORDER_AUTO_REFUND_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED', 'TIPS_ENABLED', 'LOGISTICS_PAYOUT_ENABLED', 'DELIVERY_FULFILLMENT_ENABLED',
]
const FLAGS_TO_PRINT = [
  ...MONEY_FLAGS_MUST_BE_FALSE,
  'FRANCHISE_ENABLED', 'FRANCHISE_ROYALTY_ENABLED', 'FRANCHISE_SETTLEMENT_ENABLED',
  'LOGISTICS_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'CHARGEBACKS_ENABLED',
  'ALLOW_PLATFORM_FALLBACK', 'RATE_LIMIT_ENABLED', 'ADMIN_AUDIT_ENABLED',
]
const WATCHED_KEYS = prov.WATCHED_SECRET_KEYS
const SECRET_KEYS = new Set(['INTERNAL_CRON_TOKEN', 'CRON_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXTAUTH_SECRET', 'SMTP_USER', 'SMTP_PASS', 'DATABASE_URL', 'ANTHROPIC_API_KEY'])

const facts = []
const anomalies = []
const openItems = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (msg) => { anomalies.push(msg); console.log('  !! ANOMALY: ' + msg) }
const O = (msg) => { openItems.push(msg); console.log('  >> OPEN (not financial): ' + msg) }
const mask = (s) => (typeof s === 'string' && s.length > 8 ? s.slice(0, 4) + '***' + s.slice(-4) : (s ? '***' : 'null'))
// Non-secret values are printed only when they look like a plain flag/e-mail/short token; a
// malformed line could otherwise carry a foreign value into the output (security review F5).
const SAFE_VALUE = /^[A-Za-z0-9@._:\/-]{0,80}$/
const safeShow = (v) => (v === undefined ? 'ABSENT' : (SAFE_VALUE.test(v) ? JSON.stringify(v) : '(non-canonical value, not printed)'))
const eff = (v) => (v === undefined ? 'ABSENT → EFFECTIVE FALSE' : (v === 'true' ? 'true' : (v === 'false' ? '"false" → EFFECTIVE FALSE' : 'other(non-canonical) → EFFECTIVE FALSE')))
const showVal = (k, v) => (v === undefined ? 'ABSENT' : (SECRET_KEYS.has(k) ? '(present, not printed)' : safeShow(v)))
// SDK error messages may echo credentials (Stripe: masked key with its last 4; Prisma: DB user / URL) → scrub (F2).
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***').replace(/whsec_[A-Za-z0-9]+/g, 'whsec_***').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let financialVerdict = 'NOT MEASURED'
let httpAuthVerdict = 'NOT MEASURED'

function done(result, failedStep, action) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 PREFLIGHT v5 (staging) — every value below is MEASURED on the server')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  console.log('FINANCIAL LEDGER RECONCILIATION: ' + financialVerdict)
  console.log('INTERNAL LEDGER HTTP AUTH: ' + httpAuthVerdict)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  if (openItems.length) { console.log('OPEN NON-FINANCIAL ITEMS (' + openItems.length + '):'); for (const a of openItems) console.log('  - ' + a) }
  console.log('SAFE TO CONTINUE: ' + (result.startsWith('PASS') ? 'YES' : 'NO'))
  console.log('ACTION: ' + (action || 'PASTE THIS WHOLE OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exitCode = result.startsWith('PASS') ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step, action) => done('FAIL', step, action)

// ── Env helpers ──────────────────────────────────────────────────────────────────
/** LENIENT semantics (the v2 operator) — diagnosis only. */
function parseEnvLenient(txt) {
  const out = {}
  txt.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const k = line.indexOf('=')
    if (k <= 0) return
    let v = line.slice(k + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, k).trim()] = v
  })
  return out
}
function describeKey(k, texts) {
  const merged = prov.mergeNextEnvFiles(texts)
  const next = merged.merged[k]
  const strict = prov.parseEnvStrict(texts['.env.local'] || '')[k]
  const lenient = parseEnvLenient(texts['.env.local'] || '')[k]
  const files = merged.definedIn[k] || []
  const occ = files.map((f) => f + '×' + prov.countDotenvOccurrences(texts[f], k)).join(', ')
  const same = (a, b) => (a === undefined && b === undefined) || a === b
  return 'next(dotenv, effective)=' + showVal(k, next) + ' · definedIn: ' + (occ || 'none') +
    ' · strict(root server.js, not deployed) ' + (same(next, strict) ? 'AGREES' : 'DIVERGES') +
    ' · lenient(v2) ' + (same(next, lenient) ? 'AGREES' : 'DIVERGES')
}

/** Rewrite .env.local (v3 logic): canonical first line, later duplicates neutralised, others byte-for-byte. */
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
    if (seen.has(key)) { dupes[key] = (dupes[key] || 0) + 1; return '# phase2-v4 ' + stamp + ' duplicate neutralised: ' + raw.replace(/^﻿/, '') }
    seen.add(key)
    const canonical = key + '=' + writes[key]
    if (raw !== canonical) {
      const was = before[key]
      changes.push(key + ': ' + (was === writes[key] ? 'line normalised (value unchanged)' : showVal(key, was) + ' → ' + showVal(key, writes[key])))
    }
    return canonical
  })
  for (const k of Object.keys(dupes)) changes.push(k + ': ' + dupes[k] + ' duplicate line(s) neutralised as comments')
  for (const k of Object.keys(writes)) {
    if (seen.has(k)) continue
    if (out.length && out[out.length - 1] !== '') out.push('')
    out.push('# Phase 2 preflight v4 (' + stamp + ') — ' + k)
    out.push(k + '=' + writes[k])
    changes.push(k + ': ABSENT → ' + showVal(k, writes[k]))
  }
  let text = out.join(eol)
  if (!text.endsWith(eol)) text += eol
  return { text, changes }
}

// ── Live probes (READ-ONLY, unauthenticated) ─────────────────────────────────────
async function httpJson(url, init) {
  const res = await fetch(url, Object.assign({ redirect: 'manual' }, init || {}))
  let body = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}
async function probeRuntime(base) {
  const ua = { 'User-Agent': 'grubano-phase2-preflight/5' }
  const out = { refundFlag: 'unknown', refundStatus: 0, eat: 0, restaurants: 0, restaurantId: null, tips: 'unknown', signupOpen: 'unknown', signupStatus: 0, errors: [] }
  try {
    const r = await httpJson(base + '/api/admin/refunds/run', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ua), body: '{}' })
    out.refundStatus = r.status
    out.refundFlag = r.status === 403 && r.body && r.body.gated === true ? 'false' : (r.status === 401 ? 'true' : 'unknown')
  } catch (e) { out.errors.push('refund-probe: ' + e.message) }
  try { const r = await fetch(base + '/fr/eat', { headers: ua, redirect: 'manual' }); out.eat = r.status; try { await r.arrayBuffer() } catch { /* drain */ } } catch (e) { out.errors.push('eat: ' + e.message) }
  try {
    const r = await httpJson(base + '/api/restaurants?take=1', { headers: ua }); out.restaurants = r.status
    const arr = r.body && (Array.isArray(r.body) ? r.body : (r.body.restaurants || r.body.items || []))
    if (Array.isArray(arr) && arr[0] && arr[0].id) out.restaurantId = String(arr[0].id)
  } catch (e) { out.errors.push('restaurants: ' + e.message) }
  if (out.restaurantId) {
    try { const r = await httpJson(base + '/api/restaurants/' + encodeURIComponent(out.restaurantId), { headers: ua }); if (r.status === 200 && r.body && typeof r.body.tipsEnabled === 'boolean') out.tips = String(r.body.tipsEnabled) } catch (e) { out.errors.push('tips: ' + e.message) }
  }
  try { const r = await fetch(base + '/fr/business/logistics', { headers: ua, redirect: 'manual' }); out.signupStatus = r.status; out.signupOpen = r.status === 200 ? 'true' : (r.status === 404 ? 'false' : 'unknown'); try { await r.arrayBuffer() } catch { /* drain */ } } catch (e) { out.errors.push('signup: ' + e.message) }
  return out
}
const probeLine = (p) => 'refunds(process)=' + p.refundFlag + '[' + p.refundStatus + '] · /fr/eat=' + p.eat + ' · /api/restaurants=' + p.restaurants + ' · tipsEnabled(process)=' + p.tips + ' · signup(process)=' + p.signupOpen + '[' + p.signupStatus + ']' + (p.errors.length ? ' · errors: ' + p.errors.join('; ') : '')
function probeMatches(p, expect) {
  return p.eat === 200 && p.restaurants === 200 && p.refundFlag === 'false' && p.signupOpen === (expect.signupOpen ? 'true' : 'false') && p.tips === (expect.tips ? 'true' : 'false')
}
async function waitForReload(base, expect, deadlineMs, intervalMs) {
  const t0 = Date.now(); let last = null, n = 0
  while (Date.now() - t0 < deadlineMs) {
    n++; last = await probeRuntime(base)
    if (probeMatches(last, expect)) return { reloaded: true, elapsedMs: Date.now() - t0, probes: n, last }
    await sleep(intervalMs)
  }
  return { reloaded: false, elapsedMs: Date.now() - t0, probes: n, last }
}
async function ledgerCheckHttp(base, token, from, to) {
  const url = base + '/api/admin/ledger/check?from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString())
  const res = await fetch(url, { headers: { 'X-Internal-Token': token, 'User-Agent': 'grubano-phase2-preflight/5' }, redirect: 'manual' })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
function listAppProcesses() {
  try {
    const me = execSync('id -un', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const raw = execSync('ps -o pid=,etimes=,lstart=,args= -u ' + me, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const rows = raw.split('\n').map((l) => l.trim()).filter((l) => /server\.js|app\.grubano\.com/.test(l) && !/phase2-preflight|ps -o/.test(l))
    return rows.length ? rows.map((l) => l.replace(/\s+/g, ' ').slice(0, 110)).join(' | ') : 'no app process visible to this user'
  } catch { return 'NOT MEASURED (ps unavailable)' }
}
/** Does a config file mention the key NAME? (presence only — never a value) */
function fileMentions(p, key) {
  try { const t = fs.readFileSync(p, 'utf8'); return new RegExp('\\b' + key + '\\b').test(t) ? 'YES' : 'NO' } catch { return 'ABSENT' }
}
function scanHostingConfig(key) {
  const home = os.homedir()
  const targets = [
    ['APP .htaccess (SetEnv/PassengerEnvVar)', path.join(APP_ROOT, '.htaccess')],
    ['nodevenv activate', NODEVENV_ACTIVATE],
    ['~/.cl.selector (CloudLinux Node.js selector)', path.join(home, '.cl.selector')],
    ['~/.cpanel/nodejs.d', path.join(home, '.cpanel', 'nodejs.d')],
    ['~/.bashrc', path.join(home, '.bashrc')],
    ['~/.bash_profile', path.join(home, '.bash_profile')],
    ['~/.profile', path.join(home, '.profile')],
  ]
  const out = []
  for (const [label, p] of targets) {
    try {
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        const files = fs.readdirSync(p).slice(0, 50)
        const hits = files.filter((f) => { try { return fileMentions(path.join(p, f), key) === 'YES' } catch { return false } })
        out.push(label + ': DIR (' + files.length + ' files) mentions=' + (hits.length ? 'YES in ' + hits.join(',') : 'NO'))
      } else {
        out.push(label + ': ' + fileMentions(p, key))
      }
    } catch { out.push(label + ': ABSENT') }
  }
  return out.join(' | ')
}
function serverEntryKind(txt) {
  const kinds = []
  if (/__NEXT_PRIVATE_STANDALONE_CONFIG/.test(txt)) kinds.push('next-standalone (generated by the build)')
  if (/\[grubano\]/.test(txt)) kinds.push('repo-root custom server.js')
  if (txt.includes('env-provenance preamble')) kinds.push('PROVENANCE PREAMBLE PRESENT')
  return kinds.length ? kinds.join(' + ') : 'unknown shape'
}
function tailLogs(pattern, maxLines) {
  try {
    const dir = path.join(os.homedir(), 'logs')
    const files = fs.readdirSync(dir).filter((f) => pattern.test(f)).slice(0, 5)
    if (!files.length) return 'no matching file in ~/logs'
    // Only EXTRACTED facts are printed (HTTP codes, log-line kinds, counts) — never raw log text (F4).
    return files.map((f) => {
      const t = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')
      const tail = t.slice(-maxLines)
      const codes = tail.map((l) => (l.match(/HTTP\s*(\d{3})/) || [])[1]).filter(Boolean)
      const kinds = tail.map((l) => (l.match(/\[(LEDGER [A-Z]+|EARNINGS CRON|INVOICE CRON)\]/) || [])[1]).filter(Boolean)
      return f + ' (' + t.length + ' lines; last ' + tail.length + ': kinds=' + (kinds.join(',') || '-') + ' http=' + (codes.join(',') || '-') + ')'
    }).join(' || ')
  } catch { return 'NOT MEASURED (~/logs unreadable)' }
}
function envHistory(appRoot) {
  const rows = []
  try {
    const names = fs.readdirSync(appRoot).filter((n) => /^\.env\.local\.bak/.test(n)).sort()
    for (const n of names) {
      let txt = ''
      try { txt = fs.readFileSync(path.join(appRoot, n), 'utf8') } catch { continue }
      const d = prov.parseEnvDotenv(txt)
      const mt = fs.statSync(path.join(appRoot, n)).mtime.toISOString()
      rows.push(n + ' [' + mt + '] ' + ['TIPS_ENABLED', 'REFUNDS_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'ALERT_EMAIL'].map((k) => k + '=' + safeShow(d[k])).join(' ') + ' INTERNAL_CRON_TOKEN=' + (d.INTERNAL_CRON_TOKEN === undefined ? 'ABSENT' : 'present'))
    }
  } catch { /* optional */ }
  return rows
}
const fmtEcarts = (ecarts) => ecarts.length ? ecarts.slice(0, 12).map((e) => Object.entries(e).map(([k, v]) => k + ':' + (typeof v === 'string' && /^(pi_|re_|ch_|c[a-z0-9]{20,})/.test(v) ? mask(v) : v)).join(',')).join(' | ') + (ecarts.length > 12 ? ' … +' + (ecarts.length - 12) : '') : 'none'

// ── MAIN ──────────────────────────────────────────────────────────────────────────
async function main() {
  // ── 1. ENV + IDENTITY ─────────────────────────────────────────────────────────
  console.log('[1/12] env + identity')
  const envFile = path.join(APP_ROOT, '.env.local')
  const schemaPath = path.join(APP_ROOT, 'prisma', 'schema.prisma')
  const webhookBuilt = path.join(APP_ROOT, '.next', 'server', 'app', 'api', 'webhooks', 'stripe', 'route.js')
  const corePath = path.join(APP_ROOT, 'lib', 'ledger-check-core.js')
  const serverJs = path.join(APP_ROOT, 'server.js')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT, 'run from the deployed app (~/app.grubano.com)')
  if (!fs.existsSync(schemaPath)) return fail('1 env: prisma/schema.prisma not found')
  if (!fs.existsSync(webhookBuilt)) return fail('1 env: compiled webhook route not found')
  const built = fs.readFileSync(webhookBuilt, 'utf8')
  if (!built.includes('refund.updated') || !built.includes('refund_without_reverse_transfer')) return fail('1 env: deployed build lacks the Phase 2 markers', 'deploy Phase 2 first')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  for (const f of ['recoveryOffsetPoints', 'sourceEventId', 'royaltyClawbackCents']) if (!schema.includes(f)) return fail('1 env: deployed schema lacks ' + f)
  let version = 'unknown'
  try { version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public', 'version.json'), 'utf8')).shortCommit || 'unknown' } catch { /* optional */ }

  const texts = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const merged0 = prov.mergeNextEnvFiles(texts).merged
  const val = (k) => merged0[k]
  const dbUrl = val('DATABASE_URL') || ''
  const dbName = (dbUrl.match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (!dbUrl) return fail('1 env: DATABASE_URL absent (Next merged view)')
  if (/prod/i.test(dbName)) return fail('1 env: DATABASE_URL points at a PROD-named database (' + dbName + ')', 'refusing — staging only')
  const nextauthUrl = (val('NEXTAUTH_URL') || '').replace(/\/$/, '')
  if (!/app\.grubano\.com/.test(nextauthUrl)) return fail('1 env: NEXTAUTH_URL is not the staging origin (' + nextauthUrl + ')', 'refusing — staging only')
  const stripeKey = val('STRIPE_SECRET_KEY') || ''
  const stripeMode = stripeKey.startsWith('sk_test_') ? 'TEST' : (stripeKey.startsWith('sk_live_') ? 'LIVE' : 'ABSENT/UNKNOWN')
  if (stripeMode !== 'TEST') return fail('1 env: Stripe key mode is ' + stripeMode, 'refusing — TEST only')
  const base = (process.env.PHASE2_BASE_URL || nextauthUrl).replace(/\/$/, '')
  // The file token is only ever sent to the staging origin (or a loopback harness) — F3.
  try {
    const bu = new URL(base)
    const localHarness = bu.hostname === '127.0.0.1' || bu.hostname === 'localhost'
    if (!(bu.protocol === 'https:' && bu.hostname === 'app.grubano.com') && !localHarness) return fail('1 env: probe base ' + bu.origin + ' is not the staging origin', 'refusing — the file token is only ever sent to https://app.grubano.com')
  } catch { return fail('1 env: probe base unparsable') }

  F('SOURCE', 'staging server ' + APP_ROOT + ' (env files + DB + Stripe TEST + compiled build + live routes)')
  F('DEPLOYED SHA (public/version.json)', version)
  F('DATABASE', dbName + ' (staging-named)')
  F('NEXTAUTH_URL', nextauthUrl + (base !== nextauthUrl ? ' (probe base overridden: ' + base + ')' : ''))
  F('STRIPE_SECRET_KEY mode', stripeMode)
  F('ENV FILES PRESENT (Next load order)', prov.NEXT_ENV_FILES.filter((f) => typeof texts[f] === 'string').join(', ') || 'none')
  F('DEPLOYED server.js KIND (measured)', fs.existsSync(serverJs) ? serverEntryKind(fs.readFileSync(serverJs, 'utf8')) : 'ABSENT')
  F('LEDGER CORE SHIPPED (lib/ledger-check-core.js)', fs.existsSync(corePath) ? 'YES' : 'NO')
  // ── Operator env = the deployed app's env (@next/env from the standalone runtime). This is
  //    what v4 lacked: it never populated process.env, so Prisma had no DATABASE_URL.
  let envLoad = { loader: 'NOT LOADED', filesLoaded: [] }
  try { envLoad = H.loadRuntimeEnv(APP_ROOT) } catch (e) { envLoad = { loader: 'FAILED: ' + scrub(e), filesLoaded: [] } }
  const rtFacts = H.envFacts(process.env)
  F('OPERATOR ENV LOADER', envLoad.loader + ' · files: ' + (envLoad.filesLoaded.join(', ') || 'none'))
  F('DATABASE_URL AVAILABLE TO OPERATOR', rtFacts.databaseUrl ? 'YES' : 'NO')
  F('STRIPE_SECRET_KEY AVAILABLE TO OPERATOR', rtFacts.stripeKey ? 'YES' : 'NO')
  F('STRIPE SECRET MODE (operator process)', rtFacts.stripeMode)
  if (rtFacts.stripeMode !== 'TEST') return fail('1 env: operator process Stripe key mode is ' + rtFacts.stripeMode, 'refusing — TEST only')
  if (!rtFacts.databaseUrl) A('1 env: DATABASE_URL not available to the operator after the runtime env load — DB steps will be NOT MEASURED')
  F('SHELL PRE-LOAD: INTERNAL_CRON_TOKEN PRESENT IN THIS TERMINAL ENV (not Passenger)', SHELL_HAS_TOKEN ? 'YES' : 'NO')
  for (const k of WATCHED_KEYS) F('KEY ' + k, describeKey(k, texts))
  const hist = envHistory(APP_ROOT)
  F('ENV BACKUP HISTORY (dotenv parse)', hist.length ? hist.join(' || ') : 'no .env.local.bak* file')
  const before = await probeRuntime(base)
  F('RUNTIME BEFORE (live process, measured)', probeLine(before))

  // ── 2. HOSTING CONFIG SCAN (names only) ───────────────────────────────────────
  console.log('[2/12] hosting config scan (key NAME presence only)')
  F('HOSTING CONFIG MENTIONS INTERNAL_CRON_TOKEN', scanHostingConfig('INTERNAL_CRON_TOKEN'))
  F('HOSTING CONFIG MENTIONS TIPS_ENABLED', scanHostingConfig('TIPS_ENABLED'))

  // ── 3. SAFETY RE-ASSERTION (idempotent, v3 logic) ─────────────────────────────
  console.log('[3/12] safety re-assertion')
  const originalTxt = fs.readFileSync(envFile, 'utf8')
  const stampIso = new Date().toISOString()
  const writes = { REFUNDS_ENABLED: 'false', LOGISTICS_SIGNUP_ENABLED: 'true', ALERT_EMAIL: TARGET_ALERT }
  const { text, changes } = rewriteEnv(originalTxt, writes, stampIso.slice(0, 10))
  let envChanged = false
  let backup = null
  if (changes.length === 0) {
    F('ENV WRITE', 'NO CHANGE NEEDED (canonical values already in place)')
  } else {
    backup = envFile + '.bak-phase2-' + stampIso.replace(/[:.]/g, '-')
    fs.copyFileSync(envFile, backup); try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
    fs.writeFileSync(envFile, text, { mode: 0o600 }); try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
    envChanged = true
    F('ENV BACKUP', path.basename(backup))
    F('ENV WRITE', changes.join(' ; '))
  }
  const textsA = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const mergedA = prov.mergeNextEnvFiles(textsA)
  const flag = (k) => mergedA.merged[k]
  for (const [k, v] of Object.entries(writes)) {
    if (flag(k) !== v) return fail('3 write: Next merged view of ' + k + ' = ' + showVal(k, flag(k)) + ' (expected ' + showVal(k, v) + ') — effective source: ' + ((mergedA.definedIn[k] || [])[0] || 'none'), backup ? 'restore from ' + path.basename(backup) : 'inspect the env files')
  }
  for (const k of FLAGS_TO_PRINT) F('FLAG ' + k + ' (Next merged view)', eff(flag(k)) + ((mergedA.definedIn[k] || []).length > 1 ? ' [defined in ' + mergedA.definedIn[k].join(' > ') + ']' : ''))
  for (const k of MONEY_FLAGS_MUST_BE_FALSE) {
    if (flag(k) === 'true') {
      if (backup) fs.copyFileSync(backup, envFile)
      return fail('3 flags: ' + k + ' is TRUE in the Next merged view (' + (mergedA.definedIn[k] || []).join(',') + ')' + (backup ? ' — env RESTORED from ' + path.basename(backup) : '') + ', restart REFUSED', 'human decision required')
    }
  }
  if (flag('LOGISTICS_SIGNUP_ENABLED') === 'true' && flag('RATE_LIMIT_ENABLED') !== 'true') O('RATE_LIMIT_ENABLED effective false while the public courier signup is open (flags.md recommends enabling it — FOUNDER DECISION)')
  const expect = { signupOpen: true, tips: false }

  // ── 4. MAIL — only if ALERT_EMAIL changed ─────────────────────────────────────
  console.log('[4/12] alert channel')
  const alertChanged = changes.some((c) => c.startsWith('ALERT_EMAIL'))
  if (!alertChanged) {
    F('TEST ALERT', 'SKIPPED — ALERT_EMAIL unchanged (' + flag('ALERT_EMAIL') + '); provider acceptance was measured by v3')
  } else {
    try {
      const nodemailer = require(require.resolve('nodemailer', { paths: [APP_ROOT] }))
      const transporter = nodemailer.createTransport({ host: flag('SMTP_HOST') || 'mail.grubano.com', port: 587, secure: false, auth: { user: flag('SMTP_USER') || 'contact@grubano.com', pass: flag('SMTP_PASS') } })
      const info = await transporter.sendMail({ from: '"Grubano" <contact@grubano.com>', to: TARGET_ALERT, subject: '[Grubano] MONEY REVIEW — TEST préflight Phase 2 v4 (aucun argent) ' + stampIso.slice(0, 16), html: '<p>Test du canal MONEY REVIEW (staging, v4). Aucun argent, aucune donnée modifiée. ' + stampIso + '</p>' })
      F('TEST ALERT accepted / rejected (provider)', JSON.stringify(info.accepted || []) + ' / ' + JSON.stringify(info.rejected || []))
      if (!info.accepted || !info.accepted.includes(TARGET_ALERT)) A('4 mail: provider did not accept ' + TARGET_ALERT + ' (fallback ' + FALLBACK_ALERT + ' to be decided by the founder)')
    } catch (e) { A('4 mail: send failed — ' + scrub(e)) }
  }

  // ── 5. PROVENANCE FILE (written by the deployed entry's preamble) — restart if missing/stale ─
  console.log('[5/12] env provenance (Passenger process, pre-load snapshot)')
  // Written by the deployed entry's preamble OUTSIDE the app root (= Apache DocumentRoot on cPanel).
  const provPath = path.join(os.homedir(), '.grubano', 'env-provenance.json')
  const readProv = () => { try { return JSON.parse(fs.readFileSync(provPath, 'utf8')) } catch { return null } }
  let provRep = readProv()
  const serverMtime = fs.existsSync(serverJs) ? fs.statSync(serverJs).mtimeMs : 0
  const provFresh = (r) => r && r.at && Date.parse(r.at) >= serverMtime - 1000
  if (envChanged || !provFresh(provRep)) {
    F('APP PROCESSES BEFORE RESTART (ps, best-effort)', listAppProcesses())
    fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
    const restartAt = new Date()
    fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), 'phase2-preflight v4 ' + restartAt.toISOString())
    F('PASSENGER RESTART', 'TOUCHED tmp/restart.txt at ' + restartAt.toISOString() + (envChanged ? ' (env changed)' : ' (provenance file missing or older than the deployed server.js → the new process must write it)'))
    await sleep(3000)
    const reload = await waitForReload(base, expect, RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
    F('RUNTIME AFTER RESTART (live process, measured)', probeLine(reload.last))
    F('APP PROCESSES AFTER RESTART (ps, best-effort)', listAppProcesses())
    if (reload.reloaded) F('PROCESS RELOAD PROVEN', 'YES — live routes match the file after ' + Math.round(reload.elapsedMs / 1000) + ' s / ' + reload.probes + ' probe(s)')
    else A('5 restart: the live process did NOT match the expected state within ' + Math.round(reload.elapsedMs / 1000) + ' s — last: ' + probeLine(reload.last))
    for (let i = 0; i < 6 && !provFresh(readProv()); i++) await sleep(5000)
    provRep = readProv()
  } else {
    F('PASSENGER RESTART', 'NOT NEEDED (env unchanged, provenance file fresh)')
  }
  if (!provRep) {
    O('5 provenance: ~/.grubano/env-provenance.json ABSENT — the deployed server.js has no preamble yet (deploy the fix-server.js change) or the process did not restart; hosting-injection question stays NOT MEASURED')
    F('INTERNAL_CRON_TOKEN PRESENT BEFORE ENV LOAD (Passenger process)', 'NOT MEASURED')
  } else {
    F('PROVENANCE FILE', 'at ' + provRep.at + (provFresh(provRep) ? ' (fresh)' : ' (STALE vs server.js)') + ' · files seen by the process: ' + (provRep.filesPresent || []).join(', '))
    for (const k of WATCHED_KEYS) {
      const e = provRep.keys && provRep.keys[k]
      if (!e) continue
      F('PROVENANCE ' + k, 'presentBeforeEnvLoad=' + (e.presentBeforeEnvLoad ? 'YES' : 'NO') + ' · inEnvFiles=' + (e.presentInEnvFiles ? 'YES(' + e.definedIn.join(',') + ')' : 'NO') + ' · equal(process vs files)=' + (e.equalProcessVsFiles === null ? 'n/a' : (e.equalProcessVsFiles ? 'YES' : 'NO')) + ' · effective=' + e.effectiveSource)
    }
    const tok = provRep.keys && provRep.keys.INTERNAL_CRON_TOKEN
    if (tok) F('INTERNAL_CRON_TOKEN PRESENT BEFORE ENV LOAD (Passenger process)', tok.presentBeforeEnvLoad ? 'YES' : 'NO')
  }

  // ── 6. HEALTH ×3 ──────────────────────────────────────────────────────────────
  console.log('[6/12] health')
  const runs = []
  for (let i = 0; i < 3; i++) { runs.push(await probeRuntime(base)); if (i < 2) await sleep(3000) }
  const any5xx = runs.some((p) => [p.eat, p.restaurants, p.refundStatus, p.signupStatus].some((s) => s >= 500))
  const stable = runs.every((p) => p.eat === 200 && p.restaurants === 200 && p.refundFlag === 'false' && p.signupOpen === 'true' && p.tips === 'false')
  F('HEALTH ×3', runs.map(probeLine).join(' || '))
  F('HEALTH VERDICT', stable && !any5xx ? 'STABLE — refunds gated, waitlist open, tips off, no 5xx' : 'NOT STABLE / unexpected state (see above)')
  if (!stable || any5xx) A('6 health: unexpected runtime state')

  // ── 6b. APP-ROOT WEB EXPOSURE (read-only HEAD, status only) ────────────────────
  // On cPanel/Passenger the app root IS the Apache DocumentRoot, so existing files under it may
  // be served statically before Next is reached (measured 2026-09-05: server.js, package.json,
  // prisma/schema.prisma, tmp/restart.txt, scripts/server/*.js → 200 ; .env.local, .htaccess → 404).
  console.log('[6b/12] app-root web exposure (status only)')
  // Two classes: SECRET-bearing names (any 200 = P0 SECURITY INCIDENT → hard FAIL, stop) and
  // SOURCE/ops names (200 = P1 pre-production, recorded, fixed in a separate infra train).
  const SECRET_PATHS = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.local.bak', '.env.local.bak-before-beta-flags', '.htaccess', '.git/HEAD', '.git/config', 'deploy_key', 'backup.sql', 'dump.sql']
  const SOURCE_PATHS = ['server.js', 'package.json', 'prisma/schema.prisma', 'tmp/restart.txt', 'scripts/server/phase2-preflight.js', 'lib/ledger-check-core.js']
  const exposure = []
  let secretLeak = false
  for (const rel of [...SECRET_PATHS, ...SOURCE_PATHS]) {
    try {
      const r = await fetch(base + '/' + rel, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'grubano-phase2-preflight/5' } })
      exposure.push(rel + '=' + r.status)
      if (r.status === 200 && SECRET_PATHS.includes(rel)) { secretLeak = true; A('6b P0 SECURITY INCIDENT: /' + rel + ' is publicly readable (secret-bearing class) — STOP normal Phase 2 closure; establish exposure scope before any rotation') }
      else if (r.status === 200) O('6b exposure: /' + rel + ' is served publicly (pre-existing hosting layout: DocumentRoot = app root) — P1 PRE-PRODUCTION, separate infra train (T-41), NOT fixed here')
    } catch { exposure.push(rel + '=err') }
  }
  F('APP-ROOT WEB EXPOSURE (HEAD status; 200 = served)', exposure.join(' · '))
  F('CONFIRMED SECRET LEAK (secret-bearing classes)', secretLeak ? 'YES — P0' : 'NO')

  // ── 7–10. DB + DIRECT RECONCILIATION (READ-ONLY) ───────────────────────────────
  // ── Dependency resolution = the deployed app's layout (APP_ROOT/node_modules) ─────
  let PrismaClient = null, core = null, stripe = null
  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  if (prismaRes.ok) { try { ({ PrismaClient } = require(prismaRes.path)) } catch (e) { A('7 db: @prisma/client found but not loadable (' + scrub(e) + ')') } } else A('7 db: @prisma/client not resolvable from ' + APP_ROOT + ' (' + prismaRes.error + ')')
  F('PRISMA CLIENT RESOLUTION', PrismaClient ? 'PASS (' + path.relative(APP_ROOT, prismaRes.path).split(path.sep).join('/') + ')' : 'FAIL')
  try { core = require(corePath); F('LEDGER CORE RESOLUTION', 'PASS (lib/ledger-check-core.js)') } catch (e) { F('LEDGER CORE RESOLUTION', 'FAIL'); A('7 core: lib/ledger-check-core.js not loadable (' + scrub(e) + ')') }
  try {
    const mk = H.makeStripeClient(process.env.STRIPE_SECRET_KEY || stripeKey, APP_ROOT, { apiBase: process.env.PHASE2_STRIPE_API_BASE, allowLoopback: process.env.PHASE2_ALLOW_LOOPBACK === '1' })
    stripe = mk.client; F('STRIPE SDK RESOLUTION', mk.resolution)
  } catch (e) { F('STRIPE SDK RESOLUTION', 'FAIL'); A('7 stripe: ' + scrub(e)) }
  let prisma = null
  if (PrismaClient && rtFacts.databaseUrl) {
    // URL handed explicitly — nothing depends on ambient env any more (v4 regression).
    try { prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) } catch (e) { A('7 db: PrismaClient construction failed (' + scrub(e) + ')') }
  } else if (PrismaClient) A('7 db: DATABASE_URL unavailable → Prisma NOT constructed')
  if (prisma) {
    try {
      console.log('[7/12] no unexpected refund (window since ' + WINDOW_START.toISOString().slice(0, 10) + ')')
      const [refundCount, refundsInWindow, ledgerRefunds] = await Promise.all([
        prisma.refund.count(),
        prisma.refund.findMany({ where: { createdAt: { gte: WINDOW_START } }, select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true } }),
        prisma.ledgerEntry.findMany({ where: { type: 'refund', createdAt: { gte: WINDOW_START } }, select: { sourceEventId: true, grossAmount: true, createdAt: true } }),
      ])
      F('DB Refund rows (all time) / since window', refundCount + ' / ' + refundsInWindow.length + (refundsInWindow.length ? ' [' + refundsInWindow.map((r) => r.createdAt.toISOString().slice(0, 10) + ':' + r.status + ':' + r.amountCents + ':order…' + r.orderId.slice(-6)).join(' | ') + ']' : ''))
      F('DB ledger refund lines since window', ledgerRefunds.length ? ledgerRefunds.map((l) => l.createdAt.toISOString().slice(0, 10) + ':' + mask(l.sourceEventId) + ':' + l.grossAmount).join(' | ') : 'none')
      const unexpected = refundsInWindow.filter((r) => !(r.amountCents === 1450 && r.createdAt.toISOString().startsWith('2026-08-29')))
      F('UNEXPECTED REFUND SINCE 2026-08-29 (DB)', unexpected.length === 0 ? 'NO' : 'YES — ' + unexpected.length)
      if (unexpected.length) A('7 refunds: unexpected Refund row(s) — HARD STOP')

      console.log('[8/12] order GR-' + ORDER_ID.slice(-6).toUpperCase())
      const order = await prisma.order.findUnique({ where: { id: ORDER_ID }, select: { id: true, status: true, paymentStatus: true, total: true, pointsRedeemed: true, loyaltyCreditCents: true, pointsEarned: true, stripePaymentIntentId: true, pointOfSaleId: true } })
      if (!order) A('8 order: ' + ORDER_ID + ' not found')
      else {
        const refundRows = await prisma.refund.count({ where: { orderId: order.id } })
        F('ORDER GR-' + order.id.slice(-6).toUpperCase() + ' (DB)', order.status + ' / ' + order.paymentStatus + ' · total ' + order.total + ' · pointsRedeemed ' + order.pointsRedeemed + ' · loyaltyCreditCents ' + order.loyaltyCreditCents + ' · pointsEarned ' + order.pointsEarned + ' · PI ' + mask(order.stripePaymentIntentId) + ' · POS ' + (order.pointOfSaleId || 'null') + ' · refund rows ' + refundRows + ' · DISPOSABLE ' + (refundRows === 0 && order.paymentStatus === 'paid' ? 'YES' : 'NO'))
      }

      console.log('[9/12] franchise')
      const [royaltyCount, franchiseOps, ordersWithPos] = await Promise.all([prisma.franchiseRoyalty.count(), prisma.operator.count({ where: { role: 'franchise' } }), prisma.order.count({ where: { pointOfSaleId: { not: null } } })])
      F('FRANCHISE royalty rows / franchise operators / POS orders (DB)', royaltyCount + ' / ' + franchiseOps + ' / ' + ordersWithPos + ' · FRANCHISE_ENABLED ' + (flag('FRANCHISE_ENABLED') === 'true' ? 'ON' : 'OFF'))

      console.log('[10/12] DIRECT LEDGER RECONCILIATION (Track A — same core as the HTTP route, READ-ONLY)')
      if (!core || !stripe) { A('10 direct: ledger core or Stripe client unavailable — direct reconciliation NOT MEASURED'); financialVerdict = 'NOT MEASURED' }
      else {
        const now = new Date()
        // Second window starts one day BEFORE the true-flag window so the Z1 rehearsal day
        // (2026-08-29) can never straddle a window edge (a PI created seconds before the edge
        // with its ledger line after it would show as `not_in_stripe_window` — an edge effect,
        // not a money finding). The 7 d window is the route's default, kept for comparability.
        const windows = [['7d (route default)', new Date(now.getTime() - 7 * 24 * 3600 * 1000), now], ['since 2026-08-28 (covers the true-flag window from 08-29)', new Date(WINDOW_START.getTime() - 24 * 3600 * 1000), now]]
        let allOk = true
        for (const [label, from, to] of windows) {
          const warns = []
          const r = await core.reconcileLedger({ prisma, stripe, from, to, warn: (m) => warns.push(m) })
          F('DIRECT [' + label + '] window', from.toISOString() + ' → ' + to.toISOString())
          F('DIRECT [' + label + '] ok / internalOk / reconciliationOk / refundsOk', r.ok + ' / ' + r.internalOk + ' / ' + r.reconciliationOk + ' / ' + r.refundsOk)
          F('DIRECT [' + label + '] LEDGER PAYMENT COUNT / STRIPE PAYMENT COUNT / LEDGER PAYMENT SUM / STRIPE PAYMENT SUM', r.ledgerCount + ' / ' + r.stripeCount + ' / ' + r.ledgerSum + ' / ' + r.stripeSum)
          F('DIRECT [' + label + '] LEDGER REFUND COUNT / STRIPE REFUND COUNT / LEDGER REFUND SUM / STRIPE REFUND SUM / checked', r.refunds.ledgerCount + ' / ' + r.refunds.stripeCount + ' / ' + r.refunds.ledgerSum + ' / ' + r.refunds.stripeSum + ' / ' + r.refunds.checked)
          F('DIRECT [' + label + '] aggregates gross / fee / net', r.aggregates.gross + ' / ' + r.aggregates.applicationFee + ' / ' + r.aggregates.netToRestaurant)
          F('DIRECT [' + label + '] ECARTS', fmtEcarts(r.ecarts))
          F('DIRECT [' + label + '] REFUND ECARTS', fmtEcarts(r.ecarts.filter((e) => e.kind === 'missing_refund_in_ledger')))
          if (warns.length) F('DIRECT [' + label + '] warnings', warns.map(scrub).join(' | ').slice(0, 200))
          // Window-edge classification: every not_in_stripe_window ecart is PROVEN (same PI at
          // Stripe, succeeded, same amount, created before the window start) or stays a mismatch.
          const classified = r.ecarts.length ? await H.classifyWindowEdges(r.ecarts, { prisma, stripe, from }) : []
          F('DIRECT [' + label + '] WINDOW EDGE', classified.length ? classified.map((c) => c.cls + '{' + (c.ecart.ledgerId ? 'ledger ' + mask(c.ecart.ledgerId) : '') + (c.ecart.stripePaymentIntentId ? ' ' + mask(c.ecart.stripePaymentIntentId) : '') + (c.amount != null ? ' ' + c.amount + 'c' : '') + ': ' + c.reason + '}').join(' | ').slice(0, 600) : 'none')
          const verdict = H.windowVerdict(r, classified)
          F('DIRECT [' + label + '] WINDOW VERDICT', verdict)
          if (!r.refunds.checked) A('10 direct [' + label + ']: Stripe refunds listing unavailable → refund reconciliation NOT MEASURED')
          if (!verdict.startsWith('PASS')) { A('10 direct [' + label + ']: ' + verdict + ' — see ECARTS / WINDOW EDGE / sums'); allOk = false }
        }
        financialVerdict = allOk ? 'PASS' : 'FAIL'
        F('FINANCIAL MONEY MUTATION DURING CHECK', 'NO — by construction (core uses findMany + Stripe list only; no create/update/refund call exists in this operator)')
      }
    } catch (e) {
      A('7-10 db/direct: ' + scrub(e))
      if (financialVerdict === 'NOT MEASURED') financialVerdict = 'FAIL (error)'
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  } else {
    financialVerdict = 'NOT MEASURED'
  }

  // ── 11. HTTP LEDGER AUTH (Track B — separate verdict, status only) ────────────
  console.log('[11/12] HTTP ledger route (auth verdict, status only)')
  const fileTok = flag('INTERNAL_CRON_TOKEN') || ''
  const tokProv = provRep && provRep.keys && provRep.keys.INTERNAL_CRON_TOKEN
  if (!fileTok) { httpAuthVerdict = 'FAIL (no token in any env file for Next)'; O('11 http: INTERNAL_CRON_TOKEN absent from the env files → route can only answer 401') }
  else {
    try {
      const to = new Date(), from = new Date(to.getTime() - 7 * 24 * 3600 * 1000)
      const r = await ledgerCheckHttp(base, fileTok, from, to)
      F('HTTP LEDGER CHECK status (file token)', String(r.status))
      if (r.status === 200) { httpAuthVerdict = 'PASS'; F('HTTP LEDGER CHECK ok / refundsOk', r.body.ok + ' / ' + r.body.refundsOk) }
      else if (r.status === 401) {
        httpAuthVerdict = 'FAIL (401)'
        let cause = 'the process compares a DIFFERENT value than the env files deliver'
        if (tokProv && tokProv.presentBeforeEnvLoad && tokProv.equalProcessVsFiles === false) cause = 'ROOT CAUSE MEASURED: INTERNAL_CRON_TOKEN is INJECTED by the hosting environment BEFORE Next loads the env files, with a value that DIFFERS from the file (Next never overrides a pre-existing variable) → the runtime authoritative token is the hosting one'
        else if (tokProv && tokProv.presentBeforeEnvLoad && tokProv.equalProcessVsFiles === true) cause = 'hosting-injected value EQUALS the file value, yet 401 → escalate (route-level investigation: header path / proxy)'
        else if (tokProv && !tokProv.presentBeforeEnvLoad) cause = 'NOT hosting-injected (process reads the file) yet 401 → escalate (route-level investigation: header path / proxy / process not reloaded)'
        else cause += ' (provenance NOT MEASURED — deploy the preamble first)'
        O('11 http: 401 — ' + cause)
      } else { httpAuthVerdict = 'FAIL (' + r.status + ')'; O('11 http: unexpected status ' + r.status) }
    } catch (e) { httpAuthVerdict = 'FAIL (request error)'; O('11 http: request failed — ' + scrub(e)) }
  }

  // ── 12. SERVER CRON PROBE LOG (best-effort, no secret) ─────────────────────────
  console.log('[12/12] server cron probe log')
  F('~/logs ledger probe tail (cPanel crontab 07:00, best-effort)', tailLogs(/ledger|cron/i, 2))

  const result = anomalies.length ? 'FAIL' : (httpAuthVerdict === 'PASS' ? 'PASS' : 'PASS (HTTP AUTH OPEN — non-financial)')
  return done(result, anomalies.length ? anomalies[0].split(':')[0] : undefined)
}

module.exports = { parseEnvLenient, rewriteEnv, probeRuntime, probeMatches, waitForReload, ledgerCheckHttp, serverEntryKind, fmtEcarts }

if (require.main === module) {
  main().catch((e) => fail('unexpected: ' + String(e && e.message ? e.message : e).slice(0, 200)))
}
