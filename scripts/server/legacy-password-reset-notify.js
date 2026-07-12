// scripts/legacy-password-reset-notify.js
// ─────────────────────────────────────────────────────────────────────────────
// C-1 — LEGACY PLAINTEXT-PASSWORD remediation (AUDIT + NOTIFY). READY, never run
// by CC — Mohammed runs it on STAGING (then, if he chooses, prod).
//
// CONTEXT (why this exists):
//   Login is bcrypt-ONLY since P0-SEC-1 (lib/auth.ts:70-84): a stored password
//   value that is NOT a valid bcrypt hash (a legacy plaintext value) can NEVER
//   authenticate. So the AUTH hole is already closed — a plaintext value at rest
//   is now an inert DATA-HYGIENE / PII problem, and its owner is locked out of
//   PASSWORD login until they reset (they can still magic-link / OAuth in).
//   The existing self-serve rail already works for them: POST /api/auth/forgot-
//   password issues a reset token whenever operator.password is non-null (bcrypt
//   OR plaintext), and /api/auth/reset-password re-hashes with bcrypt cost 12.
//
// WHAT THIS SCRIPT DOES:
//   • AUDIT (default, ZERO side-effects): connects to the DB, finds every Operator
//     whose `password` is set but is NOT a bcrypt hash (i.e. a legacy plaintext /
//     foreign value), and prints the COUNT + a per-role breakdown + MASKED emails.
//     It writes NOTHING and sends NOTHING. Safe to run any time.
//   • NOTIFY (gated by NOTIFY_CONFIRM=yes): for each affected operator, calls the
//     EXISTING rail — POST {BASE}/api/auth/forgot-password {email, space:'business'}
//     — which issues the 1 h single-use token and emails the reset link. This
//     script never touches email libs or writes the token itself; it drives the
//     real, already-audited endpoint (no logic duplication). A polite delay spaces
//     the sends. It is idempotent-ish: re-running just re-issues a fresh token
//     (the endpoint deletes prior tokens for the identifier).
//
// WHAT THIS SCRIPT DELIBERATELY DOES NOT DO — NEUTRALIZE:
//   Nulling the plaintext value (`password = NULL`) is a SEPARATE, LATER step and
//   is NOT implemented here on purpose. ⚠️ CAVEAT: forgot-password only issues a
//   token when operator.password is non-null, so nulling a NON-responder's
//   password would REMOVE their self-serve reset path (they'd be limited to
//   magic-link / OAuth). Neutralize must therefore run ONLY after a user has
//   PROVEN they migrated (their password is now a bcrypt hash — in which case
//   there is nothing left to neutralize for them). The policy for non-responders
//   (leave the inert plaintext vs force magic-link-only) is a security/product
//   decision for Mohammed — see the C-1 report. Do NOT bolt a blind
//   `UPDATE ... SET password=NULL WHERE <plaintext>` onto this without that call.
//
// SAFETY (mirrors scripts/backfill-*.js):
//   1. Loads DATABASE_URL + NEXTAUTH_URL from .env.local if not already in env.
//   2. Prints the MASKED target DB + the NOTIFY base URL up front.
//   3. AUDIT is the default; NOTIFY requires NOTIFY_CONFIRM=yes.
//   4. If the NOTIFY base looks like PROD, NOTIFY additionally requires
//      NOTIFY_ALLOW_PROD=yes (belt-and-suspenders against an accidental mass send).
//   5. Never prints a full email or any password value (emails are masked; the
//      plaintext values are NEVER read into the output).
//
// Usage (cPanel Terminal on STAGING, from the app root — app must be reachable):
//   ./node_modules/.bin/prisma generate                     # pinned 5.22.0 client
//   node scripts/server/legacy-password-reset-notify.js            # 1) AUDIT (no writes/sends)
//   NOTIFY_CONFIRM=yes node scripts/server/legacy-password-reset-notify.js   # 2) SEND resets
//   ⚠️  Run the AUDIT first and confirm the count looks right before NOTIFY.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs   = require('fs')
const path = require('path')

