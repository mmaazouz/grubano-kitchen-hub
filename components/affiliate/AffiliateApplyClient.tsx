'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Megaphone, Loader2, CheckCircle2, Mail } from 'lucide-react'
import { Card, Button, Input } from '@/components/design-system'

// ── AffiliateApplyClient — PRE-LOGIN affiliate signup form (Agent 118, incr. 1/3) ──
// Calqued on the supplier/creator register UX: minimal fields (name + email + consent),
// passwordless. On submit it POSTs /api/affiliate/apply (provisions the Operator + Affiliate),
// then chains the EXISTING POST /api/auth/magic-link so the user receives a sign-in link — both
// endpoints are anti-enumeration, so the success screen is shown for any accepted submission.
// Honeypot (`website`) + a form-open timestamp deter bots (mirrors /api/supplier/register).

export default function AffiliateApplyClient() {
  const t      = useTranslations('affiliate')
  const locale = useLocale()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [consent, setConsent]   = useState(false)
  const [website, setWebsite]   = useState('') // honeypot — real users never see/fill it
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState('')
  const formStartedAt = useRef<number>(0)

  useEffect(() => { formStartedAt.current = Date.now() }, [])

  const canSubmit = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && consent && !submitting

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/affiliate/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:          name.trim(),
          email:         email.trim(),
          consent,
          website,                          // honeypot
          formStartedAt: formStartedAt.current || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? t('errorGeneric'))
        return
      }
      // Chain the EXISTING passwordless sign-in: email the magic link (anti-enumeration, generic).
      // Best-effort — a mail hiccup never blocks the success screen (the account is already created;
      // the user can request a link from /auth/magic).
      await fetch('/api/auth/magic-link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), locale }),
      }).catch(() => {})
      setDone(true)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-lg space-y-4 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-grubano-lg bg-grubano-success-tint text-grubano-success">
          <Mail size={26} />
        </span>
        <h1 className="font-display text-xl font-extrabold text-grubano-ink">{t('applySuccessTitle')}</h1>
        <p className="text-sm text-grubano-ink-muted">{t('applySuccessBody')}</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-lg">
      <Card elevation="sm" padding="lg">
        <div className="mb-4 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-grubano-lg bg-grubano-tint text-grubano-primary">
            <Megaphone size={26} />
          </span>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('applyTitle')}</h1>
          <p className="mt-2 text-sm text-grubano-ink-muted">{t('applySubtitle')}</p>
        </div>

        <ul className="mx-auto mb-5 max-w-sm space-y-1.5 text-left text-sm text-grubano-ink-muted">
          <li>• {t('joinPoint1')}</li>
          <li>• {t('joinPoint2')}</li>
          <li>• {t('joinPoint3')}</li>
        </ul>

        <form onSubmit={submit} className="space-y-3">
          <Input
            label={t('applyNameLabel')}
            type="text"
            placeholder={t('applyNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
          <Input
            label={t('applyEmailLabel')}
            type="email"
            placeholder={t('applyEmailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          {/* Honeypot — visually hidden, off-screen, not focusable. A bot fills it → silent OK. */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-grubano-lg bg-grubano-bg p-3">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-grubano-primary"
            />
            <span className="text-[13px] leading-snug text-grubano-ink-muted">{t('applyConsent')}</span>
          </label>

          {error && (
            <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            disabled={!canSubmit}
            leftIcon={submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          >
            {submitting ? t('applySubmitting') : t('applySubmit')}
          </Button>
          <p className="text-center text-[11px] text-grubano-ink-faint">{t('joinNoVerif')}</p>
        </form>
      </Card>
    </div>
  )
}
