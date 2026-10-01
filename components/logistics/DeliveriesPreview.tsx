'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

// ── <DeliveriesPreview /> — operator LIVRAISONS, honest APERÇU (CD v1 LOT 5, écran 2,
// Notion 390fd2c9-…-b6ab). Rendered on /deliveries when the courier flag
// (LOGISTICS_MISSIONS_ENABLED) is OFF — the DEFAULT. Presentation-only re-skin of the
// frozen CD to --op-, UNDER the navy OperatorShell (founder-approved exception).
//
// 🔒 HONESTY (écran gated, réseau coursier NON actif) :
//   • bandeau « Bientôt » visible (état vide ET chargé),
//   • suivi GPS = placeholder hachuré, AUCUNE carte / position / trace live,
//   • rémunération du coursier « Bientôt actif », NON active (aucun paiement câblé,
//     aucun faux virement),
//   • tous les chiffres / ETA / montants sont ILLUSTRATIFS et ÉTIQUETÉS « exemple »
//     (jamais présentés comme des données réelles),
//   • tous les boutons d'action sont INERTES (aucun fetch, aucune mutation).
// Aucun appel réseau. La vraie liste Mission se branchera quand le flag s'ouvrira
// (côté RequestDelivery) — ici on ne fabrique aucune donnée réelle.

type Stage = 'assigned' | 'route' | 'picked' | 'delivering' | 'waiting'

interface DemoDelivery {
  num: string
  cust: string
  addr: string
  addrFull: string
  courier: string | null
  vehicleIcon: string // Material Symbols glyph
  stage: Stage
  stageLabel: string  // i18n key suffix
  eta: string         // clock time, illustrative
  etaRel: string      // relative, i18n key suffix
  phone: string
}

// Illustrative example data ONLY — clearly labelled « exemple » in the UI, never
// presented as a real delivery. No fetch, no real Mission is read here.
const DEMO: DemoDelivery[] = [
  { num: '#1042', cust: 'Sophie Martin', addr: '12 rue des Lilas, 75011', addrFull: '12 rue des Lilas, Apt 4B — 75011 Paris', courier: 'Thomas B.', vehicleIcon: 'sports_motorsports', stage: 'delivering', stageLabel: 'stageDelivering', eta: '19:42', etaRel: 'etaIn6', phone: '06 11 22 33 44' },
  { num: '#1044', cust: 'Amine Lahlou', addr: '45 rue de Rivoli, 75004', addrFull: '45 rue de Rivoli — 75004 Paris', courier: 'Karim T.', vehicleIcon: 'directions_bike', stage: 'picked', stageLabel: 'stagePicked', eta: '20:05', etaRel: 'etaIn14', phone: '06 22 33 44 55' },
  { num: '#1038', cust: 'Julie Roussel', addr: '3 rue Oberkampf, 75011', addrFull: '3 rue Oberkampf — 75011 Paris', courier: 'Nadia F.', vehicleIcon: 'sports_motorsports', stage: 'route', stageLabel: 'stageRoute', eta: '20:15', etaRel: 'etaIn24', phone: '06 33 44 55 66' },
  { num: '#1036', cust: 'Marc Dubois', addr: '8 av. Foch, 75016', addrFull: '8 av. Foch — 75016 Paris', courier: null, vehicleIcon: 'hourglass_empty', stage: 'waiting', stageLabel: 'stageWaiting', eta: '—', etaRel: 'etaTbd', phone: '' },
]

// mini-stepper node/line completion by stage (5 nodes / 4 lines).
const STEP_INDEX: Record<Stage, number> = { assigned: 0, route: 1, picked: 2, delivering: 3, waiting: -1 }

