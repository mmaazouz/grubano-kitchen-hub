import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { centsPerPoint } from '@/lib/loyalty'

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

// ── GET /api/loyalty/wallet[?email=] ──────────────────────────────────────────
// Two modes:
//   • ?email=  → explicit lookup (operator/admin views — unchanged contract);
//   • no param → the CONNECTED consumer's own wallet (session email). This is the
//     mode /eat/account and the /eat/cart loyalty toggle use — previously the
//     route 400'd without ?email, so the consumer balance silently read 0.
// The response now also exposes a camelCase `pointsBalance` alias + the loyalty
// conversion rate so the consumer app can render the balance and the
// points→euros scale (the exact spendable credit is still resolved server-side
// at checkout, chantier fidélité L1).

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    let email = searchParams.get('email')

    // No explicit email → fall back to the authenticated consumer's session.
    if (!email) {
      const token = await getToken({ req })
      email = typeof token?.email === 'string' ? token.email : null
    }

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
      // camelCase alias — /eat/account and the cart loyalty toggle read this.
      pointsBalance:   customer.pointsBalance,
      // Loyalty conversion scale (cents per point) for the consumer UI (L1).
      centsPerPoint:   centsPerPoint(),
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
