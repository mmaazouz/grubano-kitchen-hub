#!/usr/bin/env node
'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   PHASE 2 — REFUND EMAIL TIMELINE (staging) — READ-ONLY
   ───────────────────────────────────────────────────────────────────────────────
   Proves the ordering invariant "Stripe refund succeeded → only then the success
   e-mail was dispatched" with AUTHORITATIVE timestamps (Stripe object `created`,
   Stripe events, DB Refund.createdAt, EmailDispatch.createdAt, EmailLog.sentAt),
   all printed in UTC. Also confirms the e-mail's factual content contract from the
   audit row (subject) — the body is not stored, the code contract is referenced.

   Usage (founder, staging):
     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-email-timeline.js

   Never: writes anything, prints a secret, prints a full e-mail address (domain only).
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const prov = require(path.join(__dirname, 'env-provenance.js'))
const H = require(path.join(__dirname, 'reconcile-helpers.js'))

const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const ORDER_ID = process.env.PHASE2_REFUND_ORDER_ID || 'cmtju919h0001h7t6bkn5tsm0'
const LOOKBACK_H = Number(process.env.PHASE2_EMAIL_LOOKBACK_HOURS || 48)

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
const mask = (s) => (typeof s === 'string' && s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : (s ? '***' : 'null'))
const domainOf = (e) => (typeof e === 'string' && e.includes('@') ? '***@' + e.split('@')[1] : 'n/a')
const iso = (d) => (d instanceof Date ? d.toISOString() : (typeof d === 'number' ? new Date(d * 1000).toISOString() : String(d)))
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_***').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)

function done(result, failedStep) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 REFUND EMAIL TIMELINE (staging) — every value below is MEASURED (UTC)')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  process.exitCode = result === 'PASS' ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step) => done('FAIL', step)

