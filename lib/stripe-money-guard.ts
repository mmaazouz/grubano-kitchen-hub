// lib/stripe-money-guard.ts — T-90 (PRE-L11 hardening): the declaration every financial Stripe write
// must make, and the audit line every one of them leaves.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS CLOSES, STATED HONESTLY.
//
// The money-write recon confirmed, from six independent directions, that the product flags are checked
// at CALLERS and nowhere else. `lib/refund.ts` says so in its own header — « All routes are GATED by
// REFUNDS_ENABLED (default OFF) » — and `lib/dispute.ts:341` says « called ONLY when CHARGEBACKS_ENABLED
// is ON (the webhook gates it) ». Both statements are TRUE today and neither is ENFORCED: `executeRefund`,
// `finalizeRefundRowFromStripe` and `handleDisputeEvent` all reach `stripe.refunds.create` or
// `transfers.createReversal` with no flag consulted inside the module. The invariant lives in a comment,
// so the day someone adds an admin replay route, a reconciliation cron or a sweeper, the money moves and
// nothing objects. That is the structural hole — not a currently-open door, a missing lock on the inside.
//
// WHAT WAS **NOT** WRONG, AND MUST NOT BE «FIXED». The webhook path is ungated ON PURPOSE. When Stripe
// tells us a refund SUCCEEDED, the money has already left; refusing to finalize would leave our ledger,
// our loyalty balances and the customer's own screens disagreeing with reality. The flag gates what
// INITIATES a movement, never the recording of one that already happened. Any guard that blocked the
// completing path would turn a bounded exposure into a silent accounting hole — strictly worse.
//
// SO THIS FILE DOES NOT DECIDE WHETHER MONEY MAY MOVE. It requires every financial write to SAY, in its
// own call, under which of three authorizations it is acting, and it refuses a declaration that cannot
// possibly be true:
//   • `rail_open`                    — an operator opened the refund window. The caller passes the real
//                                      gate (`refundGateState().open`), and this file ALSO requires the
//                                      raw flag to be the string 'true'. Two independent reads; the
//                                      caller's is the authority, this one is a floor.
//   • `dispute_rail_open`            — same shape for CHARGEBACKS_ENABLED.
//   • `completing_settled_movement`  — we are recording or recovering money Stripe has ALREADY moved.
//                                      NO flag is required, by design — and a `proof` is: the Stripe id
//                                      that establishes the movement. A caller that cannot name one
//                                      cannot claim this authorization.
//
// WHY A FLOOR AND NOT A COPY OF THE GATE. Re-implementing `refundGateState` here would put a money rule
// in two files, and this repository has been bitten by exactly that. The floor is deliberately WEAKER
// than the gate (it ignores the lease and its 30-minute ceiling), so it can never authorize something the
// gate refuses — it can only catch a caller that forgot to check at all.
//
// AND IT LEAVES A LINE. Every attempt — allowed or refused — prints one `[MONEY WRITE]` record naming the
// verb, the authorization, the proof and the reason. Before this, a financial Stripe write left no trace
// of its own; the only evidence was whatever the caller happened to log. An operator can now grep one
// marker and see every write the process tried to make.
//
// LEAF MODULE: it imports nothing. That is what lets `lib/refund.ts`, `lib/refunds.ts` and
// `lib/dispute.ts` all use it with no import cycle, and what keeps it out of every client bundle.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** The authorization a financial write acts under. There is no fourth value, and no default. */
export type MoneyWriteAuthorization =
  /** An operator opened the refund window: REFUNDS_ENABLED + a live lease (checked by the caller). */
  | 'rail_open'
  /** The chargeback rail is open: CHARGEBACKS_ENABLED (checked by the caller). */
  | 'dispute_rail_open'
  /**
   * The franchise settlement rail is open: FRANCHISE_SETTLEMENT_ENABLED (checked by the caller).
   *
   * This one was FOUND BY THE ENUMERATION TEST, not by a reviewer: `lib/franchise-settlement.ts` calls
   * `transfers.create` to pay a franchisor their royalty batch — real money OUT of the platform, and the
   * only write in the repository that credits a third party rather than recovering from one. Six recon
   * agents had walked the refund and dispute rails; none reported it, because none was looking at the rail
   * that CREATES the transfers the other two reverse.
   */
  | 'settlement_rail_open'
  /**
   * A partner payout rail is open — creator, affiliate or courier. The FLAG DIFFERS BY ROLE
   * (CREATOR_PAYOUT_ENABLED / AFFILIATE_CONNECT_ENABLED / LOGISTICS_PAYOUT_ENABLED), so this
   * authorization carries its flag name in `flag`, restricted to that set.
   *
   * FOUND BY FOUR REVIEWERS AT ONCE, and only because the first version of the enumeration test walked a
   * hand-written list of six files instead of the filesystem — one entry of which did not even exist.
   * `lib/creator-payout.ts` pays a partner real money from a scheduled rail and declared nothing. The
   * lesson is not «add a file to the list»: it is that an allowlist is not an enumeration.
   */
  | 'partner_payout_rail_open'
  /**
   * The punitive-capture rail is open: PUNITIVE_CAPTURE_ENABLED (checked by the caller, lib/deposit.ts).
   *
   * Added after the review pointed out an internal contradiction in this very lot: T-100 put
   * PUNITIVE_CAPTURE_ENABLED into MONEY_FLAGS_MUST_BE_FALSE calling it « the sole gate on the only
   * `paymentIntents.capture` in the repository — a real card debit of a held empreinte », while the verb
   * itself was missing from FINANCIAL_STRIPE_WRITE_VERBS. The list said money; the choke point did not.
   * It is the ONLY write here that debits a CUSTOMER rather than a partner.
   */
  | 'capture_rail_open'
  /** Stripe has ALREADY moved this money; we are recording or recovering it. Requires a proof id. */
  | 'completing_settled_movement'

