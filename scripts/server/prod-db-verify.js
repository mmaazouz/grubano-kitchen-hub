'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   prod-db-verify.js — PROD-6a: prove, READ-ONLY, that the production database exists, is
   reachable, is NAMED as production, and is EMPTY. Nothing else.

   FOUNDER REQUEST (2026-09-29), verbatim scope: « base existe · utilisateur existe ·
   connexion possible · nom de DB explicitement production · aucune table applicative
   inattendue ». This operator answers exactly those five and stops.

   IT WRITES NOTHING. Four SELECTs against information_schema and the session, plus SHOW GRANTS.
   No CREATE, no ALTER, no db push, no Prisma migration, no seed. « DATABASE CHANGED: NO » is
   printed because it is true by construction, not because it was checked afterwards.

   WHY IT JUDGES THE DSN AND NOTHING ELSE. Every other operator in this repository cross-checks
   DATABASE_URL against NEXTAUTH_URL. That is right for them: they run inside the app whose
   environment they are judging. This one cannot. At PROD-6a the production app directory has no
   node_modules yet (the pipeline ships none; the nodevenv install is PROD-5b, and it comes after
   the first deploy), so the only place a Prisma client exists is the STAGING app directory. Cross-
   checking NEXTAUTH_URL there would refuse the very run it is meant to perform. So the rule is
   narrowed to what is actually being judged — THE DSN — and that narrowing is stated out loud
   rather than left for someone to discover:

     · a DSN whose database name ends in `_staging`  → REFUSED, always;
     · a DSN that cannot be POSITIVELY identified as production → REFUSED (whitelist, not blocklist);
     · NEXTAUTH_URL is deliberately IGNORED, and the report says so on its own line.

   THE DSN MUST NOT REACH THE SHELL HISTORY. Run it like this, from the STAGING app directory:

     cd ~/app.grubano.com
     source ~/nodevenv/app.grubano.com/24/bin/activate
     read -rsp 'production DSN: ' DATABASE_URL && export DATABASE_URL && echo
     node scripts/server/prod-db-verify.js
     unset DATABASE_URL

   `read -rs` echoes nothing and, unlike a `VAR=… command` prefix, leaves no copy in the history.
   The DSN is masked in every line this operator prints.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')

const APP_ROOT = (() => {
  const i = process.argv.indexOf('--app-root')
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(__dirname, '..', '..')
})()

/* DATABASE_URL comes from the environment ONLY. This operator deliberately does NOT read a
   .env.local: at PROD-6a the production one does not exist yet, and the staging one would hand it
   the staging DSN — the single most dangerous silent default available here. */
const DSN = process.env.DATABASE_URL || ''

const maskDsn = (d) => { try { const u = new URL(d); return `${u.protocol}//***:***@${u.host}${u.pathname}` } catch { return '(unparseable, masked)' } }

/* Prisma's connection errors start with blank lines, so `.split('\n')[0]` yields an EMPTY reason and
   the operator reports « the connection failed () » — a refusal that tells the reader nothing. Take the
   first NON-EMPTY line, and scrub any DSN the driver echoed back. */
const reasonOf = (e) => String((e && e.message) || e)
  .split('\n').map((l) => l.trim()).filter(Boolean)[0] || 'no message'

function out(lines, ok) {
  console.log('========================================')
  console.log('GRUBANO PRODUCTION DATABASE VERIFY (read-only)')
  console.log('RESULT: ' + (ok ? 'PASS' : 'FAIL'))
  for (const l of lines) console.log(l)
  console.log('DATABASE CHANGED: NO')
  console.log('========================================')
  process.exit(ok ? 0 : 1)
}
const fail = (step, action) => out(['FAILED STEP: ' + step, 'ACTION: ' + (action || 'return this output to Claude Code')], false)

