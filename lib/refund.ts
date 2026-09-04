// ── P4.5-A — Refund money mechanics (the sensitive part) — Agent 49 · PHASE 2 (2026-09) ──
//
// THIS FILE, lib/refund.ts (SINGULAR) = the royalty-aware refund ENGINE, keyed by
// orderId: prorata split + franchise royalty clawback + eager ledger (Stripe truth) +
// Refund DB row + STATUS TRUTH. Since PHASE 2 (REFUND-FINANCIAL-CONTRACT.md) it is the
// ONLY engine on the ORDER path: /api/orders/[id]/refund, /api/admin/refunds/run,
// lib/claims, the ghost-order webhook branch, and the refund.updated webhook finalize.
// The OTHER file, lib/refunds.ts (PLURAL), is the PI-keyed path for payments WITHOUT an
// Order row (tickets, reservation deposits — no royalty can exist). Never route an
// Order refund through it (it would return the royalty slice to the customer without
// reducing FranchiseRoyalty.refundedCents → the settlement pays it twice).
// All routes are GATED by REFUNDS_ENABLED (default OFF) → byte-identical when OFF.
//
// Executes a TOTAL or PARTIAL refund of a paid order AT PRORATA: each party gives
// back the SAME fraction f = refundAmount / chargeTotal of ITS share —
//   • the restaurant returns f of its NET         (Stripe reverse_transfer reverses the
//     GROSS amount from the connected account and the fee refund credits it back —
//     two balance transactions, net = amount − feeRefund);
//   • Grubano returns f of its commission           (Stripe refund_application_fee);
//   • the franchise royalty is reduced by f          (refundedCents) — or, if the
//     royalty was ALREADY settled to the franchisor, that slice is CLAWED BACK
//     (Stripe transfers.createReversal on the settlement transfer).
// Cents are EXACT (restaurantReverse + applicationFeeRefund = refundAmount to the
// cent; the royalty slice nests inside the fee refund) and CUMULATIVE across
// multiple partial refunds (never more than the order total).
//
// STATUS TRUTH (Phase 2, §8): a Refund row is 'succeeded' — and the eager ledger line
// is written, and the customer may be told « effectué » — ONLY when Stripe says the
// refund `status === 'succeeded'`. A `pending` Stripe refund leaves the row 'pending'
// (stripeRefundId recorded) and the outcome is a NON-ok `pending` variant; the row is
// finalized later by RESUME-FIRST or by the refund.updated webhook. A `failed`/`canceled`
// Stripe refund → row 'failed', the cumul cursor is released, and the order is LOCKED
// fail-closed (Stripe does NOT restore the reversed transfer on a failed refund → a
// blind retry with reverse_transfer would debit the restaurant twice).
//
// ANTI-DOUBLE-REFUND (the payout/settlement pattern):
//   • Refund.idempotencyKey @unique = `refund:<orderId>:<alreadyRefunded>` — the
//     MONOTONE cumul cursor (alreadyRefunded read live from Stripe = the true
//     cross-path total). Two concurrent attempts at the same cumul derive the SAME
//     key → one create wins (P2002), the cumul can never be double-spent.
//   • The SAME key is the Stripe refund idempotency key → a retry within ~24h
//     returns the SAME refund (no second money movement).
//   • RESUME-FIRST: a 'pending' Refund row (Stripe refund issued but DB finalize
//     failed, or refund still pending at Stripe) is re-driven BEFORE any new refund —
//     re-using the recorded refund id, else adopting a refund tagged with the row id
//     (the >24h backstop). If that adoption LIST is unavailable the resume FAILS CLOSED
//     (502, retry later) — it never creates (a pruned key + a lost response = double).
//   • The royalty clawback has the same >24h backstop: an existing reversal tagged
//     with the row id is ADOPTED, never re-created.
//   • The cumul ceiling is enforced against the LIVE Stripe refundable amount.
//
// All split amounts are DERIVED SERVER-SIDE from the live Stripe charge + the order
// (chargeTotal, application_fee, the held-back royalty) — NEVER a client input.

import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { recordRefundLedgerEntry } from '@/lib/ledger'
import { recomputeRoyaltyRefundedCents } from '@/lib/royalty-refunded'
import { recoveredRoyaltyClawbackCents, capClawback } from '@/lib/royalty-recovered'
import { matchFeeRefunds } from '@/lib/refund-fee-truth'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'

