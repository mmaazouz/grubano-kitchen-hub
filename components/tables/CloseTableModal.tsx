'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { AlertTriangle, Loader2, CreditCard, ShieldOff, Check } from 'lucide-react'

// ── <CloseTableModal /> — traced closure + deposit choice (étape 3 E/F) ──────
//
// Drives Agent 2's POST /api/tickets/[id]/close { reason, deposit? } and
// Agent 14's empreinte settlement contract (capture/release in the response).
//
// reason:
//   - 'empty'  → subtotal == 0 → release the table, no question.
//   - 'unpaid' → subtotal > 0 unpaid → choose what happens to the hold.
//
// Smart default (Agent 14):
//   - subtotal > 0 AND a hold is active → pre-select 'capture'.
//   - subtotal == 0 → pre-select 'release'.
//   - no hold → don't show the choice (send no deposit).
//
// 'capture' = a real charge → explicit confirmation step showing the amount:
//   min(noShowPenalty>0 ? noShowPenalty : depositAmount, depositAmount).

interface Props {
  ticketId:      string
  subtotal:      number
  currency?:     string
  /** The reservation linked to the ticket — used to look up the empreinte
   *  details (GET /api/reservations/[id]/deposit). null = walk-in (no hold,
   *  no deposit choice). */
  reservationId: string | null | undefined
  onClose:       () => void
  /** Fired when the close succeeded — parent refetches the ticket (now void)
   *  and may surface a result toast with the settle outcome. */
  onClosed:      (result: {
    depositResult: 'captured' | 'released' | 'none' | 'error'
    capturedAmount?: number
    error?: string
  }) => void
}

export default function CloseTableModal({
  ticketId, subtotal, currency, reservationId, onClose, onClosed,
}: Props) {
  const t  = useTranslations('premium.closure')
  const locale = useLocale()

  const isEmpty = subtotal <= 0

  // Deposit details fetched from the existing owner GET endpoint. amount is in
  // CENTS (Agent 2's contract); we convert to euros for the labels. Mohammed's
  // rule: penalty = 100% of the hold → captureAmount ≈ depositAmount.
  const [depositStatus, setDepositStatus] = useState<string | null>(null)
  const [depositEuros,  setDepositEuros]  = useState<number>(0)
  const [depositCur,    setDepositCur]    = useState<string | undefined>(currency)
  const [holdLoaded,    setHoldLoaded]    = useState(false)

  useEffect(() => {
    if (!reservationId) { setHoldLoaded(true); return }
    let cancelled = false
    fetch(`/api/reservations/${reservationId}/deposit`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        setDepositStatus(body.depositStatus ?? null)
        if (typeof body.amount === 'number') setDepositEuros(body.amount / 100)
        if (body.currency) setDepositCur(body.currency)
      })
      .catch(() => { /* no hold info → choice hidden */ })
      .finally(() => { if (!cancelled) setHoldLoaded(true) })
    return () => { cancelled = true }
  }, [reservationId])

  const holdActive = depositStatus === 'authorized'

  // Smart default per Agent 14's contract (applied once the hold is loaded).
  const [choice, setChoice] = useState<'capture' | 'release' | 'none'>('none')
  useEffect(() => {
    if (!holdLoaded) return
    setChoice(!holdActive ? 'none' : isEmpty ? 'release' : 'capture')
  }, [holdLoaded, holdActive, isEmpty])

  type Stage = 'idle' | 'confirmCapture' | 'closing'
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')

  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (depositCur || currency || 'eur').toUpperCase(),
      maximumFractionDigits: 2,
    }),
    [locale, depositCur, currency],
  )
  const subtotalLabel = fmt.format(subtotal)
  const captureLabel  = fmt.format(depositEuros)

  async function doClose() {
    setStage('closing')
    setError('')
    try {
      const r = await fetch(`/api/tickets/${ticketId}/close`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: isEmpty ? 'empty' : 'unpaid',
          // Only send a deposit choice when a hold exists and reason=unpaid.
          ...(holdActive && !isEmpty ? { deposit: choice } : {}),
        }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        setError((body?.error as string) || t('errGeneric'))
        setStage('idle')
        return
      }
      const settled = body?.deposit?.settled as
        | null
        | { depositStatus?: string; capturedAmount?: number; error?: string }
      if (settled?.error) {
        onClosed({ depositResult: 'error', error: settled.error })
      } else if (settled?.depositStatus === 'captured') {
        onClosed({ depositResult: 'captured', capturedAmount: settled.capturedAmount })
      } else if (settled?.depositStatus === 'released') {
        onClosed({ depositResult: 'released' })
      } else {
        onClosed({ depositResult: 'none' })
      }
    } catch {
      setError(t('errGeneric'))
      setStage('idle')
    }
  }

  // The primary action: empty → direct close; capture → confirm first;
  // release/none → close directly.
  function primaryAction() {
    if (!isEmpty && holdActive && choice === 'capture') {
      setStage('confirmCapture')
      return
    }
    doClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-background p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-warning/15 text-warning">
            <AlertTriangle size={15} />
          </span>
          <p className="text-base font-bold">{t('title')}</p>
        </div>

        {stage === 'confirmCapture' ? (
          // ── Explicit charge confirmation ────────────────────────────────
          <div>
            <p className="text-sm text-muted-foreground">
              {t('captureWarning', { amount: captureLabel })}
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
                onClick={doClose}
                className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground"
              >
                {t('confirmCapture')}
              </button>
            </div>
          </div>
        ) : !holdLoaded && !isEmpty ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> …
          </div>
        ) : (
          <div>
            <p className="text-[13px] text-muted-foreground">
              {isEmpty ? t('emptyDesc') : t('unpaidDesc', { amount: subtotalLabel })}
            </p>

            {/* Deposit choice — only for unpaid + active hold */}
            {!isEmpty && holdActive && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t('depositChoice')}
                </p>
                <button
                  type="button"
                  onClick={() => setChoice('capture')}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[12px] font-semibold transition ${
                    choice === 'capture'
                      ? 'border-destructive bg-destructive/5 text-destructive'
                      : 'border-border bg-card text-foreground'
                  }`}
                >
                  <CreditCard size={14} className="shrink-0" />
                  <span className="flex-1">{t('depositCapture', { amount: captureLabel })}</span>
                  {choice === 'capture' && <Check size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setChoice('release')}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[12px] font-semibold transition ${
                    choice === 'release'
                      ? 'border-success bg-success/5 text-success'
                      : 'border-border bg-card text-foreground'
                  }`}
                >
                  <ShieldOff size={14} className="shrink-0" />
                  <span className="flex-1">{t('depositRelease')}</span>
                  {choice === 'release' && <Check size={14} />}
                </button>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-lg bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                {error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={stage === 'closing'}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={primaryAction}
                disabled={stage === 'closing'}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 ${
                  isEmpty ? 'bg-primary text-primary-foreground' : 'bg-destructive text-destructive-foreground'
                }`}
              >
                {stage === 'closing'
                  ? <Loader2 size={14} className="mx-auto animate-spin" />
                  : isEmpty ? t('confirmEmpty') : t('reasonUnpaid')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
