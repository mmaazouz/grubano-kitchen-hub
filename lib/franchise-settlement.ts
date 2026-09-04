import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { recordPartnerTransferLedgerEntry } from '@/lib/ledger'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'

// ── Franchise royalty SETTLEMENT (rail financier P4-Franchise-B, Agent 42) ───────
//
// Disburses a franchisor's accrued FranchiseRoyalty 'pending' lines (the held-back
// 6% accrued by Franchise-A at orders/pay) to the franchisor's Stripe Connect account
// via a REAL Stripe Transfer (TEST mode), records a Payout (role='franchise'), and
// marks the lines 'settled'. Gated OFF by default. 100% PASS-THROUGH: the transfer is
// the EXACT sum of the claimed royaltyCents — Grubano retains NOTHING (transfers.create
// takes no application_fee). THIS MOVES REAL MONEY (in TEST) → idempotence + atomicity
// are the whole point.
//
// ANTI-DOUBLE-SETTLEMENT — a line is settled AT MOST ONCE, via 5 layers:
//   1. ATOMIC CLAIM: one UPDATE moves a franchisor's 'pending' lines to 'settling' +
//      stamps a fresh settlementId. Concurrent runs race on this single statement →
//      each line is claimed by EXACTLY ONE run (the loser claims a disjoint/empty set).
//      Relies on InnoDB/MySQL (the frozen stack) locking-read UPDATE semantics: a
//      concurrent UPDATE blocks then re-evaluates WHERE on the committed version, so a
//      row already flipped to 'settling' is not re-claimed (→ claim.count for the loser).
//   2. Payout.idempotencyKey @unique = `franchise:<operatorId>:<settlementId>` → only
//      ONE Payout row can ever exist per batch (a concurrent create → P2002 → reuse).
//   3. The Stripe Transfer uses that SAME key as its idempotency key → within Stripe's
//      ~24h key-retention window a retry returns the SAME transfer (no second movement).
//   4. RECONCILE-ON-RESUME (the >24h backstop, durable): the transfer carries a
//      transfer_group = `frset_<settlementId>`. Before (re)transferring a batch whose
//      Payout was NOT freshly created by THIS call (i.e. a resume / a contested create),
//      we LIST Stripe transfers by that group; if one already exists we ADOPT it (mark
//      paid + settle) WITHOUT a new transfer. transfer_group survives indefinitely, so
//      this closes the window even after the 24h idempotency key has expired — covering
//      "transfer succeeded but the mark-paid DB write failed / the create response was
//      lost". (The fresh path skips the LIST: a brand-new random settlementId can have
//      no prior transfer, and concurrent dups within 24h are caught by layer 3.)
//   5. ATOMIC FINALIZE: mark the Payout 'paid' (with stripeTransferId) AND mark the
//      lines 'settled' in ONE prisma.$transaction → a batch is never half-finalized.
//
// State machine per line: pending → settling (claimed) → settled (disbursed). A line is
// reverted out of 'settling' ONLY by the synchronous below-threshold rollback (before any
// Payout/transfer); on any post-transfer failure the batch stays 'settling'/Payout
// 'pending' (recoverable), NEVER 'settled' without a real disbursement.
//
// Amount = server-computed sum of the claimed lines' NON-REFUNDED royalty
// (royaltyCents − refundedCents), cent-exact, NEVER a client input. Below the
// threshold → skip. Franchisor must have an ACTIVE Connect account (P4.1) → else skip.
//
// REFUND-AWARE (P4.5-A, Agent 49): a 'pending' royalty partially refunded settles
// ONLY on its non-refunded part — every amount/threshold here nets refundedCents (set
// by lib/refund.executeRefund). BYTE-IDENTICAL while no line has refundedCents > 0
// (Math.max(0, royaltyCents − 0) = royaltyCents everywhere). A refund AFTER settlement
// is the OTHER direction (the slice already left for the franchisor): lib/refund claws
// it back via transfers.createReversal — NOT here. A line fully refunded before
// settlement (net 0) is marked 'settled' with no transfer.

