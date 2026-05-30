import Link from 'next/link'
import { ShoppingBag, Star, Lock, ChevronRight } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const apps = [
  { name: 'UberEats',   icon: '🟠', category: 'Livraison', commission: '25%', rating: 4.8, connected: false },
  { name: 'Deliveroo',  icon: '🩵', category: 'Livraison', commission: '30%', rating: 4.7, connected: false },
  { name: 'Just Eat',   icon: '🟠', category: 'Livraison', commission: '22%', rating: 4.6, connected: false },
  { name: 'Lydia',      icon: '💜', category: 'Paiement',  commission: '1.4%', rating: 4.9, connected: true  },
  { name: 'SumUp',      icon: '🟢', category: 'Paiement',  commission: '1.5%', rating: 4.8, connected: false },
  { name: 'Mailchimp',  icon: '🐒', category: 'Marketing', commission: 'gratuit', rating: 4.5, connected: false },
]

export default function MarketplacePage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Marketplace</h1>
      <p className="mb-5 text-sm text-muted-foreground">Intégrations &amp; partenaires</p>

      <SectionTitle hint="Plateformes de livraison">Connecter</SectionTitle>
      <div className="space-y-2">
        {apps.map((app) => (
          <div key={app.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted text-2xl">
              {app.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{app.name}</p>
                {app.connected && (
                  <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">Connecté</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{app.category} · {app.commission} commission</p>
            </div>
            {app.connected ? (
              <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold">
                Configurer
              </button>
            ) : (
              <Link href="/premium" className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground">
                <Lock size={10} /> Pro
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
