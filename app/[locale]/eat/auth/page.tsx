'use client'

import { useState, useEffect } from 'react'
import { useRouter } from '@/navigation'
import { signIn } from 'next-auth/react'
import { Eye, EyeOff, Mail, Lock, User as UserIcon, ArrowLeft, AlertCircle, ShieldCheck } from 'lucide-react'
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

  async function demoLogin() {
    setError('')
    setLoading(true)
    const result = await signIn('credentials', {
      email: 'test@grubano.com',
      password: 'Test1234!',
      redirect: false,
    })
    if (result?.error) {
      setError(t('errorDemoUnavailable'))
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

  return (
    <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content lg:grid lg:grid-cols-2">
      {/* Desktop brand panel — navy for Sign in, Sunrise gradient for Create account.
          Decorative only (no auth logic); hidden on mobile. */}
      <aside
        className={`relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 ${
          tab === 'login' ? 'bg-gb-ink-800' : 'bg-gb-sunrise'
        } text-white`}
      >
        {tab === 'register' && <div aria-hidden className="absolute inset-0 bg-black/25" />}
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="grid h-11 w-11 place-items-center rounded-gb-full bg-white/15 text-xl">🍽️</div>
          <span className="font-gb-display text-xl font-extrabold text-white">Grubano</span>
        </div>
        <div className="relative z-10">
          <h2 className="font-gb-display text-4xl font-extrabold leading-tight text-white">
            {tab === 'login' ? t('panelTitle') : t('joinTitle')}
          </h2>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-white/85">
            {tab === 'login' ? t('panelTagline') : t('joinBenefit')}
          </p>
        </div>
        <p className="relative z-10 inline-flex items-center gap-2 text-sm font-medium text-white/85">
          <ShieldCheck size={16} /> {t('panelSecure')}
        </p>
      </aside>

      {/* Form column */}
      <div className="px-6 pb-10 pt-4 lg:flex lg:flex-col lg:justify-center lg:px-12 lg:py-10">
        <div className="mx-auto w-full max-w-md">
          <button onClick={() => router.push('/eat')} className="mb-6 flex h-10 w-10 items-center justify-center rounded-gb-lg bg-gb-oat-100 active:scale-90 lg:hidden">
            <ArrowLeft size={22} className="text-gb-content" />
          </button>

          {/* Logo (mobile — the desktop logo lives in the brand panel) */}
          <div className="mb-7 flex flex-col items-center lg:hidden">
            <div className="mb-2.5 flex h-[70px] w-[70px] items-center justify-center rounded-gb-full bg-gb-zest-50 text-[32px]">🍽️</div>
            <p className="font-gb-display text-[22px] font-extrabold text-gb-accent">Grubano</p>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex rounded-gb-xl bg-gb-oat-100 p-1">
            {(['login', 'register'] as Tab[]).map((tabItem) => (
              <button
                key={tabItem}
                onClick={() => { setTab(tabItem); setError('') }}
                className={`flex-1 rounded-gb-lg py-2.5 text-sm font-bold transition-all ${tab === tabItem ? 'bg-gb-surface-elevated text-gb-accent shadow-gb-sm' : 'text-gb-content-muted'}`}
              >
                {tabItem === 'login' ? t('tabLogin') : t('tabRegister')}
              </button>
            ))}
          </div>

          <h1 className="font-gb-display text-[26px] font-extrabold text-gb-content">{tab === 'login' ? t('tabLogin') : t('createAccount')}</h1>
          <p className="mb-6 mt-1.5 text-sm text-gb-content-muted">
            {tab === 'login' ? t('loginSubtitle') : t('registerSubtitle')}
          </p>

          {error && (
            <p className="mb-4 flex items-start gap-2 rounded-gb-lg bg-gb-error-soft p-3 text-[13px] text-gb-content" role="alert">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-gb-error" />
              <span>{error}</span>
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'register' && (
              <div>
                <label className="mb-2 block text-[13px] font-semibold text-gb-content">{t('fullNameLabel')}</label>
                <div className="flex items-center rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated px-3.5 py-3.5">
                  <UserIcon size={18} className="mr-2.5 text-gb-content-muted" />
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fullNamePlaceholder')} className="flex-1 bg-transparent text-[15px] text-gb-content placeholder:text-gb-content-muted focus:outline-none" />
                </div>
              </div>
            )}

            <div>
              <label className="mb-2 block text-[13px] font-semibold text-gb-content">{t('emailLabel')}</label>
              <div className="flex items-center rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated px-3.5 py-3.5">
                <Mail size={18} className="mr-2.5 text-gb-content-muted" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('emailPlaceholder')} autoCapitalize="none" className="flex-1 bg-transparent text-[15px] text-gb-content placeholder:text-gb-content-muted focus:outline-none" />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[13px] font-semibold text-gb-content">{t('passwordLabel')}</label>
              <div className="flex items-center rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated px-3.5 py-3.5">
                <Lock size={18} className="mr-2.5 text-gb-content-muted" />
                <input type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={tab === 'register' ? 8 : 1} className="flex-1 bg-transparent text-[15px] text-gb-content placeholder:text-gb-content-muted focus:outline-none" />
                <button type="button" onClick={() => setShowPwd((v) => !v)}>{showPwd ? <EyeOff size={18} className="text-gb-content-muted" /> : <Eye size={18} className="text-gb-content-muted" />}</button>
              </div>
            </div>

            {tab === 'login' && (
              <button type="button" onClick={() => setForgotOpen(true)} className="ml-auto block text-[13px] font-semibold text-gb-accent">
                {t('forgotPassword')}
              </button>
            )}

            <button type="submit" disabled={loading} className="w-full rounded-gb-full bg-gb-accent py-4 text-[17px] font-bold text-gb-content-on-accent shadow-gb-md active:scale-[0.98] disabled:opacity-70">
              {loading ? t('loading') : tab === 'login' ? t('signIn') : t('createMyAccount')}
            </button>

            {/* Passwordless alternative — routes to the EXISTING magic-link page (/auth/magic). */}
            <button
              type="button"
              onClick={() => router.push('/auth/magic')}
              className="flex w-full items-center justify-center gap-2 rounded-gb-full border-[1.5px] border-gb-accent py-3.5 text-sm font-bold text-gb-accent active:scale-[0.98]"
            >
              <Mail size={16} /> {t('magicLinkCta')}
            </button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-gb-stroke" />
            <span className="text-[13px] text-gb-content-muted">{t('orContinueWith')}</span>
            <div className="h-px flex-1 bg-gb-stroke" />
          </div>

          {/* Social */}
          <div className="flex gap-3">
            <button onClick={() => social('google')} className="flex flex-1 items-center justify-center gap-2 rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated py-3.5 text-sm font-semibold text-gb-content active:scale-95">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              Google
            </button>
            <button onClick={() => social('apple')} className="flex flex-1 items-center justify-center gap-2 rounded-gb-lg border-[1.5px] border-gb-stroke bg-gb-surface-elevated py-3.5 text-sm font-semibold text-gb-content active:scale-95">
              <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor" aria-hidden>
                <path d="M13.3 9.6c0-2 1.6-3 1.7-3a3.6 3.6 0 0 0-2.9-1.5c-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7A3.8 3.8 0 0 0 3.3 7c-1.4 2.4-.4 6 1 8 .6 1 1.4 2 2.4 2s1.3-.6 2.5-.6 1.5.6 2.5.6 1.7-1 2.3-2a8.6 8.6 0 0 0 1-2.1c-.1 0-2-.8-2-3zM11.4 3.3c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z" />
              </svg>
              Apple
            </button>
          </div>

          {/* Demo account */}
          <button
            onClick={demoLogin}
            disabled={loading}
            className="mt-4 w-full rounded-gb-lg border-[1.5px] border-dashed border-gb-accent bg-gb-zest-50 py-3 text-sm font-bold text-gb-accent active:scale-[0.98] disabled:opacity-60"
          >
            🚀 {t('tryDemo')}
          </button>

          {/* Switch */}
          <p className="mt-7 text-center text-sm text-gb-content-muted">
            {tab === 'login' ? (
              <>{t('noAccountYet')} <button onClick={() => setTab('register')} className="font-bold text-gb-accent">{t('register')}</button></>
            ) : (
              <>{t('alreadyHaveAccount')} <button onClick={() => setTab('login')} className="font-bold text-gb-accent">{t('signIn')}</button></>
            )}
          </p>
        </div>
      </div>

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