/** Thrown when a financial write's declaration cannot be true. Never caught to «carry on anyway». */
export class MoneyWriteRefused extends Error {
  readonly verb: string
  readonly authorization: MoneyWriteAuthorization
  constructor(verb: string, authorization: MoneyWriteAuthorization, detail: string) {
    super(`[MONEY WRITE REFUSED] ${verb} declared ${authorization}: ${detail}`)
    this.name = 'MoneyWriteRefused'
    this.verb = verb
    this.authorization = authorization
  }
}

/**
 * A Stripe object id that establishes a movement. Deliberately narrow: `re_` (refund), `tr_` (transfer),
 * `trr_` (transfer reversal), `ch_` (charge), `fr_` (fee refund), `py_` (payment). A `pi_` is NOT here —
 * a PaymentIntent proves an intention, not a settled movement.
 *
 * IT DOES NOT VALIDATE STRIPE'S ID GRAMMAR, and must not try. The rule being enforced is « the caller can
 * NAME the movement it is completing » — not « this string is a well-formed Stripe identifier ». Two drafts
 * got that wrong and both refused legitimate calls: a length floor of eight characters rejected `re_1`, and
 * an alphanumeric-only body rejected `re_rf_A`. Length and character class are not evidence; the PREFIX is,
 * because it is what distinguishes a settled movement from a `pi_`, which proves only an intention.
 */
const SETTLED_PROOF = /^(re|tr|trr|ch|fr|py)_[A-Za-z0-9_-]+$/

/** The env flag each authorization requires as a FLOOR. `completing_settled_movement` requires none. */
const REQUIRED_FLAG: Record<MoneyWriteAuthorization, string | null> = {
  rail_open: 'REFUNDS_ENABLED',
  dispute_rail_open: 'CHARGEBACKS_ENABLED',
  settlement_rail_open: 'FRANCHISE_SETTLEMENT_ENABLED',
  // `partner_payout_rail_open` names its own flag in `flag`; see PARTNER_PAYOUT_FLAGS.
  partner_payout_rail_open: null,
  capture_rail_open: 'PUNITIVE_CAPTURE_ENABLED',
  completing_settled_movement: null,
}

/** The only flags a `partner_payout_rail_open` declaration may name. A caller cannot invent a fourth. */
export const PARTNER_PAYOUT_FLAGS = ['CREATOR_PAYOUT_ENABLED', 'AFFILIATE_CONNECT_ENABLED', 'LOGISTICS_PAYOUT_ENABLED'] as const
export type PartnerPayoutFlag = typeof PARTNER_PAYOUT_FLAGS[number]

export interface MoneyWriteDeclaration {
  /** The Stripe verb, exactly as called: 'refunds.create', 'transfers.createReversal', … */
  verb: string
  authorization: MoneyWriteAuthorization
  /** One clause saying why this write is authorized. Goes into the audit line. */
  why: string
  /**
   * The caller's OWN gate result — `refundGateState().open`, `isChargebacksEnabled()`. Required for the
   * two `*_open` authorizations: this file will not infer an authorization the caller did not assert.
   */
  railOpen?: boolean
  /** The Stripe id establishing the movement. Required for `completing_settled_movement`. */
  proof?: string | null
  orderId?: string | null
  /** Cents about to move, for the audit line only. Never used to decide. */
  amountCents?: number | null
  /**
   * Required for `partner_payout_rail_open`: WHICH payout flag governs this role. It is recorded in the
   * audit line, and a value outside PARTNER_PAYOUT_FLAGS is refused — an operator reading
   * «[MONEY WRITE] verb=transfers.create auth=partner_payout_rail_open» needs to know which rail paid.
   */
  flag?: string | null
}

/**
 * Declare a financial Stripe write, or throw. Call it IMMEDIATELY before the Stripe call — close enough
 * that no branch can slip between the two.
 *
 * It never returns a value: there is no «allowed?» boolean to ignore by accident.
 */
