import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

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
// Amount = server-computed sum of the claimed lines' royaltyCents (the real held-back),
// cent-exact, NEVER a client input. Below the threshold → skip. Franchisor must have an
// ACTIVE Connect account (P4.1) → else skip with a reason.
//
// NOT handled here (FLAGGED for later bricks): a refund/cancellation of an order whose
// royalty is still 'pending' is NOT detected/skipped — franchised orders keep their
// status/paymentStatus on refund (only a ledger line is written), so refund-aware
// settlement is not cleanly separable from clawback proration (= P4.5). We settle on the
// stored royaltyCents; reconciliation against the PI metadata (Franchise-A's rare
// double-clamp cents divergence) is also deferred to P4.5.

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

type ClaimedLine    = { id: string; royaltyCents: number; settlementId: string | null }
type FranchisorRef  = { id: string; stripeAccountId: string }
type BatchPayout    = { id: string; amountCents: number; currency: string; status: string; stripeTransferId: string | null }

const PAYOUT_SELECT = { id: true, amountCents: true, currency: true, status: true, stripeTransferId: true } as const
const LINE_SELECT   = { id: true, royaltyCents: true, settlementId: true } as const

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
  const amount = lines.reduce((s, l) => s + l.royaltyCents, 0)
  const idempotencyKey = `franchise:${ref.id}:${settlementId}`
  const transferGroup  = transferGroupOf(settlementId)

  // Nothing to disburse (e.g. a concurrent orphan-heal loser claimed an empty set) → skip
  // before creating any Payout/transfer. Real batches always sum > 0 (royaltyCents > 0).
  if (amount <= 0) return { status: 'skipped', operatorId: ref.id, reason: 'nothing_to_settle' }

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
      return { status: 'settled', operatorId: ref.id, amountCents: p.amountCents, lineCount: lines.length, stripeTransferId: existing.data[0].id, settlementId, resumed }
    }
    // No prior transfer → we are about to create one: the disbursed amount is the FROZEN
    // Payout.amountCents; if the re-summed claimed lines no longer match it, a downstream
    // invariant broke — fail loudly WITHOUT moving money rather than transfer a wrong amount.
    if (amount !== p.amountCents) {
      console.error(`[franchise settlement] amount mismatch for ${idempotencyKey}: lines=${amount} payout=${p.amountCents} — NOT transferring`)
      return { status: 'failed', operatorId: ref.id, reason: 'amount_mismatch' }
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
  return { status: 'settled', operatorId: ref.id, amountCents: p.amountCents, lineCount: lines.length, stripeTransferId: transfer.id, settlementId, resumed }
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
  const agg = await prisma.franchiseRoyalty.aggregate({
    where: { franchisorOperatorId: operatorId, status: 'pending' },
    _sum:  { royaltyCents: true },
    _count: true,
  })
  if (agg._count === 0) return { status: 'skipped', operatorId, reason: 'nothing_pending' }
  if ((agg._sum.royaltyCents ?? 0) < minSettlementCents()) {
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
  const claimedSum = lines.reduce((s, l) => s + l.royaltyCents, 0)
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
