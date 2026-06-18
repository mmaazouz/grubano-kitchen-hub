import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Lock, ChevronRight, LayoutDashboard } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, EmptyState } from '@/components/design-system'
import { prisma } from '@/lib/prisma'
import { RevenueCalculator } from './RevenueCalculator'
import BrandJoinCTA from './BrandJoinCTA'
import MyFranchiseeApplications from './MyFranchiseeApplications'

// ── Types ──────────────────────────────────────────────────────────────────────

type BrandRow = {
  id:          string
  name:        string
  cuisine:     string
  emoji:       string
  description: string
  avgRevenue:  number
  setupCost:   number
  royaltyRate: number
  citiesAvail: string[]
  available:   boolean
}

type FranchiseStats = {
  brandCount:  number
  avgRevenue:  number | null   // null → no data → show "—"
  posCount:    number
}

// ── Server data helpers ────────────────────────────────────────────────────────

const DEFAULT_ROYALTY = 0.06

async function getFranchiseStats(): Promise<FranchiseStats> {
  try {
    const [brandCount, aggResult, posCount] = await Promise.all([
      prisma.brand.count({ where: { openToFranchise: true } }),
      prisma.brand.aggregate({
        where: { openToFranchise: true },
        _avg:  { avgMonthlyRevenue: true },
      }),
      prisma.pointOfSale.count(),
    ])
    const avg = aggResult._avg.avgMonthlyRevenue
    return {
      brandCount,
      avgRevenue: avg && avg > 0 ? avg : null,
      posCount,
    }
  } catch {
    return { brandCount: 0, avgRevenue: null, posCount: 0 }
  }
}

