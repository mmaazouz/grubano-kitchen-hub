import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sheetCompleteness, type DishSheet } from '@/lib/dish-sheet'
import { readDishSheets } from '@/lib/dish-sheet-db'
import { isCreatorEnabled } from '@/lib/creator-account'

// ── Types returned to the client ──────────────────────────────────────────────

// Mission 4 (1.2): the PRIVATE studio accordion adds per-adoption analytics
// (city + sales/revenue/earnings). Richer than the shared home DishAdopter —
// declared here so the public home payload is untouched. The € figures are
// legitimate on this private surface only (never on /chef or the catalogue).
export type MyDishAdopter = {
  adoptionId:    string
  brandName:     string
  brandEmoji:    string
  city:          string    // establishment city ('' when no linked restaurant)
  adoptedAt:     string    // ISO date string
  sellingPrice:  number
  daysRemaining: number
  commitmentMet: boolean
  salesCount:    number    // count of DishSale rows for this adoption
  revenue:       number    // Σ DishSale.amount (CA généré)
  earnings:      number    // Σ DishSale.creatorEarning (gains créateur)
}

export type MyDish = {
  id:             string
  name:           string
  description:    string | null
  cuisineType:    string
  suggestedPrice: number
  status:         string
  adoptions:      number        // count of active DishAdoption rows
  totalSales:     number        // count of DishSale rows across all adoptions
  earnings:       number        // sum of DishSale.creatorEarning (gross) — kept for compat
  grubanoFee:     number        // sum of DishSale.grubanoCut  (= earnings × 20%)
  earningsNet:    number        // earnings − grubanoFee  (what creator receives)
  // ── Mission 3 editor — the UI decides what to allow WITHOUT guessing ────────
  photo:             string | null
  ingredients:       string[]   // for the edit form (Json column normalized)
  hasActiveAdoption: boolean    // R3 — content locked, photo still editable
  hasAnyHistory:     boolean    // R4 — delete becomes archive
  adoptionsCount:    number     // all-time adoptions (history)
  salesCount:        number     // all-time DishSale rows
  // Mission 4 (1.2) — richer adopters with per-adoption analytics.
  adoptersRich:      MyDishAdopter[]
  // Mission 6 — full technical sheet (the OWNER's private payload) + score.
  sheet:             DishSheet | null
  sheetCompleteness: number
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const userEmail = session.user.email

    const creator = await prisma.creator.findUnique({
      where:   { email: userEmail },
      include: { dishes: { orderBy: { createdAt: 'desc' } } },
    })

    if (!creator) {
      return NextResponse.json({
        creator:       null,
        dishes:        [],
        totalEarnings: 0,
        totalSales:    0,
        adoptions:     0,
      })
    }

    const dishIds = creator.dishes.map(d => d.id)

    // Mission 6 — technical sheets, tolerant batch read (column absent → nulls).
    const sheetsByDish = await readDishSheets(dishIds)

    // ── Batch-load all adoptions + their brands + their sales ─────────────────
    // No N+1: single query with nested includes
    const allAdoptions = dishIds.length > 0
      ? await prisma.dishAdoption.findMany({
          where: { creatorDishId: { in: dishIds } },
          include: {
            brand: {
              select: {
                name: true, emoji: true,
                // Establishment city for the private adopters analytics (1.2).
                restaurant: { select: { city: true } },
              },
            },
            sales: { select: { creatorEarning: true, grubanoCut: true, amount: true } },
          },
          orderBy: { adoptedAt: 'asc' },
        })
      : []

    // ── Build per-dish maps ───────────────────────────────────────────────────
    const now = new Date()

    type AdoptionRow = (typeof allAdoptions)[number]
    const adoptionsByDish = new Map<string, AdoptionRow[]>()

    for (const adoption of allAdoptions) {
      const list = adoptionsByDish.get(adoption.creatorDishId) ?? []
      list.push(adoption)
      adoptionsByDish.set(adoption.creatorDishId, list)
    }

    // ── Build dish payloads ───────────────────────────────────────────────────
    const dishes: MyDish[] = creator.dishes.map(d => {
      const dishAdoptions   = adoptionsByDish.get(d.id) ?? []
      const activeAdoptions = dishAdoptions.filter(a => a.status === 'active')

      const totalSales  = dishAdoptions.reduce((s, a) => s + a.sales.length, 0)
      const earnings    = Number(
        dishAdoptions
          .reduce((s, a) => s + a.sales.reduce((ss, sale) => ss + sale.creatorEarning, 0), 0)
          .toFixed(2)
      )
      const grubanoFee  = Number(
        dishAdoptions
          .reduce((s, a) => s + a.sales.reduce((ss, sale) => ss + sale.grubanoCut, 0), 0)
          .toFixed(2)
      )
      const earningsNet = Number((earnings - grubanoFee).toFixed(2))

      const adoptersRich: MyDishAdopter[] = activeAdoptions.map(a => {
        const daysElapsed   = Math.floor((now.getTime() - a.adoptedAt.getTime()) / 86_400_000)
        const daysRemaining = Math.max(0, a.minCommitmentDays - daysElapsed)
        const revenue  = Number(a.sales.reduce((s, sale) => s + sale.amount,         0).toFixed(2))
        const earnings = Number(a.sales.reduce((s, sale) => s + sale.creatorEarning, 0).toFixed(2))
        return {
          adoptionId:    a.id,
          brandName:     a.brand.name,
          brandEmoji:    a.brand.emoji,
          city:          a.brand.restaurant?.city ?? '',
          adoptedAt:     a.adoptedAt.toISOString(),
          sellingPrice:  a.sellingPrice,
          daysRemaining,
          commitmentMet: daysElapsed >= a.minCommitmentDays,
          salesCount:    a.sales.length,
          revenue,
          earnings,
        }
      })

      return {
        id:             d.id,
        name:           d.name,
        description:    d.description,
        cuisineType:    d.cuisineType,
        suggestedPrice: d.suggestedPrice,
        status:         d.status,
        adoptions:   activeAdoptions.length,
        totalSales,
        earnings,
        grubanoFee,
        earningsNet,
        adoptersRich,
        // Mission 3 editor flags (R1-R4 selectors, computed from the batch —
        // no extra query).
        photo:             d.photo,
        ingredients:       (Array.isArray(d.ingredients) ? d.ingredients : []) as string[],
        hasActiveAdoption: activeAdoptions.length > 0,
        hasAnyHistory:     dishAdoptions.length > 0 || totalSales > 0,
        adoptionsCount:    dishAdoptions.length,
        salesCount:        totalSales,
        // Mission 6 — the owner's full sheet + completeness score (D3).
        sheet:             sheetsByDish.get(d.id) ?? null,
        sheetCompleteness: sheetCompleteness(sheetsByDish.get(d.id) ?? null),
      }
    })

    return NextResponse.json({
      creator: {
        id:            creator.id,
        name:          creator.name,
        verified:      creator.verified,
        totalEarnings: creator.totalEarnings,
        instagram:     creator.instagram,
        tiktok:        creator.tiktok,
        youtube:       creator.youtube,
        followers:     creator.followers,
      },
      dishes,
      totalEarnings:   Number(dishes.reduce((s, d) => s + d.earnings,    0).toFixed(2)),
      totalGrubanoFee: Number(dishes.reduce((s, d) => s + d.grubanoFee,  0).toFixed(2)),
      totalNet:        Number(dishes.reduce((s, d) => s + d.earningsNet, 0).toFixed(2)),
      totalSales:      dishes.reduce((s, d) => s + d.totalSales, 0),
      adoptions:       dishes.reduce((s, d) => s + d.adoptions,  0),
    })
  } catch (err) {
    console.error('[GET /api/creators/my-dishes]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
