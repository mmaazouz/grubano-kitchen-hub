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
// 🔒 AUTH-ADJACENT — TWO REAL, DISTINCT ACTIONS. The screen used to draw three fields
// and post BOTH buttons to /api/auth/forgot-password: « Mettre à jour » mailed a reset
// link and reported « Lien envoyé », and the fields were decorative (no value, no
// onChange, no endpoint). Now:
//   • « Mettre à jour »        → POST /api/account/password { currentPassword, newPassword }
//                                — a real in-account change, and the ONLY thing this
//                                  button calls. It never touches forgot-password.
//   • « Mot de passe oublié ? » → POST /api/auth/forgot-password { email, space:'eat' }
//                                — UNCHANGED contract, unchanged copy, unchanged screen.
// The three fields are controlled, the gauge reads the real value, and the submit button
// enforces the SAME policy the server does (8…100, confirmation equal, new ≠ current).
//
// SESSIONS: lib/auth.ts is JWT-strategy, so the server cannot revoke a token it already
// issued. The success screen says other devices may stay signed in — it must never imply
// they were signed out.

/** Honest 0…4 strength, computed from the real value (it used to be hard-coded
 *  « ok ok mid empty » whatever the user typed). It is a HINT: the only rule the
 *  server enforces is the length, and `pwHelp` states exactly that. */
function strength(v: string): number {
  if (!v) return 0
  let s = 0
  if (v.length >= 8) s += 1
  if (v.length >= 12) s += 1
  if (/[0-9]/.test(v) && /[A-Za-z]/.test(v)) s += 1
  if (/[^A-Za-z0-9]/.test(v)) s += 1
  return s
}

export default function AccountPasswordScreen() {
  const t = useTranslations('eat.profileEdit')
  const router = useRouter()
  const { data: session, status } = useSession()
  const email = (session?.user?.email as string | undefined) ?? ''

  // Field values — `cur`rent / `nxt` (new) / `cfm` (confirmation).
  const [cur, setCur] = useState('')
  const [nxt, setNxt] = useState('')
  const [cfm, setCfm] = useState('')

  const [showCur, setShowCur] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [busySave, setBusySave] = useState(false) // POST /api/account/password
  const [busyLink, setBusyLink] = useState(false) // POST /api/auth/forgot-password
  const [sent, setSent] = useState(false)         // reset link emailed
  const [changed, setChanged] = useState(false)   // password really changed
  const [error, setError] = useState('')

  const busy = busySave || busyLink

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/eat/auth')
  }, [status, router])

  // Client-side mirror of the server's policy (app/api/account/password/route.ts).
  const tooShort = nxt.length > 0 && nxt.length < 8
  const tooLong  = nxt.length > 100
  const mismatch = cfm.length > 0 && cfm !== nxt
  const same     = nxt.length > 0 && nxt === cur
  const canSave  =
    cur.length > 0 && nxt.length >= 8 && nxt.length <= 100 && cfm === nxt && nxt !== cur

  // Server refusal codes → localised copy. Explicit literals (no dynamic t() key).
  function messageFor(code: string | undefined): string {
    switch (code) {
      case 'invalid_current': return t('pwErrCurrent')
      case 'no_password':     return t('pwErrNoPassword')
      case 'weak_new':        return t('pwErrTooShort')
      case 'same_as_current': return t('pwErrSameAsCurrent')
      case 'account_locked':  return t('pwErrLocked')
      default:                return t('pwErrSave')
    }
  }

  // REAL in-account change — the ONLY call « Mettre à jour » makes.
  async function changePassword() {
    if (busy || !canSave) return
    setError('')
    setBusySave(true)
    try {
      const r = await fetch('/api/account/password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ currentPassword: cur, newPassword: nxt }),
      })
      if (r.ok) {
        // Drop the plaintext from component state as soon as it is no longer needed.
        setCur(''); setNxt(''); setCfm('')
        setChanged(true)
        return
      }
      if (r.status === 429) { setError(t('pwErrTooMany')); return }
      const body = (await r.json().catch(() => null)) as { code?: string } | null
      setError(messageFor(body?.code))
    } catch {
      setError(t('pwErrSave'))
    } finally {
      setBusySave(false)
    }
  }

  // REAL reset-by-email request (byte-identical contract: /api/auth/forgot-password).
  async function sendResetLink() {
    if (busy || !email) return
    setError('')
    setBusyLink(true)
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
      setBusyLink(false)
    }
  }

  // ── Changed confirmation (password really updated) ─────────────────────────
  if (changed) {
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
            <div className="result__ico ok"><span className="ms" aria-hidden="true">check_circle</span></div>
            <h2>{t('pwChangedTitle')}</h2>
            <p>{t('pwChangedBody')}</p>
            {/* No session is revoked (JWT strategy) — say so rather than imply otherwise. */}
            <p>{t('pwOtherDevices')}</p>
            <button type="button" className="save" onClick={() => router.push('/eat/account')}>
              <span className="ms" aria-hidden="true">check</span><b>{t('pwSentCta')}</b>
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Sent confirmation (reset link emailed — « Mot de passe oublié ? ») ─────
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

  const score = strength(nxt)

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

        {/* current — verified server-side by bcrypt.compare */}
        <div className="pe-field">
          <span>{t('pwCurrent')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock</span>
            <input
              type={showCur ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              aria-label={t('pwCurrent')}
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
            <button type="button" className="eye" onClick={() => setShowCur((v) => !v)} aria-label={showCur ? t('pwHide') : t('pwShow')}>
              <span className="ms" aria-hidden="true">{showCur ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>

        {/* new + strength gauge (reads the real value) */}
        <div className="pe-field">
          <span>{t('pwNew')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock_reset</span>
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••••"
              aria-label={t('pwNew')}
              value={nxt}
              onChange={(e) => setNxt(e.target.value)}
            />
            <button type="button" className="eye" onClick={() => setShowNew((v) => !v)} aria-label={showNew ? t('pwHide') : t('pwShow')}>
              <span className="ms" aria-hidden="true">{showNew ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          <div className="gauge" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < score ? (score <= 2 ? 'mid' : 'ok') : undefined} />
            ))}
          </div>
          {/* pwHelp states the rule the server ACTUALLY enforces (8…100). */}
          <p className="hlp">{t('pwHelp')}</p>
          {(tooShort || tooLong) && (
            <p className="hlp" style={{ color: 'var(--gb-danger)' }}>{t('pwErrTooShort')}</p>
          )}
          {same && (
            <p className="hlp" style={{ color: 'var(--gb-danger)' }}>{t('pwErrSameAsCurrent')}</p>
          )}
        </div>

        {/* confirm */}
        <div className="pe-field">
          <span>{t('pwConfirm')}</span>
          <div className="ctrl">
            <span className="ms" aria-hidden="true">lock_reset</span>
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••••"
              aria-label={t('pwConfirm')}
              value={cfm}
              onChange={(e) => setCfm(e.target.value)}
            />
          </div>
          {mismatch && (
            <p className="hlp" style={{ color: 'var(--gb-danger)' }}>{t('pwErrMismatch')}</p>
          )}
        </div>

        {/* « Mot de passe oublié ? » — REAL reset-by-email request (unchanged) */}
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
          {/* Real in-account change. Disabled until the client-side mirror of the
              server policy is satisfied, so an impossible request is never sent. */}
          <button type="button" className="save" onClick={changePassword} disabled={busy || !canSave}>
            <span className="ms" aria-hidden="true">check</span><b>{busySave ? t('pwSaving') : t('pwUpdate')}</b>
          </button>
        </div>
      </div>
    </main>
  )
}
