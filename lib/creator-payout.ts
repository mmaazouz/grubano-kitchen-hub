import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/stripe'
// T-90: the declaration every financial Stripe write in this file must make. LEAF module, no cycle.
import { assertMoneyWriteAllowed, escalateIfPolicyRefusal, isMoneyPolicyRefusal, type PartnerPayoutFlag } from '@/lib/stripe-money-guard'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
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

/** T-112 — Stripe prunes idempotency keys after ~24 h; 20 h is the same conservative margin the refund rail
 *  uses (lib/refund.ts RESUME_CREATE_WINDOW_MS). Past it, a re-sent key is a NEW transfer. */
export const PAYOUT_RESUME_WINDOW_MS = 20 * 60 * 60 * 1000

/** T-112 — a resume that cannot PROVE whether the transfer already exists. Fails closed; never creates. */
export class PayoutResumeUnprovable extends Error {
  constructor(payoutId: string, why: string) { super(`payout ${payoutId}: ${why}`); this.name = 'PayoutResumeUnprovable' }
}
/** T-112 — a resume past the idempotency window with nothing to adopt. Refuses; a human completes it. */
export class PayoutResumeExpired extends Error {
  constructor(payoutId: string, ageMs: number) {
    super(`payout ${payoutId}: ${Math.round(ageMs / 3600000)} h old, past the ${PAYOUT_RESUME_WINDOW_MS / 3600000} h idempotency window and no transfer to adopt — a re-sent key would be a SECOND transfer`)
    this.name = 'PayoutResumeExpired'
  }
}

export function isCreatorPayoutEnabled(): boolean {
  return process.env.CREATOR_PAYOUT_ENABLED === 'true'
}

/** Affiliate payout/Connect kill-switch (Brique D1) — default OFF. Same env var the
 *  connect-onboarding 'affiliate' beneficiary reads, so the affiliate payout rail and
 *  its onboarding open together. The CREATOR rail is unaffected — it reads its OWN gate
 *  (CREATOR_PAYOUT_ENABLED) since T-90-ter; before that it had none. */
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

// T-112: `createdAt` is load-bearing — it is what bounds the Stripe idempotency window on a resume.
type PendingPayout = { id: string; amountCents: number; currency: string; idempotencyKey: string | null; createdAt?: Date | string | null }
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

/** T-90: which flag governs each payout rail, for the declaration and the audit line. */
const PAYOUT_FLAG_BY_ROLE: Record<PayoutPartnerRole, PartnerPayoutFlag> = {
  creator:   'CREATOR_PAYOUT_ENABLED',
  affiliate: 'AFFILIATE_CONNECT_ENABLED',
  logistics: 'LOGISTICS_PAYOUT_ENABLED',
}

