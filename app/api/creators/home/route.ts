import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readCreatorRoles, DEFAULT_ROLES, type CreatorRoles } from '@/lib/creator-roles'

// ── Types returned to the client ──────────────────────────────────────────────

export type CreatorHomeCreator = {
  id:               string
  name:             string
  verified:         boolean
  totalEarnings:    number
  referralCode:     string | null
  referralLinkSlug: string | null
  instagram:        string | null
  tiktok:           string | null
  youtube:          string | null
  followers:        number
}

export type DishAdopter = {
  adoptionId:    string
  brandName:     string
  brandEmoji:    string
  adoptedAt:     string   // ISO date string
  sellingPrice:  number
  daysRemaining: number   // max(0, minCommitmentDays - daysElapsed)
  commitmentMet: boolean  // daysElapsed >= minCommitmentDays
}

export type CreatorHomeDish = {
  id:             string
  name:           string
  cuisineType:    string
  suggestedPrice: number
  status:         string
  adoptions:      number        // count of DishAdoption rows with status='active'
  totalSales:     number        // count of DishSale rows across all adoptions
  earnings:       number        // sum of DishSale.creatorEarning (gross) — kept for compat
  grubanoFee:     number        // sum of DishSale.grubanoCut  (= earnings × 20%)
  earningsNet:    number        // earnings − grubanoFee  (what creator receives)
  adopters:       DishAdopter[] // active adoptions with brand + commitment details
}

export type CreatorHomeAudience = {
  referralsCount:       number   // distinct customers referred
  ordersCount:          number   // total ReferralOrders
  earningsTotal:        number   // sum of referral creatorEarning all time
  earningsThisMonth:    number   // referral only, 30-day rolling window
  earningsLastMonth:    number   // referral only, previous 30-day window
}

export type ReferralRates = {
  commissionPct:        number   // fraction, e.g. 0.22
  durationDays:         number
  customerDiscountPct:  number   // fraction, e.g. 0.10
}

export type ChartDatum = {
  date:           string
  label:          string
  amount:         number   // total = recipeAmount + referralAmount (kept for back-compat)
  recipeAmount:   number   // DishSale earnings for that day
  referralAmount: number   // ReferralOrder earnings for that day
}

