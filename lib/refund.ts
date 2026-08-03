// ── P4.5-A — Refund money mechanics (the sensitive part) — Agent 49 ──────────────
//
// ⚠️ TWO REFUND LIBS EXIST — DO NOT MERGE THEM (see the C-2 gate report, 2026-07-03).
// THIS FILE, lib/refund.ts (SINGULAR) = the royalty-aware refund ENGINE: GATED by
// REFUNDS_ENABLED (default OFF), keyed by orderId, does the prorata split + franchise
// royalty clawback + eager ledger + Refund DB row. Callers: /api/admin/refunds/run,
// the ghost-order webhook branch, lib/claims, lib/dispute (all gated OFF today).
// The OTHER file, lib/refunds.ts (PLURAL), is the SIMPLE owner-initiated path: UNGATED,
// LIVE, keyed by paymentIntentId (orders/tickets/deposits). Do NOT route the owner
// refund routes through executeRefund — audited & REJECTED (tickets have no Order row;
// it would take the live path dark; 10 behavioural divergences). Unification = a
// post-go-live DESIGN project (P3), never an in-place refactor. Keep them separate.
//
// Executes a TOTAL or PARTIAL refund of a paid order AT PRORATA: each party gives
// back the SAME fraction f = refundAmount / chargeTotal of ITS share —
//   • the restaurant returns f of its net          (Stripe reverse_transfer);
//   • Grubano returns f of its commission           (Stripe refund_application_fee);
//   • the franchise royalty is reduced by f          (refundedCents) — or, if the
//     royalty was ALREADY settled to the franchisor, that slice is CLAWED BACK
//     (Stripe transfers.createReversal on the settlement transfer).
// Cents are EXACT (restaurantReverse + applicationFeeRefund = refundAmount to the
// cent; the royalty slice nests inside the fee refund) and CUMULATIVE across
// multiple partial refunds (never more than the order total).
//
// THIS IS A NEW PATH (lib + endpoint) that REVERSES after the fact. It does NOT
// touch the encaissement: the charge creation, application_fee, on_behalf_of,
// lib/commission and the franchise accrual (computeFranchiseRoyalty) are all
// byte-identical. Gated by REFUNDS_ENABLED (default OFF) at the endpoint → no refund
// path is active and everything is byte-identical when OFF.
//
// ANTI-DOUBLE-REFUND (the payout/settlement pattern):
//   • Refund.idempotencyKey @unique = `refund:<orderId>:<alreadyRefunded>` — the
//     MONOTONE cumul cursor (alreadyRefunded read live from Stripe = the true
//     cross-path total). Two concurrent attempts at the same cumul derive the SAME
//     key → one create wins (P2002), the cumul can never be double-spent.
//   • The SAME key is the Stripe refund idempotency key → a retry within ~24h
//     returns the SAME refund (no second money movement).
//   • RESUME-FIRST: a 'pending' Refund row (Stripe refund issued but DB finalize
//     failed) is re-driven BEFORE any new refund — re-using the recorded refund id,
//     else adopting a refund tagged with the row id (the >24h backstop), else
//     re-creating under the dedupe key.
//   • The cumul ceiling is enforced against the LIVE Stripe refundable amount, so a
//     refund can never exceed what is actually still refundable on the charge.
//
// All split amounts are DERIVED SERVER-SIDE from the live Stripe charge + the order
// (chargeTotal, application_fee, the held-back royalty) — NEVER a client input.

import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { recordRefundLedgerEntry } from '@/lib/ledger'
import { recomputeRoyaltyRefundedCents } from '@/lib/royalty-refunded'

/** Kill-switch — default OFF. Only the exact string 'true' enables the rail
 *  (mirrors isFranchiseRoyaltyEnabled / isCreatorPayoutEnabled).
 *  P0-04 (vague 1) : ce flag gouverne l'OUTIL DE REMBOURSEMENT ADMIN uniquement
 *  (route /api/admin/refunds/run + reprise claims). L'AUTO-remboursement
 *  ghost-order du webhook est gouverné par le flag SÉPARÉ ci-dessous. */
