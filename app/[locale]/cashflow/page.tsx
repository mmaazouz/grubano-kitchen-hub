'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import './cashflow.css'

// ── /cashflow — operator TREASURY FORECAST (prévision de trésorerie) — CD v1 LOT 2
// (Notion 390fd2c9-…-fba). Presentation-only re-skin of the legacy mock page.
//
// 🔒 CÂBLAGE REPORTÉ (décision Mohammed). Il n'existe AUCUN backend de projection réel
// (versements attendus / charges connues / historique → BankTransaction, LedgerEntry,
// échéances : rien de tout cela n'est câblé). L'ancien écran était 100 % maquette
// (const en dur) → RETIRÉE. Cet écran est rendu en APERÇU HONNÊTE COMPLET :
//   • bandeau « Prévision de trésorerie — bientôt visible »
//   • structure CD dessinée (solde, horizon 30/60/90 j, courbe + bande d'incertitude +
//     seuil de sécurité + points bas, alerte runway, entrées/sorties Confirmé/Estimé)
//   • TOUS les montants = tiret « — », étiquetés estimation / non garanti
//   • AUCUN chiffre fabriqué n'est présenté comme réel.
// La bascule d'horizon reste (logique produit) mais ne fait que ré-étiqueter l'aperçu.
// Material Symbols (.ms), pas lucide. Sidebar « Finances » déjà active via la coquille.

const DASH = '—'

type Horizon = '30' | '60' | '90'

