import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { computePartnerBalance } from '@/lib/partner-balance'

// ── Creator payout (rail financier P4.3, Agent 39) — REAL Stripe Transfer (TEST) ─
//
// Transfers a creator's AVAILABLE balance (computed by lib/partner-balance, P4.2)
// to their Stripe Connect account, records a Payout row, in TEST mode, gated OFF.
// THIS MOVES REAL MONEY (in TEST) → idempotence + atomicity are the whole point.
//
// ANTI-DOUBLE-PAYMENT (three layers, all on a DETERMINISTIC cursor key
// `creator:<id>:paid:<paidCents>` — the ALREADY-DISBURSED cursor, monotonic). Why
// the PAID cursor (not earned): two concurrent runs read the SAME paidCents (until
// one commits its 'paid'), so they derive the SAME key and SERIALISE — even if
// they observe different earned levels (e.g. earnings matured in between). Only one
// create wins; the next run, after paidCents grows, pays the remainder. This
// prevents BOTH double-paying the same balance AND concurrent payouts at different
// earned levels.
//   1. Payout.idempotencyKey @unique → a concurrent/re-run create for the same
//      paid cursor fails (P2002) → never two Payout rows / two transfers at once.
//   2. The Stripe Transfer uses that SAME key as its idempotency key → even if a
//      second create slipped through (pre-migration), Stripe returns the SAME
//      transfer (no double money). This is the ULTIMATE guarantee.
//   3. RESUME-FIRST: a stuck 'pending' Payout (transfer done but DB write failed,
//      or transfer never reached Stripe) is re-driven with its stored key before
//      any new payout — Stripe dedupes, so we complete it without a second money
//      movement. A failure leaves the row 'pending' (recoverable), never paid twice.
//      Because a new cursor only opens once paidCents grows, at most ONE pending
//      payout per creator can exist at a time.
//
// Amount = the server-computed available balance, NEVER a client input. Below the
// minimum threshold → skip (no transfer). Creator must have an ACTIVE Connect
// account (P4.1) → else skip with a reason. Cent-exact.

export function isCreatorPayoutEnabled(): boolean {
  return process.env.CREATOR_PAYOUT_ENABLED === 'true'
}

/** Minimum payout (cents). Default 20 € (2000), env CREATOR_PAYOUT_MIN_CENTS. */
export function minPayoutCents(): number {
  const v = Number.parseInt(process.env.CREATOR_PAYOUT_MIN_CENTS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 2000
}

export type PayoutOutcome =
  | { status: 'paid';    creatorId: string; amountCents: number; stripeTransferId: string; resumed: boolean }
  | { status: 'skipped'; creatorId: string; reason: string }
  | { status: 'failed';  creatorId: string; reason: string }

type PendingPayout = { id: string; amountCents: number; currency: string; idempotencyKey: string | null }
type CreatorRef    = { id: string; stripeAccountId: string }

/** Execute the Stripe Transfer for a 'pending' Payout (idempotent on its stored
 *  key) then mark it 'paid'. Throws on Stripe/DB failure → caller leaves the row
 *  'pending' (recoverable). The Stripe idempotency key guarantees that a retry
 *  after a partial failure never creates a SECOND transfer. */
async function settlePending(payout: PendingPayout, creator: CreatorRef, resumed: boolean): Promise<PayoutOutcome> {
  const idempotencyKey = payout.idempotencyKey ?? `payout_${payout.id}`
  const transfer = await getStripe().transfers.create(
    {
      amount:      payout.amountCents,
      currency:    payout.currency,
      destination: creator.stripeAccountId,
      metadata:    { creatorId: creator.id, payoutId: payout.id },
    },
    { idempotencyKey },
  )
  await prisma.payout.update({
    where: { id: payout.id },
    data:  { status: 'paid', paidAt: new Date(), stripeTransferId: transfer.id },
  })
  return { status: 'paid', creatorId: creator.id, amountCents: payout.amountCents, stripeTransferId: transfer.id, resumed }
}

/**
 * Pay ONE creator their available balance. Safe to call repeatedly / concurrently
 * / on a schedule — never pays the same balance twice.
 */
export async function payCreator(creatorId: string): Promise<PayoutOutcome> {
  const creator = await prisma.creator.findUnique({
    where:  { id: creatorId },
    select: { id: true, stripeAccountId: true, payoutStatus: true },
  })
  if (!creator) return { status: 'skipped', creatorId, reason: 'creator_not_found' }
  if (!creator.stripeAccountId || creator.payoutStatus !== 'active') {
    return { status: 'skipped', creatorId, reason: 'no_active_connect' }
  }
  const ref: CreatorRef = { id: creator.id, stripeAccountId: creator.stripeAccountId }

  // 1. RESUME any stuck 'pending' payout first (idempotent completion).
  const pending = await prisma.payout.findFirst({
    where:   { role: 'creator', creatorId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, amountCents: true, currency: true, idempotencyKey: true },
  })
  if (pending) {
    try {
      return await settlePending(pending, ref, true)
    } catch {
      return { status: 'failed', creatorId, reason: 'transfer_failed_resume' }
    }
  }

  // 2. NORMAL path — compute available, enforce threshold, take the lock, transfer.
  const bal = await computePartnerBalance('creator', creatorId)
  if (bal.availableCents < minPayoutCents()) {
    return { status: 'skipped', creatorId, reason: 'below_threshold' }
  }

  // Cursor = the already-PAID amount (monotonic): concurrent runs share it and
  // serialise via the @unique; the next run (after paidCents grows) pays the rest.
  const idempotencyKey = `creator:${creatorId}:paid:${bal.paidCents}`
  let payout: PendingPayout
  try {
    payout = await prisma.payout.create({
      data: {
        role: 'creator', creatorId,
        amountCents: bal.availableCents, currency: bal.currency,
        status: 'pending', idempotencyKey,
      },
      select: { id: true, amountCents: true, currency: true, idempotencyKey: true },
    })
  } catch (err) {
    // @unique(idempotencyKey) collision = a concurrent run already locked this
    // cursor → no-op (NEVER a second payout / transfer for the same balance).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'skipped', creatorId, reason: 'already_in_progress' }
    }
    throw err
  }

  try {
    return await settlePending(payout, ref, false)
  } catch {
    // Transfer or mark-paid failed → row stays 'pending' (recoverable on re-run).
    // The deterministic Stripe idempotency key guarantees no double transfer.
    return { status: 'failed', creatorId, reason: 'transfer_failed' }
  }
}

export type PayoutRunSummary = {
  processed: number
  paid:      number
  skipped:   number
  failed:    number
  results:   PayoutOutcome[]
}

/**
 * Batch: pay every creator that has an ACTIVE Connect account. payCreator itself
 * enforces the threshold + idempotency, so this is safe to re-run. Sequential to
 * avoid intra-run races and Stripe rate spikes.
 */
export async function runCreatorPayouts(): Promise<PayoutRunSummary> {
  const creators = await prisma.creator.findMany({
    where:  { stripeAccountId: { not: null }, payoutStatus: 'active' },
    select: { id: true },
  })
  const summary: PayoutRunSummary = { processed: 0, paid: 0, skipped: 0, failed: 0, results: [] }
  for (const c of creators) {
    const out = await payCreator(c.id)
    summary.processed++
    summary[out.status === 'paid' ? 'paid' : out.status === 'failed' ? 'failed' : 'skipped']++
    summary.results.push(out)
  }
  return summary
}