/** Kill-switch — default OFF. Only the exact string 'true' enables the rail
 *  (mirrors isFranchiseRoyaltyEnabled / isCreatorPayoutEnabled).
 *  P0-04 (vague 1) : ce flag gouverne l'outil admin /api/admin/refunds/run,
 *  la route admin /api/orders/[id]/refund (P0-26) et les rails claims/dispute.
 *  Il ne gouverne PLUS l'auto-remboursement ghost-order du webhook (flag
 *  séparé ci-dessous).
 *  LOT C (mise à jour du périmètre réel) : depuis P0-24, l'ACCEPT d'une
 *  réclamation par le RESTAURATEUR ne rembourse PLUS RIEN — lib/claims route
 *  l'accept vers 'arbitration' sans mouvement d'argent ; seul l'ADMIN déclenche
 *  un remboursement (arbitrage ou outils ci-dessus). Avec CLAIMS_ENABLED=false
 *  (décision fondateur D4, toute la bêta), ce flag ne gouverne donc QUE les
 *  rails admin — l'allumer (D3) n'ouvre aucun chemin restaurateur/machine.
 *  Il ne gouverne PAS la RÉCONCILIATION du webhook charge.refunded / refund.*
 *  (règle fondateur : le flag gate qui INITIE, jamais la vérité Stripe établie). */
export function isRefundsEnabled(): boolean {
  return process.env.REFUNDS_ENABLED === 'true'
}

/** P0-04 (vague 1, principe fondateur) : « aucune automatisation produisant un
 *  effet externe à impact financier sans validation humaine ». L'auto-refund
 *  ghost-order (webhook payment_intent.succeeded sur commande expirée) est le
 *  chemin du moteur déclenché SANS AUCUNE action humaine → il a son PROPRE
 *  kill-switch, défaut OFF, découplé de REFUNDS_ENABLED : l'outil admin peut
 *  être actif toute la bêta pendant que ce chemin reste inactif (l'argent
 *  encaissé part alors en file manuelle 'reconcile_manual' — jamais un money-out
 *  silencieux). NB : un second chemin machine subsiste hors périmètre de ce
 *  ticket — runClaimAutoApproval (lib/claims.ts:302-338, decidedBy 'auto_timeout'),
 *  dont le scheduler a été retiré par P0-07 mais dont la route demeure appelable. */
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
      /** PHASE 2: the caller's amountCents was IGNORED because an interrupted refund was
       *  re-driven first (RESUME-FIRST). The admin must re-issue the intended amount. */
      resumedIgnoredAmount?: boolean
    }
  | {
      /** PHASE 2 (§8): Stripe accepted the refund but it is NOT yet succeeded — money
       *  has NOT moved to the customer. NOT ok on purpose: no ledger line, no email, no
       *  « effectué ». Finalized later by RESUME-FIRST or the refund.updated webhook. */
      ok: false
      status: 202
      pending: true
      refundId: string
      stripeRefundId: string
      amountCents: number
      stripeStatus: string
      error: string
    }
  | { ok: false; status: 404 | 400 | 409 | 500 | 502; error: string; pending?: false }

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
  /** Row creation time = the moment the Stripe idempotency key was first used (F8 window). */
  createdAt: Date | string
}

const ROYALTY_SELECT = {
  id: true, royaltyCents: true, refundedCents: true, status: true,
  payoutId: true, settlementId: true, franchisorOperatorId: true,
} as const
const REFUND_SELECT = {
  id: true, orderId: true, restaurantId: true, idempotencyKey: true, amountCents: true,
  restaurantReverseCents: true, applicationFeeRefundCents: true, royaltyRefundCents: true,
  stripeRefundId: true, createdAt: true,
} as const

/** Thrown when a RESUME cannot consult Stripe's list to adopt an existing refund /
 *  reversal — we must NOT create blindly (a pruned key + a lost response = a double). */
class ResumeListUnavailable extends Error {
  constructor(what: string) { super(`resume_list_unavailable:${what}`) }
}