export type CreatorHomeData = {
  creator:             CreatorHomeCreator | null
  dishes:              CreatorHomeDish[]
  dishEarningsTotal:   number   // gross — kept for compat
  dishGrubanoFeeTotal: number   // sum grubanoCut across all dish sales
  dishNetTotal:        number   // dishEarningsTotal − dishGrubanoFeeTotal
  dishSalesTotal:      number
  dishAdoptionsTotal:  number
  audience:            CreatorHomeAudience
  referralRates:       ReferralRates | null
  chartData:            ChartDatum[]
  earningsThisMonth:    number   // referral + recipe gross, 30-day rolling window
  earningsLastMonth:    number   // referral + recipe gross, previous 30-day window
  recipeEarnings30d:    number   // recipe gross, 30-day
  recipeGrubanoFee30d:  number   // grubanoCut on recipe sales, 30-day
  recipeNet30d:         number   // recipe net (gross − fee), 30-day
  referralEarnings30d:  number   // referral-only total for the chart legend
  // Chef contribution stat (Mission 1 Creator Studio): orders of the last 30
  // days stamped with this creator's chefSlug (page visit → purchase). Pure
  // VOLUME — 0 when the column isn't migrated yet (silent degrade).
  pageSales30d:         number
  // ── Role split (Mission 2) — drives the studio's conditional UI. Tolerant
  // read: columns not migrated yet → both true (deploy-time default).
  roles:                CreatorRoles
  // Real adoption rate (AdoptionConfig.creatorCommissionPctReferred, fraction
  // e.g. 0.02) — kills the hardcoded « 4% » badges (point dur E).
  adoptionCommissionPct: number
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // ── Fetch creator with dishes and referrals ───────────────────────────────
    const creator = await prisma.creator.findUnique({
      where: { email: session.user.email },
      include: {
        dishes: { orderBy: { createdAt: 'desc' } },
        referrals: {
          include: {
            orders: {
              select: { creatorEarning: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    })

    // ── ReferralConfig (global rates) ─────────────────────────────────────────
    const ratesCfg = await prisma.referralConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    })
    const referralRates: ReferralRates | null = ratesCfg
      ? {
          commissionPct:       ratesCfg.commissionPctOfGrubanoFee,
          durationDays:        ratesCfg.durationDays,
          customerDiscountPct: ratesCfg.customerDiscountPct,
        }
      : null

    if (!creator) {
      return NextResponse.json({
        creator:             null,
        dishes:              [],
        dishEarningsTotal:   0,
        dishGrubanoFeeTotal: 0,
        dishNetTotal:        0,
        dishSalesTotal:      0,
        dishAdoptionsTotal:  0,
        audience: {
          referralsCount:    0,
          ordersCount:       0,
          earningsTotal:     0,
          earningsThisMonth: 0,
          earningsLastMonth: 0,
        },
        referralRates,
        chartData:            buildEmptyChart(),
        earningsThisMonth:    0,
        earningsLastMonth:    0,
        recipeEarnings30d:    0,
        recipeGrubanoFee30d:  0,
        recipeNet30d:         0,
        referralEarnings30d:  0,
        pageSales30d:         0,
        roles:                { ...DEFAULT_ROLES },
        adoptionCommissionPct: 0.02,
      } satisfies CreatorHomeData)
    }

    // ── 30-day rolling windows ────────────────────────────────────────────────
    const now       = new Date()
    const thirtyAgo = new Date(now); thirtyAgo.setDate(now.getDate() - 29)
    const sixtyAgo  = new Date(now); sixtyAgo.setDate(now.getDate() - 59)

    // ── Real adoptions + sales for this creator's dishes ─────────────────────
    const dishIds = creator.dishes.map(d => d.id)

    const allAdoptions = dishIds.length > 0
      ? await prisma.dishAdoption.findMany({
          where:   { creatorDishId: { in: dishIds } },
          include: {
            brand: { select: { name: true, emoji: true } },
            sales: { select: { creatorEarning: true, grubanoCut: true, createdAt: true } },
          },
          orderBy: { adoptedAt: 'asc' },
        })
      : []

    // Build per-dish lookup maps from adoptions
    const adoptionCountByDish = new Map<string, number>()   // active adoptions
    const salesByDish         = new Map<string, { creatorEarning: number; grubanoCut: number; createdAt: Date }[]>()
    const adoptersByDish      = new Map<string, DishAdopter[]>()

    for (const adoption of allAdoptions) {
      const did = adoption.creatorDishId
      if (adoption.status === 'active') {
        adoptionCountByDish.set(did, (adoptionCountByDish.get(did) ?? 0) + 1)
        // Build adopter detail
        const daysElapsed   = Math.floor((now.getTime() - adoption.adoptedAt.getTime()) / 86_400_000)
        const daysRemaining = Math.max(0, adoption.minCommitmentDays - daysElapsed)
        const existing = adoptersByDish.get(did) ?? []
        adoptersByDish.set(did, [...existing, {
          adoptionId:    adoption.id,
          brandName:     adoption.brand.name,
          brandEmoji:    adoption.brand.emoji,
          adoptedAt:     adoption.adoptedAt.toISOString(),
          sellingPrice:  adoption.sellingPrice,
          daysRemaining,
          commitmentMet: daysElapsed >= adoption.minCommitmentDays,
        }])
      }
      const existing = salesByDish.get(did) ?? []
      salesByDish.set(did, [...existing, ...adoption.sales])
    }

    // ── Dish stats ────────────────────────────────────────────────────────────
    const dishes: CreatorHomeDish[] = creator.dishes.map(d => {
      const dishSales  = salesByDish.get(d.id) ?? []
      const earnings   = Number(dishSales.reduce((s, sale) => s + sale.creatorEarning, 0).toFixed(2))
      const grubanoFee = Number(dishSales.reduce((s, sale) => s + sale.grubanoCut,      0).toFixed(2))
      return {
        id:             d.id,
        name:           d.name,
        cuisineType:    d.cuisineType,
        suggestedPrice: d.suggestedPrice,
        status:         d.status,
        adoptions:      adoptionCountByDish.get(d.id) ?? 0,
        totalSales:     dishSales.length,
        earnings,
        grubanoFee,
        earningsNet:    Number((earnings - grubanoFee).toFixed(2)),
        adopters:       adoptersByDish.get(d.id) ?? [],
      }
    })

    const dishEarningsTotal   = Number(dishes.reduce((s, d) => s + d.earnings,    0).toFixed(2))
    const dishGrubanoFeeTotal = Number(dishes.reduce((s, d) => s + d.grubanoFee,  0).toFixed(2))
    const dishNetTotal        = Number(dishes.reduce((s, d) => s + d.earningsNet, 0).toFixed(2))
    const dishSalesTotal      = dishes.reduce((s, d) => s + d.totalSales, 0)
    const dishAdoptionsTotal  = dishes.reduce((s, d) => s + d.adoptions,  0)

    // ── Flatten sources for chart + KPIs ─────────────────────────────────────
    const allReferralOrders = creator.referrals.flatMap(r => r.orders)
    const allDishSales      = allAdoptions.flatMap(a => a.sales)

    // Referral earnings by rolling window
    const refEarningsNow  = allReferralOrders
      .filter(o => o.createdAt >= thirtyAgo)
      .reduce((s, o) => s + o.creatorEarning, 0)

    const refEarningsPrev = allReferralOrders
      .filter(o => o.createdAt >= sixtyAgo && o.createdAt < thirtyAgo)
      .reduce((s, o) => s + o.creatorEarning, 0)

    // Dish sale earnings by rolling window
    const dishEarningsNow  = allDishSales
      .filter(s => s.createdAt >= thirtyAgo)
      .reduce((s, sale) => s + sale.creatorEarning, 0)

    const dishGrubanoFeeNow = allDishSales
      .filter(s => s.createdAt >= thirtyAgo)
      .reduce((s, sale) => s + sale.grubanoCut, 0)

    const dishEarningsPrev = allDishSales
      .filter(s => s.createdAt >= sixtyAgo && s.createdAt < thirtyAgo)
      .reduce((s, sale) => s + sale.creatorEarning, 0)

    // Combined KPIs (referral + recipe)
    const earningsThisMonth = Number((refEarningsNow  + dishEarningsNow).toFixed(2))
    const earningsLastMonth = Number((refEarningsPrev + dishEarningsPrev).toFixed(2))

    // ── Audience block (referral-only) ────────────────────────────────────────
    const uniqueCustomers = new Set(creator.referrals.map(r => r.customerId))
    const audience: CreatorHomeAudience = {
      referralsCount:    uniqueCustomers.size,
      ordersCount:       allReferralOrders.length,
      earningsTotal:     Number(allReferralOrders.reduce((s, o) => s + o.creatorEarning, 0).toFixed(2)),
      earningsThisMonth: Number(refEarningsNow.toFixed(2)),
      earningsLastMonth: Number(refEarningsPrev.toFixed(2)),
    }

    // ── 30-day chart: recipe sales + referral orders combined per day ─────────
    const chartData = buildCombinedChart(allReferralOrders, allDishSales)

    // ── Creator info ──────────────────────────────────────────────────────────
    const creatorInfo: CreatorHomeCreator = {
      id:               creator.id,
      name:             creator.name,
      verified:         creator.verified,
      totalEarnings:    creator.totalEarnings,
      referralCode:     creator.referralCode,
      referralLinkSlug: creator.referralLinkSlug,
      instagram:        creator.instagram,
      tiktok:           creator.tiktok,
      youtube:          creator.youtube,
      followers:        creator.followers,
    }

    // ── Role flags (Mission 2) — tolerant read, both true pre-migration ──────
    const roles = await readCreatorRoles(creator.id)

    // ── Real adoption rate (point dur E) — tolerant, default 0.02 (B0) ───────
    let adoptionCommissionPct = 0.02
    try {
      const adoptionCfg = await prisma.adoptionConfig.findFirst({
        where:   { active: true },
        orderBy: { createdAt: 'desc' },
        select:  { creatorCommissionPctReferred: true },
      })
      if (typeof adoptionCfg?.creatorCommissionPctReferred === 'number') {
        adoptionCommissionPct = adoptionCfg.creatorCommissionPctReferred
      }
    } catch { /* keep the B0 default */ }

    // ── Chef contribution stat (Mission 1) — BEST-EFFORT, volume only ────────
    // Survives the pre-db-push window: a missing Order.chefSlug column throws
    // → silent 0, the rest of the payload is unaffected.
    let pageSales30d = 0
    if (creator.referralLinkSlug) {
      try {
        pageSales30d = await prisma.order.count({
          where: {
            chefSlug:  creator.referralLinkSlug,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        })
      } catch { /* column not migrated yet → 0 */ }
    }

    return NextResponse.json({
      creator: creatorInfo,
      dishes,
      dishEarningsTotal,
      dishGrubanoFeeTotal,
      dishNetTotal,
      dishSalesTotal,
      dishAdoptionsTotal,
      audience,
      referralRates,
      chartData,
      earningsThisMonth,
      earningsLastMonth,
      recipeEarnings30d:   Number(dishEarningsNow.toFixed(2)),
      recipeGrubanoFee30d: Number(dishGrubanoFeeNow.toFixed(2)),
      recipeNet30d:        Number((dishEarningsNow - dishGrubanoFeeNow).toFixed(2)),
      referralEarnings30d: Number(refEarningsNow.toFixed(2)),
      pageSales30d,
      roles,
      adoptionCommissionPct,
    } satisfies CreatorHomeData)
  } catch (err) {
    console.error('[GET /api/creators/home]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── Chart helpers ──────────────────────────────────────────────────────────────

function buildEmptyChart(): ChartDatum[] {
  const today = new Date()
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - 29 + i)
    return {
      date:           d.toISOString().slice(0, 10),
      label:          d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      amount:         0,
      recipeAmount:   0,
      referralAmount: 0,
    }
  })
}

/**
 * Build a 30-day bar chart tracking recipe earnings (DishSale) and referral
 * earnings (ReferralOrder) separately per day.
 * `amount` = recipeAmount + referralAmount for backward compatibility.
 */
function buildCombinedChart(
  referralOrders: { creatorEarning: number; createdAt: Date }[],
  dishSales:      { creatorEarning: number; createdAt: Date }[],
): ChartDatum[] {
  const today     = new Date()
  const thirtyAgo = new Date(today)
  thirtyAgo.setDate(today.getDate() - 29)

  const recipeMap   = new Map<string, number>()
  const referralMap = new Map<string, number>()

  // Pre-fill all 30 days with 0
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyAgo)
    d.setDate(thirtyAgo.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    recipeMap.set(key, 0)
    referralMap.set(key, 0)
  }

  // Accumulate referral orders
  for (const o of referralOrders) {
    if (o.createdAt < thirtyAgo) continue
    const key = o.createdAt.toISOString().slice(0, 10)
    if (referralMap.has(key)) referralMap.set(key, (referralMap.get(key) ?? 0) + o.creatorEarning)
  }

  // Accumulate dish sales
  for (const s of dishSales) {
    if (s.createdAt < thirtyAgo) continue
    const key = s.createdAt.toISOString().slice(0, 10)
    if (recipeMap.has(key)) recipeMap.set(key, (recipeMap.get(key) ?? 0) + s.creatorEarning)
  }

  return Array.from(recipeMap.keys()).map(date => {
    const recipeAmount   = Number((recipeMap.get(date)   ?? 0).toFixed(2))
    const referralAmount = Number((referralMap.get(date) ?? 0).toFixed(2))
    return {
      date,
      label:  new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      amount: Number((recipeAmount + referralAmount).toFixed(2)),
      recipeAmount,
      referralAmount,
    }
  })
}
