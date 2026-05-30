'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/grubano/Card'

const CUISINES = ['Français', 'Italien', 'Japonais', 'Méditerranéen', 'Fusion', 'Végétalien', 'Asiatique', 'Autre']

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
        setError(d.error ?? 'Erreur lors de la soumission')
      }
    } catch {
      setError('Erreur réseau')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="px-4 pt-12 max-w-lg mx-auto text-center">
        <div className="h-20 w-20 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={40} className="text-amber-500" />
        </div>
        <h1 className="text-xl font-display font-bold mb-2">Candidature envoyée !</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Notre équipe examine votre portfolio et vous recontacte sous 48h.
        </p>
        <button
          onClick={() => router.push('/creators')}
          className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600 transition"
        >
          Retour au portail
        </button>
      </div>
    )
  }

  const STEP_LABELS = ['Votre profil', 'Portfolio', 'Confirmation']

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      <h1 className="text-xl font-display font-bold mb-1">Devenir créateur</h1>
      <p className="text-xs text-muted-foreground mb-5">Étape {step + 1} sur {STEP_LABELS.length}</p>

      {/* Stepper */}
      <div className="flex items-center mb-6">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
              i < step  ? 'bg-amber-500 text-white'
              : i === step ? 'bg-amber-500 text-white ring-2 ring-amber-300'
              : 'bg-accent text-muted-foreground'
            }`}>
              {i < step ? <CheckCircle2 size={14} /> : i + 1}
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 transition ${i < step ? 'bg-amber-500' : 'bg-accent'}`} />
            )}
          </div>
        ))}
      </div>

      <Card className="mb-4">
        <h2 className="font-bold mb-4 text-sm">{STEP_LABELS[step]}</h2>

        {/* Step 0 — Profile */}
        {step === 0 && (
          <div className="space-y-3">
            {([
              { key: 'name'  as const, label: 'Nom / pseudo',  type: 'text',  placeholder: 'Amina K.'              },
              { key: 'email' as const, label: 'Email',          type: 'email', placeholder: 'amina@exemple.fr'      },
            ]).map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">{label}</label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={e => setField(key, e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Bio</label>
              <textarea
                rows={3}
                placeholder="Parlez-nous de votre parcours culinaire..."
                value={form.bio}
                onChange={e => setField('bio', e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'instagram' as const, label: 'Instagram', placeholder: '@amina.cuisine' },
                { key: 'tiktok'    as const, label: 'TikTok',    placeholder: '@amina.tiktok'  },
              ]).map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">{label}</label>
                  <input
                    type="text"
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={e => setField(key, e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">YouTube</label>
                <input
                  type="text"
                  placeholder="@amina.youtube"
                  value={form.youtube}
                  onChange={e => setField('youtube', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">Abonnés</label>
                <input
                  type="number"
                  min="0"
                  placeholder="12000"
                  value={form.followers}
                  onChange={e => setField('followers', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 1 — Portfolio (up to 3 dish concepts) */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Soumettez jusqu&apos;à 3 concepts de plats (minimum 1)</p>
            {form.dishConcepts.map((concept, i) => (
              <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Concept {i + 1}</p>
                  {form.dishConcepts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeConcept(i)}
                      className="text-destructive hover:text-destructive/80 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Nom du plat"
                  value={concept.name}
                  onChange={e => setDishField(i, 'name', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <select
                  value={concept.cuisineType}
                  onChange={e => setDishField(i, 'cuisineType', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Type de cuisine...</option>
                  {CUISINES.map(c => <option key={c}>{c}</option>)}
                </select>
                <textarea
                  rows={2}
                  placeholder="Description courte..."
                  value={concept.description}
                  onChange={e => setDishField(i, 'description', e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>
            ))}
            {form.dishConcepts.length < 3 && (
              <button
                type="button"
                onClick={addConcept}
                className="w-full rounded-xl border border-dashed border-border py-2.5 text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1.5 hover:bg-accent transition"
              >
                <Plus size={13} /> Ajouter un concept
              </button>
            )}
          </div>
        )}

        {/* Step 2 — Confirmation */}
        {step === 2 && (
          <div className="space-y-1">
            {[
              { label: 'Nom',           value: form.name                                            },
              { label: 'Email',         value: form.email                                           },
              { label: 'Abonnés',       value: form.followers ? `${parseInt(form.followers).toLocaleString('fr-FR')}` : '—' },
              { label: 'Réseaux',       value: [form.instagram, form.tiktok, form.youtube].filter(Boolean).join(', ') || '—' },
              { label: 'Concepts',      value: `${form.dishConcepts.filter(c => c.name).length} plat(s)` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-semibold text-right max-w-[60%] truncate">{value}</span>
              </div>
            ))}
            {error && <p className="text-xs text-destructive pt-2">{error}</p>}
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-bold flex items-center justify-center gap-2 hover:bg-accent transition"
          >
            <ChevronLeft size={16} /> Retour
          </button>
        )}
        {step < 2 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canProceed()}
            className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-white flex items-center justify-center gap-2 hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continuer <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-white flex items-center justify-center gap-2 hover:bg-amber-600 transition disabled:opacity-50"
          >
            {submitting ? 'Envoi en cours...' : <><CheckCircle2 size={16} /> Envoyer ma candidature</>}
          </button>
        )}
      </div>
    </div>
  )
}
