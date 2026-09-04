'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase2-preflight.js — PHASE 2 FINAL HARDENING / PREFLIGHT RECOVERY (staging, one-shot, v2)

   Run ONCE on the staging server (cPanel Terminal), with the nodevenv node:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js

   v2 (2026-09-04) — after the v1 run MEASURED `REFUNDS_ENABLED=true` on staging (the
   technical refund freeze had never existed; only the operational freeze held). This
   version RESTORES the technical freeze and completes the preflight in ONE run:

     1. ENV      proves it runs inside the deployed STAGING app (schema + Phase 2 build markers,
                 NEXTAUTH_URL on app.grubano.com, no "prod" database name, Stripe key TEST).
     2. BACKUP   copies .env.local to .env.local.bak-phase2-<stamp> (mode 600).
     3. WRITE    sets  REFUNDS_ENABLED=false  (technical freeze — P0),
                       ALERT_EMAIL=admin-qa@grubano.com,
                       LOGISTICS_SIGNUP_ENABLED=false  (founder-authorised: the flag opens a
                       reachable public courier waitlist signup — /business/logistics landing,
                       form, POST /api/logistics/register — while DELIVERY is out of beta),
                 preserving every other line byte-for-byte; re-reads the file to prove it.
     4. FLAGS    prints the EFFECTIVE value of every money flag from the RE-READ file
                 (ABSENT → EFFECTIVE FALSE) and FAILS if any auto-money flag, REFUNDS_ENABLED
                 or CLAIMS_ENABLED is 'true' after the write.
     5. MAIL     sends ONE safe, non-financial MONEY REVIEW *test* e-mail through the app's own
                 SMTP settings to ALERT_EMAIL; prints the provider's acceptance line.
     6. REFUNDS  READ-ONLY: proves no unexpected refund happened while the flag was true —
                 Refund rows (count, latest), AdminAuditLog 'refund.run' since 2026-08-29,
                 'refund' ledger lines since 2026-08-29.
     7. ORDER    READ-ONLY facts of GR-N5TSM0 (id …n5tsm0): money, loyalty rows, refunds, ledger,
                 franchise royalty row, loyalty customer → DISPOSABLE verdict.
     8. FRANCH   READ-ONLY franchise reachability counts.
     9. LEDGER   calls the app's read-only GET /api/admin/ledger/check (7 days) with the
                 internal token from the env (never printed); prints the verdict.
    10. RESTART  touches tmp/restart.txt (the env changed → Passenger reloads).

   Fail-closed: first anomaly → RESULT: FAIL + FAILED STEP, non-zero exit. Idempotent.
   NO refund. NO Stripe write. NO money. NO schema. NO secret printed (presence only; ids
   truncated; DATABASE_URL reduced to its database name). Every printed value is MEASURED
   from the server (file or DB) and tagged as such.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')

const APP_ROOT     = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID     = process.env.PHASE2_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const TARGET_ALERT = process.env.PHASE2_ALERT_EMAIL || 'admin-qa@grubano.com'
const WINDOW_START = new Date('2026-08-29T00:00:00Z') // start of the measured TRUE-flag window
// The writes this operator performs (founder-authorised, staging only).
const ENV_WRITES = {
  REFUNDS_ENABLED:          'false',
  ALERT_EMAIL:              TARGET_ALERT,
  LOGISTICS_SIGNUP_ENABLED: 'false',
}
const MONEY_FLAGS_MUST_BE_FALSE = ['REFUNDS_ENABLED', 'CLAIMS_ENABLED', 'CLAIMS_AUTO_APPROVE_ENABLED', 'GHOST_ORDER_AUTO_REFUND_ENABLED']
const FLAGS_TO_PRINT = [
  ...MONEY_FLAGS_MUST_BE_FALSE,
  'FRANCHISE_ENABLED', 'FRANCHISE_ROYALTY_ENABLED', 'FRANCHISE_SETTLEMENT_ENABLED',
  'TIPS_ENABLED', 'LOGISTICS_PAYOUT_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED', 'CHARGEBACKS_ENABLED',
  'ALLOW_PLATFORM_FALLBACK', 'RATE_LIMIT_ENABLED', 'ADMIN_AUDIT_ENABLED',
]

