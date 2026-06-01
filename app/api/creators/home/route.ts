import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

export type CreatorHomeDish = {
  id:             string
  name:           string
  cuisineType:    string
  suggestedPrice: number
  status:         string
  adoptions:      number
  totalSales:     number
  earnings:       number   // totalSales × suggestedPrice × commission
}

export type CreatorHomeAudience = {
  referralsCount:       number   // distinct customers referred
  ordersCount:          number   // total ReferralOrders
  earningsTotal:        number   // sum of creatorEarning all time
  earningsThisMonth:    number
  earningsLastMonth:    number
}

export type ReferralRates = {
  commissionPct:        number   // fraction, e.g. 0.22
  durationDays:         number
  customerDiscountPct:  number   // fraction, e.g. 0.10
}

export type ChartDatum = { date: string; label: string; amount: number }

export type CreatorHomeData = {
  creator:          CreatorHomeCreator | null
  dishes:           CreatorHomeDish[]
  dishEarningsTotal: number
  dishSalesTotal:   number
  dishAdoptionsTotal: number
  audience:         CreatorHomeAudience
  referralRates:    ReferralRates | null
  chartData:        ChartDatum[]
  earningsThisMonth: number   // referral only — schema note below
  earningsLastMonth: number   // referral only
}

// NOTE (schema gap): CreatorDish.totalSales is a cumulative counter with no
// per-date breakdown, so recipe earnings cannot be charted by day. The 30-day
// chart and monthly KPIs show REFERRAL earnings only. Flagged in Notion inbox.

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
        creator:            null,
        dishes:             [],
        dishEarningsTotal:  0,
        dishSalesTotal:     0,
        dishAdoptionsTotal: 0,
        audience: { referralsCount: 0, ordersCount: 0, earningsTotal: 0, earningsThisMonth: 0, earningsLastMonth: 0 },
        referralRates,
        chartData:          buildEmptyChart(),
        earningsThisMonth:  0,
        earningsLastMonth:  0,
      } satisfies CreatorHomeData)
    }

    // ── Dish stats ────────────────────────────────────────────────────────────
    const dishes: CreatorHomeDish[] = creator.dishes.map(d => ({
      id:             d.id,
      name:           d.name,
      cuisineType:    d.cuisineType,
      suggestedPrice: d.suggestedPrice,
      status:         d.status,
      adoptions:      (d.adoptedBy as string[]).length,
      totalSales:     d.totalSales,
      earnings:       Number((d.totalSales * d.suggestedPrice * d.commission).toFixed(2)),
    }))

    const dishEarningsTotal  = dishes.reduce((s, d) => s + d.earnings, 0)
    const dishSalesTotal     = dishes.reduce((s, d) => s + d.totalSales, 0)
    const dishAdoptionsTotal = dishes.reduce((s, d) => s + d.adoptions, 0)

    // ── Flatten all referral orders ───────────────────────────────────────────
    const allReferralOrders = creator.referrals.flatMap(r => r.orders)

    // Month boundaries
    const now              = new Date()
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const earningsThisMonth = allReferralOrders
      .filter(o => o.createdAt >= startOfThisMonth)
      .reduce((s, o) => s + o.creatorEarning, 0)

    const earningsLastMonth = allReferralOrders
      .filter(o => o.createdAt >= startOfLastMonth && o.createdAt < startOfThisMonth)
      .reduce((s, o) => s + o.creatorEarning, 0)

    // ── Audience block ────────────────────────────────────────────────────────
    const uniqueCustomers = new Set(creator.referrals.map(r => r.customerId))
    const audience: CreatorHomeAudience = {
      referralsCount:    uniqueCustomers.size,
      ordersCount:       allReferralOrders.length,
      earningsTotal:     allReferralOrders.reduce((s, o) => s + o.creatorEarning, 0),
      earningsThisMonth,
      earningsLastMonth,
    }

    // ── 30-day chart (referral earnings by day) ───────────────────────────────
    const chartData = buildChart(allReferralOrders)

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

    return NextResponse.json({
      creator: creatorInfo,
      dishes,
      dishEarningsTotal,
      dishSalesTotal,
      dishAdoptionsTotal,
      audience,
      referralRates,
      chartData,
      earningsThisMonth,
      earningsLastMonth,
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
      date:   d.toISOString().slice(0, 10),
      label:  d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      amount: 0,
    }
  })
}

function buildChart(orders: { creatorEarning: number; createdAt: Date }[]): ChartDatum[] {
  const today       = new Date()
  const thirtyAgo   = new Date(today)
  thirtyAgo.setDate(today.getDate() - 29)

  const map = new Map<string, number>()
  // Pre-fill all 30 days with 0
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyAgo)
    d.setDate(thirtyAgo.getDate() + i)
    map.set(d.toISOString().slice(0, 10), 0)
  }
  // Accumulate orders
  for (const o of orders) {
    if (o.createdAt < thirtyAgo) continue
    const key = o.createdAt.toISOString().slice(0, 10)
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + o.creatorEarning)
  }

  return Array.from(map.entries()).map(([date, amount]) => ({
    date,
    label:  new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    amount: Number(amount.toFixed(2)),
  }))
}
