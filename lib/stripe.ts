// Server-only Stripe helper (Paiement V1 — TEST mode). The SECRET key is read
// from the environment HERE and NEVER reaches the client (only a PaymentIntent
// client_secret + the publishable key — both designed to be public — go to the
// front). V1 is a TheFork-style deposit EMPREINTE: a manual-capture PaymentIntent
// (pre-authorisation) that is later captured (no-show penalty) or cancelled
// (released on arrival, nothing charged). No Stripe Connect / commission yet.

import Stripe from 'stripe'

let _stripe: Stripe | null = null

/** Lazy singleton — only instantiated when a route actually needs Stripe, so a
 *  missing key never breaks the build/import, only the call (handled by callers). */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('stripe_not_configured')
  if (!_stripe) _stripe = new Stripe(key)
  return _stripe
}

export type DepositMetadata = {
  reservationId: string
  restaurantId:  string
  tableId:       string
}

export type DepositStatus = 'none' | 'authorized' | 'captured' | 'released'

/** Map a live PaymentIntent status onto our coarse depositStatus. */
export function mapPaymentIntentStatus(s: Stripe.PaymentIntent.Status): DepositStatus {
  if (s === 'requires_capture') return 'authorized' // card authorised, awaiting capture
  if (s === 'canceled')         return 'released'    // authorisation cancelled, nothing charged
  if (s === 'succeeded')        return 'captured'    // captured (penalty taken)
  return 'none'                                      // not yet authorised
}

/** Publishable key (pk_test…) — safe to send to the client for Stripe Elements. */
export const getPublishableKey = (): string | null => process.env.STRIPE_PUBLISHABLE_KEY ?? null

/** EUR amount → integer cents (Stripe works in the smallest currency unit). */
export const eurosToCents = (eur: number) => Math.round(eur * 100)

/** Create a pre-authorisation (manual capture) for the deposit/guarantee.
 *  With `connect` (A2): a manual-capture DESTINATION charge — a captured no-show
 *  penalty lands on the resto's account (fee 0 per A0: 100 % to the resto). */
export async function createDepositHold(opts: {
  amountCents:    number
  currency:       string
  metadata:       DepositMetadata
  connect?:       ConnectRouting
  extraMetadata?: Record<string, string>
  idempotencyKey?: string
}): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.create(
    {
      amount:                    opts.amountCents,
      currency:                  opts.currency,
      capture_method:            'manual', // ← pre-authorisation (empreinte)
      automatic_payment_methods: { enabled: true },
      metadata:                  { ...opts.metadata, ...(opts.extraMetadata ?? {}) },
      ...connectParams(opts.connect),
    },
    opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
  )
}

/** Capture (no-show): take up to the authorised amount. amountCents must be ≤ hold. */
export async function captureDeposit(piId: string, amountCents: number): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.capture(piId, { amount_to_capture: amountCents })
}

/** Release (arrival): cancel the authorisation — nothing is charged. */
export async function releaseDeposit(piId: string): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.cancel(piId)
}

/** Read the live PaymentIntent (to sync depositStatus). */
export async function retrieveIntent(piId: string): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.retrieve(piId)
}

/** Routing of a charge to a connected account (rail financier A2): destination
 *  charge — the resto receives the net, Grubano's commission stays on the
 *  platform via application_fee_amount. A fee of 0 (e.g. empreinte, founders
 *  offer) simply omits the fee → 100 % transferred. */
export type ConnectRouting = {
  destination:         string // acct_... (the establishment's Express account)
  applicationFeeCents: number // Grubano's cut, integer cents (lib/commission)
}

/** Spread Connect routing params onto a PaymentIntent create payload. */
function connectParams(connect?: ConnectRouting): Partial<Stripe.PaymentIntentCreateParams> {
  if (!connect) return {}
  return {
    transfer_data: { destination: connect.destination },
    on_behalf_of:  connect.destination,
    ...(connect.applicationFeeCents > 0 ? { application_fee_amount: connect.applicationFeeCents } : {}),
  }
}

/** Re-align an unconfirmed PaymentIntent's amount (bill grew/shrank since it was
 *  created) — and, on a ROUTED PI, the application fee TOGETHER WITH it (the
 *  commission must always match the charged amount). Only valid while the PI is
 *  requires_payment_method / requires_confirmation — callers handle the failure
 *  by cancel + recreate. */
export async function updateIntentAmount(
  piId: string,
  amountCents: number,
  opts?: { applicationFeeCents?: number; idempotencyKey?: string },
): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.update(
    piId,
    {
      amount: amountCents,
      ...(opts?.applicationFeeCents != null ? { application_fee_amount: opts.applicationFeeCents } : {}),
    },
    opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
  )
}

/** Cancel any cancellable PaymentIntent (generic — not deposit-specific). */
export async function cancelIntent(piId: string): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.cancel(piId)
}

