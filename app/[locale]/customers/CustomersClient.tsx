'use client'

/**
 * <CustomersClient/> — interactive island for the operator CLIENTS screen (CD v1).
 *
 * Receives the REAL LoyaltyCustomer rows + the real member count as props from the server
 * component (page.tsx). Renders the CD content: page head + search, stat-strip, tier filters,
 * « Meilleurs clients » table, and the « Fiche client » side panel.
 *
 * 🔒 REAL DATA ONLY. Rows are the true records (name, email, integer pointsBalance, tier). The
 * tier-filter counts are the real distribution of the loaded rows. Search filters the same rows.
 *
 * ⚠️ HONEST DE-MOCK — nothing fabricated is shown as real:
 *   • stat-strip: only « Membres fidélité » is a real aggregate (the member count). The other
 *     tiles (nouveaux ce mois, panier moyen…) have NO backend → honest « — · bientôt ».
 *   • table: only real columns (Client, Palier, Points). The CD's Commandes / Total dépensé (LTV)
 *     / Dernière visite are NOT computed from LoyaltyCustomer → dropped (no fake per-row figures).
 *   • detail panel: real name/email/phone/tier/points/since. LTV, orders, average basket and the
 *     recent history have no source → honest « bientôt » placeholders. Points are loyalty points,
 *     NOT money (no formatEuros here — there is no amount on this screen).
 */

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'

export type CustomerRow = {
  id: string
  name: string
  email: string
  phone: string | null
  pointsBalance: number
  tier: string
  createdAt: string // ISO
}

// DB tier value → CD css class (the CD's top tier class is "platinum"; our DB uses "platine").
const TIER_CLASS: Record<string, string> = {
  bronze: 'bronze',
  silver: 'silver',
  gold: 'gold',
  platine: 'platinum',
  platinum: 'platinum',
}
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platine'] as const

