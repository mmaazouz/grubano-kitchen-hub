'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import SessionBadge from '@/components/session/SessionBadge'
import { usePolling } from '@/lib/use-polling'

// ── <TableBillClient /> — client island for the QR landing /t/[tableId] ──────
//
// VERBATIM reproduction of the FROZEN CD ref « Order at table / dine-in »
// (Notion 38efd2c9-…-81db, SCREEN 4 « L'addition »). The CD design tokens live
// in the gb-foundation; the component CSS is scoped under `.gb-table` in the
// route's t.css (imported by page.tsx). Material Symbols icons (no lucide).
//
// 🔒 MONEY page — VISUAL RE-SKIN ONLY. Every handler below (the ticket fetch,
// the 3s poll, startPayment → POST /api/tickets/[id]/pay, the Intl currency
// formatter, the Stripe Elements flow) is BYTE-IDENTICAL to the prior version.
// Only the JSX/markup changed.
//
// The page is server-rendered for identity (table + establishment) so a 404 on
// an unknown / deactivated table happens BEFORE any JS runs. This island then
// fetches the OPEN bill for the table (GET /api/t/[tableId]/ticket), renders the
// line items + total, and walks the consumer through the real charge via the
// factored <StripeTicketPayment /> component.
//
// CD-NOTE (real-data fidelity): the CD mock shows a « Service 10 % » line + a
// split selector + a per-person note. The REAL TicketPayload has NO service-fee
// field and NO split data (that backend is a post-Wave-5 chantier), so we do NOT
// fabricate them — we render the REAL subtotal as both Sous-total and Total.
//
// 5 visible states:
//   - "loading"        → .sk skeleton (real layout, zero shift)
//   - "no ticket yet"  → sober "addition arrive bientôt"
//   - "ticket open"    → items + total + "Payer mon addition" button
//   - "paying" / "paid"→ Stripe Elements / success panel
//   - "error"          → inline error + retry

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
  /** Establishment name for the CD table banner (null = link missing/archived). */
  establishmentName?: string | null
  /** Table label (e.g. "Table 12") for the banner + the title-row chip. */
  tableName?: string
}

