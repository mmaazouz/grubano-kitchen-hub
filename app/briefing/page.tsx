import { Clock, Sparkles, AlertTriangle, CheckCircle } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

export default function BriefingPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Briefing du jour</h1>
      <p className="mb-5 text-sm text-muted-foreground">Résumé IA · mis à jour automatiquement</p>

      <div className="overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-primary" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Résumé IA</p>
        </div>
        <p className="text-sm leading-relaxed text-navy-foreground/90">
          Bonne journée ! Aujourd&apos;hui vous avez <strong>3 priorités</strong> : vérifier le stock de sauce butter chicken,
          confirmer la réservation de Marc D. pour 19h, et répondre à l&apos;avis 1★ reçu il y a 2h.
        </p>
      </div>

      <SectionTitle>Checklist d&apos;ouverture</SectionTitle>
      <div className="space-y-2">
        {[
          { task: 'Vérifier les températures frigo',    done: true  },
          { task: 'Allumer les équipements de cuisson', done: true  },
          { task: 'Contrôler les stocks du jour',       done: false },
          { task: 'Activer les plateformes de livraison', done: false },
          { task: 'Briefer l\'équipe cuisine',          done: false },
        ].map((item) => (
          <div key={item.task} className={`flex items-center gap-3 rounded-xl border p-3 ${
            item.done ? 'border-success/20 bg-success/5' : 'border-border bg-card'
          }`}>
            <CheckCircle size={16} className={item.done ? 'text-success' : 'text-muted-foreground'} />
            <span className={`text-sm font-medium ${item.done ? 'line-through text-muted-foreground' : ''}`}>
              {item.task}
            </span>
          </div>
        ))}
      </div>

      <SectionTitle>Alertes du jour</SectionTitle>
      <div className="space-y-2">
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <AlertTriangle size={14} className="mt-0.5 text-warning shrink-0" />
          <div>
            <p className="text-xs font-bold">Stock sauce butter chicken faible</p>
            <p className="text-[11px] text-muted-foreground">Environ 1L restant · commander aujourd&apos;hui</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <Clock size={14} className="mt-0.5 text-warning shrink-0" />
          <div>
            <p className="text-xs font-bold">Pic de commandes prévu 19h–21h</p>
            <p className="text-[11px] text-muted-foreground">Préparer les ingrédients en avance</p>
          </div>
        </div>
      </div>
    </div>
  )
}
