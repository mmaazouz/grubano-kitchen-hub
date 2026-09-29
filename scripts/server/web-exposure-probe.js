'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   web-exposure-probe.js — PROD-14: does this host serve files the web has no business
   reading? READ-ONLY, HTTP only. No DB, no Stripe, no write, no secret.

   FOUNDER ARBITRATION (2026-09-29): PROD-14 reclassed 🔴 BLOCKING BEFORE THE FIRST
   PRODUCTION DEPLOY — « Je ne veux pas que grubano.com puisse servir prisma/schema.prisma,
   package.json, server.js, scripts serveur/opérateur, fichiers source ou fichiers de
   configuration non destinés au web. »

   WHY A PROBE AND NOT A UNIT TEST. The defect is not in the repository: it is Apache's
   DocumentRoot serving files that exist. Only an HTTP request against the real host can
   observe it, and only the same request can prove the fix. So the verdict is mechanical and
   repeatable instead of « I looked and it seemed fine ».

   WHY POSITIVE CONTROLS ARE THE POINT. The obvious `.htaccess` rule denies `.js` — and
   EVERY client bundle under /_next/static/ is a `.js` file. A deny rule with the wrong scope
   turns the site into a permanent skeleton with inert forms: exactly the P0 of 2026-09-06,
   which every 200-based health check passed straight through. A probe that only checked the
   DENY list would report success on a dead site. Each run therefore asserts both directions
   and refuses to pass unless the ALLOW list is intact.

     node scripts/server/web-exposure-probe.js https://app.grubano.com
     node scripts/server/web-exposure-probe.js https://grubano.com

   Exit 0 = PASS (everything denied is denied AND everything allowed still works).
   Exit 1 = FAIL, and the block names every offending path.
   ═══════════════════════════════════════════════════════════════════════════════ */

const https = require('https')
const http = require('http')
const { URL } = require('url')

const BASE = (process.argv[2] || '').replace(/\/+$/, '')
if (!/^https?:\/\/[^/]+$/.test(BASE)) {
  console.error('usage: node scripts/server/web-exposure-probe.js https://<host>')
  process.exit(2)
}

/* MUST NOT be served: sources, manifests, operator scripts, config. 403 or 404 both count —
   what matters is that the CONTENT does not come back. */
const DENY = [
  '/prisma/schema.prisma',
  '/package.json',
  '/package-lock.json',
  '/server.js',
  '/next.config.js',
  '/tsconfig.json',
  '/scripts/server/staging-backup.js',
  '/scripts/server/phase2-refund-gate.js',
  '/scripts/cron/monthly-invoices.js',
  '/scripts/cron/cron-target-guard.js',
  '/lib/ledger-check-core.js',
  '/.env.local',
  '/.env',
  '/.env.production',
  '/.htaccess',
  '/.next/BUILD_ID',
  '/.next/server/app/page.js',
  '/prisma/migrations/0_init/migration.sql',
]

/* MUST keep working. `/version.json` is the deploy's own health check; the two pages are the
   ones the client-bundle-integrity gate reads; `/api/restaurants` is the DB reachability gate. */
const ALLOW_PAGES = ['/version.json', '/api/restaurants', '/fr/eat', '/fr/auth/magic', '/fr/eat/auth']

function head(url, method) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: method || 'GET', timeout: 25000, headers: { 'user-agent': 'grubano-web-exposure-probe' } },
      (res) => {
        let n = 0
        res.on('data', (c) => { n += c.length; if (n > 4096) res.destroy() })
        res.on('end', () => resolve({ code: res.statusCode, len: Number(res.headers['content-length'] || n) || n, type: res.headers['content-type'] || '' }))
        res.on('close', () => resolve({ code: res.statusCode, len: Number(res.headers['content-length'] || n) || n, type: res.headers['content-type'] || '' }))
      },
    )
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, len: 0, type: 'timeout' }) })
    req.on('error', (e) => resolve({ code: 0, len: 0, type: 'error:' + e.code }))
    req.end()
  })
}

