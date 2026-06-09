'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  Sparkles, Users, Clock, AlertTriangle,
  ChevronRight, Plus, CalendarDays, Euro, Filter, ShieldCheck,
  RefreshCw, QrCode, X, ChevronLeft, ChevronRight as ChevRight,
  Store, Check, Timer, Download, Printer, Loader2, Receipt,
} from 'lucide-react'
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react'
import EstablishmentSwitcher, {
  type EstablishmentOption,
} from '@/components/dashboard/EstablishmentSwitcher'
import { EmptyState } from '@/components/design-system'
import TicketPanel from '@/components/tables/TicketPanel'
import SessionBadge from '@/components/session/SessionBadge'
import { reservationCode } from '@/lib/reservation-code'

// ── /tables — Agent 13 ─────────────────────────────────────────────────────────
// The page used to be a single client component (~700 l.) that fetched
// /api/tables + /api/reservations on the implicit cookie-selected establishment.
// We turn it into a server-resolved island so:
//   • the establishment switcher (shared with /dashboard) can render at the top,
//   • fetches carry an explicit ?restaurantId=<currentId> (no race on cookie
//     propagation when switching),
//   • the default reservation duration (Agent 2, commit 3d20718) seeds the
//     modal AND the Config card without any extra round trip.
//
// ZÉRO COMPLEXITÉ À N=1 : EstablishmentSwitcher renders NOTHING at ≤1
// establishment, so the chrome stays unchanged for mono operators.

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
  status:       'confirmed' | 'arrived' | 'overrun' | 'cancelled' | 'noshow'
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
  function openAddition(tableId: string) {
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

  const loadReservations = useCallback(async (date: string) => {
    if (!restaurantId) {
      setReservations([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = await fetch(scopedUrl(`/api/reservations?date=${date}`), { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setReservations(d.reservations ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [restaurantId, scopedUrl])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  useEffect(() => {
    loadReservations(selectedDate)
  }, [selectedDate, loadReservations])

  async function updateStatus(id: string, status: Reservation['status']) {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    const r = await fetch('/api/reservations', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status }),
    })
    if (!r.ok) return
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
  }

  function clearUnpaidFor(tableId: string) {
    setUnpaidByTable((prev) => {
      if (!prev[tableId]) return prev
      const next = { ...prev }
      delete next[tableId]
      return next
    })
  }

  // ── Deposit actions (Agent 2 Paiement V1 endpoints) ──────────────────────
  // Both endpoints are OWNER-scoped — Agent 2's resolveEstablishmentScope
  // confirms the reservation belongs to one of the operator's restaurants
  // before touching Stripe. We optimistically update local state on success
  // and surface a friendly error code mapping for 409 (already captured /
  // released) and the generic case.

  async function releaseDeposit(id: string): Promise<{ ok: true } | { ok: false; status: number }> {
    const r = await fetch(`/api/reservations/${id}/deposit/release`, { method: 'POST' })
    if (!r.ok) return { ok: false, status: r.status }
    const body = await r.json().catch(() => null)
    setReservations(prev => prev.map(rs =>
      rs.id === id
        ? { ...rs, status: 'arrived', depositStatus: (body?.depositStatus ?? 'released') as Reservation['depositStatus'] }
        : rs,
    ))
    return { ok: true }
  }

  async function captureDeposit(id: string): Promise<{ ok: true } | { ok: false; status: number }> {
    const r = await fetch(`/api/reservations/${id}/deposit/capture`, { method: 'POST' })
    if (!r.ok) return { ok: false, status: r.status }
    const body = await r.json().catch(() => null)
    setReservations(prev => prev.map(rs =>
      rs.id === id
        ? { ...rs, status: 'noshow', depositStatus: (body?.depositStatus ?? 'captured') as Reservation['depositStatus'] }
        : rs,
    ))
    return { ok: true }
  }

  // ── 0-establishment guard ────────────────────────────────────────────────
  if (!restaurantId) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🏪"
          title={t('noEstabTitle')}
          description={t('noEstabDesc')}
        />
      </div>
    )
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      {/* ── Switcher + header ────────────────────────────────────────────── */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-display font-bold tracking-tight">Tables</h1>
          <p className="text-sm text-muted-foreground">Créneaux intelligents &amp; acomptes</p>
        </div>
        {/* The switcher renders NOTHING at ≤1 establishment (mono-invisibility),
            so this slot is empty for the common case. */}
        <EstablishmentSwitcher establishments={establishments} currentId={currentId} />
      </div>

      <div className="mb-4 flex items-center justify-end">
        <button
          onClick={() => setAddingRes(true)}
          disabled={tables.length === 0}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          <Plus size={13} /> Réservation
        </button>
      </div>

      <div className="mb-4 grid grid-cols-5 gap-1 rounded-2xl bg-muted p-1">
        {(['list', 'calendar', 'plan', 'addition', 'setup'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[11px] font-semibold transition ${
              tab === k ? 'bg-card text-foreground shadow' : 'text-muted-foreground'
            }`}>
            {k === 'list' ? 'Liste' : k === 'calendar' ? 'Agenda' : k === 'plan' ? 'Plan' : k === 'addition' ? 'Addition' : 'Config'}
          </button>
        ))}
      </div>

      {/* ── 0-table empty state (only outside the Setup tab — Setup is where
            you'd add one). Keeps the page honest instead of presenting empty
            agendas / floor plans for a dark-kitchen-only establishment. ── */}
      {tables.length === 0 && tab !== 'setup' ? (
        <EmptyState
          emoji="🪑"
          title={t('noTablesTitle')}
          description={t('noTablesDesc')}
          action={
            <button
              onClick={() => setTab('setup')}
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white shadow-grubano-cta transition-colors hover:bg-grubano-primaryHover"
            >
              {t('noTablesGoSetup')} →
            </button>
          }
        />
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
          onSaved={() => { setAddingRes(false); loadReservations(selectedDate) }}
        />
      )}
    </div>
  )
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({
  reservations, loading, selectedDate, onDateChange, onUpdateStatus,
  onReleaseDeposit, onCaptureDeposit, onOpenAddition,
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
}) {
  const tSession = useTranslations('session')
  const td = useTranslations('tables.deposit')
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

  return (
    <>
      {/* Date nav */}
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5">
        <button onClick={prevDay} className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/80">
          <ChevronLeft size={14} />
        </button>
        <p className="text-sm font-semibold">
          {new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(selectedDate + 'T12:00:00'))}
        </p>
        <button onClick={nextDay} className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/80">
          <ChevRight size={14} />
        </button>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { l: 'Réservations', v: String(filtered.length), icon: CalendarDays },
          { l: 'Couverts',     v: String(guests),          icon: Users        },
          { l: 'Acomptes',     v: `€${deposits}`,          icon: Euro         },
        ].map(s => (
          <div key={s.l} className="rounded-2xl border border-border bg-card p-3 text-center">
            <s.icon size={14} className="mx-auto text-primary" />
            <p className="mt-1 text-base font-bold">{s.v}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        {(['all', 'arrived', 'allergy', 'deposit'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              filter === k ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {k === 'all' ? 'Toutes' : k === 'arrived' ? 'Arrivés' : k === 'allergy' ? 'Allergies' : 'Acompte'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <RefreshCw size={16} className="animate-spin" /> Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
          <p className="text-sm text-muted-foreground">Aucune réservation ce jour</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const time    = new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const endTime = new Date(r.endTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            return (
              <div key={r.id} className="rounded-2xl border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy text-navy-foreground">
                    <p className="text-xs font-bold">{time}</p>
                    <p className="text-[8px] opacity-60">{endTime}</p>
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{r.customerName}</p>
                      {/* Brique A — session anchor. Always rendered; for
                          an 'arrived' service it becomes the clickable
                          entry into the Addition tab. The badge itself
                          stays a static visual element when status !==
                          arrived (no ticket open yet, no link to make). */}
                      {r.status === 'arrived' ? (
                        <button
                          type="button"
                          onClick={() => onOpenAddition(r.tableId)}
                          title={tSession('openTableTitle')}
                          className="cursor-pointer"
                        >
                          <SessionBadge reservationId={r.id} />
                        </button>
                      ) : (
                        <SessionBadge reservationId={r.id} />
                      )}
                      {r.status === 'arrived' && (
                        <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">Arrivé</span>
                      )}
                      {r.status === 'overrun' && (
                        <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-warning">Dépassement</span>
                      )}
                      {r.depositAmount > 0 && (
                        <DepositBadge reservation={r} />
                      )}
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        r.type === 'quick'    ? 'bg-muted text-muted-foreground'
                        : r.type === 'standard' ? 'bg-warning/20 text-warning'
                        :                         'bg-primary/15 text-primary'
                      }`}>
                        {r.type === 'quick' ? 'Rapide' : r.type === 'standard' ? 'Standard' : 'Complet'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.table.name} · {r.guests} couvert{r.guests > 1 ? 's' : ''} · libère {endTime}
                    </p>
                    {r.allergies.length > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">
                        <AlertTriangle size={11} /> {r.allergies.join(', ')}
                      </div>
                    )}
                  </div>
                  {/* Action column: when the reservation has an ACTIVE
                      Stripe hold (authorized), show release / capture pair
                      that the Agent-2 endpoints expose. Otherwise fall back
                      to the legacy arrival / overrun status updates. */}
                  {r.status === 'confirmed' && r.depositStatus === 'authorized' ? (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => doRelease(r)}
                        disabled={pendingId === r.id}
                        className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-60"
                        title={td('actionArrived')}
                      >
                        {pendingId === r.id ? <Loader2 size={11} className="animate-spin" /> : td('actionArrived')}
                      </button>
                      <button
                        onClick={() => setConfirmCapture(r)}
                        disabled={pendingId === r.id}
                        className="rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[10px] font-semibold text-destructive disabled:opacity-60"
                        title={td('actionNoshow')}
                      >
                        {td('actionNoshow')}
                      </button>
                    </div>
                  ) : r.status === 'confirmed' ? (
                    <button
                      onClick={() => onUpdateStatus(r.id, 'arrived')}
                      className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground">
                      {td('actionMarkArrived')}
                    </button>
                  ) : r.status === 'arrived' ? (
                    <button
                      onClick={() => onUpdateStatus(r.id, 'overrun')}
                      className="rounded-lg bg-warning/20 px-2.5 py-1.5 text-[10px] font-semibold text-warning">
                      Dépassement
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error pill — used for both release and capture failures. */}
      {actionError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
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
        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold text-warning">
          {td('depositBadgeAuth', { amount })}
        </span>
      )
    case 'released':
      return (
        <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">
          {td('depositBadgeRel')}
        </span>
      )
    case 'captured':
      return (
        <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold text-destructive">
          {td('depositBadgeCap', { amount })}
        </span>
      )
    default:
      // Legacy reservations (depositStatus undefined or 'none') — show the
      // historical "acompte" pill so nothing visibly regresses.
      return (
        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-primary">
          {amount}
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-background p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-destructive/15 text-destructive">
            <AlertTriangle size={15} />
          </span>
          <p className="text-base font-bold">{td('actionConfirmNoshowTitle')}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {td('actionConfirmNoshowBody', { amount })}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm disabled:opacity-60"
          >
            {td('actionCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground disabled:opacity-60"
          >
            {pending ? <Loader2 size={14} className="mx-auto animate-spin" /> : td('actionConfirm')}
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

  return (
    <>
      <div className="mb-3 flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5">
        <button onClick={prevDay} className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><ChevronLeft size={14} /></button>
        <p className="text-sm font-semibold">
          {new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(selectedDate + 'T12:00:00'))}
        </p>
        <button onClick={nextDay} className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><ChevRight size={14} /></button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card p-3">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-1 py-1 text-left">Table</th>
              {hours.map(h => <th key={h} className="px-1 py-1 text-center font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {tableNames.map(t => (
              <tr key={t} className="border-t border-border">
                <td className="py-2 pr-2 font-semibold">{t}</td>
                {hours.map(h => {
                  const isOcc = occupied[t]?.some(o => o === h || o.startsWith(h.replace('h', '')))
                  return (
                    <td key={h} className="px-1 py-1">
                      <div className={`h-7 rounded-md ${isOcc ? 'bg-primary/80' : 'bg-success/20'}`} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-success/20" /> Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-primary/80" /> Réservé</span>
      </div>

      {reservations.length > 0 && (
        <div className="mt-4 rounded-2xl border border-primary/30 bg-accent p-3.5">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-primary" />
            <p className="text-[11px] font-bold text-foreground">Résumé du service</p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {reservations.filter(r => r.status !== 'cancelled').length} réservation{reservations.length > 1 ? 's' : ''} ·{' '}
            {reservations.filter(r => r.status !== 'cancelled').reduce((s, r) => s + r.guests, 0)} couverts prévus
          </p>
        </div>
      )}
    </>
  )
}

// ── Floor plan view ───────────────────────────────────────────────────────────

function FloorPlanView({
  tables, reservations, onOpenAddition,
}: {
  tables:         Table[]
  reservations:   Reservation[]
  /** Brique A — fire when the operator taps an OCCUPIED table tile (a table
   *  with an `arrived` reservation today). Opens the Addition tab on it. */
  onOpenAddition: (tableId: string) => void
}) {
  const tSession = useTranslations('session')
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
    <>
      <div className="mb-3 flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Réservée</span>
      </div>

      <div className="relative h-64 overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30">
        <div className="absolute left-2 top-2 rounded-lg bg-card/80 px-2 py-1 text-[9px] font-semibold uppercase text-muted-foreground">
          Salle principale
        </div>
        {displayTables.map(t => {
          const booked  = bookedIds.has(t.id)
          const arrived = arrivedByTable.get(t.id)
          return (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              style={{ left: `${t.x}%`, top: `${t.y}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 px-2 py-1.5 text-[10px] font-bold shadow-sm transition ${
                booked
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-success bg-success/15 text-success'
              } ${selected === t.id ? 'ring-2 ring-primary' : ''}`}>
              {t.name}
              <span className="block text-[8px] font-normal opacity-70">{t.seats} pl.</span>
              {/* Session anchor: the arrived service's short code.
                  Shown directly on the tile so the operator can spot the
                  active session at a glance. Tapping the tile selects it
                  (legacy); the panel below offers the "Voir l'addition"
                  click-through. */}
              {arrived && (
                <span className="mt-1 inline-block rounded-full bg-white/80 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-primary">
                  {reservationCode(arrived.id)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {sel && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{sel.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {sel.seats} places · {selBooked ? 'Réservée' : 'Disponible'}
              </p>
              {/* Brique A: when the selected table has an arrived service,
                  surface its session code as the panel's anchor + offer the
                  "Voir l'addition" jump. */}
              {selArrived && (
                <div className="mt-2 flex items-center gap-2">
                  <SessionBadge reservationId={selArrived.id} variant="large" />
                </div>
              )}
            </div>
            {selArrived ? (
              <button
                type="button"
                onClick={() => onOpenAddition(sel.id)}
                title={tSession('openTableTitle')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground"
              >
                <Receipt size={13} /> {tSession('openTableTitle')}
              </button>
            ) : (
              <button className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-navy-foreground">
                <QrCode size={16} />
              </button>
            )}
          </div>
          {selRes.length > 0 && (
            <div className="mt-3 space-y-1">
              {selRes.map(r => (
                <p key={r.id} className="text-[11px] text-muted-foreground">
                  {new Date(r.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} – {r.customerName} · {r.guests} pers.
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </>
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

  const currencyFmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    [locale],
  )

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
    <div className="space-y-4">
      {/* ── Default reservation duration ─────────────────────────────────────
          C'est le défaut auto-rempli dans la modale « Nouvelle réservation ».
          3 presets sobres (1 h / 1 h 30 / 2 h) + un input numérique pour un
          réglage fin (step 15). Save immédiat (no submit button) — le pill
          « Enregistré » confirme, l'erreur s'affiche sobrement. */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-primary" />
          <h3 className="text-sm font-bold">{t('durationTitle')}</h3>
          {durSaving && <RefreshCw size={11} className="ms-auto animate-spin text-muted-foreground" />}
          {!durSaving && durSavedAt && (
            <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">
              <Check size={9} /> {t('durationSavedShort')}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('durationDesc')}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {presets.map((p) => {
            const active = dur === p.min
            return (
              <button
                key={p.min}
                type="button"
                onClick={() => saveDuration(p.min)}
                disabled={durSaving}
                aria-pressed={active}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-60 ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary'
                }`}
              >
                {p.label}
              </button>
            )
          })}
          <div className="ms-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
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
              className="w-12 bg-transparent text-center text-[11px] font-bold text-foreground focus:outline-none disabled:opacity-60"
            />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('durationUnit')}
            </span>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground">{t('durationHint')}</p>

        {durError && (
          <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
            {durError}
          </p>
        )}
      </div>

      {/* ── No-show protection — single field wired to
            Restaurant.defaultDepositAmount (Agent 14 bc99eaf). The previous
            two-slider card was UI-only with no persistence; Mohammed's
            decision is ONE amount, penalty = 100% of the hold. ─────────── */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-primary" />
          <h3 className="text-sm font-bold">{tn('sectionTitle')}</h3>
          {depositSaving && <RefreshCw size={11} className="ms-auto animate-spin text-muted-foreground" />}
          {!depositSaving && depositSavedAt && (
            <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">
              <Check size={9} /> {tn('savedShort')}
            </span>
          )}
          {!depositSaving && !depositSavedAt && deposit === 0 && (
            <span className="ms-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              {tn('disabledLabel')}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{tn('intro')}</p>

        <div className="mt-4">
          <label className="text-[11px] font-semibold">{tn('depositLabel')}</label>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {[0, 10, 15, 20].map((preset) => {
              const active = deposit === preset
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => saveDeposit(preset)}
                  disabled={depositSaving || !depositLoaded}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-60 ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary'
                  }`}
                >
                  {preset === 0 ? '0' : `${preset}€`}
                </button>
              )
            })}
            {/* Numeric input — save on blur so the operator can type freely
                without firing a POST on every keystroke. */}
            <div className="ms-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
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
                className="w-14 bg-transparent text-center text-[11px] font-bold text-foreground focus:outline-none disabled:opacity-60"
              />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">€</span>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">{tn('depositHint')}</p>
        </div>

        <p className="mt-3 text-[10px] font-semibold text-destructive">
          {tn('penaltyNote')}
        </p>

        <p className="mt-3 rounded-lg bg-muted p-2 text-[10px] text-muted-foreground">
          {deposit === 0
            ? tn('customerSeesNone')
            : tn('customerSeesPrefix', { amount: deposit })}
        </p>

        {depositError && (
          <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
            {depositError}
          </p>
        )}
      </div>

      {/* Table list */}
      {tables.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {tables.length} table{tables.length > 1 ? 's' : ''} configurée{tables.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-1.5">
            {tables.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-semibold">{t.name}</span>
                <span className="text-muted-foreground">· {t.seats} places</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── QR codes per table — Agent 2's /t/[tableId] page lives at the same
            host as the dashboard (app.grubano.com staging, grubano.com prod),
            so we encode `${window.location.origin}/t/<cuid>` directly. The
            cuid table id is already non-guessable, no extra token needed. */}
      <QrCodesSection
        tables={tables}
        establishmentName={establishmentName}
      />

      {/* Add table */}
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <Plus size={14} className="text-primary" /> Ajouter une table
          </span>
          <ChevronRight size={14} className="text-muted-foreground" />
        </button>
      ) : (
        <form onSubmit={createTable} className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-bold">Nouvelle table</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground">Nom</label>
              <input value={newTable.name} onChange={e => setNewTable(n => ({ ...n, name: e.target.value }))}
                placeholder="Table 7" required
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Places</label>
              <input type="number" min={1} max={30} value={newTable.seats} onChange={e => setNewTable(n => ({ ...n, seats: Number(e.target.value) }))}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-xl border border-border py-2.5 text-sm">Annuler</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">
              {saving ? '…' : 'Créer'}
            </button>
          </div>
        </form>
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
    <div className="rounded-2xl border border-border bg-card p-4">
      {/* Section header with the print button on the right */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <QrCode size={14} className="text-primary" />
        <h3 className="text-sm font-bold">{t('title')}</h3>
        {tables.length > 0 && origin && (
          <button
            type="button"
            onClick={handlePrint}
            aria-label={t('printAria')}
            title={t('printAria')}
            className="ms-auto inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-1.5 text-[11px] font-bold text-navy-foreground transition hover:brightness-110"
          >
            <Printer size={12} /> {t('printButton')}
          </button>
        )}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{t('subtitle')}</p>

      {tables.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-background px-3 py-6 text-center text-[11px] text-muted-foreground">
          {t('noTables')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

      {/* ── Printable A4 sheet ──────────────────────────────────────────────
          Hidden on screen (`hidden`), revealed only by the @media print rule
          via `visibility: visible`. The host page chrome (Sidebar, header,
          rest of the dashboard) is hidden in print via `body * { visibility:
          hidden }` + an override on the sheet sub-tree. Browser-native
          window.print() drives it — no PDF library, no external service.

          Grid: 2 columns × 3 rows ≈ 6 cards per A4 page with comfortable
          margins; the browser handles page breaks naturally between rows. */}
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
          /* Hide everything by default ... */
          body * { visibility: hidden !important; }
          /* ... then reveal only the printable sheet tree. */
          .grubano-print-sheet, .grubano-print-sheet * { visibility: visible !important; }
          .grubano-print-sheet {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            background: #fff !important;
            color: #000 !important;
          }
          /* Avoid page break inside a single card. */
          .grubano-print-card { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}

// ── Printable sheet ───────────────────────────────────────────────────────────
//
// Renders ONE card per table, sized for A4 (2 cols × 3 rows ≈ 6/page). Each
// card shows: a large vector-SVG QR (sharp at any zoom), the table name, the
// establishment name, a small caption ("Scannez avec votre téléphone") and a
// sober Grubano wordmark. Trim hint via a thin dashed border around each card.

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
              {/* Square white panel under the QR so the contrast is guaranteed
                  even on tinted paper. Size large enough for a phone scanner
                  at arm's length (≈ 45mm = ~170 px at 96 DPI). */}
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
    <div
      className={`flex items-center gap-3 rounded-xl border border-border bg-background p-3 ${
        table.active ? '' : 'opacity-60'
      }`}
    >
      {/* Crisp SVG QR — vector, the displayed size + the printed size are both
          sharp. The dashboard render uses a smaller box than the printable
          card. */}
      <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-white p-1">
        {origin && url ? (
          <QRCodeSVG
            value={url}
            size={72}
            level="M"
            marginSize={0}
          />
        ) : (
          <span className="text-[9px] text-muted-foreground">…</span>
        )}
      </div>

      {/* Hidden canvas QR used SOLELY to power the PNG download. Same value as
          the visible SVG so the downloaded image matches what's on screen. */}
      <div aria-hidden className="hidden">
        {origin && url && (
          <QRCodeCanvas
            ref={canvasRef}
            value={url}
            size={512}
            level="M"
            marginSize={2}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{table.name}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {url || '—'}
        </p>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!origin || !url}
          aria-label={t('downloadAria', { name: table.name })}
          title={t('downloadAria', { name: table.name })}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Download size={11} /> {t('downloadPng')}
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
  onSaved:            () => void
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
  // today. Re-computed every render is cheap. We don't render this on the
  // server (the form is client-only) so toLocaleTimeString without a fixed
  // locale is safe — though we pick fr-FR for consistency with the rest of
  // the page.
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
      setError('Créez ou sélectionnez une table avant de réserver.')
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
      setError(d.error ?? 'Erreur')
      setSaving(false)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl bg-background p-5">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-muted"><X size={16} /></button>
          <p className="text-base font-bold">Nouvelle réservation</p>
          <div className="h-9 w-9" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>}

          <input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
            placeholder="Nom du client" required
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />

          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="Téléphone (optionnel)"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Date</label>
              {/* `min={today}` blocks the date picker from selecting yesterday
                  or before — the server still re-checks. */}
              <input type="date" min={today} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Heure</label>
              {/* When the date is today, the time picker's `min` is HH:MM now
                  so the operator can't pick an already-past time. Browsers
                  honour `min` on input[type=time] by clamping spinner +
                  flagging invalid keyboard input. Empty `min` on other dates
                  lets the operator freely pick any time. */}
              <input type="time" min={minTimeForToday || undefined} value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              {slotIsPast && (
                <p className="mt-1 text-[10px] font-semibold text-destructive">
                  {t('pastSlotError')}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Couverts</label>
              <input type="number" min={1} max={30} value={form.guests} onChange={e => setForm(f => ({ ...f, guests: Number(e.target.value) }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">{t('durationLabel')}</label>
              <input type="number" min={15} max={300} step={15} value={form.duration} onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              {/* Sober "libère à HH:MM" preview based on the chosen duration
                  — coherent with the list/calendar "libère X" labels. */}
              {releaseTime && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  libère à {releaseTime}
                </p>
              )}
            </div>
          </div>

          {tables.length > 0 && (
            <div>
              <label className="text-[10px] text-muted-foreground">Table</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tables.map(t => (
                  <button key={t.id} type="button" onClick={() => setForm(f => ({ ...f, tableId: t.id }))}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                      form.tableId === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                    {t.name} ({t.seats})
                  </button>
                ))}
              </div>
            </div>
          )}

          {tables.length === 0 && (
            <p className="rounded-xl bg-muted px-3 py-2 text-[11px] text-muted-foreground">
              Aucune table pour le moment. Ajoutez une table dans l&apos;onglet Config avant de réserver.
            </p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 text-sm">Annuler</button>
            <button type="submit" disabled={saving || !form.tableId || slotIsPast}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <RefreshCw size={14} className="animate-spin mx-auto" /> : 'Réserver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