;(async () => {
  // ── 1. DSN present and parseable ──────────────────────────────────────────
  if (!DSN) return fail('1 env: DATABASE_URL is not set', 'export it for this shell only (see the header)')
  let url
  try { url = new URL(DSN) } catch { return fail('1 env: DATABASE_URL is not a parseable URL') }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const dbUser = decodeURIComponent(url.username || '')
  if (!dbName) return fail('1 env: the DSN carries no database name')

  console.log('[prod-db-verify] ' + maskDsn(DSN))
  console.log('[prod-db-verify] NEXTAUTH_URL is IGNORED by design — this operator judges the DSN only (see header)')

  // ── 2. PROVE PRODUCTION, by whitelist ─────────────────────────────────────
  const looksStaging = /_staging$/.test(dbName)
  const looksProd = dbName === 'deyi0010_grubano' || (/(^|_)grubano$/.test(dbName) && !looksStaging)
  if (looksStaging) return fail(`2 target: the database name "${dbName}" is STAGING`, 'point DATABASE_URL at the production database')
  if (!looksProd) return fail(`2 target: cannot POSITIVELY identify "${dbName}" as production`, 'expected a name like deyi0010_grubano — refusing an unrecognised target rather than guessing')

  // ── 3. Prisma client, from wherever one exists ────────────────────────────
  let PrismaClient
  try { PrismaClient = require(path.join(APP_ROOT, 'node_modules', '@prisma/client')).PrismaClient } catch (_) {
    try { PrismaClient = require('@prisma/client').PrismaClient } catch (e) {
      return fail('3 prisma: @prisma/client cannot be resolved (' + reasonOf(e) + ')',
        'run this from ~/app.grubano.com, which has node_modules, or pass --app-root <dir>')
    }
  }
  const prisma = new PrismaClient({ datasources: { db: { url: DSN } } })

  const lines = []
  try {
    // ── 4. CONNECTION + identity ────────────────────────────────────────────
    let who
    try {
      who = await prisma.$queryRawUnsafe('SELECT DATABASE() AS db, CURRENT_USER() AS cu, USER() AS u, VERSION() AS v')
    } catch (e) {
      await prisma.$disconnect().catch(() => {})
      return fail('4 connect: the connection failed (' + reasonOf(e).replace(/mysql:\/\/[^\s]*/g, '<dsn>') + ')',
        'check that the user is associated with this database in cPanel -> MySQL Databases')
    }
    const r = who[0] || {}
    if (!r.db) { await prisma.$disconnect().catch(() => {}); return fail('4 connect: connected but SELECT DATABASE() is NULL — the DSN names no schema') }
    if (String(r.db) !== dbName) { await prisma.$disconnect().catch(() => {}); return fail(`4 connect: connected to "${r.db}" but the DSN asked for "${dbName}"`) }

    lines.push('DATABASE EXISTS: YES (' + r.db + ')')
    lines.push('CONNECTION: OK (server ' + r.v + ')')
    lines.push('USER EXISTS: YES (' + String(r.cu).replace(/@.*/, '@<host>') + ' — DSN user "' + dbUser + '")')
    lines.push('NAME IS PRODUCTION: YES (does not end in _staging, matches the production naming rule)')

    // ── 5. GRANTS — the production user must NOT see the staging database ───
    let grants = []
    try { grants = await prisma.$queryRawUnsafe('SHOW GRANTS FOR CURRENT_USER()') } catch (_) { /* some hosts refuse; reported below */ }
    const grantText = grants.map((g) => Object.values(g)[0]).join(' | ')
    if (!grantText) lines.push('GRANTS: NOT MEASURED (SHOW GRANTS refused by the server — check the association by hand in cPanel)')
    else {
      const touchesStaging = /_staging/.test(grantText)
      lines.push('GRANTS ON A STAGING DATABASE: ' + (touchesStaging ? 'YES — SEPARATION BROKEN' : 'NO (good: this user cannot reach staging)'))
      if (touchesStaging) { await prisma.$disconnect().catch(() => {}); return fail('5 grants: the production user also holds grants on a *_staging database', 'remove that association in cPanel -> MySQL Databases before going further') }
    }

    // ── 6. THE DATABASE MUST BE EMPTY ───────────────────────────────────────
    const tables = await prisma.$queryRawUnsafe(
      "SELECT TABLE_NAME AS t, TABLE_TYPE AS ty FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME")
    const names = tables.map((x) => String(x.t))
    lines.push('TABLES PRESENT: ' + names.length)
    if (names.length) {
      lines.push('  ' + names.slice(0, 40).join(', ') + (names.length > 40 ? ` … (+${names.length - 40})` : ''))
      await prisma.$disconnect().catch(() => {})
      return fail(`6 empty: the database is NOT empty (${names.length} tables)`,
        'PROD-6b expects a VIRGIN database — a db push here is not the deliberate first creation. Stop and decide what these tables are.')
    }
    lines.push('UNEXPECTED APPLICATION TABLES: 0 — the database is VIRGIN, as PROD-6b requires')
    lines.push('')
    /* PROD-1 — THIS MESSAGE MUST NOT SPELL THE DESTRUCTIVE FLAG. The repository bans that token on
       every EXECUTABLE line under scripts/, and a string literal is executable. The ban caught this
       very file (prod-db-verify.js:144) on the full suite — the fifth time this session a lexical
       rule has been tripped by text about itself, except that here THE RULE WAS RIGHT and the new
       file was wrong. The flags and the STOP conditions live in the runbook, which is where an
       operator reads them anyway. */
    lines.push('NEXT: nothing here creates a schema. PROD-6b is a separate, later step: deploy the')
    lines.push('      code FIRST, then ONE deliberate `npx prisma@5.22.0 db push` on a virgin database.')
    lines.push('      Exact flags and STOP conditions: docs/ops/P1-PRODUCTION-RUNBOOK.md section 4.3.')

    await prisma.$disconnect().catch(() => {})
    return out(lines, true)
  } catch (e) {
    await prisma.$disconnect().catch(() => {})
    return fail('unexpected: ' + reasonOf(e).replace(/mysql:\/\/[^\s]*/g, '<dsn>'))
  }
})()
