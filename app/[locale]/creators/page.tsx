import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChefHat, ChevronRight, Store, Coins, BarChart2 } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button } from '@/components/design-system'
import { prisma } from '@/lib/prisma'

const FALLBACK_LEADERBOARD = [
  { rank: 1, name: 'Amina K.',  dishes: 8, totalSales: 1240, earnings: 2480 },
  { rank: 2, name: 'Karim B.',  dishes: 5, totalSales: 980,  earnings: 1960 },
  { rank: 3, name: 'Sofia L.',  dishes: 4, totalSales: 640,  earnings: 1280 },
  { rank: 4, name: 'Yann D.',   dishes: 3, totalSales: 420,  earnings: 840  },
  { rank: 5, name: 'Leila M.',  dishes: 2, totalSales: 280,  earnings: 560  },
]

async function getCreatorStats() {
  try {
    const [activeCount, approvedDishCount] = await Promise.all([
      prisma.creator.count(),
      prisma.creatorDish.count({ where: { status: { in: ['approved', 'live'] } } }),
    ])
    return { activeCount, approvedDishCount }
  } catch {
    return { activeCount: 0, approvedDishCount: 0 }
  }
}

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

export default async function CreatorsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  const [t, leaderboard, stats] = await Promise.all([
    getTranslations('creators'),
    getLeaderboard(),
    getCreatorStats(),
  ])

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">

      {/* Hero */}
      <div className="rounded-grubano-xl bg-gradient-to-br from-grubano-primary to-grubano-primary/70 p-6 mb-5 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-12 w-12 rounded-grubano-xl bg-white/20 flex items-center justify-center">
            <ChefHat size={26} />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold leading-tight">{t('heroLine1')}</h1>
            <p className="text-xl font-display font-bold leading-tight">{t('heroLine2')}</p>
          </div>
        </div>
        <p className="text-sm opacity-90 mb-5">{t('heroSubtitle')}</p>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {([
            { label: t('statActive'),     value: String(stats.activeCount)        },
            { label: t('statCommission'), value: '4%'                             },
            { label: t('statDishes'),     value: String(stats.approvedDishCount)  },
          ] as const).map(({ label, value }) => (
            <div key={label} className="rounded-grubano-lg bg-white/20 p-2.5 text-center">
              <p className="text-base font-bold">{value}</p>
              <p className="text-[10px] opacity-80">{label}</p>
            </div>
          ))}
        </div>

        <Link
          href="/creators/apply"
          className="flex items-center justify-center gap-2 w-full rounded-grubano-lg bg-white text-grubano-primary py-3 text-sm font-bold hover:bg-white/90 transition"
        >
          {t('becomeCreator')} <ChevronRight size={16} />
        </Link>
      </div>

      {/* Already creator banner */}
      <div className="mb-5 rounded-grubano-xl border border-grubano-primary/30 bg-grubano-tint p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{t('alreadyCreator')}</p>
          <p className="text-xs text-grubano-ink-muted">{t('alreadyCreatorDesc')}</p>
        </div>
        <Link href="/creators/dashboard">
          <Button variant="primary" size="sm">
            {t('mySpace')}
          </Button>
        </Link>
      </div>

      {/* Leaderboard */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-display font-bold">{t('leaderboardTitle')}</h2>
        <span className="text-xs text-grubano-ink-muted">{t('leaderboardHint')}</span>
      </div>
      <div className="space-y-2 mb-8">
        {leaderboard.map(({ rank, name, dishes, totalSales, earnings }) => (
          <Card key={rank} elevation="sm" padding="sm">
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-grubano-pill flex items-center justify-center text-sm font-bold shrink-0 ${
                rank === 1 ? 'bg-yellow-400 text-yellow-900'
                : rank === 2 ? 'bg-zinc-300 text-zinc-800'
                : rank === 3 ? 'bg-amber-700 text-amber-100'
                : 'bg-grubano-bg text-grubano-ink-muted'
              }`}>
                {rank}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{name}</p>
                <p className="text-[11px] text-grubano-ink-muted">
                  {t('leaderboardRow', { dishes, sales: totalSales })}
                </p>
              </div>
              <p className="text-sm font-bold text-grubano-success shrink-0">
                €{earnings.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
              </p>
            </div>
          </Card>
        ))}
      </div>

      {/* How it works */}
      <h2 className="text-base font-display font-bold mb-3">{t('howTitle')}</h2>
      <div className="space-y-3">
        {([
          { icon: ChefHat,   title: t('how1Title'), desc: t('how1Desc') },
          { icon: Store,     title: t('how2Title'), desc: t('how2Desc') },
          { icon: Coins,     title: t('how3Title'), desc: t('how3Desc') },
          { icon: BarChart2, title: t('how4Title'), desc: t('how4Desc') },
        ] as const).map(({ icon: Icon, title, desc }, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className="h-9 w-9 rounded-grubano-lg bg-grubano-tint flex items-center justify-center shrink-0">
              <Icon size={18} className="text-grubano-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-grubano-ink-muted">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
