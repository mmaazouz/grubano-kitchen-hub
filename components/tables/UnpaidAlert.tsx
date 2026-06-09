'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { AlertTriangle, CreditCard, Trash2, Loader2, X } from 'lucide-react'
import InlinePayPanel from '@/components/tables/InlinePayPanel'
import SessionBadge from '@/components/session/SessionBadge'

// ── <UnpaidAlert /> — alert + 2 actions for a stuck table (Agent 13) ─────────
//
// Surfaced on top of the Addition tab whenever Agent 2's contract reports a
// previous-service unpaid bill blocking the new session:
//   - POST /api/tickets → 409 { code:'table_has_unpaid_previous', ... }
//   - PATCH /api/reservations { status:'arrived' } → { ticketAlert: {...} }
//
// Two actions:
//   ENCAISSER — pay the previous bill via Stripe Elements (operator-side,
//   reuses StripeTicketPayment via InlinePayPanel). The webhook flips the
//   ticket to `paid`; on success we tell the parent to retry opening.
//
//   ANNULER — `PATCH /api/tickets/[id] { status:'void' }` after an explicit
//   confirmation (action destructive — no charge, no recovery). On success
//   we tell the parent to retry opening.

interface Props {
  /** The previous-service ticket id (from the server's alert payload). */
  existingTicketId: string
  /** Amount due (in major currency units) — comes straight from the server. */
  existingSubtotal: number
  /** Currency hint when known (server returns 'eur' by default). */
  currency?: string
  /** When the operator successfully settles or voids the previous bill we
   *  expect the parent to retry the open (POST /api/tickets) and clear
   *  the alert state. */
  onResolved: () => void
  /** Optional close button (the X). When omitted the alert is non-dismissible
   *  until resolved — the recommended UX while the table is stuck. */
  onDismiss?: () => void
  /** When the server already told us the prev session's reservationId via
   *  ticketAlert, we can render the SessionBadge of THAT ticket. Today the
   *  contract only exposes existingTicketId — keeping this optional so we
   *  can wire it in later without a breaking change. */
  previousReservationId?: string | null
}

export default function UnpaidAlert({
  existingTicketId, existingSubtotal, currency,
  onResolved, onDismiss, previousReservationId,
}: Props) {
  const t      = useTranslations('tickets.cloture')
  const locale = useLocale()

  type Stage = 'idle' | 'paying' | 'confirmVoid' | 'voiding' | 'error'
  const [stage,   setStage]   = useState<Stage>('idle')
  const [error,   setError]   = useState('')

  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (currency || 'eur').toUpperCase(),
      maximumFractionDigits: 2,
    }),
    [locale, currency],
  )
  const amountLabel = fmt.format(existingSubtotal)

  // ── ANNULER (void) — destructive, gated by a confirmation modal ───────────
  async function doVoid() {
    setStage('voiding')
    setError('')
    try {
      const r = await fetch(`/api/tickets/${existingTicketId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'void' }),
      })
      if (!r.ok) {
        setError(t('errVoid'))
        setStage('error')
        return
      }
      onResolved()
    } catch {
      setError(t('errVoid'))
      setStage('error')
    }
  }

  return (
    <div className="relative rounded-2xl border border-warning/40 bg-warning/10 p-4">
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="×"
          className="absolute end-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-warning/20 hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}

      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{t('unpaidTitle')}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('unpaidBody')}</p>

          {/* Previous-session badge + amount due */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('prevSession')}
            </span>
            <SessionBadge reservationId={previousReservationId ?? null} />
            <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-bold text-warning">
              {t('unpaidAmount', { amount: amountLabel })}
            </span>
          </div>
          <p className="mt-1 text-[10px] italic text-muted-foreground">
            {t('unpaidExplain')}
          </p>

          {/* Actions */}
          {stage === 'paying' ? (
            <div className="mt-3">
              <InlinePayPanel
                ticketId={existingTicketId}
                onPaid={() => onResolved()}
              />
              <button
                type="button"
                onClick={() => { setStage('idle'); setError('') }}
                className="mt-2 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t('cancel')}
              </button>
            </div>
          ) : stage === 'voiding' ? (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> {t('savingVoid')}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setError(''); setStage('paying') }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground"
              >
                <CreditCard size={13} /> {t('actionPay')}
              </button>
              <button
                type="button"
                onClick={() => { setError(''); setStage('confirmVoid') }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] font-bold text-destructive"
              >
                <Trash2 size={13} /> {t('actionVoid')}
              </button>
            </div>
          )}

          {error && (
            <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Void confirmation modal */}
      {stage === 'confirmVoid' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-background p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-destructive/15 text-destructive">
                <Trash2 size={15} />
              </span>
              <p className="text-base font-bold">{t('confirmVoidTitle')}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('confirmVoidBody', { amount: amountLabel })}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setStage('idle')}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={doVoid}
                className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground"
              >
                {t('confirmVoidCta')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