function fatal(err: unknown): RefundOutcome {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return { ok: false, status: 500, error: 'Paiement non configuré.' }
  }
  if (err instanceof ResumeListUnavailable) {
    console.error('[refund] resume blocked — Stripe list unavailable, nothing created:', err.message)
    return { ok: false, status: 502, error: 'Reprise impossible pour l’instant (liste Stripe indisponible) — réessayez.' }
  }
  if (err instanceof ResumeIdempotencyExpired) {
    // F8: never a second Stripe refund for one intended action. Human reconciliation.
    console.error(`[MONEY REVIEW] [resume_idempotency_expired] ${err.message}: pending row older than the Stripe idempotency window with no adoptable refund — NOT created (human reconciliation: check the Stripe Dashboard for a refund of this order; if none, cancel the row)`)
    return { ok: false, status: 409, error: 'Reprise impossible : la fenêtre d’idempotence Stripe du remboursement initial a expiré et aucun remboursement n’est retrouvé — réconciliation manuelle requise (aucun second remboursement créé).' }
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

const FAILED_STATUSES = new Set(['failed', 'canceled'])

/**
 * Drive the Stripe refund for a row IDEMPOTENTLY. On RESUME, reconcile first:
 *   1. row already carries the refund id → retrieve it (no new call);
 *   2. a refund tagged with our row id already exists → adopt it (>24h backstop,
 *      survives idempotency-key expiry). If that LIST is unavailable → FAIL CLOSED
 *      (ResumeListUnavailable): never create on a resume without the list (§16 B2).
 * Then (or on the FRESH path, which can have no prior refund — like the settlement's
 * fresh path skipping its reconcile LIST) create it — the @unique cursor key dedupes
 * within ~24h, so a fresh retry never doubles.
 */
/** Stripe prunes idempotency keys "after they are at least 24 hours old" (contract §9.8).
 *  Inside this window a re-sent create with the SAME key returns the SAME refund — one
 *  intended action ⇒ at most one economic effect. Past it, a create would be a NEW
 *  request: the resume path therefore NEVER creates after the window (F8, final
 *  hardening). Conservative margin: 20 h. */
export const RESUME_CREATE_WINDOW_MS = 20 * 60 * 60 * 1000

/** Thrown when a RESUME finds no refund to adopt AND the Stripe idempotency window of the
 *  original create has expired — creating again could double the customer's cash. */
class ResumeIdempotencyExpired extends Error {
  constructor(rowId: string) { super(`resume_idempotency_expired:${rowId}`) }
}

async function driveRefund(row: RefundRow, pi: Stripe.PaymentIntent, routed: boolean, fresh: boolean, adoptOnly = false): Promise<Stripe.Refund> {
  const stripe = getStripe()
  if (!fresh) {
    if (row.stripeRefundId) return stripe.refunds.retrieve(row.stripeRefundId)
    let list: Stripe.ApiList<Stripe.Refund>
    try {
      list = await stripe.refunds.list({ payment_intent: pi.id, limit: 100 })
    } catch {
      throw new ResumeListUnavailable('refunds')
    }
    // F8: a truncated list cannot prove absence — fail closed rather than create.
    if (list.has_more) throw new ResumeListUnavailable('refunds_truncated')
    const existing = list.data.find((r) => r.metadata?.grubano_refund_row === row.id)
    if (existing) return existing
    // WEBHOOK path (security review P2-a): the event proves a refund EXISTS — a finalize
    // triggered by Stripe must never CREATE one. Not found → retryable, nothing moved.
    if (adoptOnly) throw new ResumeListUnavailable('refund_not_found_adopt_only')
    // F8 (final hardening): re-sending the create is safe ONLY while Stripe still holds the
    // original idempotency key (same key ⇒ same refund, even if the list omitted it).
    // After the window a create would be a NEW refund → never; human reconciliation.
    const ageMs = Date.now() - new Date(row.createdAt).getTime()
    if (!(ageMs >= 0 && ageMs < RESUME_CREATE_WINDOW_MS)) throw new ResumeIdempotencyExpired(row.id)
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
 *  transfer_group (the same anchor the settlement uses). null = not transferred yet.
 *  A list failure is treated as "not found" — DELIBERATE fail-safe (§17 R4-5): the
 *  clawback is skipped and lands on the settlement over-transfer alert (human path). */
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
 * PHASE 2 (§8) — Stripe TRUTH for the eager ledger line: re-list the charge's SUCCEEDED
 * refunds and the fee's refunds, attribute with the SAME rule as the webhook
 * (lib/refund-fee-truth). Returns null when the truth cannot be resolved unambiguously
 * (the eager line is then SKIPPED and the charge.refunded webhook backstop writes it —
 * the ledger never freezes a predicted cent). Also yields Σ succeeded for the royalty
 * target. Best-effort: any Stripe error → null.
 */
async function resolveFeeTruth(pi: Stripe.PaymentIntent, charge: Stripe.Charge, stripeRefundId: string): Promise<{
  feeBackCents: number | null
  reversalCents: number | null
  succeededTotalCents: number | null
}> {
  try {
    const stripe = getStripe()
    const list = await stripe.refunds.list({ payment_intent: pi.id, limit: 100, expand: ['data.transfer_reversal'] })
    if (list.has_more) return { feeBackCents: null, reversalCents: null, succeededTotalCents: null }
    const succeeded = list.data.filter((r) => r.status === 'succeeded')
    const succeededTotalCents = succeeded.reduce((s, r) => s + r.amount, 0)
    const mine = succeeded.find((r) => r.id === stripeRefundId)
    if (!mine) return { feeBackCents: null, reversalCents: null, succeededTotalCents }
    // F2: the ACTUAL transfer reversal of THIS refund (expanded object → exact amount).
    const rev = mine.transfer_reversal
    const reversalCents = rev == null ? 0 : (typeof rev === 'object' && typeof rev.amount === 'number' ? rev.amount : mine.amount)
    const appFeeId = typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id ?? null
    const totalFee = charge.application_fee_amount ?? 0
    if (!appFeeId || totalFee <= 0) {
      // No application fee on the charge → nothing was taken back: truth is 0.
      return { feeBackCents: 0, reversalCents, succeededTotalCents }
    }
    const fees = await stripe.applicationFees.listRefunds(appFeeId, { limit: 100 })
    const match = matchFeeRefunds(
      succeeded.map((r) => ({ id: r.id, amount: r.amount, created: r.created })),
      fees.data.map((f) => ({ amount: f.amount, created: f.created })),
      totalFee, charge.amount,
    )
    // Eager line only on EXACT truth ('stripe' index match, or 'none' = nothing taken back);
    // 'matched'/'residual' attribution is left to the webhook (which logs MONEY REVIEW).
    // Review #11: the engine's OWN routed refund was created with refund_application_fee:true
    // and the charge carries a fee → a 'none' list is a read lag/omission, not a truth of 0.
    // Defer to the webhook (which fails closed on an unavailable fee list).
    if (match.mode === 'none') return { feeBackCents: null, reversalCents, succeededTotalCents }
    if (match.mode !== 'stripe') return { feeBackCents: null, reversalCents, succeededTotalCents }
    return { feeBackCents: match.byRefundId.get(stripeRefundId) ?? null, reversalCents, succeededTotalCents }
  } catch {
    return { feeBackCents: null, reversalCents: null, succeededTotalCents: null }
  }
}

/**
 * PHASE 2 (§8 / §15 A3 / A11) — a Stripe refund FAILED or was CANCELED: make the row
 * truthful ('failed', stripeRefundId written so the fail-closed lock engages), release
 * the cumul cursor (Stripe did not move amount_refunded), MONEY REVIEW + admin alert.
 * No ledger line (none was written for a non-succeeded refund), loyalty untouched.
 * Idempotent (a second call finds the row already 'failed').
 */
export async function markRefundRowFailed(rowId: string, stripeRefund: Stripe.Refund): Promise<{ ok: false; status: 409; error: string }> {
  const row = await prisma.refund.findUnique({
    where:  { id: rowId },
    select: { id: true, orderId: true, idempotencyKey: true, amountCents: true, status: true, stripeRefundId: true },
  })
  const error = 'Remboursement Stripe en échec — reprise manuelle requise (le transfert inversé n’est pas restauré par Stripe : re-transférer le net au restaurant, puis rembourser sans reverse_transfer).'
  if (!row) return { ok: false, status: 409, error }
  // Security review P2-c: never let a mismatched Stripe refund re-label / lock a row that
  // already carries a DIFFERENT refund id (the event does not belong to this row).
  if (row.stripeRefundId && row.stripeRefundId !== stripeRefund.id) {
    console.error(`[MONEY REVIEW] [refund_row_mismatch] row ${row.id} holds ${row.stripeRefundId}, event refund ${stripeRefund.id} — row NOT marked failed`)
    return { ok: false, status: 409, error }
  }
  if (row.status !== 'failed') {
    const suffix = `:failed:${stripeRefund.id}`
    await prisma.refund.update({
      where: { id: row.id },
      data:  {
        status:         'failed',
        stripeRefundId: stripeRefund.id,
        idempotencyKey: row.idempotencyKey.endsWith(suffix) ? row.idempotencyKey : `${row.idempotencyKey}${suffix}`,
      },
    })
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'refund_failed',
        dedupeKey: `refund:${stripeRefund.id}`,
        title:     'Remboursement Stripe en échec — commande verrouillée',
        facts:     { orderId: row.orderId, refundRow: row.id, stripeRefundId: stripeRefund.id, amountCents: row.amountCents, stripeStatus: stripeRefund.status ?? null, failureReason: stripeRefund.failure_reason ?? null, action: 'humain : re-transférer le net au restaurant puis rembourser sans reverse_transfer (Dashboard Stripe). Le moteur refuse tout nouveau remboursement sur cette commande.' },
      })
    } catch { /* best-effort */ }
  }
  return { ok: false, status: 409, error }
}

