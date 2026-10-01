'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { MailCheck, Truck, ArrowLeft, CheckCircle2, Info, LogIn } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'

// ── /supplier/register — self-serve B2B supplier signup (Slice 0, Agent 14) ───
// Passwordless: submits business info to POST /api/supplier/register, which
// creates a SupplierProfile + a passwordless Operator(role='supplier'). Login is
// by magic-link. Anti-bot: hidden honeypot + a form-open timestamp (mirrors the
// partner register flow). LEAN signup (Agent 111): collects ONLY company + contact
// + SIREN + email + consent — the offer (city/categories/zones/terms) is set later
// in the profile, and the coherence check runs at catalogue publication.

export default function SupplierRegisterPage() {
  const t  = useTranslations('supplier')
  const tA = useTranslations('addActivity')

  const [companyName, setCompanyName]     = useState('')
  const [contactName, setContactName]     = useState('')
  const [siren, setSiren]                 = useState('')
  const [email, setEmail]                 = useState('')
  // Agent 111 — lean signup étape 2: city / categories / deliveryZones / paymentTerms are DEFERRED
  // to the supplier profile (/supplier/dashboard/profil), not collected at registration. (Agent 109
  // already deferred phone / minimum-order / lead-time.) The SIREN registry verification is unchanged;
  // the coherence check (vetSupplier) moved to the catalogue-publication trigger (lib/supplier-coherence).
  const [consent, setConsent]             = useState(false)
  const [website, setWebsite]             = useState('') // honeypot — must stay empty
  const [formStartedAt]                   = useState(() => Date.now())

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)
  // Auto-onboarding outcome from the API: 'active' (instantly usable), 'pending'
  // (manual review), or 'rejected'. Drives which success copy + icon we show.
  const [outcome, setOutcome]       = useState<'active' | 'pending' | 'rejected'>('pending')
  // B1.3-C — when arriving from the "add an activity" hub: lock the email to the
  // connected account (carried in ?email) and PREFILL the verified siren/company
  // (editable). Public self-serve visitors (no ?email) keep the free form.
  const [emailLocked, setEmailLocked] = useState(false)
  const [prefilled, setPrefilled]     = useState(false)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const qEmail = p.get('email')
    const qSiren = p.get('siren')
    const qCompany = p.get('company')
    if (qEmail)   { setEmail(qEmail); setEmailLocked(true) }
    if (qSiren)   { setSiren(qSiren); setPrefilled(true) }
    if (qCompany) { setCompanyName(qCompany); setPrefilled(true) }
  }, [])

  // Inline SIREN/SIRET format check (9 or 14 digits, spaces tolerated) — UX only;
  // the server re-validates and is the source of truth.
  const sirenDigits    = siren.replace(/\s+/g, '')
  const sirenValid     = /^\d{9}$/.test(sirenDigits) || /^\d{14}$/.test(sirenDigits)
  const showSirenError = siren.trim().length > 0 && !sirenValid

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!sirenValid) { setError(t('fieldSirenError')); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/supplier/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          contactName,
          siren,
          email,
          // city / categories / deliveryZones / paymentTerms DEFERRED (Agent 111) — set later in the
          // supplier profile; phone / minimum-order / lead-time already deferred (Agent 109).
          consent,
          website,
          formStartedAt,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || t('errorGeneric'))
        return
      }
      const o = data?.outcome
      setOutcome(o === 'active' || o === 'rejected' ? o : 'pending')
      setDone(true)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PartnerChrome>
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
            <Truck size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('registerTitle')}</h1>
            <p className="text-sm text-grubano-ink-muted">{t('registerSubtitle')}</p>
          </div>
        </div>

        <Card elevation="sm" padding="lg">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className={[
                'grid h-14 w-14 place-items-center rounded-grubano-pill',
                outcome === 'rejected' ? 'bg-grubano-surface-muted' : 'bg-grubano-success-tint',
              ].join(' ')}>
                {outcome === 'active'
                  ? <CheckCircle2 size={28} className="text-grubano-success" />
                  : outcome === 'rejected'
                    ? <Info size={28} className="text-grubano-ink-muted" />
                    : <MailCheck size={28} className="text-grubano-success" />}
              </span>
              <p className="font-display text-base font-bold text-grubano-ink">
                {t((outcome === 'active' ? 'successTitleActive' : outcome === 'rejected' ? 'successTitleRejected' : 'successTitle') as 'successTitle')}
              </p>
              <p className="max-w-xs text-sm text-grubano-ink-muted">
                {t((outcome === 'active' ? 'successBodyActive' : outcome === 'rejected' ? 'successBodyRejected' : 'successBody') as 'successBody')}
              </p>
              {outcome === 'active' && (
                <Link
                  href="/auth/magic"
                  className="mt-2 inline-flex items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-5 py-3 font-semibold text-white shadow-grubano-sm transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30"
                >
                  <LogIn size={16} /> {t('successCtaActive')}
                </Link>
              )}
              {outcome === 'pending' && (
                <Link href="/auth/magic" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
                  <ArrowLeft size={14} /> {t('backToLogin')}
                </Link>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">
                  {error}
                </p>
              )}

              {emailLocked && (
                <p className="rounded-grubano-lg border border-grubano-primary/20 bg-grubano-tint/50 px-3 py-2 text-[13px] text-grubano-ink-muted">
                  {tA('emailLocked')}{prefilled ? ' ' + tA('prefillNote') : ''}
                </p>
              )}

              <Input label={t('fieldCompanyName')} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              <Input label={t('fieldContactName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <Input
                label={t('fieldSiren')}
                required
                inputMode="numeric"
                value={siren}
                onChange={(e) => setSiren(e.target.value)}
                placeholder="123 456 789"
                hint={t('fieldSirenHint')}
                error={showSirenError ? t('fieldSirenError') : undefined}
              />
              <Input label={t('fieldEmail')} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={emailLocked} />

              {/* Honeypot — visually hidden, must stay empty (anti-bot). */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>

              <label className="flex items-start gap-2 text-sm text-grubano-ink-muted">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-grubano-primary"
                  required
                />
                <span>{t('consentLabel')}</span>
              </label>

              <Button type="submit" variant="primary" size="md" fullWidth loading={submitting}>
                {submitting ? t('submitting') : t('submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </PartnerChrome>
  )
}
