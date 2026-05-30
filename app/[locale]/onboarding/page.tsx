import Link from 'next/link'
import { Check, ChevronRight, Sparkles, Store, Users, BarChart3 } from 'lucide-react'
import { Card } from '@/components/grubano/Card'

const steps = [
  { icon: Store,    title: 'Créer votre première marque',    desc: 'Nom, logo, concept culinaire',       done: true,  href: '/brands'    },
  { icon: Sparkles, title: 'Configurer le menu IA',          desc: 'Scan ou saisie manuelle',            done: true,  href: '/menu'      },
  { icon: Users,    title: 'Inscrire vos premiers clients',  desc: 'Programme de fidélité actif',        done: false, href: '/loyalty'   },
  { icon: BarChart3,title: 'Connecter une plateforme',       desc: 'UberEats, Deliveroo ou Just Eat',    done: false, href: '/premium'   },
]

export default function OnboardingPage() {
  const doneCount = steps.filter(s => s.done).length

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Démarrage</h1>
      <p className="mb-5 text-sm text-muted-foreground">Configuration de votre Grubano OS</p>

      {/* Progress */}
      <div className="overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground mb-6">
        <p className="text-[11px] uppercase tracking-wider text-navy-foreground/60">Progression</p>
        <p className="mt-2 text-3xl font-bold">{doneCount}<span className="text-base text-navy-foreground/60">/{steps.length}</span></p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => (
          <Link key={i} href={s.href}
            className={`flex items-center gap-3 rounded-2xl border p-4 transition ${
              s.done ? 'border-success/20 bg-success/5' : 'border-border bg-card'
            }`}>
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              s.done ? 'bg-success text-success-foreground' : 'bg-accent text-primary'
            }`}>
              {s.done ? <Check size={16} /> : <s.icon size={16} />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{s.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.desc}</p>
            </div>
            {!s.done && <ChevronRight size={14} className="text-muted-foreground" />}
          </Link>
        ))}
      </div>

      <Link href="/dashboard" className="mt-5 block w-full rounded-xl border border-border bg-card py-3 text-center text-sm font-semibold">
        Configurer plus tard
      </Link>
    </div>
  )
}
