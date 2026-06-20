'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { MailCheck, Wrench, ArrowLeft, CheckCircle2, Info, LogIn } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'

// ── PrestataireRegisterForm — self-serve SERVICES signup form (P1, Agent 74) ──
// The client form, a CLONE of /supplier/register adapted to services. It is rendered
// ONLY by the server page.tsx, which 404s (notFound) when PRESTATAIRE_ENABLED is OFF —
// so the role never leaks even though /business/* is PUBLIC. Passwordless: submits to
// POST /api/prestataire/register (also 404-gated server-side), creating a pending
// PrestataireProfile + a passwordless Operator(role='prestataire'). Login is by
// magic-link AFTER verification/approval. Anti-bot: hidden honeypot + form-open
// timestamp. NO services list / quotes / payment in P1.

const SERVICE_CATEGORIES = [
  'electricity', 'plumbing', 'haccp', 'cleaning', 'pest_control',
  'fridge_repair', 'kitchen_maintenance', 'accounting', 'training', 'other',
] as const
const MODALITIES = ['on_site', 'remote', 'both'] as const

const SVC_LABEL: Record<(typeof SERVICE_CATEGORIES)[number], string> = {
  electricity: 'svcElectricity', plumbing: 'svcPlumbing', haccp: 'svcHaccp', cleaning: 'svcCleaning',
  pest_control: 'svcPestControl', fridge_repair: 'svcFridgeRepair', kitchen_maintenance: 'svcKitchenMaintenance',
  accounting: 'svcAccounting', training: 'svcTraining', other: 'svcOther',
}
const MODALITY_LABEL: Record<(typeof MODALITIES)[number], string> = {
  on_site: 'modalityOnSite', remote: 'modalityRemote', both: 'modalityBoth',
}

export default function PrestataireRegisterForm() {
  const t  = useTranslations('prestataire')
  const tA = useTranslations('addActivity')

  const [companyName, setCompanyName]       = useState('')
  const [contactName, setContactName]       = useState('')
  const [siren, setSiren]                   = useState('')
  const [email, setEmail]                   = useState('')
  const [phone, setPhone]                   = useState('')
  const [city, setCity]                     = useState('')
  const [serviceCategories, setServices]    = useState<string[]>([])
  const [coverageZones, setCoverageZones]   = useState('')
  const [modality, setModality]             = useState<(typeof MODALITIES)[number]>('on_site')
  const [indicativeRate, setIndicativeRate] = useState('')
  const [consent, setConsent]               = useState(false)
  const [website, setWebsite]               = useState('') // honeypot — must stay empty
  const [formStartedAt]                     = useState(() => Date.now())

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)
  const [outcome, setOutcome]       = useState<'active' | 'pending' | 'rejected'>('pending')
  // When arriving from the "add an activity" hub: lock the email + PREFILL siren/company.
  const [emailLocked, setEmailLocked] = useState(false)
  const [prefilled, setPrefilled]     = useState(false)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const qEmail = p.get('email')
    const qSiren = p.get('siren')
    if (qEmail) { setEmail(qEmail); setEmailLocked(true) }
    if (qSiren) { setSiren(qSiren); setPrefilled(true) }
  }, [])

  const sirenDigits    = siren.replace(/\s+/g, '')
  const sirenValid     = /^\d{9}$/.test(sirenDigits) || /^\d{14}$/.test(sirenDigits)
  const showSirenError = siren.trim().length > 0 && !sirenValid

  function toggleService(c: string) {
    setServices((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!sirenValid) { setError(t('fieldSirenError')); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/prestataire/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          contactName,
          siren,
          email,
          phone:          phone || undefined,
          city:           city || undefined,
          serviceCategories,
          coverageZones:  coverageZones.split(',').map((z) => z.trim()).filter(Boolean),
          modality,
          indicativeRate: indicativeRate || undefined,
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
            <Wrench size={20} />
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
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('fieldPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Input label={t('fieldCity')} value={city} onChange={(e) => setCity(e.target.value)} />
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-grubano-ink">{t('fieldServices')}</p>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_CATEGORIES.map((c) => {
                    const active = serviceCategories.includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleService(c)}
                        aria-pressed={active}
                        className={[
                          'rounded-grubano-pill border px-3 py-1.5 text-sm font-medium transition-colors',
                          active
                            ? 'border-grubano-primary bg-grubano-primary text-white'
                            : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                        ].join(' ')}
                      >
                        {t(SVC_LABEL[c] as 'svcOther')}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-grubano-ink">{t('fieldModality')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {MODALITIES.map((m) => {
                    const active = modality === m
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModality(m)}
                        aria-pressed={active}
                        className={[
                          'rounded-grubano-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20',
                          active
                            ? 'border-grubano-primary bg-grubano-primary text-white'
                            : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                        ].join(' ')}
                      >
                        {t(MODALITY_LABEL[m] as 'modalityOnSite')}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Input label={t('fieldCoverageZones')} value={coverageZones} onChange={(e) => setCoverageZones(e.target.value)} placeholder="Lyon, Villeurbanne, 69003" />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('fieldCoverageZonesHint')}</p>
              </div>

              <div>
                <Input label={t('fieldIndicativeRate')} value={indicativeRate} onChange={(e) => setIndicativeRate(e.target.value)} placeholder={t('fieldIndicativeRatePlaceholder')} />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('fieldIndicativeRateHint')}</p>
              </div>

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

              <Link href="/business/start" className="block text-center text-sm font-semibold text-grubano-ink-muted hover:text-grubano-primary">
                {t('back')}
              </Link>
            </form>
          )}
        </Card>
      </div>
    </PartnerChrome>
  )
}
