import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dishes/waitlist  — a restaurateur joins the waitlist for a creator
// recipe that is already taken (city-exclusive) in their city (levier 3B).
//
// Same auth guard + brand resolution as /api/dishes/adopt. Idempotent: an
// existing waiting|offered entry for (recipe, brand) is returned, never doubled.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['restaurant', 'admin'] as const

const bodySchema = z.object({
  creatorDishId: z.string().min(1),
  brandId:       z.string().min(1).optional(),
})

export async function POST(req: Request) {
  try {
    // ── Auth + role ─────────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const user       = session.user as { id?: string; role?: string }
    const operatorId = user.id
    if (!operatorId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.includes((user.role ?? '') as (typeof ALLOWED_ROLES)[number])) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    const { creatorDishId, brandId } = bodySchema.parse(body)

    // ── Resolve the target brand (same logic as /adopt) ───────────────────────────
    let brand
    if (brandId) {
      brand = await prisma.brand.findFirst({ where: { id: brandId, operatorId } })
      if (!brand) {
        return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 403 })
      }
    } else {
      brand = await prisma.brand.findFirst({ where: { operatorId }, orderBy: { createdAt: 'asc' } })
      if (!brand) {
        return NextResponse.json({ error: 'Aucune marque pour ce compte' }, { status: 400 })
      }
    }

    // ── City of this operator's restaurant (required to queue) ────────────────────
    const restaurant = await prisma.restaurant.findUnique({
      where:  { operatorId },
      select: { city: true },
    })
    const city = (restaurant?.city ?? '').trim()
    if (!city) {
      return NextResponse.json({ error: 'Ville du restaurant manquante' }, { status: 400 })
    }

    // ── Recipe must exist (avoid a raw FK error on a bogus id) ────────────────────
    const dish = await prisma.creatorDish.findUnique({
      where:  { id: creatorDishId },
      select: { id: true },
    })
    if (!dish) {
      return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    }

    // ── Idempotent join: reuse an active (waiting|offered) entry if present ───────
    const existing = await prisma.adoptionWaitlist.findFirst({
      where: { creatorDishId, brandId: brand.id, status: { in: ['waiting', 'offered'] } },
    })
    const row = existing ?? await prisma.adoptionWaitlist.create({
      data: { creatorDishId, brandId: brand.id, city, status: 'waiting' },
    })

    // ── How many brands are waiting for this recipe in this city ──────────────────
    const waitlistCount = await prisma.adoptionWaitlist.count({
      where: { creatorDishId, city, status: 'waiting' },
    })

    return NextResponse.json({ ok: true, status: row.status, waitlistCount })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/dishes/waitlist]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
