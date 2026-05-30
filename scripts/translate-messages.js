// scripts/translate-messages.js
// Auto-translates messages/fr.json into the other supported locales via Claude.
//
// Usage:
//   node scripts/translate-messages.js            # all target locales
//   node scripts/translate-messages.js en es      # only the given locales
//
// Requires ANTHROPIC_API_KEY (env or .env.local).
//
// Source of truth is always messages/fr.json. Keys and {placeholders} are
// preserved; only the string VALUES are translated. Each output is validated
// as JSON before being written.

'use strict'
const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

const MESSAGES_DIR = path.join(__dirname, '..', 'messages')
const SOURCE_LOCALE = 'fr'

const LANG_NAMES = {
  en: 'English',
  es: 'Spanish (Spain)',
  ar: 'Arabic (Modern Standard, suitable for Morocco)',
  it: 'Italian',
}

// ── Load ANTHROPIC_API_KEY from .env.local if not already set ──────────────
if (!process.env.ANTHROPIC_API_KEY) {
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^ANTHROPIC_API_KEY=(.+)$/)
      if (m) {
        process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^["']|["']$/g, '')
        break
      }
    }
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[translate] ERROR: ANTHROPIC_API_KEY not set (env or .env.local).')
  process.exit(1)
}

const client = new Anthropic()

function buildPrompt(targetName, json) {
  return [
    `You are a professional localization engine for a food-delivery and restaurant-management app called Grubano.`,
    `Translate the JSON below from French into ${targetName}.`,
    ``,
    `STRICT RULES:`,
    `- Return ONLY valid JSON. No markdown fences, no commentary.`,
    `- Preserve the exact structure and every key. Translate VALUES only.`,
    `- Never translate or alter ICU placeholders like {count}, {name}, {price}. Keep them verbatim.`,
    `- Keep the brand name "Grubano" unchanged.`,
    `- Preserve leading/trailing punctuation and ellipses (e.g. "Chargement...").`,
    `- Use natural, friendly, idiomatic ${targetName} matching a modern delivery app's tone.`,
    ``,
    `JSON to translate:`,
    JSON.stringify(json, null, 2),
  ].join('\n')
}

async function translateLocale(locale, source) {
  const targetName = LANG_NAMES[locale]
  process.stdout.write(`[translate] ${SOURCE_LOCALE} → ${locale} (${targetName})... `)

  const res = await client.messages.create({
    model: process.env.TRANSLATE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 8000,
    messages: [{ role: 'user', content: buildPrompt(targetName, source) }],
  })

  let text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  // Strip accidental code fences just in case.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    console.error(`\n[translate] ✗ ${locale}: model did not return valid JSON.`)
    console.error(text.slice(0, 500))
    throw err
  }

  const outFile = path.join(MESSAGES_DIR, `${locale}.json`)
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  console.log(`✓ wrote messages/${locale}.json`)
}

async function main() {
  const sourceFile = path.join(MESSAGES_DIR, `${SOURCE_LOCALE}.json`)
  if (!fs.existsSync(sourceFile)) {
    console.error(`[translate] ERROR: ${sourceFile} not found.`)
    process.exit(1)
  }
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))

  const requested = process.argv.slice(2)
  const targets = (requested.length ? requested : Object.keys(LANG_NAMES)).filter(
    (l) => l !== SOURCE_LOCALE,
  )

  for (const locale of targets) {
    if (!LANG_NAMES[locale]) {
      console.warn(`[translate] skip unknown locale "${locale}"`)
      continue
    }
    await translateLocale(locale, source)
  }
  console.log('[translate] done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
