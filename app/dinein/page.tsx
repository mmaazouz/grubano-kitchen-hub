import Link from 'next/link'
import { QrCode, Utensils, Clock, Users, ChevronRight } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

export default function DineInPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Sur place</h1>
      <p className="mb-5 text-sm text-muted-foreground">Commande à table &amp; QR codes</p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { icon: Users,    label: 'Tables actives',  value: '3/6'     },
          { icon: Clock,    label: 'Attente moy.',    value: '18 min'  },
          { icon: Utensils, label: 'En cuisine',      value: '5 plats' },
        ].map((s) => (
          <Card key={s.label} className="text-center !p-3">
            <s.icon size={14} className="mx-auto text-primary mb-1" />
            <p className="text-base font-bold">{s.value}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      <SectionTitle hint="Scanner pour commander">QR codes des tables</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {['Table 1', 'Table 2', 'Terrasse', 'Bar', 'Salon', 'Table 3'].map((t) => (
          <div key={t} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-4">
            <div className="grid h-16 w-16 place-items-center rounded-xl bg-muted">
              <QrCode size={32} className="text-foreground" />
            </div>
            <p className="text-sm font-semibold">{t}</p>
            <button className="w-full rounded-lg border border-border py-1.5 text-[11px] font-semibold">
              Imprimer
            </button>
          </div>
        ))}
      </div>

      <Link href="/tables" className="mt-5 flex items-center justify-between rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
            <Utensils size={16} />
          </div>
          <div>
            <p className="text-sm font-bold">Gérer les réservations</p>
            <p className="text-[11px] text-muted-foreground">Créneaux &amp; acomptes</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-muted-foreground" />
      </Link>
    </div>
  )
}