/** Extract every /_next/static asset a served page references — the real bundle list.
 *  THE CHARACTER CLASS IS THE WORKFLOW'S, verbatim: the `Client bundle integrity` step of both
 *  deploy workflows uses `/_next/static/[^" <>\]*\.\(js\|css\)`. My first attempt here allowed a
 *  trailing backslash, so the RSC payload's escaped quotes yielded paths like `x.css\` and four
 *  phantom 308s that read exactly like a real regression. Re-deriving a truth derives a different
 *  one — so this reads the same class the gate reads. */
function assetsOf(html) {
  return Array.from(new Set(Array.from(html.matchAll(/\/_next\/static\/[^" <>\\]*\.(?:js|css)/g)).map((m) => m[0])))
}

function body(url) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'GET', timeout: 25000, headers: { 'user-agent': 'grubano-web-exposure-probe' } }, (res) => {
      let s = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { s += c; if (s.length > 800000) res.destroy() })
      res.on('end', () => resolve({ code: res.statusCode, html: s }))
      res.on('close', () => resolve({ code: res.statusCode, html: s }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, html: '' }) })
    req.on('error', () => resolve({ code: 0, html: '' }))
    req.end()
  })
}

;(async () => {
  console.log('========================================')
  console.log('GRUBANO WEB EXPOSURE PROBE (read-only)')
  console.log('TARGET: ' + BASE)
  console.log('========================================')

  const exposed = []
  console.log('')
  console.log('DENY — must not return content')
  for (const p of DENY) {
    const r = await head(BASE + p)
    const served = r.code === 200
    if (served) exposed.push(`${p} → 200 (${r.len} B, ${r.type.split(';')[0]})`)
    console.log(`  ${served ? 'EXPOSED' : 'ok     '} ${String(r.code).padEnd(4)} ${String(r.len).padStart(7)} B  ${p}`)
  }

  const broken = []
  console.log('')
  console.log('ALLOW — must keep working')
  for (const p of ALLOW_PAGES) {
    const r = await head(BASE + p)
    // 2xx and 3xx are fine (a locale or auth redirect); 4xx/5xx/0 on these is a break.
    const ok = r.code >= 200 && r.code < 400
    if (!ok) broken.push(`${p} → ${r.code}`)
    console.log(`  ${ok ? 'ok     ' : 'BROKEN '} ${String(r.code).padEnd(4)} ${p}`)
  }

  console.log('')
  console.log('ALLOW — every client bundle referenced by a served page (the 2026-09-06 P0)')
  let checked = 0
  for (const page of ['/fr/auth/magic', '/fr/eat/auth']) {
    const r = await body(BASE + page)
    if (r.code !== 200) { console.log(`  skipped ${page} (HTTP ${r.code}) — cannot enumerate its assets`); continue }
    const assets = assetsOf(r.html)
    if (!assets.length) { broken.push(`${page} references NO /_next/static asset`); console.log(`  BROKEN  ${page} references no bundle at all`); continue }
    let bad = 0
    for (const a of assets.slice(0, 25)) {
      const h = await head(BASE + a)
      checked++
      if (h.code !== 200) { bad++; broken.push(`${a} → ${h.code} (referenced by ${page})`) }
    }
    console.log(`  ${bad ? 'BROKEN ' : 'ok     '} ${page}: ${assets.length} assets referenced, ${Math.min(assets.length, 25)} checked, ${bad} not 200`)
  }

  console.log('')
  console.log('========================================')
  const pass = exposed.length === 0 && broken.length === 0
  console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'))
  console.log('EXPOSED (should be 0): ' + exposed.length)
  for (const e of exposed) console.log('   ! ' + e)
  console.log('BROKEN  (should be 0): ' + broken.length)
  for (const b of broken) console.log('   ! ' + b)
  console.log('BUNDLES CHECKED: ' + checked + (checked === 0 ? '  ← no positive control ran: a PASS here proves nothing about the client' : ''))
  console.log('DATABASE CHANGED: NO · STRIPE CALLED: NO')
  console.log('========================================')
  process.exit(pass ? 0 : 1)
})()
