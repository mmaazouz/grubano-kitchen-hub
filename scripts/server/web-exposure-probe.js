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
  '/scripts/server/prod-db-verify.js',
  '/scripts/cron/monthly-invoices.js',
  '/scripts/cron/cron-target-guard.js',
  '/lib/ledger-check-core.js',
  /* FOUND BY PROBING, not by reading the deploy step — the second `lib/*-core.js` the operators
     require(). A DENY list assembled from memory misses exactly the sibling of the file you
     remembered, which is why this list is now derived from what the docroot actually serves. */
  '/lib/claims-payable-core.js',
  '/.env.local',
  '/.env',
  '/.env.production',
  '/.htaccess',
  '/.next/BUILD_ID',
  '/.next/server/app/page.js',
  /* The two build manifests, and they are the worst of the set. `routes-manifest.json` is 48 KB of
     EVERY route the application has — admin and internal API paths included — and
     `required-server-files.json` carries the resolved Next config. Both measured at 200 on staging
     on 2026-09-29, and neither was in the first version of this list. */
  '/.next/required-server-files.json',
  '/.next/routes-manifest.json',
  /* `public/` is served at the ROOT by Next, so reaching the same bytes under `/public/…` proves
     Apache is walking the deploy tree — harmless content, but it is the layout talking. Nothing in
     the application requests this prefix (verified: zero `"/public/` references in app, lib,
     components and the service worker). */
  '/public/version.json',
  '/public/manifest.webmanifest',
  '/prisma/migrations/0_init/migration.sql',
  /* ── FOUND BY AN ADVERSARIAL REVIEW, and this one is not information disclosure, it is a
     CREDENTIAL LEAK. `.next/prerender-manifest.json` carries `previewModeId`,
     `previewModeSigningKey` and `previewModeEncryptionKey` — verified by reading the local build's
     own copy, key NAMES only — and it was measured at 200 / 99 500 B on staging on 2026-09-29.
     Those three values let anyone forge Next draft-mode cookies. The first version of this list
     asked for `/.next/BUILD_ID`, twenty-one bytes, and would have reported the `.next` line of the
     rule as verified by the least valuable file in the directory. */
  '/.next/prerender-manifest.json',
  '/.next/app-build-manifest.json',
  '/.next/build-manifest.json',
  '/.next/server/middleware-manifest.json',
  /* The Passenger restart marker: 98 B holding the deployed SHA and the Actions run id. Nothing
     requests it over HTTP — Passenger reads it from disk. */
  '/tmp/restart.txt',
  /* A QUERY STRING must not be a bypass. RedirectMatch matches the URL-path, which excludes the
     query, so `^/…$` anchors still bite — but that is a claim, and a claim in a comment is not a
     control. Measured at 200 before the rule. */
  '/prisma/schema.prisma?x=1',
]

/* Directory URLs — the OTHER half of `(/|$)` in the rule, and the half nothing was verifying.
   These are asserted differently from the list above: today they answer 308 (no file, so the
   request falls through to Next's locale redirect), and 308 is NOT 200, so a "must not return 200"
   test passes on them BEFORE the rule exists and proves nothing. After the rule they must answer
   404 — that is the only outcome that shows the directory branch actually fired. An Apache index
   listing of /scripts/server/ would also be caught here and nowhere else. */
const DENY_DIRS = ['/prisma/', '/scripts/', '/scripts/server/', '/lib/', '/messages/', '/node_modules/', '/public/', '/.next/', '/tmp/']

/* The subset of DENY that was MEASURED at 200 on app.grubano.com on 2026-09-29. After the rule each
   of these MUST have flipped to 403/404. It matters because a DENY entry for a file the host does
   not have can never turn EXPOSED: without this list, "EXPOSED 0" cannot tell "the rule fired" from
   "the file was never there", and a mistyped token in the rule would survive a green board. */
const MEASURED_EXPOSED_2026_09_29 = new Set([
  '/prisma/schema.prisma', '/prisma/schema.prisma?x=1', '/package.json', '/server.js',
  '/scripts/server/staging-backup.js', '/scripts/server/phase2-refund-gate.js',
  '/scripts/cron/monthly-invoices.js', '/scripts/cron/cron-target-guard.js',
  '/lib/ledger-check-core.js', '/lib/claims-payable-core.js',
  '/.next/BUILD_ID', '/.next/required-server-files.json', '/.next/routes-manifest.json',
  '/.next/prerender-manifest.json', '/.next/app-build-manifest.json', '/.next/build-manifest.json',
  '/.next/server/middleware-manifest.json', '/tmp/restart.txt',
  '/public/version.json', '/public/manifest.webmanifest',
])

