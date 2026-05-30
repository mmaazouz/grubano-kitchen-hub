import Link from 'next/link'
import { ChefHat, ChevronRight, Store, Coins, BarChart2 } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const FALLBACK_LEADERBOARD = [
  { rank: 1, name: 'Amina K.',  dishes: 8, totalSales: 1240, earnings: 2480 },
  { rank: 2, name: 'Karim B.',  dishes: 5, totalSales: 980,  earnings: 1960 },
  { rank: 3, name: 'Sofia L.',  dishes: 4, totalSales: 640,  earnings: 1280 },
  { rank: 4, name: 'Yann D.',   dishes: 3, totalSales: 420,  earnings: 840  },
  { rank: 5, name: 'Leila M.',  dishes: 2, totalSales: 280,  earnings: 560  },
]

async function getLeaderboard() {
  try {
    const creators = await prisma.creator.findMany({
      include: {
        dishes: {
          where:  { status: { in: ['approved', 'live'] } },
          select: { totalSales: true },
        },
      },
      orderBy: { totalEarnings: 'desc' },
      take: 5,
    })
    if (creators.length === 0) return FALLBACK_LEADERBOARD
    return creators.map((c, i) => ({
      rank:       i + 1,
      name:       c.name,
      dishes:     c.dishes.length,
      totalSales: c.dishes.reduce((s, d) => s + d.totalSales, 0),
      earnings:   c.totalEarnings,
    }))
  } catch {
    return FALLBACK_LEADERBOARD
  }
}

export default async function CreatorsPage() {
  const leaderboard = await getLeaderboard()

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">

      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-6 mb-5 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center">
            <ChefHat size={26} />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold leading-tight">Créez un plat.</h1>
            <h1 className="text-xl font-display font-bold leading-tight">Vendez-le partout.</h1>
          </div>
        </div>
        <p className="text-sm opacity-90 mb-5">
          Soumettez vos recettes · Des restaurants les adoptent · Gagnez 4% sur chaque vente
        </p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: 'Créateurs actifs', value: '120+'   },
            { label: 'Commission',        value: '4%'     },
            { label: 'Plats au menu',     value: '340+'   },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white/20 p-2.5 text-center">
              <p className="text-base font-bold">{value}</p>
              <p className="text-[10px] opacity-80">{label}</p>
            </div>
          ))}
        </div>
        <Link
          href="/creators/apply"
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-white text-amber-600 py-3 text-sm font-bold hover:bg-white/90 transition"
        >
          Devenir créateur <ChevronRight size={16} />
        </Link>
      </div>

      {/* Link to dashboard */}
      <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Déjà créateur ?</p>
          <p className="text-xs text-muted-foreground">Gérez vos plats et consultez vos revenus</p>
        </div>
        <Link
          href="/creators/dashboard"
          className="shrink-0 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 transition"
        >
          Mon espace
        </Link>
      </div>

      {/* Leaderboard */}
      <SectionTitle hint="ce mois">Top créateurs</SectionTitle>
      <div className="space-y-2 mb-8">
        {leaderboard.map(({ rank, name, dishes, totalSales, earnings }) => (
          <Card key={rank} className="!p-3 flex items-center gap-3">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
              rank === 1 ? 'bg-amber-400 text-amber-900'
              : rank === 2 ? 'bg-zinc-400 text-zinc-900'
              : rank === 3 ? 'bg-amber-700 text-amber-100'
              : 'bg-accent text-muted-foreground'
            }`}>
              {rank}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{name}</p>
              <p className="text-[11px] text-muted-foreground">{dishes} plats · {totalSales} ventes</p>
            </div>
            <p className="text-sm font-bold text-success shrink-0">
              €{earnings.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
            </p>
          </Card>
        ))}
      </div>

      {/* How it works */}
      <SectionTitle>Comment ça marche</SectionTitle>
      <div className="space-y-3">
        {[
          {
            icon: ChefHat,
            title: 'Soumettez un plat',
            desc:  'Partagez votre recette, ingrédients et prix suggéré. Notre équipe examine sous 48h.',
          },
          {
            icon: Store,
            title: 'Les restaurants adoptent',
            desc:  'Vos plats approuvés sont proposés aux cuisines partenaires partout en France.',
          },
          {
            icon: Coins,
            title: 'Gagnez 4% sur chaque vente',
            desc:  'Recevez automatiquement 4% du prix de vente chaque fois qu\'un restaurant vend votre plat.',
          },
          {
            icon: BarChart2,
            title: 'Suivez vos performances',
            desc:  'Tableau de bord en temps réel : adoptions, ventes, revenus cumulés.',
          },
        ].map(({ icon: Icon, title, desc }, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <Icon size={18} className="text-amber-500" />
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
