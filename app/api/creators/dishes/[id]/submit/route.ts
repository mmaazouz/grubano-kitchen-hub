import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDishVetting } from '@/lib/dish-submit'
import { hasAllergenDeclaration } from '@/lib/dish-sheet'
import { readDishSheet } from '@/lib/dish-sheet-db'

// ── POST /api/creators/dishes/[id]/submit — submit to vetting (Mission 3) ─────
//
// 'draft' | 'rejected' → 'pending' → IMMEDIATE auto-vetting (vetDish, the
// vetCreator pattern): pass → 'approved' · flag → stays 'pending' (the UI says
// « En cours de review ») · reject → 'rejected' (+ reason in the response —
// NOT persisted: no schema field fits without a migration, choice noted).
// A TECHNICAL vetting failure maps to 'flag' inside vetDish → the dish stays
// 'pending': the creator is never blocked by an outage.
// CHOICE NOTED (prudent addition): a legacy 'pending' dish can be re-submitted
// too — it re-runs the vetting and unblocks the pre-editor rows that had no
// review path at all.

export const dynamic = 'force-dynamic'

const SUBMITTABLE = ['draft', 'rejected', 'pending']

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true },
    })
    if (!creator) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

    const dish = await prisma.creatorDish.findFirst({
      where: { id: params.id, creatorId: creator.id },
    })
    if (!dish) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    if (!SUBMITTABLE.includes(dish.status)) {
      return NextResponse.json(
        { error: 'Cette recette ne peut pas être soumise dans son état actuel.' },
        { status: 409 },
      )
    }

    // ── D2 (Mission 6) — allergens gate at submission. Tolerant read: legacy
    // recipes WITHOUT a sheet (or pre-db-push column) keep passing untouched;
    // a recipe that HAS a sheet must carry the declaration (['none'] is valid).
    const sheet = await readDishSheet(dish.id)
    if (sheet !== null && !hasAllergenDeclaration(sheet)) {
      return NextResponse.json(
        { error: 'Les allergènes sont obligatoires — sélectionnez « Aucun » si c’est le cas.', code: 'allergens_required' },
        { status: 400 },
      )
    }

    const outcome = await runDishVetting({
      name:           dish.name,
      description:    dish.description,
      ingredients:    (Array.isArray(dish.ingredients) ? dish.ingredients : []) as string[],
      cuisineType:    dish.cuisineType,
      suggestedPrice: dish.suggestedPrice,
    })

    const updated = await prisma.creatorDish.update({
      where: { id: dish.id },
      data:  { status: outcome.status },
    })

    return NextResponse.json({
      dish:    updated,
      verdict: outcome.status, // approved | pending (review) | rejected
      reason:  outcome.reason,
    })
  } catch (err) {
    console.error('[POST /api/creators/dishes/[id]/submit]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
