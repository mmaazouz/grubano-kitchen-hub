'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react'
import { formatEuros } from '@/lib/format-money'
import EstablishmentSwitcher, {
  type EstablishmentOption,
} from '@/components/dashboard/EstablishmentSwitcher'
import TicketPanel from '@/components/tables/TicketPanel'
import ReservationHistory from '@/components/tables/ReservationHistory'
import SessionBadge from '@/components/session/SessionBadge'
import { reservationCode } from '@/lib/reservation-code'
import { usePolling } from '@/lib/use-polling'
import '../../app/[locale]/tables/tables.css'

// ── /tables — Agent 13 / re-skin CD LOT 4 ──────────────────────────────────────
// The page used to be a single client component (~700 l.) that fetched
// /api/tables + /api/reservations on the implicit cookie-selected establishment.
// We turn it into a server-resolved island so:
//   • the establishment switcher (shared with /dashboard) can render at the top,
//   • fetches carry an explicit ?restaurantId=<currentId> (no race on cookie
//     propagation when switching),
//   • the default reservation duration (Agent 2, commit 3d20718) seeds the
//     modal AND the Config card without any extra round trip.
//
// 🔒 RE-SKIN PRESENTATION-ONLY (⚠️ ZONE ARGENT / STRIPE RÉEL). Navy shell owned by
// OperatorShell; this component renders ONLY the screen content inside op-content.
// Every fetch / React state / mutation handler (tables CRUD, reservations
// CRUD+status PATCH, fulfillment config, the manual-capture empreinte via
// POST/GET /api/reservations/[id]/deposit + Stripe Elements, tickets pay/close)
// is kept BYTE-IDENTICAL — only the markup is restyled to --op-* + Material
// Symbols. Acompte/pénalité = Float EUROS via formatEuros; Stripe amounts (cents)
// stay server-side. Stripe is NEVER simulated. Material Symbols, NOT lucide.

// ── Types ─────────────────────────────────────────────────────────────────────

type Table = {
  id:    string
  name:  string
  seats: number
  x:     number
  y:     number
  active: boolean
}

type Reservation = {
  id:           string
  tableId:      string
  customerName: string
  phone:        string | null
  email:        string | null
  guests:       number
  date:         string
  endTime:      string
  type:         'quick' | 'standard' | 'full'
  // 'completed' is set AUTOMATICALLY by the server (bill paid via webhook, or
  // table closed) — never by an operator action (Agent 14 fix session collée).
  // These reservations stay VISIBLE in the list/planning with a discreet
  // « Terminée » badge and must never be dropped by a filter.
  status:       'confirmed' | 'arrived' | 'overrun' | 'cancelled' | 'noshow' | 'completed'
  allergies:    string[]
  depositAmount: number
  depositPaid:  boolean
  // ── Stripe deposit lifecycle (Agent 2 Paiement V1) ─────────────────────────
  // depositStatus = 'none' | 'authorized' | 'captured' | 'released'
  // stripePaymentIntentId = the manual-capture PI handed back by Agent 2's
  // POST /api/reservations/[id]/deposit. Both are nullable / defaulted on the
  // server so older rows stay valid without backfill.
  depositStatus?:        'none' | 'authorized' | 'captured' | 'released' | string
  depositCurrency?:      string
  noShowPenalty?:        number
  stripePaymentIntentId?: string | null
  notes:        string | null
  table:        { id: string; name: string; seats: number }
}

type Tab = 'list' | 'calendar' | 'plan' | 'setup' | 'addition'

// ── consoOrigin (Agent 2's /t/[tableId] is on the SAME host as the dashboard
//   — staging app.grubano.com, prod grubano.com). Falling back to
//   NEXT_PUBLIC_CONSO_ORIGIN keeps us forward-compatible if the conso host
//   ever splits off; falling back to the empty string at SSR is harmless
//   because QR rendering only happens once the client has mounted. ──────────
function getConsoOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  const fromEnv = process.env.NEXT_PUBLIC_CONSO_ORIGIN
  return typeof fromEnv === 'string' ? fromEnv : ''
}

function buildQrUrl(origin: string, tableId: string): string {
  // /t/<id> is the PERMANENT URL Agent 2's middleware + page locked in. The
  // future payment flow will branch on the same URL, so today's printed QR
  // codes will keep working unchanged.
  return origin ? `${origin}/t/${tableId}` : ''
}

/** Sanitise a free-text label into something fit for a saved filename:
 *  lowercase, ASCII-only-ish, spaces → "-", dropping characters the OS may
 *  refuse. Falls back to "table" so we never produce an empty name. */
