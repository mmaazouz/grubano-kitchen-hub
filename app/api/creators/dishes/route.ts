import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readCreatorRoles } from '@/lib/creator-roles'
import { runDishVetting } from '@/lib/dish-submit'
import { sheetSchema, parseSheet, hasAllergenDeclaration } from '@/lib/dish-sheet'
import { isCreatorEnabled } from '@/lib/creator-account'

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
  // Mission 6 — technical sheet (zod strips unknown keys by construction).
  sheet:          sheetSchema.optional(),
})

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

    // ── D2 (Mission 6) — allergens are MANDATORY to SUBMIT a NEW recipe.
    // « Aucun allergène » (['none']) is an explicit valid choice. Drafts are
    // free (the private workbench); only the submission path is gated.
    if (!data.saveAsDraft && !hasAllergenDeclaration(parseSheet(data.sheet ?? null))) {
      return NextResponse.json(
        { error: 'Les allergènes sont obligatoires — sélectionnez « Aucun » si c’est le cas.', code: 'allergens_required' },
        { status: 400 },
      )
    }

    // Draft → no vetting; submit → vet the content right away (1.3 flow).
    // M7: the sheet's story/platingNotes + the photo enter the vetting scope,
    // and the internal-duplicate check runs against other creators.
    let status: 'draft' | 'approved' | 'pending' | 'rejected' = 'draft'
    let vetReason: string | null = null
    let vetReasonCode: string | undefined
    let vetDetail: string | undefined
    let vetSignatureScore: number | undefined
    if (!data.saveAsDraft) {
      const outcome = await runDishVetting({
        name:           data.name,
        description:    data.description,
        ingredients:    data.ingredients,
        cuisineType:    data.cuisineType,
        suggestedPrice: data.suggestedPrice,
        story:          data.sheet?.story,
        platingNotes:   data.sheet?.platingNotes,
        photoUrl:       data.photo,
      }, { creatorId: creator.id })
      status            = outcome.status
      vetReason         = outcome.reason
      vetReasonCode     = outcome.reasonCode
      vetDetail         = outcome.detail
      vetSignatureScore = outcome.signatureScore
    }

    const baseData = {
      creatorId:      creator.id,
      name:           data.name,
      description:    data.description,
      ingredients:    data.ingredients,
      cuisineType:    data.cuisineType,
      suggestedPrice: data.suggestedPrice,
      photo:          data.photo,
      status,
    }
    // Tolerant WRITE (pre-db-push window): the sheet column not migrated yet
    // makes the create throw → retry without the sheet (the recipe itself is
    // never lost; the sheet can be re-saved after the push).
    let dish
    try {
      dish = await prisma.creatorDish.create({
        data: { ...baseData, ...(data.sheet !== undefined ? { sheet: data.sheet } : {}) },
      })
    } catch (e) {
      if (data.sheet === undefined) throw e
      console.error('[POST /api/creators/dishes] sheet column missing? retrying without sheet',
        e instanceof Error ? e.message : e)
      dish = await prisma.creatorDish.create({ data: baseData })
    }

    return NextResponse.json(
      {
        dish,
        ...(vetReason ? { vetReason } : {}),
        // M7 — structured verdict (additive): code + detail + signature score.
        ...(vetReasonCode ? { vetReasonCode } : {}),
        ...(vetDetail ? { vetDetail } : {}),
        ...(vetSignatureScore !== undefined ? { vetSignatureScore } : {}),
      },
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