const facts = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const mask = (s) => (typeof s === 'string' && s.length > 8 ? s.slice(0, 4) + '***' + s.slice(-4) : (s ? '***' : 'null'))
const eff = (v) => (v === undefined ? 'ABSENT → EFFECTIVE FALSE' : (v === 'true' ? 'true' : JSON.stringify(v) + ' → EFFECTIVE FALSE'))

function done(result, failedStep, action) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 PREFLIGHT v2 (staging) — every value below is MEASURED on the server')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  console.log('SAFE TO CONTINUE: ' + (result === 'PASS' ? 'YES' : 'NO'))
  console.log('ACTION: ' + (action || 'PASTE THIS WHOLE OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(result === 'PASS' ? 0 : 1)
}
const fail = (step, action) => done('FAIL', step, action)

function parseEnv(txt) {
  const parsed = {}
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    parsed[line.slice(0, i).trim()] = v
  }
  return parsed
}

/** Rewrite .env.local: replace the value of each key in `writes` in place (first occurrence),
 *  append missing ones, keep every other line byte-for-byte. Returns the new text + changes. */
function rewriteEnv(txt, writes) {
  const lines = txt.split(/\r?\n/)
  const eol = txt.includes('\r\n') ? '\r\n' : '\n'
  const seen = new Set()
  const changes = []
  const out = lines.map((l) => {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!m || !(m[1] in writes) || seen.has(m[1])) return l
    seen.add(m[1])
    const before = m[2].trim().replace(/^"|"$/g, '')
    if (before !== writes[m[1]]) changes.push(m[1] + ': ' + JSON.stringify(before) + ' → ' + JSON.stringify(writes[m[1]]))
    return m[1] + '=' + writes[m[1]]
  })
  for (const k of Object.keys(writes)) {
    if (seen.has(k)) continue
    if (out.length && out[out.length - 1] !== '') out.push('')
    out.push('# Phase 2 preflight v2 (' + new Date().toISOString().slice(0, 10) + ') — ' + k)
    out.push(k + '=' + writes[k])
    changes.push(k + ': ABSENT → ' + JSON.stringify(writes[k]))
  }
  let text = out.join(eol)
  if (!text.endsWith(eol)) text += eol
  return { text, changes }
}

