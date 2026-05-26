import Link from 'next/link'
import { Check, Crown, Radio, BarChart3, Volume2, Pause, Lock } from 'lucide-react'
import { Card } from '@/components/grubano/Card'

const features = [
  { icon: Radio,   label: 'Feed unifié UberEats, Deliveroo, Just Eat'         },
  { icon: Volume2, label: 'Alerte sonore par plateforme (configurable)'        },
  { icon: Pause,   label: 'Pause simultanée toutes plateformes en 1 tap'      },
  { icon: BarChart3,label: 'Analytics cross-plateforme · marges réelles'      },
  { icon: Lock,    label: 'Sync menu automatique sur toutes les apps'          },
]

export default function PremiumPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Grubano Pro</h1>
      <p className="mb-5 text-sm text-muted-foreground">Tout pour les multi-plateformes</p>

      {/* Hero card */}
      <div className="overflow-hidden rounded-3xl bg-navy p-6 text-navy-foreground">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase text-primary">
          <Crown size={11} /> Plan Pro
        </div>
        <p className="mt-4 text-3xl font-bold">
          29€<span className="text-base text-navy-foreground/60">/mois</span>
        </p>
        <p className="mt-1 text-[12px] text-navy-foreground/70">Sans engagement · annulable à tout moment</p>
        <button className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
          Démarrer 14 jours gratuits
        </button>
      </div>

      {/* Feature list */}
      <h2 className="mb-3 mt-6 text-sm font-bold">Ce que vous débloquez</h2>
      <Card className="!p-4">
        <ul className="space-y-3">
          {features.map((f) => (
            <li key={f.label} className="flex items-start gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
                <Check size={13} />
              </div>
              <div className="flex flex-1 items-center gap-2 pt-0.5">
                <f.icon size={13} className="text-primary" />
                <span className="text-[13px] font-semibold">{f.label}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Free plan */}
      <Card className="mt-4 !p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Plan gratuit inclus</p>
        <ul className="mt-2 space-y-1.5 text-[12px] text-muted-foreground">
          <li>• Commandes Grubano illimitées</li>
          <li>• Analytics de base (Grubano)</li>
          <li>• Gestion stocks + IA chat</li>
          <li>• Réservations &amp; fournisseurs</li>
        </ul>
      </Card>

      <Link href="/dashboard" className="mt-4 block w-full rounded-xl border border-border bg-card py-3 text-center text-sm font-semibold">
        Plus tard
      </Link>
    </div>
  )
}
