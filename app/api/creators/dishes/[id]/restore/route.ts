import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// ── POST /api/creators/dishes/[id]/restore — un-archive (Mission 3) ───────────
//
// Archiving is REVERSIBLE: 'archived' → back to 'approved' when the recipe had
// been approved before (any adoption history implies it went through approval
// — the archive affordance only exists on recipes WITH history), otherwise
// back to 'draft' (defensive: an archived row without history can only come
// from a manual DB edit). Ownership strict → 404, never reveals existence.

export const dynamic = 'force-dynamic'

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
      where:  { id: params.id, creatorId: creator.id },
      select: { id: true, status: true },
    })
    if (!dish) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    if (dish.status !== 'archived') {
      return NextResponse.json({ error: 'Cette recette n’est pas archivée.' }, { status: 409 })
    }

    const anyHistory = await prisma.dishAdoption.count({ where: { creatorDishId: dish.id } })
    const nextStatus = anyHistory > 0 ? 'approved' : 'draft'

    const updated = await prisma.creatorDish.update({
      where: { id: dish.id },
      data:  { status: nextStatus },
    })
    return NextResponse.json({ dish: updated, restoredTo: nextStatus })
  } catch (err) {
    console.error('[POST /api/creators/dishes/[id]/restore]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