export function isRefundsEnabled(): boolean {
  return process.env.REFUNDS_ENABLED === 'true'
}

/** P0-04 (vague 1, principe fondateur) : « aucune automatisation produisant un
 *  effet externe à impact financier sans validation humaine ». L'auto-refund
 *  ghost-order (webhook payment_intent.succeeded sur commande expirée) est le
 *  SEUL chemin du moteur sans humain → il a son PROPRE kill-switch, défaut OFF,
 *  découplé de REFUNDS_ENABLED : l'outil admin peut être actif toute la bêta
 *  pendant que ce chemin reste inactif (l'argent encaissé part alors en file
 *  manuelle 'reconcile_manual' — jamais un money-out silencieux). */
export function isGhostOrderAutoRefundEnabled(): boolean {
  return process.env.GHOST_ORDER_AUTO_REFUND_ENABLED === 'true'
}

export interface RefundSplit {
  /** f = refundAmount / chargeTotal (display only; the money maths is integer). */
  fraction: number
  /** Pulled back from the resto's connected account (reverse_transfer). */
  restaurantReverseCents: number
  /** Came back from Grubano's application fee (refund_application_fee) =
   *  commission slice + held-back royalty slice. restaurantReverse + this = amount. */
  applicationFeeRefundCents: number
  /** The franchise-royalty slice INSIDE applicationFeeRefundCents for THIS refund. */
  royaltyRefundCents: number
  /** Absolute cumulative royalty refunded after this refund = round(R × C / T),
   *  capped at R — the self-healing target written to FranchiseRoyalty.refundedCents. */
  cumulativeRoyaltyRefundedCents: number
}

/**
 * PURE prorata split, integer arithmetic, cent-EXACT. CUMULATIVE-rounding: every
 * series is the rounded ABSOLUTE target at the cumulative refund level, and the
 * per-refund amount is the delta of consecutive targets — so nothing is lost or
 * created across partial refunds and the totals land EXACTLY at full refund.
 *
 *   T = chargeTotal, F = application fee on the charge (commission + held royalty),
 *   R = held-back royalty (0 when not franchised, clamped ≤ F), Cprev = already
 *   refunded (live Stripe), C = Cprev + amount.
 *
 * Invariants (proved by tests):
 *   restaurantReverseCents + applicationFeeRefundCents === amount      (customer-exact)
 *   0 ≤ royaltyRefundCents ≤ applicationFeeRefundCents                 (slice nests)
 *   full refund (Cprev 0, amount T) ⇒ feeRefund=F, royalty=R, cumulative=R
 *   not franchised (R=0) ⇒ royalty slices are 0
 */
export function computeRefundSplit(input: {
  chargeTotalCents:     number
  applicationFeeCents:  number
  royaltyChargedCents:  number
  alreadyRefundedCents: number
  refundAmountCents:    number
}): RefundSplit {
  const T = Math.max(0, Math.trunc(input.chargeTotalCents))
  const F = Math.min(Math.max(0, Math.trunc(input.applicationFeeCents)), T)
  const R = Math.min(Math.max(0, Math.trunc(input.royaltyChargedCents)), F)
  const Cprev = Math.min(Math.max(0, Math.trunc(input.alreadyRefundedCents)), T)
  const amt = Math.max(0, Math.trunc(input.refundAmountCents))
  const C = Math.min(Cprev + amt, T)

  // Absolute cumulative rounded targets. The royalty target nests UNDER the fee
  // target (royalty as a fraction R/F of the refunded fee) so it can never exceed
  // the fee slice — round(feeCum · R/F) ≤ feeCum since 0 ≤ R/F ≤ 1.
  const feeCum = (x: number) => (T > 0 ? Math.round((F * x) / T) : 0)
  const royCum = (x: number) => (T > 0 && F > 0 ? Math.round((feeCum(x) * R) / F) : 0)

  const applicationFeeRefundCents = feeCum(C) - feeCum(Cprev)
  const restaurantReverseCents = amt - applicationFeeRefundCents
  // Defensive clamps: keep the slice in [0, feeRefund] even under pathological
  // rounding (the nesting makes this all-but-impossible, but money never guesses).
  const royaltyRefundCents = Math.min(
    Math.max(0, royCum(C) - royCum(Cprev)),
    Math.max(0, applicationFeeRefundCents),
  )
  const cumulativeRoyaltyRefundedCents = Math.min(royCum(C), R)

  return {
    fraction: T > 0 ? amt / T : 0,
    restaurantReverseCents: Math.max(0, restaurantReverseCents),
    applicationFeeRefundCents,
    royaltyRefundCents,
    cumulativeRoyaltyRefundedCents,
  }
}

