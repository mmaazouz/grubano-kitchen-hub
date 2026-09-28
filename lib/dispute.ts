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
// T-90: the declaration every financial Stripe write in this file must make. LEAF module, no cycle.
import { assertMoneyWriteAllowed, escalateIfPolicyRefusal, isMoneyPolicyRefusal } from '@/lib/stripe-money-guard'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
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
  /**
   * T-106 — TRUE when money moved (or may have moved) at Stripe and our internal state is NOT finalized:
   * no coherent ledger line, `splitReversed` still false. The webhook MUST answer 5xx on this so Stripe
   * redelivers; answering 200 would tell Stripe everything is settled while our books say nothing happened,
   * and Stripe would never ask again. The founder's rule: « aucun 200 trompeur ».
   */
  retryable?: boolean
  /** T-107: the rail was CLOSED and the event was recorded only — no Stripe write was attempted. */
  recordedOnly?: boolean
}

/** T-106 — a reversal list that cannot PROVE absence. A truncated list is ambiguous, so it fails closed. */
class DisputeReversalListUnavailable extends Error {
  constructor(which: string) { super(`dispute reversal list unavailable: ${which}`); this.name = 'DisputeReversalListUnavailable' }
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

/* ── T-106 — PERSIST WHAT MOVED, THE INSTANT IT MOVES ──────────────────────────────────────────────
   The old code held `stripeReversalId` and `reverseTransferCents` in LOCAL VARIABLES until step 5, so any
   failure between the Stripe movement and step 5 discarded them: money had left and the row said nothing.
   This writes only the movement fields, and only while the unwind is still unfinished
   (`splitReversed: false`), so it can never overwrite a completed unwind. It is intentionally OUTSIDE any
   transaction: a rollback here would erase the record of money that has already left Stripe. */
async function persistDisputeMovement(
  stripeDisputeId: string,
  data: { stripeReversalId?: string | null; reverseTransferCents?: number; royaltyClawbackCents?: number },
): Promise<void> {
  try {
    await prisma.dispute.updateMany({ where: { stripeDisputeId, splitReversed: false }, data })
  } catch (e) {
    // The adoption read at the top of each step is the backstop, so this is not fatal — but it is never
    // silent: a movement Stripe made that our row does not hold is exactly what a human must be told.
    console.error(`[MONEY REVIEW] [dispute_movement_unpersisted] ${stripeDisputeId} ${JSON.stringify(data)} —`, e instanceof Error ? e.message : e)
  }
}

/* ── T-106 — AN UNFINALIZED DISPUTE IS NEVER SILENT ───────────────────────────────────────────────
   Every path that returns `retryable: true` passes through here first. Stripe will redeliver, so the
   situation is usually self-healing — but « usually » is not a property, and a chargeback whose books are
   incomplete is precisely the state a human needs to know about before the settlement pays a royalty that
   was charged back. The alert is idempotent per dispute + reason (lib/admin-alerts sendOnce), so a retry
   storm produces one mail, not a hundred. */
async function alertDisputeUnfinalized(
  dispute: Stripe.Dispute,
  ctx: DisputeContext,
  reason: string,
  facts: Record<string, number | string | null | undefined>,
): Promise<void> {
  try {
    await sendAdminMoneyReviewAlert({
      kind:      'dispute_unfinalized',
      dedupeKey: `dispute_unfinalized:${dispute.id}:${reason}`,
      title:     'Chargeback PERDU dont l’état interne n’est pas finalisé — Stripe va redélivrer',
      facts: {
        stripeDisputeId: dispute.id,
        reason,
        orderId:         ctx.orderId ?? null,
        restaurantId:    ctx.restaurantId ?? null,
        disputedCents:   dispute.amount ?? 0,
        ...facts,
        action: 'AUCUNE action Stripe : la redélivrance adopte ce qui existe déjà et termine les écritures internes. Vérifier qu’une ligne de ledger « adjustment » finit par exister pour ce dispute.',
      },
    })
  } catch { /* the console.error on each path is the primary channel */ }
}

/* ── T-107 — RECORD AN EXTERNAL REALITY, EVEN WITH THE RAIL CLOSED ────────────────────────────────
   FOUNDER ARBITRATION (2026-09-28): « un chargeback provenant de Stripe doit être tracé même si les flags
   produit sont fermés. Même principe que pour un webhook de remboursement déjà succeeded : les flags doivent
   empêcher d'INITIER une opération financière, pas empêcher d'enregistrer une réalité externe qui a déjà eu
   lieu. Cette trace doit être idempotente, auditable et ne doit elle-même déclencher aucune nouvelle sortie
   d'argent non autorisée. »

   Before this, `CHARGEBACKS_ENABLED=false` meant the webhook answered `{gated:true}` and did NOTHING: no
   Dispute row, no alert. Stripe had already pulled the funds from the platform balance, the restaurant was
   still invoiced for the order, and nothing in our books knew. The flag was protecting the UNWIND — which is
   correct — but it was also erasing the FACT, which is not.

   THREE PROPERTIES, each asserted by a test:
     1. NO STRIPE CALL AT ALL. Not even a read. Everything written comes from the event object Stripe already
        signed, plus our own database. That is what makes it impossible for this path to move money.
     2. IDEMPOTENT. One row per `stripeDisputeId` (@unique), upserted; one alert per dispute + state.
     3. IT NEVER CLAIMS THE UNWIND HAPPENED. `splitReversed` is left FALSE, and no reversal/clawback amount
        is written — so the day the rail is authorized, a redelivery (or a manual replay) still performs the
        unwind exactly once, adopting nothing because nothing was done. */
export async function recordDisputeObservation(event: Stripe.Event): Promise<DisputeOutcome> {
  const dispute = event.data.object as Stripe.Dispute
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge as { id?: string } | null)?.id ?? null
  const piId = typeof dispute.payment_intent === 'string'
    ? dispute.payment_intent
    : (dispute.payment_intent as { id?: string } | null)?.id ?? null

