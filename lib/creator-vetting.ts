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
  // Real-channel signals — far stronger evidence than the self-declared bio.
  channelTopics?:      string[] // YouTube topic categories (e.g. "Food")
  recentVideoTitles?:  string[] // titles of the channel's latest uploads
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

  const topics = Array.isArray(input.channelTopics) ? input.channelTopics.filter(Boolean) : []
  const topicsLine = topics.length ? topics.join(', ') : '(aucune)'

  const titles = Array.isArray(input.recentVideoTitles) ? input.recentVideoTitles.filter(Boolean) : []
  const titleLines = titles.length
    ? titles.map((t, i) => `  ${i + 1}. ${String(t).trim()}`).join('\n')
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
    `- Bio (SELF-DECLARED by the applicant — NOT evidence): ${bio}`,
    `- Channel topic categories (from YouTube): ${topicsLine}`,
    '- Recent video titles (from the channel — the REAL signal of what it is about):',
    titleLines,
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
    '',
    'CRITICAL — judge PRIMARILY on the REAL channel content (recent video titles + topic categories).',
    'The bio is SELF-DECLARED by the applicant and is NOT proof of anything.',
    'If the videos / categories are clearly NOT about cooking / food (gaming, vlog, music, etc.),',
    "answer 'reject' or 'flag', EVEN IF the bio claims otherwise.",
    "Answer 'pass' ONLY when the CHANNEL content clearly shows cooking / food. When in doubt → 'flag'.",
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

// ── Dish vetting v2 (Mission 7 — hardened, structured verdict) ─────────────────
//
// The verdict becomes STRUCTURED: { verdict, reasonCode?, detail?,
// signatureScore? }. New scope (M7): the sheet's story + platingNotes ENTER
// the vetting input (the story is public on /chef — it was the hole to close),
// and an optional photo goes through a MULTIMODAL coherence check (1.5,
// best-effort: an image-leg failure falls back to text-only, never blocking).
// Originality is NUANCED (1.6b): the prompt scores a signatureScore 0-100;
// below SIGNATURE_FLAG_THRESHOLD (env, default 20) a passing recipe is flagged
// « trop générique » — never a hard reject for lack of originality.

export type VetReasonCode =
  | 'not_a_recipe' | 'advertising' | 'inappropriate' | 'ip_brand'
  | 'duplicate_internal' | 'low_quality' | 'incoherent_photo'

/** French labels for the structured codes — UI-facing (project convention). */
export const VET_REASON_LABELS: Record<VetReasonCode, string> = {
  not_a_recipe:       'Ce n’est pas une vraie recette',
  advertising:        'Contenu publicitaire détecté',
  inappropriate:      'Contenu inapproprié',
  ip_brand:           'Marque déposée dans le nom du plat',
  duplicate_internal: 'Doublon d’une recette déjà au catalogue',
  low_quality:        'Qualité insuffisante',
  incoherent_photo:   'Photo incohérente avec le plat',
}

export interface VetDishResult {
  verdict:         VetVerdict
  reasonCode?:     VetReasonCode
  /** Short French detail for the creator (toast). */
  detail?:         string
  /** 0-100, générique ↔ signature (1.6b). Absent on technical fallback. */
  signatureScore?: number
}

export const SIGNATURE_FLAG_THRESHOLD = Number(process.env.SIGNATURE_FLAG_THRESHOLD) || 20

export interface VetDishInput {
  name:           string
  description:    string
  ingredients:    string[]
  cuisineType:    string
  suggestedPrice: number
  // M7 1.4 — the sheet's PUBLIC-facing free text enters the scope.
  story?:         string
  platingNotes?:  string
  // M7 1.5 — photo coherence (multimodal, best-effort).
  photoUrl?:      string
}

function safeDishFallback(): VetDishResult {
  return { verdict: 'flag', detail: 'vérification auto indisponible' }
}

const VALID_CODES = new Set<string>([
  'not_a_recipe', 'advertising', 'inappropriate', 'ip_brand',
  'duplicate_internal', 'low_quality', 'incoherent_photo',
])

