import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  TrendingUp, TrendingDown, ShoppingBag, Euro, Star,
  AlertTriangle, Sparkles, ChevronRight,
  ShoppingBasket, Megaphone, Building2, Truck, Package,
  MessageSquare, Users as UsersIcon, Clock,
} from 'lucide-react'
import { Link } from '@/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  Badge,
  Card,
  EmptyState,
} from '@/components/design-system'
import {
  DashboardRevenueChart,
  type RevenueChartDatum,
} from '@/components/dashboard/DashboardRevenueChart'

// ── Route config ─────────────────────────────────────────────────────────────
// Per-session, per-current-time data → never prerender, always run on demand.
export const dynamic = 'force-dynamic'

// ── Types ────────────────────────────────────────────────────────────────────

interface KpiDatum  { label: string; value: string; delta: number | null; deltaLabel: string }
interface OrderRow  {
  id:             string
  status:         string
  total:          number
  fulfillmentType:string
  createdAt:      Date
  itemsPreview:   string
}
interface TopDish   { name: string; qty: number }
interface Influencer { name: string; code: string; orders: number; earnings: number }
interface LowStock  { name: string; quantity: number; unit: string; minThreshold: number }

interface Action {
  key:   'pickup' | 'influencer' | 'franchise'
  icon:  React.ReactNode
  title: string
  desc:  string
  cta:   string
  href:  string
  /** Higher = more impactful — used to sort the at-most-3 visible cards. */
  impact: number
  tone:  'primary' | 'navy'
}

interface DashboardData {
  restaurant: {
    id: string; name: string; rating: number; reviewCount: number
    pickupEnabled: boolean
  } | null
  kpis:        KpiDatum[]
  activeOrders: OrderRow[]
  chart:        RevenueChartDatum[]
  topDishes:    TopDish[]
  influencers:  Influencer[]
  lowStock:     LowStock[]
  actions:      Action[]
}

// ── Data fetch ───────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['received', 'preparing', 'ready', 'picked_up']

