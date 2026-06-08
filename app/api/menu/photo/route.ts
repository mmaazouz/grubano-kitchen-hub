import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { processDishImage, ALLOWED_IMAGE_TYPES } from '@/lib/dish-photo'

// Needs Node (crypto, Buffer, fetch/FormData) + the session → never static / edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/menu/photo ──────────────────────────────────────────────────────
// Owner-scoped: set/replace the photo of an EXISTING dish (menuItemId), or just
// moderate+upload and return the URL for a not-yet-created dish (the create then
// carries the URL — but the primary path is now POST /api/menu with imageBase64,
// which moderates+uploads+persists atomically). Backend only — UI is Agent 13.
//
// The whole chain (validate → moderate → upload → square) lives in lib/dish-photo
// so this route and POST /api/menu behave identically. No error is ever swallowed.

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(ALLOWED_IMAGE_TYPES),
  // The brand the dish belongs to — used for ownership scoping. Always required.
  brandId:     z.string().min(1),
  // Optional: persist directly onto an existing dish.
  menuItemId:  z.string().min(1).optional(),
})

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
    if (menuItemId) {
      const item = await prisma.menuItem.findFirst({
        where:  { id: menuItemId, brandId: brand.id },
        select: { id: true },
      })
      if (!item) {
        return NextResponse.json({ error: 'Plat introuvable ou non autorisé' }, { status: 400 })
      }
    }

    // ── 3. Moderate → upload → square (shared chain, never swallows errors) ───
    const result = await processDishImage(imageBase64, mediaType)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.moderation ? { moderation: result.moderation } : {}) },
        { status: result.status },
      )
    }

    // ── 4. Persist onto the dish when one was given ───────────────────────────
    let persisted = false
    if (menuItemId) {
      await prisma.menuItem.update({
        where: { id: menuItemId },
        data:  { photos: [result.url] as unknown as Prisma.InputJsonValue },
      })
      persisted = true
    }

    return NextResponse.json(
      { url: result.url, photos: [result.url], warnings: result.warnings, moderation: result.moderation, persisted },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/menu/photo]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
