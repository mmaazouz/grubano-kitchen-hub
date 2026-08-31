// Shared dish-photo chain (SERVER-ONLY): moderation → signed Cloudinary upload →
// square delivery URL. Used by BOTH POST /api/menu (create a dish with a photo)
// and POST /api/menu/photo (set/replace an existing dish's photo), so the two
// paths behave identically and no credential logic is duplicated.
//
// SECURITY: every Cloudinary/Anthropic credential is read from process.env here,
// server-side only. The Cloudinary signature is computed server-side; the secret
// never reaches the client and is never logged.

import { createHash } from 'crypto'
import { llmComplete, type LlmContent } from '@/lib/llm'

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type DishImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

const CLOUDINARY_FOLDER = 'grubano/dishes'
// Square, subject-aware, auto format+quality delivery transformation. Stored in
// the URL so the menu grid renders uniformly without any client-side work.
const SQUARE_TRANSFORM = 'c_fill,g_auto,ar_1:1,f_auto,q_auto'

// ── Moderation ────────────────────────────────────────────────────────────────

export type Moderation = { allowed: boolean; reason: string; warnings: string[] }

// HARD reject (allowed=false) vs SOFT advisory (allowed=true + warnings[]).
const MODERATION_PROMPT =
  "You are a strict content moderator for a food-ordering app's DISH photos. " +
  'Return ONLY valid JSON, no markdown, exactly: ' +
  '{"allowed": boolean, "reason": string, "warnings": string[]}. ' +
  'Set allowed=false (HARD REJECT) with a short reason IN FRENCH if ANY of: ' +
  '(1) inappropriate content — sexual/nude, violence/gore, shocking/disturbing, hateful/offensive; ' +
  '(2) the image is NOT food or drink — a person/selfie, a logo, a room or place, a screenshot, ' +
  'a document, or a random non-food object; ' +
  '(3) a COMPETITOR logo or watermark (Uber Eats, Deliveroo, Just Eat, etc.), any third-party ' +
  'brand mark, or overlaid/burned-in text or price. ' +
  'Otherwise set allowed=true. Then add SOFT advisory items to "warnings" (IN FRENCH, these DO NOT ' +
  'block publishing) for any quality issue: blurry or low resolution; too dark / poorly lit; ' +
  'several dishes or a far/wide framing where the dish is not the clear subject. ' +
  'reason MUST be "" when allowed=true. warnings MUST be [] when there is nothing to advise.'

/**
 * Run Claude vision on the image. Throws on call/parse failure so the caller can
 * fail CLOSED (never store an unverified image).
 *
 * `operatorId` — COST GOVERNANCE, not authorisation. `dish_moderation` is a SONNET
 * vision task (lib/llm/index.ts TASKS), i.e. the same unit cost as `dish_scan`, and
 * lib/llm/index.ts only runs the per-partner quota `if (input.operatorId && …)`.
 * Passing it through means the call is BOTH quota-checked before spending and
 * attributed in LlmUsage (which is what `lib/llm/quota.ts` aggregates); omitting it
 * makes the spend invisible to the operator's own counter.
 * OPTIONAL on purpose: the parameter is additive so the call sites outside this
 * train's perimeter keep their EXACT current behaviour (undefined → no quota, as
 * today) instead of being silently repointed. See the note on processDishImage.
 */
export async function moderateDishImage(
  imageBase64: string,
  mediaType: DishImageType,
  operatorId?: string | null,
): Promise<Moderation> {
  const content: LlmContent = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text',  text: MODERATION_PROMPT },
  ]
  // Throws on failure (no internal catch) so the caller fails CLOSED — never stores
  // an unverified image. The gateway also throws on the kill-switch, same effect,
  // and on LlmQuotaError when this call is attributed to an over-budget operator.
  const { text: raw } = await llmComplete({ task: 'dish_moderation', content, operatorId })
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
  const parsed = JSON.parse(clean) as { allowed?: unknown; reason?: unknown; warnings?: unknown }
  return {
    allowed:  parsed.allowed === true,
    reason:   typeof parsed.reason === 'string' ? parsed.reason : '',
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  }
}

// ── Cloudinary signed upload ──────────────────────────────────────────────────

type CloudinaryUpload = { secure_url?: string; error?: { message?: string } }

/** Insert the square delivery transformation into a Cloudinary upload URL. */
function toSquareDeliveryUrl(secureUrl: string): string {
  const marker = '/image/upload/'
  const i = secureUrl.indexOf(marker)
  if (i === -1) return secureUrl
  return secureUrl.slice(0, i + marker.length) + SQUARE_TRANSFORM + '/' + secureUrl.slice(i + marker.length)
}

/**
 * Server-signed Cloudinary upload. Returns the SQUARE https delivery URL.
 * Throws Error('cloudinary_not_configured') | Error('cloudinary_upload_failed').
 */
