'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { useRouter } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import { type CategorySlug } from '@/lib/categories'

// System cuisine slugs — used as option values so the dish concepts store a
// normalised slug that getCategoryLabel() can translate later.
const CUISINE_SLUGS: CategorySlug[] = [
  'italien', 'asiatique', 'healthy', 'bowls', 'desserts',
  'burgers', 'wraps', 'sandwiches', 'pizza', 'sushi', 'pates', 'boissons',
]

// Human-readable French labels for the select (fr labels are stable for the apply form)
const CUISINE_LABELS: Record<CategorySlug, string> = {
  italien:    'Italien',
  asiatique:  'Asiatique',
  healthy:    'Healthy',
  bowls:      'Bowls',
  desserts:   'Desserts',
  burgers:    'Burgers',
  wraps:      'Wraps',
  sandwiches: 'Sandwiches',
  pizza:      'Pizza',
  sushi:      'Sushi',
  pates:      'Pâtes',
  boissons:   'Boissons',
}

type DishConcept = {
  name:        string
  description: string
  cuisineType: string
}

type FormData = {
  name:         string
  email:        string
  bio:          string
  instagram:    string
  tiktok:       string
  youtube:      string
  followers:    string
  dishConcepts: DishConcept[]
}

const EMPTY_CONCEPT: DishConcept = { name: '', description: '', cuisineType: '' }

