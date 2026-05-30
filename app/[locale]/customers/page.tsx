import { Users, Star, TrendingUp, Award } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'
import { prisma } from '@/lib/prisma'

async function getCustomers() {
  try {
    const customers = await prisma.loyaltyCustomer.findMany({
      orderBy: { pointsBalance: 'desc' },
      take: 20,
    })
    const total = await prisma.loyaltyCustomer.count()
    return { customers, total }
  } catch {
    return { customers: [], total: 0 }
  }
}

const TIER_COLORS: Record<string, string> = {
  bronze:  'bg-orange-100 text-orange-700',
  silver:  'bg-slate-100 text-slate-600',
  gold:    'bg-yellow-100 text-yellow-700',
  platine: 'bg-primary/15 text-primary',
}

export default async function CustomersPage() {
  const { customers, total } = await getCustomers()

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Clients fidèles</h1>
      <p className="mb-5 text-sm text-muted-foreground">{total} membres inscrits</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card className="text-center !p-3">
          <Users size={14} className="mx-auto text-primary mb-1" />
          <p className="text-lg font-bold">{total}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
        </Card>
        <Card className="text-center !p-3">
          <Star size={14} className="mx-auto text-warning mb-1" />
          <p className="text-lg font-bold">4.8</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Note moy.</p>
        </Card>
        <Card className="text-center !p-3">
          <TrendingUp size={14} className="mx-auto text-success mb-1" />
          <p className="text-lg font-bold">€87</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">LTV moy.</p>
        </Card>
      </div>

      <SectionTitle hint="Trié par points">Classement</SectionTitle>

      {customers.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <Award size={32} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucun client inscrit pour le moment</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {customers.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                i === 0 ? 'bg-warning/20 text-warning' : i === 1 ? 'bg-slate-100 text-slate-600' : 'bg-muted text-muted-foreground'
              }`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{c.email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold">{c.pointsBalance} pts</p>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                  TIER_COLORS[c.tier] ?? 'bg-muted text-muted-foreground'
                }`}>
                  {c.tier.charAt(0).toUpperCase() + c.tier.slice(1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
