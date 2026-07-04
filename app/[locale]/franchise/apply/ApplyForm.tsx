'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'

// ── FR8 · client form island (CD marketing --gb-*) ──────────────────────────────────
// Wired to the REAL POST /api/franchise/apply → FranchiseApplication (admin-approved). We
// render ONLY the fields the route persists (name / email / brandName / hasKitchen / siret /
// rib / motivation) — the maquette's project-type, code postal, apport, budget & phone have
// NO column via this lean route (Agent 115 defers city/phone; tested), so they are dropped
// rather than shown as inputs that save nowhere. Success is honest: the REAL record id is the
// reference, and no "confirmation e-mail" is claimed (the route sends none).

const EMAIL_RE = /^\S+@\S+\.\S+$/

export default function ApplyForm({ brands, ratePct }: { brands: string[]; ratePct: number }) {
  const t = useTranslations('franchise.apply')

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [brandName, setBrandName] = useState('')
  const [hasKitchen, setHasKitchen] = useState(false)
  const [siret,     setSiret]     = useState('')
  const [rib,       setRib]       = useState('')
  const [motivation, setMotivation] = useState('')
  const [consent,   setConsent]   = useState(false)

  const [emailLocked, setEmailLocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done,  setDone]  = useState(false)
  const [refId, setRefId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // From the "add an activity" hub the email arrives in ?email= and is LOCKED so the
  // candidacy attaches to the SAME connected account at approval (Agent 115 behaviour).
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email')
    if (e) { setEmail(prev => prev || e); setEmailLocked(true) }
  }, [])

  const s1done = !!(firstName.trim() && lastName.trim() && EMAIL_RE.test(email))
  const s2done = !!brandName.trim()
  const s3done = true // optional section — never blocks
  const s4done = motivation.trim().length >= 10 && consent
  const steps  = [
    { key: 'stepProfile',    done: s1done },
    { key: 'stepProject',    done: s2done },
    { key: 'stepCompany',    done: s3done },
    { key: 'stepMotivation', done: s4done },
  ]
  const activeIdx = steps.findIndex(s => !s.done)
  const canSubmit = s1done && s2done && s4done && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/franchise/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       `${firstName.trim()} ${lastName.trim()}`.trim(),
          email:      email.trim(),
          brandName:  brandName.trim(),
          motivation: motivation.trim(),
          hasKitchen,
          siret:      siret.trim() || undefined,
          rib:        rib.trim()   || undefined,
        }),
      })
      if (res.ok) {
        const d = await res.json().catch(() => null)
        setRefId(d?.application?.id ?? null)
        setDone(true)
        window.scrollTo(0, 0)
      } else {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? t('errorSubmit'))
      }
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fr-mkt">
      <nav className="nav">
        <div className="nav__in">
          <Link className="nav__brand" href="/franchise">
            <img src="/brand/grubano-symbol-color.svg" alt="Grubano" /><b>Grubano</b><span>{t('badge')}</span>
          </Link>
          <Link className="nav__back" href="/franchise"><span className="ms">arrow_back</span>{t('backNav')}</Link>
        </div>
      </nav>

      {done ? (
        <div className="page">
          <div className="success">
            <div className="success__ic"><span className="ms">mark_email_read</span></div>
            <h2>{t('successTitle')}</h2>
            <p>{t('successBody')}</p>
            {refId && (
              <div className="success__ref"><span className="ms">tag</span>{t('refLabel')} {refId}</div>
            )}
            <div className="success__steps">
              <div className="s"><span className="ms">fact_check</span>{t('sStep1')}</div>
              <div className="s"><span className="ms">groups</span>{t('sStep2')}</div>
              <div className="s"><span className="ms">school</span>{t('sStep3')}</div>
            </div>
            <div style={{ marginTop: 28 }}>
              <Link className="btn-zest" href="/franchise"><span className="ms">home</span>{t('sHome')}</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="page">
          <div className="head">
            <span className="eyebrow"><span className="ms">rocket_launch</span>{t('headEyebrow')}</span>
            <h1>{t('headTitle')}</h1>
            <p>{t('headSub')}</p>
          </div>

          <div className="stepper">
            {steps.map((s, i) => (
              <div key={s.key} style={{ display: 'contents' }}>
                <div className={`sp${s.done ? ' done' : i === activeIdx ? ' active' : ''}`}>
                  <span className="sp__d">{s.done ? <span className="ms">check</span> : i + 1}</span>
                  <span className="sp__l">{t(s.key)}</span>
                </div>
                {i < steps.length - 1 && <div className="sp__line" />}
              </div>
            ))}
          </div>

          <div className="grid">
            <form className="form-card" onSubmit={handleSubmit}>

              {/* 1 — Vous (name + email persist) */}
              <div className="fsec">
                <div className="fsec__h"><span className="fsec__n">1</span><div><b>{t('sec1Title')}</b><span>{t('sec1Sub')}</span></div></div>
                <div className="row2">
                  <div className="fld"><label>{t('fFirstName')}</label><input className="inp" type="text" placeholder="Bruno" value={firstName} onChange={e => setFirstName(e.target.value)} required /></div>
                  <div className="fld"><label>{t('fLastName')}</label><input className="inp" type="text" placeholder="Chevalier" value={lastName} onChange={e => setLastName(e.target.value)} required /></div>
                </div>
                <div className="fld">
                  <label>{t('fEmail')}</label>
                  <input className="inp" type="email" placeholder="vous@exemple.fr" value={email} onChange={e => setEmail(e.target.value)} disabled={emailLocked} required />
                  {emailLocked && <div className="hint"><span className="ms">lock</span><span>{t('emailLocked')}</span></div>}
                </div>
              </div>

              {/* 2 — Votre projet (brandName + hasKitchen persist) */}
              <div className="fsec">
                <div className="fsec__h"><span className="fsec__n">2</span><div><b>{t('sec2Title')}</b><span>{t('sec2Sub')}</span></div></div>
                <div className="fld">
                  <label>{t('fBrand')}</label>
                  {brands.length > 0 ? (
                    <select className="inp" value={brandName} onChange={e => setBrandName(e.target.value)} required>
                      <option value="">{t('fBrandPlaceholder')}</option>
                      {brands.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input className="inp" type="text" placeholder={t('fBrandPlaceholder')} value={brandName} onChange={e => setBrandName(e.target.value)} required />
                  )}
                </div>
                <label className="check">
                  <input type="checkbox" checked={hasKitchen} onChange={e => setHasKitchen(e.target.checked)} />
                  <span><b>{t('fKitchen')}</b><span>{t('fKitchenHint')}</span></span>
                </label>
              </div>

              {/* 3 — Votre entreprise (optional, persisted) */}
              <div className="fsec">
                <div className="fsec__h"><span className="fsec__n">3</span><div><b>{t('sec3Title')}</b><span>{t('sec3Sub')}</span></div></div>
                <div className="row2">
                  <div className="fld"><label>{t('fSiret')} <span className="opt">{t('optional')}</span></label><input className="inp mono" type="text" placeholder="123 456 789 00012" value={siret} onChange={e => setSiret(e.target.value)} /></div>
                  <div className="fld"><label>{t('fRib')} <span className="opt">{t('optional')}</span></label><input className="inp mono" type="text" placeholder="FR76 …" value={rib} onChange={e => setRib(e.target.value)} /></div>
                </div>
                <div className="hint"><span className="ms">info</span><span>{t('companyHint')}</span></div>
              </div>

              {/* 4 — Motivation (persisted) + consent */}
              <div className="fsec">
                <div className="fsec__h"><span className="fsec__n">4</span><div><b>{t('sec4Title')}</b><span>{t('sec4Sub')}</span></div></div>
                <div className="fld">
                  <label>{t('fMotivation')}</label>
                  <textarea className="inp" placeholder={t('motivationPlaceholder')} value={motivation} onChange={e => setMotivation(e.target.value)} required />
                  <div className="hint"><span className="ms">edit_note</span><span>{t('charCount', { count: motivation.trim().length })}</span></div>
                </div>
                <label className="consent">
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />
                  <span>
                    {t.rich('consent', {
                      policy: (chunks) => <Link href="/legal/confidentialite" target="_blank" rel="noreferrer">{chunks}</Link>,
                    })}
                  </span>
                </label>
              </div>

              {error && <div className="form-err" role="alert">{error}</div>}

              <div className="form-foot">
                <button type="submit" className="btn-zest" disabled={!canSubmit}>
                  <span className="ms">send</span>{submitting ? t('submitting') : t('submit')}
                </button>
                <span className="note"><span className="ms">lock</span>{t('footNote')}</span>
              </div>
            </form>

            <aside className="aside">
              <div className="aside__terms">
                <h3>{t('asideTermsTitle')}</h3>
                <div className="big">{t('asideEntry')}</div>
                <div className="tr"><span className="k">{t('asideEntryK')}</span><span className="v">{t('asideEntryV')}</span></div>
                <div className="tr"><span className="k">{t('asideRoyaltyK')}</span><span className="v">{t('asideRoyaltyV', { pct: ratePct })}</span></div>
                <div className="tr"><span className="k">{t('asideContractK')}</span><span className="v">{t('asideContractV')}</span></div>
                <div className="tr"><span className="k">{t('asideResponseK')}</span><span className="v">{t('asideResponseV')}</span></div>
              </div>
              <div className="aside__card">
                <h3><span className="ms">verified_user</span>{t('asideWhatTitle')}</h3>
                <ul className="aside__list">
                  <li><span className="ms">check_circle</span>{t('asideWhat1')}</li>
                  <li><span className="ms">check_circle</span>{t('asideWhat2')}</li>
                  <li><span className="ms">check_circle</span>{t('asideWhat3')}</li>
                  <li><span className="ms">check_circle</span>{t('asideWhat4')}</li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
