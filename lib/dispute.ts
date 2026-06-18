// ── P4.5-B — Chargeback / dispute money mechanics (Agent 51) ─────────────────────
//
// Driven by Stripe webhooks (charge.dispute.*). A dispute on a GRUBANO order is a
// DESTINATION charge → Stripe debits GRUBANO'S PLATFORM balance for the disputed
// amount + the dispute fee Φ (with or without on_behalf_of — confirmed Stripe docs,
// Agent 50); the resto keeps its net, the franchisor keeps its royalty. Recovery is
// MANUAL. On a LOST dispute we UNWIND the sale (policy B-i, Mohammed):
//   1. reverse_transfer the resto's NET (proportional to the disputed amount) — pulls
//      back ≤ (T−F) of what Stripe debited Grubano;
//   2. clawback the franchise royalty — reverse the settlement transfer if settled,
//      else reduce the pending obligation (FranchiseRoyalty.refundedCents);
//   3. ❌ NO refund_application_fee — the fee was already swept into Stripe's principal
//      debit; refunding it (like a P4.5-A REFUND does) would OVER-credit the resto.
//      THIS IS THE KEY DIFFERENCE vs a refund (which DOES refund_application_fee).
//   4. Grubano absorbs the dispute fee Φ (platform cost). Ledger records the loss.
// Target arithmetic (full dispute, F=commission C + held royalty Roy, net N=T−F):
//   Grubano = −Φ, resto = 0, franchisor = 0, Stripe = +Φ → sum = 0.
//
// REUSES the P4.5-A engine PRIMITIVES (computeRefundSplit for the cent-exact prorata,
// the franchisor clawback shape, recordLedgerEntry) WITHOUT touching lib/refund.ts —
// the refund path stays byte-identical (a refund ALWAYS emits refund_application_fee +
// reverse_transfer; a dispute NEVER emits refund_application_fee).
//
// IDEMPOTENCE: Dispute.stripeDisputeId @unique (upsert on every event → order-
// independent, closed-before-created safe) + splitReversed (the unwind runs once) +
// deterministic Stripe keys (dispute-reverse:<id>, dispute-claw:<id> → Stripe dedupes
// even on a concurrent double-fire). All amounts integer CENTS, server-derived.

import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { computeRefundSplit } from '@/lib/refund'
import { recordLedgerEntry } from '@/lib/ledger'
import { recomputeRoyaltyRefundedCents } from '@/lib/royalty-refunded'

/** Kill-switch — default OFF. Only the exact string 'true' enables the rail
 *  (mirrors isRefundsEnabled / isFranchiseRoyaltyEnabled). */
export function isChargebacksEnabled(): boolean {
  return process.env.CHARGEBACKS_ENABLED === 'true'
}

export type DisputeOutcome = {
  handled: string
  outcome?: 'won' | 'lost' | 'recorded'
  reversed?: boolean
  reverseTransferCents?: number
  royaltyClawbackCents?: number
  alreadyReversed?: boolean
  reason?: string
}

type RoyaltyRow = {
  id: string
  royaltyCents: number
  refundedCents: number
  status: string
  payoutId: string | null
  settlementId: string | null
  franchisorOperatorId: string
}
const ROYALTY_SELECT = {
  id: true, royaltyCents: true, refundedCents: true, status: true,
  payoutId: true, settlementId: true, franchisorOperatorId: true,
} as const

type DisputeContext = {
  chargeId: string | null
  paymentIntentId: string | null
  orderId: string | null
  restaurantId: string | null
  chargeTotalCents: number
  applicationFeeCents: number
  amountRefundedCents: number       // prior P4.5-A refunds on the charge (cumulative-awareness)
  transferId: string | null         // charge.transfer — the resto net transfer to reverse
  transferReversableCents: number   // transfer.amount − amount_reversed (hard cap)
  destinationAccountId: string | null
  channel: string | null
  currency: string
}

const idOf = (v: string | { id?: string } | null | undefined): string | null =>
  typeof v === 'string' ? v : v?.id ?? null

/** The dispute fee Φ borne by the platform (sum of fees across the dispute's balance
 *  transactions). Best-effort / audit only — not part of the golden equation. */
function disputeFeeCents(dispute: Stripe.Dispute): number {
  const bts = (dispute.balance_transactions ?? []) as Array<{ fee?: number | null }>
  return bts.reduce((s, bt) => s + (bt.fee ?? 0), 0)
}

/** Reconstruct everything needed from the live Stripe charge + the order. All amounts
 *  are SERVER-DERIVED (never a client input). Best-effort: a charge that can't be read
 *  leaves the money fields at 0 → settleDisputeLost records 'lost' without a reversal. */
