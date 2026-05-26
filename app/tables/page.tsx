'use client'

import { useState } from 'react'
import {
  Camera, Sparkles, Check, Users, Clock, AlertTriangle,
  ChevronRight, QrCode, Plus, CalendarDays, Euro, Filter, ShieldCheck,
} from 'lucide-react'

// ── Types & data ──────────────────────────────────────────────────────────────

type TableData = { id: string; name: string; seats: number; x: number; y: number; booked?: boolean }

const defaultTables: TableData[] = [
  { id: 'T1', name: 'Table 1', seats: 2, x: 18, y: 22 },
  { id: 'T2', name: 'Table 2', seats: 4, x: 55, y: 20, booked: true },
  { id: 'T3', name: 'Table 3', seats: 4, x: 80, y: 45 },
  { id: 'T4', name: 'Terrasse', seats: 6, x: 22, y: 60, booked: true },
  { id: 'T5', name: 'Bar',     seats: 3, x: 55, y: 70 },
  { id: 'T6', name: 'Salon',   seats: 4, x: 85, y: 80 },
]

type Reservation = {
  name: string; table: string; time: string; end: string; guests: number
  allergy: string | null; arrived: boolean; paid: number
  type: 'quick' | 'standard' | 'full'; status: 'confirmed' | 'arrived' | 'overrun'
}

const reservations: Reservation[] = [
  { name: 'Sarah K.',  table: 'Table 2', time: '18:00', end: '18:45', guests: 2, allergy: 'Gluten',              arrived: true,  paid: 10, type: 'quick',    status: 'arrived'   },
  { name: 'Marc D.',   table: 'Terrasse', time: '19:00', end: '20:00', guests: 4, allergy: null,                 arrived: false, paid: 0,  type: 'standard', status: 'confirmed' },
  { name: 'Léa M.',    table: 'Salon',   time: '20:00', end: '21:30', guests: 3, allergy: 'Lactose, Fruits à coque', arrived: false, paid: 25, type: 'full', status: 'confirmed' },
  { name: 'Karim Z.',  table: 'Bar',     time: '21:00', end: '21:45', guests: 2, allergy: null,                 arrived: false, paid: 0,  type: 'quick',    status: 'confirmed' },
  { name: 'Inès B.',   table: 'Table 2', time: '19:45', end: '20:45', guests: 2, allergy: null,                 arrived: false, paid: 10, type: 'standard', status: 'confirmed' },
]

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'list' | 'calendar' | 'plan' | 'setup'

