// lib/loyalty-refund-apply.ts — PHASE 1 loyalty↔refund reconciliation, DB layer.
//
// Persists the pure plan from lib/loyalty-refund.ts against the loyalty ledger,
// idempotently and atomically. Called by the Stripe charge.refunded webhook — the
// SINGLE reconciliation point, so a refund is reconciled the same way whether it
// was initiated by the Grubano admin rail OR externally on the Stripe Dashboard
// (Stripe is the financial source of truth; REFUNDS_ENABLED gates who may INITIATE
// a refund, it must NOT suppress reconciling an established one).
//
// IDEMPOTENCY: every movement carries sourceEventId = the immutable Stripe Refund
// id (re_…). @@unique([sourceEventId, type]) means a replayed webhook re-creating
// the same (re_…, type) row throws P2002 inside the interactive transaction, which
// rolls the whole effect back → no double credit/debit. DISTINCT partial refunds
// (distinct re_…) each apply exactly once. This replaces the pre-Phase-1 check-then-
// act findFirst guard, which lost the race under concurrent webhook delivery.
//
// FUNDING: this module moves POINTS only. It never issues cash. The cash a refund
// returns is Stripe's own charge.amount − amount_refunded (structurally ≤ the cash
// captured); the loyalty-funded value was never charged, so it is never refunded as
// cash. Points prorate on the SAME charge.amount, so points and cash unwind together.

import type { PrismaClient, Prisma } from '@prisma/client'
import {
  planLoyaltyRefund,
  applyReversalWithOffset,
  type RefundEvent,
} from '@/lib/loyalty-refund'

/** Minimal prisma surface used here — lets tests inject a mock. */
type Db = Pick<PrismaClient, 'order' | 'operator' | 'loyaltyCustomer' | 'loyaltyTransaction' | '$transaction'>

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002'
}

export interface ReconcileInput {
  orderId: string
  chargeAmountCents: number // charge.amount = cash captured
  refunds: RefundEvent[]    // all succeeded refunds on the charge (re_… id + amount + created)
}

export interface ReconcileResult {
  applied: number     // effects newly applied (reversal or restore rows created)
  skipped: number     // effects already present (idempotent replay)
  earnReversed: number
  spentRestored: number
  offsetAdded: number
}

/** Reconcile the loyalty ledger to the cumulative refund state for one order.
 *  Best-effort by contract of its caller: throws are surfaced to the caller which
 *  logs and still returns 200 (a loyalty hiccup never fails the webhook / the money
 *  path). Returns a summary for observability/tests. */
export async function reconcileLoyaltyOnRefund(db: Db, input: ReconcileInput): Promise<ReconcileResult> {
  const res: ReconcileResult = { applied: 0, skipped: 0, earnReversed: 0, spentRestored: 0, offsetAdded: 0 }

  const order = await db.order.findUnique({
    where:  { id: input.orderId },
    select: { pointsRedeemed: true, pointsEarned: true, consumerId: true },
  })
  if (!order) return res

  // The loyalty account, resolved by the consumer's email (the loyalty key).
  const operator = order.consumerId
    ? await db.operator.findUnique({ where: { id: order.consumerId }, select: { email: true } })
    : null
  const lc = operator?.email
    ? await db.loyaltyCustomer.findUnique({ where: { email: operator.email }, select: { id: true } })
    : null
  if (!lc) return res // no loyalty account → nothing to reconcile (mirrors redeem)

  // D1 precondition: only claw back points that were actually CREDITED. Points are
  // credited at 'delivered' as one 'earn' row of order.pointsEarned; if that row is
  // absent (refund before delivery), earnedCredited = 0 → no phantom clawback.
  const earnTx = await db.loyaltyTransaction.findFirst({
    where: { orderId: input.orderId, type: 'earn' }, select: { id: true },
  })
  const earnedCredited = earnTx ? Math.max(0, Math.floor(order.pointsEarned)) : 0

  const plan = planLoyaltyRefund({
    refunds:          input.refunds,
    chargeAmountCents: input.chargeAmountCents,
    earnedCredited,
    pointsRedeemed:    Math.max(0, Math.floor(order.pointsRedeemed)),
  })

  for (const effect of plan) {
    // ── D1 — earned-point clawback, keyed by the refund re_… (earn_reversal) ────
    if (effect.earnReversal > 0) {
      try {
        await db.$transaction(async (tx) => {
          // Create the keyed row FIRST: a replay (same sourceEventId+type) throws
          // P2002 here and aborts the whole effect before any balance change.
          await tx.loyaltyTransaction.create({
            data: {
              customerId: lc.id, orderId: input.orderId, type: 'earn_reversal',
              points: -effect.earnReversal, sourceEventId: effect.sourceEventId,
            },
          })
          // D3 — read the balance UNDER the transaction, floor it at 0, spill the
          // unrecovered remainder into the recovery offset. Atomic with the row.
          const cust = await tx.loyaltyCustomer.findUnique({
            where: { id: lc.id }, select: { pointsBalance: true },
          })
          const { balanceDecrement, offsetIncrease } = applyReversalWithOffset(
            effect.earnReversal, cust?.pointsBalance ?? 0,
          )
          await tx.loyaltyCustomer.update({
            where: { id: lc.id },
            data:  { pointsBalance: { decrement: balanceDecrement }, recoveryOffsetPoints: { increment: offsetIncrease } },
          })
          res.earnReversed += effect.earnReversal
          res.offsetAdded += offsetIncrease
          res.applied++
        })
      } catch (e) {
        if (isUniqueViolation(e)) res.skipped++
        else throw e
      }
    }

    // ── D2 — spent-point restoration, PRORATED, keyed by the refund re_… (refund)
    if (effect.spentRestore > 0) {
      try {
        await db.$transaction(async (tx) => {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: lc.id, orderId: input.orderId, type: 'refund',
              points: effect.spentRestore, sourceEventId: effect.sourceEventId,
            },
          })
          // Restoring spent points credits the visible balance directly. It does NOT
          // repay the recovery offset — per the founder rule, only future EARNINGS do.
          await tx.loyaltyCustomer.update({
            where: { id: lc.id }, data: { pointsBalance: { increment: effect.spentRestore } },
          })
          res.spentRestored += effect.spentRestore
          res.applied++
        })
      } catch (e) {
        if (isUniqueViolation(e)) res.skipped++
        else throw e
      }
    }
  }

  return res
}

// Keep the Prisma namespace import meaningful for consumers/tests without a hard dep.
export type { Prisma }
