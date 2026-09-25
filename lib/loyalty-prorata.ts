// lib/loyalty-prorata.ts — D-15: the loyalty prorata of a refund that happened BEFORE delivery.
//
// THE DEFECT THIS FILE CLOSES (LOYALTY-REFUND-CONTRACT §23 residual → §24, D′ lot L6). Points are credited
// once, at the `delivered` transition. A refund can land BEFORE that: the customer is refunded on Monday and
// the order is marked delivered on Tuesday. The refund webhook reconciles the loyalty ledger at the moment
// the refund happens — but at that moment no `earn` row exists, so there is nothing to reverse and it
// correctly reverses 0. Then `delivered` credits the FULL earning, and no later event ever comes back to
// take it off: a customer refunded in full kept every point of a meal they did not pay for.
//
// THE FIX, and why it is a REPLAY rather than a new formula. After the earn is credited, the same
// reconciliation the webhook runs is replayed over the refunds that are already known — so there is ONE
// rounding rule (§9, the cumulative target), ONE idempotency key (the Stripe `re_`), and one code path.
// Nothing here computes points: it assembles the facts and hands them to `reconcileLoyaltyOnRefund`.
//
// WHY THE SET COMES FROM THE DATABASE, NEVER FROM STRIPE. The status route must not read Stripe: it is on
// the restaurant's hot path, it runs when a courier taps a button, and a Stripe outage must not delay or
// fail a delivery. §24 therefore defines the refund set as what the database already PROVES: the union,
// deduplicated by the `re_` id, of
//   • `Refund` rows of the order that are `succeeded` AND carry a `re_` — a pending or failed row is not a
//     refund, and a row without a `re_` is a refund whose Stripe object we cannot name ;
//   • `LedgerEntry` lines of type `refund` whose `stripePaymentIntentId` is the order's — the ledger is
//     written by the webhook from Stripe's own object, so a Dashboard refund appears here even when no
//     `Refund` row of ours exists.
// Neither source is `charge.amount_refunded`, which is a running total and would double-count.
//
// THE ORDER OF THE EVENTS MATTERS — AND THERE IS A NAMED RESIDUAL HERE. The per-event deltas telescope over
// a SORTED and COMPLETE prefix: §9 is drift-free for a writer that holds the WHOLE refund set in one pass,
// which is exactly why the refund webhook re-reads Stripe's list and answers 503 rather than proceed on a
// partial one. This replay's set is « what the database proves », which is strictly weaker — and every
// written `(re_, type)` row FREEZES the delta it computed, because nothing ever recomputes a keyed row.
//
// So the instant is derived deterministically and the LEDGER wins when both sources carry the same `re_`
// (its `createdAt` is Stripe's own `refund.created`; our `settledAt` is when WE noticed) — but that makes
// the two paths agree only when they see the SAME set. If an EARLIER refund is invisible to the database
// while a LATER one is visible (a Dashboard refund whose webhook has not landed, beside a rail refund whose
// row is written), the later refund's delta is priced from a cumulative of zero, and the earlier refund's
// own delta — computed afterwards, over the complete set — is a different number for a key that is now
// frozen. The booked total can then miss the §9 target by at most ONE point per refund event, either way.
//
// That is a residual of the CONTRACT, not of this file: §24 (3) prescribes both the DB-known set and this
// instant rule without restating §9's prefix-completeness precondition. Closing it needs a change to §9 or
// §16 (a top-up-to-target effect, or an explicit prefix precondition) — a founder decision, not a patch.
// What this file does is refuse to let it be SILENT: after every replay the booked reversal is compared
// with the §9 target for the set now known, and any gap is logged and alerted rather than discovered in a
// customer's balance. See `detectProrataDrift`.
import type { PrismaClient } from '@prisma/client'
import { reconcileLoyaltyOnRefund, type ReconcileResult } from '@/lib/loyalty-refund-apply'
import { loyaltyPointsCumulative, type RefundEvent } from '@/lib/loyalty-refund'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'

