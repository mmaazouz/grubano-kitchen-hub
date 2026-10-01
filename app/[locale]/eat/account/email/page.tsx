'use client'

import { useState, useEffect } from 'react'
import { useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
// gb-foundation FIRST (Material `.ms` @import must be the first route-stylesheet rule).
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import '../edit/profile-edit.css'

// /eat/account/email — « Changer d'e-mail » (consumer). Re-skinned to the FROZEN CD
// « Modifier mon profil » design language (Notion 38efd2c9-…-6ffe25) using the shared
// .gb-profile-edit sheet (../edit/profile-edit.css). Material Symbols (not lucide);
// --gb-* tokens.
//
// 🔒 AUTH-ADJACENT — the email-change FLOW is BYTE-IDENTICAL: the two POSTs
// (/api/account/email-change/request-code then /api/account/email-change/request with
// { newEmail, currentEmailCode }), the same HTTP-status → error mapping, and the same
// flag-gated behaviour (AUTH_EMAIL_CHANGE_ENABLED OFF → 404 → neutral notice) are
// preserved verbatim. Only the markup/CSS + the i18n migration changed (the prior
// hard-coded `T` literals → t('eat.profileEdit.email*')).

export default function ChangeEmailScreen() {
  const t = useTranslations('eat.profileEdit')
  const router = useRouter()
  const { data: session, status } = useSession()
  const currentEmail = (session?.user?.email as string | undefined) ?? ''

  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/eat/auth')
  }, [status, router])

  async function requestCode() {
    setError('')
    if (!newEmail.trim()) { setError(t('emailNeedNew')); return }
    setBusy(true)
    try {
      const res = await fetch('/api/account/email-change/request-code', { method: 'POST' })
      if (res.status === 404) { setError(t('emailErrUnavail')); return }
      if (res.status === 403) { setError(t('emailErrUnavail')); return }
      if (res.status === 429) { setError(t('emailErrThrottle')); return }
      if (!res.ok) { setError(t('emailErrGeneric')); return }
      setCodeRequested(true)
    } catch {
      setError(t('emailErrGeneric'))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/account/email-change/request', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ newEmail: newEmail.trim(), currentEmailCode: code.trim() }),
      })
      if (res.status === 404 || res.status === 403) { setError(t('emailErrUnavail')); return }
      if (res.status === 400) { setError(t('emailErrCode')); return }
      if (!res.ok) { setError(t('emailErrGeneric')); return }
      setDone(true) // generic success — whether the new address was free or already in use
    } catch {
      setError(t('emailErrGeneric'))
    } finally {
      setBusy(false)
    }
  }

  // ── Done — verification email sent to the new address ──────────────────────
  if (done) {
    return (
      <main className="gb gb-profile-edit">
        <div className="bar">
          <button type="button" className="back" onClick={() => router.push('/eat/account')} aria-label={t('back')}>
            <span className="ms" aria-hidden="true">arrow_back</span>
          </button>
          <h2>{t('emailTitle')}</h2>
        </div>
        <div className="body">
          <div className="result">
            <div className="result__ico info"><span className="ms" aria-hidden="true">mark_email_unread</span></div>
            <h2>{t('emailDoneTitle')}</h2>
            <p>{t('emailDoneBody')}</p>
            <button type="button" className="save" onClick={() => router.push('/eat/account')}>
              <span className="ms" aria-hidden="true">check</span><b>{t('emailDoneCta')}</b>
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="gb gb-profile-edit">
      <div className="bar">
        <button type="button" className="back" onClick={() => router.push('/eat/account')} aria-label={t('back')}>
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
        <h2>{t('emailTitle')}</h2>
      </div>

      <div className="body">
        <p className="intro">
          <span className="ms" aria-hidden="true">shield</span>
          <span>{t('emailIntro')}</span>
        </p>

        {currentEmail && (
          <div className="pe-field" style={{ marginTop: 12 }}>
            <span>{t('emailCurrent')}</span>
            <div className="ctrl">
              <span className="ms" aria-hidden="true">mail</span>
              <input value={currentEmail} readOnly aria-label={t('emailCurrent')} />
              <span className="verif"><span className="ms" aria-hidden="true">check_circle</span>{t('emailVerified')}</span>
            </div>
          </div>
        )}

        <div className="pe-field">
          <span>{t('emailNew')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">alternate_email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t('emailNewPh')}
              aria-label={t('emailNew')}
            />
          </div>
          <p className="hlp">{t('emailHelp')}</p>
        </div>

        <button type="button" className="save save--line" onClick={requestCode} disabled={busy}>
          <span className="ms" aria-hidden="true">send</span>
          <b>{busy && !codeRequested ? t('emailWorking') : t('emailSendCode')}</b>
        </button>

        {codeRequested && (
          <>
            <div className="notice">
              <span className="ms" aria-hidden="true">info</span>{t('emailCodeSent')}
            </div>

            <div className="pe-field" style={{ marginTop: 14 }}>
              <span>{t('emailCode')}</span>
              <div className="ctrl">
                <span className="ms" aria-hidden="true">pin</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('emailCodePh')}
                  aria-label={t('emailCode')}
                  style={{ letterSpacing: '.18em' }}
                />
              </div>
            </div>

            <button type="button" className="save" onClick={submit} disabled={busy || !code.trim()}>
              <span className="ms" aria-hidden="true">check</span>
              <b>{busy ? t('emailWorking') : t('emailSubmit')}</b>
            </button>
          </>
        )}

        {error && (
          <div className="err"><span className="ms" aria-hidden="true">error</span>{error}</div>
        )}
      </div>
    </main>
  )
}
