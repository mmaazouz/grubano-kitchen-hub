'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2, ChevronRight, ChevronLeft, Plus, Trash2,
  Copy, Check, ExternalLink, XCircle, Clock,
} from 'lucide-react'
import { useRouter } from '@/navigation'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import { type CategorySlug } from '@/lib/categories'

// ── Cuisine slugs (stable values stored on CreatorDish) ────────────────────────
const CUISINE_SLUGS: CategorySlug[] = [
  'italien', 'asiatique', 'healthy', 'bowls', 'desserts',
  'burgers', 'wraps', 'sandwiches', 'pizza', 'sushi', 'pates', 'boissons',
]

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

// ── Types ─────────────────────────────────────────────────────────────────────

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

/** Shape returned by POST /api/creators/apply/{id}/verify */
type VerifyOkResult = {
  ok:               true
  status:           'approved' | 'flagged'
  verified:         boolean
  referralLinkSlug: string
  subscriberCount:  number
  reason?:          string
}
type VerifyFailResult = {
  ok:       false
  status?:  'rejected'
  reason:   string
  message?: string
}
type VerifyOutcome = VerifyOkResult | VerifyFailResult

const EMPTY_CONCEPT: DishConcept = { name: '', description: '', cuisineType: '' }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CreatorsApplyPage() {
  const t      = useTranslations('creators.apply')
  const tA     = useTranslations('addActivity')
  const router = useRouter()

  // ── Form state ──────────────────────────────────────────────────────────────
  const [step,       setStep]       = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')
  const [form,       setForm]       = useState<FormData>({
    name: '', email: '', bio: '',
    instagram: '', tiktok: '', youtube: '', followers: '',
    dishConcepts: [{ ...EMPTY_CONCEPT }],
  })

  // Mission 2 — role choice (cumulable, at least one). Defaults: BOTH.
  const [roles, setRoles] = useState<{ chef: boolean; influencer: boolean }>({ chef: true, influencer: true })
  // P2 — entry via the /business/start influencer teaser (?type=influencer):
  // pre-select the influencer role ALONE (chef off) + show the influencer title.
  // Any other / no ?type leaves the default (both roles selectable) untouched.
  const [influencerEntry, setInfluencerEntry] = useState(false)
  // B1.3-C — when arriving from the "add an activity" hub the email is carried in
  // ?email= and LOCKED, so the creator activity attaches to the SAME connected
  // account (never a 2nd Operator). Public visitors (no ?email) keep a free field.
  const [emailLocked, setEmailLocked] = useState(false)

  // Phase 3 — a logged-in user arriving via "Devenir aussi créateur" carries their
  // email in ?email= so the form is pre-filled (multi-role cumul: same account
  // gains the creator role on approval). Read from the URL on mount — no
  // useSearchParams (avoids a Suspense boundary); never overwrites a typed value.
  // P2 — the same mount pass reads ?type to drive the influencer-only entry.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const email = params.get('email')
    if (email) { setForm(f => (f.email ? f : { ...f, email })); setEmailLocked(true) }
    if (params.get('type') === 'influencer') {
      setInfluencerEntry(true)
      setRoles({ chef: false, influencer: true })
    }
  }, [])

  function toggleRole(key: 'chef' | 'influencer') {
    setRoles(r => {
      const next = { ...r, [key]: !r[key] }
      // At least one role stays active — flipping the last one off is a no-op.
      if (!next.chef && !next.influencer) return r
      return next
    })
  }

  // ── Verification state ──────────────────────────────────────────────────────
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [verifyCode,    setVerifyCode]    = useState<string | null>(null)
  const [verifying,     setVerifying]     = useState(false)
  const [verifyResult,  setVerifyResult]  = useState<VerifyOutcome | null>(null)
  const [copied,        setCopied]        = useState(false)

  // ── Form helpers ────────────────────────────────────────────────────────────
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
    if (form.dishConcepts.length < 3)
      setForm(f => ({ ...f, dishConcepts: [...f.dishConcepts, { ...EMPTY_CONCEPT }] }))
  }

  function removeConcept(i: number) {
    setForm(f => ({ ...f, dishConcepts: f.dishConcepts.filter((_, idx) => idx !== i) }))
  }

  // ── Step model (Mission 14) ───────────────────────────────────────────────────
  // The "portfolio" (dish-concepts) step is CHEF-only. A PURE influencer
  // (influencer on / chef off) never sees it and is never blocked by it, so they
  // can finish the application -> isInfluencer=true, isChef=false. The role cards
  // live ONLY on the "profile" step (always index 0), so toggling a role can
  // never desync the numeric `step` against this array. Chef and chef+influencer
  // keep the exact three-step flow.
  const isInfluencerOnly = roles.influencer && !roles.chef
  const STEP_KEYS: Array<'profile' | 'portfolio' | 'confirm'> = isInfluencerOnly
    ? ['profile', 'confirm']
    : ['profile', 'portfolio', 'confirm']
  const currentKey = STEP_KEYS[step] ?? 'profile'
  const totalSteps = STEP_KEYS.length

  function canProceed(): boolean {
    if (currentKey === 'profile')   return !!form.name && !!form.email && form.bio.length >= 10
    if (currentKey === 'portfolio') return form.dishConcepts.some(c => c.name && c.description && c.cuisineType)
    return true // confirm
  }

  // ── Submit form ─────────────────────────────────────────────────────────────
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
          roles,
        }),
      })
      if (res.ok) {
        const d = await res.json()
        setApplicationId(d.applicationId ?? null)
        setVerifyCode(d.verifyCode ?? null)
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

  // ── Trigger YouTube verification ────────────────────────────────────────────
  async function handleVerify() {
    if (!applicationId) return
    setVerifying(true)
    try {
      const res = await fetch(`/api/creators/apply/${applicationId}/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ roles }),
      })
      const d   = await res.json()
      setVerifyResult(d as VerifyOutcome)
    } catch {
      setVerifyResult({ ok: false, reason: 'youtube_unavailable' })
    } finally {
      setVerifying(false)
    }
  }

  // ── Copy code ───────────────────────────────────────────────────────────────
  function copyCode() {
    if (!verifyCode) return
    navigator.clipboard.writeText(verifyCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Code chip (reusable inside done screens) ────────────────────────────────
  function CodeChip() {
    return (
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-grubano-lg bg-grubano-bg px-3 py-2.5 text-base font-mono font-bold tracking-widest text-grubano-primary truncate">
          {verifyCode}
        </code>
        <button
          type="button"
          onClick={copyCode}
          className="flex items-center gap-1.5 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-xs font-semibold hover:bg-grubano-bg transition shrink-0"
        >
          {copied
            ? <><Check size={12} className="text-grubano-success" />{t('verifyCopied')}</>
            : <><Copy size={12} />{t('verifyCopy')}</>
          }
        </button>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DONE screens
  // ══════════════════════════════════════════════════════════════════════════════
  if (done) {
    const hasYoutube = !!form.youtube.trim()

    // ── A) No YouTube → simple success ─────────────────────────────────────────
    if (!hasYoutube) {
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

    // ── B) YouTube — awaiting first verification ────────────────────────────────
    if (verifyResult === null) {
      return (
        <div className="px-4 pt-8 max-w-lg mx-auto space-y-5">
          <div className="text-center">
            <div className="h-16 w-16 rounded-grubano-pill bg-grubano-success-tint flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={32} className="text-grubano-success" />
            </div>
            <h1 className="text-xl font-display font-bold mb-2">{t('verifyTitle')}</h1>
            <p className="text-sm text-grubano-ink-muted leading-relaxed">{t('verifyDesc')}</p>
          </div>

          <Card elevation="sm" padding="md">
            <p className="text-[10px] text-grubano-ink-muted uppercase tracking-wide font-semibold mb-2">
              {t('verifyCodeLabel')}
            </p>
            <CodeChip />
          </Card>

          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={handleVerify}
            loading={verifying}
          >
            {verifying ? t('verifying') : t('verifyButton')}
          </Button>
        </div>
      )
    }

    // ── C) Verification returned ok (approved or flagged) ──────────────────────
    if (verifyResult.ok) {
      const isApproved = verifyResult.status === 'approved'
      const profileUrl = `/chef/${verifyResult.referralLinkSlug}`
      return (
        <div className="px-4 pt-12 max-w-lg mx-auto text-center">
          <div className={`h-20 w-20 rounded-grubano-pill flex items-center justify-center mx-auto mb-4 ${
            isApproved ? 'bg-grubano-success-tint' : 'bg-grubano-primary/10'
          }`}>
            <CheckCircle2 size={40} className={isApproved ? 'text-grubano-success' : 'text-grubano-primary'} />
          </div>
          <h1 className="text-xl font-display font-bold mb-2">
            {isApproved ? t('verifyApprovedTitle') : t('verifyFlaggedTitle')}
          </h1>
          <p className={`text-sm text-grubano-ink-muted ${!isApproved && verifyResult.reason ? 'mb-2' : 'mb-6'}`}>
            {isApproved ? t('verifyApprovedDesc') : t('verifyFlaggedDesc')}
          </p>
          {!isApproved && verifyResult.reason && (
            <p className="text-xs text-grubano-ink-faint mb-6">{verifyResult.reason}</p>
          )}
          <Link href={profileUrl} className="block w-full">
            <Button variant="primary" size="md" fullWidth rightIcon={<ExternalLink size={14} />}>
              {t('verifyViewProfile')}
            </Button>
          </Link>
        </div>
      )
    }

    // ── D) Code not yet found → show code again + retry ────────────────────────
    if (verifyResult.reason === 'code_not_found') {
      return (
        <div className="px-4 pt-8 max-w-lg mx-auto space-y-5">
          <div className="text-center">
            <div className="h-16 w-16 rounded-grubano-pill bg-amber-50 flex items-center justify-center mx-auto mb-3">
              <Clock size={32} className="text-amber-500" />
            </div>
            <p className="text-sm text-grubano-ink-muted leading-relaxed">{t('verifyCodeNotFound')}</p>
          </div>

          <Card elevation="sm" padding="md">
            <CodeChip />
          </Card>

          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={handleVerify}
            loading={verifying}
          >
            {verifying ? t('verifying') : t('verifyRetry')}
          </Button>
        </div>
      )
    }

    // ── E) Rejected ────────────────────────────────────────────────────────────
    if (verifyResult.status === 'rejected') {
      return (
        <div className="px-4 pt-12 max-w-lg mx-auto text-center">
          <div className="h-20 w-20 rounded-grubano-pill bg-grubano-danger/10 flex items-center justify-center mx-auto mb-4">
            <XCircle size={40} className="text-grubano-danger" />
          </div>
          <h1 className="text-xl font-display font-bold mb-2">{t('verifyRejectedTitle')}</h1>
          <p className="text-sm text-grubano-ink-muted mb-2">{t('verifyRejectedDesc')}</p>
          {verifyResult.reason && (
            <p className="text-xs text-grubano-ink-faint mb-6">{verifyResult.reason}</p>
          )}
          <Button variant="secondary" size="md" fullWidth onClick={() => router.push('/creators')}>
            {t('backToPortal')}
          </Button>
        </div>
      )
    }

    // ── F) Channel not found / API unavailable / config — DISTINCT messages ────
    // Mission 14B-A: one actionable message per failure bucket instead of a
    // single "introuvable". Transient buckets (API/quota, server config) offer a
    // retry; a wrong link sends the user back to fix it.
    const channelMessage =
      verifyResult.reason === 'youtube_unresolved'    ? t('verifyChannelNotFound')
      : verifyResult.reason === 'youtube_unavailable' ? t('verifyChannelUnavailable')
      : verifyResult.reason === 'youtube_config'      ? t('verifyChannelConfig')
      : t('verifyChannelError')
    const canRetry =
      verifyResult.reason === 'youtube_unavailable' || verifyResult.reason === 'youtube_config'
    return (
      <div className="px-4 pt-12 max-w-lg mx-auto text-center">
        <div className="h-20 w-20 rounded-grubano-pill bg-grubano-danger/10 flex items-center justify-center mx-auto mb-4">
          <XCircle size={40} className="text-grubano-danger" />
        </div>
        <p className="text-sm text-grubano-ink-muted mb-6">{channelMessage}</p>
        {canRetry && (
          <Button variant="primary" size="md" fullWidth onClick={handleVerify} loading={verifying} className="mb-3">
            {verifying ? t('verifying') : t('verifyRetry')}
          </Button>
        )}
        <Button variant="secondary" size="md" fullWidth onClick={() => router.push('/creators')}>
          {t('backToPortal')}
        </Button>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FORM (steps 0–2)
  // ══════════════════════════════════════════════════════════════════════════════

  const LABEL_BY_KEY: Record<'profile' | 'portfolio' | 'confirm', string> = {
    profile:   t('stepProfile'),
    portfolio: t('stepPortfolio'),
    confirm:   t('stepConfirm'),
  }
  const STEP_LABELS = STEP_KEYS.map(k => LABEL_BY_KEY[k])

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      <h1 className="text-xl font-display font-bold mb-1">{influencerEntry ? t('titleInfluencer') : t('title')}</h1>
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

        {/* Profile */}
        {currentKey === 'profile' && (
          <div className="space-y-3">
            {/* Mission 2 — role choice: two CUMULABLE cards, at least one
                checked (toggleRole refuses to clear the last). Default: BOTH. */}
            <div>
              <p className="mb-1.5 text-sm font-semibold text-grubano-ink">{t('rolesTitle')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => toggleRole('chef')}
                  aria-pressed={roles.chef}
                  className={`rounded-grubano-lg border-2 p-3 text-start transition ${
                    roles.chef ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-grubano-surface'
                  }`}
                >
                  <p className="text-sm font-bold text-grubano-ink">🍳 {t('roleChefTitle')}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-grubano-ink-muted">{t('roleChefDesc')}</p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleRole('influencer')}
                  aria-pressed={roles.influencer}
                  className={`rounded-grubano-lg border-2 p-3 text-start transition ${
                    roles.influencer ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-grubano-surface'
                  }`}
                >
                  <p className="text-sm font-bold text-grubano-ink">📣 {t('roleInfluencerTitle')}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-grubano-ink-muted">{t('roleInfluencerDesc')}</p>
                </button>
              </div>
              <p className="mt-1 text-[10px] text-grubano-ink-faint">{t('rolesHint')}</p>
            </div>

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
              disabled={emailLocked}
            />
            {emailLocked && (
              <p className="rounded-grubano-lg border border-grubano-primary/20 bg-grubano-tint/50 px-3 py-2 text-[13px] text-grubano-ink-muted">
                {tA('emailLocked')}
              </p>
            )}
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
                placeholder={t('youtubePlaceholder')}
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

        {/* Portfolio — CHEF-only (skipped for a pure influencer) */}
        {currentKey === 'portfolio' && (
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

        {/* Confirmation */}
        {currentKey === 'confirm' && (
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
              // Portfolio summary only when the chef step was actually shown.
              ...(isInfluencerOnly ? [] : [{
                label: t('stepPortfolio'),
                value: t('summaryConcepts', { count: form.dishConcepts.filter(c => c.name).length }),
              }]),
            ]).map(({ label, value }) => (
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
        {step < totalSteps - 1 ? (
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
