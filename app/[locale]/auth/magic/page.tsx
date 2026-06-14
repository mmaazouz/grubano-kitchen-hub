'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { Loader2, MailCheck, CheckCircle2, XCircle } from 'lucide-react'
import { useRouter } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'

// ── /auth/magic — passwordless sign-in (Phase 0 auth bridge, Agent 14) ────────
//
// Two jobs on one page:
//   • ?token=… present → consume it via signIn('credentials', { magicToken })
//     then route the user by role (creator → /creators, etc.).
//   • no token        → email form → POST /api/auth/magic-link (sends the link).
//
// NOTE (Phase-0 scope): strings are FR-only here; full i18n is a fast-follow.
// This page ADDS a passwordless path; the password logins (/eat/auth,
// /business/auth) are untouched.

const ROLE_REDIRECTS: Record<string, string> = {
  restaurant: '/dashboard',
  admin:      '/dashboard',
  franchise:  '/franchise',
  creator:    '/creators',
  consumer:   '/eat',
}

function MagicInner() {
  const params = useSearchParams()
  const token  = params.get('token')
  const router = useRouter()
  const locale = useLocale()

  const [phase, setPhase] = useState<'request' | 'verifying' | 'error' | 'sent'>(token ? 'verifying' : 'request')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
        router.push(ROLE_REDIRECTS[role ?? ''] ?? '/eat')
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

  return (
    <div className="min-h-screen bg-grubano-bg px-4 pt-16">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-center font-display text-2xl font-extrabold text-grubano-ink">Connexion Grubano</h1>
        <p className="mb-6 text-center text-sm text-grubano-ink-muted">Connexion sans mot de passe par lien email.</p>

        <Card elevation="sm" padding="lg">
          {phase === 'verifying' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 size={28} className="animate-spin text-grubano-primary" />
              <p className="text-sm text-grubano-ink-muted">Connexion en cours…</p>
            </div>
          )}

          {phase === 'sent' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-grubano-pill bg-grubano-success-tint">
                <MailCheck size={28} className="text-grubano-success" />
              </span>
              <p className="font-display text-base font-bold text-grubano-ink">Vérifie ta boîte mail</p>
              <p className="max-w-xs text-sm text-grubano-ink-muted">
                Si un compte existe pour cet email, un lien de connexion vient d&apos;être envoyé. Le lien expire dans 15 minutes.
              </p>
            </div>
          )}

          {(phase === 'request' || phase === 'error') && (
            <form onSubmit={requestLink} className="space-y-4">
              {phase === 'error' && (
                <p className="flex items-start gap-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">
                  <XCircle size={15} className="mt-0.5 shrink-0" />
                  <span>Ce lien est invalide ou expiré. Demande un nouveau lien ci-dessous.</span>
                </p>
              )}
              <Input
                label="Email"
                type="email"
                required
                placeholder="toi@exemple.fr"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <Button type="submit" variant="primary" size="md" fullWidth loading={submitting}
                leftIcon={submitting ? undefined : <CheckCircle2 size={16} />}>
                {submitting ? 'Envoi…' : 'Recevoir mon lien de connexion'}
              </Button>
              <p className="text-center text-[11px] text-grubano-ink-faint">
                Tu recevras un lien à usage unique, valable 15 minutes.
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}

export default function MagicLinkPage() {
  // useSearchParams must sit under a Suspense boundary (Next.js 14 App Router).
  return (
    <Suspense fallback={null}>
      <MagicInner />
    </Suspense>
  )
}
