// lib/claims-pay-rail.ts — the DECISIONS of the claims financial rail, pure (D′ L5, spec v2 §8.2/§8.6).
//
// Everything in this file is a total function over facts the caller has already read. No Prisma, no
// Stripe, no env, no clock of its own: the route does the I/O, this module says what it means. That
// separation is the point — the money vocabulary of the rail is small, closed and testable, and a
// reviewer can read the whole of it in one screen instead of chasing it through a request handler.
//
// THE RAIL NEVER DECIDES THAT MONEY MAY MOVE. The REFUNDS lease (lib/refund refundGateState) and the
// engine's own T1 refusals decide that. This module only classifies what already happened, and says
// whether the batch must stop.
import type { RefundTriggerResult } from '@/lib/claims'
import { MARKERS, proofInstant } from '@/lib/claim-action-rules'

/** Spec v2 §8.2: the lease is re-read before EVERY claim, and a batch never starts one with less than this left. */
export const LEASE_SAFETY_MARGIN_MS = 60_000
/** Spec v2 §8.2: a batch stops offering new claims to the engine after this much wall-clock; the rest are `not_reached`. */
export const PAY_BUDGET_MS = 40_000

/**
 * The closed vocabulary of a per-claim result (spec v2 §8.6). Every value is a decision an operator
 * can act on, not a transcription of an engine message — the engine's own sentence travels beside it
 * in `error`, so the outcome stays comparable across runs while the human still reads the detail.
 */
export type RailOutcome =
  /** Money reached the customer for THIS claim. */
  | 'paid'
  /** Stripe accepted it and has not settled it yet. No notice is sent: nothing is proven. */
  | 'accepted_pending'
  /** The REFUNDS lease was closed when the engine looked. The batch stops; the rest is `not_attempted`. */
  | 'lease_closed'
  /** The claim was no longer in the state the dryRun showed. Never reported as « payée ». */
  | 'state_changed_since_dryrun'
  /** A concurrent writer took the claim between this attempt's CAS and its write. */
  | 'superseded'
  /** No amount was ratified — the engine refused before writing anything (S-27). */
  | 'not_paid:amount_not_ratified'
  /** The engine refused before creating anything, or the row it created failed. 0 € moved. */
  | 'not_paid:engine_failed'
  /** Refused by a safety rule, 0 €: nothing was sent to Stripe. */
  | 'held:safety_hold'
  | 'held:proof_stale'
  | 'held:own_row_exists'
  | 'held:unconfirmed_within_window'
  | 'held:safety_check_unreadable'
  /** Money may have moved and the evidence does not say for whom: a human must look. */
  | 'review:resume_mismatch'
  | 'review:identity_unverified'
  | 'review:engine_own_row'
  /** The attempt threw. Whether the engine was reached is unknown; the batch stops. */
  | 'crashed'
  /** The batch stopped before this claim was offered to the engine. Nothing was read or written for it. */
  | 'not_attempted'
  /** The claim no longer carries the identity the dryRun signed. Nothing was attempted (0 writes). */
  | 'skipped:stale_dryrun'
  /** An explicitly named claim that the selection does not accept. Nothing was attempted. */
  | 'skipped:not_selectable'
  /**
   * The claim could not be READ before the attempt, so nothing was attempted. It is its own word because
   * the other two assert something the rail did establish — that the decision moved, or that the recorded
   * state refuses it — and « I could not look » is neither. (An addition to the spec's §8.6 vocabulary,
   * required by its own fail-closed rule: a database read can fail, and the report must say which fact
   * is missing rather than pick the nearest sentence.)
   */
  | 'skipped:claim_unreadable'

/** The five buckets the batch audit counts (spec v2 §8 audit `claim.pay_batch`). */
export type RailBucket = 'paid' | 'pending' | 'held' | 'review' | 'failed' | 'skipped' | 'not_attempted'

export interface RailClassification {
  outcome: RailOutcome
  /** true ⇒ the batch stops here; every remaining claim is reported `not_attempted`. */
  stop: boolean
  /** The engine's own sentence, when it produced one. Never the source of the outcome. */
  error?: string
  /** `unconfirmed_within_window` only: when a conclusion becomes possible. */
  until?: string
  /**
   * How an ambiguous engine refusal was classified. `claim_reread` = the claim's recorded state was
   * read and decided it; `claim_unreadable` = it could not be read, so the SAFER bucket was taken.
   */
  evidence?: 'claim_reread' | 'claim_unreadable'
}

