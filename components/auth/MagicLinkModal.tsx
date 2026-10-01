'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
// gb-* design FOUNDATION (Agent 168) — `.gb`-scoped, no leak. Calque of ForgotPasswordModal.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── <MagicLinkModal /> — email-only modal for the CONSUMER magic-link CTA ───────
//
// The /eat/auth "Recevoir un lien magique" button must NOT require the password. This
// tiny modal collects ONLY an email (pre-filled with whatever is in the auth form) and
// hands it to the parent's goMagic(email) → /eat/magic. NO fetch here — the real
// magic-link send happens on /eat/magic (unchanged). Reuses the ForgotPasswordModal
// shell + the gb .input (email-only, like the guest-checkout field).

export default function MagicLinkModal({
  initialEmail = '', onClose, onSubmit,
}: {
  initialEmail?: string
  onClose:       () => void
  onSubmit:      (email: string) => void
}) {
  const t = useTranslations('eat.auth')
  const [email, setEmail] = useState(initialEmail)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = email.trim()
    if (!v) return
    onSubmit(v)
  }

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
              <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">link</span>
            </span>
            <p style={{ margin: 0, fontFamily: 'var(--gb-font-display)', fontWeight: 800, fontSize: '16px', color: 'var(--gb-text)' }}>
              {t('magicLinkCta')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('magicModalClose')}
            className="grid h-9 w-9 place-items-center rounded-xl active:scale-95"
            style={{ background: 'var(--gb-surface-2)', color: 'var(--gb-text)' }}
          >
            <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">close</span>
          </button>
        </div>

        <form onSubmit={submit}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--gb-muted)' }}>{t('magicModalBody')}</p>
          <div className="input" style={{ marginTop: '12px' }}>
            <span className="ms" aria-hidden="true">mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!email.trim()}
            className="btn btn--primary active:scale-95 disabled:opacity-60"
            style={{ marginTop: '16px' }}
          >
            <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">send</span>{t('magicModalSend')}
          </button>
        </form>
      </div>
    </div>
  )
}
