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
// split selector + a per-person note. G1 wires the SERVICE line to a REAL,
// per-establishment configurable rate (Restaurant.dineInServiceRatePct, gated by
// DINEIN_SERVICE_ENABLED) — the server returns serviceRatePct/serviceCents/
// totalCents and we render « Service {pct}% » + the new total ONLY when the
// service > 0 (never fabricated; the inert path renders subtotal === total). G2
// adds the CD « Partager l'addition » split selector below the totals as a
// DISPLAY aid only: « À parts égales » shows billTotal ÷ guests; « Par personne »/
// « Par plat » need a multi-payer backend → inert « bientôt ». The « Payer » CTA is
// UNCHANGED (full remaining) — no split value EVER reaches /pay (money byte-identical).
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
  /** G1 — dine-in SERVICE CHARGE breakdown (resto-bound), exposed by GET
   *  /api/t/[tableId]/ticket. All 0/absent in the inert path (flag off / rate 0)
   *  → no service line, total === subtotal (byte-identical). Integer cents. */
  serviceRatePct?: number
  serviceCents?:   number
  subtotalCents?:  number
  totalCents?:     number
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

  // ── G2 — split-the-bill (CD Écran 4 « Partager l'addition »), DISPLAY-ONLY ────
  // The split NEVER changes the charged amount: « Payer » still pays the FULL
  // remaining via the byte-identical startPayment → POST /api/tickets/[id]/pay
  // (no body). « À parts égales » shows billTotal ÷ guests as a DISPLAY aid;
  // « Par personne »/« Par plat » need a multi-payer backend the app doesn't have
  // → inert « bientôt ». No split value is ever sent to the server.
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitMode, setSplitMode] = useState<'equal' | 'person' | 'item'>('equal')
  const [guests,    setGuests]    = useState(2)

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

  // ── G1 — dine-in service line (resto-bound, server-provided, integer cents) ──
  // hasService is TRUE only when the server returned a positive serviceCents
  // (flag ON + the establishment configured a rate > 0). In the inert path
  // serviceCents is 0/absent → hasService false → the bill renders exactly as
  // pre-G1 (subtotal === total, no service line). The percentage is formatted
  // from the server's serviceRatePct (e.g. 0.10 → "10") — never hardcoded.
  const serviceCents = ticket?.serviceCents ?? 0
  const hasService   = serviceCents > 0
  const servicePctLabel = useMemo(() => {
    const pct = (ticket?.serviceRatePct ?? 0) * 100
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(pct)
  }, [locale, ticket?.serviceRatePct])
  // Bill total = the server's totalCents when a service applies, else the plain
  // subtotal (byte-identical to pre-G1 — same value rendered, same code path).
  const billTotal = hasService ? (ticket!.totalCents ?? 0) / 100 : (ticket?.subtotal ?? 0)

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
  // G1: the « Service {pct}% » line is wired to the REAL configured rate and
  // shows ONLY when serviceCents > 0 (flag ON + a rate set). The split selector +
  // per-person note stay OMITTED (no backend). In the inert path the real subtotal
  // IS the total (no fabricated amount), byte-identical to pre-G1.
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

        {/* totals — G1: a « Service {pct}% » line appears ONLY when the
            establishment configured a dine-in service AND the flag is ON
            (serviceCents > 0). The service is RESTO revenue (flows to the resto
            net, NEVER Grubano's commission). In the inert path (flag off / rate 0)
            serviceCents is 0/absent → no service line and total === subtotal,
            byte-identical to pre-G1. Amounts come from the server in integer cents
            (real data — never fabricated). */}
        {hasService && (
          <div className="totrow">
            <span>{tTable('subtotal')}</span>
            <span><bdi>{currencyFmt.format((ticket!.subtotalCents ?? 0) / 100)}</bdi></span>
          </div>
        )}
        {hasService && (
          <div className="totrow">
            <span>{tTable('serviceLine', { pct: servicePctLabel })}</span>
            <span><bdi>{currencyFmt.format((ticket!.serviceCents ?? 0) / 100)}</bdi></span>
          </div>
        )}
        {!hasService && (
          <div className="totrow">
            <span>{tTable('subtotal')}</span>
            <span><bdi>{ticket ? currencyFmt.format(ticket.subtotal) : '—'}</bdi></span>
          </div>
        )}
        <div className="totrow tot">
          <span>{t('total')}</span>
          <span className="amt"><bdi>{ticket ? currencyFmt.format(billTotal) : '—'}</bdi></span>
        </div>

        {/* ── G2 — split selector (CD Écran 4 « Partager l'addition », display-only) ──
            VERBATIM CD reproduction (.split-row disclosure + 3-segment .split-seg +
            .split-note). A DISPLAY aid ONLY: « À parts égales » shows each guest's
            share (billTotal ÷ guests); « Par personne »/« Par plat » need a multi-payer
            backend → inert « bientôt ». The « Payer » CTA (foot) is UNCHANGED and still
            charges the FULL remaining — no split value EVER reaches /pay. */}
        {ticket && (
          <div className="split-block">
            <button
              type="button"
              className="split-row"
              onClick={() => setSplitOpen((o) => !o)}
              aria-expanded={splitOpen}
            >
              <span className="ms" aria-hidden="true">call_split</span>
              <span>{tTable('splitTitle')}</span>
              <span className="ms chev" aria-hidden="true">{splitOpen ? 'expand_less' : 'expand_more'}</span>
            </button>
            {splitOpen && (
              <>
                <div className="split-seg" role="tablist" aria-label={tTable('splitTitle')}>
                  {(['equal', 'person', 'item'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={splitMode === m}
                      className={splitMode === m ? 'on' : undefined}
                      onClick={() => setSplitMode(m)}
                    >
                      {m === 'equal'
                        ? tTable('split_equal')
                        : m === 'person'
                          ? tTable('split_person')
                          : tTable('split_item')}
                    </button>
                  ))}
                </div>
                {splitMode === 'equal' ? (
                  <div className="split-note">
                    <span className="ms" aria-hidden="true">groups</span>
                    <span className="split-cv">
                      <button
                        type="button"
                        onClick={() => setGuests((g) => Math.max(1, g - 1))}
                        aria-label={tTable('splitFewer')}
                      >−</button>
                      <bdi>{guests}</bdi>
                      <button
                        type="button"
                        onClick={() => setGuests((g) => Math.min(20, g + 1))}
                        aria-label={tTable('splitMore')}
                      >+</button>
                    </span>
                    <span>{tTable('splitGuests', { count: guests })}</span>
                    <span className="split-sep" aria-hidden="true">·</span>
                    <b><bdi>{currencyFmt.format(billTotal / guests)}</bdi></b>
                    <span>{tTable('splitPerPerson')}</span>
                  </div>
                ) : (
                  <div className="split-note">
                    <span className="ms" aria-hidden="true">schedule</span>
                    <span>{tTable('splitSoon')}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
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