async function loadData(operatorEmail: string, t: Awaited<ReturnType<typeof getTranslations>>): Promise<DashboardData | null> {
  // Day boundaries
  const now      = new Date()
  const today    = new Date(now); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const yday     = new Date(today); yday.setDate(today.getDate() - 1)
  const week     = new Date(today); week.setDate(today.getDate() - 6)   // last 7 days incl. today
  const priorWk  = new Date(week);  priorWk.setDate(week.getDate() - 7)
  const last14   = new Date(today); last14.setDate(today.getDate() - 13) // 14 days incl. today
  const last30   = new Date(today); last30.setDate(today.getDate() - 29)

  // Operator + restaurant
  const operator = await prisma.operator.findUnique({
    where:  { email: operatorEmail },
    select: { id: true, role: true, restaurant: {
      select: {
        id: true, name: true, rating: true, reviewCount: true,
        pickupEnabled: true,
      },
    } },
  })

  if (!operator?.restaurant) {
    return {
      restaurant:   null,
      kpis:         [],
      activeOrders: [],
      chart:        [],
      topDishes:    [],
      influencers:  [],
      lowStock:     [],
      actions:      [],
    }
  }

  const restaurantId = operator.restaurant.id

  // Parallel queries
  const [
    ordersToday,  ordersYday,  ordersThisWeek, ordersPriorWeek,
    activeOrdersRaw, orders14d, orders30d,
    lowStockRaw, referralOrders,
  ] = await Promise.all([
    prisma.order.findMany({
      where:  { restaurantId, createdAt: { gte: today,   lt: tomorrow } },
      select: { total: true },
    }),
    prisma.order.findMany({
      where:  { restaurantId, createdAt: { gte: yday,    lt: today    } },
      select: { total: true },
    }),
    prisma.order.findMany({
      where:  { restaurantId, createdAt: { gte: week,    lt: tomorrow } },
      select: { total: true },
    }),
    prisma.order.findMany({
      where:  { restaurantId, createdAt: { gte: priorWk, lt: week     } },
      select: { total: true },
    }),
    prisma.order.findMany({
      where:   { restaurantId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
      take:    8,
      select: {
        id: true, status: true, total: true, fulfillmentType: true,
        items: true, createdAt: true,
      },
    }),
    prisma.order.findMany({
      where:   { restaurantId, createdAt: { gte: last14, lt: tomorrow } },
      select:  { total: true, createdAt: true },
    }),
    prisma.order.findMany({
      where:   { restaurantId, createdAt: { gte: last30, lt: tomorrow } },
      select:  { items: true },
    }),
    // quantity ≤ minThreshold * 1.2 needs JS-side filtering (Prisma can't
    // express column-vs-column on different fields), so just pull all.
    prisma.stockItem.findMany({
      select:  { name: true, quantity: true, unit: true, minThreshold: true },
    }),
    prisma.referralOrder.findMany({
      where: { order: { restaurantId } },
      include: {
        referral: { select: { creator: { select: { name: true, referralCode: true } } } },
      },
    }),
  ])

  // ── KPIs ────────────────────────────────────────────────────────────────
  const caToday = ordersToday.reduce((s, o) => s + o.total, 0)
  const caYday  = ordersYday.reduce((s, o) => s + o.total, 0)
  const caWeek  = ordersThisWeek.reduce((s, o) => s + o.total, 0)
  const caPrior = ordersPriorWeek.reduce((s, o) => s + o.total, 0)

  const aovWeek  = ordersThisWeek.length  > 0 ? caWeek  / ordersThisWeek.length  : 0
  const aovPrior = ordersPriorWeek.length > 0 ? caPrior / ordersPriorWeek.length : 0

  const pctChange = (curr: number, prev: number): number | null =>
    prev === 0 ? null : Math.round(((curr - prev) / prev) * 100)

  const kpis: KpiDatum[] = [
    {
      label:      t('kpi.revenueLabel'),
      value:      `€${Math.round(caToday)}`,
      delta:      pctChange(caToday, caYday),
      deltaLabel: t('kpi.vsYday'),
    },
    {
      label:      t('kpi.ordersLabel'),
      value:      String(ordersToday.length),
      delta:      pctChange(ordersToday.length, ordersYday.length),
      deltaLabel: t('kpi.vsYday'),
    },
    {
      label:      t('kpi.aovLabel'),
      value:      `€${aovWeek.toFixed(2)}`,
      delta:      pctChange(aovWeek, aovPrior),
      deltaLabel: t('kpi.vsLastWeek'),
    },
    {
      label:      t('kpi.ratingLabel'),
      value:      operator.restaurant.rating > 0
                    ? `${operator.restaurant.rating.toFixed(1)}★`
                    : '—',
      delta:      null,
      deltaLabel: '',
    },
  ]

  // ── Active orders ──────────────────────────────────────────────────────
  const activeOrders: OrderRow[] = activeOrdersRaw.map(o => {
    const items = Array.isArray(o.items) ? o.items as Array<{ name?: string; qty?: number }> : []
    const itemsPreview = items.slice(0, 2).map(i => `${i.qty ?? 1}× ${i.name ?? ''}`).join(' · ')
                       + (items.length > 2 ? ` +${items.length - 2}` : '')
    return {
      id:              o.id,
      status:          o.status,
      total:           o.total,
      fulfillmentType: o.fulfillmentType,
      createdAt:       o.createdAt,
      itemsPreview:    itemsPreview || '—',
    }
  })

  // ── 14-day chart ───────────────────────────────────────────────────────
  const dayBuckets = new Map<string, number>()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    dayBuckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const o of orders14d) {
    const k = new Date(o.createdAt).toISOString().slice(0, 10)
    if (dayBuckets.has(k)) dayBuckets.set(k, dayBuckets.get(k)! + o.total)
  }
  const dayFmt  = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' })
  const chart: RevenueChartDatum[] = Array.from(dayBuckets.entries()).map(([iso, amount]) => ({
    date:   iso,
    label:  dayFmt.format(new Date(iso)),
    amount: Math.round(amount * 100) / 100,
  }))

  // ── Top dishes (last 30 days) ──────────────────────────────────────────
  const dishMap = new Map<string, number>()
  for (const o of orders30d) {
    const items = Array.isArray(o.items) ? o.items as Array<{ name?: string; qty?: number }> : []
    for (const it of items) {
      const name = (it.name ?? '').trim()
      const qty  = Number(it.qty ?? 1)
      if (!name || !Number.isFinite(qty) || qty <= 0) continue
      dishMap.set(name, (dishMap.get(name) ?? 0) + qty)
    }
  }
  const topDishes: TopDish[] = Array.from(dishMap.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  // ── Influencers — group ReferralOrders by creator ──────────────────────
  const infMap = new Map<string, Influencer>()
  for (const r of referralOrders) {
    const c = r.referral?.creator
    if (!c) continue
    const key = c.referralCode ?? c.name
    const prev = infMap.get(key) ?? {
      name:     c.name,
      code:     c.referralCode ?? '',
      orders:   0,
      earnings: 0,
    }
    prev.orders   += 1
    prev.earnings += r.creatorEarning
    infMap.set(key, prev)
  }
  const influencers = Array.from(infMap.values())
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, 4)

  // ── Low stock (post-query filter) ──────────────────────────────────────
  const lowStock: LowStock[] = lowStockRaw
    .filter(s => s.minThreshold > 0 && s.quantity <= s.minThreshold * 1.2)
    .sort((a, b) => (a.quantity / a.minThreshold) - (b.quantity / b.minThreshold))
    .slice(0, 5)

  // ── Next best actions — calculated, priorité par impact estimé ─────────
  const actions: Action[] = []

  if (!operator.restaurant.pickupEnabled) {
    actions.push({
      key:    'pickup',
      icon:   <ShoppingBasket size={18} />,
      title:  t('actions.pickupTitle'),
      desc:   t('actions.pickupDesc'),
      cta:    t('actions.pickupCta'),
      href:   '/dashboard/fulfillment',
      impact: 80,
      tone:   'navy',
    })
  }

  if (influencers.length === 0) {
    actions.push({
      key:    'influencer',
      icon:   <Megaphone size={18} />,
      title:  t('actions.influencerTitle'),
      desc:   t('actions.influencerDesc'),
      cta:    t('actions.influencerCta'),
      href:   '/creators',
      impact: 60,
      tone:   'primary',
    })
  }

  // Franchise eligibility — solid rating + meaningful order history.
  const eligibleForFranchise =
       operator.restaurant.rating      >= 4.5
    && ordersThisWeek.length            >= 50

  if (eligibleForFranchise) {
    actions.push({
      key:    'franchise',
      icon:   <Building2 size={18} />,
      title:  t('actions.franchiseTitle'),
      desc:   t('actions.franchiseDesc'),
      cta:    t('actions.franchiseCta'),
      href:   '/franchise',
      impact: 90,
      tone:   'primary',
    })
  }

  actions.sort((a, b) => b.impact - a.impact)

  return {
    restaurant:   operator.restaurant,
    kpis,
    activeOrders,
    chart,
    topDishes,
    influencers,
    lowStock,
    actions: actions.slice(0, 3),
  }
}

