#!/usr/bin/env node
'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase2-claims-gate.js — CLAIMS REHEARSAL: server-side READ-ONLY PRECHECK and a
   FAIL-CLOSED, TTL-BOUNDED CLAIMS WINDOW. Staging only. Stripe TEST only.

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-claims-gate.js
         → MODE precheck (default, READ-ONLY): proves the Claim table is reachable, prints
           the BEFORE state of the target fixture, and measures every relevant flag from
           the LIVE process. Writes NOTHING.

     … phase2-claims-gate.js window       (needs the founder's explicit sentence)
         → MODE window: CLAIMS_ENABLED=true for a FINITE TTL, then unconditionally back to
           false, with the closed state PROVEN by an independent HTTP probe.

   ── WHY THIS OPERATOR CANNOT MOVE MONEY ──────────────────────────────────────────
   It opens CLAIMS_ENABLED **only**. REFUNDS_ENABLED is never written, and the window
   REFUSES TO OPEN unless the refund gate is measured CLOSED (403 gated) first and stays
   closed. With CLAIMS on and REFUNDS off, an approved claim rests at 'approved' with the
   refund pending activation (lib/claims.triggerClaimRefund returns refunds_disabled) —
   the rehearsal exercises the WORKFLOW, never the cash rail.

   A claims rehearsal that must actually MOVE money needs REFUNDS_ENABLED=true, i.e. a
   financial window — and that is blocked by **T-48** (a refund window's closure must not
   depend on the lifetime of the process that opened it). This operator therefore hard-
   refuses `PHASE2_CLAIMS_WITH_REFUNDS=1` and says why, instead of silently degrading.

   Evidence rule: every printed value is MEASURED (file / DB / live route) and tagged; NOT
   MEASURED when unavailable. No secret value / length / hash is ever printed.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const prov = require(path.join(__dirname, 'env-provenance.js'))
const H = require(path.join(__dirname, 'reconcile-helpers.js'))

const MODE = process.argv[2] === 'window' ? 'window' : 'precheck'
const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const CONFIRM_SENTENCE = 'I AUTHORIZE THE STAGING CLAIMS REHEARSAL'
const TARGET_ORDER_ID = process.env.PHASE2_CLAIMS_ORDER_ID || ''
const TTL_MS = Number(process.env.PHASE2_CLAIMS_WINDOW_MS || 15 * 60 * 1000)
const RELOAD_DEADLINE_MS = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)
const POLL_MS = Number(process.env.PHASE2_CLAIMS_POLL_MS || 15000)

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
const mask = (s) => (typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : (s ? '***' : 'null'))
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function done(result, failedStep) {
  console.log('========================================')
  console.log('GRUBANO CLAIMS ' + (MODE === 'window' ? 'WINDOW' : 'REHEARSAL PRECHECK') + ' (staging) — every value below is MEASURED')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  process.exitCode = result.startsWith('PASS') ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
// ROUND-6 AUDIT FIX (P2): the design record said residue was reported "on the abort paths too".
// It was not — every `return fail(...)` inside main() and the main().catch() skipped it, so an
// abort AFTER the window opened (the case where residue is most likely) printed nothing. `fail`
// now awaits the residue report whenever a DB handle exists, i.e. whenever the rehearsal got far
// enough to have created anything. The SYNCHRONOUS signal / uncaught-exception paths still cannot
// await a DB read (see emergencyClose) — that limit is stated, not papered over.
const fail = async (step) => {
  if (residuePrisma) await reportResidue()
  return done('FAIL', step)
}

/** Unauthenticated probe of a gated route: 403 {gated|enabled:false} = CLOSED, 401 = OPEN. */
async function probeGate(base, pathname) {
  try {
    const r = await fetch(base + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'grubano-phase2-claims-gate/1' }, body: '{}', redirect: 'manual' })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && (b.gated === true || b.enabled === false)) return 'CLOSED'
    if (r.status === 401) return 'OPEN'
    return 'UNKNOWN(' + r.status + ')'
  } catch { return 'UNREACHABLE' }
}
async function waitGate(base, pathname, want, deadlineMs, intervalMs) {
  const t0 = Date.now(); let last = 'n/a', n = 0
  while (Date.now() - t0 < deadlineMs) { n++; last = await probeGate(base, pathname); if (last === want) return { ok: true, elapsedMs: Date.now() - t0, probes: n, last }; await sleep(intervalMs) }
  return { ok: false, elapsedMs: Date.now() - t0, probes: n, last }
}

