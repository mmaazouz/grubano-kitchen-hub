'use client'

/**
 * LO7 · Retrait 🔒 (LogisticsShell --op-/--op-lo amber, CD verbatim). BUILD-NEW P4.3 ÉTAPE 5.
 * Self-service courier payout over the owner-scoped, session-resolved:
 *
 *   GET  /api/logistics/withdraw → { payoutEnabled, connectEnabled, availableCents, paidCents,
 *          thresholdCents, connectStatus, hasAccount, accountActive, partnerType, payouts[] }
 *   POST /api/logistics/withdraw → payPartner('logistics') (gated LOGISTICS_PAYOUT_ENABLED)
 *   POST /api/logistics/connect  → Stripe Connect onboarding (gated LOGISTICS_CONNECT_ENABLED)
 *
 * 4 REAL states derived from the server state (+ loading/error):
 *   nocfg   — no active Connect account → « Configurer via Stripe » (onboarding + KYC).
 *   below   — available < threshold → disabled, « il manque X € ».
 *   ready   — available ≥ threshold AND Connect active → « Retirer {available} ».
 *   pending — a logistics Payout is in progress → disabled, « retrait en cours ».
 *
 * MONEY RULES: amounts are SERVER CENTS → euros for DISPLAY only. The Retirer amount is NEVER
 * a client value — payPartner pays exactly computePartnerBalance('logistics').available (the
 * full matured remainder). IBAN is NEVER fabricated nor stored: Grubano only shows that a
 * Stripe-managed account exists. Payout refs are REAL Payout ids (never « RET-2026-… »). When
 * the payout rail is OFF the button is inert (« bientôt »).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'

interface Payout {
  id: string; amountCents: number; currency: string; status: string
  createdAt: string; paidAt: string | null; stripeTransferId: string | null
}
interface Payload {
  payoutEnabled:  boolean
  connectEnabled: boolean
  availableCents: number
  paidCents:      number
  thresholdCents: number
  connectStatus:  string  // none | pending | active | restricted
  hasAccount:     boolean
  accountActive:  boolean
  partnerType:    string
  payouts:        Payout[]
}
type WState = 'nocfg' | 'below' | 'ready' | 'pending'

export default function LogisticsWithdraw() {
  const t = useTranslations('logisticsWithdraw')
  const locale = useLocale()

  const [data, setData]       = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [flash, setFlash]     = useState('')
  // DAC7 fiscal capture (P4.3 ÉTAPE 6) — opened when the withdrawal returns fiscal_required.
  const [fiscalOpen, setFiscalOpen] = useState(false)
  const [fiscalBusy, setFiscalBusy] = useState(false)
  const [fiscal, setFiscal] = useState({ registeredAddress: '', taxId: '', taxIdCountry: '', sellerType: '', dateOfBirth: '' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/logistics/withdraw', { cache: 'no-store' })
      if (res.status === 401) { setError(t('noProfile')); return }
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

  // Start (or resume) the Stripe Connect onboarding, then redirect to the Stripe-hosted flow.
  const onboard = useCallback(async () => {
    setBusy(true); setFlash('')
    try {
      const res = await fetch('/api/logistics/connect', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.url) { window.location.href = json.url as string; return }
      setFlash(json?.gated ? t('flashComing') : t('flashError'))
    } catch { setFlash(t('flashError')) } finally { setBusy(false) }
  }, [t])

  // Request the withdrawal — the SERVER pays the full matured balance (body ignored).
  const withdraw = useCallback(async () => {
    setBusy(true); setFlash('')
    try {
      const res = await fetch('/api/logistics/withdraw', { method: 'POST' })
      const json = await res.json().catch(() => null) as { status?: string; amountCents?: number } | null
      switch (json?.status) {
        case 'paid':          setFlash(t('flashPaid', { amount: fmt(json.amountCents ?? 0) })); break
        case 'in_progress':   setFlash(t('flashInProgress')); break
        case 'kyc_required':  setFlash(t('flashKyc')); break
        case 'fiscal_required': // DAC7 incomplete → prefill + open the fiscal capture form
          setFlash(t('flashFiscal'))
          try {
            const cur = await fetch('/api/operator/dac7', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
            if (cur) setFiscal({ registeredAddress: cur.registeredAddress ?? '', taxId: cur.taxId ?? '', taxIdCountry: cur.taxIdCountry ?? '', sellerType: cur.sellerType ?? '', dateOfBirth: cur.dateOfBirth ?? '' })
          } catch { /* form opens blank */ }
          setFiscalOpen(true)
          break
        case 'below_threshold': setFlash(t('flashBelow')); break
        case 'rail_disabled': setFlash(t('flashComing')); break
        default:              setFlash(t('flashError'))
      }
      await load() // refresh balance + history from the server
    } catch { setFlash(t('flashError')) } finally { setBusy(false) }
  }, [t, fmt, load])

  // Save the DAC7 self-declaration (shared /api/operator/dac7), then retry the withdrawal.
  const submitFiscal = useCallback(async () => {
    setFiscalBusy(true); setFlash('')
    try {
      const res = await fetch('/api/operator/dac7', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fiscal),
      })
      if (!res.ok) { setFlash(t('flashError')); return }
      setFiscalOpen(false)
      setFlash(t('flashFiscalSaved'))
    } catch { setFlash(t('flashError')) } finally { setFiscalBusy(false) }
  }, [fiscal, t])

  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 200, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 220, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 180, borderRadius: 12, display: 'block' }} />
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

  const hasPending = data.payouts.some(p => p.status === 'pending')
  const connectOk  = data.connectStatus === 'active'
  const state: WState =
    hasPending                                    ? 'pending'
    : (!data.hasAccount || !connectOk)            ? 'nocfg'
    : data.availableCents < data.thresholdCents   ? 'below'
    : 'ready'

  const missing = Math.max(0, data.thresholdCents - data.availableCents)

  const paymentAccountCard = (
    <div className="op-card card-pad">
      <div className="card-pad__hd"><h3>{t('accountTitle')}</h3></div>
      {connectOk ? (
        <div className="pm-linked">
          <span className="pm-linked__ic"><span className="ms">account_balance</span></span>
          <div className="pm-linked__m">
            <b>{t('bankAccount')}<span className="pm-linked__ok"><span className="ms">check</span>{t('verified')}</span></b>
            {/* IBAN is Stripe-managed — Grubano NEVER stores/fabricates it (no invented digits). */}
            <div className="iban">{t('ibanManaged')}</div>
          </div>
        </div>
      ) : (
        <div className="pm-cta">
          <span className="ms">add_card</span>
          <div className="pm-cta__m">
            <b>{t('setupTitle')}</b>
            <span>{t('setupBody')}</span>
            <button type="button" className="op-btn-primary" onClick={onboard} disabled={busy || !data.connectEnabled}>
              <span className="ms">add_card</span>{data.connectEnabled ? t('setupCta') : t('comingCta')}
            </button>
          </div>
        </div>
      )}
      <div className="info-note"><span className="ms">shield</span><span>{t('stripeNote')}</span></div>
    </div>
  )

  const historyCard = (
    <div className="op-card card-pad">
      <div className="card-pad__hd"><h3>{t('historyTitle')}</h3></div>
      {data.payouts.length > 0 ? (
        <>
          <div className="wh-thead"><span>{t('colDate')}</span><span>{t('colRef')}</span><span>{t('colAmount')}</span></div>
          {data.payouts.map(p => (
            <div className="wh-row" key={p.id}>
              <span className="wh-date">{dateFmt.format(new Date(p.paidAt ?? p.createdAt))}</span>
              <div className="wh-mid"><b>{t('bankTransfer')}</b><div className="ref">#{p.id}</div></div>
              <div className="wh-r">
                <span className="wh-amt">{fmt(p.amountCents)}</span>
                <span className={`wh-status ${p.status === 'paid' ? 'paid' : 'progress'}`}>
                  <span className="ms">{p.status === 'paid' ? 'check_circle' : 'sync'}</span>
                  {p.status === 'paid' ? t('stPaid') : t('stProgress')}
                </span>
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className="op-empty"><span className="ms">receipt_long</span><b>{t('histEmptyTitle')}</b><span>{t('histEmptyBody')}</span></div>
      )}
      <div className="info-note"><span className="ms">info</span><span>{t('serverNote')}</span></div>
    </div>
  )

  return (
    <section>
      <div className="op-dash__head">
        <div><h1 className="op-dash__title">{t('title')}</h1><p className="op-dash__sub">{t('subtitle')}</p></div>
        <span className="ro-badge"><span className="ms">bolt</span>{t('selfService')}</span>
      </div>

      {flash && <div className="ro-banner"><span className="ms">info</span><div className="m"><p>{flash}</p></div></div>}

      {/* DAC7 fiscal capture (P4.3 ÉTAPE 6) — shown when the withdrawal needs the courier's
          self-declaration. Saves via the SHARED /api/operator/dac7 route, then the courier retries. */}
      {fiscalOpen && (
        <div className="op-card card-pad wd-fiscal">
          <div className="card-pad__hd"><h3>{t('fiscalTitle')}</h3></div>
          <p className="wd-fiscal__hint">{t('fiscalHint')}</p>
          <div className="wd-fiscal__grid">
            <label>{t('fSellerType')}
              <select value={fiscal.sellerType} onChange={e => setFiscal(f => ({ ...f, sellerType: e.target.value }))}>
                <option value="">{t('fChoose')}</option>
                <option value="individual">{t('fIndividual')}</option>
                <option value="entity">{t('fEntity')}</option>
              </select>
            </label>
            <label>{t('fAddress')}
              <input type="text" value={fiscal.registeredAddress} maxLength={300} onChange={e => setFiscal(f => ({ ...f, registeredAddress: e.target.value }))} />
            </label>
            <label>{t('fTaxId')}
              <input type="text" value={fiscal.taxId} maxLength={40} onChange={e => setFiscal(f => ({ ...f, taxId: e.target.value }))} />
            </label>
            <label>{t('fTaxCountry')}
              <input type="text" value={fiscal.taxIdCountry} maxLength={2} placeholder="FR" onChange={e => setFiscal(f => ({ ...f, taxIdCountry: e.target.value.toUpperCase() }))} />
            </label>
            {fiscal.sellerType === 'individual' && (
              <label>{t('fDob')}
                <input type="date" value={fiscal.dateOfBirth} onChange={e => setFiscal(f => ({ ...f, dateOfBirth: e.target.value }))} />
              </label>
            )}
          </div>
          <div className="wd-fiscal__actions">
            <button type="button" className="op-btn-ghost" onClick={() => setFiscalOpen(false)} disabled={fiscalBusy}>{t('fCancel')}</button>
            <button type="button" className="op-btn-primary" onClick={submitFiscal} disabled={fiscalBusy}><span className="ms">save</span>{t('fSave')}</button>
          </div>
          <div className="info-note"><span className="ms">info</span><span>{t('fiscalNote')}</span></div>
        </div>
      )}

      {/* balance / action card — state-derived */}
      <div className="op-card wd">
        <div className="wd__label"><span className="ms">account_balance_wallet</span>{t('available')}</div>
        <div className={`wd__v${state === 'below' || state === 'nocfg' ? ' muted' : ''}`}>{fmt(data.availableCents)}</div>
        <div className="wd__meta">{t('thresholdMeta')} <b className="mono">{fmt(data.thresholdCents)}</b></div>

        <div className="wd__amt">
          {state === 'ready' && (
            <>
              <div className="wd__amtbox">
                <button type="button" className="op-btn-primary" onClick={withdraw} disabled={busy || !data.payoutEnabled}>
                  <span className="ms">send</span>
                  {data.payoutEnabled ? t('withdrawAmount', { amount: fmt(data.availableCents) }) : t('comingCta')}
                </button>
              </div>
              <div className="wd__hint"><span className="ms">bolt</span>{t('payoutHint')}</div>
            </>
          )}
          {state === 'below' && (
            <>
              <button type="button" className="op-btn-primary" disabled><span className="ms">lock</span>{t('unavailable')}</button>
              <div className="wd__hint warn"><span className="ms">info</span>{t('missing', { amount: fmt(missing) })}</div>
            </>
          )}
          {state === 'nocfg' && (
            <>
              <button type="button" className="op-btn-primary" disabled><span className="ms">lock</span>{t('configureFirst')}</button>
              <div className="wd__hint"><span className="ms">info</span>{t('configureHint')}</div>
            </>
          )}
          {state === 'pending' && (
            <>
              <button type="button" className="op-btn-primary" disabled><span className="ms">hourglass_top</span>{t('inProgress')}</button>
              <div className="wd__hint"><span className="ms">info</span>{t('inProgressHint')}</div>
            </>
          )}
        </div>
      </div>

      {paymentAccountCard}
      {historyCard}
    </section>
  )
}
