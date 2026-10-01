/**
 * scripts/fix-server.js
 * Patches .next/standalone/server.js after `npm run build` — the file the deploy ships as
 * the Passenger entry (`cp -r .next/standalone/. deploy-temp/`; the repo-root server.js is
 * NOT deployed). Two patches:
 *
 * 1. WINDOWS PATHS. Next.js embeds the Windows build path
 *    ("outputFileTracingRoot":"C:\\Users\\Lenovo\\grubano") in the inline nextConfig JSON.
 *    On Linux/o2switch this path doesn't exist → Passenger starts the process but Next.js
 *    crashes before it can bind a port → Gateway Timeout. Replaced by the Linux root.
 *
 * 2. ENV PROVENANCE PREAMBLE (Phase 2 final preflight, 2026-09-05). A tiny try/catch block
 *    inserted BEFORE `require('next')` (i.e. before @next/env loads any .env* file) that
 *    records, for a fixed list of secret/config keys, whether the key was ALREADY in the
 *    process environment (hosting / Passenger / cPanel injection) and which env file(s)
 *    define it — BOOLEANS + file names ONLY (no value, no length, no hash). Written to
 *    tmp/env-provenance.json for the server-side read-only operator
 *    (scripts/server/phase2-preflight.js). A missing/faulty helper never blocks startup.
 *
 * Exported for tests; run as a CLI by the deploy workflow (`node scripts/fix-server.js`).
 */

'use strict'

const fs   = require('fs')
const path = require('path')

const SERVER_PATH  = path.join(__dirname, '../.next/standalone/server.js')
const LINUX_ROOT   = '/home/deyi0010/grubano.com'

const PREAMBLE_MARKER = '// ── grubano env-provenance preamble (injected by scripts/fix-server.js) ──'
// The report is written OUTSIDE the app root (= Apache DocumentRoot on cPanel/Passenger, so
// nothing under it may be assumed unreachable): ~/.grubano/env-provenance.json, mode 600.
const PREAMBLE = [
  PREAMBLE_MARKER,
  '// Snapshot taken BEFORE @next/env loads any .env* file: booleans + file names only, no value.',
  'try {',
  "  const __gp = require('path'), __gfs = require('fs'), __gos = require('os')",
  "  const __gprov = require(__gp.join(__dirname, 'scripts', 'server', 'env-provenance.js'))",
  '  const __gpre = {}',
  '  for (const __k of __gprov.WATCHED_SECRET_KEYS) __gpre[__k] = process.env[__k]',
  '  const __grep = __gprov.assertNoValues(__gprov.computeProvenance(__gpre, __gprov.readNextEnvFiles(__gfs, __gp, __dirname), __gprov.WATCHED_SECRET_KEYS))',
  "  const __gdir = __gp.join(__gos.homedir(), '.grubano')",
  '  __gfs.mkdirSync(__gdir, { recursive: true, mode: 0o700 })',
  "  __gfs.writeFileSync(__gp.join(__gdir, 'env-provenance.json'), JSON.stringify(__grep, null, 2), { mode: 0o600 })",
  '} catch (_) { /* never block startup */ }',
  '// ── end env-provenance preamble ──',
  '',
].join('\n')

/** Windows build path → Linux deployment root (idempotent). */
function patchWindowsPaths(content) {
  let out = content
  // 1. "outputFileTracingRoot":"C:\\Users\\..."
  out = out.replace(/("outputFileTracingRoot"\s*:\s*)"[^"]*"/g, `$1"${LINUX_ROOT}"`)
  // 2. any remaining C:\\Users\\... (double-escaped JSON)
  out = out.replace(/C:\\\\Users\\\\[^"']*/g, LINUX_ROOT)
  // 3. any remaining C:\Users\... (single-escaped)
  out = out.replace(/C:\\Users\\[^"']*/g, LINUX_ROOT)
  return out
}

/** Insert the provenance preamble once, right before the first `require('next')` line. */
function injectProvenancePreamble(content) {
  if (content.includes(PREAMBLE_MARKER)) return content
  const anchor = /^require\(['"]next['"]\)\s*$/m
  const m = content.match(anchor)
  if (!m || typeof m.index !== 'number') return content // unknown entry shape → leave untouched
  return content.slice(0, m.index) + PREAMBLE + content.slice(m.index)
}

function main() {
  if (!fs.existsSync(SERVER_PATH)) {
    console.error(`[fix-server] ERROR: ${SERVER_PATH} not found.`)
    console.error('  → Run "npm run build" first.')
    process.exit(1)
  }
  const before = fs.readFileSync(SERVER_PATH, 'utf8')
  let content = patchWindowsPaths(before)

  const remaining = content.match(/C:[\\\/]Users[\\\/]/g)
  if (remaining) {
    console.error('[fix-server] ERROR: Windows paths still present after patching!')
    console.error('  Occurrences:', remaining.length)
    console.error('  Check server.js manually.')
    process.exit(1)
  }
  const pathsChanged = content !== before

  const withPreamble = injectProvenancePreamble(content)
  const preambleAdded = withPreamble !== content
  content = withPreamble
  if (!content.includes(PREAMBLE_MARKER)) {
    console.error('[fix-server] WARN: env-provenance preamble NOT injected (anchor `require(\'next\')` not found) — startup unaffected, provenance file will be absent.')
  }

  if (content === before) {
    console.log('[fix-server] INFO: nothing to patch — server.js already clean.')
  } else {
    fs.writeFileSync(SERVER_PATH, content, 'utf8')
    console.log(`[fix-server] OK: server.js patched → paths ${pathsChanged ? 'fixed (' + LINUX_ROOT + ')' : 'already clean'} ; env-provenance preamble ${preambleAdded ? 'INJECTED' : 'already present'}`)
  }
}

module.exports = { patchWindowsPaths, injectProvenancePreamble, PREAMBLE_MARKER, LINUX_ROOT }

if (require.main === module) main()