/** The Prisma surface this module reads. Structural, so a test can inject a double. */
type Db = Pick<PrismaClient, 'order' | 'refund' | 'ledgerEntry' | 'operator' | 'loyaltyCustomer' | 'loyaltyTransaction' | '$transaction' | '$queryRawUnsafe'>

/** A Stripe refund id, as both sources store it. Anything else is not a refund object we can key on. */
const isStripeRefundId = (v: unknown): v is string => typeof v === 'string' && v.startsWith('re_')

const unix = (d: Date | null | undefined): number => (d ? Math.floor(d.getTime() / 1000) : 0)

export interface DbKnownRefundSet {
  refunds: RefundEvent[]
  /** T, the denominator of §9: the cash captured. */
  chargeAmountCents: number
  /** Where T came from — the report never presents a fallback as a measurement. */
  chargeSource: 'ledger_payment' | 'order_total'
  /** Which source each `re_` came from, for the trail. */
  fromRefundRows: number
  fromLedger: number
}

/**
 * Assemble the DB-known refund set of §24 for one order. Returns null when the order does not exist.
 *
 * It reads and returns; it decides nothing about points and writes nothing.
 */
export async function buildDbKnownRefundSet(db: Db, orderId: string): Promise<DbKnownRefundSet | null> {
  const order = await db.order.findUnique({
    where:  { id: orderId },
    select: { id: true, total: true, stripePaymentIntentId: true },
  })
  if (!order) return null

  // (a) our own rows: succeeded, and carrying the Stripe object's id.
  const rows = await db.refund.findMany({
    where:   { orderId, status: 'succeeded' },
    select:  { stripeRefundId: true, amountCents: true, settledAt: true, createdAt: true },
  })

  // (b) the ledger lines of the same payment. The ledger has no orderId: the PaymentIntent is the join,
  //     and an order with no PaymentIntent has no ledger line to find.
  const ledger = order.stripePaymentIntentId
    ? await db.ledgerEntry.findMany({
        where:  { type: 'refund', stripePaymentIntentId: order.stripePaymentIntentId },
        select: { sourceEventId: true, grossAmount: true, createdAt: true },
      })
    : []

  // The union, deduplicated by `re_`. The LEDGER wins: its instant comes from Stripe's own refund.created.
  const byId = new Map<string, RefundEvent>()
  let fromRefundRows = 0
  for (const r of rows) {
    if (!isStripeRefundId(r.stripeRefundId)) continue
    const amountCents = Math.floor(r.amountCents)
    if (!(amountCents > 0)) continue
    byId.set(r.stripeRefundId, { id: r.stripeRefundId, amountCents, createdUnix: unix(r.settledAt ?? r.createdAt) })
    fromRefundRows++
  }
  let fromLedger = 0
  for (const l of ledger) {
    if (!isStripeRefundId(l.sourceEventId)) continue
    // A refund line's gross is NEGATIVE (the money left): the amount is its magnitude.
    const amountCents = Math.floor(-l.grossAmount)
    if (!(amountCents > 0)) continue
    byId.set(l.sourceEventId, { id: l.sourceEventId, amountCents, createdUnix: unix(l.createdAt) })
    fromLedger++
  }

  // T — the ledger `payment` line of this PaymentIntent is the cash actually captured; the order total is
  // the fallback, and it is NAMED as one because a later write to `total` would move it.
  let chargeAmountCents = Math.max(0, Math.round(Number(order.total) * 100))
  let chargeSource: DbKnownRefundSet['chargeSource'] = 'order_total'
  if (order.stripePaymentIntentId) {
    const payment = await db.ledgerEntry.findFirst({
      where:   { type: 'payment', stripePaymentIntentId: order.stripePaymentIntentId },
      orderBy: { createdAt: 'asc' },
      select:  { grossAmount: true },
    })
    if (payment && Number.isInteger(payment.grossAmount) && payment.grossAmount > 0) {
      chargeAmountCents = payment.grossAmount
      chargeSource = 'ledger_payment'
    }
  }

  return { refunds: Array.from(byId.values()), chargeAmountCents, chargeSource, fromRefundRows, fromLedger }
}

