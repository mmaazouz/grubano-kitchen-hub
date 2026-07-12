'use client'

/**
 * /finance — operator FINANCES screen. VERBATIM CD v1 LOT 2 (Notion 390fd2c9-…-9483).
 * ⚠️ ZONE ARGENT / ISO-FLUX — presentation only.
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome, Finances
 * active in the rail). This component renders ONLY the screen content = a <section> inside
 * op-content.
 *
 * 🔒 MONEY INTEGRITY. Every figure comes from GET /api/finance/summary (rolling 30-day P&L,
 * EUR floats) and is DISPLAYED via formatEuros — NEVER recomputed here. The golden equation
 * is rendered exactly as the API supplies each term:
 *     caBrut − commissionGrubano − verseAuxCreateurs − remisesFinancees = netResto
 * The commission RATE shown is DERIVED from the real API amounts (commissionGrubano ÷ caBrut),
 * never hardcoded. Bar widths are a pure visual proportion of those same displayed amounts.
 *
 * HONEST « bientôt » (no backend for this page): next SEPA payout (amount/date/account),
 * payout schedule, per-transaction ledger journal, monthly PDF statements. These are drawn
 * as CD-faithful previews with a « bientôt » state — NEVER fake data. The refund modal is
 * drawn « prête » but INERT (gate-2: no real Stripe wiring until REFUNDS_ENABLED + review).
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import './finance.css'

type FinanceSummary = {
  windowDays:          number
  caBrut:              number
  commissionGrubano:   number
  verseAuxCreateurs:   number
  remisesFinancees:    number
  netResto:            number
  caAmeneParCreateurs: number
  ordersFromCreators:  number
  ordersTotal:         number
}

export default function FinancePage() {
  const t      = useTranslations('operator')
  const locale = useLocale()

  const [data,  setData]  = useState<FinanceSummary | null>(null)
  const [stage, setStage] = useState<'loading' | 'error' | 'ready'>('loading')

  // Refund modal — VISUAL / INERT (gate-2). Local UI state only, no network.
  const [refund, setRefund] = useState(false)

  useEffect(() => {
    fetch('/api/finance/summary', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: FinanceSummary) => { setData(d); setStage('ready') })
      .catch(() => setStage('error'))
  }, [])

  // DISPLAY-only EUR formatting (locale-aware, 2 dp). Never mutates a value.
  const eur = useMemo(() => (n: number) => formatEuros(n ?? 0, locale), [locale])

  const updatedAt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date()),
    [locale],
  )
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
    [locale],
  )

  // ── loading skeleton (mirrors CD .op-skel) ──
  if (stage === 'loading') {
    return (
      <section aria-busy="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div><span className="op-sk" style={{ width: 160, height: 22, marginBottom: 8 }} /><span className="op-sk" style={{ width: 240, height: 12 }} /></div>
          <span className="op-sk" style={{ width: 110, height: 34, borderRadius: 8 }} />
        </div>
        <div className="op-row2">
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 220, height: 14 }} /></div>
            <div style={{ padding: 18, display: 'flex', gap: 24 }}>
              <span className="op-sk" style={{ width: 90, height: 34 }} /><span className="op-sk" style={{ width: 90, height: 34 }} /><span className="op-sk" style={{ width: 90, height: 34 }} />
            </div>
          </div>
          <div className="op-card"><div className="op-card__head"><span className="op-sk" style={{ width: 140, height: 14 }} /></div>
            <div style={{ padding: 18 }}><span className="op-sk" style={{ width: '70%', height: 30, marginBottom: 10 }} /><span className="op-sk" style={{ width: '100%', height: 14 }} /></div>
          </div>
        </div>
        <div className="op-card" style={{ marginBottom: 16 }}>
          <div className="op-card__head"><span className="op-sk" style={{ width: 180, height: 14 }} /></div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="op-sk" style={{ width: '100%', height: 24 }} /><span className="op-sk" style={{ width: '100%', height: 24 }} /><span className="op-sk" style={{ width: '100%', height: 24 }} />
          </div>
        </div>
      </section>
    )
  }

  // ── error ──
  if (stage === 'error' || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('fin.errorTitle')}</h2>
          <p>{t('dash.errorBody')}</p>
          <button type="button" className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}</button>
        </div>
      </div></section>
    )
  }

  const {
    caBrut, commissionGrubano, verseAuxCreateurs, remisesFinancees, netResto,
    ordersTotal,
  } = data

  // ── empty (no transaction in the window) ──
  if (ordersTotal === 0) {
    return (
      <section>
        <div className="op-dash__head">
          <div><h1 className="op-dash__title">{t('fin.title')}</h1><p className="op-dash__sub">{dateLabel}</p></div>
        </div>
        <div className="op-card"><div className="op-emptyline" style={{ padding: '60px 20px' }}>
          <span className="ms" aria-hidden="true">payments</span>
          <b>{t('fin.emptyTitle')}</b>
          <span>{t('fin.emptyBody')}</span>
          <Link href="/orders"><span className="ms" aria-hidden="true" style={{ fontSize: 15 }}>receipt_long</span>{t('fin.emptyCta')}</Link>
        </div></div>
      </section>
    )
  }

  // ── DERIVED FOR DISPLAY ONLY (never mutates a shown amount) ──
  // Bar / legend proportion straight from the API figures. commissionShare covers
  // EVERY fee the API deducted (commission + creator cost + funded discounts), so the
  // green «net» segment matches the API's netResto proportion exactly.
  const totalFees   = commissionGrubano + verseAuxCreateurs + remisesFinancees
  const netPct      = caBrut > 0 ? Math.max(0, Math.min(100, (netResto / caBrut) * 100)) : 0
  const feesPct     = 100 - netPct
  // Real commission rate from the API amounts — NOT hardcoded. Shown only when meaningful.
  const commissionRatePct =
    caBrut > 0 ? (commissionGrubano / caBrut) * 100 : null
  const rateLabel =
    commissionRatePct == null
      ? ''
      : ` (${commissionRatePct.toLocaleString(locale, { maximumFractionDigits: 1 })}%)`

  const windowLabel = t('fin.windowLabel', { days: data.windowDays })

  // ── loaded ──
  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('fin.title')}</h1>
          <p className="op-dash__sub">{windowLabel} · {t('dash.updatedAt')} <span className="mono">{updatedAt}</span></p>
        </div>
        <button type="button" className="op-refresh" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('dash.refresh')}</button>
      </div>

      {/* ══ CA breakdown (BRUT − frais = NET) — REAL, displayed straight from the API ══ */}
      <div className="op-row2">
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">account_balance_wallet</span>{t('fin.breakdownTitle')}</h2><span className="cap">{windowLabel}</span></div>
          <div className="op-fin__formula">
            <div className="term gross"><span className="lbl">{t('fin.brutLabel')}</span><b>{eur(caBrut)}</b></div>
            <span className="op-fin__eq">−</span>
            <div className="term comm"><span className="lbl">{t('fin.feesLabel')}</span><b>{eur(totalFees)}</b></div>
            <span className="op-fin__eq">=</span>
            <div className="term net"><span className="lbl">{t('fin.netLabel')}</span><b>{eur(netResto)}</b></div>
          </div>
          <div className="op-fin__bar"><i className="net" style={{ width: `${netPct}%` }} /><i className="comm" style={{ width: `${feesPct}%` }} /></div>
          <div className="op-fin__legend">
            <span><i className="sw net" />{t('fin.legendNet', { pct: netPct.toLocaleString(locale, { maximumFractionDigits: 0 }) })}</span>
            <span><i className="sw comm" />{t('fin.legendFees', { pct: feesPct.toLocaleString(locale, { maximumFractionDigits: 0 }) })}</span>
          </div>
          {/* full decomposition — every deducted term, byte-identical from the API */}
          <div className="op-fin__lines">
            <div className="op-fin__line minus"><span>{t('fin.commissionLine') + rateLabel}</span><b>−{eur(commissionGrubano)}</b></div>
            {verseAuxCreateurs > 0 && <div className="op-fin__line minus"><span>{t('fin.creatorsLine')}</span><b>−{eur(verseAuxCreateurs)}</b></div>}
            {remisesFinancees > 0 && <div className="op-fin__line minus"><span>{t('fin.discountsLine')}</span><b>−{eur(remisesFinancees)}</b></div>}
          </div>
        </div>

        {/* Prochain versement — NO SEPA/Stripe backend for this page → honest « bientôt » */}
        <div className="op-card op-fin__next">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">payments</span>{t('fin.nextPayoutTitle')}</h2></div>
          <div className="body">
            <div className="amt soon mono">—</div>
            <div className="when"><span className="ms" aria-hidden="true">schedule</span>{t('fin.nextPayoutSoon')}</div>
            <div className="acct"><span className="ms" aria-hidden="true">account_balance</span>{t('fin.nextPayoutAcct')}</div>
          </div>
        </div>
      </div>

      {/* Échéancier des versements — no payout backend for this page → honest « bientôt » */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">sync_alt</span>{t('fin.scheduleTitle')}</h2><span className="op-pill soon"><i className="dot" />{t('soon')}</span></div>
        <div className="op-emptyline">
          <span className="ms" aria-hidden="true">sync_alt</span>
          <b>{t('fin.scheduleSoonTitle')}</b>
          <span>{t('fin.scheduleSoonBody')}</span>
        </div>
      </div>

      <div className="op-row2">
        {/* Journal des transactions — the summary endpoint gives aggregates only (no per-line
            ledger for this page) → honest « bientôt ». Refund action is drawn INERT (gate-2). */}
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">receipt_long</span>{t('fin.journalTitle')}</h2><span className="op-pill soon"><i className="dot" />{t('soon')}</span></div>
          <div className="op-emptyline" style={{ padding: '40px 16px' }}>
            <span className="ms" aria-hidden="true">receipt_long</span>
            <b>{t('fin.journalSoonTitle')}</b>
            <span>{t('fin.journalSoonBody')}</span>
          </div>
        </div>

        {/* Factures & relevés — no PDF generation → inert « bientôt » download buttons */}
        <div className="op-card">
          <div className="op-card__head"><h2><span className="ms" aria-hidden="true">description</span>{t('fin.invoicesTitle')}</h2><span className="op-pill soon"><i className="dot" />{t('soon')}</span></div>
          <div className="op-emptyline" style={{ padding: '40px 16px' }}>
            <span className="ms" aria-hidden="true">description</span>
            <b>{t('fin.invoicesSoonTitle')}</b>
            <span>{t('fin.invoicesSoonBody')}</span>
          </div>
        </div>
      </div>

      {/* ══ Refund modal — VISUAL / INERT (gate-2). No Stripe wiring. Confirm just closes. ══ */}
      <div className={`op-modal-backdrop${refund ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setRefund(false) }}>
        <div className="op-modal" role="dialog" aria-modal="true">
          <div className="op-modal__head">
            <h3>{t('fin.refundTitle')}</h3>
            <button type="button" className="op-modal__close" onClick={() => setRefund(false)} aria-label={t('fin.refundCancel')}><span className="ms" aria-hidden="true">close</span></button>
          </div>
          <div className="op-modal__body">
            <div className="op-field">
              <label>{t('fin.refundAmountLabel')}</label>
              <div className="op-seg">
                <button type="button" className="is-active">{t('fin.refundTotal')}</button>
                <button type="button">{t('fin.refundPartial')}</button>
              </div>
            </div>
            <div className="op-field">
              <label>{t('fin.refundReason')}</label>
              <select className="op-select" defaultValue="">
                <option value="" disabled>{t('fin.refundReasonPlaceholder')}</option>
                <option>{t('fin.refundReason1')}</option>
                <option>{t('fin.refundReason2')}</option>
                <option>{t('fin.refundReason3')}</option>
                <option>{t('fin.refundReason4')}</option>
              </select>
            </div>
            <div className="op-field">
              <label>{t('fin.refundNote')}</label>
              <textarea className="op-textarea" placeholder={t('fin.refundNotePlaceholder')} />
            </div>
            {/* HONEST: this modal is a preview — no real refund is issued (gate-2). */}
            <div className="op-callout warn">
              <span className="ms" aria-hidden="true">info</span>
              <p>{t('fin.refundSoonNote')}</p>
            </div>
          </div>
          <div className="op-modal__foot">
            <button type="button" className="op-btn-ghost" onClick={() => setRefund(false)}>{t('fin.refundCancel')}</button>
            {/* INERT: disabled — no Stripe call until gate-2 (REFUNDS_ENABLED + money review). */}
            <button type="button" className="op-btn-danger" disabled aria-disabled="true">
              <span className="ms" aria-hidden="true" style={{ fontSize: 15 }}>undo</span>{t('fin.refundConfirm')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
