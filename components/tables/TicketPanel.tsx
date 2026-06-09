'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Minus, Trash2, Search, Loader2, Receipt } from 'lucide-react'

// ── TicketPanel (Addition brique 1, Agent 2) ──────────────────────────────────
// Minimal operator UI to manage a table's addition: open a ticket, add dishes
// from the menu (searchable) or a free line, adjust quantities, remove lines, see
// the live total. NO payment (brique 2). Talks only to Agent 2's owner-scoped
// /api/tickets endpoints. Mounted as the "Addition" tab in TablesShell.

type TItem   = { id: string; menuItemId: string | null; name: string; unitPrice: number; quantity: number }
type Ticket  = { id: string; status: string; currency: string; subtotal: number; items: TItem[] }
type MenuRow = { id: string; name: string; price: number; category: string }
type Table   = { id: string; name: string; seats: number; active: boolean }

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

export default function TicketPanel({ tables }: { tables: Table[] }) {
  const t = useTranslations('tickets')
  const activeTables = tables.filter(tb => tb.active)

  const [tableId, setTableId]   = useState(activeTables[0]?.id ?? '')
  const [ticket, setTicket]     = useState<Ticket | null>(null)
  const [loading, setLoading]   = useState(false)
  const [pending, setPending]   = useState(false)
  const [error, setError]       = useState('')
  const [menu, setMenu]         = useState<MenuRow[]>([])
  const [search, setSearch]     = useState('')
  const [freeName, setFreeName] = useState('')
  const [freePrice, setFreePrice] = useState('')
  const [confirmVoid, setConfirmVoid] = useState(false)

  const loadTicket = useCallback(async (tid: string) => {
    if (!tid) { setTicket(null); return }
    setLoading(true); setError(''); setConfirmVoid(false)
    try {
      const r = await fetch(`/api/tickets?restaurantTableId=${tid}`, { cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      setTicket(d?.ticket ?? null)
    } catch {
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTicket(tableId) }, [tableId, loadTicket])

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

  // walkin=false → the server requires an 'arrived' reservation on this table and
  // binds the ticket to that exact service. walkin=true → open without a reservation.
  async function openTicket(walkin = false) {
    if (!tableId) return
    await mutate('/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantTableId: tableId, walkin }),
    })
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
          {/* Status + total */}
          <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ticket.status === 'paid' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'}`}>
              {ticket.status === 'paid' ? t('statusPaid') : t('statusOpen')}
            </span>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('total')}</p>
              <p className="text-xl font-bold text-foreground">{eur(ticket.subtotal)}</p>
            </div>
          </div>

          {/* Lines */}
          {ticket.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">{t('emptyLines')}</p>
          ) : (
            <div className="space-y-1.5">
              {ticket.items.map(item => (
                <div key={item.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{eur(item.unitPrice)} × {item.quantity} = {eur(item.unitPrice * item.quantity)}</p>
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
                      <button onClick={() => setQty(item, 0)} disabled={pending}
                        className="ms-1 grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
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
    </div>
  )
}
