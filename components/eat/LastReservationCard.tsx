'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  Receipt, Loader2, AlertCircle, X, UtensilsCrossed, RefreshCw,
} from 'lucide-react'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import SessionBadge from '@/components/session/SessionBadge'
import OrderAtTable from '@/components/eat/OrderAtTable'
import { usePolling } from '@/lib/use-polling'

// ── <LastReservationCard /> — "Ma session" consumer view (étape 3 bloc C) ────
//
// The connected guest retrieves their CURRENT table session from the SERVER:
// GET /api/eat/my-session (the one new read-only endpoint of étape 3) returns
// the most recent reservation linked to their account in the active window
// (confirmed | arrived). THE SERVER IS THE SOURCE OF TRUTH (fix passe 2
// horaires) : a clean 200 { session:null } means NO card — and the stale
// localStorage pointer (`grubano_last_reservation`, written by the booking
// flow) is PURGED so a reservation cancelled by a closure can never resurface
// as a ghost « En attente de validation » card. The localStorage fallback only
// serves when the fetch fails TECHNICALLY (network error / 5xx). From here the
// guest can:
//   - see their session code (SessionBadge) + live bill (3s poll),
//   - ORDER at the table (status==='arrived' only — bloc B),
//   - PAY the bill (existing Stripe flow).

interface SessionInfo {
  reservationId:  string
  tableId:        string
  tableName:      string
  restaurantId:   string
  restaurantName: string
  status:         'confirmed' | 'arrived' | string
  date:           string
  // ── Annulation client (additive my-session fields) — absent on the
  // localStorage fallback → the cancel affordance simply doesn't show.
  depositStatus?:            string
  depositAmount?:            number
  cancellationWindowHours?:  number
  restaurantPhone?:          string | null
}

interface StoredPointer {
  reservationId: string
  restaurantId:  string
  tableId:       string
  tableName:     string
  date:          string
  savedAt:       number
}

interface TicketPayload {
  id:             string
  status:         string
  currency:       string
  subtotal:       number
  items:          Array<{ id: string; name: string; unitPrice: number; quantity: number }>
  reservationId?: string | null
}
interface PayInit {
  clientSecret:   string
  publishableKey: string
  amount:         number
  currency:       string
}