function buildDishPromptV2(input: VetDishInput, hasPhoto: boolean): string {
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients.filter(Boolean) : []
  return [
    'You are a strict content-vetting reviewer for Grubano, a food delivery / dark-kitchen platform.',
    'Decide whether a CREATOR RECIPE submission should be published to the restaurant adoption catalogue.',
    '',
    'Evaluate ALL of the following:',
    '1. AUTHENTICITY — is this a REAL, commercially viable food recipe? Name, description,',
    '   ingredients (and story/plating when present) must be coherent with EACH OTHER.',
    '   Random text, placeholder/test content ("aaa", lorem ipsum) → reject (not_a_recipe).',
    '2. ADVERTISING — any external link, third-party promo code, phone number, or',
    '   « visit my website » style call-to-action anywhere in the text → reject (advertising).',
    '3. APPROPRIATE — nothing illegal, hateful, offensive, adult or dangerous → reject (inappropriate).',
    '   NO health claims whatsoever (« détox », « brûle-graisse », « guérit », medical promises) → reject (inappropriate).',
    '4. IP — a third-party REGISTERED BRAND in the DISH NAME (Nutella, Big Mac, Oreo, Coca-Cola…)',
    '   → reject (ip_brand). A brand mentioned only as an ingredient is tolerated.',
    hasPhoto
      ? '5. PHOTO — the attached image must show FOOD plausibly matching this dish (not a selfie, logo, screenshot or unrelated object). Mismatch → flag (incoherent_photo).'
      : '5. PHOTO — no photo attached, skip this check.',
    '6. SIGNATURE — score 0-100 how much this recipe is a personal SIGNATURE dish (personal twist,',
    '   story, own naming) versus fully generic (plain « pizza margherita »). This score NEVER',
    '   causes a reject on its own.',
    '',
    'Recipe data:',
    `- Name: ${(input.name ?? '').trim() || '(non fourni)'}`,
    `- Cuisine type: ${(input.cuisineType ?? '').trim() || '(non fourni)'}`,
    `- Description: ${(input.description ?? '').trim() || '(non fournie)'}`,
    `- Ingredients: ${ingredients.length ? ingredients.join(', ') : '(aucun)'}`,
    `- Suggested price: ${Number.isFinite(input.suggestedPrice) ? `${input.suggestedPrice} €` : '(non fourni)'}`,
    `- Story (PUBLIC on the creator page): ${(input.story ?? '').trim() || '(aucune)'}`,
    `- Plating notes: ${(input.platingNotes ?? '').trim() || '(aucune)'}`,
    '',
    'Return STRICTLY a single JSON object and NOTHING else — no markdown, no code fences, no commentary:',
    '{"verdict":"pass|flag|reject","reason":"not_a_recipe|advertising|inappropriate|ip_brand|low_quality|incoherent_photo|none",',
    ' "detail":"<short French explanation for the creator, max 1 sentence>","signatureScore":<integer 0-100>}',
    '',
    'Rules:',
    '- "pass" = clearly a real, coherent, appropriate recipe → auto-approve (reason "none").',
    '- "flag" = uncertain, borderline, photo mismatch, or needs human review.',
    '- "reject" = one of the hard violations above (give the matching reason code).',
    "When in doubt → 'flag'. Never 'pass' something that is not clearly food.",
  ].join('\n')
}

/** Parse the v2 structured verdict. Null on unusable payload. */
function parseDishVerdict(text: string): VetDishResult | null {
  if (!text) return null
  let obj = tryParse(text.trim())
  if (obj === null || typeof obj !== 'object') {
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) obj = tryParse(text.slice(start, end + 1))
  }
  if (!obj || typeof obj !== 'object') return null

  const r = obj as Record<string, unknown>
  const verdictRaw = String(r.verdict ?? '').toLowerCase().trim()
  if (verdictRaw !== 'pass' && verdictRaw !== 'flag' && verdictRaw !== 'reject') return null

  const codeRaw = String(r.reason ?? '').toLowerCase().trim()
  const reasonCode = VALID_CODES.has(codeRaw) ? (codeRaw as VetReasonCode) : undefined
  const detail = typeof r.detail === 'string' && r.detail.trim() ? r.detail.trim() : undefined

  let score = Number(r.signatureScore)
  const signatureScore = Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : undefined

  return { verdict: verdictRaw, reasonCode, detail, signatureScore }
}

/** Build the multimodal content blocks — the photo leg is OPTIONAL. */
function dishContent(input: VetDishInput, withPhoto: boolean): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (withPhoto && input.photoUrl) {
    blocks.push({ type: 'image', source: { type: 'url', url: input.photoUrl } })
  }
  blocks.push({ type: 'text', text: buildDishPromptV2(input, withPhoto && Boolean(input.photoUrl)) })
  return blocks
}

/**
 * Vet a single recipe's CONTENT with Claude — v2 structured verdict (M7).
 * Safety contract unchanged: never throws, never auto-passes on error — the
 * SAFE fallback is 'flag' (dish stays 'pending'). The MULTIMODAL photo leg is
 * best-effort: if the image call fails (bad URL, fetch error), we RETRY in
 * text-only mode before falling back.
 */
export async function vetDish(input: VetDishInput): Promise<VetDishResult> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return safeDishFallback()

    let parsed: VetDishResult | null = null
    try {
      const msg = await claude.messages.create({
        model:      MODEL,
        max_tokens: 400,
        messages:   [{ role: 'user', content: dishContent(input, true) }],
      })
      parsed = parseDishVerdict(extractText(msg.content))
    } catch (imgErr) {
      // Image leg failed (1.5 best-effort) → text-only retry, never blocking.
      if (input.photoUrl) {
        console.error('[creator-vetting] photo leg failed — retrying text-only')
        const msg = await claude.messages.create({
          model:      MODEL,
          max_tokens: 400,
          messages:   [{ role: 'user', content: dishContent(input, false) }],
        })
        parsed = parseDishVerdict(extractText(msg.content))
      } else {
        throw imgErr
      }
    }
    if (!parsed) return safeDishFallback()

    // 1.6b — originality is NUANCED: a passing-but-too-generic recipe is
    // FLAGGED (review), never rejected. The score travels with the verdict.
    if (parsed.verdict === 'pass'
        && parsed.signatureScore !== undefined
        && parsed.signatureScore < SIGNATURE_FLAG_THRESHOLD) {
      return {
        verdict:        'flag',
        reasonCode:     'low_quality',
        detail:         'recette trop générique — ajoutez votre twist personnel, votre histoire',
        signatureScore: parsed.signatureScore,
      }
    }
    return parsed
  } catch {
    console.error('[creator-vetting] dish vetting unavailable (API error)')
    return safeDishFallback()
  }
}
