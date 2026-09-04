'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase2-preflight.js — PHASE 2 OPERATIONAL ACTIVATION PREFLIGHT (staging, one-shot)

   Run ONCE on the staging server (cPanel Terminal), with the nodevenv node:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js

   What it does (in order — every step is fail-closed, first anomaly → FAIL, non-zero exit):
     1. ENV     proves it runs inside the deployed STAGING app (schema + Phase 2 build marker
                in the compiled webhook route + NEXTAUTH_URL on app.grubano.com + no "prod"
                database name), loads .env.local into the process (nothing printed).
     2. FLAGS   prints the EFFECTIVE value of every money flag (ABSENT → EFFECTIVE FALSE) and
                FAILS if any auto-money flag or REFUNDS_ENABLED / CLAIMS_ENABLED is 'true'.
     3. ALERT   sets ALERT_EMAIL=admin-qa@grubano.com in .env.local (backup first, mode 600,
                idempotent) — the ONLY write of this script — then proves the re-read.
     4. MAIL    sends ONE safe, non-financial MONEY REVIEW *test* e-mail through the app's
                own SMTP settings to ALERT_EMAIL and prints the provider's acceptance line.
     5. ORDER   reads (READ-ONLY) the rehearsal order GR-N5TSM0 (id …n5tsm0): money fields,
                loyalty rows, refunds, ledger lines, franchise royalty row, loyalty customer.
     6. FRANCH  reads (READ-ONLY) whether any franchised order / royalty / franchise account
                exists on staging.
     7. LEDGER  calls the app's own read-only GET /api/admin/ledger/check (7-day window) with
                the internal token from the env (never printed) and prints the verdict.
     8. RESTART touches tmp/restart.txt when ALERT_EMAIL changed (Passenger reload).

   NO refund. NO Stripe write. NO money. NO schema change. NO secret printed (presence only,
   Stripe/PI ids truncated, DATABASE_URL reduced to its database name).
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')

const APP_ROOT     = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID     = process.env.PHASE2_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const TARGET_ALERT = process.env.PHASE2_ALERT_EMAIL || 'admin-qa@grubano.com'
const MONEY_FLAGS_MUST_BE_FALSE = ['REFUNDS_ENABLED', 'CLAIMS_ENABLED', 'CLAIMS_AUTO_APPROVE_ENABLED', 'GHOST_ORDER_AUTO_REFUND_ENABLED']
const FLAGS_TO_PRINT = [
  ...MONEY_FLAGS_MUST_BE_FALSE,
  'FRANCHISE_ENABLED', 'FRANCHISE_ROYALTY_ENABLED', 'FRANCHISE_SETTLEMENT_ENABLED',
  'TIPS_ENABLED', 'LOGISTICS_PAYOUT_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'CHARGEBACKS_ENABLED',
  'ALLOW_PLATFORM_FALLBACK', 'RATE_LIMIT_ENABLED', 'ADMIN_AUDIT_ENABLED',
]

const facts = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const mask = (s) => (typeof s === 'string' && s.length > 8 ? s.slice(0, 4) + '***' + s.slice(-4) : (s ? '***' : 'null'))

function done(result, failedStep, action) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 PREFLIGHT (staging)')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  console.log('SAFE TO CONTINUE: ' + (result === 'PASS' ? 'YES' : 'NO'))
  console.log('ACTION: ' + (action || 'PASTE THIS WHOLE OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(result === 'PASS' ? 0 : 1)
}
const fail = (step, action) => done('FAIL', step, action)

function loadEnvLocal(file) {
  const txt = fs.readFileSync(file, 'utf8')
  const parsed = {}
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    parsed[k] = v
    if (process.env[k] === undefined) process.env[k] = v
  }
  return { txt, parsed }
}