export default function CashflowPage() {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [horizon, setHorizon] = useState<Horizon>('30')

  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
    [locale],
  )

  const days = horizon === '30' ? 30 : horizon === '60' ? 60 : 90

  return (
    <section className="op-cash">
      {/* head */}
      <div className="op-cash__topbar">
        <div>
          <h1>{t('cash.title')}</h1>
          <p>{t('cash.subtitle', { days })} · {dateLabel}</p>
        </div>
        <button type="button" className="op-refresh" onClick={() => location.reload()}>
          <span className="ms" aria-hidden="true">refresh</span>{t('dash.refresh')}
        </button>
      </div>

      {/* preview banner — câblage reporté (honest) */}
      <div className="op-cash__preview" role="note">
        <span className="ms" aria-hidden="true">insights</span>
        <div className="m">
          <b>{t('cash.preview.title')}</b>
          <p>{t('cash.preview.body')}</p>
        </div>
        <span className="tag-estimate">{t('cash.tag.soon')}</span>
      </div>

      {/* hero — solde actuel (value withheld until wired) */}
      <div className="op-card op-cash__hero">
        <div className="hero-top">
          <div>
            <span className="lbl">{t('cash.balanceLabel')}</span>
            <div className="bal mono" aria-label={t('cash.notAvailable')}>{DASH}</div>
            <span className="asof">{t('cash.asofPending')}</span>
          </div>
          <div className="hero-top__right">
            <div className="op-period" role="tablist" aria-label={t('cash.horizonLabel')}>
              {(['30', '60', '90'] as Horizon[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  role="tab"
                  aria-selected={horizon === h}
                  className={horizon === h ? 'is-active' : undefined}
                  onClick={() => setHorizon(h)}
                >
                  {t('cash.horizon', { days: h })}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="synthesis">
          <span className="ms" aria-hidden="true">info</span>
          <span>{t('cash.synthesisPending', { days })}</span>
        </div>
      </div>

      {/* projection chart — structure drawn, projection = preview illustration */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head">
          <h2><span className="ms" aria-hidden="true">show_chart</span>{t('cash.projTitle')}</h2>
          <span className="cap">{t('cash.projCap', { days })}</span>
          <span className="tag-estimate">{t('cash.tag.estimate')}</span>
        </div>

        {/* stats — amounts withheld (dash) */}
        <div className="op-chart__stats">
          <div className="stat">
            <span>{t('cash.stat.inflow')}</span>
            <b className="mono">{DASH}</b>
          </div>
          <div className="stat">
            <span>{t('cash.stat.outflow')}</span>
            <b className="mono">{DASH}</b>
          </div>
          <div className="stat">
            <span>{t('cash.stat.projected')}</span>
            <b className="mono">{DASH}</b>
            <span className="range mono">{t('cash.stat.rangePending')}</span>
          </div>
        </div>

        {/* legend — CD verbatim */}
        <div className="op-chart__legend">
          <span><i className="sw" />{t('cash.legend.line')}</span>
          <span><i className="sw band" />{t('cash.legend.band')}</span>
          <span><i className="sw thr" />{t('cash.legend.threshold')}</span>
        </div>

        {/* SVG — grid + safety threshold + uncertainty band + preview dashed line +
            low-point markers. No absolute euro value is rendered on the axis; the
            projection line is an illustrative PREVIEW (dashed) with a « bientôt » badge. */}
        <div className="op-chart-wrap" dir="ltr">
          <div className="op-chart-inner">
            <svg viewBox="0 0 640 200" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('cash.chartAlt')}>
              {/* horizontal grid */}
              <line x1="46" y1="10" x2="620" y2="10" stroke="var(--op-border)" strokeWidth="1" />
              <line x1="46" y1="59.1" x2="620" y2="59.1" stroke="var(--op-border)" strokeWidth="1" />
              <line x1="46" y1="108.2" x2="620" y2="108.2" stroke="var(--op-border)" strokeWidth="1" />
              <line x1="46" y1="157.3" x2="620" y2="157.3" stroke="var(--op-border)" strokeWidth="1" />
              <line x1="46" y1="190" x2="620" y2="190" stroke="var(--op-border-strong)" strokeWidth="1" />
              {/* safety threshold (dashed warning) — labelled, no amount */}
              <line x1="46" y1="140.9" x2="620" y2="140.9" stroke="var(--op-warning)" strokeWidth="1.5" strokeDasharray="5,4" />
              {/* uncertainty band (illustrative shape, .32 opacity → visibly a preview) */}
              <polygon
                points="46,69.2 141.7,85.5 237.3,23.4 333,98.7 390.4,134.0 428.7,104.7 524.3,40.4 620,25.7 620,75.7 524.3,84.4 428.7,142.7 390.4,170.0 333,130.7 237.3,47.4 141.7,101.5 46,77.2"
                fill="rgba(46,120,240,.10)" stroke="rgba(46,120,240,.25)" strokeWidth="1" strokeDasharray="4,3"
              />
              {/* projection PREVIEW line — dashed + reduced opacity so it reads as illustrative */}
              <polyline
                points="46,73.2 141.7,93.5 237.3,35.4 333,114.7 390.4,152.0 428.7,123.7 524.3,62.4 620,50.7"
                fill="none" stroke="var(--op-muted-2)" strokeWidth="2" strokeDasharray="6,5" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"
              />
              {/* low-point markers (structure) */}
              <line x1="390.4" y1="152.0" x2="390.4" y2="196" stroke="var(--op-muted-2)" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx="390.4" cy="152.0" r="5" fill="none" stroke="var(--op-muted-2)" strokeWidth="1.5" strokeDasharray="2,2" />
            </svg>
            <div className="op-chart__wm">
              <span className="ms" aria-hidden="true">query_stats</span>{t('cash.chartWatermark')}
            </div>
          </div>
        </div>
        <div className="op-chart__xaxis" aria-hidden="true">
          <span>{t('cash.axis.now')}</span><span>·</span><span>·</span><span>·</span><span>+{days}&nbsp;j</span>
        </div>
      </div>

      {/* runway alert — structure, no fabricated amount */}
      <div className="op-card op-cash__alert" role="note">
        <span className="ms alert-ic" aria-hidden="true">warning</span>
        <div className="m">
          <b>{t('cash.alert.title')}</b>
          <p>{t('cash.alert.body')}</p>
        </div>
        <span className="tag-estimate">{t('cash.tag.estimateShort')}</span>
      </div>

      {/* entrées / sorties prévues — structure, amounts withheld */}
      <div className="op-row2">
        <div className="op-card">
          <div className="op-card__head">
            <h2><span className="ms" aria-hidden="true">call_received</span>{t('cash.inflowTitle')}</h2>
            <span className="cap">{t('cash.inflowCap')}</span>
          </div>
          <div className="op-cash__flow">
            {[0, 1, 2].map((i) => (
              <div className="row" key={i}>
                <span className="date mono">{DASH}</span>
                <div className="m"><b>{t('cash.inflowRow')}</b><span className="tag-estimated">{t('cash.tag.estimated')}</span></div>
                <span className="amt mono">{DASH}</span>
              </div>
            ))}
          </div>
          <div className="op-cash__flow__foot">
            <span className="ms" aria-hidden="true">lock</span>{t('cash.flowFoot')}
          </div>
        </div>

        <div className="op-card">
          <div className="op-card__head">
            <h2><span className="ms" aria-hidden="true">call_made</span>{t('cash.outflowTitle')}</h2>
            <span className="cap">{t('cash.outflowCap')}</span>
          </div>
          <div className="op-cash__flow">
            {[0, 1, 2].map((i) => (
              <div className="row" key={i}>
                <span className="date mono">{DASH}</span>
                <div className="m"><b>{t('cash.outflowRow')}</b><span className="tag-estimated">{t('cash.tag.estimated')}</span></div>
                <span className="amt mono">{DASH}</span>
              </div>
            ))}
          </div>
          <div className="op-cash__flow__foot">
            <span className="ms" aria-hidden="true">lock</span>{t('cash.flowFoot')}
          </div>
        </div>
      </div>
    </section>
  )
}
