'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CheckCircle2, Lock, ChevronRight, LayoutDashboard } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

type Brand = {
  id:          string
  name:        string
  cuisine:     string
  emoji:       string
  description: string
  avgRevenue:  number
  setupCost:   number
  royaltyRate: number
  citiesAvail: string[]
  available:   boolean
}

export default function FranchisePage() {
  const [brands, setBrands]   = useState<Brand[]>([])
  const [orders, setOrders]   = useState(80)
  const avgTicket             = 14

  useEffect(() => {
    fetch('/api/franchise/brands')
      .then(r => r.json())
      .then(d => setBrands(d.brands ?? []))
      .catch(() => {})
  }, [])

  const monthlyRevenue = orders * 30 * avgTicket
  const royalties      = monthlyRevenue * 0.06
  const netRevenue     = monthlyRevenue - royalties

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">

      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/70 p-6 mb-5 text-primary-foreground">
        <h1 className="text-2xl font-display font-bold mb-2">Rejoignez le réseau Grubano</h1>
        <p className="text-sm opacity-90 mb-4">
          Exploitez une marque établie · Zéro R&amp;D · Support opérationnel inclus
        </p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: 'Marques actives', value: '12'     },
            { label: 'CA moyen/mois',   value: '7 800€' },
            { label: 'Satisfaction',    value: '96%'    },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white/15 p-3 text-center">
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[10px] opacity-80">{label}</p>
            </div>
          ))}
        </div>
        <Link
          href="/franchise/apply"
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-white text-primary py-3 text-sm font-bold hover:bg-white/90 transition"
        >
          Candidater maintenant <ChevronRight size={16} />
        </Link>
      </div>

      {/* Already franchisee banner */}
      <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Déjà franchisé ?</p>
          <p className="text-xs text-muted-foreground">Accédez à votre tableau de bord</p>
        </div>
        <Link
          href="/franchise/dashboard"
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
        >
          <LayoutDashboard size={13} /> Mon dashboard
        </Link>
      </div>

      {/* Brands grid */}
      <SectionTitle hint={`${brands.filter(b => b.available).length} disponibles`}>
        Marques disponibles
      </SectionTitle>

      <div className="space-y-3 mb-8">
        {brands.map(brand => (
          <Card key={brand.id} className="!p-4">
            <div className="flex items-start gap-3 mb-2">
              <span className="text-2xl mt-0.5">{brand.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm">{brand.name}</h3>
                  {!brand.available && (
                    <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                      <Lock size={9} /> Complet
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{brand.cuisine}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-3">{brand.description}</p>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: 'CA moyen',  value: `${(brand.avgRevenue / 1000).toFixed(1)}k€/mois` },
                { label: 'Setup',     value: `${brand.setupCost.toLocaleString('fr-FR')}€` },
                { label: 'Royalties', value: `${(brand.royaltyRate * 100).toFixed(0)}%` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-accent px-2 py-1.5 text-center">
                  <p className="text-xs font-bold">{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {brand.citiesAvail.map(city => (
                <span key={city} className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
                  {city}
                </span>
              ))}
            </div>

            {brand.available ? (
              <Link
                href={`/franchise/apply`}
                className="w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground flex items-center justify-center gap-1.5 hover:bg-primary/90 transition"
              >
                <CheckCircle2 size={13} /> Candidater — {brand.name}
              </Link>
            ) : (
              <button
                disabled
                className="w-full rounded-xl bg-muted py-2.5 text-xs font-bold text-muted-foreground flex items-center justify-center gap-1.5 cursor-not-allowed"
              >
                <Lock size={13} /> Liste d&apos;attente
              </button>
            )}
          </Card>
        ))}
      </div>

      {/* Revenue calculator */}
      <SectionTitle>Simulateur de revenus</SectionTitle>
      <Card className="mb-8">
        <p className="text-xs text-muted-foreground mb-4">
          Estimez vos gains mensuels selon votre volume de commandes
        </p>

        <div className="mb-5">
          <div className="flex justify-between mb-2">
            <label className="text-xs font-semibold">Commandes / jour</label>
            <span className="text-sm font-bold text-primary">{orders}</span>
          </div>
          <input
            type="range"
            min={20}
            max={200}
            step={5}
            value={orders}
            onChange={e => setOrders(Number(e.target.value))}
            className="w-full accent-primary h-2 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>20 cmd/j</span>
            <span>200 cmd/j</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'CA brut / mois',  value: `${(monthlyRevenue / 1000).toFixed(1)}k€`, color: '' },
            { label: 'Royalties (6%)',  value: `${(royalties / 1000).toFixed(1)}k€`,      color: 'text-destructive' },
            { label: 'Revenu net',      value: `${(netRevenue / 1000).toFixed(1)}k€`,      color: 'text-success' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl bg-accent p-3 text-center">
              <p className={`text-sm font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Basé sur un ticket moyen de {avgTicket}€ · Estimation indicative
        </p>
      </Card>

      {/* How it works */}
      <SectionTitle>Comment ça marche</SectionTitle>
      <div className="space-y-3">
        {[
          { step: '1', title: 'Choisissez une marque',   desc: 'Sélectionnez parmi nos concepts validés par des milliers de commandes.' },
          { step: '2', title: 'Candidature en ligne',    desc: 'Formulaire 5 minutes. Réponse sous 48h. Aucun engagement initial.' },
          { step: '3', title: 'Formation & lancement',   desc: 'Recettes, photos, fiche produit et support opérationnel fournis.' },
          { step: '4', title: 'Opérez & gagnez',         desc: 'Concentrez-vous sur la cuisine. Grubano gère le marketing et les commandes.' },
        ].map(({ step, title, desc }) => (
          <div key={step} className="flex gap-3 items-start">
            <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0 mt-0.5">
              {step}
            </div>
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
