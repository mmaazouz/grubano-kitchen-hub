import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readCreatorRoles } from '@/lib/creator-roles'
import { runDishVetting } from '@/lib/dish-submit'

// ── POST /api/creators/dishes — create a recipe (Mission 3 editor) ────────────
//
// Two paths, both owner-scoped (session email → Creator, find-or-create kept):
//   saveAsDraft:true  → status 'draft' (no vetting — the private workbench)
//   saveAsDraft:false → status 'pending' then IMMEDIATE auto-vetting (vetDish):
//                       pass → 'approved' · flag → stays 'pending' (review) ·
//                       reject → 'rejected' (+ reason in the response only).
// Requires the CHEF role (Mission 2 flags, tolerant read — both true
// pre-migration). The catalogue (/api/dishes/available) filters
// status='approved' by construction → draft/pending/rejected never leak (R5).

const dishSchema = z.object({
  name:           z.string().min(2),
  description:    z.string().min(10),
  ingredients:    z.array(z.string()).min(1),
  cuisineType:    z.string().min(1),
  suggestedPrice: z.number().positive(),
  photo:          z.string().optional(),
  saveAsDraft:    z.boolean().default(false),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await req.json()
    const data = dishSchema.parse(body)
    const userEmail = session.user.email!

    // Find or create Creator record for this operator
    let creator = await prisma.creator.findUnique({ where: { email: userEmail } })
    if (!creator) {
      creator = await prisma.creator.create({
        data: { name: session.user.name ?? 'Créateur', email: userEmail },
      })
    }

    // Mission 2/3 — the editor is a CHEF tool.
    const roles = await readCreatorRoles(creator.id)
    if (!roles.isChef) {
      return NextResponse.json(
        { error: 'Le rôle Chef créateur est désactivé sur votre profil.' },
        { status: 403 },
      )
    }

    // Draft → no vetting; submit → vet the content right away (1.3 flow).
    let status: 'draft' | 'approved' | 'pending' | 'rejected' = 'draft'
    let vetReason: string | null = null
    if (!data.saveAsDraft) {
      const outcome = await runDishVetting({
        name:           data.name,
        description:    data.description,
        ingredients:    data.ingredients,
        cuisineType:    data.cuisineType,
        suggestedPrice: data.suggestedPrice,
      })
      status    = outcome.status
      vetReason = outcome.reason
    }

    const dish = await prisma.creatorDish.create({
      data: {
        creatorId:      creator.id,
        name:           data.name,
        description:    data.description,
        ingredients:    data.ingredients,
        cuisineType:    data.cuisineType,
        suggestedPrice: data.suggestedPrice,
        photo:          data.photo,
        status,
      },
    })

    return NextResponse.json(
      { dish, ...(vetReason ? { vetReason } : {}) },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/creators/dishes]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
