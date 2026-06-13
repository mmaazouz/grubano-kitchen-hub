/**
 * Affiliate content studio — caption generation (Slice 2b, Agent 14).
 *
 * REUSES the EXISTING LLM wiring (lib/creator-vetting pattern): the same
 * @anthropic-ai/sdk client, the same ANTHROPIC_API_KEY, the same cheap model
 * (claude-haiku-4-5). NO new provider, NO new key. Server-side only.
 *
 * v1 STATELESS: generation on demand, nothing stored → no schema, no db push.
 * READ-ONLY w.r.t. money: this only writes social captions.
 *
 * Safety contract (mirrors creator-vetting): never throws — on missing key /
 * API error / unparseable output it returns null and the caller answers a clean
 * 502; it never crashes the request.
 */

import Anthropic from '@anthropic-ai/sdk'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
// Same cheap model the recipe vetting uses — captions are short creative text.
const MODEL = 'claude-haiku-4-5'

// Three distinct tones (the studio surfaces one variant per tone).
export const CONTENT_TONES = ['enthusiastic', 'punchy', 'storytelling'] as const
export type ContentTone = (typeof CONTENT_TONES)[number]

export interface CaptionTarget {
  restaurantName: string
  cuisine?:       string | null
  dishName?:      string | null
  dishPrice?:     number | null
}
export interface CaptionInput extends CaptionTarget {
  /** The affiliate deep link (built by lib/affiliate-link), embedded verbatim. */
  link:   string
  /** Fallback share token when there is no link (raw code). */
  code:   string | null
  locale: string
}
export interface Caption { tone: ContentTone; text: string }

const LANG: Record<string, string> = { fr: 'French', en: 'English', es: 'Spanish', it: 'Italian', ar: 'Arabic' }

// ── Rate limit (v1, in-memory, per process) ───────────────────────────────────
// LLM calls cost money — cap per influencer over a rolling window. In-memory is
// fine for v1 (single Passenger instance); a durable limiter is a future slice.
export const RATE_LIMIT_MAX    = 30                       // generations…
export const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000      // …per rolling 24 h
const hits = new Map<string, number[]>()

export interface RateVerdict { ok: boolean; remaining: number; resetMs: number }

/** Sliding-window check + record. Pass a stable per-influencer key. */
export function rateLimitCheck(key: string, now: number = Date.now()): RateVerdict {
  const arr = (hits.get(key) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW)
  if (arr.length >= RATE_LIMIT_MAX) {
    const resetMs = RATE_LIMIT_WINDOW - (now - arr[0])
    hits.set(key, arr)
    return { ok: false, remaining: 0, resetMs }
  }
  arr.push(now)
  hits.set(key, arr)
  return { ok: true, remaining: RATE_LIMIT_MAX - arr.length, resetMs: RATE_LIMIT_WINDOW }
}

/** TEST-ONLY: clear the in-memory window. */
export function __resetRateLimit() { hits.clear() }

function priceStr(p: number | null | undefined): string {
  return typeof p === 'number' && Number.isFinite(p) ? `${p.toFixed(2)} €` : ''
}

export function buildCaptionPrompt(input: CaptionInput): string {
  const lang = LANG[input.locale] ?? 'French'
  const subject = input.dishName
    ? `the dish « ${input.dishName} »${priceStr(input.dishPrice) ? ` (${priceStr(input.dishPrice)})` : ''} at ${input.restaurantName}`
    : `the restaurant ${input.restaurantName}`
  const share = input.link || input.code || ''
  return [
    `You write short, native-sounding social media captions in ${lang} for a food influencer.`,
    `Subject: ${subject}${input.cuisine ? ` — cuisine: ${input.cuisine}` : ''}.`,
    '',
    'Write EXACTLY 3 caption variants, one per tone:',
    '  - "enthusiastic": warm, excited, emoji-friendly.',
    '  - "punchy": very short, snappy, scroll-stopping.',
    '  - "storytelling": a tiny personal anecdote that makes the reader hungry.',
    '',
    'Each caption MUST:',
    `  - be specific to the subject (use its real name; never generic filler);`,
    `  - be at most 280 characters;`,
    `  - end with a clear call-to-action AND this exact share link verbatim: ${share}`,
    '',
    'Return STRICTLY a single JSON object, NOTHING else (no markdown, no code fence):',
    '{"captions":[{"tone":"enthusiastic","text":"..."},{"tone":"punchy","text":"..."},{"tone":"storytelling","text":"..."}]}',
  ].join('\n')
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  for (const block of content) if (block.type === 'text' && typeof block.text === 'string') return block.text
  return ''
}

/** Robust parse → up to 3 {tone,text}. Null on unusable payload. Guarantees the
 *  share link is present in every caption (appends it if the model dropped it). */
export function parseCaptions(text: string, share: string): Caption[] | null {
  if (!text) return null
  let obj: unknown = null
  try { obj = JSON.parse(text.trim()) } catch { /* carve out the object */ }
  if (!obj || typeof obj !== 'object') {
    const s = text.indexOf('{'); const e = text.lastIndexOf('}')
    if (s !== -1 && e > s) { try { obj = JSON.parse(text.slice(s, e + 1)) } catch { obj = null } }
  }
  const arr = (obj as { captions?: unknown })?.captions
  if (!Array.isArray(arr)) return null
  const out: Caption[] = []
  for (const c of arr) {
    const tone = String((c as { tone?: unknown })?.tone ?? '').toLowerCase().trim()
    let body = typeof (c as { text?: unknown })?.text === 'string' ? (c as { text: string }).text.trim() : ''
    if (!body || !CONTENT_TONES.includes(tone as ContentTone)) continue
    if (share && !body.includes(share)) body = `${body} ${share}`.trim()
    out.push({ tone: tone as ContentTone, text: body })
  }
  return out.length ? out : null
}

/** Generate caption variants. Best-effort: null on no key / API error / bad
 *  output (the caller answers a clean 502). */
export async function generateAffiliateCaptions(input: CaptionInput): Promise<Caption[] | null> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return null
    const share = input.link || input.code || ''
    const msg = await claude.messages.create({
      model:      MODEL,
      max_tokens: 700,
      messages:   [{ role: 'user', content: buildCaptionPrompt(input) }],
    })
    return parseCaptions(extractText(msg.content), share)
  } catch {
    console.error('[affiliate-content] generation unavailable (API error)')
    return null
  }
}
