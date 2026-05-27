'use client'

import { Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronRight, ChevronLeft, Building2, User, Star, FileCheck } from 'lucide-react'
import { Card } from '@/components/grubano/Card'

const BRANDS = ['Gnocchi Bar', 'Riz Gourmand', 'Pasta Fresca', 'Bowl Healthy']

const STEPS = [
  { label: 'Profil',        icon: User       },
  { label: 'Business',      icon: Building2  },
  { label: 'Marque',        icon: Star       },
  { label: 'Confirmation',  icon: FileCheck  },
]

type FormData = {
  name:       string
  city:       string
  phone:      string
  email:      string
  siret:      string
  rib:        string
  hasKitchen: boolean
  brandName:  string
  motivation: string
}

function ApplyForm() {
  const router = useRouter()
  const [step,       setStep]       = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')
  const [form,       setForm]       = useState<FormData>({
    name: '', city: '', phone: '', email: '',
    siret: '', rib: '', hasKitchen: false,
    brandName: '', motivation: '',
  })

  function set(key: keyof FormData, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function canProceed(): boolean {
    if (step === 0) return !!form.name && !!form.city && !!form.phone && !!form.email
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
        setError(data.error ?? 'Erreur lors de la soumission')
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
        <div className="h-20 w-20 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={40} className="text-success" />
        </div>
        <h1 className="text-xl font-display font-bold mb-2">Candidature envoyée !</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Notre équipe examine votre dossier et vous recontacte sous 48h.
        </p>
        <button
          onClick={() => router.push('/franchise')}
          className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition"
        >
          Retour au portail
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      <h1 className="text-xl font-display font-bold mb-1">Candidature franchise</h1>
      <p className="text-xs text-muted-foreground mb-5">Étape {step + 1} sur {STEPS.length}</p>

      {/* Stepper */}
      <div className="flex items-center mb-6">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
              i < step  ? 'bg-success text-white'
              : i === step ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-muted-foreground'
            }`}>
              {i < step ? <CheckCircle2 size={14} /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 transition ${i < step ? 'bg-success' : 'bg-accent'}`} />
            )}
          </div>
        ))}
      </div>

      <Card className="mb-4">
        <h2 className="font-bold mb-4 text-sm">{STEPS[step].label}</h2>

        {/* Step 1 — Personal info */}
        {step === 0 && (
          <div className="space-y-3">
            {([
              { key: 'name',  label: 'Nom complet', type: 'text',  placeholder: 'Jean Dupont'        },
              { key: 'city',  label: 'Ville',        type: 'text',  placeholder: 'Paris'              },
              { key: 'phone', label: 'Téléphone',    type: 'tel',   placeholder: '06 12 34 56 78'     },
              { key: 'email', label: 'Email',         type: 'email', placeholder: 'jean@exemple.fr'   },
            ] as { key: keyof FormData; label: string; type: string; placeholder: string }[]).map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                  {label}
                </label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key] as string}
                  onChange={e => set(key, e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            ))}
          </div>
        )}

        {/* Step 2 — Business info */}
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                SIRET <span className="normal-case font-normal">(optionnel)</span>
              </label>
              <input
                type="text"
                placeholder="12345678901234"
                value={form.siret}
                onChange={e => set('siret', e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                RIB / IBAN <span className="normal-case font-normal">(optionnel)</span>
              </label>
              <input
                type="text"
                placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
                value={form.rib}
                onChange={e => set('rib', e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer rounded-xl bg-accent p-3">
              <input
                type="checkbox"
                checked={form.hasKitchen}
                onChange={e => set('hasKitchen', e.target.checked)}
                className="h-4 w-4 rounded accent-primary"
              />
              <span className="text-sm">J&apos;ai déjà une cuisine disponible</span>
            </label>
          </div>
        )}

        {/* Step 3 — Brand selection + motivation */}
        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                Marque souhaitée
              </label>
              <select
                value={form.brandName}
                onChange={e => set('brandName', e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Sélectionner une marque...</option>
                {BRANDS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                Motivation
              </label>
              <textarea
                rows={5}
                placeholder="Pourquoi souhaitez-vous rejoindre Grubano ? Quelle est votre expérience ?"
                value={form.motivation}
                onChange={e => set('motivation', e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <p className="text-[10px] text-muted-foreground mt-1">{form.motivation.length} caractères</p>
            </div>
          </div>
        )}

        {/* Step 4 — Confirmation summary */}
        {step === 3 && (
          <div className="space-y-1">
            {[
              { label: 'Nom',              value: form.name      },
              { label: 'Ville',            value: form.city      },
              { label: 'Email',            value: form.email     },
              { label: 'Téléphone',        value: form.phone     },
              { label: 'Marque choisie',   value: form.brandName },
              { label: 'Cuisine dispo',    value: form.hasKitchen ? 'Oui' : 'Non' },
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
        {step < 3 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canProceed()}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continuer <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-50"
          >
            {submitting ? 'Envoi en cours...' : <><CheckCircle2 size={16} /> Envoyer ma candidature</>}
          </button>
        )}
      </div>
    </div>
  )
}

export default function FranchiseApplyPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Chargement...</div>}>
      <ApplyForm />
    </Suspense>
  )
}
