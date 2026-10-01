// lib/loyalty-refund-apply.ts — PHASE 1 loyalty↔refund reconciliation, DB layer.
//
// Persists the loyalty consequences of the refunds PROVEN on an order, idempotently and atomically. Called
// by the Stripe charge.refunded webhook, by the `delivered` transition's D-15 replay (lib/loyalty-prorata)
// and by the admin repair route — the SINGLE reconciliation point, so a refund is reconciled the same way
// whether it was initiated by the Grubano admin rail OR externally on the Stripe Dashboard (Stripe is the
// financial source of truth; REFUNDS_ENABLED gates who may INITIATE a refund, it must NOT suppress
// reconciling an established one).
//
// ── L6.1 — CONVERGENCE TO THE CUMULATIVE TARGET (founder decision, option (a), 2026-09-25) ──────────
//
// WHAT CHANGED AND WHY. Until L6.1 this module persisted a PER-EVENT plan: the proven refunds were sorted,
// each one got the delta between two cumulative targets, and each delta was written once, keyed by that
// refund's Stripe `re_`. That is exact only for a writer that sees the WHOLE set in one pass — and this one
// does not: a Dashboard refund's webhook can land AFTER a rail refund's row is written, so an EARLIER refund
// can become provable after a later one. Nothing ever recomputes a keyed row, so the earlier refund then
// priced its delta over an empty prefix and the total was one point off, permanently. Measured: T=1410,
// E=14, two refunds of 470 ⇒ 10 booked where round(14×940/1410) = 9 is the target.
//
// So this module no longer sums per-event deltas. Every pass, INSIDE ONE TRANSACTION, under the customer's
// row lock:
//   (1) reduces the proven set to ONE number — Σ of the refunded cents, deduplicated by `re_`
//       (cumulativeRefundedCents), which is why nothing here depends on the order events arrived in ;
//   (2) raises that number to the HIGH-WATER cumulative this order has already been reconciled against, so a
//       proof set that SHRINKS (a refund Stripe stops reporting as succeeded, a voided row) cannot quietly
//       hand points back — see `cumEff` below ;
//   (3) reads the BASE (the points credited / redeemed) and the effect ALREADY REALLY APPLIED from the same
//       locked snapshot — never assumes either from the events, and never mixes a stale base with a fresh
//       applied figure (that combination gave points away: adversarial review, judge panel flaw 1) ;
//   (4) writes ONLY the difference, as ONE new row. Past rows are NEVER rewritten: the correction is a new,
//       keyed, compensating movement, so the ledger stays append-only and the old evidence stays intact.
// At the target the difference is 0 and NOTHING is written — that, not a key, is what makes a replay free.
//
// THE KEY IS THE PROOF STATE. `sourceEventId = prorata:v1:<orderId>:<cumEff>`, with `type` as the second
// column of @@unique([sourceEventId, type]) separating the two sides. So ONE adjustment can exist per
// (order, side, cumulative-refunded) — and that is what makes the whole thing terminate:
//   • replay at the same cumulative ⇒ the difference is 0 (nothing written), and even if something recomputed
//     a different target for it (two callers disagreeing about the denominator T, an edited pointsEarned) the
//     key is already taken, so the writer REFUSES and REPORTS instead of flapping. A key that carried a
//     sequence number would hand every repeat a fresh key and loop for ever — the judge panel constructed
//     exactly that oscillation ;
//   • a NEW refund ⇒ a new cumulative ⇒ a new key ⇒ exactly one additional adjustment ;
//   • a pass that writes nothing does not consume the key, so the D-15 order (base 0 before delivery, base
//     14 after) still gets its adjustment at the same cumulative once the earn row exists.
// The key deliberately contains no `re_`: under convergence the unit of work is the TARGET, not the event.
// Rows written by the old per-`re_` code keep their keys, count normally in the applied effect, and can never
// collide with a new one. This module parses only its OWN keys (for the high-water); nothing else in the
// repository parses `sourceEventId`, and nothing should start.
//
// FUNDING: this module moves POINTS only. It never issues cash. The cash a refund returns is Stripe's own
// charge.amount − amount_refunded (structurally ≤ the cash captured); the loyalty-funded value was never
// charged, so it is never refunded as cash. Points prorate on the SAME charge.amount, so points and cash
// unwind together.

