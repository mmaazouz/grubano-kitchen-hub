'use strict'

/**
 * server.js — Phusion Passenger entry point for o2switch
 *
 * Key behaviours:
 *  1. Sets permissions on .next/ and public/ at startup — Passenger runs
 *     the app as a restricted user; chmod ensures it can read its own files.
 *  2. Loads .env.local manually (Next.js only auto-loads it in dev mode).
 *  3. Calls Next.js startServer with dir:__dirname so all paths resolve from
 *     the actual deployment directory, not the Windows build machine path.
 */

const path        = require('path')
const fs          = require('fs')
const { execSync } = require('child_process')

// ── 1. chdir first — everything else resolves relative to here ───────────────
const APP_DIR = __dirname
process.chdir(APP_DIR)
process.env.NODE_ENV = 'production'

// ── 2. Fix permissions (Passenger restricts file access on o2switch) ─────────
const CHMOD_TARGETS = [
  path.join(APP_DIR, '.next'),
  path.join(APP_DIR, 'public'),
]
for (const target of CHMOD_TARGETS) {
  if (fs.existsSync(target)) {
    try {
      execSync(`chmod -R 755 "${target}"`, { stdio: 'ignore' })
    } catch (_) {
      // non-fatal — log but continue
      process.stderr.write(`[grubano] warn: chmod failed on ${target}\n`)
    }
  }
}

// ── 3. Load .env.local ────────────────────────────────────────────────────────
const ENV_FILE = path.join(APP_DIR, '.env.local')
if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  }
}

// ── 4. Port — Passenger injects $PORT; fall back to 3000 for manual testing ──
const PORT     = parseInt(process.env.PORT || '3000', 10)
const HOSTNAME = '0.0.0.0'
process.env.PORT     = String(PORT)
process.env.HOSTNAME = HOSTNAME

// ── 5. Sanity checks before handing off to Next.js ───────────────────────────
const STATIC_DIR = path.join(APP_DIR, '.next', 'static')
const SERVER_DIR = path.join(APP_DIR, '.next', 'server')

if (!fs.existsSync(STATIC_DIR)) {
  process.stderr.write(
    `[grubano] WARN: .next/static missing (${STATIC_DIR})\n` +
    `          CSS/JS will not be served — re-run the deploy script.\n`,
  )
}
if (!fs.existsSync(SERVER_DIR)) {
  process.stderr.write(
    `[grubano] FATAL: .next/server missing (${SERVER_DIR})\n` +
    `          Standalone build is incomplete — run npm run build again.\n`,
  )
  process.exit(1)
}

// ── 6. Start Next.js ─────────────────────────────────────────────────────────
const { startServer } = require('next/dist/server/lib/start-server')

startServer({
  dir:              APP_DIR,
  isDev:            false,
  hostname:         HOSTNAME,
  port:             PORT,
  keepAliveTimeout: 5000,
  allowRetry:       false,
})
  .then(() => {
    process.stdout.write(`[grubano] Ready on http://${HOSTNAME}:${PORT}\n`)
  })
  .catch((err) => {
    process.stderr.write(`[grubano] FATAL startup error: ${err.message ?? err}\n`)
    process.exit(1)
  })

// ── 7. Graceful shutdown signals ─────────────────────────────────────────────
process.on('SIGTERM', () => { process.stdout.write('[grubano] SIGTERM\n'); process.exit(0) })
process.on('SIGINT',  () => { process.stdout.write('[grubano] SIGINT\n');  process.exit(0) })
