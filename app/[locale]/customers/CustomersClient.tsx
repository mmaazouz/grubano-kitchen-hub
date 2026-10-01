'use client'

/**
 * <CustomersClient/> — operator CLIENTS list (CD « Fiche client » / liste).
 *
 * 🔒 MASKED + CONTACT-FREE. Rows carry a MASKED identity (first name + last
 * initial) and REAL relation aggregates (orders count, average basket) — the props
 * contain NO email, phone or address (stripped server-side in lib/customer-scope).
 * A privacy banner states the coordinates are protected by Grubano. Each row links
 * to the full fiche client at /customers/[id].
 */

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import type { CustomerScreenStats, CustomerTier } from '@/lib/customer-scope'
import CustomerAvatar from './CustomerAvatar'

// Chip order — the CD mock's tier filter row (op-customers .tier-filters).
const TIER_FILTERS: CustomerTier[] = ['bronze', 'silver', 'gold', 'platinum']

export type CustomerRow = {
  id: string
  name: string            // MASKED — "Mohammed M."
  tier: string
  pointsBalance: number
  createdAt: string       // ISO
  ordersCount: number
  totalSpentCents: number
  avgBasketCents: number
  lastOrderAt: string | null
}

// DB tier value → CD css class (top tier = "plat").
const TIER_CLASS: Record<string, string> = {
  bronze: 'bronze', silver: 'silver', gold: 'gold', platine: 'plat', platinum: 'plat',
}

// Initiales par graphèmes + contention adaptative : CustomerAvatar (arbitrage
// Design 2026-08-19) — l'ancienne dérivation par code units vivait ici.

