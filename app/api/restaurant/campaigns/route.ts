import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { isCampaignLive, optInWindow, isValidDiscountPct } from '@/lib/campaigns'

// ─────────────────────────────────────────────────────────────────────────────
// /api/restaurant/campaigns — the resto side of chef campaigns (Promo V2 Slice 2).
//
//   GET    → INVITATIONS: live campaigns on recipes THIS resto has adopted and
//            has NOT already opted into. Each carries the resto's own MenuItem
//            (the adoption's menuItemId) so the opt-in scopes the promo correctly.
//   POST   → OPT-IN: the resto reviews/adjusts the % (its money) and confirms →
//            creates a STANDARD resto-financed Promotion (type percent, the
//            chosen %, conditions.itemIds = [the resto's MenuItem], window bounded
//            by the campaign, brand = the resto's, campaignId = the campaign).
//            ZERO new discount/commission logic — the existing engine applies it.
//   DELETE → WITHDRAW: deactivate the resto's campaign-linked promotion.
//
// Ownership is STRICT (resolveEstablishmentScope) — a resto only ever touches its
// own brands' adoptions/promotions. All campaign reads are tolerant (pre-db-push
// → no invitations, never a 500).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

async function ownedBrandIds(): Promise<{ brandIds: string[] } | { error: NextResponse }> {
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) return { error: NextResponse.json({ error: scope.error }, { status: scope.status }) }
  if (!scope.restaurantId) return { error: NextResponse.json({ error: 'Aucun établissement' }, { status: 404 }) }
  const brands = await prisma.brand.findMany({ where: { restaurantId: scope.restaurantId }, select: { id: true } })
  return { brandIds: brands.map(b => b.id) }
}

export async function GET() {
  try {
    const ctx = await ownedBrandIds()
    if ('error' in ctx) return ctx.error
    if (ctx.brandIds.length === 0) return NextResponse.json({ invitations: [] })

    let invitations: Array<Record<string, unknown>> = []
    try {
      // The recipes this resto actively adopted → their menuItemId per brand.
      const adoptions = await prisma.dishAdoption.findMany({
        where:  { brandId: { in: ctx.brandIds }, status: 'active', menuItemId: { not: null } },
        select: { creatorDishId: true, brandId: true, menuItemId: true },
      })
      if (adoptions.length === 0) return NextResponse.json({ invitations: [] })
      const dishIds = Array.from(new Set(adoptions.map(a => a.creatorDishId)))

      // Live campaigns on those recipes.
      const campaigns = await prisma.creatorCampaign.findMany({
        where:   { creatorDishId: { in: dishIds }, status: 'active' },
        include: { creatorDish: { select: { name: true } }, creator: { select: { name: true } } },
      })
      // Already opted in? an active campaign-linked promotion on one of my brands.
      const existing = await prisma.promotion.findMany({
        where:  { campaignId: { in: campaigns.map(c => c.id) }, brandId: { in: ctx.brandIds }, active: true },
        select: { campaignId: true },
      })
      const optedIn = new Set(existing.map(e => e.campaignId))

      const now = new Date()
      invitations = campaigns
        .filter(c => isCampaignLive(c, now) && !optedIn.has(c.id))
        .map(c => {
          const ad = adoptions.find(a => a.creatorDishId === c.creatorDishId)
          return {
            campaignId:           c.id,
            creatorDishId:        c.creatorDishId,
            dishName:             c.creatorDish?.name ?? '',
            creatorName:          c.creator?.name ?? '',
            suggestedDiscountPct: c.suggestedDiscountPct,
            message:              c.message,
            endsAt:               c.endDate.toISOString(),
            brandId:              ad?.brandId ?? null,
            menuItemId:           ad?.menuItemId ?? null,
          }
        })
        .filter(i => i.brandId && i.menuItemId) // need a concrete item to scope
    } catch {
      // pre-db-push: CreatorCampaign / Promotion.campaignId absent → no invites.
    }
    return NextResponse.json({ invitations })
  } catch (err) {
    console.error('[GET /api/restaurant/campaigns]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

const optInSchema = z.object({
  campaignId: z.string().min(1),
  discountPct: z.number().int(),
})

export async function POST(req: Request) {
  try {
    const ctx = await ownedBrandIds()
    if ('error' in ctx) return ctx.error

    const parsed = optInSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    const { campaignId, discountPct } = parsed.data
    if (!isValidDiscountPct(discountPct)) {
      return NextResponse.json({ error: 'Pourcentage entre 1 et 90.' }, { status: 400 })
    }

    const campaign = await prisma.creatorCampaign.findUnique({
      where:  { id: campaignId },
      include: { creatorDish: { select: { name: true } } },
    })
    if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    if (!isCampaignLive(campaign)) {
      return NextResponse.json({ error: 'Cette campagne n’est plus active.' }, { status: 409 })
    }

    // The resto must ACTIVELY adopt this recipe (→ its own MenuItem to scope).
    const adoption = await prisma.dishAdoption.findFirst({
      where:  { creatorDishId: campaign.creatorDishId, status: 'active', menuItemId: { not: null }, brandId: { in: ctx.brandIds } },
      select: { brandId: true, menuItemId: true },
    })
    if (!adoption || !adoption.menuItemId) {
      return NextResponse.json({ error: 'Vous n’avez pas adopté cette recette.' }, { status: 403 })
    }

    // One active campaign promo per (resto, campaign).
    const already = await prisma.promotion.findFirst({
      where:  { campaignId, brandId: { in: ctx.brandIds }, active: true },
      select: { id: true },
    })
    if (already) return NextResponse.json({ error: 'Vous participez déjà à cette campagne.' }, { status: 409 })

    // STANDARD resto-financed Promotion (type percent, same shape/guards as the
    // resto create path) — scoped to the resto's MenuItem, window bounded by the
    // campaign, linked by campaignId. The existing engine applies it identically.
    const win = optInWindow(campaign)
    const promotion = await prisma.promotion.create({
      data: {
        brandId:    adoption.brandId,
        name:       `Campagne — ${campaign.creatorDish?.name ?? 'recette'}`,
        type:       'percent',
        discount:   Math.round(discountPct),
        conditions: { itemIds: [adoption.menuItemId] } as object,
        startDate:  win.start,
        endDate:    win.end,
        active:     true,
        campaignId: campaign.id,
      },
    })
    return NextResponse.json({ promotion }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/restaurant/campaigns]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

const withdrawSchema = z.object({ campaignId: z.string().min(1) })

export async function DELETE(req: Request) {
  try {
    const ctx = await ownedBrandIds()
    if ('error' in ctx) return ctx.error
    const parsed = withdrawSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

    // Deactivate the resto's active campaign-linked promotion(s) — never deleted.
    const result = await prisma.promotion.updateMany({
      where: { campaignId: parsed.data.campaignId, brandId: { in: ctx.brandIds }, active: true },
      data:  { active: false },
    })
    return NextResponse.json({ withdrawn: result.count })
  } catch (err) {
    console.error('[DELETE /api/restaurant/campaigns]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
