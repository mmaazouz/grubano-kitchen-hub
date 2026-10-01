'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import SessionBadge from '@/components/session/SessionBadge'
import UnpaidAlert from '@/components/tables/UnpaidAlert'
import InlinePayPanel from '@/components/tables/InlinePayPanel'
import CloseTableModal from '@/components/tables/CloseTableModal'
import { usePolling } from '@/lib/use-polling'

// ── TicketPanel (Addition brique 1, Agent 2) — re-skin CD LOT 4 ───────────────
// Minimal operator UI to manage a table's addition: open a ticket, add dishes
// from the menu (searchable) or a free line, adjust quantities, remove lines, see
// the live total. Talks only to Agent 2's owner-scoped /api/tickets endpoints.
// Mounted as the "Addition" tab in TablesShell.
//
// 🔒 RE-SKIN PRESENTATION-ONLY (⚠️ ZONE ARGENT). Every fetch / React state /
// handler is kept BYTE-IDENTICAL: openTicket / addMenuItem / addFreeLine / setQty
// / voidTicket / cancelLine / closeEmpty and the real payment via <InlinePayPanel />
// (Stripe Elements — POST /api/tickets/[id]/pay auto-capture) + the traced closure
// via <CloseTableModal /> (empreinte capture/release). Only the markup is restyled
// to --op-* + Material Symbols. Amounts = Float EUROS via formatEuros — NEVER
// recomputed. Stripe amounts stay server-side and are NEVER simulated.

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
  const locale = useLocale()
  const eur = (n: number) => formatEuros(n, locale)
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
    return (
      <div className="op-tk__empty">
        <span className="ic"><span className="ms" aria-hidden="true">table_bar</span></span>
        <p>{t('noTable')}</p>
      </div>
    )
  }

  const isOpen = ticket?.status === 'open'

  return (
    <div className="op-tk">
      {/* Table picker */}
      <div className="op-tk__picker">
        <label>{t('selectTable')}</label>
        <select
          className="op-select"
          value={tableId}
          onChange={e => setTableId(e.target.value)}
          style={{ flex: 1 }}
        >
          {activeTables.map(tb => (
            <option key={tb.id} value={tb.id}>{tb.name} ({tb.seats})</option>
          ))}
        </select>
      </div>

      {error && <p className="op-modalerr">{error}</p>}

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
        <div className="op-tk__empty">
          <span className="ms spin" aria-hidden="true">progress_activity</span>
        </div>
      ) : !ticket || ticket.status === 'void' ? (
        <div className="op-tk__empty">
          <span className="ic"><span className="ms" aria-hidden="true">receipt_long</span></span>
          {ticket?.status === 'void' && (
            <span className="op-pill void">{t('statusVoid')}</span>
          )}
          <p>{t('openHint')}</p>
          <button
            type="button"
            onClick={() => openTicket(false)}
            disabled={pending}
            className="op-btn-primary"
          >
            {pending
              ? <span className="ms spin" aria-hidden="true">progress_activity</span>
              : <span className="ms" aria-hidden="true">add</span>} {t('open')}
          </button>
          <button
            type="button"
            onClick={() => openTicket(true)}
            disabled={pending}
            className="walkin"
          >
            {t('openWalkin')}
          </button>
        </div>
      ) : (
        <>
          {/* Status + session badge + total */}
          <div className="op-tk__head">
            <div className="lft">
              <span className={`op-pill ${ticket.status === 'paid' ? 'paid' : 'open'}`}>
                {ticket.status === 'paid' ? t('statusPaid') : t('statusOpen')}
              </span>
              {/* Session anchor — short code (#A3F2) or walk-in pill. */}
              <SessionBadge reservationId={ticket.reservationId} />
            </div>
            <div className="total">
              <span className="lbl">{t('total')}</span>
              <b className="mono">{eur(ticket.subtotal)}</b>
            </div>
          </div>

          {/* ── Bloc D — new client-order banner ── */}
          {isOpen && newClientLineIds.size > 0 && (
            <button
              type="button"
              onClick={acknowledgeClientOrders}
              className="op-tk__banner"
            >
              <span className="ms" aria-hidden="true">notifications_active</span>
              <b>{tnotif('newClientOrder')}</b>
              <span className="n">{newClientLineIds.size}</span>
            </button>
          )}

          {/* ── Closure result toast (empreinte settlement) ── */}
          {closeToast && (
            <p className="op-tk__toast">{closeToast}</p>
          )}

          {/* ── Brique CLÔTURER LA TABLE ── */}
          {isOpen && (
            <div className="op-tk__close">
              <div className="top">
                <span className="ms" aria-hidden="true">credit_card</span>
                <div className="m" style={{ minWidth: 0, flex: 1 }}>
                  <b>{tc('closeTitle')}</b>
                  <p>{ticket.items.length > 0 ? tc('closeWithItems') : tc('closeEmpty')}</p>
                  {payingCurrent ? (
                    <div style={{ marginTop: 12 }}>
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
                        className="walkin"
                        style={{ marginTop: 8 }}
                      >
                        {tc('cancel')}
                      </button>
                    </div>
                  ) : ticket.items.length > 0 ? (
                    <div className="row">
                      <button
                        type="button"
                        onClick={() => setPayingCurrent(true)}
                        disabled={pending}
                        className="op-btn-mini primary"
                      >
                        <span className="ms" aria-hidden="true">credit_card</span>{tc('closeCta')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCloseOpen(true)}
                        disabled={pending}
                        className="op-btn-mini danger"
                      >
                        <span className="ms" aria-hidden="true">delete</span>{tcl('reasonUnpaid')}
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      <button
                        type="button"
                        onClick={closeEmpty}
                        disabled={pending}
                        className="op-btn-mini danger"
                      >
                        <span className="ms" aria-hidden="true">delete</span>{tc('releaseTable')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Lines */}
          {ticket.items.length === 0 ? (
            <p className="op-tk__paidnote" style={{ padding: '18px 0' }}>{t('emptyLines')}</p>
          ) : (
            <div className="op-tk__lines">
              {ticket.items.map(item => {
                const isClient = item.addedBy === 'client'
                const isNew    = newClientLineIds.has(item.id)
                return (
                  <div key={item.id} className={`op-tk__line${isNew ? ' is-new' : ''}`}>
                    <div className="m">
                      <div className="top">
                        <b>{item.name}</b>
                        {/* Bloc D — client-order tag. */}
                        {isClient && <span className="tag">{tnotif('clientLine')}</span>}
                      </div>
                      <p className="qtyline mono">{eur(item.unitPrice)} × {item.quantity} = {eur(item.unitPrice * item.quantity)}</p>
                      {item.notes && <p className="note">“{item.notes}”</p>}
                      {item.allergies && <p className="allerg">⚠ {item.allergies}</p>}
                    </div>
                    {isOpen && (
                      <div className="qtyctl">
                        <button type="button" onClick={() => setQty(item, item.quantity - 1)} disabled={pending} className="stepper" aria-label="−">
                          <span className="ms" aria-hidden="true">remove</span>
                        </button>
                        <span className="q mono">{item.quantity}</span>
                        <button type="button" onClick={() => setQty(item, item.quantity + 1)} disabled={pending} className="stepper" aria-label="+">
                          <span className="ms" aria-hidden="true">add</span>
                        </button>
                        {/* Bloc D — soft-cancel this line (owner only). */}
                        <button
                          type="button"
                          onClick={() => cancelLine(item)}
                          disabled={pending}
                          title={tnotif('cancelLine')}
                          aria-label={tnotif('cancelLine')}
                          className="stepper del"
                        >
                          <span className="ms" aria-hidden="true">delete</span>
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
              <div className="op-tk__add">
                <div className="op-tk__search">
                  <span className="ms" aria-hidden="true">search</span>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                  />
                </div>
                <div className="op-tk__menu">
                  {filteredMenu.length === 0 ? (
                    <p className="empty">{t('menuEmpty')}</p>
                  ) : filteredMenu.map(mi => (
                    <button key={mi.id} type="button" onClick={() => addMenuItem(mi)} disabled={pending} className="item">
                      <span className="nm">{mi.name}</span>
                      <span className="pr mono">{eur(mi.price)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Free line */}
              <form onSubmit={addFreeLine} className="op-tk__free">
                <div className="grow">
                  <label>{t('freeTitle')}</label>
                  <input
                    className="op-input"
                    value={freeName}
                    onChange={e => setFreeName(e.target.value)}
                    placeholder={t('freeNamePh')}
                  />
                </div>
                <div className="pw">
                  <input
                    className="op-input mono"
                    value={freePrice}
                    onChange={e => setFreePrice(e.target.value)}
                    inputMode="decimal"
                    placeholder={t('freePricePh')}
                  />
                </div>
                <button type="submit" disabled={pending || !freeName.trim()} className="op-btn-navy" style={{ padding: '10px 14px' }}>
                  {t('addBtn')}
                </button>
              </form>

              <p className="op-tk__paidnote">{t('paidNote')}</p>

              {/* Void */}
              {confirmVoid ? (
                <div className="op-tk__voidconfirm">
                  <span className="txt">{t('voidConfirm')}</span>
                  <button type="button" onClick={voidTicket} disabled={pending} className="yes">{t('voidYes')}</button>
                  <button type="button" onClick={() => setConfirmVoid(false)} className="no">{t('voidNo')}</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmVoid(true)} className="op-tk__void">
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