/** Canonical write of ONE key in .env.local (backup first) — same primitive as the refund gate. */
function writeFlag(envFile, key, value, stamp) {
  const txt = fs.readFileSync(envFile, 'utf8')
  const eol = txt.includes('\r\n') ? '\r\n' : '\n'
  let seen = false, changed = false
  const out = txt.split(/\r?\n/).map((raw) => {
    const t = raw.replace(/^﻿/, '').trim()
    if (!t || t.startsWith('#')) return raw
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!m || m[1] !== key) return raw
    if (seen) { changed = true; return '# phase2-claims-gate ' + stamp + ' duplicate neutralised: ' + raw }
    seen = true
    const canonical = key + '=' + value
    if (raw !== canonical) changed = true
    return canonical
  })
  if (!seen) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push('# phase2-claims-gate ' + stamp + ' — ' + key); out.push(key + '=' + value); changed = true }
  if (!changed) return { changed: false, backup: null }
  const backup = envFile + '.bak-claims-gate-' + stamp.replace(/[:.]/g, '-')
  fs.copyFileSync(envFile, backup); try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
  let text = out.join(eol); if (!text.endsWith(eol)) text += eol
  fs.writeFileSync(envFile, text, { mode: 0o600 }); try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
  return { changed: true, backup: path.basename(backup) }
}
function touchRestart() { fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true }); fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), 'phase2-claims-gate ' + new Date().toISOString()) }

/* EMERGENCY CLOSE — same lesson as the refund window (closeout audit 2026-09-09): a
   `finally` only runs if the process reaches it. Armed the moment CLAIMS_ENABLED becomes
   true, disarmed only once false is on disk. NOTE: this is PROCESS-LOCAL protection. It
   does NOT survive SIGKILL or a host crash — that is exactly what T-48 is about. Claims
   is non-financial while REFUNDS stays closed, so the residual risk here is a feature
   flag left on, not money movement. */
let armedClose = null
// NOTE: emergencyClose is deliberately SYNCHRONOUS — it must finish before the process exits, so
// it cannot await a database read. Residue is reported by reportResidue() on the async exit paths;
// under a hard kill the record is the operator's own log plus the census route.

