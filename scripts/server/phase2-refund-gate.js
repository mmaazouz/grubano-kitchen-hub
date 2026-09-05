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

const MODE = process.argv[2] === 'window' ? 'window' : 'precheck'
const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID = process.env.PHASE2_REFUND_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const AMOUNT_CENTS = Number(process.env.PHASE2_REFUND_AMOUNT_CENTS || 500)
const CONFIRM_SENTENCE = 'I AUTHORIZE THE STAGING REFUND REHEARSAL'
const WINDOW_DEADLINE_MS = Number(process.env.PHASE2_REFUND_WINDOW_MS || 15 * 60 * 1000)
const RELOAD_DEADLINE_MS = Number(process.env.PHASE2_RELOAD_DEADLINE_MS || 240000)
const RELOAD_INTERVAL_MS = Number(process.env.PHASE2_RELOAD_INTERVAL_MS || 10000)
const POLL_MS = Number(process.env.PHASE2_REFUND_POLL_MS || 15000)

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
const mask = (s) => (typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : (s ? '***' : 'null'))
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let verdict = 'NOT MEASURED'

function done(result, failedStep) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 REFUND ' + (MODE === 'window' ? 'WINDOW' : 'REHEARSAL PRECHECK') + ' (staging) — every value below is MEASURED')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  console.log('FIRST REHEARSAL: ' + verdict)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  process.exitCode = result.startsWith('PASS') || result.startsWith('WAIT') ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step) => done('FAIL', step)

async function probeGate(base) {
  try {
    const r = await fetch(base + '/api/admin/refunds/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'grubano-phase2-refund-gate/1' }, body: '{}', redirect: 'manual' })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && b.gated === true) return 'CLOSED'
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

async function main() {
  console.log('[1] identity + env (mode ' + MODE + ')')
  const envFile = path.join(APP_ROOT, '.env.local')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT)
  const texts = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const merged = prov.mergeNextEnvFiles(texts).merged
  const dbName = ((merged.DATABASE_URL || '').match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (/prod/i.test(dbName)) return fail('1 env: PROD-named database (' + dbName + ') — refusing')
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
  const gate0 = await probeGate(base)
  F('REFUND GATE (live process, unauthenticated probe)', gate0 + ' (CLOSED = 403 gated = REFUNDS_ENABLED false in the process)')
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

  let order = null, piId = null, consumerEmailDomain = 'NOT MEASURED', loyalty = null, refundRows = [], claims = 0, audits = 0, ledgerRefundLines = 0
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
    loyalty = { earnRow: !!earnRow, earnPoints: earnRow ? earnRow.points : 0, balance: lc ? lc.pointsBalance : null, offset: lc ? lc.recoveryOffsetPoints : null, custId: lc ? lc.id : custId }
    F('LOYALTY customer (DB)', lc ? 'pointsBalance ' + lc.pointsBalance + ' · recoveryOffsetPoints ' + lc.recoveryOffsetPoints : 'none')
    F('CONSUMER EMAIL DOMAIN (DB, masked)', consumerEmailDomain)
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
      F('CHARGE (Stripe)', mask(ch.id) + ' · status ' + ch.status + ' · captured ' + ch.amount_captured + ' · amount_refunded ' + ch.amount_refunded + ' · refunded ' + ch.refunded)
      F('REMAINING CASH REFUNDABLE (Stripe)', String(ch.amount_captured - ch.amount_refunded))
      if (ch.amount_captured - ch.amount_refunded < AMOUNT_CENTS) A('4 stripe: remaining refundable < ' + AMOUNT_CENTS)
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
    F('REQUIRED TRANSFER REVERSAL', String(reversal))
    if (order && loyalty) {
      const cum = (base, x) => Math.round((base * x) / T)
      const earnRev = loyalty.earnRow ? cum(order.pointsEarned, C) - cum(order.pointsEarned, Cprev) : 0
      const spentRestore = cum(order.pointsRedeemed, C) - cum(order.pointsRedeemed, Cprev)
      const offsetDelta = loyalty.balance == null ? 'NOT MEASURED' : Math.max(0, earnRev - Math.max(0, loyalty.balance))
      F('EXPECTED LOYALTY (planLoyaltyRefund formula with MEASURED inputs)', 'earn reversal ' + earnRev + (loyalty.earnRow ? '' : ' (no earn row → 0)') + ' · spent restore ' + spentRestore + ' · recovery offset delta ' + offsetDelta)
    }
    var requiredReversal = reversal
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
      F('AVAILABLE BALANCE SUFFICIENT (available >= required reversal)', available >= requiredReversal ? 'YES' : 'NO (' + available + ' < ' + requiredReversal + ')')
      if (available < requiredReversal) verdict = 'WAIT — connected AVAILABLE ' + available + ' c < required reversal ' + requiredReversal + ' c (pending ' + pending + ' c; no manufactured funds, no platform advance)'
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
  if (!verdict.startsWith('READY')) return fail('7 window: precheck verdict ' + verdict + ' — window REFUSED, nothing changed')
  if (gate0 !== 'CLOSED') return fail('7 window: gate not CLOSED before opening — refusing')
  const stamp = new Date().toISOString()
  const refundsBefore = refunds.length
  let opened = null
  try {
    opened = writeFlag(envFile, 'REFUNDS_ENABLED', 'true', stamp)
    F('WINDOW OPEN WRITE', opened.changed ? 'REFUNDS_ENABLED=true (backup ' + opened.backup + ')' : 'no change')
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
    // UNCONDITIONAL RE-FREEZE
    try {
      const closed = writeFlag(envFile, 'REFUNDS_ENABLED', 'false', stamp + 'Z')
      F('WINDOW CLOSE WRITE', closed.changed ? 'REFUNDS_ENABLED=false (backup ' + closed.backup + ')' : 'no change')
      touchRestart()
      const w2 = await waitGate(base, 'CLOSED', RELOAD_DEADLINE_MS, RELOAD_INTERVAL_MS)
      F('GATE AFTER CLOSE', w2.last + ' after ' + Math.round(w2.elapsedMs / 1000) + ' s')
      if (!w2.ok) A('7 refreeze: gate NOT proven CLOSED (' + w2.last + ') — HUMAN ATTENTION REQUIRED')
    } catch (e) { A('7 refreeze: ' + scrub(e)) }
  }
  return done(anomalies.length ? 'FAIL' : 'PASS')
}

main().catch((e) => fail('unexpected: ' + scrub(e)))
