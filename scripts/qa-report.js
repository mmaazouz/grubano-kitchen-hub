// scripts/qa-report.js
// Agent 8 — QA vigie + ALERTE automatique (cœur de la mission).
//
// Runs the Vitest suite (test:ci) + the prod/staging healthcheck, aggregates the
// results, and:
//   • if anything is RED  → writes a detailed [ALERTE] to the Notion inbox (and a
//     summary to the brain), DESIGNATING the responsible agent per failing zone.
//   • if everything is GREEN → writes a short [INFO] line to the inbox for traçabilité.
//
// This script DIAGNOSES and SIGNALS only — it never edits another agent's code.
//
// Usage:
//   node scripts/qa-report.js              (CI on push to develop, or daily cron)
//   node scripts/qa-report.js --no-notion  (run checks, skip Notion writes)
//
// Exit code: 0 when all green, 1 when any test fails or any route is KO (so it can
// also gate a CI step). Notion writes are best-effort and never change the result.

'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const NOTION_SYNC = path.join(__dirname, 'notion-sync.js')
const RESULTS_FILE = path.join(ROOT, 'qa-vitest-results.json')

const NO_NOTION = process.argv.includes('--no-notion')

// Map a failing test FILE → the agent who owns that zone (numbers per CLAUDE/brief).
//   middleware + i18n → 7 ; /api/restaurants + parrainage + geo → 2 ; harness → 8.
const FILE_AGENT = {
  'middleware.test.ts':         { agent: '7', zone: 'middleware (routage rôle / anti-boucle)' },
  'i18n-completeness.test.ts':  { agent: '7', zone: 'i18n (clé manquante ou vide)' },
  'restaurants-radius.test.ts': { agent: '2', zone: '/api/restaurants (tri distance / radius / categoryHadNoMatch)' },
  'referral-earning.test.ts':   { agent: '2', zone: 'parrainage (creatorEarning figé / arrondi)' },
  'geocode.test.ts':            { agent: '2', zone: 'lib/geocode haversine (alimente /api/restaurants)' },
  'sanity.test.ts':             { agent: '8', zone: 'harnais QA (sanity)' },
}
const fileAgent = (file) => FILE_AGENT[path.basename(file)] || { agent: '8', zone: `test ${path.basename(file)}` }

// Healthcheck route.agent ("agent3") → number ("3") for the alert text.
const routeAgentNum = (a) => String(a || '').replace(/^agent/, '') || '?'

// ── 1. Run Vitest (JSON reporter to a file so we can attribute failures) ──────
function runTests() {
  // Clean any stale results so a crashed run can't masquerade as a pass.
  try { fs.existsSync(RESULTS_FILE) && fs.unlinkSync(RESULTS_FILE) } catch {}

  const res = spawnSync(
    process.execPath,
    [VITEST, 'run', '--reporter=json', `--outputFile=${RESULTS_FILE}`],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let parsed = null
  try { parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) } catch {}

  if (!parsed) {
    // Couldn't even parse results → treat as a hard QA failure (suite broken).
    return {
      ok: false, total: 0, passed: 0, failed: 0,
      failedZones: [{ agent: '8', zone: 'suite Vitest illisible (échec d\'exécution)' }],
      raw: (res.stdout || '') + (res.stderr || ''),
    }
  }

  const fileResults = parsed.testResults || []
  const failedFiles = fileResults.filter((t) => t.status === 'failed')
  const failedZones = failedFiles.map((t) => fileAgent(t.name))

  return {
    ok: (parsed.numFailedTests || 0) === 0 && (res.status === 0 || failedFiles.length === 0),
    total: parsed.numTotalTests || 0,
    passed: parsed.numPassedTests || 0,
    failed: parsed.numFailedTests || 0,
    failedZones,
  }
}

// ── 2. Run the healthcheck (network, read-only) ──────────────────────────────
async function runHealth() {
  const { runHealthcheck } = require('./qa-healthcheck')
  const { ok, results } = await runHealthcheck()
  const koRoutes = results
    .filter((r) => !r.ok)
    .map((r) => ({ agent: routeAgentNum(r.agent), zone: `route ${r.name} (${r.detail})` }))
  return { ok, total: results.length, ko: koRoutes }
}

// ── 3. Notion writes (best-effort) ───────────────────────────────────────────
function notionWrite(target, message) {
  if (NO_NOTION) { console.log(`[qa-report] (--no-notion) would write to ${target}: ${message}`); return }
  if (!process.env.NOTION_TOKEN && !fs.existsSync(path.join(ROOT, '.env.local'))) {
    console.warn(`[qa-report] NOTION_TOKEN absent — skipping ${target} write. Message was:\n  ${message}`)
    return
  }
  const res = spawnSync(process.execPath, [NOTION_SYNC, 'write', target, message], { cwd: ROOT, encoding: 'utf8' })
  if (res.status !== 0) {
    console.warn(`[qa-report] Notion write to ${target} failed (non-fatal): ${res.stderr || res.stdout}`)
  } else {
    console.log(`[qa-report] Notion ${target} updated.`)
  }
}

// Group failing zones by responsible agent so each owner gets one clear ping.
function groupByAgent(zones) {
  const byAgent = new Map()
  for (const z of zones) {
    if (!byAgent.has(z.agent)) byAgent.set(z.agent, [])
    byAgent.get(z.agent).push(z.zone)
  }
  return byAgent
}

async function main() {
  console.log('=== Grubano QA report (Agent 8 vigie) ===')

  const tests = runTests()
  console.log(`Tests: ${tests.passed}/${tests.total} passed, ${tests.failed} failed`)

  const health = await runHealth()
  console.log(`Healthcheck: ${health.total - health.ko.length}/${health.total} routes OK`)

  const allGreen = tests.ok && health.ok
  const allZones = [...tests.failedZones, ...health.ko]

  if (allGreen) {
    notionWrite('inbox', `[AGENT 8] [INFO] QA verte (${tests.passed} tests, ${health.total} routes). Action required: no`)
    console.log('\nQA GREEN — all tests pass, all routes OK.')
    process.exit(0)
  }

  // RED — one [ALERTE] per responsible agent, then a brain summary.
  const byAgent = groupByAgent(allZones)
  for (const [agent, zones] of byAgent) {
    const what = zones.join(' ; ')
    notionWrite('inbox', `[AGENT 8] [ALERTE] QA rouge — ${what} — Agent responsable: ${agent} — Action required: yes`)
  }
  const summary = `[AGENT 8] [ALERTE] QA rouge: ${tests.failed} test(s) en échec, ${health.ko.length} route(s) KO. ` +
    `Agents à intervenir: ${[...byAgent.keys()].join(', ')}. Détail dans l'inbox. Action required: yes`
  notionWrite('brain', summary)

  console.log('\nQA RED:')
  for (const [agent, zones] of byAgent) console.log(`  Agent ${agent}: ${zones.join(' ; ')}`)
  process.exit(1)
}

main().catch((err) => {
  console.error('[qa-report] fatal:', err)
  // A crash in the reporter is itself a QA alert.
  notionWrite('inbox', `[AGENT 8] [ALERTE] qa-report.js a planté: ${err && err.message} — Agent responsable: 8 — Action required: yes`)
  process.exit(1)
})