import type { PrismaClient, Prisma } from '@prisma/client'
import {
  cumulativeRefundedCents,
  loyaltyConvergenceDelta,
  loyaltyPointsCumulative,
  applyReversalWithOffset,
  applyGiveBackAgainstOffset,
  type RefundEvent,
} from '@/lib/loyalty-refund'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'

/** Minimal prisma surface used here — lets tests inject a mock. */
type Db = Pick<PrismaClient, 'order' | 'operator' | 'loyaltyCustomer' | 'loyaltyTransaction' | '$transaction' | '$queryRawUnsafe'>

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002'
}

/**
 * How many times one side may try to reach its target in a single call. More than one is needed because a
 * concurrent writer can take the transition we computed (P2002): we then re-read and re-converge rather than
 * leave the order short. Bounded, because a state that refuses to converge must be REPORTED, not spun on.
 */
export const CONVERGENCE_ATTEMPTS = 4

/** The prefix of the keys this module writes. Versioned, so a future key scheme cannot be mistaken for one. */
export const PRORATA_KEY_PREFIX = 'prorata:v1:'

/** The two sides of the reconciliation. `type` is the LoyaltyTransaction.type that records that side. */
const SIDE = {
  /** D1 — points EARNED on the order, clawed back proportionally. Rows carry NEGATIVE points. */
  earn: { type: 'earn_reversal', sign: -1 } as const,
  /** D2 — points SPENT on the order, restored proportionally. Rows carry POSITIVE points. */
  spent: { type: 'refund', sign: +1 } as const,
}
type Side = typeof SIDE.earn | typeof SIDE.spent

export interface ReconcileInput {
  orderId: string
  chargeAmountCents: number // charge.amount = cash captured
  /** ALL SUCCEEDED refunds proven on the charge (re_… id + amount + created). Order irrelevant. */
  refunds: RefundEvent[]
  /**
   * L6.1 — is this set COMPLETE, i.e. read from Stripe's own list of the charge's refunds?
   *
   * It decides one thing only, and it is the difference between a correction and a give-away: whether a
   * NEGATIVE difference may be WRITTEN. Adding effect is always safe — a set that is too small simply asks
   * for less. REMOVING effect is not: the D-15 replay and the admin repair derive their set from the DATABASE
   * (§24 (3) — the status route must never read Stripe), and the database cannot see a Dashboard refund whose
   * webhook has not landed. An order correctly clawed back for two refunds, reconciled again from a set that
   * proves only one, would hand the customer points that were rightly taken.
   *
   * So: false (the default — fail closed) means « I may raise the effect to the target, I may not lower it ».
   * A negative difference is then HELD, reported, and left to a pass whose proof is complete. Only the
   * charge.refunded webhook passes true, and only when Stripe's list call actually succeeded.
   */
  proofComplete?: boolean
}

export interface ReconcileResult {
  applied: number     // adjustment rows newly written (0 on a converged replay)
  skipped: number     // transitions already taken at this cumulative (P2002)
  /** NET points reversed by THIS call: negative when the call gave points back. */
  earnReversed: number
  /** NET points restored by THIS call: negative when the call took an over-restore back. */
  spentRestored: number
  offsetAdded: number
  /** L6.1 — points taken back OFF the recovery offset by a give-back (the inverse of offsetAdded). */
  offsetReleased: number
  grandfathered: boolean // the order was already reconciled by the pre-Phase-1 code → left untouched
  /** L6.1 — did BOTH sides end this call exactly on their cumulative target? */
  converged: boolean
  /**
   * L6.1 — a side owed an adjustment but the key for this cumulative was ALREADY USED, so the difference
   * cannot be written without rewriting history. The writer refuses and reports instead of flapping; the
   * usual cause is two callers disagreeing about the denominator T, or a base edited after the fact.
   */
  blocked: boolean
  /** L6.1 — the cumulative target for the proven set, and what the ledger held before this call. */
  targetEarnReversal: number
  targetSpentRestore: number
  appliedEarnReversalBefore: number
  appliedSpentRestoreBefore: number
  /** L6.1 — Σ of the proven refunds, deduplicated by re_. */
  cumRefundedCents: number
  /** L6.1 — the cumulative actually used: the proven Σ raised to this order's high-water (never lowered). */
  cumEffectiveCents: number
  /**
   * L6.1 — non-null when the high-water floor RAISED a caller's cumulative, i.e. this caller proved LESS than
   * the order had already been reconciled against. Its value is what the caller proved. Nothing is handed
   * back — that is what the floor is for — but a proof set that shrank is an anomaly in its own right and is
   * never reported as a clean pass.
   */
  cumFlooredFromCents: number | null
  /**
   * L6.1 — points a give-back WOULD have returned, held back because the proof set is not known to be
   * complete (see `proofComplete`). Non-zero means a discrepancy is visible and deliberately unwritten: it is
   * reported, never silently applied and never silently dropped.
   */
  heldGiveBack: number
  /**
   * L6.1 / T-44 — a give-back had to unwind a recovery-offset debt, or a take-back had to create one. The
   * composition of D-15 with the D3 debt contract is DEFERRED to T-44 PRE-LIVE, so this is reported for a
   * human, never claimed as certified.
   */
  offsetDeferredT44: boolean
}

