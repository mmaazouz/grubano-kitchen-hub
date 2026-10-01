import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isValidDiscountPct } from '@/lib/campaigns'
import { isCreatorEnabled } from '@/lib/creator-account'

// ─────────────────────────────────────────────────────────────────────────────
// /api/creators/campaigns — the CHEF launches a demand-driver campaign on one of
// their ADOPTED recipes (Promo V2 Slice 2). The chef only PROPOSES (a suggested
// %, a message, a window) — they NEVER finance it. Adopter restaurants opt in
// and finance the discount via a standard resto-financed Promotion.
//
//   GET   → the chef's campaigns (+ opt-in count = linked active promotions).
//   POST  → launch a campaign. Guards: the session is the recipe's CREATOR, the
//           recipe is approved AND adopted by ≥ 1 restaurant (else nothing to
//           drive). Created 'active' inside its window.
//   PATCH → end a campaign (status 'ended') — never deleted.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  creatorDishId:        z.string().min(1),
  suggestedDiscountPct: z.number().int(),
  message:              z.string().trim().min(2).max(280),
  startDate:            z.string().datetime(),
  endDate:              z.string().datetime(),
})
const patchSchema = z.object({ id: z.string().min(1), status: z.literal('ended') })

async function sessionCreator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.creator.findUnique({ where: { email: session.user.email }, select: { id: true } })
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const creator = await sessionCreator()
    if (!creator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    let campaigns: Array<Record<string, unknown>> = []
    try {
      const rows = await prisma.creatorCampaign.findMany({
        where:   { creatorId: creator.id },
        orderBy: { createdAt: 'desc' },
        include: {
          creatorDish: { select: { name: true } },
          promotions:  { where: { active: true }, select: { id: true } },
        },
      })
      campaigns = rows.map(c => ({
        id: c.id, creatorDishId: c.creatorDishId, dishName: c.creatorDish?.name ?? '',
        suggestedDiscountPct: c.suggestedDiscountPct, message: c.message,
        startDate: c.startDate.toISOString(), endDate: c.endDate.toISOString(),
        status: c.status, optInCount: c.promotions.length, createdAt: c.createdAt.toISOString(),
      }))
    } catch {
      // pre-db-push: the table doesn't exist yet → no campaigns (never a 500).
    }
    return NextResponse.json({ campaigns })
  } catch (err) {
    console.error('[GET /api/creators/campaigns]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const creator = await sessionCreator()
    if (!creator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const data = parsed.data
    if (!isValidDiscountPct(data.suggestedDiscountPct)) {
      return NextResponse.json({ error: 'Remise suggérée entre 1 et 90.' }, { status: 400 })
    }
    const start = new Date(data.startDate)
    const end   = new Date(data.endDate)
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: 'La fin doit suivre le début.' }, { status: 400 })
    }

    // The recipe must belong to THIS chef and be approved.
    const dish = await prisma.creatorDish.findFirst({
      where:  { id: data.creatorDishId, creatorId: creator.id },
      select: { id: true, status: true },
    })
    if (!dish) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })
    if (dish.status !== 'approved') {
      return NextResponse.json({ error: 'La recette doit être approuvée.' }, { status: 400 })
    }

    // It must be ADOPTED by ≥ 1 restaurant (a campaign drives demand to adopters).
    const adoptions = await prisma.dishAdoption.count({
      where: { creatorDishId: dish.id, status: 'active' },
    })
    if (adoptions === 0) {
      return NextResponse.json({ error: 'Aucun restaurant n’a encore adopté cette recette.' }, { status: 400 })
    }

    const campaign = await prisma.creatorCampaign.create({
      data: {
        creatorDishId:        dish.id,
        creatorId:            creator.id,
        suggestedDiscountPct: data.suggestedDiscountPct,
        message:              data.message,
        startDate:            start,
        endDate:              end,
        status:               'active',
      },
    })
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/creators/campaigns]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const creator = await sessionCreator()
    if (!creator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

    const campaign = await prisma.creatorCampaign.findFirst({
      where:  { id: parsed.data.id, creatorId: creator.id },
      select: { id: true },
    })
    if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })

    // Ending the campaign closes it; the resto opt-in promotions keep running
    // until THEIR own window ends (the resto financed them — choice noted).
    const updated = await prisma.creatorCampaign.update({
      where: { id: campaign.id }, data: { status: 'ended' },
    })
    return NextResponse.json({ campaign: updated })
  } catch (err) {
    console.error('[PATCH /api/creators/campaigns]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
