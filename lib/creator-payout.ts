import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { computePartnerBalance, type PartnerBalanceRole } from '@/lib/partner-balance'
import { payoutMinCents } from '@/lib/payout-threshold'
import { recordPartnerTransferLedgerEntry } from '@/lib/ledger'

// ── Partner payout (rail financier P4.3, Agent 39 — GÉNÉRALISÉ Brique D1, Agent 63) ─
//
// Transfers a partner's AVAILABLE balance (computed by lib/partner-balance, P4.2)
// to their Stripe Connect account, records a Payout row, in TEST mode, gated OFF.
// THIS MOVES REAL MONEY (in TEST) → idempotence + atomicity are the whole point.
//
// D1 generalises the rail from creator-only to role-aware WITHOUT changing the
// creator behaviour: payPartner(role, refId) carries the SINGLE transfer core +
// the SINGLE triple-idempotence implementation, parameterised by a per-role
// ADAPTER (entity lookup, balance role, Payout ref column, flag). payCreator stays
// a thin wrapper → payPartner('creator', creatorId) returning the legacy outcome
// shape, so every existing caller AND the existing creator tests are unchanged
// (= the proof that 'creator' is byte-identical). 'affiliate' (gated by
// AFFILIATE_CONNECT_ENABLED, OFF) pays the affiliate's OPERATOR via its own
// Operator Connect fields + Payout{role:'affiliate', operatorId}. 'logistics'
// (P4.3 ÉTAPE 2, gated by LOGISTICS_PAYOUT_ENABLED, OFF) pays the courier's
// LogisticsProfile Connect account + Payout{role:'logistics', logisticsProfileId};
// its balance source (CourierEarning) is empty until ÉTAPE 3, so the rail is inert.
//
// ANTI-DOUBLE-PAYMENT (three layers, all on a DETERMINISTIC cursor key
// `<role>:<refId>:paid:<paidCents>` — the ALREADY-DISBURSED cursor, monotonic). Why
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
//      payout per partner can exist at a time.
//
// Amount = the server-computed available balance, NEVER a client input. Below the
// minimum threshold → skip (no transfer). The partner must have an ACTIVE Connect
// account (P4.1) → else skip with a reason. Cent-exact.

export function isCreatorPayoutEnabled(): boolean {
  return process.env.CREATOR_PAYOUT_ENABLED === 'true'
}

/** Affiliate payout/Connect kill-switch (Brique D1) — default OFF. Same env var the
 *  connect-onboarding 'affiliate' beneficiary reads, so the affiliate payout rail and
 *  its onboarding open together. The CREATOR rail is unaffected (no internal gate). */
export function isAffiliateConnectEnabled(): boolean {
  return process.env.AFFILIATE_CONNECT_ENABLED === 'true'
}

/** Logistics (courier) payout rail kill-switch (P4.3 ÉTAPE 2) — default OFF. The
 *  logistics adapter's internal gate: with it OFF, payPartner('logistics') is inert (no
 *  entity/DB/Stripe touch → 'rail_disabled'), exactly like the affiliate rail. The creator
 *  + affiliate rails are UNAFFECTED by this flag (each adapter reads only its own gate).
 *  check-flags coupling (LOGISTICS_PAYOUT_ENABLED ⇒ LOGISTICS_CONNECT_ENABLED) is wired in
 *  a later step; the source that feeds CourierEarning is ÉTAPE 3. */
export function isLogisticsPayoutEnabled(): boolean {
  return process.env.LOGISTICS_PAYOUT_ENABLED === 'true'
}

/** Minimum payout (cents) — delegates to the SINGLE source (lib/payout-threshold,
 *  env CREATOR_PAYOUT_MIN_CENTS, default 25 € since Brique D2). Re-exported as the
 *  rail's threshold; payPartner logic below is otherwise unchanged. */
export function minPayoutCents(): number {
  return payoutMinCents()
}

// Roles the generalised rail can pay (extensible — franchise keeps its own settlement).
export type PayoutPartnerRole = 'creator' | 'affiliate' | 'logistics'

// ── Legacy creator-shaped outcome — UNCHANGED. Existing callers + tests depend on
// the `creatorId` field, so payCreator keeps returning EXACTLY this shape. ───────
export type PayoutOutcome =
  | { status: 'paid';    creatorId: string; amountCents: number; stripeTransferId: string; resumed: boolean }
  | { status: 'skipped'; creatorId: string; reason: string }
  | { status: 'failed';  creatorId: string; reason: string }

// ── Generalised outcome (role + refId) returned by payPartner. ──────────────────
export type PartnerPayoutOutcome =
  | { status: 'paid';    role: PayoutPartnerRole; refId: string; amountCents: number; stripeTransferId: string; resumed: boolean }
  | { status: 'skipped'; role: PayoutPartnerRole; refId: string; reason: string }
  | { status: 'failed';  role: PayoutPartnerRole; refId: string; reason: string }