export default function CustomersClient({ customers, total, stats, activeTier }: {
  customers: CustomerRow[]
  total: number
  stats: CustomerScreenStats
  activeTier: CustomerTier | null
}) {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [query, setQuery] = useState('')

  const eur = useMemo(
    () => (cents: number) => (cents / 100).toLocaleString(locale, { style: 'currency', currency: 'EUR' }),
    [locale],
  )
  const sinceLabel = (iso: string) => {
    try {
      const m = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(iso))
      return t('customers.since', { date: m })
    } catch { return '' }
  }
  // CD list shows "Hier" / "3 juil." — relative for today/yesterday, short date beyond.
  const lastVisitLabel = (iso: string | null) => {
    if (!iso) return '—'
    try {
      const d = new Date(iso)
      const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
      if (days === 0 || days === 1) {
        const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day')
        return rel.charAt(0).toUpperCase() + rel.slice(1)
      }
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d)
    } catch { return '—' }
  }
  const tierClass = (tier: string) => TIER_CLASS[tier] ?? 'bronze'
  const tierLabel = (tier: string) => t(`customers.tier.${tierClass(tier) === 'plat' ? 'platinum' : tierClass(tier)}`)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((row) => row.name.toLowerCase().includes(q)) // masked name only
  }, [customers, query])

  if (total === 0) {
    return (
      <section className="cl-root">
        <div className="lhead"><div><h1>{t('customers.title')}</h1></div></div>
        <div className="card"><div className="cl-empty">
          <span className="ms" aria-hidden="true">group</span>
          <b>{t('customers.emptyTitle')}</b>
          <span>{t('customers.emptyBody')}</span>
        </div></div>
      </section>
    )
  }

  return (
    <section className="cl-root">
      <div className="lhead">
        <div>
          <h1>{t('customers.title')}</h1>
          {/* H — the privacy wording lives in the banner ONLY; the subtitle is the
              CD scope label « Programme de fidélité actif ». */}
          <p>{t('customers.subtitle')}</p>
        </div>
        <div className="lsearch">
          <span className="ms" aria-hidden="true">search</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('customers.searchPlaceholder')}
            aria-label={t('customers.searchPlaceholder')}
          />
        </div>
      </div>

      {/* Privacy reassurance — coordinates protected by Grubano. */}
      <div className="privacy">
        <span className="ms" aria-hidden="true">verified_user</span>
        <div><b>{t('customers.privacyListTitle')}</b> {t('customers.privacyListBody')}</div>
      </div>

      {/* B — the 4 KPIs (CD stat-strip). Server-computed over EXACTLY the list's
          scope; « Nouveaux ce mois » = first in-scope order this calendar month. */}
      <div className="card stat-strip">
        <div className="stat"><span className="lbl">{t('customers.statTotal')}</span><b>{stats.totalCustomers.toLocaleString(locale)}</b></div>
        <div className="stat"><span className="lbl">{t('customers.statNew')}</span><b>{stats.newThisMonth.toLocaleString(locale)}</b></div>
        <div className="stat"><span className="lbl">{t('customers.statMembers')}</span><b>{stats.loyaltyMembers.toLocaleString(locale)}</b></div>
        <div className="stat"><span className="lbl">{t('customers.statAvg')}</span><b>{eur(stats.avgBasketCents)}</b></div>
      </div>

      {/* C — tier filters. Counters cover the FULL fenced population (server
          groupBy), and each chip NAVIGATES (?tier=…) → a real server re-query,
          never a client-side cut of the 20 visible rows. */}
      <div className="tier-filters">
        <Link href={{ pathname: '/customers' }} className={activeTier === null ? 'chip is-active' : 'chip'}>
          {t('customers.filterAll')} <span className="cnt">{stats.loyaltyMembers.toLocaleString(locale)}</span>
        </Link>
        {TIER_FILTERS.map((tf) => (
          <Link
            key={tf}
            href={{ pathname: '/customers', query: { tier: tf } }}
            className={activeTier === tf ? 'chip is-active' : 'chip'}
          >
            <span className={`tier sm ${tierClass(tf)}`}><i className="dot" aria-hidden="true" />{tierLabel(tf)}</span>
            <span className="cnt">{(stats.tierCounts[tf] ?? 0).toLocaleString(locale)}</span>
          </Link>
        ))}
      </div>

      <div className="card">
        {/* D — scope label: a list of top-N must say what it is (CD op-card__head). */}
        <div className="card__head">
          <h2><span className="ms" aria-hidden="true">workspace_premium</span>{t('customers.listTitle')}</h2>
        </div>
        {/* CD list order (op-customers): Client · Palier · Commandes · Total dépensé · Points · Dernière visite · fiche */}
        <div className="lthead">
          <span>{t('customers.colClient')}</span>
          <span>{t('customers.colTier')}</span>
          <span>{t('customers.colOrders')}</span>
          <span>{t('customers.colTotal')}</span>
          <span>{t('customers.colPoints')}</span>
          <span>{t('customers.colLastVisit')}</span>
          <span aria-hidden="true" />
        </div>

        {visible.length === 0 ? (
          <div className="cl-empty" style={{ padding: '48px 20px' }}>
            <span className="ms" aria-hidden="true">search_off</span>
            <b>{t('customers.noMatchTitle')}</b>
            <span>{t('customers.noMatchBody')}</span>
          </div>
        ) : (
          visible.map((row) => (
            <Link key={row.id} href={`/customers/${row.id}`} className="lrow">
              <div className="lc">
                {/* color per CLIENT, derived from LoyaltyCustomer.id — never the name,
                    never the tier (decision F). Same id → same color list & fiche. */}
                <CustomerAvatar customerId={row.id} name={row.name} variant="list" className="lc__av" />
                <div className="lc__m"><b>{row.name}</b><span>{sinceLabel(row.createdAt)}</span></div>
              </div>
              <div className="ltier">
                <span className={`tier sm ${tierClass(row.tier)}`}>
                  {/* pastille neutre 7×7 en currentColor sur TOUS les paliers (décision
                      CD 20/08) — le glyphe workspace_premium ne sert plus de pictogramme
                      de chip ; il reste le pictogramme du TITRE de carte. */}
                  <i className="dot" aria-hidden="true" />
                  {tierLabel(row.tier)}
                </span>
              </div>
              <span className="lnum">{row.ordersCount > 0 ? row.ordersCount.toLocaleString(locale) : '—'}</span>
              <span className="lnum strong">{row.ordersCount > 0 ? eur(row.totalSpentCents) : '—'}</span>
              {/* neutral mono — the CD mock's orange on points is a DOCUMENTED divergence
                  (orange = "action en cours" in the system, decision CD 18/08) */}
              <span className="lnum">{row.pointsBalance.toLocaleString(locale)}</span>
              <span className="llast">{lastVisitLabel(row.lastOrderAt)}</span>
              <span className="lview" title={t('customers.viewProfile')}>
                <span className="ms" aria-hidden="true">visibility</span>
              </span>
              <span className="lmini">
                {row.ordersCount > 0 ? `${row.ordersCount} · ${eur(row.totalSpentCents)} · ` : ''}{tierLabel(row.tier)}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}
