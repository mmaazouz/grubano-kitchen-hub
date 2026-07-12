'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import './franchise-finances.css'

// ── FR5 · Redevances & versements — READ-ONLY money screen (CD Vague 3 🔒) ────────
// Rendered inside FranchiseShell. DISPLAY-ONLY: NO button moves money (settlement is an
// admin/cron job gated by FRANCHISE_SETTLEMENT_ENABLED, OFF by default). Every amount is a
// REAL stored value in CENTS → € (never a CA×rate client recompute): accrued/settled/pending
// from FranchiseRoyalty, the per-POS breakdown from the same table, and the schedule from
// REAL Payout(role='franchise') rows only. While the held-back rail is gated OFF (default)
// there is nothing accrued and no payout → the honest EMPTY state shows. The rate is the
// real Brand.royaltyPct (or "—"). Owner-scoped server-side. Stripe stays TEST.

type Payout = { id: string; amountCents: number; currency: string; status: string; paidAt: string | null; stripeTransferId: string | null; createdAt: string }
type Fin = {
  royaltyEnabled: boolean
  accruedCents: number; settledCents: number; pendingCents: number
  payouts: Payout[]
  breakdown: { posName: string; royaltyCents: number }[]
  ratePct: number | null
}

const INITIALS = (s: string) =>
  (s.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2) || '–').toUpperCase()

export default function FranchiseFinancesPage() {
  const t = useTranslations('franchise.finances')
  const locale = useLocale()
  const [data, setData] = useState<Fin | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/franchise/finances')
      .then(r => r.json())
      .then(d => { if (alive) { d.error ? setError(true) : setData(d) } })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const eur = useMemo(() => {
    const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return (cents: number) => `${nf.format(cents / 100)} €`
  }, [locale])
  const eur0 = useMemo(() => {
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    return (cents: number) => `${nf.format(Math.round(cents / 100))} €`
  }, [locale])
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }), [locale])
  const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—')
  const statusLabel = (s: string) => (s === 'paid' ? t('statusPaid') : s === 'failed' ? t('statusFailed') : t('statusPending'))
  const payCls = (s: string) => (s === 'paid' ? 'done' : s === 'failed' ? 'failed' : 'wait')
  const payIcCls = (s: string) => (s === 'paid' ? 'done' : 'wait')

  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18 }} />
        <span className="op-sk" style={{ width: '100%', height: 60, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
          {[0, 1, 2, 3].map(i => <span key={i} className="op-sk" style={{ width: '100%', height: 110, borderRadius: 12 }} />)}
        </div>
      </section>
    )
  }

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

  const payouts = data.payouts ?? []
  const breakdown = data.breakdown ?? []
  // Prod default (rail gated OFF): nothing accrued, no payout → honest empty state.
  const isEmpty = data.accruedCents === 0 && payouts.length === 0 && breakdown.length === 0
  if (isEmpty) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card"><div className="op-empty">
          <span className="ms" aria-hidden="true">account_balance_wallet</span>
          <b>{t('emptyRootTitle')}</b>
          <span>{t('emptyRootDesc')}</span>
        </div></div>
      </section>
    )
  }

  const breakdownTotal = breakdown.reduce((s, b) => s + b.royaltyCents, 0)

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('headTitle')}</h1>
          <p className="op-dash__sub">{t('headSub')}</p>
        </div>
        <span className="ro-badge"><span className="ms" aria-hidden="true">lock</span>{t('readOnly')}</span>
      </div>

      <div className="ro-banner">
        <span className="ms" aria-hidden="true">verified_user</span>
        <div className="m"><b>{t('bannerTitle')}</b><p>{t('bannerBody')}</p></div>
      </div>

      <div className="sum-grid">
        <div className="op-card sum hero"><div className="l"><span className="ms" aria-hidden="true">savings</span>{t('accruedLabel')}</div><div className="v">{eur0(data.accruedCents)}</div><div className="s">{t('accruedSub')}</div></div>
        <div className="op-card sum"><div className="l"><span className="ms" aria-hidden="true">check_circle</span>{t('settledLabel')}</div><div className="v">{eur0(data.settledCents)}</div><div className="s">{t('settledSub')}</div></div>
        <div className="op-card sum"><div className="l"><span className="ms" aria-hidden="true">hourglass_top</span>{t('pendingLabel')}</div><div className="v">{eur0(data.pendingCents)}</div><div className="s">{t('pendingSub')}</div></div>
        <div className="op-card sum"><div className="l"><span className="ms" aria-hidden="true">percent</span>{t('rateLabel')}</div><div className="v">{data.ratePct != null ? `${data.ratePct} %` : '—'}</div><div className="s">{t('rateSub')}</div></div>
      </div>

      {!data.royaltyEnabled && (
        <div className="ro-banner" style={{ background: 'var(--op-surface-2)', borderColor: 'var(--op-border)' }}>
          <span className="ms" aria-hidden="true" style={{ color: 'var(--op-muted-2)' }}>info</span>
          <div className="m"><p style={{ margin: 0 }}>{t('inactiveNote')}</p></div>
        </div>
      )}

      <div className="two">
        <div className="op-card card-pad">
          <h3><span className="ms" aria-hidden="true">receipt_long</span>{t('scheduleTitle')}</h3>
          <div className="hint">{t('scheduleHint')}</div>
          {payouts.length === 0 ? (
            <div className="pay-empty">{t('scheduleEmpty')}</div>
          ) : payouts.map(p => (
            <div className="pay-row" key={p.id}>
              <span className={`pay-ic ${payIcCls(p.status)}`}><span className="ms" aria-hidden="true">{p.status === 'paid' ? 'check_circle' : 'schedule'}</span></span>
              <div className="pay-m">
                <b>{eur(p.amountCents)}</b>
                <span>{day(p.paidAt ?? p.createdAt)}{p.stripeTransferId ? ` · ${p.stripeTransferId}` : ''}</span>
              </div>
              <div><span className={`pay-status ${payCls(p.status)}`}>{statusLabel(p.status)}</span></div>
            </div>
          ))}
        </div>

        <div className="op-card card-pad">
          <h3><span className="ms" aria-hidden="true">splitscreen</span>{t('breakdownTitle')}</h3>
          <div className="hint">{t('breakdownHint')}</div>
          {breakdown.length === 0 ? (
            <div className="bd-empty">{t('breakdownEmpty')}</div>
          ) : (
            <>
              {breakdown.map((b, i) => (
                <div className="bd-row" key={i}>
                  <span className="bd-logo">{INITIALS(b.posName)}</span>
                  <div className="bd-m"><b>{b.posName}</b></div>
                  <span className="bd-amt">{eur0(b.royaltyCents)}</span>
                </div>
              ))}
              <div className="bd-total"><b>{t('breakdownTotal')}</b><span className="v">{eur0(breakdownTotal)}</span></div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
