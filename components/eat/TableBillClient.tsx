'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Clock, Loader2, AlertCircle, Receipt } from 'lucide-react'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import SessionBadge from '@/components/session/SessionBadge'
import OrderAtTable from '@/components/eat/OrderAtTable'
import { usePolling } from '@/lib/use-polling'
import { UtensilsCrossed } from 'lucide-react'

// ── <TableBillClient /> — client island for the QR landing /t/[tableId] ──────
//
// The page is server-rendered for identity (table + establishment) so a 404 on
// an unknown / deactivated table happens BEFORE any JS runs. This island then
// fetches the OPEN bill for the table (Agent 14 GET /api/t/[tableId]/ticket),
// renders the line items + total, and walks the consumer through the real
// charge via the factored <StripeTicketPayment /> component.
//
// 3 visible states:
//   - "no ticket yet"            → sober "addition arrive bientôt" (default
//                                   shell, mirrors the previous coquille)
//   - "ticket open"               → items + total + "Payer mon addition" button
//   - "paying" / "paid"           → Stripe Elements / success panel

interface TicketItem {
  id:        string
  name:      string
  unitPrice: number
  quantity:  number
}
interface TicketPayload {
  id:             string
  status:         string
  currency:       string
  subtotal:       number
  items:          TicketItem[]
  /** Brique A — exposed by Agent 2's GET /api/t/[tableId]/ticket select.
   *  null = walk-in: the guest's session has no reservation code. */
  reservationId?: string | null
}
interface PayInit {
  clientSecret:   string
  publishableKey: string
  amount:         number
  currency:       string
}

type Stage = 'loading' | 'no-ticket' | 'review' | 'pay' | 'paid' | 'error'

interface Props {
  tableId: string
}

