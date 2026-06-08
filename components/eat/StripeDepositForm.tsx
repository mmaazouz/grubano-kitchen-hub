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

// ── <StripeDepositForm /> — Payment-V1 card-hold (Agent 13) ───────────────────
//
// Mounts Stripe Elements with Agent 2's PaymentIntent (capture_method=manual)
// and walks the consumer through confirming the card hold. The Intent passes
// to `requires_capture` after success — the operator either RELEASES it on
// arrival (no charge) or CAPTURES the penalty on no-show.
//
// Contract:
//   POST /api/reservations/[id]/deposit → { clientSecret, publishableKey,
//                                           amount (cents), currency }
//   confirmPayment({ elements }) → on success the Intent is `requires_capture`
//
// The publishableKey is fetched from THE SAME endpoint — never bundled / never
// hardcoded — so the test/prod keypair always lines up.

interface DepositInit {
  clientSecret:   string
  publishableKey: string
  amount:         number  // in the smallest currency unit (cents for EUR)
  currency:       string
}

interface Props {
  reservationId: string
  /** Called once the hold is authorised so the parent can move to the
   *  "done" step. Receives the resolved status string (`requires_capture`,
   *  `processing`, etc.) for telemetry / display. */
  onAuthorized: (status: string) => void
}

export default function StripeDepositForm({ reservationId, onAuthorized }: Props) {
  const t = useTranslations('eat.reservation')
  const locale = useLocale()

  // ── State: init the PaymentIntent on mount ──────────────────────────────
  const [init, setInit]       = useState<DepositInit | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [stripePromise, setStripePromise] = useState<Promise<StripeClient | null> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadErr('')
    fetch(`/api/reservations/${reservationId}/deposit`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.clientSecret || !body?.publishableKey) {
          throw new Error(body?.error || 'init_failed')
        }
        return body as DepositInit
      })
      .then((d) => {
        if (cancelled) return
        setInit(d)
        // loadStripe(pk) returns a Promise that Elements consumes directly —
        // SHOULD live outside any render, so we put it in state instead of
        // creating a fresh one each render (which Stripe will warn about).
        setStripePromise(loadStripe(d.publishableKey))
      })
      .catch((err: Error) => {
        if (cancelled) return
        // The endpoint already returns clean error messages for `closed`,
        // `already captured`, etc. — surface a friendly fallback otherwise.
        setLoadErr(err.message === 'init_failed' ? t('errStripeNotReady') : t('errStripeNotReady'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reservationId, t])

  const currencyFmt = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (init?.currency ?? 'eur').toUpperCase(),
      maximumFractionDigits: 0,
    }),
    [locale, init?.currency],
  )
  const amountLabel = useMemo(() => {
    if (!init) return ''
    return currencyFmt.format(init.amount / 100)
  }, [currencyFmt, init])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-6 text-[12px] text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> {t('depositProcessing')}
      </div>
    )
  }
  if (loadErr || !init || !stripePromise) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
        <AlertCircle size={13} className="mt-0.5 shrink-0" />
        <span>{loadErr || t('errStripeNotReady')}</span>
      </p>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: init.clientSecret,
        // Inherit the host page's design system roughly — Stripe Elements'
        // own inputs blend in with the rest of the consumer UI.
        appearance: { theme: 'flat' },
        locale: 'auto',
      }}
    >
      <DepositInnerForm
        amountLabel={amountLabel}
        onAuthorized={onAuthorized}
      />
    </Elements>
  )
}

function DepositInnerForm({
  amountLabel, onAuthorized,
}: {
  amountLabel:  string
  onAuthorized: (status: string) => void
}) {
  const t       = useTranslations('eat.reservation')
  const stripe  = useStripe()
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
      // Manual-capture PaymentIntent → confirmPayment authorises the card.
      // On success the Intent reaches `requires_capture`, NOT `succeeded` —
      // that's exactly what the operator's release/capture buttons act on.
      const result = await stripe.confirmPayment({
        elements,
        // Stay on this page: we render our own success panel instead of
        // routing the user away to a return_url.
        redirect: 'if_required',
      })
      if (result.error) {
        const code = result.error.code
        if (code === 'card_declined') setError(t('errStripeDeclined'))
        else                          setError(t('errStripeGeneric'))
        return
      }
      const status = result.paymentIntent?.status ?? 'requires_capture'
      setDone(true)
      onAuthorized(status)
    } catch {
      setError(t('errStripeGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/5 p-4 text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-success text-white">
          <Check size={18} />
        </span>
        <p className="mt-2 text-[12px] font-bold text-foreground">{t('depositSubmit')} ✓</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('depositIntro', { amount: amountLabel })}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        {t('depositIntro', { amount: amountLabel })}
      </p>

      {/* PaymentElement = Stripe-managed inputs (card, supported methods). */}
      <PaymentElement options={{ layout: 'tabs' }} />

      <p className="text-[10px] text-muted-foreground">{t('depositHint')}</p>

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
        {submitting ? t('depositProcessing') : t('depositSubmit')}
      </button>
    </form>
  )
}