/** The minimum of the claim's recorded state the rail re-reads to classify an ambiguous engine refusal. */
export interface ClaimAfterAttempt {
  status: string
  refundError: string | null
  /**
   * Set by the trigger's own « engine refused » write ONLY when a refund row carrying this claim's
   * identity exists — which is exactly how « the engine created nothing » is told apart from « the
   * engine created a row and Stripe failed it ». On a routed charge the second case has already
   * debited the restaurant, and Stripe does not restore a reversed transfer.
   */
  refundId: string | null
}

/**
 * `engine_failed: ` is the exact prefix `triggerClaimRefund` writes when the engine refused BEFORE
 * creating anything (or the row it created has failed) — the only refusal for which « 0 € moved » is
 * established. See lib/claims.ts, the T4 `failedData` write.
 */
export const ENGINE_FAILED_PREFIX = 'engine_failed: '

/** The engine refusals the trigger returns as fixed literals, mapped to their bucket by the spec table. */
const HELD_ERRORS = new Set([
  'safety_hold', 'proof_stale', 'own_row_exists', 'unconfirmed_within_window', 'safety_check_unreadable',
])
const REVIEW_ERRORS = new Set(['resume_mismatch', 'identity_unverified'])

/**
 * Classify one `triggerClaimRefund` return (spec v2 §8.6).
 *
 * THE ONE SUBTLETY, and why `after` exists. The trigger returns TWO very different refusals under the
 * same shape: when the engine refuses and a refund row carrying this claim's identity exists (or could
 * not be read), money may already have moved — and when it refuses before creating anything, nothing
 * moved. Both come back as `{state:'failed', error:<the engine's French sentence>}`: the literal
 * `engine_own_row` never reaches the return value. Rather than change the frozen trigger to tell them
 * apart, the rail READS WHAT THE TRIGGER WROTE: only the « nothing created » branch stamps the claim
 * `approved` with a `engine_failed: ` prefix. Anything else — including a claim we could not re-read —
 * is classified `review:engine_own_row`, the bucket that says « a human must establish what was paid ».
 * Guessing the other way would print « 0 € moved » over a refund that may have left.
 */
export function classifyRailResult(
  result: RefundTriggerResult,
  after: ClaimAfterAttempt | null,
): RailClassification {
  if (result.state === 'refunded') return { outcome: 'paid', stop: false }
  if (result.state === 'already_handled') return { outcome: 'state_changed_since_dryrun', stop: false }
  if (result.state === 'pending') {
    if (result.reason === 'refunds_disabled') return { outcome: 'lease_closed', stop: true }
    return { outcome: 'accepted_pending', stop: false }
  }
  // state === 'failed'
  const e = result.error
  if (e === 'amount_not_ratified') return { outcome: 'not_paid:amount_not_ratified', stop: false }
  if (e === 'attempt_superseded') return { outcome: 'superseded', stop: false }
  if (HELD_ERRORS.has(e)) {
    return { outcome: `held:${e}` as RailOutcome, stop: false, ...(result.until ? { until: result.until } : {}) }
  }
  if (REVIEW_ERRORS.has(e)) return { outcome: `review:${e}` as RailOutcome, stop: false, error: e }
  if (after === null) return { outcome: 'review:engine_own_row', stop: false, error: e, evidence: 'claim_unreadable' }
  // THE THIRD CONDITION IS THE ONE THAT MATTERS. The trigger writes the `engine_failed: ` prefix for TWO
  // sub-cases — the engine created nothing, and the engine created a row that Stripe then FAILED — and it
  // sets `refundId` only in the second. On a routed charge that second case has already reversed the
  // transfer out of the restaurant's account, and Stripe does not restore it; « 0 € moved » would be a
  // false statement on the one screen a human reads before deciding whether to act on a locked order.
  // Only « approved, engine_failed, and NO row bound » establishes that nothing left.
  const nothingCreated = after.status === 'approved'
    && after.refundId === null
    && typeof after.refundError === 'string'
    && after.refundError.startsWith(ENGINE_FAILED_PREFIX)
  return nothingCreated
    ? { outcome: 'not_paid:engine_failed', stop: false, error: e, evidence: 'claim_reread' }
    : { outcome: 'review:engine_own_row', stop: false, error: e, evidence: 'claim_reread' }
}

