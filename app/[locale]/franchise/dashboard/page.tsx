'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, AlertCircle, PlusCircle } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

type BrandPerf = {
  id:        string
  name:      string
  emoji:     string
  revenue:   number
  orders:    number
  royalties: number
  topDishes: string[]
}

type DashData = {
  revenueThisMonth: number
  revenueLastMonth: number
  royaltiesDue:     number
  networkAvg:       number
  brands:           BrandPerf[]
}

export default function FranchiseDashboard() {
  const [data,    setData]    = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/franchise/my-dashboard')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError('Erreur réseau'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Chargement...</div>
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-4">
        <AlertCircle size={32} className="text-muted-foreground" />
        <p className="text-sm font-semibold">{error}</p>
        <Link href="/franchise" className="text-xs text-primary underline">Retour au portail</Link>
      </div>
    )
  }

  const evoPct   = data && data.revenueLastMonth
    ? Math.round(((data.revenueThisMonth - data.revenueLastMonth) / data.revenueLastMonth) * 100)
    : null
  const vsNetwork = data ? data.revenueThisMonth - data.networkAvg : 0
  const hasBrands = (data?.brands.length ?? 0) > 0

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground mt-1">Performances de vos franchises ce mois</p>
        </div>
        <Link
          href="/franchise/apply"
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
        >
          <PlusCircle size={13} /> Ajouter marque
        </Link>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="!p-4">
          <p className="text-xs text-muted-foreground mb-1">CA ce mois</p>
          <p className="text-xl font-bold">
            {(data?.revenueThisMonth ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€
          </p>
          {evoPct !== null && (
            <div className={`flex items-center gap-1 text-xs mt-1 ${evoPct >= 0 ? 'text-success' : 'text-destructive'}`}>
              {evoPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {evoPct >= 0 ? '+' : ''}{evoPct}% vs mois dernier
            </div>
          )}
        </Card>

        <Card className="!p-4">
          <p className="text-xs text-muted-foreground mb-1">Royalties dues</p>
          <p className="text-xl font-bold text-destructive">
            {(data?.royaltiesDue ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€
          </p>
          <p className="text-xs text-muted-foreground mt-1">À régler fin de mois</p>
        </Card>

        <Card className="!p-4">
          <p className="text-xs text-muted-foreground mb-1">Mois précédent</p>
          <p className="text-xl font-bold">
            {(data?.revenueLastMonth ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€
          </p>
        </Card>

        <Card className={`!p-4 ${vsNetwork >= 0 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
          <p className="text-xs text-muted-foreground mb-1">vs réseau</p>
          <p className={`text-xl font-bold ${vsNetwork >= 0 ? 'text-success' : 'text-destructive'}`}>
            {vsNetwork >= 0 ? '+' : ''}{vsNetwork.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Moy. réseau: {(data?.networkAvg ?? 7800).toLocaleString('fr-FR')}€
          </p>
        </Card>
      </div>

      {/* Brands performance */}
      <SectionTitle hint={hasBrands ? `${data!.brands.length} marque${data!.brands.length > 1 ? 's' : ''}` : undefined}>
        Performances par marque
      </SectionTitle>

      {!hasBrands ? (
        <Card className="text-center !p-8">
          <AlertCircle size={28} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-semibold mb-1">Aucune marque active</p>
          <p className="text-xs text-muted-foreground mb-4">
            Soumettez une candidature pour démarrer votre franchise
          </p>
          <Link
            href="/franchise/apply"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
          >
            <PlusCircle size={13} /> Candidater
          </Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.brands.map(brand => (
            <Card key={brand.id} className="!p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{brand.emoji}</span>
                  <div>
                    <p className="font-bold text-sm">{brand.name}</p>
                    <p className="text-[11px] text-muted-foreground">{brand.orders} commandes ce mois</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">{brand.revenue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€</p>
                  <p className="text-[11px] text-destructive">
                    −{brand.royalties.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}€ royalties
                  </p>
                </div>
              </div>

              {brand.topDishes.length > 0 && (
                <>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide mb-1.5">
                    Meilleurs plats
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {brand.topDishes.map(dish => (
                      <span key={dish} className="rounded-full bg-accent px-2 py-0.5 text-[10px]">{dish}</span>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
