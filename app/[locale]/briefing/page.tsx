'use client'

import { useEffect, useState } from 'react'
import {
  Clock, Sparkles, AlertTriangle, CheckCircle, RefreshCw,
  Users, Euro, CalendarDays, Package,
} from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

// ── Types ─────────────────────────────────────────────────────────────────────

type LowStockItem = { name: string; quantity: number; unit: string; minThreshold: number }
type ReservationItem = { time: string; customerName: string; guests: number; table: string; status: string; allergies: unknown[] }

type BriefingData = {
  briefing:     string
  lowStock:     LowStockItem[]
  reservations: ReservationItem[]
  kpis: { caToday: number; ordersToday: number; reservations: number; guests: number }
  generatedAt:  string
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BriefingPage() {
  const [data,      setData]      = useState<BriefingData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})

  const CHECKLIST = [
    'Vérifier les températures frigo',
    'Allumer les équipements de cuisson',
    'Contrôler les stocks du jour',
    'Activer les plateformes de livraison',
    'Briefer l\'équipe cuisine',
  ]

  function load() {
    setLoading(true)
    fetch('/api/briefing')
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const generatedTime = data?.generatedAt
    ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(data.generatedAt))
    : null

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Briefing du jour</h1>
          <p className="text-sm text-muted-foreground">
            Résumé IA · {generatedTime ? `généré à ${generatedTime}` : 'mis à jour automatiquement'}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground disabled:opacity-60">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPIs */}
      {data && (
        <div className="mb-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <Euro size={14} className="mx-auto text-primary" />
            <p className="mt-1 text-xl font-bold">€{data.kpis.caToday.toFixed(0)}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CA validé</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <CalendarDays size={14} className="mx-auto text-primary" />
            <p className="mt-1 text-xl font-bold">{data.kpis.reservations}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{data.kpis.guests} couverts</p>
          </div>
        </div>
      )}

      {/* AI Briefing */}
      <div className="overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground mb-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Résumé IA</p>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-navy-foreground/70">
            <RefreshCw size={14} className="animate-spin" />
            <p className="text-sm">Génération en cours…</p>
          </div>
        ) : data?.briefing ? (
          <p className="text-sm leading-relaxed text-navy-foreground/90 whitespace-pre-line">
            {data.briefing}
          </p>
        ) : (
          <p className="text-sm text-navy-foreground/70">
            Bonne journée ! Consultez vos stocks et vos réservations pour démarrer le service.
          </p>
        )}
      </div>

      {/* Low stock alerts */}
      {data && data.lowStock.length > 0 && (
        <>
          <SectionTitle>Alertes stocks</SectionTitle>
          <div className="space-y-2">
            {data.lowStock.map(item => {
              const ratio  = item.minThreshold > 0 ? item.quantity / item.minThreshold : 1
              const urgent = ratio <= 0.4
              return (
                <div key={item.name}
                  className={`flex items-start gap-3 rounded-xl border p-3 ${
                    urgent ? 'border-destructive/30 bg-destructive/10' : 'border-warning/30 bg-warning/10'
                  }`}>
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    urgent ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground'
                  }`}>
                    <Package size={14} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold capitalize">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.quantity} {item.unit} restant · seuil {item.minThreshold} {item.unit}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                    urgent ? 'bg-destructive/20 text-destructive' : 'bg-warning/20 text-warning'
                  }`}>
                    {urgent ? 'Critique' : 'Bas'}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Today's reservations */}
      {data && data.reservations.length > 0 && (
        <>
          <SectionTitle>Réservations ce soir</SectionTitle>
          <div className="space-y-2">
            {data.reservations.map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy text-navy-foreground">
                  <p className="text-[10px] font-bold">{r.time}</p>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{r.customerName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.table} · {r.guests} couvert{r.guests > 1 ? 's' : ''}
                    {Array.isArray(r.allergies) && r.allergies.length > 0 && (
                      <span className="ml-1 font-semibold text-destructive">⚠ Allergies</span>
                    )}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  r.status === 'arrived'   ? 'bg-success/15 text-success'
                  : r.status === 'overrun' ? 'bg-warning/20 text-warning'
                  :                          'bg-muted text-muted-foreground'
                }`}>
                  {r.status === 'arrived' ? 'Arrivé' : r.status === 'overrun' ? 'Dépassement' : 'Confirmé'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Checklist */}
      <SectionTitle>Checklist d&apos;ouverture</SectionTitle>
      <div className="space-y-2">
        {CHECKLIST.map(task => {
          const done = checklist[task] ?? false
          return (
            <div
              key={task}
              onClick={() => setChecklist(prev => ({ ...prev, [task]: !done }))}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                done ? 'border-success/20 bg-success/5' : 'border-border bg-card'
              }`}>
              <CheckCircle size={16} className={done ? 'text-success' : 'text-muted-foreground'} />
              <span className={`text-sm font-medium ${done ? 'line-through text-muted-foreground' : ''}`}>
                {task}
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-center text-[10px] text-muted-foreground">
        Le briefing est généré automatiquement à partir de vos données réelles.
      </p>
    </div>
  )
}
