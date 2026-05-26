'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Volume2, Pause, Filter, Lock } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const ORDERS = [
  { id: '#GR-2241', plat: 'Grubano',   brand: 'Gnocchi Bar',  total: 24.5, fee: 5,  time: 'il y a 2 min',  tone: 'primary',  premium: false },
  { id: '#GR-2240', plat: 'Grubano',   brand: 'Pasta Fresca', total: 31.2, fee: 5,  time: 'il y a 5 min',  tone: 'success',  premium: false },
  { id: '#UE-8421', plat: 'UberEats',  brand: 'Gnocchi Bar',  total: 24.5, fee: 25, time: 'il y a 6 min',  tone: 'primary',  premium: true  },
  { id: '#DR-9183', plat: 'Deliveroo', brand: 'Rollix',        total: 18.9, fee: 30, time: 'il y a 8 min',  tone: 'primary',  premium: true  },
  { id: '#JE-4421', plat: 'Just Eat',  brand: 'Pasta Fresca', total: 31.2, fee: 22, time: 'il y a 9 min',  tone: 'primary',  premium: true  },
] as const

const BRANDS = ['Toutes', ...Array.from(new Set(ORDERS.map(o => o.brand)))]

export default function OrdersPage() {
  const [brand,  setBrand]  = useState('Toutes')
  const [status, setStatus] = useState<'all' | 'live' | 'done'>('all')

  const visible = ORDERS.filter(o => !o.premium).filter(o => brand === 'Toutes' || o.brand === brand)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Commandes</h1>
      <p className="mb-4 text-sm text-muted-foreground">Grubano uniquement · {visible.length} actives</p>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button className="flex items-center justify-center gap-2 rounded-xl bg-navy py-3 text-sm font-semibold text-navy-foreground">
          <Volume2 size={15} /> Son activé
        </button>
        <button className="flex items-center justify-center gap-2 rounded-xl bg-destructive py-3 text-sm font-semibold text-destructive-foreground">
          <Pause size={15} /> Tout mettre en pause
        </button>
      </div>

      <Link href="/premium" className="mb-3 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
        <Lock size={14} className="text-primary" />
        <div className="flex-1">
          <p className="text-[11px] font-bold">Voir UberEats, Deliveroo &amp; Just Eat ici</p>
          <p className="text-[10px] text-muted-foreground">Pause unique multi-plateforme · Grubano Pro</p>
        </div>
        <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">Pro</span>
      </Link>

      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        {BRANDS.map(b => (
          <button key={b} onClick={() => setBrand(b)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${brand === b ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'}`}>
            {b}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        {([['all', 'Tous'], ['live', 'En cours'], ['done', 'Livrées']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${status === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'}`}>
            {l}
          </button>
        ))}
      </div>

      <SectionTitle hint="Live">En cours</SectionTitle>
      <div className="space-y-2">
        {visible.map((o) => {
          const net = o.total * (1 - o.fee / 100)
          return (
            <Card key={o.id} className="!p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <span className="text-xs font-bold">{o.plat}</span>
                  <span className="text-[11px] text-muted-foreground">{o.id}</span>
                </div>
                <span className="text-[11px] font-semibold text-success">{o.time}</span>
              </div>
              <p className="mt-1 text-sm font-semibold">{o.brand}</p>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-[11px] text-muted-foreground">
                  €{o.total.toFixed(2)} <span className="text-destructive">−{o.fee}%</span>
                </div>
                <p className="text-base font-bold">€{net.toFixed(2)} net</p>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
