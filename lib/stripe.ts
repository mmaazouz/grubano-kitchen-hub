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