export type RefundOutcome =
  | {
      ok: true
      resumed: boolean
      refundId: string            // our Refund row id
      stripeRefundId: string      // re_…
      amountCents: number
      restaurantReverseCents: number
      applicationFeeRefundCents: number
      royaltyRefundCents: number
      royaltyClawbackCents: number
      cumulativeRefundedCents: number   // total refunded on the order (Stripe, after this)
      remainingRefundableCents: number
      routed: boolean
    }
  | { ok: false; status: 404 | 400 | 409 | 500 | 502; error: string }

type RoyaltyRow = {
  id: string
  royaltyCents: number
  refundedCents: number
  status: string
  payoutId: string | null
  settlementId: string | null
  franchisorOperatorId: string
}
type OrderRef = { id: string; restaurantId: string; stripePaymentIntentId: string }
type RefundRow = {
  id: string
  orderId: string
  restaurantId: string
  idempotencyKey: string
  amountCents: number
  restaurantReverseCents: number
  applicationFeeRefundCents: number
  royaltyRefundCents: number
  stripeRefundId: string | null
}

const ROYALTY_SELECT = {
  id: true, royaltyCents: true, refundedCents: true, status: true,
  payoutId: true, settlementId: true, franchisorOperatorId: true,
} as const
const REFUND_SELECT = {
  id: true, orderId: true, restaurantId: true, idempotencyKey: true, amountCents: true,
  restaurantReverseCents: true, applicationFeeRefundCents: true, royaltyRefundCents: true,
  stripeRefundId: true,
} as const

function fatal(err: unknown): RefundOutcome {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return { ok: false, status: 500, error: 'Paiement non configuré.' }
  }
  console.error('[refund] stripe error', err instanceof Error ? err.message : err)
  return { ok: false, status: 502, error: 'Erreur paiement, réessayez.' }
}

const chargeOf = (pi: Stripe.PaymentIntent): Stripe.Charge | null =>
  pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null

const destOf = (charge: Stripe.Charge): string | null =>
  typeof charge.transfer_data?.destination === 'string'
    ? charge.transfer_data.destination
    : (charge.transfer_data?.destination as { id?: string } | null | undefined)?.id ?? null

/**
 * Drive the Stripe refund for a row IDEMPOTENTLY. On RESUME, reconcile first:
 *   1. row already carries the refund id → retrieve it (no new call);
 *   2. a refund tagged with our row id already exists → adopt it (>24h backstop,
 *      survives idempotency-key expiry).
 * Then (or on the FRESH path, which can have no prior refund — like the settlement's
 * fresh path skipping its reconcile LIST) create it — the @unique cursor key dedupes
 * within ~24h, so a fresh retry never doubles.
 */
async function driveRefund(row: RefundRow, pi: Stripe.PaymentIntent, routed: boolean, fresh: boolean): Promise<Stripe.Refund> {
  const stripe = getStripe()
  if (!fresh) {
    if (row.stripeRefundId) return stripe.refunds.retrieve(row.stripeRefundId)
    try {
      const list = await stripe.refunds.list({ payment_intent: pi.id, limit: 100 })
      const existing = list.data.find((r) => r.metadata?.grubano_refund_row === row.id)
      if (existing) return existing
    } catch {
      // listing unavailable → fall through to create (the key still dedupes ≤24h)
    }
  }
  return stripe.refunds.create(
    {
      payment_intent: pi.id,
      amount:         row.amountCents,
      ...(routed ? { refund_application_fee: true, reverse_transfer: true } : {}),
      metadata:       { grubano_refund_row: row.id, orderId: row.orderId },
    },
    { idempotencyKey: row.idempotencyKey },
  )
}

