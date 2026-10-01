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
// THE ORDER OF THE EVENTS NO LONGER MATTERS (L6.1, founder decision option (a), 2026-09-25). L6 shipped a
// per-event model and NAMED its residual: deltas telescope only over a SORTED and COMPLETE prefix, and every
// written `(re_, type)` row froze the delta it computed, because nothing ever recomputed a keyed row. So a
// set that became provable in the wrong order — a Dashboard refund whose webhook had not landed, beside a
// rail refund whose row was written — settled one point away from §9, permanently.
//
// The founder closed it by choosing ADJUSTMENT TO THE CUMULATIVE TARGET. `reconcileLoyaltyOnRefund` now
// computes the target for the set currently proven, reads the effect REALLY applied, and writes only the
// difference. The target depends on the SUM of the proven amounts, so there is no prefix to get wrong and no
// arrival order to be unlucky with; at the target the difference is 0 and nothing is written.
//
// This file's job is therefore narrower and stronger. It still assembles the DB-known set of §24 — and the
// instant rule stays, because `RefundEvent.createdUnix` is part of that contract and the LEDGER still wins
// on a duplicated `re_` (its `createdAt` is Stripe's own `refund.created`; our `settledAt` is when WE
// noticed) — but the numbers no longer depend on it. And the comparison below is no longer the report of an
// accepted gap: it is an INDEPENDENT VERIFIER of the writer, on BOTH sides. It re-reads the rows, recomputes
// §9 from the set — with the same base the writer uses, and the same high-water floor — and compares. After
// L6.1 a non-null result is not a residual: it is a defect (a row written outside the reconciliation, a
// target the writer refused or failed to reach) and it is alerted as one. See `detectProrataDrift`.
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

/**
 * A gap between what is BOOKED and the §9 target for the refunds the database now knows.
 *
 * After L6.1 this should always be null: the reconciliation converges. A non-null value means the ledger
 * disagrees with the contract — something wrote an `earn_reversal` row that the convergence did not, or the
 * writer could not reach its target — and it is alerted rather than left in a customer's balance.
 */
