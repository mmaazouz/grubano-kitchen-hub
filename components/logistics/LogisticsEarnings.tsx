'use client'

/**
 * LO6 · Mes gains 🔒 (LogisticsShell --op-/--op-lo amber, CD verbatim). BUILD-NEW P4.3
 * ÉTAPE 5. Over the owner-scoped, session-resolved:
 *
 *   GET /api/logistics/earnings
 *   → { balance{availableCents, paidCents}, pendingCents,
 *       earnings[{ id, type, grossCents, feeCents, netCents, status, missionId, date }] }
 *
 * RULES: amounts are SERVER CENTS → euros for DISPLAY only (÷100 via formatMoney), NEVER
 * recomputed client-side. Statuses come from the SERVER lifecycle (pending|matured|paid) —
 * a course row shows « En attente » until it matures, « Versé » once a Payout settles it.
 * Course transparency: gross → −commission (feeCents) → net (real table values). A tip is a
 * SEPARATE row, 100 % net (feeCents 0). The ref is the REAL Mission id (never « MIS-2026-… »).
 * When the P4.3 accrual rail is OFF the table is empty → honest « aucun gain » state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatMoney } from '@/lib/format-money'

interface Earning {
  id: string
  type: 'course' | 'tip' | string
  grossCents: number
  feeCents: number
  netCents: number
  status: 'pending' | 'matured' | 'paid' | string
  missionId: string | null
  orderId: string | null
  date: string
  maturesAt: string | null
}
interface Payload {
  balance:      { availableCents: number; paidCents: number }
  pendingCents: number
  earnings:     Earning[]
}

export default function LogisticsEarnings() {
  const t = useTranslations('logisticsEarnings')
  const locale = useLocale()

  const [data, setData]       = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/logistics/earnings', { cache: 'no-store' })
      if (res.status === 404) { setError(t('noProfile')); return }
      if (!res.ok) throw new Error('load_failed')
      setData((await res.json()) as Payload)
    } catch {
      setError(t('errLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const fmt = useMemo(() => (cents: number) => formatMoney(cents, locale), [locale])
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }), [locale])

  // Server status → UI badge (pending → « En attente », matured → « Disponible », paid → « Versé »).
  const statusBadge = (s: string) => {
    switch (s) {
      case 'matured': return { cls: 'avail',   icon: 'check_circle', label: t('stMatured') }
      case 'paid':    return { cls: 'paid',     icon: 'check',        label: t('stPaid') }
      default:        return { cls: 'pending',  icon: 'schedule',     label: t('stPending') }
    }
  }

  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 60, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12 }} />
        </div>
        <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12, display: 'block' }} />
      </section>
    )
  }

  if (error || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms">cloud_off</span>
          <h2>{t('errTitle')}</h2>
          <p>{error || t('errLoad')}</p>
          <button type="button" className="op-btn-primary" onClick={load}><span className="ms">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  const { balance, pendingCents, earnings } = data
  const brandNew = earnings.length === 0 && balance.availableCents === 0 && pendingCents === 0 && balance.paidCents === 0

  if (brandNew) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card"><div className="op-empty">
          <span className="ms">savings</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div></div>
      </section>
    )
  }

  return (
    <section>
      <div className="op-dash__head">
        <div><h1 className="op-dash__title">{t('title')}</h1><p className="op-dash__sub">{t('subtitle')}</p></div>
        <span className="ro-badge"><span className="ms">lock</span>{t('computedBy')}</span>
      </div>

      {/* honesty banner — maturation + the transparent 20 % commission (KEEP, exact) */}
      <div className="ro-banner">
        <span className="ms">schedule</span>
        <div className="m"><b>{t('bannerTitle')}</b><p>{t('bannerBody')}</p></div>
      </div>

      {/* 3 real balances — all server cents */}
      <div className="bal-grid">
        <div className="op-card bal avail">
          <div className="bal__l"><span className="ms">account_balance_wallet</span>{t('balAvailable')}</div>
          <div className="bal__v">{fmt(balance.availableCents)}</div>
          <div className="bal__s">{t('balAvailableSub')}</div>
          <div className="bal__cta">
            <Link href="/logistics/dashboard/retrait" className="op-btn-primary"><span className="ms">payments</span>{t('withdraw')}</Link>
          </div>
        </div>
        <div className="op-card bal">
          <div className="bal__l"><span className="ms">hourglass_top</span>{t('balPending')}</div>
          <div className="bal__v">{fmt(pendingCents)}</div>
          <div className="bal__s">{t('balPendingSub')}</div>
        </div>
        <div className="op-card bal">
          <div className="bal__l"><span className="ms">check_circle</span>{t('balPaid')}</div>
          <div className="bal__v">{fmt(balance.paidCents)}</div>
          <div className="bal__s">{t('balPaidSub')}</div>
        </div>
      </div>

      {/* history — real CourierEarning rows, transparent course math + separate tip rows */}
      <div className="op-card card-pad">
        <div className="sec-hd"><h3>{t('historyTitle')}</h3></div>
        <div className="hint">{t('historyHint')}</div>
        {earnings.length > 0 ? earnings.map((e) => {
          const badge = statusBadge(e.status)
          const isTip = e.type === 'tip'
          const ref = e.missionId ? `#${e.missionId}` : (e.orderId ? `#${e.orderId}` : null)
          return (
            <div className="ea-row" key={e.id}>
              <span className={`ea-ic ${isTip ? 'tip' : 'course'}`}>
                <span className="ms">{isTip ? 'volunteer_activism' : 'two_wheeler'}</span>
              </span>
              <div className="ea-m">
                <b>{isTip ? t('rowTip') : t('rowCourse')}</b>
                <div className="sub">
                  <span>{dateFmt.format(new Date(e.date))}</span>
                  {ref && <span className="ref">{ref}</span>}
                </div>
                {isTip ? (
                  <div className="ea-calc"><span className="tipfull mono">{fmt(e.netCents)}</span><span className="op">{t('tip100')}</span></div>
                ) : (
                  <div className="ea-calc">
                    <span className="gross mono">{fmt(e.grossCents)}</span><span className="op">{t('gross')}</span>
                    <span className="op">−</span>
                    <span className="comm mono">{fmt(e.feeCents)}</span><span className="op">{t('commission')}</span>
                    <span className="eq">=</span>
                    <span className="net mono">{fmt(e.netCents)}</span><span className="op">{t('net')}</span>
                  </div>
                )}
              </div>
              <div className="ea-r">
                <span className="ea-amt">{fmt(e.netCents)}</span>
                <span className={`ea-status ${badge.cls}`}><span className="ms">{badge.icon}</span>{badge.label}</span>
              </div>
            </div>
          )
        }) : (
          <p className="eh-empty">{t('historyEmpty')}</p>
        )}
        <div className="info-note"><span className="ms">info</span><span>{t('serverNote')}</span></div>
      </div>
    </section>
  )
}