/** Locate the Stripe transfer that disbursed a settled/settling royalty, to reverse
 *  a clawback against it: the recorded Payout transfer first, else the live
 *  transfer_group (the same anchor the settlement uses). null = not transferred yet. */
async function locateSettlementTransfer(royalty: RoyaltyRow): Promise<string | null> {
  if (royalty.payoutId) {
    const p = await prisma.payout.findUnique({ where: { id: royalty.payoutId }, select: { stripeTransferId: true } })
    if (p?.stripeTransferId) return p.stripeTransferId
  }
  if (royalty.settlementId) {
    try {
      const list = await getStripe().transfers.list({ transfer_group: `frset_${royalty.settlementId}`, limit: 1 })
      if (list.data.length > 0) return list.data[0].id
    } catch {
      // listing unavailable → treat as not found (caller defers to reconciliation)
    }
  }
  return null
}

/**
 * Finalize a refund whose Stripe refund already succeeded (fresh or resumed):
 *   (a) royalty CLAWBACK from the franchisor when the royalty was already settled
 *       (or settling with a live transfer) — idempotent on `refund-claw:<rowId>`;
 *   (b) the compensating refund LEDGER line (best-effort, idempotent with the
 *       charge.refunded webhook via @@unique on the refund id);
 *   (c) mark the Refund row 'succeeded';
 *   (d) refund-aware accrual: FranchiseRoyalty.refundedCents = Σ royalty slices of
 *       this order's SUCCEEDED refunds (capped at royaltyCents) → the settlement
 *       pays only the non-refunded part.
 * On a clawback failure the row stays 'pending' (recoverable) → a later call resumes
 * it; the Stripe refund and the reversal keys guarantee NO double movement.
 */
