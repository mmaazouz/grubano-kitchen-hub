'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, AlertCircle } from 'lucide-react'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'

// ── <InlinePayPanel /> — operator-side payment of an open ticket ─────────────
//
// Wraps Agent 14's POST /api/tickets/[id]/pay to obtain the PaymentIntent +
// publishable key, then mounts the SAME factored <StripeTicketPayment />
// component used by the QR landing (/t) and the consumer-app modal. Lives
// inline inside the operator dashboard — used in two contexts:
//   - resolving an "unpaid previous service" alert (settle the old bill),
//   - the general "Encaisser & clôturer" action when the operator settles a
//     current ticket directly at the dashboard (not the QR).

interface PayInit {
  clientSecret:   string
  publishableKey: string
  amount:         number
  currency:       string
}

export default function InlinePayPanel({
  ticketId, onPaid,
}: {
  ticketId: string
  /** Fired once the PaymentIntent reaches `succeeded`. The parent typically
   *  reacts by re-loading the ticket (which the webhook flipped to 'paid'
   *  on the server side) and surfacing a success toast. */
  onPaid: () => void
}) {
  const t = useTranslations('tickets.cloture')

  const [init,    setInit]    = useState<PayInit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/tickets/${ticketId}/pay`, { method: 'POST' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.clientSecret || !body?.publishableKey) {
          throw new Error(body?.error || 'init_failed')
        }
        return body as PayInit
      })
      .then((d) => { if (!cancelled) setInit(d) })
      .catch(() => { if (!cancelled) setError(t('errPay')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticketId, t])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 py-6 text-[12px] text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> {t('savingPay')}
      </div>
    )
  }
  if (error || !init) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
        <AlertCircle size={13} className="mt-0.5 shrink-0" />
        <span>{error || t('errPay')}</span>
      </p>
    )
  }
  return (
    <StripeTicketPayment
      clientSecret={init.clientSecret}
      publishableKey={init.publishableKey}
      amount={init.amount}
      currency={init.currency}
      onPaid={onPaid}
    />
  )
}
