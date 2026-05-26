'use client'

import { useState } from 'react'
import { ChefHat, Trophy, TrendingUp, Upload, Star, Users } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const MY_DISHES = [
  { name: 'Gnocchi à la truffe',   adoptions: 3, sales: 142, earnings: 284.00, status: 'active'  },
  { name: 'Pasta cacio e pepe XXL', adoptions: 1, sales: 58,  earnings: 116.00, status: 'active'  },
  { name: 'Risotto saffran fusion', adoptions: 0, sales: 0,   earnings: 0,      status: 'pending' },
]

const LEADERBOARD = [
  { rank: 1, name: 'Amina K.',     dishes: 8, totalSales: 1240, earnings: 2480.00 },
  { rank: 2, name: 'Karim B.',     dishes: 5, totalSales: 980,  earnings: 1960.00 },
  { rank: 3, name: 'Mohammed M.',  dishes: 3, totalSales: 200,  earnings: 400.00  },
  { rank: 4, name: 'Sofia L.',     dishes: 4, totalSales: 176,  earnings: 352.00  },
]

const CUISINES = ['Français', 'Italien', 'Japonais', 'Méditerranéen', 'Fusion', 'Végétalien', 'Autre']

export default function CreatorsPage() {
  const [tab, setTab] = useState<'mes-plats' | 'soumettre' | 'classement'>('mes-plats')
  const [form, setForm] = useState({
    name: '', description: '', ingredients: '', price: '', cuisine: '', notes: '',
  })
  const [submitted, setSubmitted] = useState(false)

  const totalEarnings = MY_DISHES.reduce((s, d) => s + d.earnings, 0)
  const totalSales    = MY_DISHES.reduce((s, d) => s + d.sales, 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setTimeout(() => { setSubmitted(false); setTab('mes-plats') }, 2500)
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 rounded-2xl bg-amber-500/20 flex items-center justify-center">
          <ChefHat size={24} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold tracking-tight">Portail Créateur</h1>
          <p className="text-sm text-muted-foreground">Mohammed M. · Commission 4%</p>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { label: 'Gains totaux',  value: `€${totalEarnings.toFixed(0)}`, color: 'text-success' },
          { label: 'Ventes',        value: String(totalSales),              color: '' },
          { label: 'Adoptions',     value: '4',                             color: 'text-primary' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="text-center !p-3">
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-accent p-1 mb-5">
        {([
          ['mes-plats',   'Mes plats'],
          ['soumettre',   'Soumettre'],
          ['classement',  'Classement'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              tab === key ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Mes plats */}
      {tab === 'mes-plats' && (
        <div className="space-y-2">
          {MY_DISHES.map(dish => (
            <Card key={dish.name} className="!p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{dish.name}</p>
                  <div className="flex gap-2 mt-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      dish.status === 'active' ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {dish.status === 'active' ? '✓ Actif' : '⏳ En attente'}
                    </span>
                    {dish.adoptions > 0 && (
                      <span className="text-[10px] text-muted-foreground">{dish.adoptions} cuisine{dish.adoptions > 1 ? 's' : ''} l&apos;adoptent</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-success">€{dish.earnings.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">{dish.sales} ventes</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tab: Soumettre */}
      {tab === 'soumettre' && (
        <form onSubmit={handleSubmit} className="space-y-3">
          {submitted ? (
            <div className="text-center py-10">
              <p className="text-4xl mb-3">🎉</p>
              <p className="font-bold text-success">Concept soumis !</p>
              <p className="text-sm text-muted-foreground mt-1">Nous l&apos;examinons sous 48h.</p>
            </div>
          ) : (
            <>
              {[
                { key: 'name',        label: 'Nom du plat',               type: 'text',  placeholder: 'Ex: Gnocchi à la truffe noire' },
                { key: 'ingredients', label: 'Ingrédients clés',          type: 'text',  placeholder: 'Ex: gnocchi, truffe, parmesan, crème' },
                { key: 'price',       label: 'Prix suggéré (€)',          type: 'number', placeholder: '12.90' },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">{label}</label>
                  <input
                    type={type}
                    required
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Type de cuisine</label>
                <select
                  required
                  value={form.cuisine}
                  onChange={e => setForm(f => ({ ...f, cuisine: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Sélectionner...</option>
                  {CUISINES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Description</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Décrivez le plat, ses saveurs, son histoire..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <button type="submit" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground flex items-center justify-center gap-2">
                <Upload size={15} /> Soumettre le concept
              </button>
            </>
          )}
        </form>
      )}

      {/* Tab: Classement */}
      {tab === 'classement' && (
        <div className="space-y-2">
          {LEADERBOARD.map(({ rank, name, dishes, totalSales, earnings }) => (
            <Card key={rank} className={`!p-3 flex items-center gap-3 ${rank === 3 ? 'border-primary/40 bg-primary/5' : ''}`}>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                rank === 1 ? 'bg-amber-400 text-amber-900'
                : rank === 2 ? 'bg-zinc-400 text-zinc-900'
                : rank === 3 ? 'bg-amber-700 text-amber-100'
                : 'bg-accent text-muted-foreground'
              }`}>
                {rank}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{name} {rank === 3 && '👈 Vous'}</p>
                <p className="text-[11px] text-muted-foreground">{dishes} plats · {totalSales} ventes</p>
              </div>
              <p className="text-sm font-bold text-success shrink-0">€{earnings.toFixed(0)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
