import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { sweepAndPromote } from '@/lib/waitlist-promotion'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dishes/waitlist/decline  — a waitlisted restaurant turns the freed
// city-exclusive slot down (Mission 4, levier 3B). The entry becomes 'declined'
// and the NEXT 'waiting' restaurant is promoted immediately (same mechanic as
// the withdraw promotion). BEST-EFFORT promotion: it never fails the decline.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['restaurant', 'admin'] as const

const bodySchema = z.object({
  creatorDishId: z.string().min(1),
  brandId:       z.string().min(1).optional(),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const user       = session.user as { id?: string; role?: string }
    const operatorId = user.id
    if (!operatorId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const isAdmin = user.role === 'admin'
    if (!ALLOWED_ROLES.includes((user.role ?? '') as (typeof ALLOWED_ROLES)[number])) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const { creatorDishId, brandId } = bodySchema.parse(body)

    const brand = brandId
      ? await prisma.brand.findFirst({
          where:  isAdmin ? { id: brandId } : { id: brandId, operatorId },
          select: { id: true },
        })
      : await prisma.brand.findFirst({
          where:   { operatorId },
          orderBy: { createdAt: 'asc' },
          select:  { id: true },
        })
    if (!brand) {
      return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 403 })
    }

    const entry = await prisma.adoptionWaitlist.findFirst({
      where:  { creatorDishId, brandId: brand.id, status: 'offered' },
      select: { id: true, city: true },
    })
    if (!entry) {
      return NextResponse.json(
        { error: 'Aucune offre d’exclusivité en cours pour cette recette.', code: 'no_offer' },
        { status: 409 },
      )
    }

    await prisma.adoptionWaitlist.update({ where: { id: entry.id }, data: { status: 'declined' } })

    // Promote the next waiting restaurant immediately (best-effort).
    await sweepAndPromote(creatorDishId, entry.city)

    return NextResponse.json({ ok: true, declined: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/dishes/waitlist/decline]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