const ADAPTERS: Record<PayoutPartnerRole, RoleAdapter> = {
  creator: {
    balanceRole:    'creator',
    notFoundReason: 'creator_not_found',
    /* T-90-ter — FOUNDER ARBITRATION (2026-09-28): « le rail créateur doit avoir une vraie autorisation
       interne explicite. Je ne veux pas d'un enabled() => true sur un chemin capable de déclencher une
       écriture financière. »
       It was `() => true`, with the flag checked only at app/api/admin/creator-payouts/run. That made the
       creator rail the ONE payout rail with no lock on the inside: any future caller — an admin replay route,
       a reconciliation cron, a sweeper — reached `transfers.create` with nothing to object.
       The flag is CREATOR_PAYOUT_ENABLED, not a borrowed one: it is this rail's own kill-switch, the same one
       the route reads and the same one scripts/check-flags.mjs already couples to CREATOR_CONNECT_ENABLED and
       CREATOR_ENABLED. Taking CREATOR_ENABLED instead would have been the « arbitrary reuse » the arbitration
       forbids — that flag governs whether the creator ROLE is visible, not whether money may leave.
       FAIL-CLOSED: absent ⇒ false ⇒ payPartner('creator') is inert (`rail_disabled`, no entity, no DB, no
       Stripe), exactly like the affiliate and logistics rails. With the flag ON the behaviour is unchanged. */
    enabled:        () => isCreatorPayoutEnabled(),
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
  /* T-90 — DECLARE BEFORE YOU MOVE MONEY. THE SEVENTH FINANCIAL WRITE, and the one that nearly escaped:
     four reviewers found it at once, because the enumeration test's first version walked a hand-written
     list of six files rather than the filesystem. This is a Transfer that PAYS a partner — a creator, an
     affiliate or a courier — from a rail a scheduled job can poke, and it declared nothing at all.
     The flag differs by role, so the declaration names it. `adapter.enabled()` is the gate `payPartner`
     already applies — and since T-90-ter (founder arbitration) EVERY adapter reads its own flag, the creator
     one included: no rail is open by construction any more. */
  /* The DECLARATION lives immediately before the CREATE, further down — not here. T-112 inserted the
     adopt-or-refuse logic between the two, and the enumeration oracle rightly reported the write as naked:
     a guard fifty lines above a movement, with branching in between, is not a guard on that movement. An
     ADOPTED transfer moves nothing and needs no declaration; only the create does. */
  /* T-112 — ADOPT-OR-REFUSE ON A RESUME, THE F8 DISCIPLINE THE REFUND RAIL ALREADY HAS.
     Found by the final invariant review. The only protection against paying a partner twice was the Stripe
     idempotency key, and Stripe prunes those « after they are at least 24 hours old » (the same fact
     lib/refund.ts:RESUME_CREATE_WINDOW_MS exists for). A `pending` Payout row re-driven MORE than a day later
     — by the nightly cron, by an admin re-run, by a retry after a long outage — re-sent the SAME key past its
     life, which Stripe treats as a NEW request: the partner is paid a second time, and `Payout.status` was
     still 'pending' so nothing objected.
     A resume therefore asks Stripe first. `transfers.list` for this destination is filtered on OUR metadata
     (`payoutId`), exactly as the refund rail matches its reversals on `refundId`. A list that cannot prove
     absence is ambiguous, so it FAILS CLOSED rather than creating; and past the idempotency window with no
     transfer to adopt, it REFUSES instead of re-creating — a human completes it. Nothing is guessed. */
  let adoptedTransfer: { id: string } | null = null
  if (resumed) {
    let list: { has_more?: boolean; data?: Array<{ id: string; metadata?: Record<string, string> }> }
    try {
      list = await getStripe().transfers.list({ destination: ref.stripeAccountId, limit: 100 })
    } catch (err) {
      console.error(`[payout] cannot prove whether ${payout.id} was already transferred:`, err instanceof Error ? err.message : err)
      throw new PayoutResumeUnprovable(payout.id, 'transfer list unavailable')
    }
    if (list.has_more) throw new PayoutResumeUnprovable(payout.id, 'transfer list truncated — absence not provable')
    adoptedTransfer = (list.data ?? []).find((t) => t.metadata?.payoutId === payout.id) ?? null
    if (adoptedTransfer) {
      console.warn(`[payout] transfer ${adoptedTransfer.id} already exists for payout ${payout.id} — ADOPTED, no second movement`)
    } else {
      const ageMs = Date.now() - new Date(payout.createdAt ?? Date.now()).getTime()
      if (!(ageMs >= 0 && ageMs < PAYOUT_RESUME_WINDOW_MS)) {
        // Past the window a re-sent key is a NEW transfer. Refuse, and let a human decide.
        throw new PayoutResumeExpired(payout.id, ageMs)
      }
    }
  }
  let transfer: { id: string }
  if (adoptedTransfer) {
    transfer = adoptedTransfer
  } else {
    // T-90 / T-109 — DECLARE IMMEDIATELY BEFORE THE MOVEMENT. One guard, the rail's OWN flag named, and the
    // caller's own gate passed in. Nothing branches between this line and the create.
    assertMoneyWriteAllowed({
      verb: 'transfers.create',
      authorization: 'partner_payout_rail_open',
      flag: PAYOUT_FLAG_BY_ROLE[role],
      railOpen: ADAPTERS[role].enabled(),
      why: `paying a ${role} partner a settled payout (${resumed ? 'resume of a pending row' : 'fresh'})`,
      amountCents: payout.amountCents,
    })
    transfer = await getStripe().transfers.create(
      {
        amount:      payout.amountCents,
        currency:    payout.currency,
        destination: ref.stripeAccountId,
        metadata:    { ...refData, payoutId: payout.id },
      },
      { idempotencyKey },
    )
  }
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
    select:  { id: true, amountCents: true, currency: true, idempotencyKey: true, createdAt: true },
  })
  if (pending) {
    try {
      return await settlePending(pending, ref, role, refData, true)
    } catch (err) {
      // T-104 — same rule on the RESUME path: a refusal is escalated and re-thrown, never retried.
      await escalateIfPolicyRefusal(err, { verb: 'transfers.create', where: 'lib/creator-payout.payPartner:resume', amountCents: pending.amountCents }, sendAdminMoneyReviewAlert)
      if (isMoneyPolicyRefusal(err)) throw err
      /* T-112 — an UNPROVABLE or EXPIRED resume is not « the transfer failed, try again »: it is « we refuse
         to risk paying twice ». Reported under its own reason and escalated, because a re-run would make the
         same refusal forever and the row needs a human. */
      if (err instanceof PayoutResumeUnprovable || err instanceof PayoutResumeExpired) {
        console.error(`[MONEY REVIEW] [payout_resume_refused] ${err.name}: ${err.message}`)
        try {
          await sendAdminMoneyReviewAlert({
            kind: 'money_write_refused',
            dedupeKey: `payout_resume_refused:${pending.id}`,
            title: 'Reprise de versement REFUSÉE — un rejeu risquerait de payer deux fois',
            facts: { payoutId: pending.id, role, refId, amountCents: pending.amountCents, detail: err.message,
              action: 'NE PAS relancer : la clé d’idempotence Stripe ne protège plus. Vérifier chez Stripe si le transfert existe, puis clore la ligne à la main.' },
          })
        } catch { /* the log line is the primary channel */ }
        return { status: 'failed', role, refId, reason: err instanceof PayoutResumeExpired ? 'resume_expired' : 'resume_unprovable' }
      }
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
  } catch (err) {
    /* T-104 — a BARE catch turned a guard refusal into `'transfer_failed'`, i.e. « retry me ». Classified
       first: a refusal is escalated and re-thrown; a genuine failure still leaves the row recoverable. */
    await escalateIfPolicyRefusal(err, { verb: 'transfers.create', where: 'lib/creator-payout.payPartner:fresh', amountCents: payout.amountCents }, sendAdminMoneyReviewAlert)
    if (isMoneyPolicyRefusal(err)) throw err
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