async function loadDisputeContext(dispute: Stripe.Dispute): Promise<DisputeContext> {
  const chargeId = idOf(dispute.charge)
  const paymentIntentId = idOf(dispute.payment_intent)
  const ctx: DisputeContext = {
    chargeId, paymentIntentId, orderId: null, restaurantId: null,
    chargeTotalCents: 0, applicationFeeCents: 0, amountRefundedCents: 0,
    transferId: null, transferReversableCents: 0, destinationAccountId: null,
    channel: null, currency: dispute.currency || 'eur',
  }
  if (chargeId) {
    try {
      const charge = await getStripe().charges.retrieve(chargeId, { expand: ['transfer'] })
      ctx.orderId = charge.metadata?.orderId ?? null
      ctx.restaurantId = charge.metadata?.restaurantId ?? null
      ctx.channel = charge.metadata?.grubano_channel ?? null
      ctx.chargeTotalCents = charge.amount ?? 0
      ctx.applicationFeeCents = charge.application_fee_amount ?? 0
      ctx.amountRefundedCents = charge.amount_refunded ?? 0
      ctx.currency = charge.currency || ctx.currency
      ctx.destinationAccountId = idOf(charge.transfer_data?.destination as string | { id?: string } | null | undefined)
      const tr = charge.transfer
      if (tr && typeof tr === 'object') {
        ctx.transferId = tr.id
        ctx.transferReversableCents = Math.max(0, (tr.amount ?? 0) - (tr.amount_reversed ?? 0))
      } else if (typeof tr === 'string') {
        ctx.transferId = tr
        try {
          const t = await getStripe().transfers.retrieve(tr)
          ctx.transferReversableCents = Math.max(0, (t.amount ?? 0) - (t.amount_reversed ?? 0))
        } catch { /* cap stays 0 → reverse skipped, recorded for review */ }
      }
    } catch (e) {
      console.error('[dispute] charge retrieve failed', chargeId, e instanceof Error ? e.message : e)
    }
  }
  // Fallback: resolve the order/restaurant from the PaymentIntent if charge metadata was absent.
  if (!ctx.orderId && paymentIntentId) {
    const o = await prisma.order.findFirst({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true, restaurantId: true } })
    if (o) { ctx.orderId = o.id; ctx.restaurantId = ctx.restaurantId ?? o.restaurantId }
  }
  return ctx
}

/** Upsert the Dispute row idempotently on stripeDisputeId. Refreshes the CONTEXT
 *  fields on every event but NEVER clobbers the lifecycle (status / splitReversed /
 *  reversal amounts) — those are owned by resolveDisputeWon / settleDisputeLost. */
async function upsertDispute(dispute: Stripe.Dispute, ctx: DisputeContext) {
  const ctxData = {
    stripeChargeId:  ctx.chargeId,
    paymentIntentId: ctx.paymentIntentId,
    orderId:         ctx.orderId,
    restaurantId:    ctx.restaurantId,
    amountCents:     dispute.amount ?? 0,
    feeCents:        disputeFeeCents(dispute),
    currency:        ctx.currency,
    reason:          dispute.reason ?? null,
    outcome:         dispute.status ?? null,
  }
  return prisma.dispute.upsert({
    where:  { stripeDisputeId: dispute.id },
    create: { stripeDisputeId: dispute.id, status: 'open', ...ctxData },
    update: ctxData,
  })
}

/** Locate the Stripe transfer that disbursed a settled/settling royalty, to reverse a
 *  clawback against it (recorded Payout transfer first, else the live transfer_group —
 *  the same anchor the settlement uses). null = not transferred yet. Mirrors the
 *  P4.5-A primitive (replicated to keep lib/refund.ts byte-identical). */
async function locateSettlementTransfer(royalty: RoyaltyRow): Promise<string | null> {
  if (royalty.payoutId) {
    const p = await prisma.payout.findUnique({ where: { id: royalty.payoutId }, select: { stripeTransferId: true } })
    if (p?.stripeTransferId) return p.stripeTransferId
  }
  if (royalty.settlementId) {
    try {
      const list = await getStripe().transfers.list({ transfer_group: `frset_${royalty.settlementId}`, limit: 1 })
      if (list.data.length > 0) return list.data[0].id
    } catch { /* listing unavailable → not found */ }
  }
  return null
}

/** Won → no money moves (Stripe restitutes the provisional debit). Mark resolved. */
async function resolveDisputeWon(dispute: Stripe.Dispute, ctx: DisputeContext): Promise<DisputeOutcome> {
  await upsertDispute(dispute, ctx)
  // Guard !lost so a (impossible) reordered won can never undo a recorded loss.
  await prisma.dispute.updateMany({
    where: { stripeDisputeId: dispute.id, status: { not: 'lost' } },
    data:  { status: 'won', outcome: dispute.status ?? null, resolvedAt: new Date() },
  })
  return { handled: 'charge.dispute.closed', outcome: 'won' }
}