/** Rows of one order's loyalty ledger, by kind. Used to say what a failed replay DID write. */
interface LoyaltyRowCount { earnReversal: number; refund: number }

/** A gap between what is booked and the §9 target for the refunds the database now knows. */
export interface ProrataDrift {
  targetEarnReversal: number
  bookedEarnReversal: number
  knownRefundedCents: number
  chargeAmountCents: number
}

export type ProrataOutcome =
  | { ok: true; replayed: true; set: DbKnownRefundSet; result: ReconcileResult; drift: ProrataDrift | null }
  /** Nothing to replay: the order has no known succeeded refund. Not a failure. */
  | { ok: true; replayed: false; reason: 'no_order' | 'no_refunds' }
  /**
   * The replay did not complete. `reconcileLoyaltyOnRefund` commits ONE TRANSACTION PER EFFECT, so a
   * failure on the third of four refunds leaves the first two APPLIED: « it failed » is never « nothing
   * was written ». `applied` is the measured difference between before and after, or null when the count
   * itself could not be read (then nothing may be claimed about it either).
   */
  | { ok: false; error: string; attempts: number; applied: LoyaltyRowCount | null }

/** Count this order's loyalty rows by kind. Best effort: null rather than a number we cannot stand behind. */
async function countLoyaltyRows(db: Db, orderId: string): Promise<LoyaltyRowCount | null> {
  try {
    const rows = await db.loyaltyTransaction.findMany({ where: { orderId }, select: { type: true } })
    return {
      earnReversal: rows.filter((r) => r.type === 'earn_reversal').length,
      refund:       rows.filter((r) => r.type === 'refund').length,
    }
  } catch { return null }
}

/**
 * The §9 target for the KNOWN set, against what is actually booked (D′ L6 residual guard).
 *
 * A gap means a delta was frozen against a different set than the one visible now — the residual this
 * file's header names. It is never repaired here: rewriting a keyed row would break the one-effect-per-
 * refund model the whole idempotency rests on. It is REPORTED, so a wrong balance is found by an alert and
 * not by a customer. A detection that cannot read says nothing rather than something false.
 */
async function detectProrataDrift(
  db: Db,
  orderId: string,
  set: DbKnownRefundSet,
  result: ReconcileResult,
): Promise<ProrataDrift | null> {
  // A grandfathered order is left exactly as the pre-Phase-1 code wrote it, by contract: §9 is not its rule.
  if (result.grandfathered) return null
  try {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { pointsEarned: true } })
    if (!order) return null
    // The D1 precondition: only points actually CREDITED can be reversed. No earn row ⇒ target 0.
    const earn = await db.loyaltyTransaction.findFirst({
      where: { orderId, type: 'earn' }, select: { id: true },
    })
    const base = earn ? Math.max(0, Math.floor(order.pointsEarned)) : 0
    const cum = set.refunds.reduce((a, r) => a + Math.max(0, Math.floor(r.amountCents)), 0)
    const target = loyaltyPointsCumulative(base, set.chargeAmountCents, cum)
    const rows = await db.loyaltyTransaction.findMany({
      where: { orderId, type: 'earn_reversal' }, select: { points: true },
    })
    const booked = rows.reduce((a, r) => a + Math.abs(Math.floor(r.points)), 0)
    if (booked === target) return null
    return {
      targetEarnReversal: target,
      bookedEarnReversal: booked,
      knownRefundedCents: cum,
      chargeAmountCents:  set.chargeAmountCents,
    }
  } catch { return null }
}

/**
 * Replay the D-15 prorata for one order, on the ROOT client.
 *
 * `reconcileLoyaltyOnRefund` opens its own transactions, so it can never be handed a transaction client —
 * that is why this is called AFTER the earn transaction has committed, never inside it. A delivery that
 * already happened is never rolled back because a points reconciliation failed: the order is delivered,
 * the customer has their food, and the points are a debt we can still settle afterwards.
 *
 * One attempt plus one retry (§24 (5)). On failure the caller is told, the log carries the marker the ops
 * runbook greps for, and — unless the caller opts out — an admin alert names the order so the repair route
 * can settle it.
 */