export function isFranchiseSettlementEnabled(): boolean {
  return process.env.FRANCHISE_SETTLEMENT_ENABLED === 'true'
}

/** Minimum settlement (cents). Default 0 = settle any positive pending batch.
 *  env FRANCHISE_SETTLEMENT_MIN_CENTS. */
export function minSettlementCents(): number {
  const v = Number.parseInt(process.env.FRANCHISE_SETTLEMENT_MIN_CENTS ?? '', 10)
  return Number.isFinite(v) && v >= 0 ? v : 0
}

export type SettlementOutcome =
  | { status: 'settled'; operatorId: string; amountCents: number; lineCount: number; stripeTransferId: string; settlementId: string; resumed: boolean }
  | { status: 'skipped'; operatorId: string; reason: string }
  | { status: 'failed';  operatorId: string; reason: string }

type ClaimedLine    = { id: string; royaltyCents: number; refundedCents: number; settlementId: string | null }
type FranchisorRef  = { id: string; stripeAccountId: string }
type BatchPayout    = { id: string; amountCents: number; currency: string; status: string; stripeTransferId: string | null }

const PAYOUT_SELECT = { id: true, amountCents: true, currency: true, status: true, stripeTransferId: true } as const
const LINE_SELECT   = { id: true, royaltyCents: true, refundedCents: true, settlementId: true } as const

/** Royalty STILL owed to the franchisor for one line = held-back minus what was
 *  refunded to the customer (P4.5-A). `refundedCents` is null/absent on legacy rows
 *  and pre-refund rows → 0 → byte-identical to the raw royaltyCents. */
const netOwedCents = (l: { royaltyCents: number; refundedCents?: number | null }): number =>
  Math.max(0, l.royaltyCents - (l.refundedCents ?? 0))

const transferGroupOf = (settlementId: string) => `frset_${settlementId}`

/** Mark every still-'settling' line of a batch as 'settled' (idempotent — a second
 *  call matches 0 rows). Used by the 'already paid' guard. */
async function markLinesSettled(settlementId: string, payoutId: string): Promise<void> {
  await prisma.franchiseRoyalty.updateMany({
    where: { settlementId, status: 'settling' },
    data:  { status: 'settled', settledAt: new Date(), payoutId },
  })
}

/** ATOMIC finalize: mark the Payout 'paid' (+ transfer id) AND settle its lines in ONE
 *  transaction, so the batch is never half-finalized. Idempotent: a re-run updates the
 *  already-'paid' Payout to the same values and matches 0 still-'settling' lines. */
async function finalizePaid(payoutId: string, transferId: string, settlementId: string): Promise<void> {
  await prisma.$transaction([
    prisma.payout.update({ where: { id: payoutId }, data: { status: 'paid', paidAt: new Date(), stripeTransferId: transferId } }),
    prisma.franchiseRoyalty.updateMany({ where: { settlementId, status: 'settling' }, data: { status: 'settled', settledAt: new Date(), payoutId } }),
  ])
}

/** LEDGER TRACE (rail A3) — RECORD an already-finalized franchise payout, append-only &
 *  idempotent. PURE ADD-ON, mirroring lib/creator-payout.payPartner (Agent 84): it RECORDS
 *  the (already-'paid', already-persisted) disbursement; it NEVER moves money, NEVER alters
 *  the transfer/Payout, and recordPartnerTransferLedgerEntry NEVER throws (it catches
 *  internally) — its result is NOT folded into the SettlementOutcome, so removing this whole
 *  function leaves every settled path BYTE-IDENTICAL. Idempotent on the Payout id
 *  (@@unique([sourceEventId,'partner_transfer'])): a resume / re-driven finalize → silent
 *  duplicate, never a 2nd line. restaurantId carries the FRANCHISOR operator id (beneficiary),
 *  NEVER a Restaurant.id → every restaurantId-scoped ledger reader stays neutral (identical
 *  shape to the affiliate trace already shipped by Agent 84). A failure is logged
 *  ([LEDGER MISS]) for manual reconciliation — it must never block or undo a settled batch. */