function emergencyClose(reason) {
  if (!armedClose) return false
  const { envFile, stamp } = armedClose
  armedClose = null
  try {
    try { writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', new Date(Date.now() - 1000).toISOString(), stamp + '-emergency') } catch { /* the flag write below is the belt */ }
    const r = writeFlag(envFile, 'CLAIMS_ENABLED', 'false', stamp + '-emergency')
    touchRestart()
    console.log('  !! EMERGENCY CLAIMS CLOSE (' + reason + '): CLAIMS_ENABLED=false written' + (r.changed ? ' (backup ' + r.backup + ')' : ' (was already false)') + ' + restart touched.')
    console.log('  !! VERIFY: POST /api/claims {} must answer 403 {gated:true} within a few minutes.')
    return true
  } catch (e) {
    console.log('  !! EMERGENCY CLAIMS CLOSE FAILED (' + reason + '): ' + scrub(e))
    console.log('  !! HUMAN ACTION REQUIRED NOW: set CLAIMS_ENABLED=false in ' + envFile + ' and touch tmp/restart.txt')
    return false
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'SIGQUIT']) {
  try { process.on(sig, () => { emergencyClose(sig); process.exit(130) }) } catch { /* unsupported on this platform */ }
}
process.on('uncaughtException', (e) => { emergencyClose('uncaughtException'); console.log('  !! ' + scrub(e)); process.exit(1) })
process.on('unhandledRejection', (e) => { emergencyClose('unhandledRejection'); console.log('  !! ' + scrub(e)); process.exit(1) })

// §20 — what this rehearsal left behind, reported on EVERY exit path.
let residueBaseline = null
let residuePrisma = null
async function reportResidue() {
  if (!residuePrisma) { A('4 residue: NOT MEASURED — no DB handle; a rehearsal must not be declared clean without this'); return }
  if (!residueBaseline) { A('4 residue: NOT MEASURED — the before-snapshot failed, so nothing can be attributed to this window'); return }
  try {
    const TERMINAL = ['refunded', 'refused_final']
    const after = await residuePrisma.claim.findMany({ select: { id: true, status: true, orderId: true, refundAttempted: true, arbitrationDecision: true } })
    const created = after.filter((c) => !residueBaseline.has(c.id))
    const residue = created.filter((c) => !TERMINAL.includes(c.status))
    F('CLAIMS CREATED BY THIS REHEARSAL', created.length + (created.length ? ' - ' + created.map((c) => c.id + ':' + c.status).join(', ') : ''))
    F('NON-TERMINAL RESIDUE', residue.length ? residue.length + ' - ' + residue.map((c) => c.id + ':' + c.status + ' (order ' + c.orderId + ')').join(', ') : 'NONE')
    if (residue.length) A('4 residue: ' + residue.length + ' claim(s) left NON-TERMINAL by this rehearsal, listed above BY ID because closing CLAIMS_ENABLED hides some of these states from the arbitration console. Resolve them in a later window; do NOT reopen claims now just to tidy up.')
    // ROUND-9 AUDIT FIX (P2): an APPROVED-and-UNPAID claim is the residue a rehearsal with REFUNDS closed
    // can leave that nothing moves afterwards: re-approving pays only with a CLAIMS window AND a REFUNDS
    // window open together (neither operator opens both), and refuse_final is refused once approved.
    // Named separately so it is never read as ordinary residue.
    const approvedUnpaid = residue.filter((c) => c.status === 'approved' && c.refundAttempted === false)
    if (approvedUnpaid.length) A('4 residue: ' + approvedUnpaid.length + ' claim(s) APPROVED and UNPAID (' + approvedUnpaid.map((c) => c.id).join(', ') + '). Nothing can pay them with REFUNDS closed and they can no longer be refused; paying them needs a CLAIMS window and a REFUNDS window open together, which neither operator opens. FOUNDER DECISION required before any rehearsal that approves a claim.')
    const stuck = await residuePrisma.claim.count({ where: { status: 'refunding' } })
    const fv    = await residuePrisma.claim.count({ where: { status: 'financial_verification' } })
    F('POST-CLOSE MONEY STATES', 'refunding ' + stuck + ' - financial_verification ' + fv)
  } catch (e) { A('4 residue: ' + scrub(e)) }
}

async function main() {
  console.log('[1] identity + env (mode ' + MODE + ')')
  const envFile = path.join(APP_ROOT, '.env.local')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT)
  const merged = prov.mergeNextEnvFiles(prov.readNextEnvFiles(fs, path, APP_ROOT)).merged
  const dbName = ((merged.DATABASE_URL || '').match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (/prod/i.test(dbName)) return fail('1 env: PROD-named database (' + dbName + ') — refusing')
  const nextauthUrl = (merged.NEXTAUTH_URL || '').replace(/\/$/, '')
  if (!/app\.grubano\.com/.test(nextauthUrl)) return fail('1 env: NEXTAUTH_URL is not staging')
  const base = (process.env.PHASE2_BASE_URL || nextauthUrl).replace(/\/$/, '')
  try {
    const bu = new URL(base)
    const loop = bu.hostname === '127.0.0.1' || bu.hostname === 'localhost'
    if (!(bu.protocol === 'https:' && bu.hostname === 'app.grubano.com') && !loop) return fail('1 env: probe base not staging')
  } catch { return fail('1 env: probe base invalid') }
  try { H.loadRuntimeEnv(APP_ROOT) } catch (e) { return fail('1 env: loader ' + scrub(e)) }
  const rt = H.envFacts(process.env)
  if (rt.stripeMode !== 'TEST') return fail('1 env: Stripe key mode ' + rt.stripeMode + ' — refusing (TEST only)')

  F('MODE', MODE + (MODE === 'window' ? ' (TTL-BOUNDED CLAIMS WINDOW — auto-close)' : ' (READ-ONLY)'))
  F('DATABASE', dbName + ' (staging-named) · DATABASE_URL available ' + (rt.databaseUrl ? 'YES' : 'NO'))
  F('STRIPE MODE', rt.stripeMode)
  for (const k of ['CLAIMS_ENABLED', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED', 'CLAIM_AUTO_APPROVE_MAX_CENTS', 'REFUNDS_ENABLED', 'ALLOW_PLATFORM_FALLBACK']) {
    const v = merged[k]
    F(k + ' (file, Next view)', v === undefined ? 'ABSENT → effective false/0' : JSON.stringify(v))
  }
  // Any automation with a financial effect must stay structurally closed for a rehearsal.
  for (const k of ['CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED', 'ALLOW_PLATFORM_FALLBACK']) {
    if (merged[k] === 'true') A('1 env: ' + k + ' is true — an automatic money path would be reachable; refusing to rehearse')
  }

  // LIVE process truth (a file value is not what the running process holds).
  // AUDIT FIX (P1): /api/admin/claims/auto-approve answers 403 {gated:true} for BOTH flags
  // (CLAIMS_ENABLED off, and CLAIMS_AUTO_APPROVE_ENABLED off), so it can never distinguish an
  // OPEN claims gate — the window could never open and 'proven closed' was a tautology.
  // POST /api/claims is governed by CLAIMS_ENABLED alone: 403 {gated:true} closed, 401 open.
  const claimsGate0 = await probeGate(base, '/api/claims')
  const refundGate0 = await probeGate(base, '/api/admin/refunds/run')
  F('CLAIMS GATE (live process, POST /api/claims unauthenticated)', claimsGate0 + ' (CLOSED = 403 gated = CLAIMS_ENABLED false in the process ; OPEN = 401 = auth required, so the flag is ON)')
  // Separate probe: the auto-approve route names the flag that refused it, which is the only
  // way to see CLAIMS_AUTO_APPROVE_ENABLED from outside once CLAIMS itself is on.
  try {
    const r = await fetch(base + '/api/admin/claims/auto-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual' })
    const b = await r.json().catch(() => null)
    F('AUTO-APPROVE ROUTE (live process)', r.status + (b && b.flag ? ' refused by ' + b.flag : (b && b.gated ? ' gated' : '')))
    if (r.status === 401) A('1 gate: the auto-approve sweep is REACHABLE (both claims flags on) — it refunds without a human; refusing to rehearse')
  } catch { F('AUTO-APPROVE ROUTE (live process)', 'NOT MEASURED') }
  F('REFUND GATE (live process, unauthenticated probe)', refundGate0 + ' (must stay CLOSED for the whole claims rehearsal)')
  if (refundGate0 !== 'CLOSED') A('1 gate: the REFUND gate is not CLOSED — a claims rehearsal must never run beside an open money window')

  console.log('[2] Claim table proof + target BEFORE state (read-only)')
  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  let prisma = null
  if (prismaRes.ok && rt.databaseUrl) {
    try { const { PrismaClient } = require(prismaRes.path); prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) }
    catch (e) { A('2 db: prisma construct ' + scrub(e)) }
  } else A('2 db: prisma not available (' + (prismaRes.ok ? 'no DATABASE_URL' : prismaRes.error) + ')')

  let targetOk = false
  if (prisma) {
    try {
      // Claim-table proof: the model must be reachable BEFORE any rehearsal is considered.
      const total = await prisma.claim.count()
      // ROUND-11 AUDIT FIX (P3): a failed groupBy printed « no rows » — a measured empty population. Not measured is said as such.
      const byStatus = await prisma.claim.groupBy({ by: ['status'], _count: true }).catch(() => null)
      F('CLAIM TABLE (DB)', 'reachable · ' + total + ' row(s) · ' + (byStatus === null ? 'byStatus NOT MEASURED (groupBy failed)' : byStatus.length ? byStatus.map((g) => g.status + ':' + g._count).join(' ') : 'no rows'))
      if (byStatus === null) A('2 db: claim groupBy failed — the per-status population is NOT MEASURED')
      const stuck = await prisma.claim.count({ where: { status: 'refunding' } })
      // AUDIT FIX (T-49 audit): a claim parked in FINANCIAL VERIFICATION also holds activeOrderKey
      // and is an OPEN MONEY CASE. Ignoring it declared a locked fixture READY and would have added
      // rehearsal noise on top of an unresolved transaction.
      const parked = await prisma.claim.count({ where: { status: 'financial_verification' } })
      if (parked > 0) A('2 db: ' + parked + ' claim(s) in financial_verification (money truth unresolved) — resolve them BEFORE a rehearsal')
      const silence = await prisma.claim.count({ where: { status: 'restaurant_review', responseDeadlineAt: { lte: new Date() } } })
      F('CLAIMS NEEDING A HUMAN BEFORE THE REHEARSAL', 'refunding ' + stuck + ' · restaurant silence expired ' + silence)
      if (stuck > 0) A('2 db: ' + stuck + ' claim(s) already stuck in refunding — resolve them BEFORE adding rehearsal noise')

      if (TARGET_ORDER_ID) {
        const order = await prisma.order.findUnique({
          where:  { id: TARGET_ORDER_ID },
          select: { id: true, status: true, paymentStatus: true, total: true, consumerId: true, restaurantId: true, updatedAt: true },
        })
        if (!order) A('2 db: target order ' + TARGET_ORDER_ID + ' NOT FOUND')
        else {
          const refunds = await prisma.refund.findMany({ where: { orderId: order.id }, select: { status: true, amountCents: true } })
          const claims = await prisma.claim.findMany({ where: { orderId: order.id }, select: { id: true, status: true, requestedAmountCents: true, refundId: true, createdAt: true } })
          F('TARGET ORDER (DB, BEFORE)', 'GR-' + order.id.slice(-6).toUpperCase() + ' · status ' + order.status + ' · paymentStatus ' + order.paymentStatus + ' · total € ' + order.total)
          F('TARGET REFUND ROWS (BEFORE)', refunds.length ? refunds.map((r) => r.status + ':' + r.amountCents).join(' | ') : 'none')
          F('TARGET CLAIM ROWS (BEFORE)', claims.length ? claims.map((c) => mask(c.id) + ':' + c.status + ':' + c.requestedAmountCents).join(' | ') : 'none')
          if (order.paymentStatus !== 'paid') A('2 db: target order is not paid — a claim would be refused')
          // AUDIT FIX (T-49 audit): this list must mirror ACTIVE_STATUSES in lib/claims.ts, which gained
          // 'financial_verification'. A parked money case still holds activeOrderKey, so omitting it
          // declared a LOCKED fixture READY and would have added rehearsal noise on an open transaction.
          if (claims.some((c) => ['restaurant_review', 'approved', 'refunding', 'arbitration', 'financial_verification'].includes(c.status))) {
            A('2 db: the target order already has an ACTIVE claim — a rehearsal claim would collide on activeOrderKey')
          } else targetOk = order.paymentStatus === 'paid'
        }
      } else F('TARGET ORDER', 'NOT SPECIFIED (set PHASE2_CLAIMS_ORDER_ID to pin the fixture — required for a window)')
    } catch (e) { A('2 db: ' + scrub(e)) } finally { await prisma.$disconnect().catch(() => {}) }
  }

  if (MODE === 'precheck') {
    F('WINDOW READINESS', anomalies.length ? 'BLOCKED — see anomalies' : (TARGET_ORDER_ID ? (targetOk ? 'READY (needs the founder sentence)' : 'BLOCKED — target unusable') : 'READY once a target fixture is pinned'))
    F('REHEARSAL MODE A (claims only, no money)', 'this operator — opens CLAIMS_ENABLED only, requires the refund gate CLOSED and re-checks it throughout')
    F('REHEARSAL MODE B (claims + refund)', 'NOT this operator — needs a separate founder-authorized refund window (phase2-refund-gate.js). The two authorities never merge.')
    F('T-48 (expiring refund authorization)', 'IMPLEMENTED in lib/refund: a refund window now needs REFUNDS_ENABLED=true AND a valid REFUNDS_WINDOW_UNTIL deadline (max 30 min), re-checked by the app on every call — a killed process can no longer leave the money gate open for ever.')
    return done(anomalies.length ? 'FAIL' : 'PASS')
  }

  // ── WINDOW MODE — CLAIMS ONLY, TTL-BOUNDED, FAIL-CLOSED ─────────────────────────
  console.log('[3] claims window')
  // TWO DISTINCT AUTHORITIES (batch 2). Mode A (this operator) rehearses the WORKFLOW with
  // REFUNDS closed: creation, ownership, restaurant review, silence expiry, admin visibility,
  // arbitration — no money can move. Mode B (claims + refund) needs a REFUND window, which is
  // a SEPARATE authority granted only by the refund operator. A claims window must never open
  // a refund window implicitly, so this operator refuses the request outright and says why.
  if (process.env.PHASE2_CLAIMS_WITH_REFUNDS === '1') {
    return fail('3 window: PHASE2_CLAIMS_WITH_REFUNDS=1 asks THIS operator to open a MONEY-MOVING rehearsal. REFUSED BY DESIGN — this operator only ever writes CLAIMS_ENABLED. A claims+refund rehearsal requires a separate, founder-authorized refund window (scripts/server/phase2-refund-gate.js), which now carries a T-48 expiring lease. Nothing changed.')
  }
  if (process.env.PHASE2_CLAIMS_WINDOW_CONFIRM !== CONFIRM_SENTENCE) return fail('3 window: confirm sentence missing — nothing changed')
  if (anomalies.length) return fail('3 window: precheck anomalies — window REFUSED, nothing changed')
  if (!TARGET_ORDER_ID || !targetOk) return fail('3 window: no usable target fixture (PHASE2_CLAIMS_ORDER_ID) — window REFUSED, nothing changed')
  if (claimsGate0 !== 'CLOSED') return fail('3 window: CLAIMS gate is not CLOSED before opening — refusing')
  if (refundGate0 !== 'CLOSED') return fail('3 window: REFUND gate is not CLOSED — refusing to open claims beside a money window')
  if (!Number.isFinite(TTL_MS) || TTL_MS <= 0 || TTL_MS > 60 * 60 * 1000) return fail('3 window: TTL must be a finite duration ≤ 60 min')
  // The operator must not outlive its own authorization: the lease is capped by the compiled
  // ceiling, so a TTL that needs more than the ceiling would leave this script polling and
  // printing WINDOW OPEN on a surface the application had already closed.
  if (TTL_MS + RELOAD_DEADLINE_MS + 120000 > 60 * 60 * 1000) {
    return fail('3 window: PHASE2_CLAIMS_WINDOW_MS=' + Math.round(TTL_MS / 60000) + ' min exceeds what the T-53 lease can cover (lease = window + 2 min, ceiling 60 min). Set it to 58 min or less. Nothing changed.')
  }

  // §20 MODE A RESIDUE — every claim this rehearsal creates must be tracked by id, so a window
  // that ends badly cannot leave rows nobody knows about. Turning CLAIMS_ENABLED back off HIDES
  // non-terminal claims (arbitration and overdue restaurant_review drop out of the gated admin
  // count), so 'nothing on screen afterwards' proves nothing. Ids are taken before and after,
  // and the difference is reported whatever the outcome.
  const idsBefore = new Set()
  if (prisma) {
    residuePrisma = prisma
    try {
      ;(await prisma.claim.findMany({ select: { id: true } })).forEach((c) => idsBefore.add(c.id))
      residueBaseline = idsBefore // set ONLY on success: a failed snapshot must not look like an empty one
    } catch (e) { A('3 residue: could not snapshot claim ids before the window - ' + scrub(e)) }
  }

  const stamp = new Date().toISOString()
  try {
    armedClose = { envFile, stamp } // ARM BEFORE the write
    // T-53 — the flag alone authorizes nothing any more. Write an ABSOLUTE deadline the
    // application re-checks on every call, so the window dies of old age through SIGKILL, a
    // host crash or a reboot, with nobody acting. Lease FIRST, flag second: the reverse order
    // would leave a brief instant where the flag is true with no deadline behind it.
    // AUDIT FIX (T-49 audit): the lease was anchored at the WRITE, but the TTL loop only starts
    // after waiting for the process to reload the flag (up to RELOAD_DEADLINE_MS). A slow reload
    // ate into the margin and the operator could outlive its own authorization — printing WINDOW
    // OPEN on a surface the application had already closed. The reload budget is included.
    const leaseUntil = new Date(Date.now() + Math.min(TTL_MS + RELOAD_DEADLINE_MS + 120000, 60 * 60 * 1000)).toISOString()
    writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', leaseUntil, stamp)
    F('T-53 CLAIMS AUTHORIZATION LEASE', 'CLAIMS_WINDOW_UNTIL=' + leaseUntil + ' — after this instant the claims surface is CLOSED by the application itself, with nobody acting (SIGKILL / host crash included). It grants NO refund authority.')
    const opened = writeFlag(envFile, 'CLAIMS_ENABLED', 'true', stamp)
    F('CLAIMS WINDOW OPEN WRITE', opened.changed ? 'CLAIMS_ENABLED=true (backup ' + opened.backup + ')' : 'no change')
    F('EMERGENCY CLOSE', 'ARMED (process-local: signals + uncaught throw). It is NOT and cannot be a SIGKILL handler — that is exactly why the T-53 lease exists: after the deadline the surface is denied even if this cleanup never ran.')
    touchRestart()
    const w1 = await waitGate(base, '/api/claims', 'OPEN', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
    F('CLAIMS GATE AFTER OPEN', w1.last + ' after ' + Math.round(w1.elapsedMs / 1000) + ' s')
    if (!w1.ok) throw new Error('claims gate did not open (still ' + w1.last + ')')
    F('WINDOW', 'OPEN at ' + new Date().toISOString() + ' — TTL ' + Math.round(TTL_MS / 60000) + ' min. REFUNDS stays CLOSED: an approved claim will rest at "approved" with the refund pending activation, NO money moves.')

    const t0 = Date.now()
    while (Date.now() - t0 < TTL_MS) {
      // Continuously re-prove the money gate stayed shut for the whole window.
      const rg = await probeGate(base, '/api/admin/refunds/run')
      if (rg !== 'CLOSED') { A('3 window: the REFUND gate changed to ' + rg + ' DURING the claims window — closing immediately'); break }
      await sleep(POLL_MS)
    }
    F('WINDOW END', 'TTL reached or aborted at ' + new Date().toISOString())
  } catch (e) { A('3 window: ' + scrub(e)) } finally {
    // UNCONDITIONAL CLOSE
    try {
      // Expire the lease FIRST: even if the flag write below fails, the application is already
      // refusing the surface. Order matters — belt before braces.
      writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', new Date(Date.now() - 1000).toISOString(), stamp + 'Z')
      const closed = writeFlag(envFile, 'CLAIMS_ENABLED', 'false', stamp + 'Z')
      armedClose = null // disarm ONLY once false is on disk
      F('CLAIMS WINDOW CLOSE WRITE', closed.changed ? 'CLAIMS_ENABLED=false (backup ' + closed.backup + ')' : 'no change')
      touchRestart()
      const w2 = await waitGate(base, '/api/claims', 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
      F('CLAIMS GATE AFTER CLOSE', w2.last + ' after ' + Math.round(w2.elapsedMs / 1000) + ' s')
      if (!w2.ok) A('3 close: CLAIMS gate NOT proven CLOSED (' + w2.last + ') — HUMAN ATTENTION REQUIRED')
      const rg = await probeGate(base, '/api/admin/refunds/run')
      F('REFUND GATE AFTER CLOSE', rg)
      if (rg !== 'CLOSED') A('3 close: the REFUND gate is not CLOSED — HUMAN ATTENTION REQUIRED')
    } catch (e) { A('3 close: ' + scrub(e)) }
  }
  // AUDIT FIX (T-49 audit): the residue report sat on the happy path only, so aborting the
  // rehearsal (a precheck anomaly, Ctrl-C, an uncaught throw) skipped it entirely — exactly
  // when residue is most likely. It is a function now, and the abort paths call it too.
  await reportResidue()

  return done(anomalies.length ? 'FAIL' : 'PASS')
}

if (require.main === module) main().catch((e) => fail('unexpected: ' + scrub(e)))

module.exports = {
  writeFlag, emergencyClose, armClose: (envFile, stamp) => { armedClose = { envFile, stamp } }, isCloseArmed: () => armedClose !== null, CONFIRM_SENTENCE,
  // ROUND-6 test seams: the residue report and its inputs, so a test can prove the abort path
  // reports residue WITHOUT calling done() (which sets process.exitCode and schedules exit).
  reportResidue,
  _setResidueForTests: (prismaHandle, baseline) => { residuePrisma = prismaHandle; residueBaseline = baseline },
  // F()/A() append to the report printed by done(); a test reads them here instead of calling done().
  _residueLinesForTests: () => ({ facts: facts.slice(), anomalies: anomalies.slice() }),
}
