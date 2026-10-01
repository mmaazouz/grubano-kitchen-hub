'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import OnboardingChat from '@/components/onboarding/OnboardingChat'
import type { CreatorHomeData } from '@/app/api/creators/home/route'
import './creator-dashboard.css'

// ── CR3 · Accueil studio (CreatorShell --op-/--op-cr, CD verbatim) ───────────────────
// Re-skin of the creator studio home. Money is 🔒 READ-ONLY: gains are stored in euros
// and shown AS-IS (never recomputed client-side); the pending/matured balances come from
// the owner-scoped /api/creator/earnings (real CENTS → €). No fabricated deltas (removed —
// no per-KPI period comparison is surfaced). No « prochain versement » date (the payout
// rail is gated OFF → no scheduled payout; the automatic-payout note is kept, honest). No
// invented « recent activity » feed (section omitted). Role-aware (chef vs influencer).

type EarnTotals = {
  pendingCents: number; maturedCents: number; paidCents: number
  cancelledCents: number; thresholdCents: number; progressPct: number
}

const NBSP = ' '
const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${NBSP}€`
const eur2 = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NBSP}€`
const isPublished = (s: string) => s === 'approved' || s === 'live'

export default function CreatorStudioHome() {
  const t = useTranslations('creators.home')

  const [data, setData] = useState<CreatorHomeData | null>(null)
  const [earn, setEarn] = useState<EarnTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('/api/creators/home', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject())),
      fetch('/api/creator/earnings', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([home, earnings]) => {
        if (!alive) return
        setData(home as CreatorHomeData)
        setEarn((earnings?.totals as EarnTotals) ?? null)
      })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: '100%', height: 88, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
          {[0, 1, 2, 3].map(i => <span key={i} className="op-sk" style={{ width: '100%', height: 120, borderRadius: 12 }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  const creator = data.creator

  // ── Not a creator yet ──────────────────────────────────────────────────────────
  if (!creator) {
    return (
      <section><div className="op-card op-empty">
        <span className="ms" aria-hidden="true">palette</span>
        <b>{t('notCreatorTitle')}</b>
        <span>{t('notCreatorDesc')}</span>
        <div style={{ marginTop: 18 }}>
          <Link href="/creators/apply" className="op-btn-primary"><span className="ms" aria-hidden="true">add</span>{t('notCreatorCta')}</Link>
        </div>
      </div></section>
    )
  }

  const roles      = data.roles ?? { isChef: true, isInfluencer: true }
  const bothRoles  = roles.isChef && roles.isInfluencer
  const dishes     = data.dishes ?? []
  const publishedCount = dishes.filter(d => isPublished(d.status)).length
  const audience   = data.audience

  // Role-scoped 30-day gains (mirror the previous dashboard rule: a single active
  // role shows only that pipe's figures). All values REAL, from the server.
  const monthGains  = bothRoles ? data.earningsThisMonth : roles.isChef ? data.recipeEarnings30d : data.referralEarnings30d
  const totalGains  = bothRoles ? creator.totalEarnings : roles.isChef ? data.dishNetTotal : audience.earningsTotal

  const firstName = creator.name.split(' ')[0] || creator.name
  const isEmpty = publishedCount === 0 && totalGains === 0 && data.dishSalesTotal === 0 && audience.ordersCount === 0

  // ── Empty studio ────────────────────────────────────────────────────────────
  if (isEmpty) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('studioTitle')}</h1></div></div>
        <div className="op-card op-empty">
          <span className="ms" aria-hidden="true">palette</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyDesc')}</span>
          {roles.isChef && (
            <div style={{ marginTop: 18 }}>
              <Link href="/creators/dashboard/promotions" className="op-btn-primary"><span className="ms" aria-hidden="true">add</span>{t('emptyCta')}</Link>
            </div>
          )}
        </div>
      </section>
    )
  }

  // KPIs (role-aware, all REAL). No fabricated deltas.
  const kpis = roles.isChef
    ? [
        { ic: 'restaurant_menu', label: t('kpiPublished'),  val: String(publishedCount) },
        { ic: 'storefront',      label: t('kpiAdoptions'),  val: String(data.dishAdoptionsTotal) },
        { ic: 'sell',            label: t('kpiSales'),      val: String(data.dishSalesTotal) },
        { ic: 'payments',        label: t('kpiGains30'),    val: eur(monthGains), ro: true },
      ]
    : [
        { ic: 'group',           label: t('kpiReferrals'),  val: String(audience.referralsCount) },
        { ic: 'shopping_bag',    label: t('kpiOrders'),     val: String(audience.ordersCount) },
        { ic: 'link',            label: t('kpiCumulative'), val: eur(audience.earningsTotal) },
        { ic: 'payments',        label: t('kpiGains30'),    val: eur(monthGains), ro: true },
      ]

  const popular = [...dishes].sort((a, b) => b.totalSales - a.totalSales).slice(0, 4)

  const dishBadge = (s: string) =>
    isPublished(s) ? { cls: 'pub', label: t('statusPublished') }
      : s === 'pending' ? { cls: 'pending', label: t('statusPending') }
      : { cls: 'draft', label: t('statusDraft') }

  // Real activation checklist signals (owner-scoped data we already hold).
  const hasProfile = !!(creator.instagram || creator.tiktok || creator.youtube || creator.followers > 0)
  const hasCode    = !!creator.referralCode

  return (
    <section>
      {/* Self-gating onboarding islands (render null when their flags are OFF → byte-identical in prod). */}
      <OnboardingGuide role="creator" />
      <OnboardingChat role="creator" />

      {/* Welcome banner */}
      <div className="op-card cr-welcome">
        <span className="cr-welcome__av">{(firstName[0] ?? 'C').toUpperCase()}</span>
        <div className="cr-welcome__m">
          <h1>{t('greeting', { name: firstName })}</h1>
          <p>{t('welcomeSub')}</p>
        </div>
        {creator.verified && (
          <span className="cr-welcome__badge"><span className="ms" aria-hidden="true">verified</span>{t('verifiedBadge')}</span>
        )}
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        {kpis.map(k => (
          <div key={k.label} className="op-card kpi">
            <div className="kpi__top"><span className="kpi__ic"><span className="ms" aria-hidden="true">{k.ic}</span></span><span className="kpi__label">{k.label}</span></div>
            <div className="kpi__val">{k.val}</div>
            {k.ro && <div className="kpi__ro"><span className="ms" aria-hidden="true">lock</span>{t('readonlyGrubano')}</div>}
          </div>
        ))}
      </div>

      <div className="ov-cols">
        {/* Left — recipes (chef) OR audience (influencer-only) */}
        {roles.isChef ? (
          <div className="op-card ov-card">
            <div className="ov-card__hd">
              <h3>{t('recipesTitle')}</h3>
              <Link href="/creators/dashboard/promotions">{t('recipesAll')}<span className="ms flip-rtl" aria-hidden="true">chevron_right</span></Link>
            </div>
            <div className="hint">{t('recipesHint')}</div>
            {popular.map(d => {
              const b = dishBadge(d.status)
              return (
                <div key={d.id} className="rc-row">
                  <span className="rc-thumb"><span className="ms" aria-hidden="true">restaurant_menu</span></span>
                  <div className="rc-m">
                    <b>{d.name}</b>
                    <div className="meta">
                      {d.adoptions > 0 && <span><span className="ms" aria-hidden="true">storefront</span>{t('recipeAdoptions', { count: d.adoptions })}</span>}
                      <span className={`rc-badge ${b.cls}`}>{b.label}</span>
                    </div>
                  </div>
                  <div className="rc-stat">
                    <b>{d.totalSales > 0 ? d.totalSales : '—'}</b>
                    <span>{d.totalSales > 0 ? t('recipeSalesLabel') : isPublished(d.status) ? t('recipeNoSale') : t('recipeUnpublished')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="op-card ov-card">
            <div className="ov-card__hd">
              <h3>{t('audienceTitle')}</h3>
              <Link href="/creators/dashboard/affiliate">{t('audienceManage')}<span className="ms flip-rtl" aria-hidden="true">chevron_right</span></Link>
            </div>
            <div className="hint">{t('audienceHint')}</div>
            <div className="earn__rows" style={{ padding: 0 }}>
              <div className="earn__r"><span className="k">{t('kpiReferrals')}</span><span className="v">{audience.referralsCount}</span></div>
              <div className="earn__r"><span className="k">{t('kpiOrders')}</span><span className="v">{audience.ordersCount}</span></div>
              <div className="earn__r"><span className="k">{t('audienceEarnings')}</span><span className="v">{eur2(audience.earningsTotal)}</span></div>
            </div>
          </div>
        )}

        {/* Right — earnings snapshot (read-only 🔒) */}
        <div className="op-card earn">
          <div className="earn__hd"><h3>{t('earnTitle')}</h3><span className="earn__ro"><span className="ms" aria-hidden="true">lock</span>{t('readonly')}</span></div>
          <div className="earn__big"><div className="v">{eur2(monthGains)}</div><div className="l">{t('earnBigLabel')}</div></div>
          <div className="earn__rows">
            {earn && <div className="earn__r"><span className="k">{t('earnPending')}</span><span className="v">{eur2(earn.pendingCents / 100)}</span></div>}
            {earn && <div className="earn__r"><span className="k">{t('earnMatured')}</span><span className="v">{eur2(earn.maturedCents / 100)}</span></div>}
            <div className="earn__r"><span className="k">{t('earnTotal')}</span><span className="v">{eur2(totalGains)}</span></div>
          </div>
          <div className="earn__note"><span className="ms" aria-hidden="true">info</span><span>{t('earnNote')}</span></div>
        </div>
      </div>

      {/* Activation checklist (real statuses) */}
      <div className="op-card ov-card">
        <div className="ov-card__hd"><h3>{t('chkTitle')}</h3></div>
        <div className="hint">{t('chkHint')}</div>
        <div className="chk-list">
          <div className={`chk${hasProfile ? ' done' : ''}`}>
            <span className="chk__box"><span className="ms" aria-hidden="true">check</span></span>
            <div className="chk__m"><b>{t('chkProfile')}</b><span>{t('chkProfileSub')}</span></div>
            {!hasProfile && <Link href="/creators/dashboard/parametres" className="chk__go">{t('chkOpen')}</Link>}
          </div>
          <div className={`chk${publishedCount > 0 ? ' done' : ''}`}>
            <span className="chk__box"><span className="ms" aria-hidden="true">check</span></span>
            <div className="chk__m"><b>{t('chkRecipe')}</b><span>{publishedCount > 0 ? t('chkRecipeDone', { count: publishedCount }) : t('chkRecipeSub')}</span></div>
            {publishedCount === 0 && roles.isChef && <Link href="/creators/dashboard/promotions" className="chk__go">{t('chkOpen')}</Link>}
          </div>
          {roles.isInfluencer && (
            <div className={`chk${hasCode ? ' done' : ''}`}>
              <span className="chk__box"><span className="ms" aria-hidden="true">check</span></span>
              <div className="chk__m"><b>{t('chkLink')}</b><span>{t('chkLinkSub')}</span></div>
              <Link href="/creators/dashboard/affiliate" className="chk__go">{t('chkOpen')}</Link>
            </div>
          )}
          {/* Payouts step — the payout rail is gated OFF → not actionable yet (no fake CTA). */}
          <div className="chk">
            <span className="chk__box"><span className="ms" aria-hidden="true">check</span></span>
            <div className="chk__m"><b>{t('chkPayout')}</b><span>{t('chkPayoutSub')}</span></div>
            <span className="chk__soon">{t('soon')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
