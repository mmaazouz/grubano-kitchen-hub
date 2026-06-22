'use client'

import { Suspense, useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, ChevronRight, ChevronLeft, Building2, User, Star, FileCheck } from 'lucide-react'
import { useRouter } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'

const BRANDS = ['Gnocchi Bar', 'Riz Gourmand', 'Pasta Fresca', 'Bowl Healthy', 'Rollix']

const STEP_ICONS = [User, Building2, Star, FileCheck]

type FormData = {
  name:       string
  // Agent 115 — city + phone deferred to the dashboard (set later on the Operator account).
  email:      string
  siret:      string
  rib:        string
  hasKitchen: boolean
  brandName:  string
  motivation: string
}

function ApplyForm() {
  const t      = useTranslations('franchise.apply')
  const tA     = useTranslations('addActivity')
  const router = useRouter()

  const [step,       setStep]       = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')
  const [form,       setForm]       = useState<FormData>({
    name: '', email: '',
    siret: '', rib: '', hasKitchen: false,
    brandName: '', motivation: '',
  })
  // B1.3-C — from the "add an activity" hub the email arrives in ?email= and is
  // LOCKED, so this candidature attaches to the SAME connected account at approval
  // (FranchiseApplication.email = session email). Public visitors keep a free field.
  const [emailLocked, setEmailLocked] = useState(false)

  function set(key: keyof FormData, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }))
  }

  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get('email')
    if (email) { setForm(f => (f.email ? f : { ...f, email })); setEmailLocked(true) }
  }, [])

  function canProceed(): boolean {
    if (step === 0) return !!form.name && !!form.email
    if (step === 1) return true
    if (step === 2) return !!form.brandName && form.motivation.length >= 10
    return true
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/franchise/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const data = await res.json()
        setError(data.error ?? t('errorSubmit'))
      }
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  const STEP_LABELS = [
    t('stepProfile'),
    t('stepBusiness'),
    t('stepBrand'),
    t('stepConfirm'),
  ]

  if (done) {
    return (
      <div className="px-4 pt-12 max-w-lg mx-auto text-center">
        <div className="h-20 w-20 rounded-grubano-pill bg-grubano-success-tint flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={40} className="text-grubano-success" />
        </div>
        <h1 className="text-xl font-display font-bold mb-2">{t('successTitle')}</h1>
        <p className="text-sm text-grubano-ink-muted mb-6">{t('successDesc')}</p>
        <Button variant="primary" size="md" fullWidth onClick={() => router.push('/franchise')}>
          {t('backToPortal')}
        </Button>
      </div>
    )
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      <h1 className="text-xl font-display font-bold mb-1">{t('title')}</h1>
      <p className="text-xs text-grubano-ink-muted mb-5">
        {t('stepOf', { current: step + 1, total: STEP_LABELS.length })}
      </p>

      {/* Stepper */}
      <div className="flex items-center mb-6">
        {STEP_LABELS.map((label, i) => {
          const Icon = STEP_ICONS[i]
          return (
            <div key={i} className="flex items-center flex-1">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-grubano-pill text-xs font-bold transition ${
                i < step    ? 'bg-grubano-success text-white'
                : i === step ? 'bg-grubano-primary text-white'
                : 'bg-grubano-bg text-grubano-ink-muted'
              }`}>
                {i < step ? <CheckCircle2 size={14} /> : <Icon size={14} />}
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 transition ${i < step ? 'bg-grubano-success' : 'bg-grubano-border'}`} />
              )}
            </div>
          )
        })}
      </div>

      <Card elevation="sm" padding="md" className="mb-4">
        <h2 className="font-bold mb-4 text-sm">{STEP_LABELS[step]}</h2>

        {/* Step 1 — Personal info */}
        {step === 0 && (
          <div className="space-y-3">
            <Input
              label={t('labelName')}
              type="text"
              placeholder="Jean Dupont"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
            <Input
              label={t('labelEmail')}
              type="email"
              placeholder="jean@exemple.fr"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              disabled={emailLocked}
            />
            {emailLocked && (
              <p className="rounded-grubano-lg border border-grubano-primary/20 bg-grubano-tint/50 px-3 py-2 text-xs text-grubano-ink-muted">
                {tA('emailLocked')}
              </p>
            )}
          </div>
        )}

        {/* Step 2 — Business info */}
        {step === 1 && (
          <div className="space-y-3">
            <Input
              label={`${t('labelSiret')} ${t('labelOptional')}`}
              type="text"
              placeholder="12345678901234"
              value={form.siret}
              onChange={e => set('siret', e.target.value)}
            />
            <Input
              label={`${t('labelRib')} ${t('labelOptional')}`}
              type="text"
              placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
              value={form.rib}
              onChange={e => set('rib', e.target.value)}
            />
            <label className="flex items-center gap-3 cursor-pointer rounded-grubano-lg bg-grubano-bg p-3">
              <input
                type="checkbox"
                checked={form.hasKitchen}
                onChange={e => set('hasKitchen', e.target.checked)}
                className="h-4 w-4 rounded accent-grubano-primary"
              />
              <span className="text-sm">{t('labelKitchen')}</span>
            </label>
          </div>
        )}

        {/* Step 3 — Brand selection + motivation */}
        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-grubano-ink-muted uppercase tracking-wide">
                {t('labelBrand')}
              </label>
              <select
                value={form.brandName}
                onChange={e => set('brandName', e.target.value)}
                className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary"
              >
                <option value="">{t('labelBrandPlaceholder')}</option>
                {BRANDS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-grubano-ink-muted uppercase tracking-wide">
                {t('labelMotivation')}
              </label>
              <textarea
                rows={5}
                placeholder={t('motivationPlaceholder')}
                value={form.motivation}
                onChange={e => set('motivation', e.target.value)}
                className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary resize-none"
              />
              <p className="text-[10px] text-grubano-ink-muted mt-1">
                {t('charCount', { count: form.motivation.length })}
              </p>
            </div>
          </div>
        )}

        {/* Step 4 — Confirmation summary */}
        {step === 3 && (
          <div className="space-y-1">
            {([
              { label: t('summaryName'),    value: form.name      },
              { label: t('summaryEmail'),   value: form.email     },
              { label: t('summaryBrand'),   value: form.brandName },
              { label: t('summaryKitchen'), value: form.hasKitchen ? t('kitchenYes') : t('kitchenNo') },
            ] as const).map(({ label, value }) => (
              <div key={label} className="flex justify-between py-2 border-b border-grubano-border last:border-0">
                <span className="text-xs text-grubano-ink-muted">{label}</span>
                <span className="text-xs font-semibold text-right max-w-[60%] truncate">{value}</span>
              </div>
            ))}
            {error && <p className="text-xs text-grubano-danger pt-2">{error}</p>}
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 0 && (
          <Button
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={() => setStep(s => s - 1)}
            leftIcon={<ChevronLeft size={16} />}
          >
            {t('back')}
          </Button>
        )}
        {step < 3 ? (
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={() => setStep(s => s + 1)}
            disabled={!canProceed()}
            rightIcon={<ChevronRight size={16} />}
          >
            {t('continue')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={handleSubmit}
            loading={submitting}
            leftIcon={submitting ? undefined : <CheckCircle2 size={16} />}
          >
            {submitting ? t('submitting') : t('submit')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default function FranchiseApplyPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-grubano-ink-muted">…</div>}>
      <ApplyForm />
    </Suspense>
  )
}
