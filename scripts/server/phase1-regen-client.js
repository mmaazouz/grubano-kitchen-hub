'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   phase1-regen-client.js — ONE-SHOT, FAIL-CLOSED, IDEMPOTENT: regenerate the
   server's Prisma client against the deployed (Phase 1) schema and restart.

   WHY THIS EXISTS. The FTPS deploy deliberately excludes node_modules/.prisma; the
   client is meant to be rebuilt on the server by the post-deploy SSH step
   (`npx prisma@5.22.0 generate`). That SSH step is `continue-on-error` and o2switch
   intermittently firewalls the GitHub runner: on the Phase 1 deploy (6545489) AND
   the previous one (49cea68) it ended in `dial tcp …:22: i/o timeout` — green step,
   nothing executed. Result: Phase 1 code running against a STALE client that does
   not know the new columns (sourceEventId / actorId / recoveryOffsetPoints), so the
   loyalty reconciliation + earn credit would silently no-op inside their
   best-effort catches. This operator closes that gap in ONE founder command:

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase1-regen-client.js

   It: locates the nodevenv npx next to the running node → runs
   `prisma@5.22.0 generate` in the app root → PROVES the regenerated client exposes
   the Phase 1 fields (reads the generated .d.ts) → touches tmp/restart.txt so
   Passenger reloads → prints a single PASS / FAIL. Fail-closed: any step failing
   → FAIL, non-zero exit, no PASS. Idempotent: re-running just regenerates + re-proves.

   SCOPE: staging one-off. No DB write, no schema change, no money, no refund.
   No secrets read or printed. Nothing is coupled to deploy.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const APP_ROOT = process.env.PHASE1_APP_ROOT || path.join(__dirname, '..', '..')
const REQUIRED_FIELDS = ['recoveryOffsetPoints', 'sourceEventId', 'actorId']
// Optional negative-control hook for local testing ONLY (never set on the server):
// forces the verification to look for a field that must NOT exist → proves FAIL path.
const VERIFY_FIELDS = process.env.PHASE1_VERIFY_FIELDS
  ? process.env.PHASE1_VERIFY_FIELDS.split(',').map((s) => s.trim()).filter(Boolean)
  : REQUIRED_FIELDS

