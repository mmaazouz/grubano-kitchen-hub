import { TrendingUp, TrendingDown, Euro, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const transactions = [
  { label: 'Commandes Grubano',    amount: +2841.50, type: 'in',  date: 'Aujourd\'hui' },
  { label: 'Fournisseur Metro Pro', amount: -342.80, type: 'out', date: 'Aujourd\'hui' },
  { label: 'Commissions UberEats', amount: -421.30, type: 'out', date: 'Hier' },
  { label: 'Virement bancaire',    amount: +1800.00, type: 'in',  date: 'Hier' },
  { label: 'Transgourmet',         amount: -215.60, type: 'out', date: '22 nov.' },
]

export default function CashflowPage() {
  const balance = transactions.reduce((s, t) => s + t.amount, 0)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Trésorerie</h1>
      <p className="mb-5 text-sm text-muted-foreground">Flux de trésorerie · 30 derniers jours</p>

      <div className="overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground mb-5">
        <p className="text-[11px] uppercase tracking-wider text-navy-foreground/60">Solde estimé</p>
        <p className="mt-2 text-4xl font-bold">€{balance.toFixed(2)}</p>
        <div className="mt-4 flex gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Entrées</p>
            <p className="text-lg font-bold text-success">+€{transactions.filter(t => t.type === 'in').reduce((s,t) => s + t.amount, 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Sorties</p>
            <p className="text-lg font-bold text-destructive">€{transactions.filter(t => t.type === 'out').reduce((s,t) => s + t.amount, 0).toFixed(2)}</p>
          </div>
        </div>
      </div>

      <SectionTitle>Transactions récentes</SectionTitle>
      <div className="space-y-2">
        {transactions.map((t, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              t.type === 'in' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
            }`}>
              {t.type === 'in' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.label}</p>
              <p className="text-[11px] text-muted-foreground">{t.date}</p>
            </div>
            <p className={`text-sm font-bold ${t.type === 'in' ? 'text-success' : 'text-destructive'}`}>
              {t.type === 'in' ? '+' : ''}€{Math.abs(t.amount).toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