  // Our OWN database, never Stripe: the order (and its restaurant) behind this payment, when we know it.
  let orderId: string | null = null
  let restaurantId: string | null = null
  if (piId) {
    try {
      const order = await prisma.order.findFirst({ where: { stripePaymentIntentId: piId }, select: { id: true, restaurantId: true } })
      if (order) { orderId = order.id; restaurantId = order.restaurantId }
    } catch (e) {
      console.error(`[dispute] [RECORD ONLY] order lookup failed for ${dispute.id}:`, e instanceof Error ? e.message : e)
    }
  }

  const lost = dispute.status === 'lost'
  const won = dispute.status === 'won'
  /* FOUND BY THE FINAL REVIEW, IN THIS LOT'S OWN CODE — A RECORD MUST NEVER ERASE A BETTER ONE.
     The first version put `orderId` and `restaurantId` in `data` unconditionally, so an UPDATE with the rail
     closed wrote NULL over values a previous authorized run had resolved (that run reads the charge from
     Stripe and gets them from its metadata; this path only knows what our own DB can join on the
     PaymentIntent). `Dispute.orderId` is the join key the royalty aggregates use, so nulling it would have
     un-linked a chargeback from its order — a record that destroys information is worse than no record.
     They are now written ONLY when this path actually resolved them. A field we do not know is a field we
     leave alone. */
  const resolved: { orderId?: string; restaurantId?: string } = {}
  if (orderId) resolved.orderId = orderId
  if (restaurantId) resolved.restaurantId = restaurantId
  const data = {
    stripeChargeId:  chargeId,
    paymentIntentId: piId,
    amountCents:     dispute.amount ?? 0,
    feeCents:        disputeFeeCents(dispute),
    currency:        (dispute.currency ?? 'eur').toLowerCase(),
    reason:          dispute.reason ?? null,
    outcome:         dispute.status ?? null,
    // `fundsWithdrawn` is Stripe's own statement that it has already pulled the money. Recording it is the
    // whole point: it is the fact the closed flag was erasing.
    ...(event.type === 'charge.dispute.funds_withdrawn' ? { fundsWithdrawn: true } : {}),
    ...(event.type === 'charge.dispute.funds_reinstated' ? { fundsWithdrawn: false } : {}),
  }
  try {
    await prisma.dispute.upsert({
      where:  { stripeDisputeId: dispute.id },
      // `status` is the LIFECYCLE, and it is honest: a closed-lost dispute is 'lost' even though we did not
      // unwind it. `splitReversed` stays false — that is the field that says whether WE acted.
      // On CREATE the resolved ids are written when known (null otherwise, which is the row's default).
      create: { stripeDisputeId: dispute.id, status: lost ? 'lost' : won ? 'won' : 'open', ...data, ...resolved },
      // On UPDATE they are written ONLY when this path resolved them, so a null never overwrites a value a
      // previous authorized run had established.
      update: { ...data, ...resolved, ...(lost ? { status: 'lost' } : won ? { status: 'won' } : {}) },
    })
  } catch (e) {
    console.error(`[MONEY REVIEW] [dispute_record_failed] ${dispute.id} —`, e instanceof Error ? e.message : e)
    // Retryable: Stripe redelivers, and the fact is worth more than a tidy 200.
    return { handled: event.type, outcome: 'recorded', recordedOnly: true, retryable: true, reason: 'record_failed' }
  }

