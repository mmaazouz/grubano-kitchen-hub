'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
// Grubano gb-* design FOUNDATION (Agent 168) — the modal ADOPTS it (visual only). The CSS is
// `.gb`-scoped, so importing it here can't leak onto the operator app. Material Symbols (the
// `.gb .ms` font) replace lucide; the primary button now uses the shared gradient `.btn--primary`.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── <ForgotPasswordModal /> — Emails v2 FIX 3, shared by BOTH spaces ───────────
//
// Tiny modal over POST /api/auth/forgot-password { email, space }. The server
// ALWAYS answers ok (no user enumeration), so the success panel is worded
// « si un compte existe… ». The actual reset happens on /eat/reset-password
// via the emailed single-use 1 h token.

export default function ForgotPasswordModal({
  space, initialEmail = '', onClose,
}: {
  space:        'eat' | 'business'
  initialEmail?: string
  onClose:      () => void
}) {
  const t = useTranslations('auth.reset')

  const [email,   setEmail]   = useState(initialEmail)
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending || !email.trim()) return
    setSending(true)
    setError('')
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), space }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        setError((body?.error as string) || t('resetErrGeneric'))
        return
      }
      setSent(true)
    } catch {
      setError(t('resetErrGeneric'))
    } finally {
      setSending(false)
    }
  }

  // Visual only: content wrapped in a `.gb` root so it uses the foundation primitives
  // (.btn--primary gradient identical to "Se connecter", .input, .hero-ico) + gb tokens.
  // The dialog shell keeps its bottom-sheet shape; it adopts the gb surface + card shadow.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div
        className="gb w-full max-w-md rounded-t-3xl p-5 sm:rounded-2xl"
        style={{ background: 'var(--gb-surface)', boxShadow: 'var(--gb-shadow-card)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{ background: '#FFF1E7', color: 'var(--gb-zest-600)' }}
            >
              <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">mail</span>
            </span>
            <p style={{ margin: 0, fontFamily: 'var(--gb-font-display)', fontWeight: 800, fontSize: '16px', color: 'var(--gb-text)' }}>
              {t('forgotTitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('forgotClose')}
            className="grid h-9 w-9 place-items-center rounded-xl active:scale-95"
            style={{ background: 'var(--gb-surface-2)', color: 'var(--gb-text)' }}
          >
            <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">close</span>
          </button>
        </div>

        {sent ? (
          <div className="text-center">
            <span className="hero-ico" style={{ width: '56px', height: '56px', margin: '0 auto' }}>
              <span className="ms" style={{ fontSize: '28px' }} aria-hidden="true">mark_email_read</span>
            </span>
            <p className="mt-3" style={{ fontSize: '13px', color: 'var(--gb-muted)' }}>{t('forgotSent')}</p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn--primary active:scale-95"
              style={{ marginTop: '16px' }}
            >
              {t('forgotClose')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--gb-muted)' }}>{t('forgotBody')}</p>
            <div className="input" style={{ marginTop: '12px' }}>
              <span className="ms" aria-hidden="true">mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('forgotEmailPh')}
                autoCapitalize="none"
              />
            </div>
            {error && (
              <p
                className="mt-2 flex items-start gap-2"
                style={{ borderRadius: 'var(--gb-r-md)', border: '1px solid #F4C7C0', background: '#FCEEEC', padding: '8px 12px', fontSize: '12px', color: '#C0392B' }}
              >
                <span className="ms" style={{ fontSize: '15px', marginTop: '1px', flex: 'none' }} aria-hidden="true">error</span>
                <span>{error}</span>
              </p>
            )}
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="btn btn--primary active:scale-95 disabled:opacity-60"
              style={{ marginTop: '16px' }}
            >
              {sending ? (
                <span className="ms" style={{ fontSize: '18px', animation: 'gb-spin .8s linear infinite' }} aria-hidden="true">progress_activity</span>
              ) : null}
              {sending ? t('forgotSending') : t('forgotSend')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