export default function TableBillClient({ tableId, establishmentName, tableName }: Props) {
  const t = useTranslations('bill')
  const tTable = useTranslations('eat.table')
  const tOrder = useTranslations('premium.order')
  const locale = useLocale()
  const router = useRouter()

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

  // ── CD table banner — reused on every state (identity is server truth) ──────
  const tableLabel = tableName || tTable('tableFallback')
  const Banner = () => (
    <div className="tbanner">
      <span className="ic"><span className="ms" aria-hidden="true">table_restaurant</span></span>
      <div className="m">
        <b>{establishmentName || tTable('establishmentFallback')}</b>
        <span>{tTable('bannerMeta', { table: tableLabel })}</span>
      </div>
      <span className="live">{tTable('live')}</span>
    </div>
  )

  // ── CD title row — back-less « L'addition » + table chip ────────────────────
  const TitleRow = () => (
    <div className="h2bar">
      <h2>{tTable('billTitle')}</h2>
      <span className="tnum"><bdi>{tableLabel}</bdi></span>
    </div>
  )

  // ── States ────────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    // Skeleton mirrors the real bill layout (zero shift): banner → title → card.
    return (
      <>
        <Banner />
        <TitleRow />
        <div className="body">
          <p className="eyebrow">{tTable('servedDuringMeal')}</p>
          <div className="tb-skel-card" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="tb-skel-row">
                <span className="sk sk-line" style={{ width: '58%' }} />
                <span className="sk sk-line" style={{ width: 52 }} />
              </div>
            ))}
          </div>
          <span className="sk sk-line lg" style={{ width: '100%', height: 44, borderRadius: 13, display: 'block' }} />
        </div>
        <p className="wordmark">{tTable('poweredBy')}</p>
      </>
    )
  }

  if (stage === 'no-ticket') {
    // Sober "addition arrive bientôt" — bill not yet opened by the restaurant.
    return (
      <>
        <Banner />
        <TitleRow />
        <div className="state">
          <span className="state__ic"><span className="ms" aria-hidden="true">schedule</span></span>
          <h2>{t('noTicketTitle')}</h2>
          <p>{t('noTicketDesc')}</p>
        </div>
        <p className="wordmark">{tTable('poweredBy')}</p>
      </>
    )
  }

  if (stage === 'error') {
    return (
      <>
        <Banner />
        <TitleRow />
        <div className="state">
          <p className="err" role="alert">
            <span className="ms" aria-hidden="true">error</span>
            <span>{error || t('errLoad')}</span>
          </p>
          <button type="button" onClick={loadTicket} className="send-btn send-btn--line">
            <span className="ms" aria-hidden="true">refresh</span>
            <b>{t('payButton')}</b>
          </button>
        </div>
        <p className="wordmark">{tTable('poweredBy')}</p>
      </>
    )
  }

  if (stage === 'paid') {
    return (
      <>
        <Banner />
        <TitleRow />
        <div className="state">
          <span className="state__ic state__ic--ok"><span className="ms" aria-hidden="true">task_alt</span></span>
          <h2>{t('paidTitle')}</h2>
          <p>{t('paidBody')}</p>
        </div>
        <p className="wordmark">{tTable('poweredBy')}</p>
      </>
    )
  }

  // ── review / pay — both show the CD « addition » (items + totals) ───────────
  // The CD « Service 10 % » + split selector + per-person note are OMITTED on
  // purpose: the real ticket exposes no service-fee field and no split data, so
  // the real subtotal IS the total (no fabricated amount).
  return (
    <>
      <Banner />
      <TitleRow />

      <div className="body">
        {/* session anchor — same #A3F2 code the operator sees; read aloud to confirm */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <SessionBadge reservationId={ticket?.reservationId ?? null} variant="large" />
        </div>

        <p className="eyebrow">{tTable('servedDuringMeal')}</p>

        {/* cumulated bill — every line sent during the meal (CD .ocard / .oline) */}
        <div className="ocard">
          {ticket?.items.map((it) => (
            <div key={it.id} className="oline">
              <span><span className="qty"><bdi>{it.quantity}×</bdi></span> {it.name}</span>
              <span><bdi>{currencyFmt.format(it.unitPrice * it.quantity)}</bdi></span>
            </div>
          ))}
        </div>

        {/* totals — real subtotal = real total (no fabricated service fee) */}
        <div className="totrow">
          <span>{tTable('subtotal')}</span>
          <span><bdi>{ticket ? currencyFmt.format(ticket.subtotal) : '—'}</bdi></span>
        </div>
        <div className="totrow tot">
          <span>{t('total')}</span>
          <span className="amt"><bdi>{ticket ? currencyFmt.format(ticket.subtotal) : '—'}</bdi></span>
        </div>
      </div>

      <div className="foot">
        {stage === 'review' && (
          <>
            {error && (
              <p className="err" role="alert">
                <span className="ms" aria-hidden="true">error</span>
                <span>{error}</span>
              </p>
            )}
            {/* Bloc B — order-at-table for the LINKED connected client only.
                Per the CD note « 3 écrans/routes séparés », « Commander » opens the
                full-screen « Menu à table » ROUTE (/t/[tableId]/menu) — NOT the old
                <OrderAtTable/> modal. The new screen submits the same byte-identical
                POST /api/t/[tableId]/order and routes back here on success. */}
            {canOrder && restaurantIdForMenu && (
              <button
                type="button"
                onClick={() => router.push(`/t/${tableId}/menu`)}
                className="send-btn send-btn--line"
              >
                <span className="ms" aria-hidden="true">restaurant</span>
                <b>{tOrder('cta')}</b>
              </button>
            )}
            <button
              type="button"
              onClick={startPayment}
              disabled={starting}
              className="send-btn"
            >
              <span className="ms" aria-hidden="true">credit_card</span>
              <b>{starting ? t('loadingPay') : t('payTitle')}</b>
            </button>
            <small>{tTable('payLaterHint')}</small>
          </>
        )}

        {stage === 'pay' && payInit && (
          <div className="pay-sheet">
            <StripeTicketPayment
              clientSecret={payInit.clientSecret}
              publishableKey={payInit.publishableKey}
              amount={payInit.amount}
              currency={payInit.currency}
              onPaid={() => setStage('paid')}
            />
          </div>
        )}
      </div>

      <p className="wordmark">{tTable('poweredBy')}</p>
    </>
  )
}
