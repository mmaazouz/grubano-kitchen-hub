#!/usr/bin/env node
// scripts/cron/ledger-check-probe.js — Agent 1 / A6 gardiens.
//
// Runs DAILY from cPanel cron. Hits GET /api/admin/ledger/check?from=&to=
// (last 24 h window) with the X-Internal-Token header, then:
//   • if ok:true  → logs a single structured line and exits 0.
//   • if ok:false → sends an alert email to ALERT_EMAIL via the same SMTP
//                   transport the app uses (nodemailer + SMTP_HOST/USER/PASS).
//                   Whether the email succeeds or not, also logs a structured
//                   [LEDGER ALERT] line so a parser can pick it up from the
//                   cron log even when SMTP is down.
//
// REQUIRED ENV (loaded from ../../.env.local when the script is run from cron):
//   INTERNAL_CRON_TOKEN   the token the route compares against
//   SITE_URL              base URL of the app (default: https://www.grubano.com)
//   ALERT_EMAIL           destination of the alert mail
//   SMTP_HOST / SMTP_USER / SMTP_PASS  (existing app transport)
//
// EXIT CODES:
//   0  check returned ok:true, OR ok:false and the alert mail was sent
//   1  network/HTTP error reaching the check endpoint, OR the alert mail
//      could not be sent (so cron logs surface it loudly)
//
// This script makes NO write to the DB. It only READS the check response and
// reports. The finance libs / webhook / flows are not touched.

'use strict'

const fs    = require('fs')
const path  = require('path')
const https = require('https')
const http  = require('http')
const { URL } = require('url')

// ---------------------------------------------------------------------------
// 1) Load .env.local if it exists (cron does not source shell env files).
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
  console.error('[LEDGER PROBE] FATAL: INTERNAL_CRON_TOKEN missing in env / .env.local')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2) Hit the check endpoint over a 24 h window ending now.
// ---------------------------------------------------------------------------
function fetchJson(rawUrl, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(rawUrl)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request({
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + (u.search || ''),
      method:   'GET',
      headers,
    }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = body ? JSON.parse(body) : null } catch (_) { /* keep raw */ }
        resolve({ status: res.statusCode, body, parsed })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

const now  = new Date()
const from = new Date(now.getTime() - 24 * 60 * 60 * 1000)
const url  = `${SITE_URL}/api/admin/ledger/check?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(now.toISOString())}`

;(async () => {
  let res
  try {
    res = await fetchJson(url, { 'X-Internal-Token': TOKEN, 'User-Agent': 'grubano-ledger-probe/1' })
  } catch (e) {
    console.error(`[LEDGER PROBE] NETWORK ERROR: ${e.message}`)
    process.exit(1)
  }

  if (res.status !== 200 || !res.parsed) {
    console.error(`[LEDGER PROBE] HTTP ${res.status} — response: ${String(res.body).slice(0, 400)}`)
    process.exit(1)
  }

  const j = res.parsed
  // Compact one-line summary — handy in tail -f cron.log
  console.log(JSON.stringify({
    ts:               now.toISOString(),
    kind:             'ledger_probe_summary',
    ok:               j.ok,
    internalOk:       j.internalOk,
    reconciliationOk: j.reconciliationOk,
    refundsOk:        j.refundsOk,
    ledgerCount:      j.ledgerCount,
    stripeCount:      j.stripeCount,
    ledgerSum:        j.ledgerSum,
    stripeSum:        j.stripeSum,
    ecarts:           Array.isArray(j.ecarts) ? j.ecarts.length : 0,
  }))

  if (j.ok) {
    process.exit(0)   // ── happy path ────────────────────────────────────────
  }

  // ── ok === false → ALERT ────────────────────────────────────────────────
  // Always log [LEDGER ALERT] BEFORE trying to send the email — the cron log
  // becomes the second channel of truth if SMTP is broken.
  console.error('[LEDGER ALERT] ok=false from', SITE_URL, '— full response below:')
  console.error(JSON.stringify(j, null, 2))

  if (!ALERT_EMAIL) {
    console.error('[LEDGER PROBE] ALERT_EMAIL not set — alert email NOT sent (log-only mode).')
    process.exit(1)
  }

  // Reuse the app's nodemailer transport pattern (host/user/pass already
  // present on the server — see app/api/email-agent/route.ts).
  let nodemailer
  try { nodemailer = require('nodemailer') }
  catch (_) {
    console.error('[LEDGER PROBE] nodemailer not installed — log-only mode.')
    process.exit(1)
  }
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'mail.grubano.com',
    port:   587,
    secure: false,
    auth:   { user: process.env.SMTP_USER || 'contact@grubano.com', pass: process.env.SMTP_PASS },
  })

  const subject = `[LEDGER ALERT] check ok:false — ${new Date().toISOString().slice(0, 10)}`
  const text    = [
    `Daily Grubano ledger check returned ok:false.`,
    ``,
    `Source      : ${SITE_URL}`,
    `Window      : ${from.toISOString()}  →  ${now.toISOString()}`,
    `internalOk  : ${j.internalOk}`,
    `reconcileOk : ${j.reconciliationOk}`,
    `refundsOk   : ${j.refundsOk}`,
    `Lines       : ledger=${j.ledgerCount} / stripe=${j.stripeCount}`,
    `Sums (cents): ledger=${j.ledgerSum} / stripe=${j.stripeSum}`,
    `Ecarts      : ${Array.isArray(j.ecarts) ? j.ecarts.length : 0}`,
    ``,
    `── Full check response (truncated to 8 KB) ──`,
    JSON.stringify(j, null, 2).slice(0, 8 * 1024),
  ].join('\n')

  try {
    await transporter.sendMail({
      from:    `"Grubano ledger probe" <contact@grubano.com>`,
      to:      ALERT_EMAIL,
      subject,
      text,
    })
    console.log(`[LEDGER PROBE] alert mail sent to ${ALERT_EMAIL}`)
    process.exit(0)
  } catch (e) {
    console.error(`[LEDGER PROBE] SMTP error sending alert: ${e.message}`)
    process.exit(1)
  }
})()