async function getBrands(): Promise<BrandRow[]> {
  try {
    const dbBrands = await prisma.brand.findMany({
      where:   { openToFranchise: true },
      include: {
        menuItems:    { take: 4, select: { name: true } },
        pointsOfSale: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return dbBrands.map(b => ({
      id:          b.id,
      name:        b.name,
      cuisine:     b.cuisineType       ?? '',
      emoji:       b.emoji,
      description: b.tagline          ?? '',
      avgRevenue:  b.avgMonthlyRevenue ?? 0,
      setupCost:   b.setupFee         ?? 0,
      royaltyRate: b.royaltyPct       ?? DEFAULT_ROYALTY,
      citiesAvail: (Array.isArray(b.franchiseZones) ? b.franchiseZones : []) as string[],
      available:   b.franchiseStatus !== 'full',
    }))
  } catch {
    return []
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Format average monthly revenue as "X XXX€". Rounds to nearest hundred. */
function fmtRevenue(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')}€`
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function FranchisePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  setRequestLocale(locale)

  const [t, stats, brands] = await Promise.all([
    getTranslations('franchise'),
    getFranchiseStats(),
    getBrands(),
  ])

  // Stat banner values — honest, from DB
  const statValues = [
    {
      label: t('statBrands'),
      value: String(stats.brandCount),
    },
    {
      label: t('statAvgRevenue'),
      value: stats.avgRevenue !== null ? fmtRevenue(stats.avgRevenue) : '—',
    },
    {
      label: t('statSatisfaction'),   // repurposed as "Points de vente"
      value: String(stats.posCount),
    },
  ]

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="rounded-grubano-xl bg-gradient-to-br from-grubano-primary to-grubano-primary/70 p-6 mb-5 text-white">
        <h1 className="text-2xl font-display font-bold mb-2">{t('heroTitle')}</h1>
        <p className="text-sm opacity-90 mb-4">{t('heroSubtitle')}</p>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {statValues.map(({ label, value }) => (
            <div key={label} className="rounded-grubano-lg bg-white/15 p-3 text-center">
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[10px] opacity-80">{label}</p>
            </div>
          ))}
        </div>

        {/* Hero CTA = BECOME A FRANCHISOR (create your own brand). Distinct from the
            per-brand "join with my restaurant" CTA below (the B7 franchisee flow). */}
        <Link
          href="/franchise/apply"
          className="flex items-center justify-center gap-2 w-full rounded-grubano-lg bg-white text-grubano-primary py-3 text-sm font-bold hover:bg-white/90 transition"
        >
          {t('becomeFranchisor')} <ChevronRight size={16} />
        </Link>
      </div>

      {/* ── Already franchisee banner ─────────────────────────────────────── */}
      <div className="mb-6 rounded-grubano-xl border border-grubano-primary/30 bg-grubano-primary/5 p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{t('alreadyFranchisee')}</p>
          <p className="text-xs text-grubano-ink-muted">{t('alreadyFranchiseeDesc')}</p>
        </div>
        <Link href="/franchise/dashboard">
          <Button variant="primary" size="sm" leftIcon={<LayoutDashboard size={13} />}>
            {t('mySpace')}
          </Button>
        </Link>
      </div>

      {/* ── My franchisee candidacies (restaurateur, B7) — renders only if signed in
              with at least one candidacy; invisible to anonymous visitors. ────────── */}
      <MyFranchiseeApplications />

      {/* ── Brands grid ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-display font-bold">{t('brandsTitle')}</h2>
        <span className="text-xs text-grubano-ink-muted">
          {t('brandsHint', { count: brands.filter(b => b.available).length })}
        </span>
      </div>

      <div className="space-y-3 mb-8">
        {brands.length === 0 && (
          <EmptyState
            emoji={<span className="text-4xl">🏗️</span>}
            title={t('brandsEmpty')}
            description={t('brandsEmptyDesc')}
          />
        )}
        {brands.map(brand => (
          <Card key={brand.id} elevation="sm" padding="md">
            <div className="flex items-start gap-3 mb-2">
              <span className="text-2xl mt-0.5">{brand.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm">{brand.name}</h3>
                  {!brand.available && (
                    <Badge tone="danger" size="sm" icon={<Lock size={9} />}>
                      {t('brandFull')}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-grubano-ink-muted">{brand.cuisine}</p>
              </div>
            </div>

            <p className="text-xs text-grubano-ink-muted mb-3">{brand.description}</p>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {([
                { label: t('brandLabelRevenue'),   value: `${(brand.avgRevenue / 1000).toFixed(1)}k€/mois` },
                { label: t('brandLabelSetup'),     value: `${brand.setupCost.toLocaleString('fr-FR')}€`    },
                { label: t('brandLabelRoyalties'), value: `${(brand.royaltyRate * 100).toFixed(0)}%`       },
              ] as const).map(({ label, value }) => (
                <div key={label} className="rounded-grubano-md bg-grubano-bg px-2 py-1.5 text-center">
                  <p className="text-xs font-bold">{value}</p>
                  <p className="text-[10px] text-grubano-ink-muted">{label}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {brand.citiesAvail.map(city => (
                <span key={city} className="rounded-grubano-pill bg-grubano-bg px-2 py-0.5 text-[10px] text-grubano-ink-muted">
                  {city}
                </span>
              ))}
            </div>

            {brand.available ? (
              // B7 — join THIS brand with one of MY restaurants (franchisee flow), NOT the
              // become-a-franchisor form. Client island: owner-scoped, auth-aware.
              <BrandJoinCTA brandId={brand.id} brandName={brand.name} />
            ) : (
              <Button variant="ghost" size="sm" fullWidth disabled leftIcon={<Lock size={13} />}>
                {t('brandWaitlist')}
              </Button>
            )}
          </Card>
        ))}
      </div>

      {/* ── Revenue calculator (client island) ────────────────────────────── */}
      <RevenueCalculator />

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <h2 className="text-base font-display font-bold mb-3">{t('howTitle')}</h2>
      <div className="space-y-3">
        {([
          { step: '1', title: t('step1Title'), desc: t('step1Desc') },
          { step: '2', title: t('step2Title'), desc: t('step2Desc') },
          { step: '3', title: t('step3Title'), desc: t('step3Desc') },
          { step: '4', title: t('step4Title'), desc: t('step4Desc') },
        ] as const).map(({ step, title, desc }) => (
          <div key={step} className="flex gap-3 items-start">
            <div className="h-7 w-7 rounded-grubano-pill bg-grubano-primary flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5">
              {step}
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
