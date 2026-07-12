import { prisma } from '@/lib/prisma'
import { isClaimsEnabled } from '@/lib/claims'

// ── Admin overview aggregate — read-only, cross-operator (CD ADM1) ────────────────
// Pure computation (the CALLER gates admin — the /admin page and GET /api/admin/overview
// both re-check the admin role). Money figures are READ from stored LedgerEntry columns
// in CENTS and never recomputed from rates. The golden equation holds in aggregate:
// SUM(grossAmount) = SUM(applicationFeeAmount) + SUM(netToRestaurant) over the same rows,
// because refund lines are stored NEGATIVE (lib/refund.ts) so a period SUM nets naturally.
//
// HONEST OMISSIONS (SIGNAL): no period-over-period delta (would need a 2nd real window —
// fabricated trends are forbidden) and no "recent activity" feed (no event/audit-log model
// exists yet — that lands with the AdminAuditLog in ADM7). The commission % is derived from
// the real sums or null (never hard-coded).

export interface AdminOverviewChannel {
  key: string
  count: number
}

export interface AdminOverview {
  restaurantsActive: number
  orders24h: number
  newUsers7d: number
  grossCents: number
  commissionCents: number
  netCents: number
  /** commission / gross × 100, rounded — or null when gross is 0 (omit, never fake). */
  commissionPct: number | null
  channels: AdminOverviewChannel[]
  pendingApprovals: number
  openClaims: number
  toReconcile: number
  /** false → the platform has no activity yet (overview renders its empty state). */
  hasData: boolean
}

// LedgerEntry types that make up GMV. Refund rows are negative → the SUM nets.
const GMV_TYPES = ['payment', 'deposit_capture', 'refund']

export async function computeAdminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [
    restaurantsActive,
    orders24h,
    newUsers7d,
    gmvAgg,
    channelRows,
    pendingApprovals,
    openClaims,
    toReconcile,
  ] = await Promise.all([
    prisma.restaurant.count({ where: { isActive: true } }),
    prisma.order.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.operator.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.ledgerEntry.aggregate({
      where: { type: { in: GMV_TYPES }, createdAt: { gte: dayAgo } },
      _sum: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['channel'],
      where: { type: 'payment', createdAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
    prisma.restaurant.count({ where: { isActive: false, approvedAt: null, archivedAt: null } }),
    isClaimsEnabled()
      ? prisma.claim.count({ where: { status: 'arbitration' } })
      : Promise.resolve(0),
    prisma.order.count({ where: { status: 'expired', paymentStatus: { in: ['paid', 'reconcile_manual'] } } }),
  ])

  const grossCents      = gmvAgg._sum.grossAmount ?? 0
  const commissionCents = gmvAgg._sum.applicationFeeAmount ?? 0
  const netCents        = gmvAgg._sum.netToRestaurant ?? 0
  const commissionPct   = grossCents > 0 ? Math.round((commissionCents / grossCents) * 100) : null

  const channels: AdminOverviewChannel[] = channelRows
    .filter((r) => !!r.channel)
    .map((r) => ({ key: r.channel as string, count: r._count._all }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)

  const hasData = restaurantsActive > 0 || orders24h > 0 || newUsers7d > 0 || grossCents !== 0

  return {
    restaurantsActive, orders24h, newUsers7d,
    grossCents, commissionCents, netCents, commissionPct,
    channels, pendingApprovals, openClaims, toReconcile, hasData,
  }
}