/** Which counter an outcome increments in the batch audit. */
export function bucketOf(outcome: RailOutcome): RailBucket {
  if (outcome === 'paid') return 'paid'
  if (outcome === 'accepted_pending') return 'pending'
  if (outcome === 'not_attempted') return 'not_attempted'
  if (outcome.startsWith('skipped:')) return 'skipped'
  if (outcome.startsWith('held:')) return 'held'
  if (outcome.startsWith('review:')) return 'review'
  // lease_closed, state_changed_since_dryrun, superseded, not_paid:*, crashed — nothing was paid.
  return 'failed'
}

/** true ⇔ this outcome means money reached the customer FOR THIS CLAIM, so the post-money notice is due. */
export function noticeDue(outcome: RailOutcome): boolean {
  return outcome === 'paid'
}

/**
 * WHAT THE AUDIT ROW MAY ASSERT ABOUT MONEY — three values, because two are not enough.
 *
 * `true`  a refund of this claim succeeded at the payment provider.
 * `false` established: nothing was sent. The engine refused before creating anything, a safety rule held
 *         the claim, the lease was closed, the identity had moved, or the claim was never offered.
 * `'unknown'` NOT ESTABLISHED. A refund object may exist: the attempt threw, another writer took the
 *         claim while the engine had already answered, the engine refused with a row of its own, or the
 *         provider accepted a refund it has not settled. An audit trail that wrote `false` here would
 *         let a reader conclude « nothing happened » about an order that may be short of money — the one
 *         conclusion this whole architecture exists to prevent.
 */
export function moneyMovedOf(outcome: RailOutcome): true | false | 'unknown' {
  if (outcome === 'paid') return true
  if (outcome === 'accepted_pending') return 'unknown'
  if (outcome.startsWith('review:')) return 'unknown'
  if (outcome === 'crashed') return 'unknown'
  // `superseded` comes from a lost compare-and-swap, and the trigger reaches that write AFTER the engine
  // has answered in some paths (it raises its own money-review alert when it does): this attempt wrote
  // nothing, which is not the same fact as « nothing was paid ».
  if (outcome === 'superseded') return 'unknown'
  return false
}

export interface RailCounts {
  requested: number
  paid: number
  pending: number
  held: number
  review: number
  failed: number
  skipped: number
  notAttempted: number
}

export function tally(outcomes: ReadonlyArray<RailOutcome>): RailCounts {
  const c: RailCounts = { requested: outcomes.length, paid: 0, pending: 0, held: 0, review: 0, failed: 0, skipped: 0, notAttempted: 0 }
  for (const o of outcomes) {
    const b = bucketOf(o)
    if (b === 'not_attempted') c.notAttempted++
    else c[b]++
  }
  return c
}

// ── dryRun preflight (spec v2 §8.2) ────────────────────────────────────────────────────────────────
//
// A hold here means « the rail would not pay this one right now ». It is advisory: the engine re-checks
// everything itself and is the only authority. Its value is that an admin sees the refusal BEFORE a
// window is opened, instead of watching a batch decline claim by claim inside a 30-minute lease.

export type PreflightVerdict =
  | { payable: true }
  | { payable: false; hold: PreflightHold; detail?: string }

export type PreflightHold =
  /** The engine would ask Stripe to refund a commission that does not exist — a terminal Stripe reject. */
  | 'routed_without_fee'
  /** Stripe could not be read: we do not know, so we do not offer it. */
  | 'funding_unreadable'
  /** The decided amount is above what is still refundable on the ORDER, live. */
  | 'exceeds_refundable'
  /** The ceiling itself could not be computed: unknown, never a number. */
  | 'ceiling_unreadable'
  /** Another refund of this order is still pending: a second one would race its cumulative key. */
  | 'order_has_pending_row'
  /** No amount, or an amount outside [1, requested] (S-10). The engine would answer amount_not_ratified. */
  | 'amount_not_ratified'
  /**
   * An explicitly named claim the §8.5 selection does not accept — a status, a decision, an attempt, a
   * binding or a recorded money state. `detail` carries which clause refused it.
   */
  | 'not_selectable'

