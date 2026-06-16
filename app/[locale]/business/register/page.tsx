'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  Eye, EyeOff, Mail, Lock, User as UserIcon, ChefHat, ShieldCheck, CheckCircle2, Loader2,
} from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'

// ── /business/register — restaurateur INSCRIPTION (S2 login-unification) ──────
// Self-serve sign-up only. The LOGIN is unified at /auth/magic for every partner
// (this page links there for existing partners). This is the register half that
// used to live in /business/auth (which now redirects to /auth/magic). Logic
// UNCHANGED — POST /api/partners/register → e-mail verification → magic-link login.
// NOTE: register still sets a password (carried over); switching sign-up to
// passwordless is the inscription refonte (S3), out of scope here.

/**
 * Lightweight client-side password strength meter (0..4). Mirrors the server
 * regex in /api/partners/register so the user sees feedback BEFORE submit.
 */
function passwordScore(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 10) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) score++
  return Math.min(4, score)
}

export default function PartnerRegisterScreen() {
  const t = useTranslations('business.auth')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  // Honeypot — must remain empty (anti-bot). Hidden from humans + assistive tech.
  const [honeypot, setHoneypot] = useState('')
  // Render time → server uses (now - formStartedAt) as a light bot signal.
  const [formStartedAt] = useState<number>(() => Date.now())

  const [registeredMessage, setRegisteredMessage] = useState<string | null>(null)

  const pwScore = useMemo(() => passwordScore(password), [password])
  const pwScoreColour = ['bg-gray-200', 'bg-red-400', 'bg-amber-400', 'bg-lime-400', 'bg-green-500'][pwScore] ?? 'bg-gray-200'
  const pwScoreLabel = ['', t('pwWeak'), t('pwOk'), t('pwGood'), t('pwStrong')][pwScore] ?? ''

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !email || !password) { setError(t('registerMissing')); return }
    if (!consent) { setError(t('consentRequired')); return }
    if (passwordScore(password) < 2 || password.length < 10) { setError(t('pwTooWeak')); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/partners/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, consent, website: honeypot, formStartedAt }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null
      if (res.status === 429) { setError(t('rateLimited')); return }
      if (!res.ok) { setError(data?.error || t('registerFailed')); return }
      setRegisteredMessage(data?.message || t('confirmationGeneric'))
    } catch {
      setError(t('networkError'))
    } finally {
      setLoading(false)
    }
  }

  // ── Confirmation screen ──────────────────────────────────────────────────
  if (registeredMessage) {
    return (
      <Layout>
        <Card elevation="premium" padding="lg" className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-grubano-success/15">
            <CheckCircle2 size={32} className="text-grubano-success" />
          </div>
          <h2 className="font-display text-2xl font-extrabold text-grubano-ink">{t('confirmationTitle')}</h2>
          <p className="mt-2 text-grubano-sm leading-relaxed text-grubano-ink-muted">{registeredMessage}</p>
          <Link href="/auth/magic" className="mt-6 block">
            <Button variant="secondary" size="md" fullWidth>{t('backToLogin')}</Button>
          </Link>
        </Card>
      </Layout>
    )
  }

  // ── Register card ─────────────────────────────────────────────────────────
  return (
    <Layout>
      <Card elevation="premium" padding="lg" className="w-full max-w-md">
        <h2 className="mb-1 font-display text-xl font-bold text-grubano-ink">{t('tabRegister')}</h2>
        <p className="mb-5 text-grubano-sm text-grubano-ink-muted">
          {t('loginPrompt')}{' '}
          <Link href="/auth/magic" className="font-semibold text-grubano-primary hover:underline">{t('signIn')}</Link>
        </p>

        {error && (
          <div className="mb-4 rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4" noValidate>
          <Input
            label={t('nameLabel')}
            autoComplete="name"
            required
            minLength={2}
            maxLength={80}
            leftIcon={<UserIcon size={16} />}
            placeholder={t('namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label={t('emailLabel')}
            type="email"
            autoComplete="email"
            required
            leftIcon={<Mail size={16} />}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="space-y-2">
            <Input
              label={t('passwordLabel')}
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={100}
              hint={t('pwHint')}
              leftIcon={<Lock size={16} />}
              rightIcon={
                <button
                  type="button"
                  aria-label={showPwd ? t('hidePassword') : t('showPassword')}
                  onClick={() => setShowPwd((v) => !v)}
                  className="text-grubano-ink-faint hover:text-grubano-ink-muted"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              placeholder={t('pwPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {password.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < pwScore ? pwScoreColour : 'bg-grubano-border'}`} />
                  ))}
                </div>
                <span className="w-14 text-right text-[11px] font-semibold text-grubano-ink-muted">{pwScoreLabel}</span>
              </div>
            )}
          </div>

          {/* Consent — RGPD: never pre-checked */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-grubano-md border border-grubano-border bg-grubano-surface-muted p-3">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-grubano-primary"
              required
            />
            <span className="text-xs leading-relaxed text-grubano-ink-muted">{t('consentText')}</span>
          </label>

          {/* Honeypot — visible only to bots that read the DOM. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}>
            <label htmlFor="business-register-website">Website</label>
            <input
              id="business-register-website"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} leftIcon={loading ? <Loader2 className="animate-spin" size={16} /> : undefined}>
            {t('createAccount')}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-grubano-ink-faint">{t('legalNote')}</p>
        </form>
      </Card>
    </Layout>
  )
}

// ── Layout / brand chrome (matches /business/auth + /business/verified) ──────
function Layout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('business.auth')
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-grubano-surface-muted/40 to-white">
      <header className="border-b border-grubano-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-grubano-md bg-grubano-dark text-grubano-primary shadow-grubano-sm">
              <ChefHat size={18} />
            </div>
            <div>
              <p className="font-display text-base font-extrabold leading-none text-grubano-ink">Grubano</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grubano-primary">{t('brandPartners')}</p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-xs font-semibold text-grubano-primary sm:inline-flex">
            <ShieldCheck size={13} />
            {t('verifiedSpace')}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-10 pt-10 md:flex-row md:items-stretch md:gap-12 md:pt-16">
        {/* Pitch column (hidden on small screens — the form is the priority on mobile) */}
        <section className="hidden flex-1 flex-col justify-center md:flex">
          <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-grubano-ink">{t('heroTitle')}</h1>
          <p className="mt-3 max-w-md text-grubano-sm leading-relaxed text-grubano-ink-muted">{t('heroSubtitle')}</p>
          <ul className="mt-6 space-y-3 text-grubano-sm">
            {(['heroBullet1', 'heroBullet2', 'heroBullet3'] as const).map((k) => (
              <li key={k} className="flex items-start gap-2.5">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-grubano-primary" />
                <span className="text-grubano-ink-muted">{t(k)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Register card column */}
        <section className="mt-2 flex w-full flex-1 justify-center md:mt-0 md:justify-end">{children}</section>
      </main>
    </div>
  )
}
