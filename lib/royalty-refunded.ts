// ── Cross-rail franchise-royalty give-back accounting (Agent 51, P4.5-B) ─────────
//
// FranchiseRoyalty.refundedCents must reflect the royalty given back to the customer
// across BOTH money rails — P4.5-A REFUNDS (lib/refund) and P4.5-B CHARGEBACKS
// (lib/dispute) — so the franchise settlement (which pays royaltyCents − refundedCents)
// NEVER disburses a royalty that was refunded OR lost to a chargeback.
//
// Both rails write the SAME field; a refund records a Refund row (royaltyRefundCents),
// a lost dispute records a Dispute row (royaltyRefundedCents) and does NOT touch a
// Refund row. A naïve per-rail aggregate therefore erases the OTHER rail's bump. This
// single source computes the cross-rail total so neither rail can clobber the other:
//   refundedCents = min(royaltyCents, max(existing, Σ refund slices + Σ dispute slices + inFlight))
// — monotone (never decreases) and order-independent. Integer CENTS.

import { prisma } from '@/lib/prisma'

/**
 * The cumulative royalty (cents) given back for an order across refunds + lost disputes,
 * clamped to [existingRefundedCents, royaltyCents]. `inFlightCents` is the slice of a
 * reversal that is being settled in THIS call but whose row is not yet committed/flagged
 * (e.g. a dispute's slice before splitReversed is set) — pass 0 from the refund rail
 * (its Refund row is already 'succeeded' and counted by the aggregate).
 */
export async function recomputeRoyaltyRefundedCents(input: {
  orderId: string
  royaltyCents: number
  existingRefundedCents: number
  inFlightCents?: number
}): Promise<number> {
  const [refundAgg, disputeAgg] = await Promise.all([
    prisma.refund.aggregate({
      where: { orderId: input.orderId, status: 'succeeded' },
      _sum:  { royaltyRefundCents: true },
    }),
    prisma.dispute.aggregate({
      where: { orderId: input.orderId, splitReversed: true },
      _sum:  { royaltyRefundedCents: true },
    }),
  ])
  const total =
    (refundAgg._sum.royaltyRefundCents ?? 0) +
    (disputeAgg._sum.royaltyRefundedCents ?? 0) +
    (input.inFlightCents ?? 0)
  // Cap at the accrued royalty; never below what was already recorded (monotone).
  return Math.min(input.royaltyCents, Math.max(input.existingRefundedCents, total))
}
