'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Store, Plus, TrendingUp, Star, ShoppingBag, Filter, Lock } from 'lucide-react'

const brands = [
  { name: 'Gnocchi Bar',   emoji: '🍝', revenue: 842, orders: 58, rating: 4.9, status: 'live',   bg: 'bg-orange-50' },
  { name: 'Riz Gourmand',  emoji: '🍚', revenue: 614, orders: 41, rating: 4.7, status: 'live',   bg: 'bg-blue-50'   },
  { name: 'Pasta Fresca',  emoji: '🍜', revenue: 723, orders: 49, rating: 4.8, status: 'live',   bg: 'bg-green-50'  },
  { name: 'Rollix',        emoji: '🌯', revenue: 468, orders: 36, rating: 4.6, status: 'paused', bg: 'bg-yellow-50' },
] as const

type BrandStatus = 'live' | 'paused'
type SortKey    = 'best' | 'worst'
type Platform   = 'grubano' | 'all'

export default function BrandsPage() {
  const [platform, setPlatform] = useState<Platform>('grubano')
  const [status,   setStatus]   = useState<'all' | BrandStatus>('all')
  const [sort,     setSort]     = useState<SortKey>('best')

  const filtered = [...brands]
    .filter((b) => status === 'all' || b.status === status)
    .sort((a, b) => sort === 'best' ? b.revenue - a.revenue : a.revenue - b.revenue)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Marques</h1>
      <p className="mb-4 text-sm text-muted-foreground">4 concepts actifs</p>

      {/* Filters */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        <button
          onClick={() => setPlatform('grubano')}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            platform === 'grubano' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}
        >
          Grubano
        </button>
        <button
          onClick={() => setPlatform('all')}
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            platform === 'all' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}
        >
          <Lock size={9} /> Toutes plateformes
        </button>
        <span className="mx-1 h-3 w-px bg-border" />
        {([['all', 'Statut: Tous'], ['live', 'Actives'], ['paused', 'Pause']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              status === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        {([['best', 'Top revenu'], ['worst', 'Bas revenu']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              sort === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {platform === 'all' && (
        <Link href="/premium" className="mb-3 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
          <Lock size={14} className="text-primary" />
          <p className="flex-1 text-[11px] font-semibold">Activez Grubano Pro pour voir UberEats, Deliveroo &amp; Just Eat</p>
          <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">29€/mois</span>
        </Link>
      )}

      <div className="space-y-3">
        {filtered.map((b) => (
          <article key={b.name} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-3 p-4">
              <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-2xl ${b.bg}`}>
                {b.emoji}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold">{b.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    b.status === 'live' ? 'bg-success/15 text-success' : 'bg-warning/20 text-warning'
                  }`}>
                    {b.status === 'live' ? 'Actif' : 'Pause'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Dark kitchen · Grubano</p>
              </div>
              <Store size={16} className="text-muted-foreground" />
            </div>
            <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-muted/30">
              <Stat icon={TrendingUp} label="Revenu"    value={`€${b.revenue}`}          />
              <Stat icon={ShoppingBag} label="Commandes" value={String(b.orders)}         />
              <Stat icon={Star}        label="Note"      value={b.rating.toFixed(1)}      />
            </div>
          </article>
        ))}
      </div>

      <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card py-4 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary">
        <Plus size={16} /> Ajouter une marque
      </button>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-2 py-3">
      <Icon size={12} className="text-muted-foreground" />
      <p className="text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}
