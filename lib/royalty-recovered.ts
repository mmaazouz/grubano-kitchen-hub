// ── Phase 2 (D-H v2) — royalty ACTUALLY recovered from the franchisor ────────────
//
// FranchiseRoyalty.refundedCents is an ACCOUNTING target (also raised by the
// charge.refunded webhook for settled rows where nothing remains to net), so it must
// NEVER cap a clawback — a webhook delivered before `refunds.create` returns would
// otherwise zero a legitimate reversal and re-open the double-payment (critic #1).
// The clawback cap is the royalty NOT YET RECOVERED = royaltyCents − Σ real reversals:
//   • Refund.royaltyClawbackCents of SUCCEEDED refund rows (other than the row being
//     finalized — its own clawback is 0 until step (c) and its Stripe key dedupes);
//   • Dispute.royaltyClawbackCents of disputes whose unwind ran (splitReversed).
// Integer cents. No Stripe I/O (the live reversal list is the >24 h backstop, in the
// engine — REFUND-FINANCIAL-CONTRACT §15 A1).

import { prisma } from '@/lib/prisma'

export async function recoveredRoyaltyClawbackCents(input: {
  orderId: string
  excludeRefundRowId?: string
}): Promise<number> {
  const [refundAgg, disputeAgg] = await Promise.all([
    prisma.refund.aggregate({
      where: {
        orderId: input.orderId,
        status:  'succeeded',
        ...(input.excludeRefundRowId ? { id: { not: input.excludeRefundRowId } } : {}),
      },
      _sum: { royaltyClawbackCents: true },
    }),
    prisma.dispute.aggregate({
      where: { orderId: input.orderId, splitReversed: true },
      _sum:  { royaltyClawbackCents: true },
    }),
  ])
  return Math.max(0, (refundAgg._sum.royaltyClawbackCents ?? 0) + (disputeAgg._sum.royaltyClawbackCents ?? 0))
}

/** Cap a royalty clawback at what is still recoverable (never negative, never above the slice). */
export function capClawback(sliceCents: number, royaltyCents: number, recoveredCents: number): number {
  return Math.max(0, Math.min(Math.trunc(sliceCents), Math.trunc(royaltyCents) - Math.trunc(recoveredCents)))
}