export async function replayLoyaltyProrata(
  db: Db,
  orderId: string,
  opts?: { notifyOnFailure?: boolean; via?: string },
): Promise<ProrataOutcome> {
  let set: DbKnownRefundSet | null = null
  let lastError = ''
  // Measured BEFORE the first attempt, so a failure can state what this call itself wrote.
  const before = await countLoyaltyRows(db, orderId)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      set = set ?? (await buildDbKnownRefundSet(db, orderId))
      if (!set) return { ok: true, replayed: false, reason: 'no_order' }
      // No known refund ⇒ nothing to prorate. The earn stands whole, which is the correct answer.
      if (set.refunds.length === 0) return { ok: true, replayed: false, reason: 'no_refunds' }
      const result = await reconcileLoyaltyOnRefund(db, {
        orderId,
        chargeAmountCents: set.chargeAmountCents,
        refunds:           set.refunds,
      })
      const drift = await detectProrataDrift(db, orderId, set, result)
      if (drift) {
        // The replay itself SUCCEEDED; the total it lands on does not match §9 for the set now visible.
        console.error('[LOYALTY MISS] earn_prorata_drift', JSON.stringify({ orderId, via: opts?.via ?? 'unknown', ...drift }))
        if (opts?.notifyOnFailure !== false) {
          try {
            await sendAdminMoneyReviewAlert({
              kind:      'loyalty_prorata_incomplete',
              dedupeKey: `loyalty:${orderId}:drift`,
              title:     'Prorata fidélité incohérent avec les remboursements connus',
              facts:     {
                orderId,
                via:                opts?.via ?? 'unknown',
                targetEarnReversal: drift.targetEarnReversal,
                bookedEarnReversal: drift.bookedEarnReversal,
                knownRefundedCents: drift.knownRefundedCents,
                chargeAmountCents:  drift.chargeAmountCents,
                chargeSource:       set.chargeSource,
                note:               'un delta a été figé sur un ensemble différent de celui visible maintenant — aucune ligne n’est réécrite, décision humaine',
                moneyMoved:         false,
              },
            })
          } catch { /* an alert that cannot be sent never changes what is booked */ }
        }
      }
      return { ok: true, replayed: true, set, result, drift }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      // The set is re-read on the retry only when it was the read that failed.
      if (attempt === 1 && !set) set = null
    }
  }

  // What this call actually wrote before it failed. The reconciliation commits one transaction per effect,
  // so a partial application is the NORMAL failure shape, not an exotic one.
  const after = await countLoyaltyRows(db, orderId)
  const applied: LoyaltyRowCount | null = before && after
    ? { earnReversal: Math.max(0, after.earnReversal - before.earnReversal), refund: Math.max(0, after.refund - before.refund) }
    : null

  // The marker the runbook greps for. It is logged whatever the alert does, because a mail can be skipped.
  console.error('[LOYALTY MISS] earn_prorata_incomplete', JSON.stringify({ orderId, via: opts?.via ?? 'unknown', applied, error: lastError.slice(0, 200) }))
  if (opts?.notifyOnFailure !== false) {
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'loyalty_prorata_incomplete',
        dedupeKey: `loyalty:${orderId}:prorata`,
        title:     'Prorata fidélité non appliqué après la livraison',
        facts:     {
          orderId,
          via:            opts?.via ?? 'unknown',
          knownRefunds:   set ? set.refunds.length : null,
          chargeSource:   set ? set.chargeSource : null,
          error:          lastError.slice(0, 200),
          /** Rows written by the failed call itself — « it failed » is not « nothing was written ». */
          appliedRows:    applied ? `earn_reversal:${applied.earnReversal} refund:${applied.refund}` : 'inconnu',
          repair:         'POST /api/admin/loyalty/reconcile { orderId }',
          moneyMoved:     false,
        },
      })
    } catch { /* an alert that cannot be sent never changes what happened to the points */ }
  }
  return { ok: false, error: lastError, attempts: 2, applied }
}