export default function TableBillClient({ tableId }: Props) {
  const t = useTranslations('bill')
  const tOrder = useTranslations('premium.order')
  const locale = useLocale()

  const [stage,   setStage]   = useState<Stage>('loading')
  const [ticket,  setTicket]  = useState<TicketPayload | null>(null)
  const [error,   setError]   = useState('')
  const [payInit, setPayInit] = useState<PayInit | null>(null)
  const [starting, setStarting] = useState(false)
  // Bloc B — the Commander button shows ONLY when the connected visitor IS
  // the linked client of THIS table's arrived session (server truth via
  // /api/eat/my-session). Walk-ins / strangers never see it (and the order
  // endpoint re-enforces server-side anyway).
  const [canOrder,  setCanOrder]  = useState(false)
  const [restaurantIdForMenu, setRestaurantIdForMenu] = useState('')
  const [orderOpen, setOrderOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/eat/my-session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.session) return
        const s = body.session as { tableId: string; status: string; restaurantId: string }
        if (s.tableId === tableId && s.status === 'arrived') {
          setCanOrder(true)
          setRestaurantIdForMenu(s.restaurantId)
        }
      })
      .catch(() => { /* anonymous visitor — no order button */ })
    return () => { cancelled = true }
  }, [tableId])

  // Initial ticket fetch.
  const loadTicket = useCallback(async () => {
    setStage('loading')
    setError('')
    try {
      const r = await fetch(`/api/t/${tableId}/ticket`, { cache: 'no-store' })
      if (!r.ok) throw new Error('load_failed')
      const body = await r.json() as { ticket: TicketPayload | null }
      if (!body.ticket) {
        setTicket(null)
        setStage('no-ticket')
        return
      }
      setTicket(body.ticket)
      setStage('review')
    } catch {
      setError(t('errLoad'))
      setStage('error')
    }
  }, [tableId, t])

  useEffect(() => { loadTicket() }, [loadTicket])

  // ── Bloc A — realtime: silent 3s poll while the consumer keeps the page
  //   open. New lines added by the waiter show up alone; when the bill gets
  //   paid (this device OR another channel), the open ticket disappears
  //   server-side → if we were showing one, flip to the "addition réglée"
  //   paid screen instead of regressing to "addition bientôt".
  const sawTicketRef = useRef(false)
  usePolling(async () => {
    // Don't disturb the Stripe Elements sheet while typing card numbers.
    if (stage === 'pay' || stage === 'loading') return
    try {
      const r = await fetch(`/api/t/${tableId}/ticket`, { cache: 'no-store' })
      if (!r.ok) return
      const body = await r.json() as { ticket: TicketPayload | null }
      if (body.ticket) {
        sawTicketRef.current = true
        setTicket(body.ticket)
        if (stage === 'no-ticket' || stage === 'error') setStage('review')
      } else if (sawTicketRef.current && stage === 'review') {
        // The bill we were looking at is gone (paid / closed) → settled.
        setStage('paid')
      }
    } catch { /* best-effort */ }
  }, 3000, stage !== 'paid')

  async function startPayment() {
    if (!ticket || starting) return
    setStarting(true)
    setError('')
    try {
      const r = await fetch(`/api/tickets/${ticket.id}/pay`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (r.status === 409) { setError(t('errAlreadyPaid')); return }
      if (!r.ok || !body?.clientSecret || !body?.publishableKey) {
        setError(t('errStripeNotReady'))
        return
      }
      setPayInit({
        clientSecret:   body.clientSecret,
        publishableKey: body.publishableKey,
        amount:         body.amount,
        currency:       body.currency,
      })
      setStage('pay')
    } catch {
      setError(t('errStripeNotReady'))
    } finally {
      setStarting(false)
    }
  }

  const currencyFmt = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (ticket?.currency || 'eur').toUpperCase(),
      maximumFractionDigits: 2,
    }),
    [locale, ticket?.currency],
  )

  // ── States ────────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    return (
      <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> {t('loadingTicket')}
      </div>
    )
  }

  if (stage === 'no-ticket') {
    // Mirrors the sober coquille shown before the API existed.
    return (
      <div className="mt-10 flex flex-col items-center text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary">
          <Clock size={22} />
        </span>
        <p className="mt-4 text-lg font-semibold">{t('noTicketTitle')}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('noTicketDesc')}</p>
      </div>
    )
  }

  if (stage === 'error') {
    return (
      <div className="mt-10 flex flex-col items-center text-center">
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error || t('errLoad')}</span>
        </p>
        <button
          type="button"
          onClick={loadTicket}
          className="mt-3 rounded-xl border border-border bg-card px-4 py-2 text-[12px] font-bold"
        >
          {t('payButton')}
        </button>
      </div>
    )
  }

  if (stage === 'paid') {
    return (
      <div className="mt-10 rounded-2xl border border-success/40 bg-success/5 p-4 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white">
          <Receipt size={20} />
        </span>
        <p className="mt-2 text-base font-bold text-foreground">{t('paidTitle')}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{t('paidBody')}</p>
      </div>
    )
  }

  // Both review and pay show the items + total. Only the bottom area swaps.
  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {t('yourBill')}
        </h2>
        {/* Brique A — the session anchor. Same code the operator sees on
            their list/plan/addition tab. Guest can read it aloud to
            confirm "you're #A3F2, right?" */}
        <SessionBadge reservationId={ticket?.reservationId ?? null} variant="large" />
      </div>

      <div className="rounded-2xl border border-border bg-card p-3">
        <ul className="divide-y divide-border">
          {ticket?.items.map((it) => (
            <li key={it.id} className="flex items-baseline gap-3 py-2 text-sm">
              <span className="text-muted-foreground">{it.quantity}×</span>
              <span className="flex-1 truncate text-foreground">{it.name}</span>
              <span className="font-semibold text-foreground">
                {currencyFmt.format(it.unitPrice * it.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-sm font-bold">
          <span>{t('total')}</span>
          <span className="text-primary">
            {ticket ? currencyFmt.format(ticket.subtotal) : '—'}
          </span>
        </div>
      </div>

      {stage === 'review' && (
        <div className="space-y-3">
          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          {/* Bloc B — order-at-table for the LINKED connected client only. */}
          {canOrder && restaurantIdForMenu && (
            <button
              type="button"
              onClick={() => setOrderOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary py-3 text-sm font-bold text-primary"
            >
              <UtensilsCrossed size={14} /> {tOrder('cta')}
            </button>
          )}
          <button
            type="button"
            onClick={startPayment}
            disabled={starting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : null}
            {starting ? t('loadingPay') : t('payTitle')}
          </button>
        </div>
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

      {orderOpen && restaurantIdForMenu && (
        <OrderAtTable
          tableId={tableId}
          restaurantId={restaurantIdForMenu}
          onOrdered={() => { /* the 3s poll picks the new lines up */ }}
          onClose={() => setOrderOpen(false)}
        />
      )}
    </div>
  )
}