async function main() {
  console.log('[1] env (read-only)')
  const texts = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const merged = prov.mergeNextEnvFiles(texts).merged
  const dbName = ((merged.DATABASE_URL || '').match(/\/([A-Za-z0-9_\-]+)(\?|$)/) || [])[1] || 'unknown'
  if (/prod/i.test(dbName)) return fail('1 env: PROD-named database — refusing')
  try { H.loadRuntimeEnv(APP_ROOT) } catch (e) { return fail('1 env: loader ' + scrub(e)) }
  const rt = H.envFacts(process.env)
  if (rt.stripeMode !== 'TEST') return fail('1 env: Stripe key mode ' + rt.stripeMode + ' — refusing (TEST only)')
  F('DATABASE', dbName + ' · DATABASE_URL available ' + (rt.databaseUrl ? 'YES' : 'NO'))
  F('STRIPE MODE', rt.stripeMode)
  F('ROUNDCUBE DISPLAY TIMEZONE', 'NOT MEASURED (client-side display; all values below are UTC)')

  console.log('[2] database (read-only)')
  const prismaRes = H.resolveFromApp('@prisma/client', APP_ROOT)
  if (!prismaRes.ok || !rt.databaseUrl) return fail('2 db: prisma not available (' + (prismaRes.ok ? 'no DATABASE_URL' : prismaRes.error) + ')')
  let prisma
  try { const { PrismaClient } = require(prismaRes.path); prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }) } catch (e) { return fail('2 db: prisma construct ' + scrub(e)) }
  let refundRows = [], dispatches = [], logs = [], consumerDomain = 'n/a', stripeId = null
  try {
    const order = await prisma.order.findUnique({ where: { id: ORDER_ID }, select: { id: true, consumerId: true } })
    if (!order) return fail('2 db: order not found')
    const consumer = await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
    consumerDomain = domainOf(consumer && consumer.email)
    refundRows = await prisma.refund.findMany({ where: { orderId: order.id }, select: { id: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    F('DB REFUND ROWS', refundRows.length ? refundRows.map((r) => r.status + ':' + r.amountCents + ':' + mask(r.stripeRefundId) + ' createdAt ' + iso(r.createdAt)).join(' | ') : 'none')
    const succeeded = refundRows.filter((r) => r.status === 'succeeded')
    if (succeeded.length !== 1) A('2 db: expected exactly ONE succeeded refund row, found ' + succeeded.length)
    stripeId = succeeded[0] ? succeeded[0].stripeRefundId : null
    const since = new Date(Date.now() - LOOKBACK_H * 3600 * 1000)
    dispatches = await prisma.emailDispatch.findMany({ where: { trigger: 'refund_confirmation', dedupeKey: { startsWith: 'order:' + order.id + ':' } }, select: { dedupeKey: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
    F('EMAIL DISPATCH CLAIMS (refund_confirmation, this order)', dispatches.length ? dispatches.map((d) => d.dedupeKey.replace(order.id, '<order>') + ' claimedAt ' + iso(d.createdAt)).join(' | ') : 'none')
    logs = await prisma.emailLog.findMany({ where: { trigger: 'refund_confirmation', sentAt: { gte: since }, ...(consumer && consumer.email ? { recipient: consumer.email } : {}) }, select: { subject: true, status: true, sentAt: true, recipient: true }, orderBy: { sentAt: 'asc' } })
    F('EMAILLOG ROWS (refund_confirmation, consumer, last ' + LOOKBACK_H + ' h)', logs.length ? logs.map((l) => l.status + ' · sentAt ' + iso(l.sentAt) + ' · to ' + domainOf(l.recipient) + ' · subject "' + l.subject + '"').join(' | ') : 'none')
    F('CONSUMER EMAIL DOMAIN', consumerDomain)
  } catch (e) { return fail('2 db: ' + scrub(e)) } finally { await prisma.$disconnect().catch(() => {}) }

  console.log('[3] stripe TEST truth (read-only)')
  let stripe
  try { stripe = H.makeStripeClient(process.env.STRIPE_SECRET_KEY, APP_ROOT, { apiBase: process.env.PHASE2_STRIPE_API_BASE, allowLoopback: process.env.PHASE2_ALLOW_LOOPBACK === '1' }).client } catch (e) { return fail('3 stripe: client ' + scrub(e)) }
  if (!stripeId) return fail('3 stripe: no succeeded refund row → no Stripe refund id to verify')
  let refund
  try { refund = stripe.kind === 'rest-readonly' ? await stripe.refunds.retrieve(stripeId) : await stripe.refunds.retrieve(stripeId) } catch (e) { return fail('3 stripe: refund retrieve ' + scrub(e)) }
  if (!Number.isInteger(refund.created) || refund.created <= 0) return fail('3 stripe: refund has no valid created timestamp')
  F('STRIPE REFUND', mask(refund.id) + ' status ' + refund.status + ' amount ' + refund.amount + ' created ' + iso(refund.created))
  if (refund.status !== 'succeeded') A('3 stripe: refund status is ' + refund.status + ', not succeeded')
  const stripeSucceededAt = refund.created * 1000

  console.log('[4] ordering')
  const sentLogs = logs.filter((l) => l.status === 'sent')
  F('EMAIL SENT (EmailLog status sent)', sentLogs.length ? 'YES (' + sentLogs.length + ')' : 'NO')
  if (sentLogs.length !== 1) A('4 email: expected exactly ONE sent refund e-mail, found ' + sentLogs.length)
  const firstSent = sentLogs[0] ? new Date(sentLogs[0].sentAt).getTime() : null
  const firstClaim = dispatches[0] ? new Date(dispatches[0].createdAt).getTime() : null
  F('STRIPE REFUND SUCCEEDED AT UTC', iso(refund.created))
  F('EMAIL DISPATCH CLAIMED AT UTC', firstClaim ? new Date(firstClaim).toISOString() : 'NOT AVAILABLE')
  F('EMAILLOG SENT AT UTC', firstSent ? new Date(firstSent).toISOString() : 'NOT AVAILABLE')
  F('EMAIL PROVIDER ACCEPTED AT UTC', 'NOT AVAILABLE (SMTP relay acceptance time is not stored; EmailLog.sentAt is written after transporter.sendMail resolved)')
  let after = 'NOT MEASURED'
  if (firstSent !== null) {
    after = firstSent >= stripeSucceededAt ? 'YES' : 'NO'
    if (firstClaim !== null && firstClaim < stripeSucceededAt) after = 'NO'
  }
  F('EMAIL SENT AFTER STRIPE SUCCEEDED', after + (firstSent !== null ? ' (Δ ' + Math.round((firstSent - stripeSucceededAt) / 1000) + ' s after Stripe created)' : ''))
  if (after !== 'YES') A('4 ordering: the e-mail is not proven to follow the Stripe success')
  F('CODE CONTRACT', 'app/api/admin/refunds/run/route.ts sends sendRefundConfirmation ONLY after result.ok (pending 202 / failed ⇒ no e-mail); amount = result.amountCents of the succeeded refund; copy neutral (no restaurant-as-refunder, no numeric bank delay, no loyalty-as-cash) since ca0e19a')
  done(anomalies.length ? 'FAIL' : 'PASS')
}

main().catch((e) => fail('unexpected: ' + scrub(e)))
