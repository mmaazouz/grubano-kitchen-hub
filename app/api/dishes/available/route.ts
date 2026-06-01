import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dishes/available  — catalogue of approved creator recipes a
// restaurateur can adopt onto their menu (brique 3C-1, read-only).
//
// For each recipe we expose the display fields + the creator's name/audience,
// plus `alreadyAdopted` = true when an ACTIVE DishAdoption already exists for
// (this recipe, one of the current operator's brands) — so the UI can show
// "Déjà à ta carte" instead of an Adopt button.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['restaurant', 'admin']

export async function GET() {
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
    if (!ALLOWED_ROLES.includes(user.role ?? '')) {
      return NextResponse.json({ error: 'Accès réservé aux restaurateurs' }, { status: 403 })
    }

    // Approved recipes + their creator's public profile.
    const dishes = await prisma.creatorDish.findMany({
      where:   { status: 'approved' },
      include: { creator: { select: { name: true, followers: true } } },
      orderBy: { createdAt: 'desc' },
    })

    // The operator's brands → which recipes they already actively adopted.
    const brands   = await prisma.brand.findMany({ where: { operatorId }, select: { id: true } })
    const brandIds = brands.map((b) => b.id)

    const activeAdoptions = brandIds.length
      ? await prisma.dishAdoption.findMany({
          where:  { brandId: { in: brandIds }, status: 'active' },
          select: { creatorDishId: true },
        })
      : []
    const adoptedDishIds = new Set(activeAdoptions.map((a) => a.creatorDishId))

    const result = dishes.map((d) => ({
      id:               d.id,
      name:             d.name,
      description:      d.description,
      photo:            d.photo,
      cuisineType:      d.cuisineType,
      suggestedPrice:   d.suggestedPrice,
      commission:       d.commission,
      creatorName:      d.creator?.name ?? '',
      creatorFollowers: d.creator?.followers ?? 0,
      alreadyAdopted:   adoptedDishIds.has(d.id),
    }))

    return NextResponse.json({ dishes: result, hasBrand: brandIds.length > 0 })
  } catch (err) {
    console.error('[GET /api/dishes/available]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
