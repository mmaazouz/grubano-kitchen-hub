'use client'

import { useEffect, useRef, useState } from 'react'
import { loadStripe, type Stripe as StripeClient, type PaymentRequest } from '@stripe/stripe-js'
import { Elements, PaymentRequestButtonElement, useStripe } from '@stripe/react-stripe-js'

// ── <WalletPaymentButton /> — Apple Pay / Google Pay 1-tap for the /eat-next checkout (Agent 137) ──
//
// 🟠 money-adjacent (payment UI), NOT the money engine. This button CONFIRMS the SAME PaymentIntent
// as the card form: identical `clientSecret`, minted server-side by POST /api/orders/[id]/pay where
// the amount = order.total. It NEVER computes or sends an amount — the charge is fixed by the
// PaymentIntent, and `confirmCardPayment(clientSecret, { payment_method })` only ATTACHES the wallet's
// payment method. The `amount`/`currency` props (SERVER values returned by /pay) are used ONLY to
// DISPLAY the total inside the native wallet sheet; they cannot change what is charged.
//
// Dedicated to /eat-next so StripeTicketPayment (shared with /eat) stays byte-identical: this mounts
// its OWN <Elements> with the same clientSecret. canMakePayment() gates visibility — no wallet on the
// device → renders nothing (the card path remains the only option). Success runs the SAME onPaid as
// the card (clearCart → tracking). Cancel/decline is graceful (card still available, cart kept).

interface Props {
  clientSecret:   string
  publishableKey: string
  amount:         number   // smallest currency unit (cents) — SERVER value from /pay, DISPLAY ONLY
  currency:       string   // SERVER value from /pay
  label:          string   // total label shown in the native wallet sheet
  heading?:       string   // optional section heading, rendered ONLY when a wallet is available
  errorLabel?:    string   // fallback message shown if the wallet payment fails (parity with the card)
  onPaid:         () => void
}

export default function WalletPaymentButton({
  clientSecret, publishableKey, amount, currency, label, heading, errorLabel, onPaid,
}: Props) {
  const [stripePromise, setStripePromise] = useState<Promise<StripeClient | null> | null>(null)
  useEffect(() => {
    if (!publishableKey) return
    setStripePromise(loadStripe(publishableKey))
  }, [publishableKey])

  // Need a Stripe key, a PaymentIntent secret, and a positive server amount before we can even ask
  // the device whether a wallet exists. Otherwise render nothing (card path is untouched).
  if (!stripePromise || !clientSecret || !amount) return null

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, locale: 'auto' }}>
      <WalletInner
        clientSecret={clientSecret}
        amount={amount}
        currency={currency}
        label={label}
        heading={heading}
        errorLabel={errorLabel}
        onPaid={onPaid}
      />
    </Elements>
  )
}

function WalletInner({
  clientSecret, amount, currency, label, heading, errorLabel, onPaid,
}: {
  clientSecret: string
  amount:       number
  currency:     string
  label:        string
  heading?:     string
  errorLabel?:  string
  onPaid:       () => void
}) {
  const stripe = useStripe()
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

  // Keep the latest onPaid without re-registering the wallet listener every render (onPaid is a fresh
  // closure in the parent). The effect below stays keyed on the SERVER payment values only.
  const onPaidRef = useRef(onPaid)
  useEffect(() => { onPaidRef.current = onPaid }, [onPaid])

  useEffect(() => {
    if (!stripe || !amount) return
    let cancelled = false

    // The wallet sheet total reflects the SERVER amount (cents from /pay) — never a client total.
    const pr = stripe.paymentRequest({
      country: 'FR',
      currency: (currency || 'eur').toLowerCase(),
      total: { label, amount },
      requestPayerName: false,
      requestPayerEmail: false,
    })

    pr.canMakePayment().then((result) => {
      if (cancelled) return
      // Only expose the button if a real wallet (Apple/Google Pay) is available on this device.
      setPaymentRequest(result ? pr : null)
    })

    pr.on('paymentmethod', async (ev) => {
      setPayError(null)
      // Confirm the SAME PaymentIntent (clientSecret from /pay). No amount is sent — the charge is
      // fixed server-side; we only attach the wallet's payment method.
      const { error, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: ev.paymentMethod.id },
        { handleActions: false },
      )
      if (error) {
        ev.complete('fail') // PM/charge hard-failed before any action → tell the sheet, stay graceful
        setPayError(error.message || errorLabel || null) // card path stays available, cart kept
        return
      }
      // Stripe REQUIRES the wallet sheet be dismissed now via ev.complete(): a 3-D Secure challenge
      // cannot open over a live Apple/Google Pay sheet. 'success' here only DISMISSES THE SHEET — it is
      // NOT the payment-success signal. onPaid stays gated on the real confirmation result below.
      ev.complete('success')
      if (paymentIntent && paymentIntent.status === 'requires_action') {
        const next = await stripe.confirmCardPayment(clientSecret) // default handleActions → runs 3DS
        if (next.error) {
          setPayError(next.error.message || errorLabel || null) // 3DS failed → no onPaid; cart kept
          return
        }
      }
      onPaidRef.current() // reached ONLY on a genuinely confirmed payment (SAME path as the card)
    })

    return () => { cancelled = true }
  }, [stripe, amount, currency, label, clientSecret])

  if (!paymentRequest) return null // no wallet available → render nothing (card-only)

  return (
    <div className="space-y-2">
      {heading && (
        <p className="font-stellar-display text-sm font-semibold text-stellar-muted-fg">{heading}</p>
      )}
      <PaymentRequestButtonElement
        options={{ paymentRequest, style: { paymentRequestButton: { theme: 'dark', height: '46px' } } }}
      />
      {payError && (
        <p className="rounded-stellar-md border border-stellar-border bg-stellar-surface-1 px-3 py-2 text-sm text-stellar-fg" role="alert">{payError}</p>
      )}
    </div>
  )
}