export default function TablesPage() {
  const [tab, setTab] = useState<Tab>('list')

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Tables</h1>
      <p className="mb-4 text-sm text-muted-foreground">Créneaux intelligents &amp; acomptes</p>

      <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1">
        {([
          ['list',     'Liste'],
          ['calendar', 'Agenda'],
          ['plan',     'Plan'],
          ['setup',    'Configurer'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[11px] font-semibold transition ${
              tab === k ? 'bg-card text-foreground shadow' : 'text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'list'     && <ListView />}
      {tab === 'calendar' && <CalendarView />}
      {tab === 'plan'     && <FloorPlanView tables={defaultTables} />}
      {tab === 'setup'    && <SetupView />}
    </div>
  )
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView() {
  const [filter, setFilter] = useState<'all' | 'arrived' | 'allergy' | 'deposit'>('all')

  const filtered = reservations.filter((r) => {
    if (filter === 'arrived') return r.arrived
    if (filter === 'allergy') return !!r.allergy
    if (filter === 'deposit') return r.paid > 0
    return true
  })

  const totalRevenue = reservations.reduce((s, r) => s + r.paid, 0)

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { l: "Aujourd'hui", v: String(reservations.length),                                icon: CalendarDays },
          { l: 'Couverts',    v: String(reservations.reduce((s, r) => s + r.guests, 0)),    icon: Users        },
          { l: 'Acomptes',    v: `€${totalRevenue}`,                                         icon: Euro         },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl border border-border bg-card p-3 text-center">
            <s.icon size={14} className="mx-auto text-primary" />
            <p className="mt-1 text-base font-bold">{s.v}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        {([
          ['all',     'Toutes'],
          ['arrived', 'Arrivés'],
          ['allergy', 'Allergies'],
          ['deposit', 'Acompte'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
              filter === k ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((r) => (
          <div key={r.name + r.time} className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy text-navy-foreground">
                <p className="text-xs font-bold">{r.time}</p>
                <p className="text-[8px] opacity-60">{r.end}</p>
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{r.name}</p>
                  {r.arrived && (
                    <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">
                      Arrivé
                    </span>
                  )}
                  {r.paid > 0 && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      €{r.paid} acompte
                    </span>
                  )}
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    r.type === 'quick'
                      ? 'bg-muted text-muted-foreground'
                      : r.type === 'standard'
                      ? 'bg-warning/20 text-warning'
                      : 'bg-primary/15 text-primary'
                  }`}>
                    {r.type === 'quick' ? 'Rapide' : r.type === 'standard' ? 'Standard' : 'Complet'}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {r.table} · {r.guests} couverts · libère {r.end}
                </p>
                {r.allergy && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">
                    <AlertTriangle size={11} /> {r.allergy}
                  </div>
                )}
              </div>
              {!r.arrived && (
                <button className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground">
                  Arrivée
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Calendar view ─────────────────────────────────────────────────────────────

function CalendarView() {
  const hours  = ['18h', '19h', '20h', '21h', '22h']
  const tables = ['T1', 'T2', 'Terrasse', 'Bar', 'Salon']
  const occupied: Record<string, string[]> = {
    T2:      ['18h', '19h45'],
    Terrasse:['19h'],
    Salon:   ['20h'],
    Bar:     ['21h'],
  }

  return (
    <>
      <p className="mb-3 text-[11px] text-muted-foreground">Mardi 18 novembre · service du soir</p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card p-3">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-1 py-1 text-left">Table</th>
              {hours.map((h) => (
                <th key={h} className="px-1 py-1 text-center font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t} className="border-t border-border">
                <td className="py-2 pr-2 font-semibold">{t}</td>
                {hours.map((h) => {
                  const isOcc = occupied[t]?.some((o) => o.startsWith(h.replace('h', '')))
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
      <div className="mt-4 rounded-2xl border border-primary/30 bg-accent p-3.5">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-primary" />
          <p className="text-[11px] font-bold text-foreground">Optimisation IA</p>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Table 2 peut accueillir 3 services ce soir (18h → 19h30 → 21h). +€68 de revenu potentiel.
        </p>
      </div>
    </>
  )
}

// ── Floor plan view ───────────────────────────────────────────────────────────

function FloorPlanView({ tables }: { tables: TableData[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const sel = tables.find((t) => t.id === selected)

  return (
    <>
      <div className="mb-3 flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Réservée</span>
      </div>

      <div className="relative h-64 overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30">
        <div className="absolute left-2 top-2 rounded-lg bg-card/80 px-2 py-1 text-[9px] font-semibold uppercase text-muted-foreground">
          Salle principale
        </div>
        {tables.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            style={{ left: `${t.x}%`, top: `${t.y}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 px-2 py-1.5 text-[10px] font-bold shadow-sm transition ${
              t.booked
                ? 'border-muted-foreground/40 bg-muted text-muted-foreground'
                : 'border-success bg-success/15 text-success'
            } ${selected === t.id ? 'ring-2 ring-primary' : ''}`}>
            {t.name}
            <span className="block text-[8px] font-normal opacity-70">{t.seats} pl.</span>
          </button>
        ))}
      </div>

      {sel && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold">{sel.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {sel.seats} places · {sel.booked ? 'Réservée' : 'Disponible'}
              </p>
            </div>
            <button className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-navy-foreground">
              <QrCode size={16} />
            </button>
          </div>
          {!sel.booked && (
            <button className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
              Réserver cette table
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ── Setup view ────────────────────────────────────────────────────────────────

function SetupView() {
  const [deposit, setDeposit] = useState(10)
  const [penalty, setPenalty] = useState(15)

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
          <input
            type="range" min={0} max={50} value={deposit}
            onChange={(e) => setDeposit(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold">Pénalité no-show</label>
            <span className="text-sm font-bold text-destructive">€{penalty}</span>
          </div>
          <input
            type="range" min={0} max={50} value={penalty}
            onChange={(e) => setPenalty(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </div>

        <p className="mt-3 rounded-lg bg-muted p-2 text-[10px] text-muted-foreground">
          Le client voit : &quot;{deposit}€ d&apos;acompte. Remboursé à l&apos;arrivée. {penalty}€ de pénalité si no-show.&quot;
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-primary" />
          <h3 className="text-sm font-bold">Durées par type de repas</h3>
        </div>
        <ul className="mt-3 space-y-2 text-[12px]">
          <li className="flex items-center justify-between">
            <span>🥪 Rapide (sandwich, bowl)</span>
            <span className="font-bold">25–35 min</span>
          </li>
          <li className="flex items-center justify-between">
            <span>🍝 Standard (plat principal)</span>
            <span className="font-bold">45–60 min</span>
          </li>
          <li className="flex items-center justify-between">
            <span>🍽️ Complet (entrée + plat + dessert)</span>
            <span className="font-bold">75–90 min</span>
          </li>
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground">
          +15 min de tampon ajouté automatiquement avant la prochaine réservation.
        </p>
      </div>

      <button className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-3 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <Camera size={14} className="text-primary" /> Refaire le plan de salle (IA)
        </span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
      <button className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-3 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <Plus size={14} className="text-primary" /> Ajouter une table
        </span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    </div>
  )
}
