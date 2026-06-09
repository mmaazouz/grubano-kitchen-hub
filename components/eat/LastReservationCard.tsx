'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  Receipt, Loader2, AlertCircle, X,
} from 'lucide-react'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'

// ── <LastReservationCard /> — Brique 2 consumer-app pay shortcut (Agent 13) ──
//
// The reservation flow at /eat/r/[id]/reserver persists a thin
// `grubano_last_reservation` pointer to localStorage on success
// (reservationId, restaurantId, tableId, tableName, date, savedAt). This
// card reads it and offers a "Payer mon addition" shortcut so the connected
// guest can pay without scanning the QR. No new API endpoint — reuses the
// same two public endpoints as /t/[tableId]: GET /api/t/[tableId]/ticket
// then POST /api/tickets/[id]/pay, then mounts the factored
// <StripeTicketPayment /> component.

interface LastReservation {
  reservationId: string
  restaurantId:  string
  tableId:       string
  tableName:     string
  date:          string
  savedAt:       number
}

interface TicketPayload {
  id:       string
  status:   string
  currency: string
  subtotal: number
  items:    Array<{ id: string; name: string; unitPrice: number; quantity: number }>
}
interface PayInit {
  clientSecret:   string
  publishableKey: string
  amount:         number
  currency:       string
}

export default function LastReservationCard() {
  const t = useTranslations('bill')
  const locale = useLocale()
  const [stored, setStored] = useState<LastReservation | null>(null)
  const [open, setOpen]     = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('grubano_last_reservation')
      if (!raw) return
      const parsed = JSON.parse(raw) as LastReservation
      if (parsed?.reservationId && parsed?.tableId) setStored(parsed)
    } catch { /* non-fatal */ }
  }, [])

  function clearStored() {
    try { localStorage.removeItem('grubano_last_reservation') } catch { /* non-fatal */ }
    setStored(null)
  }

  const dateLabel = useMemo(() => {
    if (!stored?.date) return ''
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(stored.date))
    } catch { return stored.date }
  }, [stored?.date, locale])

  if (!stored) return null

  return (
    <>
      <div className="mt-3 rounded-[20px] bg-white p-4 shadow-bolt-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF3ED] text-[#F97316]">
            <Receipt size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-[#1a1a1a]">{t('accountSectionTitle')}</p>
            <p className="text-[12px] text-[#888]">{t('accountSubtitle')}</p>
            <p className="mt-1 truncate text-[12px] font-semibold text-[#1a1a1a]">
              {t('accountReservationLine', { restaurant: stored.tableName, date: dateLabel })}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex-1 rounded-[20px] bg-[#F97316] py-3 text-[14px] font-bold text-white active:scale-95"
          >
            {t('accountPayButton')}
          </button>
          <button
            type="button"
            onClick={clearStored}
            className="rounded-[20px] border border-[#f0f0f0] px-3 py-3 text-[12px] font-semibold text-[#888] active:scale-95"
          >
            {t('accountClearLastResa')}
          </button>
        </div>
      </div>

      {open && (
        <PayBillModal
          tableId={stored.tableId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function PayBillModal({
  tableId, onClose,
}: {
  tableId: string
  onClose: () => void
}) {
  const t = useTranslations('bill')
  const locale = useLocale()

  type Stage = 'loading' | 'no-ticket' | 'review' | 'pay' | 'paid' | 'error'
  const [stage,    setStage]    = useState<Stage>('loading')
  const [ticket,   setTicket]   = useState<TicketPayload | null>(null)
  const [payInit,  setPayInit]  = useState<PayInit | null>(null)
  const [error,    setError]    = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStage('loading')
    setError('')
    fetch(`/api/t/${tableId}/ticket`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('load_failed')
        return r.json() as Promise<{ ticket: TicketPayload | null }>
      })
      .then((body) => {
        if (cancelled) return
        if (!body.ticket) { setStage('no-ticket'); return }
        setTicket(body.ticket); setStage('review')
      })
      .catch(() => { if (!cancelled) { setError(t('errLoad')); setStage('error') } })
    return () => { cancelled = true }
  }, [tableId, t])

  async function startPayment() {
    if (!ticket || starting) return
    setStarting(true); setError('')
    try {
      const r = await fetch(`/api/tickets/${ticket.id}/pay`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (r.status === 409) { setError(t('errAlreadyPaid')); return }
      if (!r.ok || !body?.clientSecret) { setError(t('errStripeNotReady')); return }
      setPayInit(body as PayInit)
      setStage('pay')
    } catch {
      setError(t('errStripeNotReady'))
    } finally {
      setStarting(false)
    }
  }

  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (ticket?.currency || 'eur').toUpperCase(),
      maximumFractionDigits: 2,
    }),
    [locale, ticket?.currency],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-bold">{t('payTitle')}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="grid h-9 w-9 place-items-center rounded-xl bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        {stage === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> {t('loadingTicket')}
          </div>
        )}

        {stage === 'no-ticket' && (
          <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-[12px] text-muted-foreground">
            {t('accountNoTicket')}
          </p>
        )}

        {stage === 'error' && (
          <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error || t('errLoad')}</span>
          </p>
        )}

        {(stage === 'review' || stage === 'pay') && ticket && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-3">
              <ul className="divide-y divide-border">
                {ticket.items.map((it) => (
                  <li key={it.id} className="flex items-baseline gap-3 py-2 text-sm">
                    <span className="text-muted-foreground">{it.quantity}×</span>
                    <span className="flex-1 truncate text-foreground">{it.name}</span>
                    <span className="font-semibold text-foreground">
                      {fmt.format(it.unitPrice * it.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-sm font-bold">
                <span>{t('total')}</span>
                <span className="text-primary">{fmt.format(ticket.subtotal)}</span>
              </div>
            </div>

            {stage === 'review' && (
              <>
                {error && (
                  <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={startPayment}
                  disabled={starting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
                >
                  {starting ? <Loader2 size={14} className="animate-spin" /> : null}
                  {starting ? t('loadingPay') : t('payButton')}
                </button>
              </>
            )}

            {stage === 'pay' && payInit && (
              <StripeTicketPayment
                clientSecret={payInit.clientSecret}
                publishableKey={payInit.publishableKey}
                amount={payInit.amount}
                currency={payInit.currency}
                onPaid={() => setStage('paid')}
              />
            )}
          </div>
        )}

        {stage === 'paid' && (
          <div className="rounded-2xl border border-success/40 bg-success/5 p-4 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white">
              <Receipt size={20} />
            </span>
            <p className="mt-2 text-base font-bold text-foreground">{t('paidTitle')}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{t('paidBody')}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
            >
              {t('close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
