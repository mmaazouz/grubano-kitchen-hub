// Creator earnings engine (phase B, mission B2a). PURE rules + a batch runner.
//
// B0 lifecycle of a gain (ReferralOrder / DishSale row):
//   pending → matured   7 days AFTER the ORDER, once the order is PAID, not
//                       fully refunded (read from the LEDGER at maturation
//                       time — the webhook is never touched), and not a
//                       self-referral.
//   pending → cancelled order never paid (checkout pays immediately — 7 days
//                       unpaid = abandoned), fully refunded, or self-referral.
//   matured → paid      B2b payouts (NOT this mission).
// Partial refund: the gain still matures — the pro-rata take-back becomes a
// compensating line at payout time (B0), never a mutation of this row.
import { prisma } from '@/lib/prisma'

export const MATURATION_DAYS        = 7    // B0
export const PAYOUT_THRESHOLD_CENTS = 2000 // B0: 20 € minimum payout

export type MaturityInput = {
  /** When the gain was generated = the ORDER's date (fallback: the row's). */
  orderCreatedAt:     Date
  now:                Date
  /** false only for legacy aggregate DishSales with no linked order. */
  orderExists:        boolean
  orderPaymentStatus: string | null // Order.paymentStatus — 'paid' | 'pending' | null
  orderTotalCents:    number
  /** |sum| of the ledger 'refund' lines on the order's PaymentIntent. */
  refundedCents:      number
  isSelfReferral:     boolean
}

export type MaturityVerdict =
  | { status: 'pending';   reason: 'too_young' }
  | { status: 'matured';   reason: 'ok' | 'no_order_link' }
  | { status: 'cancelled'; reason: 'self_referral' | 'never_paid' | 'fully_refunded' }

/** The B0 maturation rules — PURE (fully unit-tested, no I/O). */
export function evaluateEarningMaturity(i: MaturityInput): MaturityVerdict {
  if (i.isSelfReferral) return { status: 'cancelled', reason: 'self_referral' }

  const ageMs = i.now.getTime() - i.orderCreatedAt.getTime()
  if (ageMs < MATURATION_DAYS * 24 * 60 * 60 * 1000) {
    return { status: 'pending', reason: 'too_young' }
  }

  // Legacy aggregate DishSale (no order row): written by trusted server flows
  // before the checkout existed — matures on age alone.
  if (!i.orderExists) return { status: 'matured', reason: 'no_order_link' }

  if (i.orderPaymentStatus !== 'paid') {
    return { status: 'cancelled', reason: 'never_paid' }
  }
  if (i.orderTotalCents > 0 && i.refundedCents >= i.orderTotalCents) {
    return { status: 'cancelled', reason: 'fully_refunded' }
  }
  return { status: 'matured', reason: 'ok' }
}

export type MaturationSummary = {
  scanned:   { referralOrders: number; dishSales: number }
  matured:   number
  cancelled: number
  pending:   number
  reasons:   Record<string, number>
}

/** Batch maturation pass over every PENDING gain. IDEMPOTENT: a processed row
 *  leaves 'pending', so re-running scans only what's left; a no-change run is a
 *  no-op. Refunds are READ from the ledger (never recomputed, webhook untouched). */