async function loadDataSafe(email: string, t: Awaited<ReturnType<typeof getTranslations>>): Promise<DashboardData | null> {
  try {
    return await loadData(email, t)
  } catch (err) {
    console.error('[dashboard home] data load failed:', err)
    return null
  }
}

// ── Tiny shared display helpers ──────────────────────────────────────────────

function DeltaPill({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const positive = pct >= 0
  const Icon = positive ? TrendingUp : TrendingDown
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ' +
        (positive
          ? 'bg-grubano-success-tint text-grubano-success'
          : 'bg-grubano-danger-tint  text-grubano-danger')
      }
    >
      <Icon size={10} />
      {positive ? '+' : ''}{pct}%
    </span>
  )
}

function statusTone(status: string): 'info' | 'warning' | 'success' | 'neutral' {
  if (status === 'received')   return 'info'
  if (status === 'preparing')  return 'warning'
  if (status === 'ready')      return 'warning'
  if (status === 'picked_up')  return 'success'
  return 'neutral'
}

/**
 * Safe status label lookup — next-intl throws on missing keys, so we keep an
 * explicit allow-list and fall back to a generic key for anything unknown.
 */
const KNOWN_STATUS_KEYS = new Set([
  'received', 'preparing', 'ready', 'picked_up',
])
function statusKey(status: string): string {
  return KNOWN_STATUS_KEYS.has(status) ? `liveOrders.status_${status}` : 'liveOrders.status_unknown'
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardHomePage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('dashboard.home')

  const session = await getServerSession(authOptions)
  const email   = session?.user?.email

  // Defence in depth — middleware should already block unauthenticated visits.
  // If we get here without a session, render a graceful placeholder rather
  // than crashing the page.
  if (!email) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🔒"
          title={t('empty.authTitle')}
          description={t('empty.authDesc')}
        />
      </div>
    )
  }

  const d = await loadDataSafe(email, t)

  // ── Empty: no restaurant yet ─────────────────────────────────────────────
  if (!d || !d.restaurant) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState
          emoji="🏪"
          title={t('empty.noRestaurantTitle')}
          description={t('empty.noRestaurantDesc')}
          action={
            <Link
              href="/brands"
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white shadow-grubano-cta transition-colors hover:bg-grubano-primaryHover"
            >
              {t('empty.noRestaurantCta')} →
            </Link>
          }
        />
      </div>
    )
  }

  const dateLine = new Intl.DateTimeFormat(props.params.locale, {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date())

  const timeFmt = new Intl.DateTimeFormat(props.params.locale, {
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-4">
      {/* 1. EN-TÊTE MOTIVANT ────────────────────────────────────────────── */}
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {t('greeting', { name: d.restaurant.name })}
          </h1>
          <p className="text-sm text-grubano-ink-muted capitalize">{dateLine}</p>
        </div>
        <Badge tone="success" size="sm" dot>{t('statusOpen')}</Badge>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {d.kpis.map((k, i) => (
          <Card
            key={k.label}
            elevation="sm"
            padding="md"
            className={i === 0 ? 'bg-grubano-dark text-white' : ''}
          >
            <div className="flex items-center justify-between">
              <span className={
                'grid h-8 w-8 place-items-center rounded-grubano-md ' +
                (i === 0
                  ? 'bg-grubano-primary text-white'
                  : 'bg-grubano-tint text-grubano-primary')
              }>
                {i === 0 ? <Euro size={14} /> :
                 i === 1 ? <ShoppingBag size={14} /> :
                 i === 2 ? <TrendingUp size={14} /> :
                           <Star size={14} />}
              </span>
              <DeltaPill pct={k.delta} />
            </div>
            <p className={
              'mt-3 text-[10px] uppercase tracking-wider ' +
              (i === 0 ? 'text-white/60' : 'text-grubano-ink-muted')
            }>
              {k.label}
            </p>
            <p className={
              'mt-0.5 text-xl font-bold tracking-tight ' +
              (i === 0 ? 'text-white' : 'text-grubano-ink')
            }>
              {k.value}
            </p>
            {k.deltaLabel && k.delta !== null && (
              <p className={
                'mt-0.5 text-[10px] ' +
                (i === 0 ? 'text-white/40' : 'text-grubano-ink-faint')
              }>
                {k.deltaLabel}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* 2. NEXT BEST ACTIONS ────────────────────────────────────────────── */}
      {d.actions.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={16} className="text-grubano-primary" />
            <h2 className="font-display text-base font-semibold text-grubano-ink">
              {t('actions.title')}
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {d.actions.map(a => (
              <Link key={a.key} href={a.href} className="block">
                <Card
                  elevation="md"
                  padding="lg"
                  interactive
                  className={
                    a.tone === 'navy'
                      ? 'h-full border border-grubano-dark/10 bg-grubano-dark text-white'
                      : 'h-full border border-grubano-primary/30 bg-grubano-tint/40'
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary text-white">
                      {a.icon}
                    </div>
                    <ChevronRight
                      size={16}
                      className={a.tone === 'navy' ? 'text-white/40' : 'text-grubano-primary'}
                    />
                  </div>
                  <h3 className={
                    'mt-3 font-display text-base font-semibold ' +
                    (a.tone === 'navy' ? 'text-white' : 'text-grubano-ink')
                  }>
                    {a.title}
                  </h3>
                  <p className={
                    'mt-1 text-xs ' +
                    (a.tone === 'navy' ? 'text-white/70' : 'text-grubano-ink-muted')
                  }>
                    {a.desc}
                  </p>
                  <p className={
                    'mt-3 text-xs font-bold ' +
                    (a.tone === 'navy' ? 'text-grubano-primary' : 'text-grubano-primary')
                  }>
                    {a.cta} →
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 3. COMMANDES EN COURS ──────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-grubano-ink">
            {t('liveOrders.title')}
          </h2>
          <Link href="/orders" className="inline-flex items-center gap-1 text-xs font-semibold text-grubano-primary hover:underline">
            {t('liveOrders.seeAll')} <ChevronRight size={12} />
          </Link>
        </div>
        {d.activeOrders.length === 0 ? (
          <Card elevation="sm" padding="lg">
            <EmptyState
              emoji="🍽️"
              title={t('liveOrders.emptyTitle')}
              description={t('liveOrders.emptyDesc')}
              compact
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {d.activeOrders.map(o => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card elevation="sm" padding="md" interactive>
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-surface-muted text-grubano-ink-muted">
                      {o.fulfillmentType === 'pickup'
                        ? <ShoppingBasket size={16} />
                        : <Truck size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-grubano-ink">
                          #{o.id.slice(-6).toUpperCase()}
                        </span>
                        <Badge tone={statusTone(o.status)} size="sm">
                          {/* All four known statuses are translated; anything
                              unexpected falls back to the generic key. */}
                          {t(statusKey(o.status) as never)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-grubano-ink-muted">
                        {o.itemsPreview}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-grubano-ink">€{o.total.toFixed(2)}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-grubano-ink-faint">
                        <Clock size={10} />
                        {timeFmt.format(o.createdAt)}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 4. PERFORMANCE ─────────────────────────────────────────────────── */}
      <section className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-grubano-ink">
              {t('perf.title')}
            </h2>
            <Link href="/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-grubano-primary hover:underline">
              {t('perf.seeAll')} <ChevronRight size={12} />
            </Link>
          </div>
          <Card elevation="sm" padding="md">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-grubano-ink-faint">
              {t('perf.subtitle')}
            </p>
            <DashboardRevenueChart data={d.chart} />
          </Card>
        </div>
        <div>
          <div className="mb-2">
            <h2 className="font-display text-base font-semibold text-grubano-ink">
              {t('perf.topDishesTitle')}
            </h2>
          </div>
          <Card elevation="sm" padding="md">
            {d.topDishes.length === 0 ? (
              <EmptyState emoji="🍝" title={t('perf.topDishesEmpty')} compact />
            ) : (
              <ol className="space-y-2">
                {d.topDishes.map((dish, i) => (
                  <li key={dish.name} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-grubano-tint text-[10px] font-bold text-grubano-primary">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-grubano-ink">
                      {dish.name}
                    </span>
                    <span className="text-xs font-bold text-grubano-ink-muted">
                      {t('perf.qty', { count: dish.qty })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </section>

      {/* 5. INFLUENCEURS ─────────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-grubano-ink">
            {t('influencers.title')}
          </h2>
        </div>
        {d.influencers.length === 0 ? (
          <Card elevation="sm" padding="lg">
            <EmptyState
              emoji="📣"
              title={t('influencers.emptyTitle')}
              description={t('influencers.emptyDesc')}
              action={
                <Link
                  href="/creators"
                  className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white shadow-grubano-cta transition-colors hover:bg-grubano-primaryHover"
                >
                  {t('influencers.emptyCta')} →
                </Link>
              }
              compact
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {d.influencers.map(i => (
              <Card key={i.code || i.name} elevation="sm" padding="md">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary text-white">
                    <Megaphone size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-grubano-ink">{i.name}</p>
                    {i.code && (
                      <p className="mt-0.5 text-[10px] font-mono uppercase text-grubano-ink-faint">
                        {t('influencers.viaCode', { code: i.code })}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-grubano-ink">€{i.earnings.toFixed(2)}</p>
                    <p className="mt-0.5 text-[10px] text-grubano-ink-faint">
                      {t('influencers.ordersCount', { count: i.orders })}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 6. RECENT BITS — low stock + reviews ───────────────────────────── */}
      <section className="grid gap-3 md:grid-cols-2">
        {/* Low stock */}
        <Card elevation="sm" padding="md">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-grubano-ink">
              <AlertTriangle size={14} className="text-grubano-warning" />
              {t('bits.lowStockTitle')}
            </h3>
            <Link href="/stocks" className="text-xs font-semibold text-grubano-primary hover:underline">
              {t('bits.seeAll')}
            </Link>
          </div>
          {d.lowStock.length === 0 ? (
            <p className="py-3 text-center text-xs text-grubano-ink-muted">{t('bits.lowStockEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {d.lowStock.map(s => (
                <li key={s.name} className="flex items-center gap-2">
                  <Package size={12} className="text-grubano-warning" />
                  <span className="flex-1 truncate text-xs capitalize text-grubano-ink">{s.name}</span>
                  <span className="text-[10px] text-grubano-ink-muted">
                    {s.quantity}{s.unit} / {s.minThreshold}{s.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Reviews summary */}
        <Card elevation="sm" padding="md">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-grubano-ink">
              <MessageSquare size={14} className="text-grubano-primary" />
              {t('bits.reviewsTitle')}
            </h3>
            <Link href="/reviews" className="text-xs font-semibold text-grubano-primary hover:underline">
              {t('bits.seeAll')}
            </Link>
          </div>
          <div className="flex items-center gap-4 py-1">
            <div>
              <p className="text-2xl font-bold tracking-tight text-grubano-ink">
                {d.restaurant.rating > 0 ? d.restaurant.rating.toFixed(1) : '—'}
                <Star size={14} className="ml-1 inline -translate-y-1 text-grubano-primary" />
              </p>
              <p className="mt-0.5 text-[10px] text-grubano-ink-muted">
                {t('bits.reviewsCount', { count: d.restaurant.reviewCount })}
              </p>
            </div>
            <div className="flex flex-1 items-center gap-1 text-[10px] text-grubano-ink-faint">
              <UsersIcon size={11} />
              <span>{t('bits.reviewsSubtitle')}</span>
            </div>
          </div>
        </Card>
      </section>
    </div>
  )
}
