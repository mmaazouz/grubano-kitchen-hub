'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, MailCheck, CheckCircle2, XCircle } from 'lucide-react'
import { Link, useRouter } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import PartnerShell from '@/components/business/PartnerShell'
import { postLoginPath } from '@/lib/post-login-redirect'
import { requestMagicLink, type MagicLinkFailure } from '@/lib/magic-link-client'

// ── /auth/magic — passwordless sign-in (Phase 0 auth bridge, Agent 14) ────────
//
// Two jobs on one page:
//   • ?token=… present → consume it via signIn('credentials', { magicToken })
//     then route the user by role to their SPACE (creator → /creators/dashboard, …).
//   • no token        → email form → POST /api/auth/magic-link (sends the link).
//
// Fully i18n'd (namespace `magic`), addressed as "vous". This page ADDS a
// passwordless path; the password logins (/eat/auth) are untouched. The role →
// landing table lives in lib/post-login-redirect (single source of truth).
//
// UNIFICATION (2026-08-30) — la page rend la MÊME expérience sur TOUS les hôtes :
//   • PartnerShell (mode parcours, réf bankée partner-shell.html) INCONDITIONNEL —
//     l'ancien PartnerChrome legacy gaté sur window.location.hostname est SUPPRIMÉ
//     (c'était le « seul trou du tunnel » du reality check : app.grubano.com rendait
//     une page nue SANS lien d'inscription = impasse UX pour un non-inscrit).
//   • Le lien « Inscrire mon entreprise » est UNCONDITIONNEL, hors Suspense.
//   • Titre + sous-titre + lien d'inscription vivent HORS du bailout useSearchParams
//     → présents dans le HTML SERVEUR (fini la page blanche pré-hydratation) ;
//     seule la carte dynamique (token/formulaire) est sous Suspense (squelette).
//   • Aucun OperatorShell ici, sur AUCUN hôte (verrou lib/app-chrome-rules + tests).
//   • Le flow magic (host de callback, token, e-mail) est STRICTEMENT inchangé.

