'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import PartnerShell from '@/components/business/PartnerShell'

// ── /business/register — restaurateur INSCRIPTION (S2 login-unification) ──────
// Self-serve sign-up only. The LOGIN is unified at /auth/magic for every partner
// (this page links there for existing partners). This is the register half that
// used to live in /business/auth (which now redirects to /auth/magic). Logic
// UNCHANGED — POST /api/partners/register → e-mail verification → magic-link login.
// PASSWORDLESS (P6): no password field — the account is created with password=null
// and signs in by magic-link (/auth/magic). Only name + e-mail + RGPD consent are
// collected; the e-mail verification flow + magic-link login are unchanged.
//
// PRÉSENTATION (PartnerShell, mode parcours — référence partner-shell.html) : frise
// « Compte » en cours, « Quitter » → /business, colonne 560, champs .fld/.inp,
// erreur .note--error, confirmation .note--ok, bouton .btn. Le pitch latéral
// (heroTitle/bullets) n'existe pas dans la colonne formulaire de la référence :
// retiré de cette page (clés i18n conservées). Validation, états, honeypot,
// formStartedAt et l'appel API sont byte-identiques.

export default function PartnerRegisterScreen() {
  const t = useTranslations('business.auth')
  const tShell = useTranslations('business.shell')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  // Honeypot — must remain empty (anti-bot). Hidden from humans + assistive tech.
  const [honeypot, setHoneypot] = useState('')
  // Render time → server uses (now - formStartedAt) as a light bot signal.
  const [formStartedAt] = useState<number>(() => Date.now())

  const [registeredMessage, setRegisteredMessage] = useState<string | null>(null)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !email) { setError(t('registerMissing')); return }
    if (!consent) { setError(t('consentRequired')); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/partners/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, consent, website: honeypot, formStartedAt }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
      if (res.status === 429) { setError(t('rateLimited')); return }
      if (!res.ok) { setError(data?.error || t('registerFailed')); return }
      setRegisteredMessage(data?.message || t('confirmationGeneric'))
    } catch {
      setError(t('networkError'))
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    { label: tShell('stepAccount'),       state: 'now'  as const },
    { label: tShell('stepEstablishment'), state: 'todo' as const },
    { label: tShell('stepVerification'),  state: 'todo' as const },
    { label: tShell('stepGoLive'),        state: 'todo' as const },
  ]

  // ── Confirmation screen ──────────────────────────────────────────────────
  if (registeredMessage) {
    return (
      <PartnerShell mode="parcours" exitHref="/business" steps={steps}>
        <div className="card card--raised card__pad">
          <div className="note note--ok" role="status">
            <span className="ms" aria-hidden="true">check_circle</span>
            <span><b>{t('confirmationTitle')}</b> {registeredMessage}</span>
          </div>
          <Link href="/auth/magic" className="btn btn--md btn--secondary btn--block" style={{ marginTop: 'var(--pt-4)' }}>
            {t('backToLogin')}
          </Link>
        </div>
      </PartnerShell>
    )
  }

  // ── Register card ─────────────────────────────────────────────────────────
  return (
    <PartnerShell mode="parcours" exitHref="/business" steps={steps}>
      <div className="card card--raised card__pad">
        <h1 className="t-h2">{t('tabRegister')}</h1>
        <p className="t-small" style={{ margin: '6px 0 var(--pt-5)' }}>
          {t('loginPrompt')}{' '}
          <Link href="/auth/magic" style={{ fontWeight: 700, color: 'var(--pt-zest-600)' }}>{t('signIn')}</Link>
        </p>

        {error && (
          <div className="note note--error" role="alert" style={{ marginBottom: 'var(--pt-4)' }}>
            <span className="ms" aria-hidden="true">error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleRegister} noValidate>
          <div className="fld">
            <label className="t-label" htmlFor="business-register-name">{t('nameLabel')}</label>
            <input
              id="business-register-name"
              className="inp"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={80}
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="fld">
            <label className="t-label" htmlFor="business-register-email">{t('emailLabel')}</label>
            <input
              id="business-register-email"
              className="inp"
              type="email"
              autoComplete="email"
              required
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {/* Consent — RGPD: never pre-checked */}
          <div className="fld">
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              <span className="t-help">
                {t.rich('consentText', {
                  privacy: (chunks) => (
                    <Link
                      href="/legal/confidentialite"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontWeight: 700, color: 'var(--pt-zest-600)' }}
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </label>
          </div>

          {/* Honeypot — visible only to bots that read the DOM. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}>
            <label htmlFor="business-register-website">Website</label>
            <input
              id="business-register-website"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn--lg btn--primary btn--block" disabled={loading} aria-busy={loading} style={{ marginTop: 'var(--pt-4)' }}>
            {loading && <span className="ms" aria-hidden="true">progress_activity</span>}
            {t('createAccount')}
          </button>
          <p className="t-help" style={{ textAlign: 'center', marginTop: 'var(--pt-3)' }}>{t('legalNote')}</p>
        </form>
      </div>
    </PartnerShell>
  )
}