type PendingPayout = { id: string; amountCents: number; currency: string; idempotencyKey: string | null }
type PartnerRef    = { id: string; stripeAccountId: string }
// The beneficiary reference column for this role (exactly one set per Payout row).
type RefData = { creatorId: string } | { operatorId: string } | { logisticsProfileId: string }

// ── Per-role adapter — the ONLY thing that differs between rails. The transfer
// core + the triple idempotence (settlePending / payPartner below) are SHARED, a
// single implementation. ────────────────────────────────────────────────────────
interface RoleAdapter {
  balanceRole:    PartnerBalanceRole          // role passed to computePartnerBalance
  notFoundReason: string                      // skip reason when the entity is absent
  /** Internal enable gate. creator → always true (its gating is external, at the
   *  caller — byte-identical to today). affiliate → AFFILIATE_CONNECT_ENABLED. */
  enabled(): boolean
  /** Load the beneficiary's Connect account + status (null if the entity is absent). */
  loadAccount(refId: string): Promise<{ stripeAccountId: string | null; payoutStatus: string | null } | null>
  /** The Payout beneficiary column + Stripe metadata key for this role/refId. */
  refData(refId: string): RefData
}

const ADAPTERS: Record<PayoutPartnerRole, RoleAdapter> = {
  creator: {
    balanceRole:    'creator',
    notFoundReason: 'creator_not_found',
    enabled:        () => true,
    loadAccount:    (refId) => prisma.creator.findUnique({
      where:  { id: refId },
      select: { stripeAccountId: true, payoutStatus: true },
    }),
    refData:        (refId) => ({ creatorId: refId }),
  },
  affiliate: {
    balanceRole:    'affiliate',
    notFoundReason: 'affiliate_not_found',
    enabled:        () => isAffiliateConnectEnabled(),
    loadAccount:    async (refId) => {
      const op = await prisma.operator.findUnique({
        where:  { id: refId },
        select: { affiliateStripeAccountId: true, affiliatePayoutStatus: true },
      })
      if (!op) return null
      return { stripeAccountId: op.affiliateStripeAccountId, payoutStatus: op.affiliatePayoutStatus }
    },
    refData:        (refId) => ({ operatorId: refId }),
  },
  // ── Logistics (courier) rail — P4.3 ÉTAPE 2. A faithful calque of creator/affiliate:
  // balance role 'logistics' (Σ matured CourierEarning), beneficiary = the courier's
  // LogisticsProfile Connect account, Payout{role:'logistics', logisticsProfileId}. Gated
  // by LOGISTICS_PAYOUT_ENABLED (OFF) → inert. The shared transfer core + triple idempotence
  // below are UNCHANGED, so creator/affiliate stay byte-identical.
  logistics: {
    balanceRole:    'logistics',
    notFoundReason: 'logistics_not_found',
    enabled:        () => isLogisticsPayoutEnabled(),
    loadAccount:    (refId) => prisma.logisticsProfile.findUnique({
      where:  { id: refId },
      select: { stripeAccountId: true, payoutStatus: true },
    }),
    refData:        (refId) => ({ logisticsProfileId: refId }),
  },
}

/** Execute the Stripe Transfer for a 'pending' Payout (idempotent on its stored
 *  key) then mark it 'paid'. Throws on Stripe/DB failure → caller leaves the row
 *  'pending' (recoverable). The Stripe idempotency key guarantees that a retry
 *  after a partial failure never creates a SECOND transfer. SHARED by all roles. */
async function settlePending(
  payout: PendingPayout, ref: PartnerRef, role: PayoutPartnerRole, refData: RefData, resumed: boolean,
): Promise<PartnerPayoutOutcome> {
  const idempotencyKey = payout.idempotencyKey ?? `payout_${payout.id}`
  const transfer = await getStripe().transfers.create(
    {
      amount:      payout.amountCents,
      currency:    payout.currency,
      destination: ref.stripeAccountId,
      metadata:    { ...refData, payoutId: payout.id },
    },
    { idempotencyKey },
  )
  await prisma.payout.update({
    where: { id: payout.id },
    data:  { status: 'paid', paidAt: new Date(), stripeTransferId: transfer.id },
  })

  // ── LEDGER TRACE (rail A3) — record the disbursement append-only & idempotent ──
  // PURE ADD-ON: this RECORDS the (already-completed, already-persisted) payout; it
  // NEVER moves money nor alters the transfer/payout. recordPartnerTransferLedgerEntry
  // NEVER throws (it catches internally) and its result is NOT awaited into the
  // outcome — so removing this whole block leaves settlePending BYTE-IDENTICAL to the
  // pre-trace transfer path. Covers BOTH rails (this fn is shared) and BOTH the
  // resume + normal paths. Idempotent on the Payout id (sourceEventId): a replay /
  // re-driven resume hits @@unique([sourceEventId,'partner_transfer']) → no 2nd line.
  // A failure is logged ([LEDGER MISS]) for manual reconciliation, exactly like the
  // B2C webhook — it must never block or undo a settled payout.
  const led = await recordPartnerTransferLedgerEntry({
    payoutId:             payout.id,
    role,
    beneficiaryId:        ref.id,
    amountCents:          payout.amountCents,
    currency:             payout.currency,
    stripeTransferId:     transfer.id,
    destinationAccountId: ref.stripeAccountId,
  })
  if (!led.ok) {
    console.error(`[LEDGER MISS] partner_transfer payout=${payout.id} role=${role} ref=${ref.id}: ${led.error}`)
  }

  return { status: 'paid', role, refId: ref.id, amountCents: payout.amountCents, stripeTransferId: transfer.id, resumed }
}