export async function uploadDishImage(imageBase64: string, mediaType: DishImageType): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('cloudinary_not_configured')
  }

  const timestamp = Math.floor(Date.now() / 1000)
  // Signature = SHA-1 of the signed params (sorted alphabetically, key=value
  // joined by &) with the API secret appended — Cloudinary's documented scheme.
  // Only `folder` and `timestamp` are signed; `file`/`api_key` are never signed.
  const toSign    = `folder=${CLOUDINARY_FOLDER}&timestamp=${timestamp}`
  const signature = createHash('sha1').update(toSign + apiSecret).digest('hex')

  const form = new FormData()
  form.append('file', `data:${mediaType};base64,${imageBase64}`) // data URI — accepted by Cloudinary
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('folder', CLOUDINARY_FOLDER)
  form.append('signature', signature)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body:   form,
  })
  const json = (await res.json().catch(() => null)) as CloudinaryUpload | null
  if (!res.ok || !json?.secure_url) {
    // Log the Cloudinary error message (never the secret) for diagnosis.
    console.error('[dish-photo] cloudinary upload failed', json?.error?.message ?? res.status)
    throw new Error('cloudinary_upload_failed')
  }
  return toSquareDeliveryUrl(json.secure_url)
}

// ── Full chain ────────────────────────────────────────────────────────────────

export type DishPhotoResult =
  | { ok: true;  url: string; warnings: string[]; moderation: Moderation }
  | { ok: false; status: 400 | 422 | 429 | 500 | 502 | 503; error: string; moderation?: Moderation }

/**
 * Validate → moderate → upload. NEVER throws and NEVER swallows an error
 * silently: every failure maps to a concrete {ok:false, status, error} the route
 * returns verbatim, so the UI always knows what happened (a dish is never created
 * with a silently-missing photo). On success returns the SQUARE Cloudinary URL.
 *
 * `operatorId` (optional) — forwarded to the moderation call for the per-partner LLM
 * quota + usage attribution. WHO PASSES IT TODAY, stated honestly:
 *   • POST /api/menu ....................... YES (this train's perimeter)
 *   • POST /api/menu/photo ................. no — has `operator.id` in hand, next train
 *   • POST /api/creators/dishes/photo ...... no — next train
 *   • POST /api/claims ..................... no — consumer `token.sub`, next train
 * Those three remain exactly as they are today (unattributed, unquota'd); the
 * parameter being optional is what guarantees they are byte-identical. Do NOT read
 * this as "the quota now covers every LLM photo path" — it covers the dish-creation
 * path only, until the remaining call sites are wired the same way.
 */
export async function processDishImage(
  imageBase64: string,
  mediaType: DishImageType,
  operatorId?: string | null,
): Promise<DishPhotoResult> {
  // Size / emptiness (real byte size — base64 is ~33 % larger).
  const buffer = Buffer.from(imageBase64, 'base64')
  if (buffer.length === 0) {
    return { ok: false, status: 400, error: 'Image vide ou invalide.' }
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, status: 400, error: 'Image trop lourde (8 Mo maximum).' }
  }

  // Moderation BEFORE upload — a rejected image never reaches Cloudinary.
  let moderation: Moderation
  try {
    moderation = await moderateDishImage(imageBase64, mediaType, operatorId)
  } catch (err) {
    // An over-budget operator is NOT an outage: "réessayez dans un instant" would be
    // a lie for a MONTHLY cap. Same contract as POST /api/menu/scan-dish (429 + the
    // same French message). Matched by `name` rather than `instanceof` so this module
    // needs no extra import from the gateway (and stays inert in suites that mock it).
    if (err instanceof Error && err.name === 'LlmQuotaError') {
      return { ok: false, status: 429, error: 'Limite IA atteinte, réessaie plus tard.' }
    }
    console.error('[dish-photo] moderation failed', err)
    return { ok: false, status: 503, error: 'Modération indisponible, réessayez dans un instant.' }
  }
  if (!moderation.allowed) {
    return {
      ok: false,
      status: 422,
      error: `Cette image a été refusée : ${moderation.reason || 'contenu inapproprié'}`,
      moderation,
    }
  }

  // Upload (only reached once moderation passed).
  try {
    const url = await uploadDishImage(imageBase64, mediaType)
    return { ok: true, url, warnings: moderation.warnings, moderation }
  } catch (err) {
    if (err instanceof Error && err.message === 'cloudinary_not_configured') {
      console.error('[dish-photo] Cloudinary env vars missing')
      return { ok: false, status: 500, error: 'Stockage photo non configuré.' }
    }
    return { ok: false, status: 502, error: "Échec de l'envoi de la photo, réessayez." }
  }
}
