'use client'

import './auth.css'
import { useState, useEffect } from 'react'
import { useRouter } from '@/navigation'
import { signIn } from 'next-auth/react'
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

  // Markup ported 1:1 from the FROZEN reference (Notion 38dfd2c9-…-81be). `.is-signup` on the
  // root toggles every login/register variant via CSS (replaces the reference's demo setMode()).
  // Wired to the real auth flow; icons are CD's Material Symbols (kept, not lucide); the logo
  // placeholder is replaced by the real Grubano symbol; the strength meter is dynamic.
  function togglePw() { setShowPwd((v) => !v) }

  return (
    <main className={`auth${isSignup ? ' is-signup' : ''}`}>
      <aside className="auth__brand">
        {/* Real Grubano logo replaces the reference's placeholder .auth__mark box */}
        <div className="auth__logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth__mark" src={isSignup ? '/brand/grubano-symbol-white.svg' : '/brand/grubano-symbol-color.svg'} alt="Grubano" />
          <b>Grubano</b>
        </div>
        <div className="auth__pitch">
          <h2 className="show-signin">{t('panelTitle')}</h2>
          <h2 className="show-signup" style={{ color: '#fff' }}>{t('joinTitle')}</h2>
          <p className="show-signin">{t('panelTagline')}</p>
          <p className="show-signup">{t('joinBenefit')}</p>
        </div>
        <div className="auth__meta show-signin">
          <span><span className="ms" style={{ fontSize: '17px', color: '#41BD78' }}>verified_user</span>{t('metaSecure')}</span>
          <span><span className="ms" style={{ fontSize: '17px', color: '#FF9A4D' }}>bolt</span>{t('metaPasswordless')}</span>
        </div>
        <div className="auth__badge show-signup"><span className="ms" style={{ fontSize: '17px' }}>redeem</span>{t('welcomeBadge')}</div>
      </aside>

      <section className="auth__panel">
        <div className="auth__form">
          <h1 className="auth__title">
            <span className="show-signin">{t('welcomeBack')}</span>
            <span className="show-signup">{t('createAccount')}</span>
          </h1>
          <p className="auth__sub">
            <span className="show-signin">
              {t('noAccountYet')}{' '}
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a href="#" onClick={(e) => { e.preventDefault(); setTab('register'); setError('') }}>{t('register')}</a>
            </span>
            <span className="show-signup">
              {t('alreadyHaveAccount')}{' '}
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a href="#" onClick={(e) => { e.preventDefault(); setTab('login'); setError('') }}>{t('signIn')}</a>
            </span>
          </p>

          {error && (
            <p className="auth__error" role="alert">
              <span className="ms" aria-hidden="true">error</span>
              <span>{error}</span>
            </p>
          )}

          <div className="oauth">
            <button className="btn-social" type="button" onClick={() => social('google')}>
              <svg viewBox="0 0 24 24" fill="var(--gb-google)" aria-hidden="true"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
              Google
            </button>
            <button className="btn-social" type="button" onClick={() => social('apple')}>
              <svg viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" /></svg>
              Apple
            </button>
          </div>

          <div className="divider">{t('orContinueWith')}</div>

          <form onSubmit={handleSubmit}>
            <div className="field field--name">
              <div className="field__label">{t('fullNameLabel')}</div>
              <div className="input">
                <span className="ms" aria-hidden="true">person</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={t('fullNamePlaceholder')} />
              </div>
            </div>

            <div className="field">
              <div className="field__label">{t('emailLabel')}</div>
              <div className="input">
                <span className="ms" aria-hidden="true">mail</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" placeholder={t('emailPlaceholder')} />
              </div>
            </div>

            <div className="field">
              <div className="field__label">
                {t('passwordLabel')}{' '}
                {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                <a href="#" className="forgot" onClick={(e) => { e.preventDefault(); setForgotOpen(true) }}>{t('forgotPassword')}</a>
              </div>
              <div className="input">
                <span className="ms" aria-hidden="true">lock</span>
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  minLength={isSignup ? 8 : 1}
                />
                <span
                  className="ms toggle"
                  role="button"
                  tabIndex={0}
                  aria-label={t('passwordLabel')}
                  onClick={togglePw}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePw() } }}
                >
                  {showPwd ? 'visibility' : 'visibility_off'}
                </span>
              </div>
            </div>

            {/* Strength meter — DYNAMIC (bars become .on1 green / .on2 orange by score); style stays */}
            <div className="strength" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className={i < pwScore ? (pwScore <= 2 ? 'on2' : 'on1') : ''} />
              ))}
            </div>

            <button className="btn btn--primary" type="submit" disabled={loading}>
              {loading ? (
                t('loading')
              ) : (
                <>
                  <span className="show-signin">{t('signIn')}</span>
                  <span className="show-signup">{t('createMyAccount')}</span>
                </>
              )}
            </button>

            <button className="btn btn--line" type="button" onClick={() => router.push('/auth/magic')}>
              <span className="ms" aria-hidden="true">link</span>{t('magicLinkCta')}
            </button>
          </form>

          <p className="legal">{t('legal')}</p>
        </div>
      </section>

      {forgotOpen && (
        <ForgotPasswordModal
          space="eat"
          initialEmail={email}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </main>
  )
}
