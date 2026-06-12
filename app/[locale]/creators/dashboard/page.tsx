'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  TrendingUp, TrendingDown, ChefHat, Sparkles, Upload,
  Copy, Check, Link2, Instagram, ArrowRight,
  CheckCircle2, Clock, Store, Users2, ShoppingBag,
  Wallet, Star, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Link } from '@/navigation'
import {
  Card, Button, Badge, EmptyState, SkeletonList,
} from '@/components/design-system'
import { useCategoryLabel } from '@/lib/categories'
import { buildReferralLink } from '@/lib/referral-link'
import { CreatorEarningsChart } from '@/components/creators/CreatorEarningsChart'
import { StarProgressCard } from '@/components/creators/StarBadge'
import type {
  CreatorHomeData, CreatorHomeDish, DishAdopter,
} from '@/app/api/creators/home/route'

// ── Types ──────────────────────────────────────────────────────────────────────

// ── Main component ─────────────────────────────────────────────────────────────

export default function CreatorDashboardHome() {
  const t           = useTranslations('creators.home')
  const getCatLabel = useCategoryLabel()

  const [data,           setData]           = useState<CreatorHomeData | null>(null)
  // Mission 2 - local override after a toggle PATCH (the page reloads to keep
  // the sidebar in sync, this is just the optimistic in-between).
  const [rolesOverride, setRolesOverride] = useState<{ isChef: boolean; isInfluencer: boolean } | null>(null)
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleError,  setRoleError]  = useState('')
  const [loading,        setLoading]        = useState(true)
  const [copied,         setCopied]         = useState(false)
  const [submitting,     setSubmitting]     = useState(false)
  const [expandedDishId, setExpandedDishId] = useState<string | null>(null)

  function load() {
    fetch('/api/creators/home')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])


  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }


  const CUISINE_OPTIONS = [
    'italien','asiatique','healthy','bowls','desserts',
    'burgers','wraps','sandwiches','pizza','sushi','pates','boissons',
  ].map(v => ({ value: v, label: getCatLabel(v) }))

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto space-y-4">
        <SkeletonList count={5} />
      </div>
    )
  }

  // ── Derived values ───────────────────────────────────────────────────────────
  const creator  = data?.creator ?? null
  const dishes   = data?.dishes  ?? []
  const audience = data?.audience ?? {
    referralsCount: 0, ordersCount: 0, earningsTotal: 0,
    earningsThisMonth: 0, earningsLastMonth: 0,
  }
  const rates      = data?.referralRates
  const chartData  = data?.chartData ?? []
  const thisMonth  = data?.earningsThisMonth ?? 0
  const lastMonth  = data?.earningsLastMonth ?? 0
  const totalEarn  = creator?.totalEarnings ?? 0
  const totalSales          = data?.dishSalesTotal         ?? 0
  const adoptions           = data?.dishAdoptionsTotal      ?? 0
  const recipeEarnings30d   = data?.recipeEarnings30d       ?? 0
  const referralEarnings30d = data?.referralEarnings30d     ?? 0

  // Mission 2 - role flags (default BOTH true until loaded: no flash).
  const roles = rolesOverride ?? data?.roles ?? { isChef: true, isInfluencer: true }
  const bothRoles = roles.isChef && roles.isInfluencer
  // Single active role -> that pipe's figures only (mission rule). The
  // combined last-month delta has no per-pipe source -> hidden then.
  const monthEarnings = bothRoles ? thisMonth : roles.isChef ? recipeEarnings30d : referralEarnings30d
  const totalEarnShown = bothRoles ? totalEarn : roles.isChef ? (data?.dishNetTotal ?? 0) : audience.earningsTotal
  const roleChartData = bothRoles ? chartData : chartData.map((d) => ({
    ...d,
    recipeAmount:   roles.isChef ? d.recipeAmount : 0,
    referralAmount: roles.isInfluencer ? d.referralAmount : 0,
    amount:         roles.isChef ? d.recipeAmount : d.referralAmount,
  }))

  const pctDelta = bothRoles && lastMonth > 0
    ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
    : null

  // Mission 2 - self-service toggle. The 'at least one role' guard is server-
  // side (400) and surfaced here; success reloads the page so the sidebar and
  // every section re-evaluate together.
  async function saveRoles(key: 'isChef' | 'isInfluencer', value: boolean) {
    if (roleSaving) return
    setRoleSaving(true)
    setRoleError('')
    try {
      const r = await fetch('/api/creators/me/roles', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [key]: value }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        setRoleError((body?.error as string) || t('rolesError'))
        return
      }
      setRolesOverride(body?.roles ?? null)
      window.location.reload()
    } catch {
      setRoleError(t('rolesError'))
    } finally {
      setRoleSaving(false)
    }
  }

  const fmt = (n: number) =>
    n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  const referralSlug = creator?.referralLinkSlug ?? creator?.referralCode?.toLowerCase() ?? null
  // Shared builder (B1-bis): /ref/<slug> on the page's real origin with the
  // business.* browsing host neutralized — never a hardcoded domain.
  const referralLink = buildReferralLink(referralSlug)

  // Flags driving "next best actions"
  const hasReferralCode = !!creator?.referralCode
  const fewDishes       = dishes.length < 2

  // ── Not a creator yet ────────────────────────────────────────────────────────
  if (!creator) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <EmptyState
          emoji={<Sparkles size={32} className="text-grubano-primary" />}
          title={t('notCreatorTitle')}
          description={t('notCreatorDesc')}
          action={
            <Link href="/creators/apply">
              <Button variant="primary" size="sm">{t('notCreatorCta')}</Button>
            </Link>
          }
        />
      </div>
    )
  }

  // ── Status badge helper ───────────────────────────────────────────────────────
  function StatusBadge({ status }: { status: string }) {
    if (status === 'approved' || status === 'live')
      return <Badge tone="success" size="sm" icon={<CheckCircle2 size={9} />}>{t('dishStatusActive')}</Badge>
    if (status === 'pending')
      return <Badge tone="warning" size="sm" icon={<Clock size={9} />}>{t('dishStatusPending')}</Badge>
    return <Badge tone="danger" size="sm">{t('dishStatusRejected')}</Badge>
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 pb-16 pt-5 max-w-2xl mx-auto space-y-6">

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — MOTIVATING HEADER
      ══════════════════════════════════════════════════════════════════════ */}
      <div>
        {/* Greeting */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-grubano-xl bg-grubano-tint flex items-center justify-center shrink-0">
            <Sparkles size={24} className="text-grubano-primary" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold tracking-tight leading-tight">
              {t('greeting', { name: creator.name.split(' ')[0] })}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              {creator.verified && (
                <span className="text-xs text-grubano-success font-semibold">
                  {t('greetingVerified')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* KPI grid */}
        {totalEarn === 0 && thisMonth === 0 ? (
          <div className="rounded-grubano-xl bg-grubano-tint border border-grubano-primary/20 px-4 py-3 text-sm text-grubano-primary text-center">
            {t('noEarningsYet')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* This month + delta */}
            <Card elevation="sm" padding="md">
              <p className="text-xs text-grubano-ink-muted mb-1">{t('kpiMonthEarnings')}</p>
              <p className="text-2xl font-bold font-display text-grubano-success">€{fmt(monthEarnings)}</p>
              {pctDelta !== null && (
                <div className={`flex items-center gap-1 text-xs mt-1 ${pctDelta >= 0 ? 'text-grubano-success' : 'text-grubano-danger'}`}>
                  {pctDelta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {pctDelta >= 0 ? t('trendUp', { pct: pctDelta }) : t('trendDown', { pct: pctDelta })}
                </div>
              )}
            </Card>

            {/* Total cumulative */}
            <Card elevation="sm" padding="md">
              <p className="text-xs text-grubano-ink-muted mb-1">{t('kpiTotalEarnings')}</p>
              <p className="text-2xl font-bold font-display">€{fmt(totalEarnShown)}</p>
            </Card>

            {/* Sales / Adoptions - chef figures; influencer-only mode shows
                the audience volumes instead (single-role rule, Mission 2). */}
            {roles.isChef ? (
              <>
                <Card elevation="sm" padding="md" className="text-center">
                  <p className="text-xl font-bold font-display text-grubano-primary">{totalSales}</p>
                  <p className="text-[11px] text-grubano-ink-muted mt-0.5">{t('kpiSales')}</p>
                </Card>
                <Card elevation="sm" padding="md" className="text-center">
                  <p className="text-xl font-bold font-display text-grubano-primary">{adoptions}</p>
                  <p className="text-[11px] text-grubano-ink-muted mt-0.5">{t('kpiAdoptions')}</p>
                </Card>
              </>
            ) : (
              <>
                <Card elevation="sm" padding="md" className="text-center">
                  <p className="text-xl font-bold font-display text-grubano-primary">{audience.ordersCount}</p>
                  <p className="text-[11px] text-grubano-ink-muted mt-0.5">{t('audienceOrders')}</p>
                </Card>
                <Card elevation="sm" padding="md" className="text-center">
                  <p className="text-xl font-bold font-display text-grubano-primary">{audience.referralsCount}</p>
                  <p className="text-[11px] text-grubano-ink-muted mt-0.5">{t('audienceCustomers')}</p>
                </Card>
              </>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1-bis — ⭐ VOS ÉTOILES GRUBANO (Mission 4, chef role only)
      ══════════════════════════════════════════════════════════════════════ */}
      {roles.isChef && (
        <StarProgressCard
          stars={data?.stars ?? 0}
          progress={data?.starProgress ?? { nextStar: 1, missingRestaurants: 1, missingSales: 0 }}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — NEXT BEST ACTIONS
      ══════════════════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-sm font-display font-bold mb-3 text-grubano-ink-muted uppercase tracking-widest">
          {t('actionsTitle')}
        </h2>
        <div className="space-y-2">

          {/* Action 1: Referral code not yet active */}
          {roles.isInfluencer && !hasReferralCode && (
            <Card elevation="sm" padding="md" className="border-l-4 border-l-grubano-primary">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-grubano-lg bg-grubano-tint flex items-center justify-center shrink-0">
                  <Link2 size={18} className="text-grubano-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{t('actionRefTitle')}</p>
                  <p className="text-xs text-grubano-ink-muted mt-0.5">
                    {rates
                      ? t('actionRefDesc', {
                          pct:  Math.round(rates.commissionPct * 100),
                          days: rates.durationDays,
                        })
                      : t('audienceNoCodeDesc')}
                  </p>
                </div>
                <Link href="/creators/dashboard/audience">
                  <Button variant="primary" size="sm" rightIcon={<ArrowRight size={13} />}>
                    {t('actionRefCta')}
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {/* Action 2: Submit a dish (if < 2 dishes) */}
          {roles.isChef && fewDishes && (
            <Card elevation="sm" padding="md" className="border-l-4 border-l-amber-400">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-grubano-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <ChefHat size={18} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{t('actionDishTitle')}</p>
                  <p className="text-xs text-grubano-ink-muted mt-0.5">{t('actionDishDesc')}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  rightIcon={<ArrowRight size={13} />}
                  onClick={() => { window.location.href = '/creators/dashboard/promotions' }}
                >
                  {t('actionDishCta')}
                </Button>
              </div>
            </Card>
          )}

          {/* Action 3: Discover programs (always shown) */}
          <Card elevation="sm" padding="md" className="border-l-4 border-l-grubano-ink-faint">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-grubano-lg bg-grubano-bg flex items-center justify-center shrink-0">
                <Star size={18} className="text-grubano-ink-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{t('actionProgramsTitle')}</p>
                <p className="text-xs text-grubano-ink-muted mt-0.5">{t('actionProgramsDesc')}</p>
              </div>
              <Link href="/creators">
                <Button variant="ghost" size="sm" rightIcon={<ArrowRight size={13} />}>
                  {t('actionProgramsCta')}
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — DUAL PROFILE (Recipes + Audience side by side)
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* ── Left: Mes recettes ─────────────────────────────────────────── */}
        {roles.isChef && (
        <Card elevation="sm" padding="md">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ChefHat size={16} className="text-grubano-primary" />
              <h2 className="text-sm font-bold">{t('dishesTitle')}</h2>
              {/* Chef contribution stat (Mission 1) — orders that came through
                  the public /chef page in the last 30 days. Volume only. */}
              {(data?.pageSales30d ?? 0) > 0 && (
                <span className="rounded-full bg-grubano-tint px-2 py-0.5 text-[10px] font-bold text-grubano-primary">
                  {t('pageSales', { count: data?.pageSales30d ?? 0 })}
                </span>
              )}
            </div>
            {dishes.length > 0 && (
              <button
                onClick={() => { window.location.href = '/creators/dashboard/promotions' }}
                className="text-[11px] font-semibold text-grubano-primary hover:underline flex items-center gap-1"
              >
                <Upload size={11} /> {t('manageRecipesCta')}
              </button>
            )}
          </div>

          {dishes.length === 0 ? (
            <EmptyState
              compact
              emoji={<ChefHat size={24} />}
              title={t('dishesEmpty')}
              description={t('dishesEmptyDesc')}
              action={
                <Button variant="primary" size="sm" onClick={() => { window.location.href = '/creators/dashboard/promotions' }}>
                  {t('manageRecipesCta')}
                </Button>
              }
            />
          ) : (
            <div className="space-y-1">
              {(dishes as CreatorHomeDish[]).slice(0, 4).map(dish => {
                const isExpanded = expandedDishId === dish.id
                const hasAdopters = dish.adopters.length > 0
                return (
                  <div key={dish.id} className="border-b border-grubano-border last:border-0">
                    {/* ── Dish row ─────────────────────────────────────── */}
                    <button
                      onClick={() => hasAdopters && setExpandedDishId(isExpanded ? null : dish.id)}
                      className={[
                        'w-full flex items-center justify-between py-1.5 text-left',
                        hasAdopters ? 'cursor-pointer' : 'cursor-default',
                      ].join(' ')}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{dish.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <StatusBadge status={dish.status} />
                          {dish.adoptions > 0 && (
                            <span className="text-[10px] text-grubano-ink-muted flex items-center gap-0.5">
                              <Store size={9} />
                              {t('dishAdoptions', { count: dish.adoptions })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2 shrink-0">
                        <div
                          className="text-right"
                          title={`Généré €${fmt(dish.earnings)} · Commission Grubano −€${fmt(dish.grubanoFee ?? 0)} · Net €${fmt(dish.earningsNet ?? dish.earnings)}`}
                        >
                          <p className="text-[9px] text-grubano-ink-faint uppercase tracking-wide leading-none mb-0.5">
                            {t('dishNetLabel')}
                          </p>
                          <p className="text-xs font-bold text-grubano-success">€{fmt(dish.earningsNet ?? dish.earnings)}</p>
                          <p className="text-[10px] text-grubano-ink-muted">{t('dishSales', { count: dish.totalSales })}</p>
                        </div>
                        {hasAdopters && (
                          isExpanded
                            ? <ChevronUp  size={12} className="text-grubano-ink-muted" />
                            : <ChevronDown size={12} className="text-grubano-ink-muted" />
                        )}
                      </div>
                    </button>

                    {/* ── Adopters accordion ───────────────────────────── */}
                    {isExpanded && (
                      <div className="pb-2 space-y-1.5">
                        {dish.adopters.map((adopter: DishAdopter) => {
                          const sinceDate = new Date(adopter.adoptedAt)
                            .toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                          return (
                            <div
                              key={adopter.adoptionId}
                              className="flex items-center justify-between rounded-grubano-md bg-grubano-bg px-2.5 py-1.5"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-sm shrink-0">{adopter.brandEmoji}</span>
                                <div className="min-w-0">
                                  <p className="text-[11px] font-semibold truncate">{adopter.brandName}</p>
                                  <p className="text-[10px] text-grubano-ink-muted">
                                    {t('dishAdopterSince', { date: sinceDate })}
                                    {' · '}€{adopter.sellingPrice.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              {adopter.commitmentMet ? (
                                <span className="ml-2 shrink-0 flex items-center gap-0.5 rounded-grubano-pill bg-grubano-success/10 px-2 py-0.5 text-[9px] font-semibold text-grubano-success">
                                  <CheckCircle2 size={9} />
                                  {t('dishAdopterCommitmentMet')}
                                </span>
                              ) : (
                                <span className="ml-2 shrink-0 rounded-grubano-pill bg-grubano-bg border border-grubano-border px-2 py-0.5 text-[9px] font-medium text-grubano-ink-muted">
                                  {t('dishAdopterDaysLeft', { days: adopter.daysRemaining })}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {dishes.length > 4 && (
                <p className="text-[11px] text-grubano-ink-muted text-center pt-1">
                  +{dishes.length - 4} autres
                </p>
              )}
            </div>
          )}
        </Card>
        )}

        {/* ── Right: Mon audience ────────────────────────────────────────── */}
        {roles.isInfluencer && (
        <Card elevation="sm" padding="md">
          <div className="flex items-center gap-2 mb-3">
            <Users2 size={16} className="text-grubano-primary" />
            <h2 className="text-sm font-bold">{t('audienceTitle')}</h2>
          </div>

          {/* Referral code */}
          {creator.referralCode ? (
            <>
              <p className="text-[10px] text-grubano-ink-muted uppercase tracking-wide font-semibold mb-1.5">
                {t('audienceCode')}
              </p>
              <div className="flex items-center gap-2 mb-2">
                <code className="flex-1 rounded-grubano-lg bg-grubano-bg px-3 py-1.5 text-sm font-mono font-bold tracking-widest text-grubano-primary truncate">
                  {creator.referralCode}
                </code>
                <button
                  onClick={() => copyCode(creator.referralCode!)}
                  className="flex items-center gap-1 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-2.5 py-1.5 text-xs font-semibold hover:bg-grubano-bg transition shrink-0"
                >
                  {copied ? <Check size={12} className="text-grubano-success" /> : <Copy size={12} />}
                  {copied ? t('audienceCopied') : t('audienceCopy')}
                </button>
              </div>
              {referralLink && (
                <div className="flex items-center gap-1.5 mb-3">
                  <Link2 size={11} className="text-grubano-ink-faint shrink-0" />
                  <p className="text-[10px] text-grubano-ink-faint truncate">{referralLink}</p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-grubano-lg bg-grubano-bg px-3 py-2 mb-3 text-center">
              <p className="text-xs font-semibold text-grubano-ink-muted">{t('audienceNoCode')}</p>
              <p className="text-[10px] text-grubano-ink-faint mt-0.5">{t('audienceNoCodeDesc')}</p>
            </div>
          )}

          {/* Referral stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {([
              { icon: Users2,       label: t('audienceCustomers'), value: audience.referralsCount },
              { icon: ShoppingBag,  label: t('audienceOrders'),    value: audience.ordersCount    },
              { icon: Wallet,       label: t('audienceEarnings'),  value: `€${fmt(audience.earningsTotal)}` },
            ] as const).map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-grubano-lg bg-grubano-bg px-2 py-2 text-center">
                <p className="text-sm font-bold">{value}</p>
                <p className="text-[9px] text-grubano-ink-muted leading-tight mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Rates */}
          {rates && (
            <p className="text-[10px] text-grubano-ink-faint text-center">
              {t('audienceRates', {
                pct:  Math.round(rates.commissionPct * 100),
                days: rates.durationDays,
                disc: Math.round(rates.customerDiscountPct * 100),
              })}
            </p>
          )}

          {/* Social networks */}
          {(creator.instagram || creator.tiktok || creator.youtube) && (
            <div className="mt-3 pt-3 border-t border-grubano-border">
              <p className="text-[10px] text-grubano-ink-muted uppercase tracking-wide font-semibold mb-1.5">
                {t('audienceSocials')}
              </p>
              {creator.followers > 0 && (
                <p className="text-xs font-bold mb-1">
                  {t('audienceFollowers', { count: creator.followers.toLocaleString('fr-FR') })}
                </p>
              )}
              {[
                { label: 'Instagram', icon: Instagram, handle: creator.instagram },
                { label: 'TikTok',    icon: Link2,     handle: creator.tiktok    },
                { label: 'YouTube',   icon: Link2,     handle: creator.youtube   },
              ].filter(s => s.handle).map(({ label, icon: Icon, handle }) => (
                <div key={label} className="flex items-center gap-1.5 py-1 border-b border-grubano-border last:border-0">
                  <Icon size={12} className="text-grubano-ink-muted shrink-0" />
                  <span className="text-[11px] text-grubano-ink-muted">{label}</span>
                  <span className="text-[11px] font-semibold ml-auto truncate max-w-[60%]">{handle}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — PERFORMANCE CHART
      ══════════════════════════════════════════════════════════════════════ */}
      <Card elevation="sm" padding="md">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-sm font-bold">{t('perfTitle')}</h2>
            <p className="text-[11px] text-grubano-ink-muted">{t('perfSubtitle')}</p>
          </div>
          {roles.isInfluencer && audience.earningsThisMonth > 0 && (
            <Badge tone="success" size="sm">€{fmt(audience.earningsThisMonth)}</Badge>
          )}
        </div>

        <div className="mt-3">
          <CreatorEarningsChart
            data={roleChartData}
            recipeEarnings30d={roles.isChef ? recipeEarnings30d : 0}
            referralEarnings30d={roles.isInfluencer ? referralEarnings30d : 0}
            recipeRatePct={Math.round((data?.adoptionCommissionPct ?? 0.02) * 100)}
          />
        </div>

        {/* Top dishes by net earnings */}
        {dishes.filter(d => (d.earningsNet ?? d.earnings) > 0).length > 0 && (
          <div className="mt-4 pt-3 border-t border-grubano-border">
            <p className="text-[10px] text-grubano-ink-muted uppercase tracking-wide font-semibold mb-2">
              {t('perfTopDishes')}
            </p>
            <div className="space-y-1.5">
              {dishes
                .filter(d => (d.earningsNet ?? d.earnings) > 0)
                .sort((a, b) => (b.earningsNet ?? b.earnings) - (a.earningsNet ?? a.earnings))
                .slice(0, 3)
                .map((dish, i) => {
                  const topNet = dishes
                    .map(d => d.earningsNet ?? d.earnings)
                    .reduce((m, v) => Math.max(m, v), 0)
                  const netVal = dish.earningsNet ?? dish.earnings
                  return (
                    <div key={dish.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-grubano-ink-faint w-3">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-xs font-medium truncate">{dish.name}</p>
                          <p
                            className="text-xs font-bold text-grubano-success ml-2 shrink-0"
                            title={`Généré €${fmt(dish.earnings)} · Commission −€${fmt(dish.grubanoFee ?? 0)} · Net €${fmt(netVal)}`}
                          >
                            €{fmt(netVal)}
                          </p>
                        </div>
                        <div
                          className="h-1 rounded-full bg-grubano-tint overflow-hidden"
                          title={`Net €${fmt(netVal)} · Généré €${fmt(dish.earnings)}`}
                        >
                          <div
                            className="h-full bg-grubano-primary rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(100, (netVal / (topNet || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {dishes.every(d => d.earnings === 0) && audience.earningsTotal === 0 && (
          <p className="text-xs text-grubano-ink-faint text-center mt-4">{t('perfNoData')}</p>
        )}
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5 — REVENUE HISTORY LINK
      ══════════════════════════════════════════════════════════════════════ */}
      <Link href="/creators/dashboard/revenus">
        <Card
          elevation="flat"
          padding="md"
          interactive
          className="flex items-center justify-between group hover:border-grubano-primary/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-grubano-lg bg-grubano-bg flex items-center justify-center shrink-0">
              <TrendingUp size={18} className="text-grubano-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{t('historyTitle')}</p>
              <p className="text-xs text-grubano-ink-muted">{t('historyLink')}</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-grubano-ink-muted group-hover:text-grubano-primary transition-colors" />
        </Card>
      </Link>

      {/* ════════════════════════════════════════════════════════════════════
          MISSION 2 — ROLE TOGGLES (self-service, sober)
      ════════════════════════════════════════════════════════════════════ */}
      <Card elevation="sm" padding="md">
        <h2 className="text-sm font-bold mb-1">{t('rolesTitle')}</h2>
        <p className="text-[11px] text-grubano-ink-muted mb-3">{t('rolesHint')}</p>
        <div className="space-y-2">
          {([
            { key: 'isChef' as const,       label: t('roleChefLabel') },
            { key: 'isInfluencer' as const, label: t('roleInfluencerLabel') },
          ]).map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-grubano-ink">{r.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={roles[r.key]}
                disabled={roleSaving}
                onClick={() => saveRoles(r.key, !roles[r.key])}
                className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${
                  roles[r.key] ? 'bg-grubano-primary' : 'bg-grubano-surface-muted border border-grubano-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    roles[r.key] ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
        {roleError && (
          <p className="mt-2 rounded-grubano-md bg-grubano-danger-tint px-2.5 py-1.5 text-[11px] text-grubano-danger">
            {roleError}
          </p>
        )}
      </Card>

    </div>
  )
}