/**
 * Pay ONE partner their available balance. Safe to call repeatedly / concurrently
 * / on a schedule — never pays the same balance twice. Role-aware via ADAPTERS;
 * the transfer core + triple idempotence are shared (single implementation).
 */
export async function payPartner(role: PayoutPartnerRole, refId: string): Promise<PartnerPayoutOutcome> {
  const adapter = ADAPTERS[role]

  // Internal kill-switch. creator: always enabled (unchanged — its gate is at the
  // caller). affiliate: OFF by default → no entity/DB/Stripe touch when disabled.
  if (!adapter.enabled()) {
    return { status: 'skipped', role, refId, reason: 'rail_disabled' }
  }

  const acct = await adapter.loadAccount(refId)
  if (!acct) return { status: 'skipped', role, refId, reason: adapter.notFoundReason }
  if (!acct.stripeAccountId || acct.payoutStatus !== 'active') {
    return { status: 'skipped', role, refId, reason: 'no_active_connect' }
  }
  const ref: PartnerRef = { id: refId, stripeAccountId: acct.stripeAccountId }
  const refData = adapter.refData(refId)

  // 1. RESUME any stuck 'pending' payout first (idempotent completion).
  const pending = await prisma.payout.findFirst({
    where:   { role, ...refData, status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, amountCents: true, currency: true, idempotencyKey: true },
  })
  if (pending) {
    try {
      return await settlePending(pending, ref, role, refData, true)
    } catch {
      return { status: 'failed', role, refId, reason: 'transfer_failed_resume' }
    }
  }

  // 2. NORMAL path — compute available, enforce threshold, take the lock, transfer.
  const bal = await computePartnerBalance(adapter.balanceRole, refId)
  if (bal.availableCents < minPayoutCents()) {
    return { status: 'skipped', role, refId, reason: 'below_threshold' }
  }

  // Cursor = the already-PAID amount (monotonic): concurrent runs share it and
  // serialise via the @unique; the next run (after paidCents grows) pays the rest.
  const idempotencyKey = `${role}:${refId}:paid:${bal.paidCents}`
  let payout: PendingPayout
  try {
    payout = await prisma.payout.create({
      data: {
        role, ...refData,
        amountCents: bal.availableCents, currency: bal.currency,
        status: 'pending', idempotencyKey,
      },
      select: { id: true, amountCents: true, currency: true, idempotencyKey: true },
    })
  } catch (err) {
    // @unique(idempotencyKey) collision = a concurrent run already locked this
    // cursor → no-op (NEVER a second payout / transfer for the same balance).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'skipped', role, refId, reason: 'already_in_progress' }
    }
    throw err
  }

  try {
    return await settlePending(payout, ref, role, refData, false)
  } catch {
    // Transfer or mark-paid failed → row stays 'pending' (recoverable on re-run).
    // The deterministic Stripe idempotency key guarantees no double transfer.
    return { status: 'failed', role, refId, reason: 'transfer_failed' }
  }
}

/**
 * Pay ONE creator their available balance. THIN WRAPPER over payPartner('creator')
 * that maps back to the legacy creator-shaped outcome — so every existing caller
 * and the existing creator tests are byte-identical (the equivalence proof).
 */
export async function payCreator(creatorId: string): Promise<PayoutOutcome> {
  const out = await payPartner('creator', creatorId)
  if (out.status === 'paid') {
    return { status: 'paid', creatorId, amountCents: out.amountCents, stripeTransferId: out.stripeTransferId, resumed: out.resumed }
  }
  if (out.status === 'failed') {
    return { status: 'failed', creatorId, reason: out.reason }
  }
  return { status: 'skipped', creatorId, reason: out.reason }
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