export default function LastReservationCard() {
  const t  = useTranslations('bill')
  const tm = useTranslations('premium.mysession')
  const to = useTranslations('premium.order')
  const locale = useLocale()

  const [session, setSession]   = useState<SessionInfo | null>(null)
  const [resolved, setResolved] = useState(false)
  const [payOpen, setPayOpen]   = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  // ── Annulation client ──
  const [cancelOpen, setCancelOpen]   = useState(false)
  const [cancelling, setCancelling]   = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelledMsg, setCancelledMsg] = useState('')

  // Server-first resolution. The fallback hierarchy (fix passe 2 horaires):
  //   200 + session        → show it.
  //   200 + session:null   → SERVER TRUTH: no active session → NO card + PURGE
  //                          the stale localStorage pointer (ghost-card fix).
  //   other 4xx (e.g. 401) → server answered, just no usable context → no card,
  //                          but NO purge (the server made no statement about
  //                          the stored reservation itself).
  //   network error / 5xx  → TECHNICAL failure only → localStorage fallback.
  const resolveSession = useCallback(async () => {
    try {
      const r = await fetch('/api/eat/my-session', { cache: 'no-store' })
      if (r.ok) {
        const body = await r.json() as { session: SessionInfo | null }
        if (body.session) {
          setSession(body.session)
        } else {
          setSession(null)
          try { localStorage.removeItem('grubano_last_reservation') } catch { /* non-fatal */ }
        }
        setResolved(true)
        return
      }
      if (r.status < 500) {
        setSession(null)
        setResolved(true)
        return
      }
      // 5xx → fall through to the technical-failure fallback below.
    } catch { /* network failure → fall through to localStorage */ }
    try {
      const raw = localStorage.getItem('grubano_last_reservation')
      if (raw) {
        const p = JSON.parse(raw) as StoredPointer
        if (p?.reservationId && p?.tableId) {
          setSession({
            reservationId:  p.reservationId,
            tableId:        p.tableId,
            tableName:      p.tableName,
            restaurantId:   p.restaurantId,
            restaurantName: '',
            status:         'confirmed',
            date:           p.date,
          })
        }
      }
    } catch { /* non-fatal */ }
    setResolved(true)
  }, [])

  useEffect(() => { resolveSession() }, [resolveSession])

  // Light status poll: when the restaurant marks the guest 'arrived', the
  // Commander button unlocks without a manual refresh.
  usePolling(resolveSession, 5000, resolved && !!session && session.status !== 'arrived')

  const dateLabel = useMemo(() => {
    if (!session?.date) return ''
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(session.date))
    } catch { return session.date }
  }, [session?.date, locale])

  // ── Annulation client — window math. The affordance only exists when the
  // session came from the SERVER (cancellationWindowHours present): the
  // localStorage fallback can't prove ownership, the route would 403 anyway.
  const windowHours = session?.cancellationWindowHours
  const deadline = useMemo(() => {
    if (!session?.date || typeof windowHours !== 'number') return null
    const d = new Date(new Date(session.date).getTime() - windowHours * 3_600_000)
    return Number.isNaN(d.getTime()) ? null : d
  }, [session?.date, windowHours])
  const cancellable = session?.status === 'confirmed' && deadline !== null && Date.now() < deadline.getTime()
  const windowClosed = session?.status === 'confirmed' && deadline !== null && Date.now() >= deadline.getTime()
  const deadlineLabel = useMemo(() => {
    if (!deadline) return ''
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }).format(deadline)
    } catch { return '' }
  }, [deadline, locale])
  const holdActive = session?.depositStatus === 'authorized'

  async function doCancel() {
    if (!session || cancelling) return
    setCancelling(true)
    setCancelError('')
    try {
      const r = await fetch(`/api/reservations/${session.reservationId}/cancel`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        const code = body?.code as string | undefined
        if (code === 'window_closed')        setCancelError(tm('cancelErrWindow'))
        else if (code === 'not_cancellable') setCancelError(tm('cancelErrState'))
        else                                 setCancelError((body?.error as string) || tm('cancelErrGeneric'))
        return
      }
      // Cancelled server-side → close the modal, show the transient note and
      // re-resolve: my-session now answers session:null → the card disappears
      // (and the stale localStorage pointer is purged by resolveSession).
      setCancelOpen(false)
      setCancelledMsg(tm('cancelledOk'))
      await resolveSession()
    } catch {
      setCancelError(tm('cancelErrGeneric'))
    } finally {
      setCancelling(false)
    }
  }

  if (!session) {
    // Transient post-cancellation note (the card itself is gone).
    if (cancelledMsg) {
      return (
        <div className="mt-3 rounded-[20px] bg-white p-4 text-center shadow-bolt-card">
          <p className="text-[13px] font-bold text-[#16a34a]">{cancelledMsg}</p>
        </div>
      )
    }
    return null
  }

  const arrived = session.status === 'arrived'

  return (
    <>
      <div className="mt-3 rounded-[20px] bg-white p-4 shadow-bolt-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF3ED] text-[#F97316]">
            <Receipt size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-[#1a1a1a]">{tm('title')}</p>
            <p className="text-[12px] text-[#888]">
              {arrived ? tm('statusActive') : tm('statusWaiting')}
            </p>
            <p className="mt-1 truncate text-[12px] font-semibold text-[#1a1a1a]">
              {[session.restaurantName, session.tableName, dateLabel].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-1.5">
              <SessionBadge reservationId={session.reservationId} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {/* Commander — only when the restaurant validated the arrival.
              Walk-ins / unlinked accounts are refused server-side anyway
              (403 walkin_no_order / not_your_session). */}
          {arrived && (
            <button
              type="button"
              onClick={() => setOrderOpen(true)}
              className="flex-1 rounded-[20px] bg-[#F97316] py-3 text-[14px] font-bold text-white active:scale-95"
            >
              <span className="inline-flex items-center gap-1.5">
                <UtensilsCrossed size={14} /> {to('cta')}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            className={`flex-1 rounded-[20px] py-3 text-[14px] font-bold active:scale-95 ${
              arrived
                ? 'border-2 border-[#F97316] text-[#F97316]'
                : 'bg-[#F97316] text-white'
            }`}
          >
            {t('accountPayButton')}
          </button>
        </div>

        {/* ── Annulation client — sober affordance under the actions. Window
            open → deadline + text-button to the confirm modal; window closed
            (still 'confirmed') → "call the restaurant" hint. Nothing once
            arrived, nothing on the localStorage fallback. */}
        {cancellable && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#f1f1f1] pt-2.5">
            <p className="text-[11px] text-[#888]">
              {tm('cancelDeadline', { deadline: deadlineLabel })}
            </p>
            <button
              type="button"
              onClick={() => { setCancelError(''); setCancelOpen(true) }}
              className="text-[12px] font-bold text-[#dc2626] underline-offset-2 active:scale-95"
            >
              {tm('cancelCta')}
            </button>
          </div>
        )}
        {windowClosed && (
          <p className="mt-2.5 border-t border-[#f1f1f1] pt-2.5 text-[11px] text-[#888]">
            {session.restaurantPhone
              ? tm('cancelClosedPhone', { phone: session.restaurantPhone })
              : tm('cancelClosedHint')}
          </p>
        )}
      </div>

      {/* ── Cancel confirmation modal ─────────────────────────────────────── */}
      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-background p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-destructive/15 text-destructive">
                <X size={15} />
              </span>
              <p className="text-base font-bold">{tm('cancelTitle')}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {tm('cancelBody', {
                restaurant: session.restaurantName || session.tableName,
                date:       dateLabel,
              })}
            </p>
            {holdActive && (
              <p className="mt-2 rounded-xl border border-success/40 bg-success/5 px-3 py-2 text-[12px] text-success">
                {tm('cancelBodyDeposit')}
              </p>
            )}
            {cancelError && (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{cancelError}</span>
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                disabled={cancelling}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm disabled:opacity-60"
              >
                {tm('cancelAbort')}
              </button>
              <button
                type="button"
                onClick={doCancel}
                disabled={cancelling}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground disabled:opacity-60"
              >
                {cancelling ? <Loader2 size={13} className="animate-spin" /> : null}
                {cancelling ? tm('cancelling') : tm('cancelConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {orderOpen && (
        <OrderAtTable
          tableId={session.tableId}
          restaurantId={session.restaurantId}
          onClose={() => setOrderOpen(false)}
        />
      )}

      {payOpen && (
        <PayBillModal
          tableId={session.tableId}
          onClose={() => setPayOpen(false)}
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

  const loadTicket = useCallback(async (silent = false) => {
    if (!silent) { setStage('loading'); setError('') }
    try {
      const r = await fetch(`/api/t/${tableId}/ticket`, { cache: 'no-store' })
      if (!r.ok) throw new Error('load_failed')
      const body = await r.json() as { ticket: TicketPayload | null }
      if (!body.ticket) {
        if (silent && ticket) { setStage('paid'); return }
        setStage('no-ticket')
        return
      }
      setTicket(body.ticket)
      if (stage !== 'pay') setStage('review')
    } catch {
      if (!silent) { setError(t('errLoad')); setStage('error') }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, t, ticket, stage])

  useEffect(() => { loadTicket() // eslint-disable-line react-hooks/exhaustive-deps
  }, [tableId])

  // Bloc A — the modal's bill follows the waiter's additions live.
  usePolling(() => loadTicket(true), 3000, stage === 'review' || stage === 'no-ticket')

  async function startPayment() {
    if (!ticket || starting) return
    setStarting(true); setError('')
    try {
      const r = await fetch(`/api/tickets/${ticket.id}/pay`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ via: 'account' }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.clientSecret) {
        setError((body?.error as string) || t('errStripeNotReady'))
        return
      }
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
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-base font-bold">{t('payTitle')}</p>
            <SessionBadge reservationId={ticket?.reservationId ?? null} />
          </div>
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
