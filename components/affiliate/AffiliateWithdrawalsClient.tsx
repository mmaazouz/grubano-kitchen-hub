'use client'

/**
 * AF4 · Retraits 🔒 (AffiliateShell --op-/--op-af teal, CD verbatim). Payout/Connect
 * screen for the AFFILIATE. VISUAL re-skin only — money plumbing untouched. The payout
 * rail is gated OFF (AFFILIATE_CONNECT_ENABLED → onboarding/withdraw routes 404), so this
 * screen is DISPLAY-ONLY & honest:
 *   · solde disponible = REAL server availableCents (÷100 via formatMoney, never recomputed);
 *   · seuil = the REAL server threshold (payout-threshold, passed as a prop — NEVER hardcoded);
 *   · « Total versé » = REAL paid cumul (balance.paidCents, 0 while gated);
 *   · « Prochain versement » = « — » (no fabricated date); « une fois activé » wording;
 *   · payout history = HONEST EMPTY (no fictive AFP refs / PDF statements);
 *   · « Demander un retrait » + « Activer » (Connect onboarding) = INERT « bientôt ».
 *
 * The real self-service withdraw flow (KYC/DAC7/step-up) lives in AffiliateWithdrawCard,
 * mounted below: it self-hides (renders null) while the rail is gated → invisible now. At
 * go-live (AFFILIATE_CONNECT_ENABLED ON) it activates; it still carries the old design
 * system → a full re-skin + reconciliation with this screen is a go-live task (SIGNAL).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import AffiliateWithdrawCard from '@/components/affiliate/AffiliateWithdrawCard'

interface Payload {
  earnings: { maturedCents: number; pendingCents: number }
  balance:  { availableCents: number; paidCents: number }
}

export default function AffiliateWithdrawalsClient({ thresholdCents }: { thresholdCents: number }) {
  const t = useTranslations('affiliate.withdrawals')
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

  // ── loading ──
  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 60, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 140, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 240, borderRadius: 12, display: 'block' }} />
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

  const { earnings, balance } = data
  const reached = balance.availableCents >= thresholdCents
  const missingCents = Math.max(0, thresholdCents - balance.availableCents)
  const brandNew = balance.availableCents === 0 && balance.paidCents === 0 && earnings.maturedCents === 0 && earnings.pendingCents === 0

  // ── empty (nothing accrued yet) ──
  if (brandNew) {
    return (
      <section>
        <div className="op-dash__head">
          <div><h1 className="op-dash__title">{t('title')}</h1><p className="op-dash__sub">{t('subtitle')}</p></div>
          <span className="ro-badge"><span className="ms">lock</span>{t('readOnly')}</span>
        </div>
        <div className="op-card op-empty">
          <span className="ms">account_balance</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div>
        <AffiliateWithdrawCard />
      </section>
    )
  }

  return (
    <section>
      <div className="op-dash__head">
        <div><h1 className="op-dash__title">{t('title')}</h1><p className="op-dash__sub">{t('subtitle')}</p></div>
        <span className="ro-badge"><span className="ms">lock</span>{t('readOnly')}</span>
      </div>

      {/* read-only banner (KEEP) */}
      <div className="ro-banner">
        <span className="ms">verified_user</span>
        <div className="m"><b>{t('bannerTitle')}</b><p>{t('bannerBody')}</p></div>
      </div>

      {/* withdraw hero — real solde + REAL server threshold; INERT « Demander un retrait ». */}
      <div className="op-card wd">
        <div className="wd__main">
          <div className="wd__label"><span className="ms">account_balance_wallet</span>{t('balanceLabel')}</div>
          <div className="wd__v">{fmt(balance.availableCents)}</div>
          <div className="wd__meta">
            {t('thresholdLabel')} <b>{fmt(thresholdCents)}</b> — {reached ? t('thresholdReached') : t('thresholdMissing', { missing: fmt(missingCents) })}
          </div>
        </div>
        <div className="wd__act">
          <div className="wd-soon" aria-disabled="true"><span className="ms">lock</span>{t('requestWithdraw')} <span className="soon">{t('soon')}</span></div>
          <div className="wd__auto"><span className="ms">schedule</span>{t('autoFuture')}</div>
        </div>
      </div>

      {/* schedule — no fabricated « prochain versement » date; « Total versé » = real paid cumul. */}
      <div className="op-card sched">
        <div className="cell">
          <div className="l"><span className="ms">event_upcoming</span>{t('nextPayout')}</div>
          <div className="v">—</div>
          <div className="s">{t('nextPayoutSub')}</div>
        </div>
        <div className="cell">
          <div className="l"><span className="ms">calendar_month</span>{t('frequency')}</div>
          <div className="v" style={{ fontSize: 16 }}>{t('frequencyValue')}</div>
          <div className="s">{t('frequencySub')}</div>
        </div>
        <div className="cell">
          <div className="l"><span className="ms">savings</span>{t('totalPaid')}</div>
          <div className="v">{fmt(balance.paidCents)}</div>
          <div className="s">{t('totalPaidSub')}</div>
        </div>
      </div>

      {/* payout method — Connect onboarding INERT « Activer — bientôt » while gated. */}
      <div className="op-card card-pad">
        <div className="card-pad__hd"><h3>{t('methodTitle')}</h3></div>
        <div className="hint">{t('methodHint')}</div>
        <div className="pm-row">
          <span className="ms">account_balance</span>
          <div className="m"><b>{t('methodStatus')}</b><span>{t('methodStatusSub')}</span></div>
          <span className="pm-soon" aria-disabled="true"><span className="ms">verified_user</span>{t('activate')} <span className="soon">{t('soon')}</span></span>
        </div>
        <div className="pm-note"><span className="ms">info</span><span>{t('methodNote')}</span></div>
      </div>

      {/* payout history — HONEST EMPTY (no fictive AFP rows / PDF). */}
      <div className="op-card card-pad">
        <div className="card-pad__hd"><h3>{t('historyTitle')}</h3></div>
        <div className="hint">{t('historyHint')}</div>
        <div className="po-empty">
          <span className="ms">account_balance</span>
          <p>{t('historyEmpty')}</p>
        </div>
        <div className="info-note"><span className="ms">info</span><span>{t('historyNote')}</span></div>
      </div>

      {/* Real self-service withdraw flow — self-hides (null) while the rail is gated. */}
      <AffiliateWithdrawCard />
    </section>
  )
}
