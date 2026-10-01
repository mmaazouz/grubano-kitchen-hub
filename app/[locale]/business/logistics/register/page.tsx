'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import './logistics-apply-form.css'

// ── LO5 · /business/logistics/register — self-serve courier onboarding (RE-SKIN) ──
// CD marketing language (gb-foundation clair, accent AMBRE --gb-lo / gradient
// --gb-ride, Material Symbols, scoped .lo-mkt) replaces the old PartnerChrome +
// design-system (Card/Button/Input) + lucide-react. Exact calque of the AF8 form
// pattern (.af-mkt → .lo-mkt). The REAL flow (Slice 1, Agent 15) is preserved
// BYTE-IDENTICAL: same state, same ?email/?siren prefill, same honeypot `website`
// + formStartedAt anti-bot, same POST /api/logistics/register body, same
// outcome/officialName/waitlist handling. NO fetch, NO payload, NO network change.
//
// Honesty (CD note + fondateur), like AF8: the CD's fabricated success reference
// (« LIV-2026-00318 ») is removed (the endpoint returns a neutral outcome, no ref);
// the register sends NO e-mail / magic-link, so the CD's "a confirmation e-mail was
// just sent" line is removed; the success is the honest waitlist wording + the
// « no active account, you cannot sign in yet » note (no auto-login); the success
// CTA and the nav back both link to the /business/logistics landing (LO4). The RGPD
// consent links to /legal/confidentialite and the waitlist-terms line to
// /legal/mentions-legales (no invented /legal/cgu page).
// The CSS (logistics-apply-form.css) is imported by this page (the file itself is
// the page — no separate client child), matching the chantier build lesson.

const PARTNER_TYPES = ['independent', 'company'] as const
const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const VEHICLE_TYPES = ['velo', 'scooter', 'voiture', 'camionnette', 'frigorifique'] as const

// Map enum → i18n key suffix (camelCase) for the option labels.
const MISSION_LABEL: Record<(typeof MISSION_TYPES)[number], string> = {
  repas: 'missionRepas',
  produits_fournisseurs: 'missionProduits',
  b2b: 'missionB2b',
  froid: 'missionFroid',
}
const VEHICLE_LABEL: Record<(typeof VEHICLE_TYPES)[number], string> = {
  velo: 'vehicleVelo',
  scooter: 'vehicleScooter',
  voiture: 'vehicleVoiture',
  camionnette: 'vehicleCamionnette',
  frigorifique: 'vehicleFrigorifique',
}
// Material Symbols icon per vehicle (marketing choice tiles).
const VEHICLE_ICON: Record<(typeof VEHICLE_TYPES)[number], string> = {
  velo: 'pedal_bike',
  scooter: 'two_wheeler',
  voiture: 'directions_car',
  camionnette: 'local_shipping',
  frigorifique: 'ac_unit',
}
// Material Symbols icon per mission type (marketing choice tiles).
const MISSION_ICON: Record<(typeof MISSION_TYPES)[number], string> = {
  repas: 'restaurant',
  produits_fournisseurs: 'inventory_2',
  b2b: 'store',
  froid: 'ac_unit',
}

const SYMBOL_COLOR = '/brand/grubano-symbol-color.svg'

