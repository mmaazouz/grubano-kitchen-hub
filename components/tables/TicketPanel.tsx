'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Minus, Trash2, Search, Loader2, Receipt, CreditCard, Bell } from 'lucide-react'
import SessionBadge from '@/components/session/SessionBadge'
import UnpaidAlert from '@/components/tables/UnpaidAlert'
import InlinePayPanel from '@/components/tables/InlinePayPanel'
import CloseTableModal from '@/components/tables/CloseTableModal'
import { usePolling } from '@/lib/use-polling'

// ── TicketPanel (Addition brique 1, Agent 2) ──────────────────────────────────
// Minimal operator UI to manage a table's addition: open a ticket, add dishes
// from the menu (searchable) or a free line, adjust quantities, remove lines, see
// the live total. NO payment (brique 2). Talks only to Agent 2's owner-scoped
// /api/tickets endpoints. Mounted as the "Addition" tab in TablesShell.

type TItem   = {
  id: string; menuItemId: string | null; name: string; unitPrice: number; quantity: number
  addedBy?: string; notes?: string | null; allergies?: string | null; status?: string
}
type Ticket  = {
  id:            string
  status:        string
  currency:      string
  subtotal:      number
  items:         TItem[]
  /** Server-side ensureOpenTicket binds the ticket to the precise arrived
   *  reservation. null = explicit walk-in. Drives the session badge. */
  reservationId?: string | null
}
type MenuRow = { id: string; name: string; price: number; category: string }
type Table   = { id: string; name: string; seats: number; active: boolean }

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