async function main() {
  // ── 1. ENV ────────────────────────────────────────────────────────────────
  console.log('[1/8] env')
  const envFile = path.join(APP_ROOT, '.env.local')
  const schemaPath = path.join(APP_ROOT, 'prisma', 'schema.prisma')
  const webhookBuilt = path.join(APP_ROOT, '.next', 'server', 'app', 'api', 'webhooks', 'stripe', 'route.js')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT, 'run from the deployed app (~/app.grubano.com)')
  if (!fs.existsSync(schemaPath)) return fail('1 env: prisma/schema.prisma not found')
  if (!fs.existsSync(webhookBuilt)) return fail('1 env: compiled webhook route not found (' + path.relative(APP_ROOT, webhookBuilt) + ')')
  const built = fs.readFileSync(webhookBuilt, 'utf8')
  if (!built.includes('refund.updated') || !built.includes('refund.failed')) return fail('1 env: deployed build lacks the Phase 2 refund status branch (refund.updated/refund.failed)', 'deploy Phase 2 (>= 4ce8f53) first')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  for (const f of ['recoveryOffsetPoints', 'sourceEventId', 'royaltyClawbackCents']) {
    if (!schema.includes(f)) return fail('1 env: deployed schema lacks ' + f)
  }
  let version = 'unknown'
  try { version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public', 'version.json'), 'utf8')).shortCommit || 'unknown' } catch { /* optional */ }
  const env = loadEnvLocal(envFile)
  const dbUrl = process.env.DATABASE_URL || ''
  const dbName = (dbUrl.match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (!dbUrl) return fail('1 env: DATABASE_URL absent')
  if (/prod/i.test(dbName)) return fail('1 env: DATABASE_URL points at a PROD-named database (' + dbName + ')', 'refusing — staging only')
  const nextauthUrl = process.env.NEXTAUTH_URL || ''
  if (!/app\.grubano\.com/.test(nextauthUrl)) return fail('1 env: NEXTAUTH_URL is not the staging origin (' + nextauthUrl + ')', 'refusing — staging only')
  F('APP_ROOT', APP_ROOT)
  F('DEPLOYED SHA', version)
  F('PHASE 2 BUILD MARKER', 'PRESENT (refund.updated/refund.failed branch)')
  F('DATABASE', dbName + ' (staging-named)')
  F('NEXTAUTH_URL', nextauthUrl)
  F('SMTP_HOST', process.env.SMTP_HOST || 'ABSENT (default mail.grubano.com)')
  F('SMTP_USER present', String(!!process.env.SMTP_USER))
  F('SMTP_PASS present', String(!!process.env.SMTP_PASS))
  F('INTERNAL_CRON_TOKEN present', String(!!(process.env.INTERNAL_CRON_TOKEN || '').trim()))
  F('STRIPE_SECRET_KEY mode', (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_') ? 'TEST' : ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'LIVE (!)' : 'ABSENT/UNKNOWN'))
  F('STRIPE_WEBHOOK_SECRET present', String(!!process.env.STRIPE_WEBHOOK_SECRET))
  if ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_')) return fail('1 env: staging carries a LIVE Stripe key', 'refusing')

  // ── 2. FLAGS ──────────────────────────────────────────────────────────────
  console.log('[2/8] flags')
  for (const k of FLAGS_TO_PRINT) {
    const v = process.env[k]
    F('FLAG ' + k, v === undefined ? 'ABSENT → EFFECTIVE FALSE' : (v === 'true' ? 'true' : JSON.stringify(v) + ' → EFFECTIVE FALSE'))
  }
  for (const k of MONEY_FLAGS_MUST_BE_FALSE) {
    if (process.env[k] === 'true') return fail('2 flags: ' + k + ' is TRUE on staging', 'must stay FALSE during the Phase 2 rehearsal — human decision required')
  }

  // ── 3. ALERT_EMAIL (the only write) ───────────────────────────────────────
  console.log('[3/8] ALERT_EMAIL')
  const current = env.parsed.ALERT_EMAIL
  let alertChanged = false
  if (current === TARGET_ALERT) {
    F('ALERT_EMAIL', current + ' (UNCHANGED)')
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = envFile + '.bak-phase2-' + stamp
    fs.copyFileSync(envFile, backup)
    try { fs.chmodSync(backup, 0o600) } catch { /* best-effort */ }
    const lines = env.txt.split(/\r?\n/)
    let replaced = false
    const out = lines.map((l) => {
      if (/^\s*ALERT_EMAIL\s*=/.test(l)) { replaced = true; return 'ALERT_EMAIL=' + TARGET_ALERT }
      return l
    })
    if (!replaced) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push('# Phase 2 — MONEY REVIEW alerts destination (staging QA inbox)')
      out.push('ALERT_EMAIL=' + TARGET_ALERT)
    }
    fs.writeFileSync(envFile, out.join('\n') + (out[out.length - 1] === '' ? '' : '\n'), { mode: 0o600 })
    try { fs.chmodSync(envFile, 0o600) } catch { /* best-effort */ }
    const reread = loadEnvLocal(envFile).parsed.ALERT_EMAIL
    if (reread !== TARGET_ALERT) return fail('3 alert: ALERT_EMAIL re-read mismatch (' + reread + ')', 'restore from ' + path.basename(backup))
    alertChanged = true
    process.env.ALERT_EMAIL = TARGET_ALERT
    F('ALERT_EMAIL', TARGET_ALERT + ' (' + (current === undefined ? 'ADDED' : 'REPLACED from ' + current) + ', backup ' + path.basename(backup) + ')')
  }

  // ── 4. MAIL — safe non-financial test alert through the app's SMTP settings ─
  console.log('[4/8] test alert')
  let nodemailer
  try { nodemailer = require(require.resolve('nodemailer', { paths: [APP_ROOT] })) } catch { return fail('4 mail: nodemailer not resolvable from ' + APP_ROOT) }
  if (!process.env.SMTP_PASS) return fail('4 mail: SMTP_PASS absent in .env.local')
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.grubano.com', port: 587, secure: false,
    auth: { user: process.env.SMTP_USER || 'contact@grubano.com', pass: process.env.SMTP_PASS },
  })
  const stamp = new Date().toISOString()
  try {
    const info = await transporter.sendMail({
      from: '"Grubano" <contact@grubano.com>',
      to: TARGET_ALERT,
      subject: '[Grubano] MONEY REVIEW — TEST préflight Phase 2 (aucun argent) ' + stamp.slice(0, 16),
      html: '<div style="font-family:system-ui,Arial,sans-serif;color:#111827;max-width:520px">'
        + '<h2 style="font-size:17px">Test du canal MONEY REVIEW (staging)</h2>'
        + '<p>Ceci est un e-mail de TEST envoyé par l’opérateur de préflight Phase 2. <b>Aucun remboursement, aucun mouvement d’argent, aucune modification de données.</b></p>'
        + '<p style="font-size:13px;color:#6b7280">Horodatage : ' + stamp + ' · Build : ' + version + ' · Destination configurée : ' + TARGET_ALERT + '</p></div>',
    })
    F('TEST ALERT accepted', JSON.stringify(info.accepted || []))
    F('TEST ALERT rejected', JSON.stringify(info.rejected || []))
    F('TEST ALERT provider response', String(info.response || '').slice(0, 120))
    F('TEST ALERT messageId', String(info.messageId || ''))
    if (!info.accepted || !info.accepted.includes(TARGET_ALERT)) return fail('4 mail: provider did not accept ' + TARGET_ALERT)
  } catch (e) {
    return fail('4 mail: send failed — ' + String(e && e.message ? e.message : e).slice(0, 200))
  }

  // ── 5. ORDER facts (READ-ONLY) ────────────────────────────────────────────
  console.log('[5/8] order GR-' + ORDER_ID.slice(-6).toUpperCase())
  let PrismaClient
  try { ({ PrismaClient } = require(require.resolve('@prisma/client', { paths: [APP_ROOT] }))) } catch { return fail('5 order: @prisma/client not resolvable from ' + APP_ROOT) }
  const prisma = new PrismaClient()
  try {
    const order = await prisma.order.findUnique({
      where: { id: ORDER_ID },
      select: { id: true, restaurantId: true, consumerId: true, status: true, paymentStatus: true, subtotal: true, deliveryFee: true, total: true, pointsEarned: true, pointsRedeemed: true, loyaltyCreditCents: true, pointOfSaleId: true, stripePaymentIntentId: true, createdAt: true },
    })
    if (!order) return fail('5 order: ' + ORDER_ID + ' not found on staging')
    const resto = await prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true, stripeAccountStatus: true, stripeAccountId: true } })
    F('ORDER ref', 'GR-' + order.id.slice(-6).toUpperCase() + ' (id …' + order.id.slice(-8) + ')')
    F('ORDER createdAt', order.createdAt.toISOString())
    F('ORDER status / paymentStatus', order.status + ' / ' + order.paymentStatus)
    F('ORDER restaurant', (resto ? resto.name : 'unknown') + ' · connect=' + (resto ? resto.stripeAccountStatus : 'n/a') + ' · acct=' + mask(resto && resto.stripeAccountId))
    F('ORDER subtotal / deliveryFee / total (€)', order.subtotal + ' / ' + order.deliveryFee + ' / ' + order.total)
    F('ORDER pointsRedeemed / loyaltyCreditCents / pointsEarned', order.pointsRedeemed + ' / ' + order.loyaltyCreditCents + ' / ' + order.pointsEarned)
    F('ORDER pointOfSaleId (franchise POS)', order.pointOfSaleId || 'null')
    F('ORDER PI', mask(order.stripePaymentIntentId))
    if (order.paymentStatus !== 'paid') return fail('5 order: paymentStatus is ' + order.paymentStatus + ' (expected paid)')
    if (!order.stripePaymentIntentId) return fail('5 order: no stripePaymentIntentId')

    const lts = await prisma.loyaltyTransaction.findMany({ where: { orderId: order.id }, select: { type: true, points: true, sourceEventId: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    F('LOYALTY rows for order', lts.length ? lts.map((t) => t.type + ':' + t.points + (t.sourceEventId ? '(' + mask(t.sourceEventId) + ')' : '')).join(', ') : 'none')
    const refundRows = await prisma.refund.findMany({ where: { orderId: order.id }, select: { status: true, amountCents: true, stripeRefundId: true } })
    F('REFUND rows for order', refundRows.length ? refundRows.map((r) => r.status + ':' + r.amountCents + ':' + mask(r.stripeRefundId)).join(', ') : 'none')
    const ledger = await prisma.ledgerEntry.findMany({ where: { stripePaymentIntentId: order.stripePaymentIntentId }, select: { type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, stripeFeeAmount: true, routed: true, sourceEventId: true }, orderBy: { createdAt: 'asc' } })
    F('LEDGER lines for PI', ledger.length ? ledger.map((l) => l.type + '{gross ' + l.grossAmount + ', fee ' + l.applicationFeeAmount + ', net ' + l.netToRestaurant + ', stripeFee ' + l.stripeFeeAmount + ', routed ' + l.routed + '}').join(' ; ') : 'none')
    const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: { royaltyCents: true, refundedCents: true, status: true } })
    F('FRANCHISE ROYALTY row for order', royalty ? JSON.stringify(royalty) : 'none (standard restaurant)')
    try {
      const op = await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
      const lc = op ? await prisma.loyaltyCustomer.findUnique({ where: { email: op.email }, select: { pointsBalance: true, recoveryOffsetPoints: true } }) : null
      F('LOYALTY customer (consumer)', lc ? 'pointsBalance ' + lc.pointsBalance + ', recoveryOffsetPoints ' + lc.recoveryOffsetPoints : 'none')
    } catch (e) { F('LOYALTY customer (consumer)', 'n/a (' + String(e.message || e).slice(0, 60) + ')') }
    F('ORDER DISPOSABLE (paid, 0 refund rows)', refundRows.length === 0 ? 'YES' : 'NO')

    // ── 6. FRANCHISE facts (READ-ONLY) ──────────────────────────────────────
    console.log('[6/8] franchise')
    const [royaltyCount, posCount, franchiseOps, ordersWithPos] = await Promise.all([
      prisma.franchiseRoyalty.count(),
      prisma.pointOfSale.count().catch(() => -1),
      prisma.operator.count({ where: { role: 'franchise' } }),
      prisma.order.count({ where: { pointOfSaleId: { not: null } } }),
    ])
    F('FRANCHISE royalty rows (all)', String(royaltyCount))
    F('FRANCHISE points of sale', String(posCount))
    F('FRANCHISE operators (role=franchise)', String(franchiseOps))
    F('ORDERS attached to a POS', String(ordersWithPos))
    F('FRANCHISE_ENABLED effective', process.env.FRANCHISE_ENABLED === 'true' ? 'ON' : 'OFF')
  } finally {
    await prisma.$disconnect().catch(() => {})
  }

  // ── 7. LEDGER CHECK (READ-ONLY route, token from env, never printed) ──────
  console.log('[7/8] ledger check')
  const tok = (process.env.INTERNAL_CRON_TOKEN || '').trim()
  if (!tok) return fail('7 ledger: INTERNAL_CRON_TOKEN absent in .env.local')
  const to = new Date(), from = new Date(to.getTime() - 7 * 24 * 3600 * 1000)
  const url = nextauthUrl.replace(/\/$/, '') + '/api/admin/ledger/check?from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString())
  try {
    const res = await fetch(url, { headers: { 'X-Internal-Token': tok, 'User-Agent': 'grubano-phase2-preflight/1' } })
    const body = await res.json().catch(() => ({}))
    F('LEDGER CHECK http', String(res.status))
    F('LEDGER CHECK ok / refundsOk', body.ok + ' / ' + body.refundsOk)
    F('LEDGER CHECK ledgerCount / stripeCount', body.ledgerCount + ' / ' + body.stripeCount)
    F('LEDGER CHECK ledgerSum / stripeSum', body.ledgerSum + ' / ' + body.stripeSum)
    F('LEDGER CHECK ecarts', JSON.stringify(body.ecarts || []).slice(0, 300))
    F('LEDGER CHECK refunds', JSON.stringify(body.refunds || {}).slice(0, 200))
    if (res.status !== 200) return fail('7 ledger: HTTP ' + res.status)
  } catch (e) {
    return fail('7 ledger: request failed — ' + String(e && e.message ? e.message : e).slice(0, 160))
  }

  // ── 8. RESTART (only if the env changed) ──────────────────────────────────
  console.log('[8/8] restart')
  if (alertChanged) {
    try {
      fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
      fs.writeFileSync(path.join(APP_ROOT, 'tmp', 'restart.txt'), String(Date.now()))
      F('PASSENGER RESTART', 'TOUCHED tmp/restart.txt (ALERT_EMAIL changed)')
    } catch (e) {
      return fail('8 restart: could not touch tmp/restart.txt (' + String(e.message || e).slice(0, 100) + ')')
    }
  } else {
    F('PASSENGER RESTART', 'NOT NEEDED (env unchanged)')
  }
  return done('PASS')
}

main().catch((e) => fail('unexpected: ' + String(e && e.message ? e.message : e).slice(0, 200)))