/** The magnitude already applied on one side, read from the rows themselves (SIGNED, never magnitudes). */
function appliedMagnitude(rows: Array<{ points: number }>, sign: -1 | 1): number {
  let total = 0
  for (const r of rows) total += sign * Math.floor(Number(r.points) || 0)
  return total
}

/**
 * The highest cumulative this order has already been reconciled against on one side, read back from the keys
 * this module wrote. The cumulative is the LAST field, so an orderId containing a colon cannot confuse it.
 */
function highWaterCum(rows: Array<{ sourceEventId: string | null }>): number {
  let high = 0
  for (const r of rows) {
    const s = r.sourceEventId
    if (typeof s !== 'string' || !s.startsWith(PRORATA_KEY_PREFIX)) continue
    const parts = s.split(':')
    const cum = Number(parts[parts.length - 1])
    if (Number.isFinite(cum) && cum > high) high = Math.floor(cum)
  }
  return high
}

/** What one committed transaction applied. Added to the result only AFTER the commit resolves. */
interface SideEffects {
  earnReversed: number
  spentRestored: number
  offsetAdded: number
  offsetReleased: number
  offsetTouchedT44: boolean
  /** Points a D2 take-back could not take without inventing a debt. Reported, never booked. */
  heldRemainder: number
}
const NO_EFFECTS: SideEffects = { earnReversed: 0, spentRestored: 0, offsetAdded: 0, offsetReleased: 0, offsetTouchedT44: false, heldRemainder: 0 }

/**
 * Reconcile ONE side of the loyalty ledger to its cumulative target.
 *
 * EVERYTHING that decides the write happens inside the transaction, after the customer row is locked: the
 * base, the applied effect, the high-water and the target all come from one snapshot. A zero difference
 * commits nothing. The counters are applied by the CALLER, after the commit resolves — a transaction that
 * rolls back on its way out must not leave a money figure behind in the result.
 */
