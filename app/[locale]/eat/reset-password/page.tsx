'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import { Lock, Loader2, AlertCircle, Check, Eye, EyeOff } from 'lucide-react'

// ── /eat/reset-password — Emails v2 FIX 3 (the reset page) ─────────────────────
//
// PUBLIC (lives under the /eat tree → covered by the middleware allowance, the
// middleware itself is untouched). Serves BOTH spaces: the email link carries
// ?token=…&email=…&space=eat|business — `space` only routes the post-reset
// sign-in CTA (/eat/auth vs /business/auth). Token = single-use, 1 h
// (consumed server-side by POST /api/auth/reset-password).

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto flex max-w-md items-center justify-center px-5 py-24 text-[#888]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    }>
      <ResetInner />
    </Suspense>
  )
}

function ResetInner() {
  const t = useTranslations('auth.reset')
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

  return (
    <div className="mx-auto min-h-screen max-w-md bg-[#FAFAFA] px-5 pb-24 pt-10">
      <div className="rounded-[20px] bg-white p-5 shadow-bolt-card">
        {done ? (
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#16a34a] text-white">
              <Check size={24} />
            </span>
            <p className="mt-4 text-[18px] font-extrabold text-[#1a1a1a]">{t('resetDoneTitle')}</p>
            <p className="mt-2 text-[13px] text-[#888]">{t('resetDoneBody')}</p>
            <button
              type="button"
              onClick={() => router.push(loginHref)}
              className="mt-5 w-full rounded-[30px] bg-[#F97316] py-4 text-[15px] font-bold text-white active:scale-95"
            >
              {t('resetGoLogin')}
            </button>
          </div>
        ) : !linkValid ? (
          <div className="text-center">
            <p className="flex items-start justify-center gap-2 rounded-[16px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-600">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{t('resetInvalid')}</span>
            </p>
            <button
              type="button"
              onClick={() => router.push(loginHref)}
              className="mt-4 w-full rounded-[30px] border-2 border-[#F97316] py-3.5 text-[14px] font-bold text-[#F97316] active:scale-95"
            >
              {t('resetGoLogin')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#FFF3ED] text-[#F97316]">
                <Lock size={17} />
              </span>
              <div>
                <h1 className="text-[17px] font-extrabold text-[#1a1a1a]">{t('resetTitle')}</h1>
                <p className="text-[12px] text-[#888]">{email}</p>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-[#888]">{t('resetBody')}</p>

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-[#888]">
              {t('resetPwLabel')}
            </label>
            <div className="mt-1 flex items-center rounded-[14px] border border-[#eee] bg-[#FAFAFA] px-3 py-3">
              <input
                type={showPw ? 'text' : 'password'}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={8}
                placeholder="••••••••"
                className="flex-1 bg-transparent text-[15px] text-[#1a1a1a] placeholder:text-[#bbb] focus:outline-none"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="•">
                {showPw ? <EyeOff size={17} className="text-[#aaa]" /> : <Eye size={17} className="text-[#aaa]" />}
              </button>
            </div>

            <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-[#888]">
              {t('resetPw2Label')}
            </label>
            <div className="mt-1 flex items-center rounded-[14px] border border-[#eee] bg-[#FAFAFA] px-3 py-3">
              <input
                type={showPw ? 'text' : 'password'}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                minLength={8}
                placeholder="••••••••"
                className="flex-1 bg-transparent text-[15px] text-[#1a1a1a] placeholder:text-[#bbb] focus:outline-none"
              />
            </div>

            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[30px] bg-[#F97316] py-4 text-[15px] font-bold text-white active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? t('resetSubmitting') : t('resetSubmit')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
