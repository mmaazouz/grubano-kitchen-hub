import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TIER_THRESHOLDS = [
  { tier: 'bronze',  min: 0,   next: 'Silver',  nextPts: 100 },
  { tier: 'silver',  min: 100, next: 'Gold',    nextPts: 200 },
  { tier: 'gold',    min: 200, next: 'Platine', nextPts: 400 },
  { tier: 'platine', min: 400, next: null,       nextPts: null },
]

const REWARDS = [
  { name: 'Boisson offerte',  cost: 50,  tier: 'bronze'  },
  { name: 'Dessert offert',   cost: 100, tier: 'silver'  },
  { name: 'Plat offert',      cost: 200, tier: 'gold'    },
  { name: 'Repas complet',    cost: 400, tier: 'platine' },
]

// ── GET /api/loyalty/wallet?email= ───────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const email = searchParams.get('email')

    if (!email) {
      return NextResponse.json({ error: 'email requis' }, { status: 400 })
    }

    const customer = await prisma.loyaltyCustomer.findUnique({
      where:   { email },
      include: {
        orders: {
          orderBy: { validatedAt: 'desc' },
          take:    10,
          include: { brand: { select: { name: true } } },
        },
        rewards: {
          where:   { redeemed: false },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
    }

    const tierInfo  = TIER_THRESHOLDS.find(t => t.tier === customer.tier) ?? TIER_THRESHOLDS[0]
    const available = REWARDS.filter(r => customer.pointsBalance >= r.cost)

    return NextResponse.json({
      points_balance:  customer.pointsBalance,
      tier:            customer.tier,
      next_tier:       tierInfo.next,
      next_tier_pts:   tierInfo.nextPts !== null
        ? tierInfo.nextPts - customer.pointsBalance
        : 0,
      recent_orders:    customer.orders.map(o => ({
        id:          o.id,
        brand:       o.brand.name,
        amount:      o.amount,
        pointsEarned:o.pointsEarned,
        date:        o.validatedAt,
      })),
      available_rewards: available,
      referral_code: customer.referralCode.slice(0, 8).toUpperCase(),
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