/**
 * Lost → UNWIND the sale (proportional to the disputed amount):
 *   reverse_transfer the resto NET + clawback the franchise royalty, NO
 *   refund_application_fee, ledger the loss. Idempotent (splitReversed fast-path +
 *   deterministic Stripe keys). On a Stripe failure the row stays NOT-reversed →
 *   a later redelivery resumes it (the keys prevent any double movement).
 */
async function settleDisputeLost(dispute: Stripe.Dispute, ctx: DisputeContext): Promise<DisputeOutcome> {
  const row = await upsertDispute(dispute, ctx)

  // Idempotent fast-path: the unwind already ran → just ensure 'lost'.
  if (row.splitReversed) {
    await prisma.dispute.updateMany({
      where: { stripeDisputeId: dispute.id, status: { not: 'lost' } },
      data:  { status: 'lost', outcome: dispute.status ?? null, resolvedAt: new Date() },
    })
    return { handled: 'charge.dispute.closed', outcome: 'lost', alreadyReversed: true }
  }

  const D = dispute.amount ?? 0
  const T = ctx.chargeTotalCents
  const F = ctx.applicationFeeCents

  // Can't reconstruct the sale → record 'lost' WITHOUT a reversal (manual review).
  // splitReversed stays false so a later redelivery WITH context can still unwind.
  if (!ctx.orderId || !ctx.restaurantId || T <= 0 || D <= 0) {
    console.error(`[dispute] LOST but unresolvable context for ${dispute.id} — no reversal (order=${ctx.orderId} charge=${ctx.chargeId} T=${T} D=${D})`)
    await prisma.dispute.updateMany({
      where: { stripeDisputeId: dispute.id, status: { not: 'lost' } },
      data:  { status: 'lost', outcome: dispute.status ?? null, resolvedAt: new Date() },
    })
    return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, reason: 'unresolved_context' }
  }

  const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: ctx.orderId }, select: ROYALTY_SELECT })
  const Roy = royalty?.royaltyCents ?? 0

  // Cent-exact prorata via the P4.5-A engine. We use restaurantReverseCents (the resto
  // NET to reverse) + royaltyRefundCents (the royalty slice) and DELIBERATELY IGNORE
  // applicationFeeRefundCents — NO refund_application_fee on a dispute.
  const split = computeRefundSplit({
    chargeTotalCents:     T,
    applicationFeeCents:  F,
    royaltyChargedCents:  Roy,
    alreadyRefundedCents: ctx.amountRefundedCents,
    refundAmountCents:    D,
  })

  // 1. reverse_transfer the resto NET (capped at the transfer's remaining reversible).
  let reverseTransferCents = 0
  let stripeReversalId: string | null = null
  const toReverse = Math.min(split.restaurantReverseCents, ctx.transferReversableCents)
  if (ctx.transferId && toReverse > 0) {
    try {
      const rev = await getStripe().transfers.createReversal(
        ctx.transferId,
        { amount: toReverse, metadata: { disputeId: dispute.id, orderId: ctx.orderId, kind: 'dispute_net_reversal' } },
        { idempotencyKey: `dispute-reverse:${dispute.id}` },
      )
      reverseTransferCents = toReverse
      stripeReversalId = rev.id
    } catch (err) {
      console.error(`[dispute] net reverse_transfer failed for ${dispute.id}:`, err instanceof Error ? err.message : err)
      return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, reason: 'reverse_failed' }
    }
  }

  // 2. Franchise royalty clawback — settled/settling with a live transfer → reverse it;
  //    pending → nothing to reverse (the held-back never left Grubano; refundedCents
  //    below stops the settlement from ever paying it).
  let royaltyClawbackCents = 0
  if (royalty && split.royaltyRefundCents > 0 && (royalty.status === 'settled' || royalty.status === 'settling')) {
    const transferId = await locateSettlementTransfer(royalty)
    if (transferId) {
      const amount = Math.min(split.royaltyRefundCents, royalty.royaltyCents)
      try {
        await getStripe().transfers.createReversal(
          transferId,
          { amount, metadata: { disputeId: dispute.id, orderId: ctx.orderId, kind: 'dispute_royalty_clawback' } },
          { idempotencyKey: `dispute-claw:${dispute.id}` },
        )
        royaltyClawbackCents = amount
      } catch (err) {
        console.error(`[dispute] royalty clawback failed for ${dispute.id}:`, err instanceof Error ? err.message : err)
        // Net reverse already idempotent on retry → leave NOT-reversed so a redelivery completes it.
        return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, reason: 'clawback_failed' }
      }
    } else {
      console.warn(`[dispute] royalty for order ${ctx.orderId} is '${royalty.status}' with no locatable settlement transfer — clawback deferred (refundedCents still reduces what settlement pays)`)
    }
  }

  // 3. Refund-aware settlement: bump FranchiseRoyalty.refundedCents to the CROSS-RAIL
  //    cumulative (refunds + lost disputes), capped at royaltyCents, never decreasing →
  //    the settlement never pays a royalty lost to a chargeback, and a later REFUND can
  //    never erase this dispute's clawback (and vice-versa). This dispute is not yet
  //    splitReversed (set at step 5), so its slice is passed as inFlightCents.
  if (royalty) {
    const cum = await recomputeRoyaltyRefundedCents({
      orderId:               ctx.orderId,
      royaltyCents:          royalty.royaltyCents,
      existingRefundedCents: royalty.refundedCents,
      inFlightCents:         split.royaltyRefundCents,
    })
    await prisma.franchiseRoyalty.update({ where: { orderId: ctx.orderId }, data: { refundedCents: cum } })
  }

  // 4. Ledger — a NEGATIVE 'adjustment' line unwinding the disputed portion of the sale.
  //    Golden equation holds: gross(−D) = fee(−feeSlice) + net(−netSlice), since
  //    feeSlice + netSlice = D. Type 'adjustment' (NOT 'refund') so the ledger-check
  //    probe's refund↔Stripe-refunds reconciliation is untouched (a dispute is not a
  //    Stripe refund). Φ recorded in stripeFeeAmount (audit; not in the equation).
  //    Idempotent: @@unique([sourceEventId, type]) = (dispute.id, 'adjustment').
  try {
    await recordLedgerEntry({
      type:                  'adjustment',
      restaurantId:          ctx.restaurantId,
      stripePaymentIntentId: ctx.paymentIntentId,
      stripeChargeId:        ctx.chargeId,
      stripeTransferId:      stripeReversalId,
      grossAmount:           -D,
      applicationFeeAmount:  -split.applicationFeeRefundCents,
      stripeFeeAmount:       row.feeCents || disputeFeeCents(dispute) || null,
      netToRestaurant:       -split.restaurantReverseCents,
      routed:                !!ctx.transferId,
      destinationAccountId:  ctx.destinationAccountId,
      currency:              ctx.currency,
      channel:               ctx.channel,
      sourceEventId:         dispute.id,
    })
  } catch (e) {
    console.error('[dispute] [LEDGER MISS] dispute adjustment line write failed:', dispute.id, e instanceof Error ? e.message : e)
  }

  // 5. Mark reversed + lost (idempotent on splitReversed:false).
  await prisma.dispute.updateMany({
    where: { stripeDisputeId: dispute.id, splitReversed: false },
    data:  {
      splitReversed:        true,
      status:               'lost',
      outcome:              dispute.status ?? null,
      reverseTransferCents,
      royaltyClawbackCents,
      royaltyRefundedCents: split.royaltyRefundCents,
      stripeReversalId,
      resolvedAt:           new Date(),
    },
  })

  return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: true, reverseTransferCents, royaltyClawbackCents }
}