/** Charge-level facts for the LEDGER (A3): the charge id, the REAL Stripe
 *  processing fee (balance transaction) and the Connect transfer id when the
 *  charge was routed. One extra retrieve with expand — callers treat a failure
 *  as "facts unknown" (nulls), never as a payment failure. */
export async function retrieveChargeFacts(piId: string): Promise<{
  chargeId: string | null
  stripeFeeCents: number | null
  transferId: string | null
}> {
  const pi = await getStripe().paymentIntents.retrieve(piId, {
    expand: ['latest_charge.balance_transaction'],
  })
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === 'object'
    ? charge.balance_transaction
    : null
  const transfer = charge?.transfer
  return {
    chargeId:       charge?.id ?? null,
    stripeFeeCents: bt?.fee ?? null,
    transferId:     typeof transfer === 'string' ? transfer : transfer?.id ?? null,
  }
}

// ── Bill payment (Brique 2) ───────────────────────────────────────────────────
// IMPORTANT: this is the REAL charge for a table addition — NOT the empreinte.
// capture_method is AUTOMATIC (the customer is debited immediately), whereas the
// reservation empreinte above is MANUAL (authorise-only). Do NOT use
// createDepositHold for a bill. Commission is 0 in TEST (no Connect yet → the
// whole amount lands on the platform account); the fee can be added later.
export type TicketPaymentMetadata = {
  // The table-bill id — OPTIONAL since C1: a checkout ORDER charge reuses this
  // same automatic-capture factory and identifies itself via extraMetadata
  // (orderId + grubano_channel) instead.
  ticketId?:      string
  restaurantId:   string
  reservationId?: string
}

/** Create an AUTOMATIC-capture PaymentIntent — a real, immediate bill charge.
 *  With `connect` (A2): a DESTINATION charge — the resto receives the net,
 *  Grubano's commission (application_fee_amount, lib/commission) stays on the
 *  platform account. Without it: the exact pre-A2 platform charge (fallback). */
export async function createTicketPayment(opts: {
  amountCents:    number
  currency:       string
  metadata:       TicketPaymentMetadata
  connect?:       ConnectRouting
  extraMetadata?: Record<string, string>
  idempotencyKey?: string
}): Promise<Stripe.PaymentIntent> {
  // Stripe metadata values must be strings; omit absent ids entirely.
  const metadata: Record<string, string> = {
    restaurantId: opts.metadata.restaurantId,
    ...(opts.extraMetadata ?? {}),
  }
  if (opts.metadata.ticketId)      metadata.ticketId      = opts.metadata.ticketId
  if (opts.metadata.reservationId) metadata.reservationId = opts.metadata.reservationId

  return getStripe().paymentIntents.create(
    {
      amount:                    opts.amountCents,
      currency:                  opts.currency,
      capture_method:            'automatic', // ← REAL charge (vs manual empreinte)
      automatic_payment_methods: { enabled: true },
      metadata,
      ...connectParams(opts.connect),
    },
    opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
  )
}

// ── Stripe Connect — rail financier A1 (Express accounts, TEST mode) ──────────
// One Express connected account per establishment. KYC onboarding happens on
// Stripe-hosted pages (Account Links) — Grubano never touches identity papers.
// Payment ROUTING to these accounts (destination charges + application_fee) is
// A2: nothing here changes any existing money flow.

export type ConnectAccountStatus = 'pending' | 'active' | 'restricted'

/** Map a live Stripe Account onto our coarse onboarding status.
 *  active     = onboarding finished AND Stripe enabled both charges & payouts.
 *  restricted = onboarding finished but something blocks charges/payouts
 *               (expired document, rejected verification…).
 *  pending    = onboarding not finished yet (fresh account / abandoned form). */
export function mapAccountStatus(acct: Stripe.Account): ConnectAccountStatus {
  if (acct.details_submitted && acct.charges_enabled && acct.payouts_enabled) return 'active'
  if (acct.details_submitted) return 'restricted'
  return 'pending'
}

/** Create the establishment's Express account (France). The DAILY payout
 *  schedule (A0 decision) is set AT CREATION so it is never forgotten later. */
export async function createExpressAccount(restaurantId: string): Promise<Stripe.Account> {
  return getStripe().accounts.create({
    type:    'express',
    country: 'FR',
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    settings: { payouts: { schedule: { interval: 'daily' } } },
    metadata: { restaurantId },
  })
}

/** One-time Stripe-hosted onboarding link (expires after a few minutes — the
 *  caller regenerates one on every request; this never creates an account). */
export async function createOnboardingLink(
  accountId: string, refreshUrl: string, returnUrl: string,
): Promise<Stripe.AccountLink> {
  return getStripe().accountLinks.create({
    account:     accountId,
    refresh_url: refreshUrl,
    return_url:  returnUrl,
    type:        'account_onboarding',
  })
}

/** Read the live connected account (to sync stripeAccountStatus). */
export async function retrieveAccount(accountId: string): Promise<Stripe.Account> {
  return getStripe().accounts.retrieve(accountId)
}
