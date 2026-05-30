'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Camera, Sparkles, Check, Users, Clock, AlertTriangle,
  ChevronRight, Plus, CalendarDays, Euro, Filter, ShieldCheck,
  RefreshCw, QrCode, X, ChevronLeft, ChevronRight as ChevRight,
} from 'lucide-react'

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
  notes:        string | null
  table:        { id: string; name: string; seats: number }
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'list' | 'calendar' | 'plan' | 'setup'

export default function TablesPage() {
  const [tab,           setTab]           = useState<Tab>('list')
  const [tables,        setTables]        = useState<Table[]>([])
  const [reservations,  setReservations]  = useState<Reservation[]>([])
  const [loading,       setLoading]       = useState(true)
  const [selectedDate,  setSelectedDate]  = useState(new Date().toISOString().split('T')[0])
  const [addingRes,     setAddingRes]     = useState(false)

  const loadTables = useCallback(async () => {
    const r = await fetch('/api/tables')
    if (r.ok) {
      const d = await r.json()
      setTables(d.tables ?? [])
    }
  }, [])

  const loadReservations = useCallback(async (date: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/reservations?date=${date}`)
      if (r.ok) {
        const d = await r.json()
        setReservations(d.reservations ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  useEffect(() => {
    loadReservations(selectedDate)
  }, [selectedDate, loadReservations])

  async function updateStatus(id: string, status: Reservation['status']) {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    await fetch('/api/reservations', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status }),
    })
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Tables</h1>
          <p className="text-sm text-muted-foreground">Créneaux intelligents &amp; acomptes</p>
        </div>
        <button onClick={() => setAddingRes(true)}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground">
          <Plus size={13} /> Réservation
        </button>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1">
        {(['list', 'calendar', 'plan', 'setup'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[11px] font-semibold transition ${
              tab === k ? 'bg-card text-foreground shadow' : 'text-muted-foreground'
            }`}>
            {k === 'list' ? 'Liste' : k === 'calendar' ? 'Agenda' : k === 'plan' ? 'Plan' : 'Config'}
          </button>
        ))}
      </div>

      {tab === 'list'     && (
        <ListView
          reservations={reservations}
          loading={loading}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onUpdateStatus={updateStatus}
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
      {tab === 'plan' && <FloorPlanView tables={tables} reservations={reservations} />}
      {tab === 'setup'   && <SetupView tables={tables} onRefresh={loadTables} />}

      {addingRes && (
        <NewReservationForm
          tables={tables}
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
}: {
  reservations:   Reservation[]
  loading:        boolean
  selectedDate:   string
  onDateChange:   (d: string) => void
  onUpdateStatus: (id: string, status: Reservation['status']) => void
}) {
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
                      {r.status === 'arrived' && (
                        <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">Arrivé</span>
                      )}
                      {r.status === 'overrun' && (
                        <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-warning">Dépassement</span>
                      )}
                      {r.depositAmount > 0 && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-primary">
                          €{r.depositAmount} acompte{r.depositPaid ? ' ✓' : ''}
                        </span>
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
                  {r.status === 'confirmed' && (
                    <button
                      onClick={() => onUpdateStatus(r.id, 'arrived')}
                      className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground">
                      Arrivée
                    </button>
                  )}
                  {r.status === 'arrived' && (
                    <button
                      onClick={() => onUpdateStatus(r.id, 'overrun')}
                      className="rounded-lg bg-warning/20 px-2.5 py-1.5 text-[10px] font-semibold text-warning">
                      Dépassement
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
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

function FloorPlanView({ tables, reservations }: { tables: Table[]; reservations: Reservation[] }) {
  const [selected, setSelected] = useState<string | null>(null)

  const bookedIds = new Set(
    reservations
      .filter(r => r.status === 'confirmed' || r.status === 'arrived')
      .map(r => r.tableId),
  )

  const sel     = tables.find(t => t.id === selected)
  const selBooked = selected ? bookedIds.has(selected) : false
  const selRes  = sel ? reservations.filter(r => r.tableId === sel.id && r.status !== 'cancelled' && r.status !== 'noshow') : []

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
          const booked = bookedIds.has(t.id)
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
            </button>
          )
        })}
      </div>

      {sel && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold">{sel.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {sel.seats} places · {selBooked ? 'Réservée' : 'Disponible'}
              </p>
            </div>
            <button className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-navy-foreground">
              <QrCode size={16} />
            </button>
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

function SetupView({ tables, onRefresh }: { tables: Table[]; onRefresh: () => void }) {
  const [deposit, setDeposit] = useState(10)
  const [penalty, setPenalty] = useState(15)
  const [adding, setAdding]   = useState(false)
  const [newTable, setNewTable] = useState({ name: '', seats: 4, x: 50, y: 50 })
  const [saving, setSaving]   = useState(false)

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
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-primary" />
          <h3 className="text-sm font-bold">Protection no-show</h3>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Pré-autorisation carte bancaire requise à la réservation.
        </p>
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold">Acompte (remboursé à l&apos;arrivée)</label>
            <span className="text-sm font-bold text-primary">€{deposit}</span>
          </div>
          <input type="range" min={0} max={50} value={deposit} onChange={e => setDeposit(Number(e.target.value))} className="mt-2 w-full accent-primary" />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold">Pénalité no-show</label>
            <span className="text-sm font-bold text-destructive">€{penalty}</span>
          </div>
          <input type="range" min={0} max={50} value={penalty} onChange={e => setPenalty(Number(e.target.value))} className="mt-2 w-full accent-primary" />
        </div>
        <p className="mt-3 rounded-lg bg-muted p-2 text-[10px] text-muted-foreground">
          Le client voit : &quot;{deposit}€ d&apos;acompte. Remboursé à l&apos;arrivée. {penalty}€ si no-show.&quot;
        </p>
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

// ── New reservation form ──────────────────────────────────────────────────────

function NewReservationForm({
  tables, onClose, onSaved,
}: {
  tables:   Table[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    tableId:      tables[0]?.id ?? '',
    customerName: '',
    phone:        '',
    guests:       2,
    date:         today,
    time:         '19:00',
    duration:     60,
    type:         'standard' as 'quick' | 'standard' | 'full',
    depositAmount: 10,
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const start = new Date(`${form.date}T${form.time}:00`)
    const end   = new Date(start.getTime() + form.duration * 60_000)
    const r = await fetch('/api/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        tableId:       form.tableId,
        customerName:  form.customerName,
        phone:         form.phone || undefined,
        guests:        form.guests,
        date:          start.toISOString(),
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
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Heure</label>
              <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Couverts</label>
              <input type="number" min={1} max={30} value={form.guests} onChange={e => setForm(f => ({ ...f, guests: Number(e.target.value) }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Durée (min)</label>
              <input type="number" min={15} max={300} step={15} value={form.duration} onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none" />
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

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 text-sm">Annuler</button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">
              {saving ? <RefreshCw size={14} className="animate-spin mx-auto" /> : 'Réserver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