export async function matureCreatorEarnings(now: Date = new Date()): Promise<MaturationSummary> {
  const summary: MaturationSummary = {
    scanned: { referralOrders: 0, dishSales: 0 },
    matured: 0, cancelled: 0, pending: 0, reasons: {},
  }
  const bump = (reason: string) => { summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1 }

  const [referralOrders, dishSales] = await Promise.all([
    prisma.referralOrder.findMany({
      where: { status: 'pending' },
      select: {
        id: true, createdAt: true,
        // Brique B (Agent 59): the affiliate referrer (operator id) for the self-referral
        // belt — null on a creator accrual (which uses referral.creator.email below).
        affiliateId: true,
        referral: { select: { creator: { select: { email: true } } } },
        order: {
          select: {
            createdAt: true, paymentStatus: true, total: true,
            stripePaymentIntentId: true, consumerId: true,
          },
        },
      },
    }),
    prisma.dishSale.findMany({
      where: { status: 'pending' },
      select: {
        id: true, createdAt: true,
        adoption: { select: { creatorDish: { select: { creator: { select: { email: true } } } } } },
        order: {
          select: {
            createdAt: true, paymentStatus: true, total: true,
            stripePaymentIntentId: true, consumerId: true,
          },
        },
      },
    }),
  ])
  summary.scanned.referralOrders = referralOrders.length
  summary.scanned.dishSales      = dishSales.length

  // Batch context: refunded cents per PaymentIntent (ledger = source of truth)
  // + buyer emails (self-referral belt — creation-time block already exists).
  const piIds = Array.from(new Set(
    [...referralOrders, ...dishSales]
      .map(r => r.order?.stripePaymentIntentId)
      .filter((x): x is string => !!x),
  ))
  const consumerIds = Array.from(new Set(
    [...referralOrders, ...dishSales]
      .map(r => r.order?.consumerId)
      .filter((x): x is string => !!x),
  ))
  const [refundLines, buyers] = await Promise.all([
    piIds.length
      ? prisma.ledgerEntry.findMany({
          where:  { type: 'refund', stripePaymentIntentId: { in: piIds } },
          select: { stripePaymentIntentId: true, grossAmount: true },
        })
      : [],
    consumerIds.length
      ? prisma.operator.findMany({
          where:  { id: { in: consumerIds } },
          select: { id: true, email: true },
        })
      : [],
  ])
  const refundedByPi = new Map<string, number>()
  for (const l of refundLines) {
    if (!l.stripePaymentIntentId) continue
    refundedByPi.set(l.stripePaymentIntentId, (refundedByPi.get(l.stripePaymentIntentId) ?? 0) + -l.grossAmount)
  }
  const buyerEmailById = new Map(buyers.map(b => [b.id, b.email.toLowerCase()]))

  type Row = {
    id: string
    createdAt: Date
    creatorEmail: string | null
    // Brique B — the affiliate referrer's OPERATOR id (null for creator/dish rows).
    // Compared directly to order.consumerId (also an operator id) → self-referral.
    affiliateOperatorId: string | null
    order: {
      createdAt: Date; paymentStatus: string | null; total: number
      stripePaymentIntentId: string | null; consumerId: string
    } | null
    kind: 'referralOrder' | 'dishSale'
  }
  const rows: Row[] = [
    ...referralOrders.map(r => ({
      id: r.id, createdAt: r.createdAt, kind: 'referralOrder' as const,
      creatorEmail: r.referral?.creator?.email?.toLowerCase() ?? null,
      affiliateOperatorId: r.affiliateId ?? null,
      order: r.order,
    })),
    ...dishSales.map(r => ({
      id: r.id, createdAt: r.createdAt, kind: 'dishSale' as const,
      creatorEmail: r.adoption?.creatorDish?.creator?.email?.toLowerCase() ?? null,
      affiliateOperatorId: null,
      order: r.order,
    })),
  ]

  for (const row of rows) {
    const buyerEmail = row.order ? buyerEmailById.get(row.order.consumerId) ?? null : null
    const verdict = evaluateEarningMaturity({
      orderCreatedAt:     row.order?.createdAt ?? row.createdAt,
      now,
      orderExists:        !!row.order,
      orderPaymentStatus: row.order?.paymentStatus ?? null,
      orderTotalCents:    row.order ? Math.round(row.order.total * 100) : 0,
      refundedCents:      row.order?.stripePaymentIntentId
        ? refundedByPi.get(row.order.stripePaymentIntentId) ?? 0
        : 0,
      // Self-referral belt: creator (email match) OR affiliate (the referrer's operator
      // id == the buyer's operator id). The creation-time guard already blocks both;
      // this is the durable belt, now generalized to the affiliate rail (Brique B).
      isSelfReferral:
        (!!row.creatorEmail && !!buyerEmail && row.creatorEmail === buyerEmail) ||
        (!!row.affiliateOperatorId && !!row.order && row.affiliateOperatorId === row.order.consumerId),
    })

    if (verdict.status === 'pending') { summary.pending++; continue }
    bump(verdict.reason)
    if (verdict.status === 'cancelled') {
      console.warn(`[earnings] ${row.kind} ${row.id} CANCELLED (${verdict.reason})`)
    }

    const data = verdict.status === 'matured'
      ? { status: 'matured', maturedAt: now }
      : { status: 'cancelled' }
    if (row.kind === 'referralOrder') {
      await prisma.referralOrder.updateMany({ where: { id: row.id, status: 'pending' }, data })
    } else {
      await prisma.dishSale.updateMany({ where: { id: row.id, status: 'pending' }, data })
    }
    if (verdict.status === 'matured') summary.matured++
    else summary.cancelled++
  }

  return summary
}