export function assertMoneyWriteAllowed(d: MoneyWriteDeclaration): void {
  const flag = REQUIRED_FLAG[d.authorization]
  let refusal: string | null = null

  if (flag === undefined) {
    refusal = 'unknown authorization'
  } else if (d.authorization === 'completing_settled_movement') {
    const proof = (d.proof ?? '').trim()
    if (!proof) {
      refusal = 'no proof id — this authorization means Stripe ALREADY moved the money, so the id that '
        + 'establishes the movement must be named. A caller that cannot name one is INITIATING, and must '
        + 'declare rail_open instead.'
    } else if (!SETTLED_PROOF.test(proof)) {
      refusal = `proof ${JSON.stringify(proof.slice(0, 12))} is not a settled-movement Stripe id `
        + '(re_/tr_/trr_/ch_/fr_/py_). A pi_ proves an intention, not a movement.'
    }
  } else if (d.authorization === 'partner_payout_rail_open') {
    /* The payout family names its own flag. The caller's gate stays the authority — and for the CREATOR
       role that gate is deliberately `() => true` in lib/creator-payout.ts, with the flag checked at the
       admin route. That is a real residual (recorded as a ticket), and this guard does NOT tighten it
       behind the founder's back: tightening a rail that may be paying creators today, on a guess about a
       production env var, is the one failure direction worse than the exposure. So the declaration records
       the rail and the flag, and refuses only what the rail itself would refuse. */
    if (!d.flag || !(PARTNER_PAYOUT_FLAGS as readonly string[]).includes(d.flag)) {
      refusal = `flag ${JSON.stringify(String(d.flag))} is not one of ${PARTNER_PAYOUT_FLAGS.join(', ')} — `
        + 'a payout must say which rail authorized it.'
    } else if (d.railOpen !== true) {
      refusal = `the ${d.flag} rail is not open (railOpen=${String(d.railOpen)}).`
    }
  } else {
    // The caller's own gate is the authority; the raw flag is a floor that cannot exceed it.
    if (d.railOpen !== true) {
      refusal = `the caller did not assert its gate (railOpen=${String(d.railOpen)}). The flag check lives `
        + 'at the caller and must be passed in; this guard will not infer it.'
    } else if (process.env[flag as string] !== 'true') {
      refusal = `${flag} is not 'true' in this process, yet the caller asserted its gate is open. Those `
        + 'two cannot both be right — refusing rather than guessing which.'
    }
  }

  logMoneyWrite(d, refusal)
  if (refusal) throw new MoneyWriteRefused(d.verb, d.authorization, refusal)
}

/**
 * ONE greppable line per financial write attempt. No secret, no PII: a verb, an authorization, a Stripe
 * id (already non-secret and already logged elsewhere), an order id and an amount.
 */
export function logMoneyWrite(d: MoneyWriteDeclaration, refusal: string | null): void {
  const parts = [
    `[MONEY WRITE]${refusal ? ' REFUSED' : ''}`,
    `verb=${d.verb}`,
    `auth=${d.authorization}`,
    d.flag ? `flag=${d.flag}` : null,
    d.proof ? `proof=${d.proof}` : null,
    d.orderId ? `order=${d.orderId}` : null,
    typeof d.amountCents === 'number' ? `cents=${d.amountCents}` : null,
    `why=${d.why}`,
    refusal ? `refusal=${refusal}` : null,
  ].filter(Boolean)
  // A refusal is an error: it means a caller's declaration could not be true, which is a code defect.
  if (refusal) console.error(parts.join(' · '))
  else console.warn(parts.join(' · '))
}

/**
 * The canonical list of Stripe verbs this repository treats as FINANCIAL WRITES — the enumeration the
 * completeness test walks. A read (`retrieve`, `list`, `search`, `balance.retrieve`) is not here, and
 * `webhooks.constructEvent` is not a call to Stripe at all.
 *
 * Adding a verb here without guarding its call sites makes the completeness test fail, which is the
 * point: the list and the code cannot drift apart silently.
 */
export const FINANCIAL_STRIPE_WRITE_VERBS = [
  'refunds.create',
  'transfers.create',
  'transfers.createReversal',
  'transferReversals.create',
  'payouts.create',
  'payouts.cancel',
  'applicationFees.createRefund',
  'topups.create',
  /* `paymentIntents.capture` — the no-show / walk-out penalty. The one write that takes money from a
     CUSTOMER'S card rather than moving it between our own accounts, and it was missing from this list while
     the same lot was adding its flag to MONEY_FLAGS_MUST_BE_FALSE. `paymentIntents.create` and `.cancel` are
     deliberately NOT here: `create` is the money-IN rail the product keeps live on purpose (a checkout, a
     ticket, a hold), so requiring a declaration on it would mean declaring on every order rather than
     guarding a gate; `cancel` RELEASES an uncaptured authorization and takes nothing. Those exclusions are
     a judgement, stated so the next reader can disagree with it knowingly rather than assume an oversight. */
  'paymentIntents.capture',
] as const