export interface ProrataDrift {
  targetEarnReversal: number
  bookedEarnReversal: number
  /** L6.1 — the D2 side is verified too: a wrong spent-restore total is a wrong balance just the same. */
  targetSpentRestore: number
  bookedSpentRestore: number
  knownRefundedCents: number
  chargeAmountCents: number
  /** Which side(s) disagree with §9. */
  sides: string
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
 * The §9 target for the KNOWN set, against what is actually booked — an INDEPENDENT verifier of the writer.
 *
 * It deliberately does not trust `ReconcileResult`: it re-reads the rows and recomputes the target, so a
 * convergence that reported success while landing somewhere else is still caught. Nothing is repaired here
 * (that is the writer's job, and rewriting a row would break the append-only ledger); it is REPORTED, so a
 * wrong balance is found by an alert and not by a customer. A detection that cannot read says nothing rather
 * than something false.
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
    const order = await db.order.findUnique({ where: { id: orderId }, select: { pointsRedeemed: true } })
    if (!order) return null
    // The D1 precondition: only points actually CREDITED can be reversed. No earn row ⇒ base 0. The base is
    // the ROW's points, exactly as the writer reads it — taking `Order.pointsEarned` here instead would make
    // any divergence between the column and the credit look like a permanent defect that no repair can clear.
    const earn = await db.loyaltyTransaction.findFirst({
      where: { orderId, type: 'earn' }, select: { points: true },
    })
    const earnBase = earn ? Math.max(0, Math.floor(Number(earn.points) || 0)) : 0
    const spentBase = Math.max(0, Math.floor(order.pointsRedeemed))
    // The cumulative the WRITER used, not merely the one visible now: it floors the proven Σ at the order's
    // high-water, so a set that has since shrunk must not read as a gap.
    const cum = Math.max(
      set.refunds.reduce((a, r) => a + Math.max(0, Math.floor(r.amountCents)), 0),
      result.cumEffectiveCents || 0,
    )
    const rows = await db.loyaltyTransaction.findMany({
      where: { orderId, type: { in: ['earn_reversal', 'refund'] } }, select: { type: true, points: true },
    })
    // SIGNED, not absolute. An `earn_reversal` row carries NEGATIVE points when it claws back and POSITIVE
    // points when a convergence gives some back (L6.1) — and a `refund` row the mirror image. Summing
    // magnitudes would count a give-back as MORE effect, so the verifier would report a gap on exactly the
    // orders it had just corrected.
    const signedSum = (type: string, sign: -1 | 1) =>
      rows.filter((r) => r.type === type).reduce((a, r) => a + sign * Math.floor(Number(r.points) || 0), 0)
    const targetEarnReversal = loyaltyPointsCumulative(earnBase, set.chargeAmountCents, cum)
    const targetSpentRestore = loyaltyPointsCumulative(spentBase, set.chargeAmountCents, cum)
    const bookedEarnReversal = signedSum('earn_reversal', -1)
    const bookedSpentRestore = signedSum('refund', +1)
    const sides = [
      bookedEarnReversal !== targetEarnReversal ? 'earn_reversal' : null,
      bookedSpentRestore !== targetSpentRestore ? 'refund' : null,
    ].filter(Boolean).join('+')
    if (!sides) return null
    return {
      targetEarnReversal, bookedEarnReversal, targetSpentRestore, bookedSpentRestore,
      knownRefundedCents: cum,
      chargeAmountCents:  set.chargeAmountCents,
      sides,
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
  /**
   * The row count BEFORE anything was written, so a failure can state what THIS call applied. Read lazily,
   * once, and only once we know there IS something to reconcile: this function runs on every delivery, and
   * the overwhelming majority of deliveries have no refund at all. An order that returns `no_refunds` costs
   * exactly what it cost before this measurement existed.
   */
  let before: LoyaltyRowCount | null = null
  let beforeRead = false
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      set = set ?? (await buildDbKnownRefundSet(db, orderId))
      if (!set) return { ok: true, replayed: false, reason: 'no_order' }
      // No known refund ⇒ nothing to prorate. The earn stands whole, which is the correct answer.
      if (set.refunds.length === 0) return { ok: true, replayed: false, reason: 'no_refunds' }
      if (!beforeRead) { before = await countLoyaltyRows(db, orderId); beforeRead = true }
      const result = await reconcileLoyaltyOnRefund(db, {
        orderId,
        chargeAmountCents: set.chargeAmountCents,
        refunds:           set.refunds,
      })
      const drift = await detectProrataDrift(db, orderId, set, result)
      if (drift) {
        // The replay returned; the ledger does not agree with §9 for the set now visible. After L6.1 this is
        // a DEFECT, not an accepted residual — the convergence should have reached the target.
        console.error('[LOYALTY MISS] earn_prorata_drift', JSON.stringify({ orderId, via: opts?.via ?? 'unknown', converged: result.converged, ...drift }))
        if (opts?.notifyOnFailure !== false) {
          try {
            await sendAdminMoneyReviewAlert({
              kind:      'loyalty_prorata_incomplete',
              dedupeKey: `loyalty:${orderId}:drift`,
              title:     'Prorata fidélité incohérent avec les remboursements connus (cible cumulative non atteinte)',
              facts:     {
                orderId,
                via:                opts?.via ?? 'unknown',
                sides:              drift.sides,
                targetEarnReversal: drift.targetEarnReversal,
                bookedEarnReversal: drift.bookedEarnReversal,
                targetSpentRestore: drift.targetSpentRestore,
                bookedSpentRestore: drift.bookedSpentRestore,
                knownRefundedCents: drift.knownRefundedCents,
                chargeAmountCents:  drift.chargeAmountCents,
                chargeSource:       set.chargeSource,
                blocked:            result.blocked,
                converged:          result.converged,
                note:               'après L6.1 la réconciliation converge vers la cible : un écart ici est un DÉFAUT (ligne écrite hors réconciliation, ou cible non atteinte), pas un résidu accepté — aucune ligne n’est réécrite, décision humaine',
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