export default function TicketPanel({
  tables, selectedTableId, alert, onAlertResolved,
}: {
  tables: Table[]
  /** When the operator clicks a table card in ListView/FloorPlanView,
   *  TablesShell lifts this id so the addition tab opens directly on the
   *  right session — no reload, no state loss across tab switches. */
  selectedTableId?: string | null
  /** TablesShell hands us a `table_has_unpaid_previous` alert when the
   *  PATCH /api/reservations { status:'arrived' } response carried a
   *  ticketAlert. The panel surfaces <UnpaidAlert /> on top of the empty
   *  state until the previous bill is settled or voided. */
  alert?: { existingTicketId: string; existingSubtotal: number; currency?: string } | null
  /** Fired when the unpaid previous bill is settled or voided. The parent
   *  clears its `unpaidByTable[tableId]` entry; we retry openTicket so the
   *  new session's blank addition opens immediately. */
  onAlertResolved?: () => void
}) {
  const t  = useTranslations('tickets')
  const ts = useTranslations('session')
  const tc = useTranslations('tickets.cloture')
  const tcl = useTranslations('premium.closure')
  const tnotif = useTranslations('premium.notif')
  const activeTables = tables.filter(tb => tb.active)

  // Resolve the initial pick: the parent-lifted selection wins; otherwise
  // fall back to the first active table (legacy behaviour preserved).
  const initialTableId =
    selectedTableId && activeTables.some(t => t.id === selectedTableId)
      ? selectedTableId
      : (activeTables[0]?.id ?? '')
  const [tableId, setTableId]   = useState(initialTableId)

  // Reflect a fresh selection coming from the parent (the operator clicked a
  // different table from the list while the addition tab was already mounted).
  useEffect(() => {
    if (selectedTableId && activeTables.some(t => t.id === selectedTableId) && selectedTableId !== tableId) {
      setTableId(selectedTableId)
      setPendingAlert(null)
      setPayingCurrent(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId])

  // When the parent (TablesShell) is told by the PATCH /reservations response
  // that THIS table has a previous-service unpaid bill, it hands us the alert
  // payload. Drives <UnpaidAlert />.
  useEffect(() => {
    if (alert && alert.existingTicketId) {
      setPendingAlert({
        existingTicketId: alert.existingTicketId,
        existingSubtotal: alert.existingSubtotal,
        currency:         alert.currency,
      })
    }
  }, [alert])
  const [ticket, setTicket]     = useState<Ticket | null>(null)
  const [loading, setLoading]   = useState(false)
  const [pending, setPending]   = useState(false)
  const [error, setError]       = useState('')
  const [menu, setMenu]         = useState<MenuRow[]>([])
  const [search, setSearch]     = useState('')
  const [freeName, setFreeName] = useState('')
  const [freePrice, setFreePrice] = useState('')
  const [confirmVoid, setConfirmVoid] = useState(false)
  // Brique unpaid-previous: when POST /api/tickets returns 409 with
  // code='table_has_unpaid_previous', or the parent feeds us the same alert
  // (from PATCH /api/reservations.ticketAlert), surface <UnpaidAlert /> on
  // top of the empty state. Cleared when the previous bill is settled/voided.
  const [pendingAlert, setPendingAlert] = useState<
    { existingTicketId: string; existingSubtotal: number; currency?: string } | null
  >(null)
  // Operator-side payment of the CURRENT open ticket (the "Encaisser /
  // clôturer la table" general action). When `true` we render the inline
  // Stripe Elements panel until onPaid fires.
  const [payingCurrent, setPayingCurrent] = useState(false)
  // Bloc E/F — traced closure modal (close unpaid with deposit choice).
  const [closeOpen, setCloseOpen] = useState(false)
  // Bloc D — track which client-line ids we've already seen on this panel so
  // freshly-arrived ones can be highlighted + counted in a "new order" banner.
  const seenClientIdsRef = useRef<Set<string>>(new Set())
  const [newClientLineIds, setNewClientLineIds] = useState<Set<string>>(new Set())
  // Closure result toast (empreinte settlement outcome).
  const [closeToast, setCloseToast] = useState<string | null>(null)

  const loadTicket = useCallback(async (tid: string, silent = false) => {
    if (!tid) { setTicket(null); return }
    if (!silent) { setLoading(true); setError(''); setConfirmVoid(false) }
    try {
      const r = await fetch(`/api/tickets?restaurantTableId=${tid}`, { cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      setTicket(d?.ticket ?? null)
    } catch {
      if (!silent) setTicket(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { loadTicket(tableId) }, [tableId, loadTicket])

  // Reset the "seen client lines" baseline whenever the selected table changes
  // — each table's notification state is independent.
  useEffect(() => {
    seenClientIdsRef.current = new Set()
    setNewClientLineIds(new Set())
  }, [tableId])

  // ── Bloc D — detect newly-arrived client lines. After each ticket load we
  //   diff the current client-line ids against the ones already seen on this
  //   panel; the fresh ones are highlighted + counted in the banner. The
  //   operator dismisses the banner (acknowledge → all current become seen).
  useEffect(() => {
    if (!ticket) return
    const clientIds = ticket.items.filter((it) => it.addedBy === 'client').map((it) => it.id)
    const fresh = clientIds.filter((id) => !seenClientIdsRef.current.has(id))
    if (fresh.length > 0) {
      setNewClientLineIds((prev) => {
        const next = new Set(prev)
        fresh.forEach((id) => next.add(id))
        return next
      })
    }
  }, [ticket])

  function acknowledgeClientOrders() {
    if (ticket) {
      ticket.items.filter((it) => it.addedBy === 'client').forEach((it) => seenClientIdsRef.current.add(it.id))
    }
    setNewClientLineIds(new Set())
  }

  // ── Bloc A — realtime: silent 3s poll of the current table's ticket. Client
  //   orders (addedBy='client') and webhook-side payments (status flips to
  //   'paid' → the open disappears) show up without a manual reload. Paused
  //   while the operator is in the middle of the inline payment sheet so the
  //   refresh doesn't yank the Elements form out from under them.
  usePolling(() => loadTicket(tableId, true), 3000, !!tableId && !payingCurrent)

  // Load the establishment's menu once for the picker.
  useEffect(() => {
    let alive = true
    fetch('/api/tickets/menu', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && Array.isArray(d?.items)) setMenu(d.items) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function mutate(url: string, init: RequestInit) {
    setPending(true); setError('')
    try {
      const r = await fetch(url, init)
      const d = await r.json().catch(() => null)
      if (!r.ok) { setError((d?.error as string) || t('error')); return false }
      if (d?.ticket) setTicket(d.ticket)
      return true
    } catch {
      setError(t('error')); return false
    } finally {
      setPending(false)
    }
  }

  // walkin=false → the server requires an 'arrived' reservation on this table
  // and binds the ticket to that exact service. walkin=true → open without a
  // reservation. The 409 { code:'table_has_unpaid_previous' } response is
  // surfaced as <UnpaidAlert />, NOT as the generic error pill.
  async function openTicket(walkin = false) {
    if (!tableId) return
    setPending(true); setError('')
    try {
      const r = await fetch('/api/tickets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ restaurantTableId: tableId, walkin }),
      })
      const d = await r.json().catch(() => null)
      if (r.status === 409 && d?.code === 'table_has_unpaid_previous' && d?.existingTicketId) {
        setPendingAlert({
          existingTicketId: d.existingTicketId,
          existingSubtotal: Number(d.existingSubtotal) || 0,
          currency:         (d.currency as string) || undefined,
        })
        return
      }
      if (!r.ok) { setError((d?.error as string) || t('error')); return }
      if (d?.ticket) setTicket(d.ticket)
    } catch {
      setError(t('error'))
    } finally {
      setPending(false)
    }
  }

  // The previous-service bill has been settled or voided. Tell the parent so
  // it can clear unpaidByTable[tableId], then retry opening — Agent 2's
  // ensureOpenTicket will now create the new client's blank session ticket.
  function resolveAlertAndReopen() {
    setPendingAlert(null)
    setPayingCurrent(false)
    onAlertResolved?.()
    // Best-effort retry. If the table still has another stuck bill the 409
    // path will surface a new alert; otherwise the new ticket appears.
    void openTicket(false)
  }

  function addMenuItem(mi: MenuRow) {
    if (!ticket) return
    mutate(`/api/tickets/${ticket.id}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menuItemId: mi.id, quantity: 1 }),
    })
  }

  async function addFreeLine(e: React.FormEvent) {
    e.preventDefault()
    if (!ticket) return
    const price = Number(freePrice.replace(',', '.'))
    if (!freeName.trim() || !Number.isFinite(price) || price < 0) { setError(t('error')); return }
    const ok = await mutate(`/api/tickets/${ticket.id}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: freeName.trim(), unitPrice: price, quantity: 1 }),
    })
    if (ok) { setFreeName(''); setFreePrice('') }
  }

  function setQty(item: TItem, q: number) {
    if (!ticket) return
    if (q < 1) {
      mutate(`/api/tickets/${ticket.id}/items/${item.id}`, { method: 'DELETE' })
      return
    }
    mutate(`/api/tickets/${ticket.id}/items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: q }),
    })
  }

  async function voidTicket() {
    if (!ticket) return
    const ok = await mutate(`/api/tickets/${ticket.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'void' }),
    })
    if (ok) { setConfirmVoid(false); loadTicket(tableId) }
  }

  // Bloc D — owner soft-cancel of a single line. DELETE /items/[itemId] flips
  // it to status='cancelled' server-side; the live select drops it from the
  // returned ticket (out of total), so a refetch just removes it visually.
  async function cancelLine(item: TItem) {
    if (!ticket) return
    await mutate(`/api/tickets/${ticket.id}/items/${item.id}`, { method: 'DELETE' })
    loadTicket(tableId, true)
  }

  // Bloc E — empty table → release directly (no question). reason:'empty'.
  async function closeEmpty() {
    if (!ticket) return
    const ok = await mutate(`/api/tickets/${ticket.id}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'empty' }),
    })
    if (ok) loadTicket(tableId)
  }

  const filteredMenu = search.trim()
    ? menu.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase()))
    : menu

  if (activeTables.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">{t('noTable')}</p>
  }

  const isOpen = ticket?.status === 'open'

  return (
    <div className="space-y-4">
      {/* Table picker */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('selectTable')}</label>
        <select
          value={tableId}
          onChange={e => setTableId(e.target.value)}
          className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          {activeTables.map(tb => (
            <option key={tb.id} value={tb.id}>{tb.name} ({tb.seats})</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>
      )}

      {/* Brique unpaid-previous — alert + 2 actions. Stays on top of the
          empty state until the previous-service bill is settled or voided. */}
      {pendingAlert && (
        <UnpaidAlert
          existingTicketId={pendingAlert.existingTicketId}
          existingSubtotal={pendingAlert.existingSubtotal}
          currency={pendingAlert.currency}
          onResolved={resolveAlertAndReopen}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> …
        </div>
      ) : !ticket || ticket.status === 'void' ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-primary"><Receipt size={22} /></span>
          {ticket?.status === 'void' && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t('statusVoid')}</span>
          )}
          <p className="max-w-xs text-[12px] text-muted-foreground">{t('openHint')}</p>
          <button
            onClick={() => openTicket(false)}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {t('open')}
          </button>
          <button
            onClick={() => openTicket(true)}
            disabled={pending}
            className="text-[12px] font-semibold text-muted-foreground underline-offset-2 hover:text-primary hover:underline disabled:opacity-60"
          >
            {t('openWalkin')}
          </button>
        </div>
      ) : (
        <>
          {/* Status + session badge + total */}
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ticket.status === 'paid' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'}`}>
                {ticket.status === 'paid' ? t('statusPaid') : t('statusOpen')}
              </span>
              {/* Session anchor — short code (#A3F2) or walk-in pill. The
                  operator and the guest cross-check this verbally. */}
              <SessionBadge reservationId={ticket.reservationId} />
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('total')}</p>
              <p className="text-xl font-bold text-foreground">{eur(ticket.subtotal)}</p>
            </div>
          </div>

          {/* ── Bloc D — new client-order banner ─────────────────────────── */}
          {isOpen && newClientLineIds.size > 0 && (
            <button
              type="button"
              onClick={acknowledgeClientOrders}
              className="flex w-full items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-left"
            >
              <Bell size={14} className="shrink-0 text-primary" />
              <span className="flex-1 text-[12px] font-bold text-foreground">
                {tnotif('newClientOrder')}
              </span>
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                {newClientLineIds.size}
              </span>
            </button>
          )}

          {/* ── Closure result toast (empreinte settlement) ───────────────── */}
          {closeToast && (
            <p className="rounded-2xl border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
              {closeToast}
            </p>
          )}

          {/* ── Brique CLÔTURER LA TABLE ──────────────────────────────────
              Always-visible CTA so the operator never gets stuck with a
              ticket that can't be released. items > 0 → "Encaisser & clôturer"
              (inline Stripe) as the primary path + a secondary "Clôturer sans
              encaisser" (traced close, deposit choice). items == 0 → "Libérer
              la table" closes empty directly. Hidden once paid. */}
          {isOpen && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-2">
                <CreditCard size={14} className="mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{tc('closeTitle')}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {ticket.items.length > 0 ? tc('closeWithItems') : tc('closeEmpty')}
                  </p>
                  {payingCurrent ? (
                    <div className="mt-3">
                      <InlinePayPanel
                        ticketId={ticket.id}
                        onPaid={() => {
                          setPayingCurrent(false)
                          loadTicket(tableId)
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setPayingCurrent(false)}
                        className="mt-2 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {tc('cancel')}
                      </button>
                    </div>
                  ) : ticket.items.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setPayingCurrent(true)}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-60"
                      >
                        <CreditCard size={13} /> {tc('closeCta')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCloseOpen(true)}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] font-bold text-destructive disabled:opacity-60"
                      >
                        <Trash2 size={13} /> {tcl('reasonUnpaid')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={closeEmpty}
                      disabled={pending}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] font-bold text-destructive disabled:opacity-60"
                    >
                      <Trash2 size={13} /> {tc('releaseTable')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Lines */}
          {ticket.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">{t('emptyLines')}</p>
          ) : (
            <div className="space-y-1.5">
              {ticket.items.map(item => {
                const isClient = item.addedBy === 'client'
                const isNew    = newClientLineIds.has(item.id)
                return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                    isNew ? 'border-primary bg-primary/5' : 'border-border bg-card'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                      {/* Bloc D — client-order tag so the operator distinguishes
                          what the guest ordered from the app. */}
                      {isClient && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary">
                          {tnotif('clientLine')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{eur(item.unitPrice)} × {item.quantity} = {eur(item.unitPrice * item.quantity)}</p>
                    {item.notes && <p className="mt-0.5 text-[10px] italic text-muted-foreground">“{item.notes}”</p>}
                    {item.allergies && <p className="text-[10px] font-semibold text-destructive">⚠ {item.allergies}</p>}
                  </div>
                  {isOpen && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(item, item.quantity - 1)} disabled={pending}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">
                        <Minus size={13} />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                      <button onClick={() => setQty(item, item.quantity + 1)} disabled={pending}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">
                        <Plus size={13} />
                      </button>
                      {/* Bloc D — soft-cancel this line (owner only). */}
                      <button onClick={() => cancelLine(item)} disabled={pending}
                        title={tnotif('cancelLine')} aria-label={tnotif('cancelLine')}
                        className="ms-1 grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )}

          {isOpen && (
            <>
              {/* Add from menu */}
              <div className="rounded-2xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                  <Search size={14} className="shrink-0 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="w-full bg-transparent text-sm focus:outline-none"
                  />
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {filteredMenu.length === 0 ? (
                    <p className="py-3 text-center text-[12px] text-muted-foreground">{t('menuEmpty')}</p>
                  ) : filteredMenu.map(mi => (
                    <button key={mi.id} onClick={() => addMenuItem(mi)} disabled={pending}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50">
                      <span className="truncate">{mi.name}</span>
                      <span className="ms-2 shrink-0 font-semibold text-primary">{eur(mi.price)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Free line */}
              <form onSubmit={addFreeLine} className="flex items-end gap-2 rounded-2xl border border-border bg-card p-3">
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('freeTitle')}</label>
                  <input value={freeName} onChange={e => setFreeName(e.target.value)} placeholder={t('freeNamePh')}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                </div>
                <div className="w-24">
                  <input value={freePrice} onChange={e => setFreePrice(e.target.value)} inputMode="decimal" placeholder={t('freePricePh')}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                </div>
                <button type="submit" disabled={pending || !freeName.trim()}
                  className="rounded-xl bg-navy px-3 py-2 text-sm font-semibold text-navy-foreground disabled:opacity-50">
                  {t('addBtn')}
                </button>
              </form>

              <p className="text-center text-[11px] text-muted-foreground">{t('paidNote')}</p>

              {/* Void */}
              {confirmVoid ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px]">
                  <span className="text-destructive">{t('voidConfirm')}</span>
                  <button onClick={voidTicket} disabled={pending} className="rounded-lg bg-destructive px-2.5 py-1 font-semibold text-white disabled:opacity-50">{t('voidYes')}</button>
                  <button onClick={() => setConfirmVoid(false)} className="rounded-lg border border-border px-2.5 py-1 font-semibold text-muted-foreground">{t('voidNo')}</button>
                </div>
              ) : (
                <button onClick={() => setConfirmVoid(true)}
                  className="w-full rounded-xl border border-destructive/30 py-2 text-[12px] font-semibold text-destructive">
                  {t('voidBtn')}
                </button>
              )}
            </>
          )}
        </>
      )}

      {/* ── Bloc E/F — traced closure modal (close unpaid + deposit choice) */}
      {closeOpen && ticket && (
        <CloseTableModal
          ticketId={ticket.id}
          subtotal={ticket.subtotal}
          currency={ticket.currency}
          reservationId={ticket.reservationId ?? null}
          onClose={() => setCloseOpen(false)}
          onClosed={(res) => {
            setCloseOpen(false)
            // Surface the empreinte settlement outcome as a sober toast.
            if (res.depositResult === 'captured') {
              const amt = res.capturedAmount != null
                ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(res.capturedAmount / 100)
                : ''
              setCloseToast(tcl('doneCaptured', { amount: amt }))
            } else if (res.depositResult === 'released') {
              setCloseToast(tcl('doneReleased'))
            } else if (res.depositResult === 'error') {
              setCloseToast(tcl('settleError', { error: res.error ?? '' }))
            } else {
              setCloseToast(tcl('doneClosed'))
            }
            loadTicket(tableId)
          }}
        />
      )}
    </div>
  )
}
