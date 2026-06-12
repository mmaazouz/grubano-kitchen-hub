import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sheetCompleteness } from '@/lib/dish-sheet'
import { readDishSheet } from '@/lib/dish-sheet-db'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dishes/[id]/sheet — THE technical sheet (Mission 6, verrou D1).
//
// The sheet is the LICENSED ASSET the 2% royalties pay for. It is served ONLY:
//   • to a restaurateur whose brand has a DishAdoption of the recipe — ACTIVE
//     or ENDED (an ended adoption already paid for the license; historical
//     orders still reference the dish),
//   • to the recipe's CREATOR (their own asset),
//   • to an ADMIN.
// Everyone else gets a 404 that reveals NOTHING (not even existence). This is
// the SERVER-side lock — the UI alone is never the gate.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const user = session.user as { id?: string; role?: string; email?: string | null }

    // Explicit select (NO sheet here — the tolerant reader fetches it) so this
    // route survives the pre-db-push window like everything else.
    const dish = await prisma.creatorDish.findUnique({
      where:  { id: params.id },
      select: {
        id: true, creatorId: true, name: true, photo: true,
        cuisineType: true, suggestedPrice: true, status: true,
      },
    })
    if (!dish) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

    // ── D1 access check ──────────────────────────────────────────────────────
    let allowed = user.role === 'admin'

    // The creator owns the asset.
    if (!allowed && user.email) {
      const creator = await prisma.creator.findUnique({
        where:  { email: user.email },
        select: { id: true },
      })
      if (creator && creator.id === dish.creatorId) allowed = true
    }

    // A restaurateur with an adoption (active OR ended) of THIS recipe.
    if (!allowed && user.id) {
      const adoption = await prisma.dishAdoption.findFirst({
        where: {
          creatorDishId: dish.id,
          status:        { in: ['active', 'ended'] },
          brand:         { operatorId: user.id },
        },
        select: { id: true },
      })
      if (adoption) allowed = true
    }

    if (!allowed) {
      // Same body as a truly missing dish — never reveal the asset exists.
      return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    }

    const sheet = await readDishSheet(dish.id)
    return NextResponse.json({
      dish: {
        id:             dish.id,
        name:           dish.name,
        photo:          dish.photo,
        cuisineType:    dish.cuisineType,
        suggestedPrice: dish.suggestedPrice,
      },
      sheet,                                    // null = legacy recipe, no sheet yet
      completeness: sheetCompleteness(sheet),
    })
  } catch (err) {
    console.error('[GET /api/dishes/[id]/sheet]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
