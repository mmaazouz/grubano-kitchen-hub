'use client'

import { Link } from '@/navigation'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import './brands.css'

/**
 * /brands — operator MARQUES screen (LOT 7, écran 1) — CD v1 re-skin.
 *
 * PRESENTATION-ONLY re-skin to the navy operator shell (--op-* tokens). The page
 * renders ONLY the content section — the shell (sidebar / topbar / bottom-nav) is
 * mounted by AppChrome → OperatorShell and is NOT touched here.
 *
 * The CD Marques mock is a LIST of the operator's brands (monogram, name, cuisine,
 * status pill, attached-establishment counter, "Gérer") + a stat strip + a
 * "Créer une marque" CTA + empty / skeleton / error / onboarding states. This file
 * reproduces that design on the operator's REAL brands (GET /api/brands/summary),
 * and keeps the full brand-creation flow (from scratch OR by copying an existing
 * brand into an establishment, with the post-copy re-adoption pass for city-exclusive
 * creator dishes) BYTE-IDENTICAL — it is simply surfaced in an op-modal opened by the
 * "Créer une marque" button instead of the previous full-page form.
 *
 * 🔒 DATA LOGIC PRESERVED byte-for-byte:
 *   - GET  /api/brands/summary   (list + operator-level 30-day performance)
 *   - GET  /api/establishments   (switcher / copy targets)
 *   - POST /api/brands           (create from scratch)
 *   - POST /api/brands/copy      (copy into a target establishment)
 *   - POST /api/dishes/adopt     (re-adopt excluded creator dishes)
 * No payload renamed, no handler modified. Money (caBrut) is read verbatim from the
 * endpoint (EUROS → formatEuros) and NEVER recomputed; all figures carry .mono.
 */

type BrandSummary = {
  id:               string
  name:             string
  emoji:            string
  platform:         string
  status:           string
  restaurantId:     string | null
  menuCount:        number
  adoptedDishCount: number
}

type Performance = { windowDays: number; caBrut: number; ordersTotal: number }

type EstablishmentLite = { id: string; name: string; city: string; isActive: boolean }

// Canonical cuisine values shared with the onboarding flow — labels are i18n.
const CUISINE_TYPES = [
  { value: 'italien',   emoji: '🍕' },
  { value: 'asiatique', emoji: '🍜' },
  { value: 'burger',    emoji: '🍔' },
  { value: 'healthy',   emoji: '🥗' },
  { value: 'sushi',     emoji: '🍣' },
  { value: 'desserts',  emoji: '🍰' },
  { value: 'wraps',     emoji: '🥙' },
  { value: 'pasta',     emoji: '🍝' },
  { value: 'autre',     emoji: '🍴' },
] as const
const BRAND_EMOJIS = ['🍕', '🍜', '🍔', '🥗', '🍣', '🍰', '🥙', '🍝', '🌮', '🍱', '🥘', '🥟', '🍴', '🥐']

// Deterministic monogram gradient (matches the CD's coloured monograms) derived
// from the brand name — presentation only, never persisted.
const MONO_GRADIENTS = [
  'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#D5372A,#A8281D)',
  'linear-gradient(135deg,#E8A63D,#B9740A)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#1E9E57,#127A42)',
  'linear-gradient(135deg,#6E56CF,#4B3894)',
  'linear-gradient(135deg,#2E78F0,#1E5AC0)',
]
function monoGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return MONO_GRADIENTS[Math.abs(h) % MONO_GRADIENTS.length]
}
function monogram(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·'
}

interface BrandForm {
  name:        string
  emoji:       string
  cuisineType: string
  tagline:     string
}

type ReadoptStatus = 'idle' | 'loading' | 'done' | 'taken' | 'error'
interface ReadoptItem { creatorDishId: string; name: string; sellingPrice: number; status: ReadoptStatus }
interface ReadoptState { brandId: string; items: ReadoptItem[] }

type LoadState = 'loading' | 'error' | 'loaded'