export default function LogisticsRegisterPage() {
  const t  = useTranslations('business.logistics')
  const tU = useTranslations('business.logistics.applyUi')
  const tA = useTranslations('addActivity')

  const [partnerType, setPartnerType]   = useState<(typeof PARTNER_TYPES)[number]>('independent')
  const [contactName, setContactName]   = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [siren, setSiren]               = useState('')
  const [missionTypes, setMissionTypes] = useState<string[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([])
  const [zones, setZones]               = useState('')
  const [consent, setConsent]           = useState(false)
  const [website, setWebsite]           = useState('') // honeypot — must stay empty
  const [formStartedAt]                 = useState(() => Date.now())

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)
  // Outcome from the API: 'active' (instantly usable), 'pending' (review), or
  // 'rejected'. `officialName` accompanies an 'active' outcome (greet by the
  // verified registry name).
  const [outcome, setOutcome]           = useState<'active' | 'pending' | 'rejected'>('pending')
  const [officialName, setOfficialName] = useState<string | null>(null)
  // LA — courier activation is gated OFF: a successful registration lands on the
  // WAITLIST (network pre-seeding). `waitlist` (from the API) switches the success copy
  // to the "you're on the list — we build, we'll reach out at launch" message.
  const [waitlist, setWaitlist]         = useState(false)
  // B1.3-C — when arriving from the "add an activity" hub: lock the email to the
  // connected account (carried in ?email) and PREFILL the verified siren (editable).
  // Public self-serve visitors (no ?email) keep the free form.
  const [emailLocked, setEmailLocked] = useState(false)
  const [prefilled, setPrefilled]     = useState(false)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const qEmail = p.get('email')
    const qSiren = p.get('siren')
    if (qEmail) { setContactEmail(qEmail); setEmailLocked(true) }
    if (qSiren) { setSiren(qSiren); setPrefilled(true) }
  }, [])

  // Inline SIREN/SIRET format check (9 or 14 digits, spaces tolerated) — UX only;
  // the server re-validates and is the source of truth.
  // WAVE 3 — le SIREN devient OPTIONNEL pour un indépendant au stade liste
  // d'attente (« informations minimales, pas de KYC ») ; requis pour une société.
  const sirenDigits    = siren.replace(/\s+/g, '')
  const sirenFormatOk  = /^\d{9}$/.test(sirenDigits) || /^\d{14}$/.test(sirenDigits)
  const sirenRequired  = partnerType === 'company'
  const sirenValid     = sirenRequired ? sirenFormatOk : (sirenDigits === '' || sirenFormatOk)
  const showSirenError = siren.trim().length > 0 && !sirenFormatOk

  function toggle(list: string[], setList: (v: string[]) => void, v: string) {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!sirenValid) { setError(t('fieldSirenError')); return }
    if (missionTypes.length === 0) { setError(t('errorMissionRequired')); return }
    if (vehicleTypes.length === 0) { setError(t('errorVehicleRequired')); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/logistics/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerType,
          contactName,
          contactEmail,
          contactPhone: contactPhone || undefined,
          // WAVE 3 — omis quand vide (indépendant en liste d'attente, sans KYC)
          siren: sirenDigits || undefined,
          missionTypes,
          vehicleTypes,
          zones: zones.split(',').map((z) => z.trim()).filter(Boolean),
          consent,
          website,
          formStartedAt,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || t('errorGeneric'))
        return
      }
      const o = data?.outcome
      setOutcome(o === 'active' || o === 'rejected' ? o : 'pending')
      setOfficialName(typeof data?.officialName === 'string' ? data.officialName : null)
      setWaitlist(data?.waitlist === true)
      setDone(true)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Marketing chrome — brand badge + back link to the /business/logistics landing ──
  function Nav() {
    return (
      <nav className="nav">
        <div className="nav__in">
          <Link href="/business/logistics" className="nav__brand">
            <img src={SYMBOL_COLOR} alt="Grubano" />
            <b>Grubano</b>
            <span>{tU('navBadge')}</span>
          </Link>
          <Link href="/business/logistics" className="nav__back">
            <span className="ms">arrow_back</span>{tU('navBack')}
          </Link>
        </div>
      </nav>
    )
  }

  // ── SUCCESS — honest outcome (waitlist / pending / active / rejected). No fabricated
  // reference, no "confirmation e-mail sent" line (this endpoint sends none), no
  // auto-login. Titles/bodies reuse the existing outcome-aware keys; the CTA and the
  // nav back both point to the real /business/logistics landing (no session posed).
  if (done) {
    const title =
      outcome === 'active'   ? t('successTitleActive')   :
      outcome === 'rejected' ? t('successTitleRejected') :
      waitlist               ? t('successTitleWaitlist') : t('successTitle')
    const body =
      outcome === 'active'   ? t('successBodyActive')   :
      outcome === 'rejected' ? t('successBodyRejected') :
      waitlist               ? t('successBodyWaitlist') : t('successBody')
    const icClass =
      outcome === 'active'   ? 'success__ic is-active'   :
      outcome === 'rejected' ? 'success__ic is-rejected' : 'success__ic'
    const icon =
      outcome === 'active'   ? 'verified'  :
      outcome === 'rejected' ? 'info'      : 'mark_email_read'

    return (
      <div className="lo-mkt">
        <Nav />
        <div className="page">
          <div className="success">
            <div className={icClass}><span className="ms">{icon}</span></div>
            <h2>{title}</h2>
            {outcome === 'active' && officialName && (
              <div className="success__badge"><span className="ms">verified</span>{officialName}</div>
            )}
            <p>{body}</p>
            {/* Honest next-steps — no e-mail claim; the waitlist path shows the real path forward. */}
            {outcome !== 'rejected' && (
              <>
                <div className="success__steps">
                  <div className="s"><span className="ms">schedule</span>{tU('successStepReview')}</div>
                  <div className="s"><span className="ms">description</span>{tU('successStepDocs')}</div>
                  <div className="s"><span className="ms">lock_open</span>{tU('successStepShare')}</div>
                </div>
                <p className="success__note">{tU('successNote')}</p>
              </>
            )}
            <div className="success__cta">
              {outcome === 'active' ? (
                <Link href="/auth/magic" className="btn-lo">
                  <span className="ms">login</span>{t('successCtaActive')}
                </Link>
              ) : (
                <Link href="/business/logistics" className="btn-lo">
                  <span className="ms">home</span>{tU('successCta')}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── FORM — fields aligned on the real POST /api/logistics/register payload ─────
  return (
    <div className="lo-mkt">
      <Nav />
      <div className="page">
        <div className="head">
          <span className="eyebrow"><span className="ms">two_wheeler</span>{tU('eyebrow')}</span>
          <h1>{t('registerTitle')}</h1>
          <p>{tU('headSubtitle')}</p>
        </div>

        <div className="wait-note"><span className="ms">schedule</span>{tU('waitNote')}</div>

        <div className="grid">
          {/* Real endpoint: POST /api/logistics/register (unchanged) */}
          <form className="form-card" onSubmit={submit}>

            {/* Honeypot — visually hidden, off-screen, not focusable. A bot fills it → silent OK. */}
            <div aria-hidden="true" className="hp">
              <label>
                Website
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>

            {/* 1 — Vous : contact + partner type */}
            <div className="fsec">
              <div className="fsec__h">
                <span className="fsec__n">1</span>
                <div><b>{tU('secYouTitle')}</b><span>{tU('secYouSub')}</span></div>
              </div>

              {emailLocked && (
                <p className="locked-note">
                  <span className="ms">lock</span>
                  <span>{tA('emailLocked')}{prefilled ? ' ' + tA('prefillNote') : ''}</span>
                </p>
              )}

              <div className="fld">
                <label htmlFor="lo-name">{t('fieldContactName')}</label>
                <input
                  id="lo-name"
                  className="inp"
                  type="text"
                  required
                  autoComplete="name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="row2">
                <div className="fld">
                  <label htmlFor="lo-email">{t('fieldContactEmail')}</label>
                  <input
                    id="lo-email"
                    className="inp"
                    type="email"
                    required
                    autoComplete="email"
                    disabled={emailLocked}
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="lo-phone">{t('fieldContactPhone')} <span className="opt">(facultatif)</span></label>
                  <input
                    id="lo-phone"
                    className="inp mono"
                    type="tel"
                    autoComplete="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="fld">
                <label>{t('fieldPartnerType')}</label>
                <div className="seg">
                  {PARTNER_TYPES.map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPartnerType(pt)}
                      aria-pressed={partnerType === pt}
                      className={`seg__btn${partnerType === pt ? ' on' : ''}`}
                    >
                      {t(pt === 'independent' ? 'partnerTypeIndependent' : 'partnerTypeCompany')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 2 — Votre livraison : missions + vehicles + zones */}
            <div className="fsec">
              <div className="fsec__h">
                <span className="fsec__n">2</span>
                <div><b>{tU('secDeliveryTitle')}</b><span>{tU('secDeliverySub')}</span></div>
              </div>

              <div className="fld">
                <label>{t('fieldMissionTypes')}</label>
                <div className="choices">
                  {MISSION_TYPES.map((m) => {
                    const active = missionTypes.includes(m)
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggle(missionTypes, setMissionTypes, m)}
                        aria-pressed={active}
                        className={`choice${active ? ' on' : ''}`}
                      >
                        <span className="ms">{MISSION_ICON[m]}</span>
                        <b>{t(MISSION_LABEL[m] as 'missionRepas')}</b>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="fld">
                <label>{t('fieldVehicleTypes')}</label>
                <div className="choices">
                  {VEHICLE_TYPES.map((v) => {
                    const active = vehicleTypes.includes(v)
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => toggle(vehicleTypes, setVehicleTypes, v)}
                        aria-pressed={active}
                        className={`choice${active ? ' on' : ''}`}
                      >
                        <span className="ms">{VEHICLE_ICON[v]}</span>
                        <b>{t(VEHICLE_LABEL[v] as 'vehicleVelo')}</b>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="fld">
                <label htmlFor="lo-zones">{t('fieldZones')} <span className="opt">(facultatif)</span></label>
                <input
                  id="lo-zones"
                  className="inp"
                  type="text"
                  placeholder="Lyon, Villeurbanne, 69003"
                  value={zones}
                  onChange={(e) => setZones(e.target.value)}
                />
                <div className="hint"><span className="ms">info</span><span>{t('fieldZonesHint')}</span></div>
              </div>
            </div>

            {/* 3 — Votre statut : SIREN/SIRET (real payload requires it) */}
            <div className="fsec">
              <div className="fsec__h">
                <span className="fsec__n">3</span>
                <div><b>{tU('secStatusTitle')}</b><span>{tU('secStatusSub')}</span></div>
              </div>

              <div className="fld">
                {/* WAVE 3 — optionnel pour un indépendant (liste d'attente) ; requis société */}
                <label htmlFor="lo-siren">{t('fieldSiren')}{!sirenRequired && ` — ${t('fieldSirenOptional')}`}</label>
                <input
                  id="lo-siren"
                  className="inp mono"
                  type="text"
                  required={sirenRequired}
                  inputMode="numeric"
                  placeholder="123 456 789"
                  value={siren}
                  onChange={(e) => setSiren(e.target.value)}
                />
                <div className={`hint${showSirenError ? ' fld-err' : ''}`}>
                  <span className="ms">{showSirenError ? 'error' : 'info'}</span>
                  <span>{showSirenError ? t('fieldSirenError') : sirenRequired ? t('fieldSirenHint') : t('fieldSirenOptionalHint')}</span>
                </div>
                <div className="hint"><span className="ms">verified_user</span><span>{tU('justificatifsHint')}</span></div>
              </div>
            </div>

            {/* 4 — Consentements */}
            <div className="fsec">
              <div className="fsec__h">
                <span className="fsec__n">4</span>
                <div><b>{tU('secConsentTitle')}</b><span>{tU('secConsentSub')}</span></div>
              </div>

              <label className="consent">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {t('consentLabel')}{' '}
                  <Link href="/legal/confidentialite" target="_blank" rel="noopener noreferrer">
                    /legal/confidentialite
                  </Link>
                </span>
              </label>
              <label className="consent" style={{ marginTop: 12 }}>
                <input type="checkbox" required />
                <span>
                  {tU('consentTermsLabel')}{' '}
                  <Link href="/legal/mentions-legales" target="_blank" rel="noopener noreferrer">
                    {tU('consentTermsLink')}
                  </Link>.
                </span>
              </label>
            </div>

            {error && <p className="form-err">{error}</p>}

            <div className="form-foot">
              <button type="submit" className="btn-lo" disabled={submitting}>
                <span className="ms">{submitting ? 'progress_activity' : 'send'}</span>
                {submitting ? t('submitting') : t('submit')}
              </button>
              <span className="note"><span className="ms">lock</span>{tU('footNote')}</span>
            </div>
          </form>

          {/* aside — qualitative only (no €, no rates, no fabricated volumes) */}
          <aside className="aside">
            <div className="aside__promo">
              <span className="ms">groups</span>
              <b>{tU('asidePromoTitle')}</b>
              <span>{tU('asidePromoBody')}</span>
            </div>
            <div className="aside__card">
              <h3><span className="ms">checklist</span>{tU('asideAwaitsTitle')}</h3>
              <ul className="aside__list">
                <li><span className="ms">check_circle</span>{tU('asideAwaits1')}</li>
                <li><span className="ms">check_circle</span>{tU('asideAwaits2')}</li>
                <li><span className="ms">check_circle</span>{tU('asideAwaits3')}</li>
                <li><span className="ms">check_circle</span>{tU('asideAwaits4')}</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
