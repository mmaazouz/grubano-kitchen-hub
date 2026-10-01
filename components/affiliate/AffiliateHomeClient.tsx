'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'

// ── AffiliateHomeClient — the affiliate home (CD AF1). ────────────────────────────
// READ-ONLY / DISPLAY-ONLY: fetches /api/affiliate/stats (owner-scoped, flag-gated
// server-side) and renders the welcome + link bar + KPIs + active links + earnings
// snapshot 🔒 + checklist + recent activity. MONEY doctrine (posture CR6): every € is a
// REAL server aggregate (cents/100) formatted locally — NEVER recomputed, NEVER fabricated.
// The click funnel (clics/commandes/taux) depends on ReferralClick tracking (gated by
// AFFILIATE_ENABLED) → rendered as an inert « bientôt »/« — », NEVER a misleading « 0 ».
// No fabricated « prochain versement » date. Identity/link come from the server (props).

type Order = { id: string; date: string; restaurant: string | null; status: string }
type Stats = {
  earnings: { maturedCents: number; pendingCents: number }
  balance:  { availableCents: number; paidCents: number }
  referrals: { newCustomers: number; orders: Order[] }
}

export default function AffiliateHomeClient({
  name,
  initials,
  statusActive,
  link,
}: {
  name: string
  initials: string
  statusActive: boolean
  link: string
}) {
  const t = useTranslations('affiliate.home')
  const locale = useLocale()
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/affiliate/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) setStats(d) })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // Real € — server cents/100, formatted for the active locale (never recomputed).
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
  const shortDate = (iso: string) => {
    try { return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(new Date(iso)) } catch { return '' }
  }
  const firstName = (name.trim().split(/\s+/)[0]) || name

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ }
  }
  const shareLink = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ url: link }); return } catch { /* fall through to copy */ }
    }
    void copyLink()
  }

  // ── loading skeleton ──
  if (loading) {
    return (
      <section>
        <span className="op-sk" style={{ width: '100%', height: 88, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 66, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 120, borderRadius: 12 }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── error ──
  if (error || !stats) {
    return (
      <div className="op-center">
        <div className="op-error__card">
          <span className="ms">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorSub')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}><span className="ms">refresh</span>{t('retry')}</button>
        </div>
      </div>
    )
  }

  const { maturedCents, pendingCents } = stats.earnings
  const { availableCents, paidCents }  = stats.balance
  const totalCents  = maturedCents + pendingCents + paidCents
  const orders      = stats.referrals.orders ?? []
  const hasActivity = orders.length > 0 || stats.referrals.newCustomers > 0
  const isEmpty     = maturedCents === 0 && pendingCents === 0 && availableCents === 0 && orders.length === 0

  // ── empty « welcome » state (brand-new affiliate, no activity yet) ──
  if (isEmpty) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('pageTitle')}</h1></div></div>
        <div className="op-card op-empty">
          <span className="ms">link</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptySub')}</span>
          <button className="op-btn-primary" style={{ marginTop: 18 }} onClick={copyLink}>
            <span className="ms">content_copy</span>{copied ? t('copied') : t('emptyCopy')}
          </button>
        </div>
      </section>
    )
  }

  // ── loaded ──
  const gatedKpis = [
    { key: 'clicks', icon: 'ads_click',    label: t('kpiClicks') },
    { key: 'orders', icon: 'shopping_bag', label: t('kpiOrders') },
    { key: 'conv',   icon: 'percent',      label: t('kpiConversion') },
  ]

  return (
    <section>
      {/* welcome */}
      <div className="op-card af-welcome">
        <span className="af-welcome__av">{initials}</span>
        <div className="af-welcome__m">
          <h1>{t('welcomeTitle', { name: firstName })}</h1>
          <p>{t('welcomeSub')}</p>
        </div>
        {statusActive && <span className="af-welcome__badge"><span className="ms">verified</span>{t('statusActive')}</span>}
      </div>

      {/* link quick-copy */}
      <div className="op-card af-linkbar">
        <span className="ic"><span className="ms">link</span></span>
        <div className="af-linkbar__m">
          <span>{t('linkLabel')}</span>
          <b>{link}</b>
        </div>
        <button className="af-copy" onClick={copyLink}>
          <span className="ms">{copied ? 'check' : 'content_copy'}</span>{copied ? t('copied') : t('copy')}
        </button>
        <button className="op-btn-ghost" onClick={shareLink}><span className="ms">share</span>{t('share')}</button>
      </div>

      {/* KPIs — funnel gated (« bientôt »), gains real */}
      <div className="kpi-grid">
        {gatedKpis.map((k) => (
          <div key={k.key} className="op-card kpi">
            <div className="kpi__top"><span className="kpi__ic"><span className="ms">{k.icon}</span></span><span className="kpi__label">{k.label}</span></div>
            <div className="kpi__val is-soon">—</div>
            <div className="kpi__soon"><span className="ms" style={{ fontSize: 12 }}>schedule</span>{t('soon')}</div>
          </div>
        ))}
        <div className="op-card kpi">
          <div className="kpi__top"><span className="kpi__ic"><span className="ms">payments</span></span><span className="kpi__label">{t('kpiEarnings')}</span></div>
          <div className="kpi__val">{money(maturedCents)}</div>
          <div className="kpi__ro"><span className="ms">lock</span>{t('readOnly')}</div>
        </div>
      </div>

      {/* active links (volumes only) + earnings snapshot 🔒 */}
      <div className="ov-cols">
        <div className="op-card ov-card">
          <div className="ov-card__hd">
            <h3>{t('activeLinksTitle')}</h3>
            <Link href="/affiliate/dashboard/liens">{t('seeAll')}<span className="ms flip-rtl">chevron_right</span></Link>
          </div>
          <div className="hint">{t('activeLinksHint')}</div>
          <div className="lk-row">
            <span className="lk-ic"><span className="ms">link</span></span>
            <div className="lk-m"><b>{t('mainLink')}</b><span>{link}</span></div>
            <div className="lk-stat"><b>—</b><span>{t('clicksUnit')}</span></div>
          </div>
        </div>

        <div className="op-card earn">
          <div className="earn__hd"><h3>{t('earnTitle')}</h3><span className="earn__ro"><span className="ms">lock</span>{t('earnReadOnly')}</span></div>
          <div className="earn__big"><div className="v">{money(maturedCents)}</div><div className="l">{t('earnBigLabel')}</div></div>
          <div className="earn__rows">
            <div className="earn__r"><span className="k">{t('earnAvailable')}</span><span className="v">{money(availableCents)}</span></div>
            <div className="earn__r"><span className="k">{t('earnTotal')}</span><span className="v">{money(totalCents)}</span></div>
          </div>
          <div className="earn__note"><span className="ms">info</span><span>{t('earnNote')}</span></div>
        </div>
      </div>

      {/* checklist + recent activity (activity omitted when empty) */}
      <div className="ov-cols">
        <div className="op-card ov-card">
          <div className="ov-card__hd"><h3>{t('checklistTitle')}</h3></div>
          <div className="hint">{t('checklistHint')}</div>
          <div className="chk-list">
            <div className="chk done">
              <span className="chk__box"><span className="ms">check</span></span>
              <div className="chk__m"><b>{t('chkActivate')}</b><span>{t('chkActivateDone')}</span></div>
            </div>
            <div className={`chk${hasActivity ? ' done' : ''}`}>
              <span className="chk__box"><span className="ms">check</span></span>
              <div className="chk__m"><b>{t('chkShare')}</b><span>{hasActivity ? t('chkShareDone') : t('chkShareTodo')}</span></div>
            </div>
            <div className="chk">
              <span className="chk__box"><span className="ms">check</span></span>
              <div className="chk__m"><b>{t('chkPayouts')}</b><span>{t('chkPayoutsSoon')}</span></div>
              <span className="chk__soon">{t('soon')}</span>
            </div>
            <Link href="/affiliate/dashboard/influenceur" className="chk">
              <span className="chk__box"><span className="ms">check</span></span>
              <div className="chk__m"><b>{t('chkInfluencer')}</b><span>{t('chkInfluencerSub')}</span></div>
              <span className="chk__go">{t('open')}</span>
            </Link>
          </div>
        </div>

        {hasActivity && orders.length > 0 && (
          <div className="op-card ov-card">
            <div className="ov-card__hd"><h3>{t('activityTitle')}</h3></div>
            <div className="hint">{t('activityHint')}</div>
            <div className="chk-list">
              {orders.slice(0, 5).map((o) => (
                <div key={o.id} className="chk" style={{ cursor: 'default' }}>
                  <span className="chk__box" style={{ border: 'none', background: 'var(--op-af-bg)', color: 'var(--op-af)' }}><span className="ms">shopping_bag</span></span>
                  <div className="chk__m">
                    <b>{o.restaurant ? t('activityOrderNamed', { restaurant: o.restaurant }) : t('activityOrder')}</b>
                    <span>{shortDate(o.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
