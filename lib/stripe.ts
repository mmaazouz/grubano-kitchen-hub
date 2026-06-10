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

/** Create a pre-authorisation (manual capture) for the deposit/guarantee. */
export async function createDepositHold(opts: {
  amountCents: number
  currency:    string
  metadata:    DepositMetadata
}): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.create({
    amount:                    opts.amountCents,
    currency:                  opts.currency,
    capture_method:            'manual', // ← pre-authorisation (empreinte)
    automatic_payment_methods: { enabled: true },
    metadata:                  opts.metadata,
  })
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

/** Re-align an unconfirmed PaymentIntent's amount (bill grew/shrank since it was
 *  created). Only valid while the PI is requires_payment_method /
 *  requires_confirmation — callers handle the failure by cancel + recreate. */
export async function updateIntentAmount(piId: string, amountCents: number): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.update(piId, { amount: amountCents })
}

/** Cancel any cancellable PaymentIntent (generic — not deposit-specific). */
export async function cancelIntent(piId: string): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.cancel(piId)
}

// ── Bill payment (Brique 2) ───────────────────────────────────────────────────
// IMPORTANT: this is the REAL charge for a table addition — NOT the empreinte.
// capture_method is AUTOMATIC (the customer is debited immediately), whereas the
// reservation empreinte above is MANUAL (authorise-only). Do NOT use
// createDepositHold for a bill. Commission is 0 in TEST (no Connect yet → the
// whole amount lands on the platform account); the fee can be added later.
export type TicketPaymentMetadata = {
  ticketId:       string
  restaurantId:   string
  reservationId?: string
}

/** Create an AUTOMATIC-capture PaymentIntent — a real, immediate bill charge. */
export async function createTicketPayment(opts: {
  amountCents: number
  currency:    string
  metadata:    TicketPaymentMetadata
}): Promise<Stripe.PaymentIntent> {
  // Stripe metadata values must be strings; omit reservationId when absent.
  const metadata: Record<string, string> = {
    ticketId:     opts.metadata.ticketId,
    restaurantId: opts.metadata.restaurantId,
  }
  if (opts.metadata.reservationId) metadata.reservationId = opts.metadata.reservationId

  return getStripe().paymentIntents.create({
    amount:                    opts.amountCents,
    currency:                  opts.currency,
    capture_method:            'automatic', // ← REAL charge (vs manual empreinte)
    automatic_payment_methods: { enabled: true },
    metadata,
  })
}
