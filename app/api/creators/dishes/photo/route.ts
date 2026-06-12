import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readCreatorRoles } from '@/lib/creator-roles'
import { processDishImage, ALLOWED_IMAGE_TYPES } from '@/lib/dish-photo'

// ── POST /api/creators/dishes/photo — recipe photo upload (Mission 3) ─────────
//
// CREATOR-side mirror of POST /api/menu/photo: the SAME proven chain
// lib/dish-photo.processDishImage (size/type validation → Claude moderation →
// signed Cloudinary upload → square delivery URL) — REUSED, not modified, so
// creator photos behave exactly like restaurant dish photos. Auth: session
// email → Creator with the CHEF role (tolerant read). Returns { url, warnings }
// — the editor previews it then persists via POST/PATCH /api/creators/dishes.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType:   z.enum(ALLOWED_IMAGE_TYPES),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 404 })
    }
    const roles = await readCreatorRoles(creator.id)
    if (!roles.isChef) {
      return NextResponse.json(
        { error: 'Le rôle Chef créateur est désactivé sur votre profil.' },
        { status: 403 },
      )
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Image invalide (jpeg, png ou webp).' }, { status: 400 })
    }

    const result = await processDishImage(parsed.data.imageBase64, parsed.data.mediaType)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ url: result.url, warnings: result.warnings })
  } catch (err) {
    console.error('[POST /api/creators/dishes/photo]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