export default function DeliveriesPreview() {
  const t = useTranslations('operator.deliveries')
  const [open, setOpen] = useState<DemoDelivery | null>(null)

  // 5-step full stepper for the modal (based on the selected delivery's stage).
  const steps: { key: string; icon: string }[] = [
    { key: 'stepAssigned', icon: 'check' },
    { key: 'stepRoute', icon: 'check' },
    { key: 'stepPicked', icon: 'check' },
    { key: 'stepDelivering', icon: 'moped' },
    { key: 'stepDelivered', icon: 'flag' },
  ]
  const curIdx = open ? (open.stage === 'waiting' ? -1 : STEP_INDEX[open.stage]) : 3

  return (
    <section className="op-del">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('sub')}</p>
        </div>
      </div>

      {/* Honest « Bientôt » banner — kept visible while the courier network is not live */}
      <div className="preview-banner">
        <span className="ms">local_shipping</span>
        <div className="m">
          <b>{t('bannerTitle')}</b>
          <p>{t('bannerBodyPreview')}</p>
        </div>
        <span className="tag">{t('soon')}</span>
      </div>

      {/* Stat strip — ALL figures are illustrative examples (labelled). */}
      <div className="op-card stat-strip" style={{ marginBottom: 18 }}>
        <div className="stat"><span className="lbl">{t('statInProgress')}</span><b className="mono">4</b></div>
        <div className="stat"><span className="lbl">{t('statAvgTime')}</span><b className="mono">27 min</b></div>
        <div className="stat"><span className="lbl">{t('statActiveCouriers')}</span><b className="mono">3</b></div>
        <div className="stat"><span className="lbl">{t('statLate')}</span><b className="mono alert">1</b></div>
      </div>
      <p className="op-dash__sub" style={{ margin: '-8px 0 16px' }}>{t('exampleNote')}</p>

      <div className="delivery-list">
        {DEMO.map((d) => {
          const idx = d.stage === 'waiting' ? -1 : STEP_INDEX[d.stage]
          return (
            <div className="delivery-card" key={d.num}>
              <div className="dc-top">
                <span className="dc-num">{d.num}</span>
                <span className="dc-cust"><span className="ms">person</span>{d.cust}</span>
                <span className="dc-addr"><span className="ms">location_on</span>{d.addr}</span>
              </div>
              {d.courier ? (
                <span className="courier-chip"><span className="ms">{d.vehicleIcon}</span>{d.courier} · {t('exampleTag')}</span>
              ) : (
                <span className="courier-chip waiting"><span className="ms">hourglass_empty</span>{t('waitingAssign')}</span>
              )}
              <div className="dc-foot">
                <div className={`mini-stepper${d.stage === 'waiting' ? ' waiting' : ''}`}>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <span key={`n${n}`} style={{ display: 'contents' }}>
                      {n > 0 && <span className={`line${idx >= n ? ' done' : ''}`} />}
                      <span className={`node${idx > n ? ' done' : idx === n ? ' current' : ''}`} />
                    </span>
                  ))}
                </div>
                <span className={`stage-label${d.stage === 'waiting' ? ' waiting' : ''}`}>{t(d.stageLabel)}</span>
                <span className="dc-eta"><b>{d.eta}</b><span>{t(d.etaRel)}</span></span>
                <button type="button" className="dc-track-btn" onClick={() => setOpen(d)}>
                  <span className="ms">visibility</span>{t('view')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* DETAIL modal — presentation only (local state). No live GPS; payout inactive. */}
      {open && (
        <div className="op-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <div className="op-modal">
            <div className="op-modal__head">
              <div className="op-modal__headtext">
                <h3>{open.num}</h3>
                <span className="sub">{open.cust} · {t('exampleTag')}</span>
              </div>
              <button type="button" className="op-modal__close" onClick={() => setOpen(null)}><span className="ms">close</span></button>
            </div>
            <div className="op-modal__body">
              <div className="full-stepper">
                {steps.map((s, i) => (
                  <div key={s.key} className={`step${i < curIdx ? ' done' : i === curIdx ? ' current' : ''}`}>
                    <span className="ln" />
                    <span className="dot"><span className="ms">{i < curIdx ? 'check' : s.icon}</span></span>
                    <span>{t(s.key)}</span>
                  </div>
                ))}
              </div>

              <div className="dt-eta-box">
                <span className="ic"><span className="ms">schedule</span></span>
                <div className="m">
                  <b>{t('etaEstimated')}</b>
                  <span className="dt-eta-val">{open.eta === '—' ? t('etaTbd') : `${open.eta} · ${t(open.etaRel)}`}</span>
                </div>
              </div>

              {open.courier && (
                <div className="dt-info-box">
                  <div className="row"><span className="ms">{open.vehicleIcon}</span><b>{open.courier}</b><span>· {t('exampleTag')}</span></div>
                  <div className="row"><span className="ms">call</span><span className="mono">{open.phone}</span></div>
                  <div className="row"><span className="ms">location_on</span><span>{open.addrFull}</span></div>
                </div>
              )}

              {/* Honest hatched GPS placeholder — NO live map, no real position/trace. */}
              <div className="track-preview">
                <span className="tag">{t('previewTag')}</span>
                <span className="ms">map</span>
                <b>{t('gpsSoonTitle')}</b>
                <span>{t('gpsSoonBody')}</span>
              </div>

              <div>
                {/* Delivery fee = illustrative example amount (labelled), NOT a real charge. */}
                <div className="dt-fee-row"><span>{t('feeClient')} · {t('exampleTag')}</span><span>3,50&nbsp;€</span></div>
                {/* Courier payout is INACTIVE — no money moves. */}
                <div className="payout-row">
                  <span>{t('courierPayout')}</span>
                  <span className="payout-inactive"><span className="ms">schedule</span>{t('payoutSoon')}</span>
                </div>
              </div>

              <div className="op-callout">
                <span className="ms">info</span>
                <p>{t('calloutBody')}</p>
              </div>
            </div>
            <div className="op-modal__foot">
              <button type="button" className="op-btn-ghost" onClick={() => setOpen(null)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