function MagicCard() {
  const params = useSearchParams()
  const token  = params.get('token')
  const router = useRouter()
  const locale = useLocale()
  const t      = useTranslations('magic')

  const [phase, setPhase] = useState<'request' | 'verifying' | 'error' | 'sent'>(token ? 'verifying' : 'request')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Échec de TRANSPORT du mint (429 / 5xx / réseau) — affiché honnêtement sur le
  // formulaire au lieu du faux écran « envoyé » (reality check 2026-08-29).
  const [sendError, setSendError] = useState<MagicLinkFailure | null>(null)
  // Phase 3 (Agent 88) — login email-code fallback. The magic-link response reports
  // whether the global OTP flag is ON (a config boolean, no enumeration leak); when so,
  // the "sent" screen also offers a 6-digit code box → same session as the link.
  const [otpEnabled, setOtpEnabled] = useState(false)
  const [code, setCode] = useState('')
  const [otpSubmitting, setOtpSubmitting] = useState(false)
  const [otpError, setOtpError] = useState(false)

  // Token present → try to sign in, then redirect by role.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      const res = await signIn('credentials', { magicToken: token, redirect: false })
      if (cancelled) return
      if (res?.ok) {
        const session = await fetch('/api/auth/session', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
        const role = (session?.user as { role?: string } | undefined)?.role
        router.push(postLoginPath(role))
      } else {
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [token, router])

  async function requestLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email || submitting) return
    setSubmitting(true)
    setSendError(null)
    try {
      // 2xx reste générique (anti-énumération) ; 429/5xx/réseau = échec de TRANSPORT
      // → message honnête, on reste sur le formulaire (fini le faux « envoyé »).
      const res = await requestMagicLink(email, { locale })
      if (!res.ok) {
        setSendError(res.reason)
        return
      }
      setOtpEnabled(res.otpEnabled)
      setPhase('sent')
    } finally {
      setSubmitting(false)
    }
  }

  // Code path (alternative to the link) → consume the OTP via the credentials provider,
  // then route by role EXACTLY like the token path. Errors stay generic.
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim()
    if (!/^\d{6}$/.test(c) || otpSubmitting) return
    setOtpSubmitting(true)
    setOtpError(false)
    try {
      const res = await signIn('credentials', { email, otp: c, redirect: false })
      if (res?.ok) {
        const session = await fetch('/api/auth/session', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
        const role = (session?.user as { role?: string } | undefined)?.role
        router.push(postLoginPath(role))
      } else {
        setOtpError(true)
      }
    } catch {
      setOtpError(true)
    } finally {
      setOtpSubmitting(false)
    }
  }

  return (
    <Card elevation="sm" padding="lg">
      {phase === 'verifying' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite">
          <Loader2 size={28} className="animate-spin text-grubano-primary" />
          <p className="text-sm text-grubano-ink-muted">{t('verifying')}</p>
        </div>
      )}

      {phase === 'sent' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite">
          <span className="grid h-14 w-14 place-items-center rounded-grubano-pill bg-grubano-success-tint">
            <MailCheck size={28} className="text-grubano-success" />
          </span>
          <p className="font-display text-base font-bold text-grubano-ink">{t('sentTitle')}</p>
          <p className="max-w-xs text-sm text-grubano-ink-muted">{t('sentBody')}</p>

          {otpEnabled && (
            <form onSubmit={verifyCode} className="mt-4 w-full max-w-xs space-y-3 border-t border-grubano-border pt-4" noValidate>
              <p className="text-sm text-grubano-ink-muted">{t('otpPrompt')}</p>
              {otpError && (
                <p role="alert" className="flex items-start gap-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-left text-sm text-grubano-danger">
                  <XCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{t('otpError')}</span>
                </p>
              )}
              <Input
                label={t('otpLabel')}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <Button type="submit" variant="primary" size="md" fullWidth loading={otpSubmitting}
                disabled={code.trim().length !== 6}>
                {otpSubmitting ? t('otpSubmitting') : t('otpSubmit')}
              </Button>
            </form>
          )}
        </div>
      )}

      {(phase === 'request' || phase === 'error') && (
        <form onSubmit={requestLink} className="space-y-4" noValidate>
          {phase === 'error' && (
            <p role="alert" className="flex items-start gap-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">
              <XCircle size={15} className="mt-0.5 shrink-0" />
              <span>{t('errorMsg')}</span>
            </p>
          )}
          {sendError && (
            <p role="alert" className="flex items-start gap-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">
              <XCircle size={15} className="mt-0.5 shrink-0" />
              <span>{t(sendError === 'rate_limited' ? 'sendErrorRate' : 'sendErrorDown')}</span>
            </p>
          )}
          <Input
            label={t('emailLabel')}
            type="email"
            required
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Button type="submit" variant="primary" size="md" fullWidth loading={submitting}
            leftIcon={submitting ? undefined : <CheckCircle2 size={16} />}>
            {submitting ? t('submitting') : t('submit')}
          </Button>
          <p className="text-center text-[11px] text-grubano-ink-faint">{t('hint')}</p>
        </form>
      )}
    </Card>
  )
}

// Squelette statique de la carte — rendu SERVEUR pendant le bailout useSearchParams
// (plus jamais de page blanche avant hydratation).
function CardSkeleton() {
  return (
    <Card elevation="sm" padding="lg">
      <div className="space-y-4" aria-hidden="true">
        <div className="h-4 w-24 animate-pulse rounded bg-grubano-border" />
        <div className="h-11 w-full animate-pulse rounded-grubano-lg bg-grubano-surface-muted" />
        <div className="h-11 w-full animate-pulse rounded-grubano-lg bg-grubano-tint" />
      </div>
    </Card>
  )
}

export default function MagicLinkPage() {
  const t = useTranslations('magic')
  return (
    <PartnerShell mode="parcours" exitHref="/business">
      <div className="mx-auto w-full max-w-md">
        <h1 className="mb-1 text-center font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
        <p className="mb-6 text-center text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        {/* useSearchParams doit vivre sous Suspense (App Router) — mais SEULEMENT la
            carte : le chrome, le titre et le lien d'inscription restent server-rendered. */}
        <Suspense fallback={<CardSkeleton />}>
          <MagicCard />
        </Suspense>
        {/* Lien d'inscription UNCONDITIONNEL (les deux hôtes) — l'impasse UX de
            l'app host est fermée. */}
        <p className="mt-4 text-center text-sm text-grubano-ink-muted">
          {t('registerPrompt')}{' '}
          <Link href="/business/start" className="font-semibold text-grubano-primary">{t('registerCta')}</Link>
        </p>
      </div>
    </PartnerShell>
  )
}
