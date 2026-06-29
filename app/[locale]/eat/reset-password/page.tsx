'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
// gb-foundation FIRST (Material `.ms` @import must be the first route-stylesheet rule).
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import '../account/edit/profile-edit.css'

// ── /eat/reset-password — Emails v2 FIX 3 (the reset page) ─────────────────────
//
// PUBLIC (lives under the /eat tree → covered by the middleware allowance, the
// middleware itself is untouched). Serves BOTH spaces: the email link carries
// ?token=…&email=…&space=eat|business — `space` only routes the post-reset
// sign-in CTA (/eat/auth vs /business/auth). Token = single-use, 1 h
// (consumed server-side by POST /api/auth/reset-password).
//
// 🔒 AUTH-ADJACENT — re-skinned to the FROZEN CD « Mot de passe » design (Notion
// 38efd2c9-…-6ffe25) using the shared .gb-profile-edit sheet. The reset FLOW is
// BYTE-IDENTICAL: same token/email/space parsing, same client validation (≥8,
// match), same POST /api/auth/reset-password body, same error mapping. Only the
// markup/CSS changed (lucide → Material Symbols, plain Tailwind → gb-* tokens).

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="gb gb-profile-edit">
        <div className="body" style={{ paddingTop: 40 }}>
          <span className="sk sk-row" />
          <span className="sk sk-row" />
        </div>
      </div>
    }>
      <ResetInner />
    </Suspense>
  )
}

function ResetInner() {
  const t = useTranslations('auth.reset')
  const tp = useTranslations('eat.profileEdit')
  const router = useRouter()
  const searchParams = useSearchParams()

  const token = searchParams.get('token') ?? ''
  const email = searchParams.get('email') ?? ''
  const space = searchParams.get('space') === 'business' ? 'business' : 'eat'

  const [pw,  setPw]  = useState('')
  const [pw2, setPw2] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const linkValid = token.length >= 32 && email.includes('@')
  const loginHref = space === 'business' ? '/auth/magic' : '/eat/auth'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (pw.length < 8) { setError(t('resetTooShort')); return }
    if (pw !== pw2)    { setError(t('resetMismatch')); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, token, password: pw }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        setError(r.status === 400 ? ((body?.error as string) || t('resetInvalid')) : t('resetErrGeneric'))
        return
      }
      setDone(true)
    } catch {
      setError(t('resetErrGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Done — reset succeeded ───────────────────────────────────────────────────
  if (done) {
    return (
      <main className="gb gb-profile-edit">
        <div className="bar">
          <h2>{t('resetTitle')}</h2>
        </div>
        <div className="body">
          <div className="result">
            <div className="result__ico ok"><span className="ms" aria-hidden="true">check</span></div>
            <h2>{t('resetDoneTitle')}</h2>
            <p>{t('resetDoneBody')}</p>
            <button type="button" className="save" onClick={() => router.push(loginHref)}>
              <span className="ms" aria-hidden="true">login</span><b>{t('resetGoLogin')}</b>
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Invalid / expired link ───────────────────────────────────────────────────
  if (!linkValid) {
    return (
      <main className="gb gb-profile-edit">
        <div className="bar">
          <h2>{t('resetTitle')}</h2>
        </div>
        <div className="body">
          <div className="result">
            <div className="result__ico bad"><span className="ms" aria-hidden="true">link_off</span></div>
            <h2>{tp('pwLinkInvalidTitle')}</h2>
            <p>{t('resetInvalid')}</p>
            <button type="button" className="save save--line" onClick={() => router.push(loginHref)}>
              <span className="ms" aria-hidden="true">login</span><b>{t('resetGoLogin')}</b>
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Reset form (CD « Mot de passe » design) ──────────────────────────────────
  return (
    <main className="gb gb-profile-edit">
      <div className="bar">
        <h2>{t('resetTitle')}</h2>
      </div>
      <form className="body" onSubmit={submit}>
        <p className="intro">
          <span className="ms" aria-hidden="true">lock_reset</span>
          <span>{t('resetBody')} — <bdi>{email}</bdi></span>
        </p>

        <div className="pe-field">
          <span>{t('resetPwLabel')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock_reset</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              minLength={8}
              placeholder="••••••••"
              autoComplete="new-password"
              aria-label={t('resetPwLabel')}
            />
            <button type="button" className="eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? tp('pwHide') : tp('pwShow')}>
              <span className="ms" aria-hidden="true">{showPw ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          <p className="hlp">{tp('pwHelp')}</p>
        </div>

        <div className="pe-field">
          <span>{t('resetPw2Label')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock_reset</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              minLength={8}
              placeholder="••••••••"
              autoComplete="new-password"
              aria-label={t('resetPw2Label')}
            />
          </div>
        </div>

        {error && (
          <div className="err"><span className="ms" aria-hidden="true">error</span>{error}</div>
        )}

        <div className="foot" style={{ marginTop: 18, marginInline: -18, paddingInline: 18 }}>
          <div className="inner">
            <button type="submit" className="save" disabled={submitting}>
              <span className="ms" aria-hidden="true">check</span>
              <b>{submitting ? t('resetSubmitting') : t('resetSubmit')}</b>
            </button>
          </div>
        </div>
      </form>
    </main>
  )
}