async function finalizeRefund(
  row: RefundRow,
  order: OrderRef,
  royalty: RoyaltyRow | null,
  pi: Stripe.PaymentIntent,
  charge: Stripe.Charge,
  stripeRefund: Stripe.Refund,
  routed: boolean,
  resumed: boolean,
): Promise<RefundOutcome> {
  // (a) Royalty clawback from the franchisor — ONLY for already-committed royalty.
  let royaltyClawbackCents = 0
  if (royalty && row.royaltyRefundCents > 0 && (royalty.status === 'settled' || royalty.status === 'settling')) {
    const transferId = await locateSettlementTransfer(royalty)
    if (transferId) {
      const amount = Math.min(row.royaltyRefundCents, royalty.royaltyCents)
      try {
        await getStripe().transfers.createReversal(
          transferId,
          { amount, metadata: { orderId: order.id, refundId: row.id, kind: 'royalty_refund_clawback' } },
          { idempotencyKey: `refund-claw:${row.id}` },
        )
        royaltyClawbackCents = amount
      } catch (err) {
        // Refund succeeded for the customer, but recovering the royalty from the
        // franchisor failed → leave the row 'pending' so the next call resumes the
        // clawback (idempotent key → no double). Surface as a retryable error.
        console.error(
          `[refund] royalty clawback reversal failed for order ${order.id} (refund row ${row.id}): ` +
          (err instanceof Error ? err.message : String(err)),
        )
        return { ok: false, status: 502, error: 'Remboursement émis, reprise de la royalty franchisé en échec — réessayez.' }
      }
    } else {
      // Settling but not yet transferred → no money with the franchisor to reverse;
      // refundedCents below reduces what the settlement will pay. Logged for review.
      console.warn(
        `[refund] royalty for order ${order.id} is '${royalty.status}' with no locatable settlement transfer — ` +
        'clawback deferred to settlement reconciliation (settlement settles royaltyCents − refundedCents)',
      )
    }
  }

  // (b) Compensating refund ledger line — best-effort, idempotent with the webhook.
  try {
    await recordRefundLedgerEntry({
      refundId:                  stripeRefund.id,
      restaurantId:              order.restaurantId,
      refundedCents:             row.amountCents,
      applicationFeeRefundCents: row.applicationFeeRefundCents,
      stripePaymentIntentId:     pi.id,
      stripeChargeId:            charge.id,
      routed,
      destinationAccountId:      destOf(charge),
      channel:                   charge.metadata?.grubano_channel ?? null,
      currency:                  stripeRefund.currency || charge.currency || 'eur',
      createdAt:                 stripeRefund.created ? new Date(stripeRefund.created * 1000) : undefined,
    })
  } catch (e) {
    console.error('[refund] [LEDGER MISS] refund line write failed (webhook backstop will heal):',
      order.id, e instanceof Error ? e.message : e)
  }

  // (c) Mark the row succeeded (idempotent — a resume re-writes the same values).
  await prisma.refund.update({
    where: { id: row.id },
    data:  { status: 'succeeded', stripeRefundId: stripeRefund.id, royaltyClawbackCents, settledAt: new Date() },
  })

  // (d) Refund-aware settlement accrual: the royalty's cumulative refunded across BOTH
  //     rails (refunds + lost disputes), capped at royaltyCents, monotone. This refund's
  //     Refund row is already 'succeeded' (step c) → counted by the aggregate. CROSS-RAIL
  //     (P4.5-B): includes lost-dispute slices so a refund can NEVER erase a chargeback's
  //     clawback. Byte-identical for refund-only orders (no disputes → the old value).
  if (royalty) {
    const cum = await recomputeRoyaltyRefundedCents({
      orderId:               order.id,
      royaltyCents:          royalty.royaltyCents,
      existingRefundedCents: royalty.refundedCents,
    })
    await prisma.franchiseRoyalty.update({ where: { orderId: order.id }, data: { refundedCents: cum } })
  }

  // Post-refund cumulative from the charge we already hold (no extra Stripe call):
  // it was read BEFORE this refund on the fresh path (so add this amount), and
  // AFTER the original refund on the resume path (so it already reflects it).
  const chargeTotal = charge.amount
  const cumulativeRefundedCents = Math.min(
    chargeTotal,
    resumed ? (charge.amount_refunded ?? 0) : (charge.amount_refunded ?? 0) + row.amountCents,
  )

  return {
    ok: true,
    resumed,
    refundId:                  row.id,
    stripeRefundId:            stripeRefund.id,
    amountCents:               row.amountCents,
    restaurantReverseCents:    row.restaurantReverseCents,
    applicationFeeRefundCents: row.applicationFeeRefundCents,
    royaltyRefundCents:        row.royaltyRefundCents,
    royaltyClawbackCents,
    cumulativeRefundedCents,
    remainingRefundableCents:  Math.max(0, chargeTotal - cumulativeRefundedCents),
    routed,
  }
}

/**
 * Execute a refund (TOTAL when amountCents is omitted, else PARTIAL). Server-derives
 * every split amount from the live Stripe charge + the order. Safe to call repeatedly
 * / concurrently — never refunds the same money twice (cumul cursor + Stripe key +
 * resume-first). The endpoint enforces the REFUNDS_ENABLED gate + admin/cron auth.
 */