function slugForFilename(input: string, fallback = 'table'): string {
  const trimmed = (input ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const ascii   = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ascii || fallback
}

// ── Bloc D — new-client-order detection across arrived tables ───────────────
// The dashboard surfaces a "nouvelle commande" badge on the LIST + PLAN as soon
// as a connected guest adds a line (addedBy='client') to a table the operator
// hasn't opened yet. There is NO server notification model (T3.Q3): "seen" is
// UI-side. We bounded-poll ONLY the arrived tables' open tickets (reusing the
// owner GET /api/tickets?restaurantTableId=) every 6s, paused with the tab.
//
// Baseline rule: the FIRST time we see a table we treat its existing client
// lines as already-seen, so opening the page doesn't light up every table that
// ordered earlier in the service. Only lines that appear AFTER raise the badge.
// Acknowledged when the operator opens that table's Addition tab.
function useNewClientOrders(reservations: Reservation[], restaurantId: string | null) {
  const [newOrderTables, setNewOrderTables] = useState<Set<string>>(new Set())
  const seenRef       = useRef<Map<string, Set<string>>>(new Map())
  const baselinedRef  = useRef<Set<string>>(new Set())

  const arrivedTableIds = useMemo(
    () => Array.from(new Set(
      reservations.filter((r) => r.status === 'arrived' || r.status === 'overrun').map((r) => r.tableId),
    )),
    [reservations],
  )
  // A stable key so the poll callback only changes when the set really changes.
  const arrivedKey = arrivedTableIds.slice().sort().join(',')

  const poll = useCallback(async () => {
    if (!restaurantId || arrivedTableIds.length === 0) return
    await Promise.all(arrivedTableIds.map(async (tid) => {
      try {
        const r = await fetch(`/api/tickets?restaurantTableId=${tid}`, { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        const items: Array<{ id: string; addedBy?: string }> = d?.ticket?.items ?? []
        const clientIds = items.filter((it) => it.addedBy === 'client').map((it) => it.id)
        if (!baselinedRef.current.has(tid)) {
          // First sight of this table → existing client lines are the baseline.
          seenRef.current.set(tid, new Set(clientIds))
          baselinedRef.current.add(tid)
          return
        }
        const seen = seenRef.current.get(tid) ?? new Set<string>()
        const hasFresh = clientIds.some((id) => !seen.has(id))
        if (hasFresh) setNewOrderTables((prev) => {
          if (prev.has(tid)) return prev
          const next = new Set(prev); next.add(tid); return next
        })
      } catch { /* best-effort */ }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, arrivedKey])

  usePolling(poll, 6000, !!restaurantId && arrivedTableIds.length > 0)

  // Acknowledge: clear the badge and re-baseline so the table's current client
  // lines become "seen" on the next poll (no badge until a NEW line lands).
  const acknowledge = useCallback((tableId: string) => {
    setNewOrderTables((prev) => {
      if (!prev.has(tableId)) return prev
      const next = new Set(prev); next.delete(tableId); return next
    })
    baselinedRef.current.delete(tableId)
    seenRef.current.delete(tableId)
  }, [])

  return { newOrderTables, acknowledge }
}

export interface TablesShellProps {
  /** The establishment the page currently scopes to, resolved server-side from
   *  the cookie. `null` means the operator owns no establishment at all. */
  restaurantId:      string | null
  establishments:    EstablishmentOption[]
  currentId:         string
  /** Establishment-level default minutes — used to seed the New-reservation
   *  modal AND the Config card. 60 when no establishment / not set yet. */
  defaultDurationMin: number
}

export default function TablesShell({
  restaurantId,
  establishments,
  currentId,
  defaultDurationMin: initialDefaultDuration,
}: TablesShellProps) {
  const t = useTranslations('tables')

  const [tab,           setTab]           = useState<Tab>('list')
  const [tables,        setTables]        = useState<Table[]>([])
  const [reservations,  setReservations]  = useState<Reservation[]>([])
  const [loading,       setLoading]       = useState(true)
  const [selectedDate,  setSelectedDate]  = useState(new Date().toISOString().split('T')[0])
  const [addingRes,     setAddingRes]     = useState(false)
  // Brique A — selected table id for the Addition tab. Lifted HERE so a
  // navigation Liste → Addition → Liste → autre table never reloads or
  // loses the ticket context (the ticket itself stays open in the DB; this
  // is purely UI navigation). When the operator clicks a reservation /
  // floor-plan card with an open bill, we set this AND switch tabs.
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  // Bloc G — the reservation whose archived consumption is being viewed.
  const [historyResId, setHistoryResId] = useState<string | null>(null)

  // Bloc D — cross-table "nouvelle commande" detection (see hook above).
  const { newOrderTables, acknowledge: ackClientOrders } =
    useNewClientOrders(reservations, restaurantId)

  // Chantier horaires — POST /api/reservations (owner) may answer with a
  // NON-blocking { hoursWarning } when the slot falls outside the configured
  // hours: the reservation IS created (the restaurant is master of its own
  // room), we just surface the server's message in a dismissible banner.
  const [hoursWarning, setHoursWarning] = useState<string | null>(null)

  function openAddition(tableId: string) {
    // Opening the table's addition is the implicit "I've seen it" for its
    // pending client orders → clear the list/plan badge.
    ackClientOrders(tableId)
    setSelectedTableId(tableId)
    setTab('addition')
  }

  // When PATCH /api/reservations status='arrived' returns a `ticketAlert`
  // (Agent 2 a557d45/852ac73 contract: the previous-service ticket is still
  // open with items), we surface it on the Addition tab via <UnpaidAlert />.
  // Keyed by tableId so each stuck table carries its own banner — cleared
  // when the operator settles or voids the previous bill.
  const [unpaidByTable, setUnpaidByTable] = useState<
    Record<string, { existingTicketId: string; existingSubtotal: number; currency?: string }>
  >({})
  // Default duration as seen by the modal. Seeded server-side (no flash) and
  // refreshed every time /api/tables answers, so a Config save propagates here.
  const [defaultDurationMin, setDefaultDurationMin] = useState(initialDefaultDuration)

  // Helper: append ?restaurantId=<id> when we know the scope (the API also
  // honours the cookie, so a missing restaurantId still works — explicit is
  // safer when the cookie hasn't propagated after a switch).
  const scopedUrl = useCallback(
    (base: string) =>
      restaurantId
        ? `${base}${base.includes('?') ? '&' : '?'}restaurantId=${restaurantId}`
        : base,
    [restaurantId],
  )

  const loadTables = useCallback(async () => {
    if (!restaurantId) {
      setTables([])
      return
    }
    const r = await fetch(scopedUrl('/api/tables'), { cache: 'no-store' })
    if (r.ok) {
      const d = await r.json()
      setTables(d.tables ?? [])
      if (typeof d.defaultDurationMin === 'number') {
        setDefaultDurationMin(d.defaultDurationMin)
      }
    }
  }, [restaurantId, scopedUrl])

  const loadReservations = useCallback(async (date: string, silent = false) => {
    if (!restaurantId) {
      setReservations([])
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const r = await fetch(scopedUrl(`/api/reservations?date=${date}`), { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setReservations(d.reservations ?? [])
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [restaurantId, scopedUrl])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  useEffect(() => {
    loadReservations(selectedDate)
  }, [selectedDate, loadReservations])

  // ── Bloc A — realtime via polling. Silent refresh every 4s while the tab is
  //   visible: arrivals, status flips, paid bills (table freed) appear on the
  //   list / plan without a manual reload. The Addition tab has its own
  //   3s ticket poll inside TicketPanel.
  usePolling(() => loadReservations(selectedDate, true), 4000, !!restaurantId)

  async function updateStatus(
    id: string,
    status: Reservation['status'],
  ): Promise<{ ok: true } | { ok: false; status: number }> {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    const r = await fetch('/api/reservations', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status }),
    })
    if (!r.ok) {
      // Roll back the optimistic flip on failure and surface the status so
      // the caller can map a message. The next poll re-syncs anyway.
      loadReservations(selectedDate, true)
      return { ok: false, status: r.status }
    }
    // Agent 2's contract: when marking 'arrived' would have auto-opened a
    // ticket but a previous-service bill is still stuck on the same table,
    // the response carries `ticketAlert`. The reservation IS 'arrived', but
    // we navigate to the Addition tab and surface <UnpaidAlert /> so the
    // operator settles / voids the previous bill before serving the new
    // client.
    const body = await r.json().catch(() => null)
    const alert = body?.ticketAlert as
      | { code?: string; existingTicketId?: string; existingSubtotal?: number; currency?: string }
      | undefined
    if (status === 'arrived' && alert?.code === 'table_has_unpaid_previous' && alert.existingTicketId) {
      const reservation = reservations.find((res) => res.id === id)
      const tableId = reservation?.tableId
      if (tableId) {
        setUnpaidByTable((prev) => ({
          ...prev,
          [tableId]: {
            existingTicketId: alert.existingTicketId as string,
            existingSubtotal: Number(alert.existingSubtotal) || 0,
            currency:         alert.currency,
          },
        }))
        openAddition(tableId)
      }
    }
    return { ok: true }
  }

  function clearUnpaidFor(tableId: string) {
    setUnpaidByTable((prev) => {
      if (!prev[tableId]) return prev
      const next = { ...prev }
      delete next[tableId]
      return next
    })
  }

  // ── Bloc H — new empreinte cycle. "Client arrivé" calls ONLY
  // PATCH /api/reservations { status:'arrived' } — the empreinte STAYS active
  // until the bill is paid (the webhook releases it at payment) or until the
  // traced closure settles it (capture/release choice). "No-show" goes through
  // the same PATCH with status:'noshow' — the server captures the penalty
  // there (Agent 14 étape 2 wired captureHold into that transition).
  // The dedicated POST /deposit/release and /deposit/capture endpoints still
  // exist server-side but the dashboard NO LONGER calls them at arrival.

  async function releaseDeposit(id: string): Promise<{ ok: true } | { ok: false; status: number }> {
    // "Client arrivé": PATCH only — deposit untouched (released at payment).
    return updateStatus(id, 'arrived')
  }

  async function captureDeposit(id: string): Promise<{ ok: true } | { ok: false; status: number }> {
    // "No-show": PATCH — the server captures the penalty inside the same
    // transition (one round-trip, no separate deposit call).
    return updateStatus(id, 'noshow')
  }

  // ── 0-establishment guard ────────────────────────────────────────────────
  if (!restaurantId) {
    return (
      <section className="op-error"><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">storefront</span>
          <h2>{t('noEstabTitle')}</h2>
          <p>{t('noEstabDesc')}</p>
        </div>
      </div></section>
    )
  }

  const dateSub = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(selectedDate + 'T12:00:00'))

  return (
    <section className="op-rv">
      {/* ── Page head : title + switcher + « Nouvelle réservation » ───────── */}
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('pageTitle')}</h1>
          <p className="op-dash__sub">{dateSub}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* The switcher renders NOTHING at ≤1 establishment (mono-invisibility). */}
          <EstablishmentSwitcher establishments={establishments} currentId={currentId} />
          <button
            type="button"
            className="op-btn-add"
            onClick={() => setAddingRes(true)}
            disabled={tables.length === 0}
          >
            <span className="ms" aria-hidden="true">add</span>{t('newReservation')}
          </button>
        </div>
      </div>

      {/* Avertissement horaires non bloquant (owner) — la résa est créée. */}
      {hoursWarning && (
        <div className="op-warnbanner">
          <span className="ms" aria-hidden="true">warning</span>
          <div className="m">
            <b>{t('hoursWarningTitle')}</b>
            <p>{hoursWarning}</p>
            <p>{t('hoursWarningBody')}</p>
          </div>
          <button
            type="button"
            className="close"
            onClick={() => setHoursWarning(null)}
            aria-label={t('hoursWarningClose')}
          >
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>
      )}

      {/* ── tabs ── */}
      <div className="op-tabs" role="tablist">
        {(['list', 'calendar', 'plan', 'addition', 'setup'] as const).map(k => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={tab === k ? 'is-active' : undefined}
          >
            {t(`tab.${k}`)}
          </button>
        ))}
      </div>

      {/* ── 0-table empty state (only outside the Setup tab — Setup is where
            you'd add one). Keeps the page honest instead of presenting empty
            agendas / floor plans for a dark-kitchen-only establishment. ── */}
      {tables.length === 0 && tab !== 'setup' ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">chair_alt</span>
          <b>{t('noTablesTitle')}</b>
          <span>{t('noTablesDesc')}</span>
          <button className="op-btn-primary" onClick={() => setTab('setup')}>
            {t('noTablesGoSetup')}
          </button>
        </div></div>
      ) : (
        <>
          {tab === 'list' && (
            <ListView
              reservations={reservations}
              loading={loading}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              onUpdateStatus={updateStatus}
              onReleaseDeposit={releaseDeposit}
              onCaptureDeposit={captureDeposit}
              onOpenAddition={openAddition}
              newOrderTables={newOrderTables}
              onShowHistory={setHistoryResId}
            />
          )}
          {tab === 'calendar' && (
            <CalendarView
              reservations={reservations}
              tables={tables}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
            />
          )}
          {tab === 'plan' && (
            <FloorPlanView
              tables={tables}
              reservations={reservations}
              onOpenAddition={openAddition}
              newOrderTables={newOrderTables}
              onShowHistory={setHistoryResId}
            />
          )}
          {tab === 'addition' && (
            <TicketPanel
              tables={tables}
              selectedTableId={selectedTableId}
              alert={selectedTableId ? unpaidByTable[selectedTableId] ?? null : null}
              onAlertResolved={() => {
                if (selectedTableId) clearUnpaidFor(selectedTableId)
              }}
            />
          )}
          {tab === 'setup' && (
            <SetupView
              tables={tables}
              restaurantId={restaurantId}
              establishmentName={
                establishments.find((e) => e.id === currentId)?.name ?? ''
              }
              defaultDurationMin={defaultDurationMin}
              onDurationSaved={(min) => setDefaultDurationMin(min)}
              onRefresh={loadTables}
            />
          )}
        </>
      )}

      {addingRes && (
        <NewReservationForm
          tables={tables}
          defaultDurationMin={defaultDurationMin}
          onClose={() => setAddingRes(false)}
          onSaved={(warning) => {
            setAddingRes(false)
            setHoursWarning(warning ?? null)
            loadReservations(selectedDate)
          }}
        />
      )}

      {/* Bloc G — archived consumption of a past / closed reservation. */}
      {historyResId && (
        <ReservationHistory
          reservationId={historyResId}
          onClose={() => setHistoryResId(null)}
        />
      )}
    </section>
  )
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({
  reservations, loading, selectedDate, onDateChange, onUpdateStatus,
  onReleaseDeposit, onCaptureDeposit, onOpenAddition,
  newOrderTables, onShowHistory,
}: {
  reservations:     Reservation[]
  loading:          boolean
  selectedDate:     string
  onDateChange:     (d: string) => void
  onUpdateStatus:   (id: string, status: Reservation['status']) => void
  onReleaseDeposit: (id: string) => Promise<{ ok: true } | { ok: false; status: number }>
  onCaptureDeposit: (id: string) => Promise<{ ok: true } | { ok: false; status: number }>
  /** Brique A — fire when the operator clicks an `arrived` row (or the
   *  badge / "Voir l'addition" CTA). Switches TablesShell to the Addition
   *  tab focused on this table's open ticket. */
  onOpenAddition:   (tableId: string) => void
  /** Bloc D — tables with an unseen client order (badge on the row). */
  newOrderTables:   Set<string>
  /** Bloc G — open the archived-consumption view for a past reservation. */
  onShowHistory:    (reservationId: string) => void
}) {
  const t = useTranslations('tables')
  const tSession = useTranslations('session')
  const td = useTranslations('tables.deposit')
  const tnotif = useTranslations('premium.notif')
  const thist  = useTranslations('premium.history')
  const locale = useLocale()
  // Confirmation modal state for the no-show capture (real charge).
  const [confirmCapture, setConfirmCapture] = useState<Reservation | null>(null)
  // Per-reservation pending state for action buttons.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function doRelease(r: Reservation) {
    setActionError(null)
    setPendingId(r.id)
    const res = await onReleaseDeposit(r.id)
    if (!res.ok) {
      setActionError(res.status === 409 ? td('actionError409') : td('actionErrorGeneric'))
    }
    setPendingId(null)
  }

  async function doCapture(r: Reservation) {
    setActionError(null)
    setPendingId(r.id)
    const res = await onCaptureDeposit(r.id)
    if (!res.ok) {
      setActionError(res.status === 409 ? td('actionError409') : td('actionErrorGeneric'))
    }
    setPendingId(null)
    setConfirmCapture(null)
  }
  const [filter, setFilter] = useState<'all' | 'arrived' | 'allergy' | 'deposit'>('all')

  function prevDay() {
    const d = new Date(selectedDate); d.setDate(d.getDate() - 1)
    onDateChange(d.toISOString().split('T')[0])
  }
  function nextDay() {
    const d = new Date(selectedDate); d.setDate(d.getDate() + 1)
    onDateChange(d.toISOString().split('T')[0])
  }

  const filtered = reservations.filter(r => {
    if (filter === 'arrived') return r.status === 'arrived'
    if (filter === 'allergy') return r.allergies.length > 0
    if (filter === 'deposit') return r.depositAmount > 0
    return r.status !== 'cancelled' && r.status !== 'noshow'
  })

  const guests   = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'noshow')
                               .reduce((s, r) => s + r.guests, 0)
  const deposits = reservations.filter(r => r.depositPaid).reduce((s, r) => s + r.depositAmount, 0)

  const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(selectedDate + 'T12:00:00'))

  return (
    <>
      {/* Date nav */}
      <div className="day-select">
        <button type="button" className="nav" onClick={prevDay} aria-label={t('prevDay')}>
          <span className="ms flip-rtl" aria-hidden="true">chevron_left</span>
        </button>
        <span className="dlabel">{dayLabel}</span>
        <button type="button" className="nav" onClick={nextDay} aria-label={t('nextDay')}>
          <span className="ms flip-rtl" aria-hidden="true">chevron_right</span>
        </button>
      </div>

      {/* KPIs */}
      <div className="op-card stat-strip" style={{ marginBottom: 18 }}>
        <div className="stat"><span className="lbl">{t('kpiReservations')}</span><b className="mono">{filtered.length}</b></div>
        <div className="stat"><span className="lbl">{t('kpiCovers')}</span><b className="mono">{guests}</b></div>
        <div className="stat"><span className="lbl">{t('kpiDeposits')}</span><b className="mono">{formatEuros(deposits, locale, { noDecimals: true })}</b></div>
      </div>

      {/* Filters */}
      <div className="op-filters">
        <span className="ms lbl-ic" aria-hidden="true">filter_list</span>
        {(['all', 'arrived', 'allergy', 'deposit'] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`op-filter-chip${filter === k ? ' is-active' : ''}`}
          >
            {t(`filter.${k}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms spin" aria-hidden="true">progress_activity</span>
          <span>{t('loading')}</span>
        </div></div>
      ) : filtered.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">event_busy</span>
          <b>{t('emptyDayTitle')}</b>
          <span>{t('emptyDayDesc')}</span>
        </div></div>
      ) : (
        <div className="op-card rv-list">
          {filtered.map(r => {
            const time    = new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const endTime = new Date(r.endTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const hasHold = r.status === 'confirmed' && r.depositStatus === 'authorized'
            return (
              <div key={r.id} className="resv-row">
                <span className="time mono">{time}<small>{endTime}</small></span>
                <span className="covers"><span className="ms" aria-hidden="true">person</span>{r.guests}</span>
                <div className="m">
                  <b>{r.customerName}</b>
                  <span>{t('rowMeta', { table: r.table.name, guests: r.guests, release: endTime })}</span>
                  <div className="badges">
                    {/* Brique A — session anchor. Always rendered; for an
                        'arrived' service it becomes the clickable entry into
                        the Addition tab. */}
                    {r.status === 'arrived' ? (
                      <button
                        type="button"
                        onClick={() => onOpenAddition(r.tableId)}
                        title={tSession('openTableTitle')}
                        style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                      >
                        <SessionBadge reservationId={r.id} />
                      </button>
                    ) : (
                      <SessionBadge reservationId={r.id} />
                    )}
                    {r.status === 'arrived' && (
                      <span className="op-pill arrived"><i className="dot" />{t('status.arrived')}</span>
                    )}
                    {r.status === 'overrun' && (
                      <span className="op-pill overrun"><i className="dot" />{t('status.overrun')}</span>
                    )}
                    {r.status === 'completed' && (
                      <span className="op-pill completed"><i className="dot" />{t('statusCompleted')}</span>
                    )}
                    {/* Bloc D — a connected guest just added a line to this
                        table; tap to jump into the Addition (acknowledges). */}
                    {newOrderTables.has(r.tableId) && (r.status === 'arrived' || r.status === 'overrun') && (
                      <button
                        type="button"
                        onClick={() => onOpenAddition(r.tableId)}
                        className="op-pill neworder"
                      >
                        <span className="ms" aria-hidden="true">notifications_active</span>{tnotif('newClientOrder')}
                      </button>
                    )}
                    {r.depositAmount > 0 && (
                      <DepositBadge reservation={r} />
                    )}
                    <span className={`op-pill type-${r.type}`}>{t(`type.${r.type}`)}</span>
                  </div>
                  {r.allergies.length > 0 && (
                    <div className="allergy">
                      <span className="ms" aria-hidden="true">warning</span>{r.allergies.join(', ')}
                    </div>
                  )}
                </div>
                {/* Action column: when the reservation has an ACTIVE Stripe
                    hold (authorized), show release / capture pair. Otherwise
                    fall back to the legacy arrival / overrun status updates.
                    Plus a Bloc G history shortcut on any non-future res. */}
                <div className="status-col">
                  {hasHold ? (
                    <div className="dep-actions">
                      <button
                        type="button"
                        onClick={() => doRelease(r)}
                        disabled={pendingId === r.id}
                        className="op-btn-mini primary"
                        title={td('actionArrived')}
                      >
                        {pendingId === r.id
                          ? <span className="ms spin" aria-hidden="true">progress_activity</span>
                          : <><span className="ms" aria-hidden="true">check</span>{td('actionArrived')}</>}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmCapture(r)}
                        disabled={pendingId === r.id}
                        className="op-btn-mini danger"
                        title={td('actionNoshow')}
                      >
                        {td('actionNoshow')}
                      </button>
                    </div>
                  ) : r.status === 'confirmed' ? (
                    <button
                      type="button"
                      onClick={() => onUpdateStatus(r.id, 'arrived')}
                      className="op-btn-mini primary"
                    >
                      <span className="ms" aria-hidden="true">check</span>{td('actionMarkArrived')}
                    </button>
                  ) : r.status === 'arrived' ? (
                    <button
                      type="button"
                      onClick={() => onUpdateStatus(r.id, 'overrun')}
                      className="op-btn-mini ghost"
                    >
                      {t('status.overrun')}
                    </button>
                  ) : null}
                  {/* Bloc G — archived consumption. Hidden for a still-future
                      'confirmed' booking (nothing consumed yet). */}
                  {r.status !== 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => onShowHistory(r.id)}
                      aria-label={thist('title')}
                      title={thist('title')}
                      className="icon-btn-sm"
                    >
                      <span className="ms" aria-hidden="true">history</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error pill — used for both release and capture failures. */}
      {actionError && (
        <p className="op-actionerr">
          <span className="ms" aria-hidden="true">error</span>
          <span>{actionError}</span>
        </p>
      )}

      {/* Capture-confirm modal — the action DEBITS the client, so it lives
          behind an explicit "are you sure?" with the amount in the body. */}
      {confirmCapture && (
        <CaptureConfirmModal
          reservation={confirmCapture}
          pending={pendingId === confirmCapture.id}
          onCancel={() => setConfirmCapture(null)}
          onConfirm={() => doCapture(confirmCapture)}
        />
      )}
    </>
  )
}

// ── Deposit badge — one of authorized / released / captured ─────────────────

function DepositBadge({ reservation }: { reservation: Reservation }) {
  const td = useTranslations('tables.deposit')
  const locale = useLocale()
  const currency = (reservation.depositCurrency ?? 'eur').toUpperCase()
  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }),
    [locale, currency],
  )
  const amount = fmt.format(reservation.depositAmount)

  switch (reservation.depositStatus) {
    case 'authorized':
      return (
        <span className="op-pill dep-auth"><span className="mono">{td('depositBadgeAuth', { amount })}</span></span>
      )
    case 'released':
      return (
        <span className="op-pill dep-rel">{td('depositBadgeRel')}</span>
      )
    case 'captured':
      return (
        <span className="op-pill dep-cap"><span className="mono">{td('depositBadgeCap', { amount })}</span></span>
      )
    default:
      // Legacy reservations (depositStatus undefined or 'none') — show the
      // historical "acompte" pill so nothing visibly regresses.
      return (
        <span className="op-pill dep-legacy">
          <span className="mono">{amount}</span>
          {reservation.depositPaid ? ' ✓' : ''}
        </span>
      )
  }
}

// ── Capture confirm modal — explicit consent before charging the guest ──────

function CaptureConfirmModal({
  reservation, pending, onCancel, onConfirm,
}: {
  reservation: Reservation
  pending:     boolean
  onCancel:    () => void
  onConfirm:   () => void
}) {
  const td = useTranslations('tables.deposit')
  const locale = useLocale()
  const currency = (reservation.depositCurrency ?? 'eur').toUpperCase()
  const amount = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
      .format(reservation.noShowPenalty || reservation.depositAmount),
    [reservation.depositAmount, reservation.noShowPenalty, currency, locale],
  )

  return (
    <div className="op-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="op-modal narrow" role="dialog" aria-modal="true">
        <div className="op-modal__head">
          <span className="op-modal__ic danger"><span className="ms" aria-hidden="true">warning</span></span>
          <h3>{td('actionConfirmNoshowTitle')}</h3>
        </div>
        <div className="op-modal__body">
          <p className="op-modal__text">
            {td('actionConfirmNoshowBody', { amount })}
          </p>
        </div>
        <div className="op-modal__foot">
          <button type="button" className="op-btn-ghost" onClick={onCancel} disabled={pending}>
            {td('actionCancel')}
          </button>
          <button type="button" className="op-btn-danger" onClick={onConfirm} disabled={pending}>
            {pending
              ? <span className="ms spin" aria-hidden="true">progress_activity</span>
              : td('actionConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Calendar view ─────────────────────────────────────────────────────────────

function CalendarView({
  reservations, tables, selectedDate, onDateChange,
}: {
  reservations: Reservation[]
  tables:       Table[]
  selectedDate: string
  onDateChange: (d: string) => void
}) {
  const t = useTranslations('tables')
  const hours      = ['17h', '18h', '19h', '20h', '21h', '22h']
  const tableNames = tables.length > 0 ? tables.map(t => t.name) : ['T1', 'T2', 'Terrasse', 'Bar', 'Salon']

  const occupied: Record<string, string[]> = {}
  for (const r of reservations) {
    if (r.status === 'cancelled' || r.status === 'noshow') continue
    const tname = r.table.name
    const h     = new Date(r.date).getHours()
    if (!occupied[tname]) occupied[tname] = []
    occupied[tname].push(`${h}h`)
  }

  function prevDay() {
    const d = new Date(selectedDate); d.setDate(d.getDate() - 1)
    onDateChange(d.toISOString().split('T')[0])
  }
  function nextDay() {
    const d = new Date(selectedDate); d.setDate(d.getDate() + 1)
    onDateChange(d.toISOString().split('T')[0])
  }

  const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
    .format(new Date(selectedDate + 'T12:00:00'))

  const activeCount = reservations.filter(r => r.status !== 'cancelled').length
  const covers = reservations.filter(r => r.status !== 'cancelled').reduce((s, r) => s + r.guests, 0)

  return (
    <>
      <div className="day-select">
        <button type="button" className="nav" onClick={prevDay} aria-label={t('prevDay')}>
          <span className="ms flip-rtl" aria-hidden="true">chevron_left</span>
        </button>
        <span className="dlabel">{dayLabel}</span>
        <button type="button" className="nav" onClick={nextDay} aria-label={t('nextDay')}>
          <span className="ms flip-rtl" aria-hidden="true">chevron_right</span>
        </button>
      </div>

      <div className="op-card">
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">calendar_view_week</span>{t('agendaTitle')}</h2></div>
        <div className="agenda-wrap">
          <table className="agenda">
            <thead>
              <tr>
                <th className="col-table">{t('agendaTableCol')}</th>
                {hours.map(h => <th key={h} className="mono">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {tableNames.map(tn => (
                <tr key={tn}>
                  <td className="cell-table">{tn}</td>
                  {hours.map(h => {
                    const isOcc = occupied[tn]?.some(o => o === h || o.startsWith(h.replace('h', '')))
                    return (
                      <td key={h}>
                        <div className={`slot${isOcc ? ' busy' : ''}`} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="agenda-legend">
          <span><i className="free" />{t('legendFree')}</span>
          <span><i className="busy" />{t('legendBooked')}</span>
        </div>
      </div>

      {reservations.length > 0 && (
        <div className="agenda-summary">
          <span className="ms" aria-hidden="true">auto_awesome</span>
          <div className="m">
            <b>{t('serviceSummary')}</b>
            <span>{t('serviceSummaryBody', { count: activeCount, covers })}</span>
          </div>
        </div>
      )}
    </>
  )
}

// ── Floor plan view ───────────────────────────────────────────────────────────

function FloorPlanView({
  tables, reservations, onOpenAddition, newOrderTables, onShowHistory,
}: {
  tables:         Table[]
  reservations:   Reservation[]
  /** Brique A — fire when the operator taps an OCCUPIED table tile (a table
   *  with an `arrived` reservation today). Opens the Addition tab on it. */
  onOpenAddition: (tableId: string) => void
  /** Bloc D — tables with an unseen client order (dot on the tile). */
  newOrderTables: Set<string>
  /** Bloc G — open the archived-consumption view for a reservation. */
  onShowHistory:  (reservationId: string) => void
}) {
  const t = useTranslations('tables')
  const tSession = useTranslations('session')
  const tnotif   = useTranslations('premium.notif')
  const thist    = useTranslations('premium.history')
  const [selected, setSelected] = useState<string | null>(null)

  const bookedIds = new Set(
    reservations
      .filter(r => r.status === 'confirmed' || r.status === 'arrived')
      .map(r => r.tableId),
  )

  // Brique A — map tableId → ARRIVED reservation (the active session).
  // The Plan view shows the session code ONLY for tables with an arrived
  // service, since that's the precondition for an open ticket (Agent 2
  // a557d45 forces ensureOpenTicket to require an arrived reservation).
  // Plain `confirmed` reservations stay visible as "booked" but without a
  // session badge — there's no addition to navigate into yet, mirroring
  // the server-side rule: no `arrived` → no open bill.
  const arrivedByTable = new Map<string, Reservation>()
  for (const r of reservations) {
    if (r.status === 'arrived' && !arrivedByTable.has(r.tableId)) {
      arrivedByTable.set(r.tableId, r)
    }
  }

  const sel       = tables.find(t => t.id === selected)
  const selBooked = selected ? bookedIds.has(selected) : false
  const selRes    = sel ? reservations.filter(r => r.tableId === sel.id && r.status !== 'cancelled' && r.status !== 'noshow') : []
  const selArrived = sel ? arrivedByTable.get(sel.id) ?? null : null

  const displayTables = tables.length > 0 ? tables : [
    { id: 'T1', name: 'Table 1', seats: 2, x: 18, y: 22, active: true },
    { id: 'T2', name: 'Table 2', seats: 4, x: 55, y: 20, active: true },
    { id: 'T3', name: 'Terrasse', seats: 6, x: 22, y: 60, active: true },
  ]

  return (
    <div className="op-card">
      <div className="op-card__head"><h2><span className="ms" aria-hidden="true">table_restaurant</span>{t('floorTitle')}</h2></div>
      <div className="floor-grid">
        {displayTables.map(tb => {
          const booked  = bookedIds.has(tb.id)
          const arrived = arrivedByTable.get(tb.id)
          const cls = arrived ? 'occupied' : booked ? 'reserved' : 'free'
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => setSelected(tb.id)}
              className={`table-cell ${cls}${selected === tb.id ? ' is-selected' : ''}`}
            >
              {/* Bloc D — pulsing dot when a guest just ordered on this table. */}
              {newOrderTables.has(tb.id) && (
                <span className="neworder-dot" title={tnotif('newClientOrder')}>
                  <span className="ms" aria-hidden="true">notifications_active</span>
                </span>
              )}
              <b>{tb.name}</b>
              <span className="cap mono">{t('seatsShort', { n: tb.seats })}</span>
              {/* Session anchor: the arrived service's short code. */}
              {arrived && (
                <span className="code">{reservationCode(arrived.id)}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="floor-legend">
        <span><i style={{ background: 'var(--op-success)' }} />{t('legendFreeTable')}</span>
        <span><i style={{ background: 'var(--op-danger)' }} />{t('legendOccupied')}</span>
        <span><i style={{ background: 'var(--op-warning)' }} />{t('legendReserved')}</span>
      </div>

      {sel && (
        <div className="floor-detail">
          <div className="floor-detail__head">
            <div className="m">
              <b>{sel.name}</b>
              <span>{t('floorDetailMeta', { seats: sel.seats, state: selBooked ? t('stateReserved') : t('stateAvailable') })}</span>
              {selArrived && (
                <div className="sess">
                  <SessionBadge reservationId={selArrived.id} variant="large" />
                </div>
              )}
            </div>
            {selArrived ? (
              <button
                type="button"
                onClick={() => onOpenAddition(sel.id)}
                title={tSession('openTableTitle')}
                className="op-btn-mini primary"
              >
                <span className="ms" aria-hidden="true">receipt_long</span>{tSession('openTableTitle')}
              </button>
            ) : (
              <span className="icon-btn-sm"><span className="ms" aria-hidden="true">qr_code_2</span></span>
            )}
          </div>
          {selRes.length > 0 && (
            <div className="floor-detail__resv">
              {selRes.map(r => (
                <div key={r.id} className="r">
                  <span>{t('floorResvLine', {
                    time: new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                    name: r.customerName,
                    guests: r.guests,
                  })}</span>
                  {r.status !== 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => onShowHistory(r.id)}
                      aria-label={thist('title')}
                      title={thist('title')}
                      className="icon-btn-sm"
                    >
                      <span className="ms" aria-hidden="true">history</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Setup view ────────────────────────────────────────────────────────────────

function SetupView({
  tables, restaurantId, establishmentName, defaultDurationMin, onDurationSaved, onRefresh,
}: {
  tables:              Table[]
  restaurantId:        string
  establishmentName:   string
  defaultDurationMin:  number
  onDurationSaved:     (min: number) => void
  onRefresh:           () => void
}) {
  const t  = useTranslations('tables')
  const tn = useTranslations('tables.noShow')
  const locale = useLocale()
  const [adding, setAdding]   = useState(false)
  const [newTable, setNewTable] = useState({ name: '', seats: 4, x: 50, y: 50 })
  const [saving, setSaving]   = useState(false)

  // ── Deposit amount (Restaurant.defaultDepositAmount — Agent 14 bc99eaf) ───
  // Single field, replaces the two dead UI-only sliders ("acompte" + "pénalité").
  // Penalty = 100% of the deposit by Mohammed's decision, so there is exactly
  // one number to configure here. 0 disables the hold entirely.
  const [deposit, setDeposit]               = useState<number>(10)
  const [depositLoaded, setDepositLoaded]   = useState(false)
  const [depositSaving, setDepositSaving]   = useState(false)
  const [depositSavedAt, setDepositSavedAt] = useState<number | null>(null)
  const [depositError, setDepositError]     = useState('')

  // Hydrate at mount / whenever the active establishment changes. Tolerant:
  // a failure leaves the default of 10 (which matches Prisma's column default,
  // so the card is never visibly broken even when the endpoint hiccups).
  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    fetch(`/api/restaurants/${restaurantId}/fulfillment`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('load_failed')
        return r.json() as Promise<{ defaultDepositAmount?: number | null }>
      })
      .then((body) => {
        if (cancelled) return
        const fromApi = typeof body?.defaultDepositAmount === 'number' ? body.defaultDepositAmount : 10
        setDeposit(Math.max(0, Math.min(500, fromApi)))
        setDepositLoaded(true)
      })
      .catch(() => { if (!cancelled) setDepositLoaded(true) })
    return () => { cancelled = true }
  }, [restaurantId])

  // Auto-clear the "Saved" pill after 2 s (same idiom as duration above).
  useEffect(() => {
    if (!depositSavedAt) return
    const id = setTimeout(() => setDepositSavedAt(null), 2000)
    return () => clearTimeout(id)
  }, [depositSavedAt])

  async function saveDeposit(nextValue: number) {
    // Clamp to the API range (Zod 0..500) BEFORE sending so the input can't
    // produce a 400 we'd have to explain.
    const clamped = Math.max(0, Math.min(500, Math.round(nextValue)))
    setDeposit(clamped)
    setDepositError('')
    setDepositSaving(true)
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/fulfillment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ defaultDepositAmount: clamped }),
      })
      if (!r.ok) { setDepositError(tn('saveError')); return }
      setDepositSavedAt(Date.now())
    } catch {
      setDepositError(tn('saveError'))
    } finally {
      setDepositSaving(false)
    }
  }

  // ── Default reservation duration (Agent 2 endpoint, commit 3d20718) ────────
  // Lit + écrit GET/POST /api/restaurants/[id]/fulfillment
  // .defaultReservationDurationMin (Zod 15..600). Initialement seeded server-
  // side via la prop defaultDurationMin pour pas de flash.
  const [dur, setDur]                 = useState<number>(defaultDurationMin)
  const [durSaving, setDurSaving]     = useState(false)
  const [durSavedAt, setDurSavedAt]   = useState<number | null>(null)
  const [durError, setDurError]       = useState('')

  // Re-sync the local state when the parent reports a fresh default (e.g. after
  // a Switcher change or after this component just saved).
  useEffect(() => {
    setDur(defaultDurationMin)
  }, [defaultDurationMin])

  // Auto-clear the "Saved" pill after 2s so it doesn't linger.
  useEffect(() => {
    if (!durSavedAt) return
    const id = setTimeout(() => setDurSavedAt(null), 2000)
    return () => clearTimeout(id)
  }, [durSavedAt])

  async function saveDuration(nextMin: number) {
    // Clamp to the API range (Zod 15..600) before sending so the input can't
    // produce a 400 we'd have to explain.
    const clamped = Math.max(15, Math.min(600, Math.round(nextMin)))
    setDur(clamped)
    if (clamped === defaultDurationMin) return
    setDurSaving(true)
    setDurError('')
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/fulfillment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ defaultReservationDurationMin: clamped }),
      })
      if (!r.ok) {
        setDurError(t('durationSaveError'))
        return
      }
      onDurationSaved(clamped)
      setDurSavedAt(Date.now())
    } catch {
      setDurError(t('durationSaveError'))
    } finally {
      setDurSaving(false)
    }
  }

  const presets: Array<{ min: number; label: string }> = [
    { min: 60,  label: t('preset60')  },
    { min: 90,  label: t('preset90')  },
    { min: 120, label: t('preset120') },
  ]

  async function createTable(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/tables', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(newTable),
    })
    setSaving(false)
    setAdding(false)
    setNewTable({ name: '', seats: 4, x: 50, y: 50 })
    onRefresh()
  }

  return (
    <div className="op-setup">
      {/* ── Default reservation duration ── */}
      <div className="op-card">
        <div className="op-setup__body">
          <div className="op-setup__title">
            <span className="ms" aria-hidden="true">timer</span>{t('durationTitle')}
            {durSaving && <span className="ms savingic" aria-hidden="true">progress_activity</span>}
            {!durSaving && durSavedAt && (
              <span className="saved"><span className="ms" aria-hidden="true">check</span>{t('durationSavedShort')}</span>
            )}
          </div>
          <p className="op-setup__desc">{t('durationDesc')}</p>

          <div className="op-presets">
            {presets.map((p) => {
              const active = dur === p.min
              return (
                <button
                  key={p.min}
                  type="button"
                  onClick={() => saveDuration(p.min)}
                  disabled={durSaving}
                  aria-pressed={active}
                  className={`op-preset${active ? ' is-active' : ''}`}
                >
                  {p.label}
                </button>
              )
            })}
            <div className="op-num">
              <input
                type="number"
                min={15}
                max={600}
                step={15}
                value={dur}
                onChange={(e) => setDur(Number(e.target.value))}
                onBlur={(e) => saveDuration(Number(e.target.value))}
                disabled={durSaving}
                aria-label={t('durationLabel')}
              />
              <span>{t('durationUnit')}</span>
            </div>
          </div>

          <p className="op-setup__hint">{t('durationHint')}</p>

          {durError && <p className="op-setup__err">{durError}</p>}
        </div>
      </div>

      {/* ── No-show protection — single field wired to
            Restaurant.defaultDepositAmount (Agent 14 bc99eaf). ── */}
      <div className="op-card">
        <div className="op-setup__body">
          <div className="op-setup__title">
            <span className="ms" aria-hidden="true">verified_user</span>{tn('sectionTitle')}
            {depositSaving && <span className="ms savingic" aria-hidden="true">progress_activity</span>}
            {!depositSaving && depositSavedAt && (
              <span className="saved"><span className="ms" aria-hidden="true">check</span>{tn('savedShort')}</span>
            )}
            {!depositSaving && !depositSavedAt && deposit === 0 && (
              <span className="disabled-tag">{tn('disabledLabel')}</span>
            )}
          </div>
          <p className="op-setup__desc">{tn('intro')}</p>

          <label className="op-setup__label">{tn('depositLabel')}</label>
          <div className="op-presets">
            {[0, 10, 15, 20].map((preset) => {
              const active = deposit === preset
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => saveDeposit(preset)}
                  disabled={depositSaving || !depositLoaded}
                  aria-pressed={active}
                  className={`op-preset${active ? ' is-active' : ''}`}
                >
                  {preset === 0 ? '0' : `${preset}€`}
                </button>
              )
            })}
            {/* Numeric input — save on blur so the operator can type freely
                without firing a POST on every keystroke. */}
            <div className="op-num">
              <input
                type="number"
                min={0}
                max={500}
                step={1}
                value={deposit}
                onChange={(e) => setDeposit(Number(e.target.value))}
                onBlur={(e) => saveDeposit(Number(e.target.value))}
                disabled={depositSaving || !depositLoaded}
                aria-label={tn('depositLabel')}
              />
              <span>€</span>
            </div>
          </div>
          <p className="op-setup__hint">{tn('depositHint')}</p>

          <p className="op-setup__penalty">{tn('penaltyNote')}</p>

          <p className="op-setup__mininote">
            {deposit === 0
              ? tn('customerSeesNone')
              : tn('customerSeesPrefix', { amount: deposit })}
          </p>

          {depositError && <p className="op-setup__err">{depositError}</p>}
        </div>
      </div>

      {/* Table list */}
      {tables.length > 0 && (
        <div className="op-card">
          <div className="op-setup__body">
            <p className="op-setup__count">{t('tablesConfigured', { n: tables.length })}</p>
            <div className="op-tablelist">
              {tables.map(tb => (
                <div key={tb.id} className="row">
                  <b>{tb.name}</b>
                  <span>{t('seatsDot', { n: tb.seats })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── QR codes per table ── */}
      <QrCodesSection
        tables={tables}
        establishmentName={establishmentName}
      />

      {/* Add table */}
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="op-add-row">
          <span className="lft"><span className="ms" aria-hidden="true">add</span>{t('addTable')}</span>
          <span className="ms flip-rtl" aria-hidden="true">chevron_right</span>
        </button>
      ) : (
        <div className="op-card">
          <form onSubmit={createTable} className="op-setup__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="op-setup__title"><span className="ms" aria-hidden="true">add_circle</span>{t('newTable')}</div>
            <div className="op-field-row">
              <div className="op-field">
                <label>{t('tableName')}</label>
                <input
                  className="op-input"
                  value={newTable.name}
                  onChange={e => setNewTable(n => ({ ...n, name: e.target.value }))}
                  placeholder={t('tableNamePlaceholder')}
                  required
                />
              </div>
              <div className="op-field">
                <label>{t('tableSeats')}</label>
                <input
                  className="op-input mono"
                  type="number"
                  min={1}
                  max={30}
                  value={newTable.seats}
                  onChange={e => setNewTable(n => ({ ...n, seats: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="op-modal__foot" style={{ position: 'static', padding: 0, borderTop: 'none' }}>
              <button type="button" className="op-btn-ghost" onClick={() => setAdding(false)}>{t('cancel')}</button>
              <button type="submit" className="op-btn-primary" disabled={saving}>
                {saving ? <span className="ms spin" aria-hidden="true">progress_activity</span> : t('create')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// ── QR codes section (Setup tab) ─────────────────────────────────────────────
//
// Sober list of per-table cards: a sharp SVG QR (vector — prints perfectly),
// the table label, the encoded URL, and a small PNG download button. Hidden
// when the establishment has zero tables (the empty caption replaces the
// section so the operator knows what to do).

function QrCodesSection({
  tables, establishmentName,
}: {
  tables:            Table[]
  establishmentName: string
}) {
  const t = useTranslations('tables.qr')
  // window.location.origin is only legitimately readable AFTER mount, so we
  // gate the rendering of the encoded URLs on a mounted flag — avoids the
  // "QR points at empty origin" race during the very first SSR-friendly paint.
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(getConsoOrigin()) }, [])

  function handlePrint() {
    // Browsers only run window.print() once any pending paint is committed —
    // the printable sheet markup below is in the DOM already with display:none
    // on screen but `visibility:visible` in print (via the @media print rule
    // injected as a global style), so this call is enough.
    window.print()
  }

  return (
    <div className="op-card">
      <div className="op-setup__body">
        <div className="op-setup__title">
          <span className="ms" aria-hidden="true">qr_code_2</span>{t('title')}
          {tables.length > 0 && origin && (
            <button
              type="button"
              onClick={handlePrint}
              aria-label={t('printAria')}
              title={t('printAria')}
              className="op-btn-navy"
              style={{ marginInlineStart: 'auto' }}
            >
              <span className="ms" aria-hidden="true">print</span>{t('printButton')}
            </button>
          )}
        </div>
        <p className="op-setup__desc">{t('subtitle')}</p>

        {tables.length === 0 ? (
          <p className="op-qr__empty">{t('noTables')}</p>
        ) : (
          <div className="op-qr__grid">
            {tables.map((table) => (
              <QrCard
                key={table.id}
                table={table}
                establishmentName={establishmentName}
                origin={origin}
              />
            ))}
          </div>
        )}

        {/* ── Printable A4 sheet ── */}
        <PrintableQrSheet
          tables={tables}
          establishmentName={establishmentName}
          origin={origin}
        />
        {/* Global print rules — small and idempotent (we use unique class
            names so multiple instances won't fight). */}
        <style jsx global>{`
          @media print {
            @page { size: A4; margin: 12mm; }
            body * { visibility: hidden !important; }
            .grubano-print-sheet, .grubano-print-sheet * { visibility: visible !important; }
            .grubano-print-sheet {
              position: absolute !important;
              inset: 0 !important;
              width: 100% !important;
              background: #fff !important;
              color: #000 !important;
            }
            .grubano-print-card { break-inside: avoid; page-break-inside: avoid; }
          }
        `}</style>
      </div>
    </div>
  )
}

// ── Printable sheet ───────────────────────────────────────────────────────────

function PrintableQrSheet({
  tables, establishmentName, origin,
}: {
  tables:            Table[]
  establishmentName: string
  origin:            string
}) {
  const t = useTranslations('tables.qr')
  if (tables.length === 0 || !origin) return null

  return (
    <section
      aria-hidden
      className="grubano-print-sheet hidden"
    >
      <div className="mb-4 flex items-baseline justify-between border-b border-black/10 pb-2">
        <p className="text-base font-bold text-black">
          {t('sheetTitle', { establishment: establishmentName || '—' })}
        </p>
        <p className="text-[10px] uppercase tracking-wider text-black/50">
          {t('sheetBrandLine')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {tables.map((table) => {
          const url = buildQrUrl(origin, table.id)
          return (
            <div
              key={table.id}
              className="grubano-print-card flex flex-col items-center gap-2 rounded-md border border-dashed border-black/30 p-4 text-center"
            >
              <p className="text-[10px] uppercase tracking-widest text-black/50">
                {establishmentName || '—'}
              </p>
              <p className="text-xl font-bold text-black">{table.name}</p>
              <div className="my-1 bg-white p-2">
                <QRCodeSVG value={url} size={180} level="M" marginSize={0} />
              </div>
              <p className="text-[11px] font-semibold text-black">{t('sheetCaption')}</p>
              <p className="mt-1 text-[9px] uppercase tracking-wider text-black/50">
                {t('sheetBrandLine')}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function QrCard({
  table, establishmentName, origin,
}: {
  table:             Table
  establishmentName: string
  origin:            string
}) {
  const t = useTranslations('tables.qr')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const url       = buildQrUrl(origin, table.id)

  function handleDownload() {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl  = canvas.toDataURL('image/png')
    const filename = t('downloadFilename', {
      establishment: slugForFilename(establishmentName, 'grubano'),
      table:         slugForFilename(table.name, 'table'),
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className={`op-qr__card${table.active ? '' : ' dim'}`}>
      {/* Crisp SVG QR — vector, the displayed size + the printed size are both
          sharp. The dashboard render uses a smaller box than the printable
          card. */}
      <div className="op-qr__thumb">
        {origin && url ? (
          <QRCodeSVG value={url} size={72} level="M" marginSize={0} />
        ) : (
          <span className="ms" aria-hidden="true">qr_code_2</span>
        )}
      </div>

      {/* Hidden canvas QR used SOLELY to power the PNG download. Same value as
          the visible SVG so the downloaded image matches what's on screen. */}
      <div aria-hidden className="hidden">
        {origin && url && (
          <QRCodeCanvas ref={canvasRef} value={url} size={512} level="M" marginSize={2} />
        )}
      </div>

      <div className="op-qr__m">
        <b>{table.name}</b>
        <span className="url">{url || '—'}</span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!origin || !url}
          aria-label={t('downloadAria', { name: table.name })}
          title={t('downloadAria', { name: table.name })}
          className="op-qr__dl"
        >
          <span className="ms" aria-hidden="true">download</span>{t('downloadPng')}
        </button>
      </div>
    </div>
  )
}

// ── New reservation form ──────────────────────────────────────────────────────

function NewReservationForm({
  tables, defaultDurationMin, onClose, onSaved,
}: {
  tables:             Table[]
  defaultDurationMin: number
  onClose:            () => void
  /** Chantier horaires — carries the server's non-blocking hoursWarning
   *  message (when the slot is outside the configured hours) so the parent
   *  surfaces it AFTER the modal closes. The reservation is created anyway. */
  onSaved:            (hoursWarning?: string) => void
}) {
  const t = useTranslations('tables')
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    tableId:      tables[0]?.id ?? '',
    customerName: '',
    phone:        '',
    guests:       2,
    date:         today,
    time:         '19:00',
    duration:     defaultDurationMin,
    type:         'standard' as 'quick' | 'standard' | 'full',
    depositAmount: 10,
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Live "libère à HH:MM" preview computed from the chosen date + time +
  // duration. Stays empty when the user hasn't typed both date and time.
  const releaseTime = (() => {
    if (!form.date || !form.time) return ''
    const start = new Date(`${form.date}T${form.time}:00`)
    if (Number.isNaN(start.getTime())) return ''
    const end = new Date(start.getTime() + form.duration * 60_000)
    return end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  })()

  // ── Past-slot guard (mirrors Agent 2 PAST_GRACE_MS = 5*60*1000) ────────────
  // The server is the authority — it returns 400 "Créneau déjà passé" if start
  // < (now - 5 min). The form guides BEFORE the round-trip so we never POST a
  // request we know will fail. Same 5-minute grace so a "réservation pour tout
  // de suite" never trips the guard.
  const PAST_GRACE_MS = 5 * 60 * 1000

  function isPast(date: string, time: string): boolean {
    if (!date || !time) return false
    const start = new Date(`${date}T${time}:00`)
    if (Number.isNaN(start.getTime())) return false
    return start.getTime() < Date.now() - PAST_GRACE_MS
  }

  // Today's HH:MM — used as the input[type=time]'s `min` when the date is
  // today. Re-computed every render is cheap.
  const isToday = form.date === today
  const minTimeForToday = isToday
    ? new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : ''

  const slotIsPast = isPast(form.date, form.time)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // A reservation must reference an existing table. When the room has no tables
    // the form has no table to pre-select; block here with a clear message rather
    // than POSTing an empty tableId (which used to come back as "Erreur serveur").
    if (!form.tableId) {
      setError(t('errorNoTable'))
      return
    }
    // Block past slots BEFORE the round-trip. The server is still the
    // authority — same 5-min grace as PAST_GRACE_MS — but the form guides
    // the operator instead of submitting a doomed request.
    if (isPast(form.date, form.time)) {
      setError(t('pastSlotError'))
      return
    }
    setSaving(true)
    const start = new Date(`${form.date}T${form.time}:00`)
    // Send BOTH durationMin (Agent 2's preferred field, commit 3d20718) and
    // endTime for retro-compat. The server resolves the slot in this priority
    // order: durationMin > endTime > establishment default > 60.
    const end = new Date(start.getTime() + form.duration * 60_000)
    const r = await fetch('/api/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        tableId:       form.tableId,
        customerName:  form.customerName,
        phone:         form.phone || undefined,
        guests:        form.guests,
        date:          start.toISOString(),
        durationMin:   form.duration,
        endTime:       end.toISOString(),
        type:          form.type,
        depositAmount: form.depositAmount,
      }),
    })
    if (!r.ok) {
      const d = await r.json()
      setError(d.error ?? t('errorGeneric'))
      setSaving(false)
      return
    }
    // Non-blocking hours warning (Agent 2's contract): the reservation IS
    // created; the parent shows the banner.
    const d = await r.json().catch(() => null)
    onSaved(typeof d?.hoursWarning?.message === 'string' ? d.hoursWarning.message : undefined)
  }

  return (
    <div className="op-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="op-modal" role="dialog" aria-modal="true">
        <div className="op-modal__head">
          <h3>{t('newReservationTitle')}</h3>
          <button type="button" className="op-modal__close" onClick={onClose} aria-label={t('cancel')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="op-modal__body">
            {error && <p className="op-modalerr">{error}</p>}

            <div className="op-field-row">
              <div className="op-field">
                <label>{t('customerName')}</label>
                <input
                  className="op-input"
                  value={form.customerName}
                  onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                  placeholder={t('customerNamePlaceholder')}
                  required
                />
              </div>
              <div className="op-field">
                <label>{t('phone')}</label>
                <input
                  className="op-input mono"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder={t('phonePlaceholder')}
                />
              </div>
            </div>

            <div className="op-field-row">
              <div className="op-field">
                <label>{t('dateLabel')}</label>
                {/* `min={today}` blocks the date picker from selecting yesterday
                    or before — the server still re-checks. */}
                <input
                  className="op-input"
                  type="date"
                  min={today}
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="op-field">
                <label>{t('timeLabel')}</label>
                {/* When the date is today, the time picker's `min` is HH:MM now. */}
                <input
                  className="op-input mono"
                  type="time"
                  min={minTimeForToday || undefined}
                  value={form.time}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                />
                {slotIsPast && (
                  <p className="op-fieldhint danger">{t('pastSlotError')}</p>
                )}
              </div>
            </div>

            <div className="op-field-row">
              <div className="op-field">
                <label>{t('coversLabel')}</label>
                <input
                  className="op-input mono"
                  type="number"
                  min={1}
                  max={30}
                  value={form.guests}
                  onChange={e => setForm(f => ({ ...f, guests: Number(e.target.value) }))}
                />
              </div>
              <div className="op-field">
                <label>{t('durationLabel')}</label>
                <input
                  className="op-input mono"
                  type="number"
                  min={15}
                  max={300}
                  step={15}
                  value={form.duration}
                  onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
                />
                {releaseTime && (
                  <p className="op-fieldhint">{t('releaseAt', { time: releaseTime })}</p>
                )}
              </div>
            </div>

            {tables.length > 0 && (
              <div className="op-field">
                <label>{t('tableLabel')}</label>
                <div className="op-tablechips">
                  {tables.map(tb => (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, tableId: tb.id }))}
                      className={`op-tablechip${form.tableId === tb.id ? ' is-on' : ''}`}
                    >
                      {t('tableChip', { name: tb.name, seats: tb.seats })}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tables.length === 0 && (
              <p className="op-setup__mininote">{t('noTablesModalHint')}</p>
            )}
          </div>

          <div className="op-modal__foot">
            <button type="button" className="op-btn-ghost" onClick={onClose}>{t('cancel')}</button>
            <button
              type="submit"
              className="op-btn-primary"
              disabled={saving || !form.tableId || slotIsPast}
            >
              {saving
                ? <span className="ms spin" aria-hidden="true">progress_activity</span>
                : <><span className="ms" aria-hidden="true">check</span>{t('save')}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