/**
 * Finalize a refund whose Stripe refund object we hold (fresh or resumed):
 *   (0) STATUS TRUTH — failed/canceled → row 'failed' + lock; not yet succeeded →
 *       row stays 'pending' (stripeRefundId recorded) and the NON-ok pending variant;
 *   (a) royalty CLAWBACK from the franchisor when the royalty was already settled
 *       (or settling with a live transfer) — capped at the royalty NOT YET RECOVERED
 *       (never at refundedCents — §10.B D-H v2), adopting an existing tagged reversal on
 *       a resume (>24h backstop, §15 A1), idempotent on `refund-claw:<rowId>`;
 *   (b) the compensating refund LEDGER line with Stripe's REAL fee refund (skipped when
 *       the truth is ambiguous — the webhook backstop writes it), idempotent on re_…;
 *   (c) mark the Refund row 'succeeded';
 *   (d) refund-aware accrual: FranchiseRoyalty.refundedCents = cross-rail cumulative
 *       (Σ rows ∨ Stripe target) capped at royaltyCents → the settlement pays only the
 *       non-refunded part.
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
  resumedIgnoredAmount = false,
): Promise<RefundOutcome> {
  // (0) STATUS TRUTH (§8, §16 B4: anything ∉ {succeeded, failed, canceled} = pending).
  const stripeStatus = stripeRefund.status ?? 'pending'
  if (FAILED_STATUSES.has(stripeStatus)) {
    return markRefundRowFailed(row.id, stripeRefund)
  }
  if (stripeStatus !== 'succeeded') {
    if (row.stripeRefundId !== stripeRefund.id) {
      await prisma.refund.update({ where: { id: row.id }, data: { stripeRefundId: stripeRefund.id } })
    }
    return {
      ok: false, status: 202, pending: true,
      refundId: row.id, stripeRefundId: stripeRefund.id, amountCents: row.amountCents, stripeStatus,
      error: 'Remboursement en attente côté Stripe — aucun montant n’a encore été restitué au client.',
    }
  }

  // (a) Royalty clawback from the franchisor — ONLY for already-committed royalty.
  let royaltyClawbackCents = 0
  if (royalty && row.royaltyRefundCents > 0 && (royalty.status === 'settled' || royalty.status === 'settling')) {
    const transferId = await locateSettlementTransfer(royalty)
    if (transferId) {
      const recovered = await recoveredRoyaltyClawbackCents({ orderId: order.id, excludeRefundRowId: row.id })
      const amount = capClawback(row.royaltyRefundCents, royalty.royaltyCents, recovered)
      if (amount > 0) {
        try {
          let adopted: Stripe.TransferReversal | null = null
          if (resumed) {
            // >24h backstop: adopt a reversal already tagged with this row (never re-create).
            let reversals: Stripe.ApiList<Stripe.TransferReversal>
            try {
              reversals = await getStripe().transfers.listReversals(transferId, { limit: 100 })
            } catch {
              throw new ResumeListUnavailable('reversals')
            }
            // F8 (review #12): the same discipline as the refund create — a truncated list
            // cannot prove absence, and past the idempotency window a re-sent reversal would
            // be a NEW reversal (the franchisor debited twice). Fail closed, human path.
            if (reversals.has_more) throw new ResumeListUnavailable('reversals_truncated')
            adopted = reversals.data.find((rv) => rv.metadata?.refundId === row.id) ?? null
            if (!adopted) {
              const ageMs = Date.now() - new Date(row.createdAt).getTime()
              if (!(ageMs >= 0 && ageMs < RESUME_CREATE_WINDOW_MS)) throw new ResumeIdempotencyExpired(row.id + ':clawback')
            }
          }
          if (adopted) {
            royaltyClawbackCents = adopted.amount
          } else {
            await getStripe().transfers.createReversal(
              transferId,
              { amount, metadata: { orderId: order.id, refundId: row.id, kind: 'royalty_refund_clawback' } },
              { idempotencyKey: `refund-claw:${row.id}` },
            )
            royaltyClawbackCents = amount
          }
        } catch (err) {
          if (err instanceof ResumeListUnavailable || err instanceof ResumeIdempotencyExpired) return fatal(err)
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
        console.warn(`[refund] royalty for order ${order.id}: slice ${row.royaltyRefundCents}c already recovered (${recovered}c of ${royalty.royaltyCents}c) — no further clawback`)
      }
    } else {
      // Settling but not yet transferred → no money with the franchisor to reverse;
      // refundedCents below reduces what the settlement will pay. If the settlement
      // already froze its batch, its post-transfer re-read raises the over-transfer
      // alert (§10.A D-G v2). Logged for review.
      console.warn(
        `[refund] royalty for order ${order.id} is '${royalty.status}' with no locatable settlement transfer — ` +
        'clawback deferred to settlement reconciliation (settlement settles royaltyCents − refundedCents; over-transfer is alerted)',
      )
    }
  }

  // (b) Compensating refund ledger line — Stripe TRUTH only, idempotent with the webhook.
  const truth = await resolveFeeTruth(pi, charge, stripeRefund.id)
  if (truth.feeBackCents !== null && truth.reversalCents !== null) {
    if (truth.feeBackCents !== row.applicationFeeRefundCents) {
      console.error(`[MONEY REVIEW] [fee_prediction_mismatch] order ${order.id} refund ${stripeRefund.id}: predicted fee refund ${row.applicationFeeRefundCents}c, Stripe real ${truth.feeBackCents}c — ledger uses Stripe`)
    }
    if (routed && truth.reversalCents === 0) {
      console.error(`[MONEY REVIEW] [refund_without_reverse_transfer] order ${order.id} refund ${stripeRefund.id}: no transfer reversal on a routed charge — restaurant give-back booked 0`)
    }
    try {
      await recordRefundLedgerEntry({
        refundId:                  stripeRefund.id,
        restaurantId:              order.restaurantId,
        refundedCents:             row.amountCents,
        applicationFeeRefundCents: truth.feeBackCents,
        reversalCents:             truth.reversalCents, // F2: ACTUAL transfer reversal (0 when none)
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
  } else {
    console.warn(`[refund] eager ledger line skipped for ${stripeRefund.id} (fee truth unresolved) — charge.refunded webhook writes it`)
  }

  // (c) Mark the row succeeded (idempotent — a resume re-writes the same values).
  await prisma.refund.update({
    where: { id: row.id },
    data:  { status: 'succeeded', stripeRefundId: stripeRefund.id, royaltyClawbackCents, settledAt: new Date() },
  })

  // (d) Refund-aware settlement accrual: the royalty's cumulative refunded across BOTH
  //     rails (refunds + lost disputes) ∨ the Stripe-truth target, capped at royaltyCents,
  //     monotone. This refund's Refund row is already 'succeeded' (step c) → counted.
  if (royalty) {
    const stripeTargetCents = truth.succeededTotalCents !== null
      ? computeRefundSplit({
          chargeTotalCents:     charge.amount,
          applicationFeeCents:  charge.application_fee_amount ?? 0,
          royaltyChargedCents:  royalty.royaltyCents,
          alreadyRefundedCents: 0,
          refundAmountCents:    truth.succeededTotalCents,
        }).cumulativeRoyaltyRefundedCents
      : undefined
    // Financial review F3: a DB blip here must NOT mask a COMPLETED refund as a 500 (the
    // admin would re-issue and create a second refund). The D-B webhook target heals
    // refundedCents on the next charge.refunded / refund.updated delivery — log MONEY REVIEW.
    try {
      const cum = await recomputeRoyaltyRefundedCents({
        orderId:               order.id,
        royaltyCents:          royalty.royaltyCents,
        existingRefundedCents: royalty.refundedCents,
        stripeTargetCents,
      })
      await prisma.franchiseRoyalty.update({ where: { orderId: order.id }, data: { refundedCents: cum } })
    } catch (e) {
      console.error(`[MONEY REVIEW] [royalty_refunded_write_failed] order ${order.id} refund ${stripeRefund.id}: refundedCents not updated (webhook D-B target heals it) —`, e instanceof Error ? e.message : e)
    }
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
    ...(resumedIgnoredAmount ? { resumedIgnoredAmount: true } : {}),
  }
}

/**
 * PHASE 2 (§16 B1) — finalize a 'pending' Refund row from the refund.updated webhook once
 * Stripe reports the refund succeeded (or make it 'failed'). Same code path as RESUME-FIRST.
 */
