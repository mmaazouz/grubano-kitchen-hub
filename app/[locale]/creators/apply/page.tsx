'use client'

// ── CR2 · Candidature publique créateur (CD marketing --gb-*, scoped .cr-mkt) ────
// PUBLIC route /creators/apply (∈ AppChrome BARE_PREFIXES) → full-bleed marketing
// gb-foundation clair, accent ROSE-MAGENTA créateur. This is a RE-SKIN of the real
// multi-step vetting wizard — the CD mock is a simple form→success, but the genuine
// flow (profile · portfolio · confirm → verifyCode + YouTube ownership-proof → verify
// → verdicts) is preserved byte-identical. Every fetch URL/body and every step is
// unchanged; only the visual language (Material Symbols, --gb-cr, plain elements)
// replaces the old design-system + lucide-react.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/navigation'
import { type CategorySlug } from '@/lib/categories'
import './creator-apply.css'

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
  const [consent,    setConsent]    = useState(false)
  const [form,       setForm]       = useState<FormData>({
    name: '', email: '', bio: '',
    instagram: '', tiktok: '', youtube: '', followers: '',
    dishConcepts: [{ ...EMPTY_CONCEPT }],
  })

  // B1.3-C — when arriving from the "add an activity" hub the email is carried in
  // ?email= and LOCKED, so the creator activity attaches to the SAME connected
  // account (never a 2nd Operator). Public visitors (no ?email) keep a free field.
  const [emailLocked, setEmailLocked] = useState(false)

  // Phase 3 — a logged-in user arriving via "Devenir aussi créateur" carries their
  // email in ?email= so the form is pre-filled (multi-role cumul: same account
  // gains the creator role on approval). Read from the URL on mount — no
  // useSearchParams (avoids a Suspense boundary); never overwrites a typed value.
  // Agent 120 (unification « recommander » incr. 3/3) — the creator wizard is now
  // CHEF-ONLY: the recommend rail moved to the Affiliate programme (/affiliate/apply),
  // so there is no role choice and the legacy ?type=influencer entry is gone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const email = params.get('email')
    if (email) { setForm(f => (f.email ? f : { ...f, email })); setEmailLocked(true) }
  }, [])

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

  // ── Step model ────────────────────────────────────────────────────────────────
  // Agent 120 — the creator is now purely a CHEF: always the three-step flow
  // (profile · portfolio · confirm), and the dish-concepts portfolio is mandatory
  // (≥1 concept, enforced by canProceed + the apply route). The recommend/influencer
  // rail moved to the Affiliate programme.
  const STEP_KEYS: Array<'profile' | 'portfolio' | 'confirm'> = ['profile', 'portfolio', 'confirm']
  const currentKey = STEP_KEYS[step] ?? 'profile'
  const totalSteps = STEP_KEYS.length

  function canProceed(): boolean {
    if (currentKey === 'profile')   return !!form.name && !!form.email && form.bio.length >= 10
    if (currentKey === 'portfolio') return form.dishConcepts.some(c => c.name && c.description && c.cuisineType)
    return consent // confirm — RGPD consent required before submit
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
        // Agent 120 — chef-only: no roles sent; the verify route defaults a new creator
        // to chef-only (isInfluencer=false) and grandfathers any existing influencer.
        body:    JSON.stringify({}),
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

  // ── Shared marketing chrome (nav + brand) ───────────────────────────────────
  function Nav() {
    return (
      <nav className="nav">
        <div className="nav__in">
          <Link href="/creators" className="nav__brand">
            <img src="/brand/grubano-symbol-color.svg" alt="Grubano" />
            <b>Grubano</b>
            <span>Creators</span>
          </Link>
          <button type="button" className="nav__back" onClick={() => router.push('/creators')}>
            <span className="ms">arrow_back</span>{t('navBack')}
          </button>
        </div>
      </nav>
    )
  }

  // ── Verification code chip (reused across proof / retry states) ──────────────
  function CodeChip() {
    return (
      <div className="code-row">
        <code>{verifyCode}</code>
        <button type="button" className={`code-copy${copied ? ' copied' : ''}`} onClick={copyCode}>
          <span className="ms">{copied ? 'check' : 'content_copy'}</span>
          {copied ? t('verifyCopied') : t('verifyCopy')}
        </button>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DONE screens — the real vetting outcomes (unchanged logic, re-skinned)
  // ══════════════════════════════════════════════════════════════════════════════
  if (done) {
    const hasYoutube = !!form.youtube.trim()

    // ── A) No YouTube → simple success (no ownership-proof step to run) ─────────
    if (!hasYoutube) {
      return (
        <div className="cr-mkt">
          <Nav />
          <div className="page">
            <div className="verify-wrap">
              <div className="vcard">
                <div className="vic vic--cr"><span className="ms">celebration</span></div>
                <h2>{t('successTitle')}</h2>
                <p>{t('successDesc')}</p>
                {applicationId && (
                  <div className="success__ref"><span className="ms">tag</span>{applicationId}</div>
                )}
                <div className="success__steps">
                  <div className="s"><span className="ms">query_stats</span>{t('successStepReview')}</div>
                  <div className="s"><span className="ms">verified</span>{t('successStepStudio')}</div>
                  <div className="s"><span className="ms">restaurant_menu</span>{t('successStepPublish')}</div>
                </div>
                <div className="actions">
                  <button type="button" className="btn-cr" onClick={() => router.push('/creators')}>
                    <span className="ms">home</span>{t('backToPortal')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // ── B) YouTube — awaiting first verification (ownership-proof instructions) ──
    if (verifyResult === null) {
      return (
        <div className="cr-mkt">
          <Nav />
          <div className="page">
            <div className="verify-wrap">
              <div className="vcard">
                <div className="vic vic--cr"><span className="ms">how_to_reg</span></div>
                <h2>{t('verifyTitle')}</h2>
                <p>{t('verifyDesc')}</p>
                <div className="code-box">
                  <p className="code-box__lbl">{t('verifyCodeLabel')}</p>
                  <CodeChip />
                </div>
                <div className="actions">
                  <button type="button" className="btn-cr" onClick={handleVerify} disabled={verifying}>
                    <span className="ms">{verifying ? 'progress_activity' : 'verified_user'}</span>
                    {verifying ? t('verifying') : t('verifyButton')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // ── C) Verification returned ok (approved or flagged) ──────────────────────
    if (verifyResult.ok) {
      const isApproved = verifyResult.status === 'approved'
      const profileUrl = `/chef/${verifyResult.referralLinkSlug}`
      return (
        <div className="cr-mkt">
          <Nav />
          <div className="page">
            <div className="verify-wrap">
              <div className="vcard">
                <div className={`vic ${isApproved ? 'vic--ok' : 'vic--cr'}`}>
                  <span className="ms">{isApproved ? 'verified' : 'hourglass_top'}</span>
                </div>
                <h2>{isApproved ? t('verifyApprovedTitle') : t('verifyFlaggedTitle')}</h2>
                <p>{isApproved ? t('verifyApprovedDesc') : t('verifyFlaggedDesc')}</p>
                {!isApproved && verifyResult.reason && (
                  <p className="subtle">{verifyResult.reason}</p>
                )}
                <div className="actions">
                  <Link href={profileUrl} className="btn-cr">
                    <span className="ms">open_in_new</span>{t('verifyViewProfile')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // ── D) Code not yet found → show code again + retry ────────────────────────
    if (verifyResult.reason === 'code_not_found') {
      return (
        <div className="cr-mkt">
          <Nav />
          <div className="page">
            <div className="verify-wrap">
              <div className="vcard">
                <div className="vic vic--warn"><span className="ms">schedule</span></div>
                <h2>{t('verifyCodeNotFoundTitle')}</h2>
                <p>{t('verifyCodeNotFound')}</p>
                <div className="code-box">
                  <p className="code-box__lbl">{t('verifyCodeLabel')}</p>
                  <CodeChip />
                </div>
                <div className="actions">
                  <button type="button" className="btn-cr" onClick={handleVerify} disabled={verifying}>
                    <span className="ms">{verifying ? 'progress_activity' : 'refresh'}</span>
                    {verifying ? t('verifying') : t('verifyRetry')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // ── E) Rejected ────────────────────────────────────────────────────────────
    if (verifyResult.status === 'rejected') {
      return (
        <div className="cr-mkt">
          <Nav />
          <div className="page">
            <div className="verify-wrap">
              <div className="vcard">
                <div className="vic vic--err"><span className="ms">cancel</span></div>
                <h2>{t('verifyRejectedTitle')}</h2>
                <p>{t('verifyRejectedDesc')}</p>
                {verifyResult.reason && <p className="subtle">{verifyResult.reason}</p>}
                <div className="actions">
                  <button type="button" className="btn-ghost" onClick={() => router.push('/creators')}>
                    <span className="ms">arrow_back</span>{t('backToPortal')}
                  </button>
                </div>
              </div>
            </div>
          </div>
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
      <div className="cr-mkt">
        <Nav />
        <div className="page">
          <div className="verify-wrap">
            <div className="vcard">
              <div className="vic vic--err"><span className="ms">error</span></div>
              <h2>{t('verifyChannelTitle')}</h2>
              <p>{channelMessage}</p>
              <div className="actions">
                {canRetry && (
                  <button type="button" className="btn-cr" onClick={handleVerify} disabled={verifying}>
                    <span className="ms">{verifying ? 'progress_activity' : 'refresh'}</span>
                    {verifying ? t('verifying') : t('verifyRetry')}
                  </button>
                )}
                <button type="button" className="btn-ghost" onClick={() => router.push('/creators')}>
                  <span className="ms">arrow_back</span>{t('backToPortal')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FORM (steps 0–2) — CD marketing layout, real 3-step wizard
  // ══════════════════════════════════════════════════════════════════════════════

  const LABEL_BY_KEY: Record<'profile' | 'portfolio' | 'confirm', string> = {
    profile:   t('stepProfile'),
    portfolio: t('stepPortfolio'),
    confirm:   t('stepConfirm'),
  }
  const STEP_LABELS = STEP_KEYS.map(k => LABEL_BY_KEY[k])

  return (
    <div className="cr-mkt">
      <Nav />
      <div className="page">
        <div className="head">
          <span className="eyebrow"><span className="ms">palette</span>{t('eyebrow')}</span>
          <h1>{t('headTitle')}</h1>
          <p>{t('headSubtitle')}</p>
        </div>

        {/* Stepper — reflects the REAL current step (done / active / upcoming) */}
        <div className="stepper">
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div className={`sp ${i < step ? 'done' : i === step ? 'active' : ''}`}>
                <span className="sp__d">{i < step ? <span className="ms">check</span> : i + 1}</span>
                <span className="sp__l">{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && <div className="sp__line" />}
            </div>
          ))}
        </div>

        <div className="grid">
          <div className="form-card">

            {/* Profile */}
            {currentKey === 'profile' && (
              <div className="fsec">
                <div className="fsec__h">
                  <span className="fsec__n">1</span>
                  <div><b>{t('secProfileTitle')}</b><span>{t('secProfileSub')}</span></div>
                </div>
                <div className="fld">
                  <label>{t('labelName')}</label>
                  <input
                    className="inp" type="text" placeholder="Amina K."
                    value={form.name} onChange={e => setField('name', e.target.value)}
                  />
                </div>
                <div className="fld">
                  <label>{t('labelEmail')}</label>
                  <input
                    className="inp" type="email" placeholder="amina@exemple.fr"
                    value={form.email} onChange={e => setField('email', e.target.value)}
                    disabled={emailLocked}
                  />
                  {emailLocked && (
                    <div className="locked"><span className="ms">lock</span>{tA('emailLocked')}</div>
                  )}
                </div>
                <div className="fld">
                  <label>{t('labelBio')}</label>
                  <textarea
                    className="inp" rows={3} placeholder={t('bioPlaceholder')}
                    value={form.bio} onChange={e => setField('bio', e.target.value)}
                  />
                </div>
                <div className="row2">
                  <div className="fld">
                    <label>{t('labelInstagram')} <span className="opt">{t('optional')}</span></label>
                    <input
                      className="inp" type="text" placeholder="@amina.cuisine"
                      value={form.instagram} onChange={e => setField('instagram', e.target.value)}
                    />
                  </div>
                  <div className="fld">
                    <label>{t('labelTiktok')} <span className="opt">{t('optional')}</span></label>
                    <input
                      className="inp" type="text" placeholder="@amina.tiktok"
                      value={form.tiktok} onChange={e => setField('tiktok', e.target.value)}
                    />
                  </div>
                </div>
                <div className="row2">
                  <div className="fld">
                    <label>{t('labelYoutube')} <span className="opt">{t('optional')}</span></label>
                    <input
                      className="inp" type="text" placeholder={t('youtubePlaceholder')}
                      value={form.youtube} onChange={e => setField('youtube', e.target.value)}
                    />
                    <p className="hint"><span className="ms">verified_user</span>{t('youtubeHint')}</p>
                  </div>
                  <div className="fld">
                    <label>{t('labelFollowers')} <span className="opt">{t('optional')}</span></label>
                    <input
                      className="inp" type="number" placeholder="12000" min="0"
                      value={form.followers} onChange={e => setField('followers', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Portfolio — CHEF-only mandatory dish concepts (server superRefine rejects empty) */}
            {currentKey === 'portfolio' && (
              <div className="fsec">
                <div className="fsec__h">
                  <span className="fsec__n">2</span>
                  <div><b>{t('secPortfolioTitle')}</b><span>{t('secPortfolioSub')}</span></div>
                </div>
                <p className="hint" style={{ marginBottom: 14 }}>
                  <span className="ms">info</span>{t('portfolioHint')}
                </p>
                {form.dishConcepts.map((concept, i) => (
                  <div key={i} className="concept">
                    <div className="concept__top">
                      <span className="concept__n">{t('conceptLabel', { n: i + 1 })}</span>
                      {form.dishConcepts.length > 1 && (
                        <button type="button" className="concept__rm" onClick={() => removeConcept(i)}>
                          <span className="ms">delete</span>
                        </button>
                      )}
                    </div>
                    <input
                      className="inp" type="text" placeholder={t('conceptNamePlaceholder')}
                      value={concept.name} onChange={e => setDishField(i, 'name', e.target.value)}
                    />
                    <select
                      className="inp" value={concept.cuisineType}
                      onChange={e => setDishField(i, 'cuisineType', e.target.value)}
                    >
                      <option value="">{t('conceptCuisinePlaceholder')}</option>
                      {CUISINE_SLUGS.map(slug => (
                        <option key={slug} value={slug}>{CUISINE_LABELS[slug]}</option>
                      ))}
                    </select>
                    <textarea
                      className="inp" rows={2} placeholder={t('conceptDescPlaceholder')}
                      value={concept.description}
                      onChange={e => setDishField(i, 'description', e.target.value)}
                    />
                  </div>
                ))}
                {form.dishConcepts.length < 3 && (
                  <button type="button" className="add-concept" onClick={addConcept}>
                    <span className="ms">add</span>{t('addConcept')}
                  </button>
                )}
              </div>
            )}

            {/* Confirmation */}
            {currentKey === 'confirm' && (
              <>
                <div className="fsec">
                  <div className="fsec__h">
                    <span className="fsec__n">3</span>
                    <div><b>{t('secConfirmTitle')}</b><span>{t('secConfirmSub')}</span></div>
                  </div>
                  <div className="summary">
                    {([
                      { label: t('summaryName'),  value: form.name },
                      { label: t('summaryEmail'), value: form.email },
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
                    ]).map(({ label, value }) => (
                      <div key={label} className="summary__row">
                        <span className="summary__k">{label}</span>
                        <span className="summary__v">{value}</span>
                      </div>
                    ))}
                  </div>
                  <label className="consent" style={{ marginTop: 16 }}>
                    <input
                      type="checkbox" checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                    />
                    <span>
                      {t('consentPre')}{' '}
                      <Link href="/legal/confidentialite" target="_blank" rel="noopener noreferrer">
                        {t('consentLink')}
                      </Link>
                      {t('consentPost')}
                    </span>
                  </label>
                </div>
                {error && <div className="form-err">{error}</div>}
              </>
            )}

            {/* Footer navigation — back / continue / submit */}
            <div className="form-foot">
              {step > 0 && (
                <button type="button" className="btn-ghost" onClick={() => setStep(s => s - 1)}>
                  <span className="ms">arrow_back</span>{t('back')}
                </button>
              )}
              {step < totalSteps - 1 ? (
                <button
                  type="button" className="btn-cr"
                  onClick={() => setStep(s => s + 1)} disabled={!canProceed()}
                >
                  {t('continue')}<span className="ms">arrow_forward</span>
                </button>
              ) : (
                <button
                  type="button" className="btn-cr"
                  onClick={handleSubmit} disabled={submitting || !canProceed()}
                >
                  <span className="ms">{submitting ? 'progress_activity' : 'send'}</span>
                  {submitting ? t('submitting') : t('submit')}
                </button>
              )}
              <span className="note"><span className="ms">check_circle</span>{t('footNote')}</span>
            </div>
          </div>

          {/* aside — honest "100% free" programme + what awaits */}
          <aside className="aside">
            <div className="aside__promo">
              <span className="ms">workspace_premium</span>
              <b>{t('asidePromoTitle')}</b>
              <span>{t('asidePromoBody')}</span>
            </div>
            <div className="aside__card">
              <h3><span className="ms">auto_awesome</span>{t('asideAwaitsTitle')}</h3>
              <ul className="aside__list">
                <li><span className="ms">check_circle</span>{t('asideAwaits1')}</li>
                <li><span className="ms">check_circle</span>{t('asideAwaits2')}</li>
                <li><span className="ms">check_circle</span>{t('asideAwaits3')}</li>
                <li><span className="ms">check_circle</span>{t('asideAwaits4')}</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
