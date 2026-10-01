// scripts/translate-dashboard-home.js
// One-off helper: translates ONLY the newly-added `dashboard.home` namespace
// from fr.json into en / es / ar / it and merges it into each target locale
// file (preserving every other translation already in place).
//
// Why this exists: the generic scripts/translate-messages.js translates the
// whole file in a single Claude call with max_tokens=8000, which truncates
// once the file grows past ~480 keys. Translating one subtree at a time
// keeps every output well under the limit and avoids re-translating siblings
// that other agents may have hand-tuned.
//
// Safe to delete once translate-messages.js is upgraded to chunk by namespace.

'use strict'

const fs   = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')

const MESSAGES_DIR = path.join(__dirname, '..', 'messages')
const NAMESPACE    = ['dashboard', 'home'] // path inside the JSON tree

const LANG_NAMES = {
  en: 'English',
  es: 'Spanish (Spain)',
  ar: 'Arabic (Modern Standard, suitable for Morocco)',
  it: 'Italian',
}

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
  console.error('[translate-dashboard-home] ERROR: ANTHROPIC_API_KEY not set.')
  process.exit(1)
}

const client = new Anthropic()

function getPath(obj, segs) {
  return segs.reduce((acc, k) => (acc == null ? undefined : acc[k]), obj)
}
function setPath(obj, segs, value) {
  let cursor = obj
  for (let i = 0; i < segs.length - 1; i++) {
    if (cursor[segs[i]] == null || typeof cursor[segs[i]] !== 'object') {
      cursor[segs[i]] = {}
    }
    cursor = cursor[segs[i]]
  }
  cursor[segs[segs.length - 1]] = value
}

function buildPrompt(targetName, subtree) {
  return [
    `You are a professional localization engine for a food-delivery and restaurant-management app called Grubano.`,
    `Translate the JSON below from French into ${targetName}.`,
    ``,
    `STRICT RULES:`,
    `- Return ONLY valid JSON. No markdown fences, no commentary.`,
    `- Preserve the exact structure and every key. Translate VALUES only.`,
    `- Never translate or alter ICU placeholders like {count}, {name}, {code}. Keep them verbatim.`,
    `- Preserve ICU pluralisation syntax: "{count, plural, one {# avis} other {# avis}}" — keep the curly-brace structure.`,
    `- Keep the brand name "Grubano" unchanged.`,
    `- Use natural, friendly, idiomatic ${targetName} matching a modern delivery app's tone.`,
    ``,
    `JSON to translate:`,
    JSON.stringify(subtree, null, 2),
  ].join('\n')
}

async function translateOne(locale, subtree) {
  process.stdout.write(`[translate-dashboard-home] fr → ${locale} ... `)
  const res = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 4000,
    messages:   [{ role: 'user', content: buildPrompt(LANG_NAMES[locale], subtree) }],
  })
  let text = res.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(text)
  console.log('✓')
  return parsed
}

async function main() {
  const sourceFile = path.join(MESSAGES_DIR, 'fr.json')
  const source     = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  const subtree    = getPath(source, NAMESPACE)
  if (subtree == null) {
    console.error(`[translate-dashboard-home] Path ${NAMESPACE.join('.')} not found in fr.json.`)
    process.exit(1)
  }

  for (const locale of Object.keys(LANG_NAMES)) {
    const translated = await translateOne(locale, subtree)
    const targetFile = path.join(MESSAGES_DIR, `${locale}.json`)
    const target     = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
    setPath(target, NAMESPACE, translated)
    fs.writeFileSync(targetFile, JSON.stringify(target, null, 2) + '\n', 'utf8')
  }
  console.log('[translate-dashboard-home] done.')
}

main().catch(err => { console.error(err); process.exit(1) })
