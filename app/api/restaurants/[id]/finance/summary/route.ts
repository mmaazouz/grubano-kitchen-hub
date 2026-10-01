import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { resolveCommissionRate } from '@/lib/commission'

// ── GET /api/restaurants/[id]/finance/summary?period=day|week|month ───────────
// Rail A7 — the establishment's money overview, aggregated EXCLUSIVELY from
// LedgerEntry (read-only; the ledger is the source of truth). Periods:
//   day   = since local midnight (the resto's "aujourd'hui")
//   week  = rolling last 7 days
//   month = rolling last 30 days
// Also returns the commission rates applicable to THIS establishment per channel
// (computed via lib/commission: platform default, per-resto override, founders
// offer) — feeds the transparency block without a separate endpoint. Includes
// the refund-rate guard metric (policy 🔄: surveillance is a requirement).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(restaurantId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: {
      id: true, operatorId: true,
      commissionRateDineIn: true, commissionRatePickup: true,
      commissionRateDelivery: true, commissionFreeUntil: true,
    },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }
  if (restaurant.operatorId !== operator.id && operator.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }
  return { restaurant }
}

function periodStart(period: string, now: Date): Date {
  if (period === 'day') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (period === 'month') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // week (default)
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error
    const restaurant = auth.restaurant

    const { searchParams } = new URL(req.url)
    const period = ['day', 'week', 'month'].includes(searchParams.get('period') ?? '')
      ? (searchParams.get('period') as 'day' | 'week' | 'month')
      : 'week'
    const now  = new Date()
    const from = periodStart(period, now)

    const lines = await prisma.ledgerEntry.findMany({
      where:  { restaurantId: restaurant.id, createdAt: { gte: from, lte: now } },
      select: { type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true },
    })
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

    // Money IN (payments + captured no-show penalties) vs money BACK (refunds).
    const moneyIn = lines.filter(l => l.type === 'payment' || l.type === 'deposit_capture')
    const refunds = lines.filter(l => l.type === 'refund')

    const grossCents          = sum(moneyIn.map(l => l.grossAmount))
    const applicationFeeCents = sum(moneyIn.map(l => l.applicationFeeAmount))
    const netCents            = sum(moneyIn.map(l => l.netToRestaurant))
    // Refund lines are stored NEGATIVE — expose them as positive "given back".
    const refundedCents       = -sum(refunds.map(l => l.grossAmount))
    const feeReturnedCents    = -sum(refunds.map(l => l.applicationFeeAmount))
    const netRefundedCents    = -sum(refunds.map(l => l.netToRestaurant))

    // The 🔄 guard metric: share of collected money given back over the period.
    const refundRatePct = grossCents > 0 ? Math.round((refundedCents / grossCents) * 1000) / 10 : 0

    return NextResponse.json({
      period,
      from: from.toISOString(),
      to:   now.toISOString(),
      grossCents,
      applicationFeeCents,
      netCents,
      operationsCount: moneyIn.length,
      refunds: {
        count:            refunds.length,
        refundedCents,
        feeReturnedCents,
        netRefundedCents,
      },
      netAfterRefundsCents: netCents - netRefundedCents,
      refundRatePct,
      // Transparency: the rates THIS establishment actually pays, per channel
      // (source of truth = lib/commission — defaults, override, founders offer).
      rates: {
        dinein:      resolveCommissionRate(restaurant, 'dinein'),
        pickup:      resolveCommissionRate(restaurant, 'pickup'),
        delivery:    resolveCommissionRate(restaurant, 'delivery'),
        reservation: resolveCommissionRate(restaurant, 'reservation'),
        freeUntil:
          restaurant.commissionFreeUntil && restaurant.commissionFreeUntil.getTime() > now.getTime()
            ? restaurant.commissionFreeUntil.toISOString()
            : null,
      },
    })
  } catch (err) {
    console.error('[finance summary]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