export interface PreflightFacts {
  approvedAmountCents: number | null
  requestedAmountCents: number
  /** null ⇒ not read (no PaymentIntent on the order): the engine refuses it itself, without writing. */
  funding: 'ok' | 'routed_without_fee' | 'unreadable' | null
  /** Live remaining refundable on the order, or null when the ceiling could not be computed. */
  maxRefundableCents: number | null
  ceilingReadable: boolean
  /** A Refund row of this order still `pending` (any claim, any rail). */
  orderHasPendingRow: boolean
}

/**
 * Pure: the order of the checks is the order of certainty. An amount that was never ratified is not a
 * funding question; a ceiling we could not compute is not an « amount too high » verdict. Each refusal
 * says exactly what was, and was not, established.
 */
export function preflightVerdict(f: PreflightFacts): PreflightVerdict {
  const a = f.approvedAmountCents
  if (a === null || !Number.isInteger(a) || a <= 0 || a > f.requestedAmountCents) {
    return { payable: false, hold: 'amount_not_ratified' }
  }
  if (f.funding === 'routed_without_fee') return { payable: false, hold: 'routed_without_fee' }
  if (f.funding === 'unreadable') return { payable: false, hold: 'funding_unreadable' }
  if (!f.ceilingReadable || f.maxRefundableCents === null) return { payable: false, hold: 'ceiling_unreadable' }
  if (a > f.maxRefundableCents) {
    return { payable: false, hold: 'exceeds_refundable', detail: `${a} > ${f.maxRefundableCents}` }
  }
  if (f.orderHasPendingRow) return { payable: false, hold: 'order_has_pending_row' }
  return { payable: true }
}

// ── the payable SHAPE, re-checked on a freshly read row ────────────────────────────────────────────

/** The claim fields the rail re-reads before offering a claim to the engine. */
export interface PayableShapeFacts {
  status: string
  arbitrationDecision: string | null
  refundAttempted: boolean
  refundId: string | null
  refundError: string | null
  approvedAmountCents: number | null
  requestedAmountCents: number
}

/**
 * null ⇔ the row is still one the rail may offer to the engine; otherwise the clause that refuses it.
 *
 * This is the AUTOMATIC selection of spec v2 §8.5 (lib/claims-payable-core PAYABLE_WHERE) re-expressed
 * over one already-read row, plus the ONE documented widening: a v13 payable proof, past its quiescence
 * instant, is a recorded state the engine ACCEPTS (lib/claims, T1). It is never selected automatically
 * (S-14b) — an admin must name it — but once named it must pass this check, or the rail would refuse a
 * claim the engine would have paid and an admin would be told « it changed » about a claim that did not.
 *
 * `allowV13` is therefore false for the automatic batch and true only for explicitly named claims.
 * The instant itself is parsed by the ONE parser in lib/claim-action-rules, never re-derived here.
 */
export function payableShapeRefusal(c: PayableShapeFacts, opts: { nowMs: number; allowV13: boolean }): string | null {
  if (c.status !== 'approved') return 'status'
  if (c.arbitrationDecision !== 'approved') return 'arbitration_decision'
  if (c.refundAttempted) return 'refund_attempted'
  if (c.refundId !== null) return 'refund_id'
  const a = c.approvedAmountCents
  if (a === null || !Number.isInteger(a) || a <= 0 || a > c.requestedAmountCents) return 'amount_not_ratified'
  if (c.refundError === null) return null
  if (!opts.allowV13) return 'refund_error'
  if (!c.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13)) return 'refund_error'
  const instant = proofInstant(c.refundError)
  if (!instant || opts.nowMs < instant.getTime()) return 'v13_before_instant'
  return null
}

/**
 * The lease is usable for one more claim (spec §8.2, S-05): open, and with more than the safety
 * margin left. A lease about to expire is treated as closed — an engine call started inside the last
 * minute could be answered after it, and « the window was open when I began » is not a fact anyone
 * can verify afterwards.
 */
export function leaseUsable(
  gate: { open: false; reason: string } | { open: true; expiresAt: Date; remainingMs: number },
  marginMs: number = LEASE_SAFETY_MARGIN_MS,
): boolean {
  return gate.open && gate.remainingMs > marginMs
}
