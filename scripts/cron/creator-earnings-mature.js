#!/usr/bin/env node
// scripts/cron/creator-earnings-mature.js — Agent 14 / B2a earnings engine.
//
// Runs DAILY from cPanel cron — recommended cadence: 06:30 UTC (before the
// ledger probe). Calls POST /api/admin/creator-earnings/mature, which moves
// every PENDING creator gain (ReferralOrder + DishSale) to matured/cancelled
// per the B0 rules (7 days after the order, order paid, not fully refunded,
// not self-referral). The endpoint is IDEMPOTENT — running this twice in a
// row re-scans only what is still pending.
//
// REQUIRED ENV (loaded from ../../.env.local when run from cron):
//   INTERNAL_CRON_TOKEN    same token the endpoint accepts
//   SITE_URL               base URL (default: https://www.grubano.com)
//   ALERT_EMAIL            optional — recap mail when something moved
//   SMTP_HOST/USER/PASS    existing app transport
//
// EXIT CODES: 0 = pass succeeded (even if 0 rows moved) ; 1 = network/HTTP/SMTP error.

'use strict'

const fs    = require('fs')
const path  = require('path')
const https = require('https')
const http  = require('http')
const { URL } = require('url')

// ---------------------------------------------------------------------------
// .env.local loader (cron does not source shell env files).
// ---------------------------------------------------------------------------
function loadDotenv() {
  const candidates = [
    path.join(__dirname, '..', '..', '.env.local'),
    path.join(__dirname, '..', '..', '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}
loadDotenv()

const TOKEN       = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
const SITE_URL    = (process.env.SITE_URL || 'https://www.grubano.com').replace(/\/$/, '')
const ALERT_EMAIL = (process.env.ALERT_EMAIL || '').trim()

if (!TOKEN) {
  console.error('[EARNINGS CRON] FATAL: INTERNAL_CRON_TOKEN missing in env / .env.local')
  process.exit(1)
}

function postJson(rawUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const u   = new URL(rawUrl)
    const mod = u.protocol === 'http:' ? http : https
    const payload = body ? JSON.stringify(body) : null
    const req = mod.request({
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + (u.search || ''),
      method:   'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      let rawBody = ''
      res.on('data', c => { rawBody += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = rawBody ? JSON.parse(rawBody) : null } catch (_) { /* keep raw */ }
        resolve({ status: res.statusCode, body: rawBody, parsed })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

;(async () => {
  const now = new Date()
  console.log(`[EARNINGS CRON] Maturation pass via ${SITE_URL}`)

  let res
  try {
    res = await postJson(
      `${SITE_URL}/api/admin/creator-earnings/mature`,
      { 'X-Internal-Token': TOKEN, 'User-Agent': 'grubano-earnings-cron/1' },
      null,
    )
  } catch (e) {
    console.error(`[EARNINGS CRON] NETWORK ERROR: ${e.message}`)
    process.exit(1)
  }

  if (res.status !== 200 || !res.parsed || res.parsed.ok !== true) {
    console.error(`[EARNINGS CRON] HTTP ${res.status} — response: ${String(res.body).slice(0, 400)}`)
    process.exit(1)
  }

  const j = res.parsed
  console.log(JSON.stringify({
    ts:        now.toISOString(),
    kind:      'earnings_cron_summary',
    scanned:   j.scanned,
    matured:   j.matured,
    cancelled: j.cancelled,
    pending:   j.pending,
    reasons:   j.reasons,
  }))

  const moved = (Number(j.matured) || 0) + (Number(j.cancelled) || 0)
  if (!ALERT_EMAIL || moved === 0) {
    if (!ALERT_EMAIL) console.log('[EARNINGS CRON] ALERT_EMAIL not set — log-only mode.')
    process.exit(0)
  }

  let nodemailer
  try { nodemailer = require('nodemailer') }
  catch (_) {
    console.error('[EARNINGS CRON] nodemailer not installed — log-only mode.')
    process.exit(0)
  }
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'mail.grubano.com',
    port:   587,
    secure: false,
    auth:   { user: process.env.SMTP_USER || 'contact@grubano.com', pass: process.env.SMTP_PASS },
  })

  const reasons = Object.entries(j.reasons || {}).map(([k, v]) => `  • ${k}: ${v}`)
  try {
    await transporter.sendMail({
      from:    `"Grubano gains créateurs" <contact@grubano.com>`,
      to:      ALERT_EMAIL,
      subject: `[GRUBANO] Maturation gains créateurs — ${j.matured} mûris, ${j.cancelled} annulés`,
      text: [
        `Passe de maturation du ${now.toISOString()} :`,
        ``,
        `Scannés  : ${j.scanned ? `${j.scanned.referralOrders} referral + ${j.scanned.dishSales} adoption` : 'n/a'}`,
        `Mûris    : ${j.matured}`,
        `Annulés  : ${j.cancelled}`,
        `Encore pending : ${j.pending}`,
        ``,
        `Raisons :`,
        ...(reasons.length ? reasons : ['  (aucune)']),
      ].join('\n'),
    })
    console.log(`[EARNINGS CRON] recap mail sent to ${ALERT_EMAIL}`)
    process.exit(0)
  } catch (e) {
    console.error(`[EARNINGS CRON] SMTP error sending recap: ${e.message}`)
    process.exit(1)
  }
})()