// ── 1. Load DATABASE_URL / NEXTAUTH_URL from .env.local if not in env ──────────
// (this script lives in scripts/server/, so the app root — where .env.local sits —
//  is TWO levels up.)
{
  const envFile = path.join(__dirname, '..', '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('[legacy-password-reset-notify] DATABASE_URL not set (checked env + .env.local). Aborting.')
  process.exit(1)
}

function maskedTarget(url) {
  try {
    const u = new URL(url)
    const cred = u.username ? `${u.username}:***@` : ''
    return `${u.protocol}//${cred}${u.host}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL — masked for safety)'
  }
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@')
  if (!domain) return '***'
  const head = local.length <= 1 ? local : local[0]
  return `${head}***@${domain}`
}

// A bcryptjs hash is exactly `$2a$`/`$2b$`/`$2x$`/`$2y$` + cost + 53 chars = 60 total.
// Anything else with a non-null password is a legacy plaintext (or foreign) value.
function isBcryptHash(pw) {
  return typeof pw === 'string' && /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(pw)
}

const NOTIFY        = process.env.NOTIFY_CONFIRM === 'yes'
const ALLOW_PROD    = process.env.NOTIFY_ALLOW_PROD === 'yes'
const BASE_URL      = (process.env.NOTIFY_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
const SEND_DELAY_MS = Number(process.env.NOTIFY_DELAY_MS || 400) // polite spacing between sends
const looksProd     = /(^|\/\/)(www\.)?grubano\.com/.test(BASE_URL) && !/app\.grubano\.com/.test(BASE_URL)

console.log('============================================================')
console.log('  GRUBANO — C-1 legacy plaintext-password AUDIT / NOTIFY')
console.log('============================================================')
console.log(`  Target database : ${maskedTarget(process.env.DATABASE_URL)}`)
console.log(`  Notify base URL : ${BASE_URL || '(unset — NOTIFY unavailable)'}`)
console.log(`  Mode            : ${NOTIFY ? 'NOTIFY (send reset emails via the rail)' : 'AUDIT — read-only, no writes/sends'}`)
console.log('  ⚠️  Make ABSOLUTELY sure the target above is your STAGING DB.')
console.log('============================================================')

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function findLegacyAccounts() {
  // Only rows with a password set can be plaintext; SSO/passwordless (null) are skipped.
  // We select the password ONLY to classify it (bcrypt vs not) — it is never printed.
  const withPassword = await prisma.operator.findMany({
    where:  { NOT: { password: null } },
    select: { id: true, email: true, role: true, password: true },
  })
  return withPassword.filter((o) => !isBcryptHash(o.password))
}

async function runAudit() {
  const legacy = await findLegacyAccounts()
  const byRole = legacy.reduce((acc, o) => { acc[o.role] = (acc[o.role] ?? 0) + 1; return acc }, {})

  console.log('\n── AUDIT ──────────────────────────────────────────────────')
  console.log(`  Operators with a password set that is NOT a bcrypt hash: ${legacy.length}`)
  if (legacy.length > 0) {
    console.log('  Per role:')
    for (const [role, n] of Object.entries(byRole).sort()) console.log(`    • ${role.padEnd(12)} : ${n}`)
    console.log('  Affected (masked):')
    for (const o of legacy) console.log(`    • ${maskEmail(o.email)}  [${o.role}]`)
  } else {
    console.log('  ✅ None found — no legacy plaintext passwords at rest. Nothing to do.')
  }
  return legacy
}

async function runNotify(legacy) {
  if (!BASE_URL) {
    console.error('\n[abort] NOTIFY needs a base URL (NOTIFY_BASE_URL or NEXTAUTH_URL). No email sent.')
    process.exitCode = 1
    return
  }
  if (looksProd && !ALLOW_PROD) {
    console.error(`\n[abort] NOTIFY base URL "${BASE_URL}" looks like PRODUCTION. Refusing a mass send.`)
    console.error('        If this is intentional, re-run with NOTIFY_ALLOW_PROD=yes. No email sent.')
    process.exitCode = 1
    return
  }
  if (legacy.length === 0) {
    console.log('\n[notify] Nothing to send — 0 legacy accounts.')
    return
  }

  console.log(`\n── NOTIFY ─────────────────────────────────────────────────`)
  console.log(`  Sending a reset link to ${legacy.length} account(s) via POST ${BASE_URL}/api/auth/forgot-password`)
  let sent = 0, failed = 0
  for (const o of legacy) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: o.email, space: 'business' }),
      })
      // The endpoint always answers 200 { ok:true } (no enumeration); a non-200
      // means the endpoint itself is unreachable/broken.
      if (res.ok) { sent++; console.log(`    ✓ ${maskEmail(o.email)}`) }
      else        { failed++; console.warn(`    ✗ ${maskEmail(o.email)} — HTTP ${res.status}`) }
    } catch (e) {
      failed++
      console.warn(`    ✗ ${maskEmail(o.email)} — ${e instanceof Error ? e.message : e}`)
    }
    if (SEND_DELAY_MS > 0) await wait(SEND_DELAY_MS)
  }
  console.log(`\n[notify] Done. Reset requests dispatched: ${sent}, failed: ${failed}.`)
  console.log('  Users have 1 h to use the link; after that they can self-serve via')
  console.log('  the "Mot de passe oublié" flow (their password is still non-null).')
}

;(async () => {
  try {
    const legacy = await runAudit()
    if (NOTIFY) await runNotify(legacy)
    else if (legacy.length > 0) {
      console.log('\n[audit] Read-only. To email these users a reset link via the existing rail:')
      console.log('        NOTIFY_CONFIRM=yes node scripts/legacy-password-reset-notify.js')
    }
  } catch (err) {
    console.error('\n[legacy-password-reset-notify] FAILED:', err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
})()
