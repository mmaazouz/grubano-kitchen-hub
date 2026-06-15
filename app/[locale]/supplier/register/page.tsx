'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { MailCheck, Truck, ArrowLeft, CheckCircle2, Info } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'

// ── /supplier/register — self-serve B2B supplier signup (Slice 0, Agent 14) ───
// Passwordless: submits business info to POST /api/supplier/register, which
// creates a pending SupplierProfile + a passwordless Operator(role='supplier').
// Login is by magic-link AFTER an admin approval. Anti-bot: hidden honeypot +
// a form-open timestamp (mirrors the partner register flow).

const CATEGORIES = ['fresh', 'meat', 'fish', 'dairy', 'drinks', 'grocery', 'packaging'] as const

export default function SupplierRegisterPage() {
  const t = useTranslations('supplier')

  const [companyName, setCompanyName]     = useState('')
  const [contactName, setContactName]     = useState('')
  const [siren, setSiren]                 = useState('')
  const [email, setEmail]                 = useState('')
  const [phone, setPhone]                 = useState('')
  const [city, setCity]                   = useState('')
  const [categories, setCategories]       = useState<string[]>([])
  const [deliveryZones, setDeliveryZones] = useState('')
  const [minimumOrderEur, setMinOrder]    = useState('')
  const [leadTimeDays, setLeadTime]       = useState('1')
  const [paymentTerms, setPaymentTerms]   = useState('')
  const [consent, setConsent]             = useState(false)
  const [website, setWebsite]             = useState('') // honeypot — must stay empty
  const [formStartedAt]                   = useState(() => Date.now())

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)
  // Auto-onboarding outcome from the API: 'active' (instantly usable), 'pending'
  // (manual review), or 'rejected'. Drives which success copy + icon we show.
  const [outcome, setOutcome]       = useState<'active' | 'pending' | 'rejected'>('pending')

  function toggleCategory(c: string) {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
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
          phone:           phone || undefined,
          city:            city || undefined,
          categories,
          deliveryZones:   deliveryZones.split(',').map((z) => z.trim()).filter(Boolean),
          minimumOrderEur: Number(minimumOrderEur) || 0,
          leadTimeDays:    Number(leadTimeDays) || 0,
          paymentTerms:    paymentTerms || undefined,
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
    <div className="min-h-screen bg-grubano-bg px-4 py-10">
      <div className="mx-auto max-w-lg">
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
              {outcome !== 'rejected' && (
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

              <Input label={t('fieldCompanyName')} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              <Input label={t('fieldContactName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <div>
                <Input label={t('fieldSiren')} required inputMode="numeric" value={siren} onChange={(e) => setSiren(e.target.value)} placeholder="123 456 789" />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('fieldSirenHint')}</p>
              </div>
              <Input label={t('fieldEmail')} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('fieldPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Input label={t('fieldCity')} value={city} onChange={(e) => setCity(e.target.value)} />
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-grubano-ink">{t('fieldCategories')}</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => {
                    const active = categories.includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCategory(c)}
                        aria-pressed={active}
                        className={[
                          'rounded-grubano-pill border px-3 py-1.5 text-sm font-medium transition-colors',
                          active
                            ? 'border-grubano-primary bg-grubano-primary text-white'
                            : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                        ].join(' ')}
                      >
                        {t(`cat${c.charAt(0).toUpperCase()}${c.slice(1)}` as 'catFresh')}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Input label={t('fieldDeliveryZones')} value={deliveryZones} onChange={(e) => setDeliveryZones(e.target.value)} placeholder="Lyon, Villeurbanne, 69003" />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('fieldDeliveryZonesHint')}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label={t('fieldMinimumOrder')} type="number" inputMode="decimal" min={0} value={minimumOrderEur} onChange={(e) => setMinOrder(e.target.value)} placeholder="50" />
                <Input label={t('fieldLeadTime')} type="number" inputMode="numeric" min={0} value={leadTimeDays} onChange={(e) => setLeadTime(e.target.value)} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('fieldPaymentTerms')}</label>
                <textarea
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  rows={2}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20"
                />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('fieldPaymentTermsHint')}</p>
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
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