async function main() {
  // ── 1. ENV ────────────────────────────────────────────────────────────────
  console.log('[1/10] env')
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
  const before = parseEnv(originalTxt)
  const dbUrl = before.DATABASE_URL || ''
  const dbName = (dbUrl.match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (!dbUrl) return fail('1 env: DATABASE_URL absent')
  if (/prod/i.test(dbName)) return fail('1 env: DATABASE_URL points at a PROD-named database (' + dbName + ')', 'refusing — staging only')
  const nextauthUrl = before.NEXTAUTH_URL || ''
  if (!/app\.grubano\.com/.test(nextauthUrl)) return fail('1 env: NEXTAUTH_URL is not the staging origin (' + nextauthUrl + ')', 'refusing — staging only')
  const stripeMode = (before.STRIPE_SECRET_KEY || '').startsWith('sk_test_') ? 'TEST' : ((before.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'LIVE' : 'ABSENT/UNKNOWN')
  if (stripeMode !== 'TEST') return fail('1 env: Stripe key mode is ' + stripeMode, 'refusing — TEST only')
  F('SOURCE', 'staging server ' + APP_ROOT + ' (.env.local + DB + compiled build)')
  F('DEPLOYED SHA', version)
  F('PHASE 2 BUILD MARKERS', 'PRESENT (refund status branch + F2 hardening)')
  F('DATABASE', dbName + ' (staging-named)')
  F('NEXTAUTH_URL', nextauthUrl)
  F('STRIPE_SECRET_KEY mode', stripeMode)
  F('STRIPE_WEBHOOK_SECRET present', String(!!before.STRIPE_WEBHOOK_SECRET))
  F('SMTP_HOST', before.SMTP_HOST || 'ABSENT (default mail.grubano.com)')
  F('SMTP_USER / SMTP_PASS present', !!before.SMTP_USER + ' / ' + !!before.SMTP_PASS)
  F('INTERNAL_CRON_TOKEN present', String(!!(before.INTERNAL_CRON_TOKEN || '').trim()))
  F('REFUNDS_ENABLED BEFORE (measured file)', eff(before.REFUNDS_ENABLED))
  F('ALERT_EMAIL BEFORE (measured file)', before.ALERT_EMAIL === undefined ? 'ABSENT' : before.ALERT_EMAIL)
  F('LOGISTICS_SIGNUP_ENABLED BEFORE (measured file)', eff(before.LOGISTICS_SIGNUP_ENABLED))

  // ── 2. BACKUP ─────────────────────────────────────────────────────────────
  console.log('[2/10] backup')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = envFile + '.bak-phase2-' + stamp
  fs.copyFileSync(envFile, backup)
  try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
  if (fs.readFileSync(backup, 'utf8') !== originalTxt) return fail('2 backup: backup content mismatch')
  F('ENV BACKUP', path.basename(backup) + ' (mode 600, ' + originalTxt.length + ' bytes)')

  // ── 3. WRITE (technical freeze + alert channel + courier signup) ──────────
  console.log('[3/10] write')
  const { text, changes } = rewriteEnv(originalTxt, ENV_WRITES)
  let envChanged = false
  if (changes.length === 0) {
    F('ENV WRITE', 'NO CHANGE NEEDED (all three keys already at target)')
  } else {
    fs.writeFileSync(envFile, text, { mode: 0o600 })
    try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
    envChanged = true
    F('ENV WRITE', changes.join(' ; '))
  }
  const after = parseEnv(fs.readFileSync(envFile, 'utf8'))
  for (const [k, v] of Object.entries(ENV_WRITES)) {
    if (after[k] !== v) return fail('3 write: re-read ' + k + ' = ' + JSON.stringify(after[k]) + ' (expected ' + JSON.stringify(v) + ')', 'restore from ' + path.basename(backup))
  }
  // Every non-written key must be preserved byte-for-byte.
  for (const k of Object.keys(before)) {
    if (k in ENV_WRITES) continue
    if (after[k] !== before[k]) return fail('3 write: unrelated key ' + k + ' changed', 'restore from ' + path.basename(backup))
  }
  F('REFUNDS_ENABLED AFTER (measured file)', eff(after.REFUNDS_ENABLED))
  F('ALERT_EMAIL AFTER (measured file)', after.ALERT_EMAIL)
  F('LOGISTICS_SIGNUP_ENABLED AFTER (measured file)', eff(after.LOGISTICS_SIGNUP_ENABLED))
  F('UNRELATED ENV KEYS PRESERVED', 'YES (' + Object.keys(before).filter((k) => !(k in ENV_WRITES)).length + ' keys byte-identical)')
  for (const [k, v] of Object.entries(after)) if (process.env[k] === undefined) process.env[k] = v

  // ── 4. FLAGS (from the RE-READ file) ──────────────────────────────────────
  console.log('[4/10] flags')
  for (const k of FLAGS_TO_PRINT) F('FLAG ' + k + ' (measured file)', eff(after[k]))
  for (const k of MONEY_FLAGS_MUST_BE_FALSE) {
    if (after[k] === 'true') return fail('4 flags: ' + k + ' is TRUE after the write', 'human decision required')
  }
  F('RUNTIME PROCESS RELOAD', 'NOT OBSERVABLE FROM THIS SCRIPT — restart.txt is touched in step 10; the running process reads the file at its next start (Passenger semantics)')

  // ── 5. MAIL — safe non-financial test alert ───────────────────────────────
  console.log('[5/10] test alert')
  let nodemailer
  try { nodemailer = require(require.resolve('nodemailer', { paths: [APP_ROOT] })) } catch { return fail('5 mail: nodemailer not resolvable from ' + APP_ROOT) }
  if (!after.SMTP_PASS) return fail('5 mail: SMTP_PASS absent in .env.local')
  const transporter = nodemailer.createTransport({
    host: after.SMTP_HOST || 'mail.grubano.com', port: 587, secure: false,
    auth: { user: after.SMTP_USER || 'contact@grubano.com', pass: after.SMTP_PASS },
  })
  const now = new Date().toISOString()
  try {
    const info = await transporter.sendMail({
      from: '"Grubano" <contact@grubano.com>',
      to: TARGET_ALERT,
      subject: '[Grubano] MONEY REVIEW — TEST préflight Phase 2 v2 (aucun argent) ' + now.slice(0, 16),
      html: '<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">'
        + '<h2 style="font-size:17px">Test du canal MONEY REVIEW (staging)</h2>'
        + '<p>E-mail de TEST envoyé par l’opérateur de préflight Phase 2 v2. <b>Aucun remboursement, aucun mouvement d’argent, aucune modification de données.</b></p>'
        + '<p style="font-size:13px;color:#6b7280">Horodatage : ' + now + ' · Build : ' + version + ' · Destination : ' + TARGET_ALERT + '</p></div>',
    })
    F('TEST ALERT accepted (provider)', JSON.stringify(info.accepted || []))
    F('TEST ALERT rejected (provider)', JSON.stringify(info.rejected || []))
    F('TEST ALERT provider response', String(info.response || '').slice(0, 120))
    F('TEST ALERT messageId', String(info.messageId || ''))
    F('TEST ALERT inbox receipt', 'NOT MEASURED (human confirmation optional)')
    if (!info.accepted || !info.accepted.includes(TARGET_ALERT)) return fail('5 mail: provider did not accept ' + TARGET_ALERT)
  } catch (e) {
    return fail('5 mail: send failed — ' + String(e && e.message ? e.message : e).slice(0, 200))
  }

  // ── 6–8. DB (READ-ONLY) ───────────────────────────────────────────────────
  let PrismaClient
  try { ({ PrismaClient } = require(require.resolve('@prisma/client', { paths: [APP_ROOT] }))) } catch { return fail('6 db: @prisma/client not resolvable from ' + APP_ROOT) }
  const prisma = new PrismaClient()
  try {
    console.log('[6/10] no unexpected refund (window since ' + WINDOW_START.toISOString().slice(0, 10) + ')')
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
    // The only expected refund in the window is the Z1 rehearsal refund of 2026-08-29 (14,50 €).
    const unexpected = refundsInWindow.filter((r) => !(r.amountCents === 1450 && r.createdAt.toISOString().startsWith('2026-08-29')))
    F('UNEXPECTED REFUND DURING TRUE-FLAG WINDOW (DB)', unexpected.length === 0 ? 'NO' : 'YES — ' + unexpected.length + ' row(s) (see above)')
    if (unexpected.length) return fail('6 refunds: unexpected Refund row(s) in the true-flag window', 'HARD STOP — reconcile before continuing')

    console.log('[7/10] order GR-' + ORDER_ID.slice(-6).toUpperCase())
    const order = await prisma.order.findUnique({
      where: { id: ORDER_ID },
      select: { id: true, restaurantId: true, consumerId: true, status: true, paymentStatus: true, subtotal: true, deliveryFee: true, total: true, pointsEarned: true, pointsRedeemed: true, loyaltyCreditCents: true, pointOfSaleId: true, stripePaymentIntentId: true, createdAt: true },
    })
    if (!order) return fail('7 order: ' + ORDER_ID + ' not found on staging')
    const resto = await prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true, stripeAccountStatus: true, stripeAccountId: true } })
    F('ORDER ref (DB)', 'GR-' + order.id.slice(-6).toUpperCase() + ' (id …' + order.id.slice(-8) + ')')
    F('ORDER createdAt (DB)', order.createdAt.toISOString())
    F('ORDER status / paymentStatus (DB)', order.status + ' / ' + order.paymentStatus)
    F('ORDER restaurant (DB)', (resto ? resto.name : 'unknown') + ' · connect=' + (resto ? resto.stripeAccountStatus : 'n/a') + ' · acct=' + mask(resto && resto.stripeAccountId))
    F('ORDER subtotal / deliveryFee / total € (DB)', order.subtotal + ' / ' + order.deliveryFee + ' / ' + order.total)
    F('ORDER pointsRedeemed / loyaltyCreditCents / pointsEarned (DB)', order.pointsRedeemed + ' / ' + order.loyaltyCreditCents + ' / ' + order.pointsEarned)
    F('ORDER pointOfSaleId (DB)', order.pointOfSaleId || 'null')
    F('ORDER PI (DB)', mask(order.stripePaymentIntentId))
    if (order.paymentStatus !== 'paid') return fail('7 order: paymentStatus is ' + order.paymentStatus + ' (expected paid)')
    if (!order.stripePaymentIntentId) return fail('7 order: no stripePaymentIntentId')
    const lts = await prisma.loyaltyTransaction.findMany({ where: { orderId: order.id }, select: { type: true, points: true, sourceEventId: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    F('LOYALTY rows for order (DB)', lts.length ? lts.map((t) => t.type + ':' + t.points + (t.sourceEventId ? '(' + mask(t.sourceEventId) + ')' : '')).join(', ') : 'none')
    const refundRows = await prisma.refund.findMany({ where: { orderId: order.id }, select: { status: true, amountCents: true, stripeRefundId: true } })
    F('REFUND rows for order (DB)', refundRows.length ? refundRows.map((r) => r.status + ':' + r.amountCents + ':' + mask(r.stripeRefundId)).join(', ') : 'none')
    const ledger = await prisma.ledgerEntry.findMany({ where: { stripePaymentIntentId: order.stripePaymentIntentId }, select: { type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, stripeFeeAmount: true, routed: true }, orderBy: { createdAt: 'asc' } })
    F('LEDGER lines for PI (DB)', ledger.length ? ledger.map((l) => l.type + '{gross ' + l.grossAmount + ', fee ' + l.applicationFeeAmount + ', net ' + l.netToRestaurant + ', stripeFee ' + l.stripeFeeAmount + ', routed ' + l.routed + '}').join(' ; ') : 'none')
    const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: { royaltyCents: true, refundedCents: true, status: true } })
    F('FRANCHISE ROYALTY row for order (DB)', royalty ? JSON.stringify(royalty) : 'none (standard restaurant)')
    try {
      const op = await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
      const lc = op ? await prisma.loyaltyCustomer.findUnique({ where: { email: op.email }, select: { pointsBalance: true, recoveryOffsetPoints: true } }) : null
      F('LOYALTY customer (DB)', lc ? 'pointsBalance ' + lc.pointsBalance + ', recoveryOffsetPoints ' + lc.recoveryOffsetPoints : 'none')
    } catch (e) { F('LOYALTY customer (DB)', 'n/a (' + String(e.message || e).slice(0, 60) + ')') }
    F('ORDER DISPOSABLE (paid, 0 refund rows)', refundRows.length === 0 ? 'YES' : 'NO')

    console.log('[8/10] franchise')
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
    F('FRANCHISE_ENABLED effective (measured file)', after.FRANCHISE_ENABLED === 'true' ? 'ON' : 'OFF')
  } finally {
    await prisma.$disconnect().catch(() => {})
  }

  // ── 9. LEDGER CHECK (READ-ONLY route) ─────────────────────────────────────
  console.log('[9/10] ledger check')
  const tok = (after.INTERNAL_CRON_TOKEN || '').trim()
  if (!tok) return fail('9 ledger: INTERNAL_CRON_TOKEN absent in .env.local')
  const to = new Date(), from = new Date(to.getTime() - 7 * 24 * 3600 * 1000)
  const url = nextauthUrl.replace(/\/$/, '') + '/api/admin/ledger/check?from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString())
  try {
    const res = await fetch(url, { headers: { 'X-Internal-Token': tok, 'User-Agent': 'grubano-phase2-preflight/2' } })
    const body = await res.json().catch(() => ({}))
    F('LEDGER CHECK http', String(res.status))
    F('LEDGER CHECK ok / refundsOk', body.ok + ' / ' + body.refundsOk)
    F('LEDGER CHECK ledgerCount / stripeCount', body.ledgerCount + ' / ' + body.stripeCount)
    F('LEDGER CHECK ledgerSum / stripeSum', body.ledgerSum + ' / ' + body.stripeSum)
    F('LEDGER CHECK ecarts', JSON.stringify(body.ecarts || []).slice(0, 300))
    F('LEDGER CHECK refunds', JSON.stringify(body.refunds || {}).slice(0, 200))
    if (res.status !== 200) return fail('9 ledger: HTTP ' + res.status)
  } catch (e) {
    return fail('9 ledger: request failed — ' + String(e && e.message ? e.message : e).slice(0, 160))
  }

  // ── 10. RESTART ───────────────────────────────────────────────────────────
  console.log('[10/10] restart')
  try {
    fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
    fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), String(Date.now()))
    F('PASSENGER RESTART', 'TOUCHED tmp/restart.txt' + (envChanged ? ' (env changed)' : ' (env unchanged — touched anyway, harmless)'))
  } catch (e) {
    return fail('10 restart: could not touch tmp/restart.txt (' + String(e.message || e).slice(0, 100) + ')')
  }
  return done('PASS')
}

main().catch((e) => fail('unexpected: ' + String(e && e.message ? e.message : e).slice(0, 200)))
