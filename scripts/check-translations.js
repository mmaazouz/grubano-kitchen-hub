// scripts/check-translations.js
// Translation-completeness gate. messages/fr.json is the source of truth; every
// other locale must contain every key from fr.json with a non-empty string
// value. Reports missing / empty keys per locale and exits 1 if any locale is
// incomplete, 0 if all complete.
//
// Wired into CI before deploy so untranslated strings can never ship.
//
// Usage:
//   node scripts/check-translations.js
//   npm run check:i18n

'use strict'
const fs = require('fs')
const path = require('path')

const MESSAGES_DIR = path.join(__dirname, '..', 'messages')
const SOURCE_LOCALE = 'fr'
const TARGET_LOCALES = ['en', 'es', 'ar', 'it']

/** Flatten a nested object into dot-path → value pairs. */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, p, out)
    } else {
      out[p] = value
    }
  }
  return out
}

function loadLocale(locale) {
  const file = path.join(MESSAGES_DIR, `${locale}.json`)
  if (!fs.existsSync(file)) {
    return { error: `messages/${locale}.json not found` }
  }
  try {
    return { data: flatten(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  } catch (err) {
    return { error: `messages/${locale}.json is not valid JSON: ${err.message}` }
  }
}

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function main() {
  const source = loadLocale(SOURCE_LOCALE)
  if (source.error) {
    console.error(`[check:i18n] ERROR: source ${source.error}`)
    process.exit(1)
  }
  const sourceKeys = Object.keys(source.data)
  console.log(`[check:i18n] Reference: messages/${SOURCE_LOCALE}.json (${sourceKeys.length} keys)\n`)

  let failed = false

  for (const locale of TARGET_LOCALES) {
    const target = loadLocale(locale)
    if (target.error) {
      console.error(`✗ ${locale}.json: ${target.error}`)
      failed = true
      continue
    }

    const missing = []
    const empty = []
    for (const key of sourceKeys) {
      if (!(key in target.data)) missing.push(key)
      else if (isEmpty(target.data[key])) empty.push(key)
    }
    // Keys present in target but absent from source (drift to surface, non-fatal).
    const extra = Object.keys(target.data).filter((k) => !(k in source.data))

    if (missing.length === 0 && empty.length === 0) {
      console.log(`✓ ${locale}.json: complete (${sourceKeys.length} keys)${extra.length ? ` — ${extra.length} extra key(s)` : ''}`)
    } else {
      failed = true
      const parts = []
      if (missing.length) parts.push(`${missing.length} missing`)
      if (empty.length) parts.push(`${empty.length} empty`)
      console.error(`✗ ${locale}.json: ${parts.join(', ')}`)
      if (missing.length) console.error(`    missing: ${missing.join(', ')}`)
      if (empty.length) console.error(`    empty:   ${empty.join(', ')}`)
    }
    if (extra.length) {
      console.warn(`  ⚠ ${locale}.json has ${extra.length} key(s) not in source: ${extra.join(', ')}`)
    }
  }

  console.log('')
  if (failed) {
    console.error('[check:i18n] FAILED — some locales are incomplete. Run: node scripts/translate-messages.js')
    process.exit(1)
  }
  console.log('[check:i18n] OK — all locales complete.')
  process.exit(0)
}

main()