/* MUST keep working — the founder's own checklist, item by item. `/version.json` is the deploy's
   health check; the two auth pages are what the client-bundle-integrity gate reads;
   `/api/restaurants` is the DB reachability gate; and the last five are the PUBLIC assets, which a
   rule written by file extension would have killed along with the bundles. Every one of these was
   measured at 200 on staging before the rule, so a 4xx after it is the rule's fault and nothing else. */
const ALLOW_PAGES = [
  '/version.json',
  '/api/restaurants',
  '/fr/eat',
  '/fr/auth/magic',
  '/fr/eat/auth',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/sw.js',
  '/offline.html',
  '/icons/icon-192.png',
  '/apple-touch-icon.png',
  '/fonts/OFL-cairo.txt',
]

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
  let mustFlipChecked = 0
  let absentAnyway = 0
  console.log('')
  console.log('DENY — must not return content   (* = measured 200 on 2026-09-29, so it MUST have flipped)')
  for (const p of DENY) {
    const r = await head(BASE + p)
    const served = r.code === 200
    const tracked = MEASURED_EXPOSED_2026_09_29.has(p)
    if (served) exposed.push(`${p} → 200 (${r.len} B, ${r.type.split(';')[0]})`)
    else if (tracked) mustFlipChecked++
    else absentAnyway++
    console.log(`  ${served ? 'EXPOSED' : 'ok     '} ${tracked ? '*' : ' '} ${String(r.code).padEnd(4)} ${String(r.len).padStart(7)} B  ${p}`)
  }

  console.log('')
  console.log('DENY — directory URLs, which must answer 404 (308 = the rule did NOT fire)')
  for (const p of DENY_DIRS) {
    const r = await head(BASE + p)
    /* 404 or 403 = the rule fired. 308/200/2xx = it did not, and a 200 would be an index listing. */
    const ok = r.code === 404 || r.code === 403
    if (!ok) exposed.push(`${p} → ${r.code} (the directory branch of the rule did not fire; 200 would be an index listing)`)
    console.log(`  ${ok ? 'ok     ' : 'EXPOSED'} ${String(r.code).padEnd(4)} ${p}`)
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
    /* JS and CSS are reported SEPARATELY and each must be non-empty. The founder's checklist names
       « chunks JS 200 » and « CSS 200 » as two items, and they fail differently: a rule that killed
       only the stylesheets would leave a working but unstyled site, which a combined count could
       hide behind the JS successes. A page that references zero of either is itself a finding. */
    let bad = 0
    let js = 0
    let css = 0
    for (const a of assets.slice(0, 40)) {
      const h = await head(BASE + a)
      checked++
      if (h.code === 200) { if (a.endsWith('.css')) css++; else js++ }
      else { bad++; broken.push(`${a} → ${h.code} (referenced by ${page})`) }
    }
    if (js === 0) broken.push(`${page}: ZERO JavaScript chunk returned 200 — the 2026-09-06 P0 shape`)
    if (css === 0) broken.push(`${page}: ZERO stylesheet returned 200 — the page would render unstyled`)
    console.log(`  ${bad || !js || !css ? 'BROKEN ' : 'ok     '} ${page}: ${assets.length} referenced, ${Math.min(assets.length, 40)} checked · JS 200 = ${js} · CSS 200 = ${css} · not 200 = ${bad}`)
  }

  console.log('')
  console.log('========================================')
  /* BUNDLES CHECKED = 0 IS A FAILURE, NOT A NOTE. The previous version printed a warning beside a
     PASS — a clause documented in the header and not implemented in the code, which is the exact
     shape of defect this repository keeps paying for. If no page could be enumerated, the positive
     control did not run, so the verdict says nothing about the client and must not be green. */
  if (checked === 0) broken.push('BUNDLES CHECKED = 0 — the positive control did not run, so a PASS would prove nothing about the client')
  const pass = exposed.length === 0 && broken.length === 0
  console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'))
  console.log('EXPOSED (should be 0): ' + exposed.length)
  for (const e of exposed) console.log('   ! ' + e)
  console.log('BROKEN  (should be 0): ' + broken.length)
  for (const b of broken) console.log('   ! ' + b)
  console.log('BUNDLES CHECKED: ' + checked)
  console.log('DENY ENTRIES THAT FLIPPED FROM A MEASURED 200: ' + mustFlipChecked + ' / ' + MEASURED_EXPOSED_2026_09_29.size)
  console.log('DENY ENTRIES THE HOST NEVER HAD (no signal): ' + absentAnyway)
  console.log('DATABASE CHANGED: NO · STRIPE CALLED: NO')
  console.log('========================================')
  process.exit(pass ? 0 : 1)
})()
