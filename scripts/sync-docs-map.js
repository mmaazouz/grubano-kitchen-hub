#!/usr/bin/env node
/**
 * Re-sync the embedded docs-map snapshot from the published JSON.
 *
 * Reads:   https://docs.grubano.com/docs-map.json
 * Writes:  lib/docs-map.ts (the embedded snapshot block only — comments
 *          and helper functions are preserved).
 *
 * Run:
 *   node scripts/sync-docs-map.js
 *   node scripts/sync-docs-map.js --check    # exit 1 on drift, no write
 *
 * After running, do: npm run check:i18n && npm run build
 *
 * Schema sanity checks before writing:
 *   - JSON must parse
 *   - top-level keys: version, base, locales[], topics{}
 *   - base starts with https://
 *   - locales is a non-empty string[]
 *   - every topic has a string `doc` starting with "/"
 */

'use strict'

const fs   = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const SOURCE_URL   = 'https://docs.grubano.com/docs-map.json'
const TARGET_FILE  = path.resolve(__dirname, '..', 'lib', 'docs-map.ts')
const CHECK_ONLY   = process.argv.includes('--check')

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('invalid JSON: ' + e.message)) }
      })
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')) })
  })
}

function validate(map) {
  if (typeof map !== 'object' || map === null) throw new Error('not an object')
  if (typeof map.version !== 'number') throw new Error('missing or invalid version')
  if (typeof map.base !== 'string' || !map.base.startsWith('https://')) throw new Error('base must be an https:// URL')
  if (!Array.isArray(map.locales) || map.locales.length === 0) throw new Error('locales must be a non-empty array')
  for (const loc of map.locales) {
    if (typeof loc !== 'string') throw new Error(`bad locale: ${JSON.stringify(loc)}`)
  }
  if (typeof map.topics !== 'object' || map.topics === null) throw new Error('topics missing')
  for (const [k, v] of Object.entries(map.topics)) {
    if (typeof v !== 'object' || v === null) throw new Error(`topic ${k}: not an object`)
    if (typeof v.doc !== 'string' || !v.doc.startsWith('/')) throw new Error(`topic ${k}: doc must start with "/"`)
    if (v.app !== null && typeof v.app !== 'string') throw new Error(`topic ${k}: app must be null or string`)
  }
}

function quote(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

/** Generate the literal blocks injected into lib/docs-map.ts. */
function renderSnapshot(map) {
  const versionLine = `export const DOCS_MAP_VERSION = ${map.version} as const`
  const localesArr  = map.locales.map((l) => quote(l)).join(', ')
  const localesLine = `export const DOCS_LOCALES = [${localesArr}] as const`
  const baseLine    = `export const DOCS_BASE = ${quote(map.base)}`

  // Topics — pad doc + app columns so the source diff stays readable.
  const keys      = Object.keys(map.topics)
  const keyPad    = Math.max(...keys.map((k) => k.length + 2))   // +2 = quotes
  const docPad    = Math.max(...keys.map((k) => map.topics[k].doc.length + 2))
  const topicsLines = keys.map((k) => {
    const keyLit = quote(k).padEnd(keyPad)
    const docLit = quote(map.topics[k].doc).padEnd(docPad)
    const appLit = map.topics[k].app === null ? 'null' : quote(map.topics[k].app)
    return `  ${keyLit}: { doc: ${docLit}, app: ${appLit} },`
  }).join('\n')

  const topicsBlock = `export const DOCS_TOPICS = {\n${topicsLines}\n} as const satisfies Record<string, { doc: string; app: string | null }>`

  return { versionLine, baseLine, localesLine, topicsBlock }
}

function rewriteFile(originalSource, blocks) {
  let s = originalSource

  // Replace each export block via narrow regex. We only touch the lines we
  // explicitly own; comments + helpers stay verbatim.
  const subs = [
    [/^export const DOCS_MAP_VERSION =.*$/m, blocks.versionLine],
    [/^export const DOCS_LOCALES =.*$/m,     blocks.localesLine],
    [/^export const DOCS_BASE =.*$/m,        blocks.baseLine],
    [/^export const DOCS_TOPICS = \{[\s\S]*?^\} as const satisfies[^\n]*$/m, blocks.topicsBlock],
  ]
  for (const [re, repl] of subs) {
    if (!re.test(s)) throw new Error(`could not locate block matching ${re} in lib/docs-map.ts`)
    s = s.replace(re, repl)
  }
  return s
}

async function main() {
  console.log('[sync-docs-map] Fetching', SOURCE_URL)
  const map = await fetchJson(SOURCE_URL)
  validate(map)
  console.log(`[sync-docs-map] OK — version ${map.version}, ${map.locales.length} locale(s), ${Object.keys(map.topics).length} topic(s)`)

  if (!fs.existsSync(TARGET_FILE)) {
    throw new Error(`target file not found: ${TARGET_FILE}`)
  }
  const original = fs.readFileSync(TARGET_FILE, 'utf8')
  const blocks   = renderSnapshot(map)
  const next     = rewriteFile(original, blocks)

  if (next === original) {
    console.log('[sync-docs-map] No drift — snapshot already up to date.')
    return
  }

  if (CHECK_ONLY) {
    console.error('[sync-docs-map] DRIFT detected. Run `node scripts/sync-docs-map.js` to update.')
    process.exit(1)
  }

  fs.writeFileSync(TARGET_FILE, next, 'utf8')
  console.log('[sync-docs-map] Wrote', path.relative(process.cwd(), TARGET_FILE))
  console.log('[sync-docs-map] Next: npm run check:i18n && npm run build')
}

main().catch((err) => {
  console.error('[sync-docs-map] FAILED:', err.message)
  process.exit(1)
})
