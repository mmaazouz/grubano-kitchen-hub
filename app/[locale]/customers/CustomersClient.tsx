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

export type CustomerRow = {
  id: string
  name: string            // MASKED — "Mohammed M."
  tier: string
  pointsBalance: number
  createdAt: string       // ISO
  ordersCount: number
  avgBasketCents: number
  lastOrderAt: string | null
}

// DB tier value → CD css class (top tier = "plat").
const TIER_CLASS: Record<string, string> = {
  bronze: 'bronze', silver: 'silver', gold: 'gold', platine: 'plat', platinum: 'plat',
}
const TIER_GRADIENT: Record<string, string> = {
  bronze: 'linear-gradient(135deg,#B9740A,#8A5600)',
  silver: 'linear-gradient(135deg,#8992A3,#5B6472)',
  gold:   'linear-gradient(135deg,#FF8A3D,#F2570E)',
  platine:'linear-gradient(135deg,#0E9F6E,#0A6E4A)',
  platinum:'linear-gradient(135deg,#0E9F6E,#0A6E4A)',
}

function initials(name: string): string {
  return (
    name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  )
}

export default function CustomersClient({ customers, total }: { customers: CustomerRow[]; total: number }) {
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
          <p>{t('customers.subtitleProtected')}</p>
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

      <div className="card">
        <div className="lthead">
          <span>{t('customers.colClient')}</span>
          <span>{t('customers.colOrders')}</span>
          <span>{t('customers.colAvg')}</span>
          <span>{t('customers.colTier')}</span>
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
                <span className="lc__av" style={{ background: TIER_GRADIENT[row.tier] ?? TIER_GRADIENT.bronze }}>{initials(row.name)}</span>
                <div className="lc__m"><b>{row.name}</b><span>{sinceLabel(row.createdAt)}</span></div>
              </div>
              <span className="lnum">{row.ordersCount > 0 ? row.ordersCount.toLocaleString(locale) : '—'}</span>
              <span className="lnum">{row.ordersCount > 0 ? eur(row.avgBasketCents) : '—'}</span>
              <div className="ltier">
                <span className={`tier sm ${tierClass(row.tier)}`}>
                  {tierClass(row.tier) === 'gold' ? <span className="ms" aria-hidden="true">workspace_premium</span> : null}
                  {tierLabel(row.tier)}
                </span>
              </div>
              <span className="lmini">
                {row.ordersCount > 0 ? `${row.ordersCount} · ${eur(row.avgBasketCents)} · ` : ''}{tierLabel(row.tier)}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}
