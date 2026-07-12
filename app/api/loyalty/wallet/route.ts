import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { centsPerPoint, pointsToCents } from '@/lib/loyalty'
import { loyaltyCustomerWhereForOperator } from '@/lib/customer-scope'

const TIER_THRESHOLDS = [
  { tier: 'bronze',  min: 0,   next: 'Silver',  nextPts: 100 },
  { tier: 'silver',  min: 100, next: 'Gold',    nextPts: 200 },
  { tier: 'gold',    min: 200, next: 'Platine', nextPts: 400 },
  { tier: 'platine', min: 400, next: null,       nextPts: null },
]

// Chantier fidélité L2 — the points now buy a GRUBANO-financed € CREDIT, not a
// named reward. The misleading « Boisson / Dessert / Plat / Repas » catalogue is
// replaced by a euro-credit scale computed from the REAL conversion rate
// (lib/loyalty.pointsToCents — never a hardcoded rate). Milestones mirror the
// tier points so the scale reads naturally. (Verified: no client read the old
// `available_rewards` field — safe to drop, choice noted.)
const CREDIT_MILESTONE_POINTS = [100, 200, 400]
function creditScale() {
  return CREDIT_MILESTONE_POINTS.map((points) => ({
    points,
    euros: pointsToCents(points) / 100,
  }))
}

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
    const explicitEmail = searchParams.get('email')

    // WP-SEC-03 — throttle the ?email= enumeration path (per-IP, before any auth/DB).
    if (explicitEmail) {
      const limited = rateLimit(req, 'wallet_email', { limitDefault: 20, windowDefault: 60 })
      if (limited) return limited
    }

    const token = await getToken({ req })

    // A restaurateur consulting an explicit ?email= is scoped to HIS OWN customers
    // (SEC — cross-tenant). Admin keeps the platform-wide view; a consumer only ever
    // reads their own wallet via the session fallback.
    let email: string | null
    let scopeToOperatorId: string | null = null   // non-null ⇒ scope to this operator's tenant
    if (explicitEmail) {
      // WP-SEC-01 — an explicit ?email= lookup is an OPERATOR/ADMIN action (the
      // /loyalty screen consulting a client wallet). A consumer may ONLY read their
      // OWN wallet, via the session fallback below. Gating this closes a PII
      // enumeration leak where any unauthenticated caller could read any consumer's
      // points balance, tier, referral code and last-10 orders by guessing an email.
      if (!token) {
        return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
      }
      const role = typeof token.role === 'string' ? token.role : null
      if (role !== 'restaurant' && role !== 'admin') {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
      email = explicitEmail
      // WP-SEC-02 — AUTHN alone is not enough: without tenant scoping ANY
      // restaurateur could read ANY platform customer's wallet + cross-tenant order
      // history by guessing an email (and use the 404/200 as an email oracle). A
      // restaurant caller is therefore fenced to customers who ordered chez lui;
      // admin (no operator tenant) keeps the unscoped view.
      if (role === 'restaurant') {
        scopeToOperatorId = typeof token.sub === 'string' ? token.sub : null
        if (!scopeToOperatorId) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
        }
      }
    } else {
      // No explicit email → the authenticated consumer's own wallet (session email).
      email = typeof token?.email === 'string' ? token.email : null
    }

    if (!email) {
      return NextResponse.json({ error: 'email requis' }, { status: 400 })
    }

    let customer
    if (scopeToOperatorId) {
      // Tenant-scoped: the customer must have ordered at one of the caller's own
      // brands/restaurants (same fence as the /customers screen), and only the
      // caller's OWN brand orders are returned (no competitor brand names leak).
      const scopedWhere = await loyaltyCustomerWhereForOperator(scopeToOperatorId)
      customer = await prisma.loyaltyCustomer.findFirst({
        where:   { AND: [{ email }, scopedWhere] },
        include: {
          orders: {
            where:   { brand: { operatorId: scopeToOperatorId } },
            orderBy: { validatedAt: 'desc' },
            take:    10,
            include: { brand: { select: { name: true } } },
          },
        },
      })
    } else {
      // Consumer's own wallet OR admin platform-wide lookup — unscoped by design.
      customer = await prisma.loyaltyCustomer.findUnique({
        where:   { email },
        include: {
          orders: {
            orderBy: { validatedAt: 'desc' },
            take:    10,
            include: { brand: { select: { name: true } } },
          },
        },
      })
    }

    if (!customer) {
      // Same 404 whether the customer doesn't exist or isn't the caller's — no oracle.
      return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
    }

    const tierInfo = TIER_THRESHOLDS.find(t => t.tier === customer.tier) ?? TIER_THRESHOLDS[0]

    return NextResponse.json({
      points_balance:  customer.pointsBalance,
      // camelCase alias — /eat/account and the cart loyalty toggle read this.
      pointsBalance:   customer.pointsBalance,
      // Loyalty conversion scale (cents per point) for the consumer UI (L1).
      centsPerPoint:   centsPerPoint(),
      // ── L2 — the € CREDIT view (replaces the named-reward catalogue) ─────────
      // The balance converted to euros (server rate, never client) + a readable
      // points→€ scale. « Tu as 240 pts = 12 € de crédit ».
      balanceCents:    pointsToCents(customer.pointsBalance),
      balanceEuros:    pointsToCents(customer.pointsBalance) / 100,
      creditScale:     creditScale(),
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
      referral_code: customer.referralCode.slice(0, 8).toUpperCase(),
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
