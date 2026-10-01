'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
// gb-foundation FIRST (Material `.ms` @import must be the first route-stylesheet rule).
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import '../edit/profile-edit.css'

// /eat/account/password — « Mot de passe » (in-account). VERBATIM reproduction of the
// FROZEN CD ref (Notion 38efd2c9-…-6ffe25 — the « Écran Mot de passe » block of
// eat/edit-profile.html). Renders INSIDE the EatShell. Reuses the .gb-profile-edit
// sheet (../edit/profile-edit.css). Material Symbols; --gb-* tokens.
//
// 🔒 AUTH-ADJACENT — REAL FLOW: a logged-in consumer can only change the password via
// the single-use email reset link (there is NO in-account "current → new" password
// endpoint in the app). So the actionable path here is the REAL forgot-password flow:
// POST /api/auth/forgot-password { email: <session>, space:'eat' } → reset email →
// /eat/reset-password?token=… (the re-skinned token landing). The current/new/confirm
// fields + strength gauge reproduce the CD design but are DISPLAY-ONLY (no endpoint) —
// reported gap. Both « Mettre à jour » and « Mot de passe oublié ? » trigger the same
// real reset-email request.

export default function AccountPasswordScreen() {
  const t = useTranslations('eat.profileEdit')
  const router = useRouter()
  const { data: session, status } = useSession()
  const email = (session?.user?.email as string | undefined) ?? ''

  const [showCur, setShowCur] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/eat/auth')
  }, [status, router])

  // REAL reset-by-email request (byte-identical contract: /api/auth/forgot-password).
  async function sendResetLink() {
    if (busy || !email) return
    setError('')
    setBusy(true)
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, space: 'eat' }),
      })
      if (!r.ok) { setError(t('pwErrGeneric')); return }
      setSent(true)
    } catch {
      setError(t('pwErrGeneric'))
    } finally {
      setBusy(false)
    }
  }

  // ── Sent confirmation (reset link emailed) ─────────────────────────────────
  if (sent) {
    return (
      <main className="gb gb-profile-edit">
        <div className="bar">
          <button type="button" className="back" onClick={() => router.push('/eat/account/edit')} aria-label={t('back')}>
            <span className="ms" aria-hidden="true">arrow_back</span>
          </button>
          <h2>{t('pwTitle')}</h2>
        </div>
        <div className="body">
          <div className="result">
            <div className="result__ico ok"><span className="ms" aria-hidden="true">mark_email_read</span></div>
            <h2>{t('pwSentTitle')}</h2>
            <p>{t('pwSentBody')}</p>
            <button type="button" className="save" onClick={() => router.push('/eat/account')}>
              <span className="ms" aria-hidden="true">check</span><b>{t('pwSentCta')}</b>
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="gb gb-profile-edit">
      <div className="bar">
        <button type="button" className="back" onClick={() => router.push('/eat/account/edit')} aria-label={t('back')}>
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
        <h2>{t('pwTitle')}</h2>
      </div>

      <div className="body">
        <p className="lbl" style={{ marginTop: 6 }}>{t('pwChange')}</p>

        {/* current — display-only (no in-account change endpoint; reported gap) */}
        <div className="pe-field">
          <span>{t('pwCurrent')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock</span>
            <input type={showCur ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" aria-label={t('pwCurrent')} />
            <button type="button" className="eye" onClick={() => setShowCur((v) => !v)} aria-label={showCur ? t('pwHide') : t('pwShow')}>
              <span className="ms" aria-hidden="true">{showCur ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>

        {/* new + strength gauge (visual) */}
        <div className="pe-field">
          <span>{t('pwNew')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock_reset</span>
            <input type={showNew ? 'text' : 'password'} autoComplete="new-password" placeholder="••••••••••" aria-label={t('pwNew')} />
            <button type="button" className="eye" onClick={() => setShowNew((v) => !v)} aria-label={showNew ? t('pwHide') : t('pwShow')}>
              <span className="ms" aria-hidden="true">{showNew ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          <div className="gauge" aria-hidden="true">
            <span className="ok" /><span className="ok" /><span className="mid" /><span />
          </div>
          <p className="hlp">{t('pwHelp')}</p>
        </div>

        {/* confirm (visual) */}
        <div className="pe-field">
          <span>{t('pwConfirm')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock_reset</span>
            <input type={showNew ? 'text' : 'password'} autoComplete="new-password" placeholder="••••••••••" aria-label={t('pwConfirm')} />
          </div>
        </div>

        {/* « Mot de passe oublié ? » — REAL reset-by-email request */}
        <button type="button" className="linkrow" style={{ marginTop: 6 }} onClick={sendResetLink} disabled={busy}>
          <span className="ic"><span className="ms" aria-hidden="true">help</span></span>
          <div className="m"><b>{t('pwForgot')}</b><span>{t('pwForgotSub')}</span></div>
          <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
        </button>

        {error && (
          <div className="err"><span className="ms" aria-hidden="true">error</span>{error}</div>
        )}
      </div>

      <div className="foot">
        <div className="inner">
          {/* In-account "current → new" has no endpoint → the real action is the reset email. */}
          <button type="button" className="save" onClick={sendResetLink} disabled={busy}>
            <span className="ms" aria-hidden="true">check</span><b>{busy ? t('pwWorking') : t('pwUpdate')}</b>
          </button>
        </div>
      </div>
    </main>
  )
}
