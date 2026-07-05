'use client'

/**
 * AF3 · Mes gains 🔒 (AffiliateShell --op-/--op-af teal, CD verbatim). Clone of CR6
 * (creator « Mes gains ») for the AFFILIATE entity. VISUAL re-skin only — money
 * plumbing untouched. Over the owner-scoped, session-resolved:
 *
 *   GET /api/affiliate/stats
 *   → { earnings{maturedCents, pendingCents, byMonth[]}, balance{availableCents,
 *       paidCents}, referrals{newCustomers, orders[{…, earningCents, bonusCents,
 *       status, date, restaurant}]}, commissionPct, … }
 *
 * RULES: amounts are CENTS → euros for DISPLAY only (÷100 via formatMoney), NEVER
 * recomputed client-side. Statuses come from the SERVER lifecycle (pending|matured|
 * cancelled|paid) — a refund shows « Annulé », never « Versé ». The payout rail is
 * gated OFF (AFFILIATE_CONNECT_ENABLED): NO fictive « prochain versement »/date, the
 * « Retrait manuel » CTA is INERT, the note is future-tense.
 *
 * « Versements reçus » = HONEST EMPTY (static). The CR6 twin wires /api/partner/payouts,
 * but that route is CREATOR-scoped (resolves by email → prisma.creator, role:'creator',
 * gated by isConnectOnboardingEnabled('creator')) — wiring it for the affiliate would risk
 * surfacing the user's CREATOR payouts on this AFFILIATE screen. There is no affiliate-
 * scoped payout-rows endpoint and the affiliate rail is gated OFF (zero real affiliate
 * payouts) → the truthful state is empty. A real affiliate payouts feed is a go-live task.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'

interface AffOrder {
  id: string; date: string; restaurant: string | null
  earningCents: number; bonusCents: number
  status: 'pending' | 'matured' | 'cancelled' | 'paid' | string
}
interface Payload {
  earnings:  { maturedCents: number; pendingCents: number; byMonth: { month: string; gainCents: number }[] }
  balance:   { availableCents: number; paidCents: number }
  referrals: { newCustomers: number; orders: AffOrder[] }
  commissionPct: number | null
}

export default function AffiliateEarningsClient() {
  const t = useTranslations('affiliate.earnings')
  const locale = useLocale()

  const [data, setData]       = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/affiliate/stats', { cache: 'no-store' })
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

  const statusBadge = (s: string) => {
    switch (s) {
      case 'pending':   return { cls: 'pending',   icon: 'schedule', label: t('statusPending') }
      case 'matured':   return { cls: 'matured',   icon: 'task_alt', label: t('statusMatured') }
      case 'paid':      return { cls: 'paid',      icon: 'check',    label: t('statusPaid') }
      case 'cancelled': return { cls: 'cancelled', icon: 'cancel',   label: t('statusCancelled') }
      default:          return { cls: 'cancelled', icon: 'help',     label: s }
    }
  }

  // ── loading ──
  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 60, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 170, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 280, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── error ──
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

  const { earnings, balance, referrals } = data
  const orders = referrals.orders ?? []
  const cumulativeCents = earnings.maturedCents + earnings.pendingCents + balance.paidCents
  // « Gagné ce mois » — the CURRENT calendar month from the server byMonth aggregate
  // (matured + pending gains keyed by YYYY-MM). Real, never a fabricated rolling window.
  const nowKey = (() => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` })()
  const thisMonthCents = earnings.byMonth?.find((m) => m.month === nowKey)?.gainCents ?? 0

  const brandNew = orders.length === 0 && earnings.maturedCents === 0 && earnings.pendingCents === 0 && balance.paidCents === 0

  // ── empty (no gains yet) ──
  if (brandNew) {
    return (
      <section>
        <div className="op-dash__head">
          <div><h1 className="op-dash__title">{t('title')}</h1><p className="op-dash__sub">{t('subtitle')}</p></div>
          <span className="ro-badge"><span className="ms">lock</span>{t('readOnly')}</span>
        </div>
        <div className="op-card op-empty">
          <span className="ms">savings</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="op-dash__head">
        <div><h1 className="op-dash__title">{t('title')}</h1><p className="op-dash__sub">{t('subtitle')}</p></div>
        <span className="ro-badge"><span className="ms">lock</span>{t('readOnly')}</span>
      </div>

      {/* read-only banner (honest — KEEP) */}
      <div className="ro-banner">
        <span className="ms">verified_user</span>
        <div className="m"><b>{t('bannerTitle')}</b><p>{t('bannerBody')}</p></div>
      </div>

      {/* balance hero — big = availableCents (« Solde disponible »). NO fabricated
          « Prochain versement »/date; the CTA is INERT; the note is future-tense. */}
      <div className="op-card bal">
        <div className="bal__main">
          <div className="bal__label"><span className="ms">account_balance_wallet</span>{t('balanceLabel')}</div>
          <div className="bal__v">{fmt(balance.availableCents)}</div>
          <div className="bal__meta">
            {t('earnedThisMonth')} <b>{fmt(thisMonthCents)}</b> · {t('cumulativeShort')} <b>{fmt(cumulativeCents)}</b>
          </div>
        </div>
        <div className="bal__side">
          <div className="bal__row"><span className="k">{t('waiting')}</span><span className="v">{fmt(earnings.pendingCents)}</span></div>
          <div className="bal__row"><span className="k">{t('alreadyPaid')}</span><span className="v">{fmt(balance.paidCents)}</span></div>
          <div className="bal__cta">
            <div className="payout-soon" aria-disabled="true"><span className="ms">lock</span>{t('manualWithdraw')} <span className="soon">{t('soon')}</span></div>
          </div>
          <div className="bal__auto"><span className="ms">schedule</span>{t('autoFuture')}</div>
        </div>
      </div>

      {/* transparency (real config rate, hidden if unknown) */}
      {data.commissionPct != null && (
        <p className="earn-line">{t('transparency', { pct: data.commissionPct })}</p>
      )}

      <div className="two">
        {/* history — real orders + SERVER statuses (a refund → « Annulé », never « Versé ») */}
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('historyTitle')}</h3></div>
          <div className="hint">{t('historyHint')}</div>
          {orders.length > 0 ? (
            <>
              <div className="eh-thead"><span>{t('colDate')}</span><span>{t('colSource')}</span><span>{t('colStatus')}</span><span>{t('colAmount')}</span></div>
              {orders.map((o) => {
                const badge = statusBadge(o.status)
                const gain = o.earningCents + o.bonusCents
                const isCancelled = o.status === 'cancelled'
                return (
                  <div className="eh-row" key={o.id}>
                    <span className="eh-date eh-date-cell">{dateFmt.format(new Date(o.date))}</span>
                    <div className="eh-src">
                      <span className="eh-src__ic"><span className="ms">receipt_long</span></span>
                      <div><b>{o.restaurant ?? t('sourceAffiliated')}</b><span>{t('orderAffiliated')}</span></div>
                    </div>
                    <span className="eh-status-cell"><span className={`eh-status ${badge.cls}`}><span className="ms">{badge.icon}</span>{badge.label}</span></span>
                    <span className={`eh-amt${isCancelled ? ' is-cancelled' : ''}`}>{fmt(gain)}</span>
                    <span className="eh-mini">{dateFmt.format(new Date(o.date))} · {badge.label}</span>
                  </div>
                )
              })}
            </>
          ) : (
            <p className="eh-empty">{t('historyEmpty')}</p>
          )}
          <div className="info-note"><span className="ms">info</span><span>{t('waitingNote')}</span></div>
        </div>

        {/* « Versements reçus » — HONEST EMPTY (no fictive AFP rows, no PDF note).
            /api/partner/payouts is CREATOR-scoped → not wired here (see header). */}
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('payoutsTitle')}</h3></div>
          <div className="hint">{t('payoutsHint')}</div>
          <div className="po-empty">
            <span className="ms">account_balance</span>
            <p>{t('payoutsEmpty')}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
