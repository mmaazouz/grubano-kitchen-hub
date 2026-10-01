'use strict'
/* ─────────────────────────────────────────────────────────────────────────────
   lib/claims-payable-core.js — THE definition of « which claims the financial
   rail may pay », and nothing else. D′ lot L5 (spec v2 §8.5, §8.8).

   Plain CommonJS on purpose, exactly like lib/ledger-check-core.js: it is the
   SINGLE implementation used by
     • lib/claims.ts                                   — the admin queue « À rembourser » ;
     • app/api/admin/claims/pay-approved/route.ts      — the dryRun selection ;
     • scripts/server/phase2-claims-pay-window.js      — the operator precheck, which runs
       on the server under plain node, where no TypeScript build exists.
   Shipped to the server by the deploy (deploy-temp/lib/).

   WHY ONE FILE. The operator decides whether to OPEN a refund window by counting what
   the rail would pay. If the operator's idea of « payable » were a second copy of the
   query, a window could be opened for a set the rail then refuses — or, worse, closed
   while the rail still had work. The two must be the same sentence, so there is only
   one sentence.

   WHAT THIS FILE NEVER DOES: no auth, no env read, no Stripe, no write of any kind, no
   decision about MONEY BEING ALLOWED (that is the REFUNDS lease, lib/refund
   refundGateState, read by the caller before each claim). It only says which rows are
   candidates, in which order, and how many.
   ───────────────────────────────────────────────────────────────────────────── */

/** Spec v2 §8.5 — a batch never exceeds 20 claims, wherever the number comes from. */
const MAX_BATCH = 20

/**
 * APPROVED_AWAITING_PAYMENT (spec v2 §2.1): Grubano decided, with an amount, and the rail has
 * not touched it yet. Every clause is load-bearing:
 *   status/arbitrationDecision 'approved' — a human decision, never a machine one (S-02) ;
 *   refundAttempted false, refundId null  — no attempt has been made and nothing is bound ;
 *   refundError null                      — NO recorded money state. A v13 proof is a recorded
 *                                           state: it is excluded here and payable only through
 *                                           an explicit claimIds list, after its instant (S-14b) ;
 *   approvedAmountCents not null          — an amount was ratified. Without one the engine
 *                                           refuses with amount_not_ratified and 0 writes (S-27).
 */
const PAYABLE_WHERE = Object.freeze({
  status:              'approved',
  arbitrationDecision: 'approved',
  refundAttempted:     false,
  refundId:            null,
  refundError:         null,
  approvedAmountCents: { not: null },
})

/** FIFO by the instant Grubano decided; `createdAt` breaks ties deterministically (spec v2 §8.5). */
const PAYABLE_ORDER_BY = Object.freeze([{ arbitratedAt: 'asc' }, { createdAt: 'asc' }])

/** Projection: identity, money and decision instants only — no consumer, no free text of the claim. */
const PAYABLE_SELECT = Object.freeze({
  id:                   true,
  orderId:              true,
  requestedAmountCents: true,
  approvedAmountCents:  true,
  arbitratedAt:         true,
  arbitrationReason:    true,
  createdAt:            true,
})

/** 1 ≤ take ≤ MAX_BATCH, whatever a caller (or a request body) asks for. */
function clampTake(take) {
  const n = Number(take)
  if (!Number.isFinite(n)) return MAX_BATCH
  return Math.min(Math.max(1, Math.floor(n)), MAX_BATCH)
}

/**
 * The one query. `prisma` is any client exposing `claim.findMany` — the app singleton, an
 * operator's own PrismaClient, or a test double. Read-only by construction.
 */
async function selectPayableClaims(prisma, options) {
  const take = clampTake(options && options.take)
  return prisma.claim.findMany({
    where:   PAYABLE_WHERE,
    orderBy: PAYABLE_ORDER_BY,
    take,
    select:  PAYABLE_SELECT,
  })
}

/**
 * S-10, re-checked on a row the caller just re-read: the amount must still be an integer in
 * [1, requestedAmountCents]. Returns null when it holds, or the reason it does not.
 *
 * The engine re-checks this itself before its attempt CAS (T1, spec v2 §8.3) and refuses with
 * `amount_not_ratified` and zero writes. This helper exists so the dryRun and the operator can
 * say the same thing BEFORE anything is attempted, never to replace that refusal.
 */
function approvedAmountRefusal(row) {
  if (!row) return 'missing'
  const a = row.approvedAmountCents
  const r = row.requestedAmountCents
  if (a === null || a === undefined) return 'amount_not_ratified'
  if (!Number.isInteger(a) || a <= 0) return 'amount_not_ratified'
  if (!Number.isInteger(r) || a > r) return 'amount_above_requested'
  return null
}

/** Σ of the approved amounts, in cents, as integers. Used by the T-42 funding precheck. */
function sumApprovedCents(rows) {
  let total = 0
  for (const r of rows || []) total += Number(r.approvedAmountCents) || 0
  return total
}

/**
 * The identity a dryRun signs and a PAYER re-checks (spec v2 §8.2): the claim, the amount that
 * was decided, and the instant it was decided. If any of the three moved between the two calls,
 * the item is `skipped:stale_dryrun` and nothing is attempted.
 */
function itemIdentity(row) {
  return {
    claimId:             row.id,
    approvedAmountCents: row.approvedAmountCents,
    arbitratedAt:        row.arbitratedAt ? new Date(row.arbitratedAt).toISOString() : null,
  }
}

/** true ⇔ the freshly re-read row still carries exactly the identity the dryRun signed. */
function sameIdentity(signed, row) {
  if (!signed || !row) return false
  const now = itemIdentity(row)
  return signed.claimId === now.claimId
    && signed.approvedAmountCents === now.approvedAmountCents
    && (signed.arbitratedAt ?? null) === now.arbitratedAt
}

module.exports = {
  MAX_BATCH,
  PAYABLE_WHERE,
  PAYABLE_ORDER_BY,
  PAYABLE_SELECT,
  clampTake,
  selectPayableClaims,
  approvedAmountRefusal,
  sumApprovedCents,
  itemIdentity,
  sameIdentity,
}