async function convergeSide(
  db: Db,
  args: {
    orderId: string
    customerId: string
    side: Side
    chargeAmountCents: number
    cumProvenCents: number
    proofComplete: boolean
  },
): Promise<{
  appliedBefore: number; target: number; cumEffective: number
  converged: boolean; blocked: boolean; heldGiveBack: number
  writes: number; skips: number; effects: SideEffects
  floorEngagedFrom: number | null
}> {
  let appliedBefore: number | null = null
  let target = 0
  let cumEffective = args.cumProvenCents
  let converged = false
  let blocked = false
  let heldGiveBack = 0
  let writes = 0
  let skips = 0
  const effects: SideEffects = { ...NO_EFFECTS }
  /**
   * What the current attempt COMPUTED, kept across a rollback. A transaction that throws takes its return
   * value with it, so without these a blocked side would report a target of 0 — and a report of 0 on a side
   * that actually owed 2 is exactly the kind of false number this lot exists to remove.
   */
  let attemptedKey: string | null = null
  let lastFailedKey: string | null = null
  let computedTarget: number | null = null
  let computedCumEff: number | null = null
  /** Set when the high-water floor raised a caller's cumulative — i.e. the proven set SHRANK. */
  let floorEngagedFrom: number | null = null
  /** The applied figure the previous pass measured, to notice a write that did not move the ledger. */
  let previousApplied: number | null = null

  for (let attempt = 1; attempt <= CONVERGENCE_ATTEMPTS; attempt++) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        // (a) LOCK the customer row FIRST. Two reconciliations of the same customer serialise here, so the
        //     second one reads the first one's rows instead of racing it to the same delta.
        const locked = await tx.$queryRawUnsafe<Array<{ pointsBalance: number; recoveryOffsetPoints: number }>>(
          'SELECT pointsBalance, recoveryOffsetPoints FROM LoyaltyCustomer WHERE id = ? FOR UPDATE', args.customerId,
        )
        const balance = Math.floor(Number(locked?.[0]?.pointsBalance ?? 0))
        const offset = Math.floor(Number(locked?.[0]?.recoveryOffsetPoints ?? 0))

        // (b) THE BASE, read under the same lock as the applied effect. Reading it outside was a real defect:
        //     a webhook that saw no `earn` row while the delivered transition committed one would compute a
        //     target of 0 against an applied 9 and give 9 points back on a two-thirds refunded order.
        const order = await tx.order.findUnique({
          where:  { id: args.orderId },
          select: { pointsEarned: true, pointsRedeemed: true },
        })
        if (!order) return { kind: 'no_order' as const }
        let base: number
        if (args.side.sign === -1) {
          // D1 precondition: only claw back points that were actually CREDITED. Points are credited at
          // 'delivered' as one 'earn' row; if that row is absent (a refund before delivery) the base is 0, so
          // the target is 0 whatever was refunded — and no key is consumed, because nothing is written.
          const earnTx = await tx.loyaltyTransaction.findFirst({
            where: { orderId: args.orderId, type: 'earn' }, select: { points: true },
          })
          // The base is the ROW's points, not `order.pointsEarned`. They are the same number in every normal
          // case (the transition writes the column's value), but only the ROW is the credit that actually
          // happened — and §11 says to claw back only what was CREDITED. Reading the column instead would let
          // a later edit of `pointsEarned` claw back more points than the customer ever received.
          base = earnTx ? Math.max(0, Math.floor(Number(earnTx.points) || 0)) : 0
        } else {
          base = Math.max(0, Math.floor(order.pointsRedeemed))
        }

        // (c) The effect REALLY applied on this side of this order, and the high-water cumulative.
        const rows = await tx.loyaltyTransaction.findMany({
          where:  { orderId: args.orderId, type: args.side.type },
          select: { points: true, sourceEventId: true },
        })
        const applied = appliedMagnitude(rows, args.side.sign)
        // A proof set can only ever GROW here. A shrinking one (Stripe stops reporting a refund as
        // succeeded, a row is voided) must not quietly hand points back: whether an established clawback
        // should be undone is not a question this writer may answer on its own.
        const cumEff = Math.max(args.cumProvenCents, highWaterCum(rows))
        // The floor ENGAGED: this caller proved less than the order was already reconciled against. Nothing is
        // handed back (that is the point), but it must not read as a clean pass either — a proof set that
        // shrank is itself an anomaly, and `converged: true` with no word about it is exactly the silent
        // outcome this lot exists to remove.
        if (cumEff > args.cumProvenCents) floorEngagedFrom = args.cumProvenCents
        const tgt = loyaltyPointsCumulative(base, args.chargeAmountCents, cumEff)
        if (appliedBefore === null) appliedBefore = applied
        computedTarget = tgt
        computedCumEff = cumEff

        // (d) The difference, and NOTHING when there is none.
        const delta = loyaltyConvergenceDelta({
          base,
          chargeAmountCents: args.chargeAmountCents,
          cumRefundedCents:  cumEff,
          appliedPoints:     applied,
        })
        if (delta === 0) return { kind: 'converged' as const, applied, target: tgt, cumEff }

        // REMOVING effect needs complete proof. A set that is merely what the database can prove is allowed
        // to raise the effect to the target, never to lower it: the missing refund is far likelier than an
        // over-application, and handing back a clawback that was right is money out of the wrong pocket.
        if (delta < 0 && !args.proofComplete) {
          return { kind: 'held' as const, applied, target: tgt, cumEff, held: -delta }
        }
        // AND AN EMPTY PROVEN SET MAY NEVER LOWER ANYTHING, whatever it claims about its completeness. A
        // cumulative of zero beside an applied effect means « I can see no refund at all on an order that was
        // demonstrably reconciled » — which is the definition of evidence one cannot act on, not a licence to
        // give the whole clawback back. This is reachable from the webhook: `charge.refunded` fires at refund
        // CREATION (contract §9.4), so the succeeded set can legitimately be EMPTY on the first delivery while
        // the list call itself succeeded. Without this, that event reversed the entire clawback of a legacy
        // order and reported it as a clean success.
        if (delta < 0 && cumEff <= 0) {
          return { kind: 'held' as const, applied, target: tgt, cumEff, held: -delta }
        }

        // (e) The key IS the proof state: one adjustment per (order, side, cumulative).
        const sourceEventId = `${PRORATA_KEY_PREFIX}${args.orderId}:${cumEff}`
        attemptedKey = sourceEventId
        const e: SideEffects = { ...NO_EFFECTS }
        if (delta > 0) {
          // MORE effect owed. D1: a clawback floors the visible balance at 0 and spills the remainder into
          // the recovery offset (debt). D2: a restore credits the balance and never repays the offset —
          // only future EARNINGS do, by the D3 rule. Both unchanged from Phase 1.
          if (args.side.sign === -1) {
            const { balanceDecrement, offsetIncrease } = applyReversalWithOffset(delta, balance)
            await tx.loyaltyCustomer.update({
              where: { id: args.customerId },
              data:  { pointsBalance: { decrement: balanceDecrement }, recoveryOffsetPoints: { increment: offsetIncrease } },
            })
            e.earnReversed = delta
            e.offsetAdded = offsetIncrease
            // §24 (8), the case the founder DEFERRED and asked to be alerted: a D-15 clawback meeting a debt.
            // Both shapes count — it created one (the points were spent elsewhere) or it landed on a customer
            // who already carried one. `!== 0` and not `> 0`: a NEGATIVE offset means the debt ledger is
            // corrupt (nothing floors it, and the waiver route decrements it without the lock), and a
            // detector that reads a corrupt ledger as « no debt » is a detector that goes quiet exactly when
            // it is needed. Neither composition is certified, so neither is silent.
            e.offsetTouchedT44 = offsetIncrease > 0 || offset !== 0
          } else {
            await tx.loyaltyCustomer.update({
              where: { id: args.customerId }, data: { pointsBalance: { increment: delta } },
            })
            e.spentRestored = delta
            // The D2 side must report the deferred composition too. The CLASSIC D-15 shape is a refund before
            // delivery: the base is 0, so nothing moves on D1 at all and only this branch runs. Leaving it out
            // made the detector silent on exactly the ordering D-15 is named after.
            e.offsetTouchedT44 = offset !== 0
          }
        } else {
          // LESS effect owed than is applied — give exactly the difference back. On the D1 side this is the
          // arithmetic INVERSE of the clawback: unwind the debt it booked before crediting the balance,
          // otherwise the customer holds the points and still owes them. On the D2 side an over-restore is
          // taken back like a clawback, flooring the balance at 0.
          const give = -delta
          if (args.side.sign === -1) {
            // `recoveryOffsetPoints` is a CUSTOMER-level pool: it can hold debt booked by OTHER orders, and
            // repaying those would take a genuinely-owed debt off the books. So the release is bounded by
            // what THIS order's own clawback could have spilled — it never clawed back more than `applied`,
            // so it never put more than `applied` into the pool. Full attribution needs the per-row spill,
            // which this schema does not store: that is a T-44 item, and it is reported as one.
            const attributable = Math.min(offset, Math.max(0, applied))
            const { offsetDecrement, balanceIncrement } = applyGiveBackAgainstOffset(give, attributable)
            await tx.loyaltyCustomer.update({
              where: { id: args.customerId },
              data:  { pointsBalance: { increment: balanceIncrement }, recoveryOffsetPoints: { decrement: offsetDecrement } },
            })
            e.earnReversed = -give
            e.offsetReleased = offsetDecrement
            e.offsetTouchedT44 = offsetDecrement > 0 || offset > 0
          } else {
            // A D2 take-back must NOT invent a debt. The D1 clawback books one because the points it removes
            // were genuinely earned and genuinely spent; an over-RESTORE is our own arithmetic error, and
            // turning it into a debt the customer never owed would make them repay it out of a future
            // earning. So take only what the balance holds, and HOLD the rest: visible, reported, unwritten.
            const takeable = Math.min(give, Math.max(0, balance))
            if (takeable <= 0) return { kind: 'held' as const, applied, target: tgt, cumEff, held: give }
            await tx.loyaltyCustomer.update({
              where: { id: args.customerId }, data: { pointsBalance: { decrement: takeable } },
            })
            e.spentRestored = -takeable
            e.heldRemainder = give - takeable
            e.offsetTouchedT44 = offset !== 0
          }
        }

        // The row is written LAST, carrying the movement that was ACTUALLY applied — so a D2 take-back that
        // could only take part of what it owed records the part, not the wish, and the ledger never claims a
        // movement that did not happen. Order inside the transaction does not affect atomicity: a P2002 here
        // rolls the balance update back with it, and the customer row is locked so nothing interleaves.
        const points = args.side.sign === -1 ? -e.earnReversed : e.spentRestored
        await tx.loyaltyTransaction.create({
          data: {
            customerId: args.customerId, orderId: args.orderId, type: args.side.type,
            points, sourceEventId,
          },
        })
        return { kind: 'written' as const, applied, target: tgt, cumEff, effects: e }
      })

      if (outcome.kind === 'no_order') { converged = true; break }
      target = outcome.target
      cumEffective = outcome.cumEff
      if (outcome.kind === 'converged') { converged = true; break }
      if (outcome.kind === 'held') { heldGiveBack = outcome.held; break }

      // The commit RESOLVED — only now is it true that these points moved.
      writes++
      effects.earnReversed += outcome.effects.earnReversed
      effects.spentRestored += outcome.effects.spentRestored
      effects.offsetAdded += outcome.effects.offsetAdded
      effects.offsetReleased += outcome.effects.offsetReleased
      effects.offsetTouchedT44 = effects.offsetTouchedT44 || outcome.effects.offsetTouchedT44
      // A take-back that could not take everything leaves the side short of its target, by a known amount.
      if (outcome.effects.heldRemainder > 0) { heldGiveBack += outcome.effects.heldRemainder; break }
      // A WRITE THAT DID NOT MOVE THE LEDGER is not something to repeat. If two passes measure the same
      // applied figure after one of them wrote, the row is not readable back — a swallowed write, a replica
      // that lags — and writing the same delta again would move the balance once per attempt while only one
      // row is ever claimed. Stop and let the caller report it.
      if (previousApplied !== null && outcome.applied === previousApplied) break
      previousApplied = outcome.applied
      // Loop once more: the cheap, honest way to prove the target was reached rather than assume it — and if
      // a concurrent writer moved the state meanwhile, this pass corrects for it.
      continue
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // The adjustment for this cumulative already exists. Either a concurrent reconciliation wrote exactly
      // it (the next pass will read it and converge) or something recomputed a DIFFERENT target for the same
      // proof state — an edited base, two callers disagreeing about T — in which case no further attempt can
      // help. Refuse, and let the caller report it; never rewrite a row to force a number.
      skips++
      if (attemptedKey !== null && attemptedKey === lastFailedKey) { blocked = true; break }
      lastFailedKey = attemptedKey
    }
  }

  // A write that landed on the LAST attempt left no budget for the confirming pass, so `converged` would be
  // false on a side that is in fact exactly on target — and a false MONEY REVIEW alert is worse than none,
  // because it teaches an operator to ignore the real ones. One read-only check, no transaction, no write.
  if (!converged && !blocked && writes > 0) {
    try {
      const rows = await db.loyaltyTransaction.findMany({
        where:  { orderId: args.orderId, type: args.side.type },
        select: { points: true, sourceEventId: true },
      })
      if (computedTarget !== null && appliedMagnitude(rows, args.side.sign) === computedTarget) converged = true
    } catch { /* a verification that cannot read proves nothing; the side stays reported as unconverged */ }
  }

  return {
    appliedBefore: appliedBefore ?? 0,
    // A blocked, held or exhausted side reports what it COMPUTED, not the zero it never got to return.
    target:        computedTarget ?? target,
    cumEffective:  computedCumEff ?? cumEffective,
    converged, blocked, heldGiveBack, writes, skips, effects,
    floorEngagedFrom,
  }
}

