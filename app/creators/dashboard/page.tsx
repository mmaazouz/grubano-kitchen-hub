'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChefHat, Upload, AlertCircle, CheckCircle2, Clock, Store } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const CUISINES = ['Français', 'Italien', 'Japonais', 'Méditerranéen', 'Fusion', 'Végétalien', 'Asiatique', 'Autre']

type Dish = {
  id:             string
  name:           string
  cuisineType:    string
  suggestedPrice: number
  status:         string
  adoptions:      number
  totalSales:     number
  earnings:       number
}

type DashData = {
  creator:      { id: string; name: string; verified: boolean } | null
  dishes:       Dish[]
  totalEarnings: number
  totalSales:   number
  adoptions:    number
}

type NewDish = {
  name:           string
  description:    string
  ingredientsRaw: string
  cuisineType:    string
  suggestedPrice: string
}

const EMPTY_DISH: NewDish = {
  name: '', description: '', ingredientsRaw: '', cuisineType: '', suggestedPrice: '',
}

export default function CreatorsDashboard() {
  const [tab,        setTab]        = useState<'dishes' | 'submit'>('dishes')
  const [data,       setData]       = useState<DashData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [form,       setForm]       = useState<NewDish>(EMPTY_DISH)
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')

  function load() {
    fetch('/api/creators/my-dishes')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function set(key: keyof NewDish, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmitDish(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitErr('')
    try {
      const ingredients = form.ingredientsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

      const res = await fetch('/api/creators/dishes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           form.name,
          description:    form.description,
          ingredients,
          cuisineType:    form.cuisineType,
          suggestedPrice: parseFloat(form.suggestedPrice),
        }),
      })

      if (res.ok) {
        setSubmitted(true)
        setForm(EMPTY_DISH)
        setTimeout(() => {
          setSubmitted(false)
          setTab('dishes')
          setLoading(true)
          load()
        }, 2000)
      } else {
        const d = await res.json()
        setSubmitErr(d.error ?? 'Erreur lors de la soumission')
      }
    } catch {
      setSubmitErr('Erreur réseau')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Chargement...</div>
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'approved':
      case 'live':
        return <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"><CheckCircle2 size={9} /> Actif</span>
      case 'pending':
        return <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400"><Clock size={9} /> En attente</span>
      default:
        return <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">Rejeté</span>
    }
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 rounded-2xl bg-amber-500/20 flex items-center justify-center">
          <ChefHat size={24} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold tracking-tight">Espace Créateur</h1>
          <p className="text-sm text-muted-foreground">
            {data?.creator?.name ?? 'Mon compte'} · Commission 4%
            {data?.creator?.verified && <span className="ml-1 text-success">✓</span>}
          </p>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { label: 'Gains totaux', value: `€${(data?.totalEarnings ?? 0).toFixed(0)}`,  color: 'text-success'  },
          { label: 'Ventes',       value: String(data?.totalSales ?? 0),                  color: ''              },
          { label: 'Adoptions',    value: String(data?.adoptions ?? 0),                   color: 'text-primary'  },
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
          ['dishes',  'Mes plats'],
          ['submit',  'Soumettre'],
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

      {/* Tab: My dishes */}
      {tab === 'dishes' && (
        <div className="space-y-2">
          {(data?.dishes.length ?? 0) === 0 ? (
            <Card className="text-center !p-8">
              <ChefHat size={28} className="mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-semibold mb-1">Aucun plat soumis</p>
              <p className="text-xs text-muted-foreground mb-4">
                Partagez votre première recette pour démarrer
              </p>
              <button
                onClick={() => setTab('submit')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
              >
                <Upload size={13} /> Soumettre un plat
              </button>
            </Card>
          ) : (
            data!.dishes.map(dish => (
              <Card key={dish.id} className="!p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{dish.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {statusBadge(dish.status)}
                      {dish.adoptions > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Store size={9} />{dish.adoptions} cuisine{dish.adoptions > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-3 shrink-0">
                    <p className="text-sm font-bold text-success">€{dish.earnings.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">{dish.totalSales} ventes</p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Tab: Submit dish */}
      {tab === 'submit' && (
        <form onSubmit={handleSubmitDish} className="space-y-3">
          {submitted ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">🎉</p>
              <p className="font-bold text-success text-lg">Concept soumis !</p>
              <p className="text-sm text-muted-foreground mt-1">Nous l&apos;examinons sous 48h.</p>
            </div>
          ) : (
            <>
              {([
                { key: 'name' as const,           label: 'Nom du plat',       type: 'text',   placeholder: 'Ex: Gnocchi à la truffe noire' },
                { key: 'ingredientsRaw' as const,  label: 'Ingrédients (séparés par virgule)', type: 'text', placeholder: 'gnocchi, truffe, parmesan, crème' },
                { key: 'suggestedPrice' as const,  label: 'Prix suggéré (€)', type: 'number',  placeholder: '12.90' },
              ]).map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                    {label}
                  </label>
                  <input
                    type={type}
                    required
                    step={type === 'number' ? '0.01' : undefined}
                    min={type === 'number' ? '0.01' : undefined}
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                  Type de cuisine
                </label>
                <select
                  required
                  value={form.cuisineType}
                  onChange={e => set('cuisineType', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Sélectionner...</option>
                  {CUISINES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                  Description
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Décrivez le plat, ses saveurs, son histoire..."
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {submitErr && <p className="text-xs text-destructive">{submitErr}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-50"
              >
                <Upload size={15} />
                {submitting ? 'Envoi en cours...' : 'Soumettre le concept'}
              </button>
            </>
          )}
        </form>
      )}

      {/* Apply CTA if not yet a creator */}
      {!data?.creator && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-center">
          <p className="text-sm font-bold mb-1">Pas encore inscrit comme créateur ?</p>
          <p className="text-xs text-muted-foreground mb-3">Soumettez votre portfolio pour être approuvé</p>
          <Link
            href="/creators/apply"
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 transition"
          >
            Déposer ma candidature
          </Link>
        </div>
      )}
    </div>
  )
}
