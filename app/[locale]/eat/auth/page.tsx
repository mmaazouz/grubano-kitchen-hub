'use client'

import { useState, useEffect } from 'react'
import { useRouter } from '@/navigation'
import { signIn } from 'next-auth/react'
import { Eye, EyeOff, Mail, Lock, User as UserIcon, AlertCircle, ShieldCheck, Gift, Zap, Link as LinkIcon } from 'lucide-react'
import { showToast } from '@/lib/eat-cart'
import { useTranslations } from 'next-intl'
import ForgotPasswordModal from '@/components/auth/ForgotPasswordModal'

type Tab = 'login' | 'register'

// One unified sign-in for every role → route by role after login.
const ROLE_REDIRECTS: Record<string, string> = {
  restaurant: '/dashboard',
  admin: '/dashboard',
  franchise: '/franchise',
  creator: '/creators',
  consumer: '/eat',
}

async function routeByRole(router: ReturnType<typeof useRouter>) {
  try {
    const session = await fetch('/api/auth/session').then((r) => r.json())
    const role = session?.user?.role ?? 'consumer'
    router.push(ROLE_REDIRECTS[role] ?? '/eat')
  } catch {
    router.push('/eat')
  }
}

// Password strength — PURELY VISUAL client hint (0..4). It drives ONLY the meter
// segments; it NEVER gates validation or submission (the form keeps minLength=8).
function strengthScore(pw: string): number {
  let s = 0
  if (pw.length >= 8) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}