export async function executeRefund(input: {
  orderId: string
  amountCents?: number
  reason?: string
}): Promise<RefundOutcome> {
  const order = await prisma.order.findUnique({
    where:  { id: input.orderId },
    select: { id: true, restaurantId: true, paymentStatus: true, stripePaymentIntentId: true },
  })
  if (!order) return { ok: false, status: 404, error: 'Commande introuvable.' }
  if (order.paymentStatus !== 'paid' || !order.stripePaymentIntentId) {
    return { ok: false, status: 409, error: 'Commande non payée — rien à rembourser.' }
  }
  const orderRef: OrderRef = { id: order.id, restaurantId: order.restaurantId, stripePaymentIntentId: order.stripePaymentIntentId }

  // Load the live PaymentIntent + charge (the authoritative decomposition source).
  let pi: Stripe.PaymentIntent
  try {
    pi = await getStripe().paymentIntents.retrieve(order.stripePaymentIntentId, { expand: ['latest_charge'] })
  } catch (err) {
    return fatal(err)
  }
  if (pi.status !== 'succeeded') return { ok: false, status: 409, error: 'Paiement non débité — rien à rembourser.' }
  const charge = chargeOf(pi)
  if (!charge) return { ok: false, status: 502, error: 'Charge introuvable sur le paiement.' }
  const routed = !!pi.transfer_data

  // RESUME-FIRST: re-drive any interrupted refund before issuing a new one.
  const pending = await prisma.refund.findFirst({
    where:   { orderId: order.id, status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select:  REFUND_SELECT,
  })
  if (pending) {
    const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: ROYALTY_SELECT })
    let stripeRefund: Stripe.Refund
    try {
      stripeRefund = await driveRefund(pending, pi, routed, false)
    } catch (err) {
      return fatal(err)
    }
    return finalizeRefund(pending, orderRef, royalty, pi, charge, stripeRefund, routed, true)
  }

  // Cumul ceiling against the LIVE refundable amount (true cross-path total).
  const chargeTotal     = charge.amount
  const alreadyRefunded = charge.amount_refunded ?? 0
  const refundable      = chargeTotal - alreadyRefunded
  if (refundable <= 0) return { ok: false, status: 409, error: 'Paiement déjà intégralement remboursé.' }
  const amt = input.amountCents ?? refundable
  if (!Number.isInteger(amt) || amt <= 0 || amt > refundable) {
    return { ok: false, status: 400, error: `Montant invalide — remboursable: ${(refundable / 100).toFixed(2)} €.` }
  }

  // Held-back royalty actually inside the application fee (0 when not franchised).
  const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: ROYALTY_SELECT })
  const applicationFeeCents = charge.application_fee_amount ?? 0
  const split = computeRefundSplit({
    chargeTotalCents:     chargeTotal,
    applicationFeeCents:  applicationFeeCents,
    royaltyChargedCents:  royalty?.royaltyCents ?? 0,
    alreadyRefundedCents: alreadyRefunded,
    refundAmountCents:    amt,
  })

  // CLAIM the cumul cursor (anti-double-refund). A concurrent attempt at the same
  // cumul collides here (P2002) and is rejected — the cumul can't be double-spent.
  const idempotencyKey = `refund:${order.id}:${alreadyRefunded}`
  let row: RefundRow
  try {
    row = await prisma.refund.create({
      data: {
        orderId:                   order.id,
        restaurantId:              order.restaurantId,
        stripePaymentIntentId:     pi.id,
        idempotencyKey,
        amountCents:               amt,
        restaurantReverseCents:    split.restaurantReverseCents,
        applicationFeeRefundCents: split.applicationFeeRefundCents,
        royaltyRefundCents:        split.royaltyRefundCents,
        royaltyClawbackCents:      0,
        franchiseRoyaltyStatus:    royalty?.status ?? null,
        reason:                    input.reason ?? null,
        status:                    'pending',
      },
      select: REFUND_SELECT,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, status: 409, error: 'Un remboursement est déjà en cours sur ce montant cumulé.' }
    }
    throw err
  }

  // Issue the Stripe refund (idempotent on the cursor key). On failure the row stays
  // 'pending' → a later call resumes it (the key prevents any double movement).
  let stripeRefund: Stripe.Refund
  try {
    stripeRefund = await driveRefund(row, pi, routed, true)
  } catch (err) {
    return fatal(err)
  }
  return finalizeRefund(row, orderRef, royalty, pi, charge, stripeRefund, routed, false)
}
