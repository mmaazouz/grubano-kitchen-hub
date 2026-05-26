/**
 * scripts/fix-server.js
 * Patches .next/standalone/server.js after `npm run build`.
 *
 * Problem: Next.js embeds the Windows build path
 * ("outputFileTracingRoot":"C:\\Users\\Lenovo\\grubano") directly inside
 * the inline nextConfig JSON in server.js.  On Linux/o2switch this path
 * doesn't exist → Passenger starts the process but Next.js crashes before
 * it can bind a port → Gateway Timeout.
 *
 * This script replaces every Windows path occurrence with the real Linux
 * deployment path before the file is zipped and uploaded.
 */

'use strict'

const fs   = require('fs')
const path = require('path')

const SERVER_PATH  = path.join(__dirname, '../.next/standalone/server.js')
const LINUX_ROOT   = '/home/deyi0010/grubano.com'

if (!fs.existsSync(SERVER_PATH)) {
  console.error(`[fix-server] ERROR: ${SERVER_PATH} not found.`)
  console.error('  → Run "npm run build" first.')
  process.exit(1)
}

let content = fs.readFileSync(SERVER_PATH, 'utf8')
const before = content

// ── 1. Replace "outputFileTracingRoot":"C:\\Users\\..." ────────────────────
content = content.replace(
  /("outputFileTracingRoot"\s*:\s*)"[^"]*"/g,
  `$1"${LINUX_ROOT}"`
)

// ── 2. Replace any remaining C:\\Users\\... paths (double-escaped JSON) ────
content = content.replace(
  /C:\\\\Users\\\\[^"']*/g,
  LINUX_ROOT
)

// ── 3. Replace any remaining C:\Users\... paths (single-escaped) ───────────
content = content.replace(
  /C:\\Users\\[^"']*/g,
  LINUX_ROOT
)

// ── 4. Sanity check ────────────────────────────────────────────────────────
const remaining = content.match(/C:[\\\/]Users[\\\/]/g)
if (remaining) {
  console.error('[fix-server] ERROR: Windows paths still present after patching!')
  console.error('  Occurrences:', remaining.length)
  console.error('  Check server.js manually.')
  process.exit(1)
}

if (content === before) {
  console.log('[fix-server] INFO: No Windows paths found — server.js already clean.')
} else {
  fs.writeFileSync(SERVER_PATH, content, 'utf8')
  console.log(`[fix-server] OK: server.js patched → outputFileTracingRoot = "${LINUX_ROOT}"`)
}
