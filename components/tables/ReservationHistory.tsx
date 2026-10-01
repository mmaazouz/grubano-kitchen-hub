'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Loader2, AlertCircle, X, Receipt } from 'lucide-react'
import SessionBadge from '@/components/session/SessionBadge'

// ── <ReservationHistory /> — per-reservation archive (étape 3 bloc G) ────────
//
// Owner-side. Click a PAST reservation → its archived consumption via Agent 2's
// GET /api/reservations/[id]/tickets. Shows every ticket (open|paid|void) with
// ALL items (cancelled lines distinct, struck through, out of total), the
// total, the status (paid / closed-unpaid / voided), closedReason, dates and
// the session code.

interface HItem {
  id:         string
  name:       string
  unitPrice:  number
  quantity:   number
  addedBy:    string
  status:     string
  cancelledAt: string | null
}
interface HTicket {
  id:           string
  status:       string
  currency:     string
  subtotal:     number
  openedAt:     string | null
  paidAt:       string | null
  closedReason: string | null
  closedAt:     string | null
  amountPaid:   number | null
  items:        HItem[]
}
interface HistoryPayload {
  reservation: { id: string; customerName: string; status: string; date: string }
  tickets:     HTicket[]
}

export default function ReservationHistory({
  reservationId, onClose,
}: {
  reservationId: string
  onClose: () => void
}) {
  const t  = useTranslations('premium.history')
  const tn = useTranslations('premium.notif')
  const locale = useLocale()

  const [data,    setData]    = useState<HistoryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/reservations/${reservationId}/tickets`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('load_failed')
        return r.json() as Promise<HistoryPayload>
      })
      .then((body) => { if (!cancelled) setData(body) })
      .catch(() => { if (!cancelled) setError(t('empty')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reservationId, t])

  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
    [locale],
  )
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [locale],
  )
  const fmtCur = (n: number, cur: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: (cur || 'eur').toUpperCase(), maximumFractionDigits: 2 }).format(n)

  function statusLabel(tk: HTicket): { label: string; cls: string } {
    if (tk.status === 'paid')                              return { label: t('statusPaid'),   cls: 'bg-success/15 text-success' }
    if (tk.status === 'void' && tk.closedReason === 'void_unpaid') return { label: t('statusUnpaid'), cls: 'bg-destructive/15 text-destructive' }
    if (tk.status === 'void')                              return { label: t('statusVoid'),   cls: 'bg-muted text-muted-foreground' }
    return { label: t('statusOpen'), cls: 'bg-primary/15 text-primary' }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-background sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <p className="flex items-center gap-2 text-base font-bold">
            <Receipt size={16} className="text-primary" /> {t('title')}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('back')}
            className="grid h-9 w-9 place-items-center rounded-xl bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> {t('loading')}
            </div>
          ) : error ? (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          ) : !data || data.tickets.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-3 py-8 text-center text-[12px] text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <div className="space-y-4">
              {/* Reservation header + session code */}
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-foreground">{data.reservation.customerName}</p>
                <SessionBadge reservationId={data.reservation.id} />
              </div>

              {data.tickets.map((tk) => {
                const s = statusLabel(tk)
                return (
                  <div key={tk.id} className="rounded-2xl border border-border bg-card p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${s.cls}`}>
                        {s.label}
                      </span>
                      <div className="text-right text-[10px] text-muted-foreground">
                        {tk.openedAt && <span>{t('openedAt')} {dateFmt.format(new Date(tk.openedAt))}</span>}
                        {tk.paidAt && <span className="ms-2">{t('paidAt')} {dateFmt.format(new Date(tk.paidAt))}</span>}
                        {tk.closedAt && !tk.paidAt && <span className="ms-2">{t('closedAt')} {dateFmt.format(new Date(tk.closedAt))}</span>}
                      </div>
                    </div>

                    <ul className="divide-y divide-border">
                      {tk.items.map((it) => {
                        const cancelled = it.status === 'cancelled'
                        return (
                          <li key={it.id} className="flex items-baseline gap-2 py-1.5 text-[13px]">
                            <span className="text-muted-foreground">{it.quantity}×</span>
                            <span className={`flex-1 truncate ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                              {it.name}
                              {it.addedBy === 'client' && (
                                <span className="ms-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-primary">
                                  {tn('clientLine')}
                                </span>
                              )}
                              {cancelled && (
                                <span className="ms-1.5 text-[9px] font-bold uppercase text-muted-foreground">
                                  {t('cancelledTag')}
                                </span>
                              )}
                            </span>
                            <span className={cancelled ? 'text-muted-foreground line-through' : 'font-semibold text-foreground'}>
                              {fmtCur(it.unitPrice * it.quantity, tk.currency)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>

                    <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-sm font-bold">
                      <span>{t('total')}</span>
                      <span>{fmtCur(tk.subtotal, tk.currency)}</span>
                    </div>
                    {tk.amountPaid != null && (
                      <p className="mt-0.5 text-right text-[11px] text-success">
                        {t('amountPaid')} {fmtCur(tk.amountPaid, tk.currency)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
