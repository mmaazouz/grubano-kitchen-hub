#!/usr/bin/env node
// scripts/cron/monthly-invoices.js — Agent 1 / A6 gardiens.
//
// Runs once a month from cPanel cron — recommended cadence: 07:00 UTC on the
// 1st of every month, AFTER the daily ledger probe of the same day. Generates
// the commission invoices for the PREVIOUS month, then mails a one-line recap
// (n invoices generated / pre-existing, total TTC) to ALERT_EMAIL.
//
// The endpoint /api/admin/invoices/generate is IDEMPOTENT (see lib/invoice's
// issueInvoice — the legal counter only moves inside the creation transaction,
// so running this script twice in a row will not burn a number nor duplicate).
//
// REQUIRED ENV (loaded from ../../.env.local when run from cron):
//   INTERNAL_CRON_TOKEN    same token /api/admin/invoices/generate accepts
//   SITE_URL               base URL (default: https://www.grubano.com)
//   ALERT_EMAIL            destination of the recap mail
//   SMTP_HOST/USER/PASS    existing app transport
//
// EXIT CODES:
//   0  invoice generation call succeeded (even if 0 invoices) AND recap mail
//      was sent (or ALERT_EMAIL is unset → log-only mode is acceptable)
//   1  network/HTTP error, OR recap mail SMTP error

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
  console.error('[INVOICE CRON] FATAL: INTERNAL_CRON_TOKEN missing in env / .env.local')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Compute the PREVIOUS month — UTC, "YYYY-MM" format.
// ---------------------------------------------------------------------------
const now  = new Date()
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
const targetMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// POST /api/admin/invoices/generate { month: targetMonth }
// ---------------------------------------------------------------------------
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
  console.log(`[INVOICE CRON] Generating invoices for ${targetMonth} via ${SITE_URL}`)

  let res
  try {
    res = await postJson(
      `${SITE_URL}/api/admin/invoices/generate`,
      { 'X-Internal-Token': TOKEN, 'User-Agent': 'grubano-invoice-cron/1' },
      { month: targetMonth },
    )
  } catch (e) {
    console.error(`[INVOICE CRON] NETWORK ERROR: ${e.message}`)
    process.exit(1)
  }

  if (res.status !== 200 || !res.parsed) {
    console.error(`[INVOICE CRON] HTTP ${res.status} — response: ${String(res.body).slice(0, 400)}`)
    process.exit(1)
  }

  const j = res.parsed
  const invoices = Array.isArray(j.invoices) ? j.invoices : []
  const generated      = Number(j.generated || 0)
  const alreadyExisted = Number(j.alreadyExisted || 0)
  const totalTtc       = invoices.reduce((sum, i) => sum + (Number(i.totalTtc) || 0), 0)
  const totalHt        = invoices.reduce((sum, i) => sum + (Number(i.totalHt)  || 0), 0)
  const totalTva       = invoices.reduce((sum, i) => sum + (Number(i.totalTva) || 0), 0)

  console.log(JSON.stringify({
    ts:      now.toISOString(),
    kind:    'invoice_cron_summary',
    month:   targetMonth,
    generated,
    alreadyExisted,
    invoicesCount: invoices.length,
    totalTtc, totalHt, totalTva,
  }))

  if (!ALERT_EMAIL) {
    console.log('[INVOICE CRON] ALERT_EMAIL not set — recap mail NOT sent (log-only mode).')
    process.exit(0)
  }

  let nodemailer
  try { nodemailer = require('nodemailer') }
  catch (_) {
    console.error('[INVOICE CRON] nodemailer not installed — log-only mode.')
    process.exit(0)
  }
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'mail.grubano.com',
    port:   587,
    secure: false,
    auth:   { user: process.env.SMTP_USER || 'contact@grubano.com', pass: process.env.SMTP_PASS },
  })

  const eur = (cents) => (cents / 100).toFixed(2) + ' €'
  const lines = invoices.map(
    i => `  • ${i.number}  resto=${i.restaurantId}  TTC=${eur(Number(i.totalTtc) || 0)}  HT=${eur(Number(i.totalHt) || 0)}  TVA=${eur(Number(i.totalTva) || 0)}${i.alreadyExisted ? '  (re-émise)' : ''}`
  )

  const subject = `[GRUBANO] Factures de commission — ${targetMonth}`
  const text    = [
    `Factures de commission émises pour ${targetMonth} :`,
    ``,
    `Nouvelles                 : ${generated}`,
    `Déjà existantes (idempot.): ${alreadyExisted}`,
    `Total factures dans la réponse : ${invoices.length}`,
    `Total TTC                 : ${eur(totalTtc)}`,
    `Total HT                  : ${eur(totalHt)}`,
    `Total TVA                 : ${eur(totalTva)}`,
    ``,
    `Détail :`,
    ...(lines.length ? lines : ['  (aucune)']),
  ].join('\n')

  try {
    await transporter.sendMail({
      from:    `"Grubano facturation" <contact@grubano.com>`,
      to:      ALERT_EMAIL,
      subject,
      text,
    })
    console.log(`[INVOICE CRON] recap mail sent to ${ALERT_EMAIL}`)
    process.exit(0)
  } catch (e) {
    console.error(`[INVOICE CRON] SMTP error sending recap: ${e.message}`)
    process.exit(1)
  }
})()
