import Link from 'next/link'
import { Sparkles, TrendingUp, Lock } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const suggestions = [
  { dish: 'Gnocchi pesto',       current: 10.90, suggested: 12.50, reason: '+14% marge · dans la fourchette marché' },
  { dish: 'Butter chicken bowl', current: 13.50, suggested: 14.90, reason: '+10% · best-sellers similaires à €14-16' },
  { dish: 'Chicken roll',        current: 7.90,  suggested: 8.50,  reason: 'Sous le prix marché · +7.5%' },
]

export default function PricingPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Tarification IA</h1>
      <p className="mb-5 text-sm text-muted-foreground">Optimisation des prix en temps réel</p>

      <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-accent p-4 mb-5">
        <Sparkles size={16} className="text-primary mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-bold">+€340 de revenu potentiel ce mois</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            En ajustant 3 prix sur vos plats les plus vendus
          </p>
        </div>
      </div>

      <SectionTitle hint="Basé sur le marché Paris 75011">Suggestions de prix</SectionTitle>
      <div className="space-y-3">
        {suggestions.map((s) => (
          <Card key={s.dish} className="!p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-sm font-bold">{s.dish}</p>
              <TrendingUp size={14} className="text-success mt-0.5" />
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase">Actuel</p>
                <p className="text-base font-bold">€{s.current.toFixed(2)}</p>
              </div>
              <div className="flex-1 h-px bg-border relative">
                <span className="absolute left-1/2 -top-2 -translate-x-1/2 text-[10px] text-success font-bold">
                  +{((s.suggested - s.current) / s.current * 100).toFixed(0)}%
                </span>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase">Suggéré</p>
                <p className="text-base font-bold text-primary">€{s.suggested.toFixed(2)}</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{s.reason}</p>
            <div className="mt-3 flex gap-2">
              <button className="flex-1 rounded-lg bg-primary py-2 text-[11px] font-bold text-primary-foreground">
                Appliquer
              </button>
              <button className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold">
                Ignorer
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Link href="/premium" className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
        <Lock size={14} className="text-primary" />
        <div className="flex-1">
          <p className="text-xs font-bold">Tarification dynamique automatique</p>
          <p className="text-[11px] text-muted-foreground">Ajustement automatique selon l&apos;heure · Grubano Pro</p>
        </div>
        <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">Pro</span>
      </Link>
    </div>
  )
}
