import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { centsPerPoint, pointsToCents } from '@/lib/loyalty'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/loyalty/history  — the connected consumer's points ledger (L2).
//
// Session-aware like /api/loyalty/wallet: the loyalty profile is keyed by the
// LoyaltyCustomer's email (the consumer is an Operator(role=consumer), loyalty
// lives in LoyaltyCustomer). We resolve session email → LoyaltyCustomer.id →
// its LoyaltyTransaction rows (the L1 ledger: type earn|redeem|refund, signed
// points). READ-ONLY: this route never writes, never computes a credit — it
// merely surfaces the movements the rail already recorded.
//
// Each row carries the SIGNED points (+earned / −spent / +re-credited) and the
// euro equivalent of that movement (|points| × centsPerPoint) so the UI can
// label it without any client-side conversion rate.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const MAX_TAKE = 30
const orderRef = (id: string) => `#${id.slice(-6).toUpperCase()}`

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    // CONSUMER-ONLY: the ledger is resolved SOLELY from the session token —
    // NEVER from a caller-supplied ?email. /api is outside the middleware auth
    // gate, so honouring ?email here would be an IDOR (any caller could read
    // another customer's full points ledger). No operator/admin use-case exists
    // for this route, so there is no blessed ?email mode (unlike the wallet).
    const token = await getToken({ req })
    const email = typeof token?.email === 'string' ? token.email : null
    if (!email) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    // NaN-safe parsing: a malformed ?take=abc / ?skip=abc must fall back to the
    // defaults, never reach Prisma as NaN (which would 500 the route). Floor too
    // so a fractional ?take=5.5 never hits Prisma as a non-integer.
    const takeRaw = Number(searchParams.get('take'))
    const take = Math.min(Math.max(Number.isFinite(takeRaw) ? Math.floor(takeRaw) : 20, 1), MAX_TAKE)
    const skipRaw = Number(searchParams.get('skip'))
    const skip = Math.max(Number.isFinite(skipRaw) ? Math.floor(skipRaw) : 0, 0)

    const customer = await prisma.loyaltyCustomer.findUnique({
      where:  { email },
      select: { id: true, pointsBalance: true },
    })
    // No loyalty profile yet (never earned a point) → a clean empty ledger,
    // never an error: the account page just shows "no movements yet".
    if (!customer) {
      return NextResponse.json({
        transactions: [], total: 0, take, skip,
        centsPerPoint: centsPerPoint(),
        pointsBalance: 0, balanceCents: 0,
      })
    }

    const [rows, total] = await Promise.all([
      prisma.loyaltyTransaction.findMany({
        where:   { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select:  { id: true, type: true, points: true, orderId: true, createdAt: true },
      }),
      prisma.loyaltyTransaction.count({ where: { customerId: customer.id } }),
    ])

    const transactions = rows.map((r) => ({
      id:        r.id,
      type:      r.type,                                    // earn | redeem | refund
      points:    r.points,                                  // signed
      // Euro magnitude of the movement (server conversion rate, never client).
      euros:     pointsToCents(Math.abs(r.points)) / 100,
      orderId:   r.orderId,
      orderRef:  r.orderId ? orderRef(r.orderId) : null,
      date:      r.createdAt,
    }))

    return NextResponse.json({
      transactions,
      total,
      take,
      skip,
      centsPerPoint: centsPerPoint(),
      pointsBalance: customer.pointsBalance,
      balanceCents:  pointsToCents(customer.pointsBalance),
    })
  } catch (err) {
    console.error('[GET /api/loyalty/history]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
