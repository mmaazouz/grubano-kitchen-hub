// scripts/qa-healthcheck.js
// Agent 8 — QA vigie. Smoke-tests the PUBLIC key routes of staging + prod to
// confirm the apps are up. Read-only: only HTTP GET, never mutates anything.
//
// Usage:
//   node scripts/qa-healthcheck.js          → prints OK/KO per route, exit 1 if any KO
//   require('./qa-healthcheck').runHealthcheck()  → returns Promise<{ ok, results }>
//
// "Expected": a route is OK when the FINAL response (after following up to 5
// redirects) is HTTP 200. Locale/auth redirects are followed, not treated as KO.

'use strict'
const https = require('https')
const http = require('http')

// Public routes that must always answer. `json:true` also asserts a non-empty
// JSON body. `mode:'up'` accepts any 2xx/3xx as healthy (used for the prod root,
// which intentionally 307-redirects to the detected locale — and o2switch's edge
// cache serves that redirect WITHOUT a Location header, so we must not chase it).
// `agent` names who to ping if this route is KO (used by qa-report).
const ROUTES = [
  { name: 'staging /fr/eat',       url: 'https://app.grubano.com/fr/eat',       agent: 'agent3' },
  { name: 'staging /fr/franchise', url: 'https://app.grubano.com/fr/franchise', agent: 'agent4' },
  { name: 'staging /fr/creators',  url: 'https://app.grubano.com/fr/creators',  agent: 'agent4' },
  { name: 'prod root',             url: 'https://www.grubano.com',              agent: 'agent1', mode: 'up' },
  { name: 'staging /api/restaurants (geo)', url: 'https://app.grubano.com/api/restaurants?lat=44.14&lng=4.81', agent: 'agent2', json: true },
]

const TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 5

function fetchOnce(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: { 'User-Agent': 'grubano-qa-healthcheck/1.0' } }, (res) => {
      let body = ''
      // Cap body read so a huge HTML page doesn't bloat memory; JSON checks are small.
      res.on('data', (c) => { if (body.length < 200_000) body += c })
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }))
    })
    req.on('error', (err) => resolve({ status: 0, error: err.message }))
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve({ status: 0, error: `timeout after ${TIMEOUT_MS}ms` }) })
  })
}

async function fetchFollowing(startUrl) {
  let url = startUrl
  let last = null
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    last = await fetchOnce(url)
    if (last.status >= 300 && last.status < 400 && last.location) {
      url = new URL(last.location, url).toString()
      continue
    }
    break
  }
  return { ...last, finalUrl: url }
}

async function checkRoute(route) {
  // 'up' routes answer with an intentional redirect we must NOT follow; every
  // other route is followed to its final response and must land on 200.
  const r = route.mode === 'up' ? await fetchOnce(route.url) : await fetchFollowing(route.url)
  let ok = route.mode === 'up' ? (r.status >= 200 && r.status < 400) : r.status === 200
  let detail = r.error ? r.error : `HTTP ${r.status}`
  if (ok && route.json) {
    try {
      const parsed = JSON.parse(r.body)
      const empty = parsed == null || (Array.isArray(parsed) && parsed.length === 0) ||
        (typeof parsed === 'object' && Object.keys(parsed).length === 0)
      if (empty) { ok = false; detail = 'HTTP 200 but empty JSON' }
      else detail = 'HTTP 200, JSON non-empty'
    } catch {
      ok = false; detail = 'HTTP 200 but body is not JSON'
    }
  }
  return { ...route, ok, status: r.status, detail }
}

async function runHealthcheck() {
  const results = await Promise.all(ROUTES.map(checkRoute))
  const ok = results.every((r) => r.ok)
  return { ok, results }
}

async function main() {
  console.log('\n=== Grubano QA healthcheck (vigie) ===')
  const { ok, results } = await runHealthcheck()
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK ' : 'KO '} ${r.name.padEnd(34)} ${r.detail}`)
  }
  const ko = results.filter((r) => !r.ok).length
  console.log(`\n${ok ? 'All routes OK' : `${ko} route(s) KO`} (${results.length} checked)\n`)
  process.exit(ok ? 0 : 1)
}

module.exports = { runHealthcheck, ROUTES }

if (require.main === module) {
  main().catch((err) => { console.error('[qa-healthcheck]', err); process.exit(1) })
}
