'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import {
  Banknote, Receipt, RotateCcw, FileText, Percent, Loader2, AlertCircle,
} from 'lucide-react'
import { Modal, Button, Input } from '@/components/design-system'
import ConnectCard from '@/components/connect/ConnectCard'

// ── <FinanceRail /> — rail financier A7, the resto's « Finances » section ──────
// Fed EXCLUSIVELY by LedgerEntry through the read-only A7 endpoints:
//   GET /api/restaurants/[id]/finance/summary?period=day|week|month
//   GET /api/restaurants/[id]/finance/operations?page=N
//   GET /api/restaurants/[id]/invoices (A4)
// Refund actions call the A5 endpoints AS-IS (policy 🔄: mandatory confirmation
// modal with the retained-on-payouts + 5-10 business days warnings). The
// establishment is resolved via GET /api/establishments (currentId). Vision UX:
// progressive info (overview → operations → invoices/rates), sober, mobile-first.

type Summary = {
  period: string
  grossCents: number
  applicationFeeCents: number
  netCents: number
  operationsCount: number
  refunds: { count: number; refundedCents: number; feeReturnedCents: number; netRefundedCents: number }
  netAfterRefundsCents: number
  refundRatePct: number
  rates: { dinein: number; pickup: number; delivery: number; reservation: number; freeUntil: string | null }
}

type Operation = {
  id: string
  type: 'payment' | 'deposit_capture' | 'refund' | 'adjustment'
  createdAt: string
  currency: string
  routed: boolean
  grossCents: number
  applicationFeeCents: number
  netCents: number
  refundedCents: number
  ticket: { id: string; status: string; tableName: string | null } | null
  reservation: { id: string; customerName: string; date: string; depositStatus: string } | null
  // C3-fix: the linked pickup/delivery order (joined by PaymentIntent) — its
  // refund action targets POST /api/orders/[id]/refund.
  order: { id: string; paymentStatus: string | null; fulfillmentType: string } | null
}

type InvoiceRow = {
  id: string; number: string; periodStart: string; periodEnd: string
  totalHt: number; totalTva: number; totalTtc: number
}

type Period = 'day' | 'week' | 'month'

