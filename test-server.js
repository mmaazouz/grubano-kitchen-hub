/**
 * test-server.js — Minimal HTTP server for o2switch Passenger diagnostics.
 *
 * Purpose: verify that Node.js + Phusion Passenger can start and respond
 * BEFORE testing the full Next.js app.  If this works but server.js doesn't,
 * the problem is in the Next.js startup (path, missing file, env var, etc.).
 *
 * Deploy to /home/deyi0010/grubano.com/test-server.js
 * In cPanel "Setup Node.js App" → set startup file to "test-server.js"
 * Restart → visit grubano.com → should see "Node.js works on o2switch"
 * Then switch startup file back to "server.js"
 *
 * NOT included in deploy.zip — local diagnostic only.
 */

'use strict'

const http = require('http')
const os   = require('os')

const PORT = parseInt(process.env.PORT || '3000', 10)

const server = http.createServer((req, res) => {
  const body = JSON.stringify({
    status:   'ok',
    message:  'Node.js works on o2switch',
    node:     process.version,
    platform: process.platform,
    arch:     process.arch,
    hostname: os.hostname(),
    cwd:      process.cwd(),
    env:      {
      NODE_ENV: process.env.NODE_ENV,
      PORT:     process.env.PORT,
    },
    url:      req.url,
    time:     new Date().toISOString(),
  }, null, 2)

  res.writeHead(200, {
    'Content-Type':  'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(body)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[test-server] Ready on http://0.0.0.0:${PORT}`)
  console.log(`[test-server] Node ${process.version} — ${process.platform}/${process.arch}`)
  console.log(`[test-server] cwd: ${process.cwd()}`)
})

server.on('error', (err) => {
  console.error('[test-server] ERROR:', err.message)
  process.exit(1)
})

process.on('SIGTERM', () => { server.close(); process.exit(0) })
process.on('SIGINT',  () => { server.close(); process.exit(0) })