/**
 * Reconcile the loyalty ledger to the cumulative refund state for one order (L6.1 convergence).
 *
 * Best-effort by contract of its caller: throws are surfaced to the caller, which logs and still returns 200
 * (a loyalty hiccup never fails the webhook / the money path). Returns a summary for observability/tests.
 *
 * MUST be called on the ROOT client: it opens its own transactions.
 */
export async function reconcileLoyaltyOnRefund(db: Db, input: ReconcileInput): Promise<ReconcileResult> {
  const res: ReconcileResult = {
    applied: 0, skipped: 0, earnReversed: 0, spentRestored: 0, offsetAdded: 0, offsetReleased: 0,
    grandfathered: false, converged: true, blocked: false,
    targetEarnReversal: 0, targetSpentRestore: 0,
    appliedEarnReversalBefore: 0, appliedSpentRestoreBefore: 0,
    cumRefundedCents: 0, cumEffectiveCents: 0, cumFlooredFromCents: null, heldGiveBack: 0, offsetDeferredT44: false,
  }

  const order = await db.order.findUnique({
    where:  { id: input.orderId },
    select: { consumerId: true },
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

  // ── GRANDFATHER GUARD (adversarial review E-P1a / F-P1) ──────────────────────
  // A refund handled by the PRE-Phase-1 webhook created ONE 'refund' row with a
  // NULL sourceEventId and fully re-credited pointsRedeemed. Because MySQL treats
  // NULLs as distinct in the unique index, a new keyed 'refund' row would NOT
  // collide with that legacy (NULL,'refund') row → a SECOND refund on such an
  // order would double-credit the spent points AND apply a never-owed earned
  // clawback. So: if the order carries ANY legacy loyalty refund row, its loyalty
  // was already reconciled under the old rules — leave it exactly as it stands
  // (preserve the prior financial/audit evidence; never double-apply, never
  // retroactively rewrite a grandfathered order). New (post-migration) orders have
  // no such marker and reconcile normally.
  // L6.1: unchanged, and checked BEFORE any target is computed — a grandfathered order is not measured
  // against §9 at all, so the convergence can never "correct" what the old rules wrote.
  const legacy = await db.loyaltyTransaction.findFirst({
    where: { orderId: input.orderId, type: 'refund', sourceEventId: null }, select: { id: true },
  })
  if (legacy) { res.grandfathered = true; return res }

  // The proven set, reduced to the one number the target depends on. Deduplicated by `re_`, so the same
  // refund reported by two sources counts once; summed, so no arrival order can change the result.
  const cum = cumulativeRefundedCents(input.refunds)
  res.cumRefundedCents = cum

  const sides: Array<{ side: Side; label: 'earn' | 'spent' }> = [
    { side: SIDE.earn, label: 'earn' },
    { side: SIDE.spent, label: 'spent' },
  ]
  for (const { side, label } of sides) {
    const out = await convergeSide(db, {
      orderId: input.orderId, customerId: lc.id, side,
      chargeAmountCents: input.chargeAmountCents, cumProvenCents: cum,
      proofComplete: input.proofComplete === true,
    })
    res.applied += out.writes
    res.skipped += out.skips
    res.earnReversed += out.effects.earnReversed
    res.spentRestored += out.effects.spentRestored
    res.offsetAdded += out.effects.offsetAdded
    res.offsetReleased += out.effects.offsetReleased
    res.offsetDeferredT44 = res.offsetDeferredT44 || out.effects.offsetTouchedT44
    res.converged = res.converged && out.converged
    res.blocked = res.blocked || out.blocked
    res.heldGiveBack += out.heldGiveBack
    if (out.floorEngagedFrom !== null) res.cumFlooredFromCents = out.floorEngagedFrom
    res.cumEffectiveCents = Math.max(res.cumEffectiveCents, out.cumEffective)
    if (label === 'earn') {
      res.targetEarnReversal = out.target
      res.appliedEarnReversalBefore = out.appliedBefore
    } else {
      res.targetSpentRestore = out.target
      res.appliedSpentRestoreBefore = out.appliedBefore
    }
  }

  // NO SILENT LOSS. A side that did not reach its target leaves a customer's balance wrong by a known
  // amount; it is reported here, at the one place all three callers go through, rather than at each of them.
  // An alert that cannot be sent never changes what is booked.
  // A SHRUNKEN PROOF SET is reported even when the floor made the pass write nothing. « Converged » is then
  // true and correct — the order IS on the target of everything it was ever reconciled against — but a caller
  // that can no longer prove what it once proved is a fact a human needs, not a silence.
  if (res.cumFlooredFromCents !== null) {
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'loyalty_proof_set_shrank',
        dedupeKey: `loyalty:${input.orderId}:shrank:${res.cumFlooredFromCents}:${res.cumEffectiveCents}`,
        title:     'Ensemble de remboursements prouvé PLUS PETIT que celui déjà réconcilié',
        facts:     {
          orderId:            input.orderId,
          provenCents:        res.cumFlooredFromCents,
          reconciledAgainst:  res.cumEffectiveCents,
          proofComplete:      input.proofComplete === true,
          targetEarnReversal: res.targetEarnReversal,
          targetSpentRestore: res.targetSpentRestore,
          note:               'aucun point n’a été rendu (plancher haut) ; un remboursement que Stripe ou la base prouvait a cessé de l’être — décision humaine',
          moneyMoved:         false,
        },
      })
    } catch { /* the console line inside the sender is the primary channel */ }
  }

  if (!res.converged) {
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'loyalty_target_unconverged',
        dedupeKey: `loyalty:${input.orderId}:unconverged:${res.cumEffectiveCents}`,
        title:     res.heldGiveBack > 0
          ? 'Reprise fidélité RETENUE — preuve incomplète (l’effet appliqué dépasse la cible de cet ensemble)'
          : res.blocked
            ? 'Cible fidélité non atteinte — ajustement déjà écrit pour ce cumul (dénominateur ou base divergents)'
            : 'Cible fidélité cumulative non atteinte',
        facts:     {
          orderId:            input.orderId,
          blocked:            res.blocked,
          heldGiveBack:       res.heldGiveBack,
          proofComplete:      input.proofComplete === true,
          cumRefundedCents:   res.cumRefundedCents,
          cumEffectiveCents:  res.cumEffectiveCents,
          chargeAmountCents:  input.chargeAmountCents,
          targetEarnReversal: res.targetEarnReversal,
          targetSpentRestore: res.targetSpentRestore,
          appliedEarnReversalBefore: res.appliedEarnReversalBefore,
          appliedSpentRestoreBefore: res.appliedSpentRestoreBefore,
          attempts:           CONVERGENCE_ATTEMPTS,
          note:               res.heldGiveBack > 0
            ? 'rien n’a été rendu : cet ensemble vient de la BASE et ne prouve pas l’absence d’un remboursement (Dashboard non encore reçu). Une passe à preuve complète (webhook charge.refunded) tranchera, sinon décision humaine.'
            : res.blocked
              ? 'aucune ligne n’est réécrite pour forcer un chiffre — décision humaine'
              : 'la passe a épuisé ses tentatives',
          repair:             'POST /api/admin/loyalty/reconcile { orderId }',
          moneyMoved:         false,
        },
      })
    } catch { /* the console line inside the sender is the primary channel */ }
  }

  // T-44 PRE-LIVE. The give-back had to unwind a recovery-offset debt (or a take-back had to create one), and
  // the composition of D-15 with the D3 debt contract is DEFERRED: the arithmetic inverse is applied (so the
  // customer never holds points they still owe), and a human confirms it. The D3 RULE is not rewritten here.
  if (res.offsetDeferredT44) {
    try {
      await sendAdminMoneyReviewAlert({
        kind:      'loyalty_offset_t44_review',
        dedupeKey: `loyalty:${input.orderId}:offset-t44:${res.cumEffectiveCents}`,
        title:     'Reprise fidélité touchant une dette recovery offset (composition différée T-44)',
        facts:     {
          orderId:           input.orderId,
          cumEffectiveCents: res.cumEffectiveCents,
          offsetReleased:    res.offsetReleased,
          offsetAdded:       res.offsetAdded,
          earnReversed:      res.earnReversed,
          spentRestored:     res.spentRestored,
          note:              'inverse arithmétique appliqué ; la composition D-15 × recoveryOffsetPoints n’est PAS certifiée (T-44 PRE-LIVE)',
          moneyMoved:        false,
        },
      })
    } catch { /* idem */ }
  }

  return res
}

// Keep the Prisma namespace import meaningful for consumers/tests without a hard dep.
export type { Prisma }
