/**
 * Claude-based creator content vetting — server-side only.
 *
 * Judges whether a CREATOR applicant should be approved to publish signature
 * dish recipes on Grubano. Uses a fast Haiku model and demands a STRICT JSON
 * verdict so the result is machine-actionable.
 *
 * Client pattern mirrors app/api/email-agent/route.ts:
 *   new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
 *
 * SAFETY:
 *   - Never throws. Any failure (no key, API error, unreadable JSON) returns a
 *     SAFE fallback verdict of 'flag' (manual review) — NEVER an auto-'pass'.
 *   - Logs nothing that could contain personal data.
 */

import Anthropic from '@anthropic-ai/sdk'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Fast, cheap model for a short classification call. email-agent uses Sonnet,
// so we name Haiku explicitly here.
const MODEL = 'claude-haiku-4-5'

export type VetVerdict = 'pass' | 'flag' | 'reject'

export interface VetResult {
  verdict:       VetVerdict
  reason:        string
  foodRelevance: number // 0-100
}

export interface VetCreatorInput {
  channelTitle?:       string
  channelDescription?: string
  bio:                 string
  dishConcepts: { name: string; description: string; cuisineType: string }[]
}

// SAFE fallback — used whenever we cannot get a trustworthy verdict. 'flag' so a
// human reviews it; foodRelevance 0 so it never looks auto-approved.
function safeFallback(): VetResult {
  return { verdict: 'flag', reason: 'vérification auto indisponible', foodRelevance: 0 }
}

function buildPrompt(input: VetCreatorInput): string {
  const title    = (input.channelTitle ?? '').trim()       || '(non fourni)'
  const desc     = (input.channelDescription ?? '').trim() || '(non fourni)'
  const bio      = (input.bio ?? '').trim()                || '(non fourni)'
  const concepts = Array.isArray(input.dishConcepts) ? input.dishConcepts : []
  const conceptLines = concepts.length
    ? concepts
        .map((d, i) =>
          `  ${i + 1}. ${(d?.name ?? '').trim()} [${(d?.cuisineType ?? '').trim()}]: ${(d?.description ?? '').trim()}`,
        )
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
    `- Channel title: ${title}`,
    `- Channel description: ${desc}`,
    `- Bio: ${bio}`,
    '- Dish concepts:',
    conceptLines,
    '',
    'Return STRICTLY a single JSON object and NOTHING else — no markdown, no code fences, no commentary:',
    '{"verdict":"pass|flag|reject","reason":"<short French explanation, max 1 sentence>","foodRelevance":<integer 0-100>}',
    '',
    'Rules:',
    '- "pass" = clearly food-relevant, appropriate, and decent concepts → auto-approve.',
    '- "flag" = uncertain, borderline, or needs human review.',
    '- "reject" = off-topic (not about food) OR inappropriate / unsafe content.',
    '- foodRelevance = integer 0-100 measuring how food/cooking-relevant the creator is.',
  ].join('\n')
}

/** First text block of a Claude message, or '' if none. */
function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return ''
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Robustly parse the model's reply into a VetResult.
 * Tolerates surrounding noise / code fences by extracting the first {...} block.
 * Returns null when the payload is unusable (caller then uses the safe fallback).
 */
function parseVerdict(text: string): VetResult | null {
  if (!text) return null

  // Direct parse first; otherwise carve out the outermost JSON object.
  let obj = tryParse(text.trim())
  if (obj === null || typeof obj !== 'object') {
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      obj = tryParse(text.slice(start, end + 1))
    }
  }
  if (!obj || typeof obj !== 'object') return null

  const record      = obj as Record<string, unknown>
  const verdictRaw  = String(record.verdict ?? '').toLowerCase().trim()
  if (verdictRaw !== 'pass' && verdictRaw !== 'flag' && verdictRaw !== 'reject') {
    return null // unknown verdict → fall back to 'flag', never trust it
  }

  const reasonRaw = typeof record.reason === 'string' ? record.reason.trim() : ''
  const reason    = reasonRaw || 'Aucune raison fournie'

  let foodRelevance = Number(record.foodRelevance)
  if (!Number.isFinite(foodRelevance)) foodRelevance = 0
  foodRelevance = Math.max(0, Math.min(100, Math.round(foodRelevance)))

  return { verdict: verdictRaw, reason, foodRelevance }
}

/**
 * Vet a creator applicant with Claude. Returns a strict { verdict, reason,
 * foodRelevance } object. Best-effort: on missing key, API error, or unreadable
 * output it returns the SAFE fallback ('flag') — it never throws and never
 * auto-passes on error.
 */
export async function vetCreator(input: VetCreatorInput): Promise<VetResult> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return safeFallback()

    const msg = await claude.messages.create({
      model:      MODEL,
      max_tokens: 300,
      messages:   [{ role: 'user', content: buildPrompt(input) }],
    })

    return parseVerdict(extractText(msg.content)) ?? safeFallback()
  } catch {
    // No personal data in the log — just a generic availability note.
    console.error('[creator-vetting] vetting unavailable (API error)')
    return safeFallback()
  }
}
