'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Mail, Loader2, AlertCircle, X, Check } from 'lucide-react'

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#FFF3ED] text-[#F97316]">
              <Mail size={15} />
            </span>
            <p className="text-base font-extrabold text-[#1a1a1a]">{t('forgotTitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('forgotClose')}
            className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4f4f4]"
          >
            <X size={15} className="text-[#1a1a1a]" />
          </button>
        </div>

        {sent ? (
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#16a34a] text-white">
              <Check size={20} />
            </span>
            <p className="mt-3 text-[13px] text-[#555]">{t('forgotSent')}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-[30px] bg-[#F97316] py-3.5 text-[14px] font-bold text-white active:scale-95"
            >
              {t('forgotClose')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="text-[13px] text-[#888]">{t('forgotBody')}</p>
            <div className="mt-3 flex items-center rounded-[14px] border border-[#eee] bg-[#FAFAFA] px-3 py-3">
              <Mail size={16} className="me-2 text-[#aaa]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('forgotEmailPh')}
                autoCapitalize="none"
                className="flex-1 bg-transparent text-[15px] text-[#1a1a1a] placeholder:text-[#bbb] focus:outline-none"
              />
            </div>
            {error && (
              <p className="mt-2 flex items-start gap-2 rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[30px] bg-[#F97316] py-3.5 text-[14px] font-bold text-white active:scale-95 disabled:opacity-60"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : null}
              {sending ? t('forgotSending') : t('forgotSend')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
