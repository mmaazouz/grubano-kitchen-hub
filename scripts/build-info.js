// scripts/build-info.js — S0-3 build traceability (Sprint 0).
// Stamps a deploy folder with the exact commit + build date so the deployed
// build is always identifiable:
//   <deployDir>/VERSION              — human-readable, lands at the ZIP root
//   <deployDir>/public/version.json  — served statically at https://<host>/version.json
//                                      (middleware matcher excludes paths with a
//                                      file extension, so it is never auth-gated)
//
// Usage:  node scripts/build-info.js [deployDir]     (default: deploy-temp)
//
// Zero runtime impact: the app never reads these files; they are static
// artifacts written into the deploy folder only (never into the repo tree).
// In CI the commit comes from GITHUB_* env vars; locally from git.

'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const deployDir = process.argv[2] || 'deploy-temp'

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const commit = process.env.GITHUB_SHA || git('rev-parse HEAD') || 'unknown'
const branch = process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD') || 'unknown'
const info = {
  commit,
  shortCommit: commit.slice(0, 7),
  branch,
  buildDate: new Date().toISOString(),
  ciRunId: process.env.GITHUB_RUN_ID || null,
  builder: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local',
}

if (!fs.existsSync(deployDir)) {
  console.error(`[build-info] deploy dir not found: ${deployDir} — run the deploy preparation first.`)
  process.exit(1)
}

const publicDir = path.join(deployDir, 'public')
fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(path.join(publicDir, 'version.json'), JSON.stringify(info, null, 2) + '\n')
fs.writeFileSync(
  path.join(deployDir, 'VERSION'),
  `${info.shortCommit} (${info.branch}) built ${info.buildDate}${info.ciRunId ? ` ci-run ${info.ciRunId}` : ''}\n`
)

console.log(`[build-info] stamped ${deployDir}: ${info.shortCommit} (${info.branch}) ${info.buildDate}`)
