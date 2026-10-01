'use strict'
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   dprime-regen-client.js — ONE-SHOT, FAIL-CLOSED, IDEMPOTENT: regenerate the server's Prisma
   client against the deployed D′ schema (lot L3b) and restart Passenger.

     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/dprime-regen-client.js

   WHY IT EXISTS. The FTPS deploy excludes node_modules/.prisma; the client is meant to be rebuilt
   by the post-deploy SSH step (`npx prisma@5.22.0 generate`), which is `continue-on-error` and has
   already ended in `dial tcp …:22: i/o timeout` — a GREEN step that executed nothing. The result
   is D′ code running against a STALE client that does not know approvedAmountCents / selection /
   deliveredAt: every read of them would be undefined and every write would throw inside a
   best-effort catch. This operator closes that gap in one command and PROVES the outcome.

   IT IS NOT the Phase 1 operator with new strings: it verifies the D′ fields and NOTHING ELSE, and
   it refuses to certify a client generated from a schema that does not carry them. Phase 1's
   operator keeps its own contract (loyalty fields) and is not reused here.

   Steps, aborting NON-ZERO on the first failure:
     0 the DEPLOYED BUILD is the one the founder pinned — DPRIME_EXPECT_SHA against the static
       public/version.json (read-only; skipped when unset, and the report says so) → 1 the deployed
       prisma/schema.prisma carries the three D′ fields, each on its model (Claim gets
       approvedAmountCents + selection, Order gets deliveredAt) → 2 prisma generate (pinned 5.22.0,
       the workflow's own command, no shell) → 3 the "Generated Prisma Client" marker → 4 the
       generated index.d.ts exposes the three fields AND the model-scoped enums that prove they
       belong to the right models (ClaimScalarFieldEnum / OrderScalarFieldEnum) → 5 touch
       tmp/restart.txt, READ IT BACK and check its mtime → PASS.

   WHAT IT DOES NOT PROVE: the Passenger reload itself. Touching tmp/restart.txt is the documented
   trigger and the touch is proven; the reload is asynchronous. The proof that the new client is
   LIVE is GET /api/admin/claims/census (internal token) reporting schema.ready true — the PASS
   report says exactly that instead of implying a restart happened.

   SCOPE: staging one-off. NO DB write and no DB read, no schema change, no migration, no gate, no
   flag, no Stripe, no e-mail, no money. No secret is read or printed. Nothing is coupled to deploy.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const APP_ROOT = process.env.DPRIME_APP_ROOT || path.join(__dirname, '..', '..')
/** Founder pin (D′ L3b): when set, the DEPLOYED build must be exactly this SHA or the run refuses. */
const EXPECT_SHA = process.env.DPRIME_EXPECT_SHA || ''
/** The D′ fields (spec v2 §9), with the model each one must belong to. */
const REQUIRED = [
  { model: 'Claim', field: 'approvedAmountCents' },
  { model: 'Claim', field: 'selection' },
  { model: 'Order', field: 'deliveredAt' },
]
// Optional negative-control hook for local testing ONLY (never set on the server): forces the
// verification to look for a field that must NOT exist → proves the FAIL path is real.
const VERIFY = process.env.DPRIME_VERIFY_FIELDS
  ? process.env.DPRIME_VERIFY_FIELDS.split(',').map((s) => s.trim()).filter(Boolean).map((f) => {
      const [model, field] = f.includes('.') ? f.split('.') : ['Claim', f]
      return { model, field }
    })
  : REQUIRED

function pass(o) {
  console.log('========================================')
  console.log('GRUBANO D′ CLIENT REGENERATION')
  console.log('RESULT: PASS')
  console.log('DEPLOYED BUILD: ' + (o.deployed || 'NOT PINNED (DPRIME_EXPECT_SHA unset)'))
  console.log('PRISMA GENERATE: ' + o.generate)
  console.log('CLIENT FIELDS: ' + o.fields)
  console.log('PASSENGER RESTART: ' + o.restart)
  console.log('MONEY MOVED: NO — no DB write, no schema change, no gate, no flag, no Stripe, no e-mail')
  console.log('VERIFY: the reload is asynchronous and is NOT proven here — GET /api/admin/claims/census')
  console.log('        (internal token) must report schema.ready true once Passenger has reloaded.')
  console.log('SAFE TO CONTINUE: YES')
  console.log('========================================')
  process.exit(0)
}
function fail(step, action) {
  console.log('========================================')
  console.log('GRUBANO D′ CLIENT REGENERATION')
  console.log('RESULT: FAIL')
  console.log('FAILED STEP: ' + step)
  console.log('SAFE TO CONTINUE: NO')
  console.log('ACTION: ' + (action || 'RETURN THIS OUTPUT TO CLAUDE CODE'))
  console.log('========================================')
  process.exit(1)
}

/** The body of `model <Name> { … }` in a Prisma schema, or null. */
function modelBody(schema, model) {
  const m = new RegExp('(^|\\n)model\\s+' + model + '\\s*\\{').exec(schema)
  if (!m) return null
  const start = m.index + m[0].length
  const end = schema.indexOf('\n}', start)
  return end < 0 ? null : schema.slice(start, end)
}

function main() {
  // ── 0. the DEPLOYED BUILD must be the one the founder pinned (D′ L3b) ─────────────────────
  // Read-only: public/version.json is a static artifact stamped by the deploy. It proves WHICH
  // build the files on disk came from — regenerating a client against a schema from another
  // deploy is exactly the mismatch this operator exists to prevent.
  let deployed = 'NOT PINNED (DPRIME_EXPECT_SHA unset)'
  if (EXPECT_SHA) {
    let v = null
    try { v = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public', 'version.json'), 'utf8')) } catch { /* absent */ }
    if (!v || !v.commit) return fail('0 expect-sha: public/version.json unreadable — the deployed build cannot be identified', 'check the deploy, then re-run')
    const want = EXPECT_SHA.slice(0, 7)
    if (!String(v.commit).startsWith(want) && !String(v.shortCommit || '').startsWith(want)) {
      return fail('0 expect-sha: deployed ' + (v.shortCommit || v.commit) + ' ≠ expected ' + EXPECT_SHA, 'deploy the expected SHA first, then re-run')
    }
    deployed = (v.shortCommit || String(v.commit).slice(0, 7)) + ' (branch ' + (v.branch || '?') + ', build ' + (v.buildDate || '?') + ')'
    console.log('[dprime-regen] deployed build:', deployed)
  }

  // ── 1. the DEPLOYED schema must carry the D′ fields, each on its own model ─────────────────
  const schemaPath = path.join(APP_ROOT, 'prisma', 'schema.prisma')
  if (!fs.existsSync(schemaPath)) return fail('1 env: prisma/schema.prisma not found under ' + APP_ROOT, 'run from the deployed app (~/app.grubano.com)')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  for (const { model, field } of REQUIRED) {
    const body = modelBody(schema, model)
    if (body === null) return fail('1 env: model ' + model + ' not found in the deployed schema', 'RETURN THIS OUTPUT TO CLAUDE CODE')
    if (!new RegExp('(^|\\n)\\s*' + field + '\\s').test(body)) {
      return fail('1 env: the deployed schema lacks ' + model + '.' + field + ' (D′ L3b not deployed)', 'deploy the D′ L3b schema first, then re-run')
    }
  }

  // ── 2/3. prisma generate (pinned 5.22.0, the deploy workflow's own command, NO shell) ──────
  const localCli = path.join(APP_ROOT, 'node_modules', 'prisma', 'build', 'index.js')
  const binDir = path.dirname(process.execPath)
  const npxPath = [path.join(binDir, 'npx'), path.join(binDir, 'npx.cmd')].find((c) => fs.existsSync(c))
  console.log('[dprime-regen] app root:', APP_ROOT)
  console.log('[dprime-regen] node:', process.execPath)
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
      route = 'npx.cmd prisma@5.22.0'
      genOut = execFileSync('cmd.exe', ['/d', '/s', '/c', '"' + npxPath + '" prisma@5.22.0 generate'], { cwd: APP_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: runEnv })
    } else {
      return fail('3 prisma generate: no local CLI and no npx next to ' + process.execPath, 'run with the nodevenv node')
    }
  } catch (e) {
    const msg = String((e && (e.stderr || e.stdout || e.message)) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)
    return fail('3 prisma generate failed via ' + route + ': ' + msg, 'check nodevenv / prisma 5.22.0 availability')
  }
  console.log('[dprime-regen] generate route:', route)
  if (!/Generated Prisma Client/i.test(genOut)) return fail('3 prisma generate: no "Generated Prisma Client" marker in output', 'RETURN THIS OUTPUT TO CLAUDE CODE')

  // ── 4. PROVE the regenerated client exposes the D′ fields ON THE RIGHT MODELS ──────────────
  // A bare substring search would pass on a stale client that happens to mention the word
  // elsewhere, so each field is looked up inside its model's own scalar-field enum.
  const dts = [
    path.join(APP_ROOT, 'node_modules', '.prisma', 'client', 'index.d.ts'),
    path.join(APP_ROOT, 'node_modules', '@prisma', 'client', 'index.d.ts'),
  ].find((p) => fs.existsSync(p))
  if (!dts) return fail('4 verify: generated client index.d.ts not found', 'RETURN THIS OUTPUT TO CLAUDE CODE')
  const types = fs.readFileSync(dts, 'utf8')
  const missing = []
  for (const { model, field } of VERIFY) {
    const enumRe = new RegExp('const ' + model + 'ScalarFieldEnum:\\s*\\{([\\s\\S]*?)\\}')
    const m = enumRe.exec(types)
    if (!m) { missing.push(model + '.' + field + ' (no ' + model + 'ScalarFieldEnum in the generated client)'); continue }
    if (!new RegExp('(^|\\s)' + field + ':').test(m[1])) missing.push(model + '.' + field)
  }
  if (missing.length) return fail('4 verify: the regenerated client lacks ' + missing.join(', '), 'schema/client mismatch — RETURN THIS OUTPUT')

  // ── 5. Passenger restart (the same touch the deploy workflow performs) ─────────────────────
  // The touch is PROVEN by reading it back (content + a fresh mtime). The Passenger reload that
  // follows is asynchronous and is NOT proven here — the census is what proves the new client is
  // live, and the report says so rather than implying a restart happened.
  let restart
  try {
    fs.mkdirSync(path.join(APP_ROOT, 'tmp'), { recursive: true })
    const rf = path.join(APP_ROOT, 'tmp', 'restart.txt')
    const stamp = 'dprime-regen ' + new Date().toISOString()
    fs.writeFileSync(rf, stamp)
    const readBack = fs.readFileSync(rf, 'utf8')
    const ageMs = Date.now() - fs.statSync(rf).mtimeMs
    if (readBack !== stamp) return fail('5 restart: tmp/restart.txt does not read back what was written')
    if (!(ageMs >= 0 && ageMs < 60_000)) return fail('5 restart: tmp/restart.txt mtime is not fresh (' + ageMs + ' ms)')
    restart = 'TOUCHED tmp/restart.txt (read back, mtime fresh) — reload is asynchronous, not proven here'
  } catch (e) {
    return fail('5 restart: could not touch tmp/restart.txt (' + String(e.message || e).slice(0, 120) + ')')
  }

  return pass({
    deployed,
    generate: 'OK (' + route + ', marker present)',
    fields: 'VERIFIED (' + VERIFY.map((f) => f.model + '.' + f.field).join(', ') + ' in ' + path.relative(APP_ROOT, dts) + ', model-scoped)',
    restart,
  })
}

// Guarded so `require()` (a test reading the constants) never regenerates anything.
if (require.main === module) main()

module.exports = { REQUIRED, modelBody }