export default function AuthScreen() {
  const t = useTranslations('eat.auth')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [providers, setProviders] = useState<Record<string, unknown>>({})
  // Emails v2 FIX 3 — the real forgot-password flow (was a "soon" toast).
  const [forgotOpen, setForgotOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/providers')
      .then((r) => r.json())
      .then((p) => setProviders(p ?? {}))
      .catch(() => setProviders({}))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email || !password || (tab === 'register' && !name)) {
      setError(t('errorFillAllFields'))
      return
    }
    setLoading(true)

    if (tab === 'register') {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role: 'consumer' }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? t('errorAccountCreation'))
          setLoading(false)
          return
        }
      } catch {
        setError(t('errorNetwork'))
        setLoading(false)
        return
      }
    }

    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.error) {
      setError(t('errorInvalidCredentials'))
      setLoading(false)
      return
    }
    await routeByRole(router)
    setLoading(false)
  }

  function social(provider: 'google' | 'apple') {
    if (providers[provider]) {
      signIn(provider, { callbackUrl: '/eat' })
    } else {
      showToast(t('socialSoon', { provider: provider === 'google' ? 'Google' : 'Apple' }))
    }
  }

  const isSignup = tab === 'register'
  const pwScore = strengthScore(password)

  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-gb-surface font-gb-sans text-gb-content min-[880px]:grid-cols-[46%_1fr]">
      {/* ── Brand panel — navy (Sign in) / Sunrise gradient (Create account). Decorative,
          no auth logic. Desktop = full-height column; mobile (<880) = compact top banner. */}
      <aside
        className={`relative flex justify-between overflow-hidden text-white max-[879px]:flex-row max-[879px]:items-center max-[879px]:gap-4 max-[879px]:p-6 min-[880px]:flex-col min-[880px]:p-[clamp(28px,3.4vw,44px)] ${
          isSignup ? 'bg-gb-sunrise' : 'bg-gradient-to-br from-gb-ink-800 to-gb-ink-700'
        }`}
      >
        {/* Decorative glows — login (navy): an orange halo (top-right) + a green halo
            (bottom-left); register (sunrise): one crisp white circle (top-right).
            Token-based (no raw rgba); hidden on the compact mobile banner. */}
        {isSignup ? (
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-20 h-80 w-80 rounded-full bg-white/15 max-[879px]:hidden" />
        ) : (
          <>
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-20 h-80 w-80 rounded-full bg-gb-accent/30 blur-2xl max-[879px]:hidden" />
            <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-gb-basil-500/25 blur-2xl max-[879px]:hidden" />
          </>
        )}
        {/* Logo */}
        <div className={`relative z-10 flex items-center gap-3 ${isSignup ? 'min-[880px]:justify-end' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={isSignup ? '/brand/grubano-symbol-white.svg' : '/brand/grubano-symbol-color.svg'}
            alt="Grubano"
            className="h-10 w-auto"
          />
          {!isSignup && <span className="font-gb-display text-2xl font-extrabold tracking-tight text-white">Grubano</span>}
        </div>
        {/* Pitch — h2 shows on mobile (compact), the paragraph is hidden there. */}
        <div className="relative z-10">
          <h2 className="m-0 font-gb-display text-[20px] font-extrabold leading-[1.06] tracking-tight text-white min-[880px]:text-[clamp(26px,3vw,34px)]">
            {isSignup ? t('joinTitle') : t('panelTitle')}
          </h2>
          <p className="mt-3.5 max-w-[34ch] text-[15px] leading-relaxed text-white/85 max-[879px]:hidden">
            {isSignup ? t('joinBenefit') : t('panelTagline')}
          </p>
        </div>
        {/* Meta (Sign in) / welcome badge (Create account) — hidden on mobile. */}
        {isSignup ? (
          <span className="relative z-10 inline-flex items-center gap-2 self-start rounded-gb-full bg-white/20 px-3.5 py-2 text-[12.5px] font-bold text-white max-[879px]:hidden">
            <Gift size={14} /> {t('welcomeBadge')}
          </span>
        ) : (
          <div className="relative z-10 flex gap-4 text-[12.5px] font-medium text-white/85 max-[879px]:hidden">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={16} className="text-gb-basil-400" /> {t('metaSecure')}</span>
            <span className="inline-flex items-center gap-1.5"><Zap size={16} className="text-gb-zest-300" /> {t('metaPasswordless')}</span>
          </div>
        )}
      </aside>

      {/* ── Form panel ── */}
      <section className="flex items-center justify-center p-[clamp(24px,4vw,40px)] max-[879px]:items-start max-[879px]:px-5 max-[879px]:pb-10 max-[879px]:pt-6">
        <div className="w-full max-w-[380px] max-[879px]:mx-auto max-[879px]:max-w-[440px]">
          {/* Title + inversion link — the ONLY login/register switch (CD blueprint has no
              segmented toggle; the sub-paragraph link below flips the mode). */}
          <h1 className="m-0 font-gb-display text-[26px] font-extrabold tracking-tight text-gb-content">
            {isSignup ? t('createAccount') : t('welcomeBack')}
          </h1>
          <p className="mb-6 mt-[7px] text-sm text-gb-content-muted">
            {isSignup ? (
              <>{t('alreadyHaveAccount')} <button type="button" onClick={() => { setTab('login'); setError('') }} className="font-bold text-gb-accent">{t('signIn')}</button></>
            ) : (
              <>{t('noAccountYet')} <button type="button" onClick={() => { setTab('register'); setError('') }} className="font-bold text-gb-accent">{t('register')}</button></>
            )}
          </p>

          {error && (
            <p className="mb-4 flex items-start gap-2 rounded-gb-lg bg-gb-error-soft p-3 text-[13px] text-gb-content" role="alert">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-gb-error" />
              <span>{error}</span>
            </p>
          )}

          {/* OAuth — ALWAYS at the top (CD order). Wired to the real social() handler. */}
          <div className="mb-[18px] flex gap-2.5 max-[380px]:flex-wrap">
            <button onClick={() => social('google')} className="flex flex-1 items-center justify-center gap-2 rounded-gb-md border border-gb-stroke-strong bg-gb-surface-elevated p-3 text-[13.5px] font-semibold text-gb-content active:scale-95">
              {/* Google "G" — BRAND blue, mono (CD blueprint): #4285F4 light / #5B9BFF dark.
                  A brand-logo colour (like Apple's currentColor below), not a DS token. */}
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[17px] w-[17px] text-[#4285F4] dark:text-[#5B9BFF]">
                <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
              </svg>
              Google
            </button>
            <button onClick={() => social('apple')} className="flex flex-1 items-center justify-center gap-2 rounded-gb-md border border-gb-stroke-strong bg-gb-surface-elevated p-3 text-[13.5px] font-semibold text-gb-content active:scale-95">
              <svg width="15" height="17" viewBox="0 0 16 18" fill="currentColor" aria-hidden>
                <path d="M13.3 9.6c0-2 1.6-3 1.7-3a3.6 3.6 0 0 0-2.9-1.5c-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7A3.8 3.8 0 0 0 3.3 7c-1.4 2.4-.4 6 1 8 .6 1 1.4 2 2.4 2s1.3-.6 2.5-.6 1.5.6 2.5.6 1.7-1 2.3-2a8.6 8.6 0 0 0 1-2.1c-.1 0-2-.8-2-3zM11.4 3.3c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z" />
              </svg>
              Apple
            </button>
          </div>

          {/* Divider */}
          <div className="mb-[18px] flex items-center gap-3 text-[11.5px] font-semibold text-gb-content-muted before:h-px before:flex-1 before:bg-gb-stroke before:content-[''] after:h-px after:flex-1 after:bg-gb-stroke after:content-['']">
            {t('orContinueWith')}
          </div>

          <form onSubmit={handleSubmit}>
            {isSignup && (
              <div className="mb-3.5">
                <div className="mb-[7px] text-[12.5px] font-semibold text-gb-content">{t('fullNameLabel')}</div>
                <div className="flex items-center gap-2.5 rounded-gb-md border border-gb-stroke-strong bg-gb-surface-elevated px-3.5 py-3 focus-within:border-gb-accent focus-within:shadow-gb-focus">
                  <UserIcon size={18} className="shrink-0 text-gb-content-muted" />
                  <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={t('fullNamePlaceholder')} className="w-full border-none bg-transparent text-sm text-gb-content outline-none placeholder:text-gb-content-muted" />
                </div>
              </div>
            )}

            <div className="mb-3.5">
              <div className="mb-[7px] text-[12.5px] font-semibold text-gb-content">{t('emailLabel')}</div>
              <div className="flex items-center gap-2.5 rounded-gb-md border border-gb-stroke-strong bg-gb-surface-elevated px-3.5 py-3 focus-within:border-gb-accent focus-within:shadow-gb-focus">
                <Mail size={18} className="shrink-0 text-gb-content-muted" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" placeholder={t('emailPlaceholder')} className="w-full border-none bg-transparent text-sm text-gb-content outline-none placeholder:text-gb-content-muted" />
              </div>
            </div>

            <div className="mb-3.5">
              <div className="mb-[7px] flex items-center justify-between text-[12.5px] font-semibold text-gb-content">
                <span>{t('passwordLabel')}</span>
                {!isSignup && (
                  <button type="button" onClick={() => setForgotOpen(true)} className="text-xs font-semibold text-gb-accent">{t('forgotPassword')}</button>
                )}
              </div>
              <div className="flex items-center gap-2.5 rounded-gb-md border border-gb-stroke-strong bg-gb-surface-elevated px-3.5 py-3 focus-within:border-gb-accent focus-within:shadow-gb-focus">
                <Lock size={18} className="shrink-0 text-gb-content-muted" />
                <input type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="••••••••" minLength={isSignup ? 8 : 1} className="w-full border-none bg-transparent text-sm text-gb-content outline-none placeholder:text-gb-content-muted" />
                <button type="button" onClick={() => setShowPwd((v) => !v)} className="cursor-pointer text-gb-content-muted" aria-label={t('passwordLabel')}>
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Strength meter — purely-visual client hint (Create account only). */}
            {isSignup && (
              <div className="mb-5 mt-2 flex gap-[5px]" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <i
                    key={i}
                    className={`h-[5px] flex-1 rounded-[3px] ${
                      i < pwScore ? (pwScore <= 2 ? 'bg-gb-warning' : 'bg-gb-basil-600') : 'bg-gb-stroke'
                    }`}
                  />
                ))}
              </div>
            )}

            <button type="submit" disabled={loading} className="mb-3 w-full rounded-gb-md bg-gradient-to-br from-gb-zest-400 to-gb-zest-600 p-3.5 text-[15px] font-bold text-white shadow-gb-md active:scale-[0.98] disabled:opacity-70">
              {loading ? t('loading') : isSignup ? t('createMyAccount') : t('signIn')}
            </button>

            {/* Passwordless alternative — routes to the EXISTING magic-link page. */}
            <button type="button" onClick={() => router.push('/auth/magic')} className="flex w-full items-center justify-center gap-2 rounded-gb-md border border-gb-stroke-strong bg-gb-surface-elevated p-[13px] text-sm font-semibold text-gb-content active:scale-95">
              <LinkIcon size={16} /> {t('magicLinkCta')}
            </button>
          </form>

          <p className="mt-[18px] text-center text-[11.5px] leading-relaxed text-gb-content-muted">{t('legal')}</p>
        </div>
      </section>

      {forgotOpen && (
        <ForgotPasswordModal
          space="eat"
          initialEmail={email}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </div>
  )
}
