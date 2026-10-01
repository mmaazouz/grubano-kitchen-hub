/**
 * Claude-based creator content vetting — server-side only.
 *
 * Judges whether a CREATOR applicant should be approved to publish signature
 * dish recipes on Grubano. Demands a STRICT JSON verdict so the result is
 * machine-actionable.
 *
 * Routes through the central LLM gateway (lib/llm) — tasks 'creator_vetting' and
 * 'dish_vetting' (both on the fast Haiku model). No direct SDK use.
 *
 * SAFETY:
 *   - Never throws. Any failure (no key, API error, unreadable JSON) returns a
 *     SAFE fallback verdict of 'flag' (manual review) — NEVER an auto-'pass'.
 *   - Logs nothing that could contain personal data.
 */

import { llmComplete, type LlmContentBlock } from '@/lib/llm'

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
  // Mission 14 — role choice (cumulable). Influencer-ONLY (influencer ✔ /
  // chef ✘) switches to the OPEN brand-safety barème; chef and chef+influencer
  // keep the culinary barème. Absent ⇒ culinary (backward-compatible).
  roles?: { chef: boolean; influencer: boolean }
}

// SAFE fallback — used whenever we cannot get a trustworthy verdict. 'flag' so a
// human reviews it; foodRelevance 0 so it never looks auto-approved.
function safeFallback(): VetResult {
  return { verdict: 'flag', reason: 'vérification auto indisponible', foodRelevance: 0 }
}

// ── CHEF barème (culinary) — UNCHANGED. A chef needs real cooking content for
// their recipe-publishing capability. Used for chef and chef+influencer (and any
// roleless legacy input). The string below is byte-for-byte the original prompt.
function buildChefPrompt(input: VetCreatorInput): string {
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

// ── Mission 14 — INFLUENCER barème (OPEN) ──────────────────────────────────────
// A PURE influencer (influencer ✔ / chef ✘) is judged on AUDIENCE, not cooking.
// Founder decision: accept ANY real, owned audience whatever the niche; reject
// ONLY for brand-safety or a fake/empty/bot audience. NO culinary requirement,
// NO dish concepts, NO size threshold. Ownership (the YouTube code in the channel
// description) is proven separately in the verify route and is NOT re-judged here.
function buildInfluencerPrompt(input: VetCreatorInput): string {
  const title = (input.channelTitle ?? '').trim()       || '(non fourni)'
  const desc  = (input.channelDescription ?? '').trim() || '(non fourni)'
  const bio   = (input.bio ?? '').trim()                || '(non fourni)'

  const topics = Array.isArray(input.channelTopics) ? input.channelTopics.filter(Boolean) : []
  const topicsLine = topics.length ? topics.join(', ') : '(aucune)'

  const titles = Array.isArray(input.recentVideoTitles) ? input.recentVideoTitles.filter(Boolean) : []
  const titleLines = titles.length
    ? titles.map((t, i) => `  ${i + 1}. ${String(t).trim()}`).join('\n')
    : '  (aucun)'

  return [
    'You are a BRAND-SAFETY reviewer for Grubano, a food delivery / dark-kitchen platform.',
    'You are evaluating an INFLUENCER applicant who will promote restaurants via an affiliate link.',
    "An influencer's value is their AUDIENCE, not cooking skills. The niche does NOT matter:",
    'gaming, lifestyle, travel, beauty, comedy, tech, sport, music, education… are ALL perfectly fine.',
    '',
    'Evaluate ONLY two things:',
    '1. BRAND SAFETY — is this channel safe for a food brand to be associated with?',
    '2. AUDIENCE REALITY — does it show REAL, owned content (not empty, not obviously fake / bot / engagement-farmed)?',
    '',
    'Creator data:',
    `- Channel title: ${title}`,
    `- Channel description: ${desc}`,
    `- Bio (SELF-DECLARED by the applicant — NOT evidence): ${bio}`,
    `- Channel topic categories (from YouTube): ${topicsLine}`,
    '- Recent video titles (from the channel — the REAL signal of what the channel is):',
    titleLines,
    '',
    'Return STRICTLY a single JSON object and NOTHING else — no markdown, no code fences, no commentary:',
    '{"verdict":"pass|flag|reject","reason":"<short French explanation, max 1 sentence>","foodRelevance":0}',
    '',
    'Rules:',
    '- "pass" = a real, owned, brand-safe channel of ANY niche → approve. This is the DEFAULT for a genuine creator.',
    '- "reject" = ONLY if EITHER (a) the content is built around illegal activity, hate / harassment / violence,',
    '  sexual / adult content, or content clearly unsafe for a food brand to be associated with; OR (b) the',
    '  audience is FAKE / empty / bot (empty channel, no real content, or bot / engagement-farmed fake followers).',
    '- "flag" = genuinely uncertain (borderline brand-safety, or you cannot tell whether the audience is real) → human review.',
    '- Do NOT require ANY food, cooking or culinary content. Being off-topic for food is NOT a reason to reject.',
    '- Do NOT require a minimum audience size — a small but REAL audience passes. Judge "real", not "big".',
    '- A REAL audience that uses clickbait, giveaways or hype call-to-actions is NOT a reason to reject.',
    '- Edgy-but-legal niches (dark humor, horror gaming, political commentary, esports / betting talk, etc.) are',
    '  NOT grounds for rejection — only the hard categories in (a) are.',
    '- foodRelevance is NOT used for influencers — always return 0.',
    '',
    'CRITICAL — judge PRIMARILY on the REAL channel content (recent video titles + topic categories),',
    'NOT the self-declared bio. When the channel is genuine and brand-safe, the default verdict is "pass".',
  ].join('\n')
}

/**
 * Role-aware creator-vetting prompt (Mission 14). A PURE influencer
 * (influencer ✔ / chef ✘) gets the OPEN brand-safety barème; chef,
 * chef+influencer, and any roleless legacy input keep the culinary barème.
 * Exported so the policy-per-role can be unit-tested deterministically.
 */
export function buildCreatorVettingPrompt(input: VetCreatorInput): string {
  const influencerOnly = input.roles?.influencer === true && input.roles?.chef === false
  return influencerOnly ? buildInfluencerPrompt(input) : buildChefPrompt(input)
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

    const { text } = await llmComplete({ task: 'creator_vetting', content: buildCreatorVettingPrompt(input) })
    return parseVerdict(text) ?? safeFallback()
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
function dishContent(input: VetDishInput, withPhoto: boolean): LlmContentBlock[] {
  const blocks: LlmContentBlock[] = []
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
      const { text } = await llmComplete({ task: 'dish_vetting', content: dishContent(input, true) })
      parsed = parseDishVerdict(text)
    } catch (imgErr) {
      // Image leg failed (1.5 best-effort) → text-only retry, never blocking.
      if (input.photoUrl) {
        console.error('[creator-vetting] photo leg failed — retrying text-only')
        const { text } = await llmComplete({ task: 'dish_vetting', content: dishContent(input, false) })
        parsed = parseDishVerdict(text)
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
