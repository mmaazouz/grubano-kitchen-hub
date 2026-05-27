'use client'

import { Fragment, useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Users, RefreshCw, ShoppingBag, Euro, BarChart2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

// ── Types ─────────────────────────────────────────────────────────────────────

type RevenuePoint = { date: string; label: string; amount: number }
type BrandStat    = { name: string; emoji: string; amount: number; count: number }
type HourStat     = { hour: number; count: number }

type AnalyticsData = {
  revenueChart: RevenuePoint[]
  brandStats:   BrandStat[]
  peakHours:    HourStat[]
  kpis: {
    todayRevenue:  number
    todayOrders:   number
    totalRevenue:  number
    avgOrder:      number
    totalOrders:   number
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data,    setData]    = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/analytics')
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground gap-2">
        <RefreshCw size={16} className="animate-spin" /> Chargement…
      </div>
    )
  }

  // Fall back to mock data if DB is empty
  const revenueChart = data?.revenueChart ?? []
  const brandStats   = data?.brandStats   ?? []
  const peakHours    = data?.peakHours    ?? []
  const kpis         = data?.kpis ?? { todayRevenue: 0, todayOrders: 0, totalRevenue: 0, avgOrder: 0, totalOrders: 0 }

  const maxPeak = Math.max(...peakHours.map(h => h.count), 1)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Intelligence</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Chiffres réels, sans fioritures
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">Live</span>
      </p>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aujourd&apos;hui</p>
          <p className="mt-1 text-2xl font-bold">€{kpis.todayRevenue.toFixed(0)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <ShoppingBag size={10} /> {kpis.todayOrders} commandes
          </p>
        </Card>
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Panier moyen (30j)</p>
          <p className="mt-1 text-2xl font-bold">€{kpis.avgOrder.toFixed(2)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Euro size={10} /> {kpis.totalOrders} total
          </p>
        </Card>
      </div>

      {/* Revenue chart */}
      <SectionTitle hint="7 derniers jours">Revenus quotidiens</SectionTitle>
      {revenueChart.length > 0 ? (
        <Card className="!pt-4 !pb-2">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={revenueChart} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `€${v}`} />
              <Tooltip
                formatter={(v: number) => [`€${v.toFixed(2)}`, 'Revenu']}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)' }}
              />
              <Bar dataKey="amount" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[10px] text-muted-foreground text-right">
            Total 7j : <span className="font-bold text-foreground">€{revenueChart.reduce((s, d) => s + d.amount, 0).toFixed(0)}</span>
          </p>
        </Card>
      ) : (
        <Card>
          <p className="text-[12px] text-muted-foreground text-center py-6">Aucune commande encore enregistrée</p>
        </Card>
      )}

      {/* Best sellers by brand */}
      {brandStats.length > 0 && (
        <>
          <SectionTitle hint="30 derniers jours">Performance par marque</SectionTitle>
          <div className="space-y-2">
            {brandStats.map((b, i) => (
              <Card key={b.name} className={`flex items-center justify-between !p-3 ${i === 0 ? '!border-warning/40 !bg-warning/5' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{b.emoji}</span>
                  <div>
                    <p className="text-sm font-semibold">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">{b.count} commandes</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-primary">€{b.amount.toFixed(0)}</p>
                  {i === 0 && <span className="text-[9px] font-bold text-warning">★ Best</span>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Peak hours heatmap */}
      {peakHours.length > 0 && (
        <>
          <SectionTitle hint="7 derniers jours">Heures de pointe</SectionTitle>
          <Card>
            <div className="flex items-end gap-1 h-20">
              {peakHours.map(h => (
                <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-sm bg-primary transition-all"
                    style={{ height: `${Math.max(4, (h.count / maxPeak) * 100)}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">{h.hour}h</span>
                </div>
              ))}
            </div>
            {peakHours.length > 0 && (() => {
              const peak = peakHours.reduce((a, b) => a.count > b.count ? a : b)
              const slow = peakHours.reduce((a, b) => a.count < b.count ? a : b)
              return (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Pic : <span className="font-bold text-foreground">{peak.hour}h</span>
                  {' · '} Creux : <span className="font-bold text-foreground">{slow.hour}h</span>
                </p>
              )
            })()}
          </Card>
        </>
      )}

      {/* 30-day total */}
      <SectionTitle hint="30 derniers jours">Récapitulatif</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CA total</p>
            <p className="mt-1 text-2xl font-bold">€{kpis.totalRevenue.toFixed(0)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Commandes</p>
            <p className="mt-1 text-2xl font-bold">{kpis.totalOrders}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