  // A LOST dispute with the rail closed is the case that costs money and that nobody would otherwise see:
  // Stripe has debited the platform, the restaurant keeps its net, and no unwind will run until the founder
  // opens the rail. One alert, idempotent per dispute.
  if (lost) {
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'dispute_recorded_rail_closed',
        dedupeKey: `dispute_recorded_rail_closed:${dispute.id}`,
        title:     'Chargeback PERDU enregistré alors que CHARGEBACKS_ENABLED est fermé — aucun déroulé exécuté',
        facts: {
          stripeDisputeId: dispute.id,
          orderId,
          restaurantId,
          disputedCents:   dispute.amount ?? 0,
          disputeFeeCents: disputeFeeCents(dispute),
          reason:          dispute.reason ?? null,
          action: 'Stripe a déjà débité la plateforme. AUCUN déroulé n’a été exécuté (pas de reverse_transfer, pas de reprise de royalty, pas de ligne de ledger) et splitReversed reste false : le jour où le rail est autorisé, une redélivrance ou un rejeu exécutera le déroulé exactement une fois.',
        },
      })
    } catch { /* the row is the durable record; a failed mail must not lose it */ }
  }
  return { handled: event.type, outcome: 'recorded', recordedOnly: true, reversed: false }
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

  /* 1. reverse_transfer the resto NET (capped at the transfer's remaining reversible).
     T-106 — ADOPT OR CREATE, NEVER CREATE AND HOPE. Two defects lived here.
     (a) PARTIAL-FAILURE AMNESIA: the reversal succeeded, the clawback below then failed, the function
         RETURNED, and the webhook answered 200 — so Stripe never redelivered. `stripeReversalId` and
         `reverseTransferCents` were local variables, discarded; steps 3, 4 and 5 were skipped. Money had
         left the restaurant with NO ledger line, no royalty write-down and `splitReversed` still false.
         Both royalty aggregates filter on `splitReversed: true`, so the chargeback was invisible to them and
         the settlement could still pay a royalty that had been charged back.
     (b) DOUBLE REVERSAL PAST ~24 h: the only protection was the Stripe idempotency key
         `dispute-reverse:<disputeId>`, and Stripe prunes those after about a day. A redelivery later found
         `splitReversed` still false, recomputed `toReverse`, and debited the restaurant a SECOND time.
     The fix is the discipline lib/refund.ts already uses (F8): what MOVED is persisted the instant it moves,
     and before creating anything we ask whether it already exists — first our own row, then Stripe's
     reversal list, matched on the metadata we wrote. A list that cannot prove absence fails CLOSED. */
  let reverseTransferCents = row.reverseTransferCents || 0
  let stripeReversalId: string | null = row.stripeReversalId ?? null
  const toReverse = Math.min(split.restaurantReverseCents, ctx.transferReversableCents)
  if (ctx.transferId && toReverse > 0 && !stripeReversalId) {
    // (i) Does Stripe already hold this reversal? Our row said nothing, which is not proof.
    let adopted: Stripe.TransferReversal | null = null
    try {
      const list = await getStripe().transfers.listReversals(ctx.transferId, { limit: 100 })
      if (list.has_more) throw new DisputeReversalListUnavailable('net_truncated')
      adopted = list.data.find((rv) => rv.metadata?.disputeId === dispute.id && rv.metadata?.kind === 'dispute_net_reversal') ?? null
    } catch (err) {
      console.error(`[dispute] cannot prove whether the net reversal exists for ${dispute.id}:`, err instanceof Error ? err.message : err)
      await alertDisputeUnfinalized(dispute, ctx, 'net_reversal_unprovable', { toReverse })
      // FAIL CLOSED and RETRYABLE: we may not create a reversal we cannot prove absent.
      return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, retryable: true, reason: 'net_reversal_unprovable' }
    }
    if (adopted) {
      console.warn(`[dispute] net reversal ${adopted.id} already exists for ${dispute.id} — ADOPTED, no second movement`)
      reverseTransferCents = adopted.amount
      stripeReversalId = adopted.id
      await persistDisputeMovement(dispute.id, { stripeReversalId, reverseTransferCents })
    } else try {
      /* T-90 — DECLARE BEFORE YOU MOVE MONEY. This debits the RESTAURANT's connected account. The only
         gate is CHARGEBACKS_ENABLED, read in ONE place (app/api/webhooks/stripe/route.ts) from a PUBLIC
         signed webhook, and this module's own header asserted the invariant it did not enforce: « called
         ONLY when CHARGEBACKS_ENABLED is ON ». Now the write says so itself, and refuses if the flag is
         not literally 'true'. */
      assertMoneyWriteAllowed({
        verb: 'transfers.createReversal',
        authorization: 'dispute_rail_open',
        railOpen: isChargebacksEnabled(),
        why: 'lost dispute: reversing the restaurant NET share Grubano was debited for',
        orderId: ctx.orderId,
        amountCents: toReverse,
      })
      const rev = await getStripe().transfers.createReversal(
        ctx.transferId,
        { amount: toReverse, metadata: { disputeId: dispute.id, orderId: ctx.orderId, kind: 'dispute_net_reversal' } },
        { idempotencyKey: `dispute-reverse:${dispute.id}` },
      )
      reverseTransferCents = toReverse
      stripeReversalId = rev.id
      /* T-106 — PERSIST THE MOVEMENT BEFORE ANYTHING ELSE CAN FAIL. This single write is what turns the old
         amnesia into a resumable state: a redelivery now reads `stripeReversalId` from the row, adopts it,
         and moves nothing. It is deliberately NOT inside a transaction with the steps below — a transaction
         would roll back the record of money that has ALREADY left Stripe, which is the one thing that must
         never be undone. If this write itself fails, the reversal-list adoption above is the backstop. */
      await persistDisputeMovement(dispute.id, { stripeReversalId, reverseTransferCents })
    } catch (err) {
      console.error(`[dispute] net reverse_transfer failed for ${dispute.id}:`, err instanceof Error ? err.message : err)
      // T-104: a guard refusal is a code defect, not a provider outage — escalate and re-throw it.
      await escalateIfPolicyRefusal(err, { verb: 'transfers.createReversal', where: 'lib/dispute.settleDisputeLost:net', orderId: ctx.orderId, amountCents: toReverse }, sendAdminMoneyReviewAlert)
      if (isMoneyPolicyRefusal(err)) throw err
      // T-106: nothing moved (or we cannot tell) and nothing is finalized → RETRYABLE, never a 200.
      await alertDisputeUnfinalized(dispute, ctx, 'reverse_failed', { toReverse })
      return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, retryable: true, reason: 'reverse_failed' }
    }
  }

  // 2. Franchise royalty clawback — settled/settling with a live transfer → reverse it;
  //    pending → nothing to reverse (the held-back never left Grubano; refundedCents
  //    below stops the settlement from ever paying it).
  let royaltyClawbackCents = row.royaltyClawbackCents || 0
  if (royalty && split.royaltyRefundCents > 0 && !royaltyClawbackCents && (royalty.status === 'settled' || royalty.status === 'settling')) {
    const transferId = await locateSettlementTransfer(royalty)
    if (transferId) {
      const amount = Math.min(split.royaltyRefundCents, royalty.royaltyCents)
      // T-106 — same adopt-or-create discipline as the net reversal above: a redelivery past the Stripe
      // idempotency window must never debit the FRANCHISOR a second time.
      let adoptedClaw: Stripe.TransferReversal | null = null
      try {
        const list = await getStripe().transfers.listReversals(transferId, { limit: 100 })
        if (list.has_more) throw new DisputeReversalListUnavailable('clawback_truncated')
        adoptedClaw = list.data.find((rv) => rv.metadata?.disputeId === dispute.id && rv.metadata?.kind === 'dispute_royalty_clawback') ?? null
      } catch (err) {
        console.error(`[dispute] cannot prove whether the royalty clawback exists for ${dispute.id}:`, err instanceof Error ? err.message : err)
        await alertDisputeUnfinalized(dispute, ctx, 'clawback_unprovable', { amount, reverseTransferCents })
        return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, retryable: true, reason: 'clawback_unprovable' }
      }
      if (adoptedClaw) {
        console.warn(`[dispute] royalty clawback ${adoptedClaw.id} already exists for ${dispute.id} — ADOPTED, no second movement`)
        royaltyClawbackCents = adoptedClaw.amount
        await persistDisputeMovement(dispute.id, { royaltyClawbackCents })
      } else try {
        // T-90 — DECLARE BEFORE YOU MOVE MONEY. This debits the FRANCHISOR's connected account, behind the
        // same single flag as the reversal above.
        assertMoneyWriteAllowed({
          verb: 'transfers.createReversal',
          authorization: 'dispute_rail_open',
          railOpen: isChargebacksEnabled(),
          why: 'lost dispute: clawing back the franchise royalty already settled on this order',
          orderId: ctx.orderId,
          amountCents: amount,
        })
        await getStripe().transfers.createReversal(
          transferId,
          { amount, metadata: { disputeId: dispute.id, orderId: ctx.orderId, kind: 'dispute_royalty_clawback' } },
          { idempotencyKey: `dispute-claw:${dispute.id}` },
        )
        royaltyClawbackCents = amount
        // T-106: persisted the instant it moves, exactly like the net reversal.
        await persistDisputeMovement(dispute.id, { royaltyClawbackCents })
      } catch (err) {
        console.error(`[dispute] royalty clawback failed for ${dispute.id}:`, err instanceof Error ? err.message : err)
        // T-104: a refusal is escalated and re-thrown, never degraded into « retry me ».
        await escalateIfPolicyRefusal(err, { verb: 'transfers.createReversal', where: 'lib/dispute.settleDisputeLost:clawback', orderId: ctx.orderId, amountCents: amount }, sendAdminMoneyReviewAlert)
        if (isMoneyPolicyRefusal(err)) throw err
        /* T-106 — THE ORIGINAL DEFECT WAS HERE. The net reversal had ALREADY moved the restaurant's money;
           this return skipped steps 3, 4 and 5, and the webhook answered 200 so Stripe never came back. The
           movement is now on the row (persisted above), the state is declared NOT finalized, and the answer
           is RETRYABLE: the redelivery adopts what exists and completes the rest. */
        await alertDisputeUnfinalized(dispute, ctx, 'clawback_failed', { amount, reverseTransferCents })
        return { handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, retryable: true, reason: 'clawback_failed', reverseTransferCents }
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
    /* T-106 — FOUNDER RULE: « un dispute ayant réellement déplacé de l'argent laisse TOUJOURS une trace
       ledger cohérente AVANT qu'on considère l'événement comme correctement traité. » So a failed ledger
       write is no longer a logged shrug: `splitReversed` is NOT set, the answer is RETRYABLE, and Stripe
       comes back. The retry adopts the existing reversals (moving nothing) and re-attempts the line, which
       is idempotent on @@unique([sourceEventId, type]). A PARTIAL line is never written — an incoherent
       ledger is worse than a missing one, because the missing one is still visible as missing. */
    await alertDisputeUnfinalized(dispute, ctx, 'ledger_write_failed', { reverseTransferCents, royaltyClawbackCents })
    return {
      handled: 'charge.dispute.closed', outcome: 'lost', reversed: false, retryable: true,
      reason: 'ledger_write_failed', reverseTransferCents, royaltyClawbackCents,
    }
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