function BrandsInner() {
  const t      = useTranslations('brands')
  const tOp    = useTranslations('operator')
  const locale = useLocale()

  // The establishment the operator clicked "Ajouter une marque" from, passed by
  // the hub as ?restaurantId=… so the new brand attaches to THAT establishment
  // instead of the cookie-selected / oldest one. Ownership is enforced server-side
  // (POST /api/brands rejects a foreign id with 400) — never resolved by city.
  const searchParams          = useSearchParams()
  const requestedRestaurantId = searchParams.get('restaurantId')

  // Existing brands (list surface + source list for the copy mode + guard).
  const [brands, setBrands]                                 = useState<BrandSummary[]>([])
  const [performance, setPerformance]                       = useState<Performance>({ windowDays: 30, caBrut: 0, ordersTotal: 0 })
  const [establishments, setEstablishments]                 = useState<EstablishmentLite[]>([])
  const [currentEstablishmentId, setCurrentEstablishmentId] = useState<string | null>(null)
  const [loadState, setLoadState]                           = useState<LoadState>('loading')

  // Create modal open + mode toggle.
  const [modalOpen, setModalOpen]   = useState(false)
  const [createMode, setCreateMode] = useState<'scratch' | 'copy'>('scratch')

  // Scratch form.
  const [form, setForm] = useState<BrandForm>({
    name: '', emoji: '🍕', cuisineType: 'italien', tagline: '',
  })

  // Copy form.
  const [copySource, setCopySource] = useState('')
  const [copyTarget, setCopyTarget] = useState('')

  // Flow state.
  const [saving, setSaving]     = useState(false)
  const [copying, setCopying]   = useState(false)
  const [error, setError]       = useState('')
  const [readopt, setReadopt]   = useState<ReadoptState | null>(null)
  const [done, setDone]         = useState(false)

  const loadBrands = useCallback(async () => {
    try {
      const res  = await fetch('/api/brands/summary', { cache: 'no-store' })
      if (!res.ok) throw new Error('load')
      const data = await res.json()
      if (Array.isArray(data?.brands)) setBrands(data.brands)
      if (data?.performance) setPerformance(data.performance)
      return true
    } catch {
      return false
    }
  }, [])

  const loadEstablishments = useCallback(async () => {
    try {
      const res  = await fetch('/api/establishments', { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data?.establishments)) setEstablishments(data.establishments)
      if (typeof data?.currentId === 'string') setCurrentEstablishmentId(data.currentId)
    } catch { /* non-fatal */ }
  }, [])

  const loadAll = useCallback(async () => {
    setLoadState('loading')
    const [brandsOk] = await Promise.all([loadBrands(), loadEstablishments()])
    setLoadState(brandsOk ? 'loaded' : 'error')
  }, [loadBrands, loadEstablishments])

  useEffect(() => {
    let cancelled = false
    ;(async () => { if (!cancelled) await loadAll() })()
    return () => { cancelled = true }
  }, [loadAll])

  // Default copy-target = the active establishment (or the first one), so the
  // operator just picks a source and clicks once.
  useEffect(() => {
    if (!copyTarget) {
      // Prefer the establishment we came from (?restaurantId=…) when it's one of
      // the operator's own; otherwise fall back to the selected / first one.
      const preferred =
        requestedRestaurantId && establishments.some((e) => e.id === requestedRestaurantId)
          ? requestedRestaurantId
          : (currentEstablishmentId ?? establishments[0]?.id ?? '')
      setCopyTarget(preferred)
    }
    if (!copySource && brands.length > 0) {
      setCopySource(brands[0].id)
    }
  }, [brands, establishments, currentEstablishmentId, requestedRestaurantId, copySource, copyTarget])

  // Open the create modal from the ?restaurantId= deep-link (kept: the hub links
  // here to create a brand for a specific establishment).
  useEffect(() => {
    if (requestedRestaurantId) setModalOpen(true)
  }, [requestedRestaurantId])

  function openCreate() { setError(''); setDone(false); setCreateMode('scratch'); setModalOpen(true) }
  function closeCreate() { if (saving || copying) return; setModalOpen(false); setError('') }

  // ── Scratch submit ─────────────────────────────────────────────────────────
  async function submitScratch(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError(t('errName'))
      return
    }
    setError('')
    setSaving(true)
    // Attach to the establishment we came from (?restaurantId=…) when present,
    // else the cookie-selected / first establishment. The server re-checks
    // ownership and rejects a foreign id with 400 — we never resolve by city.
    const targetEstabId = requestedRestaurantId ?? currentEstablishmentId ?? establishments[0]?.id ?? null
    try {
      const res = await fetch('/api/brands', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        form.name.trim(),
          emoji:       form.emoji,
          cuisineType: form.cuisineType,
          tagline:     form.tagline.trim() || null,
          // Explicit target establishment (verified owner-side); null only when
          // the operator has none.
          restaurantId: targetEstabId || undefined,
        }),
      })
      if (res.status === 401) { window.location.href = '/auth/magic'; return }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError((data && (data.error as string)) || t('errSaveFailed'))
        return
      }
      // After create: bounce back to the hub of the target establishment so the
      // operator sees their freshly-created brand listed where it belongs.
      if (targetEstabId) {
        window.location.href = `/dashboard/establishments/${targetEstabId}`
        return
      }
      // Fallback: show a sober confirmation in-place.
      setDone(true)
    } catch {
      setError(t('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  // ── Copy submit (preserves re-adoption follow-up for excluded creator dishes)
  async function submitCopy(e: React.FormEvent) {
    e.preventDefault()
    if (!copySource) { setError(t('copyNoBrands'));  return }
    if (!copyTarget) { setError(t('copyNoTarget')); return }
    setError('')
    setCopying(true)
    try {
      const res = await fetch('/api/brands/copy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBrandId: copySource, targetRestaurantId: copyTarget }),
      })
      if (res.status === 401) { window.location.href = '/auth/magic'; return }
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.brand?.id) {
        setError((data && (data.error as string)) || t('copyErrorFailed'))
        return
      }
      // If adopted dishes were excluded (levier 3B), offer the re-adoption pass
      // in place; otherwise bounce to the target establishment's hub.
      const excluded = Array.isArray(data.excludedAdoptions) ? data.excludedAdoptions : []
      if (excluded.length > 0) {
        setReadopt({
          brandId: data.brand.id as string,
          items: excluded.map((x: { creatorDishId: string; name: string; sellingPrice: number }) => ({
            creatorDishId: x.creatorDishId,
            name:          x.name,
            sellingPrice:  x.sellingPrice,
            status:        'idle' as ReadoptStatus,
          })),
        })
      } else {
        window.location.href = `/dashboard/establishments/${copyTarget}`
      }
    } catch {
      setError(t('errNetwork'))
    } finally {
      setCopying(false)
    }
  }

  // ── Re-adopt one excluded creator recipe into the freshly-copied brand ────
  async function readoptOne(idx: number) {
    if (!readopt) return
    const item = readopt.items[idx]
    if (!item || item.status === 'loading' || item.status === 'done') return
    setReadopt((r) => r && { ...r, items: r.items.map((it, i) => i === idx ? { ...it, status: 'loading' } : it) })
    try {
      const res = await fetch('/api/dishes/adopt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorDishId: item.creatorDishId,
          brandId:       readopt.brandId,
          sellingPrice:  item.sellingPrice,
        }),
      })
      const data = await res.json().catch(() => null)
      const status: ReadoptStatus =
        res.ok                                                ? 'done'
        : res.status === 409 && data?.reason === 'city_taken' ? 'taken'
        :                                                       'error'
      setReadopt((r) => r && { ...r, items: r.items.map((it, i) => i === idx ? { ...it, status } : it) })
    } catch {
      setReadopt((r) => r && { ...r, items: r.items.map((it, i) => i === idx ? { ...it, status: 'error' } : it) })
    }
  }

  function closeReadopt() {
    setReadopt(null)
    // After the operator's done with re-adoption, send them to the hub of the
    // target establishment to see the new brand in context.
    if (copyTarget) window.location.href = `/dashboard/establishments/${copyTarget}`
  }

  // Status pill: active brands are "Active", everything else is honestly labelled
  // "Brouillon" (draft) — mirrors the CD's Active / Brouillon pills.
  const isActive = (s: string) => s === 'active'

  // ── SKELETON ────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <section className="op-brands-skel" aria-busy="true">
        <div className="op-brands-skel__head">
          <span className="op-sk" style={{ width: 110, height: 22 }} />
          <span className="op-sk" style={{ width: 160, height: 38, borderRadius: 8 }} />
        </div>
        <div className="op-card op-brands-skel__strip">
          <span className="op-sk" style={{ width: 110, height: 34 }} />
          <span className="op-sk" style={{ width: 110, height: 34 }} />
          <span className="op-sk" style={{ width: 110, height: 34 }} />
        </div>
        <div className="op-brands-skel__grid">
          <span className="op-sk" style={{ width: '100%', height: 210, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 210, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 210, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <section className="op-error-wrap">
        <div className="op-center">
          <div className="op-error__card">
            <span className="ms" aria-hidden="true">cloud_off</span>
            <h2>{t('brandsErrorTitle')}</h2>
            <p>{tOp('dash.errorBody')}</p>
            <button type="button" className="op-btn-primary" onClick={loadAll}>
              <span className="ms" aria-hidden="true">refresh</span>{tOp('dash.retry')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  const establishmentTotal = new Set(
    brands.map((b) => b.restaurantId).filter((id): id is string => Boolean(id)),
  ).size

  return (
    <>
      <section className="op-brands">
        {/* head */}
        <div className="op-dash__head">
          <div>
            <h1 className="op-dash__title">{t('title')}</h1>
            <p className="op-dash__sub">{t('marquesSubtitle')}</p>
          </div>
          <button type="button" className="op-btn-add" onClick={openCreate}>
            <span className="ms" aria-hidden="true">add</span>{t('createBrandCta')}
          </button>
        </div>

        {brands.length === 0 ? (
          // ── EMPTY ──────────────────────────────────────────────────────────
          <div className="op-card">
            <div className="op-emptyline">
              <span className="ms" aria-hidden="true">branding_watermark</span>
              <b>{t('marquesEmptyTitle')}</b>
              <span>{t('marquesEmptyDesc')}</span>
              <button type="button" className="op-btn-primary" onClick={openCreate}>
                <span className="ms" aria-hidden="true">add</span>{t('createBrandCta')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* stat strip (mono) — REAL brand + establishment counts + 30-day CA/orders */}
            <div className="op-card stat-strip">
              <div className="stat">
                <span className="lbl">{t('title')}</span>
                <b className="mono">{brands.length}</b>
              </div>
              <div className="stat">
                <span className="lbl">{t('marquesStatEstab')}</span>
                <b className="mono">{establishmentTotal}</b>
              </div>
              <div className="stat">
                <span className="lbl">{t('perfRevenue')}</span>
                <b className="mono">{formatEuros(performance.caBrut, locale, { noDecimals: true })}</b>
              </div>
              <div className="stat">
                <span className="lbl">{t('perfOrders')}</span>
                <b className="mono">{performance.ordersTotal}</b>
              </div>
            </div>

            {/* brands grid */}
            <div className="brands-grid">
              {brands.map((b) => {
                const active = isActive(b.status)
                const est    = b.restaurantId
                  ? establishments.find((e) => e.id === b.restaurantId) ?? null
                  : null
                return (
                  <div key={b.id} className="brand-card">
                    <div className="brand-card__top">
                      <span className="brand-mono" style={{ background: monoGradient(b.name) }}>
                        {monogram(b.name)}
                      </span>
                      <div className="brand-card__m">
                        <b>{b.emoji ? `${b.emoji} ` : ''}{b.name}</b>
                        <span>{b.platform || t('filterGrubano')}</span>
                      </div>
                      <span className={`brand-status ${active ? 'active' : 'draft'}`}>
                        <i className="dot" />{active ? t('statusActivePill') : t('statusDraftPill')}
                      </span>
                    </div>

                    <div className="brand-est-row">
                      <span className="ms" aria-hidden="true">storefront</span>
                      <span className="m">{t('marquesEstRow')}</span>
                      <span className="brand-est-count">{b.restaurantId ? 1 : 0}</span>
                    </div>

                    {est && (
                      <div className="brand-avatars">
                        <span className="op-estab__mini" style={{ width: 28, height: 28 }}>
                          {monogram(est.name)}
                        </span>
                      </div>
                    )}

                    {/* honest counters (menu + adopted creator dishes) */}
                    <div className="brand-metrics">
                      <div className="brand-metric">
                        <span className="ms" aria-hidden="true">menu_book</span>
                        <span className="brand-metric__v mono">{b.menuCount}</span>
                        <span className="brand-metric__l">{t('statMenu')}</span>
                      </div>
                      <div className="brand-metric">
                        <span className="ms" aria-hidden="true">auto_awesome</span>
                        <span className="brand-metric__v mono">{b.adoptedDishCount}</span>
                        <span className="brand-metric__l">{t('statAdopted')}</span>
                      </div>
                    </div>

                    {/* "Gérer" → the brand's establishment hub when attached; the
                        detail route /brands/[id] doesn't exist yet → honest inert
                        for detached (draft) brands. */}
                    {b.restaurantId ? (
                      <Link
                        href={`/dashboard/establishments/${b.restaurantId}`}
                        className="brand-manage-btn"
                      >
                        <span className="ms" aria-hidden="true">settings</span>{t('marquesManage')}
                      </Link>
                    ) : (
                      <span className="brand-manage-btn is-inert" aria-disabled="true">
                        <span className="ms" aria-hidden="true">settings</span>
                        {t('marquesManage')} · {tOp('soon')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      {/* ══ CREATE MODAL (scratch / copy — logic byte-identical) ══════════════ */}
      {modalOpen && (
        <div className="op-modal-backdrop" onClick={closeCreate}>
          <div
            className="op-modal wide"
            role="dialog"
            aria-modal="true"
            aria-label={t('createTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="op-modal__head">
              <h3>{t('createTitle')}</h3>
              <button type="button" className="op-modal__close" onClick={closeCreate} aria-label={t('cancel')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>

            <div className="op-modal__body">
              <p className="op-modal__lead">{t('pageDescCreate')}</p>

              {/* Mode toggle */}
              <div className="op-mode-toggle">
                <button
                  type="button"
                  className={`op-mode-btn${createMode === 'scratch' ? ' is-active' : ''}`}
                  onClick={() => { setError(''); setCreateMode('scratch') }}
                >
                  <span className="ms" aria-hidden="true">add</span>{t('copyModeScratch')}
                </button>
                <button
                  type="button"
                  className={`op-mode-btn${createMode === 'copy' ? ' is-active' : ''}`}
                  onClick={() => { setError(''); setCreateMode('copy') }}
                  disabled={brands.length === 0}
                >
                  <span className="ms" aria-hidden="true">content_copy</span>{t('copyModeCopy')}
                </button>
              </div>

              {error && (
                <div className="op-callout op-callout--danger">
                  <span className="ms" aria-hidden="true">error</span>
                  <span>{error}</span>
                </div>
              )}
              {done && (
                <div className="op-callout op-callout--success">
                  <span className="ms" aria-hidden="true">check_circle</span>
                  <span>{t('create')} ✓</span>
                </div>
              )}

              {createMode === 'scratch' ? (
                <form id="brand-scratch-form" onSubmit={submitScratch} className="op-form">
                  <div className="op-field">
                    <label htmlFor="brand-name">{t('fieldName')}</label>
                    <input
                      id="brand-name"
                      className="op-input"
                      value={form.name}
                      maxLength={80}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={t('fieldNamePlaceholder')}
                    />
                  </div>

                  <div className="op-field">
                    <label>{t('fieldCuisine')}</label>
                    <div className="op-cuisine-grid">
                      {CUISINE_TYPES.map((c) => {
                        const activeC = form.cuisineType === c.value
                        return (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => setForm({ ...form, cuisineType: c.value })}
                            className={`op-cuisine-chip${activeC ? ' is-active' : ''}`}
                          >
                            <span className="e">{c.emoji}</span>
                            <span>{t(`cuisine_${c.value}` as 'cuisine_italien')}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="op-field">
                    <label>{t('fieldEmoji')}</label>
                    <div className="op-emoji-grid">
                      {BRAND_EMOJIS.map((e2) => (
                        <button
                          key={e2}
                          type="button"
                          onClick={() => setForm({ ...form, emoji: e2 })}
                          aria-label={e2}
                          className={`op-emoji-chip${form.emoji === e2 ? ' is-active' : ''}`}
                        >
                          {e2}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="op-field">
                    <label htmlFor="brand-tagline">{t('fieldTagline')}</label>
                    <input
                      id="brand-tagline"
                      className="op-input"
                      value={form.tagline}
                      maxLength={140}
                      onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                      placeholder={t('fieldTaglinePlaceholder')}
                    />
                  </div>
                </form>
              ) : (
                // ── COPY MODE ─────────────────────────────────────────────────
                brands.length === 0 ? (
                  <div className="op-callout op-callout--info">
                    <span className="ms" aria-hidden="true">info</span>
                    <span>{t('copyNoBrands')}</span>
                  </div>
                ) : (
                  <form id="brand-copy-form" onSubmit={submitCopy} className="op-form">
                    <div className="op-field">
                      <label htmlFor="copy-source">{t('copySourceLabel')}</label>
                      <select
                        id="copy-source"
                        className="op-select"
                        value={copySource}
                        onChange={(e) => setCopySource(e.target.value)}
                      >
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="op-field">
                      <label htmlFor="copy-target">{t('copyTargetLabel')}</label>
                      <select
                        id="copy-target"
                        className="op-select"
                        value={copyTarget}
                        onChange={(e) => setCopyTarget(e.target.value)}
                      >
                        {establishments.length === 0 && <option value="">—</option>}
                        {establishments.map((es) => (
                          <option key={es.id} value={es.id}>
                            {es.name}{es.city ? ` · ${es.city}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="op-callout op-callout--info">
                      <span className="ms" aria-hidden="true">content_copy</span>
                      <span>{t('copyHint')}</span>
                    </div>
                  </form>
                )
              )}
            </div>

            <div className="op-modal__foot">
              <button type="button" className="op-btn-ghost" onClick={closeCreate}>
                {t('cancel')}
              </button>
              {createMode === 'scratch' ? (
                <button
                  type="submit"
                  form="brand-scratch-form"
                  className="op-btn-primary"
                  disabled={saving}
                >
                  {saving ? <span className="op-spin" aria-hidden="true" /> : <span className="ms" aria-hidden="true">add</span>}
                  {t('create')}
                </button>
              ) : (
                <button
                  type="submit"
                  form="brand-copy-form"
                  className="op-btn-primary"
                  disabled={copying || !copyTarget || brands.length === 0}
                >
                  {copying ? <span className="op-spin" aria-hidden="true" /> : <span className="ms" aria-hidden="true">content_copy</span>}
                  {t('copyButton')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ RE-ADOPTION follow-up (city-exclusive creator dishes) ═════════════ */}
      {readopt && (
        <div className="op-modal-backdrop" onClick={closeReadopt}>
          <div
            className="op-modal wide"
            role="dialog"
            aria-modal="true"
            aria-label={t('readoptTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="op-modal__head">
              <h3>{t('readoptTitle')}</h3>
              <button type="button" className="op-modal__close" onClick={closeReadopt} aria-label={t('readoptClose')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              <p className="op-modal__lead">{t('readoptIntro')}</p>
              <ul className="op-readopt-list">
                {readopt.items.map((it, idx) => (
                  <li key={it.creatorDishId} className="op-readopt-row">
                    <span className="ms op-readopt-row__ic" aria-hidden="true">auto_awesome</span>
                    <div className="op-readopt-row__m">
                      <p className="op-readopt-row__name">{it.name}</p>
                      <p className="op-readopt-row__price mono">
                        {formatEuros(it.sellingPrice, locale)}
                      </p>
                    </div>
                    {it.status === 'done' ? (
                      <span className="op-readopt-row__done">
                        <span className="ms" aria-hidden="true">check</span>{t('readoptDone')}
                      </span>
                    ) : it.status === 'taken' ? (
                      <span className="op-readopt-row__taken">
                        <span className="ms" aria-hidden="true">warning</span>{t('readoptCityTaken')}
                      </span>
                    ) : it.status === 'error' ? (
                      <button
                        type="button"
                        onClick={() => readoptOne(idx)}
                        className="op-readopt-row__retry"
                      >
                        {t('readoptError')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="op-btn-ghost op-readopt-row__btn"
                        disabled={it.status === 'loading'}
                        onClick={() => readoptOne(idx)}
                      >
                        {it.status === 'loading' && <span className="op-spin" aria-hidden="true" />}
                        {t('readoptBtn')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="op-modal__foot">
              <button type="button" className="op-btn-primary" onClick={closeReadopt}>
                {t('readoptClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function BrandsPage() {
  // useSearchParams() (read in BrandsInner) requires a Suspense boundary in the
  // Next.js 14 App Router, or the build fails with a CSR-bailout error.
  return (
    <Suspense fallback={null}>
      <BrandsInner />
    </Suspense>
  )
}
