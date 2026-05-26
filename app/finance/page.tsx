import Link from 'next/link'
import { PieChart, Receipt, TrendingUp, Download, Lock } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

export default function FinancePage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Finance</h1>
      <p className="mb-5 text-sm text-muted-foreground">Comptabilité &amp; rapports</p>

      {/* Monthly summary */}
      <div className="overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground mb-5">
        <p className="text-[11px] uppercase tracking-wider text-navy-foreground/60">Novembre 2025</p>
        <p className="mt-2 text-3xl font-bold">€18 420</p>
        <p className="mt-1 text-[12px] text-navy-foreground/70">Chiffre d&apos;affaires brut</p>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div><p className="text-[10px] text-navy-foreground/60 uppercase">Commissions</p><p className="font-bold text-destructive">-€4 105</p></div>
          <div><p className="text-[10px] text-navy-foreground/60 uppercase">Fournisseurs</p><p className="font-bold text-destructive">-€3 840</p></div>
          <div><p className="text-[10px] text-navy-foreground/60 uppercase">Net</p><p className="font-bold text-success">€10 475</p></div>
        </div>
      </div>

      <SectionTitle>Rapports disponibles</SectionTitle>
      <div className="space-y-2">
        {[
          { icon: Receipt,   title: 'Relevé des commissions',   desc: 'Par plateforme · Novembre'  },
          { icon: PieChart,  title: 'Répartition par marque',   desc: 'Analyse de rentabilité'     },
          { icon: TrendingUp,title: 'Rapport mensuel complet',  desc: 'PDF · exportable'           },
        ].map((r) => (
          <div key={r.title} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <r.icon size={16} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="text-[11px] text-muted-foreground">{r.desc}</p>
            </div>
            <button className="grid h-8 w-8 place-items-center rounded-lg border border-border">
              <Download size={13} />
            </button>
          </div>
        ))}
      </div>

      <Link href="/premium" className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
        <Lock size={14} className="text-primary" />
        <div className="flex-1">
          <p className="text-xs font-bold">Export comptable automatique</p>
          <p className="text-[11px] text-muted-foreground">Intégration Sage, QuickBooks · Grubano Pro</p>
        </div>
        <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">Pro</span>
      </Link>
    </div>
  )
}
