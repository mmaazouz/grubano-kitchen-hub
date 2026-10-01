'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'

// ── AF8 · AffiliateApplyClient — PUBLIC pre-login affiliate signup (RE-SKIN) ─────
// CD marketing language (gb-foundation clair, accent TEAL --gb-af, Material
// Symbols, scoped .af-mkt) replaces the old design-system + lucide-react. The
// REAL flow (Agent 118) is preserved byte-identical:
//   POST /api/affiliate/apply { name, email, consent, website (honeypot),
//   formStartedAt } → ALWAYS a neutral { ok: true } (anti-enumeration — the
//   minted code/link is NEVER returned; it is revealed in the affiliate space
//   after sign-in), then a chained best-effort POST /api/auth/magic-link
//   { email, locale } which really sends a sign-in e-mail.
// Honesty (CD note + fondateur): no wished-slug field (the server mints the code
// via mintUniqueAffiliateCode — only name/email/consent are accepted), no
// fabricated success ref/link, generic anti-enumeration e-mail line, real RGPD
// link to /legal/confidentialite, and NO auto-login CTA — the success button is
// a plain Link to the real /auth/magic passwordless sign-in page.
// The CSS (affiliate-apply-form.css) is imported by the PAGE, never here.

export default function AffiliateApplyClient() {
  const t      = useTranslations('affiliate')
  const tC     = useTranslations('affiliate.candidature')
  const locale = useLocale()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [consent, setConsent]   = useState(false)
  const [website, setWebsite]   = useState('') // honeypot — real users never see/fill it
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState('')
  const formStartedAt = useRef<number>(0)

  useEffect(() => { formStartedAt.current = Date.now() }, [])

  const canSubmit = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && consent && !submitting

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/affiliate/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:          name.trim(),
          email:         email.trim(),
          consent,
          website,                          // honeypot
          formStartedAt: formStartedAt.current || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? t('errorGeneric'))
        return
      }
      // Chain the EXISTING passwordless sign-in: email the magic link (anti-enumeration, generic).
      // Best-effort — a mail hiccup never blocks the success screen (the account is already created;
      // the user can request a link from /auth/magic).
      await fetch('/api/auth/magic-link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), locale }),
      }).catch(() => {})
      setDone(true)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Marketing chrome — brand badge + back link to the AF7 landing ─────────────
  function Nav() {
    return (
      <nav className="nav">
        <div className="nav__in">
          <Link href="/affiliate/apply" className="nav__brand">
            <img src="/brand/grubano-symbol-color.svg" alt="Grubano" />
            <b>Grubano</b>
            <span>{tC('navBadge')}</span>
          </Link>
          <Link href="/affiliate/apply" className="nav__back">
            <span className="ms">arrow_back</span>{tC('navBack')}
          </Link>
        </div>
      </nav>
    )
  }

  // ── SUCCESS — honest: neutral wording (anti-enumeration), a generic "if your
  // address is valid" e-mail line (a magic-link e-mail IS really sent by the
  // chained call), no fabricated ref/link, and a plain Link to the real
  // /auth/magic sign-in page (no auto-login).
  if (done) {
    return (
      <div className="af-mkt">
        <Nav />
        <div className="page">
          <div className="success">
            <div className="success__ic"><span className="ms">mark_email_read</span></div>
            <h2>{tC('successTitle')}</h2>
            <p>{tC('successBody')}</p>
            <div className="success__steps">
              <div className="s"><span className="ms">mail</span>{tC('successStepEmail')}</div>
              <div className="s"><span className="ms">login</span>{tC('successStepLogin')}</div>
              <div className="s"><span className="ms">link</span>{tC('successStepShare')}</div>
            </div>
            <div className="success__cta">
              <Link href="/auth/magic" className="btn-af">
                <span className="ms">login</span>{tC('successCta')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── FORM — only the fields the API persists (name / email / consent) ──────────
  return (
    <div className="af-mkt">
      <Nav />
      <div className="page">
        <div className="head">
          <span className="eyebrow"><span className="ms">link</span>{tC('eyebrow')}</span>
          <h1>{tC('headTitle')}</h1>
          <p>{tC('headSubtitle')}</p>
        </div>

        <div className="grid">
          <form className="form-card" onSubmit={submit}>

            <div className="fsec">
              <div className="fsec__h">
                <span className="fsec__n">1</span>
                <div><b>{tC('secYouTitle')}</b><span>{tC('secYouSub')}</span></div>
              </div>
              <div className="row2">
                <div className="fld">
                  <label htmlFor="af-apply-name">{t('applyNameLabel')}</label>
                  <input
                    id="af-apply-name"
                    className="inp"
                    type="text"
                    placeholder={t('applyNamePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
                <div className="fld">
                  <label htmlFor="af-apply-email">{t('applyEmailLabel')}</label>
                  <input
                    id="af-apply-email"
                    className="inp"
                    type="email"
                    placeholder={t('applyEmailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              </div>
              {/* Honest hint — the unique link is minted SERVER-SIDE (no wished-slug
                  field: the API only accepts name/email/consent) and revealed in the
                  affiliate space after sign-in. */}
              <p className="hint"><span className="ms">auto_awesome</span>{tC('linkHint')}</p>
            </div>

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

            <div className="fsec">
              <div className="fsec__h">
                <span className="fsec__n">2</span>
                <div><b>{tC('secFinishTitle')}</b><span>{tC('secFinishSub')}</span></div>
              </div>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {tC('consentPre')}{' '}
                  <Link href="/legal/confidentialite" target="_blank" rel="noopener noreferrer">
                    {tC('consentLink')}
                  </Link>
                  {tC('consentPost')}
                </span>
              </label>
            </div>

            {error && <p className="form-err">{error}</p>}

            <div className="form-foot">
              <button type="submit" className="btn-af" disabled={!canSubmit}>
                <span className="ms">{submitting ? 'progress_activity' : 'send'}</span>
                {submitting ? t('applySubmitting') : t('applySubmit')}
              </button>
              <span className="note"><span className="ms">check_circle</span>{tC('footNote')}</span>
            </div>
          </form>

          {/* aside — qualitative only (no €, no rates, no fabricated volumes) */}
          <aside className="aside">
            <div className="aside__promo">
              <span className="ms">bolt</span>
              <b>{tC('asidePromoTitle')}</b>
              <span>{tC('asidePromoBody')}</span>
            </div>
            <div className="aside__card">
              <h3><span className="ms">auto_awesome</span>{tC('asideAwaitsTitle')}</h3>
              <ul className="aside__list">
                <li><span className="ms">check_circle</span>{tC('asideAwaits1')}</li>
                <li><span className="ms">check_circle</span>{tC('asideAwaits2')}</li>
                <li><span className="ms">check_circle</span>{tC('asideAwaits3')}</li>
                <li><span className="ms">check_circle</span>{tC('asideAwaits4')}</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
