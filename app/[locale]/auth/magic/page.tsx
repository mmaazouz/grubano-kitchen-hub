'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, MailCheck, CheckCircle2, XCircle } from 'lucide-react'
import { Link, useRouter } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'
import { postLoginPath } from '@/lib/post-login-redirect'

// ── /auth/magic — passwordless sign-in (Phase 0 auth bridge, Agent 14) ────────
//
// Two jobs on one page:
//   • ?token=… present → consume it via signIn('credentials', { magicToken })
//     then route the user by role to their SPACE (creator → /creators/dashboard, …).
//   • no token        → email form → POST /api/auth/magic-link (sends the link).
//
// Fully i18n'd (namespace `magic`), addressed as "vous". This page ADDS a
// passwordless path; the password logins (/eat/auth, /business/auth) are untouched.
// The role → landing table lives in lib/post-login-redirect (single source of truth,
// unit-tested): every partner role lands on its OWN dashboard, never a public landing.

function MagicInner() {
  const params = useSearchParams()
  const token  = params.get('token')
  const router = useRouter()
  const locale = useLocale()
  const t      = useTranslations('magic')

  const [phase, setPhase] = useState<'request' | 'verifying' | 'error' | 'sent'>(token ? 'verifying' : 'request')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Host-aware presentation: on business.grubano.com this shared sign-in page wears
  // the PARTNER chrome (PartnerChrome — clean partner header, light bg) instead of
  // the operator dashboard sidebar, and offers the partner sign-up link. Every other
  // host renders exactly as before. Detected CLIENT-side and defaulting to false, so
  // the app host's SSR + first hydration are byte-identical (no change, no mismatch);
  // business swaps to the partner chrome post-mount.
  const [isPartner, setIsPartner] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname.includes('business')) setIsPartner(true)
  }, [])

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
    try {
      await fetch('/api/auth/magic-link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, locale }),
      })
      setPhase('sent')
    } catch {
      setPhase('sent') // generic by design — never reveal account state
    } finally {
      setSubmitting(false)
    }
  }

  const content = (
    <div className="mx-auto w-full max-w-md">
      <h1 className="mb-1 text-center font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
      <p className="mb-6 text-center text-sm text-grubano-ink-muted">{t('subtitle')}</p>

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
              {isPartner && (
                <p className="border-t border-grubano-border pt-3 text-center text-sm text-grubano-ink-muted">
                  {t('registerPrompt')}{' '}
                  <Link href="/business/start" className="font-semibold text-grubano-primary">{t('registerCta')}</Link>
                </p>
              )}
            </form>
          )}
        </Card>
      </div>
  )

  // Business host → clean partner chrome (no operator sidebar). Other hosts → the
  // existing light shell, unchanged.
  if (isPartner) return <PartnerChrome>{content}</PartnerChrome>
  return <div className="min-h-screen bg-grubano-bg px-4 pt-16">{content}</div>
}

export default function MagicLinkPage() {
  // useSearchParams must sit under a Suspense boundary (Next.js 14 App Router).
  return (
    <Suspense fallback={null}>
      <MagicInner />
    </Suspense>
  )
}
