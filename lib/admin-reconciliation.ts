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

// ── LOT C — cancelled-but-paid queue (« Annulées payées — remboursement à instruire »). ──
// With CLAIMS_ENABLED=false (founder decision D4, whole beta), a restaurant refusing /
// cancelling a PAID order creates NO system claim: the money stays captured with NO
// admin surface listing it. This queue is that surface — READ-ONLY (no money action,
// nothing written): every cancelled order whose payment WAS captured ('paid', or
// 'reconcile_manual' = the manual ghost-order queue), with what was already given
// back (refundedCents = |Σ| of the 'refund' ledger lines on the same PaymentIntent —
// the ledger is the truth of give-backs; Order.paymentStatus is NEVER mutated by a
// refund). The admin instructs the refund via /api/admin/refunds/run.

export interface CancelledPaidOrderRow {
  id: string
  restaurantName: string | null
  amountEuros: number // Order.total is a Float in EUROS (legacy) → formatEuros, not cents
  paymentStatus: 'paid' | 'reconcile_manual'
  stripePaymentIntentId: string | null
  /** Cents already given back on this PaymentIntent (0 when no refund yet). */
  refundedCents: number
  createdAt: string
}

export interface CancelledPaidOrderList {
  rows: CancelledPaidOrderRow[]
  capped: boolean
}

export async function listCancelledPaidOrders(): Promise<CancelledPaidOrderList> {
  const orders = await prisma.order.findMany({
    where:   { status: 'cancelled', paymentStatus: { in: ['paid', 'reconcile_manual'] } },
    select:  {
      id: true, paymentStatus: true, total: true, createdAt: true,
      stripePaymentIntentId: true, restaurant: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take:    CAP,
  })

  // Already-refunded cents per PaymentIntent: 'refund' ledger lines store the
  // give-back as a NEGATIVE grossAmount (lib/ledger.recordRefundLedgerEntry) →
  // absolute value of the sum. One grouped query for the whole page.
  const pis = orders
    .map((o) => o.stripePaymentIntentId)
    .filter((pi): pi is string => typeof pi === 'string' && pi.length > 0)
  const refundedByPi = new Map<string, number>()
  if (pis.length > 0) {
    const groups = await prisma.ledgerEntry.groupBy({
      by:    ['stripePaymentIntentId'],
      where: { type: 'refund', stripePaymentIntentId: { in: pis } },
      _sum:  { grossAmount: true },
    })
    for (const g of groups) {
      if (g.stripePaymentIntentId) {
        refundedByPi.set(g.stripePaymentIntentId, Math.abs(g._sum.grossAmount ?? 0))
      }
    }
  }

  const rows: CancelledPaidOrderRow[] = orders.map((o) => ({
    id: o.id,
    restaurantName: o.restaurant?.name ?? null,
    amountEuros: o.total,
    paymentStatus: o.paymentStatus === 'reconcile_manual' ? 'reconcile_manual' : 'paid',
    stripePaymentIntentId: o.stripePaymentIntentId ?? null,
    refundedCents: o.stripePaymentIntentId ? refundedByPi.get(o.stripePaymentIntentId) ?? 0 : 0,
    createdAt: o.createdAt.toISOString(),
  }))

  return { rows, capped: orders.length >= CAP }
}
