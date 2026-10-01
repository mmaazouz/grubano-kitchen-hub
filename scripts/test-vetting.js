// scripts/test-vetting.js
// Smoke-test the Claude creator-vetting helper (lib/creator-vetting.ts).
//
// Runs two cases and logs the verdicts:
//   1. A credible FOOD creator   → expect "pass"
//   2. An off-topic applicant    → expect "reject"
//
// Usage (locally OR on the o2switch server, once ANTHROPIC_API_KEY is set):
//   node scripts/test-vetting.js
//
// The script loads ANTHROPIC_API_KEY from .env.local automatically so a plain
// `node` invocation works in cPanel Terminal too. The vetting logic is inlined
// (mirrors lib/creator-vetting.ts) so the script has zero TypeScript dependency
// — same pattern as scripts/test-youtube.js.

'use strict'

const fs   = require('fs')
const path = require('path')

// ── Load ANTHROPIC_API_KEY from .env.local if not already in the environment ─
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

const AnthropicPkg = require('@anthropic-ai/sdk')
const Anthropic    = AnthropicPkg.default || AnthropicPkg
const claude       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-haiku-4-5'

function safeFallback() {
  return { verdict: 'flag', reason: 'vérification auto indisponible', foodRelevance: 0 }
}

function buildPrompt(input) {
  const title    = (input.channelTitle || '').trim()       || '(non fourni)'
  const desc     = (input.channelDescription || '').trim() || '(non fourni)'
  const bio      = (input.bio || '').trim()                || '(non fourni)'
  const concepts = Array.isArray(input.dishConcepts) ? input.dishConcepts : []
  const conceptLines = concepts.length
    ? concepts
        .map((d, i) =>
          '  ' + (i + 1) + '. ' + ((d && d.name) || '').trim() +
          ' [' + ((d && d.cuisineType) || '').trim() + ']: ' +
          ((d && d.description) || '').trim())
        .join('\n')
    : '  (aucun)'

  return [
    'You are a strict content-vetting reviewer for Grubano, a food delivery / dark-kitchen platform.',
    'Decide whether a CREATOR applicant should be approved to publish signature dish recipes.',
    '',
    'Evaluate three things:',
    '1. Is the creator a credible, relevant FOOD / cooking creator (not off-topic)?',
    '2. Is the content appropriate and brand-safe (no hateful, adult, illegal, dangerous or misleading content)?',
    '3. Are the proposed dish concepts coherent and of decent quality?',
    '',
    'Creator data:',
    '- Channel title: ' + title,
    '- Channel description: ' + desc,
    '- Bio: ' + bio,
    '- Dish concepts:',
    conceptLines,
    '',
    'Return STRICTLY a single JSON object and NOTHING else — no markdown, no code fences, no commentary:',
    '{"verdict":"pass|flag|reject","reason":"<short French explanation, max 1 sentence>","foodRelevance":<integer 0-100>}',
    '',
    'Rules:',
    '- "pass" = clearly food-relevant, appropriate, and decent concepts -> auto-approve.',
    '- "flag" = uncertain, borderline, or needs human review.',
    '- "reject" = off-topic (not about food) OR inappropriate / unsafe content.',
    '- foodRelevance = integer 0-100 measuring how food/cooking-relevant the creator is.',
  ].join('\n')
}

function extractText(msg) {
  if (!msg || !Array.isArray(msg.content)) return ''
  for (const block of msg.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return ''
}

function tryParse(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

function parseVerdict(text) {
  if (!text) return null
  let obj = tryParse(text.trim())
  if (obj === null || typeof obj !== 'object') {
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) obj = tryParse(text.slice(start, end + 1))
  }
  if (!obj || typeof obj !== 'object') return null

  const verdictRaw = String(obj.verdict || '').toLowerCase().trim()
  if (verdictRaw !== 'pass' && verdictRaw !== 'flag' && verdictRaw !== 'reject') return null

  const reason = (typeof obj.reason === 'string' && obj.reason.trim()) || 'Aucune raison fournie'
  let foodRelevance = Number(obj.foodRelevance)
  if (!Number.isFinite(foodRelevance)) foodRelevance = 0
  foodRelevance = Math.max(0, Math.min(100, Math.round(foodRelevance)))

  return { verdict: verdictRaw, reason, foodRelevance }
}

async function vetCreator(input) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return safeFallback()
    const msg = await claude.messages.create({
      model:      MODEL,
      max_tokens: 300,
      messages:   [{ role: 'user', content: buildPrompt(input) }],
    })
    return parseVerdict(extractText(msg)) || safeFallback()
  } catch {
    console.error('[test-vetting] vetting unavailable (API error)')
    return safeFallback()
  }
}

const FOOD_CREATOR = {
  channelTitle:       'Marco Food',
  channelDescription: 'Recettes maison italiennes, street food et bons plans cuisine au quotidien.',
  bio:                'Créateur food basé à Avignon, je partage des recettes simples et gourmandes.',
  dishConcepts: [
    { name: 'Gnocchi truffe & parmesan', cuisineType: 'Italien', description: 'Gnocchi maison, crème de truffe et copeaux de parmesan.' },
    { name: 'Wrap poulet croustillant',  cuisineType: 'Street food', description: 'Galette garnie de poulet pané, salade et sauce maison.' },
  ],
}

const OFF_TOPIC = {
  channelTitle:       'Crypto Pump Daily',
  channelDescription: 'Daily crypto trading signals, get-rich-quick schemes and pump alerts.',
  bio:                'Financial influencer. No cooking content whatsoever.',
  dishConcepts: [
    { name: 'Buy the dip', cuisineType: 'Finance', description: 'Not a dish — investment advice.' },
  ],
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[test-vetting] ANTHROPIC_API_KEY not set (checked env + .env.local).')
    console.warn('[test-vetting] Both calls will return the safe fallback (flag).')
  }

  console.log('[test-vetting] Case 1 — food creator (expect "pass"):')
  console.log(await vetCreator(FOOD_CREATOR))

  console.log('[test-vetting] Case 2 — off-topic applicant (expect "reject"):')
  console.log(await vetCreator(OFF_TOPIC))
}

main().catch((err) => {
  console.error('[test-vetting] unexpected error:', err)
  process.exit(1)
})