async function recordFranchisePayoutTrace(p: BatchPayout, ref: FranchisorRef, transferId: string | null): Promise<void> {
  if (!transferId) return // no transfer reference (e.g. nothing was moved) → nothing to trace
  // Belt-and-suspenders best-effort: recordPartnerTransferLedgerEntry already NEVER throws
  // (it catches internally), and this extra try/catch GUARANTEES that even a hypothetical
  // throw can never propagate to the settlement caller — a ledger MISS must never undo a
  // settled batch.
  try {
    const led = await recordPartnerTransferLedgerEntry({
      payoutId:             p.id,
      role:                 'franchise',
      beneficiaryId:        ref.id,            // franchisor OPERATOR id — never a Restaurant.id
      amountCents:          p.amountCents,
      currency:             p.currency,
      stripeTransferId:     transferId,
      destinationAccountId: ref.stripeAccountId,
    })
    if (!led.ok) {
      console.error(`[LEDGER MISS] partner_transfer payout=${p.id} role=franchise ref=${ref.id}: ${led.error}`)
    }
  } catch (err) {
    console.error(`[LEDGER MISS] partner_transfer payout=${p.id} role=franchise ref=${ref.id}: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Disburse a CLAIMED batch (lines already 'settling' under `settlementId`): create the
 * 'pending' Payout (idempotent on its key), transfer the sum, then atomically mark the
 * Payout 'paid' and the lines 'settled'. Throws on Stripe/DB failure → caller leaves the
 * batch 'settling'/'pending' (recoverable). NEVER double-transfers: layer 3 (Stripe key)
 * covers ≤24h; layer 4 (transfer_group reconciliation) covers >24h.
 */
async function finalizeBatch(
  ref: FranchisorRef, settlementId: string, lines: ClaimedLine[], resumed: boolean,
): Promise<SettlementOutcome> {
  // REFUND-AWARE sum: only the NON-refunded royalty is owed (byte-identical to
  // Σ royaltyCents while no line was refunded). NEVER a client input.
  const amount = lines.reduce((s, l) => s + netOwedCents(l), 0)
  const idempotencyKey = `franchise:${ref.id}:${settlementId}`
  const transferGroup  = transferGroupOf(settlementId)

  // Nothing to disburse: an empty claimed set (concurrent orphan-heal loser) OR a
  // batch whose lines are all fully refunded (net 0). Mark any such 'settling' lines
  // 'settled' (no transfer — nothing is owed) so they don't linger, then skip BEFORE
  // creating any Payout/transfer. Without refunds, real batches always sum > 0.
  if (amount <= 0) {
    await prisma.franchiseRoyalty.updateMany({
      where: { settlementId, status: 'settling' },
      data:  { status: 'settled', settledAt: new Date() },
    })
    return { status: 'skipped', operatorId: ref.id, reason: 'nothing_to_settle' }
  }

  // Create-or-find the Payout (BEFORE the transfer). @unique(idempotencyKey) makes the
  // create idempotent: a concurrent finalize → P2002 → reuse the existing row.
  let payout = await prisma.payout.findUnique({ where: { idempotencyKey }, select: PAYOUT_SELECT })
  let fresh = false
  if (!payout) {
    try {
      payout = await prisma.payout.create({
        data: { role: 'franchise', operatorId: ref.id, amountCents: amount, currency: 'eur', status: 'pending', idempotencyKey },
        select: PAYOUT_SELECT,
      })
      fresh = true
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        payout = await prisma.payout.findUnique({ where: { idempotencyKey }, select: PAYOUT_SELECT })
      } else {
        throw err
      }
    }
  }
  if (!payout) throw new Error('payout_unavailable')
  const p: BatchPayout = payout

  // Already fully disbursed (finalize ran before) → just ensure the lines are settled.
  if (p.status === 'paid') {
    await markLinesSettled(settlementId, p.id)
    await recordFranchisePayoutTrace(p, ref, p.stripeTransferId) // best-effort, idempotent (recovery on resume)
    await detectOverTransfer(ref.id, settlementId, p.amountCents, p.stripeTransferId) // D-G v2 (§15 A5)
    return { status: 'settled', operatorId: ref.id, amountCents: p.amountCents, lineCount: lines.length, stripeTransferId: p.stripeTransferId ?? '', settlementId, resumed }
  }

  // The Payout pre-existed (resume, or a concurrent create won the @unique race): a
  // transfer for this batch MAY already exist. Reconcile DURABLY against Stripe before
  // (re)transferring — this is the >24h backstop. (Skipped on the fresh path: a brand-new
  // random settlementId can have no prior transfer.)
  if (!fresh) {
    // RECONCILE FIRST (the >24h backstop): if a transfer for this batch already executed,
    // ADOPT it — record paid + settle WITHOUT a new transfer. Done before the amount check
    // so an already-moved batch is always reconciled, even if the re-summed lines drifted.
    const existing = await getStripe().transfers.list({ transfer_group: transferGroup, limit: 1 })
    if (existing.data.length > 0) {
      await finalizePaid(p.id, existing.data[0].id, settlementId)
      await recordFranchisePayoutTrace(p, ref, existing.data[0].id) // best-effort, after 'paid'
      await detectOverTransfer(ref.id, settlementId, p.amountCents, existing.data[0].id) // D-G v2 (§15 A5)
      return { status: 'settled', operatorId: ref.id, amountCents: p.amountCents, lineCount: lines.length, stripeTransferId: existing.data[0].id, settlementId, resumed }
    }
    // No prior transfer → we are about to create one: the disbursed amount is the FROZEN
    // Payout.amountCents; if the re-summed claimed lines no longer match it, a refund (or a
    // lost dispute) landed on a claimed line — fail WITHOUT moving money. PHASE 2 (D-G v2,
    // REFUND-FINANCIAL-CONTRACT §10.A): the amount is NOT re-planned (the shared Stripe
    // idempotency key is the only guard against a concurrent run transferring the frozen
    // amount; re-keying would re-open a double transfer) and the batch is NOT reverted
    // (unsafe while a concurrent run may still transfer) — it is DETECTED and ALERTED
    // (`amount_drift`, MONEY REVIEW) for a human decision, never silent.
    if (amount !== p.amountCents) {
      console.error(`[franchise settlement] amount drift for ${idempotencyKey}: lines=${amount} payout=${p.amountCents} — NOT transferring`)
      try {
        await sendAdminMoneyReviewAlert({
          kind:      'settlement_amount_drift',
          dedupeKey: `settlement:${settlementId}:${amount}`,
          title:     'Règlement franchise bloqué — montant figé ≠ lignes vivantes',
          facts:     { franchisorOperatorId: ref.id, settlementId, payoutId: p.id, frozenPayoutCents: p.amountCents, liveOwedCents: amount, deltaCents: p.amountCents - amount, action: 'aucun transfert effectué ; lot laissé en « settling » — décision humaine requise' },
        })
      } catch { /* best-effort */ }
      return { status: 'failed', operatorId: ref.id, reason: 'amount_drift' }
    }
  }

  // PASS-THROUGH: a pure Transfer of the exact batch sum to the franchisor — NO
  // application_fee, nothing retained by Grubano. transfer_group enables the >24h
  // reconciliation above; the deterministic idempotency key dedupes within 24h.
  const transfer = await getStripe().transfers.create(
    {
      amount:         p.amountCents,
      currency:       p.currency,
      destination:    ref.stripeAccountId,
      transfer_group: transferGroup,
      metadata:       { franchisorOperatorId: ref.id, settlementId, payoutId: p.id },
    },
    { idempotencyKey },
  )
  await finalizePaid(p.id, transfer.id, settlementId)
  await recordFranchisePayoutTrace(p, ref, transfer.id) // best-effort, after 'paid'
  // PHASE 2 (D-G v2, §10.A / §16 B7): AFTER the money moved and the batch is finalized,
  // re-read the batch lines — a refundedCents bump that landed between the claim and the
  // transfer means the franchisor was over-paid by that slice. Detected + alerted (human
  // clawback), never silent, never throws.
  await detectOverTransfer(ref.id, settlementId, p.amountCents, transfer.id)
  return { status: 'settled', operatorId: ref.id, amountCents: p.amountCents, lineCount: lines.length, stripeTransferId: transfer.id, settlementId, resumed }
}

/**
 * PHASE 2 — D-G v2 detection (REFUND-FINANCIAL-CONTRACT §10.A, §15 A5). Re-read EVERY line
 * of the batch by settlementId regardless of status (settled/settling — `markLinesSettled`
 * only flips status; only the pre-payout below-threshold rollback nulls settlementId) and
 * compare the live Σ netOwed with what was transferred. `refundedCents` is monotone, so
 * live ≤ transferred; a strict `<` is exactly an over-transfer caused by a refund (or lost
 * dispute) that landed after the claim → MONEY REVIEW + admin alert with the exact delta.
 * Read-only, best-effort, NEVER throws (the settlement outcome is already final).
 */
async function detectOverTransfer(operatorId: string, settlementId: string, transferredCents: number, stripeTransferId: string | null): Promise<void> {
  try {
    const live = await prisma.franchiseRoyalty.findMany({
      where:  { settlementId },
      select: { id: true, royaltyCents: true, refundedCents: true },
    })
    const liveOwedCents = live.reduce((s, l) => s + netOwedCents(l), 0)
    if (liveOwedCents < transferredCents) {
      await sendAdminMoneyReviewAlert({
        kind:      'settlement_over_transfer',
        dedupeKey: `settlement:${settlementId}:${liveOwedCents}`,
        title:     'Franchiseur sur-payé — remboursement arrivé pendant le règlement',
        facts:     { franchisorOperatorId: operatorId, settlementId, stripeTransferId, transferredCents, liveOwedCents, deltaCents: transferredCents - liveOwedCents, lines: live.length, action: 'reprise humaine du delta auprès du franchiseur (transfer reversal) — aucune action automatique' },
      })
    }
  } catch (e) {
    console.error('[franchise settlement] [MONEY REVIEW] over-transfer detection failed (settlement unaffected):', settlementId, e instanceof Error ? e.message : e)
  }
}

/**
 * Settle ONE franchisor's pending royalties. Safe to call repeatedly / concurrently /
 * on a schedule — never settles the same line twice.
 */
export async function settleFranchisor(operatorId: string): Promise<SettlementOutcome> {
  const op = await prisma.operator.findUnique({
    where:  { id: operatorId },
    select: { id: true, franchiseStripeAccountId: true, franchisePayoutStatus: true },
  })
  if (!op) return { status: 'skipped', operatorId, reason: 'operator_not_found' }
  if (!op.franchiseStripeAccountId || op.franchisePayoutStatus !== 'active') {
    return { status: 'skipped', operatorId, reason: 'no_active_connect' }
  }
  const ref: FranchisorRef = { id: op.id, stripeAccountId: op.franchiseStripeAccountId }

  // 1. RESUME any interrupted batch first (lines already claimed 'settling'). Re-driven
  //    with its OWN settlementId → same key + transfer_group → no second transfer.
  const settling = await prisma.franchiseRoyalty.findMany({
    where:   { franchisorOperatorId: operatorId, status: 'settling' },
    orderBy: { createdAt: 'asc' },
    select:  LINE_SELECT,
  })
  if (settling.length > 0) {
    let settlementId = settling.find((l) => l.settlementId)?.settlementId ?? null
    let batch: ClaimedLine[]
    if (settlementId) {
      batch = settling.filter((l) => l.settlementId === settlementId)
    } else {
      // Self-heal an orphaned claim ('settling' rows with no settlementId — unreachable
      // via this code, only a manual DB edit / partial write). Adopt them into a fresh id
      // instead of stranding the franchisor's batch as permanently 'failed'.
      settlementId = randomUUID()
      await prisma.franchiseRoyalty.updateMany({
        where: { franchisorOperatorId: operatorId, status: 'settling', settlementId: null },
        data:  { settlementId },
      })
      batch = await prisma.franchiseRoyalty.findMany({
        where: { franchisorOperatorId: operatorId, status: 'settling', settlementId }, select: LINE_SELECT,
      })
    }
    try {
      return await finalizeBatch(ref, settlementId, batch, true)
    } catch {
      return { status: 'failed', operatorId, reason: 'transfer_failed_resume' }
    }
  }

  // 2. NORMAL — pre-check the threshold on PENDING (read-only), then CLAIM atomically.
  // Refund-aware: compare the NON-refunded sum (Σ royaltyCents − Σ refundedCents) —
  // byte-identical to Σ royaltyCents while nothing was refunded.
  const agg = await prisma.franchiseRoyalty.aggregate({
    where: { franchisorOperatorId: operatorId, status: 'pending' },
    _sum:  { royaltyCents: true, refundedCents: true },
    _count: true,
  })
  if (agg._count === 0) return { status: 'skipped', operatorId, reason: 'nothing_pending' }
  const pendingNetCents = (agg._sum.royaltyCents ?? 0) - (agg._sum.refundedCents ?? 0)
  if (pendingNetCents < minSettlementCents()) {
    return { status: 'skipped', operatorId, reason: 'below_threshold' }
  }

  // ATOMIC CLAIM — one UPDATE; concurrent runs get disjoint sets (the loser claims 0).
  const settlementId = randomUUID()
  const claim = await prisma.franchiseRoyalty.updateMany({
    where: { franchisorOperatorId: operatorId, status: 'pending' },
    data:  { status: 'settling', settlementId },
  })
  if (claim.count === 0) return { status: 'skipped', operatorId, reason: 'nothing_pending' }

  const lines = await prisma.franchiseRoyalty.findMany({
    where:  { franchisorOperatorId: operatorId, status: 'settling', settlementId }, select: LINE_SELECT,
  })

  // Re-validate the threshold against the ACTUALLY-claimed sum (the pre-check set can be
  // shrunk by a concurrent run between the aggregate and the claim). Revert + skip BEFORE
  // any Payout/transfer if the claimed batch fell below the threshold.
  const claimedSum = lines.reduce((s, l) => s + netOwedCents(l), 0)
  if (claimedSum < minSettlementCents()) {
    await prisma.franchiseRoyalty.updateMany({
      where: { settlementId, status: 'settling' },
      data:  { status: 'pending', settlementId: null },
    })
    return { status: 'skipped', operatorId, reason: 'below_threshold' }
  }

  try {
    return await finalizeBatch(ref, settlementId, lines, false)
  } catch {
    // Transfer or DB finalize failed → batch stays 'settling' / Payout 'pending'
    // (recoverable on re-run via RESUME). Layers 3+4 prevent a double on retry.
    return { status: 'failed', operatorId, reason: 'transfer_failed' }
  }
}

export type SettlementRunSummary = {
  processed: number
  settled:   number
  skipped:   number
  failed:    number
  results:   SettlementOutcome[]
}

/**
 * Batch: settle every franchisor that has pending OR interrupted ('settling') royalties.
 * settleFranchisor enforces the active-Connect prerequisite, the threshold and the
 * idempotency, so this is safe to re-run. Sequential to avoid intra-run races and Stripe
 * rate spikes.
 */
export async function runFranchiseSettlements(): Promise<SettlementRunSummary> {
  const rows = await prisma.franchiseRoyalty.findMany({
    where:    { status: { in: ['pending', 'settling'] } },
    select:   { franchisorOperatorId: true },
    distinct: ['franchisorOperatorId'],
  })
  const summary: SettlementRunSummary = { processed: 0, settled: 0, skipped: 0, failed: 0, results: [] }
  for (const r of rows) {
    const out = await settleFranchisor(r.franchisorOperatorId)
    summary.processed++
    summary[out.status === 'settled' ? 'settled' : out.status === 'failed' ? 'failed' : 'skipped']++
    summary.results.push(out)
  }
  return summary
}
