'use client'

/**
 * /pricing — operator TARIFICATION & PREMIUM screen. VERBATIM CD v1 LOT 3
 * (Notion 390fd2c9-…-92708528). ⚠️ ZONE ARGENT (frais client + facturation).
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome).
 * /pricing is NOT a sidebar entry → no rail item is force-active (acceptable —
 * it is a config screen; « Réglages »/« Plus » remain the nearest nav). This
 * component renders ONLY the screen content = a <section> inside op-content.
 *
 * 🔒 PRESENTATION ONLY — this route replaces the legacy presentation-only mock;
 * there is NO real settings/billing endpoint (that is separate dev / gate-2).
 *   • Section A (fees + per-channel adjustment) holds PRESENTATION defaults —
 *     the fields are editable but « Enregistrer les réglages » is INERT (no write,
 *     no fetch). Values carry className="mono".
 *   • Section B plan prices are INDICATIVE (« 29 € /mois indicatif »). The REAL
 *     commission + advantages are resolved server-side (lib/commission.ts) — NEVER
 *     hardcoded here; the honest callouts say so explicitly.
 *   • The « Passer à Premium » modal is drawn « prête » but INERT: open/close is
 *     local React state — NO fetch, NO fake success. The real Stripe billing flow
 *     is gate-2 / separate dev (« jamais simulé »). « Confirmer » only closes.
 *
 * States are driven by the SAME real source as the shell (GET /api/establishments):
 * N=0 → onboarding · loading → skeleton · error → error card · loaded → screen.
 * There is no « vide » state (there is always a default settings set + a current plan).
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import './pricing.css'

interface Establishment { id: string; name: string; city: string | null; isActive: boolean }

export default function PricingPage() {
  const t = useTranslations('operator')

  const [establishments, setEstablishments] = useState<Establishment[]>([])
  const [stage, setStage] = useState<'loading' | 'error' | 'ready'>('loading')

  // « Passer à Premium » modal — VISUAL / INERT (gate-2). Local UI state only, no network.
  const [premiumOpen, setPremiumOpen] = useState(false)
  const openPremiumModal = () => setPremiumOpen(true)
  const closePremiumModal = () => setPremiumOpen(false)

  useEffect(() => {
    fetch('/api/establishments', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setEstablishments(Array.isArray(d.establishments) ? d.establishments : [])
        setStage('ready')
      })
      .catch(() => setStage('error'))
  }, [])

  // ── loading skeleton (mirrors CD .op-skel) ──
  if (stage === 'loading') {
    return (
      <section aria-busy="true">
        <div style={{ marginBottom: 18 }}><span className="op-sk" style={{ width: 220, height: 22 }} /></div>
        <div className="op-card" style={{ marginBottom: 18 }}>
          <div className="op-card__head"><span className="op-sk" style={{ width: 160, height: 14 }} /></div>
          <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            <span className="op-sk" style={{ width: '100%', height: 44, borderRadius: 8 }} />
            <span className="op-sk" style={{ width: '100%', height: 44, borderRadius: 8 }} />
            <span className="op-sk" style={{ width: '100%', height: 44, borderRadius: 8 }} />
          </div>
        </div>
        <div className="op-card" style={{ marginBottom: 18 }}>
          <div className="op-card__head"><span className="op-sk" style={{ width: 200, height: 14 }} /></div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="op-sk" style={{ width: '100%', height: 34 }} />
            <span className="op-sk" style={{ width: '100%', height: 34 }} />
            <span className="op-sk" style={{ width: '100%', height: 34 }} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── error ──
  if (stage === 'error') {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('pricing.errorTitle')}</h2>
          <p>{t('dash.errorBody')}</p>
          <button type="button" className="op-btn-primary" onClick={() => location.reload()}>
            <span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}
          </button>
        </div>
      </div></section>
    )
  }

  // ── onboarding (N=0) — no establishment yet ──
  if (establishments.length === 0) {
    return (
      <section><div className="op-center">
        <div className="op-onb__card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <h1>{t('pricing.onbTitle')}</h1>
          <p>{t('pricing.onbBody')}</p>
          <button type="button" className="op-onb__cta"><span className="ms" aria-hidden="true">add_business</span>{t('pricing.onbCta')}</button>
          <div className="op-onb__steps">
            <div className="step"><span className="n">1</span><b>{t('pricing.onbStep1Title')}</b><span>{t('pricing.onbStep1Body')}</span></div>
            <div className="step"><span className="n">2</span><b>{t('pricing.onbStep2Title')}</b><span>{t('pricing.onbStep2Body')}</span></div>
            <div className="step"><span className="n">3</span><b>{t('pricing.onbStep3Title')}</b><span>{t('pricing.onbStep3Body')}</span></div>
          </div>
        </div>
      </div></section>
    )
  }

  // aggregate label shown only when the operator has multiple establishments (multi scale)
  const isMulti = establishments.length >= 2
  const premiumTarget = establishments[0]?.name ?? ''

  // ── loaded ──
  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('pricing.title')}</h1>
          <p className="op-dash__sub">
            {isMulti && (
              <span className="op-agg-label">{t('pricing.aggLabel', { count: establishments.length })} · </span>
            )}
            {t('pricing.subtitle')}
          </p>
        </div>
      </div>

      {/* honest ZONE ARGENT callout — the final calc (commission, TVA) stays server-side */}
      <div className="op-callout" style={{ marginBottom: 18 }}>
        <span className="ms" aria-hidden="true">payments</span>
        <p>{t('pricing.sensitiveNote')}</p>
      </div>

      {/* ══ Section A — Tarification de l'établissement (PRESENTATION defaults, save INERT) ══ */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">sell</span>{t('pricing.sectionA')}</h2></div>
        <div className="pricing-fields">
          <div className="pf"><label>{t('pricing.deliveryFee')}</label><input className="op-input mono" defaultValue="2,90" inputMode="decimal" /></div>
          <div className="pf"><label>{t('pricing.minOrder')}</label><input className="op-input mono" defaultValue="15,00" inputMode="decimal" /></div>
          <div className="pf"><label>{t('pricing.packagingFee')}</label><input className="op-input mono" defaultValue="0,50" inputMode="decimal" /></div>
        </div>
        <div className="channel-adjust">
          <div className="channel-adjust__label">{t('pricing.channelAdjust')}</div>
          <div className="channel-row">
            <span className="ms" aria-hidden="true">two_wheeler</span>
            <span className="cname">{t('pricing.channelDelivery')}</span>
            <input className="op-input mono" defaultValue="+5" inputMode="numeric" /><span className="pct">%</span>
          </div>
          <div className="channel-row">
            <span className="ms" aria-hidden="true">shopping_bag</span>
            <span className="cname">{t('pricing.channelPickup')}</span>
            <input className="op-input mono" defaultValue="0" inputMode="numeric" /><span className="pct">%</span>
          </div>
          <div className="channel-row">
            <span className="ms" aria-hidden="true">table_restaurant</span>
            <span className="cname">{t('pricing.channelDinein')}</span>
            <input className="op-input mono" defaultValue="0" inputMode="numeric" /><span className="pct">%</span>
          </div>
          <div className="channel-note">
            <span className="ms" aria-hidden="true">info</span>
            <p>{t('pricing.channelNote')}</p>
          </div>
        </div>
        {/* INERT: presentation-only re-skin — no settings write endpoint yet (separate dev). */}
        <div className="pricing-save">
          <button type="button" className="op-btn-primary" disabled aria-disabled="true">
            <span className="ms" aria-hidden="true" style={{ fontSize: 16 }}>check</span>{t('pricing.save')}
          </button>
        </div>
      </div>

      {/* ══ Section B — Abonnement Grubano (Standard vs Premium) ══ */}
      <div className="op-card">
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">workspace_premium</span>{t('pricing.sectionB')}</h2></div>
        <div style={{ padding: 18 }}>
          <div className="plans-grid">
            {/* Standard — current plan */}
            <div className="plan-card">
              <div className="plan-card__top"><span className="plan-name">{t('pricing.planStandard')}</span><span className="plan-badge">{t('pricing.currentPlan')}</span></div>
              <div className="plan-price">{t('pricing.included')}</div>
              <div className="plan-feats">
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.stdFeat1')}</span></div>
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.stdFeat2')}</span></div>
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.stdFeat3')}</span></div>
                <div><span className="ms dim" aria-hidden="true">radio_button_unchecked</span><span className="muted">{t('pricing.stdFeat4')}</span></div>
              </div>
              <button type="button" className="op-btn-ghost" style={{ width: '100%', textAlign: 'center' }} disabled aria-disabled="true">{t('pricing.currentPlan')}</button>
            </div>

            {/* Premium — recommended, INDICATIVE price */}
            <div className="plan-card premium">
              <div className="plan-card__top"><span className="plan-name">{t('pricing.planPremium')}</span><span className="plan-badge premium-badge">{t('pricing.recommended')}</span></div>
              <div className="plan-price">29&nbsp;€<span>{t('pricing.perMonthIndicative')}</span></div>
              <div className="plan-feats">
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.premFeat1')}</span></div>
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.premFeat2')}</span></div>
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.premFeat3')}</span></div>
                <div><span className="ms" aria-hidden="true">check_circle</span><span>{t('pricing.premFeat4')}</span></div>
              </div>
              <button type="button" className="op-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={openPremiumModal}>
                <span className="ms" aria-hidden="true">arrow_upward</span>{t('pricing.upgradeCta')}
              </button>
            </div>
          </div>
          {/* honest: real commission/advantages depend on the contract (server-side) */}
          <div className="op-callout warn" style={{ marginTop: 16 }}>
            <span className="ms" aria-hidden="true">info</span>
            <p>{t('pricing.planNote')}</p>
          </div>
        </div>
      </div>

      {/* ══ « Passer à Premium » modal — VISUAL / INERT. No fetch, no fake success. ══ */}
      <div className={`op-modal-backdrop${premiumOpen ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) closePremiumModal() }}>
        <div className="op-modal" role="dialog" aria-modal="true">
          <div className="op-modal__head">
            <h3>{t('pricing.upgradeCta')}</h3>
            <button type="button" className="op-modal__close" onClick={closePremiumModal} aria-label={t('pricing.modalCancel')}><span className="ms" aria-hidden="true">close</span></button>
          </div>
          <div className="op-modal__body">
            <p>{t('pricing.modalRecap', { establishment: premiumTarget })}</p>
            {/* HONEST: real commission + first-billing date confirmed before any charge. */}
            <div className="op-callout">
              <span className="ms" aria-hidden="true">info</span>
              <p>{t('pricing.modalNote')}</p>
            </div>
          </div>
          <div className="op-modal__foot">
            <button type="button" className="op-btn-ghost" onClick={closePremiumModal}>{t('pricing.modalCancel')}</button>
            {/* INERT: no billing call (gate-2 / separate dev). « Confirmer » only closes — jamais simulé. */}
            <button type="button" className="op-btn-primary" onClick={closePremiumModal}>
              <span className="ms" aria-hidden="true">workspace_premium</span>{t('pricing.modalConfirm')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
