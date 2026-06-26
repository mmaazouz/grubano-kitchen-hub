'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { Mail, X, Loader2, AlertCircle, Sparkles } from 'lucide-react'

// ── <CheckoutAuthSheet /> — passwordless account-AT-payment for the LIVE /eat checkout (Agent 138) ──
//
// Reuses the EXISTING passwordless rail UNCHANGED: provision (POST /api/eat/consumer-provision, the
// un-gated /eat twin of Agent 132's route) → mint (POST /api/auth/magic-link → { otpEnabled }) →
// in-page 6-digit code → signIn('credentials', { email, otp }). It NEVER touches the money engine.
//
// Session: /eat is wrapped in <EatSessionProvider> (= NextAuth <SessionProvider>, app/[locale]/eat/
// layout.tsx). After signIn('credentials', { …, redirect:false }) resolves ok, the session cookie is
// set, so the caller's next POST /api/orders carries it (no 401) — the SAME mechanism that already
// works for the password sign-in. onConnected() lets the cart continue straight to placeOrder().
//
// Look = the gb- Design System (cream sheet, vivid accent, lucide). The password sign-in (/eat/auth)
// is untouched and stays reachable via the fallback link below.

type Step = 'email' | 'code' | 'linkSent'
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)

export default function CheckoutAuthSheet({
  onConnected,
  onClose,
  initialEmail = '',
}: {
  onConnected: () => void
  onClose: () => void
  initialEmail?: string
}) {
  const t = useTranslations('eat.checkoutAuth')
  const locale = useLocale()
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!isEmail(addr) || sending) return
    setSending(true)
    setError('')
    try {
      // 1) Ensure a passwordless 'consumer' Operator exists (un-gated /eat twin). Best-effort,
      //    anti-enumeration: the result is ignored.
      await fetch('/api/eat/consumer-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      }).catch(() => {})
      // 2) The UNCHANGED mint emails the 6-digit code (+ link) and tells us whether OTP is enabled.
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr, locale }),
      })
      const data = await res.json().catch(() => null)
      setStep((data as { otpEnabled?: boolean } | null)?.otpEnabled ? 'code' : 'linkSent')
    } catch {
      setStep('linkSent')
    } finally {
      setSending(false)
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim()
    if (!/^\d{6}$/.test(c) || verifying) return
    setVerifying(true)
    setError('')
    try {
      // Consume the code through the UNCHANGED credentials provider. On ok the session cookie is set
      // → the cart's POST /api/orders will carry it (no 401).
      const res = await signIn('credentials', { email: email.trim().toLowerCase(), otp: c, redirect: false })
      if (res?.ok) onConnected()
      else setError(t('codeError'))
    } catch {
      setError(t('codeError'))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-gb-xl bg-gb-surface-elevated px-6 pb-8 pt-5 font-gb-sans text-gb-content sm:rounded-gb-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-gb-display text-[20px] font-extrabold text-gb-content">{t('title')}</h2>
          <button onClick={onClose} aria-label={t('close')} className="flex h-9 w-9 items-center justify-center rounded-gb-lg bg-gb-oat-100 active:scale-90">
            <X size={20} className="text-gb-content" />
          </button>
        </div>

        {error && (
          <p className="mb-3 flex items-start gap-2 rounded-gb-lg bg-gb-error-soft p-3 text-[13px] text-gb-content" role="alert">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-gb-error" />
            <span>{error}</span>
          </p>
        )}

        {step === 'email' && (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <p className="text-sm text-gb-content-muted">{t('subtitle')}</p>
            <div>
              <label className="mb-2 block text-[13px] font-semibold text-gb-content">{t('emailLabel')}</label>
              <div className="flex items-center rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated px-3.5 py-3.5">
                <Mail size={18} className="mr-2.5 text-gb-content-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  autoCapitalize="none"
                  className="flex-1 bg-transparent text-[15px] text-gb-content placeholder:text-gb-content-muted focus:outline-none"
                />
              </div>
            </div>
            <button type="submit" disabled={!isEmail(email.trim()) || sending} className="flex w-full items-center justify-center gap-2 rounded-gb-full bg-gb-accent py-4 text-[17px] font-bold text-gb-content-on-accent active:scale-[0.98] disabled:opacity-60">
              {sending && <Loader2 size={18} className="animate-spin" />}
              {sending ? t('sending') : t('sendCode')}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verifyCode} className="space-y-4" noValidate>
            <p className="text-sm text-gb-content-muted">{t('codeSent', { email: email.trim().toLowerCase() })}</p>
            <div>
              <label className="mb-2 block text-[13px] font-semibold text-gb-content">{t('codeLabel')}</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                className="w-full rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated px-3.5 py-3.5 text-center text-[22px] font-bold tracking-[8px] text-gb-content placeholder:text-gb-content-muted focus:outline-none"
              />
            </div>
            <p className="flex items-start gap-2 rounded-gb-lg bg-gb-success-soft px-3 py-2 text-[12px] text-gb-content">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-gb-success" />
              <span>{t('passwordNudge')}</span>
            </p>
            <button type="submit" disabled={code.trim().length !== 6 || verifying} className="flex w-full items-center justify-center gap-2 rounded-gb-full bg-gb-accent py-4 text-[17px] font-bold text-gb-content-on-accent active:scale-[0.98] disabled:opacity-60">
              {verifying && <Loader2 size={18} className="animate-spin" />}
              {verifying ? t('verifying') : t('verify')}
            </button>
            <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }} className="block w-full text-center text-[13px] font-semibold text-gb-content-muted underline">
              {t('changeEmail')}
            </button>
          </form>
        )}

        {step === 'linkSent' && (
          <div className="space-y-2">
            <p className="font-gb-display text-base font-bold text-gb-content">{t('linkSentTitle')}</p>
            <p className="text-sm text-gb-content-muted">{t('linkSentBody', { email: email.trim().toLowerCase() })}</p>
          </div>
        )}

        {/* Password fallback — the existing /eat/auth sign-in is untouched and still reachable. */}
        <button type="button" onClick={() => router.push('/eat/auth')} className="mt-5 block w-full text-center text-[13px] font-semibold text-gb-accent">
          {t('usePassword')}
        </button>
      </div>
    </div>
  )
}
