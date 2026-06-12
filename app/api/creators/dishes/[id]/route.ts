import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDishVetting } from '@/lib/dish-submit'

// ── /api/creators/dishes/[id] — edit & delete (Mission 3 editor) ──────────────
//
// OWNERSHIP IS STRICT: the recipe must belong to the session's Creator —
// anything else is a 404 (never reveal existence). The business rules
// (décisions Agent 0, gravées) drive every branch:
//   R1  never adopted (all-time) AND zero DishSale → everything editable;
//       DELETE = real deletion.
//   R2  'approved' WITHOUT an active adoption → content editable BUT the
//       recipe goes back through vetting (the validated content changed).
//       The PHOTO changes freely without touching the status.
//   R3  ACTIVE adoption → CONTENT LOCKED (restaurants adopted THIS content,
//       MenuItems derive from it): content PATCH → 409; DELETE → 409
//       (« archivez plutôt »). Photo stays editable.
//   R4  never hard-delete when a DishSale or DishAdoption exists (the earnings
//       ledger points at them) → deletion becomes 'archived'.

export const dynamic = 'force-dynamic'

const CONTENT_FIELDS = ['name', 'description', 'ingredients', 'cuisineType', 'suggestedPrice'] as const

const patchSchema = z.object({
  name:           z.string().min(2).optional(),
  description:    z.string().min(10).optional(),
  ingredients:    z.array(z.string()).min(1).optional(),
  cuisineType:    z.string().min(1).optional(),
  suggestedPrice: z.number().positive().optional(),
  photo:          z.string().optional(),
})

/** Resolve the dish IFF it belongs to the session creator — else null (→404). */
async function resolveOwnedDish(id: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return { error: 401 as const }
  const creator = await prisma.creator.findUnique({
    where:  { email: session.user.email },
    select: { id: true },
  })
  if (!creator) return { error: 404 as const }
  const dish = await prisma.creatorDish.findFirst({
    where: { id, creatorId: creator.id },
  })
  if (!dish) return { error: 404 as const }
  return { dish }
}

/** Adoption/sale history flags — the rule selectors (grouped, no N+1). */
async function dishHistory(dishId: string) {
  const [activeCount, anyAdoptionCount, salesCount] = await Promise.all([
    prisma.dishAdoption.count({ where: { creatorDishId: dishId, status: 'active' } }),
    prisma.dishAdoption.count({ where: { creatorDishId: dishId } }),
    prisma.dishSale.count({ where: { adoption: { creatorDishId: dishId } } }),
  ])
  return {
    hasActiveAdoption: activeCount > 0,
    hasAnyHistory:     anyAdoptionCount > 0 || salesCount > 0,
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const resolved = await resolveOwnedDish(params.id)
    if ('error' in resolved) {
      return resolved.error === 401
        ? NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
        : NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    }
    const dish = resolved.dish

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    const data = parsed.data
    const touchesContent = CONTENT_FIELDS.some((f) => data[f] !== undefined)
    const touchesPhoto   = data.photo !== undefined

    if (!touchesContent && !touchesPhoto) {
      return NextResponse.json({ dish }) // no-op
    }

    const { hasActiveAdoption } = await dishHistory(dish.id)

    // R3 — content locked while an adoption is active (photo stays free).
    if (touchesContent && hasActiveAdoption) {
      return NextResponse.json(
        {
          error: 'Contenu verrouillé : des restaurants servent cette recette. Seule la photo est modifiable — pour la retirer du catalogue, archivez-la.',
          code:  'content_locked',
        },
        { status: 409 },
      )
    }

    // Merged content (for the re-vetting of an approved recipe — R2).
    const merged = {
      name:           data.name           ?? dish.name,
      description:    data.description    ?? dish.description,
      ingredients:    data.ingredients    ?? ((Array.isArray(dish.ingredients) ? dish.ingredients : []) as string[]),
      cuisineType:    data.cuisineType    ?? dish.cuisineType,
      suggestedPrice: data.suggestedPrice ?? dish.suggestedPrice,
    }

    // R2 — validated content changed on an 'approved' recipe → re-vet now.
    let nextStatus = dish.status
    let vetReason: string | null = null
    if (touchesContent && dish.status === 'approved') {
      const outcome = await runDishVetting(merged)
      nextStatus = outcome.status
      vetReason  = outcome.reason
    }

    const updated = await prisma.creatorDish.update({
      where: { id: dish.id },
      data: {
        ...(touchesContent ? {
          name:           merged.name,
          description:    merged.description,
          ingredients:    merged.ingredients,
          cuisineType:    merged.cuisineType,
          suggestedPrice: merged.suggestedPrice,
        } : {}),
        ...(touchesPhoto ? { photo: data.photo } : {}),
        status: nextStatus,
      },
    })

    return NextResponse.json({ dish: updated, ...(vetReason ? { vetReason } : {}) })
  } catch (err) {
    console.error('[PATCH /api/creators/dishes/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const resolved = await resolveOwnedDish(params.id)
    if ('error' in resolved) {
      return resolved.error === 401
        ? NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
        : NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    }
    const dish = resolved.dish
    const { hasActiveAdoption, hasAnyHistory } = await dishHistory(dish.id)

    // R3 — an active adoption can't be deleted NOR silently archived from the
    // delete affordance: the explicit ARCHIVE action is the only path.
    if (hasActiveAdoption) {
      return NextResponse.json(
        {
          error: 'Des restaurants servent cette recette — archivez-la plutôt (les adoptions en cours continuent).',
          code:  'has_active_adoption',
        },
        { status: 409 },
      )
    }

    // R4 — any history (past adoption or any sale: the earnings ledger points
    // at those rows) → soft archive instead of a hard delete.
    if (hasAnyHistory) {
      await prisma.creatorDish.update({ where: { id: dish.id }, data: { status: 'archived' } })
      return NextResponse.json({ archived: true })
    }

    // R1 — pristine recipe → real deletion (waitlist rows are inert leftovers).
    await prisma.adoptionWaitlist.deleteMany({ where: { creatorDishId: dish.id } }).catch(() => {})
    await prisma.creatorDish.delete({ where: { id: dish.id } })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[DELETE /api/creators/dishes/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