export default function FinanceRail() {
  const t      = useTranslations('financeRail')
  const locale = useLocale()

  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [summary,    setSummary]    = useState<Summary | null>(null)
  const [period,     setPeriod]     = useState<Period>('week')
  const [operations, setOperations] = useState<Operation[]>([])
  const [page,       setPage]       = useState(1)
  const [hasMore,    setHasMore]    = useState(false)
  const [invoices,   setInvoices]   = useState<InvoiceRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(false)

  // Refund modal state — one modal serves both flows (bill / penalty).
  const [refundTarget, setRefundTarget] = useState<Operation | null>(null)
  const [partial,      setPartial]      = useState(false)
  const [amountEur,    setAmountEur]    = useState('')
  const [refunding,    setRefunding]    = useState(false)
  const [refundError,  setRefundError]  = useState('')

  const eur = useMemo(() => (cents: number) => formatMoney(cents, locale), [locale])
  const dateFmt = useMemo(() => (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])

  // ── Data loading ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/establishments', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setRestaurantId(d?.currentId ?? null))
      .catch(() => setLoadError(true))
  }, [])

  const loadSummary = useCallback(async (rid: string, p: Period) => {
    const r = await fetch(`/api/restaurants/${rid}/finance/summary?period=${p}`, { cache: 'no-store' })
    if (!r.ok) throw new Error('summary')
    setSummary(await r.json())
  }, [])

  const loadOperations = useCallback(async (rid: string, p: number, append: boolean) => {
    const r = await fetch(`/api/restaurants/${rid}/finance/operations?page=${p}`, { cache: 'no-store' })
    if (!r.ok) throw new Error('operations')
    const d = await r.json() as { operations: Operation[]; hasMore: boolean }
    setOperations(prev => (append ? [...prev, ...d.operations] : d.operations))
    setHasMore(d.hasMore)
    setPage(p)
  }, [])

  const loadInvoices = useCallback(async (rid: string) => {
    const r = await fetch(`/api/restaurants/${rid}/invoices`, { cache: 'no-store' })
    if (!r.ok) return // invoices are non-blocking
    const d = await r.json() as { invoices: InvoiceRow[] }
    setInvoices(d.invoices ?? [])
  }, [])

  const reloadAll = useCallback(async (rid: string, p: Period) => {
    setLoading(true)
    setLoadError(false)
    try {
      await Promise.all([loadSummary(rid, p), loadOperations(rid, 1, false), loadInvoices(rid)])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [loadSummary, loadOperations, loadInvoices])

  useEffect(() => {
    if (restaurantId) reloadAll(restaurantId, period)
  }, [restaurantId, period, reloadAll])

  // ── Refund flow (policy 🔄) ─────────────────────────────────────────────────
  const refundableCents = refundTarget
    ? Math.max(0, refundTarget.grossCents - refundTarget.refundedCents)
    : 0
  const refundAmountCents = (() => {
    if (!refundTarget) return 0
    if (refundTarget.type === 'deposit_capture' || !partial) return refundableCents
    const parsed = Math.round(parseFloat(amountEur.replace(',', '.')) * 100)
    return Number.isFinite(parsed) ? parsed : 0
  })()
  const refundAmountValid = refundAmountCents > 0 && refundAmountCents <= refundableCents

  function openRefund(op: Operation) {
    setRefundTarget(op)
    setPartial(false)
    setAmountEur('')
    setRefundError('')
  }

  async function confirmRefund() {
    if (!refundTarget || !restaurantId || refunding) return
    if (!refundAmountValid) { setRefundError(t('errAmountInvalid')); return }
    setRefunding(true)
    setRefundError('')
    try {
      const isPenalty = refundTarget.type === 'deposit_capture'
      const url = isPenalty
        ? `/api/reservations/${refundTarget.reservation?.id}/refund-deposit`
        : refundTarget.ticket
          ? `/api/tickets/${refundTarget.ticket.id}/refund`
          : `/api/orders/${refundTarget.order?.id}/refund` // C3-fix: pickup/delivery order
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isPenalty || !partial ? {} : { amountCents: refundAmountCents },
        ),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setRefundError(typeof d?.error === 'string' ? d.error : t('errGeneric'))
        return
      }
      setRefundTarget(null)
      // The ledger line lands via webhook within seconds — refresh shortly after.
      setTimeout(() => { void reloadAll(restaurantId, period) }, 4000)
      void reloadAll(restaurantId, period)
    } catch {
      setRefundError(t('errGeneric'))
    } finally {
      setRefunding(false)
    }
  }

  // No establishment / hard failure → render nothing alarming.
  if (restaurantId === null && !loadError) return null
  if (loadError && !summary) {
    return (
      <p className="mb-5 flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
        <AlertCircle size={14} /> {t('errLoad')}
      </p>
    )
  }

  const pct = (rate: number) => `${(rate * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`

  return (
    <section className="mb-8">
      {/* Connect status on top of the money section (A1 card, reused as-is). */}
      {restaurantId && <div className="mb-4"><ConnectCard restaurantId={restaurantId} /></div>}

      {/* ── Overview ── */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Banknote size={15} className="text-primary" /> {t('sectionTitle')}
        </h2>
        <div className="flex rounded-xl border border-border bg-card p-0.5">
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                period === p ? 'bg-navy text-navy-foreground' : 'text-muted-foreground'
              }`}
            >
              {t(p === 'day' ? 'periodDay' : p === 'week' ? 'periodWeek' : 'periodMonth')}
            </button>
          ))}
        </div>
      </div>

      {loading && !summary ? (
        <div className="mb-4 h-28 animate-pulse rounded-2xl bg-navy/10" />
      ) : summary && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Figure label={t('grossLabel')} value={eur(summary.grossCents)} strong />
          <Figure label={t('feeLabel')}   value={`−${eur(summary.applicationFeeCents)}`} />
          <Figure label={t('netLabel')}   value={eur(summary.netCents)} tone="success" />
          <Figure label={t('opsLabel')}   value={String(summary.operationsCount)} />
          {summary.refunds.count > 0 && (
            <div className="col-span-2 flex items-center justify-between rounded-2xl border border-border bg-card px-3.5 py-2.5 md:col-span-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('refundsLabel')}
              </span>
              <span className="text-[12px] font-semibold tabular-nums text-destructive">
                {t('refundsValue', { count: summary.refunds.count, amount: eur(summary.refunds.refundedCents) })}
                <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {t('refundRateLabel')} {summary.refundRatePct.toLocaleString(locale)}%
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Operations ── */}
      <h3 className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        <Receipt size={13} /> {t('opsTitle')}
      </h3>
      {operations.length === 0 && !loading ? (
        <p className="mb-4 rounded-2xl border border-dashed border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
          {t('opsEmpty')}
        </p>
      ) : (
        <div className="mb-2 space-y-1.5">
          {operations.map(op => <OperationRow key={op.id} op={op} eur={eur} dateFmt={dateFmt} t={t} onRefund={openRefund} />)}
        </div>
      )}
      {hasMore && (
        <div className="mb-4 text-center">
          <Button variant="ghost" size="sm" onClick={() => restaurantId && loadOperations(restaurantId, page + 1, true)}>
            {t('loadMore')}
          </Button>
        </div>
      )}

      {/* ── Invoices ── */}
      <h3 className="mb-2 mt-5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        <FileText size={13} /> {t('invoicesTitle')}
      </h3>
      {invoices.length === 0 ? (
        <p className="mb-4 rounded-2xl border border-dashed border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
          {t('invoicesEmpty')}
        </p>
      ) : (
        <div className="mb-4 space-y-1.5">
          {invoices.map(inv => (
            <div key={inv.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold">{inv.number}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(inv.periodStart).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                  {' · '}{t('htLabel')} {eur(inv.totalHt)} · {t('tvaLabel')} {eur(inv.totalTva)}
                </p>
              </div>
              <span className="text-[13px] font-bold tabular-nums">{eur(inv.totalTtc)}</span>
              <a
                href={`/api/restaurants/${restaurantId}/invoices/${inv.id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold"
              >
                {t('invoiceOpen')}
              </a>
              <a
                href={`/api/restaurants/${restaurantId}/invoices/${inv.id}/pdf`}
                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold"
              >
                {t('invoicePdf')}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* ── Transparency: the rates THIS resto pays ── */}
      {summary && (
        <>
          <h3 className="mb-2 mt-5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            <Percent size={13} /> {t('ratesTitle')}
          </h3>
          <div className="rounded-2xl border border-border bg-card p-3.5">
            {summary.rates.freeUntil && (
              <p className="mb-2 rounded-xl bg-success/10 px-3 py-2 text-[12px] font-bold text-success">
                {t('rateFreeBadge', {
                  date: new Date(summary.rates.freeUntil).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
                })}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4">
              <Rate label={t('rateDinein')}      value={pct(summary.rates.dinein)} />
              <Rate label={t('ratePickup')}      value={pct(summary.rates.pickup)} />
              <Rate label={t('rateDelivery')}    value={pct(summary.rates.delivery)} />
              <Rate label={t('rateReservation')} value={summary.rates.reservation === 0 ? t('rateFree') : pct(summary.rates.reservation)} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t('ratesDesc')}</p>
          </div>
        </>
      )}

      {/* ── Refund confirmation modal (policy 🔄 — MANDATORY warnings) ── */}
      <Modal
        open={!!refundTarget}
        onClose={() => !refunding && setRefundTarget(null)}
        title={refundTarget?.type === 'deposit_capture' ? t('modalPenaltyTitle') : t('modalTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRefundTarget(null)} disabled={refunding}>
              {t('modalCancel')}
            </Button>
            <Button variant="danger" onClick={confirmRefund} disabled={refunding || !refundAmountValid}>
              {refunding ? <Loader2 size={13} className="me-1 animate-spin" /> : <RotateCcw size={13} className="me-1" />}
              {t('modalConfirm')}
            </Button>
          </div>
        }
      >
        {refundTarget && (
          <div className="space-y-3">
            {/* Bill refunds: full / partial choice. Penalty: always full. */}
            {refundTarget.type === 'payment' && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={!partial} onChange={() => setPartial(false)} />
                  {t('modalFullOption', { amount: eur(refundableCents) })}
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={partial} onChange={() => setPartial(true)} />
                  {t('modalPartialOption')}
                </label>
                {partial && (
                  <Input
                    label={t('modalAmountLabel')}
                    hint={t('modalRemaining', { amount: eur(refundableCents) })}
                    inputMode="decimal"
                    value={amountEur}
                    onChange={e => setAmountEur(e.target.value)}
                    error={amountEur && !refundAmountValid ? t('errAmountInvalid') : undefined}
                  />
                )}
              </div>
            )}

            <p className="text-[13px] font-semibold">
              {t('modalRecap', { amount: eur(refundAmountValid ? refundAmountCents : refundableCents) })}
            </p>
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-[12px] leading-relaxed">
              <p>{t('modalWarnRetained')}</p>
              <p className="mt-1">{t('modalWarnDelay')}</p>
            </div>

            {refundError && (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {refundError}
              </p>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Figure({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'success' }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? 'text-xl font-bold' : 'text-lg font-bold'} ${tone === 'success' ? 'text-success' : ''}`}>
        {value}
      </p>
    </div>
  )
}

function Rate({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-bold tabular-nums">{value}</span>
    </div>
  )
}

function OperationRow({
  op, eur, dateFmt, t, onRefund,
}: {
  op: Operation
  eur: (c: number) => string
  dateFmt: (iso: string) => string
  t: (key: string, values?: Record<string, string | number>) => string
  onRefund: (op: Operation) => void
}) {
  const isRefundLine = op.type === 'refund'
  const refundable   = Math.max(0, op.grossCents - op.refundedCents)

  // Refund actions per the 🔄 policy: a PAID bill with money left; a PAID
  // pickup/delivery order with money left (C3-fix — same display rules); a
  // CAPTURED penalty not yet given back.
  const canRefundBill    = op.type === 'payment' && op.ticket?.status === 'paid' && refundable > 0
  const canRefundOrder   = op.type === 'payment' && !op.ticket &&
    op.order?.paymentStatus === 'paid' && refundable > 0
  const canRefundPenalty = op.type === 'deposit_capture' &&
    op.reservation?.depositStatus === 'captured' && op.refundedCents === 0

  const typeLabel =
    op.type === 'payment'         ? t('typePayment') :
    op.type === 'deposit_capture' ? t('typeDepositCapture') :
    op.type === 'refund'          ? t('typeRefund') : t('typeAdjustment')

  const typeTone =
    op.type === 'payment'         ? 'bg-success/10 text-success' :
    op.type === 'deposit_capture' ? 'bg-warning/10 text-warning' :
    'bg-destructive/10 text-destructive'

  return (
    <div className="rounded-2xl border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${typeTone}`}>{typeLabel}</span>

        {/* Refund badges derived from the ledger's own refund lines. */}
        {op.type === 'payment' && op.refundedCents > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
            {op.refundedCents >= op.grossCents ? t('badgeRefundedFull') : t('badgeRefundedPartial')}
          </span>
        )}
        {op.type === 'deposit_capture' && op.refundedCents > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
            {t('badgePenaltyRefunded')}
          </span>
        )}

        <span className={`ms-auto text-[14px] font-bold tabular-nums ${isRefundLine ? 'text-destructive' : ''}`}>
          {eur(op.grossCents)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{dateFmt(op.createdAt)}</span>
        {op.ticket?.tableName && <span>· {t('tableLabel', { name: op.ticket.tableName })}</span>}
        {op.reservation && !op.ticket?.tableName && <span>· {op.reservation.customerName}</span>}
        {op.applicationFeeCents !== 0 && (
          <span>· {t('commissionShort', { amount: eur(Math.abs(op.applicationFeeCents)) })}</span>
        )}
        {op.routed && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold">{t('routedDirect')}</span>}

        {(canRefundBill || canRefundOrder || canRefundPenalty) && (
          <button
            type="button"
            onClick={() => onRefund(op)}
            className="ms-auto rounded-lg border border-destructive/30 px-2 py-1 text-[10px] font-bold text-destructive"
          >
            {canRefundPenalty ? t('btnRefundPenalty') : t('btnRefund')}
          </button>
        )}
      </div>
    </div>
  )
}
