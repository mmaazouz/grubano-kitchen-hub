'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Loader2, AlertCircle, CreditCard, Check } from 'lucide-react'
import { loadStripe, type Stripe as StripeClient } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'

// ── <StripeTicketPayment /> — Brique 2 bill payment (Agent 13) ───────────────
//
// Factored Stripe Elements component, used by BOTH the QR landing
// (/t/[tableId]) and the consumer-app account view (/eat/account → modal).
// Critical distinction vs StripeDepositForm: this PaymentIntent is
// capture_method='automatic' (a REAL charge, immediate capture), NOT a
// pre-authorisation. Agent 14's webhook handles the rest server-side:
// ticket.status = 'paid' AND if the ticket has a linked reservation with an
// active deposit hold, that hold is released automatically (we never charge
// the bill AND keep the guarantee blocked).
//
// Contract:
//   The caller has already POSTed /api/tickets/[id]/pay and received
//   { clientSecret, publishableKey, amount (cents), currency }. Those go in
//   via props. On success the parent fires onPaid (e.g. to flip the screen
//   to "Paid ✅").

interface Props {
  clientSecret:   string
  publishableKey: string
  amount:         number   // smallest currency unit (cents for EUR)
  currency:       string
  onPaid:         () => void
}

export default function StripeTicketPayment({
  clientSecret, publishableKey, amount, currency, onPaid,
}: Props) {
  const t = useTranslations('bill')
  const locale = useLocale()

  const [stripePromise, setStripePromise] = useState<Promise<StripeClient | null> | null>(null)
  useEffect(() => {
    if (!publishableKey) return
    setStripePromise(loadStripe(publishableKey))
  }, [publishableKey])

  const currencyFmt = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (currency || 'eur').toUpperCase(),
      maximumFractionDigits: 2, // exact amount — never round a payment phrase to the euro (M7)
    }),
    [locale, currency],
  )
  const amountLabel = useMemo(() => currencyFmt.format((amount ?? 0) / 100), [currencyFmt, amount])

  if (!stripePromise || !clientSecret) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-6 text-[12px] text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> {t('loadingPay')}
      </div>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: 'flat' },
        locale: 'auto',
      }}
    >
      <TicketInnerForm
        amountLabel={amountLabel}
        // LOT D (P-4) — auto-extinctive test-card tip: only rendered on a TEST
        // publishable key, so it disappears by itself at LIVE switch-over.
        isTestMode={publishableKey.startsWith('pk_test_')}
        onPaid={onPaid}
      />
    </Elements>
  )
}

function TicketInnerForm({
  amountLabel, isTestMode, onPaid,
}: {
  amountLabel: string
  isTestMode:  boolean
  onPaid:      () => void
}) {
  const t        = useTranslations('bill')
  const stripe   = useStripe()
  const elements = useElements()

  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')
  const [done,       setDone]       = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || submitting) return
    setSubmitting(true)
    setError('')
    try {
      // Capture-method 'automatic' (Agent 14) → confirmPayment immediately
      // captures. We don't redirect: render the success panel in-place.
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      })
      if (result.error) {
        const code = result.error.code
        if (code === 'card_declined') setError(t('errCardDeclined'))
        else                          setError(t('errGeneric'))
        return
      }
      setDone(true)
      onPaid()
    } catch {
      setError(t('errGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/5 p-4 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white">
          <Check size={20} />
        </span>
        <p className="mt-2 text-base font-bold text-foreground">{t('paidTitle')}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{t('paidBody')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        {t('payIntro', { amount: amountLabel })}
      </p>
      <p className="text-[10px] font-semibold text-destructive">{t('payRealDebitNote')}</p>

      <PaymentElement options={{ layout: 'tabs' }} />

      {/* LOT D (P-4) — the test-card tip renders only in Stripe TEST mode (pk_test_). */}
      {isTestMode && (
        <p className="text-[10px] text-muted-foreground">{t('testCardHint')}</p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {submitting
          ? <Loader2 size={14} className="animate-spin" />
          : <CreditCard size={14} />}
        {submitting ? t('processing') : t('payButton')}
      </button>
    </form>
  )
}