// Cosmetic avatar gradient per tier (presentation only — not data).
const TIER_GRADIENT: Record<string, string> = {
  bronze: 'linear-gradient(135deg,#D5372A,#A8281D)',
  silver: 'linear-gradient(135deg,#E8A63D,#B9740A)',
  gold: 'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  platine: 'linear-gradient(135deg,#FF8A3D,#F2570E)',
  platinum: 'linear-gradient(135deg,#FF8A3D,#F2570E)',
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

export default function CustomersClient({ customers, total }: { customers: CustomerRow[]; total: number }) {
  const t = useTranslations('operator')
  const locale = useLocale()

  const [query, setQuery] = useState('')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [selected, setSelected] = useState<CustomerRow | null>(null)

  const tierClass = (tier: string) => TIER_CLASS[tier] ?? 'bronze'
  const tierLabel = (tier: string) => {
    const cls = tierClass(tier)
    return t(`customers.tier.${cls}`)
  }
  const nfmt = useMemo(
    () => (n: number) => n.toLocaleString(locale),
    [locale],
  )

  // « Client depuis <mois année> » from the real createdAt.
  const sinceLabel = (iso: string) => {
    try {
      const d = new Date(iso)
      const m = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d)
      return t('customers.since', { date: m })
    } catch {
      return ''
    }
  }

  // Real tier distribution of the loaded rows (honest counts for the filter chips).
  const tierCounts = useMemo(() => {
    const c: Record<string, number> = { all: customers.length }
    for (const k of TIER_ORDER) c[k] = 0
    for (const row of customers) {
      const key = TIER_CLASS[row.tier] === 'platinum' ? 'platine' : row.tier
      if (c[key] == null) c[key] = 0
      c[key] += 1
    }
    return c
  }, [customers])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter((row) => {
      const tierKey = TIER_CLASS[row.tier] === 'platinum' ? 'platine' : row.tier
      if (tierFilter !== 'all' && tierKey !== tierFilter) return false
      if (!q) return true
      return row.name.toLowerCase().includes(q) || row.email.toLowerCase().includes(q)
    })
  }, [customers, query, tierFilter])

  // ── empty (no loyalty customer at all) ──
  if (total === 0) {
    return (
      <section className="op-cl-screen">
        <div className="op-dash__head">
          <div><h1 className="op-dash__title">{t('customers.title')}</h1></div>
        </div>
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">group</span>
          <b>{t('customers.emptyTitle')}</b>
          <span>{t('customers.emptyBody')}</span>
        </div></div>
      </section>
    )
  }

  return (
    <section className="op-cl-screen">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('customers.title')}</h1>
          <p className="op-dash__sub">{t('customers.subtitle')}</p>
        </div>
        <div className="op-search">
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

      {/* ══ stat-strip — only « Membres fidélité » is real; the rest are honest « bientôt » ══ */}
      <div className="op-card stat-strip">
        <div className="stat">
          <span className="lbl">{t('customers.statMembers')}</span>
          <b className="mono">{nfmt(total)}</b>
        </div>
        <div className="stat is-soon">
          <span className="lbl">{t('customers.statNew')}</span>
          <b className="mono soon">—</b>
          <span className="tag-soon">{t('soon')}</span>
        </div>
        <div className="stat is-soon">
          <span className="lbl">{t('customers.statActive')}</span>
          <b className="mono soon">—</b>
          <span className="tag-soon">{t('soon')}</span>
        </div>
        <div className="stat is-soon">
          <span className="lbl">{t('customers.statAvg')}</span>
          <b className="mono soon">—</b>
          <span className="tag-soon">{t('soon')}</span>
        </div>
      </div>

      {/* ══ tier filters — counts are the REAL distribution of the loaded rows ══ */}
      <div className="tier-filters">
        <button
          type="button"
          className={tierFilter === 'all' ? 'is-active' : undefined}
          onClick={() => setTierFilter('all')}
        >
          {t('customers.filterAll')} <span className="cnt mono">{nfmt(tierCounts.all)}</span>
        </button>
        {TIER_ORDER.map((k) => (
          <button
            type="button"
            key={k}
            className={tierFilter === k ? 'is-active' : undefined}
            onClick={() => setTierFilter(k)}
          >
            <span className={`tier-chip ${TIER_CLASS[k]}`}><i className="dot" />{t(`customers.tier.${TIER_CLASS[k]}`)}</span>
            <span className="cnt mono">{nfmt(tierCounts[k] ?? 0)}</span>
          </button>
        ))}
      </div>

      {/* ══ « Meilleurs clients » — REAL rows, real columns only ══ */}
      <div className="op-card">
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">workspace_premium</span>{t('customers.tableTitle')}</h2></div>
        <div className="cl-table">
          <div className="cl-head-row">
            <span>{t('customers.colClient')}</span>
            <span>{t('customers.colTier')}</span>
            <span style={{ textAlign: 'end' }}>{t('customers.colPoints')}</span>
            <span />
          </div>

          {visible.length === 0 ? (
            <div className="op-emptyline" style={{ padding: '48px 20px' }}>
              <span className="ms" aria-hidden="true">search_off</span>
              <b>{t('customers.noMatchTitle')}</b>
              <span>{t('customers.noMatchBody')}</span>
            </div>
          ) : (
            visible.map((row) => (
              <div
                key={row.id}
                className="cl-row"
                role="button"
                tabIndex={0}
                onClick={() => setSelected(row)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(row) } }}
              >
                <div className="cl-name">
                  <span className="cl-av" style={{ background: TIER_GRADIENT[row.tier] ?? TIER_GRADIENT.bronze }}>{initials(row.name)}</span>
                  <div className="m"><b>{row.name}</b><span>{sinceLabel(row.createdAt)}</span></div>
                </div>
                <span><span className={`tier-chip ${tierClass(row.tier)}`}><i className="dot" />{tierLabel(row.tier)}</span></span>
                <span className="pts mono">{nfmt(row.pointsBalance)}</span>
                <span className="viewbtn">
                  <button type="button" className="icon-btn-sm" title={t('customers.viewProfile')} aria-label={t('customers.viewProfile')} onClick={(e) => { e.stopPropagation(); setSelected(row) }}>
                    <span className="ms" aria-hidden="true">visibility</span>
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ══ « Fiche client » side panel — real fields; LTV/orders/history honest « bientôt » ══ */}
      <div
        className={`op-modal-backdrop${selected ? ' open' : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
      >
        {selected && (
          <div className="op-panel" role="dialog" aria-modal="true" aria-label={t('customers.panelTitle')}>
            <div className="op-panel__head">
              <h3>{t('customers.panelTitle')}</h3>
              <button type="button" className="op-modal__close" onClick={() => setSelected(null)} aria-label={t('customers.close')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-panel__body">
              <div className="detail-hero">
                <span className="cl-av" style={{ background: TIER_GRADIENT[selected.tier] ?? TIER_GRADIENT.bronze }}>{initials(selected.name)}</span>
                <div className="m"><b>{selected.name}</b><span>{sinceLabel(selected.createdAt)}</span></div>
              </div>
              <div>
                <span className={`tier-chip ${tierClass(selected.tier)}`}><i className="dot" />{tierLabel(selected.tier)}</span>
              </div>

              {/* Real metric = points balance. LTV / orders / average basket have no source → « bientôt ». */}
              <div className="detail-grid">
                <div className="detail-box">
                  <span className="lbl">{t('customers.dtPoints')}</span>
                  <span className="detail-val mono" style={{ color: 'var(--op-zest-600)' }}>{nfmt(selected.pointsBalance)}</span>
                </div>
                <div className="detail-box is-soon">
                  <span className="lbl">{t('customers.dtLtv')}</span>
                  <span className="detail-val mono soon">—</span>
                  <span className="tag-soon">{t('soon')}</span>
                </div>
                <div className="detail-box is-soon">
                  <span className="lbl">{t('customers.dtOrders')}</span>
                  <span className="detail-val mono soon">—</span>
                  <span className="tag-soon">{t('soon')}</span>
                </div>
                <div className="detail-box is-soon">
                  <span className="lbl">{t('customers.dtAvg')}</span>
                  <span className="detail-val mono soon">—</span>
                  <span className="tag-soon">{t('soon')}</span>
                </div>
              </div>

              <div className="op-callout">
                <span className="ms" aria-hidden="true">info</span>
                <p>{t('customers.serverNote')}</p>
              </div>

              <div>
                <p className="detail-section-title">{t('customers.contactTitle')}</p>
                <div className="detail-contact" style={{ marginTop: 10 }}>
                  {selected.phone
                    ? <div className="row"><span className="ms" aria-hidden="true">call</span><span className="mono">{selected.phone}</span></div>
                    : <div className="row row--muted"><span className="ms" aria-hidden="true">call</span><span>{t('customers.noPhone')}</span></div>}
                  <div className="row"><span className="ms" aria-hidden="true">mail</span><span>{selected.email}</span></div>
                </div>
              </div>

              {/* Order / reservation / reward history has no per-client feed here → honest « bientôt ». */}
              <div>
                <p className="detail-section-title">{t('customers.historyTitle')}</p>
                <div className="detail-soon" style={{ marginTop: 10 }}>
                  <span className="ms" aria-hidden="true">history</span>
                  <div className="m"><b>{t('customers.historySoonTitle')}</b><span>{t('customers.historySoonBody')}</span></div>
                  <span className="op-pill soon"><i className="dot" />{t('soon')}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