export async function finalizeRefundRowFromStripe(rowId: string): Promise<RefundOutcome> {
  const row = await prisma.refund.findUnique({ where: { id: rowId }, select: { ...REFUND_SELECT, status: true } })
  if (!row) return { ok: false, status: 404, error: 'Ligne de remboursement introuvable.' }
  if (row.status === 'succeeded') return { ok: false, status: 409, error: 'Déjà finalisé.' }
  if (row.status === 'failed') return { ok: false, status: 409, error: 'Remboursement en échec — reprise manuelle requise.' }
  const order = await prisma.order.findUnique({
    where:  { id: row.orderId },
    select: { id: true, restaurantId: true, stripePaymentIntentId: true },
  })
  if (!order?.stripePaymentIntentId) return { ok: false, status: 404, error: 'Commande introuvable.' }
  const orderRef: OrderRef = { id: order.id, restaurantId: order.restaurantId, stripePaymentIntentId: order.stripePaymentIntentId }
  let pi: Stripe.PaymentIntent
  try {
    pi = await getStripe().paymentIntents.retrieve(order.stripePaymentIntentId, { expand: ['latest_charge'] })
  } catch (err) {
    return fatal(err)
  }
  const charge = chargeOf(pi)
  if (!charge) return { ok: false, status: 502, error: 'Charge introuvable sur le paiement.' }
  const routed  = !!pi.transfer_data
  const royalty = await prisma.franchiseRoyalty.findUnique({ where: { orderId: order.id }, select: ROYALTY_SELECT })
  let stripeRefund: Stripe.Refund
  try {
    stripeRefund = await driveRefund(row, pi, routed, false, /* adoptOnly */ true)
  } catch (err) {
    return fatal(err)
  }
  return finalizeRefund(row, orderRef, royalty, pi, charge, stripeRefund, routed, true)
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
  // LOT C — garde ÉLARGIE : 'reconcile_manual' (ghost order encaissé, mis en file
  // manuelle par le webhook) EST de l'argent encaissé — c'est précisément la file
  // que ce rail doit pouvoir drainer (avant, le moteur la REFUSAIT en 409). Sans
  // risque de faux remboursement : le refundable est re-vérifié LIVE côté Stripe
  // ci-dessous (pi.status === 'succeeded' + amount_refunded) avant tout mouvement.
  const isRefundablePaymentStatus =
    order.paymentStatus === 'paid' || order.paymentStatus === 'reconcile_manual'
  if (!isRefundablePaymentStatus || !order.stripePaymentIntentId) {
    return { ok: false, status: 409, error: 'Commande non payée — rien à rembourser.' }
  }
  const orderRef: OrderRef = { id: order.id, restaurantId: order.restaurantId, stripePaymentIntentId: order.stripePaymentIntentId }

  // PHASE 2 (§8 fail-closed, §16 B5 — BEFORE resume): a FAILED Stripe refund on this order
  // locks it. Stripe does not restore the reversed transfer on a failed refund → a new
  // refund with reverse_transfer would debit the restaurant a second time. Human path only.
  const failed = await prisma.refund.findFirst({
    where:  { orderId: order.id, status: 'failed', stripeRefundId: { not: null } },
    select: { id: true, stripeRefundId: true },
  })
  if (failed) {
    return { ok: false, status: 409, error: 'Remboursement précédent en échec sur cette commande — reprise manuelle requise (Dashboard Stripe : re-transférer le net au restaurant, puis rembourser sans reverse_transfer).' }
  }

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
    const ignored = input.amountCents !== undefined && input.amountCents !== pending.amountCents
    return finalizeRefund(pending, orderRef, royalty, pi, charge, stripeRefund, routed, true, ignored)
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
