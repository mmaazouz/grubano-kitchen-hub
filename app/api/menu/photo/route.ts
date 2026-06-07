import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'

// Needs Node (crypto, Buffer, fetch/FormData) + the session → never static / edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/menu/photo ──────────────────────────────────────────────────────
// Owner-scoped dish-photo pipeline (backend only — UI is Agent 13):
//   1. auth + ownership (the caller must own the target brand / menu item),
//   2. validate the image (type + size),
//   3. [commit 2] moderate with Claude vision BEFORE storing,
//   4. upload to Cloudinary with a SERVER-SIGNED request (the API secret never
//      leaves the server and is never sent to the client),
//   5. [commit 3] persist the URL into MenuItem.photos when a menuItemId is given.
//
// SECURITY: every Cloudinary/Anthropic credential is read from process.env in
// this server module only. The signature is computed server-side; the client
// only ever sends the raw image + ids and receives back a public URL.

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const CLOUDINARY_FOLDER = 'grubano/dishes'

// Reads ANTHROPIC_API_KEY from the environment (same as scan-dish).
const claude = new Anthropic()

// Strict moderation prompt. The model must return ONLY JSON {allowed, reason}.
const MODERATION_PROMPT =
  'You are a strict content moderator for a food-ordering app. The image MUST be an ' +
  'appropriate photograph of a dish, food, or drink. REJECT (allowed=false) if it ' +
  'contains ANY of: sexual or nude content; violence, gore or shocking/disturbing ' +
  'imagery; hateful or offensive content; a person as the main subject; or content ' +
  'that is clearly NOT food (documents, screenshots, memes, logos or text as the main ' +
  'subject, random objects). ACCEPT (allowed=true) ONLY a genuine, appropriate photo of ' +
  'food or drink. Respond with ONLY valid JSON, no markdown, exactly: ' +
  '{"allowed": boolean, "reason": "short reason IN FRENCH when rejected, empty string when allowed"}.'

type Moderation = { allowed: boolean; reason: string }

/** Run Claude vision on the image. Throws if the call/parse fails (caller fails closed). */
async function moderateImage(
  imageBase64: string,
  mediaType: (typeof ALLOWED_TYPES)[number],
): Promise<Moderation> {
  const msg = await claude.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text',  text: MODERATION_PROMPT },
      ],
    }],
  })
  const first = msg.content[0]
  const raw   = first && first.type === 'text' ? first.text : ''
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
  const parsed = JSON.parse(clean) as { allowed?: unknown; reason?: unknown }
  return {
    allowed: parsed.allowed === true,
    reason:  typeof parsed.reason === 'string' ? parsed.reason : '',
  }
}

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(ALLOWED_TYPES),
  // The brand the dish belongs to — used for ownership scoping. Always required
  // (both the manual editor and the AI scan know the current brand).
  brandId:     z.string().min(1),
  // Optional: persist directly onto an existing dish. Omitted for the AI-scan /
  // new-dish flow where the photo precedes the dish (the client then sends the
  // returned URL to POST /api/menu at creation).
  menuItemId:  z.string().min(1).optional(),
})

type CloudinaryUpload = { secure_url?: string; error?: { message?: string } }

/** Server-signed Cloudinary upload. Returns the https URL, or throws. */
async function uploadToCloudinary(dataUri: string): Promise<string> {
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
  form.append('file', dataUri)            // base64 data URI — Cloudinary accepts it
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
    console.error('[POST /api/menu/photo] cloudinary upload failed', json?.error?.message ?? res.status)
    throw new Error('cloudinary_upload_failed')
  }
  return json.secure_url
}

export async function POST(req: Request) {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    // ── 2. Validate input ─────────────────────────────────────────────────────
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    const { imageBase64, mediaType, brandId, menuItemId } = parsed.data

    // Decode once to enforce the real byte size (base64 is ~33 % larger).
    const buffer = Buffer.from(imageBase64, 'base64')
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Image vide ou invalide.' }, { status: 400 })
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Image trop lourde (8 Mo maximum).' },
        { status: 400 },
      )
    }

    // ── Owner-scope: the brand must belong to the caller (admin bypass) ───────
    const brand = await prisma.brand.findFirst({
      where: operator.role === 'admin'
        ? { id: brandId }
        : { id: brandId, operatorId: operator.id },
      select: { id: true },
    })
    if (!brand) {
      return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 400 })
    }
    // If a target dish is given, it must belong to that brand.
    if (menuItemId) {
      const item = await prisma.menuItem.findFirst({
        where:  { id: menuItemId, brandId: brand.id },
        select: { id: true },
      })
      if (!item) {
        return NextResponse.json({ error: 'Plat introuvable ou non autorisé' }, { status: 400 })
      }
    }

    // ── 3. Moderation (BLOCKING) — never store an image Claude rejects ────────
    // Moderate the buffer BEFORE any upload, so a rejected image is never stored.
    let moderation: Moderation
    try {
      moderation = await moderateImage(imageBase64, mediaType)
    } catch (err) {
      // Fail CLOSED: if moderation cannot be evaluated, do not store anything.
      console.error('[POST /api/menu/photo] moderation failed', err)
      return NextResponse.json(
        { error: 'Modération indisponible, réessayez dans un instant.' },
        { status: 503 },
      )
    }
    if (!moderation.allowed) {
      return NextResponse.json(
        {
          error: `Cette image a été refusée : ${moderation.reason || 'contenu inapproprié'}`,
          moderation,
        },
        { status: 422 },
      )
    }

    // ── 4. Upload to Cloudinary (only reached once moderation passed) ─────────
    const dataUri = `data:${mediaType};base64,${imageBase64}`
    const url = await uploadToCloudinary(dataUri)

    return NextResponse.json({ url, photos: [url], moderation }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message === 'cloudinary_not_configured') {
      console.error('[POST /api/menu/photo] Cloudinary env vars missing')
      return NextResponse.json({ error: 'Stockage photo non configuré.' }, { status: 500 })
    }
    if (err instanceof Error && err.message === 'cloudinary_upload_failed') {
      return NextResponse.json({ error: "Échec de l'envoi de la photo, réessayez." }, { status: 502 })
    }
    console.error('[POST /api/menu/photo]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
