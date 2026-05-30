import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import {
  TrendingUp, ShoppingBag, Star, Users,
  AlertTriangle, CalendarDays, Truck, Sparkles,
  ChevronRight, Lock, Power, EyeOff,
} from 'lucide-react'

// ── Real data from MySQL ──────────────────────────────────────────────────────
async function getDashboardData() {
  try {
    const today     = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow  = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)

    const [ordersToday, ordersYday, loyaltyCount] = await Promise.all([
      prisma.loyaltyOrder.findMany({
        where:   { validatedAt: { gte: today, lt: tomorrow } },
        include: { brand: { select: { name: true } } },
        orderBy: { validatedAt: 'desc' },
        take:    20,
      }),
      prisma.loyaltyOrder.findMany({ where: { validatedAt: { gte: yesterday, lt: today } } }),
      prisma.loyaltyCustomer.count(),
    ])

    const caToday = ordersToday.reduce((s, o) => s + o.amount, 0)
    const caYday  = ordersYday.reduce((s, o) => s + o.amount, 0)
    const evoCA   = caYday > 0 ? Math.round(((caToday - caYday) / caYday) * 100) : null
    const evoCmds = ordersYday.length > 0
      ? Math.round(((ordersToday.length - ordersYday.length) / ordersYday.length) * 100)
      : null

    return { caToday, commandesJour: ordersToday.length, loyaltyCount, evoCA, evoCmds, ordersToday }
  } catch {
    return { caToday: 0, commandesJour: 0, loyaltyCount: 0, evoCA: null, evoCmds: null, ordersToday: [] }
  }
}

function EvoTag({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] font-semibold text-muted-foreground">vs hier : —</span>
  const pos = pct >= 0
  return (
    <span className={`text-[10px] font-semibold ${pos ? 'text-success' : 'text-destructive'}`}>
      {pos ? '+' : ''}{pct}%
    </span>
  )
}

export default async function DashboardPage() {
  const d = await getDashboardData()

  const kpis = [
    { icon: TrendingUp, label: 'Revenu vs hier', value: d.caToday > 0 ? `€${d.caToday.toFixed(0)}` : '€0', evo: d.evoCA, navy: true },
    { icon: ShoppingBag, label: 'Commandes',     value: String(d.commandesJour), evo: d.evoCmds, navy: false },
    { icon: Star,        label: 'Note (30j)',    value: '4.8★', evo: null, navy: false },
    { icon: Users,       label: 'Fidèles',       value: String(d.loyaltyCount), evo: null, navy: false },
  ]

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-4xl">

      {/* Header */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Aujourd&apos;hui</h1>
          <p className="text-sm text-muted-foreground">
            {new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success px-2.5 py-1 text-[10px] font-bold uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          Ouvert
        </span>
      </div>

      {/* Alertes */}
      <div className="mb-5 space-y-2">
        {[
          { icon: AlertTriangle, title: 'Vérifier les stocks ce soir', desc: 'Mettez à jour via l\'IA en fin de service', tone: 'warning', to: '/stocks' },
          { icon: CalendarDays,  title: 'Gérer les réservations', desc: 'Tables et couverts en attente', tone: 'navy', to: '/tables' },
        ].map((a) => (
          <Link key={a.to} href={a.to}
            className={`flex items-start gap-3 rounded-2xl border p-3.5 ${
              a.tone === 'warning' ? 'border-warning/30 bg-warning/10'
              : 'border-navy/20 bg-navy text-navy-foreground'
            }`}
          >
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              a.tone === 'warning' ? 'bg-warning text-warning-foreground' : 'bg-primary text-primary-foreground'
            }`}>
              <a.icon size={15} />
            </div>
            <div className="flex-1">
              <p className={`text-xs font-bold ${a.tone === 'navy' ? '' : 'text-foreground'}`}>{a.title}</p>
              <p className={`mt-0.5 text-[11px] ${a.tone === 'navy' ? 'text-navy-foreground/70' : 'text-muted-foreground'}`}>{a.desc}</p>
            </div>
            <ChevronRight size={16} className={a.tone === 'navy' ? 'text-navy-foreground/50' : 'text-muted-foreground'} />
          </Link>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {kpis.map(({ icon: Icon, label, value, evo, navy }) => (
          <div key={label} className={`rounded-2xl border p-3.5 ${navy ? 'border-transparent bg-navy text-navy-foreground' : 'border-border bg-card'}`}>
            <div className="flex items-center justify-between">
              <div className={`grid h-8 w-8 place-items-center rounded-lg ${navy ? 'bg-primary text-primary-foreground' : 'bg-accent text-primary'}`}>
                <Icon size={15} />
              </div>
              <EvoTag pct={evo} />
            </div>
            <p className={`mt-3 text-[10px] uppercase tracking-wider ${navy ? 'text-navy-foreground/60' : 'text-muted-foreground'}`}>{label}</p>
            <p className="mt-0.5 text-xl font-bold tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      {/* Stock AI shortcut */}
      <Link href="/stocks" className="mb-5 flex items-center gap-3 rounded-2xl bg-navy p-4 text-navy-foreground">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold">Mettre à jour mes stocks</p>
          <p className="mt-0.5 text-[11px] text-navy-foreground/70">Parlez à l&apos;IA en fin de service</p>
        </div>
        <ChevronRight size={18} className="text-navy-foreground/60" />
      </Link>

      {/* Actions rapides */}
      <h2 className="mb-2 text-sm font-bold">Actions rapides</h2>
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { icon: Power,       label: 'Ouvrir',    href: '#' },
          { icon: EyeOff,      label: 'Rupture',   href: '/menu' },
          { icon: CalendarDays,label: 'Résas',     href: '/tables' },
          { icon: Truck,       label: 'Commander', href: '/suppliers' },
        ].map(({ icon: Icon, label, href }) => (
          <Link key={label} href={href} className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card py-3 transition active:scale-95">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-foreground"><Icon size={15} /></div>
            <span className="text-[10px] font-semibold">{label}</span>
          </Link>
        ))}
      </div>

      {/* Dernières commandes */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Dernières commandes validées</h2>
        <Link href="/loyalty" className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
          Voir tout <ChevronRight size={12} />
        </Link>
      </div>

      {d.ordersToday.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Aucune commande validée aujourd&apos;hui</p>
          <Link href="/loyalty" className="mt-3 inline-block text-xs text-primary font-semibold underline">
            Valider une commande UberEats →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {d.ordersToday.slice(0, 5).map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{o.brand.name}</p>
                  <span className="text-[10px] text-muted-foreground">{o.uberOrderNumber}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(o.validatedAt))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">€{o.amount.toFixed(2)}</p>
                <span className="text-[10px] font-semibold text-success">+{o.pointsEarned} pts</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Premium */}
      <Link href="/premium" className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Lock size={14} /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-foreground">Connecter UberEats, Deliveroo, Just Eat</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Multi-plateforme · Grubano Pro</p>
        </div>
        <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">29€/mois</span>
      </Link>
    </div>
  )
}