function pass(o) {
  console.log('========================================')
  console.log('GRUBANO PHASE 1 CLIENT REGENERATION')
  console.log('RESULT: PASS')
  console.log('PRISMA GENERATE: ' + o.generate)
  console.log('CLIENT FIELDS: ' + o.fields)
  console.log('PASSENGER RESTART: ' + o.restart)
  console.log('SAFE TO CONTINUE: YES')
  console.log('========================================')
  process.exit(0)
}
function fail(step, action) {
  console.log('========================================')
  console.log('GRUBANO PHASE 1 CLIENT REGENERATION')
  console.log('RESULT: FAIL')
  console.log('FAILED STEP: ' + step)
  console.log('SAFE TO CONTINUE: NO')
  console.log('ACTION: ' + (action || 'RETURN THIS OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(1)
}

;(function main() {
  // ── 1. environment: app root + schema present ────────────────────────────
  const schemaPath = path.join(APP_ROOT, 'prisma', 'schema.prisma')
  if (!fs.existsSync(schemaPath)) return fail('1 env: prisma/schema.prisma not found under ' + APP_ROOT, 'run from the deployed app (~/app.grubano.com)')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  // The DEPLOYED schema must itself carry the Phase 1 fields — otherwise we are
  // regenerating a pre-Phase-1 client and must say so instead of printing PASS.
  const missingInSchema = REQUIRED_FIELDS.filter((f) => !schema.includes(f))
  if (missingInSchema.length) return fail('1 env: deployed schema lacks Phase 1 fields ' + missingInSchema.join(','), 'deploy Phase 1 code first')

  // ── 2/3. prisma generate (pinned 5.22.0, same as the deploy workflow) ─────
  // Two routes, tried in order, NO shell (so paths with spaces never split):
  //  (a) the app's own pinned CLI  node_modules/prisma/build/index.js  via the
  //      node that runs this script — used when present (dev/local);
  //  (b) the workflow's exact command  npx prisma@5.22.0 generate  using the
  //      nodevenv npx that sits next to the running node — the server route.
  const localCli = path.join(APP_ROOT, 'node_modules', 'prisma', 'build', 'index.js')
  const binDir = path.dirname(process.execPath)
  const npxPath = [path.join(binDir, 'npx'), path.join(binDir, 'npx.cmd')].find((c) => fs.existsSync(c))
  console.log('[regen] app root:', APP_ROOT)
  console.log('[regen] node:', process.execPath)
  const runEnv = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }
  let genOut = ''
  let route = ''
  try {
    if (fs.existsSync(localCli)) {
      route = 'local CLI ' + path.relative(APP_ROOT, localCli)
      genOut = execFileSync(process.execPath, [localCli, 'generate'], { cwd: APP_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: runEnv })
    } else if (npxPath && process.platform !== 'win32') {
      route = 'npx prisma@5.22.0 (' + npxPath + ')'
      genOut = execFileSync(npxPath, ['prisma@5.22.0', 'generate'], { cwd: APP_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: runEnv })
    } else if (npxPath) {
      // Windows fallback (dev only): npx.cmd needs cmd.exe; quote the path explicitly.
      route = 'npx.cmd prisma@5.22.0'
      genOut = execFileSync('cmd.exe', ['/d', '/s', '/c', '"' + npxPath + '" prisma@5.22.0 generate'], { cwd: APP_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: runEnv, windowsVerbatimArguments: true })
    } else {
      return fail('3 prisma generate: no local CLI and no npx next to ' + process.execPath, 'run with the nodevenv node')
    }
  } catch (e) {
    const msg = String((e && (e.stderr || e.stdout || e.message)) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)
    return fail('3 prisma generate failed via ' + route + ': ' + msg, 'check nodevenv / prisma 5.22.0 availability')
  }
  console.log('[regen] generate route:', route)
  if (!/Generated Prisma Client/i.test(genOut)) return fail('3 prisma generate: no "Generated Prisma Client" marker in output', 'RETURN THIS OUTPUT TO CLAUDE CODE')

  // ── 4. PROVE the regenerated client exposes the Phase 1 fields ─────────────
  const dtsCandidates = [
    path.join(APP_ROOT, 'node_modules', '.prisma', 'client', 'index.d.ts'),
    path.join(APP_ROOT, 'node_modules', '@prisma', 'client', 'index.d.ts'),
  ]
  const dts = dtsCandidates.find((p) => fs.existsSync(p))
  if (!dts) return fail('4 verify: generated client index.d.ts not found', 'RETURN THIS OUTPUT TO CLAUDE CODE')
  const types = fs.readFileSync(dts, 'utf8')
  const missing = VERIFY_FIELDS.filter((f) => !types.includes(f))
  if (missing.length) return fail('4 verify: regenerated client lacks fields ' + missing.join(','), 'schema/client mismatch — RETURN THIS OUTPUT')

  // ── 5. Passenger restart (the same touch the deploy workflow performs) ─────
  let restart = 'SKIPPED'
  try {
    fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
    const rf = path.join(APP_ROOT, 'tmp', 'restart.txt')
    fs.writeFileSync(rf, String(Date.now()))
    restart = 'TOUCHED tmp/restart.txt'
  } catch (e) {
    return fail('5 restart: could not touch tmp/restart.txt (' + String(e.message || e).slice(0, 120) + ')')
  }

  return pass({
    generate: 'OK (' + route + ', marker present)',
    fields: 'VERIFIED (' + VERIFY_FIELDS.join(', ') + ' present in ' + path.relative(APP_ROOT, dts) + ')',
    restart,
  })
})()
