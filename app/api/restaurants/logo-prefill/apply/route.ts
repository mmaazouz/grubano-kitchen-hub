import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sniffImageType, ALLOWED_IMAGE_MEDIA, MAX_IMAGE_BYTES } from '@/lib/safe-fetch'
import { isLogoPrefillEnabled } from '@/lib/logo-detect'
import { uploadDishImage, type DishImageType } from '@/lib/dish-photo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/restaurants/logo-prefill/apply — upload the confirmed logo to OUR storage ────────
// POST {imageBase64, mediaType}: the user CONFIRMED a previewed logo. We RE-VALIDATE the
// bytes CHEZ NOUS — declared type ∈ allow-list, decoded size ≤ cap, and the MAGIC BYTES
// must match a real raster (never trust the client / the HTTP header) — then upload the
// BYTES (never an external URL) to our existing Cloudinary path (lib/dish-photo.uploadDishImage,
// UNCHANGED). Returns OUR https asset URL; the client then writes it via the EXISTING
// PATCH /api/restaurants/[id] (no fork). Gated by ONBOARDING_AI_LOGO_PREFILL_ENABLED
// (404 OFF). Owner-scoped (restaurant/admin). ZERO money surface.

async function callerOperator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
}

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(ALLOWED_IMAGE_MEDIA),
})

export async function POST(req: Request) {
  if (!isLogoPrefillEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })

  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Image invalide.' }, { status: 400 })

  // RE-VALIDATE chez nous (never trust the client) BEFORE any upload:
  const buffer = Buffer.from(parsed.data.imageBase64, 'base64')
  if (buffer.length === 0)               return NextResponse.json({ error: 'Image vide.' }, { status: 400 })
  if (buffer.length > MAX_IMAGE_BYTES)   return NextResponse.json({ error: 'Image trop volumineuse.' }, { status: 413 })
  const sniffed = sniffImageType(buffer)
  // The CONTENT must really be the declared raster type (magic bytes) — rejects a fake .png,
  // an SVG, an HTML page, etc. Cloudinary is NEVER relied on for this check.
  if (!sniffed || sniffed !== parsed.data.mediaType) {
    return NextResponse.json({ error: 'Fichier non reconnu comme une image valide.' }, { status: 400 })
  }

  try {
    // Existing Cloudinary path, UNCHANGED. We pass only the BYTES (base64) — never the
    // external site URL — so Cloudinary cannot be used to re-open the SSRF.
    const url = await uploadDishImage(parsed.data.imageBase64, sniffed as DishImageType)
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof Error && err.message === 'cloudinary_not_configured') {
      return NextResponse.json({ error: 'Stockage image non configuré.' }, { status: 500 })
    }
    console.error('[POST /api/restaurants/logo-prefill/apply]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Échec de l'enregistrement de l'image." }, { status: 502 })
  }
}
