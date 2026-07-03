import { prisma } from '@/lib/prisma'

// ── Admin reconciliation — read-only ghost-order queue (CD ADM3, decision D5). ────
// Surfaces the SAME data as GET /api/admin/reconcile-ghost-orders (orders lazily
// EXPIRED yet captured), but queries DIRECTLY so a page render never triggers that
// route's best-effort e-mail DIGEST side-effect. READ-ONLY: no money action, nothing
// written — the « Résoudre » control stays a disabled « bientôt » (POST-resolve deferred).
//
// The two CD tabs are derived from the REAL paymentStatus (no invented category):
//   • 'reconcile_manual' → « À réconcilier » (explicitly flagged, REFUNDS off)
//   • 'paid'             → « Anomalie »      (paid + expired — the crash-window residual)
// HONEST OMISSIONS (SIGNAL): no customer e-mail (no clean Order column) and no
// « Voir la commande » link (no admin order-detail screen exists yet).

export type GhostCategory = 'reconcile' | 'anomaly'

export interface GhostOrderRow {
  id: string
  category: GhostCategory
  restaurantName: string | null
  amountEuros: number // Order.total is a Float in EUROS (legacy) → formatEuros, not cents
  createdAt: string
}

export interface GhostOrderList {
  rows: GhostOrderRow[]
  counts: { reconcile: number; anomaly: number }
  capped: boolean
}

const CAP = 200

export async function listGhostOrders(): Promise<GhostOrderList> {
  const orders = await prisma.order.findMany({
    where:   { status: 'expired', paymentStatus: { in: ['paid', 'reconcile_manual'] } },
    select:  { id: true, paymentStatus: true, total: true, createdAt: true, restaurant: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take:    CAP,
  })

  const rows: GhostOrderRow[] = orders.map((o) => ({
    id: o.id,
    category: o.paymentStatus === 'reconcile_manual' ? 'reconcile' : 'anomaly',
    restaurantName: o.restaurant?.name ?? null,
    amountEuros: o.total,
    createdAt: o.createdAt.toISOString(),
  }))

  return {
    rows,
    counts: {
      reconcile: rows.filter((r) => r.category === 'reconcile').length,
      anomaly:   rows.filter((r) => r.category === 'anomaly').length,
    },
    capped: orders.length >= CAP,
  }
}