export default function CreatorsApplyPage() {
  const t      = useTranslations('creators.apply')
  const router = useRouter()

  const [step,       setStep]       = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')
  const [form,       setForm]       = useState<FormData>({
    name: '', email: '', bio: '',
    instagram: '', tiktok: '', youtube: '', followers: '',
    dishConcepts: [{ ...EMPTY_CONCEPT }],
  })

  function setField(key: keyof Omit<FormData, 'dishConcepts'>, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function setDishField(i: number, key: keyof DishConcept, value: string) {
    setForm(f => {
      const concepts = [...f.dishConcepts]
      concepts[i] = { ...concepts[i], [key]: value }
      return { ...f, dishConcepts: concepts }
    })
  }

  function addConcept() {
    if (form.dishConcepts.length < 3) {
      setForm(f => ({ ...f, dishConcepts: [...f.dishConcepts, { ...EMPTY_CONCEPT }] }))
    }
  }

  function removeConcept(i: number) {
    setForm(f => ({ ...f, dishConcepts: f.dishConcepts.filter((_, idx) => idx !== i) }))
  }

  function canProceed(): boolean {
    if (step === 0) return !!form.name && !!form.email && form.bio.length >= 10
    if (step === 1) return form.dishConcepts.some(c => c.name && c.description && c.cuisineType)
    return true
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/creators/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         form.name,
          email:        form.email,
          bio:          form.bio,
          instagram:    form.instagram || undefined,
          tiktok:       form.tiktok   || undefined,
          youtube:      form.youtube  || undefined,
          followers:    parseInt(form.followers || '0', 10),
          dishConcepts: form.dishConcepts.filter(c => c.name && c.description && c.cuisineType),
        }),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const d = await res.json()
        setError(d.error ?? t('errorSubmit'))
      }
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  const STEP_LABELS = [t('stepProfile'), t('stepPortfolio'), t('stepConfirm')]

  if (done) {
    return (
      <div className="px-4 pt-12 max-w-lg mx-auto text-center">
        <div className="h-20 w-20 rounded-grubano-pill bg-grubano-success-tint flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={40} className="text-grubano-success" />
        </div>
        <h1 className="text-xl font-display font-bold mb-2">{t('successTitle')}</h1>
        <p className="text-sm text-grubano-ink-muted mb-6">{t('successDesc')}</p>
        <Button variant="primary" size="md" fullWidth onClick={() => router.push('/creators')}>
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
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-grubano-pill text-xs font-bold transition ${
              i < step    ? 'bg-grubano-primary text-white'
              : i === step ? 'bg-grubano-primary text-white ring-2 ring-grubano-primary/40'
              : 'bg-grubano-bg text-grubano-ink-muted'
            }`}>
              {i < step ? <CheckCircle2 size={14} /> : i + 1}
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 transition ${i < step ? 'bg-grubano-primary' : 'bg-grubano-border'}`} />
            )}
          </div>
        ))}
      </div>

      <Card elevation="sm" padding="md" className="mb-4">
        <h2 className="font-bold mb-4 text-sm">{STEP_LABELS[step]}</h2>

        {/* Step 0 — Profile */}
        {step === 0 && (
          <div className="space-y-3">
            <Input
              label={t('labelName')}
              type="text"
              placeholder="Amina K."
              value={form.name}
              onChange={e => setField('name', e.target.value)}
            />
            <Input
              label={t('labelEmail')}
              type="email"
              placeholder="amina@exemple.fr"
              value={form.email}
              onChange={e => setField('email', e.target.value)}
            />
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-grubano-ink-muted uppercase tracking-wide">
                {t('labelBio')}
              </label>
              <textarea
                rows={3}
                placeholder={t('bioPlaceholder')}
                value={form.bio}
                onChange={e => setField('bio', e.target.value)}
                className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label={t('labelInstagram')}
                type="text"
                placeholder="@amina.cuisine"
                value={form.instagram}
                onChange={e => setField('instagram', e.target.value)}
              />
              <Input
                label={t('labelTiktok')}
                type="text"
                placeholder="@amina.tiktok"
                value={form.tiktok}
                onChange={e => setField('tiktok', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label={t('labelYoutube')}
                type="text"
                placeholder="@amina.youtube"
                value={form.youtube}
                onChange={e => setField('youtube', e.target.value)}
              />
              <Input
                label={t('labelFollowers')}
                type="number"
                placeholder="12000"
                min="0"
                value={form.followers}
                onChange={e => setField('followers', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 1 — Portfolio */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-grubano-ink-muted">{t('portfolioHint')}</p>
            {form.dishConcepts.map((concept, i) => (
              <div key={i} className="rounded-grubano-lg border border-grubano-border p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-grubano-ink-muted uppercase">
                    {t('conceptLabel', { n: i + 1 })}
                  </p>
                  {form.dishConcepts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeConcept(i)}
                      className="text-grubano-danger hover:text-grubano-danger/80 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder={t('conceptNamePlaceholder')}
                  value={concept.name}
                  onChange={e => setDishField(i, 'name', e.target.value)}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary"
                />
                <select
                  value={concept.cuisineType}
                  onChange={e => setDishField(i, 'cuisineType', e.target.value)}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary"
                >
                  <option value="">{t('conceptCuisinePlaceholder')}</option>
                  {CUISINE_SLUGS.map(slug => (
                    <option key={slug} value={slug}>{CUISINE_LABELS[slug]}</option>
                  ))}
                </select>
                <textarea
                  rows={2}
                  placeholder={t('conceptDescPlaceholder')}
                  value={concept.description}
                  onChange={e => setDishField(i, 'description', e.target.value)}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary resize-none"
                />
              </div>
            ))}
            {form.dishConcepts.length < 3 && (
              <button
                type="button"
                onClick={addConcept}
                className="w-full rounded-grubano-lg border border-dashed border-grubano-border py-2.5 text-xs font-semibold text-grubano-ink-muted flex items-center justify-center gap-1.5 hover:bg-grubano-bg transition"
              >
                <Plus size={13} /> {t('addConcept')}
              </button>
            )}
          </div>
        )}

        {/* Step 2 — Confirmation */}
        {step === 2 && (
          <div className="space-y-1">
            {([
              { label: t('summaryName'),      value: form.name },
              { label: t('summaryEmail'),     value: form.email },
              {
                label: t('summaryFollowers'),
                value: form.followers ? parseInt(form.followers).toLocaleString('fr-FR') : t('none'),
              },
              {
                label: t('summaryNetworks'),
                value: [form.instagram, form.tiktok, form.youtube].filter(Boolean).join(', ') || t('none'),
              },
              {
                label: t('stepPortfolio'),
                value: t('summaryConcepts', { count: form.dishConcepts.filter(c => c.name).length }),
              },
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
        {step < 2 ? (
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