/**
 * Webhook router for charge.dispute.* — called ONLY when CHARGEBACKS_ENABLED is ON
 * (the webhook gates it). created/updated → record; funds_withdrawn/reinstated →
 * record + flag; closed → won (resolve) / lost (unwind). Safe to call repeatedly /
 * out-of-order (upsert + splitReversed + Stripe keys).
 */
export async function handleDisputeEvent(event: Stripe.Event): Promise<DisputeOutcome> {
  const dispute = event.data.object as Stripe.Dispute
  const ctx = await loadDisputeContext(dispute)

  switch (event.type) {
    case 'charge.dispute.funds_withdrawn':
      await upsertDispute(dispute, ctx)
      await prisma.dispute.update({ where: { stripeDisputeId: dispute.id }, data: { fundsWithdrawn: true } })
      return { handled: event.type, outcome: 'recorded' }
    case 'charge.dispute.funds_reinstated':
      await upsertDispute(dispute, ctx)
      await prisma.dispute.update({ where: { stripeDisputeId: dispute.id }, data: { fundsWithdrawn: false } })
      return { handled: event.type, outcome: 'recorded' }
    case 'charge.dispute.closed':
      if (dispute.status === 'lost') return settleDisputeLost(dispute, ctx)
      if (dispute.status === 'won')  return resolveDisputeWon(dispute, ctx)
      await upsertDispute(dispute, ctx) // e.g. warning_closed — record only
      return { handled: event.type, outcome: 'recorded' }
    default: // charge.dispute.created / .updated / anything else → record only
      await upsertDispute(dispute, ctx)
      return { handled: event.type, outcome: 'recorded' }
  }
}
