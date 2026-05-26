import { TrendingUp, Star, Users, ChevronRight, CheckCircle2, Lock } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const BRANDS = [
  {
    name:        'Gnocchi Bar',
    cuisine:     'Italien',
    rating:      4.8,
    avgRevenue:  '8 200€/mois',
    setupCost:   '2 500€',
    royalty:     '6%',
    available:   true,
    description: 'Gnocchi artisanaux, sauces maison. Concept fort, forte demande.',
  },
  {
    name:        'Pasta Fresca',
    cuisine:     'Méditerranéen',
    rating:      4.6,
    avgRevenue:  '6 800€/mois',
    setupCost:   '2 000€',
    royalty:     '5%',
    available:   true,
    description: 'Pâtes fraîches et salades généreuses. Adapté aux cuisines compactes.',
  },
  {
    name:        'Rollix',
    cuisine:     'Fusion',
    rating:      4.7,
    avgRevenue:  '9 400€/mois',
    setupCost:   '3 000€',
    royalty:     '7%',
    available:   false,
    description: "Rouleaux fusion premium. Zone exclusive — liste d'attente active.",
  },
]

export default function FranchisePage() {
  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold tracking-tight">Portail Franchise</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Exploitez une marque établie · Zéro R&D · Support opérationnel inclus
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        {[
          { label: 'Marques actives', value: '12' },
          { label: 'CA moyen/mois',   value: '7 800€' },
          { label: 'Satisfaction',    value: '96%' },
        ].map(({ label, value }) => (
          <Card key={label} className="text-center !p-3">
            <p className="text-lg font-bold">{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>

      <SectionTitle>Marques disponibles</SectionTitle>
      <div className="space-y-3 mb-8">
        {BRANDS.map(brand => (
          <Card key={brand.name} className="!p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold">{brand.name}</h3>
                  {!brand.available && (
                    <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                      <Lock size={9} /> Complet
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{brand.cuisine}</p>
              </div>
              <div className="flex items-center gap-1 text-amber-400">
                <Star size={12} className="fill-amber-400" />
                <span className="text-xs font-bold">{brand.rating}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-3">{brand.description}</p>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: 'CA moyen',  value: brand.avgRevenue },
                { label: 'Setup',     value: brand.setupCost },
                { label: 'Royalties', value: brand.royalty },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-accent px-2 py-1.5 text-center">
                  <p className="text-xs font-bold">{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <button
              disabled={!brand.available}
              className="w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {brand.available
                ? <><CheckCircle2 size={13} /> Candidater — {brand.name}</>
                : <><Lock size={13} /> Liste d&apos;attente</>}
            </button>
          </Card>
        ))}
      </div>

      <SectionTitle>Comment ça marche</SectionTitle>
      <div className="space-y-3">
        {[
          { step: '1', title: 'Choisissez une marque', desc: 'Sélectionnez parmi nos concepts validés par des centaines de commandes.' },
          { step: '2', title: 'Candidature en ligne',  desc: 'Formulaire 5 minutes. Réponse sous 48h. Aucun engagement initial.' },
          { step: '3', title: 'Formation & launch',    desc: 'Recettes, photos, fiche produit et support opérationnel fournis.' },
          { step: '4', title: 'Opérez & gagnez',       desc: 'Concentrez-vous sur la cuisine. Grubano gère le marketing et les commandes.' },
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
